/**
 * SIREN — 영수증 번호 관리 (STEP H-2c)
 *
 * 형식: TBFA-{YYYY}-{donationId 6자리 0패딩}
 * 예시: TBFA-2026-000042
 *
 * 장점:
 *   - donation.id가 UNIQUE이므로 영수증 번호도 자동으로 UNIQUE 보장
 *   - 별도 시퀀스 테이블 불필요
 *   - 동시 발급 race condition 없음
 */
import { eq } from "drizzle-orm";
import { db, donations } from "../db";

/**
 * 영수증 번호 문자열 생성 (DB 저장 없이 순수 변환)
 */
export function buildReceiptNumber(donationId: number, year?: number): string {
  const y = year || new Date().getFullYear();
  const seq = String(donationId).padStart(6, "0");
  return `TBFA-${y}-${seq}`;
}

/**
 * 영수증 번호 발급 + DB 저장
 *
 * - 이미 발급되어 있으면 기존 번호를 그대로 반환 (isNew: false)
 * - 처음 발급이면 번호 생성 + receiptIssued / receiptIssuedAt / receiptNumber 저장
 *
 * @param donationId 후원 ID
 * @returns { receiptNumber, isNew }
 */
export async function issueReceiptNumber(
  donationId: number
): Promise<{ receiptNumber: string; isNew: boolean }> {
  const [d] = await db
    .select()
    .from(donations)
    .where(eq(donations.id, donationId))
    .limit(1);

  if (!d) {
    throw new Error("Donation not found: id=" + donationId);
  }

  /* 이미 발급된 영수증이 있으면 그대로 반환 */
  const existing = (d as any).receiptNumber;
  if (existing) {
    return { receiptNumber: existing, isNew: false };
  }

  /* 신규 발급 */
  const createdAt = (d as any).createdAt as Date | string;
  const year = new Date(createdAt).getFullYear();
  const receiptNumber = buildReceiptNumber(donationId, year);

  await db
    .update(donations)
    .set({
      receiptNumber,
      receiptIssued: true,
      receiptIssuedAt: new Date(),
      updatedAt: new Date(),
    } as any)
    .where(eq(donations.id, donationId));

  return { receiptNumber, isNew: true };
}