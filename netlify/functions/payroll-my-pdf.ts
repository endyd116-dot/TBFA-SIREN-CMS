/**
 * GET /api/payroll-my-pdf?id=N[&signed=1]
 *
 * 본인 명세서 PDF 다운로드. 교부(발송·지급완료)된 본인 명세서만 허용.
 *
 * 2026-07-11 — 교부 시점에 확정 보관된 문서를 그대로 준다 (매번 새로 만들지 않는다).
 *   signed=1 이면 서명본(서명란이 찍힌 증빙 문서).
 *   고정 문서가 없던 옛 명세서만 즉석 생성으로 폴백한다.
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { payrollSlips } from "../../db/schema";
import { eq } from "drizzle-orm";
import { requireOperator, operatorGuardFailed } from "../../lib/operator-guard";
import { fetchPayrollDocument } from "../../lib/payroll-document";

export const config = { path: "/api/payroll-my-pdf" };

function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "본인 PDF 다운로드 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}
function jsonBadRequest(msg: string, status = 400) {
  return new Response(JSON.stringify({ ok: false, error: msg }), {
    status, headers: { "Content-Type": "application/json" },
  });
}

export default async function handler(req: Request, _ctx: Context): Promise<Response> {
  const auth = await requireOperator(req);
  if (operatorGuardFailed(auth)) return auth.res;
  const me = (auth as any).ctx.member;

  const url = new URL(req.url);
  const idNum = Number(url.searchParams.get("id") || 0);
  if (!idNum) return jsonBadRequest("id 필수");

  let slip: any;
  try {
    [slip] = await db.select().from(payrollSlips).where(eq(payrollSlips.id, idNum)).limit(1);
    if (!slip) return jsonBadRequest("명세서를 찾을 수 없습니다", 404);
  } catch (err) { return jsonError("select_slip", err); }

  // 본인 소유권
  if (slip.memberUid !== String(me.id)) {
    return jsonBadRequest("본인 명세서만 다운로드할 수 있습니다", 403);
  }
  // 발송(SENT)·지급 완료(PAID) 상태만 본인 노출
  if (slip.status !== "SENT" && slip.status !== "PAID") {
    return jsonBadRequest("발송 완료된 명세서만 다운로드할 수 있습니다", 403);
  }

  const wantSigned = url.searchParams.get("signed") === "1";
  if (wantSigned && !slip.signedDocumentR2Key) {
    return jsonBadRequest("아직 서명본이 없습니다 (수령 확인을 먼저 해주세요)", 404);
  }

  try {
    const doc = await fetchPayrollDocument(idNum, { signed: wantSigned });
    if (!doc.ok || !doc.bytes) return jsonError("fetch_document", new Error(doc.error || "문서를 가져오지 못했습니다"));

    const encoded = encodeURIComponent(doc.filename || "급여명세서.pdf");
    return new Response(Buffer.from(doc.bytes) as any, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${encoded}"; filename*=UTF-8''${encoded}`,
        "Content-Length": String(doc.bytes.length),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) { return jsonError("generate_pdf", err); }
}
