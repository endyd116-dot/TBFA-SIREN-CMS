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

export async function sendAligoAlimtalk(
  opts: AligoAlimtalkOpts,
): Promise<AligoAlimtalkResult> {
  const apikey = process.env.ALIGO_API_KEY || "";
  const userid = process.env.ALIGO_USER_ID || "";

  if (!apikey || !userid) {
    return { ok: false, error: "ALIGO_API_KEY/ALIGO_USER_ID 미등록" };
  }
  if (!opts.senderKey) {
    return { ok: false, error: "ALIGO_KAKAO_CHANNEL_ID(senderkey) 미등록" };
  }
  if (!opts.tplCode) {
    return { ok: false, error: "tplCode 미지정 (템플릿 ID 환경변수 미등록)" };
  }
  if (!opts.receiver) {
    return { ok: false, error: "수신자 번호 없음" };
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
