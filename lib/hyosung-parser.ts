// lib/hyosung-parser.ts
// ★ Phase 1: 효성 CMS+ CSV 파서
// 계약정보 + 청구목록 + 수납내역 3종 양식 공통 파서
// Phone/금액/날짜 정규화 + UTF-8/EUC-KR 감지

/* =========================================================
   타입 정의
   ========================================================= */

export interface HyosungContractRow {
  memberNo: number;
  memberName: string | null;
  phone: string | null;           // 정규화된 "01024341756"
  phoneOriginal: string | null;   // 원본 "010-2434-1756"
  memberStatus: string | null;    // 사용/중지
  contractStatus: string | null;  // 사용/중지/기간만료
  promiseDay: number | null;
  paymentMethod: string | null;   // 자동결제/미등록
  paymentTool: string | null;     // CMS/카드
  paymentInfo: string | null;     // "451*****720(농협은행)"
  accountHolder: string | null;
  registrationStatus: string | null;  // 신청완료/기간만료/신청중
  agreementStatus: string | null;     // 동의
  electronicContract: string | null;
  productName: string | null;     // 정기후원/일시후원/후원회비
  productAmount: number | null;
  billingStart: string | null;    // ISO "2024-07-18"
  billingEnd: string | null;      // ISO "9999-12-31"
  managerName: string | null;
  memberType: string | null;
  billingAuto: string | null;
  sendMethod: string | null;
  rawData: Record<string, any>;
}

export interface HyosungBillingRow {
  memberNo: number;
  memberName: string | null;
  phone: string | null;
  phoneOriginal: string | null;
  contractNo: string | null;
  billingMonth: string;           // "2026/05"
  firstBillingMonth: string | null;
  productName: string | null;
  billingAmount: number | null;
  supplyAmount: number | null;
  vatAmount: number | null;
  receivedAmount: number;
  unpaidAmount: number;
  cancelAmount: number;
  refundAmount: number;
  receiptStatus: string | null;   // 완납/미납/수납대기
  paymentStatus: string | null;   // 대기/결제중
  paymentMethod: string | null;
  paymentTool: string | null;
  promiseDay: number | null;
  paymentDate: string | null;     // ISO
  billingType: string | null;
  unreceivedHandling: string | null;
  memo: string | null;
  paymentResult: string | null;
  rawData: Record<string, any>;
}

export interface ParseResult<T> {
  rows: T[];
  totalCount: number;
  errors: Array<{ rowIndex: number; error: string; raw: Record<string, any> }>;
}

/* =========================================================
   유틸: 인코딩 감지
   ========================================================= */

/**
 * Buffer의 UTF-8 BOM을 감지하거나, 한글 바이트 패턴으로 EUC-KR/UTF-8 추정
 */
export function detectEncoding(buffer: Buffer): 'utf-8' | 'euc-kr' {
  // UTF-8 BOM
  if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
    return 'utf-8';
  }

  // 샘플 1KB로 UTF-8 valid 여부 체크
  const sample = buffer.slice(0, Math.min(1024, buffer.length));
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(sample);
    // 한글이 유효하게 나오면 UTF-8
    if (/[\uAC00-\uD7A3]/.test(decoded)) return 'utf-8';
  } catch {
    // UTF-8 디코딩 실패 → EUC-KR 가능성 높음
  }

  return 'euc-kr';
}

/**
 * Buffer를 지정된 인코딩으로 문자열 변환
 * Node.js 환경 전용 (iconv-lite 없이 UTF-8만 기본 지원)
 * EUC-KR은 향후 iconv-lite 설치 필요 시 대응
 */
export function bufferToText(buffer: Buffer, encoding: 'utf-8' | 'euc-kr' = 'utf-8'): string {
  if (encoding === 'utf-8') {
    // BOM 제거
    if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
      return buffer.slice(3).toString('utf-8');
    }
    return buffer.toString('utf-8');
  }

  // EUC-KR: Node.js 기본 미지원 → iconv-lite 필요
  // Phase 1에서는 UTF-8만 지원. EUC-KR 파일은 사용자에게 UTF-8 변환 안내
  throw new Error('EUC-KR encoding detected. Please save CSV as UTF-8 and try again.');
}

