/**
 * Oracle Cloud Free Tier VM에서 실행되는 알리고 카카오 API 프록시.
 *
 * 흐름:
 *   Netlify Functions(변동 IP) → 이 프록시(고정 IP) → 알리고 카카오 API
 *
 * 보안:
 *   - x-proxy-secret 헤더로 Netlify ↔ 프록시 간 인증
 *   - 알리고 API Key·Sender Key는 프록시 환경변수로만 보관 (Netlify는 모름)
 *
 * 실행:
 *   PROXY_SECRET=xxx \
 *   ALIGO_API_KEY=xxx \
 *   ALIGO_USER_ID=tbfa4utb \
 *   ALIGO_KAKAO_CHANNEL_ID=2b03f0eb... \
 *   ALIGO_SENDER=02xxx \
 *   node server.js
 *
 * 의존성 없음 (Node 18+ 내장 fetch 사용).
 */

const http = require("http");

const PORT = Number(process.env.PORT) || 8080;
const PROXY_SECRET = process.env.PROXY_SECRET || "";

const ALIGO_ENDPOINT = "https://kakaoapi.aligo.in/akv10/alimtalk/send/";
const ALIGO_API_KEY = process.env.ALIGO_API_KEY || "";
const ALIGO_USER_ID = process.env.ALIGO_USER_ID || "";
const ALIGO_KAKAO_CHANNEL_ID = process.env.ALIGO_KAKAO_CHANNEL_ID || "";
const ALIGO_SENDER = process.env.ALIGO_SENDER || "";

function jsonResponse(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; if (raw.length > 1_000_000) req.destroy(); });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  /* 헬스 체크 */
  if (req.method === "GET" && (req.url === "/" || req.url === "/health")) {
    return jsonResponse(res, 200, {
      ok: true,
      service: "aligo-kakao-proxy",
      configured: {
        api_key: !!ALIGO_API_KEY,
        user_id: !!ALIGO_USER_ID,
        kakao_channel_id: !!ALIGO_KAKAO_CHANNEL_ID,
        sender: !!ALIGO_SENDER,
        proxy_secret: !!PROXY_SECRET,
      },
    });
  }

  if (req.method !== "POST" || req.url !== "/aligo/alimtalk") {
    return jsonResponse(res, 404, { ok: false, error: "Not Found" });
  }

  /* 인증 */
  if (!PROXY_SECRET) {
    return jsonResponse(res, 500, { ok: false, error: "PROXY_SECRET 미설정" });
  }
  if (req.headers["x-proxy-secret"] !== PROXY_SECRET) {
    return jsonResponse(res, 401, { ok: false, error: "인증 실패" });
  }

  /* 환경변수 점검 */
  if (!ALIGO_API_KEY || !ALIGO_USER_ID) {
    return jsonResponse(res, 500, { ok: false, error: "알리고 API 자격 미설정" });
  }
  if (!ALIGO_KAKAO_CHANNEL_ID || !ALIGO_SENDER) {
    return jsonResponse(res, 500, { ok: false, error: "알리고 카카오 채널·발신번호 미설정" });
  }

  /* 입력 파싱 */
  let payload;
  try {
    const raw = await readBody(req);
    payload = JSON.parse(raw);
  } catch (e) {
    return jsonResponse(res, 400, { ok: false, error: "JSON 파싱 실패" });
  }
  const { tplCode, receiver, message, subject, buttonJson } = payload || {};
  if (!tplCode || !receiver || !message) {
    return jsonResponse(res, 400, { ok: false, error: "tplCode·receiver·message 필수" });
  }

  /* 알리고 form 구성 */
  const form = new URLSearchParams();
  form.set("apikey", ALIGO_API_KEY);
  form.set("userid", ALIGO_USER_ID);
  form.set("senderkey", ALIGO_KAKAO_CHANNEL_ID);
  form.set("tpl_code", String(tplCode));
  form.set("sender", ALIGO_SENDER);
  form.set("receiver_1", String(receiver));
  form.set("subject_1", String(subject || ""));
  form.set("message_1", String(message));
  if (buttonJson) form.set("button_1", typeof buttonJson === "string" ? buttonJson : JSON.stringify(buttonJson));

  /* 알리고 호출 */
  try {
    const aligoRes = await fetch(ALIGO_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    const aligoText = await aligoRes.text();
    let aligoJson;
    try { aligoJson = JSON.parse(aligoText); } catch { aligoJson = { raw: aligoText }; }

    const code = Number(aligoJson?.code ?? -999);
    const msg = String(aligoJson?.message ?? "");
    const mid = aligoJson?.info?.mid ?? aligoJson?.mid ?? null;

    if (code === 0) {
      return jsonResponse(res, 200, {
        ok: true,
        providerMessageId: mid ? String(mid) : null,
        code,
        message: msg,
      });
    }
    return jsonResponse(res, 200, {
      ok: false,
      code,
      message: msg,
      error: `Aligo code=${code} ${msg}`.slice(0, 500),
    });
  } catch (err) {
    return jsonResponse(res, 500, {
      ok: false,
      error: String(err?.message || err).slice(0, 500),
    });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[aligo-proxy] listening on :${PORT}`);
  console.log(`[aligo-proxy] configured: secret=${!!PROXY_SECRET}, api=${!!ALIGO_API_KEY}, channel=${!!ALIGO_KAKAO_CHANNEL_ID}, sender=${!!ALIGO_SENDER}`);
});
