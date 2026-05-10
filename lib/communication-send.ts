// lib/communication-send.ts
// Phase 10 R3 — 발송 큐 헬퍼
// 어댑터(Phase 8/9)가 NotifyEvent enum 기반이라 마케팅 발송에 부적합.
// 본 라운드는 채널별 발송 모듈을 직접 호출 (이메일·SMS·인앱·카카오).
// 카카오는 알림톡 정책상 광고성 메시지를 임의 본문으로 보낼 수 없어 R3 대상 외 (skip).

import { db } from "../db";
import { eq } from "drizzle-orm";
import { members, communicationTemplates, recipientGroups } from "../db";
import { sendEmail } from "./email";
import { aligoSend } from "./aligo-client";
import { createNotification } from "./notify";

export type SendChannel = "email" | "sms" | "kakao" | "inapp";

export interface SendPayload {
  /** 이메일 제목 / 인앱 알림 제목 (있으면 사용) */
  subject?: string;
  /** 본문 — 모든 채널 공통 */
  body: string;
}

export interface SendResult {
  ok: boolean;
  /** 외부 추적 ID (Resend message id, Aligo msg id 등) */
  providerMessageId?: string;
  /** 실패 사유 (500자 이내) */
  error?: string;
  /** 실제 발송이 일어나지 않고 정책상 스킵된 경우 (예: 카카오 마케팅) */
  skipped?: boolean;
}

/* =========================================================
   sendViaAdapter — 채널별 직접 발송
   ========================================================= */

export async function sendViaAdapter(
  channel: SendChannel,
  member: { id: number; name: string | null; email: string | null; phone: string | null },
  payload: SendPayload,
): Promise<SendResult> {
  try {
    switch (channel) {
      case "email":
        return await sendEmailDirect(member, payload);
      case "sms":
        return await sendSmsDirect(member, payload);
      case "inapp":
        return await sendInappDirect(member, payload);
      case "kakao":
        // 알림톡은 사전 심사 통과 템플릿만 발송 가능 — 자유 본문 마케팅 불가
        return { ok: true, skipped: true, providerMessageId: "kakao-marketing-not-supported" };
      default:
        return { ok: false, error: `알 수 없는 채널: ${channel}` };
    }
  } catch (err: any) {
    return { ok: false, error: String(err?.message || err).slice(0, 500) };
  }
}

/* ─── 이메일 직접 발송 ─── */
async function sendEmailDirect(
  member: { id: number; email: string | null; name: string | null },
  payload: SendPayload,
): Promise<SendResult> {
  if (!member.email) {
    return { ok: false, error: `이메일 주소 없음 (memberId=${member.id})` };
  }
  const subject = (payload.subject || "").trim() || "(제목 없음)";
  const html =
    `<div style="font-family:'Noto Sans KR','Apple SD Gothic Neo',sans-serif;color:#0f0f0f;padding:24px;line-height:1.7;font-size:15px;">` +
    String(payload.body).slice(0, 50000) +
    `</div>`;

  const result: any = await sendEmail({ to: member.email, subject, html });
  if (!result?.ok) {
    return {
      ok: false,
      error: String(result?.error?.message || result?.error || "이메일 발송 실패").slice(0, 500),
    };
  }
  return { ok: true, providerMessageId: result?.id || undefined };
}

/* ─── SMS 직접 발송 (Aligo) ─── */
async function sendSmsDirect(
  member: { id: number; phone: string | null; name: string | null },
  payload: SendPayload,
): Promise<SendResult> {
  if (!member.phone) {
    return { ok: false, error: `전화번호 없음 (memberId=${member.id})` };
  }
  const msg = String(payload.body).slice(0, 2000);
  const title = payload.subject ? String(payload.subject).slice(0, 30) : undefined;

  const result = await aligoSend({ receiver: member.phone, msg, title });
  if (!result.ok) {
    return {
      ok: false,
      error: (result.error || `Aligo 오류 code=${result.resultCode}`).slice(0, 500),
    };
  }
  return { ok: true, providerMessageId: result.msgId };
}

/* ─── 인앱 알림 직접 생성 ─── */
async function sendInappDirect(
  member: { id: number; name: string | null },
  payload: SendPayload,
): Promise<SendResult> {
  const notifId = await createNotification({
    recipientId: member.id,
    recipientType: "user",
    category: "system",
    severity: "info",
    title: (payload.subject || "알림").slice(0, 200),
    message: String(payload.body).slice(0, 500),
  });
  if (notifId == null) {
    return { ok: false, error: "createNotification 반환값 null" };
  }
  return { ok: true, providerMessageId: String(notifId) };
}

