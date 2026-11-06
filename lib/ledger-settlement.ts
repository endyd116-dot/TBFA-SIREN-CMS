// lib/ledger-settlement.ts — 결산 서류 묶음, 주석, 점검표 (2026-11-06)
//
// 설계: docs/active/2026-11-06-ledger-settlement-design.md
// 정관 제33조 제출 서류와 회계기준 재무제표를 한 묶음으로 만든다.
// 확정하면 그 순간의 묶음을 승인본으로 저장하고, 이후 출력은 승인본을 쓴다.
import { sql } from "drizzle-orm";
import { db } from "../db";
import { charterGap, closeStatus, loadFiscalYears, suspenseBalances, type FiscalYear } from "./ledger-report";
import {
  assetBalances, budgetStatement, fiscalYearOf, fundSummary, majorTransactions,
  natureBreakdown, netAssetChanges, settlementStatement, yearStatements,
} from "./ledger-statements";
import { pendingStatus } from "./ledger-auto";

const rowsOf = (r: any): any[] => r?.rows ?? r ?? [];
const won = (n: number) => `${Number(n || 0).toLocaleString("ko-KR")}원`;

export const SETTLEMENT_STATUS = ["draft", "locked", "audited", "board_approved", "assembly_approved", "submitted"] as const;
export type SettlementStatus = typeof SETTLEMENT_STATUS[number];
export const SETTLEMENT_LABEL: Record<SettlementStatus, string> = {
  draft: "작성중", locked: "확정", audited: "감사 완료", board_approved: "이사회 의결",
  assembly_approved: "총회 승인", submitted: "제출 완료",
};

/** 사람이 직접 확인해야 하는 결산 정리 항목 */
export const MANUAL_CHECKS = [
  { key: "depreciation", label: "유형자산 감가상각을 대체 전표로 반영했습니다(없으면 체크)" },
  { key: "retirement", label: "퇴직급여충당부채를 연말 기준으로 반영했습니다(대상자가 없으면 체크)" },
  { key: "accrual", label: "연말까지 발생한 미지급비용과 내년분 선급비용을 정리했습니다" },
  { key: "inkind", label: "현물기부 여부를 확인했습니다" },
] as const;

export interface OrgInfo {
  name: string; registrationNo: string; representative: string; address: string; phone: string;
}

export async function loadOrgInfo(): Promise<OrgInfo> {
  const fallback: OrgInfo = {
    name: process.env.ORG_NAME || "사단법인 교사유가족협의회",
    registrationNo: process.env.ORG_REGISTRATION_NO || "",
    representative: process.env.ORG_REPRESENTATIVE || "",
    address: process.env.ORG_ADDRESS || "",
    phone: process.env.ORG_PHONE || "",
  };
  try {
    const r = rowsOf(await db.execute(sql`
      SELECT org_name, org_registration_no, org_representative, org_address, org_phone
        FROM receipt_settings ORDER BY id LIMIT 1`))[0];
    if (!r) return fallback;
    return {
      name: r.org_name || fallback.name, registrationNo: r.org_registration_no || fallback.registrationNo,
      representative: r.org_representative || fallback.representative,
      address: r.org_address || fallback.address, phone: r.org_phone || fallback.phone,
    };
  } catch (err: any) {
    console.warn("[settlement] 기관 정보 조회 실패 (기본값으로 계속):", err?.message);
    return fallback;
  }
}

interface NoteContext {
  year: number;
  fy: FiscalYear;
  org: OrgInfo;
  programs: any[];
  funds: Awaited<ReturnType<typeof fundSummary>>;
  loans: number;
  basicNetAsset: number;
  major: Awaited<ReturnType<typeof majorTransactions>>;
  rules: any[];
  correction: number;
}

interface NoteDef {
  key: string;
  no: number;
  title: string;
  /** 근거 조문 */
  clause: string;
  /** 자동 표. 화면이 이 이름으로 표를 그린다 */
  table?: "netAssets" | "nature" | "funds" | "major" | "rules";
  /** 사실을 사람이 확인해야 하는 문구 */
  confirm?: boolean;
  body: (c: NoteContext) => string;
}

