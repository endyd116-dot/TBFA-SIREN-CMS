/**
 * POST /api/admin-approval-decide — 지출 결재 승인/반려
 * body: { requestId, decision: 'approve'|'reject', comment?, expectedStep? }
 *
 * 3계층 직책: operator(기안)/admin(국장·1차)/super_admin(이사장·최종).
 * - 현재 단계 직책을 승인 권한 있는 사람만 결재(super_admin 전권·위임 반영).
 * - 마지막 단계 승인 시: 예산을 잠그고 사용가능액을 다시 계산한 뒤 미지급 상태로 예약하고 지출결의서를 발행한다.
 *   지출은 지급 확인 때 만든다. 승인된 예산안이 없는 연도는 사용가능액을 판단할 수 없어 검사를 건너뛴다(설계도 10·14쪽).
 * - (2026-11-06 이전 동작) 마지막 단계 승인 시: 지출(expenses) 생성·예산 목에 집행 물림 + 지출결의서 정식번호 발행.
 *
 * 2026-11-06: 상태 확인부터 지출 생성·번호 발행까지 한 트랜잭션으로 묶었다.
 * - 요청 행을 잠가 동시 클릭이 지출을 두 번 만들지 못하게 한다.
 * - expectedStep이 있으면 화면이 본 단계와 현재 단계가 같을 때만 처리한다
 *   (이사장의 중복 클릭이 다음 단계까지 넘겨 버리는 것을 막는다).
 * - 결의번호는 연도별 잠금 안에서 MAX+1로 발급한다.
 * - DB 연결이 1개라 트랜잭션 안에서는 tx만 쓰고, 알림·PDF는 커밋 뒤에 처리한다.
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";
import { createNotification, notifyMany } from "../../lib/notify";
import { buildAndStoreResolutionPdf } from "../../lib/resolution-pdf-store";
import { budgetPosition, lockBudget, recordBudgetLedger } from "../../lib/budget-ledger";

export const config = { path: "/api/admin-approval-decide" };

function jsonError(step: string, err: any) {
  return new Response(jsonKST({
    ok: false, error: "결재 처리 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}
function bad(msg: string, status = 400) {
  return new Response(jsonKST({ ok: false, error: msg }),
    { status, headers: { "Content-Type": "application/json" } });
}
function rowsOf(q: any): any[] { return q?.rows ?? q ?? []; }

/** 트랜잭션을 되돌리고 사용자에게 안내할 때 쓴다 */
class DecideStop extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

/* 현재 단계 직책 R을 이 관리자가 결재할 수 있는가 */
async function canDecide(tx: any, role: string, memberId: number, stepRole: string): Promise<boolean> {
  if (role === "super_admin") return true;          // 이사장 전권
  if (role === stepRole) return true;               // 국장은 admin 단계
  // 위임(전결·대결): 오늘 유효한 위임이 있으면 해당 직책 결재 가능
  const del: any = await tx.execute(sql`
    SELECT 1 FROM approval_delegations
     WHERE is_active = TRUE AND delegate_role = ${stepRole} AND to_member_id = ${memberId}
       AND (NOW() AT TIME ZONE 'Asia/Seoul')::date BETWEEN start_at AND end_at
     LIMIT 1
  `);
  return rowsOf(del).length > 0;
}

