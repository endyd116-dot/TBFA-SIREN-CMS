/**
 * POST /api/admin-approval-decide — 지출 결재 승인/반려
 * body: { requestId, decision: 'approve'|'reject', comment? }
 *
 * 3계층 직책: operator(기안)/admin(국장·1차)/super_admin(이사장·최종).
 * - 현재 단계 직책을 승인 권한 있는 사람만 결재(super_admin 전권·위임 반영).
 * - 마지막 단계 승인 시: 지출(expenses) 생성·예산 목에 집행 물림 + 지출결의서 정식번호 발행.
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";
import { createNotification, notifyMany } from "../../lib/notify";
import { generateResolutionPDF } from "../../lib/pdf-resolution";
import { uploadToR2 } from "../../lib/r2-server";

export const config = { path: "/api/admin-approval-decide" };

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "결재 처리 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}
function bad(msg: string, status = 400) {
  return new Response(JSON.stringify({ ok: false, error: msg }),
    { status, headers: { "Content-Type": "application/json" } });
}
async function rowsOf(q: any): Promise<any[]> { return q?.rows ?? q ?? []; }

/* 현재 단계 직책 R을 이 관리자가 결재할 수 있는가 */
async function canDecide(role: string, memberId: number, stepRole: string): Promise<boolean> {
  if (role === "super_admin") return true;          // 이사장 전권
  if (role === stepRole) return true;               // 국장은 admin 단계
  // 위임(전결·대결): 오늘 유효한 위임이 있으면 해당 직책 결재 가능
  const del: any = await db.execute(sql`
    SELECT 1 FROM approval_delegations
     WHERE is_active = TRUE AND delegate_role = ${stepRole} AND to_member_id = ${memberId}
       AND (NOW() AT TIME ZONE 'Asia/Seoul')::date BETWEEN start_at AND end_at
     LIMIT 1
  `);
  return (await rowsOf(del)).length > 0;
}

