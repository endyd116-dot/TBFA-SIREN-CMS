/**
 * POST /api/admin-rag-reindex — RAG 전체 재색인 트리거
 *
 * 실제 색인은 admin-rag-reindex-background(15분 한도)가 수행.
 * 이 함수는 super_admin 인증 후 background를 fire-and-forget으로 호출하고
 * 즉시 "색인 시작됨" 응답. (Q&A 328개 순차 임베딩은 일반 함수 10초로 불가)
 *
 * 진행 현황은 admin-rag-status GET이 ai_rag_documents 문서 수를 집계 → 폴링.
 */
import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/admin-rag-reindex" };

const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "POST만 허용" }), { status: 405, headers: JSON_HEADER });
  }

  try {
    const auth = await requireAdmin(req);
    if (!auth.ok) return (auth as any).res;

    const adminId = (auth as any).ctx?.admin?.uid ?? null; // Q3-048 fix: 식별 필드는 admin.uid (admin.id는 undefined → 비용로그 adminId 누락)

    const base = process.env.URL
      || (process.env.SITE_URL ? `https://${process.env.SITE_URL}` : "https://tbfa-siren-cms.netlify.app");
    const secret = process.env.INTERNAL_TRIGGER_SECRET || "";

    if (!secret) {
      return new Response(JSON.stringify({
        ok: false,
        error: "INTERNAL_TRIGGER_SECRET 미설정 — 재색인 비활성(fail-closed)",
      }), { status: 503, headers: JSON_HEADER });
    }

    /* background 호출 — await로 요청 전송을 보장(미await 시 함수 종료로 fetch가 취소됨).
       -background 함수는 호출 즉시 202를 반환하고 실제 색인은 15분 한도로 계속 실행. */
    let bgStatus = 0;
    let bgError = "";
    try {
      const resp = await fetch(`${base}/.netlify/functions/admin-rag-reindex-background`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret, adminId }),
      });
      bgStatus = resp.status;
      if (bgStatus !== 202 && bgStatus !== 200) {
        bgError = (await resp.text().catch(() => "")).slice(0, 200);
      }
    } catch (e: any) {
      bgError = String(e?.message || e).slice(0, 200);
      console.warn("[rag-reindex] background 트리거 실패:", bgError);
    }

    return new Response(JSON.stringify({
      ok: true,
      data: {
        started: true,
        bgStatus,
        bgError: bgError || undefined,
        message: "재색인을 시작했습니다. 현황은 잠시 후 새로고침하면 갱신됩니다.",
      },
    }), { status: 202, headers: JSON_HEADER });

  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false,
      error: "재색인 시작 실패",
      detail: String(err?.message || err).slice(0, 500),
    }), { status: 500, headers: JSON_HEADER });
  }
}
