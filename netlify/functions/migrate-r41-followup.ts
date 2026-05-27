/**
 * netlify/functions/migrate-r41-followup.ts  (1회용 — 호출 후 삭제)
 *
 * R41 후속(보류건 정리):
 *  - Q2-023: comment_votes 중복 정리 후 (comment_id, member_id) UNIQUE → 더블클릭 중복투표 영구 차단
 *  - Q2-047-FK: memorial_message_likes 고아행 정리 후 message_id → memorial_messages(id) 외래키(ON DELETE CASCADE)
 * 멱등: 중복/고아 정리 후 IF NOT EXISTS / pg_constraint 체크.
 *
 * GET         : 진단 (현재 중복·고아·제약 존재 여부)
 * GET ?run=1  : requireAdmin 후 실제 적용
 * 호출: https://tbfa.co.kr/api/migrate-r41-followup?run=1
 * 성공 후 파일 삭제 + 커밋.
 */
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-r41-followup" };

async function one(q: any): Promise<any> {
  const r: any = await db.execute(q);
  const rows = Array.isArray(r) ? r : r.rows ?? [];
  return rows[0] ?? {};
}

export default async (req: Request) => {
  const run = new URL(req.url).searchParams.get("run") === "1";

  if (!run) {
    try {
      const dupVotes = await one(sql`
        SELECT COUNT(*)::int AS n FROM (
          SELECT comment_id, member_id FROM comment_votes GROUP BY comment_id, member_id HAVING COUNT(*) > 1
        ) t`);
      const orphanLikes = await one(sql`
        SELECT COUNT(*)::int AS n FROM memorial_message_likes
        WHERE message_id NOT IN (SELECT id FROM memorial_messages)`);
      const hasVoteUniq = await one(sql`SELECT to_regclass('public.comment_votes_comment_member_uniq') IS NOT NULL AS yes`);
      const hasLikeFk = await one(sql`SELECT EXISTS(SELECT 1 FROM pg_constraint WHERE conname = 'memorial_message_likes_message_fk') AS yes`);
      return new Response(JSON.stringify({ ok: true, mode: "diagnostic", dupVotePairs: dupVotes.n, orphanLikes: orphanLikes.n, voteUniqueExists: hasVoteUniq.yes, likeFkExists: hasLikeFk.yes }, null, 2), { headers: { "content-type": "application/json; charset=utf-8" } });
    } catch (e: any) {
      return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500, headers: { "content-type": "application/json" } });
    }
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  const steps: Record<string, string> = {};
  try {
    // 1. 댓글 투표 중복 정리(낮은 id 유지) → UNIQUE
    await db.execute(sql`DELETE FROM comment_votes a USING comment_votes b WHERE a.id > b.id AND a.comment_id = b.comment_id AND a.member_id = b.member_id`);
    steps.dedup_comment_votes = "done";
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS comment_votes_comment_member_uniq ON comment_votes (comment_id, member_id)`);
    steps.unique_comment_votes = "done";

    // 2. 추모 좋아요 고아행 정리 → 외래키(있으면 skip)
    await db.execute(sql`DELETE FROM memorial_message_likes WHERE message_id NOT IN (SELECT id FROM memorial_messages)`);
    steps.clean_orphan_likes = "done";
    await db.execute(sql`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memorial_message_likes_message_fk') THEN
          ALTER TABLE memorial_message_likes
            ADD CONSTRAINT memorial_message_likes_message_fk
            FOREIGN KEY (message_id) REFERENCES memorial_messages(id) ON DELETE CASCADE;
        END IF;
      END $$;`);
    steps.fk_memorial_likes = "done";

    return new Response(JSON.stringify({ ok: true, mode: "run", steps }, null, 2), { headers: { "content-type": "application/json; charset=utf-8" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e), stack: String(e?.stack || "").slice(0, 800), steps }, null, 2), { status: 500, headers: { "content-type": "application/json" } });
  }
};
