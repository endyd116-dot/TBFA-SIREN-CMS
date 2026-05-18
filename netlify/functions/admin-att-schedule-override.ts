import { db } from "../../db/index";
import { attScheduleOverrides } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/admin-att-schedule-override" };

function jsonOk(data: unknown, status = 200) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status, headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "스케줄 재정의 처리 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;
  if (auth.member.role !== "super_admin") {
    return new Response(JSON.stringify({ ok: false, error: "슈퍼어드민 전용" }), {
      status: 403, headers: { "Content-Type": "application/json" },
    });
  }

  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  let body: any;
  try { body = await req.json(); } catch { body = {}; }

  const { memberUid, date, workMode, workplaceId, reason } = body;
  if (!memberUid || !date || !workMode) {
    return jsonError("validate", new Error("memberUid, date, workMode 필수"), 400);
  }

  try {
    // UNIQUE(memberUid, date) — 이미 있으면 업데이트
    const [row] = await db
      .insert(attScheduleOverrides)
      .values({
        memberUid,
        date,
        workMode,
        workplaceId: workplaceId ?? null,
        reason: reason ?? null,
        createdBy: auth.member.uid,
      })
      .onConflictDoUpdate({
        target: [attScheduleOverrides.memberUid, attScheduleOverrides.date],
        set: {
          workMode,
          workplaceId: workplaceId ?? null,
          reason: reason ?? null,
          createdBy: auth.member.uid,
        },
      })
      .returning();
    return jsonOk(row, 201);
  } catch (err) {
    return jsonError("upsert_override", err);
  }
}
