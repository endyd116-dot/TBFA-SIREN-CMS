// netlify/functions/workspace-event-rsvp.ts
// POST /api/workspace-event-rsvp  : RSVP 등록·수정 { workspaceId, eventId, status, note? }
// GET  /api/workspace-event-rsvps : RSVP 목록 ?eventId=N

import { Context } from "@netlify/functions";
import { db } from "../../db";
import { workspaceEventRsvps, members } from "../../db/schema";
import { eq, and } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";
import { ok, badRequest, methodNotAllowed, serverError, parseJson } from "../../lib/response";

const VALID_STATUSES = ["yes", "no", "maybe"] as const;

/* ── POST /api/workspace-event-rsvp ── */
export default async (req: Request, _ctx: Context) => {
  const guard = await requireAdmin(req);
  if (!guard.ok) return (guard as { ok: false; res: Response }).res;
  const adminMember = guard.ctx.member;
  const meId = adminMember.id;

  try {
    if (req.method !== "POST") return methodNotAllowed();

    const body: any = await parseJson(req);
    if (!body) return badRequest("JSON body 필요");

    const workspaceId = Number(body.workspaceId);
    const eventId = Number(body.eventId);
    const status = String(body.status || "");
    const note = body.note ? String(body.note).trim().slice(0, 500) : null;

    if (!workspaceId) return badRequest("workspaceId 필수");
    if (!eventId) return badRequest("eventId 필수");
    if (!(VALID_STATUSES as readonly string[]).includes(status)) {
      return badRequest("status는 yes/no/maybe 중 하나");
    }

    // upsert — 같은 (eventId, memberId) 이미 있으면 status·note 갱신
    const existing: any = await db
      .select()
      .from(workspaceEventRsvps)
      .where(
        and(
          eq(workspaceEventRsvps.eventId, eventId),
          eq(workspaceEventRsvps.memberId, meId)
        )
      )
      .limit(1);

    let result: any;
    if ((existing as any[]).length > 0) {
      const [updated]: any = await db
        .update(workspaceEventRsvps)
        .set({ status, note } as any)
        .where(eq(workspaceEventRsvps.id, existing[0].id))
        .returning();
      result = updated;
    } else {
      const [inserted]: any = await db
        .insert(workspaceEventRsvps)
        .values({
          workspaceId,
          eventId,
          memberId: meId,
          status,
          note,
        } as any)
        .returning();
      result = inserted;
    }

    return ok({ id: result.id, eventId: result.eventId, memberId: result.memberId, status: result.status });
  } catch (err: any) {
    console.error("[workspace-event-rsvp POST] error:", err);
    return serverError("RSVP 처리 중 오류", err);
  }
};

export const config = { path: "/api/workspace-event-rsvp" };
