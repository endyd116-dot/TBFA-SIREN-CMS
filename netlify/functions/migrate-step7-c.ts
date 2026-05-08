/**
 * Phase 3 Step 7-C.1 1회용 마이그레이션
 *
 * 신규 테이블 1개:
 *   - workspace_task_templates (업무 템플릿 — 반복 업무 양식 저장)
 *
 * 호출:
 *   POST /api/migrate-step7-c?key=<ADMIN_MIGRATION_KEY 또는 다른 키>
 *
 * GET 진단:
 *   GET  /api/migrate-step7-c
 *
 * ⚠️ 호출 성공 후 즉시 이 파일을 삭제하고 커밋·푸시해야 합니다.
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";

const QUERIES: string[] = [
  `CREATE TABLE IF NOT EXISTS workspace_task_templates (
    id serial PRIMARY KEY,
    name varchar(200) NOT NULL,
    description text,
    priority varchar(20) NOT NULL DEFAULT 'normal',
    estimated_hours numeric(5,1),
    default_subtasks jsonb NOT NULL DEFAULT '[]'::jsonb,
    default_tags jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_by integer REFERENCES members(id) ON DELETE SET NULL,
    usage_count integer NOT NULL DEFAULT 0,
    is_shared boolean NOT NULL DEFAULT true,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS task_templates_name_idx ON workspace_task_templates(name)`,
  `CREATE INDEX IF NOT EXISTS task_templates_created_by_idx ON workspace_task_templates(created_by)`,
];

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);

  /* ─── GET = 진단 ─── */
  if (req.method === "GET") {
    try {
      const tblRows: any = await db.execute(sql`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'workspace_task_templates'
      `);
      const exists = (Array.isArray(tblRows) ? tblRows : (tblRows as any).rows || []).length > 0;

      let columnInfo: any[] = [];
      if (exists) {
        const colRows: any = await db.execute(sql`
          SELECT column_name, data_type FROM information_schema.columns
          WHERE table_name = 'workspace_task_templates'
          ORDER BY ordinal_position
        `);
        columnInfo = Array.isArray(colRows) ? colRows : (colRows as any).rows || [];
      }

      const keyHints = {
        ADMIN_MIGRATION_KEY: process.env.ADMIN_MIGRATION_KEY ? `설정됨 (길이: ${process.env.ADMIN_MIGRATION_KEY.length})` : "없음",
        ADMIN_JWT_SECRET: process.env.ADMIN_JWT_SECRET ? `설정됨 (길이: ${process.env.ADMIN_JWT_SECRET.length})` : "없음",
        JWT_SECRET: process.env.JWT_SECRET ? `설정됨 (길이: ${process.env.JWT_SECRET.length})` : "없음",
      };

      return new Response(JSON.stringify({
        ok: true,
        mode: "diagnose",
        step7c: {
          tableExists: exists,
          status: exists ? "✅ 완료" : "⚠️ 미완료",
          columns: columnInfo,
        },
        keyEnvironment: keyHints,
        howToMigrate: "POST /api/migrate-step7-c?key=<ADMIN_MIGRATION_KEY 또는 다른 키>",
      }, null, 2), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err: any) {
      return new Response(JSON.stringify({
        ok: false,
        mode: "diagnose",
        error: err?.message || String(err),
      }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ ok: false, error: "POST 만 허용" }),
      { status: 405, headers: { "Content-Type": "application/json" } }
    );
  }

  const expectedKey =
    process.env.ADMIN_MIGRATION_KEY ||
    process.env.ADMIN_JWT_SECRET ||
    process.env.JWT_SECRET ||
    "";

  if (!expectedKey) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "서버에 키 환경변수가 없습니다 (ADMIN_MIGRATION_KEY 또는 ADMIN_JWT_SECRET 또는 JWT_SECRET)",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const givenKey = url.searchParams.get("key") || "";
  if (givenKey !== expectedKey) {
    return new Response(
      JSON.stringify({ ok: false, error: "권한 없음 (key 불일치)" }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }

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

    return new Response(
      JSON.stringify({
        ok: allOk,
        total: QUERIES.length,
        success: successCount,
        failed: QUERIES.length - successCount,
        durationMs: Date.now() - start,
        results,
        nextAction: allOk
          ? "✅ 모두 성공. 즉시 이 파일(netlify/functions/migrate-step7-c.ts)을 삭제하고 커밋·푸시하세요."
          : "⚠️ 일부 실패. results 확인 후 재시도 가능 (멱등성 보장됨).",
      }),
      { status: allOk ? 200 : 207, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ ok: false, error: err?.message || "unknown", results }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};

export const config = { path: "/api/migrate-step7-c" };
