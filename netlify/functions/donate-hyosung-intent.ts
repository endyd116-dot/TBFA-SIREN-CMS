// netlify/functions/donate-hyosung-intent.ts
// ★ Phase M-4: 효성 CMS+ 정기후원 신청 의향 기록
// - 사용자가 "효성 CMS+ 선택 → 제출" 시 호출
// - donations.status = 'pending_hyosung'
// - 실제 등록은 사용자가 효성 외부 사이트에서 진행
// - 관리자가 효성 CSV 업로드 시(M-13) 이름+전화로 매칭하여 'completed' 전환

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

export const config = { path: "/api/donate-hyosung-intent" };

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

    if (!name) return badRequest("이름은 필수입니다");
    if (!phone) return badRequest("연락처는 필수입니다");
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return badRequest("올바른 이메일을 입력해주세요");
    }
    if (!Number.isFinite(amount) || amount < 1000 || amount > 100000000) {
      return badRequest("금액은 1,000원 ~ 1억원 사이여야 합니다");
    }

    /* 로그인 사용자면 연결 */
    const auth = authenticateUser(req);
    const memberId = auth?.uid ?? null;

    /* 정책에서 hyosungUrl 가져오기 */
    const [policy] = await db.select().from(donationPolicies).where(eq(donationPolicies.id, 1)).limit(1);
    const hyosungUrl = (policy as any)?.hyosungUrl
      || "https://ap.hyosungcmsplus.co.kr/external/shorten/20240709hAxVVDFECf";
    const guideText = (policy as any)?.hyosungGuideText
      || "효성 CMS+에서 등록한 경우 등록 완료까지 2~3일 정도 소요됩니다.";

    /* DB 저장 (pending_hyosung 상태) */
    const transactionId = generateTransactionId();
    const insertData: any = {
      memberId,
      donorName: name,
      donorPhone: phone,
      donorEmail: email,
      amount,
      type: "regular",
      payMethod: "cms",
      status: "pending_hyosung",
      transactionId,
      pgProvider: "hyosung_cms",
      isAnonymous,
      receiptRequested: true,
    };

    const [record] = await db.insert(donations).values(insertData).returning();

    /* 감사 로그 */
    await logUserAction(req, memberId, name, "donate_hyosung_intent", {
      target: `D-${(record as any).id}`,
      detail: { amount, email, phone },
      success: true,
    });

    /* 운영자 알림 (효성 신청 의향이 들어왔음을 알림) */
    try {
      await notifyAllOperators({
        category: "donation",
        severity: "info",
        title: "🏦 효성 CMS+ 신청 의향 접수",
        message: `${name}님이 월 ${amount.toLocaleString()}원 효성 CMS+ 정기후원 신청 의향을 보였습니다.`,
        link: "/admin.html#hyosung",
        refTable: "donations",
        refId: (record as any).id,
      });
    } catch (e) {
      console.warn("[donate-hyosung-intent] 알림 실패", e);
    }

    return created({
      donationId: `D-${String((record as any).id).padStart(7, "0")}`,
      hyosungUrl,
      guideText,
      autoRedirectSeconds: 5,
    }, "효성 CMS+ 신청 의향이 접수되었습니다");
  } catch (err) {
    console.error("[donate-hyosung-intent]", err);
    return serverError("신청 처리 중 오류가 발생했습니다", err);
  }
};