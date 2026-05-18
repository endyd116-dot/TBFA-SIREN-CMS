/**
 * Phase 27: att_remote_work_reports 테이블 생성
 * GET /api/migrate-phase27-att-reports?run=1  (어드민 로그인 필요)
 * GET /api/migrate-phase27-att-reports         (진단 모드)
 */
import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-phase27-att-reports" };

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  if (!run) {
    return new Response(JSON.stringify({
      ok: true, mode: "진단",
      steps: [
        "att_remote_work_reports 테이블 생성 (재택 보고서)",
        "member_uid + date UNIQUE 인덱스",
        "status 인덱스",
      ],
    }), { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } });
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  const steps: string[] = [];
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS att_remote_work_reports (
        id              SERIAL PRIMARY KEY,
        member_uid      INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        date            DATE NOT NULL,
        wbs_card_ids    JSONB DEFAULT '[]'::jsonb,
        content         TEXT,
        ai_draft        TEXT,
        quality_score   INTEGER CHECK (quality_score >= 0 AND quality_score <= 100),
        status          VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
        submitted_at    TIMESTAMPTZ,
        supervisor_note TEXT,
        is_starred      BOOLEAN DEFAULT FALSE,
        created_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        updated_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        CONSTRAINT att_remote_work_reports_member_date_uq UNIQUE (member_uid, date)
      )
    `);
    steps.push("att_remote_work_reports 테이블 생성 완료");

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_arr_member_uid ON att_remote_work_reports(member_uid);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_arr_date ON att_remote_work_reports(date DESC);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_arr_status ON att_remote_work_reports(status);
    `);
    steps.push("인덱스 3개 생성 완료");

    return new Response(JSON.stringify({ ok: true, steps }), {
      status: 200, headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false, error: "마이그레이션 실패", steps,
      detail: String(err?.message || err).slice(0, 500),
    }), { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } });
  }
};