export const NOTE_DEFS: NoteDef[] = [
  {
    key: "n01", no: 1, title: "법인의 개황 및 주요사업 내용", clause: "제41조 1호",
    body: (c) => {
      const charter = c.programs.filter((p) => p.charterRef);
      const outside = c.programs.filter((p) => !p.charterRef && p.actual > 0);
      return [
        `${c.org.name}은(는) 민법 제32조 및 교육부 소관 비영리법인의 설립 및 감독에 관한 규칙에 따라 설립된 사단법인으로, 교육 기회 확대와 교육 공동체 활성화를 위한 환경 개선에 기여하는 것을 목적으로 합니다.`,
        c.org.address ? `주된 사무소는 ${c.org.address}에 있고 대표자는 ${c.org.representative}입니다.` : "",
        "",
        "주요사업(정관 제4조)",
        ...charter.map((p, i) => `${i + 1}. ${p.name}`),
        ...(outside.length ? ["", "그 밖에 수행한 사업", ...outside.map((p, i) => `${i + 1}. ${p.name}`)] : []),
      ].filter((line, i, all) => line !== "" || all[i - 1] !== "").join("\n");
    },
  },
  {
    key: "n02", no: 2, title: "채택한 회계정책", clause: "제41조 2호",
    body: (c) => [
      "법인은 공익법인회계기준에 따라 재무제표를 작성합니다.",
      `1. 회계기간은 ${c.fy.startDate}부터 ${c.fy.endDate}까지입니다.${c.fy.startDate.slice(5) !== "01-01" ? " 장부 시작일 이전의 잔액은 개시 전표로 반영했고, 그 이전 기간의 수입과 지출은 포함하지 않았습니다." : ""}`,
      "2. 복식부기와 발생주의를 적용합니다.",
      "3. 계좌로 받은 기부금은 입금일에, 카드·CMS로 받은 기부금은 결제 승인 또는 출금 요청일에 수익으로 인식합니다. 결제 수수료는 입금 시 지급수수료로 처리합니다.",
      "4. 후원회원의 후원금은 기부금수익으로, 회원의 의무에 따른 회비는 회비수익으로 구분합니다.",
      "5. 사업비용은 사업수행비용, 일반관리비용, 모금비용으로 구분하고 성격에 따라 분배비용, 인력비용, 시설비용, 기타비용으로 구분합니다.",
      "6. 유형자산은 취득가액 100만 원을 넘고 1년을 넘게 사용하는 자산으로 하며 정액법으로 5년간 상각합니다.",
      "7. 부가가치세 매입세액은 비용에 포함합니다.",
      "8. 고유목적사업준비금은 설정하지 않습니다.",
    ].join("\n"),
  },
  {
    key: "n03", no: 3, title: "사용이 제한된 현금및현금성자산", clause: "제41조 3호", table: "funds",
    body: (c) => {
      const held = c.funds.filter((f) => f.restricted && f.closing > 0);
      if (!held.length) return "사용이 제한된 현금및현금성자산은 없습니다.";
      return `기부자나 보조 기관이 용도를 정한 재원의 미사용 잔액은 ${held.map((f) => `${f.name} ${won(f.closing)}`).join(", ")}입니다.`;
    },
  },
  {
    key: "n04", no: 4, title: "차입금 등 상환해야 하는 부채", clause: "제41조 4호",
    body: (c) => c.loans ? `회계연도 말 차입금 잔액은 ${won(c.loans)}입니다. 차입처, 이자율, 만기를 적어 주세요.` : "회계연도 말 차입금은 없습니다.",
  },
  { key: "n05", no: 5, title: "현물기부", clause: "제41조 5호", confirm: true, body: () => "해당 회계연도에 받은 현물기부는 없습니다." },
  { key: "n06", no: 6, title: "제공한 담보·보증", clause: "제41조 6호", confirm: true, body: () => "제공한 담보와 보증은 없습니다." },
  { key: "n07", no: 7, title: "특수관계인과의 중요한 거래", clause: "제41조 7호", confirm: true, body: () => "특수관계인과의 중요한 거래는 없습니다." },
  {
    key: "n08", no: 8, title: "총자산 또는 사업수익의 10% 이상 거래", clause: "제41조 8호", table: "major",
    body: (c) => c.major.rows.length
      ? `기준 금액은 ${won(c.major.threshold)}이며 해당 거래는 아래 표와 같습니다.`
      : "해당 거래는 없습니다.",
  },
  { key: "n09", no: 9, title: "진행 중인 소송", clause: "제41조 9호", confirm: true, body: () => "회계연도 말 현재 진행 중인 소송 사건은 없습니다." },
  {
    key: "n10", no: 10, title: "회계정책·회계추정의 변경과 오류수정", clause: "제41조 10호", confirm: true,
    body: (c) => c.correction
      ? `전기오류수정 금액 ${won(Math.abs(c.correction))}이 있습니다. 내용을 적어 주세요.`
      : "회계정책과 회계추정의 변경, 오류수정은 없습니다.",
  },
  {
    key: "n11", no: 11, title: "기본순자산의 취득원가와 공정가치", clause: "제41조 11호", confirm: true,
    body: (c) => c.basicNetAsset
      ? `기본순자산은 ${won(c.basicNetAsset)}이며 현금성 자산으로 보유하고 있어 취득원가와 공정가치의 차이는 없습니다.`
      : "장부에 기록된 기본순자산은 없습니다.",
  },
  { key: "n12", no: 12, title: "순자산의 변동", clause: "제41조 12호", table: "netAssets", body: () => "순자산의 변동 내용은 아래 표와 같습니다." },
  { key: "n13", no: 13, title: "유형자산 재평가차액", clause: "제41조 13호", body: () => "유형자산을 재평가하지 않았습니다." },
  { key: "n14", no: 14, title: "유가증권의 취득원가와 공정가치", clause: "제41조 14호", confirm: true, body: () => "보유한 유가증권은 없습니다." },
  { key: "n15", no: 15, title: "그 밖의 중요한 사항", clause: "제41조 15호", confirm: true, body: () => "해당 사항은 없습니다." },
  {
    key: "n16", no: 16, title: "사업비용의 성격별 구분", clause: "제27조", table: "nature",
    body: () => "운영성과표의 사업비용은 기능별로 표시되어 있습니다. 이를 성격별로 구분한 내용은 아래 표와 같습니다.",
  },
  {
    key: "n17", no: 17, title: "공통비용의 배분 기준", clause: "제30조", table: "rules",
    body: (c) => c.rules.length
      ? "여러 활동에 관련된 비용은 아래 기준으로 배분했고, 회계기간 동안 같은 기준을 적용했습니다."
      : "등록된 배분 기준이 없습니다. 인건비와 임차료처럼 여러 활동에 걸친 비용이 있으면 장부 기준 정보의 배분 규칙에 기준을 등록해 주세요.",
  },
];

