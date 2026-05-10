// netlify/functions/migrate-phase10-send-jobs.ts
// Phase 10 R3 — communication_send_jobs + communication_send_recipients (1회용)
//
// 실행: 어드민 로그인 후 주소창
//   https://tbfa-siren-cms.netlify.app/api/migrate-phase10-send-jobs?run=1
// 진단: ?run=1 없이 접속 (인증 불필요) — 테이블 존재·각 행 수 + R1·R2 의존 테이블 확인
// 멱등: 모든 DDL이 IF NOT EXISTS — 여러 번 호출 안전.
// 호출 성공 후 즉시 파일 삭제 + schema 정의 활성화 (메인 채팅이 처리)

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-phase10-send-jobs" };

const JSON_HEADER = { "Content-Type": "application/json" };

export default async function handler(req: Request, _ctx: Context) {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  /* ── 진단 모드 ── */
  if (!run) {
    try {
      const checkTable = async (name: string) => {
        const r: any = await db.execute(sql`
          SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = ${name}
          ) AS exists
        `);
        return ((r?.rows ?? r)[0] ?? {}).exists === true;
      };
      const countOf = async (name: string) => {
        try {
          const r: any = await db.execute(sql.raw(`SELECT COUNT(*)::int AS n FROM ${name}`));
          return ((r?.rows ?? r)[0] ?? {}).n ?? 0;
        } catch {
          return null;
        }
      };

      const jobsExists = await checkTable("communication_send_jobs");
      const recExists = await checkTable("communication_send_recipients");
      const tplExists = await checkTable("communication_templates");
      const grpExists = await checkTable("recipient_groups");

      return new Response(
        JSON.stringify({
          ok: true,
          mode: "diagnostic",
          tables: {
            communication_send_jobs: jobsExists,
            communication_send_recipients: recExists,
            communication_templates_required: tplExists,
            recipient_groups_required: grpExists,
          },
          counts: {
            communication_send_jobs: jobsExists ? await countOf("communication_send_jobs") : null,
            communication_send_recipients: recExists ? await countOf("communication_send_recipients") : null,
            communication_templates: tplExists ? await countOf("communication_templates") : null,
            recipient_groups: grpExists ? await countOf("recipient_groups") : null,
          },
          note: "?run=1 + 어드민 로그인으로 실제 실행. R1(communication_templates)·R2(recipient_groups) 선행 필요.",
        }),
        { status: 200, headers: JSON_HEADER },
      );
    } catch (err: any) {
      return jsonError("diagnostic", err);
    }
  }

  /* ── 실행 모드 (어드민 인증 필수) ── */
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  /* 선행 테이블 존재 점검 (R1·R2 머지·마이그 완료 가정) */
  try {
    const r: any = await db.execute(sql`
      SELECT
        EXISTS (SELECT 1 FROM information_schema.tables
                WHERE table_schema='public' AND table_name='communication_templates') AS tpl,
        EXISTS (SELECT 1 FROM information_schema.tables
                WHERE table_schema='public' AND table_name='recipient_groups') AS grp
    `);
    const row = (r?.rows ?? r)[0] ?? {};
    if (!row.tpl || !row.grp) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "선행 테이블 누락 — R1(communication_templates) 또는 R2(recipient_groups) 마이그 먼저 실행 필요",
          tpl: row.tpl, grp: row.grp,
        }),
        { status: 412, headers: JSON_HEADER },
      );
    }
  } catch (err: any) {
    return jsonError("precheck", err);
  }

  /* ── communication_send_jobs ── */
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS communication_send_jobs (
        id                 BIGSERIAL PRIMARY KEY,
        name               VARCHAR(200) NOT NULL,
        template_id        INTEGER NOT NULL REFERENCES communication_templates(id) ON DELETE RESTRICT,
        recipient_group_id INTEGER NOT NULL REFERENCES recipient_groups(id) ON DELETE RESTRICT,
        channel            TEXT NOT NULL,
        schedule_type      TEXT NOT NULL,
        scheduled_at       TIMESTAMP,
        status             TEXT NOT NULL DEFAULT 'pending',
        total_recipients   INTEGER NOT NULL DEFAULT 0,
        success_count      INTEGER NOT NULL DEFAULT 0,
        failure_count      INTEGER NOT NULL DEFAULT 0,
        last_error         TEXT,
        started_at         TIMESTAMP,
        completed_at       TIMESTAMP,
        created_by         INTEGER REFERENCES members(id) ON DELETE SET NULL,
        created_at         TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at         TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS send_jobs_status_idx    ON communication_send_jobs(status)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS send_jobs_scheduled_idx ON communication_send_jobs(scheduled_at)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS send_jobs_template_idx  ON communication_send_jobs(template_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS send_jobs_group_idx     ON communication_send_jobs(recipient_group_id)`);
  } catch (err: any) {
    return jsonError("create_send_jobs", err);
  }

  /* ── communication_send_recipients ── */
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS communication_send_recipients (
        id               BIGSERIAL PRIMARY KEY,
        job_id           INTEGER NOT NULL REFERENCES communication_send_jobs(id) ON DELETE CASCADE,
        member_id        INTEGER NOT NULL REFERENCES members(id) ON DELETE SET NULL,
        channel          TEXT NOT NULL,
        status           TEXT NOT NULL DEFAULT 'pending',
        sent_at          TIMESTAMP,
        error            TEXT,
        retry_count      INTEGER NOT NULL DEFAULT 0,
        rendered_subject TEXT,
        rendered_body    TEXT NOT NULL,
        created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS send_recipients_job_idx        ON communication_send_recipients(job_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS send_recipients_job_status_idx ON communication_send_recipients(job_id, status)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS send_recipients_member_idx     ON communication_send_recipients(member_id)`);
  } catch (err: any) {
    return jsonError("create_send_recipients", err);
  }

  /* ── 결과 검증 ── */
  try {
    const j: any = await db.execute(sql`SELECT COUNT(*)::int AS n FROM communication_send_jobs`);
    const r: any = await db.execute(sql`SELECT COUNT(*)::int AS n FROM communication_send_recipients`);
    return new Response(
      JSON.stringify({
        ok: true,
        mode: "executed",
        result: {
          communication_send_jobs_count: ((j?.rows ?? j)[0] ?? {}).n ?? 0,
          communication_send_recipients_count: ((r?.rows ?? r)[0] ?? {}).n ?? 0,
        },
        next: "schema.ts 정의 활성화 + 본 파일 삭제 후 push",
      }),
      { status: 200, headers: JSON_HEADER },
    );
  } catch (err: any) {
    return jsonError("verify", err);
  }
}

function jsonError(step: string, err: any) {
  return new Response(
    JSON.stringify({
      ok: false,
      error: `migrate-phase10-send-jobs:${step} 실패`,
      step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }),
    { status: 500, headers: JSON_HEADER },
  );
}
