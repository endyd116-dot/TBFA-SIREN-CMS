// lib/approval-docs-read.ts — 결재 문서 조회 (2026-11-06)
//
// 문서함, 결재 홈 건수, 문서 상세, 참조 검색, 예산 선택과 진행현황.
// 열람 권한은 서버에서 검사한다(설계도 14쪽). 기안자, 결재선, 참조자만 보고,
// 재정 조회 권한자는 지출결의서를, 이사장은 전체를 본다. 임시저장은 기안자만 본다.
import { sql } from "drizzle-orm";
import { db } from "../db";
import { yearKST } from "./kst";
import { ymd } from "./ledger-post";
import { buildBudgetReport } from "./finance-budget-report";
import { budgetPosition } from "./budget-ledger";
import { activePurgeGrant, cardScope, DEFAULT_GUIDES, DOC_TYPES, type DocActor, EXPENSE_KINDS, INTERNAL_KINDS, loadSettings, PAY_METHODS, purgeProblems, STATUS_LABEL } from "./approval-docs";
import { isPayrollDoc, maskPayroll, payrollBudgetView } from "./payroll-approval";

const rowsOf = (r: any): any[] => r?.rows ?? r ?? [];

export interface ReadScope {
  actor: DocActor;
  /** 재정 조회 권한 */
  finance: boolean;
  /** 재정 기록 권한. 지출완료 확인, 반환 확인, 일반 삭제를 한다 */
  bookkeeping: boolean;
}

const isChair = (s: ReadScope) => s.actor.role === "super_admin";

function visible(s: ReadScope) {
  if (isChair(s)) return sql`(r.status <> 'draft' OR r.drafter_id = ${s.actor.id})`;
  const me = s.actor.id;
  const shared = sql`r.drafter_id = ${me}
    OR EXISTS (SELECT 1 FROM approval_request_steps st WHERE st.request_id = r.id AND st.assignee_id = ${me})
    OR EXISTS (SELECT 1 FROM approval_doc_watchers w WHERE w.request_id = r.id AND w.member_id = ${me})`;
  return s.finance
    ? sql`((r.status <> 'draft' AND r.doc_type = 'expense') OR ${shared})`
    : sql`(${shared})`;
}

/** 지금 내 차례인 문서: 진행중 문서의 현재 단계, 또는 취소 결재의 첫 대기 단계 */
const myApprovalTurn = (me: number) => sql`(r.status = 'pending' AND EXISTS (
  SELECT 1 FROM approval_request_steps st
   WHERE st.request_id = r.id AND st.version = r.version AND st.kind = 'approval'
     AND st.step_index = r.current_step AND st.decision = 'pending' AND st.assignee_id = ${me}))`;
const myCancelTurn = (me: number) => sql`(r.cancel_status = 'requested' AND ${me} = (
  SELECT st.assignee_id FROM approval_request_steps st
   WHERE st.request_id = r.id AND st.kind = 'cancel' AND st.decision = 'pending'
   ORDER BY st.round DESC, st.step_index LIMIT 1))`;

function rowView(r: any) {
  return {
    id: Number(r.id),
    docNo: r.doc_no,
    docType: r.doc_type,
    docLabel: DOC_TYPES[r.doc_type]?.label ?? r.doc_type,
    title: r.title,
    amount: Number(r.amount) || 0,
    status: r.status,
    statusLabel: r.approval_mode === "substituted" && r.status === "approved" ? "승인 갈음" : STATUS_LABEL[r.status] ?? r.status,
    paymentStatus: r.payment_status,
    paymentLabel: r.doc_type !== "expense" ? "해당없음"
      : r.payment_status === "paid" ? "지출완료" : r.payment_status === "unpaid" ? "확인대기" : "-",
    cancelStatus: r.cancel_status,
    refundStatus: r.refund_status,
    deleteStatus: r.delete_status,
    currentAssignee: r.current_assignee ?? null,
    drafterName: r.drafter_name,
    version: Number(r.version) || 1,
    createdAt: r.created_at,
    submittedAt: r.submitted_at,
    resolutionNo: r.resolution_no,
    followupDue: r.followup_due === true || r.followup_due === "t",
  };
}

export interface ListQuery {
  box: string;
  docType?: string | null;
  status?: string | null;
  q?: string | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
  offset?: number;
}

