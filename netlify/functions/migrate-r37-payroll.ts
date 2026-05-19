/**
 * GET /api/migrate-r37-payroll          진단 (인증 불필요)
 * GET /api/migrate-r37-payroll?run=1    어드민 인증 후 실행
 *
 * R37 — 급여 통합 (Payroll Integration)
 * 신규 테이블 2개: payroll_slips, payroll_send_history
 * 멱등 보장 (IF NOT EXISTS).
 * 호출 성공 후 즉시 파일 삭제 + 커밋.
 */
import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-r37-payroll" };

function jsonError(step: string, err: any) {
  return new Response(
    JSON.stringify({
      ok: false,
      error: "R37 급여 통합 마이그레이션 실패",
      step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }),
    { status: 500, headers: { "Content-Type": "application/json" } }
  );
}

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  /* 진단 모드 — 테이블 존재 여부·행 수 */
  if (!run) {
    try {
      const { db } = await import("../../db");
      const { sql } = await import("drizzle-orm");
      const tables = await db.execute(sql`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('payroll_slips', 'payroll_send_history')
        ORDER BY table_name
      `);
      const rows = Array.isArray(tables) ? tables : ((tables as any)?.rows ?? []);
      const counts: Record<string, number | null> = {
        payroll_slips: null,
        payroll_send_history: null,
      };
      for (const t of rows as Array<{ table_name: string }>) {
        try {
          const c = await db.execute(
            sql`SELECT COUNT(*)::int AS n FROM ${sql.identifier(t.table_name)}`
          );
          const cRows = Array.isArray(c) ? c : ((c as any)?.rows ?? []);
          counts[t.table_name] = Number(cRows?.[0]?.n ?? 0);
        } catch {
          counts[t.table_name] = -1;
        }
      }
      return new Response(
        JSON.stringify({
          ok: true,
          mode: "diagnose",
          existing: (rows as any[]).map((r) => r.table_name),
          counts,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } catch (err) {
      return jsonError("diagnose", err);
    }
  }

  /* 실행 모드 — 어드민 인증 필수 */
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  try {
    const { db } = await import("../../db");
    const { sql } = await import("drizzle-orm");

    /* payroll_slips */
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS payroll_slips (
        id                    SERIAL PRIMARY KEY,
        member_uid            VARCHAR(36) NOT NULL,
        pay_year              INTEGER NOT NULL,
        pay_month             INTEGER NOT NULL CHECK (pay_month BETWEEN 1 AND 12),

        working_days          INTEGER NOT NULL DEFAULT 0,
        working_mins          INTEGER NOT NULL DEFAULT 0,
        overtime_mins         INTEGER NOT NULL DEFAULT 0,
        late_count            INTEGER NOT NULL DEFAULT 0,
        absent_count          INTEGER NOT NULL DEFAULT 0,
        paid_leave_days       NUMERIC(5,1) NOT NULL DEFAULT 0,
        unpaid_leave_days     NUMERIC(5,1) NOT NULL DEFAULT 0,
        perfect_attendance    BOOLEAN NOT NULL DEFAULT FALSE,

        base_salary_month     NUMERIC(15,2) NOT NULL DEFAULT 0,
        overtime_pay          NUMERIC(15,2) NOT NULL DEFAULT 0,
        deduction_unpaid      NUMERIC(15,2) NOT NULL DEFAULT 0,
        performance_bonus     NUMERIC(15,2) NOT NULL DEFAULT 0,
        perfect_bonus         NUMERIC(15,2) NOT NULL DEFAULT 0,
        gross_pay             NUMERIC(15,2) NOT NULL DEFAULT 0,

        status                VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
        reviewed_by           VARCHAR(36),
        reviewed_at           TIMESTAMP,
        review_note           TEXT,
        approved_by           VARCHAR(36),
        approved_at           TIMESTAMP,
        sent_at               TIMESTAMP,
        email_sent_to         TEXT,
        pdf_url               TEXT,

        calculation_snapshot  JSONB,
        created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMP NOT NULL DEFAULT NOW(),

        CONSTRAINT payroll_slips_member_month_uq UNIQUE (member_uid, pay_year, pay_month)
      )
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_payroll_slips_member ON payroll_slips(member_uid)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_payroll_slips_month ON payroll_slips(pay_year, pay_month)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_payroll_slips_status ON payroll_slips(status)
    `);

    /* payroll_send_history */
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS payroll_send_history (
        id            SERIAL PRIMARY KEY,
        slip_id       INTEGER NOT NULL REFERENCES payroll_slips(id) ON DELETE CASCADE,
        sent_by       VARCHAR(36) NOT NULL,
        sent_to       TEXT NOT NULL,
        status        VARCHAR(20) NOT NULL,
        error_message TEXT,
        resend_id     TEXT,
        created_at    TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_payroll_send_history_slip ON payroll_send_history(slip_id)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_payroll_send_history_status ON payroll_send_history(status)
    `);

    return new Response(
      JSON.stringify({
        ok: true,
        message: "R37 급여 통합 테이블 2종 생성 완료 (payroll_slips, payroll_send_history)",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return jsonError("create_tables", err);
  }
};
