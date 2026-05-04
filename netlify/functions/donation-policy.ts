// netlify/functions/donation-policy.ts
// ★ Phase M-4 + 핫픽스: 후원 정책 조회 (공개 API)
// - 에러 원인 진단 강화 (상세 로그)
// - DB 조회 실패 시에도 폴백 응답 (사용자 모달 정상 작동)
// - schema 로드 실패 방어

import type { Context } from "@netlify/functions";
import {
  ok, serverError, corsPreflight, methodNotAllowed,
} from "../../lib/response";

export const config = { path: "/api/donation-policy" };

/* 폴백 기본값 (항상 반환 가능) */
const FALLBACK_POLICY = {
  regularAmounts: [10000, 30000, 50000, 100000, 300000, 500000],
  onetimeAmounts: [10000, 30000, 50000, 100000, 300000, 500000],
  bankName: "국민은행",
  bankAccountNo: "(계좌번호 미등록)",
  bankAccountHolder: "(사)교사유가족협의회",
  bankGuideText: "입금 확인까지 1~3일 이내 소요될 수 있습니다. 입금자명을 정확히 입력해 주세요.",
  hyosungUrl: "https://ap.hyosungcmsplus.co.kr/external/shorten/20240709hAxVVDFECf",
  hyosungGuideText: "효성 CMS+에서 등록한 경우 등록 완료까지 2~3일 정도 소요됩니다. 확인 버튼을 누르면 효성 CMS+ 등록 페이지로 이동합니다.",
  modalTitle: "🎗 후원 동참하기",
  modalSubtitle: "여러분의 따뜻한 마음이 유가족에게 큰 힘이 됩니다.",
};

function parseJsonArr(v: any): any[] {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  try {
    const a = JSON.parse(v);
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  try {
    /* ★ 지연 import (schema 로드 실패 방어) */
    let db: any, donationPolicies: any, eq: any;
    try {
      const dbModule = await import("../../db");
      db = dbModule.db;
      const schemaModule = await import("../../db/schema");
      donationPolicies = schemaModule.donationPolicies;
      const drizzleModule = await import("drizzle-orm");
      eq = drizzleModule.eq;
    } catch (importErr: any) {
      console.error("[donation-policy] ★ 모듈 import 실패:", {
        message: importErr?.message,
        stack: importErr?.stack?.slice(0, 500),
      });
      /* schema 로드 실패 → 폴백 반환 (500 대신 200) */
      return ok(FALLBACK_POLICY, "기본 정책 (시스템 일시 점검 중)");
    }

    /* ★ DB 조회 (개별 try-catch로 격리) */
    let row: any = null;
    try {
      const result = await db
        .select()
        .from(donationPolicies)
        .where(eq(donationPolicies.id, 1))
        .limit(1);
      row = result && result.length > 0 ? result[0] : null;
    } catch (dbErr: any) {
      console.error("[donation-policy] ★ DB 조회 실패:", {
        message: dbErr?.message,
        code: dbErr?.code,
        stack: dbErr?.stack?.slice(0, 500),
      });
      /* DB 조회 실패 → 폴백 반환 (500 대신 200) */
      return ok(FALLBACK_POLICY, "기본 정책 (DB 일시 점검 중)");
    }

    /* 행 없음 → 폴백 */
    if (!row) {
      return ok(FALLBACK_POLICY, "기본 정책 (미설정)");
    }

    /* 정상 응답 */
    return ok({
      regularAmounts: parseJsonArr(row.regularAmounts),
      onetimeAmounts: parseJsonArr(row.onetimeAmounts),
      bankName: row.bankName || FALLBACK_POLICY.bankName,
      bankAccountNo: row.bankAccountNo || FALLBACK_POLICY.bankAccountNo,
      bankAccountHolder: row.bankAccountHolder || FALLBACK_POLICY.bankAccountHolder,
      bankGuideText: row.bankGuideText || FALLBACK_POLICY.bankGuideText,
      hyosungUrl: row.hyosungUrl || FALLBACK_POLICY.hyosungUrl,
      hyosungGuideText: row.hyosungGuideText || FALLBACK_POLICY.hyosungGuideText,
      modalTitle: row.modalTitle || FALLBACK_POLICY.modalTitle,
      modalSubtitle: row.modalSubtitle || FALLBACK_POLICY.modalSubtitle,
    });
  } catch (e: any) {
    console.error("[donation-policy] ★ 최상위 예외:", {
      message: e?.message,
      stack: e?.stack?.slice(0, 500),
    });
    /* 최후의 폴백 — 500 대신 200 + 기본값 */
    return ok(FALLBACK_POLICY, "기본 정책 (폴백)");
  }
};