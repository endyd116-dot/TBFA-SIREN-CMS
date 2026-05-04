// netlify/functions/admin-churn-reengage.ts
// ★ Phase M-19-1: 후원자 재참여 유도 메일 발송
// ★ Pass 1-C 패치: admin.js 의 API 계약에 맞게 재작성
//
// POST /api/admin/churn-reengage
// Body 형식 (둘 중 하나):
//   { memberId: number, useAiMessage: true }      → AI 자동 생성
//   { memberId: number, customMessage: string }   → 운영자 직접 작성
//
// 정책:
//   1. members.agreeEmail === false 이면 발송 차단
//   2. lastReengageEmailAt 7일 이내면 발송 차단
//   3. 운영자 작성 시 50~600자 검증
//   4. 발송 후 lastReengageEmailAt 갱신
//   5. audit_logs 자동 기록
//   6. 권한: super_admin / operator 모두 가능
//
// 응답:
//   data: {
//     memberId, sentTo, messageSource: 'ai'|'custom'|'fallback', messageBody
//   }

import { eq } from "drizzle-orm";
import { db } from "../../db";
import { members } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, badRequest, notFound, forbidden, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { sendEmail, tplChurnReengage } from "../../lib/email";
import { logAdminAction } from "../../lib/audit";
import { callGeminiJSON } from "../../lib/ai-gemini";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const SIGNAL_LABEL_KO: Record<string, string> = {
  consecutive_fail: "정기 결제 연속 실패",
  long_inactive: "최근 35~60일간 결제 없음",
  very_long_inactive: "최근 60일 이상 결제 없음",
  no_recent_login: "90일간 로그인 없음",
  amount_decreasing: "후원 금액 감소 추세",
  billing_deactivated: "정기 결제 카드 비활성화",
  card_likely_expired: "카드 만료 가능성",
};

const FALLBACK_MESSAGE = (memberName: string) =>
  `${memberName}님, 오랜만에 안부 인사드립니다.

지금까지 보내주신 따뜻한 마음이 교사 유가족분들의 회복 여정에 큰 힘이 되었습니다.

사이렌은 지금도 유가족 심리 상담, 법률 자문, 자녀 장학 사업을 묵묵히 이어가고 있습니다.

${memberName}님의 안부가 늘 궁금합니다.
언제든 편안히 연락 주세요. 🎗`;

/* ─────────────────────────────────────────────────────
   AI 자동 메시지 생성
   - 성공 시 → 'ai' source 반환
   - 실패 시 → 'fallback' source 반환
   ───────────────────────────────────────────────────── */
async function generateAiMessage(
  memberName: string,
  signals: string[],
  totalAmount: number,
): Promise<{ text: string; source: "ai" | "fallback" }> {
  const signalsText = signals.map((s) => SIGNAL_LABEL_KO[s] || s).join(", ");

  const prompt = `당신은 NPO(교사유가족협의회)의 후원자 케어 담당자입니다.
다음 정보를 바탕으로 후원자에게 보낼 따뜻한 안부 메시지 본문을 JSON으로만 응답하세요. 코드블록은 사용하지 마세요.

# 후원자 정보
- 이름: ${memberName}
- 누적 후원금액: ₩${totalAmount.toLocaleString()}
- 감지된 신호: ${signalsText || "장기 미접속"}

# 응답 형식 (JSON only)
{
  "messageBody": "본문 (200~400자, 줄바꿈은 \\n 사용)"
}

# 작성 원칙
- 부담 주지 않는 안부 인사
- 후원 강요/재촉 절대 금지
- "결제 실패" "이탈" 같은 부정 표현 금지
- 협회의 최근 활동 한두 줄 자연스럽게 언급 (심리상담/법률자문/장학)
- 따뜻하고 진솔한 어조
- 마지막은 "언제든 편안히 연락 주세요" 류로 마무리`;

  try {
    const r = await callGeminiJSON(prompt, {
      temperature: 0.7,
      maxOutputTokens: 600,
    });
    if (r.ok && r.data?.messageBody) {
      const body = String(r.data.messageBody).trim();
      if (body.length >= 50 && body.length <= 600) {
        return { text: body, source: "ai" };
      }
    }
  } catch (e) {
    console.warn("[churn-reengage] AI 생성 실패, 폴백 사용:", e);
  }
  return { text: FALLBACK_MESSAGE(memberName), source: "fallback" };
}

/* ─────────────────────────────────────────────────────
   메인 핸들러
   ───────────────────────────────────────────────────── */