const COLUMNS = sql`r.id, r.doc_no, r.doc_type, r.title, r.amount, r.status, r.approval_mode, r.payment_status, r.cancel_status,
  r.refund_status, r.delete_status, r.drafter_name, r.version, r.created_at, r.submitted_at, r.resolution_no, r.followup_due,
  (SELECT st.assignee_name FROM approval_request_steps st
    WHERE st.request_id = r.id AND st.version = r.version AND st.kind = 'approval' AND st.step_index = r.current_step
      AND st.decision = 'pending' LIMIT 1) AS current_assignee`;

export async function listDocs(s: ReadScope, q: ListQuery) {
  const me = s.actor.id;
  let where = sql`${visible(s)} AND r.delete_status = 'none'`;
  if (q.box === "todo") where = sql`${where} AND (${myApprovalTurn(me)} OR ${myCancelTurn(me)})`;
  else if (q.box === "processed") where = sql`${where} AND EXISTS (SELECT 1 FROM approval_request_steps st WHERE st.request_id = r.id AND st.decided_by = ${me})`;
  else if (q.box === "mine") where = sql`${where} AND r.drafter_id = ${me}`;
  else if (q.box === "reference") where = sql`${where} AND EXISTS (SELECT 1 FROM approval_doc_watchers w WHERE w.request_id = r.id AND w.member_id = ${me})`;
  else if (q.box === "pay") where = sql`r.delete_status = 'none' AND r.doc_type = 'expense' AND r.status = 'approved' AND r.payment_status = 'unpaid'`;
  else if (q.box === "cancel") where = sql`${where} AND r.cancel_status <> 'none'`;
  else if (q.box === "archive") where = sql`r.delete_status = 'deleted'`;
  const canSeeBox = s.bookkeeping || isChair(s) || (q.box === "archive" && !!(await activePurgeGrant(db, me)));
  if ((q.box === "pay" || q.box === "archive") && !canSeeBox) {
    return { items: [], total: 0 };
  }
  if (q.docType && DOC_TYPES[q.docType]) where = sql`${where} AND r.doc_type = ${q.docType}`;
  if (q.status) where = sql`${where} AND r.status = ${q.status}`;
  if (q.q) {
    const like = `%${q.q.slice(0, 80)}%`;
    where = sql`${where} AND (r.title ILIKE ${like} OR r.doc_no ILIKE ${like} OR r.drafter_name ILIKE ${like})`;
  }
  if (q.from) where = sql`${where} AND COALESCE(r.submitted_at, r.created_at) >= ${q.from}::date`;
  if (q.to) where = sql`${where} AND COALESCE(r.submitted_at, r.created_at) < (${q.to}::date + 1)`;

  const total = Number(rowsOf(await db.execute(sql`SELECT COUNT(*)::int AS n FROM approval_requests r WHERE ${where}`))[0]?.n ?? 0);
  const rows = rowsOf(await db.execute(sql`
    SELECT ${COLUMNS} FROM approval_requests r WHERE ${where}
     ORDER BY COALESCE(r.submitted_at, r.created_at) DESC, r.id DESC
     LIMIT ${Math.min(q.limit ?? 50, 200)} OFFSET ${q.offset ?? 0}`));
  return { items: rows.map(rowView), total };
}

/** 결재 홈(설계도 2쪽). 예산 관련 대기 건수는 지출결의서만 센다. */
export async function homeCounts(s: ReadScope) {
  const me = s.actor.id;
  const n = async (where: any) => Number(rowsOf(await db.execute(sql`SELECT COUNT(*)::int AS n FROM approval_requests r WHERE ${where}`))[0]?.n ?? 0);
  const payWait = s.bookkeeping || isChair(s)
    ? await n(sql`r.delete_status = 'none' AND r.doc_type = 'expense' AND r.status = 'approved' AND r.payment_status = 'unpaid'`)
    : 0;
  const counts = {
    waiting: await n(sql`r.delete_status = 'none' AND ${myApprovalTurn(me)}`),
    inProgress: await n(sql`r.delete_status = 'none' AND r.drafter_id = ${me} AND r.status = 'pending'`),
    payWait,
    cancelWait: await n(sql`r.delete_status = 'none' AND ${myCancelTurn(me)}`),
    followup: await n(sql`r.delete_status = 'none' AND r.drafter_id = ${me} AND r.followup_due = TRUE AND r.status = 'approved'`),
  };
  const recent = await listDocs(s, { box: "all", limit: 8 });
  return { counts, recent: recent.items };
}