/* =========================================================
   유틸: CSV 파싱
   ========================================================= */

/**
 * CSV 텍스트를 2차원 배열로 변환
 * - 따옴표 이스케이프 처리
 * - 개행/콤마 포함 필드 처리
 * - 빈 줄 제거
 */
export function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        // 이스케이프된 따옴표
        currentField += '"';
        i += 2;
        continue;
      }
      if (ch === '"') {
        inQuotes = false;
        i++;
        continue;
      }
      currentField += ch;
      i++;
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
        continue;
      }
      if (ch === ',') {
        currentRow.push(currentField);
        currentField = '';
        i++;
        continue;
      }
      if (ch === '\r' && next === '\n') {
        currentRow.push(currentField);
        if (currentRow.some(f => f.trim() !== '')) rows.push(currentRow);
        currentRow = [];
        currentField = '';
        i += 2;
        continue;
      }
      if (ch === '\n' || ch === '\r') {
        currentRow.push(currentField);
        if (currentRow.some(f => f.trim() !== '')) rows.push(currentRow);
        currentRow = [];
        currentField = '';
        i++;
        continue;
      }
      currentField += ch;
      i++;
    }
  }

  // 마지막 필드/행
  if (currentField !== '' || currentRow.length > 0) {
    currentRow.push(currentField);
    if (currentRow.some(f => f.trim() !== '')) rows.push(currentRow);
  }

  return rows;
}

/* =========================================================
   유틸: 데이터 정규화
   ========================================================= */

/**
 * 전화번호 정규화: 숫자만 추출
 * "010-2434-1756" → "01024341756"
 * "010 2434 1756" → "01024341756"
 * "+82-10-2434-1756" → "821024341756"
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '-') return null;
  const digits = trimmed.replace(/[^\d]/g, '');
  return digits.length >= 10 ? digits : null;
}

/**
 * 금액 정규화: 콤마 제거 후 정수
 * "20,000" → 20000
 * "20000" → 20000
 * "-" → null
 */
export function normalizeAmount(raw: string | null | undefined): number | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '-') return null;
  const cleaned = trimmed.replace(/,/g, '');
  const num = parseInt(cleaned, 10);
  return isNaN(num) ? null : num;
}

/**
 * 날짜 정규화: YYYY-MM-DD 형식 문자열로 반환 (DB INSERT용)
 * "2024-07-18" → "2024-07-18"
 * "2024/07/18" → "2024-07-18"
 * "9999-12-31" → "9999-12-31" (무기한)
 * "-" → null
 */
export function normalizeDate(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '-') return null;

  // YYYY-MM-DD 또는 YYYY/MM/DD
  const match = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!match) return null;

  const [, year, month, day] = match;
  const mm = month.padStart(2, '0');
  const dd = day.padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

/**
 * 정수 정규화
 */
export function normalizeInt(raw: string | null | undefined): number | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '-') return null;
  const num = parseInt(trimmed, 10);
  return isNaN(num) ? null : num;
}

/**
 * 문자열 정규화: 공백 정리 + 빈 값 null
 */
export function normalizeString(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '-') return null;
  return trimmed;
}

/* =========================================================
   유틸: 헤더 매핑
   ========================================================= */

/**
 * 한글 컬럼명 → snake_case 매핑
 * 효성 CMS+의 3종 양식에서 나타나는 모든 헤더
 */
