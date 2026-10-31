// lib/donation-bank.ts — 후원 계좌 정보 단일 출처 (2026-10-31)
// 값은 후원 정책 표(donation_policies#1 · 어드민 › 후원 관리 › 후원 정책)에서 운영자가 고친다.
// 홈 «후원 계좌 안내» 배너·후원 창 «가입 없이 계좌로 보내기» 안내·계좌이체 신청 결과가 같은 값을 쓴다. 표가 비면 아래 기본값.
import { sql } from "drizzle-orm";
import { db } from "../db";

export interface DonationBankInfo {
  bankName: string;
  accountNo: string;
  holder: string;
  guide: string;
}

export const DONATION_BANK_FALLBACK: DonationBankInfo = {
  bankName: "우리은행",
  accountNo: "1005-404-940572",
  holder: "사단법인 교사유가족협의회",
  guide: "입금 확인까지 1~3일 이내 소요될 수 있습니다. 입금자명을 정확히 입력해 주세요.",
};

export async function getDonationBankInfo(): Promise<DonationBankInfo> {
  try {
    const r: any = await db.execute(sql`
      SELECT bank_name, bank_account_no, bank_account_holder, bank_guide_text
        FROM donation_policies WHERE id = 1 LIMIT 1`);
    const p = (r?.rows ?? r ?? [])[0] || {};
    return {
      bankName: String(p.bank_name || DONATION_BANK_FALLBACK.bankName),
      accountNo: String(p.bank_account_no || DONATION_BANK_FALLBACK.accountNo),
      holder: String(p.bank_account_holder || DONATION_BANK_FALLBACK.holder),
      guide: String(p.bank_guide_text || DONATION_BANK_FALLBACK.guide),
    };
  } catch (e: any) {
    console.warn("[donation-bank] 후원 정책 조회 실패(기본값):", e?.message || e);
    return { ...DONATION_BANK_FALLBACK };
  }
}
