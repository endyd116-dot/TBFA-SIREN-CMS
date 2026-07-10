// netlify/functions/admin-workspace-events.ts
// ★ Phase 3 Step 2-A — 워크스페이스 Event CRUD API
//
// GET ?list=1&from=YYYY-MM-DD&to=YYYY-MM-DD  : 기간 조회 (필수)
// GET ?list=1&mine=1                          : 내가 만든 이벤트
// GET ?list=1&attending=1                     : 참석자에 포함된 이벤트
// GET ?list=1&type=board_meeting              : 이벤트 타입 필터
// GET ?id=N                                   : 단일 상세
// GET ?stats=1&year=YYYY&month=M              : 월별 통계
// GET ?conflicts=1&startAt=...&endAt=...      : 충돌 사전 검증
// POST                                        : 생성 (반복 규칙 지원)
// PATCH ?id=N                                 : 수정
// PATCH ?id=N&action=rsvp { status:'accept'|'decline' } : 참석 응답
// DELETE ?id=N                                : 삭제

import { Context } from "@netlify/functions";
import { db } from "../../db";
import { workspaceEvents, members, workspaceEventRsvps } from "../../db/schema";
import { eq, and, or, desc, asc, sql, gte, lte } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, badRequest, methodNotAllowed, serverError,
  notFound, forbidden, parseJson,
} from "../../lib/response";
import { logAudit } from "../../lib/audit";
import {
  logWorkspaceActivity,
  sendWorkspaceNotification,
  broadcastNotification,
} from "../../lib/workspace-logger";

