/**
 * 6순위 #6 — 교원 회원 자격 변경 1회용 마이그레이션
 *
 * 추가:
 *  1) members.eligibility_type           varchar(30)  (현직/은퇴/예비/일반)
 *  2) eligibility_change_requests 테이블 신설
 *     - 신청 → 검토 → 승인/반려 워크플로
 *     - reviewed_by 는 members.id 참조 (admin도 members 테이블)
 *  3) 부분 UNIQUE 인덱스: 회원당 동시 pending 1건 제한
 *
 * 호출 (어드민 로그인 상태에서 주소창에 그냥 입력):
 *   https://tbfa-siren-cms.netlify.app/api/migrate-add-eligibility-change?run=1
 *
 * 진단 (인증 불필요):
 *   https://tbfa-siren-cms.netlify.app/api/migrate-add-eligibility-change
 *
 * ⚠️ 호출 성공 후 즉시 이 파일을 삭제하고 커밋·푸시합니다 (1회용 보안 원칙).
 *
 * 멱등: ALTER TABLE ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS — 중복 호출 안전.
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";

const QUERIES: string[] = [
  /* 1) members 컬럼 */
  `ALTER TABLE members ADD COLUMN IF NOT EXISTS eligibility_type varchar(30)`,

  /* 2) 신청 테이블 */
  `CREATE TABLE IF NOT EXISTS eligibility_change_requests (
    id              serial PRIMARY KEY,
    member_id       integer NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    current_type    varchar(30),
    requested_type  varchar(30) NOT NULL,
    reason          text,
    evidence_blob_id integer REFERENCES blob_uploads(id) ON DELETE SET NULL,
    status          varchar(20) NOT NULL DEFAULT 'pending',
    admin_note      text,
    reviewed_by     integer REFERENCES members(id) ON DELETE SET NULL,
    reviewed_at     timestamp,
    created_at      timestamp NOT NULL DEFAULT now(),
    updated_at      timestamp NOT NULL DEFAULT now()
  )`,

  /* 3) 인덱스 */
  `CREATE INDEX IF NOT EXISTS eligibility_req_member_idx
     ON eligibility_change_requests(member_id)`,
  `CREATE INDEX IF NOT EXISTS eligibility_req_status_idx
     ON eligibility_change_requests(status)`,
  `CREATE INDEX IF NOT EXISTS eligibility_req_created_idx
     ON eligibility_change_requests(created_at DESC)`,

  /* 4) 부분 UNIQUE — 회원당 동시 pending 1건 */
  `CREATE UNIQUE INDEX IF NOT EXISTS eligibility_req_pending_unique
     ON eligibility_change_requests(member_id)
     WHERE status = 'pending'`,
];

const EXPECTED_COLS = ["eligibility_type"];
const EXPECTED_TABLES = ["eligibility_change_requests"];

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
            results.push({ sql: q.replace(/\s+/g, " ").slice(0, 90) + "...", ok: true });
          } catch (err: any) {
            results.push({
              sql: q.replace(/\s+/g, " ").slice(0, 90) + "...",
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
            ? "✅ 모두 성공. AI에게 결과를 알려주세요. AI가 자동으로 schema 정의 활성화 + 이 파일 삭제 + 푸시합니다."
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
          AND column_name = ANY(ARRAY['eligibility_type'])
      `);
      const cols = (Array.isArray(colRows) ? colRows : (colRows as any).rows || [])
        .map((r: any) => r.column_name);

      const tabRows: any = await db.execute(sql`
        SELECT table_name FROM information_schema.tables
        WHERE table_name = ANY(ARRAY['eligibility_change_requests'])
      `);
      const tabs = (Array.isArray(tabRows) ? tabRows : (tabRows as any).rows || [])
        .map((r: any) => r.table_name);

      const totalExpected = EXPECTED_COLS.length + EXPECTED_TABLES.length;
      const totalDone = cols.length + tabs.length;

      return new Response(JSON.stringify({
        ok: true,
        mode: "diagnose",
        eligibility_change: {
          status: totalDone === totalExpected ? "✅ 완료" : `⚠️ 미완료 (${totalDone}/${totalExpected})`,
          existingColumns: cols,
          missingColumns: EXPECTED_COLS.filter(c => !cols.includes(c)),
          existingTables: tabs,
          missingTables: EXPECTED_TABLES.filter(t => !tabs.includes(t)),
        },
        howToMigrate: "어드민 로그인된 상태에서 주소창에 ?run=1 붙여 호출: /api/migrate-add-eligibility-change?run=1",
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

export const config = { path: "/api/migrate-add-eligibility-change" };
