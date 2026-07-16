/**
 * POST /api/admin-approval-cancel — 지출 결재 취소·삭제
 * body: { requestId, action: 'cancel'|'delete', reason? }
 *
 * - cancel: 이미 최종 승인되어 지출결의서(정식 결의번호)가 발행된 건을 무효화.
 *   결의번호·발행 PDF는 감사 흔적으로 그대로 남기고 status만 'canceled'로 바꾼다.
 *   연결된 expenses.status도 'canceled'로 바꿔 예산 집행 합계(SUM WHERE status='approved')에서 자동 제외.
 *   이사장(super_admin) 전용 — 이미 확정된 금액을 되돌리는 조작이라 가장 높은 권한만 허용.
 * - delete: 아직 결의번호가 발행되지 않은 건(대기중·반려)만 완전 삭제.
 *   결의번호가 한 번이라도 발행된 문서는 삭제 자체를 막는다(회계 문서 번호 결번 방지) —
 *   그런 건은 cancel로만 무효화 가능. 기안자 본인 또는 이사장만 삭제 가능.
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";
import { createNotification } from "../../lib/notify";
import { logAdminAction } from "../../lib/audit";

export const config = { path: "/api/admin-approval-cancel" };

function jsonError(step: string, err: any) {
  return new Response(jsonKST({
    ok: false, error: "결재 취소/삭제 처리 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}
function bad(msg: string, status = 400) {
  return new Response(jsonKST({ ok: false, error: msg }),
    { status, headers: { "Content-Type": "application/json" } });
}
async function rowsOf(q: any): Promise<any[]> { return q?.rows ?? q ?? []; }

export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "POST") return bad("POST 메서드만 허용", 405);

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  const me = auth.ctx.member;
  const myId = auth.ctx.admin.uid;

  let body: any;
  try { body = await req.json(); } catch { body = {}; }
  const requestId = Number(body.requestId);
  const action = String(body.action || "");
  const reason = body.reason ? String(body.reason).slice(0, 500) : null;
  if (!requestId || (action !== "cancel" && action !== "delete")) {
    return bad("requestId·action('cancel'|'delete') 필수");
  }

  let r: any;
  try {
    const rows = await rowsOf(await db.execute(sql`
      SELECT id, title, amount, status, expense_id, resolution_no, drafter_id, drafter_name
        FROM approval_requests WHERE id = ${requestId} LIMIT 1
    `));
    r = rows[0];
  } catch (err: any) { return jsonError("select_request", err); }
  if (!r) return bad("결재 요청을 찾을 수 없습니다", 404);

  if (action === "cancel") {
    if (me.role !== "super_admin") return bad("결재취소는 이사장(super_admin) 전용입니다", 403);
    if (r.status !== "approved") return bad(`최종 승인된 건만 취소할 수 있습니다 (현재 상태: ${r.status})`, 409);

    try {
      if (r.expense_id) {
        await db.execute(sql`UPDATE expenses SET status = 'canceled', updated_at = NOW() WHERE id = ${r.expense_id}`);
      }
      await db.execute(sql`
        UPDATE approval_requests SET status = 'canceled', updated_at = NOW() WHERE id = ${requestId}
      `);
      await logAdminAction(req, myId, me.name || "", "approval_cancel", {
        target: String(requestId), detail: { resolutionNo: r.resolution_no, amount: Number(r.amount), reason },
      });
      if (r.drafter_id) {
        await createNotification({
          recipientId: Number(r.drafter_id), recipientType: "operator",
          category: "system", severity: "warning",
          title: "지출결의서 취소됨",
          message: `"${r.title}" (${r.resolution_no || ""}) 결재가 취소됐어요.${reason ? " 사유: " + reason : ""}`,
          link: "/cms-tbfa.html#approval-resolutions", refTable: "approval_requests", refId: requestId,
        });
      }
    } catch (err: any) { return jsonError("cancel", err); }

    return new Response(jsonKST({ ok: true, data: { status: "canceled" } }),
      { headers: { "Content-Type": "application/json" } });
  }

  /* ── delete ── */
  if (r.resolution_no) {
    return bad("정식 결의번호가 발행된 문서는 삭제할 수 없습니다. 결재취소를 사용하세요.", 409);
  }
  const canDelete = me.role === "super_admin" || Number(r.drafter_id) === myId;
  if (!canDelete) return bad("본인이 올린 기안 또는 이사장만 삭제할 수 있습니다", 403);

  try {
    await db.execute(sql`DELETE FROM approval_requests WHERE id = ${requestId}`);
    await logAdminAction(req, myId, me.name || "", "approval_delete", {
      target: String(requestId), detail: { title: r.title, amount: Number(r.amount), status: r.status },
    });
  } catch (err: any) { return jsonError("delete", err); }

  return new Response(jsonKST({ ok: true, data: { deleted: true } }),
    { headers: { "Content-Type": "application/json" } });
}
