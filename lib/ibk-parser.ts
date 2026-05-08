// lib/ibk-parser.ts
// ★ 6순위 #15: 기업은행(IBK) 거래내역 CSV 파서
// hyosung-parser.ts와 동일 인터페이스 패턴 (정규화 유틸 import 재사용)
// 기업은행 인터넷뱅킹 "거래내역 다운로드" 양식 다종 지원 (헤더 한글명 가변)

import {
  parseCsvText,
  normalizeAmount,
  normalizeDate,
  normalizeString,
  detectEncoding,
  bufferToText,
  type ParseResult,
} from "./hyosung-parser";

/* =========================================================
   타입 정의
   ========================================================= */

export interface IbkTransferRow {
  txDate: string | null;          // ISO "2026-05-09"
  txTime: string | null;          // "14:32:11" or null
  amountIn: number | null;        // 입금액 (deposit)
  amountOut: number | null;       // 출금액 (withdrawal)
  balance: number | null;         // 잔액
  depositorName: string | null;   // 입금자명 (보낸 사람)
  memo: string | null;            // 적요/내용
  branchInfo: string | null;      // 지점/취급점
  accountTail4: string | null;    // 입금자 계좌 끝4자리 (있을 때)
  rawData: Record<string, any>;
}

/* =========================================================
   유틸: 헤더 매핑
   ========================================================= */

/**
 * 기업은행 다양한 양식 헤더를 표준 키로 매핑
 * 양식별 변동 가능 — 동의어 다수 등록
 */
const IBK_HEADER_MAP: Record<string, string> = {
  /* 거래일시 */
  "거래일자": "tx_date",
  "거래일": "tx_date",
  "거래일시": "tx_datetime",
  "일자": "tx_date",
  "이체일": "tx_date",

  /* 거래시각 (분리된 경우) */
  "거래시각": "tx_time",
  "시각": "tx_time",
  "시간": "tx_time",

  /* 입금액 (받은 돈) */
  "입금액": "amount_in",
  "입금": "amount_in",
  "받은금액": "amount_in",
  "찾으신금액": "amount_out",   // 기업은행 일부 양식에서 "찾으신금액" = 출금액
  "맡기신금액": "amount_in",    // "맡기신금액" = 입금액

  /* 출금액 (보낸 돈) */
  "출금액": "amount_out",
  "출금": "amount_out",
  "보낸금액": "amount_out",

  /* 잔액 */
  "잔액": "balance",
  "거래후잔액": "balance",

  /* 입금자/송금자 */
  "입금자": "depositor",
  "입금자명": "depositor",
  "받는분": "depositor",
  "보낸분": "depositor",
  "보낸사람": "depositor",
  "송금인": "depositor",
  "거래자": "depositor",
  "이름": "depositor",

  /* 적요 */
  "적요": "memo",
  "내용": "memo",
  "거래내용": "memo",
  "통장표시": "memo",
  "메모": "memo",

  /* 지점/취급점 */
  "거래점": "branch",
  "취급점": "branch",
  "지점": "branch",

  /* 계좌번호 (송금 측) */
  "송금인계좌": "src_account",
  "보낸계좌": "src_account",
  "상대계좌": "src_account",
  "거래계좌": "src_account",
};

function mapIbkHeaders(headers: string[]): string[] {
  return headers.map(h => {
    const clean = h.trim().replace(/\s+/g, "");
    return IBK_HEADER_MAP[clean] || clean.toLowerCase().replace(/[^\w]/g, "_");
  });
}

/* =========================================================
   유틸: 거래일시 파싱
   "2026-05-09 14:32:11" → { date: "2026-05-09", time: "14:32:11" }
   "2026/05/09" → { date: "2026-05-09", time: null }
   ========================================================= */
function splitDateTime(raw: string | null): { date: string | null; time: string | null } {
  if (!raw) return { date: null, time: null };
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "-") return { date: null, time: null };

  /* 공백 또는 T 기준 분리 */
  const parts = trimmed.split(/[\sT]+/);
  const datePart = parts[0];
  const timePart = parts[1] || null;

  const date = normalizeDate(datePart);
  let time: string | null = null;
  if (timePart) {
    /* HH:MM:SS or HH:MM 매칭 */
    const m = timePart.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
    if (m) {
      const hh = m[1].padStart(2, "0");
      const mm = m[2].padStart(2, "0");
      const ss = (m[3] || "00").padStart(2, "0");
      time = `${hh}:${mm}:${ss}`;
    }
  }
  return { date, time };
}

