// lib/hyosung-merge.ts
// M2 — Phase 3: 효성 흡수 정책 (merge 보존 + 신규 회원 자동 생성)
// DESIGN_PHASE3.md §5.3·§5.4 화이트리스트 정책 강제.
// 이 파일 수정 권한은 Main 채팅(Opus 4.7)에만 있음.

import type { HyosungContractRow } from "./hyosung-parser";
import {
  mapContractRowToMemberHyosungUpdate,
  toContractStatusCode,
} from "./hyosung-mapper";

/* =========================================================
   §5.4 SIREN 고유 컬럼 화이트리스트 (절대 덮어쓰지 않음)
   효성 데이터 흡수 시 이 컬럼들은 항상 보존.
   ========================================================= */
export const SIREN_PRESERVED_COLUMNS = [
  "memo",
  "blacklistedAt",
  "blacklistedBy",
  "blacklistReason",
  "gradeId",
  "gradeAssignedAt",
  "gradeLocked",
  "eligibilityType",
  "signupSourceId",
  "email",
  "passwordHash",
  "churnRiskScore",
  "churnRiskLevel",
  "churnLastEvaluatedAt",
  "churnSignals",
  "lastReengageEmailAt",
  "totalDonationAmount",
  "regularMonthsCount",
  "nextBillingDate",
  "billingDay",
  "billingRetryCount",
  "billingLastFailedAt",
] as const;

/* =========================================================
   1. 기존 회원에 효성 contracts 데이터 merge
      §5.4 정책:
      - 효성 운영 컬럼(hyosung_*) → 효성 값으로 갱신
      - SIREN 고유 컬럼 → 보존 (이 함수에서 반환하지 않음)
      - 이름·연락처 → 효성 값이 비어있지 않을 때만 갱신
      반환 객체를 drizzle UPDATE에 바로 spread 가능.
   ========================================================= */
export function buildContractMergeUpdate(
  row: HyosungContractRow,
): Record<string, unknown> {
  const hyosungFields = mapContractRowToMemberHyosungUpdate(row);

  const basicUpdate: Record<string, unknown> = {};
  if (row.memberName) basicUpdate.name = row.memberName;
  if (row.phone)       basicUpdate.phone = row.phone;

  return {
    ...hyosungFields,
    ...basicUpdate,
    updatedAt: new Date(),
  };
}

/* =========================================================
   2. 효성 미매칭 회원 신규 자동 생성 페이로드
      §5.3 정책:
      - signupSources 'hyosung_csv' ID를 인자로 받음
      - donorType = 'regular' (계약 사용 중) or 'prospect' (중지)
      - email·passwordHash는 호출부(admin-donation-import.ts)에서 생성
   ========================================================= */
export function buildNewMemberFromContract(
  row: HyosungContractRow,
  signupSourceId: number | null,
): {
  name: string;
  phone: string | null;
  signupSourceId: number | null;
  hyosungMemberNo: number;
  hyosungContractStatus: string | null;
  hyosungPaymentMethod: string | null;
  hyosungPaymentTool: string | null;
  hyosungBankInfo: string | null;
  hyosungPromiseDay: number | null;
  hyosungSyncedAt: Date;
  donorType: "regular" | "prospect" | "none";
  donorChannels: string[];
  prospectSubtype: "cancelled" | "onetime" | null;
  donorEvaluatedAt: Date;
} {
  const hyosungFields = mapContractRowToMemberHyosungUpdate(row);
  const typeEval = evaluateDonorTypeFromContract(row.contractStatus);

  return {
    name: row.memberName || `효성회원_${row.memberNo}`,
    phone: row.phone,
    signupSourceId,
    ...hyosungFields,
    donorType: typeEval.donorType,
    donorChannels: typeEval.donorType === "regular" ? ["hyosung"] : [],
    prospectSubtype: typeEval.prospectSubtype,
    donorEvaluatedAt: new Date(),
  };
}

/* =========================================================
   3. contractStatus → donor_type 평가
      contracts 업로드 직후 즉각 반영용 단순 평가.
      cron-donor-status-sync는 별도 bulk SQL로 전체 재평가.
   ========================================================= */
export function evaluateDonorTypeFromContract(contractStatus: string | null): {
  donorType: "regular" | "prospect" | "none";
  prospectSubtype: "cancelled" | "onetime" | null;
  channelAction: "add_hyosung" | "remove_hyosung";
} {
  const code = toContractStatusCode(contractStatus);
  if (code === "active") {
    return { donorType: "regular", prospectSubtype: null, channelAction: "add_hyosung" };
  }
  if (
    code === "cancelled" ||
    code === "expired" ||
    code === "suspended" ||
    code === "terminated"
  ) {
    return { donorType: "prospect", prospectSubtype: "cancelled", channelAction: "remove_hyosung" };
  }
  return { donorType: "none", prospectSubtype: null, channelAction: "remove_hyosung" };
}

/* =========================================================
   4. donorChannels 배열에서 hyosung 채널 추가/제거 (불변 처리)
   ========================================================= */
export function patchDonorChannels(
  existing: string[],
  action: "add_hyosung" | "remove_hyosung",
): string[] {
  const set = new Set(existing);
  if (action === "add_hyosung") set.add("hyosung");
  else set.delete("hyosung");
  return Array.from(set);
}

/* =========================================================
   5. hyosungContracts UPSERT용 고유키 헬퍼
      memberNo unique constraint 기반 — upsert 시 conflict 기준
   ========================================================= */
export function getContractUpsertKey(memberNo: number): { memberNo: number } {
  return { memberNo };
}
