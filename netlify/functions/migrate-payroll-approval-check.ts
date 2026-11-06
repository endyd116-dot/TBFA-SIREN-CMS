/**
 * 급여 지급 결재 라이브 점검 (1회용 — 확인 뒤 이 파일을 지운다)
 *
 * GET /api/migrate-payroll-approval-check            진단 (인증 불필요): 남은 점검 데이터가 있는지만 알려 준다
 * GET /api/migrate-payroll-approval-check?run=1      이사장 로그인 뒤 실행
 * GET /api/migrate-payroll-approval-check?cleanup=1  이사장 로그인 뒤 점검 데이터만 지운다(실행이 중간에 끊겼을 때)
 *
 * 급여 지급 결재(lib/payroll-approval.ts)의 쓰기 경로를 실제 DB에서 한 번 돌린다.
 *   점검용 급여 1건 → 결재 문서 만들기 → 상신 → 승인(예산 예약) → 지급 확인(급여 지급 완료) → 전부 삭제
 * 실제 직원과 실제 급여는 건드리지 않는다. 점검용 급여는 2099년 1월, 없는 직원 번호로 만든다.
 * 지급일도 2099년이라 장부 전표는 만들어지지 않는다(회계연도가 없어 대기로 남고, 급여를 지우면 사라진다).
 * 끝나면 성공·실패와 관계없이 점검 데이터(문서, 예산 원장, 이력, 급여, 인건비 배부)를 지운다.
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { decideDoc, requestCancel, saveDraft, submitDoc, type DocActor, type LeaveBridge } from "../../lib/approval-docs";
import { budgetPosition } from "../../lib/budget-ledger";
import { payrollMonthStatus, payrollOf, slipClaims } from "../../lib/payroll-approval";
import docsHandler from "./admin-docs";
import payrollHandler from "./admin-payroll";
import payHandler from "./admin-approval-pay";

export const config = { path: "/api/migrate-payroll-approval-check" };

const rowsOf = (r: any): any[] => r?.rows ?? r ?? [];
const JSON_HEADERS = { "Content-Type": "application/json" };
const json = (body: unknown, status = 200) => new Response(jsonKST(body), { status, headers: JSON_HEADERS });

const TEST_UID = "999999001";
const YEAR = 2099;
const MONTH = 1;
const TITLE = "[점검] 급여 지급 결재";

/* 휴가 문서가 아니므로 근태 연결은 쓰이지 않는다 */
const noLeave: LeaveBridge = {
  create: async () => { throw new Error("점검에서는 휴가를 만들지 않습니다"); },
  decide: async () => undefined,
  withdraw: async () => undefined,
};

async function testDocIds(exec: { execute: (q: any) => Promise<any> }): Promise<number[]> {
  return rowsOf(await exec.execute(sql`
    SELECT id FROM approval_requests
     WHERE (form_data->'payroll'->>'year')::int = ${YEAR} OR title = ${TITLE}`)).map((r: any) => Number(r.id));
}

async function residue() {
  const n = async (q: any) => Number(rowsOf(await db.execute(q))[0]?.n ?? 0);
  return {
    slips: await n(sql`SELECT COUNT(*)::int AS n FROM payroll_slips WHERE member_uid = ${TEST_UID}`),
    allocations: await n(sql`SELECT COUNT(*)::int AS n FROM ledger_staff_allocations WHERE member_id = ${Number(TEST_UID)}`),
    documents: (await testDocIds(db)).length,
  };
}

