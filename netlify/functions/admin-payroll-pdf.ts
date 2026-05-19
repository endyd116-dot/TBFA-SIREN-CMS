/**
 * GET /api/admin-payroll-pdf?id=N
 *
 * 슈퍼어드민이 명세서 PDF 다운로드. R2에 캐시된 pdf_url 있으면 redirect,
 * 없으면 즉시 생성·R2 업로드·DB 갱신·바이너리 응답.
 *
 * R37 1일차 — 골격만. 실제 PDF 생성 로직은 3일차에서 pdf-lib·NotoSansKR 임베딩.
 */
import { db } from "../../db/index";
import { payrollSlips } from "../../db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";

export const config = { path: "/api/admin-payroll-pdf" };

function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "급여 명세서 PDF 처리 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}
function jsonBadRequest(msg: string) {
  return new Response(JSON.stringify({ ok: false, error: msg }), {
    status: 400, headers: { "Content-Type": "application/json" },
  });
}

export default async function handler(req: Request) {
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

  try {
    const [slip] = await db.select().from(payrollSlips).where(eq(payrollSlips.id, idNum)).limit(1);
    if (!slip) return jsonBadRequest("명세서를 찾을 수 없습니다");

    // 3일차에서 구현: pdf-lib·@pdf-lib/fontkit·NotoSansKR 임베딩 + R2 업로드 + pdf_url 갱신
    return new Response(JSON.stringify({
      ok: false,
      error: "PDF 생성 로직은 R37 3일차에서 구현 예정",
      step: "pdf_not_ready",
      slipId: slip.id,
    }), { status: 501, headers: { "Content-Type": "application/json" } });
  } catch (err) { return jsonError("select_slip", err); }
}
