import { requireActiveUser } from "../../lib/auth";

export const config = { path: "/api/att-geocode" };

function jsonOk(data: unknown) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "지오코딩 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request) {
  const auth = await requireActiveUser(req);
  if (!auth.ok) return auth.res;

  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const kakaoKey = process.env.KAKAO_REST_API_KEY;
  if (!kakaoKey) {
    return new Response(JSON.stringify({ ok: false, error: "카카오 API 키 미설정" }), {
      status: 503, headers: { "Content-Type": "application/json" },
    });
  }

  let body: any;
  try { body = await req.json(); } catch { body = {}; }

  const { address } = body;
  if (!address) return jsonError("validate", new Error("address 필수"), 400);

  try {
    const url = `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(address)}`;
    const kakaoRes = await fetch(url, {
      headers: { Authorization: `KakaoAK ${kakaoKey}` },
    });

    if (!kakaoRes.ok) {
      return jsonError("kakao_api", new Error(`카카오 API 오류 ${kakaoRes.status}`), 502);
    }

    const kakaoData = await kakaoRes.json() as any;
    const doc = kakaoData.documents?.[0];

    if (!doc) {
      return new Response(JSON.stringify({ ok: false, error: "주소를 찾을 수 없습니다", step: "no_result" }), {
        status: 404, headers: { "Content-Type": "application/json" },
      });
    }

    return jsonOk({
      lat: Number(doc.y),
      lng: Number(doc.x),
      roadAddress: doc.road_address?.address_name ?? null,
      jibunAddress: doc.address?.address_name ?? doc.address_name ?? null,
    });
  } catch (err) {
    return jsonError("fetch_kakao", err);
  }
}
