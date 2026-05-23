// lib/solapi-client.ts
// SOLAPI(솔라피) 발송 클라이언트 — 알리고 + Oracle 프록시 대체 (2026-05-23)
//
// 배경: 알리고는 "발신 서버 고정 IP 화이트리스트"를 요구해 Netlify 변동 IP에서
//   직접 호출이 막혔고, 이를 우회하려 Oracle 무료 VM 프록시를 뒀으나 메모리 부족
//   hang으로 발송이 간헐 실패. 솔라피는 API Key + Secret(HMAC-SHA256) 인증이라
//   IP 화이트리스트가 불필요 → 중간 프록시 없이 Netlify에서 직접 호출 → 프록시 폐기.
//
// 인증: Authorization: HMAC-SHA256 apiKey=..., date=ISO8601, salt=..., signature=...
//   signature = hex( HMAC-SHA256(apiSecret, date + salt) )
//
// 발송: POST https://api.solapi.com/messages/v4/send   body { message: {...} }
//   성공 = HTTP 200 + statusCode "2000"
//
// 환경변수:
//   SOLAPI_API_KEY      — 솔라피 API Key (콘솔 → API Key 관리, "모든 IP 허용")
//   SOLAPI_API_SECRET   — 솔라피 API Secret (발급 시 1회만 노출)
//   SOLAPI_SENDER       — 발신번호 (솔라피에 등록된 협회 대표번호). 미설정 시 ALIGO_SENDER 폴백
//   NOTIFICATION_TEST_MODE=true → 실제 발송 없이 로그만

import { createHmac, randomBytes } from "crypto";

const SOLAPI_BASE = "https://api.solapi.com";
const SEND_URL = `${SOLAPI_BASE}/messages/v4/send`;
const STORAGE_URL = `${SOLAPI_BASE}/storage/v1/files`;

/* =========================================================
   공통
   ========================================================= */
function getCreds() {
  const apiKey = process.env.SOLAPI_API_KEY || "";
  const apiSecret = process.env.SOLAPI_API_SECRET || "";
  const sender = process.env.SOLAPI_SENDER || process.env.ALIGO_SENDER || "";
  return { apiKey, apiSecret, sender };
}

/** 솔라피 HMAC-SHA256 인증 헤더 생성 */
function authHeader(apiKey: string, apiSecret: string): string {
  const date = new Date().toISOString();
  const salt = randomBytes(32).toString("hex");
  const signature = createHmac("sha256", apiSecret).update(date + salt).digest("hex");
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

/** 전화번호 정규화: 숫자만 */
function normalizePhone(raw: string): string {
  return String(raw || "").replace(/[^0-9]/g, "");
}

/** 메시지 바이트 수 (한글 2바이트) — SMS/LMS 자동 분류용 */
function byteLength(str: string): number {
  let len = 0;
  for (let i = 0; i < str.length; i++) len += str.charCodeAt(i) > 0x7f ? 2 : 1;
  return len;
}

export interface SolapiResult {
  ok: boolean;
  /** 솔라피 messageId (성공 시) */
  msgId?: string;
  /** 솔라피 statusCode 원문 ("2000"=성공) */
  statusCode?: string;
  /** 솔라피 statusMessage 원문 */
  message?: string;
  error?: string;
}

/** 솔라피 단건 발송 공통 (message 객체를 받아 POST) */
async function postSend(message: Record<string, any>): Promise<SolapiResult> {
  const { apiKey, apiSecret } = getCreds();
  if (!apiKey || !apiSecret) {
    return { ok: false, error: "SOLAPI 환경변수 미설정 (SOLAPI_API_KEY / SOLAPI_API_SECRET)" };
  }
  try {
    const res = await fetch(SEND_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader(apiKey, apiSecret),
      },
      body: JSON.stringify({ message }),
    });
    const raw: any = await res.json().catch(() => ({}));
    const statusCode = String(raw?.statusCode ?? "");

    if (res.ok && statusCode === "2000") {
      return {
        ok: true,
        msgId: String(raw?.messageId ?? raw?.groupId ?? ""),
        statusCode,
        message: String(raw?.statusMessage ?? ""),
      };
    }
    /* 실패: statusCode/errorCode + 사유 노출 (디버깅용 detail) */
    const reason = String(raw?.statusMessage ?? raw?.errorMessage ?? raw?.message ?? JSON.stringify(raw).slice(0, 200));
    return {
      ok: false,
      statusCode: statusCode || String(raw?.errorCode ?? ""),
      message: reason,
      error: `SOLAPI 발송 실패 (HTTP ${res.status}, status=${statusCode || raw?.errorCode || "?"}) ${reason}`.slice(0, 500),
    };
  } catch (err: any) {
    return { ok: false, error: `SOLAPI 요청 실패: ${String(err?.message || err).slice(0, 300)}` };
  }
}

