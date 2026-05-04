// lib/donor-check.ts
// ★ Phase M-17: 후원자 검증 헬퍼
// - 사이렌 AI 분석 결과 응답을 "후원 내역 1건 이상 회원"에게만 제공
// - 적용 도메인: 사건제보 / 악성민원 / 법률상담 (유가족 지원은 제외)
// - 기준: donations.status = 'completed' 1건 이상

import { eq, and, sql } from "drizzle-orm";
import { db } from "../db";
import { donations } from "../db/schema";

export interface DonorCheckResult {
  isDonor: boolean;
  donationCount: number;
}

/**
 * 회원이 1건 이상 완료된 후원 내역을 가지고 있는지 확인
 * @param memberId members.id
 * @returns isDonor + 후원 건수
 */
export async function hasAnyCompletedDonation(memberId: number): Promise<DonorCheckResult> {
  if (!memberId || !Number.isFinite(memberId)) {
    return { isDonor: false, donationCount: 0 };
  }

  try {
    const rows: any = await db
      .select({ c: sql<number>`COUNT(*)::int` })
      .from(donations)
      .where(
        and(
          eq(donations.memberId, memberId),
          eq(donations.status, "completed"),
        ),
      );

    const count = Number(rows[0]?.c ?? 0);
    return {
      isDonor: count > 0,
      donationCount: count,
    };
  } catch (e) {
    console.error("[donor-check] 후원 내역 조회 예외:", e);
    /* 안전 폴백: 조회 실패 시 비후원자로 처리 */
    return { isDonor: false, donationCount: 0 };
  }
}

/**
 * 비후원자에게 표시할 안내 메시지 (UI 측에서 사용)
 */
export function getNonDonorPremiumNotice(category: "incident" | "harassment" | "legal"): {
  title: string;
  message: string;
  ctaText: string;
  ctaUrl: string;
} {
  const categoryLabel: Record<string, string> = {
    incident: "사건 제보",
    harassment: "악성민원",
    legal: "법률 상담",
  };

  return {
    title: "🎗 사이렌 후원 회원 전용 서비스",
    message:
      `AI 분석 결과는 사이렌 후원 회원에게 제공되는 우대 서비스입니다.\n\n` +
      `${categoryLabel[category] || "이 도메인"}은 정상적으로 접수되었으며, ` +
      `운영진의 검토 후 답변을 받으실 수 있습니다.\n\n` +
      `1회 이상 후원하시면 즉시 AI 분석 결과를 받아보실 수 있습니다. ` +
      `여러분의 따뜻한 마음이 더 많은 교사 가족에게 도움이 됩니다.`,
    ctaText: "후원하러 가기",
    ctaUrl: "/support.html",
  };
}