export default async (req: Request, _ctx: Context) => {
  const guard = await requireAdmin(req);
  if (!guard.ok) return (guard as { ok: false; res: Response }).res;
  const adminMember = guard.ctx.member;
  const meId = adminMember.id;
  const isSuperAdmin = (adminMember as any).role === "super_admin";

  const url = new URL(req.url);

  try {
    /* ════════════════════════════════════════════
       GET
    ════════════════════════════════════════════ */
    if (req.method === "GET") {
      const id = url.searchParams.get("id");
      const listFlag = url.searchParams.get("list");
      const statsFlag = url.searchParams.get("stats");
      const conflictsFlag = url.searchParams.get("conflicts");

      // ─── 충돌 검증 ───
      if (conflictsFlag === "1") {
        const startAt = url.searchParams.get("startAt");
        const endAt = url.searchParams.get("endAt");
        const excludeId = url.searchParams.get("excludeId");
        if (!startAt || !endAt) return badRequest("startAt, endAt 필수");

        const startDate = new Date(startAt);
        const endDate = new Date(endAt);
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
          return badRequest("날짜 형식 오류");
        }

        const conds: any[] = [
          or(
            eq(workspaceEvents.memberId, meId),
            sql`${workspaceEvents.attendees} @> ${JSON.stringify([{ memberId: meId }])}::jsonb`
          ),
          // 겹치는 조건: (start < endDate) AND (end > startDate)
          sql`${workspaceEvents.startAt} < ${endDate.toISOString()}`,
          sql`${workspaceEvents.endAt} > ${startDate.toISOString()}`,
        ];
        if (excludeId) {
          conds.push(sql`${workspaceEvents.id} != ${Number(excludeId)}`);
        }

        const conflicts: any = await db
          .select({
            id: workspaceEvents.id,
            title: workspaceEvents.title,
            startAt: workspaceEvents.startAt,
            endAt: workspaceEvents.endAt,
            eventType: workspaceEvents.eventType,
          })
          .from(workspaceEvents)
          .where(and(...conds))
          .limit(10);

        return ok({
          hasConflict: conflicts.length > 0,
          conflicts,
        });
      }

      // ─── 통계 ───
      if (statsFlag === "1") {
        const year = Number(url.searchParams.get("year") || new Date().getFullYear());
        const month = Number(url.searchParams.get("month") || new Date().getMonth() + 1);

        const rows: any = await db.execute(sql`
          SELECT
            event_type,
            COUNT(*) AS cnt
          FROM workspace_events
          WHERE (member_id=${meId} OR attendees @> ${JSON.stringify([{ memberId: meId }])}::jsonb)
            AND EXTRACT(YEAR FROM start_at) = ${year}
            AND EXTRACT(MONTH FROM start_at) = ${month}
          GROUP BY event_type
        `);
        const list = Array.isArray(rows) ? rows : (rows as any).rows || [];
        const breakdown: Record<string, number> = {};
        let total = 0;
        for (const r of list) {
          breakdown[r.event_type] = Number(r.cnt);
          total += Number(r.cnt);
        }
        return ok({ year, month, total, breakdown });
      }

      // ─── 단일 조회 ───
      if (id) {
        const rowId = Number(id);
        if (!rowId) return badRequest("id가 유효하지 않습니다");

        const [ev]: any = await db
          .select()
          .from(workspaceEvents)
          .where(eq(workspaceEvents.id, rowId))
          .limit(1);
        if (!ev) return notFound("이벤트를 찾을 수 없습니다");

        // 권한: 소유자 / 참석자 / super_admin
        const attendees = Array.isArray(ev.attendees) ? ev.attendees : [];
        const isAttendee = attendees.some((a: any) => a.memberId === meId);
        const canView = isSuperAdmin || ev.memberId === meId || isAttendee;
        if (!canView) return forbidden("조회 권한이 없습니다");

        // 참석자 이름 조회
        const attendeeIds = attendees.map((a: any) => a.memberId).filter(Boolean);
        let memberMap: Record<number, string> = {};
        if (attendeeIds.length > 0) {
          const memberList: any = await db
            .select({ id: members.id, name: members.name })
            .from(members)
            .where(sql`${members.id} = ANY(${attendeeIds})`);
          for (const m of memberList) memberMap[m.id] = m.name;
        }

        const [owner]: any = await db
          .select({ name: members.name })
          .from(members)
          .where(eq(members.id, ev.memberId))
          .limit(1);

        // ★ Q3-006 fix: RSVP 응답은 workspace_event_rsvps 단일 출처에서 조회 (attendees JSONB는 초대 명단 전용).
        //   미응답 = 초대됐으나 rsvps에 행 없는 사람.
        let rsvpMap: Record<number, string> = {};
        try {
          const rsvpRows: any = await db
            .select({ memberId: workspaceEventRsvps.memberId, status: workspaceEventRsvps.status })
            .from(workspaceEventRsvps)
            .where(eq(workspaceEventRsvps.eventId, rowId));
          for (const r of rsvpRows) rsvpMap[r.memberId] = r.status;
        } catch (_) { /* rsvps 조회 실패 시 초대 명단만 표시 */ }

        return ok({
          ...ev,
          _computed: {
            ownerName: owner?.name || null,
            attendeesWithNames: attendees.map((a: any) => ({
              ...a,
              name: memberMap[a.memberId] || null,
              rsvp: rsvpMap[a.memberId] || null,   // 실제 응답(yes/no/maybe), 없으면 미응답
            })),
            isMine: ev.memberId === meId,
            isAttendee,
            myRsvp: rsvpMap[meId] || null,
          },
        });
      }

      // ─── 목록 ───
      if (listFlag === "1") {
        const from = url.searchParams.get("from");
        const to = url.searchParams.get("to");
        const mine = url.searchParams.get("mine") === "1";
        const attending = url.searchParams.get("attending") === "1";
        const type = url.searchParams.get("type");
        const includeMemos = url.searchParams.get("includeMemos") === "1";
        const limit = Math.min(Number(url.searchParams.get("limit") || 200), 500);

        const conds: any[] = [];

        // 스코프 — [감사#18] 기본='전체(공유)': 전 운영자 일정 표시(Swain 결정·소유자명 병기).
        //   mine=내가 만든 것만 / attending=초대받은 것만 / 그 외(기본)=전원 일정
        if (mine) {
          conds.push(eq(workspaceEvents.memberId, meId));
        } else if (attending) {
          conds.push(sql`${workspaceEvents.attendees} @> ${JSON.stringify([{ memberId: meId }])}::jsonb`);
        }
        // else(전체 공유): member 조건 없음 — 모든 운영자 일정 반환

        // P1-15 fix: 날짜만 온 from/to는 KST 하루 경계로 해석
        // (과거 new Date('YYYY-MM-DD')=UTC 자정=KST 09:00라 일 보기에서 오전 9시 이후 일정 누락)
        if (from) conds.push(gte(workspaceEvents.startAt, /T/.test(from) ? new Date(from) : new Date(from + "T00:00:00+09:00")));
        if (to) conds.push(lte(workspaceEvents.startAt, /T/.test(to) ? new Date(to) : new Date(to + "T23:59:59.999+09:00")));
        if (type) conds.push(eq(workspaceEvents.eventType, type));

        const eventItems: any = await db
          .select()
          .from(workspaceEvents)
          .where(and(...conds))
          .orderBy(asc(workspaceEvents.startAt))
          .limit(limit);

        // [감사#18] 공유 캘린더 — 소유자 이름 병기(전 운영자 일정 구분용)
        let ownerMap: Record<number, string> = {};
        const ownerIds = [...new Set(eventItems.map((e: any) => e.memberId).filter(Boolean))];
        if (ownerIds.length > 0) {
          try {
            const owners: any = await db.select({ id: members.id, name: members.name })
              .from(members).where(sql`${members.id} = ANY(${ownerIds})`);
            for (const o of owners) ownerMap[o.id] = o.name;
          } catch { /* 이름 조회 실패는 무시 */ }
        }
        const typedEvents = eventItems.map((e: any) => ({ type: "event", ...e, ownerName: ownerMap[e.memberId] || null }));

        // Phase 21 R4 — 메모 미러링 (includeMemos=1 + from/to 기간 내 showInCalendar=true 메모)
        let memoItems: any[] = [];
        if (includeMemos && from && to) {
          try {
            const memoRows: any = await db.execute(sql`
              SELECT
                id,
                title,
                color,
                is_pinned AS "isPinned",
                show_in_calendar AS "showInCalendar",
                TO_CHAR(event_date, 'YYYY-MM-DD') AS "eventDate",
                TO_CHAR(event_time, 'HH24:MI:SS') AS "eventTime"
              FROM workspace_memos
              WHERE member_id = ${meId}
                AND show_in_calendar = TRUE
                AND event_date BETWEEN ${from}::date AND ${to}::date
              ORDER BY event_date ASC
              LIMIT 500
            `);
            const rows = Array.isArray(memoRows) ? memoRows : (memoRows as any).rows || [];
            memoItems = rows.map((m: any) => ({
              type: "memo",
              id: m.id,
              title: m.title,
              startAt: m.eventTime
                ? `${m.eventDate}T${m.eventTime}`
                : m.eventDate,
              endAt: null,
              allDay: !m.eventTime,
              color: m.color || null,
              isPinned: !!m.isPinned,
            }));
          } catch { /* 컬럼 미생성 시 빈 배열 */ }
        }

        const items = [...typedEvents, ...memoItems];
        return ok({ items, total: items.length });
      }

      return badRequest("list=1 / id=N / stats=1 / conflicts=1 중 하나 필수");
    }

    /* ════════════════════════════════════════════
       POST — 신규 생성 (반복 일정 지원)
    ════════════════════════════════════════════ */
    if (req.method === "POST") {
      const body: any = await parseJson(req);
      if (!body) return badRequest("JSON body 필요");

      if (!body.title) return badRequest("title 필수");
      if (!body.startAt || !body.endAt) return badRequest("startAt, endAt 필수");

      const startDate = new Date(body.startAt);
      const endDate = new Date(body.endAt);
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return badRequest("날짜 형식 오류");
      }
      if (endDate < startDate) return badRequest("endAt이 startAt보다 앞섭니다");

      // 참석자 구조 정규화
      const attendees = Array.isArray(body.attendees)
        ? body.attendees.map((a: any) => ({
            memberId: Number(a.memberId),
            status: a.status || "invited",   // 'invited' | 'accepted' | 'declined'
            respondedAt: a.respondedAt || null,
          })).filter((a: any) => a.memberId)
        : [];

      const [newEvent]: any = await db
        .insert(workspaceEvents)
        .values({
          memberId: meId,
          title: String(body.title).trim().slice(0, 300),
          location: body.location || null,
          startAt: startDate,
          endAt: endDate,
          allDay: !!body.allDay,
          color: body.color || "blue",
          description: body.description || null,
          attendees,
          externalRef: body.externalRef || null,
          eventType: body.eventType || "general",
          sourceType: body.sourceType || null,
          sourceId: body.sourceId || null,
          recurringRule: body.recurringRule || null,
          recurringParentId: body.recurringParentId || null,
          reminderConfig: body.reminderConfig || {},
          remindersSentAt: [],
          createdByAgent: body.createdByAgent || "user",
        } as any)
        .returning();

      // 감사 로그
      await logAudit({
        userId: meId, userType: "admin", userName: adminMember.name,
        action: "workspace.event.create", target: `event:${newEvent.id}`,
        detail: {
          title: newEvent.title,
          eventType: newEvent.eventType,
          attendeeCount: attendees.length,
        }, req,
      });

      // Activity Log
      await logWorkspaceActivity({
        actorId: meId,
        actorName: adminMember.name,
        actionType: "event.create",
        targetType: "event",
        targetId: newEvent.id,
        targetTitle: newEvent.title,
        metadata: {
          eventType: newEvent.eventType,
          startAt: newEvent.startAt,
          attendeeCount: attendees.length,
        },
        visibility: "team",
      });

      // 참석자에게 초대 알림
      const attendeeIds = attendees.map((a: any) => a.memberId).filter((mid: number) => mid !== meId);
      if (attendeeIds.length > 0) {
        await broadcastNotification(attendeeIds, {
          sourceType: "event",
          sourceId: newEvent.id,
          notifType: "invited",
          channel: "bell",
          title: `📅 새 일정 초대: ${newEvent.title}`,
          body: `${startDate.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} · ${body.location || "장소 미정"}`,
          actionUrl: `/workspace-calendar.html`,  // [감사#29] 죽은 해시 → 캘린더
        });
      }

      return ok(newEvent, "이벤트가 생성되었습니다");
    }

    /* ════════════════════════════════════════════
       PATCH — 수정
    ════════════════════════════════════════════ */
    if (req.method === "PATCH") {
      const id = Number(url.searchParams.get("id"));
      if (!id) return badRequest("id 필수");
      const action = url.searchParams.get("action");
      const body: any = await parseJson(req);
      if (!body) return badRequest("JSON body 필요");

      const [ev]: any = await db
        .select()
        .from(workspaceEvents)
        .where(eq(workspaceEvents.id, id))
        .limit(1);
      if (!ev) return notFound("이벤트를 찾을 수 없습니다");

      /* ─── action=rsvp (참석 응답) ─── */
      // ★ Q3-006 fix: 응답은 workspace_event_rsvps 단일 출처에 upsert (attendees JSONB는 초대 명단 전용으로 보존).
      //   기존엔 응답을 attendees JSONB에 써서 캘린더 UI(workspace-event-rsvp)의 rsvps 테이블과 이원화됐다.
      if (action === "rsvp") {
        /* OP-037: 초대 여부 검증 — 주최자이거나 attendees에 포함된 사람만 응답 가능(주최자 알림 스팸 방지). */
        const evAttendeeIds: number[] = Array.isArray(ev.attendees)
          ? ev.attendees
              .map((a: any) => (typeof a === "number" ? a : Number(a?.memberId)))
              .filter((n: number) => Number.isFinite(n) && n > 0)
          : [];
        if (ev.memberId !== meId && !evAttendeeIds.includes(meId)) {
          return forbidden("초대된 일정에만 응답할 수 있습니다");
        }
        const statusMap: Record<string, string> = { accepted: "yes", declined: "no", invited: "maybe", yes: "yes", no: "no", maybe: "maybe" };
        const rsvpStatus = statusMap[String(body.status || "")];
        if (!rsvpStatus) return badRequest("status는 yes/no/maybe (또는 accepted/declined)");
        try {
          const exist: any = await db
            .select({ id: workspaceEventRsvps.id })
            .from(workspaceEventRsvps)
            .where(and(eq(workspaceEventRsvps.eventId, id), eq(workspaceEventRsvps.memberId, meId)))
            .limit(1);
          if (exist.length > 0) {
            await db.update(workspaceEventRsvps).set({ status: rsvpStatus } as any).where(eq(workspaceEventRsvps.id, exist[0].id));
          } else {
            await db.insert(workspaceEventRsvps).values({ workspaceId: (ev as any).workspaceId ?? 1, eventId: id, memberId: meId, status: rsvpStatus } as any);
          }
        } catch (e: any) {
          return serverError("RSVP 저장 실패", e);
        }

        await logWorkspaceActivity({
          actorId: meId,
          actorName: adminMember.name,
          actionType: rsvpStatus === "yes" ? "event.rsvp.accept" : "event.rsvp.decline",
          targetType: "event",
          targetId: id,
          targetTitle: ev.title,
          metadata: { status: rsvpStatus },
          visibility: "team",
        });

        // 주최자에게 응답 알림
        if (ev.memberId !== meId) {
          const label = rsvpStatus === "yes" ? "참석" : rsvpStatus === "no" ? "불참" : "미정";
          await sendWorkspaceNotification({
            memberId: ev.memberId,
            sourceType: "event",
            sourceId: id,
            notifType: rsvpStatus === "yes" ? "approved" : "rejected",
            channel: "bell",
            title: `${adminMember.name}님이 ${label}: ${ev.title}`,
            actionUrl: `/workspace-calendar.html`,  // [감사#29] 죽은 해시 → 캘린더
          });
        }

        return ok({ eventId: id, status: rsvpStatus }, "응답이 저장되었습니다");
      }

      /* ─── 일반 PATCH ─── */
      // 권한: 소유자 또는 super_admin
      if (ev.memberId !== meId && !isSuperAdmin) {
        return forbidden("소유자만 수정할 수 있습니다");
      }

      const updateData: any = { updatedAt: new Date() };
      if (body.title !== undefined) updateData.title = String(body.title).trim().slice(0, 300);
      if (body.location !== undefined) updateData.location = body.location;
      if (body.startAt !== undefined) {
        const d = new Date(body.startAt);
        if (isNaN(d.getTime())) return badRequest("startAt 형식 오류");
        updateData.startAt = d;
      }
      if (body.endAt !== undefined) {
        const d = new Date(body.endAt);
        if (isNaN(d.getTime())) return badRequest("endAt 형식 오류");
        updateData.endAt = d;
      }
      if (body.allDay !== undefined) updateData.allDay = !!body.allDay;
      if (body.color !== undefined) updateData.color = body.color;
      if (body.description !== undefined) updateData.description = body.description;
      if (body.eventType !== undefined) updateData.eventType = body.eventType;
      if (body.recurringRule !== undefined) updateData.recurringRule = body.recurringRule;
      if (body.reminderConfig !== undefined) updateData.reminderConfig = body.reminderConfig;
      if (body.attendees !== undefined && Array.isArray(body.attendees)) {
        updateData.attendees = body.attendees.map((a: any) => ({
          memberId: Number(a.memberId),
          status: a.status || "invited",
          respondedAt: a.respondedAt || null,
        })).filter((a: any) => a.memberId);
      }

      const [updated]: any = await db
        .update(workspaceEvents)
        .set(updateData)
        .where(eq(workspaceEvents.id, id))
        .returning();

      await logAudit({
        userId: meId, userType: "admin", userName: adminMember.name,
        action: "workspace.event.update", target: `event:${id}`,
        detail: { changed: Object.keys(updateData) }, req,
      });

      await logWorkspaceActivity({
        actorId: meId,
        actorName: adminMember.name,
        actionType: "event.update",
        targetType: "event",
        targetId: id,
        targetTitle: updated.title,
        metadata: { changedKeys: Object.keys(updateData) },
        visibility: "team",
      });

      return ok(updated, "이벤트가 수정되었습니다");
    }

    /* ════════════════════════════════════════════
       DELETE
    ════════════════════════════════════════════ */
    if (req.method === "DELETE") {
      const id = Number(url.searchParams.get("id"));
      if (!id) return badRequest("id 필수");

      const [ev]: any = await db
        .select()
        .from(workspaceEvents)
        .where(eq(workspaceEvents.id, id))
        .limit(1);
      if (!ev) return notFound("이벤트를 찾을 수 없습니다");

      if (ev.memberId !== meId && !isSuperAdmin) {
        return forbidden("소유자만 삭제할 수 있습니다");
      }

      await db.delete(workspaceEvents).where(eq(workspaceEvents.id, id));

      // 참석자들에게 취소 알림
      const attendees = Array.isArray(ev.attendees) ? ev.attendees : [];
      const notifyIds = attendees
        .map((a: any) => a.memberId)
        .filter((mid: number) => mid && mid !== meId);
      if (notifyIds.length > 0) {
        await broadcastNotification(notifyIds, {
          sourceType: "event",
          sourceId: id,
          notifType: "rejected",
          channel: "bell",
          title: `❌ 일정이 취소되었습니다: ${ev.title}`,
          body: new Date(ev.startAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }),
        });
      }

      await logAudit({
        userId: meId, userType: "admin", userName: adminMember.name,
        action: "workspace.event.delete", target: `event:${id}`,
        detail: { title: ev.title }, req,
      });

      await logWorkspaceActivity({
        actorId: meId,
        actorName: adminMember.name,
        actionType: "event.delete",
        targetType: "event",
        targetId: id,
        targetTitle: ev.title,
        metadata: { eventType: ev.eventType },
        visibility: "team",
      });

      return ok({ id }, "이벤트가 삭제되었습니다");
    }

    return methodNotAllowed();
  } catch (err: any) {
    console.error("[admin-workspace-events] error:", err);
    return serverError("이벤트 처리 중 오류", err);
  }
};

export const config = { path: "/api/admin-workspace-events" };