/* =========================================================
   유틸: 계좌번호에서 끝4자리 추출
   "123-456-7890" → "7890"
   "451*****720" → null (마스킹)
   ========================================================= */
function extractAccountTail4(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length < 4) return null;
  /* 끝 4자리가 모두 숫자인지 확인 */
  return digits.slice(-4);
}

/* =========================================================
   파서: 기업은행 거래내역 CSV
   ========================================================= */

/**
 * 기업은행 거래내역 CSV 파싱
 * - 다양한 양식 지원 (헤더 동의어 매핑)
 * - 입금 거래만 후원 매칭 후보 (amount_in > 0)
 * - 출금 거래는 rawData 보존하되 결과에서 제외
 */
export function parseIbkTransfersCsv(text: string): ParseResult<IbkTransferRow> {
  const grid = parseCsvText(text);
  if (grid.length < 2) {
    return { rows: [], totalCount: 0, errors: [{ rowIndex: 0, error: "Empty or header-only CSV", raw: {} }] };
  }

  /* 기업은행 양식은 헤더가 1행 또는 2~3행 위쪽에 있을 수 있음.
     파일 첫 5행 중 "입금"/"출금"/"거래일" 키워드를 가진 행을 헤더로 탐색 */
  let headerIdx = 0;
  for (let i = 0; i < Math.min(5, grid.length); i++) {
    const joined = grid[i].join(" ");
    if (/입금|출금|거래일|적요|입금자|받는분|보낸분/.test(joined)) {
      headerIdx = i;
      break;
    }
  }

  const rawHeaders = grid[headerIdx];
  const headers = mapIbkHeaders(rawHeaders);
  const dataRows = grid.slice(headerIdx + 1);

  const rows: IbkTransferRow[] = [];
  const errors: Array<{ rowIndex: number; error: string; raw: Record<string, any> }> = [];

  dataRows.forEach((row, idx) => {
    /* 빈 행 스킵 */
    if (!row.some(f => f && f.trim() !== "")) return;

    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = row[i] !== undefined ? row[i].trim() : "";
    });

    try {
      /* 거래일시 — date + datetime 두 키 모두 시도 */
      let txDate: string | null = null;
      let txTime: string | null = null;
      if (obj.tx_datetime) {
        const split = splitDateTime(obj.tx_datetime);
        txDate = split.date;
        txTime = split.time;
      } else if (obj.tx_date) {
        const split = splitDateTime(obj.tx_date);
        txDate = split.date;
        txTime = split.time || normalizeString(obj.tx_time);
        /* tx_time 단독 컬럼이 있으면 보강 */
        if (!txTime && obj.tx_time) {
          const m = obj.tx_time.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
          if (m) {
            const hh = m[1].padStart(2, "0");
            const mm = m[2].padStart(2, "0");
            const ss = (m[3] || "00").padStart(2, "0");
            txTime = `${hh}:${mm}:${ss}`;
          }
        }
      }

      const amountIn = normalizeAmount(obj.amount_in);
      const amountOut = normalizeAmount(obj.amount_out);

      /* 입금 거래만 후원 후보. 출금/0원은 스킵 */
      if (!amountIn || amountIn <= 0) return;

      const parsed: IbkTransferRow = {
        txDate,
        txTime,
        amountIn,
        amountOut: amountOut ?? null,
        balance: normalizeAmount(obj.balance),
        depositorName: normalizeString(obj.depositor),
        memo: normalizeString(obj.memo),
        branchInfo: normalizeString(obj.branch),
        accountTail4: extractAccountTail4(obj.src_account),
        rawData: { ...obj },
      };

      /* 입금자명이 없으면 적요에서 추출 시도 (예: "홍길동" 또는 "타행이체 홍길동") */
      if (!parsed.depositorName && parsed.memo) {
        const m = parsed.memo.match(/[가-힣]{2,4}/);
        if (m) parsed.depositorName = m[0];
      }

      rows.push(parsed);
    } catch (err: any) {
      errors.push({ rowIndex: idx + headerIdx + 2, error: err?.message || "Parse error", raw: obj });
    }
  });

  return { rows, totalCount: rows.length, errors };
}

/* =========================================================
   재내보내기 — 외부 호출자가 한 모듈에서 가져갈 수 있도록
   ========================================================= */
export { detectEncoding, bufferToText };
export type { ParseResult };