/* 제YYYY-NNNN호 발급. 호출한 트랜잭션이 끝날 때까지 같은 연도 발급을 직렬화한다. */
async function nextResolutionNo(tx: any, fiscalYear: number): Promise<string> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"approval-resolution:" + fiscalYear}))`);
  const res: any = await tx.execute(sql`
    SELECT COALESCE(MAX(CAST(SUBSTRING(resolution_no FROM '-([0-9]+)호') AS INTEGER)), 0) AS maxn
      FROM approval_requests
     WHERE fiscal_year = ${fiscalYear} AND resolution_no IS NOT NULL
  `);
  const seq = (Number(rowsOf(res)[0]?.maxn) || 0) + 1;
  return `제${fiscalYear}-${String(seq).padStart(4, "0")}호`;
}

type Outcome =
  | { kind: "rejected"; r: any }
  | { kind: "advanced"; r: any; nextIdx: number; nextRole: string }
  | { kind: "approved"; r: any; expenseId: number | null; resolutionNo: string };

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
  const expectedStep = body.expectedStep == null ? null : Number(body.expectedStep);
  if (!requestId || (decision !== "approve" && decision !== "reject")) {
    return bad("requestId·decision('approve'|'reject') 필수");
  }

  let outcome: Outcome;
  try {
    outcome = await db.transaction(async (tx): Promise<Outcome> => {
      const rows = rowsOf(await tx.execute(sql`
        SELECT id, title, amount, status, steps, current_step, board_required,
               budget_account_id, fiscal_year, occurred_at, payee_name, description,
               evidence_url, drafter_id, drafter_name, resolution_no, created_at
          FROM approval_requests WHERE id = ${requestId} FOR UPDATE
      `));
      const r = rows[0];
      if (!r) throw new DecideStop("결재 요청을 찾을 수 없습니다", 404);
      if (r.status !== "pending") throw new DecideStop(`이미 처리된 결재입니다 (상태: ${r.status})`, 409);

      const steps: string[] = Array.isArray(r.steps) ? r.steps : [];
      const curIdx = Number(r.current_step) || 0;
      const stepRole = steps[curIdx];
      if (!stepRole) throw new Error("결재 단계 정보 오류");
      if (expectedStep !== null && expectedStep !== curIdx) {
        throw new DecideStop("이미 다음 단계로 넘어간 결재입니다. 목록을 새로고침해 주세요", 409);
      }
      if (!(await canDecide(tx, me.role ?? "", myId, stepRole))) {
        throw new DecideStop("이 단계를 결재할 권한이 없습니다", 403);
      }

      // 단계 이력 기록
      await tx.execute(sql`
        UPDATE approval_request_steps
           SET decision = ${decision === "approve" ? "approved" : "rejected"},
               decided_by = ${myId}, decided_by_name = ${me.name ?? null},
               comment = ${comment}, decided_at = NOW()
         WHERE request_id = ${requestId} AND step_index = ${curIdx}
      `);

      /* ── 반려 ── */
      if (decision === "reject") {
        await tx.execute(sql`
          UPDATE approval_requests SET status = 'rejected', decided_at = NOW(), updated_at = NOW()
           WHERE id = ${requestId}
        `);
        return { kind: "rejected", r };
      }

      /* ── 승인: 다음 단계로 ── */
      if (curIdx < steps.length - 1) {
        const nextIdx = curIdx + 1;
        await tx.execute(sql`
          UPDATE approval_requests SET current_step = ${nextIdx}, updated_at = NOW()
           WHERE id = ${requestId}
        `);
        return { kind: "advanced", r, nextIdx, nextRole: steps[nextIdx] };
      }

      /* ── 최종 승인: 지출결의서 번호 발행. 지출은 지급 확인 때 만든다(승인 = 예약) ── */
      const expenseId: number | null = null;
      const year = Number(r.fiscal_year);
      const budgetAccountId = r.budget_account_id == null ? null : Number(r.budget_account_id);
      const amount = Number(r.amount);
      await lockBudget(tx, year, budgetAccountId);
      const position = await budgetPosition(tx, year, budgetAccountId);
      if (position.hasPlan && amount > position.available) {
        throw new DecideStop(
          `예산 사용가능액을 넘어 승인할 수 없습니다. 사용가능액 ${position.available.toLocaleString("ko-KR")}원, 결재 금액 ${amount.toLocaleString("ko-KR")}원`,
          422,
        );
      }
      const resolutionNo = await nextResolutionNo(tx, year);
      await tx.execute(sql`
        UPDATE approval_requests
           SET status = 'approved', decided_at = NOW(), updated_at = NOW(),
               payment_status = 'unpaid', resolution_no = ${resolutionNo}, resolution_issued_at = NOW()
         WHERE id = ${requestId}
      `);
      await recordBudgetLedger(tx, {
        year, budgetAccountId, documentId: requestId, documentNo: resolutionNo, type: "reserve", amount,
        before: position, actor: { id: myId, name: me.name ?? "" }, key: `reserve:approval:${requestId}`,
      });
      return { kind: "approved", r, expenseId, resolutionNo };
    });
  } catch (err: any) {
    if (err instanceof DecideStop) return bad(err.message, err.status);
    return jsonError("transaction", err);
  }

  /* ── 커밋 뒤 처리: 실패해도 결재 결과는 유효 ── */
  const r = outcome.r;

  if (outcome.kind === "rejected") {
    try {
      if (r.drafter_id) {
        await createNotification({
          recipientId: Number(r.drafter_id), recipientType: "operator",
          category: "system", severity: "warning",
          title: "지출 결재 반려",
          message: `"${r.title}" 지출 결재가 반려됐어요.${comment ? " 사유: " + comment : ""}`,
          link: "/cms-tbfa.html#approval-drafts", refTable: "approval_requests", refId: requestId,
        });
      }
    } catch (e) { console.warn("[approval-decide] 반려 알림 실패(무시):", e); }
    return new Response(jsonKST({ ok: true, data: { status: "rejected" } }),
      { headers: { "Content-Type": "application/json" } });
  }

  if (outcome.kind === "advanced") {
    try {
      const approvers = rowsOf(await db.execute(sql`
        SELECT id FROM members
         WHERE type = 'admin' AND operator_active = TRUE AND status = 'active'
           AND role IN (${outcome.nextRole}, 'super_admin')
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
    } catch (e) { console.warn("[approval-decide] 다음 단계 알림 실패(무시):", e); }
    return new Response(jsonKST({ ok: true, data: { status: "pending", advancedTo: outcome.nextIdx } }),
      { headers: { "Content-Type": "application/json" } });
  }

  // 지출결의서 PDF 생성 → R2 박제 (실패해도 승인·결의번호는 유효)
  // 생성 로직은 재발행과 공용(lib/resolution-pdf-store) — 두 경로가 항상 동일하게.
  try {
    await buildAndStoreResolutionPdf(requestId, myId);
  } catch (e) { console.warn("[approval-decide] 결의서 PDF 실패(무시):", e); }

  try {
    if (r.drafter_id) {
      await createNotification({
        recipientId: Number(r.drafter_id), recipientType: "operator",
        category: "system", severity: "info",
        title: "지출 결재 승인 완료",
        message: `"${r.title}" 지출이 최종 승인됐어요. 지출결의서 ${outcome.resolutionNo} 발행 완료.`,
        link: "/cms-tbfa.html#approval-resolutions", refTable: "approval_requests", refId: requestId,
      });
    }
  } catch (e) { console.warn("[approval-decide] 승인 알림 실패(무시):", e); }

  return new Response(jsonKST({
    ok: true,
    data: { status: "approved", expenseId: outcome.expenseId, resolutionNo: outcome.resolutionNo },
  }), { headers: { "Content-Type": "application/json" } });
}
