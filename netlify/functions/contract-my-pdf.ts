/**
 * 직원 근로계약서 PDF 다운로드 (본인 것만)
 *   GET /api/contract-my-pdf?id=N
 * 완료본이 있으면 고정본, 없으면(미완료) 워터마크 미리보기. 인증: requireOperator(본인).
 */
import type { Context } from "@netlify/functions";
import { jsonKST } from "../../lib/kst";
import { requireOperator, operatorGuardFailed } from "../../lib/operator-guard";
import { loadContractRow, fetchContractDocument } from "../../lib/contract-document";

export const config = { path: "/api/contract-my-pdf" };
const JH = { "Content-Type": "application/json; charset=utf-8" };

export default async function handler(req: Request, _ctx: Context) {
  try {
    const auth = await requireOperator(req);
    if (operatorGuardFailed(auth)) return auth.res;
    const me = auth.ctx.member;

    const url = new URL(req.url);
    const id = Number(url.searchParams.get("id"));
    if (!id) return new Response(jsonKST({ ok: false, error: "id 없음" }), { status: 400, headers: JH });

    const row = await loadContractRow(id);
    if (!row) return new Response(jsonKST({ ok: false, error: "계약을 찾을 수 없습니다" }), { status: 404, headers: JH });
    if (Number(row.member_id) !== Number(me.id)) return new Response(jsonKST({ ok: false, error: "본인 계약만 내려받을 수 있습니다" }), { status: 403, headers: JH });
    if (row.status === "draft") return new Response(jsonKST({ ok: false, error: "아직 전달되지 않은 계약입니다" }), { status: 404, headers: JH });

    const r = await fetchContractDocument(id, {});
    if (!r.ok || !r.bytes) return new Response(jsonKST({ ok: false, error: r.error || "문서를 만들 수 없습니다" }), { status: 500, headers: JH });

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
    return new Response(jsonKST({ ok: false, error: "PDF 생성 실패", detail: String(err?.message || err).slice(0, 400) }), { status: 500, headers: JH });
  }
}