/* =========================================================
   validateSendJob — 작업 등록 시 검증
   템플릿·그룹 활성 + 채널 일치 + 예약 시각 미래
   ========================================================= */

export interface SendJobValidationInput {
  templateId: number;
  recipientGroupId: number;
  scheduleType: "now" | "scheduled";
  scheduledAt?: Date | string | null;
}

export interface SendJobValidationResult {
  ok: boolean;
  errors: string[];
  template?: {
    id: number;
    name: string;
    channel: string;
    subject: string | null;
    bodyTemplate: string;
    variables: any;
    isActive: boolean;
  };
  group?: {
    id: number;
    name: string;
    criteria: any;
    isActive: boolean;
  };
  /** scheduleType='now'면 NOW(), 'scheduled'면 입력 시각 */
  effectiveScheduledAt?: Date;
}

export async function validateSendJob(
  input: SendJobValidationInput,
): Promise<SendJobValidationResult> {
  const errors: string[] = [];

  if (!Number.isInteger(input.templateId) || input.templateId <= 0) {
    errors.push("templateId가 올바르지 않습니다.");
  }
  if (!Number.isInteger(input.recipientGroupId) || input.recipientGroupId <= 0) {
    errors.push("recipientGroupId가 올바르지 않습니다.");
  }
  if (input.scheduleType !== "now" && input.scheduleType !== "scheduled") {
    errors.push("scheduleType은 'now' 또는 'scheduled'여야 합니다.");
  }

  let effectiveScheduledAt: Date | undefined;
  if (input.scheduleType === "scheduled") {
    if (!input.scheduledAt) {
      errors.push("예약 발송은 scheduledAt이 필요합니다.");
    } else {
      const dt = input.scheduledAt instanceof Date ? input.scheduledAt : new Date(input.scheduledAt);
      if (isNaN(dt.getTime())) {
        errors.push("scheduledAt 형식이 올바르지 않습니다.");
      } else if (dt.getTime() < Date.now() + 60 * 1000) {
        errors.push("예약 시각은 현재로부터 1분 이후여야 합니다.");
      } else {
        effectiveScheduledAt = dt;
      }
    }
  } else if (input.scheduleType === "now") {
    effectiveScheduledAt = new Date();
  }

  if (errors.length > 0) return { ok: false, errors };

  /* 템플릿 조회 */
  const [tplRow] = await db
    .select({
      id: communicationTemplates.id,
      name: communicationTemplates.name,
      channel: communicationTemplates.channel,
      subject: communicationTemplates.subject,
      bodyTemplate: communicationTemplates.bodyTemplate,
      variables: communicationTemplates.variables,
      isActive: communicationTemplates.isActive,
    })
    .from(communicationTemplates)
    .where(eq(communicationTemplates.id, input.templateId))
    .limit(1);

  if (!tplRow) {
    errors.push("선택한 템플릿이 존재하지 않습니다.");
    return { ok: false, errors };
  }
  if (!tplRow.isActive) {
    errors.push("선택한 템플릿이 비활성 상태입니다.");
  }

  /* 그룹 조회 */
  const [grpRow] = await db
    .select({
      id: recipientGroups.id,
      name: recipientGroups.name,
      criteria: recipientGroups.criteria,
      isActive: recipientGroups.isActive,
    })
    .from(recipientGroups)
    .where(eq(recipientGroups.id, input.recipientGroupId))
    .limit(1);

  if (!grpRow) {
    errors.push("선택한 수신자 그룹이 존재하지 않습니다.");
    return { ok: false, errors };
  }
  if (!grpRow.isActive) {
    errors.push("선택한 수신자 그룹이 비활성 상태입니다.");
  }

  return {
    ok: errors.length === 0,
    errors,
    template: tplRow as any,
    group: grpRow as any,
    effectiveScheduledAt,
  };
}

/* =========================================================
   buildMemberRenderData — 회원 정보 → 템플릿 변수 자동 매핑
   템플릿에서 흔히 쓰는 키(name, email, phone)를 자동 채움
   ========================================================= */

export function buildMemberRenderData(member: {
  id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
}): Record<string, string> {
  return {
    name: member.name || "",
    memberName: member.name || "",
    email: member.email || "",
    phone: member.phone || "",
    memberId: String(member.id),
  };
}
