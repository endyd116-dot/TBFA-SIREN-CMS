/**
 * GET /api/user-match-feedback-status
 * 피드백 제출 여부 확인
 *
 * ?matchId=N
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireActiveUser } from "../../lib/auth";
import { ok, badRequest, serverError, corsPreflight, methodNotAllowed } from "../../lib/response";

export const config = { path: "/api/user-match-feedback-status" };

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  const auth = await requireActiveUser(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  const { user } = auth;

  let step = "parse";
  try {
    const url = new URL(req.url);
    const matchIdParam = url.searchParams.get("matchId");

    step = "validate";
    const matchId = Number(matchIdParam);
    if (!matchId || !Number.isFinite(matchId)) return badRequest("matchId가 필요합니다");

    // 매칭 조회 + 소유권 확인
    step = "select_match";
    const matchRows = await db.execute(sql`
      SELECT
        em.id,
        em.user_id,
        em.status,
        em.closed_at,
        m.name AS expert_name
      FROM expert_matches em
      LEFT JOIN members m ON m.id = em.expert_id
      WHERE em.id = ${matchId}
      LIMIT 1
    `);
    const match = ((matchRows as any).rows || matchRows as any[])[0];
    if (!match) return badRequest("존재하지 않는 매칭입니다");
    if (match.user_id !== user.uid) return badRequest("본인의 매칭만 조회할 수 있습니다");

    // 피드백 제출 여부
    step = "check_submitted";
    const feedbackRows = await db.execute(sql`
      SELECT id FROM matching_feedbacks WHERE match_id = ${matchId} LIMIT 1
    `);
    const submitted = ((feedbackRows as any).rows || feedbackRows as any[]).length > 0;

    return ok({
      submitted,
      match: {
        id:         match.id,
        status:     match.status,
        expertName: match.expert_name ?? null,
        closedAt:   match.closed_at ?? null,
      },
    });
  } catch (err: any) {
    return serverError(`피드백 상태 조회 실패 [${step}]`, err);
  }
};
