/**
 * admin-martyrdom-review — 전문가 검토 배정·결정 (⑤·§P3.2)
 *
 * POST  { caseId, outputId, assignedTo }       : 검토자 배정
 * PATCH { reviewId, status, note? }            : 승인(approved)/수정요청(changes_requested) 결정
 *                                                approved 시 draft ai_outputs status→reviewed
 * GET   ?caseId=N                              : 검토 이력·배정 현황
 *
 * 응답:
 *   POST  { ok, reviewId, status:'pending', assignedTo }
 *   PATCH { ok, reviewId, status }
 *   GET   { ok, reviews:[…] }
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { logAdminAction } from "../../lib/audit";
import { notifyMartyrdomAdmins } from "../../lib/martyrdom-notify";

export const config = { path: "/api/admin-martyrdom-review" };

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "처리 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}
function badRequest(msg: string) {
  return new Response(JSON.stringify({ ok: false, error: msg }), {
    status: 400, headers: { "Content-Type": "application/json" },
  });
}

export default async (req: Request, _ctx: Context) => {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  const { admin, member } = auth.ctx;

  /* ─────────── POST — 검토자 배정 ─────────── */
  if (req.method === "POST") {
    let body: any;
    try { body = await req.json(); } catch { return badRequest("요청 본문 파싱 실패"); }
    const caseId = Number(body.caseId);
    const outputId = Number(body.outputId);
    const assignedTo = Number(body.assignedTo);
    if (!caseId || !outputId || !assignedTo) return badRequest("caseId·outputId·assignedTo 필수");

    try {
      /* 대상 산출물·검토자 존재 확인 */
      const oc: any = await db.execute(sql.raw(`SELECT id FROM martyrdom_ai_outputs WHERE id = ${outputId} AND case_id = ${caseId} LIMIT 1`));
      if (!(oc?.rows ?? oc ?? []).length) return badRequest("대상 산출물을 찾을 수 없습니다");
      const mc: any = await db.execute(sql.raw(`SELECT id, name FROM members WHERE id = ${assignedTo} AND operator_active = true LIMIT 1`));
      const reviewer = (mc?.rows ?? mc ?? [])[0];
      if (!reviewer) return badRequest("배정 가능한 운영자가 아닙니다");

      const ins: any = await db.execute(sql.raw(`
        INSERT INTO martyrdom_reviews (case_id, output_id, assigned_to, assigned_by, status, created_at)
        VALUES (${caseId}, ${outputId}, ${assignedTo}, ${admin.uid}, 'pending', NOW())
        RETURNING id
      `));
      const reviewId = Number((ins?.rows ?? ins ?? [])[0]?.id || 0);

      void logAdminAction(req, admin.uid, member.name || String(admin.uid), "martyrdom_review_assign", {
        target: String(caseId), detail: { outputId, assignedTo },
      });

      void notifyMartyrdomAdmins({
        caseId, assignedAdminId: assignedTo,
        title: "순직 지원 — 서면 검토 배정",
        message: `유족급여신청서 초안 검토가 배정되었습니다 (${reviewer.name || "운영자"}).`,
        severity: "info",
      });

      return new Response(JSON.stringify({ ok: true, reviewId, status: "pending", assignedTo }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (err: any) {
      return jsonError("review_assign", err);
    }
  }

  /* ─────────── PATCH — 검토 결정 ─────────── */
  if (req.method === "PATCH") {
    let body: any;
    try { body = await req.json(); } catch { return badRequest("요청 본문 파싱 실패"); }
    const reviewId = Number(body.reviewId);
    const status = String(body.status || "");
    if (!reviewId) return badRequest("reviewId 필수");
    if (!["approved", "changes_requested"].includes(status)) return badRequest("status는 approved|changes_requested");
    const note = body.note ? String(body.note).slice(0, 2000) : null;

    try {
      const rv: any = await db.execute(sql.raw(`SELECT id, case_id AS "caseId", output_id AS "outputId" FROM martyrdom_reviews WHERE id = ${reviewId} LIMIT 1`));
      const row = (rv?.rows ?? rv ?? [])[0];
      if (!row) {
        return new Response(JSON.stringify({ ok: false, error: "검토 배정을 찾을 수 없습니다" }), {
          status: 404, headers: { "Content-Type": "application/json" },
        });
      }

      const noteSql = note ? `'${note.replace(/'/g, "''")}'` : "NULL";
      await db.execute(sql.raw(`
        UPDATE martyrdom_reviews SET status = '${status}', note = ${noteSql}, decided_at = NOW() WHERE id = ${reviewId}
      `));

      /* 승인 시 draft 산출물 status → reviewed */
      if (status === "approved" && row.outputId) {
        await db.execute(sql.raw(`
          UPDATE martyrdom_ai_outputs SET status = 'reviewed', reviewed_by = ${admin.uid}, reviewed_at = NOW()
          WHERE id = ${Number(row.outputId)}
        `));
      }

      void logAdminAction(req, admin.uid, member.name || String(admin.uid), "martyrdom_review_decide", {
        target: String(reviewId), detail: { status },
      });

      void notifyMartyrdomAdmins({
        caseId: Number(row.caseId),
        title: status === "approved" ? "순직 지원 — 서면 검토 승인" : "순직 지원 — 서면 수정 요청",
        message: status === "approved" ? "유족급여신청서 초안이 검토 승인되었습니다." : "유족급여신청서 초안에 수정 요청이 등록되었습니다.",
        severity: status === "approved" ? "info" : "warning",
      });

      return new Response(JSON.stringify({ ok: true, reviewId, status }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (err: any) {
      return jsonError("review_decide", err);
    }
  }

  /* ─────────── GET — 검토 이력 ─────────── */
  if (req.method === "GET") {
    const url = new URL(req.url);
    const caseId = Number(url.searchParams.get("caseId"));
    if (!caseId) return badRequest("caseId 필수");

    try {
      const rr: any = await db.execute(sql.raw(`
        SELECT r.id, r.output_id AS "outputId", r.assigned_to AS "assignedTo", m.name AS "assignedToName",
               r.status, r.note, r.created_at AS "createdAt", r.decided_at AS "decidedAt"
        FROM martyrdom_reviews r
        LEFT JOIN members m ON m.id = r.assigned_to
        WHERE r.case_id = ${caseId}
        ORDER BY r.created_at DESC
      `));
      const reviews = (rr?.rows ?? rr ?? []).map((row: any) => ({
        id: Number(row.id), outputId: Number(row.outputId), assignedTo: Number(row.assignedTo),
        assignedToName: row.assignedToName ? String(row.assignedToName) : null,
        status: String(row.status || "pending"), note: row.note ? String(row.note) : null,
        createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
        decidedAt: row.decidedAt ? new Date(row.decidedAt).toISOString() : null,
      }));
      return new Response(JSON.stringify({ ok: true, reviews }), { headers: { "Content-Type": "application/json" } });
    } catch (err: any) {
      return jsonError("review_list", err);
    }
  }

  return new Response(JSON.stringify({ ok: false, error: "POST·PATCH·GET만 허용" }), { status: 405 });
};
