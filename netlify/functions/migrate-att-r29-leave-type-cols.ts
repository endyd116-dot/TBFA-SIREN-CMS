/**
 * migrate-att-r29-leave-type-cols
 *
 * att_leave_types 테이블에 FE 어드민 화면에서 사용하는 4개 컬럼 추가:
 *   - code           VARCHAR(50) UNIQUE  (휴가 코드, 예: ANNUAL/SICK/PERSONAL)
 *   - max_days       NUMERIC(5,2)         (연간 최대 사용 한도)
 *   - allow_half_day BOOLEAN DEFAULT false (반차 허용)
 *   - description    TEXT                 (설명)
 *
 * 멱등 보장: 이미 컬럼 존재 시 skip (IF NOT EXISTS).
 *
 * 진단:  GET ?       — 현재 컬럼 상태 표시
 * 실행:  GET ?run=1  — 어드민 인증 후 ALTER TABLE
 */
import { db } from "../../db/index";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-att-r29-leave-type-cols" };

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

const TARGET_COLS = ["code", "max_days", "allow_half_day", "description"];

async function getExistingCols(): Promise<string[]> {
  const res: any = await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'att_leave_types'
      AND column_name IN ('code', 'max_days', 'allow_half_day', 'description')
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

  const applied: string[] = [];
  const skipped: string[] = [];

  try {
    // code
    await db.execute(sql`
      ALTER TABLE att_leave_types
      ADD COLUMN IF NOT EXISTS code VARCHAR(50)
    `);
    // code UNIQUE 인덱스 (NULL 허용해야 기존 row 들이 통과되므로 partial unique)
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS att_leave_types_code_uq
        ON att_leave_types (code) WHERE code IS NOT NULL
    `);
    // max_days
    await db.execute(sql`
      ALTER TABLE att_leave_types
      ADD COLUMN IF NOT EXISTS max_days NUMERIC(5,2)
    `);
    // allow_half_day
    await db.execute(sql`
      ALTER TABLE att_leave_types
      ADD COLUMN IF NOT EXISTS allow_half_day BOOLEAN DEFAULT false NOT NULL
    `);
    // description
    await db.execute(sql`
      ALTER TABLE att_leave_types
      ADD COLUMN IF NOT EXISTS description TEXT
    `);

    const after = await getExistingCols();
    for (const c of TARGET_COLS) {
      if (after.includes(c)) applied.push(c);
      else skipped.push(c);
    }

    return jsonOk({
      mode: "run",
      result: "applied",
      columns: after,
      nextStep: "schema.ts 정의 + admin-att-leave-types.ts 본문 갱신 후 push",
    });
  } catch (err) {
    return jsonError("alter_table", err);
  }
}