export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "POST") return bad("POST 메서드만 허용", 405);

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  const me = auth.ctx.member;
  const myId = auth.ctx.admin.uid;

  let body: any;
  try { body = await req.json(); } catch { body = {}; }
  const requestId = Number(body.requestId);
  const decision = String(body.decision || "");
  const comment = body.comment ? String(body.comment).slice(0, 1000) : null;
  if (!requestId || (decision !== "approve" && decision !== "reject")) {
    return bad("requestId·decision('approve'|'reject') 필수");
  }

  // 요청 로드
  let r: any;
  try {
    const rows = await rowsOf(await db.execute(sql`
      SELECT id, title, amount, status, steps, current_step, board_required,
             budget_account_id, fiscal_year, occurred_at, payee_name, description,
             evidence_url, drafter_id, drafter_name, resolution_no
        FROM approval_requests WHERE id = ${requestId} LIMIT 1
    `));
    r = rows[0];
  } catch (err: any) { return jsonError("select_request", err); }
  if (!r) return bad("결재 요청을 찾을 수 없습니다", 404);
  if (r.status !== "pending") return bad(`이미 처리된 결재입니다 (상태: ${r.status})`, 409);

  const steps: string[] = Array.isArray(r.steps) ? r.steps : [];
  const curIdx = Number(r.current_step) || 0;
  const stepRole = steps[curIdx];
  if (!stepRole) return jsonError("step", new Error("결재 단계 정보 오류"));

  // 권한 확인
  try {
    if (!(await canDecide(me.role ?? "", myId, stepRole))) {
      return bad("이 단계를 결재할 권한이 없습니다", 403);
    }
  } catch (err: any) { return jsonError("check_perm", err); }

  const nowSql = sql`NOW()`;

  // 단계 이력 기록
  try {
    await db.execute(sql`
      UPDATE approval_request_steps
         SET decision = ${decision === "approve" ? "approved" : "rejected"},
             decided_by = ${myId}, decided_by_name = ${me.name ?? null},
             comment = ${comment}, decided_at = ${nowSql}
       WHERE request_id = ${requestId} AND step_index = ${curIdx}
    `);
  } catch (err: any) { return jsonError("update_step", err); }

  /* ── 반려 ── */
  if (decision === "reject") {
    try {
      await db.execute(sql`
        UPDATE approval_requests SET status = 'rejected', decided_at = ${nowSql}, updated_at = ${nowSql}
         WHERE id = ${requestId}
      `);
      if (r.drafter_id) {
        await createNotification({
          recipientId: Number(r.drafter_id), recipientType: "operator",
          category: "system", severity: "warning",
          title: "지출 결재 반려",
          message: `"${r.title}" 지출 결재가 반려됐어요.${comment ? " 사유: " + comment : ""}`,
          link: "/cms-tbfa.html#approval-drafts", refTable: "approval_requests", refId: requestId,
        });
      }
    } catch (err: any) { return jsonError("reject", err); }
    return new Response(JSON.stringify({ ok: true, data: { status: "rejected" } }),
      { headers: { "Content-Type": "application/json" } });
  }

  /* ── 승인 ── */
  const isFinal = curIdx >= steps.length - 1;

  if (!isFinal) {
    // 다음 단계로 진행 + 다음 결재자 알림
    try {
      const nextIdx = curIdx + 1;
      await db.execute(sql`
        UPDATE approval_requests SET current_step = ${nextIdx}, updated_at = ${nowSql}
         WHERE id = ${requestId}
      `);
      const nextRole = steps[nextIdx];
      const approvers = await rowsOf(await db.execute(sql`
        SELECT id FROM members
         WHERE type = 'admin' AND operator_active = TRUE AND status = 'active'
           AND role IN (${nextRole}, 'super_admin')
      `));
      const ids = approvers.map((a: any) => Number(a.id));
      if (ids.length) {
        await notifyMany(ids, {
          recipientType: "operator", category: "system", severity: "warning",
          title: "지출 결재 차례",
          message: `${r.drafter_name || "기안자"}님의 ${Number(r.amount).toLocaleString()}원 지출 결재가 다음 결재를 기다려요. "${r.title}"`,
          link: "/cms-tbfa.html#approval-inbox", refTable: "approval_requests", refId: requestId,
        });
      }
    } catch (err: any) { return jsonError("advance", err); }
    return new Response(JSON.stringify({ ok: true, data: { status: "pending", advancedTo: curIdx + 1 } }),
      { headers: { "Content-Type": "application/json" } });
  }

  /* ── 최종 승인: 지출 생성(예산 목 물림) + 지출결의서 정식번호 발행 ── */
  let expenseId: number | null = null;
  let resolutionNo: string | null = null;
  try {
    // 1) 지출 생성 (승인 상태로) — budget_account_id로 예산 목에 집행 물림
    const exRows = await rowsOf(await db.execute(sql`
      INSERT INTO expenses
        (fiscal_year, occurred_at, category_id, budget_account_id, amount, payee_name,
         description, receipt_url, status, recorded_by, recorded_at, approved_by, approved_at)
      VALUES
        (${Number(r.fiscal_year)}, COALESCE(${r.occurred_at}, (NOW() AT TIME ZONE 'Asia/Seoul')::date), NULL,
         ${r.budget_account_id}, ${Number(r.amount)}, ${r.payee_name ?? null},
         ${r.title}, ${r.evidence_url ?? null}, 'approved', ${r.drafter_id ?? null}, ${nowSql},
         ${myId}, ${nowSql})
      RETURNING id
    `));
    expenseId = exRows[0] ? Number(exRows[0].id) : null;

    // 2) 지출결의서 정식번호 발행 (제YYYY-NNNN호)
    const seqRows = await rowsOf(await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM approval_requests
       WHERE fiscal_year = ${Number(r.fiscal_year)} AND resolution_no IS NOT NULL
    `));
    const seq = (Number(seqRows[0]?.n) || 0) + 1;
    resolutionNo = `제${r.fiscal_year}-${String(seq).padStart(4, "0")}호`;

    // 3) 요청 확정
    await db.execute(sql`
      UPDATE approval_requests
         SET status = 'approved', decided_at = ${nowSql}, updated_at = ${nowSql},
             expense_id = ${expenseId}, resolution_no = ${resolutionNo}, resolution_issued_at = ${nowSql}
       WHERE id = ${requestId}
    `);

    // 4) 지출결의서 PDF 생성 → R2 박제 (실패해도 승인·결의번호는 유효)
    try {
      const stepHist = await rowsOf(await db.execute(sql`
        SELECT role, decided_by_name, decided_at FROM approval_request_steps
         WHERE request_id = ${requestId} ORDER BY step_index
      `));
      let budgetPath = "";
      if (r.budget_account_id) {
        const bp = await rowsOf(await db.execute(sql`
          SELECT gwan.name AS g, hang.name AS h, mok.name AS m
            FROM budget_accounts mok
            LEFT JOIN budget_accounts hang ON hang.id = mok.parent_id
            LEFT JOIN budget_accounts gwan ON gwan.id = hang.parent_id
           WHERE mok.id = ${r.budget_account_id} LIMIT 1
        `));
        if (bp[0]) budgetPath = [bp[0].g, bp[0].h, bp[0].m].filter(Boolean).join(" > ");
      }
      const RL: any = { operator: "담당자", admin: "국장", super_admin: "이사장" };
      const pdfSteps = [{ roleLabel: "기안", name: r.drafter_name || "", date: "" }].concat(
        (stepHist as any[]).map((s) => ({ roleLabel: RL[s.role] || s.role, name: s.decided_by_name || "", date: s.decided_at || "" }))
      );
      const pdfBytes = await generateResolutionPDF({
        resolutionNo: resolutionNo!, title: r.title, amount: Number(r.amount), budgetPath,
        payeeName: r.payee_name, occurredAt: r.occurred_at, description: r.description,
        drafterName: r.drafter_name, steps: pdfSteps,
      });
      const up = await uploadToR2({
        buffer: pdfBytes, originalName: `resolution_${resolutionNo}.pdf`,
        mimeType: "application/pdf", context: "approval_resolution",
        uploadedByAdmin: myId, isPublic: false,
      });
      if (up.ok && up.url) {
        await db.execute(sql`UPDATE approval_requests SET resolution_pdf_url = ${up.url} WHERE id = ${requestId}`);
      }
    } catch (e) { console.warn("[approval-decide] 결의서 PDF 실패(무시):", e); }

    // 5) 기안자 알림 (최종 승인 + 결의번호)
    if (r.drafter_id) {
      await createNotification({
        recipientId: Number(r.drafter_id), recipientType: "operator",
        category: "system", severity: "info",
        title: "지출 결재 승인 완료",
        message: `"${r.title}" 지출이 최종 승인됐어요. 지출결의서 ${resolutionNo} 발행 완료.`,
        link: "/cms-tbfa.html#approval-resolutions", refTable: "approval_requests", refId: requestId,
      });
    }
  } catch (err: any) { return jsonError("final_approve", err); }

  return new Response(JSON.stringify({
    ok: true,
    data: { status: "approved", expenseId, resolutionNo },
  }), { headers: { "Content-Type": "application/json" } });
}
