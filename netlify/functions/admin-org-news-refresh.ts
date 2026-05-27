/**
 * 뉴스·여론 수동 새로고침 — 트리거 전용 (super_admin)
 *
 * POST /api/admin-org-news-refresh
 *   → admin-org-news-refresh-background 트리거(await로 전송 보장) → 즉시 { ok, started } 반환
 *
 * 무거운 수집·분석(네이버 2회 + Gemini 2회)은 26초 함수 한도를 넘어 504 나던 문제로
 * 백그라운드 함수(15분 한도)로 위임(2026-05-26 fix). 프론트는 admin-org-news-get 폴링으로 결과 확인.
 */
import type { Context } from "@netlify/functions";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";

export const config = { path: "/api/admin-org-news-refresh" };

export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "POST") {
    return Response.json({ ok: false, error: "POST 전용" }, { status: 405 });
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  const admin = auth.ctx?.member as any;
  if (admin?.role !== "super_admin") {
    return Response.json({ ok: false, error: "슈퍼어드민 전용" }, { status: 403 });
  }

  const secret = process.env.INTERNAL_TRIGGER_SECRET || "";
  if (!secret) {
    return Response.json({ ok: false, error: "INTERNAL_TRIGGER_SECRET 미설정 — 재조사 비활성(fail-closed)" }, { status: 503 });
  }

  const base = process.env.URL || process.env.SITE_URL || "https://tbfa.co.kr";
  const baseUrl = base.startsWith("http") ? base : `https://${base}`;

  try {
    /* await로 요청 전송 보장 — 미await 시 함수 종료로 fetch 취소(5313ce8 패턴) */
    const resp = await fetch(`${baseUrl}/.netlify/functions/admin-org-news-refresh-background`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminId: admin.id, secret }),
    });
    if (resp.status !== 202 && resp.status !== 200) {
      const t = await resp.text().catch(() => "");
      return Response.json({ ok: false, error: "분석 시작 실패", detail: `bg ${resp.status}: ${t.slice(0, 200)}` }, { status: 502 });
    }
  } catch (err: any) {
    return Response.json({ ok: false, error: "분석 시작 실패", detail: String(err?.message || err).slice(0, 300) }, { status: 500 });
  }

  return Response.json({
    ok: true,
    started: true,
    message: "재조사를 시작했습니다. 1~2분 후 결과가 자동으로 표시됩니다.",
  });
}
