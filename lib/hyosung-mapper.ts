// lib/hyosung-mapper.ts
// M1 — Phase 3: 효성 CSV 파서 출력 → DB schema 컬럼 변환 라이브러리
// DESIGN_PHASE3.md §5.2 매핑 표가 SOT — 임의 변경 금지.
// 이 파일 수정 권한은 Main 채팅(Opus 4.7)에만 있음.

import type { HyosungContractRow, HyosungBillingRow } from "./hyosung-parser";
import { normalizeDate } from "./hyosung-parser";

/* =========================================================
   §5.2 주의: 결제방식·결제수단 cross-mapping
   ─────────────────────────────────────────────────────────
   효성 CSV 헤더명   | HyosungContractRow 필드  | schema 컬럼
   결제방식(자동결제/미등록) | .paymentMethod    | paymentTool
   결제수단(CMS/카드)       | .paymentTool      | paymentMethod
   파서(hyosung-parser.ts)와 schema.ts가 서로 다른 방향으로
   naming했기 때문에 매핑 시 swap 필수.
   ========================================================= */

/* ─────────────────────────────────────────────────────────
   1. 계약상태 한국어 → 영문 코드
      members.hyosungContractStatus에 저장. donor-status.ts가
      'active' | 'cancelled' | 'expired' 로 평가함.
      hyosungContracts.contractStatus는 한국어 원본 그대로 보존.
   ───────────────────────────────────────────────────────── */
export function toContractStatusCode(rawStatus: string | null | undefined): string | null {
  switch ((rawStatus || "").trim()) {
    case "사용":     return "active";
    case "중지":     return "cancelled";
    case "기간만료": return "expired";
    default:         return rawStatus ? rawStatus.trim() : null;
  }
}

/* ─────────────────────────────────────────────────────────
   내부 유틸: "YYYY-MM-DD" 문자열 → Date (timestamp mode:date 컬럼용)
   ───────────────────────────────────────────────────────── */
function toDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso + "T00:00:00Z");
  return isNaN(d.getTime()) ? null : d;
}

/* ─────────────────────────────────────────────────────────
   2. 계약정보 행 → hyosungContracts INSERT/UPSERT 페이로드
      §5.2 계약정보 22컬럼 전체 매핑.
   ───────────────────────────────────────────────────────── */
export function mapContractRowToInsert(
  row: HyosungContractRow,
  linkedMemberId?: number | null,
) {
  return {
    memberNo: row.memberNo,
    memberName: row.memberName,
    phone: row.phone,
    memberStatus: row.memberStatus,
    contractStatus: row.contractStatus,             // 한국어 원본 (UI 표시용)
    promiseDay: row.promiseDay,
    paymentMethod: row.paymentTool  ?? null,        // 결제수단(CMS/카드) — cross-mapping
    paymentTool:   row.paymentMethod ?? null,        // 결제방식(자동결제/미등록) — cross-mapping
    paymentInfo: row.paymentInfo,
    accountHolder: row.accountHolder,
    registrationStatus: row.registrationStatus,
    agreementStatus: row.agreementStatus,
    electronicContract: row.electronicContract,
    productName: row.productName,
    productAmount: row.productAmount,
    billingStart: toDate(row.billingStart),
    billingEnd: toDate(row.billingEnd),
    managerName: row.managerName,
    memberType: row.memberType,
    billingAuto: row.billingAuto,
    sendMethod: row.sendMethod,
    linkedMemberId: linkedMemberId ?? null,
    rawData: row.rawData,
  };
}

/* ─────────────────────────────────────────────────────────
   3. 계약정보 행 → members 테이블 효성 운영 컬럼 업데이트 페이로드
      M2 merge에서 기존 회원 UPDATE 시 사용.
      SIREN 고유 컬럼(memo·등급·블랙 등)은 여기에 포함 안 함.
   ───────────────────────────────────────────────────────── */
export function mapContractRowToMemberHyosungUpdate(row: HyosungContractRow): {
  hyosungMemberNo: number;
  hyosungContractStatus: string | null;
  hyosungPaymentMethod: string | null;
  hyosungPaymentTool: string | null;
  hyosungBankInfo: string | null;
  hyosungPromiseDay: number | null;
  hyosungSyncedAt: Date;
} {
  return {
    hyosungMemberNo: row.memberNo,
    hyosungContractStatus: toContractStatusCode(row.contractStatus), // 영문 코드
    hyosungPaymentMethod: row.paymentTool  ?? null,   // 결제수단(CMS/카드)
    hyosungPaymentTool:   row.paymentMethod ?? null,  // 결제방식(자동결제/미등록)
    hyosungBankInfo: row.paymentInfo ?? null,
    hyosungPromiseDay: row.promiseDay ?? null,
    hyosungSyncedAt: new Date(),
  };
}

/* ─────────────────────────────────────────────────────────
   4. 수납내역 행 → hyosungBillings INSERT/UPSERT 페이로드
      §5.2 수납내역 28컬럼 전체 매핑.
      billingCompletionDate는 HyosungBillingRow에 없어 rawData에서 추출.
      결제방식·결제수단 cross-mapping 동일하게 적용.
   ───────────────────────────────────────────────────────── */
export function mapBillingRowToInsert(
  row: HyosungBillingRow,
  linkedMemberId?: number | null,
  linkedDonationId?: number | null,
) {
  const completionDateStr = normalizeDate(
    (row.rawData as Record<string, any>)?.billing_completion_date,
  );
  const billingCompletionDate = completionDateStr ? new Date(completionDateStr) : null;

  return {
    memberNo: row.memberNo,
    contractNo: row.contractNo,
    memberName: row.memberName,
    billingMonth: row.billingMonth,
    firstBillingMonth: row.firstBillingMonth,
    phone: row.phone,
    productName: row.productName,
    billingAmount: row.billingAmount,
    supplyAmount: row.supplyAmount,
    vatAmount: row.vatAmount,
    receivedAmount: row.receivedAmount,
    unpaidAmount: row.unpaidAmount,
    cancelAmount: row.cancelAmount,
    refundAmount: row.refundAmount,
    receiptStatus: row.receiptStatus,
    paymentStatus: row.paymentStatus,
    paymentMethod: row.paymentTool  ?? null,    // 결제수단 — cross-mapping
    paymentTool:   row.paymentMethod ?? null,   // 결제방식 — cross-mapping
    promiseDay: row.promiseDay,
    paymentDate: toDate(row.paymentDate),
    billingType: row.billingType,
    unreceivedHandling: row.unreceivedHandling,
    billingCompletionDate,
    memo: row.memo,
    paymentResult: row.paymentResult,
    linkedDonationId: linkedDonationId ?? null,
    rawData: {
      ...(row.rawData as Record<string, any>),
      ...(linkedMemberId != null ? { _linkedMemberId: linkedMemberId } : {}),
    },
  };
}
