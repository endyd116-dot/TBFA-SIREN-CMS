import { isoUTC, jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-approval-requests" };

/* =========================================================
   지출 결재 요청 목록·상세 조회 API — GET
   - ?id=N        단건 상세 (+ 예산과목 경로 + 단계 이력)
   - ?box=inbox   내가 지금 결재할 차례인 pending 목록
   - ?box=drafts  내가 올린 기안
   - ?box=all     전체(기본, ?status= 필터)
   ========================================================= */

function jsonError(step: string, err: any) {
  return new Response(jsonKST({
    ok: false, error: "지출 결재 목록 조회 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

function rowsOf(res: any): any[] {
  return (res?.rows ?? res ?? []) as any[];
}

/* jsonb steps[current_step]의 role 안전 추출 */
function currentStepRole(steps: any, currentStep: number): string | null {
  if (!Array.isArray(steps)) return null;
  const idx = Number(currentStep) || 0;
  const v = steps[idx];
  return v == null ? null : String(v);
}

/* 내 role이 해당 단계 role을 결재할 수 있는가 */
function canApprove(myRole: string, stepRole: string | null): boolean {
  if (!stepRole) return false;
  if (myRole === "super_admin") return true;   // super_admin은 모든 단계 결재 가능
  return myRole === stepRole;
}

export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "GET") {
    return new Response(jsonKST({ ok: false, error: "GET 메서드만 허용" }),
      { status: 405, headers: { "Content-Type": "application/json" } });
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  const myId = auth.ctx.admin.uid;
  const myRole = String(auth.ctx.member.role || "");

  let url: URL;
  try { url = new URL(req.url); } catch (err: any) { return jsonError("parse_url", err); }

  const idParam = url.searchParams.get("id");
  if (idParam != null && idParam !== "") {
    return handleDetail(Number(idParam));
  }

  const box = url.searchParams.get("box") || "all";
  const statusFilter = url.searchParams.get("status");
  return handleList(box, statusFilter, myId, myRole);
}

/* =========================================================
   단건 상세
   ========================================================= */
async function handleDetail(id: number) {
  if (!Number.isFinite(id)) {
    return new Response(jsonKST({ ok: false, error: "id가 올바르지 않습니다" }),
      { status: 400, headers: { "Content-Type": "application/json" } });
  }

  // 1) 요청 본문 + 예산 목 이름 (목 조인만)
  let reqRow: any;
  try {
    const res: any = await db.execute(sql`
      SELECT
        ar.id, ar.request_no, ar.title, ar.amount, ar.description,
        ar.budget_account_id, ar.fiscal_year, ar.occurred_at, ar.payee_name,
        ar.evidence_url, ar.drafter_id, ar.drafter_name, ar.approval_line_id,
        ar.board_required, ar.steps, ar.current_step, ar.status, ar.expense_id,
        ar.resolution_no, ar.resolution_pdf_url, ar.resolution_issued_at,
        ar.created_at, ar.updated_at, ar.decided_at,
        ba.name AS budget_account_name, ba.parent_id AS budget_parent_id
      FROM approval_requests ar
      LEFT JOIN budget_accounts ba ON ba.id = ar.budget_account_id
      WHERE ar.id = ${id}
      LIMIT 1
    `);
    reqRow = rowsOf(res)[0];
    if (!reqRow) {
      return new Response(jsonKST({ ok: false, error: "결재 요청을 찾을 수 없습니다" }),
        { status: 404, headers: { "Content-Type": "application/json" } });
    }
  } catch (err: any) { return jsonError("select_request", err); }

  // 2) 예산과목 경로 '관>항>목' (목→항→관 상향 조회)
  let budgetPath: string | null = null;
  try {
    if (reqRow.budget_account_id != null) {
      const chain: string[] = [];
      let cursor: number | null = Number(reqRow.budget_account_id);
      for (let hop = 0; hop < 5 && cursor != null; hop++) {
        const r: any = await db.execute(sql`
          SELECT name, parent_id FROM budget_accounts WHERE id = ${cursor} LIMIT 1
        `);
        const row = rowsOf(r)[0];
        if (!row) break;
        chain.push(String(row.name));
        cursor = row.parent_id == null ? null : Number(row.parent_id);
      }
      // chain은 목→항→관 순 → 뒤집어 관>항>목
      budgetPath = chain.reverse().join(">");
    }
  } catch (err: any) {
    console.warn("[admin-approval-requests] 예산 경로 조회 실패(무시):", err?.message);
  }

  // 3) 단계 이력
  let steps: any[] = [];
  try {
    const res: any = await db.execute(sql`
      SELECT id, request_id, step_index, role, decision, decided_by,
             decided_by_name, comment, decided_at
      FROM approval_request_steps
      WHERE request_id = ${id}
      ORDER BY step_index ASC
    `);
    steps = rowsOf(res).map((s: any) => ({
      id:            Number(s.id),
      requestId:     Number(s.request_id),
      stepIndex:     Number(s.step_index),
      role:          s.role,
      decision:      s.decision,
      decidedBy:     s.decided_by == null ? null : Number(s.decided_by),
      decidedByName: s.decided_by_name,
      comment:       s.comment,
      decidedAt:     isoUTC(s.decided_at),
    }));
  } catch (err: any) { return jsonError("select_steps", err); }

  const request = {
    id:                Number(reqRow.id),
    requestNo:         reqRow.request_no,
    title:             reqRow.title,
    amount:            Number(reqRow.amount),
    description:       reqRow.description,
    budgetAccountId:   reqRow.budget_account_id == null ? null : Number(reqRow.budget_account_id),
    budgetAccountName: reqRow.budget_account_name || null,
    fiscalYear:        Number(reqRow.fiscal_year),
    occurredAt:        isoUTC(reqRow.occurred_at),
    payeeName:         reqRow.payee_name,
    evidenceUrl:       reqRow.evidence_url,
    drafterId:         reqRow.drafter_id == null ? null : Number(reqRow.drafter_id),
    drafterName:       reqRow.drafter_name,
    approvalLineId:    reqRow.approval_line_id == null ? null : Number(reqRow.approval_line_id),
    boardRequired:     reqRow.board_required === true || reqRow.board_required === "t",
    steps:             Array.isArray(reqRow.steps) ? reqRow.steps : [],
    currentStep:       Number(reqRow.current_step) || 0,
    status:            reqRow.status,
    expenseId:         reqRow.expense_id == null ? null : Number(reqRow.expense_id),
    resolutionNo:      reqRow.resolution_no,
    resolutionPdfUrl:  reqRow.resolution_pdf_url,
    resolutionIssuedAt: isoUTC(reqRow.resolution_issued_at),
    createdAt:         isoUTC(reqRow.created_at),
    updatedAt:         isoUTC(reqRow.updated_at),
    decidedAt:         isoUTC(reqRow.decided_at),
  };

  return new Response(jsonKST({
    ok: true,
    data: { request, steps, budgetPath },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

/* =========================================================
   목록 (inbox / drafts / all)
   ========================================================= */
async function handleList(box: string, statusFilter: string | null, myId: number, myRole: string) {
  // box별 WHERE 절 (목록은 approval_request_steps 조인 없이 approval_requests + 목 이름만)
  let whereSql;
  if (box === "drafts") {
    whereSql = sql`WHERE ar.drafter_id = ${myId}`;
  } else if (box === "inbox") {
    // pending 전체를 가져와 JS에서 현재 단계 role 판정 (jsonb[current_step])
    whereSql = sql`WHERE ar.status = 'pending'`;
  } else {
    // all — status 필터 옵션
    if (statusFilter && statusFilter.trim() !== "") {
      whereSql = sql`WHERE ar.status = ${statusFilter.trim()}`;
    } else {
      whereSql = sql`WHERE TRUE`;
    }
  }

  let rows: any[];
  try {
    const res: any = await db.execute(sql`
      SELECT
        ar.id, ar.request_no, ar.title, ar.amount, ar.status,
        ar.current_step, ar.steps, ar.board_required, ar.drafter_name,
        ar.fiscal_year, ar.occurred_at, ar.resolution_no, ar.resolution_pdf_url, ar.created_at,
        ar.budget_account_id, ba.name AS budget_account_name
      FROM approval_requests ar
      LEFT JOIN budget_accounts ba ON ba.id = ar.budget_account_id
      ${whereSql}
      ORDER BY ar.created_at DESC
      LIMIT 200
    `);
    rows = rowsOf(res);
  } catch (err: any) { return jsonError("select_list", err); }

  let mapped = rows.map((r: any) => {
    const stepsArr = Array.isArray(r.steps) ? r.steps : [];
    const curStep = Number(r.current_step) || 0;
    return {
      id:                Number(r.id),
      requestNo:         r.request_no,
      title:             r.title,
      amount:            Number(r.amount),
      status:            r.status,
      currentStep:       curStep,
      steps:             stepsArr,
      boardRequired:     r.board_required === true || r.board_required === "t",
      drafterName:       r.drafter_name,
      budgetAccountId:   r.budget_account_id == null ? null : Number(r.budget_account_id),
      budgetAccountName: r.budget_account_name || null,
      fiscalYear:        Number(r.fiscal_year),
      occurredAt:        isoUTC(r.occurred_at),
      resolutionNo:      r.resolution_no,
      resolutionPdfUrl:  r.resolution_pdf_url || null,
      createdAt:         isoUTC(r.created_at),
      _stepRole:         currentStepRole(stepsArr, curStep),
    };
  });

  // inbox: 현재 단계 role이 내 role로 결재 가능한 것만
  if (box === "inbox") {
    mapped = mapped.filter((m) => canApprove(myRole, m._stepRole));
  }

  const items = mapped.map(({ _stepRole, ...rest }) => rest);

  return new Response(jsonKST({
    ok: true,
    data: { box, items, total: items.length },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}
