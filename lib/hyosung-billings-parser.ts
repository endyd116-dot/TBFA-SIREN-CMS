// lib/hyosung-billings-parser.ts
// D2 — Phase 3: 효성 수납내역 파싱 + DB 적재 helper 라이브러리
// 파싱 원시 함수는 lib/hyosung-parser.ts 위임, 이 파일은 DB 적재 로직 담당.
// DESIGN_PHASE3.md §5.2 수납내역 28컬럼 SOT — 임의 변경 금지.

export {
  parseBillingsCsv,
  type HyosungBillingRow,
  type ParseResult,
} from "./hyosung-parser";

export { mapBillingRowToInsert } from "./hyosung-mapper";

/* =========================================================
   billings 업로드 결과 타입
   ========================================================= */

export interface BillingsImportSummary {
  totalRows: number;
  billingsUpserted: number;
  donationsCreated: number;
  matched: number;
  unmatched: number;
  errors: { rowIndex: number; reason: string }[];
}