export async function canViewDoc(s: ReadScope, id: number): Promise<boolean> {
  const r = rowsOf(await db.execute(sql`SELECT 1 FROM approval_requests r WHERE r.id = ${id} AND ${visible(s)}`));
  if (r.length) return true;
  if (s.bookkeeping && rowsOf(await db.execute(sql`
    SELECT 1 FROM approval_requests WHERE id = ${id} AND doc_type = 'expense' AND status <> 'draft'`)).length) return true;
  /* 완전삭제 담당자는 보존함의 문서를 확인할 수 있어야 한다 */
  return !!(await activePurgeGrant(db, s.actor.id)) && rowsOf(await db.execute(sql`
    SELECT 1 FROM approval_requests WHERE id = ${id} AND delete_status = 'deleted'`)).length > 0;
}

export async function docDetail(s: ReadScope, id: number) {
  if (!(await canViewDoc(s, id))) return null;
  const doc = rowsOf(await db.execute(sql`SELECT * FROM approval_requests WHERE id = ${id}`))[0];
  if (!doc) return null;

  const steps = rowsOf(await db.execute(sql`
    SELECT step_index, version, kind, round, step_type, role, decision, assignee_id, assignee_name, assignee_title,
           decided_by_name, comment, decided_at
      FROM approval_request_steps WHERE request_id = ${id}
     ORDER BY kind, version, round, step_index`)).map((r: any) => ({
    stepIndex: Number(r.step_index), version: Number(r.version), kind: r.kind, round: Number(r.round) || 0,
    stepType: r.step_type, decision: r.decision, assigneeId: r.assignee_id == null ? null : Number(r.assignee_id),
    assigneeName: r.assignee_name ?? r.decided_by_name, assigneeTitle: r.assignee_title, comment: r.comment, decidedAt: r.decided_at,
  }));
  const currentSteps = steps.filter((x) => x.kind === "approval" && x.version === Number(doc.version));
  const cancelRound = Math.max(0, ...steps.filter((x) => x.kind === "cancel").map((x) => x.round));
  const cancelSteps = steps.filter((x) => x.kind === "cancel" && x.round === cancelRound);

  const references = rowsOf(await db.execute(sql`
    SELECT x.target_id, x.target_version, x.target_doc_no, x.ref_kind, t.title, t.doc_type, t.status, t.cancel_status, t.delete_status, t.version
      FROM approval_doc_references x JOIN approval_requests t ON t.id = x.target_id
     WHERE x.request_id = ${id} ORDER BY x.id`)).map((r: any) => ({
    id: Number(r.target_id), docNo: r.target_doc_no, refKind: r.ref_kind, title: r.delete_status === "purged" ? "(완전삭제된 문서)" : r.title,
    docLabel: DOC_TYPES[r.doc_type]?.label ?? r.doc_type, linkedVersion: r.target_version == null ? null : Number(r.target_version),
    currentVersion: Number(r.version), status: r.status, statusLabel: STATUS_LABEL[r.status] ?? r.status,
    canceled: r.cancel_status === "approved", deleted: r.delete_status !== "none",
  }));
  const referencedBy = rowsOf(await db.execute(sql`
    SELECT r.id, r.doc_no, r.title, r.doc_type, r.status FROM approval_doc_references x
      JOIN approval_requests r ON r.id = x.request_id WHERE x.target_id = ${id} AND r.delete_status <> 'purged' ORDER BY r.id`)).map((r: any) => ({
    id: Number(r.id), docNo: r.doc_no, title: r.title, docLabel: DOC_TYPES[r.doc_type]?.label ?? r.doc_type, statusLabel: STATUS_LABEL[r.status] ?? r.status,
  }));
  const files = rowsOf(await db.execute(sql`
    SELECT id, version, file_kind, file_name, mime_type, size_bytes, sha256, uploaded_by_name, created_at
      FROM approval_doc_files WHERE request_id = ${id} AND removed_at IS NULL ORDER BY id`)).map((r: any) => ({
    id: Number(r.id), version: Number(r.version), fileKind: r.file_kind, fileName: r.file_name, mimeType: r.mime_type,
    sizeBytes: Number(r.size_bytes) || 0, sha256: r.sha256, uploadedByName: r.uploaded_by_name, createdAt: r.created_at,
  }));
  const watchers = rowsOf(await db.execute(sql`SELECT member_id, member_name, kind FROM approval_doc_watchers WHERE request_id = ${id}`))
    .map((r: any) => ({ memberId: Number(r.member_id), name: r.member_name, kind: r.kind }));
  const comments = rowsOf(await db.execute(sql`
    SELECT id, member_name, body, created_at FROM approval_doc_comments WHERE request_id = ${id} ORDER BY id`))
    .map((r: any) => ({ id: Number(r.id), name: r.member_name, body: r.body, createdAt: r.created_at }));
  const versions = rowsOf(await db.execute(sql`
    SELECT version, content_hash, submitted_at FROM approval_doc_versions WHERE request_id = ${id} ORDER BY version`))
    .map((r: any) => ({ version: Number(r.version), hash: r.content_hash, submittedAt: r.submitted_at }));

  /* 급여 지급 결재: 직원별 금액은 이사장만 보고, 예산은 과목별로 보여 준다 */
  const payroll = isPayrollDoc(doc);
  const payrollBudget = payroll ? await payrollBudgetView(db, doc) : null;

  /* 예산 진행현황: 열람할 때 자기 금액을 다시 빼지 않는다(설계도 6쪽) */
  let budget: any = null;
  if (doc.doc_type === "expense" && doc.budget_account_id && !payroll) {
    const position = await budgetPosition(db, Number(doc.fiscal_year), Number(doc.budget_account_id));
    const amount = Number(doc.amount) || 0;
    const counted = doc.status === "approved" || doc.status === "canceled";
    budget = { ...position, draftAmount: counted ? 0 : amount, expectedAvailable: position.available - (counted ? 0 : amount) };
  }

  let budgetInfo: any = null;
  if (doc.doc_type === "expense") {
    const b = rowsOf(await db.execute(sql`
      SELECT g.name AS gwan_name, h.name AS hang_name, m.name AS mok_name,
             (SELECT name FROM ledger_programs WHERE id = ${doc.program_id}) AS program_name,
             (SELECT name FROM ledger_funds WHERE id = ${doc.fund_id}) AS fund_name
        FROM (SELECT 1) one
        LEFT JOIN budget_accounts m ON m.id = ${doc.budget_account_id}
        LEFT JOIN budget_accounts h ON h.id = m.parent_id
        LEFT JOIN budget_accounts g ON g.id = h.parent_id`))[0];
    budgetInfo = {
      path: [b?.gwan_name, b?.hang_name, b?.mok_name].filter(Boolean).join(" › ") || null,
      programName: b?.program_name ?? null, fundName: b?.fund_name ?? null,
    };
  }

  /* 승인 갈음 문서의 근거 품의가 취소됐는지(설계도 9쪽) */
  let basisCanceled = false;
  if (doc.substitute_basis_id != null) {
    basisCanceled = rowsOf(await db.execute(sql`
      SELECT 1 FROM approval_requests WHERE id = ${doc.substitute_basis_id} AND cancel_status = 'approved'`)).length > 0;
  }
  const followupDue = doc.followup_due === true || doc.followup_due === "t";

  const me = s.actor.id;
  const mine = Number(doc.drafter_id) === me;
  const pendingStep = currentSteps.find((x) => x.stepIndex === Number(doc.current_step) && x.decision === "pending");
  const cancelStep = cancelSteps.find((x) => x.decision === "pending");
  const scope = doc.doc_type === "proposal" && doc.pay_method === "card" ? await cardScope(db, id) : null;
  const purgeGrant = await activePurgeGrant(db, me);
  const actions = {
    edit: mine && ["draft", "rejected", "recalled"].includes(doc.status),
    recall: mine && doc.status === "pending",
    decide: doc.status === "pending" && pendingStep?.assigneeId === me ? pendingStep.stepType : null,
    /* 지급이 끝난 급여 결재는 취소할 수 없다(급여 정정은 급여 관리의 정정 절차) */
    cancelRequest: doc.status === "approved" && doc.cancel_status !== "requested" && (mine || isChair(s))
      && !(payroll && doc.payment_status === "paid"),
    cancelDecide: doc.cancel_status === "requested" && cancelStep?.assigneeId === me ? cancelStep.stepType : null,
    delete: doc.cancel_status === "approved" && doc.delete_status === "none" && (s.bookkeeping || isChair(s)),
    /* 급여 지급 확인은 급여 관리와 같이 이사장만 한다 */
    pay: doc.doc_type === "expense" && doc.status === "approved" && doc.payment_status === "unpaid"
      && doc.cancel_status !== "requested" && (payroll ? isChair(s) : s.bookkeeping || isChair(s)),
    refund: doc.refund_status === "required" && (s.bookkeeping || isChair(s)),
    addFile: doc.status === "approved" && (mine || s.bookkeeping || isChair(s)),
    followup: followupDue && doc.status === "approved" && (mine || isChair(s)),
    cardUse: doc.doc_type === "proposal" && doc.pay_method === "card" && doc.status === "approved"
      && doc.cancel_status !== "requested" && doc.delete_status === "none",
    cardUsage: doc.doc_type === "card" && doc.status === "approved" && doc.delete_status === "none"
      && doc.cancel_status !== "requested" && (mine || s.bookkeeping || isChair(s)),
    purge: doc.delete_status === "deleted" && !!purgeGrant,
  };

  return {
    id: Number(doc.id), docNo: doc.doc_no, docType: doc.doc_type, docLabel: DOC_TYPES[doc.doc_type]?.label ?? doc.doc_type,
    title: doc.title, amount: Number(doc.amount) || 0, body: doc.body, formData: maskPayroll(doc.form_data, isChair(s)), version: Number(doc.version) || 1,
    isPayroll: payroll, payrollBudget,
    status: doc.status, statusLabel: doc.approval_mode === "substituted" && doc.status === "approved" ? "승인 갈음" : STATUS_LABEL[doc.status] ?? doc.status,
    approvalMode: doc.approval_mode, substituteBasisId: doc.substitute_basis_id == null ? null : Number(doc.substitute_basis_id),
    payMethod: doc.pay_method, payMethodLabel: PAY_METHODS[doc.pay_method] ?? null,
    expenseKind: doc.expense_kind, expenseKindLabel: EXPENSE_KINDS[doc.expense_kind] ?? null,
    internalKindLabel: INTERNAL_KINDS[doc.form_data?.kind]?.label ?? null,
    budgetAccountId: doc.budget_account_id == null ? null : Number(doc.budget_account_id),
    budgetSplitId: doc.budget_split_id == null ? null : Number(doc.budget_split_id),
    functionCode: doc.function_code, programId: doc.program_id == null ? null : Number(doc.program_id),
    fundId: doc.fund_id == null ? null : Number(doc.fund_id), fiscalYear: Number(doc.fiscal_year),
    paymentStatus: doc.payment_status, paidAt: doc.paid_at ? ymd(doc.paid_at) : null, paidAmount: doc.paid_amount == null ? null : Number(doc.paid_amount),
    resolutionNo: doc.resolution_no,
    resolutionPdfUrl: doc.resolution_pdf_url,
    cancelStatus: doc.cancel_status, cancelReason: doc.cancel_reason, refundStatus: doc.refund_status,
    deleteStatus: doc.delete_status, deleteReason: doc.delete_reason, holdReason: doc.hold_reason,
    followupDue, basisCanceled, budgetInfo,
    drafterId: Number(doc.drafter_id) || null, drafterName: doc.drafter_name, createdAt: doc.created_at, submittedAt: doc.submitted_at, decidedAt: doc.decided_at,
    steps: currentSteps, cancelSteps, history: steps, references, referencedBy, files, watchers, comments, versions, budget, cardScope: scope,
    purgeProblems: actions.purge ? await purgeProblems(db, doc) : [],
    actions,
  };
}

