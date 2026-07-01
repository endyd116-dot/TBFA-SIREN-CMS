/**
 * Phase 22-D-R2 — 통장 거래내역 자동화 공용 라이브러리
 * 설계서: docs/milestones/2026-05-15-phase22d-r2-bank-reconciliation.md §1·§3
 *
 * 구성:
 *  1) 거래 행 정규화 + dedup_hash 생성 (파싱은 클라이언트 SheetJS — 서버는 정규화·해시·검증만)
 *  2) 거래내용 키워드 룰 (출금 계정과목 추정)
 *  3) 대사 엔진 — 입금 대사(묶음/개별/미매칭) + 출금 대사(거래처/AI/신뢰도)
 *  4) 거래처 자동 학습
 */
import { createHash } from "crypto";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { callGeminiJSON } from "./ai-gemini";

/* =========================================================
   1) 거래 행 정규화 + 중복 방지 해시
   ========================================================= */

/** 클라이언트가 SheetJS로 파싱해 보낸 원시 행 (IBK 입출식 예금 12컬럼) */
export interface RawBankRow {
  txnDateTime?: string;        // '2026-05-07 18:44:45' (거래일시)
  withdrawal?: string | number; // 출금 (콤마 숫자)
  deposit?: string | number;    // 입금 (콤마 숫자)
  balanceAfter?: string | number; // 거래후 잔액
  description?: string;          // 거래내용
  counterpartAccount?: string;   // 상대계좌번호
  counterpartBank?: string;      // 상대은행
  memo?: string;
  txnMethod?: string;            // 거래구분
  cmsCode?: string;              // CMS코드
  counterpartName?: string;      // 상대계좌예금주명
}

/** 정규화된 거래 — DB 적재 직전 형태 */
export interface NormalizedTxn {
  txnDate: string;             // 'YYYY-MM-DD'
  txnDateTime: string;         // 원본 일시 (해시·표시용)
  amount: number;              // 출금 음수 / 입금 양수
  txnType: "debit" | "credit"; // debit=출금, credit=입금
  description: string;
  counterpartAccount: string | null;
  counterpartBank: string | null;
  counterpartName: string | null;
  txnMethod: string | null;
  memo: string | null;
  cmsCode: string | null;
  balanceAfter: number | null;
  dedupHash: string;
}

/** 콤마·공백·통화기호 제거 후 숫자화. 빈 값은 0 */
function parseAmount(v: string | number | undefined | null): number {
  if (v === undefined || v === null || v === "") return 0;
  if (typeof v === "number") return Math.round(v);
  const cleaned = String(v).replace(/[^0-9.\-]/g, "");
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : Math.round(n);
}

