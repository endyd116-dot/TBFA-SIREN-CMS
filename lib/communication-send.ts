// lib/communication-send.ts
// Phase 10 R3 — 발송 큐 헬퍼
// 어댑터(Phase 8/9)가 NotifyEvent enum 기반이라 마케팅 발송에 부적합.
// 본 라운드는 채널별 발송 모듈을 직접 호출 (이메일·SMS·인앱·카카오).
// 카카오는 알림톡 정책상 광고성 메시지를 임의 본문으로 보낼 수 없어 R3 대상 외 (skip).

import { db } from "../db";
import { eq } from "drizzle-orm";
import { members, communicationTemplates, recipientGroups } from "../db";
import { sendEmail } from "./email";
import { aligoSend, aligoSendMms } from "./aligo-client";
import { createNotification } from "./notify";

export type SendChannel = "email" | "sms" | "kakao" | "inapp";

export interface SendPayload {
  /** 이메일 제목 / 인앱 알림 제목 (있으면 사용) */
  subject?: string;
  /** 본문 — 모든 채널 공통. 카카오는 변수 치환된 최종 본문(알리고에 그대로 전송) */
  body: string;
  /** 2026-05-16: 카카오 알림톡 — 알리고 등록 tpl_code (UH_XXXX). 없으면 발송 안 함 */
  alimtalkTemplateCode?: string;
  /** 2026-05-16: 카카오 알림톡 버튼 JSON (button_1) */
  alimtalkButtonJson?: any;
  /** 2026-05-17: SMS 채널일 때 이미지 첨부 시 자동 MMS 전환. 첫 번째 이미지 URL만 사용. */
  mmsImageUrl?: string;
  /** 2026-05-16: 이메일 채널 전용 — SIREN baseLayout으로 wrap (메일 웹 감싸기) */
  wrapEmail?: boolean;
  /** 2026-05-16: 이메일 채널 전용 — 첨부파일 (R2 blob_key + 파일명). 무시되는 채널은 무관. */
  emailAttachments?: Array<{ blobKey: string; filename: string }>;
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
        return await sendKakaoDirect(member, payload);
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
  /* 2026-05-16: 효성 import 시 자동 생성된 placeholder 이메일은 발송 시도 X.
     실제 도메인이 아니라 Resend가 응답 안 보내 15초 타임아웃 낭비됨. */
  const emailLower = member.email.toLowerCase();
  if (emailLower.endsWith("@noemail.siren.local") || emailLower.endsWith(".local") || emailLower.endsWith(".invalid") || emailLower.endsWith(".test")) {
    return { ok: false, error: `유효하지 않은 이메일 도메인 (placeholder): ${member.email}` };
  }
  const subject = (payload.subject || "").trim() || "(제목 없음)";
  const innerBody = String(payload.body).slice(0, 50000);

  /* 2026-05-16: wrapEmail=true면 SIREN baseLayout으로 wrap, 아니면 기본 div */
  let html: string;
  if (payload.wrapEmail) {
    const { baseLayout } = await import("./email");
    html = baseLayout({ title: subject, bodyHtml: innerBody });
  } else {
    html = `<div style="font-family:'Noto Sans KR','Apple SD Gothic Neo',sans-serif;color:#0f0f0f;padding:24px;line-height:1.7;font-size:15px;">${innerBody}</div>`;
  }

  /* 2026-05-16: 첨부파일 — R2 private bucket이라 downloadFromR2 직접 호출 → base64 */
  let attachments: Array<{ filename: string; content: string }> | undefined;
  if (Array.isArray(payload.emailAttachments) && payload.emailAttachments.length > 0) {
    const { downloadFromR2 } = await import("./r2-server");
    attachments = [];
    for (const att of payload.emailAttachments) {
      try {
        const data = await downloadFromR2(att.blobKey);
        if (!data) continue;
        if (data.byteLength > 20 * 1024 * 1024) continue;  /* 단일 첨부 20MB 상한 (Resend 권장) */
        attachments.push({ filename: att.filename, content: Buffer.from(data).toString("base64") });
      } catch {}
    }
    if (attachments.length === 0) attachments = undefined;
  }

  const result: any = await sendEmail({ to: member.email, subject, html, attachments });
  if (!result?.ok) {
    return {
      ok: false,
      error: String(result?.error?.message || result?.error || "이메일 발송 실패").slice(0, 500),
    };
  }
  return { ok: true, providerMessageId: result?.id || undefined };
}

/* ─── SMS 직접 발송 (Aligo) — 이미지 있으면 자동 MMS ─── */
async function sendSmsDirect(
  member: { id: number; phone: string | null; name: string | null },
  payload: SendPayload,
): Promise<SendResult> {
  if (!member.phone) {
    return { ok: false, error: `전화번호 없음 (memberId=${member.id})` };
  }
  const msg = String(payload.body).slice(0, 2000);
  const title = payload.subject ? String(payload.subject).slice(0, 30) : undefined;

  /* 2026-05-17: 이미지 URL이 있으면 MMS로 발송. 알리고 단가 LMS의 2~3배. */
  if (payload.mmsImageUrl) {
    const mmsResult = await aligoSendMms({
      receiver: member.phone,
      msg, title,
      imageUrl: payload.mmsImageUrl,
    });
    if (!mmsResult.ok) {
      return {
        ok: false,
        error: (mmsResult.error || `Aligo MMS 오류 code=${mmsResult.resultCode}`).slice(0, 500),
      };
    }
    return { ok: true, providerMessageId: mmsResult.msgId };
  }

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

/* ─── 카카오 알림톡 직접 발송 ───
   2026-05-23 솔라피 전환: 마케팅 발송의 "임의 본문" 카카오는 솔라피 미지원
   (솔라피 알림톡은 등록 템플릿ID + 변수맵만 허용). 시스템 이벤트 알림톡(결제·
   후원 안내 등)은 notify-adapters/kakao-aligo(솔라피)가 담당. → 본 경로는 정책 스킵. */
async function sendKakaoDirect(
  _member: { id: number; phone: string | null; name: string | null },
  _payload: SendPayload,
): Promise<SendResult> {
  return {
    ok: true,
    skipped: true,
    providerMessageId: "kakao-skip-solapi",
    error: "[정책 스킵] 카카오 알림톡은 시스템 이벤트(결제·후원 안내)만 발송됩니다. 마케팅은 이메일/문자를 이용해 주세요.",
  } as SendResult & { error?: string };
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
  /* 2026-05-16: 사용자가 템플릿 본문에서 어떤 변수 표기를 써도 회원 정보가
     자동 치환되도록 한글·영문 alias 폭넓게 채움. 매핑되지 않으면 빈 문자열로
     치환되어 미리보기 예시값(홍길동 등)이 실제 메일에 박히는 사고 차단. */
  const name = member.name || "";
  const email = member.email || "";
  const phone = member.phone || "";
  const idStr = String(member.id);
  return {
    /* 회원 이름 */
    name, memberName: name, member_name: name, userName: name, user_name: name,
    이름: name, 회원이름: name, 회원명: name, 성함: name,
    /* 이메일 */
    email, memberEmail: email, member_email: email, userEmail: email, user_email: email,
    이메일: email, 회원이메일: email,
    /* 전화번호 */
    phone, memberPhone: phone, member_phone: phone, userPhone: phone, user_phone: phone,
    연락처: phone, 전화번호: phone, 휴대폰: phone, 회원연락처: phone,
    /* 회원 ID */
    memberId: idStr, member_id: idStr, userId: idStr, user_id: idStr, 회원번호: idStr,
  };
}
