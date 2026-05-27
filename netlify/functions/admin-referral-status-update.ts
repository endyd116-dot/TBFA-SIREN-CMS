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
    /* Q2-035: RETURNING id로 실제 갱신 행 확인 — 0행이면 존재하지 않는 인계 건이므로 404.
       (기존에는 0행 갱신도 ok 반환해 잘못된 referralId가 성공으로 보였음) */
    const result = await db.execute(sql`
      UPDATE referral_logs SET
        status            = ${status},
        status_memo       = ${statusMemo ?? null},
        status_updated_by = ${adminId},
        status_updated_at = NOW(),
        updated_at        = NOW()
      WHERE id = ${Number(referralId)}
      RETURNING id
    `);
    const rows = Array.isArray(result) ? result : ((result as any)?.rows ?? []);
    if (rows.length === 0) {
      return new Response(
        JSON.stringify({ ok: false, error: "인계 건을 찾을 수 없습니다" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return jsonError("update_status", err);
  }
};
