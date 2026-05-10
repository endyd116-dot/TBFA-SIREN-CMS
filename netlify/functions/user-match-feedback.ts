/**
 * POST /api/user-match-feedback
 * 사용자 매칭 별점·후기 제출
 *
 * Body: { matchId: number, rating: number (1~5), comment?: string }
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireActiveUser } from "../../lib/auth";
import { ok, badRequest, serverError, parseJson, corsPreflight, methodNotAllowed } from "../../lib/response";

export const config = { path: "/api/user-match-feedback" };

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  const auth = await requireActiveUser(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  const { user } = auth;

  let step = "parse";
  try {
    const body = await parseJson(req);

    step = "validate";
    const matchId = Number(body?.matchId);
    const rating  = Number(body?.rating);
    const comment = body?.comment ? String(body.comment).slice(0, 500) : null;

    if (!matchId || !Number.isFinite(matchId)) return badRequest("matchId가 필요합니다");
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) return badRequest("rating은 1~5 사이 정수여야 합니다");

    // 매칭 조회 + 소유권 확인
    step = "check_owner";
    const matchRows = await db.execute(sql`
      SELECT id, user_id, expert_id, status, closed_at
      FROM expert_matches
      WHERE id = ${matchId}
      LIMIT 1
    `);
    const match = ((matchRows as any).rows || matchRows as any[])[0];
    if (!match) return badRequest("존재하지 않는 매칭입니다");
    if (match.user_id !== user.uid) return badRequest("본인의 매칭에만 후기를 작성할 수 있습니다");

    // 종결 상태 확인
    step = "check_status";
    if (match.status !== "closed") return badRequest("종결된 매칭에만 후기를 작성할 수 있습니다");

    // 중복 제출 확인
    step = "check_dup";
    const dupRows = await db.execute(sql`
      SELECT id FROM matching_feedbacks WHERE match_id = ${matchId} LIMIT 1
    `);
    if (((dupRows as any).rows || dupRows as any[]).length > 0) {
      return badRequest("이미 후기를 작성하셨습니다");
    }

    // 피드백 저장
    step = "insert_feedback";
    await db.execute(sql`
      INSERT INTO matching_feedbacks (match_id, member_id, rating, comment)
      VALUES (${matchId}, ${user.uid}, ${Math.round(rating)}, ${comment})
    `);

    // 전문가 평점 재계산
    step = "update_avg";
    if (match.expert_id) {
      await db.execute(sql`
        UPDATE expert_profiles
        SET
          avg_rating   = (
            SELECT ROUND(AVG(mf.rating)::NUMERIC, 2)
            FROM matching_feedbacks mf
            JOIN expert_matches em ON em.id = mf.match_id
            WHERE em.expert_id = ${match.expert_id}
          ),
          rating_count = (
            SELECT COUNT(*)
            FROM matching_feedbacks mf
            JOIN expert_matches em ON em.id = mf.match_id
            WHERE em.expert_id = ${match.expert_id}
          ),
          updated_at   = NOW()
        WHERE member_id = ${match.expert_id}
      `);
    }

    return ok({}, "후기가 등록되었습니다. 감사합니다.");
  } catch (err: any) {
    return serverError(`후기 등록 실패 [${step}]`, err);
  }
};
