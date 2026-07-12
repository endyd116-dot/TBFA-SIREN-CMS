import { jsonKST } from "../../lib/kst";
import { db } from "../../db/index";
import { attWorkplaces } from "../../db/schema";
import { eq } from "drizzle-orm";
import { requireOperator, operatorGuardFailed } from "../../lib/operator-guard";
import { getScheduledWorkMode, todayKST } from "../../lib/att-utils";

export const config = { path: "/api/att-schedule-today" };

function jsonOk(data: unknown) {
  return new Response(jsonKST({ ok: true, data }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(jsonKST({
    ok: false, error: "오늘 근무형태 조회 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request) {
  const auth = await requireOperator(req);
  if (operatorGuardFailed(auth)) return auth.res;

  if (req.method !== "GET") return new Response("Method Not Allowed", { status: 405 });

  // att_*.member_uid (varchar) — members.id 문자열
  const memberUid: string = String(auth.ctx.member.id);

  const today = todayKST();

  try {
    const workMode = await getScheduledWorkMode(memberUid, today);

    // 거점 정보 조회 (있는 경우)
    let workplace = null;
    if (workMode.workplaceId) {
      try {
        const [wp] = await db
          .select()
          .from(attWorkplaces)
          .where(eq(attWorkplaces.id, workMode.workplaceId))
          .limit(1);
        workplace = wp ?? null;
      } catch (err) {
        console.warn("[att-schedule-today] 거점 조회 실패:", err);
      }
    }

    return jsonOk({
      date: today,
      memberUid,
      ...workMode,
      workplace,
    });
  } catch (err) {
    return jsonError("get_work_mode", err);
  }
}