/** 사업별 계획·실적과 집행액 */
export async function loadProgramReports(year: number, fy: FiscalYear | undefined) {
  const programs = rowsOf(await db.execute(sql`
    SELECT id, code, name, charter_ref, segment, is_active FROM ledger_programs ORDER BY sort_order, id`));
  const reports = new Map<number, any>();
  for (const r of rowsOf(await db.execute(sql`SELECT * FROM ledger_program_reports WHERE year = ${year}`))) {
    reports.set(Number(r.program_id), r);
  }
  const actual = new Map<number, number>();
  if (fy) {
    for (const r of rowsOf(await db.execute(sql`
      SELECT l.program_id, COALESCE(SUM(l.debit - l.credit), 0)::bigint AS amount
        FROM voucher_lines l
        JOIN vouchers v ON v.id = l.voucher_id
        JOIN account_codes a ON a.code = l.account_code
       WHERE v.status = 'approved' AND v.is_template = FALSE AND l.program_id IS NOT NULL
         AND a.kind = 'expense' AND v.voucher_date BETWEEN ${fy.startDate} AND ${fy.endDate}
       GROUP BY l.program_id`))) actual.set(Number(r.program_id), Number(r.amount) || 0);
  }
  const planned = new Map<number, number>();
  for (const r of rowsOf(await db.execute(sql`
    SELECT s.program_id, COALESCE(SUM(s.amount), 0)::bigint AS amount
      FROM budget_line_splits s
      JOIN budget_lines l ON l.id = s.line_id
      JOIN budget_plans p ON p.id = l.plan_id
     WHERE p.fiscal_year = ${year} AND s.program_id IS NOT NULL
     GROUP BY s.program_id`))) planned.set(Number(r.program_id), Number(r.amount) || 0);

  return programs.map((p: any) => {
    const id = Number(p.id);
    const r = reports.get(id);
    return {
      id, code: p.code, name: p.name, charterRef: p.charter_ref, isActive: p.is_active === true || p.is_active === "t",
      planTarget: r?.plan_target ?? "", planPeriod: r?.plan_period ?? "", planBody: r?.plan_body ?? "",
      resultBody: r?.result_body ?? "", events: r?.events == null ? null : Number(r.events),
      beneficiaries: r?.beneficiaries == null ? null : Number(r.beneficiaries),
      planned: planned.get(id) ?? 0, actual: actual.get(id) ?? 0,
    };
  });
}

