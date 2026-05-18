import { db } from "../../db/index";
import { members, attWorkplaces } from "../../db/schema";
import { eq } from "drizzle-orm";
import { requireActiveUser } from "../../lib/auth";
import { getScheduledWorkMode } from "../../lib/att-utils";

export const config = { path: "/api/att-schedule-today" };

function jsonOk(data: unknown) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "오늘 근무형태 조회 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request) {
  const auth = await requireActiveUser(req);
  if (!auth.ok) return auth.res;

  if (req.method !== "GET") return new Response("Method Not Allowed", { status: 405 });

  // members 테이블에서 uid(varchar) 조회
  let memberUid: string;
  try {
    const [member] = await db
      .select({ uid: members.uid })
      .from(members)
      .where(eq(members.id, auth.user.uid))
      .limit(1);
    if (!member) return jsonError("member_not_found", new Error("회원 없음"), 404);
    memberUid = member.uid;
  } catch (err) {
    return jsonError("select_member", err);
  }

  const today = new Date().toISOString().slice(0, 10);

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
