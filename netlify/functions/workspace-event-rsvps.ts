// netlify/functions/workspace-event-rsvps.ts
// GET /api/workspace-event-rsvps?eventId=N  : 이벤트별 RSVP 목록 + 집계

import { Context } from "@netlify/functions";
import { db } from "../../db";
import { workspaceEventRsvps, workspaceEvents, members } from "../../db/schema";
import { eq, inArray } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";
import { ok, badRequest, methodNotAllowed, serverError, forbidden, notFound } from "../../lib/response";

export default async (req: Request, _ctx: Context) => {
  const guard = await requireAdmin(req);
  if (!guard.ok) return (guard as { ok: false; res: Response }).res;
  const meId = guard.ctx.member.id as number;
  const isSuperAdmin = (guard.ctx.member as any).role === "super_admin";

  try {
    if (req.method !== "GET") return methodNotAllowed();

    const url = new URL(req.url);
    const eventId = Number(url.searchParams.get("eventId") || 0);
    if (!eventId) return badRequest("eventId 필수");

    // [감사#72] RSVP 목록 조회 IDOR 차단 — 단건 조회와 동일(소유자/참석자/super_admin만)
    const [ev]: any = await db.select().from(workspaceEvents).where(eq(workspaceEvents.id, eventId)).limit(1);
    if (!ev) return notFound("일정을 찾을 수 없습니다");
    const attendees = Array.isArray(ev.attendees) ? ev.attendees : [];
    const isAttendee = attendees.some((a: any) => a.memberId === meId);
    if (!(isSuperAdmin || ev.memberId === meId || isAttendee)) return forbidden("조회 권한이 없습니다");

    const rows: any = await db
      .select()
      .from(workspaceEventRsvps)
      .where(eq(workspaceEventRsvps.eventId, eventId));

    // 멤버 이름 조회 (별도 query)
    const memberIds = [...new Set((rows as any[]).map((r: any) => r.memberId).filter(Boolean))] as number[];
    let memberNameMap: Record<number, string> = {};
    if (memberIds.length > 0) {
      try {
        const memberRows: any = await db
          .select({ id: members.id, name: members.name })
          .from(members)
          .where(inArray(members.id, memberIds));
        for (const m of memberRows as any[]) memberNameMap[m.id] = m.name;
      } catch { /* 보조 쿼리 실패 무시 */ }
    }

    const rsvps = (rows as any[]).map((r: any) => ({
      id: r.id,
      workspaceId: r.workspaceId,
      eventId: r.eventId,
      memberId: r.memberId,
      memberName: memberNameMap[r.memberId] || null,
      status: r.status,
      note: r.note,
      respondedAt: r.respondedAt,
    }));

    const summary = {
      yes: rsvps.filter((r: any) => r.status === "yes").length,
      no: rsvps.filter((r: any) => r.status === "no").length,
      maybe: rsvps.filter((r: any) => r.status === "maybe").length,
    };

    return ok({ rsvps, summary });
  } catch (err: any) {
    console.error("[workspace-event-rsvps] error:", err);
    return serverError("RSVP 목록 조회 중 오류", err);
  }
};

export const config = { path: "/api/workspace-event-rsvps" };
