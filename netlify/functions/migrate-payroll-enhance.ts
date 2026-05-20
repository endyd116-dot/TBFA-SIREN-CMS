/**
 * migrate-payroll-enhance — 급여 고도화 스키마 (1회용)
 *
 *  GET  /api/migrate-payroll-enhance          진단 (인증 불필요) — 컬럼·테이블 존재 여부
 *  GET  /api/migrate-payroll-enhance?run=1     실행 (super_admin 인증) — 멱등 적용
 *
 * 적용:
 *  1) payroll_slips 컬럼 추가 — 수동수정 잠금·조정라인·공제 7종·공제합계·실수령·지급확정
 *  2) payroll_settings 신규 (계산기준 단일행·id=1 시드)
 *  3) payroll_audit 신규 (수정 이력)
 *
 * 호출 성공 후: schema.ts 정의 활성화 + 본 파일 삭제 + 커밋.
 */
import type { Context } from "@netlify/functions";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-payroll-enhance" };

const NEW_SLIP_COLS = [
  "manually_edited", "adjustments",
  "income_tax", "local_tax", "national_pension", "health_insurance",
  "long_term_care", "employment_insurance", "other_deduction",
  "total_deduction", "net_pay", "paid_at", "paid_by",
];

export default async function handler(req: Request, _ctx: Context) {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  // ── 진단 모드 (인증 불필요) ──
  if (!run) {
    try {
      const cols = await db.execute(sql`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'payroll_slips' AND column_name = ANY(${NEW_SLIP_COLS}::text[])
      `);
      const existingCols = ((cols as any).rows || (cols as any[])).map((r: any) => r.column_name);
      const tbls = await db.execute(sql`
        SELECT table_name FROM information_schema.tables
        WHERE table_name IN ('payroll_settings', 'payroll_audit')
      `);
      const existingTbls = ((tbls as any).rows || (tbls as any[])).map((r: any) => r.table_name);
      return Response.json({
        ok: true, mode: "diagnose",
        slipColumns: { expected: NEW_SLIP_COLS, existing: existingCols, missing: NEW_SLIP_COLS.filter(c => !existingCols.includes(c)) },
        tables: { expected: ["payroll_settings", "payroll_audit"], existing: existingTbls },
        hint: "적용하려면 ?run=1 (super_admin 로그인 상태에서 주소창 호출)",
      });
    } catch (err: any) {
      return Response.json({ ok: false, step: "diagnose", detail: String(err?.message || err).slice(0, 500) }, { status: 500 });
    }
  }

  // ── 실행 모드 (super_admin) ──
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  if ((auth.ctx.member as any).role !== "super_admin") {
    return Response.json({ ok: false, error: "슈퍼어드민 전용" }, { status: 403 });
  }

  const done: string[] = [];
  try {
    // 1) payroll_slips 컬럼 추가 (멱등)
    await db.execute(sql`
      ALTER TABLE payroll_slips
        ADD COLUMN IF NOT EXISTS manually_edited      boolean        NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS adjustments          jsonb          NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS income_tax           numeric(15,2)  NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS local_tax            numeric(15,2)  NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS national_pension     numeric(15,2)  NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS health_insurance     numeric(15,2)  NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS long_term_care       numeric(15,2)  NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS employment_insurance numeric(15,2)  NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS other_deduction      numeric(15,2)  NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS total_deduction      numeric(15,2)  NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS net_pay              numeric(15,2)  NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS paid_at              timestamp,
        ADD COLUMN IF NOT EXISTS paid_by              varchar(36)
    `);
    done.push("payroll_slips columns");

    // 2) payroll_settings (계산기준·단일행)
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS payroll_settings (
        id                   serial PRIMARY KEY,
        overtime_multiplier  numeric(5,2)  NOT NULL DEFAULT 1.5,
        annual_hours         integer       NOT NULL DEFAULT 2080,
        monthly_work_days    integer       NOT NULL DEFAULT 22,
        pension_rate         numeric(6,5)  NOT NULL DEFAULT 0.045,
        health_rate          numeric(6,5)  NOT NULL DEFAULT 0.03545,
        longterm_rate        numeric(6,5)  NOT NULL DEFAULT 0.1295,
        employment_rate      numeric(6,5)  NOT NULL DEFAULT 0.009,
        income_tax_rate      numeric(6,5)  NOT NULL DEFAULT 0,
        updated_at           timestamp     NOT NULL DEFAULT now(),
        updated_by           varchar(36)
      )
    `);
    done.push("payroll_settings table");

    // 단일행 시드 (id=1)
    await db.execute(sql`INSERT INTO payroll_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
    done.push("payroll_settings seed(id=1)");

    // 3) payroll_audit (수정 이력)
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS payroll_audit (
        id          serial PRIMARY KEY,
        slip_id     integer     NOT NULL REFERENCES payroll_slips(id) ON DELETE CASCADE,
        changed_by  varchar(36) NOT NULL,
        field       varchar(60) NOT NULL,
        old_value   text,
        new_value   text,
        reason      text,
        created_at  timestamp   NOT NULL DEFAULT now()
      )
    `);
    done.push("payroll_audit table");

    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_payroll_audit_slip ON payroll_audit(slip_id)`);
    done.push("payroll_audit index");

    return Response.json({ ok: true, mode: "run", done });
  } catch (err: any) {
    return Response.json({
      ok: false, step: "run", done,
      detail: String(err?.message || err).slice(0, 500),
    }, { status: 500 });
  }
}
