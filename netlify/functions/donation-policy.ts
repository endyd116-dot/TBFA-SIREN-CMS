// netlify/functions/donation-policy.ts
// ★ Phase M-4 + 2026-05: 후원 정책 조회 (공개 API)
// - 효성 카운트다운 메시지/초수 응답 추가

import type { Context } from "@netlify/functions";
import { ok, corsPreflight, methodNotAllowed } from "../../lib/response";

export const config = { path: "/api/donation-policy" };

const FALLBACK_POLICY = {
  regularAmounts: [10000, 30000, 50000, 100000, 300000, 500000],
  onetimeAmounts: [10000, 30000, 50000, 100000, 300000, 500000],
  bankName: "국민은행",
  bankAccountNo: "(계좌번호 미등록)",
  bankAccountHolder: "(사)교사유가족협의회",
  bankGuideText: "입금 확인까지 1~3일 이내 소요될 수 있습니다. 입금자명을 정확히 입력해 주세요.",
  hyosungUrl: "https://ap.hyosungcmsplus.co.kr/external/shorten/20240709hAxVVDFECf",
  hyosungGuideText: "효성 CMS+에서 등록한 경우 등록 완료까지 2~3일 정도 소요됩니다.",
  /* ★ 2026-05 신규 */
  hyosungCountdownMessage: "자동이체를 위해 외부페이지로 이동합니다.",
  hyosungCountdownSeconds: 5,
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
    let db: any, donationPolicies: any, eq: any;
    try {
      const dbModule = await import("../../db");
      db = dbModule.db;
      const schemaModule = await import("../../db/schema");
      donationPolicies = schemaModule.donationPolicies;
      const drizzleModule = await import("drizzle-orm");
      eq = drizzleModule.eq;
    } catch (importErr: any) {
      console.error("[donation-policy] 모듈 import 실패:", importErr?.message);
      return ok(FALLBACK_POLICY, "기본 정책 (시스템 일시 점검 중)");
    }

    let row: any = null;
    try {
      const result = await db
        .select()
        .from(donationPolicies)
        .where(eq(donationPolicies.id, 1))
        .limit(1);
      row = result && result.length > 0 ? result[0] : null;
    } catch (dbErr: any) {
      console.error("[donation-policy] DB 조회 실패:", dbErr?.message);
      return ok(FALLBACK_POLICY, "기본 정책 (DB 일시 점검 중)");
    }

    if (!row) {
      return ok(FALLBACK_POLICY, "기본 정책 (미설정)");
    }

    /* 카운트다운 초수 안전 검증 (1~30 범위) */
    const cdSec = Number(row.hyosungCountdownSeconds);
    const safeCdSec = Number.isFinite(cdSec) && cdSec >= 1 && cdSec <= 30
      ? cdSec
      : FALLBACK_POLICY.hyosungCountdownSeconds;

    return ok({
      regularAmounts: parseJsonArr(row.regularAmounts),
      onetimeAmounts: parseJsonArr(row.onetimeAmounts),
      bankName: row.bankName || FALLBACK_POLICY.bankName,
      bankAccountNo: row.bankAccountNo || FALLBACK_POLICY.bankAccountNo,
      bankAccountHolder: row.bankAccountHolder || FALLBACK_POLICY.bankAccountHolder,
      bankGuideText: row.bankGuideText || FALLBACK_POLICY.bankGuideText,
      hyosungUrl: row.hyosungUrl || FALLBACK_POLICY.hyosungUrl,
      hyosungGuideText: row.hyosungGuideText || FALLBACK_POLICY.hyosungGuideText,
      /* ★ 2026-05 신규 */
      hyosungCountdownMessage: row.hyosungCountdownMessage || FALLBACK_POLICY.hyosungCountdownMessage,
      hyosungCountdownSeconds: safeCdSec,
      modalTitle: row.modalTitle || FALLBACK_POLICY.modalTitle,
      modalSubtitle: row.modalSubtitle || FALLBACK_POLICY.modalSubtitle,
    });
  } catch (e: any) {
    console.error("[donation-policy] 최상위 예외:", e?.message);
    return ok(FALLBACK_POLICY, "기본 정책 (폴백)");
  }
};