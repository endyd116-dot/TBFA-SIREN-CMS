import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export default async (req: Request, _ctx: Context) => {
  /* 진단 모드 (인증 없이) */
  if (req.method === "GET" && !new URL(req.url).searchParams.get("run")) {
    return new Response(JSON.stringify({
      ok: true,
      mode: "diagnostic",
      description: "GET ?run=1 로 실행 (어드민 로그인 필요)",
      indexes: [
        "members(created_at)",
        "members(status)",
        "members(type)",
        "members(donor_type)",
        "donations(member_id, status)",
        "donations(created_at)",
        "notifications(member_id, is_read)",
        "audit_logs(created_at)",
        "workspace_tasks(status, due_date)",
        "send_jobs(status, scheduled_at)",
      ],
    }), { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } });
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  const results: { index: string; result: string }[] = [];

  async function addIndex(name: string, ddl: string) {
    try {
      await db.execute(sql.raw(ddl));
      results.push({ index: name, result: "ok" });
    } catch (e: any) {
      /* 이미 존재하면 무시 */
      results.push({ index: name, result: e?.message?.includes("already exists") ? "already exists" : String(e?.message).slice(0, 120) });
    }
  }

  /* members 테이블 — 목록 조회·필터링에 자주 사용 */
  await addIndex("idx_members_created_at",   "CREATE INDEX IF NOT EXISTS idx_members_created_at   ON members(created_at DESC)");
  await addIndex("idx_members_status",        "CREATE INDEX IF NOT EXISTS idx_members_status        ON members(status)");
  await addIndex("idx_members_type",          "CREATE INDEX IF NOT EXISTS idx_members_type          ON members(type)");
  await addIndex("idx_members_donor_type",    "CREATE INDEX IF NOT EXISTS idx_members_donor_type    ON members(donor_type) WHERE donor_type IS NOT NULL");

  /* donations 테이블 — 후원 내역 조회 */
  await addIndex("idx_donations_member_status", "CREATE INDEX IF NOT EXISTS idx_donations_member_status ON donations(member_id, status)");
  await addIndex("idx_donations_created_at",    "CREATE INDEX IF NOT EXISTS idx_donations_created_at    ON donations(created_at DESC)");
  await addIndex("idx_donations_status",        "CREATE INDEX IF NOT EXISTS idx_donations_status        ON donations(status)");

  /* notifications 테이블 — 알림 목록 */
  await addIndex("idx_notifications_member_read", "CREATE INDEX IF NOT EXISTS idx_notifications_member_read ON notifications(member_id, is_read)");
  await addIndex("idx_notifications_created_at",  "CREATE INDEX IF NOT EXISTS idx_notifications_created_at  ON notifications(created_at DESC)");

  /* audit_logs 테이블 — 감사 로그 정리 cron */
  await addIndex("idx_audit_logs_created_at", "CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC)");

  /* workspace_tasks 테이블 — 칸반·마감 알림 */
  await addIndex("idx_workspace_tasks_status_due", "CREATE INDEX IF NOT EXISTS idx_workspace_tasks_status_due ON workspace_tasks(status, due_date)");
  await addIndex("idx_workspace_tasks_board_id",   "CREATE INDEX IF NOT EXISTS idx_workspace_tasks_board_id   ON workspace_tasks(board_id)");

  /* send_jobs 테이블 — 발송 작업 목록 */
  await addIndex("idx_send_jobs_status",       "CREATE INDEX IF NOT EXISTS idx_send_jobs_status        ON send_jobs(status)");
  await addIndex("idx_send_jobs_scheduled_at", "CREATE INDEX IF NOT EXISTS idx_send_jobs_scheduled_at ON send_jobs(scheduled_at DESC)");

  return new Response(
    JSON.stringify({ ok: true, results }),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } }
  );
};

export const config = { path: "/api/migrate-add-indexes" };