/** 승인 당시 내용(설계도 13쪽: 누가 어떤 버전을 승인했는지) */
export async function docVersion(s: ReadScope, id: number, version: number) {
  if (!(await canViewDoc(s, id))) return null;
  const r = rowsOf(await db.execute(sql`
    SELECT version, snapshot, content_hash, submitted_at FROM approval_doc_versions WHERE request_id = ${id} AND version = ${version}`))[0];
  if (!r) return null;
  /* 승인 당시 내용에도 직원별 급여가 들어 있다. 이사장이 아니면 합계만 돌려준다 */
  const snapshot = r.snapshot && typeof r.snapshot === "object"
    ? { ...r.snapshot, formData: maskPayroll(r.snapshot.formData, isChair(s)) } : r.snapshot;
  return { version: Number(r.version), snapshot, hash: r.content_hash, submittedAt: r.submitted_at };
}

/** 참조 검색. 열람 가능한 문서만, 완료 문서를 먼저 보여 준다(설계도 8쪽). */
export async function searchDocs(s: ReadScope, q: string, docType: string | null, excludeId: number, from?: string | null, to?: string | null) {
  const like = `%${q.slice(0, 80)}%`;
  let where = sql`${visible(s)} AND r.delete_status = 'none' AND r.id <> ${excludeId} AND r.status <> 'draft'`;
  if (q) where = sql`${where} AND (r.title ILIKE ${like} OR r.doc_no ILIKE ${like} OR r.drafter_name ILIKE ${like})`;
  if (docType && DOC_TYPES[docType]) where = sql`${where} AND r.doc_type = ${docType}`;
  if (from) where = sql`${where} AND COALESCE(r.submitted_at, r.created_at) >= ${from}::date`;
  if (to) where = sql`${where} AND COALESCE(r.submitted_at, r.created_at) < (${to}::date + 1)`;
  const rows = rowsOf(await db.execute(sql`
    SELECT ${COLUMNS} FROM approval_requests r WHERE ${where}
     ORDER BY (r.status = 'approved') DESC, r.id DESC LIMIT 30`));
  return rows.map(rowView);
}

