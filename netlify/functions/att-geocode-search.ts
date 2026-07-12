// 카카오 로컬 API 다건 주소 검색
// GET ?query={주소} — 5~10건 후보 반환
// 응답: { ok:true, data:{ results:[{ address, roadAddress, lat, lng, placeName }] } }
//
// KAKAO_REST_API_KEY 환경변수 필수. 미설정 시 503 + 안내 메시지.
import { jsonKST } from "../../lib/kst";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";

export const config = { path: "/api/att-geocode-search" };

function jsonOk(data: unknown) {
  return new Response(jsonKST({ ok: true, data }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(jsonKST({
    ok: false, error: "주소 검색 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  if (req.method !== "GET") return new Response("Method Not Allowed", { status: 405 });

  const kakaoKey = process.env.KAKAO_REST_API_KEY;
  if (!kakaoKey) {
    return new Response(jsonKST({
      ok: false,
      error: "거점 주소 검색 환경변수가 등록되지 않았습니다 (KAKAO_REST_API_KEY)",
      step: "env_missing",
    }), { status: 503, headers: { "Content-Type": "application/json" } });
  }

  const url = new URL(req.url);
  const query = (url.searchParams.get("query") || "").trim();
  if (!query) return jsonError("validate", new Error("query 필수"), 400);

  try {
    // 1) 주소 검색 (지번+도로명)
    const addrUrl = `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(query)}&size=10`;
    const addrRes = await fetch(addrUrl, {
      headers: { Authorization: `KakaoAK ${kakaoKey}` },
    });

    if (addrRes.status === 401 || addrRes.status === 403) {
      return new Response(jsonKST({
        ok: false,
        error: "거점 주소 검색 환경변수가 등록되지 않았습니다 (KAKAO_REST_API_KEY)",
        step: "kakao_auth",
      }), { status: 503, headers: { "Content-Type": "application/json" } });
    }
    if (!addrRes.ok) {
      return jsonError("kakao_address_api", new Error(`카카오 주소 API 오류 ${addrRes.status}`), 502);
    }

    const addrData = await addrRes.json() as any;
    const addrDocs = (addrData.documents ?? []) as any[];

    const results = addrDocs.map(doc => ({
      address: doc.address?.address_name ?? doc.address_name ?? "",
      roadAddress: doc.road_address?.address_name ?? "",
      lat: doc.y != null ? Number(doc.y) : null,
      lng: doc.x != null ? Number(doc.x) : null,
      placeName: doc.road_address?.building_name ?? "",
    })).filter(r => r.lat != null && r.lng != null);

    return jsonOk({ results });
  } catch (err) {
    return jsonError("fetch_kakao", err);
  }
}
