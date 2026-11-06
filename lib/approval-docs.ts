// lib/approval-docs.ts — 공통 결재 문서 (2026-11-06)
//
// 설계: docs/active/2026-11-06-approval-docs-design.md (원문 쪽 번호 대조표 있음)
// 5개 문서를 approval_requests 한 표로 다룬다. 돈 처리는 3단계 공용 처리를 그대로 쓴다.
// 결재는 지정된 담당자 본인만 순서대로 한다. 대리·전결·병렬합의는 없다(설계도 4·7쪽).
// 상신하면 그 버전을 고정하고, 고치려면 회수 후 새 버전으로 처음부터 승인받는다.
// 연결 1개 환경이라 트랜잭션 안에서는 tx만 쓰고, 알림·PDF는 커밋 뒤에 처리한다.
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { todayKST, yearKST } from "./kst";
import { LedgerError, recordHistory, ymd } from "./ledger-post";
import { budgetPosition, lockBudget, recordBudgetLedger, type BudgetPosition } from "./budget-ledger";

const rowsOf = (r: any): any[] => r?.rows ?? r ?? [];

export const DOC_TYPES: Record<string, { label: string; prefix: string }> = {
  internal: { label: "내부결재", prefix: "내부" },
  proposal: { label: "품의서", prefix: "품의" },
  expense: { label: "지출결의서", prefix: "지출" },
  card: { label: "법인카드 사용신청서", prefix: "카드" },
  seal: { label: "법인인감 사용승인 신청서", prefix: "인감" },
};
export const STATUS_LABEL: Record<string, string> = {
  draft: "임시저장", pending: "진행중", approved: "완료", rejected: "반려", recalled: "회수", canceled: "취소",
};
/** 내부결재 구분. leave는 근태 휴가와 연결한다(설계도 4쪽, 로드맵 §6-4) */
export const INTERNAL_KINDS: Record<string, { label: string; leave: boolean }> = {
  annual: { label: "연차", leave: true },
  sick: { label: "병가", leave: true },
  family: { label: "경조사", leave: true },
  welfare: { label: "복리후생", leave: false },
  trip: { label: "출장", leave: false },
  outside: { label: "외근", leave: false },
  etc: { label: "기타", leave: false },
};
export const PAY_METHODS: Record<string, string> = { card: "카드결제", transfer: "계좌이체", other: "기타", none: "지출 없음" };
export const EXPENSE_KINDS: Record<string, string> = {
  general: "일반 지출", urgent: "긴급 지출", fixed_personnel: "고정 인건비", fixed_cost: "월 고정경비",
};
export const FILE_KINDS: Record<string, string> = {
  attachment: "첨부", payment: "지급증빙", proposal: "품의 근거", seal_target: "날인 대상", additional: "추가증빙",
};

export interface DocActor {
  id: number;
  name: string;
  role: string;
}

export interface LineStep {
  type: "approve" | "consult";
  memberId: number;
  name: string;
  title: string | null;
}

export interface DocSettings {
  cardRuleEffectiveOn: string | null;
  cardRuleNote: string | null;
  retentionYears: number | null;
  requireProposal: boolean;
  /** 이 금액 미만의 일반 지출은 사전 품의 없이 상신할 수 있다. 0이면 전부 필요 */
  proposalMinAmount: number;
  /** 사업수행 비율 참고 기준(%). 법령 기준은 세무 확인 뒤 정한다 */
  publicRatioTarget: number;
}

export async function loadSettings(exec: { execute: (q: any) => Promise<any> } = db): Promise<DocSettings> {
  const r = rowsOf(await exec.execute(sql`
    SELECT card_rule_effective_on, card_rule_note, retention_years, require_proposal, proposal_min_amount, public_ratio_target FROM approval_settings WHERE id = 1`))[0];
  return {
    cardRuleEffectiveOn: r?.card_rule_effective_on ? ymd(r.card_rule_effective_on) : null,
    cardRuleNote: r?.card_rule_note ?? null,
    retentionYears: r?.retention_years == null ? null : Number(r.retention_years),
    requireProposal: r ? r.require_proposal === true || r.require_proposal === "t" : true,
    proposalMinAmount: Number(r?.proposal_min_amount) || 0,
    publicRatioTarget: r?.public_ratio_target == null ? 80 : Number(r.public_ratio_target),
  };
}

/** 본문은 굵게·밑줄·목록만 허용한다. 속성은 전부 지워 스크립트가 실릴 수 없게 한다. */
const ALLOWED_TAGS = new Set(["b", "strong", "u", "i", "em", "ul", "ol", "li", "p", "br", "div"]);
export function sanitizeBody(html: unknown): string {
  return String(html ?? "")
    .slice(0, 50000)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/?([a-zA-Z0-9]+)(?:\s[^>]*)?\/?>/g, (m, tag) => {
      const name = String(tag).toLowerCase();
      if (!ALLOWED_TAGS.has(name)) return "";
      return m.startsWith("</") ? `</${name}>` : `<${name}>`;
    });
}
const plainBody = (html: string | null) => String(html ?? "").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();

const text = (v: unknown, max: number): string | null => {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, max) : null;
};
const money = (v: unknown): number => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** 문서번호. 표에서 발급해 취소·삭제 뒤에도 다시 쓰지 않는다(설계도 7쪽). */
export async function nextDocNo(tx: any, docType: string, year: number): Promise<string> {
  const r = rowsOf(await tx.execute(sql`
    INSERT INTO approval_doc_sequences (doc_type, year, last_no) VALUES (${docType}, ${year}, 1)
    ON CONFLICT (doc_type, year) DO UPDATE SET last_no = approval_doc_sequences.last_no + 1
    RETURNING last_no`))[0];
  return `${DOC_TYPES[docType].prefix}-${year}-${String(r.last_no).padStart(4, "0")}`;
}