/** 작성 화면의 예산 선택. 나눈 예산이 있으면 그 단위로 고른다(설계도 8·10쪽). */
export async function budgetChoices(yearInput?: number) {
  const year = yearInput || yearKST();
  const plan = rowsOf(await db.execute(sql`SELECT id FROM budget_plans WHERE fiscal_year = ${year} AND status = 'approved' LIMIT 1`))[0];
  const paths = new Map<number, { path: string; code: string }>();
  for (const r of rowsOf(await db.execute(sql`
    SELECT mok.id, mok.code, mok.name, hang.name AS hang_name, gwan.name AS gwan_name
      FROM budget_accounts mok
      LEFT JOIN budget_accounts hang ON hang.id = mok.parent_id
      LEFT JOIN budget_accounts gwan ON gwan.id = hang.parent_id
     WHERE mok.level = '목' AND mok.is_active = TRUE
     ORDER BY mok.sort_order, mok.code`))) {
    paths.set(Number(r.id), { path: [r.gwan_name, r.hang_name, r.name].filter(Boolean).join(" › "), code: r.code });
  }
  if (!plan) {
    return {
      year, hasPlan: false,
      options: [...paths.entries()].map(([id, p]) => ({
        key: `m${id}`, label: p.path, code: p.code, budgetAccountId: id, splitId: null,
        functionCode: null, programId: null, fundId: null, programName: null, fundName: null, locked: false,
        planned: 0, executed: 0, reserved: 0, remaining: 0, available: 0,
      })),
    };
  }
  const report = await buildBudgetReport(Number(plan.id), year);
  const splits = rowsOf(await db.execute(sql`
    SELECT s.id, s.line_id, s.function_code, s.program_id, s.fund_id, s.amount, p.name AS program_name, f.name AS fund_name
      FROM budget_line_splits s
      JOIN budget_lines l ON l.id = s.line_id
      LEFT JOIN ledger_programs p ON p.id = s.program_id
      LEFT JOIN ledger_funds f ON f.id = s.fund_id
     WHERE l.plan_id = ${Number(plan.id)} ORDER BY s.id`));
  const options: any[] = [];
  for (const item of report.items) {
    if (item.budgetAccountId == null) continue;
    const p = paths.get(item.budgetAccountId);
    const base = {
      code: p?.code ?? "", budgetAccountId: item.budgetAccountId, planned: item.plannedAmount, executed: item.executedAmount,
      reserved: item.reserved, remaining: item.remaining, available: item.available,
    };
    const own = splits.filter((x: any) => Number(x.line_id) === item.id);
    if (!own.length) {
      options.push({ ...base, key: `m${item.budgetAccountId}`, label: p?.path ?? item.categoryName, splitId: null, functionCode: null, programId: null, fundId: null, programName: null, fundName: null, locked: false });
      continue;
    }
    for (const x of own) {
      options.push({
        ...base, key: `s${x.id}`, label: [p?.path ?? item.categoryName, x.program_name, x.fund_name].filter(Boolean).join(" · "),
        splitId: Number(x.id), functionCode: x.function_code, programId: x.program_id == null ? null : Number(x.program_id),
        fundId: x.fund_id == null ? null : Number(x.fund_id), programName: x.program_name, fundName: x.fund_name, locked: true, splitAmount: Number(x.amount) || 0,
      });
    }
  }
  return { year, hasPlan: true, options };
}

