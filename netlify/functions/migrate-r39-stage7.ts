/**
 * R39 Stage 7 — 휴가 수동 조정 이력 + 어드민 출퇴근 수정 이력 + 디바이스 타입
 *
 * GET            : 진단 (인증 불필요·테이블/컬럼 존재 여부 확인)
 * GET ?run=1     : 어드민 인증 후 실행 (멱등)
 *
 * 변경 3종:
 *   1) att_leave_balance_adjustments — 휴가 잔여 수동 조정 이력 (감사 추적)
 *   2) att_record_admin_edits        — 어드민 출퇴근 수정 이력 (R35 H-G2 호환)
 *   3) att_records.device_type       — 디바이스 타입 컬럼 (MOBILE·TABLET·DESKTOP)
 */
import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-r39-stage7" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

async function tableExists(name: string): Promise<boolean> {
  try {
    const r = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ${name}
      ) AS exists
    `);
    return Boolean(((r as any).rows?.[0] ?? (r as any)[0])?.exists);
  } catch { return false; }
}
async function columnExists(table: string, col: string): Promise<boolean> {
  try {
    const r = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${col}
      ) AS exists
    `);
    return Boolean(((r as any).rows?.[0] ?? (r as any)[0])?.exists);
  } catch { return false; }
}

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);

  /* ── 진단 ── */
  if (req.method === "GET" && !url.searchParams.get("run")) {
    const diag = {
      ok: true,
      mode: "diagnostic",
      changes: {
        att_leave_balance_adjustments: await tableExists("att_leave_balance_adjustments"),
        att_record_admin_edits:        await tableExists("att_record_admin_edits"),
        att_records_device_type:       await columnExists("att_records", "device_type"),
      },
      runUrl: "/api/migrate-r39-stage7?run=1",
    };
    return new Response(JSON.stringify(diag, null, 2), { status: 200, headers: JSON_HEADER });
  }

  /* ── 실행 ── */
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  const steps: Array<{ step: string; result: string }> = [];

  /* 1) att_leave_balance_adjustments */
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS att_leave_balance_adjustments (
        id            serial PRIMARY KEY,
        member_uid    varchar(36) NOT NULL,
        leave_type_id integer NOT NULL,
        year          integer NOT NULL,
        delta_days    numeric(6, 2) NOT NULL,
        reason        text NOT NULL,
        adjusted_by   varchar(36) NOT NULL,
        created_at    timestamp NOT NULL DEFAULT now()
      )
    `);
    steps.push({ step: "create_att_leave_balance_adjustments", result: "ok" });
  } catch (e: any) {
    steps.push({ step: "create_att_leave_balance_adjustments", result: String(e?.message).slice(0, 300) });
  }
  try {
    await db.execute(sql`CREATE INDEX IF NOT EXISTS att_lba_member_idx ON att_leave_balance_adjustments (member_uid)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS att_lba_type_idx ON att_leave_balance_adjustments (leave_type_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS att_lba_member_year_idx ON att_leave_balance_adjustments (member_uid, year)`);
    steps.push({ step: "index_att_leave_balance_adjustments", result: "ok" });
  } catch (e: any) {
    steps.push({ step: "index_att_leave_balance_adjustments", result: String(e?.message).slice(0, 300) });
  }

  /* 2) att_record_admin_edits */
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS att_record_admin_edits (
        id              serial PRIMARY KEY,
        record_id       integer NOT NULL REFERENCES att_records(id) ON DELETE CASCADE,
        edited_by       varchar(36) NOT NULL,
        old_check_in    timestamp,
        old_check_out   timestamp,
        old_work_mode   varchar(30),
        new_check_in    timestamp,
        new_check_out   timestamp,
        new_work_mode   varchar(30),
        reason          text NOT NULL,
        created_at      timestamp NOT NULL DEFAULT now()
      )
    `);
    steps.push({ step: "create_att_record_admin_edits", result: "ok" });
  } catch (e: any) {
    steps.push({ step: "create_att_record_admin_edits", result: String(e?.message).slice(0, 300) });
  }
  try {
    await db.execute(sql`CREATE INDEX IF NOT EXISTS att_rae_record_idx ON att_record_admin_edits (record_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS att_rae_edited_by_idx ON att_record_admin_edits (edited_by)`);
    steps.push({ step: "index_att_record_admin_edits", result: "ok" });
  } catch (e: any) {
    steps.push({ step: "index_att_record_admin_edits", result: String(e?.message).slice(0, 300) });
  }

  /* 3) att_records.device_type — ALTER TABLE ADD COLUMN IF NOT EXISTS */
  try {
    await db.execute(sql`
      ALTER TABLE att_records ADD COLUMN IF NOT EXISTS device_type varchar(20)
    `);
    steps.push({ step: "alter_att_records_device_type", result: "ok" });
  } catch (e: any) {
    steps.push({ step: "alter_att_records_device_type", result: String(e?.message).slice(0, 300) });
  }

  /* 검증 */
  const verify = {
    att_leave_balance_adjustments: await tableExists("att_leave_balance_adjustments"),
    att_record_admin_edits:        await tableExists("att_record_admin_edits"),
    att_records_device_type:       await columnExists("att_records", "device_type"),
  };

  return new Response(JSON.stringify({
    ok: true,
    steps,
    verify,
  }, null, 2), { status: 200, headers: JSON_HEADER });
};
