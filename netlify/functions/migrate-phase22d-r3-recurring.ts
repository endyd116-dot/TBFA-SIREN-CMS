/**
 * Phase 22-D-R3 마이그레이션 — vouchers 반복 전표 컬럼 추가
 * GET /api/migrate-phase22d-r3-recurring          → 진단 (인증 불필요)
 * GET /api/migrate-phase22d-r3-recurring?run=1    → ALTER 실행 (어드민 인증)
 *
 * 추가 컬럼 (멱등 — IF NOT EXISTS):
 *   - recurring_day    INTEGER          매월 자동 생성일 (1~31, 0=말일)
 *   - recurring_active BOOLEAN DEFAULT FALSE  자동 생성 ON/OFF
 *
 * 호출 성공 후 즉시 파일 삭제 + 커밋 (1회용 보안 원칙)
 */
import type { Context } from "@netlify/functions";
import { neon } from "@neondatabase/serverless";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-phase22d-r3-recurring" };

export default async function handler(req: Request, _ctx: Context) {
  const url   = new URL(req.url);
  const doRun = url.searchParams.get("run") === "1";
  const sql   = neon(process.env.NETLIFY_DATABASE_URL!);

  // ── 진단 모드 ──────────────────────────────────────────────
  if (!doRun) {
    const cols = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'vouchers'
        AND column_name IN ('recurring_day', 'recurring_active')`;
    const existing = cols.map((c: any) => c.column_name);
    return new Response(JSON.stringify({
      ok: true, mode: "diagnostic",
      existingColumns: existing,
      pending: ["recurring_day", "recurring_active"].filter((c) => !existing.includes(c)),
      hint: "?run=1 으로 ALTER 실행",
    }), { headers: { "Content-Type": "application/json" } });
  }

  // ── 인증 ──────────────────────────────────────────────────
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  // ── Run 모드 — 멱등 ALTER ──────────────────────────────────
  try {
    await sql`ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS recurring_day INTEGER`;
    await sql`ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS recurring_active BOOLEAN NOT NULL DEFAULT FALSE`;

    const cols = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'vouchers'
        AND column_name IN ('recurring_day', 'recurring_active')`;

    return new Response(JSON.stringify({
      ok: true, mode: "executed",
      columns: cols.map((c: any) => c.column_name),
      message: "vouchers 반복 전표 컬럼 2개 추가 완료 (recurring_day, recurring_active)",
    }), { headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false, error: "ALTER 실패",
      detail: String(err?.message || err).slice(0, 500),
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