export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  const guard: any = await requireAdmin(req);
  if (!guard.ok) return guard.res;
  const { admin } = guard.ctx;

  try {
    const body = await parseJson(req);
    if (!body) return badRequest("요청 본문이 비어있습니다");

    const memberId = Number(body.memberId);
    if (!Number.isFinite(memberId) || memberId <= 0) {
      return badRequest("유효하지 않은 memberId");
    }

    /* 회원 조회 */
    const [m] = await db
      .select({
        id: members.id,
        name: members.name,
        email: members.email,
        status: members.status,
        agreeEmail: members.agreeEmail,
        churnSignals: members.churnSignals,
        churnRiskLevel: members.churnRiskLevel,
        totalDonationAmount: members.totalDonationAmount,
        lastReengageEmailAt: members.lastReengageEmailAt,
      })
      .from(members)
      .where(eq(members.id, memberId))
      .limit(1);

    if (!m) return notFound("회원을 찾을 수 없습니다");
    if (m.status !== "active") {
      return badRequest("활성 상태인 회원만 메일을 보낼 수 있습니다");
    }
    if (!m.email) {
      return badRequest("이메일 주소가 등록되지 않은 회원입니다");
    }

    /* 정책 1: agreeEmail 체크 */
    if (m.agreeEmail === false) {
      return forbidden("이 회원은 이메일 수신에 동의하지 않았습니다");
    }

    /* 정책 2: 7일 중복 차단 */
    if (m.lastReengageEmailAt) {
      const diff = Date.now() - new Date(m.lastReengageEmailAt).getTime();
      if (diff < SEVEN_DAYS_MS) {
        const remainHours = Math.ceil((SEVEN_DAYS_MS - diff) / (60 * 60 * 1000));
        return badRequest(
          `최근 7일 이내에 이미 재참여 메일을 발송했습니다 (${remainHours}시간 후 재발송 가능)`
        );
      }
    }

    /* ★ 본문 결정: admin.js 의 두 가지 입력 방식 모두 지원 */
    let messageBody = "";
    let messageSource: "ai" | "custom" | "fallback" = "custom";

    const useAiMessage = body.useAiMessage === true;
    const customMessage = typeof body.customMessage === "string"
      ? body.customMessage.trim()
      : "";

    if (useAiMessage) {
      /* AI 자동 생성 모드 */
      const signalsRaw: any = m.churnSignals || {};
      const signalCodes: string[] = Array.isArray(signalsRaw.codes) ? signalsRaw.codes : [];
      const aiResult = await generateAiMessage(
        m.name || "회원",
        signalCodes,
        m.totalDonationAmount || 0,
      );
      messageBody = aiResult.text;
      messageSource = aiResult.source;  // 'ai' | 'fallback'
    } else if (customMessage.length > 0) {
      /* 운영자 직접 작성 모드 */
      if (customMessage.length < 50) {
        return badRequest("메시지는 50자 이상으로 작성해 주세요");
      }
      if (customMessage.length > 600) {
        return badRequest("메시지는 600자 이하로 작성해 주세요");
      }
      messageBody = customMessage;
      messageSource = "custom";
    } else {
      return badRequest("useAiMessage:true 또는 customMessage 중 하나를 지정해 주세요");
    }

    /* 메일 발송 */
    const tpl = tplChurnReengage({
      memberName: m.name || "회원",
      messageBody,
      totalDonationAmount: m.totalDonationAmount || 0,
    });

    const sent = await sendEmail({
      to: m.email,
      subject: tpl.subject,
      html: tpl.html,
    });

    if (!sent.ok) {
      console.error("[admin-churn-reengage] 메일 발송 실패:", sent.error);
      return serverError("메일 발송에 실패했습니다");
    }

    /* lastReengageEmailAt 갱신 */
    await db
      .update(members)
      .set({
        lastReengageEmailAt: new Date(),
        updatedAt: new Date(),
      } as any)
      .where(eq(members.id, memberId));

    /* 감사 로그 */
    try {
      await logAdminAction(req, admin.uid, admin.name, "churn_reengage_sent", {
        target: `M-${memberId}`,
        detail: {
          email: m.email,
          churnLevel: m.churnRiskLevel,
          messageSource,
          messageLength: messageBody.length,
        },
      });
    } catch (_) {}

    /* ★ admin.js 가 기대하는 응답 키: messageSource */
    return ok({
      memberId,
      sentTo: m.email,
      messageSource,    // 'ai' | 'custom' | 'fallback'
      messageBody,
    }, "재참여 메일이 발송되었습니다");
  } catch (err: any) {
    console.error("[admin-churn-reengage]", err);
    return serverError("재참여 메일 처리 중 오류", err?.message);
  }
};

export const config = { path: "/api/admin/churn-reengage" };