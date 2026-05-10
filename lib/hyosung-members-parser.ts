// lib/hyosung-members-parser.ts
// D1 — Phase 3 (마일스톤 #16 단계 D): 효성 계약정보 행 → SIREN members 매핑·생성 lib
// 파싱(CSV → 객체)은 lib/hyosung-parser.ts에 위임.
// 이 파일은 DB 매핑 (기존 회원 갱신 / 미매칭 신규 생성) 담당.
/* === A: m16-step-d-parser === */

import { eq } from "drizzle-orm";
import { db, members } from "../db";
import type { HyosungContractRow } from "./hyosung-parser";
import { toContractStatusCode } from "./hyosung-mapper";
import { createHyosungMember } from "./member-classifier";
import { safeReevaluate } from "./donor-status";

/* =========================================================
   결과 타입
   ========================================================= */

export type UpsertMemberOutcome =
  | "matched_hyosung_no"  // hyosung_member_no 일치 → 기존 회원 업데이트
  | "matched_phone"       // phone 단일 일치 → 기존 회원 업데이트
  | "created"             // 미매칭 → 신규 회원 자동 생성
  | "conflict"            // phone 2+명 일치 → 스킵 (매칭 불가)
  | "error";              // DB 오류 → 스킵

export interface UpsertMemberResult {
  outcome: UpsertMemberOutcome;
  memberId?: number;
  isNew: boolean;
  conflictCount?: number;  // outcome='conflict' 시 중복 수
  error?: string;
}

/* =========================================================
   내부 헬퍼: 효성 운영 컬럼 업데이트 페이로드
   결제방식·결제수단 cross-mapping은 hyosung-mapper.ts §5.2 준수.
   contractStatus는 toContractStatusCode() 영문 코드로 변환 (cron 의존 제거).
   ========================================================= */
function buildHyosungUpdate(row: HyosungContractRow) {
  return {
    hyosungMemberNo: row.memberNo,
    hyosungContractStatus: toContractStatusCode(row.contractStatus), // 영문 코드 즉시 반영
    hyosungPaymentMethod: row.paymentTool   ?? null,  // 결제수단(CMS/카드) — cross-mapping
    hyosungPaymentTool:   row.paymentMethod ?? null,  // 결제방식(자동결제/미등록) — cross-mapping
    hyosungBankInfo:      row.paymentInfo   ?? null,
    hyosungPromiseDay:    row.promiseDay    ?? null,
    hyosungSyncedAt:      new Date(),
  };
}

/* =========================================================
   핵심 함수: 계약정보 행 1개 → members 반영
   ========================================================= */

/**
 * 효성 계약정보 CSV 1행을 SIREN members에 반영한다.
 *
 * 매칭 우선순위:
 *   1. hyosung_member_no 일치 (이미 연동된 회원 — 재업로드 시 빠른 경로)
 *   2. phone 단일 일치 (최초 업로드 — 단 1명만 일치할 때만 허용)
 *   3. 미매칭 → createHyosungMember (가상 이메일 신규 생성)
 *
 * 업데이트 대상: 효성 운영 컬럼(hyosung_*)만, SIREN 고유 컬럼(메모·등급·태그) 보존.
 * safeReevaluate: 갱신·생성 직후 donor_type 즉시 재평가 (fire-and-forget).
 */
export async function upsertMemberFromContract(
  row: HyosungContractRow,
): Promise<UpsertMemberResult> {
  try {
    const update = buildHyosungUpdate(row);

    /* --- 1순위: hyosung_member_no 매칭 (재업로드 안전 경로) --- */
    const [byHyosungNo] = await db
      .select({ id: members.id })
      .from(members)
      .where(eq((members as any).hyosungMemberNo, row.memberNo))
      .limit(1);

    if (byHyosungNo) {
      await db.update(members).set(update).where(eq(members.id, byHyosungNo.id));
      await safeReevaluate(byHyosungNo.id, "hyosung-members-parser");
      return { outcome: "matched_hyosung_no", memberId: byHyosungNo.id, isNew: false };
    }

    /* --- 2순위: phone 단일 매칭 --- */
    if (row.phone) {
      const byPhone = await db
        .select({ id: members.id })
        .from(members)
        .where(eq(members.phone, row.phone));

      if (byPhone.length === 1) {
        await db.update(members).set(update).where(eq(members.id, byPhone[0].id));
        await safeReevaluate(byPhone[0].id, "hyosung-members-parser");
        return { outcome: "matched_phone", memberId: byPhone[0].id, isNew: false };
      }

      if (byPhone.length > 1) {
        /* phone 중복 — 어느 회원인지 특정 불가. 스킵. */
        return { outcome: "conflict", isNew: false, conflictCount: byPhone.length };
      }
    }

    /* --- 3순위: 미매칭 → 신규 회원 자동 생성 --- */
    const created = await createHyosungMember({
      hyosungMemberNo: row.memberNo,
      donorName: row.memberName || "",
      phone: row.phone,
    });

    if (!created.ok || !created.memberId) {
      return {
        outcome: "error",
        isNew: false,
        error: created.error || "createHyosungMember 실패",
      };
    }

    /* 생성 직후 효성 운영 컬럼 및 donor_type 설정 */
    await db.update(members).set(update).where(eq(members.id, created.memberId));
    await safeReevaluate(created.memberId, "hyosung-members-parser-new");

    return { outcome: "created", memberId: created.memberId, isNew: true };
  } catch (err: any) {
    return {
      outcome: "error",
      isNew: false,
      error: String(err?.message || err).slice(0, 200),
    };
  }
}
