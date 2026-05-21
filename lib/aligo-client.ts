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
  /** 프록시 호출 timeout 여부 — true면 발송이 진행 중일 수 있어 호출부에서 롤백 금지 */
  timeout?: boolean;
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

  /* ★ 2026-05-16: Oracle 프록시 경유 모드 (카카오 알림톡과 동일 패턴).
     ALIGO_SMS_PROXY_URL이 설정되어 있으면 Oracle 고정 IP 프록시로 호출 →
     Netlify 변동 IP가 알리고 화이트리스트 차단되는 문제(result_code=-101) 해결.
     아래는 lib/notify-adapters/kakao-aligo.ts·aligo-kakao-client.ts 동일 흐름. */
  const proxyUrl    = process.env.ALIGO_SMS_PROXY_URL || "";
  const proxySecret = process.env.ALIGO_PROXY_SECRET || "";
  let raw: any;

  /* ★ 2026-05-21: 프록시 우선 시도 → 실패(다운·timeout) 시 알리고 직접 호출 폴백.
     프록시 VM이 죽어도 발송이 자가복구됨(알리고 IP 제한 해제 시). */
  let proxyTimedOut = false;
  if (proxyUrl && !proxySecret) console.warn("[aligo-client] ALIGO_PROXY_SECRET 미설정 → 직접 호출 폴백");
  if (proxyUrl && proxySecret) {
    /* 프록시 콜드 스타트 또는 다운 시 Netlify 함수 자체가 30초 timeout으로 죽으면
       send 핸들러의 SMS 실패 분기(deleteVerification 롤백)까지 도달 못 함 → row 남음 →
       사용자 5분 갇힘. AbortController로 10초 안에 명확히 ok:false 반환되도록 안전망. */
    /* ★ 2026-05-20: 8초로 단축 — Netlify 함수 기본 timeout(10초)과 경합해 함수가
       응답 못 보내고 죽는(ERR_HTTP2_PROTOCOL_ERROR) 문제 방지. 함수 한도 전에 확실히
       AbortError로 잡아 호출부가 "발송 중(pending)" 응답을 정상 반환하게 한다. */
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(proxyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-proxy-secret": proxySecret },
        body: JSON.stringify({
          receiver, msg: opts.msg, msgType, title, testmode: false,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      raw = await res.json().catch(() => ({}));
      if (raw?.ok === true) {
        return {
          ok: true,
          msgId: raw.msgId || `proxy-${Date.now()}`,
          resultCode: raw.resultCode || "1",
          message: raw.message || "",
        };
      }
      console.warn(`[aligo-client] SMS 프록시 응답 실패 → 직접 호출 폴백: ${String(raw?.error || raw?.message || res.status).slice(0, 200)}`);
    } catch (err: any) {
      clearTimeout(timer);
      proxyTimedOut = err?.name === "AbortError";
      console.warn(`[aligo-client] SMS 프록시 ${proxyTimedOut ? "timeout(8초)" : "호출 실패"} → 직접 호출 폴백`);
    }
  }

  /* ===== 직접 호출 (프록시 미설정 시 기본 / 프록시 실패 시 폴백)
     ※ 알리고 IP 제한 해제(또는 IP 화이트리스트 통과) 시 성공 → 프록시 없이도 발송됨 ===== */
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

  try {
    const res = await fetch(ALIGO_SEND_URL, {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body:    body.toString(),
    });
    raw = await res.json();
  } catch (err: any) {
    return { ok: false, timeout: proxyTimedOut, error: `Aligo 요청 실패: ${String(err?.message || err).slice(0, 300)}` };
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
    timeout:    proxyTimedOut,
  };
}

/* =========================================================
   ★ 2026-05-17: aligoSendMms — 이미지 첨부 MMS 발송 (multipart)
   - image 파라미터로 image1·image2·image3 최대 3장. 우리는 1장만 사용.
   - 알리고 정책: 한 장 ~300KB, jpg/png/gif.
   - title 필수 (LMS와 동일).
   ========================================================= */
export interface AligoMmsOpts extends AligoSendOpts {
  /** 첨부할 이미지 (R2 URL 또는 절대 URL). Buffer 다운로드 후 multipart. */
  imageUrl: string;
}

export async function aligoSendMms(opts: AligoMmsOpts): Promise<AligoSendResult> {
  const apiKey  = process.env.ALIGO_API_KEY;
  const userId  = process.env.ALIGO_USER_ID;
  const sender  = process.env.ALIGO_SENDER;

  if (!apiKey || !userId || !sender) {
    return { ok: false, error: "Aligo 환경변수 미설정 (ALIGO_API_KEY / ALIGO_USER_ID / ALIGO_SENDER)" };
  }

  const testMode = process.env.NOTIFICATION_TEST_MODE === "true";
  const receiver = normalizePhone(opts.receiver);
  if (!receiver || receiver.length < 10) {
    return { ok: false, error: `수신번호 형식 오류: ${opts.receiver}` };
  }
  if (!opts.imageUrl) {
    return { ok: false, error: "MMS 이미지 URL 미지정" };
  }

  /* 이미지 다운로드 + 300KB 초과 시 자동 압축 (sharp) */
  let imageBlob: Blob;
  try {
    const imgRes = await fetch(opts.imageUrl);
    if (!imgRes.ok) {
      return { ok: false, error: `이미지 다운로드 실패: HTTP ${imgRes.status}` };
    }
    imageBlob = await imgRes.blob();

    if (imageBlob.size > 300 * 1024) {
      /* ★ 2026-05-16: 자동 압축 — JPEG quality 단계적 → 해상도 축소 → 그래도 안되면 실패. */
      const { compressToMaxBytes } = await import("./image-compress");
      const arrayBuf = await imageBlob.arrayBuffer();
      const compressed = await compressToMaxBytes(arrayBuf, 300 * 1024);
      if (!compressed) {
        return {
          ok: false,
          error: `이미지 크기 초과 (${Math.round(imageBlob.size / 1024)}KB) — 자동 압축 시도했으나 300KB 이하로 줄일 수 없습니다. 더 작은 이미지로 다시 업로드해 주세요.`,
        };
      }
      console.log(`[aligo-client] MMS 이미지 자동 압축: ${Math.round(compressed.originalBytes / 1024)}KB → ${Math.round(compressed.finalBytes / 1024)}KB (mode=${compressed.mode}${compressed.meta.quality ? ' q=' + compressed.meta.quality : ''}${compressed.meta.width ? ' w=' + compressed.meta.width : ''})`);
      imageBlob = new Blob([new Uint8Array(compressed.buffer)], { type: "image/jpeg" });
    }
  } catch (err: any) {
    return { ok: false, error: `이미지 다운로드 오류: ${String(err?.message || err).slice(0, 300)}` };
  }

  const title = opts.title ?? "알림";

  if (testMode) {
    console.log(`[aligo-client] TEST_MODE MMS 발송 (실제 전송 안 됨) to=${receiver} bytes=${opts.msg.length} imgSize=${imageBlob.size}`);
    return { ok: true, msgId: `test-mms-${Date.now()}`, resultCode: "1", message: "테스트모드(MMS)" };
  }

  const ext = (imageBlob.type.split("/")[1] || "jpg").replace(/[^a-z0-9]/gi, "").slice(0, 4);

  /* ★ 2026-05-16: MMS도 Oracle 프록시 경유 (ALIGO_SMS_PROXY_URL과 동일 origin, /aligo/mms 라우트).
     이미지를 base64로 인코딩해서 JSON body로 전송 → 프록시가 multipart로 알리고 전달. */
  const smsProxyUrl = process.env.ALIGO_SMS_PROXY_URL || "";
  const proxySecret = process.env.ALIGO_PROXY_SECRET || "";
  let raw: any;

  if (smsProxyUrl) {
    if (!proxySecret) {
      return { ok: false, error: "ALIGO_PROXY_SECRET 미설정 — MMS 프록시 인증 불가" };
    }
    /* SMS URL을 MMS URL로 변환 (/aligo/sms → /aligo/mms) */
    const mmsProxyUrl = smsProxyUrl.replace(/\/aligo\/sms$/, "/aligo/mms");
    const arrayBuf = await imageBlob.arrayBuffer();
    const imageBase64 = Buffer.from(arrayBuf).toString("base64");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(mmsProxyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-proxy-secret": proxySecret },
        body: JSON.stringify({
          receiver, msg: opts.msg, title,
          imageBase64, imageType: imageBlob.type || "image/jpeg", imageName: `mms.${ext}`,
          testmode: false,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      raw = await res.json().catch(() => ({}));
      if (raw?.ok === true) {
        return { ok: true, msgId: raw.msgId || `proxy-mms-${Date.now()}`, resultCode: raw.resultCode || "1", message: raw.message || "" };
      }
      return { ok: false, resultCode: raw?.resultCode, message: raw?.message,
        error: String(raw?.error || `MMS 프록시 응답 실패 (HTTP ${res.status})`).slice(0, 500) };
    } catch (err: any) {
      clearTimeout(timer);
      const isTimeout = err?.name === "AbortError";
      return { ok: false, error: isTimeout
        ? "MMS 프록시 호출 timeout (10초)"
        : `MMS 프록시 호출 실패: ${String(err?.message || err).slice(0, 400)}` };
    }
  }

  /* ===== 직접 호출 모드 (옛 경로) ===== */
  const form = new FormData();
  form.set("key", apiKey);
  form.set("user_id", userId);
  form.set("sender", normalizePhone(sender));
  form.set("receiver", receiver);
  form.set("msg", opts.msg);
  form.set("msg_type", "MMS");
  form.set("title", title);
  form.set("testmode_yn", "N");
  form.set("image1", imageBlob, `mms.${ext}`);

  try {
    const res = await fetch(ALIGO_SEND_URL, { method: "POST", body: form });
    raw = await res.json();
  } catch (err: any) {
    return { ok: false, error: `Aligo MMS 요청 실패: ${String(err?.message || err).slice(0, 300)}` };
  }

  const code = String(raw?.result_code ?? "");
  if (code === "1") {
    return {
      ok: true,
      msgId: String(raw?.msg_id ?? ""),
      resultCode: code,
      message: String(raw?.message ?? ""),
    };
  }
  return {
    ok: false,
    resultCode: code,
    message: String(raw?.message ?? ""),
    error: `Aligo MMS 오류 result_code=${code} message=${raw?.message ?? ""}`,
  };
}