const HEADER_MAP: Record<string, string> = {
  'NO.': 'no',
  'NO': 'no',
  '회원번호': 'member_no',
  '계약번호': 'contract_no',
  '회원명': 'member_name',
  '최초청구월': 'first_billing_month',
  '청구월': 'billing_month',
  '납부자 휴대전화': 'phone',
  '회원상태': 'member_status',
  '계약상태': 'contract_status',
  '약정일': 'promise_day',
  '결제방식': 'payment_method',
  '결제수단': 'payment_tool',
  '결제정보': 'payment_info',
  '예금주/명의자명': 'account_holder',
  '결제등록상태': 'registration_status',
  '동의여부': 'agreement_status',
  '전자계약': 'electronic_contract',
  '상품': 'product_name',
  '상품목록': 'product_name',
  '상품금액합': 'product_amount',
  '청구금액': 'billing_amount',
  '공급가액': 'supply_amount',
  '부가세': 'vat_amount',
  '수납금액': 'received_amount',
  '미납금액': 'unpaid_amount',
  '취소금액': 'cancel_amount',
  '환불금액': 'refund_amount',
  '수납상태': 'receipt_status',
  '결제상태': 'payment_status',
  '결제일(납부기간)': 'payment_date',
  '청구시작일': 'billing_start',
  '청구종료일': 'billing_end',
  '청구타입': 'billing_type',
  '미수처리상태': 'unreceived_handling',
  '청구완납일자': 'billing_completion_date',
  '비고': 'memo',
  '결제결과': 'payment_result',
  '담당관리자': 'manager_name',
  '회원구분': 'member_type',
  '청구자동생성': 'billing_auto',
  '발송방식': 'send_method',
  '청구생성일': 'created_date',
  '청구생성방식': 'created_method',
  '발송상태': 'send_status',
  '최종발송일': 'last_send_date',
};

/**
 * 헤더 행을 snake_case 키로 변환
 */
function mapHeaders(headers: string[]): string[] {
  return headers.map(h => {
    const clean = h.trim();
    return HEADER_MAP[clean] || clean.toLowerCase().replace(/[^\w]/g, '_');
  });
}

/* =========================================================
   파서: 계약정보
   ========================================================= */

/**
 * 계약정보 CSV 파싱
 * 헤더: NO.,회원번호,회원명,납부자 휴대전화,회원상태,계약상태,약정일,결제방식,결제수단,결제정보,예금주/명의자명,결제등록상태,동의여부,전자계약,상품목록,상품금액합,청구시작일,청구종료일,담당관리자,회원구분,청구자동생성,발송방식
 */
export function parseContractsCsv(text: string): ParseResult<HyosungContractRow> {
  const grid = parseCsvText(text);
  if (grid.length < 2) {
    return { rows: [], totalCount: 0, errors: [{ rowIndex: 0, error: 'Empty or header-only CSV', raw: {} }] };
  }

  const headers = mapHeaders(grid[0]);
  const dataRows = grid.slice(1);
  const rows: HyosungContractRow[] = [];
  const errors: Array<{ rowIndex: number; error: string; raw: Record<string, any> }> = [];

  dataRows.forEach((row, idx) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = row[i] !== undefined ? row[i].trim() : '';
    });

    try {
      const memberNo = normalizeInt(obj.member_no);
      if (memberNo === null) {
        errors.push({ rowIndex: idx + 2, error: 'Invalid member_no', raw: obj });
        return;
      }

      const phoneOriginal = normalizeString(obj.phone);
      const phone = normalizePhone(phoneOriginal);

      const parsed: HyosungContractRow = {
        memberNo,
        memberName: normalizeString(obj.member_name),
        phone,
        phoneOriginal,
        memberStatus: normalizeString(obj.member_status),
        contractStatus: normalizeString(obj.contract_status),
        promiseDay: normalizeInt(obj.promise_day),
        paymentMethod: normalizeString(obj.payment_method),
        paymentTool: normalizeString(obj.payment_tool),
        paymentInfo: normalizeString(obj.payment_info),
        accountHolder: normalizeString(obj.account_holder),
        registrationStatus: normalizeString(obj.registration_status),
        agreementStatus: normalizeString(obj.agreement_status),
        electronicContract: normalizeString(obj.electronic_contract),
        productName: normalizeString(obj.product_name),
        productAmount: normalizeAmount(obj.product_amount),
        billingStart: normalizeDate(obj.billing_start),
        billingEnd: normalizeDate(obj.billing_end),
        managerName: normalizeString(obj.manager_name),
        memberType: normalizeString(obj.member_type),
        billingAuto: normalizeString(obj.billing_auto),
        sendMethod: normalizeString(obj.send_method),
        rawData: { ...obj },
      };

      rows.push(parsed);
    } catch (err: any) {
      errors.push({ rowIndex: idx + 2, error: err.message || 'Parse error', raw: obj });
    }
  });

  return { rows, totalCount: dataRows.length, errors };
}

/* =========================================================
   파서: 청구/수납 내역 통합
   ========================================================= */

