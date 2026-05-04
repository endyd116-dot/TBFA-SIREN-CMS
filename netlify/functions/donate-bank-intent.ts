// netlify/functions/donate-bank-intent.ts
// ★ Phase M-4: 직접 계좌이체 일시후원 신청
// - 사용자가 "직접 계좌이체 선택 → 입금자명 입력 → 제출" 시 호출
// - donations.status = 'pending_bank'
// - 관리자가 은행 거래내역 확인 후 수동으로 'completed' 전환 (M-15)

import { db, donations, generateTransactionId } from "../../db";
import { eq } from "drizzle-orm";
import { donationPolicies } from "../../db/schema";
import { authenticateUser } from "../../lib/auth";
import {
  created, badRequest, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logUserAction } from "../../lib/audit";
import { notifyAllOperators } from "../../lib/notify";

export const config = { path: "/api/donate-bank-intent" };

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  try {
    const body: any = await parseJson(req);
    if (!body) return badRequest("요청 본문이 비어있습니다");

    const name = String(body.name || "").trim().slice(0, 50);
    const phone = String(body.phone || "").trim().slice(0, 20);
    const email = String(body.email || "").trim().slice(0, 100);
    const amount = Number(body.amount);
    const isAnonymous = !!body.isAnonymous;
    const depositorName = String(body.depositorName || body.bankDepositorName || name).trim().slice(0, 50);

    if (!name) return badRequest("이름은 필수입니다");
    if (!phone) return badRequest("연락처는 필수입니다");
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return badRequest("올바른 이메일을 입력해주세요");
    }
    if (!Number.isFinite(amount) || amount < 1000 || amount > 100000000) {
      return badRequest("금액은 1,000원 ~ 1억원 사이여야 합니다");
    }
    if (!depositorName) return badRequest("입금자명을 입력해주세요");

    /* 로그인 사용자면 연결 */
    const auth = authenticateUser(req);
    const memberId = auth?.uid ?? null;

    /* 계좌 정책 조회 */
    const [policy] = await db.select().from(donationPolicies).where(eq(donationPolicies.id, 1)).limit(1);
    const bankName = (policy as any)?.bankName || "국민은행";
    const bankAccountNo = (policy as any)?.bankAccountNo || "(계좌번호 미등록)";
    const bankAccountHolder = (policy as any)?.bankAccountHolder || "(사)교사유가족협의회";
    const bankGuideText = (policy as any)?.bankGuideText || "입금 확인까지 1~3일 이내 소요됩니다.";

    /* DB 저장 (pending_bank 상태) */
    const transactionId = generateTransactionId();
    const insertData: any = {
      memberId,
      donorName: name,
      donorPhone: phone,
      donorEmail: email,
      amount,
      type: "onetime",
      payMethod: "bank",
      status: "pending_bank",
      transactionId,
      pgProvider: "manual",
      isAnonymous,
      receiptRequested: true,
      bankDepositorName: depositorName,
    };

    const [record] = await db.insert(donations).values(insertData).returning();

    /* 감사 로그 */
    await logUserAction(req, memberId, name, "donate_bank_intent", {
      target: `D-${(record as any).id}`,
      detail: { amount, email, phone, depositorName },
      success: true,
    });

// netlify/functions/donate-bank-intent.ts — 운영자 알림 try 블록 교체
    /* 운영자 알림 */
    try {
      await notifyAllOperators({
        category: "donation",
        severity: "info",
        title: "🏦 직접 계좌이체 신청 접수",
        message: `${depositorName}님의 ${amount.toLocaleString()}원 계좌이체 신청. 입금 확인 후 승인 필요.`,
        link: "/admin.html#donations",
        refTable: "donations",
        refId: (record as any).id,
      }, {
        /* ★ M-15: donation 담당 운영자 + super_admin에게만 발송 */
        category: "donation",
      });
    } catch (e) {
      console.warn("[donate-bank-intent] 알림 실패", e);
    }

    return created({
      donationId: `D-${String((record as any).id).padStart(7, "0")}`,
      bankInfo: {
        bankName,
        bankAccountNo,
        bankAccountHolder,
        guideText: bankGuideText,
        amount,
        depositorName,
      },
    }, "계좌이체 신청이 접수되었습니다");
  } catch (err) {
    console.error("[donate-bank-intent]", err);
    return serverError("신청 처리 중 오류가 발생했습니다", err);
  }
};