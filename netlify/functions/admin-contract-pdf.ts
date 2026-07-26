/**
 * 관리자 근로계약서 PDF 다운로드 (슈퍼어드민 전용)
 *   GET /api/admin-contract-pdf?id=N          — 완료본(고정) 또는 미완료 미리보기(워터마크)
 *   GET /api/admin-contract-pdf?id=N&draft=1  — 항상 즉석 미리보기(워터마크)
 */
import type { Context } from "@netlify/functions";
import { jsonKST } from "../../lib/kst";
import { requireAdmin } from "../../lib/admin-guard";
import { fetchContractDocument } from "../../lib/contract-document";

export const config = { path: "/api/admin-contract-pdf" };

export default async function handler(req: Request, _ctx: Context) {
  try {
    const auth = await requireAdmin(req);
    if (!auth.ok) return (auth as any).res;
    if ((auth as any).ctx.member.role !== "super_admin") {
      return new Response(jsonKST({ ok: false, error: "이사장(슈퍼어드민)만 가능합니다" }), { status: 403, headers: { "Content-Type": "application/json; charset=utf-8" } });
    }
    const url = new URL(req.url);
    const id = Number(url.searchParams.get("id"));
    if (!id) return new Response(jsonKST({ ok: false, error: "id 없음" }), { status: 400, headers: { "Content-Type": "application/json; charset=utf-8" } });

    const draft = url.searchParams.get("draft") === "1";
    const r = await fetchContractDocument(id, { draft });
    if (!r.ok || !r.bytes) return new Response(jsonKST({ ok: false, error: r.error || "문서를 만들 수 없습니다" }), { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } });

    const fname = encodeURIComponent(r.filename || `contract-${id}.pdf`);
    return new Response(Buffer.from(r.bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="contract-${id}.pdf"; filename*=UTF-8''${fname}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err: any) {
    return new Response(jsonKST({ ok: false, error: "PDF 생성 실패", detail: String(err?.message || err).slice(0, 400) }), { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } });
  }
}