/** 예산 진행현황: 선택 예산의 문서(설계도 6쪽) */
export async function budgetProgress(s: ReadScope, year: number, budgetAccountId: number) {
  const position = await budgetPosition(db, year, budgetAccountId);
  const rows = rowsOf(await db.execute(sql`
    SELECT ${COLUMNS} FROM approval_requests r
     WHERE r.doc_type = 'expense' AND r.fiscal_year = ${year}
       AND (r.budget_account_id = ${budgetAccountId}
            /* 급여 지급 결재는 여러 과목에 걸친다(기본급·상여금) */
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(
                 CASE WHEN jsonb_typeof(r.form_data->'payroll'->'budget') = 'array' THEN r.form_data->'payroll'->'budget' ELSE '[]'::jsonb END) AS b(value)
                WHERE (b.value->>'budgetAccountId')::int = ${budgetAccountId}))
       AND r.status <> 'draft' AND r.delete_status <> 'purged' AND ${visible(s)}
     ORDER BY r.id DESC LIMIT 200`));
  return {
    position,
    rate: position.planned > 0 ? Math.round((position.executed / position.planned) * 1000) / 10 : null,
    documents: rows.map(rowView),
  };
}

export async function loadPeople() {
  return rowsOf(await db.execute(sql`
    SELECT id, name, role, position FROM members
     WHERE type = 'admin' AND status = 'active' ORDER BY name`))
    .map((r: any) => ({ id: Number(r.id), name: r.name, role: r.role, title: r.position ?? null }));
}