/* =========================================================
   SMS / LMS — 단일 수신자
   ========================================================= */
export interface SolapiSmsOpts {
  /** 수신번호 — 대시 포함 무관 */
  receiver: string;
  /** 메시지 본문 */
  msg: string;
  /** LMS 제목 (자동 LMS 분류 시 사용, 기본값 "알림") */
  title?: string;
}

export async function solapiSendSms(opts: SolapiSmsOpts): Promise<SolapiResult> {
  const { sender } = getCreds();
  if (!sender) return { ok: false, error: "SOLAPI 발신번호 미설정 (SOLAPI_SENDER)" };

  const to = normalizePhone(opts.receiver);
  if (!to || to.length < 10) return { ok: false, error: `수신번호 형식 오류: ${opts.receiver}` };

  const bytes = byteLength(opts.msg);
  const type = bytes > 90 ? "LMS" : "SMS";

  if (process.env.NOTIFICATION_TEST_MODE === "true") {
    console.log(
      `[solapi] TEST_MODE 발송 (실제 전송 안 됨) type=${type} to=${to} bytes=${bytes}` +
      ` msg="${opts.msg.slice(0, 50)}${opts.msg.length > 50 ? "…" : ""}"`,
    );
    return { ok: true, msgId: `test-${Date.now()}`, statusCode: "2000", message: "테스트모드" };
  }

  const message: Record<string, any> = {
    to,
    from: normalizePhone(sender),
    text: opts.msg,
    type,
  };
  if (type === "LMS") message.subject = opts.title ?? "알림";

  return postSend(message);
}

/* =========================================================
   카카오 알림톡 — 단일 수신자 (템플릿 재등록·발신프로필 연동 후 사용)
   - 알리고는 "렌더된 본문 + tplCode"를 보냈으나, 솔라피는 "templateId + variables"로
     솔라피가 등록 템플릿을 채워 발송한다. 따라서 어댑터가 변수 맵을 넘겨야 함.
   - disableSms=false 시 알림톡 실패하면 text로 SMS 대체발송.
   ========================================================= */
export interface SolapiAlimtalkOpts {
  receiver: string;
  /** 발신프로필 키 (솔라피 카카오 채널 연동 시 발급, env SOLAPI_KAKAO_PFID) */
  pfId: string;
  /** 솔라피에 등록·승인된 템플릿 ID */
  templateId: string;
  /** 템플릿 변수 맵 (예: { "#{name}": "홍길동" }) */
  variables?: Record<string, string>;
  /** 실패 시 SMS 대체발송 비활성 (기본 false = 대체발송 허용) */
  disableSms?: boolean;
  /** SMS 대체발송 본문 (disableSms=false일 때 사용) */
  text?: string;
}

export async function solapiSendAlimtalk(opts: SolapiAlimtalkOpts): Promise<SolapiResult> {
  const { sender } = getCreds();
  if (!sender) return { ok: false, error: "SOLAPI 발신번호 미설정 (SOLAPI_SENDER)" };
  if (!opts.pfId) return { ok: false, error: "발신프로필 키 미설정 (SOLAPI_KAKAO_PFID)" };
  if (!opts.templateId) return { ok: false, error: "템플릿 ID 미지정" };

  const to = normalizePhone(opts.receiver);
  if (!to || to.length < 10) return { ok: false, error: `수신번호 형식 오류: ${opts.receiver}` };

  if (process.env.NOTIFICATION_TEST_MODE === "true") {
    console.log(`[solapi] TEST_MODE 알림톡 (실제 전송 안 됨) to=${to} tpl=${opts.templateId}`);
    return { ok: true, msgId: `test-ata-${Date.now()}`, statusCode: "2000", message: "테스트모드" };
  }

  const message: Record<string, any> = {
    to,
    from: normalizePhone(sender),
    kakaoOptions: {
      pfId: opts.pfId,
      templateId: opts.templateId,
      variables: opts.variables || {},
      disableSms: opts.disableSms ?? false,
    },
  };
  /* 대체발송(SMS) 본문 — 알림톡 실패 시 이 text가 SMS/LMS로 나감 */
  if (opts.text && !opts.disableSms) message.text = opts.text;

  return postSend(message);
}