/** 재산목록과 장부 잔액 대조 */
export async function loadProperty(year: number, asOf: string) {
  const items = rowsOf(await db.execute(sql`
    SELECT id, property_class, account_code, name, detail, quantity, amount, note, sort_order
      FROM ledger_property_items WHERE year = ${year} ORDER BY property_class, sort_order, id`)).map((r: any) => ({
    id: Number(r.id), propertyClass: r.property_class, accountCode: r.account_code, name: r.name, detail: r.detail,
    quantity: r.quantity, amount: Number(r.amount) || 0, note: r.note,
  }));
  const balances = await assetBalances(asOf);
  const codes = new Set<string>([...balances.map((b) => b.code), ...items.map((i: any) => i.accountCode)]);
  const accountNames = new Map<string, string>();
  for (const r of rowsOf(await db.execute(sql`SELECT code, name FROM account_codes`))) accountNames.set(r.code, r.name);
  const reconcile = [...codes].sort().map((code) => {
    const ledger = balances.find((b) => b.code === code)?.amount ?? 0;
    const listed = items.filter((i: any) => i.accountCode === code).reduce((s: number, i: any) => s + i.amount, 0);
    return { code, name: accountNames.get(code) ?? code, ledger, listed, difference: listed - ledger };
  });
  const sum = (cls: string) => items.filter((i: any) => i.propertyClass === cls).reduce((s: number, i: any) => s + i.amount, 0);
  return {
    items, reconcile, matched: reconcile.every((r) => r.difference === 0),
    basicTotal: sum("basic"), ordinaryTotal: sum("ordinary"),
  };
}

export async function loadAllocationRules(activeOnly = false) {
  const rows = rowsOf(await db.execute(sql`
    SELECT id, name, basis, lines, is_active FROM ledger_allocation_rules ORDER BY id`));
  return rows
    .map((r: any) => ({
      id: Number(r.id), name: r.name, basis: r.basis ?? "", isActive: r.is_active === true || r.is_active === "t",
      lines: Array.isArray(r.lines) ? r.lines : [],
    }))
    .filter((r: any) => !activeOnly || r.isActive);
}

export async function loadSettlementRow(year: number) {
  const r = rowsOf(await db.execute(sql`SELECT * FROM ledger_settlements WHERE year = ${year}`))[0];
  return r ?? null;
}

const settlementView = (r: any) => ({
  status: (r?.status ?? "draft") as SettlementStatus,
  statusLabel: SETTLEMENT_LABEL[(r?.status ?? "draft") as SettlementStatus],
  checklist: r?.checklist ?? {},
  lockedAt: r?.locked_at ?? null, lockedByName: r?.locked_by_name ?? null,
  auditedOn: r?.audited_on ?? null, auditorName: r?.auditor_name ?? null, auditOpinion: r?.audit_opinion ?? null,
  boardOn: r?.board_on ?? null, boardNote: r?.board_note ?? null,
  assemblyOn: r?.assembly_on ?? null, assemblyNote: r?.assembly_note ?? null,
  submittedOn: r?.submitted_on ?? null, submittedTo: r?.submitted_to ?? null, submittedNote: r?.submitted_note ?? null,
});

