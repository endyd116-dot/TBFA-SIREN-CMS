// netlify/functions/comment-report.ts
// 라운드 10 — 사건 댓글/사건 신고 (중복 체크)
//
// POST /api/comment-report
//   { commentId?: number, incidentId?: number, reportType: "comment"|"incident", reason: string }
// 응답: { ok, reportId }

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireActiveUser } from "../../lib/auth";

export const config = { path: "/api/comment-report" };

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function jsonError(step: string, err: any, status = 500) {
  return json({
    ok: false,
    error: "신고 처리 실패",
    step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }, status);
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

  const _r = await requireActiveUser(req);
  if (!_r.ok) return (_r as { ok: false; res: Response }).res;
  const memberId: number = _r.user.uid;

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "JSON 파싱 오류" }, 400); }

  const reportType = String(body?.reportType || "").trim();
  const reason = String(body?.reason || "").trim();
  const commentId = body?.commentId != null ? Number(body.commentId) : null;
  const incidentId = body?.incidentId != null ? Number(body.incidentId) : null;

  if (reportType !== "comment" && reportType !== "incident") {
    return json({ ok: false, error: "reportType은 comment 또는 incident" }, 400);
  }
  if (!reason || reason.length < 1) {
    return json({ ok: false, error: "신고 사유를 입력해주세요" }, 400);
  }
  if (reportType === "comment" && (!commentId || !Number.isFinite(commentId))) {
    return json({ ok: false, error: "commentId 필요" }, 400);
  }
  if (reportType === "incident" && (!incidentId || !Number.isFinite(incidentId))) {
    return json({ ok: false, error: "incidentId 필요" }, 400);
  }

  // check_duplicate
  try {
    let dupRes: any;
    if (reportType === "comment") {
      dupRes = await db.execute(sql`
        SELECT id FROM comment_reports
        WHERE member_id = ${memberId} AND comment_id = ${commentId}
        LIMIT 1
      `);
    } else {
      dupRes = await db.execute(sql`
        SELECT id FROM comment_reports
        WHERE member_id = ${memberId} AND incident_id = ${incidentId}
        LIMIT 1
      `);
    }
    const dupRows = dupRes?.rows ?? dupRes;
    if (dupRows?.length > 0) {
      return json({ ok: false, error: "이미 신고한 항목입니다." }, 409);
    }
  } catch (err: any) {
    return jsonError("check_duplicate", err);
  }

  // insert
  try {
    const insRes: any = await db.execute(sql`
      INSERT INTO comment_reports (comment_id, incident_id, member_id, report_type, reason, status, created_at)
      VALUES (${commentId}, ${incidentId}, ${memberId}, ${reportType}, ${reason.slice(0, 500)}, 'pending', now())
      RETURNING id
    `);
    const row = (insRes?.rows ?? insRes)?.[0];
    return json({ ok: true, reportId: Number(row?.id) });
  } catch (err: any) {
    return jsonError("insert", err);
  }
};
