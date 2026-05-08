/**
 * 5순위 #1 — 블랙 통합 1회용 마이그레이션
 *
 * members 테이블에 컬럼 3개 추가:
 *   - blacklisted_at      (timestamp)
 *   - blacklisted_by      (integer, members.id 참조 — FK 생략, 데이터 정합성은 코드에서)
 *   - blacklist_reason    (text)
 *
 * 호출 (어드민 로그인 상태에서 주소창에 그냥 입력):
 *   https://tbfa-siren-cms.netlify.app/api/migrate-step5-blacklist?run=1
 *
 * 진단 (인증 불필요):
 *   https://tbfa-siren-cms.netlify.app/api/migrate-step5-blacklist
 *
 * ⚠️ 호출 성공 후 즉시 이 파일을 삭제하고 커밋·푸시합니다 (1회용 보안 원칙).
 *
 * 멱등: ALTER TABLE ADD COLUMN IF NOT EXISTS — 중복 호출 안전.
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";

const QUERIES: string[] = [
  `ALTER TABLE members ADD COLUMN IF NOT EXISTS blacklisted_at timestamp`,
  `ALTER TABLE members ADD COLUMN IF NOT EXISTS blacklisted_by integer`,
  `ALTER TABLE members ADD COLUMN IF NOT EXISTS blacklist_reason text`,
];

const EXPECTED_COLS = ["blacklisted_at", "blacklisted_by", "blacklist_reason"];

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);

  /* ─── GET ─── */
  if (req.method === "GET") {
    const runFlag = url.searchParams.get("run");

    /* GET ?run=1 : 어드민 세션으로 즉시 실행 */
    if (runFlag === "1") {
      const auth = await requireAdmin(req);
      if (!auth.ok) return auth.res;

      const start = Date.now();
      const results: Array<{ sql: string; ok: boolean; error?: string }> = [];
      try {
        for (const q of QUERIES) {
          try {
            await db.execute(sql.raw(q));
            results.push({ sql: q.replace(/\s+/g, " ").slice(0, 80) + "...", ok: true });
          } catch (err: any) {
            results.push({
              sql: q.replace(/\s+/g, " ").slice(0, 80) + "...",
              ok: false,
              error: err?.message || String(err),
            });
          }
        }
        const successCount = results.filter(r => r.ok).length;
        const allOk = successCount === QUERIES.length;
        return new Response(JSON.stringify({
          ok: allOk,
          mode: "run",
          executor: (auth.ctx.member as any).name || (auth.ctx.member as any).email || "admin",
          total: QUERIES.length,
          success: successCount,
          failed: QUERIES.length - successCount,
          durationMs: Date.now() - start,
          results,
          nextAction: allOk
            ? "✅ 모두 성공. AI에게 결과를 알려주세요. AI가 자동으로 이 파일을 삭제·푸시합니다."
            : "⚠️ 일부 실패. results 확인 후 재시도 가능 (멱등 보장).",
        }, null, 2), {
          status: allOk ? 200 : 207,
          headers: { "Content-Type": "application/json" },
        });
      } catch (err: any) {
        return new Response(JSON.stringify({
          ok: false, mode: "run", error: err?.message || "unknown", results,
        }), { status: 500, headers: { "Content-Type": "application/json" } });
      }
    }

    /* GET (기본) : 진단 */
    try {
      const colRows: any = await db.execute(sql`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'members'
          AND column_name = ANY(ARRAY['blacklisted_at','blacklisted_by','blacklist_reason'])
      `);
      const cols = (Array.isArray(colRows) ? colRows : (colRows as any).rows || []).map((r: any) => r.column_name);

      return new Response(JSON.stringify({
        ok: true,
        mode: "diagnose",
        step5_blacklist: {
          status: cols.length === 3 ? "✅ 완료" : `⚠️ 미완료 (${cols.length}/3)`,
          existing: cols,
          missing: EXPECTED_COLS.filter(c => !cols.includes(c)),
        },
        howToMigrate: "어드민 로그인된 상태에서 주소창에 ?run=1 붙여 호출: /api/migrate-step5-blacklist?run=1",
      }, null, 2), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err: any) {
      return new Response(JSON.stringify({
        ok: false, mode: "diagnose", error: err?.message || String(err),
      }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  }

  return new Response(
    JSON.stringify({ ok: false, error: "GET 만 허용 (?run=1로 실행, 그 외 진단)" }),
    { status: 405, headers: { "Content-Type": "application/json" } }
  );
};

export const config = { path: "/api/migrate-step5-blacklist" };
