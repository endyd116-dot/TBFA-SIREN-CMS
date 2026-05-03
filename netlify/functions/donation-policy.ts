// netlify/functions/donation-policy.ts
// ★ Phase M-4: 후원 정책 조회 (공개 API)
// - 프론트 후원 모달에서 금액 버튼/계좌번호/효성 URL 로드용
// - GET만 공개, PATCH는 M-15에서 관리자 전용으로 제공

import type { Context } from "@netlify/functions";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { donationPolicies } from "../../db/schema";
import {
  ok, serverError, corsPreflight, methodNotAllowed,
} from "../../lib/response";

export const config = { path: "/api/donation-policy" };

function parseJsonArr(v: any): any[] {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  try { const a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch { return []; }
}

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  try {
    const [row] = await db.select().from(donationPolicies).where(eq(donationPolicies.id, 1)).limit(1);

    if (!row) {
      /* 시드가 안 되어 있으면 하드코딩 기본값 반환 (fallback) */
      return ok({
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
      }, "기본 정책 (미설정)");
    }

    return ok({
      regularAmounts: parseJsonArr((row as any).regularAmounts),
      onetimeAmounts: parseJsonArr((row as any).onetimeAmounts),
      bankName: (row as any).bankName,
      bankAccountNo: (row as any).bankAccountNo,
      bankAccountHolder: (row as any).bankAccountHolder,
      bankGuideText: (row as any).bankGuideText,
      hyosungUrl: (row as any).hyosungUrl,
      hyosungGuideText: (row as any).hyosungGuideText,
      modalTitle: (row as any).modalTitle,
      modalSubtitle: (row as any).modalSubtitle,
    });
  } catch (e: any) {
    console.error("[donation-policy]", e);
    return serverError("정책 조회 실패", e);
  }
};