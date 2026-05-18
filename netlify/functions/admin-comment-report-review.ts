// netlify/functions/admin-comment-report-review.ts
// 라운드 10 — 어드민 신고 검토 처리
//
// PATCH /api/admin-comment-report-review
//   { reportId, status: "reviewed"|"dismissed"|"resolved", action?: "none"|"hide_comment"|"delete_comment" }
// 응답: { ok }
//
// action="hide_comment" → incidentComments SET isHidden=true
// action="delete_comment" → incidentComments DELETE

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/admin-comment-report-review" };

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function jsonError(step: string, err: any, status = 500) {
  return json({
    ok: false,
    error: "신고 검토 처리 실패",
    step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }, status);
}

const VALID_STATUS = new Set(["pending", "reviewed", "dismissed", "resolved"]);
const VALID_ACTION = new Set(["none", "hide_comment", "delete_comment"]);

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "PATCH") return json({ ok: false, error: "PATCH only" }, 405);

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;
  const adminId = (auth.ctx.member as any).id as number;

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "JSON 파싱 오류" }, 400); }

  const reportId = Number(body?.reportId);
  const status = String(body?.status || "").trim();
  const action = String(body?.action || "none").trim();

  if (!Number.isFinite(reportId) || reportId <= 0) {
    return json({ ok: false, error: "reportId 필요" }, 400);
  }
  if (!VALID_STATUS.has(status)) {
    return json({ ok: false, error: "유효하지 않은 status" }, 400);
  }
  if (!VALID_ACTION.has(action)) {
    return json({ ok: false, error: "유효하지 않은 action" }, 400);
  }

  // 신고 레코드 조회
  let report: any;
  try {
    const r: any = await db.execute(sql`
      SELECT id, comment_id, incident_id, report_type
      FROM comment_reports WHERE id = ${reportId} LIMIT 1
    `);
    report = (r?.rows ?? r)?.[0];
    if (!report) return json({ ok: false, error: "신고를 찾을 수 없습니다" }, 404);
  } catch (err: any) {
    return jsonError("select_report", err);
  }

  // action 적용 (댓글 숨김/삭제)
  try {
    if (action === "hide_comment" && report.comment_id) {
      await db.execute(sql`
        UPDATE incident_comments
           SET is_hidden = true, hidden_by = ${adminId}, hidden_at = now()
         WHERE id = ${report.comment_id}
      `);
    } else if (action === "delete_comment" && report.comment_id) {
      await db.execute(sql`DELETE FROM incident_comments WHERE id = ${report.comment_id}`);
    }
  } catch (err: any) {
    return jsonError("apply_action", err);
  }

  // 신고 status 갱신
  try {
    await db.execute(sql`
      UPDATE comment_reports
         SET status = ${status},
             reviewed_by = ${adminId},
             reviewed_at = now()
       WHERE id = ${reportId}
    `);
    return json({ ok: true });
  } catch (err: any) {
    return jsonError("update_status", err);
  }
};
