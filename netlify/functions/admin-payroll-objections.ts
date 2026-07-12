/**
 * /api/admin-payroll-objections — 급여명세 이의제기 처리 (슈퍼어드민)
 *
 * GET   ?status=OPEN|IN_REVIEW|RESOLVED|REJECTED|ALL   이의제기 목록 (기본 미해결만)
 * PATCH ?id=N   body { status, resolutionNote? }        상태 변경 + 직원에게 회신
 *
 * 기존엔 직원 문의가 알림 한 번으로 끝나 접수·처리·회신 이력이 남지 않았다.
 * 이제 티켓으로 관리한다: 접수(OPEN) → 검토중(IN_REVIEW) → 처리완료(RESOLVED) / 반려(REJECTED)
 */
import { isoUTC, jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { sendWorkspaceNotification } from "../../lib/workspace-logger";

export const config = { path: "/api/admin-payroll-objections" };

const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };
const VALID_STATUS = ["OPEN", "IN_REVIEW", "RESOLVED", "REJECTED"];

function jsonOk(data: unknown, message?: string) {
  return new Response(jsonKST({ ok: true, message, data }), { status: 200, headers: JSON_HEADER });
}
function jsonErr(error: string, status = 400) {
  return new Response(jsonKST({ ok: false, error }), { status, headers: JSON_HEADER });
}
function jsonStepErr(step: string, err: any) {
  return new Response(jsonKST({
    ok: false, error: "이의제기 처리 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 800),
  }), { status: 500, headers: JSON_HEADER });
}
const rows = (r: any) => ((r as any).rows ?? r ?? []) as any[];

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  if ((auth as any).ctx.member.role !== "super_admin") return jsonErr("슈퍼어드민 전용", 403);
  const admin = (auth as any).ctx.member;

  const url = new URL(req.url);

  /* ── 목록 ── */
  if (req.method === "GET") {
    const status = url.searchParams.get("status") || "PENDING_ALL";
    try {
      const cond =
        status === "ALL"          ? sql`TRUE` :
        status === "PENDING_ALL"  ? sql`o.status IN ('OPEN','IN_REVIEW')` :
        VALID_STATUS.includes(status) ? sql`o.status = ${status}` :
        sql`o.status IN ('OPEN','IN_REVIEW')`;

      const r: any = await db.execute(sql`
        SELECT o.id, o.slip_id, o.member_uid, o.reason, o.status,
               o.resolution_note, o.resolved_at, o.created_at,
               s.pay_year, s.pay_month, s.gross_pay, s.net_pay, s.document_version,
               m.name AS member_name, m.email AS member_email
          FROM payroll_objections o
          LEFT JOIN payroll_slips s ON s.id = o.slip_id
          LEFT JOIN members m ON m.id = NULLIF(o.member_uid,'')::int
         WHERE ${cond}
         ORDER BY
           CASE o.status WHEN 'OPEN' THEN 0 WHEN 'IN_REVIEW' THEN 1 ELSE 2 END,
           o.created_at DESC
         LIMIT 200
      `);

      const list = rows(r).map((o: any) => ({
        id: o.id, slipId: o.slip_id, memberUid: o.member_uid,
        memberName: o.member_name, memberEmail: o.member_email,
        payYear: o.pay_year, payMonth: o.pay_month,
        grossPay: o.gross_pay, netPay: o.net_pay,
        documentVersion: Number(o.document_version || 1),
        reason: o.reason, status: o.status,
        resolutionNote: o.resolution_note, resolvedAt: isoUTC(o.resolved_at), createdAt: isoUTC(o.created_at),
      }));

      const counts = { OPEN: 0, IN_REVIEW: 0, RESOLVED: 0, REJECTED: 0 };
      try {
        const cr: any = await db.execute(sql`SELECT status, COUNT(*)::int AS c FROM payroll_objections GROUP BY status`);
        for (const c of rows(cr)) {
          if (c.status in counts) (counts as any)[c.status] = Number(c.c);
        }
      } catch (err) { console.warn("[admin-payroll-objections] 카운트 조회 실패:", err); }

      return jsonOk({ rows: list, counts, total: list.length });
    } catch (err) { return jsonStepErr("select_objections", err); }
  }

  /* ── 상태 변경 + 회신 ── */
  if (req.method === "PATCH") {
    const id = Number(url.searchParams.get("id") || 0);
    if (!id) return jsonErr("id 필수");

    let body: any = {};
    try { body = await req.json(); } catch { return jsonErr("JSON 본문 필수"); }

    const status = String(body?.status || "");
    if (!VALID_STATUS.includes(status)) {
      return jsonErr("status는 OPEN|IN_REVIEW|RESOLVED|REJECTED 중 하나");
    }
    const note = String(body?.resolutionNote || "").trim();
    const closing = status === "RESOLVED" || status === "REJECTED";
    if (closing && !note) {
      return jsonErr("처리 완료·반려 시에는 직원에게 보낼 회신 내용이 필요합니다");
    }

    let obj: any;
    try {
      const r: any = await db.execute(sql`
        SELECT o.id, o.slip_id, o.member_uid, o.status, s.pay_year, s.pay_month
          FROM payroll_objections o
          LEFT JOIN payroll_slips s ON s.id = o.slip_id
         WHERE o.id = ${id} LIMIT 1
      `);
      obj = rows(r)[0];
      if (!obj) return jsonErr("이의제기를 찾을 수 없습니다", 404);
    } catch (err) { return jsonStepErr("select_objection", err); }

    try {
      await db.execute(sql`
        UPDATE payroll_objections SET
          status = ${status},
          resolution_note = ${note || null},
          resolved_by = ${closing ? String(admin.id) : null},
          resolved_at = ${closing ? sql`NOW()` : sql`NULL`},
          updated_at = NOW()
        WHERE id = ${id}
      `);
    } catch (err) { return jsonStepErr("update_objection", err); }

    /* 이의가 해결되면 명세서를 다시 '수령 확인 대기'로 되돌린다 —
       직원이 정정된 내용을 보고 새로 서명할 수 있게. (반려면 그대로 이의 상태 유지) */
    if (status === "RESOLVED") {
      try {
        await db.execute(sql`
          UPDATE payroll_slips
             SET ack_status = 'PENDING', updated_at = NOW()
           WHERE id = ${Number(obj.slip_id)} AND ack_status = 'OBJECTED'
        `);
      } catch (err) { console.warn("[admin-payroll-objections] 명세서 상태 복귀 실패:", err); }
    }

    /* 직원에게 회신 알림 */
    try {
      const memberId = Number(obj.member_uid);
      if (Number.isFinite(memberId) && closing) {
        const period = `${obj.pay_year}년 ${String(obj.pay_month).padStart(2, "0")}월`;
        await sendWorkspaceNotification({
          memberId,
          sourceType: "event" as any,
          sourceId: Number(obj.slip_id),
          notifType: status === "RESOLVED" ? "approved" : "rejected",
          channel: "bell",
          title: status === "RESOLVED"
            ? `${period} 급여명세 이의제기가 처리되었습니다`
            : `${period} 급여명세 이의제기가 반려되었습니다`,
          body: note.slice(0, 200),
          actionUrl: `/workspace-attendance.html#payroll-slip=${obj.slip_id}`,
          category: "system",
        });
      }
    } catch (err) { console.warn("[admin-payroll-objections] 회신 알림 실패:", err); }

    return jsonOk({ id, status },
      closing ? "처리 결과를 직원에게 전달했습니다" : "상태를 변경했습니다");
  }

  return jsonErr("지원하지 않는 메서드입니다", 405);
}
