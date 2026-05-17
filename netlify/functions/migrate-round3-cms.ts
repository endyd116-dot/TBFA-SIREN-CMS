import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-round3-cms" };

export default async function handler(req: Request, context: Context) {
  const url = new URL(req.url);
  const run = url.searchParams.get("run");

  if (run !== "1") {
    return new Response(
      JSON.stringify({
        ok: true,
        mode: "dry-run",
        message: "진단 모드. ?run=1 로 실행",
        ops: ["donations.paid_at 컬럼 추가", "기존 데이터 백필 (hyosung_paid_date || created_at)"],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  const results: string[] = [];

  try {
    await db.execute(sql`
      ALTER TABLE donations ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP
    `);
    results.push("donations.paid_at 컬럼 추가: OK");
  } catch (err) {
    results.push(`donations.paid_at 컬럼 추가: FAIL — ${String(err)}`);
  }

  try {
    const { rowCount } = await db.execute(sql`
      UPDATE donations
      SET paid_at = COALESCE(hyosung_paid_date, created_at)
      WHERE paid_at IS NULL
    `) as any;
    results.push(`기존 데이터 백필: OK (${rowCount ?? "?"}건)`);
  } catch (err) {
    results.push(`기존 데이터 백필: FAIL — ${String(err)}`);
  }

  return new Response(
    JSON.stringify({ ok: true, results }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
