/**
 * GET /api/migrate-att-r36-workmode-change          진단 (인증 불필요)
 * GET /api/migrate-att-r36-workmode-change?run=1    어드민 인증 후 실행
 *
 * R36-Att-Optional A-1: 직원 역방향 근무형태 변경 신청 테이블 신설
 * 호출 성공 후 즉시 파일 삭제 + 커밋.
 */
import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-att-r36-workmode-change" };

function jsonError(step: string, err: any) {
  return new Response(
    JSON.stringify({
      ok: false,
      error: "att_workmode_change_requests 마이그레이션 실패",
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

  if (!run) {
    /* 진단 모드 — 테이블 존재 여부만 확인 */
    try {
      const { db } = await import("../../db");
      const { sql } = await import("drizzle-orm");
      const result: any = await db.execute(sql`
        SELECT to_regclass('public.att_workmode_change_requests') AS tbl
      `);
      const rows = Array.isArray(result) ? result : (result?.rows ?? []);
      return new Response(
        JSON.stringify({ ok: true, mode: "diagnose", exists: rows[0]?.tbl ?? null }),
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

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS att_workmode_change_requests (
        id            SERIAL PRIMARY KEY,
        member_uid    VARCHAR(36) NOT NULL,
        target_mode   VARCHAR(30) NOT NULL,
        target_date   DATE NOT NULL,
        reason        TEXT,
        status        VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        reviewed_by   VARCHAR(36),
        review_note   TEXT,
        created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS att_wm_change_member_idx
        ON att_workmode_change_requests (member_uid)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS att_wm_change_status_idx
        ON att_workmode_change_requests (status)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS att_wm_change_date_idx
        ON att_workmode_change_requests (target_date)
    `);

    return new Response(
      JSON.stringify({
        ok: true,
        message: "att_workmode_change_requests 테이블·인덱스 3종 생성 완료 (멱등)",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return jsonError("create_table", err);
  }
};
