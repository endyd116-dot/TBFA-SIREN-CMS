// lib/aligo-client.ts
// 발송 래퍼 — 2026-05-23 알리고(+Oracle 프록시) → 솔라피(SOLAPI) 전면 위임.
// aligoSend(SMS/LMS)·aligoSendMms(MMS) 모두 lib/solapi-client로 위임한다.
// 함수명·시그니처는 호출부 호환 위해 유지(phone-verify·notify-adapters·communication-send).
// (파일명은 레거시이나 호출부 다수 참조로 유지 — 내용은 솔라피)

import { solapiSendSms, solapiSendMms } from "./solapi-client";

export interface AligoSendOpts {
  /** 수신번호 — 대시 포함 무관 */
  receiver: string;
  /** 메시지 본문 */
  msg: string;
  /** LMS 제목 (자동 LMS 분류 시 사용, 기본값 "알림") */
  title?: string;
}

export interface AligoSendResult {
  ok: boolean;
  msgId?: string;
  /** 솔라피 statusCode를 담음 (호환 위해 이름 유지) */
  resultCode?: string;
  message?: string;
  error?: string;
  /** 솔라피 직접 발송이라 항상 false (프록시 시절 호환 필드) */
  timeout?: boolean;
}

/* =========================================================
   SMS / LMS — 솔라피 위임 (자동 SMS/LMS 분류는 solapiSendSms 내부)
   ========================================================= */
export async function aligoSend(opts: AligoSendOpts): Promise<AligoSendResult> {
  const r = await solapiSendSms({ receiver: opts.receiver, msg: opts.msg, title: opts.title });
  return { ok: r.ok, msgId: r.msgId, resultCode: r.statusCode, message: r.message, error: r.error, timeout: false };
}

export interface AligoMmsOpts extends AligoSendOpts {
  /** 첨부 이미지 (R2 URL 또는 절대 URL) */
  imageUrl: string;
}

/* =========================================================
   MMS — 솔라피 위임 (이미지 스토리지 업로드 → imageId 발송)
   ========================================================= */
export async function aligoSendMms(opts: AligoMmsOpts): Promise<AligoSendResult> {
  const r = await solapiSendMms({ receiver: opts.receiver, msg: opts.msg, title: opts.title, imageUrl: opts.imageUrl });
  return { ok: r.ok, msgId: r.msgId, resultCode: r.statusCode, message: r.message, error: r.error, timeout: false };
}