/** 점검 데이터 삭제. 예산 원장과 변경 이력은 지울 수 없게 잠겨 있어 이 거래 안에서만 잠금을 푼다. */
async function cleanup() {
  return db.transaction(async (tx: any) => {
    const ids = await testDocIds(tx);
    const slipIds = rowsOf(await tx.execute(sql`SELECT id FROM payroll_slips WHERE member_uid = ${TEST_UID}`)).map((r: any) => Number(r.id));
    let ledgerRows = 0;
    let vouchers = 0;
    if (slipIds.length) {
      vouchers = Number(rowsOf(await tx.execute(sql`
        SELECT COUNT(*)::int AS n FROM vouchers
         WHERE source_type = 'payroll' AND source_id IN (${sql.join(slipIds.map((i) => sql`${String(i)}`), sql`, `)})`))[0]?.n ?? 0);
    }
    if (ids.length) {
      const list = sql`(${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`;
      const texts = sql`(${sql.join(ids.map((i) => sql`${String(i)}`), sql`, `)})`;
      await tx.execute(sql.raw(`ALTER TABLE budget_ledger DISABLE TRIGGER budget_ledger_guard_trg`));
      await tx.execute(sql.raw(`ALTER TABLE ledger_history DISABLE TRIGGER ledger_history_guard_trg`));
      ledgerRows = Number(rowsOf(await tx.execute(sql`SELECT COUNT(*)::int AS n FROM budget_ledger WHERE document_type = 'approval_request' AND document_id IN ${list}`))[0]?.n ?? 0);
      await tx.execute(sql`DELETE FROM budget_ledger WHERE document_type = 'approval_request' AND document_id IN ${list}`);
      await tx.execute(sql`DELETE FROM ledger_history WHERE entity = 'approval' AND entity_id IN ${texts}`);
      /* 이 점검은 알림을 보내지 않는다(상신·승인은 알림 없는 공용 처리를 직접 부른다) */
      await tx.execute(sql`DELETE FROM approval_doc_references WHERE target_id IN ${list}`);
      await tx.execute(sql`DELETE FROM approval_request_steps WHERE request_id IN ${list}`);
      await tx.execute(sql`DELETE FROM approval_requests WHERE id IN ${list}`);
      await tx.execute(sql.raw(`ALTER TABLE budget_ledger ENABLE TRIGGER budget_ledger_guard_trg`));
      await tx.execute(sql.raw(`ALTER TABLE ledger_history ENABLE TRIGGER ledger_history_guard_trg`));
      /* 점검이 쓴 문서번호를 되돌린다. 실제 문서의 다음 번호가 건너뛰지 않게 한다 */
      await tx.execute(sql`
        UPDATE approval_doc_sequences q
           SET last_no = COALESCE((
             SELECT MAX(CAST(SUBSTRING(r.doc_no FROM '([0-9]+)$') AS INTEGER)) FROM approval_requests r
              WHERE r.doc_type = q.doc_type AND r.doc_no IS NOT NULL
                AND CAST(SUBSTRING(r.doc_no FROM '-([0-9]{4})-') AS INTEGER) = q.year), 0)
         WHERE q.doc_type = 'expense'`);
    }
    await tx.execute(sql`DELETE FROM payroll_slips WHERE member_uid = ${TEST_UID}`);
    await tx.execute(sql`DELETE FROM ledger_staff_allocations WHERE member_id = ${Number(TEST_UID)}`);
    return { documents: ids.length, slips: slipIds.length, budgetLedgerRows: ledgerRows, vouchers };
  });
}

