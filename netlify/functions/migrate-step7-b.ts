/**
 * Phase 3 Step 7-B 1회용 마이그레이션
 *
 * 신규 테이블 3개 생성:
 *   - workspace_task_comments    (댓글 스레드 + @멘션)
 *   - workspace_task_reports     (중간/완료 보고서 + 검토)
 *   - workspace_task_attachments (카드 ↔ 파일함 연결)
 *
 * 호출:
 *   curl -X POST "https://tbfa-siren-cms.netlify.app/api/migrate-step7-b?key=YOUR_KEY"
 *
 * 키:
 *   ADMIN_MIGRATION_KEY > ADMIN_JWT_SECRET > JWT_SECRET 순 폴백.
 *
 * ⚠️ 호출 성공 후 즉시 이 파일을 삭제하고 커밋·푸시해야 합니다 (1회용 보안 원칙).
 *
 * 멱등성: CREATE TABLE/INDEX IF NOT EXISTS 사용 — 중복 호출 안전.
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";

const QUERIES: string[] = [
  // ─── Step 7-A: workspace_tasks 컬럼 9개 (이전 마이그레이션 실패로 재실행) ───
  `ALTER TABLE workspace_tasks ADD COLUMN IF NOT EXISTS estimated_hours numeric(5,1)`,
  `ALTER TABLE workspace_tasks ADD COLUMN IF NOT EXISTS actual_hours numeric(5,1)`,
  `ALTER TABLE workspace_tasks ADD COLUMN IF NOT EXISTS hold_reason text`,
  `ALTER TABLE workspace_tasks ADD COLUMN IF NOT EXISTS hold_started_at timestamp`,
  `ALTER TABLE workspace_tasks ADD COLUMN IF NOT EXISTS archived_at timestamp`,
  `ALTER TABLE workspace_tasks ADD COLUMN IF NOT EXISTS bookmarked_by jsonb DEFAULT '[]'::jsonb`,
  `ALTER TABLE workspace_tasks ADD COLUMN IF NOT EXISTS ai_summary text`,
  `ALTER TABLE workspace_tasks ADD COLUMN IF NOT EXISTS ai_risk_score integer`,
  `ALTER TABLE workspace_tasks ADD COLUMN IF NOT EXISTS ai_risk_updated_at timestamp`,

  // ─── Step 7-B: workspace_task_comments ───
  `CREATE TABLE IF NOT EXISTS workspace_task_comments (
    id serial PRIMARY KEY,
    task_id integer NOT NULL REFERENCES workspace_tasks(id) ON DELETE CASCADE,
    member_id integer NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    content text NOT NULL,
    mentions jsonb NOT NULL DEFAULT '[]'::jsonb,
    parent_comment_id integer,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now(),
    deleted_at timestamp
  )`,
  `CREATE INDEX IF NOT EXISTS task_comments_task_idx ON workspace_task_comments(task_id)`,
  `CREATE INDEX IF NOT EXISTS task_comments_member_idx ON workspace_task_comments(member_id)`,
  `CREATE INDEX IF NOT EXISTS task_comments_parent_idx ON workspace_task_comments(parent_comment_id)`,

  // workspace_task_reports
  `CREATE TABLE IF NOT EXISTS workspace_task_reports (
    id serial PRIMARY KEY,
    task_id integer NOT NULL REFERENCES workspace_tasks(id) ON DELETE CASCADE,
    member_id integer NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    type varchar(20) NOT NULL,
    title varchar(300),
    content text NOT NULL,
    attached_file_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
    review_status varchar(20) NOT NULL DEFAULT 'pending',
    reviewed_by integer REFERENCES members(id) ON DELETE SET NULL,
    reviewed_at timestamp,
    review_reason text,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS task_reports_task_idx ON workspace_task_reports(task_id)`,
  `CREATE INDEX IF NOT EXISTS task_reports_type_idx ON workspace_task_reports(type)`,
  `CREATE INDEX IF NOT EXISTS task_reports_review_idx ON workspace_task_reports(review_status)`,

  // workspace_task_attachments
  `CREATE TABLE IF NOT EXISTS workspace_task_attachments (
    id serial PRIMARY KEY,
    task_id integer NOT NULL REFERENCES workspace_tasks(id) ON DELETE CASCADE,
    file_id integer NOT NULL REFERENCES workspace_files(id) ON DELETE CASCADE,
    attached_by integer NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    attached_at timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS task_attach_task_idx ON workspace_task_attachments(task_id)`,
  `CREATE INDEX IF NOT EXISTS task_attach_file_idx ON workspace_task_attachments(file_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS task_attach_unique ON workspace_task_attachments(task_id, file_id)`,
];

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);

  /* ─── GET = 진단 모드 (키 검증 없음, 스키마 상태만 확인) ─── */
  if (req.method === "GET") {
    try {
      // Step 7-A 컬럼 9개 존재 여부
      const colRows: any = await db.execute(sql`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'workspace_tasks'
          AND column_name IN (
            'estimated_hours','actual_hours','hold_reason','hold_started_at',
            'archived_at','bookmarked_by','ai_summary','ai_risk_score','ai_risk_updated_at'
          )
      `);
      const cols = (Array.isArray(colRows) ? colRows : (colRows as any).rows || []).map((r: any) => r.column_name);
      const expectedCols = [
        "estimated_hours","actual_hours","hold_reason","hold_started_at",
        "archived_at","bookmarked_by","ai_summary","ai_risk_score","ai_risk_updated_at"
      ];

      // Step 7-B 테이블 3개 존재 여부
      const tblRows: any = await db.execute(sql`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('workspace_task_comments','workspace_task_reports','workspace_task_attachments')
      `);
      const tbls = (Array.isArray(tblRows) ? tblRows : (tblRows as any).rows || []).map((r: any) => r.table_name);
      const expectedTbls = ["workspace_task_comments","workspace_task_reports","workspace_task_attachments"];

      // 환경변수 키 존재 여부 (값은 노출 안 함, 길이만)
      const keyHints = {
        ADMIN_MIGRATION_KEY: process.env.ADMIN_MIGRATION_KEY ? `설정됨 (길이: ${process.env.ADMIN_MIGRATION_KEY.length})` : "없음",
        ADMIN_JWT_SECRET: process.env.ADMIN_JWT_SECRET ? `설정됨 (길이: ${process.env.ADMIN_JWT_SECRET.length})` : "없음",
        JWT_SECRET: process.env.JWT_SECRET ? `설정됨 (길이: ${process.env.JWT_SECRET.length})` : "없음",
      };

      return new Response(JSON.stringify({
        ok: true,
        mode: "diagnose",
        step7a: {
          status: cols.length === 9 ? "✅ 완료" : `⚠️ 미완료 (${cols.length}/9)`,
          existing: cols,
          missing: expectedCols.filter(c => !cols.includes(c)),
        },
        step7b: {
          status: tbls.length === 3 ? "✅ 완료" : `⚠️ 미완료 (${tbls.length}/3)`,
          existing: tbls,
          missing: expectedTbls.filter(t => !tbls.includes(t)),
        },
        keyEnvironment: keyHints,
        howToMigrate: "POST /api/migrate-step7-b?key=<ADMIN_MIGRATION_KEY 또는 ADMIN_JWT_SECRET 또는 JWT_SECRET 값>",
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
          ? "✅ 모두 성공. 즉시 이 파일(netlify/functions/migrate-step7-b.ts)을 삭제하고 커밋·푸시하세요."
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

export const config = { path: "/api/migrate-step7-b" };