/**
 * 청구목록/수납내역 CSV 파싱 (컬럼 차이 흡수)
 * 수납내역 헤더: NO.,회원번호,계약번호,회원명,최초청구월,청구월,납부자 휴대전화,상품,수납상태,결제상태,결제방식,결제수단,약정일,결제일(납부기간),청구타입,미수처리상태,청구금액,공급가액,부가세,수납금액,미납금액,취소금액,환불금액,청구완납일자,비고,결제결과,회원구분,담당관리자
 * 청구목록 헤더: 유사하지만 일부 컬럼 없음
 */
export function parseBillingsCsv(text: string): ParseResult<HyosungBillingRow> {
  const grid = parseCsvText(text);
  if (grid.length < 2) {
    return { rows: [], totalCount: 0, errors: [{ rowIndex: 0, error: 'Empty or header-only CSV', raw: {} }] };
  }

  const headers = mapHeaders(grid[0]);
  const dataRows = grid.slice(1);
  const rows: HyosungBillingRow[] = [];
  const errors: Array<{ rowIndex: number; error: string; raw: Record<string, any> }> = [];

  dataRows.forEach((row, idx) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = row[i] !== undefined ? row[i].trim() : '';
    });

    try {
      const memberNo = normalizeInt(obj.member_no);
      if (memberNo === null) {
        errors.push({ rowIndex: idx + 2, error: 'Invalid member_no', raw: obj });
        return;
      }

      const billingMonth = normalizeString(obj.billing_month);
      if (!billingMonth) {
        errors.push({ rowIndex: idx + 2, error: 'Invalid billing_month', raw: obj });
        return;
      }

      const phoneOriginal = normalizeString(obj.phone);
      const phone = normalizePhone(phoneOriginal);

      const parsed: HyosungBillingRow = {
        memberNo,
        memberName: normalizeString(obj.member_name),
        phone,
        phoneOriginal,
        contractNo: normalizeString(obj.contract_no),
        billingMonth,
        firstBillingMonth: normalizeString(obj.first_billing_month),
        productName: normalizeString(obj.product_name),
        billingAmount: normalizeAmount(obj.billing_amount),
        supplyAmount: normalizeAmount(obj.supply_amount),
        vatAmount: normalizeAmount(obj.vat_amount),
        receivedAmount: normalizeAmount(obj.received_amount) || 0,
        unpaidAmount: normalizeAmount(obj.unpaid_amount) || 0,
        cancelAmount: normalizeAmount(obj.cancel_amount) || 0,
        refundAmount: normalizeAmount(obj.refund_amount) || 0,
        receiptStatus: normalizeString(obj.receipt_status),
        paymentStatus: normalizeString(obj.payment_status),
        paymentMethod: normalizeString(obj.payment_method),
        paymentTool: normalizeString(obj.payment_tool),
        promiseDay: normalizeInt(obj.promise_day),
        paymentDate: normalizeDate(obj.payment_date),
        billingType: normalizeString(obj.billing_type),
        unreceivedHandling: normalizeString(obj.unreceived_handling),
        memo: normalizeString(obj.memo),
        paymentResult: normalizeString(obj.payment_result),
        rawData: { ...obj },
      };

      rows.push(parsed);
    } catch (err: any) {
      errors.push({ rowIndex: idx + 2, error: err.message || 'Parse error', raw: obj });
    }
  });

  return { rows, totalCount: dataRows.length, errors };
}

/* =========================================================
   기타: 자동 감지 파서
   ========================================================= */

/**
 * CSV 헤더를 분석해서 계약정보/청구내역 중 어느 양식인지 감지
 */
export function detectCsvType(text: string): 'contracts' | 'billings' | 'unknown' {
  const firstLine = text.split('\n')[0] || '';

  // 계약정보 고유: "회원상태" + "계약상태" + "청구시작일"
  if (firstLine.includes('회원상태') && firstLine.includes('계약상태') && firstLine.includes('청구시작일')) {
    return 'contracts';
  }

  // 청구내역 고유: "청구월" + "수납상태"
  if (firstLine.includes('청구월') && firstLine.includes('수납상태')) {
    return 'billings';
  }

  return 'unknown';
}
