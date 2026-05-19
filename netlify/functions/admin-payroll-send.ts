/**
 * POST /api/admin-payroll-send
 *   body: { year: number, month: number, slipIds?: number[] }
 *
 * APPROVED 상태 명세서만 발송 가능.
 * Resend rate limit 대응: 10명 단위 batch + 각 batch 사이 500ms delay.
 * 발송 후 status=SENT·sent_at·email_sent_to 갱신 + payroll_send_history 적재.
 *
 * R37 1일차 — 골격만. 실제 Resend 발송 로직은 5일차에서 구현.
 */
import { db } from "../../db/index";
import { payrollSlips } from "../../db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";

export const config = { path: "/api/admin-payroll-send" };

function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "급여 명세서 발송 실패", step,
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

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "POST 전용" }), {
      status: 405, headers: { "Content-Type": "application/json" },
    });
  }

  let body: any;
  try { body = await req.json(); } catch { return jsonBadRequest("JSON 본문 필수"); }
  const year = Number(body?.year);
  const month = Number(body?.month);
  if (!year || !month) return jsonBadRequest("year·month 필수");

  try {
    // 발송 대상: APPROVED 상태만 (slipIds 지정 시 그 ID들만)
    const conds = [
      eq(payrollSlips.payYear, year),
      eq(payrollSlips.payMonth, month),
      eq(payrollSlips.status, "APPROVED"),
    ];
    const where = Array.isArray(body?.slipIds) && body.slipIds.length > 0
      ? and(...conds, inArray(payrollSlips.id, body.slipIds.map((n: any) => Number(n)).filter((n: number) => !isNaN(n))))
      : and(...conds);
    const candidates = await db.select().from(payrollSlips).where(where);

    return new Response(JSON.stringify({
      ok: false,
      error: "이메일 일괄 발송 로직은 R37 5일차에서 구현 예정",
      step: "send_not_ready",
      candidateCount: candidates.length,
      candidateIds: candidates.map(c => c.id),
    }), { status: 501, headers: { "Content-Type": "application/json" } });
  } catch (err) { return jsonError("select_candidates", err); }
}
