/**
 * GET /api/payroll-my-pdf?id=N
 *
 * 본인 명세서 PDF 다운로드. SENT 상태 본인 명세서만 허용.
 * lib/payroll-pdf.ts 의 generatePayrollSlipPdf 공유.
 *
 * R37 3일차 — A4 1페이지·NotoSansKR·on-demand 생성.
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { payrollSlips, members } from "../../db/schema";
import { eq } from "drizzle-orm";
import { requireOperator, operatorGuardFailed } from "../../lib/operator-guard";
import { generatePayrollSlipPdf, payrollSlipFilename } from "../../lib/payroll-pdf";

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

  let memberInfo: any = {
    name: me.name,
    email: me.email,
    role: me.role,
    milestoneRole: me.milestoneRole,
  };
  // me는 operator-guard에서 가져온 members row — 보장됨
  try {
    const bytes = await generatePayrollSlipPdf({ slip, member: memberInfo });
    const fileName = payrollSlipFilename(slip, memberInfo.name);
    const encoded = encodeURIComponent(fileName);
    return new Response(Buffer.from(bytes) as any, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${encoded}"; filename*=UTF-8''${encoded}`,
        "Content-Length": String(bytes.length),
      },
    });
  } catch (err) { return jsonError("generate_pdf", err); }
}