/** 서류 전체를 계산한다. 승인본 여부는 부르는 쪽이 판단한다. */
export async function buildPackage(year: number) {
  const statements = await yearStatements(year);
  if (!statements) return null;
  const { fy, previous, balance, operating } = statements;
  const org = await loadOrgInfo();
  const [nature, netAssets, funds, settlement, programs, property, rules] = [
    await natureBreakdown(fy.startDate, fy.endDate),
    await netAssetChanges(fy),
    await fundSummary(fy),
    await settlementStatement(fy),
    await loadProgramReports(year, fy),
    await loadProperty(year, fy.endDate),
    await loadAllocationRules(true),
  ];
  const major = await majorTransactions(fy, balance.totals.assets.total, operating.summary.businessRevenue);
  const nextYear = year + 1;
  const nextBudget = await budgetStatement(nextYear);
  const nextPrograms = await loadProgramReports(nextYear, undefined);

  const rowAmount = (key: string) => balance.rows.find((r) => r.key === key)?.current.total ?? 0;
  const context: NoteContext = {
    year, fy, org, programs, funds, major, rules,
    loans: rowAmount("liability.2016") + rowAmount("liability.2021"),
    basicNetAsset: rowAmount("net.basic"),
    correction: 0,
  };
  const correctionRows = operating.rows.filter((r) => r.accountCode === "4024" || r.key.endsWith(".4024") || r.key.endsWith(".5054"));
  context.correction = correctionRows.reduce((s, r) => s + r.current.total, 0);

  const saved = new Map<string, any>();
  for (const r of rowsOf(await db.execute(sql`SELECT note_key, body, updated_at, updated_by_name FROM ledger_notes WHERE year = ${year}`))) {
    saved.set(r.note_key, r);
  }
  const notes = NOTE_DEFS.map((d) => {
    const s = saved.get(d.key);
    return {
      key: d.key, no: d.no, title: d.title, clause: d.clause, table: d.table ?? null, confirm: !!d.confirm,
      body: s?.body ?? d.body(context), saved: !!s, updatedAt: s?.updated_at ?? null, updatedByName: s?.updated_by_name ?? null,
    };
  });

  return {
    year, org, period: { from: fy.startDate, to: fy.endDate }, previousYear: previous?.year ?? null,
    balance, operating, nature, netAssets, funds, major, notes, settlement, programs, property, rules,
    next: { year: nextYear, budget: nextBudget, programs: nextPrograms },
    generatedAt: new Date().toISOString(),
  };
}

export interface CheckItem {
  key: string;
  label: string;
  /** ok 통과, warn 확인 권장, block 확정 불가 */
  state: "ok" | "warn" | "block";
  detail: string;
}

