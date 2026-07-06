// netlify/functions/att-door-open.ts — 직원 수동 "문 열기"(모바일 키).
// 근무 중(오늘 출근 세션이 열려 있는) 운영자가 문 앞에서 직접 개방할 때.
// (ON access-door-open 이식. 출입문 어댑터는 lib/adapters/door.)
import { db } from "../../db/index";
import { attRecords } from "../../db/schema";
import { eq, and } from "drizzle-orm";
import { requireOperator, operatorGuardFailed } from "../../lib/operator-guard";
import { normalizeSessions, isWorking } from "../../lib/att-session";
import { todayKST } from "../../lib/att-utils";
import { openDoor } from "../../lib/adapters/door";

export const config = { path: "/api/att-door-open" };

function jsonOk(data: unknown, status = 200) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status, headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "문 열기 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
  }), { status, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request) {
  const auth = await requireOperator(req);
  if (operatorGuardFailed(auth)) return auth.res;
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const memberUid: string = String(auth.ctx.member.id);
  const today = todayKST();

  // 근무 중(오늘 출근 세션이 열려 있음) 확인 — 미출근 상태 개방 방지.
  let existing: any = null;
  try {
    const rows = await db.select().from(attRecords)
      .where(and(eq(attRecords.memberUid, memberUid), eq(attRecords.date, today))).limit(1);
    existing = rows[0] ?? null;
  } catch (err) { return jsonError("select_record", err); }

  if (!existing || !isWorking(normalizeSessions(existing))) {
    return new Response(JSON.stringify({
      ok: false, error: "출근(근무 중) 상태에서만 문을 열 수 있습니다", step: "not_working",
    }), { status: 409, headers: { "Content-Type": "application/json" } });
  }

  try {
    const r = await openDoor({ triggerType: "mobilekey", triggerId: existing.id, memberUid });
    return jsonOk({ ok: r.ok, adapter: r.adapter, sim: r.adapter === "sim", detail: r.detail ?? null });
  } catch (err) {
    return jsonError("open_door", err);
  }
}