/** '2026-05-07 18:44:45' / '2026.05.07' / Date 직렬화 등 → 'YYYY-MM-DD' */
function parseDate(v: string | undefined): string {
  if (!v) return "";
  const s = String(v).trim();
  // 'YYYY-MM-DD' 또는 'YYYY.MM.DD' 또는 'YYYY/MM/DD' 선두 추출
  const m = s.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (m) {
    const [, y, mo, d] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // ISO 직렬화 형태 시도
  const dt = new Date(s);
  if (!isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
  return "";
}

/** 합계 행 판별 — 거래일시 비어 있고 '합계'/'계' 텍스트만 있는 행 */
function isSummaryRow(row: RawBankRow): boolean {
  const dt = parseDate(row.txnDateTime);
  if (dt) return false;
  const text = `${row.description || ""}${row.memo || ""}`.trim();
  return /합\s*계|^계$|소\s*계/.test(text);
}

/**
 * 원시 행 배열 → 정규화 + 합계행 제외 + dedup_hash 생성.
 * 같은 거래 판별: 거래일시 + amount + balance_after 조합 SHA-256.
 */
export function normalizeBankRows(rows: RawBankRow[]): {
  normalized: NormalizedTxn[];
  skippedSummary: number;
  skippedInvalid: number;
} {
  const normalized: NormalizedTxn[] = [];
  let skippedSummary = 0;
  let skippedInvalid = 0;

  for (const row of rows) {
    if (isSummaryRow(row)) { skippedSummary++; continue; }

    const txnDate = parseDate(row.txnDateTime);
    if (!txnDate) { skippedInvalid++; continue; }

    const withdrawal = parseAmount(row.withdrawal);
    const deposit    = parseAmount(row.deposit);
    if (withdrawal === 0 && deposit === 0) { skippedInvalid++; continue; }

    // 출금 음수 / 입금 양수 — 단일 amount 컬럼
    const amount   = deposit > 0 ? deposit : -withdrawal;
    const txnType  = deposit > 0 ? "credit" : "debit";
    const balance  = row.balanceAfter !== undefined ? parseAmount(row.balanceAfter) : null;
    const txnDateTime = String(row.txnDateTime || txnDate).trim();

    const dedupHash = createHash("sha256")
      .update(`${txnDateTime}|${amount}|${balance ?? ""}`)
      .digest("hex");

    normalized.push({
      txnDate,
      txnDateTime,
      amount,
      txnType,
      description:        String(row.description || "").trim(),
      counterpartAccount: row.counterpartAccount ? String(row.counterpartAccount).trim() : null,
      counterpartBank:    row.counterpartBank ? String(row.counterpartBank).trim() : null,
      counterpartName:    row.counterpartName ? String(row.counterpartName).trim() : null,
      txnMethod:          row.txnMethod ? String(row.txnMethod).trim() : null,
      memo:               row.memo ? String(row.memo).trim() : null,
      cmsCode:            row.cmsCode ? String(row.cmsCode).trim() : null,
      balanceAfter:       balance,
      dedupHash,
    });
  }

  return { normalized, skippedSummary, skippedInvalid };
}

/* =========================================================
   2) 거래내용 키워드 룰 — 출금 계정과목 추정 (AI 호출 전 1차 필터)
   ========================================================= */

/**
 * [키워드 정규식, category, 구체 계정과목 code, 신뢰도, 사유]
 * code: 세분 계정과목(예: 통신비 5032). 키워드가 큰 분류만 특정 가능하면 대분류 code(503 등).
 * 순서 중요 — 위에서부터 첫 적중 룰이 적용되므로 세분 키워드를 먼저 둔다.
 */
const KEYWORD_RULES: Array<{ re: RegExp; category: string; code: string; confidence: number; reason: string }> = [
  { re: /임대료|임차료|월세|보증금/,         category: "admin_ops",   code: "5031", confidence: 0.85, reason: "거래내용 키워드: 임차료 → 임차료(5031)" },
  { re: /통신|인터넷|KT|SKT|LG ?U|전화요금/,  category: "admin_ops",   code: "5032", confidence: 0.85, reason: "거래내용 키워드: 통신비 → 통신비(5032)" },
  { re: /GS25|CU|세븐일레븐|이마트|다이소|문구|소모품|사무용품/, category: "admin_ops", code: "5033", confidence: 0.80, reason: "거래내용 키워드: 편의점·소모품 → 사무용품비(5033)" },
  { re: /전기|가스|수도|공과금|한전|광열/,    category: "admin_ops",   code: "5034", confidence: 0.85, reason: "거래내용 키워드: 공과금 → 공과금/광열수도(5034)" },
  { re: /청소|관리비|경비|미화|CMS|수수료|이체수수료|펌뱅킹/, category: "admin_ops", code: "503", confidence: 0.78, reason: "거래내용 키워드: 청소·관리비·수수료 → 관리운영비(503)" },
  { re: /급여|인건비|상여|임금|4대보험|국민연금|건강보험/, category: "personnel", code: "5011", confidence: 0.88, reason: "거래내용 키워드: 급여·인건비 → 급여(5011)" },
  { re: /강사료|강연료|자문료|용역|외주|교육|상담/, category: "program",  code: "5021", confidence: 0.78, reason: "거래내용 키워드: 강사료·용역·교육 → 교육·상담비(5021)" },
  { re: /장학금|장학/,                       category: "program",     code: "5023", confidence: 0.80, reason: "거래내용 키워드: 장학금 → 장학금(5023)" },
  { re: /후원|기부|지원금 지급/,             category: "program",     code: "502",  confidence: 0.72, reason: "거래내용 키워드: 후원·기부 지급 → 사업비(502)" },
  { re: /광고|홍보/,                         category: "fundraising", code: "5041", confidence: 0.78, reason: "거래내용 키워드: 광고·홍보 → 홍보비(5041)" },
  { re: /모금|캠페인/,                       category: "fundraising", code: "5042", confidence: 0.75, reason: "거래내용 키워드: 모금·캠페인 → 모금행사비(5042)" },
];

/** 출금 거래내용으로 계정과목 추정 (룰 기반) — 구체 code 포함. 미적중 시 null */
export function classifyByKeyword(description: string, counterpartName?: string | null):
  { category: string; code: string; confidence: number; reason: string } | null {
  const text = `${description || ""} ${counterpartName || ""}`;
  for (const rule of KEYWORD_RULES) {
    if (rule.re.test(text)) {
      return { category: rule.category, code: rule.code, confidence: rule.confidence, reason: rule.reason };
    }
  }
  return null;
}

/* =========================================================
   3) 묶음 정산 감지
   ========================================================= */

const BATCH_KEYWORDS = /토스페이먼츠|토스|효성|효성에프엠에스|효성FMS|정산|PG정산|결제대행/i;

/** 입금 거래가 PG·CMS 묶음 정산인지 (counterpart_name·description 키워드) */
export function isBatchSettlement(txn: NormalizedTxn): boolean {
  if (txn.txnType !== "credit") return false;
  const text = `${txn.description || ""} ${txn.counterpartName || ""}`;
  return BATCH_KEYWORDS.test(text);
}

/* =========================================================
   4) 거래처 마스터 조회·학습
   ========================================================= */

export interface CounterpartyRow {
  id: number;
  name: string;
  account_no: string | null;
  bank_name: string | null;
  default_match_type: string | null;
  default_account_code: string | null;
  default_budget_line_id: number | null;
  txn_count: number;
}

/**
 * 거래처 마스터 조회 — 상대계좌번호 우선, 없으면 예금주명으로.
 * 계좌번호 없는 거래(CMS사용료 등) 대응 — name만으로도 매칭.
 */
export async function findCounterparty(
  accountNo: string | null,
  name: string | null,
): Promise<CounterpartyRow | null> {
  if (!accountNo && !name) return null;
  try {
    let r: any;
    if (accountNo) {
      r = await db.execute(sql`
        SELECT id, name, account_no, bank_name, default_match_type,
               default_account_code, default_budget_line_id, txn_count
        FROM counterparties
        WHERE account_no = ${accountNo} ${name ? sql`AND name = ${name}` : sql``}
        ORDER BY txn_count DESC LIMIT 1`);
      const hit = (r?.rows ?? r ?? [])[0];
      if (hit) return hit as CounterpartyRow;
    }
    if (name) {
      r = await db.execute(sql`
        SELECT id, name, account_no, bank_name, default_match_type,
               default_account_code, default_budget_line_id, txn_count
        FROM counterparties
        WHERE name = ${name}
        ORDER BY txn_count DESC LIMIT 1`);
      const hit = (r?.rows ?? r ?? [])[0];
      if (hit) return hit as CounterpartyRow;
    }
  } catch (e) {
    console.warn("[bank-reconcile] findCounterparty 실패:", e);
  }
  return null;
}

/**
 * 거래처 자동 학습 — 관리자 확정 시 호출.
 * 이미 있으면 txn_count++ + 룰 갱신, 없으면 신규 등록.
 */
export async function learnCounterparty(params: {
  name: string;
  accountNo: string | null;
  bankName: string | null;
  matchType: string;
  accountCode: string | null;
  budgetLineId: number | null;
  learnedBy: number | null;
}): Promise<{ id: number; created: boolean } | null> {
  const { name, accountNo, bankName, matchType, accountCode, budgetLineId, learnedBy } = params;
  if (!name) return null;
  try {
    // UNIQUE(account_no, name) — account_no NULL 허용 (name만으로도)
    const existing = await findCounterparty(accountNo, name);
    if (existing) {
      await db.execute(sql`
        UPDATE counterparties SET
          txn_count = txn_count + 1,
          default_match_type = ${matchType},
          default_account_code = ${accountCode},
          default_budget_line_id = ${budgetLineId},
          bank_name = COALESCE(${bankName}, bank_name),
          updated_at = NOW()
        WHERE id = ${existing.id}`);
      return { id: existing.id, created: false };
    }
    const r: any = await db.execute(sql`
      INSERT INTO counterparties
        (name, account_no, bank_name, default_match_type, default_account_code,
         default_budget_line_id, txn_count, learned_by, created_at, updated_at)
      VALUES
        (${name}, ${accountNo}, ${bankName}, ${matchType}, ${accountCode},
         ${budgetLineId}, 1, ${learnedBy}, NOW(), NOW())
      ON CONFLICT (account_no, name) DO UPDATE SET
        txn_count = counterparties.txn_count + 1,
        default_match_type = EXCLUDED.default_match_type,
        default_account_code = EXCLUDED.default_account_code,
        updated_at = NOW()
      RETURNING id`);
    const row = (r?.rows ?? r ?? [])[0];
    return row ? { id: Number(row.id), created: true } : null;
  } catch (e) {
    console.warn("[bank-reconcile] learnCounterparty 실패:", e);
    return null;
  }
}

/* =========================================================
   5) 입금 대사 — donations / other_revenues 매칭
   ========================================================= */

export interface IncomeMatchResult {
  matchType: "donation" | "donation_batch" | "revenue" | "pending";
  status: "confirmed" | "pending";
  donationId?: number | null;
  otherRevenueId?: number | null;
  counterpartyId?: number | null;
  confidence?: number;
  reasoning: string;
  /** 관리자 확인용 후보 (pending일 때) */
  candidates?: {
    donations?: Array<{ id: number; donorName: string; amount: number; createdAt: string }>;
    members?: Array<{ id: number; name: string; phone: string | null }>;
    batchExpected?: number;  // 묶음정산 — 기간 후원 합계
    batchActual?: number;    // 실제 입금액
  };
}

/**
 * 입금 거래 1건 대사.
 * ① 묶음 정산 감지 → 기간 합계 대조
 * ② 개별 매칭 — donations [금액 일치 + ±3일 + 입금자명 유사]
 * ③ 미매칭 → 거래처 타입별 후보 (donation/revenue) + 회원 후보
 */
export async function reconcileIncome(
  txn: NormalizedTxn,
  threshold: number = 0.75,
): Promise<IncomeMatchResult> {
  const amount = Math.abs(txn.amount);

  // ── ① 묶음 정산 ──────────────────────────────────────────
  if (isBatchSettlement(txn)) {
    try {
      // 입금일 기준 ±35일 내 토스·효성 승인 후원 합계 (월 정산 가정)
      const r: any = await db.execute(sql`
        SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS cnt
        FROM donations
        WHERE status = 'completed'
          AND (pg_provider ILIKE '%toss%' OR pg_provider ILIKE '%hyosung%'
               OR pay_method ILIKE '%cms%' OR pay_method ILIKE '%card%')
          AND created_at BETWEEN (${txn.txnDate}::date - INTERVAL '35 days')
                             AND (${txn.txnDate}::date + INTERVAL '1 day')`);
      const row = (r?.rows ?? r ?? [])[0] || {};
      const expected = Number(row.total || 0);
      const matched = expected === amount;
      return {
        matchType: "donation_batch",
        status: matched ? "confirmed" : "pending",
        confidence: matched ? 1 : 0.5,
        reasoning: matched
          ? `묶음 정산 확인 — 기간 후원 합계 ${expected.toLocaleString()}원과 입금액 일치`
          : `묶음 정산 추정 — 기간 후원 합계 ${expected.toLocaleString()}원 ≠ 입금 ${amount.toLocaleString()}원 (관리자 확인 필요)`,
        candidates: { batchExpected: expected, batchActual: amount },
      };
    } catch (e) {
      console.warn("[bank-reconcile] 묶음정산 대조 실패:", e);
      return { matchType: "donation_batch", status: "pending", confidence: 0.5,
        reasoning: "묶음 정산 추정 — 합계 대조 실패, 관리자 확인 필요" };
    }
  }

  // ── ② 개별 매칭 — donations ──────────────────────────────
  try {
    const r: any = await db.execute(sql`
      SELECT id, donor_name, amount, created_at, bank_depositor_name
      FROM donations
      WHERE status = 'completed'
        AND amount = ${amount}
        AND created_at BETWEEN (${txn.txnDate}::date - INTERVAL '3 days')
                           AND (${txn.txnDate}::date + INTERVAL '3 days')
      ORDER BY created_at DESC
      LIMIT 10`);
    const rows = (r?.rows ?? r ?? []) as any[];

    if (rows.length > 0) {
      // 입금자명 유사도 — counterpart_name과 donor_name/bank_depositor_name 비교
      const incomingName = (txn.counterpartName || "").replace(/\s/g, "");
      const scored = rows.map(d => {
        const dn = String(d.donor_name || "").replace(/\s/g, "");
        const bn = String(d.bank_depositor_name || "").replace(/\s/g, "");
        let nameScore = 0;
        if (incomingName && (dn === incomingName || bn === incomingName)) nameScore = 1;
        else if (incomingName && (dn.includes(incomingName) || incomingName.includes(dn)
                                  || bn.includes(incomingName) || incomingName.includes(bn))) nameScore = 0.7;
        // 금액·날짜는 이미 일치 → base 0.6, 이름으로 가산
        const confidence = 0.6 + nameScore * 0.4;
        return { d, confidence };
      }).sort((a, b) => b.confidence - a.confidence);

      const best = scored[0];
      if (best.confidence >= threshold && scored.filter(s => s.confidence === best.confidence).length === 1) {
        return {
          matchType: "donation",
          status: "confirmed",
          donationId: Number(best.d.id),
          confidence: best.confidence,
          reasoning: `개별 후원 매칭 — 금액 ${amount.toLocaleString()}원 + 날짜 ±3일 + 입금자명 일치 (${best.d.donor_name})`,
        };
      }
      // 후보는 있으나 신뢰도 부족 or 동점 → 관리자 확인
      return {
        matchType: "pending",
        status: "pending",
        confidence: best.confidence,
        reasoning: `후원 후보 ${rows.length}건 (금액·날짜 일치, 입금자명 확인 필요)`,
        candidates: {
          donations: rows.map(d => ({
            id: Number(d.id), donorName: d.donor_name,
            amount: Number(d.amount), createdAt: String(d.created_at),
          })),
        },
      };
    }
  } catch (e) {
    console.warn("[bank-reconcile] 개별 후원 매칭 실패:", e);
  }

  // ── ③ 미매칭 입금 — 거래처 타입별 분기 ──────────────────
  const cp = await findCounterparty(txn.counterpartAccount, txn.counterpartName);

  if (cp && cp.default_match_type === "donation") {
    // 계좌 직접후원 가능성 — 입금자명 ↔ members 후보
    const members = await findMemberCandidates(txn.counterpartName);
    return {
      matchType: "pending",
      status: "pending",
      counterpartyId: cp.id,
      confidence: 0.6,
      reasoning: `계좌 직접후원 추정 — 학습된 거래처 '${cp.name}' (후원 타입). 회원 매칭 후 donations 등록 필요`,
      candidates: { members },
    };
  }

  if (cp && cp.default_match_type === "revenue") {
    return {
      matchType: "revenue",
      status: "pending",
      counterpartyId: cp.id,
      confidence: 0.7,
      reasoning: `후원 외 수입 추정 — 학습된 거래처 '${cp.name}' (매출 타입). other_revenues 등록 필요`,
    };
  }

  // 미등록 거래처 — 기본 매출 후보 + 회원 후보 동시 제시
  const members = await findMemberCandidates(txn.counterpartName);
  return {
    matchType: "pending",
    status: "pending",
    counterpartyId: cp?.id ?? null,
    confidence: 0.4,
    reasoning: members.length > 0
      ? `미매칭 입금 — 입금자명 '${txn.counterpartName}'와 유사한 회원 ${members.length}명. 후원 등록 또는 매출 등록 선택 필요`
      : `미매칭 입금 — 거래처 미등록. 후원·매출·무시 중 관리자 확인 필요`,
    candidates: { members },
  };
}

/** 입금자명 ↔ members 명단 후보 검색 (정확 일치 + 부분 일치) */
async function findMemberCandidates(name: string | null): Promise<
  Array<{ id: number; name: string; phone: string | null }>
> {
  if (!name) return [];
  const clean = name.replace(/\s/g, "");
  if (clean.length < 2) return [];
  try {
    const r: any = await db.execute(sql`
      SELECT id, name, phone FROM members
      WHERE REPLACE(name, ' ', '') = ${clean}
         OR REPLACE(name, ' ', '') ILIKE ${"%" + clean + "%"}
      ORDER BY (REPLACE(name, ' ', '') = ${clean}) DESC
      LIMIT 5`);
    return (r?.rows ?? r ?? []).map((m: any) => ({
      id: Number(m.id), name: m.name, phone: m.phone,
    }));
  } catch (e) {
    console.warn("[bank-reconcile] findMemberCandidates 실패:", e);
    return [];
  }
}

/* =========================================================
   5.5) 예산 관-항-목 연동 — 계정과목 → 예산 목 → 편성 라인
   ---------------------------------------------------------
   2026-07-01 additive: AI/키워드가 확정한 계정과목(account_code)을
   budget_account_code_map을 통해 예산 목(budget_accounts, level='목')으로 잇고,
   해당 회계연도(budget_plans.fiscal_year)의 편성 라인(budget_lines.budget_account_id=목)
   id를 반환한다. 매핑/편성이 없으면 null → 기존 동작 그대로 (fallback 안전).
   ========================================================= */

/**
 * 계정과목(accountCode) → 예산 목 → 해당 연도 편성 라인 id 해석.
 * @returns budget_lines.id | null (매핑·편성 없으면 null — 절대 throw 안 함)
 *
 * 조회 흐름:
 *  1) budget_account_code_map에서 accountCode에 매핑된 budget_account_id(목) 조회
 *  2) 그 목을 참조하는 budget_lines 중 planId가 해당 fiscalYear의 budget_plans에 속하는 행
 *     - status='approved' 플랜 우선, 그다음 최신 plan, budget_lines.id ASC
 */
export async function resolveBudgetLineByAccountCode(
  accountCode: string | null,
  fiscalYear: number,
): Promise<number | null> {
  if (!accountCode || !fiscalYear || !Number.isFinite(fiscalYear)) return null;
  try {
    const r: any = await db.execute(sql`
      SELECT bl.id AS id
      FROM budget_account_code_map bacm
      JOIN budget_lines bl        ON bl.budget_account_id = bacm.budget_account_id
      JOIN budget_plans bp        ON bp.id = bl.plan_id
      WHERE bacm.account_code = ${accountCode}
        AND bp.fiscal_year   = ${fiscalYear}
      ORDER BY (bp.status = 'approved') DESC, bp.id DESC, bl.id ASC
      LIMIT 1`);
    const row = (r?.rows ?? r ?? [])[0];
    return row?.id != null ? Number(row.id) : null;
  } catch (e) {
    console.warn("[bank-reconcile] resolveBudgetLineByAccountCode 실패:", e);
    return null;
  }
}

/* =========================================================
   6) 출금 대사 — vouchers 자동 생성
   ========================================================= */

export interface ExpenseMatchResult {
  matchType: "voucher";
  status: "confirmed" | "pending";
  counterpartyId?: number | null;
  accountCode: string | null;
  accountName: string | null;
  budgetLineId?: number | null;
  confidence: number;
  reasoning: string;
  /** confirmed일 때 — voucher draft 생성용 */
  autoCreateVoucher: boolean;
}

/**
 * 출금 거래 1건 대사.
 * ① 거래처 마스터 조회 → 학습된 default_account_code 자동 적용 (신뢰도 100%)
 * ② 미등록 → 키워드 룰 → 미적중 시 AI 분류
 * ③ 신뢰도 분기 (임계값 75%) → ≥75% voucher 자동 생성 / <75% 관리자 대기
 */
export async function reconcileExpense(
  txn: NormalizedTxn,
  threshold: number = 0.75,
): Promise<ExpenseMatchResult> {
  // 회계연도 — 거래일 연도 (예산 편성 매칭용)
  const fiscalYear = parseInt(String(txn.txnDate).slice(0, 4)) || 0;

  // ── ① 거래처 마스터 ──────────────────────────────────────
  const cp = await findCounterparty(txn.counterpartAccount, txn.counterpartName);
  if (cp && cp.default_match_type === "voucher" && cp.default_account_code) {
    const accountName = await lookupAccountName(cp.default_account_code);
    // 학습된 예산 라인 우선, 없으면 계정과목→예산 목→편성 라인으로 보완 (additive)
    const budgetLineId = cp.default_budget_line_id
      ?? await resolveBudgetLineByAccountCode(cp.default_account_code, fiscalYear);
    return {
      matchType: "voucher",
      status: "confirmed",
      counterpartyId: cp.id,
      accountCode: cp.default_account_code,
      accountName,
      budgetLineId: budgetLineId ?? undefined,
      confidence: 1,
      reasoning: `학습된 거래처 '${cp.name}' — 계정과목 ${cp.default_account_code} 자동 적용`,
      autoCreateVoucher: true,
    };
  }

  // ── ② 키워드 룰 ─────────────────────────────────────────
  const kw = classifyByKeyword(txn.description, txn.counterpartName);
  if (kw) {
    // 키워드가 특정한 구체 계정과목 우선 — 없거나 비활성 코드면 대분류 대표 계정으로 폴백
    let account: { code: string; name: string } | null = null;
    const kwName = await lookupAccountName(kw.code);
    if (kwName) account = { code: kw.code, name: kwName };
    if (!account) account = await pickAccountByCategory(kw.category);
    const branch = kw.confidence >= threshold;
    // 예산 관-항-목 연동 — 계정과목 → 예산 목 → 편성 라인 (없으면 null, 기존 동작 유지)
    const budgetLineId = account?.code
      ? await resolveBudgetLineByAccountCode(account.code, fiscalYear)
      : null;
    return {
      matchType: "voucher",
      status: branch ? "confirmed" : "pending",
      counterpartyId: cp?.id ?? null,
      accountCode: account?.code ?? null,
      accountName: account?.name ?? null,
      budgetLineId: budgetLineId ?? undefined,
      confidence: kw.confidence,
      reasoning: kw.reason,
      autoCreateVoucher: branch && !!account,
    };
  }

  // ── ③ AI 분류 ───────────────────────────────────────────
  const ai = await classifyExpenseByAI(txn);
  const branch = ai.confidence >= threshold;
  const account = ai.accountCode
    ? { code: ai.accountCode, name: await lookupAccountName(ai.accountCode) }
    : await pickAccountByCategory(ai.category);
  // 예산 관-항-목 연동 — 계정과목 → 예산 목 → 편성 라인 (없으면 null, 기존 동작 유지)
  const aiBudgetLineId = account?.code
    ? await resolveBudgetLineByAccountCode(account.code, fiscalYear)
    : null;
  return {
    matchType: "voucher",
    status: branch ? "confirmed" : "pending",
    counterpartyId: cp?.id ?? null,
    accountCode: account?.code ?? null,
    accountName: account?.name ?? null,
    budgetLineId: aiBudgetLineId ?? undefined,
    confidence: ai.confidence,
    reasoning: ai.reasoning,
    autoCreateVoucher: branch && !!account,
  };
}

/** account_codes에서 code → name 조회 */
async function lookupAccountName(code: string | null): Promise<string | null> {
  if (!code) return null;
  try {
    const r: any = await db.execute(sql`
      SELECT name FROM account_codes WHERE code = ${code} LIMIT 1`);
    return (r?.rows ?? r ?? [])[0]?.name ?? null;
  } catch { return null; }
}

/** category로 대표 계정과목 1개 선택 (sort_order 빠른 활성 항목) */
async function pickAccountByCategory(category: string): Promise<{ code: string; name: string } | null> {
  try {
    const r: any = await db.execute(sql`
      SELECT code, name FROM account_codes
      WHERE category = ${category} AND is_active = TRUE
      ORDER BY sort_order ASC, id ASC LIMIT 1`);
    const row = (r?.rows ?? r ?? [])[0];
    return row ? { code: row.code, name: row.name } : null;
  } catch { return null; }
}

/** Gemini로 출금 계정과목 추정 — 실패 시 휴리스틱 폴백 */
async function classifyExpenseByAI(txn: NormalizedTxn): Promise<{
  category: string; accountCode: string | null; confidence: number; reasoning: string;
}> {
  // account_codes 후보 목록 — 대분류>소분류 계층으로 AI에 제공 (출금이므로 수익 계정 제외)
  let codeTree = "";
  try {
    const r: any = await db.execute(sql`
      SELECT code, name, category, parent_code FROM account_codes
      WHERE is_active = TRUE AND category <> 'income'
      ORDER BY category, sort_order, code`);
    const rows: any[] = r?.rows ?? r ?? [];
    const CAT_LABEL: Record<string, string> = {
      personnel: "인건비", program: "사업비", admin_ops: "관리운영비", fundraising: "모금비",
    };
    const parents = rows.filter((c) => !c.parent_code);
    const lines: string[] = [];
    for (const p of parents) {
      const children = rows.filter((c) => c.parent_code === p.code);
      const childStr = children.map((c) => `${c.code} ${c.name}`).join(", ");
      lines.push(`[${CAT_LABEL[p.category] || p.category}] 대분류 ${p.code} ${p.name}`
        + (childStr ? ` → 소분류: ${childStr}` : ""));
    }
    // 부모 없이 떠 있는 소분류도 노출
    const orphans = rows.filter((c) => c.parent_code && !parents.some((p) => p.code === c.parent_code));
    for (const o of orphans) lines.push(`[${CAT_LABEL[o.category] || o.category}] ${o.code} ${o.name}`);
    codeTree = lines.join("\n");
  } catch { /* 폴백으로 계속 */ }

  const prompt = `당신은 NPO(비영리단체) 회계 담당자입니다. 통장 출금 거래 1건을 보고 가장 적합한 계정과목을 고르세요.

[거래 정보]
거래내용: ${txn.description || "(없음)"}
거래처(예금주명): ${txn.counterpartName || "(없음)"}
금액: ${Math.abs(txn.amount).toLocaleString()}원
거래구분: ${txn.txnMethod || "(없음)"}

[계정과목 체계 — 대분류 아래 소분류]
${codeTree || "(목록 없음 — category만 추정)"}

[분류 방법]
1. 먼저 거래 성격으로 대분류(인건비/사업비/관리운영비/모금비)를 정한다.
2. 그 대분류 안에서 거래내용에 가장 잘 맞는 소분류 코드를 고른다.
3. 소분류까지 특정하기 어려우면 대분류 코드를 그대로 쓴다.
4. 어느 대분류인지도 불확실하면 accountCode는 null, confidence는 0.5 미만으로 둔다.

다음 JSON만 출력:
{"accountCode":"소분류 또는 대분류 코드, 불확실하면 null","category":"personnel|program|admin_ops|fundraising","confidence":0.0~1.0,"reasoning":"왜 이 계정과목인지 한 줄"}`;

  try {
    const res = await callGeminiJSON<{
      accountCode: string | null; category: string; confidence: number; reasoning: string;
    }>(prompt, { temperature: 0.2 });
    if (res.ok && res.data) {
      const d = res.data;
      const conf = Math.max(0, Math.min(1, Number(d.confidence) || 0));
      return {
        category: d.category || "admin_ops",
        accountCode: d.accountCode && d.accountCode !== "null" ? d.accountCode : null,
        confidence: conf,
        reasoning: `AI 분류: ${d.reasoning || "계정과목 추정"}`,
      };
    }
  } catch (e) {
    console.warn("[bank-reconcile] AI 분류 실패:", e);
  }
  // 폴백 — 휴리스틱 (관리운영비, 낮은 신뢰도)
  return {
    category: "admin_ops",
    accountCode: null,
    confidence: 0.4,
    reasoning: "AI 분류 실패 — 관리운영비로 추정 (관리자 확인 필요)",
  };
}
