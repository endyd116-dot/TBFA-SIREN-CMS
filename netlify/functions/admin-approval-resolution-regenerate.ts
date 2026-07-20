/**
 * POST /api/admin-approval-resolution-regenerate — 지출결의서 발행본(PDF) 재발행
 * body: { requestId }
 * - 이미 발행된 결의서의 PDF를 최신 서식·결재란 규칙으로 다시 생성해 R2에 박제(resolution_pdf_url 갱신).
 * - 데이터(결의번호·금액 등)는 그대로. 레이아웃/결재란 표기만 갱신하는 용도.
 * - 이사장(super_admin) 전용.
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { buildAndStoreResolutionPdf } from "../../lib/resolution-pdf-store";

export const config = { path: "/api/admin-approval-resolution-regenerate" };

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "POST") {
    return new Response(jsonKST({ ok: false, error: "POST 메서드만 허용" }), { status: 405 });
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  if (String(auth.ctx.member.role || "") !== "super_admin") {
    return new Response(jsonKST({ ok: false, error: "재발행은 이사장만 가능합니다." }), { status: 403 });
  }
  const myId = auth.ctx.admin.uid;

  let body: any;
  try { body = await req.json(); } catch { body = {}; }
  const requestId = Number(body.requestId);
  if (!requestId) return new Response(jsonKST({ ok: false, error: "requestId 필수" }), { status: 400 });

  try {
    const { url, resolutionNo } = await buildAndStoreResolutionPdf(requestId, myId);
    if (!url) return new Response(jsonKST({ ok: false, error: "PDF 저장 실패", step: "upload" }), { status: 500 });
    return new Response(jsonKST({ ok: true, data: { resolutionPdfUrl: url, resolutionNo } }),
      { headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(jsonKST({
      ok: false, error: "재발행 실패", step: "build",
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500 });
  }
};
