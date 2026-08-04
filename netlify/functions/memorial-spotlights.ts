/**
 * netlify/functions/memorial-spotlights.ts — 추모관 "이달에 기억할 선생님" (공개)
 *
 * GET /api/memorial-spotlights
 *   이번 달에 특별한 날(생일·기일 등)을 맞은 선생님 목록과 코너 제목·설명을 돌려준다.
 *   등록된 항목이 없으면 빈 목록 — 화면에서는 코너 전체를 숨긴다.
 *
 * 인증 불필요. 하루 단위로 바뀌는 자료라 10분 캐시.
 */
import { jsonKST } from "../../lib/kst";
import { getThisMonthSpotlights, getSpotlightText } from "../../lib/memorial-spotlight";

export const config = { path: "/api/memorial-spotlights" };

export default async (req: Request) => {
  if (req.method !== "GET") {
    return new Response(jsonKST({ ok: false, error: "허용되지 않은 방식입니다" }), {
      status: 405, headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  try {
    const [items, text] = await Promise.all([getThisMonthSpotlights(), getSpotlightText()]);
    const res = new Response(jsonKST({ ok: true, data: { items, ...text } }), {
      status: 200, headers: { "Content-Type": "application/json; charset=utf-8" },
    });
    res.headers.set("Cache-Control", "public, max-age=600, stale-while-revalidate=120");
    return res;
  } catch (e: any) {
    console.error("[memorial-spotlights]", e);
    /* 실패해도 화면이 멈추지 않도록 빈 목록으로 응답 */
    return new Response(jsonKST({ ok: true, data: { items: [], title: "", desc: "" } }), {
      status: 200, headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
};
