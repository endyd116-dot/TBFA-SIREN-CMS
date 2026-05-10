// lib/aligo-client.ts
// Phase 9 — Aligo SMS API 자체 래퍼
//
// 환경변수:
//   ALIGO_API_KEY    — Aligo 인증키
//   ALIGO_USER_ID    — Aligo 사이트 아이디
//   ALIGO_SENDER     — 발신번호 (등록된 번호, 예: 01012341234)
//   NOTIFICATION_TEST_MODE=true 시 실제 발송 없이 콘솔 + DB 기록만
//
// 자동 분류:
//   메시지 바이트 ≤ 90  → SMS
//   메시지 바이트 > 90  → LMS (2000자 이내)
//
// Aligo API: POST https://apis.aligo.in/send/
//   result_code "1" = 성공, 음수 = 오류

const ALIGO_SEND_URL = "https://apis.aligo.in/send/";

/* =========================================================
   공개 타입
   ========================================================= */
export interface AligoSendOpts {
  /** 수신번호 — 대시 포함 무관 (내부에서 정규화) */
  receiver: string;
  /** 메시지 본문 */
  msg: string;
  /** LMS 제목 (자동 LMS 분류 시 사용, 기본값: "알림") */
  title?: string;
}

export interface AligoSendResult {
  ok: boolean;
  /** Aligo msg_id (성공 시) */
  msgId?: string;
  /** Aligo result_code 원문 */
  resultCode?: string;
  /** Aligo message 원문 */
  message?: string;
  /** 오류 사유 */
  error?: string;
}

/* =========================================================
   내부 헬퍼
   ========================================================= */

/** 전화번호 정규화: 대시·공백 제거 → 숫자만 */
function normalizePhone(raw: string): string {
  return raw.replace(/[^0-9]/g, "");
}

/** 메시지 바이트 수 계산 (한글 2바이트, 나머지 1바이트) */
function byteLength(str: string): number {
  let len = 0;
  for (let i = 0; i < str.length; i++) {
    len += str.charCodeAt(i) > 0x7f ? 2 : 1;
  }
  return len;
}

/* =========================================================
   send — 단일 수신자에게 SMS / LMS 발송
   ========================================================= */
export async function aligoSend(opts: AligoSendOpts): Promise<AligoSendResult> {
  const apiKey  = process.env.ALIGO_API_KEY;
  const userId  = process.env.ALIGO_USER_ID;
  const sender  = process.env.ALIGO_SENDER;

  if (!apiKey || !userId || !sender) {
    return {
      ok:    false,
      error: "Aligo 환경변수 미설정 (ALIGO_API_KEY / ALIGO_USER_ID / ALIGO_SENDER)",
    };
  }

  const testMode = process.env.NOTIFICATION_TEST_MODE === "true";
  const receiver = normalizePhone(opts.receiver);

  if (!receiver || receiver.length < 10) {
    return { ok: false, error: `수신번호 형식 오류: ${opts.receiver}` };
  }

  const bytes   = byteLength(opts.msg);
  const msgType = bytes > 90 ? "LMS" : "SMS";
  const title   = opts.title ?? "알림";

  if (testMode) {
    console.log(
      `[aligo-client] TEST_MODE 발송 (실제 전송 안 됨)` +
      ` type=${msgType} to=${receiver} bytes=${bytes}` +
      ` msg="${opts.msg.slice(0, 50)}${opts.msg.length > 50 ? "…" : ""}"`,
    );
    return { ok: true, msgId: `test-${Date.now()}`, resultCode: "1", message: "테스트모드" };
  }

  const body = new URLSearchParams({
    key:         apiKey,
    user_id:     userId,
    sender:      normalizePhone(sender),
    receiver,
    msg:         opts.msg,
    msg_type:    msgType,
    testmode_yn: "N",
    ...(msgType === "LMS" ? { title } : {}),
  });

  let raw: any;
  try {
    const res = await fetch(ALIGO_SEND_URL, {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body:    body.toString(),
    });
    raw = await res.json();
  } catch (err: any) {
    return { ok: false, error: `Aligo 요청 실패: ${String(err?.message || err).slice(0, 300)}` };
  }

  const code = String(raw?.result_code ?? "");
  if (code === "1") {
    return {
      ok:         true,
      msgId:      String(raw?.msg_id ?? ""),
      resultCode: code,
      message:    String(raw?.message ?? ""),
    };
  }

  return {
    ok:         false,
    resultCode: code,
    message:    String(raw?.message ?? ""),
    error:      `Aligo 오류 result_code=${code} message=${raw?.message ?? ""}`,
  };
}
