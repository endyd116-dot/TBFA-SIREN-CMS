/**
 * POST /api/admin-referral-status-update
 * 인계 건 상태 및 메모 갱신
 *
 * Body: { referralId, status, statusMemo? }
 */
import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-referral-status-update" };

const VALID_STATUSES = ["pending", "sent", "reviewing", "in_progress", "completed", "rejected"];

function jsonError(step: string, err: any) {
  return new Response(
    JSON.stringify({
      ok: false,
      error: "인계 상태 갱신 실패",
      step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }),
    { status: 500, headers: { "Content-Type": "application/json" } }
  );
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "POST only" }), {
      status: 405, headers: { "Content-Type": "application/json" },
    });
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;
  const adminId: number = auth.ctx.admin.uid;

  let body: any;
  try {
    body = await req.json();
  } catch (err) {
    return jsonError("parse_body", err);
  }

  const { referralId, status, statusMemo } = body;

  if (!referralId || isNaN(Number(referralId))) {
    return new Response(
      JSON.stringify({ ok: false, error: "referralId는 필수입니다" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }
  if (!status || !VALID_STATUSES.includes(status)) {
    return new Response(
      JSON.stringify({ ok: false, error: `status는 ${VALID_STATUSES.join("|")} 중 하나여야 합니다` }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    await db.execute(sql`
      UPDATE referral_logs SET
        status            = ${status},
        status_memo       = ${statusMemo ?? null},
        status_updated_by = ${adminId},
        status_updated_at = NOW(),
        updated_at        = NOW()
      WHERE id = ${Number(referralId)}
    `);
    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return jsonError("update_status", err);
  }
};