/* 제YYYY-NNNN호. 호출한 트랜잭션이 끝날 때까지 같은 연도 발급을 직렬화한다 */
async function nextResolutionNo(tx: any, fiscalYear: number): Promise<string> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"approval-resolution:" + fiscalYear}))`);
  const res: any = await tx.execute(sql`
    SELECT COALESCE(MAX(CAST(SUBSTRING(resolution_no FROM '-([0-9]+)호') AS INTEGER)), 0) AS maxn
      FROM approval_requests WHERE fiscal_year = ${fiscalYear} AND resolution_no IS NOT NULL`);
  return `제${fiscalYear}-${String((Number(rowsOf(res)[0]?.maxn) || 0) + 1).padStart(4, "0")}호`;
}

/** 지출내역 합계. 공급가액 + 부가세(설계도 5쪽) */
function expenseTotal(items: any[]): number {
  return (Array.isArray(items) ? items : []).reduce((t, i) => t + money(i?.supply) + money(i?.vat), 0);
}

export interface DraftInput {
  id?: number;
  docType: string;
  title?: string;
  body?: string;
  formData?: any;
  payMethod?: string;
  expenseKind?: string;
  budgetAccountId?: number | null;
  budgetSplitId?: number | null;
  budgetYear?: number | null;
  functionCode?: string | null;
  programId?: number | null;
  fundId?: number | null;
  references?: { targetId: number; refKind?: string }[];
  watchers?: number[];
  line?: LineStep[];
}

function amountOf(docType: string, form: any): number {
  if (docType === "expense") return expenseTotal(form?.items);
  if (docType === "proposal") return (Array.isArray(form?.budgetRows) ? form.budgetRows : []).reduce((t: number, r: any) => t + money(r?.amount), 0);
  if (docType === "card") return money(form?.plannedAmount);
  return 0;
}

/** 선택 예산에서 활동·사업·재원을 가져온다. 나눈 예산이 있으면 입력값을 쓰지 않는다(설계도 8쪽). */
async function resolveBudget(tx: any, input: DraftInput) {
  const splitId = Number(input.budgetSplitId) || null;
  if (splitId) {
    const s = rowsOf(await tx.execute(sql`
      SELECT s.id, s.function_code, s.program_id, s.fund_id, l.budget_account_id, p.fiscal_year
        FROM budget_line_splits s
        JOIN budget_lines l ON l.id = s.line_id
        JOIN budget_plans p ON p.id = l.plan_id
       WHERE s.id = ${splitId}`))[0];
    if (!s) throw new LedgerError("선택한 예산을 찾을 수 없습니다", 404);
    return {
      budgetAccountId: Number(s.budget_account_id), budgetSplitId: splitId, fiscalYear: Number(s.fiscal_year),
      functionCode: s.function_code, programId: s.program_id == null ? null : Number(s.program_id),
      fundId: s.fund_id == null ? null : Number(s.fund_id), locked: true,
    };
  }
  return {
    budgetAccountId: Number(input.budgetAccountId) || null, budgetSplitId: null,
    fiscalYear: Number(input.budgetYear) || yearKST(),
    functionCode: ["service", "admin", "fundraising"].includes(String(input.functionCode)) ? String(input.functionCode) : null,
    programId: input.functionCode === "service" ? Number(input.programId) || null : null,
    fundId: Number(input.fundId) || null, locked: false,
  };
}

async function replaceReferences(tx: any, id: number, refs: DraftInput["references"], actor: DocActor) {
  await tx.execute(sql`DELETE FROM approval_doc_references WHERE request_id = ${id}`);
  const seen = new Set<number>();
  for (const r of refs ?? []) {
    const targetId = Number(r?.targetId) || 0;
    if (!targetId || targetId === id || seen.has(targetId)) continue;
    seen.add(targetId);
    const t = rowsOf(await tx.execute(sql`SELECT version, doc_no FROM approval_requests WHERE id = ${targetId}`))[0];
    if (!t) continue;
    await tx.execute(sql`
      INSERT INTO approval_doc_references (request_id, target_id, target_version, target_doc_no, ref_kind, created_by)
      VALUES (${id}, ${targetId}, ${Number(t.version) || 1}, ${t.doc_no}, ${r?.refKind === "basis" ? "basis" : "related"}, ${actor.id})`);
  }
}

async function replaceWatchers(tx: any, id: number, ids: number[] | undefined) {
  await tx.execute(sql`DELETE FROM approval_doc_watchers WHERE request_id = ${id} AND kind = 'reference'`);
  for (const memberId of [...new Set((ids ?? []).map(Number).filter(Boolean))]) {
    const m = rowsOf(await tx.execute(sql`SELECT name FROM members WHERE id = ${memberId}`))[0];
    if (!m) continue;
    await tx.execute(sql`
      INSERT INTO approval_doc_watchers (request_id, member_id, member_name, kind) VALUES (${id}, ${memberId}, ${m.name}, 'reference')
      ON CONFLICT (request_id, member_id) DO NOTHING`);
  }
}

/** 임시저장. 반려·회수된 문서는 같은 번호로 고쳐 다시 올린다. */
export async function saveDraft(actor: DocActor, input: DraftInput) {
  const docType = String(input.docType ?? "");
  if (!DOC_TYPES[docType]) throw new LedgerError("문서 유형을 고르세요", 400);
  const form = input.formData && typeof input.formData === "object" ? { ...input.formData } : {};
  if (Array.isArray(input.line)) form.line = input.line;

  return db.transaction(async (tx: any) => {
    const budget = docType === "expense" ? await resolveBudget(tx, input) : null;
    const title = text(input.title, 200) ?? "(제목 없음)";
    const amount = amountOf(docType, form);
    const body = sanitizeBody(input.body);
    const payMethod = PAY_METHODS[String(input.payMethod)] ? String(input.payMethod) : null;
    const expenseKind = docType === "expense" && EXPENSE_KINDS[String(input.expenseKind)] ? String(input.expenseKind) : null;
    const occurredAt = text(form.payDate, 10);
    const payeeName = docType === "expense"
      ? text([...new Set((form.items ?? []).map((i: any) => String(i?.payee ?? "").trim()).filter(Boolean))].join(", "), 200)
      : null;
    const fiscalYear = budget?.fiscalYear ?? yearKST();
    const formJson = JSON.stringify(form);

    let id = Number(input.id) || 0;
    if (id) {
      const cur = rowsOf(await tx.execute(sql`SELECT drafter_id, status FROM approval_requests WHERE id = ${id} FOR UPDATE`))[0];
      if (!cur) throw new LedgerError("문서를 찾을 수 없습니다", 404);
      if (Number(cur.drafter_id) !== actor.id) throw new LedgerError("본인이 쓴 문서만 고칠 수 있습니다", 403);
      if (!["draft", "rejected", "recalled"].includes(cur.status)) throw new LedgerError("상신한 문서는 회수한 뒤 고칠 수 있습니다.");
      await tx.execute(sql`
        UPDATE approval_requests
           SET title = ${title}, amount = ${amount}, body = ${body}, form_data = ${formJson}::jsonb,
               pay_method = ${payMethod}, expense_kind = ${expenseKind}, budget_account_id = ${budget?.budgetAccountId ?? null},
               budget_split_id = ${budget?.budgetSplitId ?? null}, function_code = ${budget?.functionCode ?? null},
               program_id = ${budget?.programId ?? null}, fund_id = ${budget?.fundId ?? null}, fiscal_year = ${fiscalYear},
               occurred_at = ${occurredAt}, payee_name = ${payeeName}, updated_at = NOW()
         WHERE id = ${id}`);
    } else {
      const row = rowsOf(await tx.execute(sql`
        INSERT INTO approval_requests
          (doc_type, title, amount, body, form_data, pay_method, expense_kind, budget_account_id, budget_split_id,
           function_code, program_id, fund_id, fiscal_year, occurred_at, payee_name, drafter_id, drafter_name, status, steps, created_at, updated_at)
        VALUES
          (${docType}, ${title}, ${amount}, ${body}, ${formJson}::jsonb, ${payMethod}, ${expenseKind}, ${budget?.budgetAccountId ?? null},
           ${budget?.budgetSplitId ?? null}, ${budget?.functionCode ?? null}, ${budget?.programId ?? null}, ${budget?.fundId ?? null},
           ${fiscalYear}, ${occurredAt}, ${payeeName}, ${actor.id}, ${actor.name}, 'draft', '[]'::jsonb, NOW(), NOW())
        RETURNING id`))[0];
      id = Number(row.id);
    }
    if (input.references) await replaceReferences(tx, id, input.references, actor);
    if (input.watchers) await replaceWatchers(tx, id, input.watchers);
    return { id };
  });
}

async function activeMembers(tx: any, ids: number[]) {
  if (!ids.length) return new Map<number, any>();
  const rows = rowsOf(await tx.execute(sql`
    SELECT id, name, role FROM members
     WHERE id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
       AND type = 'admin' AND status = 'active'`));
  return new Map(rows.map((r: any) => [Number(r.id), r]));
}

/** 결재선 기본 유효성. 전결 한도는 계산하지 않는다(설계도 14쪽). */
async function validateLine(tx: any, doc: any, line: any[], actor: DocActor): Promise<LineStep[]> {
  const steps: LineStep[] = (Array.isArray(line) ? line : []).map((s: any) => ({
    type: s?.type === "consult" ? "consult" : "approve",
    memberId: Number(s?.memberId) || 0, name: String(s?.name ?? ""), title: s?.title ? String(s.title).slice(0, 100) : null,
  }));
  if (!steps.length) throw new LedgerError("결재선을 지정하세요.");
  if (steps[steps.length - 1].type !== "approve") throw new LedgerError("마지막 단계는 결재로 지정해야 합니다.");
  const members = await activeMembers(tx, steps.map((s) => s.memberId));
  const seen = new Set<number>();
  for (const s of steps) {
    const m = members.get(s.memberId);
    if (!m) throw new LedgerError(`결재선 담당자를 찾을 수 없습니다: ${s.name || s.memberId}`);
    if (seen.has(s.memberId)) throw new LedgerError(`같은 담당자가 두 번 들어 있습니다: ${m.name}`);
    seen.add(s.memberId);
    if (s.memberId === actor.id && actor.role !== "super_admin") throw new LedgerError("본인을 결재선에 넣을 수 없습니다.");
    s.name = m.name;
  }
  return steps;
}

async function fileCount(tx: any, id: number, kinds: string[]): Promise<number> {
  return Number(rowsOf(await tx.execute(sql`
    SELECT COUNT(*)::int AS n FROM approval_doc_files
     WHERE request_id = ${id} AND removed_at IS NULL
       AND file_kind IN (${sql.join(kinds.map((k) => sql`${k}`), sql`, `)})`))[0]?.n ?? 0);
}

async function approvedBasis(tx: any, id: number): Promise<any[]> {
  return rowsOf(await tx.execute(sql`
    SELECT t.id, t.doc_type, t.doc_no, t.status, t.cancel_status, t.delete_status, t.amount, t.pay_method, r.ref_kind
      FROM approval_doc_references r
      JOIN approval_requests t ON t.id = r.target_id
     WHERE r.request_id = ${id}`));
}
const validProposal = (t: any) => t.doc_type === "proposal" && t.status === "approved" && t.cancel_status !== "requested" && t.delete_status === "none";

/** 사전 품의 근거(설계도 8쪽). 참조할 수 있다고 근거가 되는 것은 아니다. */
async function checkBasis(tx: any, doc: any, form: any, settings: DocSettings): Promise<{ missing: string[]; followup: boolean }> {
  const missing: string[] = [];
  let followup = false;
  const refs = await approvedBasis(tx, doc.id);
  const hasProposal = refs.some(validProposal);
  const anyBasis = refs.some((t) => t.status === "approved" && t.delete_status === "none");
  const kind = doc.expense_kind;
  if (!kind) missing.push("지출 구분");
  if (!settings.requireProposal) return { missing, followup };
  if (kind === "general") {
    const small = settings.proposalMinAmount > 0 && Number(doc.amount) < settings.proposalMinAmount;
    if (!small && !hasProposal && !(await fileCount(tx, doc.id, ["proposal"]))) {
      missing.push("승인된 사전 품의서를 참조하거나 품의 근거를 첨부하세요");
    }
  } else if (kind === "urgent") {
    if (!text(form.urgentReason, 500)) missing.push("사전 품의가 불가능했던 사유");
    if (!hasProposal) followup = true;
  } else if (kind === "fixed_personnel" || kind === "fixed_cost") {
    if (!anyBasis && !(await fileCount(tx, doc.id, ["proposal"]))) {
      missing.push(kind === "fixed_personnel" ? "근로계약·급여조건 근거" : "사전 승인된 정기비용 근거");
    }
  }
  return { missing, followup };
}

/** 상신 유효성(설계도 14쪽) */
async function validateSubmit(tx: any, doc: any, form: any, settings: DocSettings) {
  const missing: string[] = [];
  if (!text(doc.title, 200) || doc.title === "(제목 없음)") missing.push("제목");

  if (doc.doc_type === "expense") {
    const items = Array.isArray(form.items) ? form.items : [];
    if (!items.length || !Number(doc.amount)) missing.push("지출내역");
    if (items.some((i: any) => !text(i?.payee, 200))) missing.push("지출내역의 지급처");
    if (!doc.budget_account_id) missing.push("예산");
    if (!doc.pay_method) missing.push("지급방법");
    if (!(await fileCount(tx, doc.id, ["payment"]))) missing.push("지급증빙");
    if (!doc.budget_split_id) {
      if (!doc.function_code) missing.push("활동");
      if (!doc.fund_id) missing.push("재원");
      if (doc.function_code === "service" && !doc.program_id) missing.push("사업");
    }
    const basis = await checkBasis(tx, doc, form, settings);
    missing.push(...basis.missing);
    return { missing, followup: basis.followup };
  }
  if (doc.doc_type === "proposal") {
    if (!plainBody(doc.body)) missing.push("품의 내용");
    if (!doc.pay_method) missing.push("지출 방식");
    if (!text(form.periodFrom, 10)) missing.push("시행기간");
  }
  if (doc.doc_type === "internal") {
    const kind = INTERNAL_KINDS[String(form.kind)];
    if (!kind) missing.push("신청 구분");
    if (!text(form.periodFrom, 10) || !text(form.periodTo, 10)) missing.push("신청기간");
    if (!plainBody(doc.body)) missing.push("신청 내용");
    if (kind?.leave && !Number(form.leaveTypeId)) missing.push("휴가 종류");
  }
  if (doc.doc_type === "card") {
    if (!text(form.usePurpose, 300)) missing.push("사용 목적");
    if (!Number(doc.amount)) missing.push("예정금액");
    if (!text(form.periodFrom, 10)) missing.push("사용 기간");
    if (!text(form.cardLabel, 100)) missing.push("카드 식별정보");
  }
  if (doc.doc_type === "seal") {
    if (!text(form.sealType, 50)) missing.push("인감 종류");
    if (!text(form.usePurpose, 300)) missing.push("사용 목적");
    if (!text(form.submitTo, 200)) missing.push("제출처");
    if (!text(form.useDate, 10)) missing.push("사용일");
    if (!text(form.sealTarget, 300)) missing.push("날인 대상");
  }
  return { missing, followup: false };
}

/** 품의서에서 카드로 쓴 누계와 남은 승인범위(설계도 9쪽) */
export async function cardScope(exec: any, proposalId: number, excludeId = 0) {
  const r = rowsOf(await exec.execute(sql`
    SELECT COALESCE(SUM(amount), 0)::bigint AS used
      FROM approval_requests
     WHERE doc_type = 'card' AND substitute_basis_id = ${proposalId} AND id <> ${excludeId}
       AND status = 'approved' AND delete_status = 'none'`))[0];
  const p = rowsOf(await exec.execute(sql`SELECT amount FROM approval_requests WHERE id = ${proposalId}`))[0];
  const approved = Number(p?.amount) || 0;
  const used = Number(r?.used) || 0;
  return { approved, used, remaining: approved - used };
}

/** 승인 갈음 가능 여부. 가능하면 근거 문서를 돌려주고, 안 되면 이유를 던진다. */
async function substitutionBasis(tx: any, doc: any, form: any, settings: DocSettings): Promise<any> {
  const refs = await approvedBasis(tx, doc.id);
  const basisId = Number(form.basisId) || 0;
  const basis = refs.find((t) => Number(t.id) === basisId);
  if (!basis) throw new LedgerError("승인 갈음의 근거 품의를 연결하세요.");
  if (!validProposal(basis)) throw new LedgerError("근거 품의가 승인 상태가 아니거나 취소가 진행 중이라 승인 갈음을 할 수 없습니다.");
  if (doc.doc_type === "card") {
    if (!settings.cardRuleEffectiveOn) throw new LedgerError("카드 승인 갈음은 규정 시행일을 정한 뒤 쓸 수 있습니다. 결재선으로 상신하세요.");
    if (todayKST() < settings.cardRuleEffectiveOn) throw new LedgerError(`규정 시행일(${settings.cardRuleEffectiveOn}) 전이라 결재선으로 상신해야 합니다.`);
    if (basis.pay_method !== "card") throw new LedgerError("지급방법이 카드결제인 품의만 승인 갈음을 할 수 있습니다.");
    const scope = await cardScope(tx, basisId, doc.id);
    if (Number(doc.amount) > scope.remaining) {
      throw new LedgerError(`승인 범위를 넘어 승인 갈음을 할 수 없습니다. 남은 범위 ${scope.remaining.toLocaleString("ko-KR")}원`);
    }
  } else if (!(await fileCount(tx, basisId, ["seal_target"]))) {
    throw new LedgerError("날인 대상이 첨부된 품의만 승인 갈음을 할 수 있습니다.");
  }
  return basis;
}

async function snapshotOf(tx: any, id: number) {
  const doc = rowsOf(await tx.execute(sql`SELECT * FROM approval_requests WHERE id = ${id}`))[0];
  const refs = rowsOf(await tx.execute(sql`
    SELECT target_id, target_version, target_doc_no, ref_kind FROM approval_doc_references WHERE request_id = ${id} ORDER BY id`));
  const files = rowsOf(await tx.execute(sql`
    SELECT id, file_kind, file_name, sha256, size_bytes FROM approval_doc_files WHERE request_id = ${id} AND removed_at IS NULL ORDER BY id`));
  return {
    title: doc.title, amount: Number(doc.amount), body: doc.body, formData: doc.form_data, payMethod: doc.pay_method,
    expenseKind: doc.expense_kind, budgetAccountId: doc.budget_account_id, budgetSplitId: doc.budget_split_id,
    functionCode: doc.function_code, programId: doc.program_id, fundId: doc.fund_id, fiscalYear: doc.fiscal_year,
    references: refs, files,
  };
}

export interface LeaveBridge {
  create: (memberUid: string, form: any) => Promise<number>;
  decide: (leaveId: number, action: "APPROVED" | "REJECTED" | "CANCELLED", reviewerId: number, note: string | null) => Promise<void>;
  withdraw: (leaveId: number) => Promise<void>;
}

/** 상신. 번호 발급, 버전 고정, 결재선 고정을 한 트랜잭션으로 묶는다. */
export async function submitDoc(actor: DocActor, id: number, leave: LeaveBridge) {
  const settings = await loadSettings();

  /* 휴가는 근태 쪽 검사(잔여일·겹침)를 먼저 통과해야 한다. 근태 처리는 트랜잭션 밖이다 */
  const pre = rowsOf(await db.execute(sql`
    SELECT doc_type, form_data, status, att_leave_request_id, drafter_id FROM approval_requests WHERE id = ${id}`))[0];
  if (!pre) throw new LedgerError("문서를 찾을 수 없습니다", 404);
  const preKind = pre.doc_type === "internal" ? INTERNAL_KINDS[String(pre.form_data?.kind)] : null;
  let leaveId: number | null = null;
  if (preKind?.leave && Number(pre.drafter_id) === actor.id && ["draft", "rejected", "recalled"].includes(pre.status)) {
    leaveId = await leave.create(String(actor.id), pre.form_data);
  }

  try {
    return await db.transaction(async (tx: any) => {
      const doc = rowsOf(await tx.execute(sql`SELECT * FROM approval_requests WHERE id = ${id} FOR UPDATE`))[0];
      if (!doc) throw new LedgerError("문서를 찾을 수 없습니다", 404);
      if (Number(doc.drafter_id) !== actor.id) throw new LedgerError("본인이 쓴 문서만 상신할 수 있습니다", 403);
      if (!["draft", "rejected", "recalled"].includes(doc.status)) throw new LedgerError("이미 상신한 문서입니다.");
      const form = doc.form_data ?? {};
      const { missing, followup } = await validateSubmit(tx, doc, form, settings);
      if (missing.length) throw new LedgerError("상신하려면 다음 항목이 필요합니다.", 422, missing);

      /* 재상신은 새 버전으로 처음부터(설계도 7쪽). 번호는 그대로다 */
      const first = !doc.doc_no;
      const version = first ? 1 : Number(doc.version) + 1;
      const docNo: string = doc.doc_no ?? await nextDocNo(tx, doc.doc_type, yearKST());
      const substitute = form.substitute === true && (doc.doc_type === "card" || doc.doc_type === "seal");

      if (substitute) {
        const basis = await substitutionBasis(tx, doc, form, settings);
        await tx.execute(sql`
          UPDATE approval_requests
             SET doc_no = ${docNo}, request_no = ${docNo}, version = ${version}, status = 'approved', approval_mode = 'substituted',
                 substitute_basis_id = ${Number(basis.id)}, submitted_at = NOW(), decided_at = NOW(), current_step = 0, updated_at = NOW()
           WHERE id = ${id}`);
      } else {
        const steps = await validateLine(tx, doc, form.line, actor);
        const members = await activeMembers(tx, steps.map((s) => s.memberId));
        const roles = steps.map((s) => members.get(s.memberId)?.role ?? "admin");
        await tx.execute(sql`
          UPDATE approval_requests
             SET doc_no = ${docNo}, request_no = ${docNo}, version = ${version}, status = 'pending', approval_mode = 'line',
                 substitute_basis_id = NULL, steps = ${JSON.stringify(roles)}::jsonb, current_step = 0,
                 submitted_at = NOW(), decided_at = NULL, followup_due = ${followup},
                 att_leave_request_id = ${leaveId}, updated_at = NOW()
           WHERE id = ${id}`);
        for (let i = 0; i < steps.length; i += 1) {
          const s = steps[i];
          await tx.execute(sql`
            INSERT INTO approval_request_steps
              (request_id, step_index, role, decision, version, kind, step_type, assignee_id, assignee_name, assignee_title)
            VALUES (${id}, ${i}, ${roles[i]}, 'pending', ${version}, 'approval', ${s.type}, ${s.memberId}, ${s.name}, ${s.title})`);
        }
      }

      const snapshot = await snapshotOf(tx, id);
      const json = JSON.stringify({ ...snapshot, line: form.line ?? [] });
      await tx.execute(sql`
        INSERT INTO approval_doc_versions (request_id, version, snapshot, content_hash, submitted_by)
        VALUES (${id}, ${version}, ${json}::jsonb, ${createHash("sha256").update(json).digest("hex")}, ${actor.id})`);
      await recordHistory(tx, {
        entity: "approval", entityId: id, action: substitute ? "substituted" : "submitted", actor,
        after: { docNo, version, docType: doc.doc_type },
      });
      const firstAssignee = substitute ? null : Number(form.line?.[0]?.memberId) || null;
      return { id, docNo, version, status: substitute ? "approved" : "pending", title: doc.title, firstAssignee, drafterName: doc.drafter_name };
    });
  } catch (err) {
    /* 문서가 상신되지 않았으면 근태 대기 건도 남기지 않는다 */
    if (leaveId) {
      try { await leave.withdraw(leaveId); } catch (e: any) { console.warn("[docs] 휴가 대기 건 정리 실패:", e?.message); }
    }
    throw err;
  }
}

/** 상신취소·회수. 아무도 처리하지 않았으면 임시저장으로, 일부 처리됐으면 회수로 돌린다. */
export async function recallDoc(actor: DocActor, id: number) {
  return db.transaction(async (tx: any) => {
    const doc = rowsOf(await tx.execute(sql`SELECT * FROM approval_requests WHERE id = ${id} FOR UPDATE`))[0];
    if (!doc) throw new LedgerError("문서를 찾을 수 없습니다", 404);
    if (Number(doc.drafter_id) !== actor.id) throw new LedgerError("기안자만 회수할 수 있습니다", 403);
    if (doc.status !== "pending") throw new LedgerError("진행중인 문서만 회수할 수 있습니다.");
    const decided = Number(rowsOf(await tx.execute(sql`
      SELECT COUNT(*)::int AS n FROM approval_request_steps
       WHERE request_id = ${id} AND version = ${doc.version} AND kind = 'approval' AND decision = 'approved'`))[0]?.n ?? 0);
    const status = decided ? "recalled" : "draft";
    await tx.execute(sql`
      UPDATE approval_request_steps SET decision = 'canceled'
       WHERE request_id = ${id} AND version = ${doc.version} AND kind = 'approval' AND decision = 'pending'`);
    await tx.execute(sql`
      UPDATE approval_requests SET status = ${status}, att_leave_request_id = NULL, updated_at = NOW() WHERE id = ${id}`);
    await recordHistory(tx, { entity: "approval", entityId: id, action: "recalled", actor, after: { status, version: doc.version } });
    return { status, leaveId: doc.att_leave_request_id == null ? null : Number(doc.att_leave_request_id) };
  });
}

export type DecideOutcome =
  | { kind: "rejected"; doc: any }
  | { kind: "advanced"; doc: any; nextAssignee: number | null }
  | { kind: "approved"; doc: any; resolutionNo: string | null };

/** 지출결의서 최종 승인: 예산을 잠그고 다시 계산한 뒤 예약한다(설계도 10·14쪽). */
async function finalizeExpense(tx: any, doc: any, actor: DocActor) {
  const year = Number(doc.fiscal_year);
  const budgetAccountId = doc.budget_account_id == null ? null : Number(doc.budget_account_id);
  const amount = Number(doc.amount);
  await lockBudget(tx, year, budgetAccountId);
  const position = await budgetPosition(tx, year, budgetAccountId);
  if (position.hasPlan && amount > position.available) {
    throw new LedgerError(`예산 사용가능액을 넘어 승인할 수 없습니다. 사용가능액 ${position.available.toLocaleString("ko-KR")}원, 결재 금액 ${amount.toLocaleString("ko-KR")}원`);
  }
  const resolutionNo = await nextResolutionNo(tx, year);
  await tx.execute(sql`
    UPDATE approval_requests
       SET status = 'approved', decided_at = NOW(), updated_at = NOW(), payment_status = 'unpaid',
           resolution_no = ${resolutionNo}, resolution_issued_at = NOW()
     WHERE id = ${doc.id}`);
  await recordBudgetLedger(tx, {
    year, budgetAccountId, documentId: Number(doc.id), documentNo: doc.doc_no, documentVersion: Number(doc.version),
    type: "reserve", amount, before: position, actor, key: `reserve:approval:${doc.id}`,
  });
  return resolutionNo;
}

export async function decideDoc(actor: DocActor, id: number, input: { decision: string; comment?: string; expectedVersion?: number }): Promise<DecideOutcome> {
  const decision = input.decision;
  if (decision !== "approve" && decision !== "reject") throw new LedgerError("decision 값이 올바르지 않습니다", 400);
  const comment = text(input.comment, 1000);
  return db.transaction(async (tx: any) => {
    const doc = rowsOf(await tx.execute(sql`SELECT * FROM approval_requests WHERE id = ${id} FOR UPDATE`))[0];
    if (!doc) throw new LedgerError("문서를 찾을 수 없습니다", 404);
    if (doc.status !== "pending") throw new LedgerError("진행중인 문서가 아닙니다.", 409);
    /* 결재자가 본 버전과 다르면 처리하지 않는다 */
    if (input.expectedVersion != null && Number(input.expectedVersion) !== Number(doc.version)) {
      throw new LedgerError("문서가 새 버전으로 바뀌었습니다. 다시 확인해 주세요.", 409);
    }
    const step = rowsOf(await tx.execute(sql`
      SELECT * FROM approval_request_steps
       WHERE request_id = ${id} AND version = ${doc.version} AND kind = 'approval' AND step_index = ${doc.current_step}`))[0];
    if (!step || step.decision !== "pending") throw new LedgerError("처리할 단계가 없습니다.", 409);
    if (Number(step.assignee_id) !== actor.id) throw new LedgerError("이 단계의 담당자가 아닙니다.", 403);
    if (decision === "reject" && !comment) throw new LedgerError("반려 사유를 입력하세요", 400);

    await tx.execute(sql`
      UPDATE approval_request_steps
         SET decision = ${decision === "approve" ? "approved" : "rejected"}, decided_by = ${actor.id},
             decided_by_name = ${actor.name}, comment = ${comment}, decided_at = NOW()
       WHERE id = ${step.id}`);

    if (decision === "reject") {
      await tx.execute(sql`UPDATE approval_requests SET status = 'rejected', decided_at = NOW(), updated_at = NOW() WHERE id = ${id}`);
      await tx.execute(sql`
        UPDATE approval_request_steps SET decision = 'canceled'
         WHERE request_id = ${id} AND version = ${doc.version} AND kind = 'approval' AND decision = 'pending'`);
      await recordHistory(tx, { entity: "approval", entityId: id, action: "rejected", actor, reason: comment });
      return { kind: "rejected" as const, doc };
    }

    const next = rowsOf(await tx.execute(sql`
      SELECT step_index, assignee_id FROM approval_request_steps
       WHERE request_id = ${id} AND version = ${doc.version} AND kind = 'approval' AND step_index > ${doc.current_step}
       ORDER BY step_index LIMIT 1`))[0];
    if (next) {
      await tx.execute(sql`UPDATE approval_requests SET current_step = ${next.step_index}, updated_at = NOW() WHERE id = ${id}`);
      return { kind: "advanced" as const, doc, nextAssignee: next.assignee_id == null ? null : Number(next.assignee_id) };
    }

    let resolutionNo: string | null = null;
    if (doc.doc_type === "expense") {
      resolutionNo = await finalizeExpense(tx, doc, actor);
    } else {
      await tx.execute(sql`UPDATE approval_requests SET status = 'approved', decided_at = NOW(), updated_at = NOW() WHERE id = ${id}`);
    }
    await recordHistory(tx, { entity: "approval", entityId: id, action: "approved", actor, after: { docNo: doc.doc_no, version: doc.version } });
    return { kind: "approved" as const, doc, resolutionNo };
  });
}

/** 취소 요청. 원승인의 결재·합의 구분과 담당자·순서를 그대로 복사한다(설계도 11쪽). */
export async function requestCancel(actor: DocActor, id: number, reason: string) {
  const why = text(reason, 500);
  if (!why) throw new LedgerError("취소 사유를 입력하세요", 400);
  return db.transaction(async (tx: any) => {
    const doc = rowsOf(await tx.execute(sql`SELECT * FROM approval_requests WHERE id = ${id} FOR UPDATE`))[0];
    if (!doc) throw new LedgerError("문서를 찾을 수 없습니다", 404);
    if (doc.status !== "approved") throw new LedgerError("완료된 문서만 취소를 요청할 수 있습니다.");
    if (doc.cancel_status === "requested") throw new LedgerError("이미 취소가 진행 중입니다.");
    if (Number(doc.drafter_id) !== actor.id && actor.role !== "super_admin") throw new LedgerError("기안자 또는 이사장이 요청할 수 있습니다", 403);

    /* 승인 갈음 문서는 근거 품의의 실제 결재선을 쓴다(설계도 9쪽) */
    const sourceId = doc.approval_mode === "substituted" ? Number(doc.substitute_basis_id) : id;
    const source = rowsOf(await tx.execute(sql`SELECT version FROM approval_requests WHERE id = ${sourceId}`))[0];
    const steps = rowsOf(await tx.execute(sql`
      SELECT step_index, role, step_type, assignee_id, assignee_name, assignee_title
        FROM approval_request_steps
       WHERE request_id = ${sourceId} AND version = ${source.version} AND kind = 'approval' AND decision = 'approved'
       ORDER BY step_index`));
    if (!steps.length) throw new LedgerError("원승인 결재선을 찾을 수 없습니다.");
    const ids = steps.map((s: any) => Number(s.assignee_id)).filter(Boolean);
    const members = await activeMembers(tx, ids);
    /* 퇴직 등으로 원승인자 계정이 없으면 이사장이 대신 승인하고 그 사실을 남긴다 */
    const inactive = steps.filter((s: any) => !members.has(Number(s.assignee_id)));
    if (inactive.length) {
      const chair = rowsOf(await tx.execute(sql`
        SELECT id, name, role FROM members WHERE type = 'admin' AND status = 'active' AND role = 'super_admin' ORDER BY id LIMIT 1`))[0];
      if (!chair) throw new LedgerError("원승인자 계정이 비활성이고 대신 승인할 이사장 계정이 없습니다.");
      for (const s of inactive) {
        s.assignee_title = `원승인자 ${s.assignee_name} 대체`;
        s.assignee_id = chair.id;
        s.assignee_name = chair.name;
      }
    }

    const round = Number(rowsOf(await tx.execute(sql`
      SELECT COALESCE(MAX(round), 0)::int AS n FROM approval_request_steps WHERE request_id = ${id} AND kind = 'cancel'`))[0]?.n ?? 0) + 1;
    let index = 0;
    for (const s of steps) {
      await tx.execute(sql`
        INSERT INTO approval_request_steps
          (request_id, step_index, role, decision, version, kind, round, step_type, assignee_id, assignee_name, assignee_title)
        VALUES (${id}, ${index}, ${s.role}, 'pending', ${doc.version}, 'cancel', ${round}, ${s.step_type}, ${s.assignee_id}, ${s.assignee_name}, ${s.assignee_title})`);
      index += 1;
    }
    await tx.execute(sql`
      UPDATE approval_requests
         SET cancel_status = 'requested', cancel_reason = ${why}, cancel_requested_by = ${actor.id},
             cancel_requested_at = NOW(), updated_at = NOW()
       WHERE id = ${id}`);
    await recordHistory(tx, { entity: "approval", entityId: id, action: "cancel_requested", actor, reason: why });
    return { firstAssignee: Number(steps[0].assignee_id), title: doc.title };
  });
}

/** 취소 결재. 마지막 승인 때 예약 해제 또는 반환 확인 대기로 넘어간다(설계도 10쪽). */
export async function decideCancel(actor: DocActor, id: number, input: { decision: string; comment?: string }) {
  const decision = input.decision;
  if (decision !== "approve" && decision !== "reject") throw new LedgerError("decision 값이 올바르지 않습니다", 400);
  const comment = text(input.comment, 1000);
  return db.transaction(async (tx: any) => {
    const doc = rowsOf(await tx.execute(sql`SELECT * FROM approval_requests WHERE id = ${id} FOR UPDATE`))[0];
    if (!doc) throw new LedgerError("문서를 찾을 수 없습니다", 404);
    if (doc.cancel_status !== "requested") throw new LedgerError("취소가 진행 중인 문서가 아닙니다.", 409);
    const round = Number(rowsOf(await tx.execute(sql`
      SELECT COALESCE(MAX(round), 0)::int AS n FROM approval_request_steps WHERE request_id = ${id} AND kind = 'cancel'`))[0]?.n ?? 0);
    const step = rowsOf(await tx.execute(sql`
      SELECT * FROM approval_request_steps
       WHERE request_id = ${id} AND kind = 'cancel' AND round = ${round} AND decision = 'pending'
       ORDER BY step_index LIMIT 1`))[0];
    if (!step) throw new LedgerError("처리할 단계가 없습니다.", 409);
    if (Number(step.assignee_id) !== actor.id) throw new LedgerError("이 단계의 담당자가 아닙니다.", 403);
    if (decision === "reject" && !comment) throw new LedgerError("반려 사유를 입력하세요", 400);
    await tx.execute(sql`
      UPDATE approval_request_steps
         SET decision = ${decision === "approve" ? "approved" : "rejected"}, decided_by = ${actor.id},
             decided_by_name = ${actor.name}, comment = ${comment}, decided_at = NOW()
       WHERE id = ${step.id}`);

    if (decision === "reject") {
      await tx.execute(sql`
        UPDATE approval_request_steps SET decision = 'canceled'
         WHERE request_id = ${id} AND kind = 'cancel' AND round = ${round} AND decision = 'pending'`);
      await tx.execute(sql`UPDATE approval_requests SET cancel_status = 'rejected', updated_at = NOW() WHERE id = ${id}`);
      await recordHistory(tx, { entity: "approval", entityId: id, action: "cancel_rejected", actor, reason: comment });
      return { kind: "rejected" as const, doc, nextAssignee: null, refundRequired: false };
    }

    const next = rowsOf(await tx.execute(sql`
      SELECT assignee_id FROM approval_request_steps
       WHERE request_id = ${id} AND kind = 'cancel' AND round = ${round} AND decision = 'pending'
       ORDER BY step_index LIMIT 1`))[0];
    if (next) return { kind: "advanced" as const, doc, nextAssignee: Number(next.assignee_id), refundRequired: false };

    /* 최종 취소 승인 */
    let refundRequired = false;
    if (doc.doc_type === "expense" && doc.payment_status === "paid") {
      refundRequired = true;
      await tx.execute(sql`
        UPDATE approval_requests SET status = 'canceled', cancel_status = 'approved', refund_status = 'required', updated_at = NOW() WHERE id = ${id}`);
    } else if (doc.doc_type === "expense" && doc.payment_status === "unpaid") {
      const year = Number(doc.fiscal_year);
      const budgetAccountId = doc.budget_account_id == null ? null : Number(doc.budget_account_id);
      await lockBudget(tx, year, budgetAccountId);
      const position: BudgetPosition = await budgetPosition(tx, year, budgetAccountId);
      await tx.execute(sql`
        UPDATE approval_requests SET status = 'canceled', cancel_status = 'approved', payment_status = 'none', updated_at = NOW() WHERE id = ${id}`);
      await recordBudgetLedger(tx, {
        year, budgetAccountId, documentId: id, documentNo: doc.doc_no, documentVersion: Number(doc.version), type: "release",
        amount: Number(doc.amount), before: position, actor, key: `release:approval:${id}`, note: doc.cancel_reason,
      });
    } else {
      await tx.execute(sql`UPDATE approval_requests SET status = 'canceled', cancel_status = 'approved', updated_at = NOW() WHERE id = ${id}`);
    }
    await recordHistory(tx, { entity: "approval", entityId: id, action: "cancel_approved", actor, reason: doc.cancel_reason });
    return { kind: "approved" as const, doc, nextAssignee: null, refundRequired };
  });
}

/** 일반 삭제. 취소 최종승인 뒤에만, 사유를 남기고 화면에서 뺀다(설계도 11쪽). 임시저장은 기안자가 지운다. */
export async function deleteDoc(actor: DocActor, id: number, reason: string | null, canDelete: boolean) {
  return db.transaction(async (tx: any) => {
    const doc = rowsOf(await tx.execute(sql`SELECT * FROM approval_requests WHERE id = ${id} FOR UPDATE`))[0];
    if (!doc) throw new LedgerError("문서를 찾을 수 없습니다", 404);
    if (doc.status === "draft" && !doc.doc_no) {
      if (Number(doc.drafter_id) !== actor.id) throw new LedgerError("본인의 임시저장만 지울 수 있습니다", 403);
      await tx.execute(sql`DELETE FROM approval_doc_files WHERE request_id = ${id}`);
      await tx.execute(sql`DELETE FROM approval_requests WHERE id = ${id}`);
      return { removed: true };
    }
    if (!canDelete) throw new LedgerError("일반 삭제 권한이 없습니다", 403);
    if (doc.cancel_status !== "approved") throw new LedgerError("취소가 최종 승인된 문서만 삭제할 수 있습니다.");
    if (doc.delete_status !== "none") throw new LedgerError("이미 삭제된 문서입니다.");
    const why = text(reason, 500);
    if (!why) throw new LedgerError("삭제 사유를 입력하세요", 400);
    await tx.execute(sql`
      UPDATE approval_requests SET delete_status = 'deleted', deleted_at = NOW(), deleted_by = ${actor.id}, delete_reason = ${why}, updated_at = NOW()
       WHERE id = ${id}`);
    await recordHistory(tx, { entity: "approval", entityId: id, action: "doc_deleted", actor, reason: why });
    return { removed: false };
  });
}

/** 유효한 완전삭제 권한. 없으면 메뉴와 API를 쓸 수 없다(설계도 12쪽). */
export async function activePurgeGrant(exec: any, memberId: number) {
  const today = todayKST();
  return rowsOf(await exec.execute(sql`
    SELECT id FROM approval_purge_grants
     WHERE member_id = ${memberId} AND revoked_at IS NULL AND start_on <= ${today} AND end_on >= ${today}
     ORDER BY id DESC LIMIT 1`))[0] ?? null;
}

/** 완전삭제 대상 검사. 지정 담당자라도 조건을 못 맞추면 지울 수 없다. */
export async function purgeProblems(exec: any, doc: any): Promise<string[]> {
  const settings = await loadSettings(exec);
  const problems: string[] = [];
  if (doc.delete_status !== "deleted") problems.push("일반 삭제된 문서가 아닙니다");
  if (doc.cancel_status !== "approved") problems.push("취소가 최종 승인된 문서가 아닙니다");
  if (doc.hold_reason) problems.push(`보존 중지 중입니다: ${doc.hold_reason}`);
  if (settings.retentionYears == null) {
    problems.push("보존기간이 정해지지 않았습니다");
  } else {
    const from = new Date(doc.deleted_at ?? doc.updated_at);
    const until = new Date(from);
    until.setUTCFullYear(until.getUTCFullYear() + settings.retentionYears);
    if (until.toISOString().slice(0, 10) > todayKST()) problems.push(`보존기간이 ${until.toISOString().slice(0, 10)}까지입니다`);
  }
  return problems;
}

/** 완전삭제. 내용을 지우고 내부 식별값과 최소 기록만 남긴다. 지출·원장은 건드리지 않는다. */
export async function purgeDoc(actor: DocActor, id: number, reason: string, grantId: number) {
  const why = text(reason, 500);
  if (!why) throw new LedgerError("삭제 사유를 입력하세요", 400);
  return db.transaction(async (tx: any) => {
    const doc = rowsOf(await tx.execute(sql`SELECT * FROM approval_requests WHERE id = ${id} FOR UPDATE`))[0];
    if (!doc) throw new LedgerError("문서를 찾을 수 없습니다", 404);
    const problems = await purgeProblems(tx, doc);
    if (problems.length) throw new LedgerError("완전삭제할 수 없습니다.", 422, problems);
    const files = rowsOf(await tx.execute(sql`SELECT blob_key FROM approval_doc_files WHERE request_id = ${id}`));
    const versions = rowsOf(await tx.execute(sql`SELECT COUNT(*)::int AS n FROM approval_doc_versions WHERE request_id = ${id}`))[0];
    await tx.execute(sql`DELETE FROM approval_doc_files WHERE request_id = ${id}`);
    await tx.execute(sql`DELETE FROM approval_doc_versions WHERE request_id = ${id}`);
    await tx.execute(sql`DELETE FROM approval_doc_comments WHERE request_id = ${id}`);
    await tx.execute(sql`DELETE FROM approval_doc_watchers WHERE request_id = ${id}`);
    await tx.execute(sql`DELETE FROM approval_request_steps WHERE request_id = ${id}`);
    await tx.execute(sql`DELETE FROM approval_doc_references WHERE request_id = ${id}`);
    await tx.execute(sql`
      UPDATE approval_requests
         SET title = '(완전삭제된 문서)', body = NULL, form_data = '{}'::jsonb, description = NULL, payee_name = NULL,
             evidence_url = NULL, cancel_reason = NULL, delete_reason = NULL, amount = 0, delete_status = 'purged', updated_at = NOW()
       WHERE id = ${id}`);
    await tx.execute(sql`
      INSERT INTO approval_purge_log (request_id, doc_no, doc_type, actor_id, actor_name, grant_id, reason, scope)
      VALUES (${id}, ${doc.doc_no}, ${doc.doc_type}, ${actor.id}, ${actor.name}, ${grantId}, ${why},
              ${JSON.stringify({ files: files.length, versions: Number(versions?.n) || 0 })}::jsonb)`);
    return { blobKeys: files.map((f: any) => f.blob_key).filter(Boolean) };
  });
}
