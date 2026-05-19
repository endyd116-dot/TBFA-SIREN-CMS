/**
 * GET /api/admin-payroll-pdf?id=N
 *
 * 슈퍼어드민이 명세서 PDF 다운로드.
 * lib/payroll-pdf.ts 의 generatePayrollSlipPdf 공유.
 *
 * R37 3일차 — A4 1페이지·NotoSansKR·on-demand 생성.
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { payrollSlips, members } from "../../db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { generatePayrollSlipPdf, payrollSlipFilename } from "../../lib/payroll-pdf";

export const config = { path: "/api/admin-payroll-pdf" };

function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "급여 명세서 PDF 처리 실패", step,
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
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  if ((auth as any).ctx.member.role !== "super_admin") {
    return new Response(JSON.stringify({ ok: false, error: "슈퍼어드민 전용" }), {
      status: 403, headers: { "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const idNum = Number(url.searchParams.get("id") || 0);
  if (!idNum) return jsonBadRequest("id 필수");

  let slip: any;
  try {
    [slip] = await db.select().from(payrollSlips).where(eq(payrollSlips.id, idNum)).limit(1);
    if (!slip) return jsonBadRequest("명세서를 찾을 수 없습니다", 404);
  } catch (err) { return jsonError("select_slip", err); }

  let member: any = null;
  try {
    const memberId = Number(slip.memberUid);
    if (!isNaN(memberId)) {
      [member] = await db.select({
        id: members.id, name: members.name, email: members.email,
        role: members.role, milestoneRole: members.milestoneRole,
      }).from(members).where(eq(members.id, memberId)).limit(1);
    }
  } catch (err) {
    console.warn("[admin-payroll-pdf] member lookup failed:", err);
  }
  if (!member) member = { id: slip.memberUid, name: `회원ID:${slip.memberUid}` };

  try {
    const bytes = await generatePayrollSlipPdf({ slip, member });
    const fileName = payrollSlipFilename(slip, member.name);
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