export default async function handler(req: Request, _ctx: Context) {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";
  const onlyCleanup = url.searchParams.get("cleanup") === "1";

  if (!run && !onlyCleanup) {
    try {
      return json({
        ok: true, mode: "diagnose",
        note: "?run=1 로 실행하면 점검용 급여 1건으로 결재부터 지급 확인까지 돌리고 전부 지웁니다. 실제 직원과 급여는 건드리지 않습니다.",
        residue: await residue(),
      });
    } catch (err: any) {
      return json({ ok: false, mode: "diagnose", error: "진단 실패", detail: String(err?.message || err).slice(0, 500) }, 500);
    }
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  if (String(auth.ctx.member.role ?? "") !== "super_admin") {
    return json({ ok: false, error: "이사장 계정으로 실행해 주세요" }, 403);
  }
  const actor: DocActor = { id: Number(auth.ctx.admin.uid), name: auth.ctx.member.name ?? "", role: "super_admin" };

  if (onlyCleanup) {
    try {
      return json({ ok: true, mode: "cleanup", removed: await cleanup(), residue: await residue() });
    } catch (err: any) {
      return json({ ok: false, mode: "cleanup", error: "정리 실패", detail: String(err?.message || err).slice(0, 500), stack: String(err?.stack || "").slice(0, 1000) }, 500);
    }
  }

  const checks: { name: string; ok: boolean; detail?: string }[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) => {
    checks.push({ name, ok: !!ok, ...(detail === undefined ? {} : { detail: String(typeof detail === "string" ? detail : JSON.stringify(detail)).slice(0, 300) }) });
  };
  /* 실제 화면이 부르는 것과 같은 처리를 같은 로그인으로 부른다 */
  const call = async (h: (r: Request, c: Context) => Promise<Response>, method: string, path: string, body?: unknown) => {
    const res = await h(new Request(new URL(path, req.url), {
      method, headers: { cookie: req.headers.get("cookie") ?? "", "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), _ctx);
    let data: any = null;
    try { data = await res.json(); } catch { /* 본문 없음 */ }
    return { status: res.status, data };
  };
  const one = async (q: any) => rowsOf(await db.execute(q))[0];

  let step = "pre_clean";
  let failure: any = null;
  let cleaned: any = null;
  try {
    await cleanup();

    step = "seed";
    await db.execute(sql`INSERT INTO ledger_staff_allocations (member_id, function_code) VALUES (${Number(TEST_UID)}, 'admin') ON CONFLICT (member_id) DO NOTHING`);
    const slip = await one(sql`
      INSERT INTO payroll_slips (member_uid, pay_year, pay_month, base_salary_month, performance_bonus, gross_pay, total_deduction, income_tax, net_pay, status)
      VALUES (${TEST_UID}, ${YEAR}, ${MONTH}, 1000000, 100000, 1100000, 100000, 100000, 1000000, 'APPROVED')
      RETURNING id`);
    const slipId = Number(slip.id);
    const expensesBefore = Number((await one(sql`SELECT COUNT(*)::int AS n FROM expenses`)).n);

    step = "org";
    const status = await payrollMonthStatus(db, YEAR, MONTH);
    check("점검용 급여가 사단법인 소속으로 판정", status.get(slipId)?.org === true && status.get(slipId)?.claim == null, status.get(slipId));
    const list = await call(payrollHandler, "GET", `/api/admin-payroll?year=${YEAR}&month=${MONTH}`);
    const listRow = (list.data?.data?.rows ?? []).find((r: any) => Number(r.id) === slipId);
    check("급여 일람이 소속과 결재 상태를 돌려줌", list.status === 200 && listRow?.orgPayroll === true && listRow?.approval === null, { status: list.status, org: listRow?.orgPayroll });

    step = "direct_paid";
    const direct = await call(payrollHandler, "POST", `/api/admin-payroll?id=${slipId}&action=paid`, { paidAt: "2099-01-25" });
    check("사단법인 급여의 직접 지급 확정 차단", direct.status === 400 && /결재를 거쳐/.test(direct.data?.error ?? ""), direct.data?.error);

    step = "draft";
    const draft = await call(docsHandler, "POST", "/api/admin-docs", { action: "payroll_draft", year: YEAR, month: MONTH });
    const docId = Number(draft.data?.data?.id) || 0;
    check("결재 문서 만들기", draft.status === 200 && draft.data?.data?.created === true && draft.data?.data?.count === 1 && draft.data?.data?.gross === 1100000, draft.data?.data ?? draft.data);
    if (!docId) throw new Error("결재 문서가 만들어지지 않았습니다: " + JSON.stringify(draft.data).slice(0, 300));
    const doc1 = await one(sql`SELECT * FROM approval_requests WHERE id = ${docId}`);
    const p1 = payrollOf(doc1.form_data);
    check("문서 값: 지출결의서, 고정 인건비, 지급총액", doc1.doc_type === "expense" && doc1.expense_kind === "fixed_personnel" && Number(doc1.amount) === 1100000 && doc1.status === "draft",
      { type: doc1.doc_type, kind: doc1.expense_kind, amount: doc1.amount });
    check("예산을 기본급·상여금 과목으로 나눔(과목 연결 있음)", !!p1 && p1.budget.length === 2 && p1.budget.every((b) => b.budgetAccountId != null)
      && p1.budget.reduce((t, b) => t + b.amount, 0) === 1100000, p1?.budget);

    step = "save";
    await saveDraft(actor, { id: docId, docType: "expense", title: TITLE, formData: { line: [{ type: "approve", memberId: actor.id, name: actor.name, title: null }], payroll: { slipIds: [] } } });
    const doc2 = await one(sql`SELECT title, amount, form_data FROM approval_requests WHERE id = ${docId}`);
    check("저장은 제목·결재선만 바꾸고 급여 내역은 그대로", doc2.title === TITLE && Number(doc2.amount) === 1100000 && payrollOf(doc2.form_data)?.slipIds.length === 1 && doc2.form_data.line.length === 1);

    step = "submit";
    let noBasis: any = null;
    try { await submitDoc(actor, docId, noLeave); } catch (err: any) { noBasis = err; }
    check("근로계약이 없는 직원 급여는 근거 없이 상신 불가", (noBasis?.missing ?? []).some((x: string) => /근로계약이 등록되지 않은/.test(x)), noBasis?.missing ?? String(noBasis?.message ?? "상신됨"));
    await db.execute(sql`INSERT INTO approval_doc_files (request_id, file_kind, file_name) VALUES (${docId}, 'proposal', '[점검] 급여 근거.pdf')`);
    const submitted = await submitDoc(actor, docId, noLeave);
    check("상신과 문서번호 발급", submitted.status === "pending" && /^지출-\d{4}-\d{4}$/.test(submitted.docNo), submitted);

    step = "lock";
    const claim = (await slipClaims(db, { slipIds: [slipId] })).get(slipId);
    check("결재 중 급여 잠금 판정", claim?.locked === true && claim?.docId === docId, claim);
    const edit = await call(payrollHandler, "PATCH", `/api/admin-payroll?id=${slipId}`, { baseSalaryMonth: 1, autoDeduction: false, reason: "점검" });
    check("결재 중 급여 수정 차단", edit.status === 400 && /결재 진행 중/.test(edit.data?.error ?? ""), edit.data?.error);

    step = "approve";
    const parts = payrollOf((await one(sql`SELECT form_data FROM approval_requests WHERE id = ${docId}`)).form_data)!.budget;
    const fiscalYear = Number((await one(sql`SELECT fiscal_year FROM approval_requests WHERE id = ${docId}`)).fiscal_year);
    const before = [];
    for (const part of parts) before.push(await budgetPosition(db, fiscalYear, part.budgetAccountId));
    const decided = await decideDoc(actor, docId, { decision: "approve" });
    check("최종 승인과 결의번호", decided.kind === "approved" && !!(decided as any).resolutionNo, { kind: decided.kind, no: (decided as any).resolutionNo });
    const after = [];
    for (const part of parts) after.push(await budgetPosition(db, fiscalYear, part.budgetAccountId));
    check("승인 뒤 과목별 예약", parts.every((part, i) => after[i].reserved - before[i].reserved === part.amount),
      parts.map((part, i) => ({ mok: part.budgetAccountId, amount: part.amount, reserved: after[i].reserved - before[i].reserved })));

    step = "pay";
    const paid = await call(payHandler, "POST", "/api/admin-approval-pay", { requestId: docId, paidAt: "2099-01-25", evidenceChecked: true });
    check("지급 확인", paid.status === 200 && paid.data?.data?.payroll?.slips === 1 && paid.data?.data?.expenseId === null, paid.data?.data ?? paid.data);
    const slipAfter = await one(sql`SELECT status, paid_by, to_char(paid_at, 'YYYY-MM-DD HH24:MI') AS paid_at FROM payroll_slips WHERE id = ${slipId}`);
    check("급여가 지급 완료, 지급일은 이체일의 한국 정오", slipAfter.status === "PAID" && slipAfter.paid_by === String(actor.id) && slipAfter.paid_at === "2099-01-25 03:00", slipAfter);
    const doc3 = await one(sql`SELECT payment_status, paid_amount, expense_id, to_char(paid_at, 'YYYY-MM-DD') AS paid_on FROM approval_requests WHERE id = ${docId}`);
    check("문서는 지출완료, 지출은 만들지 않음", doc3.payment_status === "paid" && Number(doc3.paid_amount) === 1100000 && doc3.expense_id == null && doc3.paid_on === "2099-01-25", doc3);
    check("지출 건수 변화 없음", Number((await one(sql`SELECT COUNT(*)::int AS n FROM expenses`)).n) === expensesBefore);
    const released = [];
    for (const part of parts) released.push(await budgetPosition(db, fiscalYear, part.budgetAccountId));
    check("지급 뒤 예약 해제", parts.every((_, i) => released[i].reserved === before[i].reserved), released.map((r) => r.reserved));
    const ledger = rowsOf(await db.execute(sql`SELECT txn_type FROM budget_ledger WHERE document_type = 'approval_request' AND document_id = ${docId} ORDER BY id`)).map((r: any) => r.txn_type);
    check("예산 원장: 과목별 예약과 집행", ledger.filter((t) => t === "reserve").length === parts.length && ledger.filter((t) => t === "execute").length === parts.length, ledger.join(","));
    const vouchers = Number((await one(sql`SELECT COUNT(*)::int AS n FROM vouchers WHERE source_type = 'payroll' AND source_id = ${String(slipId)}`)).n);
    check("2099년 지급이라 장부 전표는 만들지 않음", vouchers === 0, { vouchers, ledger: paid.data?.data?.ledger });

    step = "cancel";
    let cancelError: any = null;
    try { await requestCancel(actor, docId, "점검"); } catch (err: any) { cancelError = err; }
    check("지급이 끝난 급여 결재는 취소 불가", /취소할 수 없습니다/.test(String(cancelError?.message ?? "")), String(cancelError?.message ?? "취소 요청이 받아들여짐"));
    step = "done";
  } catch (err: any) {
    failure = { step, detail: String(err?.message || err).slice(0, 500), missing: err?.missing ?? undefined, stack: String(err?.stack || "").slice(0, 1000) };
  } finally {
    try {
      cleaned = await cleanup();
    } catch (err: any) {
      cleaned = { error: String(err?.message || err).slice(0, 500) };
    }
  }

  let left: any = null;
  try { left = await residue(); } catch (err: any) { left = { error: String(err?.message || err).slice(0, 300) }; }
  const clean = left && left.slips === 0 && left.allocations === 0 && left.documents === 0;
  const failed = checks.filter((c) => !c.ok);
  return json({
    ok: !failure && failed.length === 0 && !!clean,
    mode: "run",
    pass: checks.length - failed.length,
    fail: failed.length,
    failed,
    error: failure,
    cleanup: cleaned,
    residue: left,
    checks,
  }, failure ? 500 : 200);
}
