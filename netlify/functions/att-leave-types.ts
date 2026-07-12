/**
 * GET /api/att-leave-types
 * 활성 휴가 종류 목록 — 직원 휴가 신청 드롭다운용.
 * 응답: { ok:true, data: [{ id, name, isPaid, unit, defaultDays, ... }] }
 */
import { jsonKST } from "../../lib/kst";
import { db } from "../../db/index";
import { attLeaveTypes } from "../../db/schema";
import { eq, asc } from "drizzle-orm";
import { requireOperator, operatorGuardFailed } from "../../lib/operator-guard";

export const config = { path: "/api/att-leave-types" };

function jsonOk(data: unknown) {
  return new Response(jsonKST({ ok: true, data }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(jsonKST({
    ok: false, error: "휴가 종류 조회 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request) {
  const auth = await requireOperator(req);
  if (operatorGuardFailed(auth)) return auth.res;
  if (req.method !== "GET") return new Response("Method Not Allowed", { status: 405 });

  try {
    const rows = await db
      .select()
      .from(attLeaveTypes)
      .where(eq(attLeaveTypes.isActive, true))
      .orderBy(asc(attLeaveTypes.displayOrder), asc(attLeaveTypes.id));
    return jsonOk(rows);
  } catch (err) {
    return jsonError("select_types", err);
  }
}
