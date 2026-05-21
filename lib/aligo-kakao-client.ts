// lib/aligo-kakao-client.ts
// Phase 9 — Aligo 카카오 알림톡 API 래퍼
// 엔드포인트: https://kakaoapi.aligo.in/akv10/alimtalk/send/
// 인증: apikey + userid (form-urlencoded)
//
// A 채팅의 lib/aligo-client.ts(SMS)와 분리 — 호출 엔드포인트가 다름.
// 공통 인증 키(ALIGO_API_KEY, ALIGO_USER_ID)만 공유.

export interface AligoAlimtalkOpts {
  /** 등록된 템플릿 코드 (Aligo 콘솔의 tpl_code) */
  tplCode: string;
  /** 수신자 휴대폰 번호 (- 제거, 010~ 형식) */
  receiver: string;
  /** 알림톡 본문 (템플릿에 등록된 문구 + 변수 치환 결과 — 정확히 일치해야 발송됨) */
  message: string;
  /** 알림톡 제목 (템플릿에 등록된 강조 표기. 강조형이 아니면 빈 문자열 가능) */
  subject?: string;
  /** 버튼 정보 JSON (button_1) — { button: [{ name, linkType, linkTypeName, linkM, linkP }] } */
  buttonJson?: string;
  /** 협회 카카오톡 채널 sender key (Aligo 콘솔에서 발급) */
  senderKey: string;
  /** 발신번호 (협회 대표번호 — 알림톡 실패 시 SMS 대체발송용) */
  sender: string;
}

export interface AligoAlimtalkResult {
  ok: boolean;
  /** Aligo 응답 mid (성공 시) */
  providerMessageId?: string;
  /** Aligo 코드 (0=성공, 음수=실패) */
  code?: number;
  /** Aligo 메시지 (성공/실패 사유) */
  message?: string;
  error?: string;
}

const ALIGO_ENDPOINT = "https://kakaoapi.aligo.in/akv10/alimtalk/send/";

/* ★ 2026-05-16: AWS us-east-2 Lambda 변동 IP가 알리고 화이트리스트와 호환 안 됨.
   ALIGO_PROXY_URL이 설정되어 있으면 Oracle Cloud Free Tier에 배포한 고정 IP
   프록시 서버 경유로 호출. 프록시가 자체 환경변수로 알리고 자격 보관하므로
   Netlify 측은 PROXY_URL·PROXY_SECRET만 알면 됨. */
export async function sendAligoAlimtalk(
  opts: AligoAlimtalkOpts,
): Promise<AligoAlimtalkResult> {
  if (!opts.tplCode) {
    return { ok: false, error: "tplCode 미지정 (템플릿 ID 환경변수 미등록)" };
  }
  if (!opts.receiver) {
    return { ok: false, error: "수신자 번호 없음" };
  }

  const proxyUrl    = process.env.ALIGO_PROXY_URL || "";
  const proxySecret = process.env.ALIGO_PROXY_SECRET || "";

  /* === 프록시 경유 모드 (운영) === */
  if (proxyUrl) {
    if (!proxySecret) {
      return { ok: false, error: "ALIGO_PROXY_SECRET 미설정 — 프록시 인증 불가" };
    }
    try {
      const res = await fetch(proxyUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-proxy-secret": proxySecret,
        },
        body: JSON.stringify({
          tplCode: opts.tplCode,
          receiver: opts.receiver,
          message: opts.message,
          subject: opts.subject || "",
          buttonJson: opts.buttonJson || null,
        }),
      });
      const json: any = await res.json().catch(() => ({}));
      if (json?.ok === true) {
        return {
          ok: true,
          providerMessageId: json.providerMessageId || undefined,
          code: json.code,
          message: json.message,
        };
      }
      console.warn(`[aligo-kakao] 알림톡 프록시 응답 실패 → 직접 호출 폴백: ${String(json?.error || json?.message || res.status).slice(0, 200)}`);
    } catch (err: any) {
      console.warn(`[aligo-kakao] 알림톡 프록시 호출 실패 → 직접 호출 폴백: ${String(err?.message || err).slice(0, 200)}`);
    }
    /* ★ 2026-05-21: 프록시 실패 시 return하지 않고 아래 직접 호출(폴백)로 진행 — 프록시 다운에도 발송 자가복구(알리고 IP 제한 해제 시) */
  }

  /* === 직접 호출 (프록시 미설정 시 기본 / 프록시 실패 시 폴백·알리고 IP 제한 해제 시 성공) === */
  const apikey = process.env.ALIGO_API_KEY || "";
  const userid = process.env.ALIGO_USER_ID || "";

  if (!apikey || !userid) {
    return { ok: false, error: "ALIGO_API_KEY/ALIGO_USER_ID 미등록 (또는 ALIGO_PROXY_URL 설정 필요)" };
  }
  if (!opts.senderKey) {
    return { ok: false, error: "ALIGO_KAKAO_CHANNEL_ID(senderkey) 미등록" };
  }

  const form = new URLSearchParams();
  form.set("apikey", apikey);
  form.set("userid", userid);
  form.set("senderkey", opts.senderKey);
  form.set("tpl_code", opts.tplCode);
  form.set("sender", opts.sender || "");
  form.set("receiver_1", opts.receiver);
  form.set("subject_1", opts.subject || "");
  form.set("message_1", opts.message);
  if (opts.buttonJson) form.set("button_1", opts.buttonJson);

  try {
    const res = await fetch(ALIGO_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    const json: any = await res.json().catch(() => ({}));

    // Aligo 응답: { code: 0, message: 'success', info: { mid, scnt, fcnt, msg_type } }
    const code = Number(json?.code ?? -999);
    const message = String(json?.message ?? "");
    const mid = json?.info?.mid ?? json?.mid ?? null;

    if (code === 0) {
      return { ok: true, providerMessageId: mid ? String(mid) : undefined, code, message };
    }
    return { ok: false, code, message, error: `Aligo code=${code} ${message}`.slice(0, 500) };
  } catch (err: any) {
    return { ok: false, error: String(err?.message || err).slice(0, 500) };
  }
}

/* =========================================================
   휴대폰 번호 정규화 (- 제거, 공백 제거)
   ========================================================= */
export function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return "";
  return String(phone).replace(/[^0-9]/g, "");
}