/** 결산 점검표. block이 하나라도 있으면 확정할 수 없다. */
export async function settlementChecks(year: number): Promise<{ items: CheckItem[]; blockers: number } | null> {
  const fy = fiscalYearOf(await loadFiscalYears(), year);
  if (!fy) return null;
  const items: CheckItem[] = [];
  const add = (key: string, label: string, state: CheckItem["state"], detail: string) => items.push({ key, label, state, detail });
  const count = async (q: any) => Number(rowsOf(await db.execute(q))[0]?.n ?? 0);

  const status = await closeStatus(year);
  const lastMonth = status?.months[status.months.length - 1];
  add("months_closed", "모든 달 마감", lastMonth?.closed ? "ok" : "block",
    lastMonth?.closed ? "마지막 달까지 마감했습니다" : `마감 기준일 ${fy.closedThrough ?? "없음"}. ${fy.endDate}까지 마감해야 합니다`);

  const open = await count(sql`
    SELECT COUNT(*)::int AS n FROM vouchers
     WHERE is_template = FALSE AND status IN ('draft','submitted','rejected')
       AND voucher_date BETWEEN ${fy.startDate} AND ${fy.endDate}`);
  add("open_vouchers", "미결 전표 없음", open ? "block" : "ok", open ? `미결 전표 ${open}건` : "없습니다");

  let pending = { total: 0, blocked: 0 };
  try { pending = await pendingStatus(); } catch (err: any) { console.warn("[settlement] 미반영 집계 실패:", err?.message); }
  const unposted = pending.total + pending.blocked;
  add("unposted", "장부 미반영 없음", unposted ? "block" : "ok",
    unposted ? `미반영 ${pending.total}건, 마감된 달 미반영 ${pending.blocked}건` : "없습니다");

  const totals = rowsOf(await db.execute(sql`
    SELECT COALESCE(SUM(l.debit), 0)::bigint AS dr, COALESCE(SUM(l.credit), 0)::bigint AS cr
      FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
     WHERE v.status = 'approved' AND v.is_template = FALSE AND v.voucher_date <= ${fy.endDate}`))[0];
  const matched = Number(totals?.dr) === Number(totals?.cr);
  add("trial_balance", "차변·대변 합계 일치", matched ? "ok" : "block", matched ? "일치합니다" : "합계가 다릅니다");

  const suspense = await suspenseBalances(fy.endDate);
  add("suspense", "가지급금·가수금 정리", suspense.length ? "block" : "ok",
    suspense.length ? suspense.map((s) => `${s.name} ${won(s.amount)}`).join(", ") : "잔액이 없습니다");

  const bankPending = await count(sql`
    SELECT COUNT(*)::int AS n FROM bank_transactions
     WHERE status = 'pending' AND txn_date BETWEEN ${fy.startDate} AND ${fy.endDate}`);
  add("bank_pending", "통장 거래 분류 완료", bankPending ? "block" : "ok", bankPending ? `미확인 ${bankPending}건` : "없습니다");

  /* 전용계좌 장부 잔액과 통장 잔액 */
  const book = rowsOf(await db.execute(sql`
    SELECT COALESCE(SUM(l.debit - l.credit), 0)::bigint AS balance
      FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
      JOIN account_codes a ON a.code = l.account_code
     WHERE a.system_role = 'cash_default' AND v.status = 'approved' AND v.is_template = FALSE
       AND v.voucher_date <= ${fy.endDate}`))[0];
  const bank = rowsOf(await db.execute(sql`
    SELECT b.balance_after, b.txn_date
      FROM bank_transactions b
      JOIN bank_imports i ON i.id = b.import_id
      JOIN account_codes a ON a.code = i.account_code AND a.system_role = 'cash_default'
     WHERE b.balance_after IS NOT NULL AND b.txn_date <= ${fy.endDate}
     ORDER BY b.txn_date DESC, b.id DESC LIMIT 1`))[0];
  if (!bank) {
    add("bank_balance", "전용계좌 잔액 일치", "warn", "연말까지의 통장 파일을 올려 잔액을 대조해 주세요");
  } else {
    const difference = Number(bank.balance_after) - (Number(book?.balance) || 0);
    add("bank_balance", "전용계좌 잔액 일치", difference ? "block" : "ok",
      difference ? `통장 ${won(Number(bank.balance_after))}, 장부 ${won(Number(book?.balance))}, 차이 ${won(difference)}` : "일치합니다");
  }

  const unpaid = await count(sql`
    SELECT COUNT(*)::int AS n FROM approval_requests
     WHERE status = 'approved' AND payment_status = 'unpaid' AND fiscal_year = ${year}`);
  add("unpaid", "미지급 결재", unpaid ? "warn" : "ok",
    unpaid ? `${unpaid}건. 연말 전에 의무가 생긴 비용이면 미지급금 전표가 필요합니다` : "없습니다");

  const refund = await count(sql`
    SELECT COUNT(*)::int AS n FROM approval_requests WHERE refund_status = 'required' AND fiscal_year = ${year}`);
  add("refund", "반환 확인 대기", refund ? "warn" : "ok", refund ? `${refund}건` : "없습니다");

  const receivable = rowsOf(await db.execute(sql`
    SELECT COALESCE(SUM(l.debit - l.credit), 0)::bigint AS balance
      FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
      JOIN account_codes a ON a.code = l.account_code
     WHERE a.system_role = 'settlement_receivable' AND v.status = 'approved' AND v.is_template = FALSE
       AND v.voucher_date <= ${fy.endDate}`))[0];
  const settlementLeft = Number(receivable?.balance) || 0;
  add("settlement_receivable", "결제 정산 미수금", settlementLeft ? "warn" : "ok",
    settlementLeft ? `${won(settlementLeft)}. 연초 입금분이면 그대로 두고, 수수료면 전표로 정리해 주세요` : "없습니다");

  const opening = await count(sql`
    SELECT COUNT(*)::int AS n FROM vouchers
     WHERE voucher_type = 'opening' AND status = 'approved' AND voucher_date BETWEEN ${fy.startDate} AND ${fy.endDate}`);
  const previous = fiscalYearOf(await loadFiscalYears(), year - 1);
  if (!previous) add("opening", "개시 잔액 입력", opening ? "ok" : "warn", opening ? "입력했습니다" : "장부 시작일 잔액의 개시 전표가 없습니다");

  const mixed = await count(sql`
    SELECT COUNT(*)::int AS n FROM (
      SELECT l.voucher_id FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
       WHERE v.status = 'approved' AND v.voucher_date BETWEEN ${fy.startDate} AND ${fy.endDate}
         AND l.program_id IS NOT NULL
       GROUP BY l.voucher_id
      HAVING COUNT(DISTINCT l.segment) > 1) x`);
  if (mixed) add("mixed_segment", "부문이 섞인 전표", "warn", `${mixed}건. 전표 전체가 기타사업으로 집계됩니다`);

  const gap = await charterGap(year);
  if (gap && gap.outside > 0) {
    add("charter", "정관 근거 없는 사업", "warn", `사업수행비용의 ${gap.outsideRate}%(${won(gap.outside)})가 정관 제4조에 없는 사업입니다`);
  }

  const property = await loadProperty(year, fy.endDate);
  add("property", "재산목록과 장부 일치", property.matched ? "ok" : "block",
    property.matched ? "일치합니다" : property.reconcile.filter((r) => r.difference).map((r) => `${r.name} 차이 ${won(r.difference)}`).join(", "));

  const noteKeys = new Set(rowsOf(await db.execute(sql`SELECT note_key FROM ledger_notes WHERE year = ${year}`)).map((r: any) => r.note_key));
  const unconfirmed = NOTE_DEFS.filter((d) => d.confirm && !noteKeys.has(d.key));
  add("notes", "주석 문구 확인", unconfirmed.length ? "block" : "ok",
    unconfirmed.length ? `확인하지 않은 주석 ${unconfirmed.length}개: ${unconfirmed.map((d) => d.no).join(", ")}번` : "확인했습니다");

  const reports = await loadProgramReports(year, fy);
  const missing = reports.filter((r: any) => r.actual > 0 && !r.resultBody.trim());
  add("programs", "사업실적 작성", missing.length ? "block" : "ok",
    missing.length ? `지출이 있는 사업 ${missing.length}개의 실적이 비어 있습니다` : "작성했습니다");

  const next = await budgetStatement(year + 1);
  add("next_budget", `${year + 1}년 예산안`, !next ? "warn" : next.status === "approved" ? "ok" : "warn",
    !next ? "예산안이 없습니다. 제출 서류에 필요합니다" : next.status === "approved" ? "승인됐습니다" : "아직 승인 전입니다");

  const row = await loadSettlementRow(year);
  const checklist = row?.checklist ?? {};
  for (const m of MANUAL_CHECKS) {
    add(`manual_${m.key}`, m.label, checklist[m.key] === true ? "ok" : "block", checklist[m.key] === true ? "확인했습니다" : "확인이 필요합니다");
  }

  return { items, blockers: items.filter((i) => i.state === "block").length };
}

/** 화면용 결산 현황. 승인본이 있으면 승인본을 돌려준다. */
export async function settlementOverview(year: number, opts: { live?: boolean } = {}) {
  const row = await loadSettlementRow(year);
  const view = settlementView(row);
  const frozen = !!row?.snapshot && !opts.live;
  const pack = frozen ? row.snapshot : await buildPackage(year);
  if (!pack) return null;
  return { settlement: view, frozen, package: pack, manualChecks: MANUAL_CHECKS };
}