/** 금액별 추천 결재선. 채워 줄 뿐 기안자가 바꿀 수 있다(로드맵 §6-4). */
export async function recommendLine(amount: number, drafterId: number) {
  const line = rowsOf(await db.execute(sql`
    SELECT name, steps FROM approval_lines
     WHERE is_active = TRUE AND min_amount <= ${amount} AND (max_amount IS NULL OR ${amount} <= max_amount)
     ORDER BY sort_order, min_amount LIMIT 1`))[0];
  if (!line) return { name: null, steps: [] as any[] };
  const chief = (p: { title: string | null }) => (String(p.title ?? "").includes("사무국장") ? 0 : 1);
  const people = (await loadPeople()).sort((a, b) => chief(a) - chief(b));
  const steps: any[] = [];
  for (const role of Array.isArray(line.steps) ? line.steps : []) {
    const person = people.find((p) => p.role === role && p.id !== drafterId && !steps.some((x) => x.memberId === p.id));
    if (person) steps.push({ type: "approve", memberId: person.id, name: person.name, title: person.title });
  }
  return { name: line.name, steps };
}

export async function loadSavedLines(ownerId: number) {
  return rowsOf(await db.execute(sql`
    SELECT id, owner_id, name, steps FROM approval_saved_lines
     WHERE owner_id IS NULL OR owner_id = ${ownerId} ORDER BY name`))
    .map((r: any) => ({ id: Number(r.id), name: r.name, shared: r.owner_id == null, steps: r.steps ?? [] }));
}

export async function loadGuides() {
  const rows = rowsOf(await db.execute(sql`
    SELECT DISTINCT ON (doc_type) doc_type, version, guide FROM approval_form_guides ORDER BY doc_type, version DESC`));
  const saved = Object.fromEntries(rows.map((r: any) => [r.doc_type, { version: Number(r.version), guide: r.guide }]));
  const defaults = Object.fromEntries(Object.entries(DEFAULT_GUIDES).map(([k, guide]) => [k, { version: 0, guide }]));
  return { ...defaults, ...saved };
}

export async function loadPurgeGrants() {
  return rowsOf(await db.execute(sql`
    SELECT id, member_id, member_name, granted_by_name, start_on, end_on, reason, revoked_at, revoked_by_name, created_at
      FROM approval_purge_grants ORDER BY id DESC LIMIT 100`)).map((r: any) => ({
    id: Number(r.id), memberId: Number(r.member_id), memberName: r.member_name, grantedByName: r.granted_by_name,
    startOn: ymd(r.start_on), endOn: ymd(r.end_on), reason: r.reason, revokedAt: r.revoked_at, revokedByName: r.revoked_by_name,
  }));
}

export { loadSettings };
