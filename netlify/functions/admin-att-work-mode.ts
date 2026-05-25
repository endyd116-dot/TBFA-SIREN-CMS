import { db } from "../../db/index";
import { attSchedules, attScheduleOverrides } from "../../db/schema";
import { eq, and, lte, gte, or, isNull } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/admin/att/work-mode" };

function jsonOk(data: unknown) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "근무형태 관리 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;
  if (auth.ctx.member.role !== "super_admin") {
    return new Response(JSON.stringify({ ok: false, error: "슈퍼어드민 전용", step: "role_check" }), {
      status: 403, headers: { "Content-Type": "application/json" },
    });
  }

  // GET: 특정 직원의 스케줄 + 오버라이드 조회
  if (req.method === "GET") {
    const url = new URL(req.url);
    const memberUid = url.searchParams.get("memberUid");
    if (!memberUid) {
      return new Response(JSON.stringify({ ok: false, error: "memberUid 필수", step: "validate" }),
        { status: 400, headers: { "Content-Type": "application/json" } });
    }

    let schedules: any[] = [];
    let overrides: any[] = [];
    try {
      schedules = await db
        .select()
        .from(attSchedules)
        .where(eq(attSchedules.memberUid, memberUid))
        .limit(50);
    } catch (err) {
      return jsonError("select_schedules", err);
    }
    try {
      overrides = await db
        .select()
        .from(attScheduleOverrides)
        .where(eq(attScheduleOverrides.memberUid, memberUid))
        .limit(50);
    } catch (err) {
      console.warn("[work-mode] 오버라이드 조회 실패:", err);
    }

    return jsonOk({ schedules, overrides });
  }

  // POST: 스케줄 또는 오버라이드 생성
  if (req.method === "POST") {
    let body: any;
    try { body = await req.json(); } catch { body = {}; }

    const { memberUid, workMode, recurringRule, startDate, endDate, workplaceId, note } = body;
    if (!memberUid || !workMode || !startDate) {
      return new Response(JSON.stringify({ ok: false, error: "memberUid, workMode, startDate 필수", step: "validate" }),
        { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const validModes = ["OFFICE", "REMOTE", "FIELD", "BUSINESS_TRIP", "HYBRID"];
    if (!validModes.includes(workMode)) {
      return new Response(JSON.stringify({ ok: false, error: `workMode는 ${validModes.join("|")} 중 하나여야 합니다`, step: "validate" }),
        { status: 400, headers: { "Content-Type": "application/json" } });
    }

    // recurringRule 정규화: 문자열("MON:OFFICE,TUE:REMOTE")이면 객체로 파싱.
    //                       객체이면 키를 모두 대문자 3자로 통일.
    let normalizedRule: Record<string, string> | null = null;
    if (recurringRule && typeof recurringRule === "string") {
      normalizedRule = {};
      for (const part of recurringRule.split(",")) {
        const [k, v] = part.split(":").map(s => s.trim());
        if (k && v) normalizedRule[k.toUpperCase()] = v.toUpperCase();
      }
    } else if (recurringRule && typeof recurringRule === "object") {
      normalizedRule = {};
      for (const [k, v] of Object.entries(recurringRule)) {
        if (k && v) normalizedRule[k.toUpperCase()] = String(v).toUpperCase();
      }
    }

    /* 겹치는 활성 스케줄 감지 (같은 직원·기간 겹침)
       - 확인(replaceConflicts) 전이면 알림만 → 프론트가 확인창 1회
       - 확인 후엔 기존 줄을 '새 시작일 전날'로 종료(이력 보존). 같은 날·이후 시작 줄은 0일이라 제거. */
    const newEndForOverlap = endDate ?? "9999-12-31";
    let overlaps: any[] = [];
    try {
      overlaps = await db.select().from(attSchedules).where(and(
        eq(attSchedules.memberUid, String(memberUid)),
        lte(attSchedules.startDate, newEndForOverlap),
        or(isNull(attSchedules.endDate), gte(attSchedules.endDate, startDate)),
      ));
    } catch (e) { console.warn("[work-mode] 겹침 조회 실패:", e); }

    if (overlaps.length > 0 && !body.replaceConflicts) {
      return new Response(JSON.stringify({
        ok: false, needsReplaceConfirm: true,
        message: "겹치는 근무형태가 있습니다. 기존을 종료하고 대체할까요?",
        conflicts: overlaps.map(c => ({ id: c.id, workMode: c.workMode, startDate: c.startDate, endDate: c.endDate })),
      }), { status: 409, headers: { "Content-Type": "application/json" } });
    }

    if (body.replaceConflicts && overlaps.length > 0) {
      const prev = new Date(`${startDate}T00:00:00Z`);
      prev.setUTCDate(prev.getUTCDate() - 1);
      const prevDay = prev.toISOString().slice(0, 10);
      for (const c of overlaps) {
        try {
          if (String(c.startDate) < startDate) {
            await db.update(attSchedules).set({ endDate: prevDay, updatedAt: new Date() } as any).where(eq(attSchedules.id, c.id));
          } else {
            await db.delete(attSchedules).where(eq(attSchedules.id, c.id));
          }
        } catch (e) { console.warn("[work-mode] 겹침 종료 실패:", e); }
      }
    }

    try {
      const [row] = await db
        .insert(attSchedules)
        .values({
          memberUid: String(memberUid),
          workMode,
          recurringRule: normalizedRule,
          startDate,
          endDate: endDate ?? null,
          workplaceId: workplaceId ?? null,
          note: note ?? null,
          createdBy: String(auth.ctx.member.id),
        } as any)
        .returning({ id: attSchedules.id });
      return jsonOk({ id: row.id });
    } catch (err) {
      return jsonError("insert_schedule", err);
    }
  }

  // DELETE: 스케줄 또는 오버라이드 삭제
  if (req.method === "DELETE") {
    let body: any;
    try { body = await req.json(); } catch { body = {}; }

    const { id, type } = body;
    if (!id || !type) {
      return new Response(JSON.stringify({ ok: false, error: "id, type 필수", step: "validate" }),
        { status: 400, headers: { "Content-Type": "application/json" } });
    }

    try {
      if (type === "schedule") {
        await db.delete(attSchedules).where(eq(attSchedules.id, id));
      } else if (type === "override") {
        await db.delete(attScheduleOverrides).where(eq(attScheduleOverrides.id, id));
      } else {
        return new Response(JSON.stringify({ ok: false, error: 'type은 "schedule"|"override" 중 하나', step: "validate" }),
          { status: 400, headers: { "Content-Type": "application/json" } });
      }
      return jsonOk({ message: "삭제 완료" });
    } catch (err) {
      return jsonError("delete_item", err);
    }
  }

  return new Response("Method Not Allowed", { status: 405 });
}
