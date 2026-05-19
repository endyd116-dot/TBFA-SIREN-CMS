/**
 * GET /api/payroll-my-pdf?id=N
 *
 * 본인 명세서 PDF 다운로드. status≥SENT 본인 명세서만 허용.
 * 권한: requireOperator (운영자 본인만).
 *
 * R37 1일차 — 본인 소유권·상태 검증까지 골격. 실제 PDF 생성은 3일차에서 구현.
 */
import { db } from "../../db/index";
import { payrollSlips } from "../../db/schema";
import { eq } from "drizzle-orm";
import { requireOperator, operatorGuardFailed } from "../../lib/operator-guard";

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

export default async function handler(req: Request) {
  const auth = await requireOperator(req);
  if (operatorGuardFailed(auth)) return auth.res;
  const me = (auth as any).ctx.member;

  const url = new URL(req.url);
  const idNum = Number(url.searchParams.get("id") || 0);
  if (!idNum) return jsonBadRequest("id 필수");

  try {
    const [slip] = await db.select().from(payrollSlips).where(eq(payrollSlips.id, idNum)).limit(1);
    if (!slip) return jsonBadRequest("명세서를 찾을 수 없습니다", 404);

    // 본인 소유권
    if (slip.memberUid !== String(me.id)) {
      return jsonBadRequest("본인 명세서만 다운로드할 수 있습니다", 403);
    }
    // 발송 전 상태는 비공개
    if (slip.status !== "SENT") {
      return jsonBadRequest("발송 완료된 명세서만 다운로드할 수 있습니다", 403);
    }

    // 3일차에서 구현: pdf-lib 생성·R2 캐싱
    return new Response(JSON.stringify({
      ok: false,
      error: "본인 PDF 생성은 R37 3일차에서 구현 예정",
      step: "pdf_not_ready",
      slipId: slip.id,
    }), { status: 501, headers: { "Content-Type": "application/json" } });
  } catch (err) { return jsonError("select_slip", err); }
}
