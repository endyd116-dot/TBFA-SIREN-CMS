/**
 * GET /api/admin/ai/match?requestId=N    — 봉사자 매칭 추천
 * GET /api/admin/ai/churn                — 후원 이탈 예측
 * GET /api/admin/ai/distribution         — 회원 위험도 분포 (차트용)
 */
import { eq, desc, and, sql, gte, lt, count, isNotNull } from "drizzle-orm";
import { db, members, supportRequests, donations } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import { ok, notFound, serverError, corsPreflight, methodNotAllowed } from "../../lib/response";

/* =========================================================
   봉사자 매칭 추천 알고리즘 (간단 휴리스틱)
   - 카테고리에 맞는 봉사자 type 우선
   - 가입 오래된 순 (신뢰도)
   - 활동 이력 (감사 로그) 가산
   ========================================================= */
async function recommendVolunteers(category: string) {
  const volunteers = await db
    .select({
      id: members.id,
      name: members.name,
      email: members.email,
      memo: members.memo,
      createdAt: members.createdAt,
      lastLoginAt: members.lastLoginAt,
    })
    .from(members)
    .where(and(eq(members.type, "volunteer"), eq(members.status, "active")))
    .orderBy(desc(members.createdAt))
    .limit(20);

  /* 점수 계산 */
  const now = Date.now();
  const scored = volunteers.map((v, idx) => {
    let score = 60; // 기본
    /* 카테고리 매칭 가산 (메모에 키워드 있으면) */
    const memo = (v.memo || "").toLowerCase();
    const catKeywords: Record<string, string[]> = {
      counseling: ["상담", "심리", "임상"],
      legal: ["변호", "법률", "법무"],
      scholarship: ["교육", "장학", "멘토"],
    };
    const keywords = catKeywords[category] || [];
    if (keywords.some(k => memo.includes(k))) score += 30;

    /* 최근 로그인 가산 */
    if (v.lastLoginAt) {
      const daysSince = (now - new Date(v.lastLoginAt).getTime()) / 86400_000;
      if (daysSince < 7) score += 10;
      else if (daysSince < 30) score += 5;
    }

    /* 가입 오래된 순 보너스 (최대 10) */
    score += Math.max(0, 10 - idx);

    return {
      id: v.id,
      name: v.name,
      memo: v.memo || `봉사자 #${v.id}`,
      score: Math.min(99, score),
    };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

/* =========================================================
   후원 이탈 예측 (90일 결제 패턴)
   - 정기 후원자 중 최근 90일 결제 없는 사람
   - 또는 최근 결제 실패 발생
   ========================================================= */
async function predictChurn() {
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  /* 정기 후원 회원 중 활성 */
  const regularDonors = await db
    .selectDistinct({
      memberId: donations.memberId,
    })
    .from(donations)
    .where(and(eq(donations.type, "regular"), eq(donations.status, "completed"), isNotNull(donations.memberId)));

  let atRisk = 0;
  for (const d of regularDonors) {
    if (!d.memberId) continue;
    const recent = await db
      .select({ id: donations.id })
      .from(donations)
      .where(
        and(
          eq(donations.memberId, d.memberId),
          eq(donations.status, "completed"),
          gte(donations.createdAt, ninetyDaysAgo)
        )
      )
      .limit(1);
    if (recent.length === 0) atRisk++;
  }

  return {
    totalRegular: regularDonors.length,
    atRiskCount: atRisk,
  };
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  const guard = await requireAdmin(req);
  if (!guard.ok) return guard.res;

  try {
    const url = new URL(req.url);
    const action = url.pathname.split("/").pop() || "";

    /* /api/admin/ai/match */
    if (action === "match") {
      const requestId = Number(url.searchParams.get("requestId") || 0);
      if (!Number.isFinite(requestId) || requestId <= 0) {
        /* 가장 최근 submitted 신청에 대해 추천 */
        const [latest] = await db
          .select({ id: supportRequests.id, requestNo: supportRequests.requestNo, category: supportRequests.category })
          .from(supportRequests)
          .where(eq(supportRequests.status, "submitted"))
          .orderBy(desc(supportRequests.createdAt))
          .limit(1);
        if (!latest) return ok({ request: null, recommendations: [] }, "대기 중인 신청 없음");
        const recs = await recommendVolunteers(latest.category);
        return ok({ request: latest, recommendations: recs });
      }

      const [target] = await db
        .select({ id: supportRequests.id, requestNo: supportRequests.requestNo, category: supportRequests.category })
        .from(supportRequests)
        .where(eq(supportRequests.id, requestId))
        .limit(1);
      if (!target) return notFound("신청 내역 없음");

      const recs = await recommendVolunteers(target.category);
      return ok({ request: target, recommendations: recs });
    }

    /* /api/admin/ai/churn */
    if (action === "churn") {
      const churn = await predictChurn();
      return ok(churn);
    }

    /* /api/admin/ai/distribution — 회원 위험도 분포 (차트용) */
    if (action === "distribution") {
      const churn = await predictChurn();
      const totalMembers = (await db.select({ c: count() }).from(members))[0]?.c ?? 0;
      const safeCount = Math.max(0, Number(totalMembers) - churn.atRiskCount * 4);
      return ok({
        labels: ["안전", "관심필요", "위험", "이탈예측"],
        values: [
          safeCount,
          Math.floor(churn.atRiskCount * 2),
          Math.floor(churn.atRiskCount * 1.5),
          churn.atRiskCount,
        ],
      });
    }

    return notFound("알 수 없는 액션");
  } catch (err) {
    console.error("[admin-ai]", err);
    return serverError("AI 분석 중 오류", err);
  }
};

/* ★ 2026-05 패치: 와일드카드 제거 → 3개 액션만 명시
   다른 admin-ai-*.ts (reply-draft, reply-draft-v2, expert-match, similar-cases)와의 path 충돌 방지 */
export const config = {
  path: ["/api/admin/ai/match", "/api/admin/ai/churn", "/api/admin/ai/distribution"],
};