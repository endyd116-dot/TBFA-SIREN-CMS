/**
 * migrate-att-r29-halfday
 *
 * 반차(0.5일) 처리를 위한 att_leave_requests 컬럼 2개 추가:
 *   - is_half_day      BOOLEAN NOT NULL DEFAULT FALSE
 *   - half_day_period  VARCHAR(2)  DEFAULT NULL  -- 'AM' | 'PM'
 *
 * 멱등 보장: ADD COLUMN IF NOT EXISTS.
 *
 * 진단:  GET ?       — 현재 컬럼 상태 표시
 * 실행:  GET ?run=1  — 어드민 인증 후 ALTER TABLE
 */
import { db } from "../../db/index";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-att-r29-halfday" };

function jsonOk(data: unknown) {
  return new Response(JSON.stringify({ ok: true, ...((data as any) || {}) }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "마이그레이션 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}

const TARGET_COLS = ["is_half_day", "half_day_period"];

async function getExistingCols(): Promise<string[]> {
  const res: any = await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'att_leave_requests'
      AND column_name IN ('is_half_day', 'half_day_period')
  `);
  const rows = Array.isArray(res) ? res : (res?.rows ?? []);
  return rows.map((r: any) => String(r.column_name));
}

export default async function handler(req: Request) {
  if (req.method !== "GET") return new Response("Method Not Allowed", { status: 405 });

  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  if (!run) {
    try {
      const existing = await getExistingCols();
      const missing = TARGET_COLS.filter(c => !existing.includes(c));
      return jsonOk({
        mode: "diagnose",
        existing,
        missing,
        nextStep: missing.length === 0
          ? "모든 컬럼 존재 — 실행 불필요"
          : "GET ?run=1 로 실행 (어드민 로그인 필요)",
      });
    } catch (err) {
      return jsonError("diagnose", err);
    }
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  try {
    await db.execute(sql`
      ALTER TABLE att_leave_requests
      ADD COLUMN IF NOT EXISTS is_half_day BOOLEAN DEFAULT FALSE NOT NULL
    `);
    await db.execute(sql`
      ALTER TABLE att_leave_requests
      ADD COLUMN IF NOT EXISTS half_day_period VARCHAR(2)
    `);

    const after = await getExistingCols();
    return jsonOk({
      mode: "run",
      result: "applied",
      columns: after,
      nextStep: "schema.ts attLeaveRequests 정의 갱신 + 1회용 마이그파일 삭제 push",
    });
  } catch (err) {
    return jsonError("alter_table", err);
  }
}