/* =========================================================
   MMS — 이미지 첨부 발송 (이미지를 솔라피 스토리지에 업로드 후 imageId로 발송)
   - SOLAPI는 알리고와 달리 "스토리지 업로드 → fileId → 메시지 imageId" 방식.
   - 이미지 200KB 초과 시 자동 압축(jpg).
   ========================================================= */
export interface SolapiMmsOpts {
  receiver: string;
  msg: string;
  title?: string;
  /** 첨부 이미지 URL (R2 또는 절대 URL) */
  imageUrl: string;
}

export async function solapiSendMms(opts: SolapiMmsOpts): Promise<SolapiResult> {
  const { apiKey, apiSecret, sender } = getCreds();
  if (!apiKey || !apiSecret) return { ok: false, error: "SOLAPI 환경변수 미설정 (SOLAPI_API_KEY / SOLAPI_API_SECRET)" };
  if (!sender) return { ok: false, error: "SOLAPI 발신번호 미설정 (SOLAPI_SENDER)" };

  const to = normalizePhone(opts.receiver);
  if (!to || to.length < 10) return { ok: false, error: `수신번호 형식 오류: ${opts.receiver}` };
  if (!opts.imageUrl) return { ok: false, error: "MMS 이미지 URL 미지정" };

  if (process.env.NOTIFICATION_TEST_MODE === "true") {
    console.log(`[solapi] TEST_MODE MMS (실제 전송 안 됨) to=${to} img=${opts.imageUrl.slice(0, 60)}`);
    return { ok: true, msgId: `test-mms-${Date.now()}`, statusCode: "2000", message: "테스트모드(MMS)" };
  }

  /* 1) 이미지 다운로드 + 200KB 초과 시 압축 */
  let base64: string;
  try {
    const imgRes = await fetch(opts.imageUrl);
    if (!imgRes.ok) return { ok: false, error: `이미지 다운로드 실패: HTTP ${imgRes.status}` };
    const orig = await imgRes.arrayBuffer();
    let outBuf: Buffer = Buffer.from(orig);
    if (orig.byteLength > 200 * 1024) {
      const { compressToMaxBytes } = await import("./image-compress");
      const c = await compressToMaxBytes(orig, 200 * 1024);
      if (!c) return { ok: false, error: `이미지 크기 초과 — 200KB 이하로 압축 실패. 더 작은 이미지로 올려주세요.` };
      outBuf = Buffer.from(c.buffer);
    }
    base64 = outBuf.toString("base64");
  } catch (err: any) {
    return { ok: false, error: `이미지 처리 오류: ${String(err?.message || err).slice(0, 300)}` };
  }

  /* 2) 솔라피 스토리지 업로드 → fileId */
  let fileId = "";
  try {
    const res = await fetch(STORAGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader(apiKey, apiSecret) },
      body: JSON.stringify({ file: base64, name: "mms.jpg", type: "MMS" }),
    });
    const raw: any = await res.json().catch(() => ({}));
    fileId = String(raw?.fileId || "");
    if (!res.ok || !fileId) {
      return { ok: false, error: `이미지 업로드 실패 (HTTP ${res.status}) ${raw?.errorMessage || JSON.stringify(raw).slice(0, 200)}`.slice(0, 400) };
    }
  } catch (err: any) {
    return { ok: false, error: `이미지 업로드 요청 실패: ${String(err?.message || err).slice(0, 300)}` };
  }

  /* 3) MMS 발송 (imageId 포함 → type MMS) */
  return postSend({
    to,
    from: normalizePhone(sender),
    text: opts.msg,
    subject: opts.title ?? "알림",
    imageId: fileId,
    type: "MMS",
  });
}
