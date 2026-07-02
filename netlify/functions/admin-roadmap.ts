// netlify/functions/admin-roadmap.ts
// 사업 로드맵 (목표·단계) CRUD API — 2026-07-02
//
// GET  /api/admin-roadmap                          : 목표 목록 + 각 목표의 단계 중첩 + 진행률 자동 집계
//        &status= &category= &ownerId=             : 필터
// GET  /api/admin-roadmap?id=N                     : 단일 목표 + 단계
// GET  /api/admin-roadmap?calendar=1&from=&to=     : 캘린더 오버레이용 단계(기간 겹침) 평면 목록
// POST /api/admin-roadmap  { resource:'objective'|'phase', ... }   : 생성 (슈퍼/어드민)
// PATCH /api/admin-roadmap?id=N  { resource, ... }                 : 수정 (슈퍼/어드민)
// DELETE /api/admin-roadmap?id=N&resource=objective|phase          : 삭제 (슈퍼/어드민)
//
// 열람은 관리자 전원(오퍼레이터 포함), 편집(POST/PATCH/DELETE)은 super_admin·admin 만.

import { Context } from "@netlify/functions";
import { db } from "../../db";
import { roadmapObjectives, roadmapPhases, members } from "../../db/schema";
import { eq, and, asc, inArray, lte, gte, sql } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, created, badRequest, methodNotAllowed, serverError,
  notFound, forbidden, parseJson,
} from "../../lib/response";
import { logAudit } from "../../lib/audit";

const VALID_OBJ_STATUS = ["planned", "active", "done", "paused", "cancelled"];
const VALID_PHASE_STATUS = ["planned", "in_progress", "done", "blocked"];

/** 단계 진행률로 목표 진행률 자동 집계 (단계 없으면 목표 자체 progress 사용) */
function computeObjectiveProgress(obj: any, phases: any[]): number {
  if (!phases || phases.length === 0) return obj.progress ?? 0;
  const sum = phases.reduce((acc, p) => acc + (Number(p.progress) || 0), 0);
  return Math.round(sum / phases.length);
}

export default async (req: Request, _ctx: Context) => {
  const guard = await requireAdmin(req);
  if (!guard.ok) return (guard as { ok: false; res: Response }).res;
  const me = guard.ctx.member;
  const meId = me.id;
  const role = (me as any).role;
  const canEdit = role === "super_admin" || role === "admin";

  const url = new URL(req.url);

  try {
    /* ════════════════════════════════════════════ GET ════════════════════════════════════════════ */
    if (req.method === "GET") {
      const idParam = url.searchParams.get("id");
      const calendarFlag = url.searchParams.get("calendar");

      // ── 캘린더 오버레이용: 기간과 겹치는 단계 평면 목록 ──
      if (calendarFlag === "1") {
        const from = url.searchParams.get("from");
        const to = url.searchParams.get("to");
        if (!from || !to) return badRequest("from, to (YYYY-MM-DD) 필수");

        // 겹침 조건: phase.start_date <= to AND phase.end_date >= from
        const phases = await db.select().from(roadmapPhases)
          .where(and(lte(roadmapPhases.startDate, to), gte(roadmapPhases.endDate, from)))
          .orderBy(asc(roadmapPhases.startDate));

        const objIds = [...new Set(phases.map(p => p.objectiveId))];
        let objMap = new Map<number, any>();
        if (objIds.length) {
          const objs = await db.select({
            id: roadmapObjectives.id, title: roadmapObjectives.title,
            color: roadmapObjectives.color, category: roadmapObjectives.category,
          }).from(roadmapObjectives).where(inArray(roadmapObjectives.id, objIds));
          objMap = new Map(objs.map(o => [o.id, o]));
        }

        const phaseItems = phases.map(p => {
          const obj = objMap.get(p.objectiveId);
          return {
            kind: "phase",
            phaseId: p.id,
            objectiveId: p.objectiveId,
            objectiveTitle: obj?.title || "",
            title: p.title,
            status: p.status,
            progress: p.progress,
            startDate: p.startDate,
            endDate: p.endDate,
            color: p.color || obj?.color || "indigo",
            category: obj?.category || null,
          };
        });

        // 기간(시작일+목표완료일)이 설정된 목표도 막대로 표시 (start<=to AND target>=from)
        const objsInRange = await db.select().from(roadmapObjectives)
          .where(and(lte(roadmapObjectives.startDate, to), gte(roadmapObjectives.targetDate, from)))
          .orderBy(asc(roadmapObjectives.startDate));
        const objItems = objsInRange.map(o => ({
          kind: "objective",
          objectiveId: o.id,
          objectiveTitle: o.title,
          title: o.title,
          status: o.status,
          progress: o.progress,
          startDate: o.startDate,
          endDate: o.targetDate,   // 목표 완료일을 종료로 매핑
          color: o.color || "indigo",
          category: o.category || null,
        }));

        return ok({ items: [...objItems, ...phaseItems] });
      }

      // ── 단일 목표 + 단계 ──
      if (idParam) {
        const id = Number(idParam);
        if (!Number.isInteger(id)) return badRequest("잘못된 id");
        const [obj] = await db.select().from(roadmapObjectives).where(eq(roadmapObjectives.id, id)).limit(1);
        if (!obj) return notFound("목표를 찾을 수 없습니다");
        const phases = await db.select().from(roadmapPhases)
          .where(eq(roadmapPhases.objectiveId, id))
          .orderBy(asc(roadmapPhases.sortOrder), asc(roadmapPhases.startDate));
        return ok({
          objective: { ...obj, progress: computeObjectiveProgress(obj, phases), phaseCount: phases.length },
          phases,
        });
      }

      // ── 목표 목록 + 단계 중첩 ──
      const statusF = url.searchParams.get("status");
      const categoryF = url.searchParams.get("category");
      const ownerF = url.searchParams.get("ownerId");
      const conds: any[] = [];
      if (statusF) conds.push(eq(roadmapObjectives.status, statusF));
      if (categoryF) conds.push(eq(roadmapObjectives.category, categoryF));
      if (ownerF && Number.isInteger(Number(ownerF))) conds.push(eq(roadmapObjectives.ownerId, Number(ownerF)));

      const objs = await db.select().from(roadmapObjectives)
        .where(conds.length ? and(...conds) : undefined as any)
        .orderBy(asc(roadmapObjectives.sortOrder), asc(roadmapObjectives.targetDate))
        .limit(500);

      // 단계 일괄 조회 후 JS Map 매칭 (§6.3 leftJoin 체인 회피)
      const objIds = objs.map(o => o.id);
      let phaseMap = new Map<number, any[]>();
      if (objIds.length) {
        const allPhases = await db.select().from(roadmapPhases)
          .where(inArray(roadmapPhases.objectiveId, objIds))
          .orderBy(asc(roadmapPhases.sortOrder), asc(roadmapPhases.startDate));
        for (const p of allPhases) {
          if (!phaseMap.has(p.objectiveId)) phaseMap.set(p.objectiveId, []);
          phaseMap.get(p.objectiveId)!.push(p);
        }
      }

      const items = objs.map(o => {
        const phases = phaseMap.get(o.id) || [];
        return {
          ...o,
          progress: computeObjectiveProgress(o, phases),
          phaseCount: phases.length,
          phases,
        };
      });
      return ok({ items, canEdit });
    }

    /* ════════════════════════════════════════════ 편집 권한 게이트 ════════════════════════════════════════════ */
    if (!canEdit) return forbidden("목표·단계 편집은 슈퍼어드민·어드민만 가능합니다");

    /* ════════════════════════════════════════════ POST (생성) ════════════════════════════════════════════ */
    if (req.method === "POST") {
      const body = await parseJson<any>(req);
      if (!body) return badRequest("본문 파싱 실패");
      const resource = body.resource;

      if (resource === "objective") {
        const title = String(body.title || "").trim();
        if (!title) return badRequest("제목은 필수입니다");
        const status = VALID_OBJ_STATUS.includes(body.status) ? body.status : "active";

        // 담당자 표시명 스냅샷
        let ownerName: string | null = body.ownerName || null;
        const ownerId = body.ownerId ? Number(body.ownerId) : null;
        if (ownerId && !ownerName) {
          const [m] = await db.select({ name: members.name }).from(members).where(eq(members.id, ownerId)).limit(1);
          ownerName = m?.name || null;
        }

        const [row] = await db.insert(roadmapObjectives).values({
          title: title.slice(0, 300),
          description: body.description || null,
          category: body.category ? String(body.category).slice(0, 50) : null,
          status,
          progress: Math.max(0, Math.min(100, Number(body.progress) || 0)),
          ownerId, ownerName,
          startDate: body.startDate || null,
          targetDate: body.targetDate || null,
          color: body.color ? String(body.color).slice(0, 20) : "indigo",
          sortOrder: Number(body.sortOrder) || 0,
          createdBy: meId,
        } as any).returning();

        await logAudit({ userId: meId, userType: "admin", userName: (me as any).name, action: "roadmap.objective.create", target: `objective:${row.id}`, detail: { title }, req });
        return created({ objective: row }, "목표가 생성되었습니다");
      }

      if (resource === "phase") {
        const objectiveId = Number(body.objectiveId);
        if (!Number.isInteger(objectiveId)) return badRequest("objectiveId 필수");
        const title = String(body.title || "").trim();
        if (!title) return badRequest("제목은 필수입니다");
        if (!body.startDate || !body.endDate) return badRequest("시작일·종료일은 필수입니다");
        if (String(body.endDate) < String(body.startDate)) return badRequest("종료일이 시작일보다 빠를 수 없습니다");

        const [parent] = await db.select({ id: roadmapObjectives.id }).from(roadmapObjectives).where(eq(roadmapObjectives.id, objectiveId)).limit(1);
        if (!parent) return badRequest("상위 목표가 존재하지 않습니다");

        const status = VALID_PHASE_STATUS.includes(body.status) ? body.status : "planned";
        const [row] = await db.insert(roadmapPhases).values({
          objectiveId,
          title: title.slice(0, 300),
          description: body.description || null,
          status,
          progress: Math.max(0, Math.min(100, Number(body.progress) || 0)),
          startDate: body.startDate,
          endDate: body.endDate,
          color: body.color ? String(body.color).slice(0, 20) : null,
          sortOrder: Number(body.sortOrder) || 0,
          createdBy: meId,
        } as any).returning();

        await logAudit({ userId: meId, userType: "admin", userName: (me as any).name, action: "roadmap.phase.create", target: `phase:${row.id}`, detail: { title, objectiveId }, req });
        return created({ phase: row }, "단계가 추가되었습니다");
      }

      return badRequest("resource는 objective 또는 phase 여야 합니다");
    }

    /* ════════════════════════════════════════════ PATCH (수정) ════════════════════════════════════════════ */
    if (req.method === "PATCH") {
      const id = Number(url.searchParams.get("id"));
      if (!Number.isInteger(id)) return badRequest("id 필수");
      const body = await parseJson<any>(req);
      if (!body) return badRequest("본문 파싱 실패");
      const resource = body.resource;

      if (resource === "objective") {
        const [existing] = await db.select().from(roadmapObjectives).where(eq(roadmapObjectives.id, id)).limit(1);
        if (!existing) return notFound("목표를 찾을 수 없습니다");

        const patch: any = { updatedAt: new Date() };
        if (body.title !== undefined) { const t = String(body.title).trim(); if (!t) return badRequest("제목은 비울 수 없습니다"); patch.title = t.slice(0, 300); }
        if (body.description !== undefined) patch.description = body.description || null;
        if (body.category !== undefined) patch.category = body.category ? String(body.category).slice(0, 50) : null;
        if (body.status !== undefined) { if (!VALID_OBJ_STATUS.includes(body.status)) return badRequest("잘못된 상태"); patch.status = body.status; }
        if (body.progress !== undefined) patch.progress = Math.max(0, Math.min(100, Number(body.progress) || 0));
        if (body.startDate !== undefined) patch.startDate = body.startDate || null;
        if (body.targetDate !== undefined) patch.targetDate = body.targetDate || null;
        if (body.color !== undefined) patch.color = body.color ? String(body.color).slice(0, 20) : "indigo";
        if (body.sortOrder !== undefined) patch.sortOrder = Number(body.sortOrder) || 0;
        if (body.ownerId !== undefined) {
          const ownerId = body.ownerId ? Number(body.ownerId) : null;
          patch.ownerId = ownerId;
          if (ownerId) {
            const [m] = await db.select({ name: members.name }).from(members).where(eq(members.id, ownerId)).limit(1);
            patch.ownerName = m?.name || null;
          } else patch.ownerName = null;
        }

        const [row] = await db.update(roadmapObjectives).set(patch).where(eq(roadmapObjectives.id, id)).returning();
        await logAudit({ userId: meId, userType: "admin", userName: (me as any).name, action: "roadmap.objective.update", target: `objective:${id}`, detail: { fields: Object.keys(patch) }, req });
        return ok({ objective: row }, "목표가 수정되었습니다");
      }

      if (resource === "phase") {
        const [existing] = await db.select().from(roadmapPhases).where(eq(roadmapPhases.id, id)).limit(1);
        if (!existing) return notFound("단계를 찾을 수 없습니다");

        const patch: any = { updatedAt: new Date() };
        if (body.title !== undefined) { const t = String(body.title).trim(); if (!t) return badRequest("제목은 비울 수 없습니다"); patch.title = t.slice(0, 300); }
        if (body.description !== undefined) patch.description = body.description || null;
        if (body.status !== undefined) { if (!VALID_PHASE_STATUS.includes(body.status)) return badRequest("잘못된 상태"); patch.status = body.status; }
        if (body.progress !== undefined) patch.progress = Math.max(0, Math.min(100, Number(body.progress) || 0));
        if (body.startDate !== undefined) { if (!body.startDate) return badRequest("시작일은 비울 수 없습니다"); patch.startDate = body.startDate; }
        if (body.endDate !== undefined) { if (!body.endDate) return badRequest("종료일은 비울 수 없습니다"); patch.endDate = body.endDate; }
        const newStart = patch.startDate ?? existing.startDate;
        const newEnd = patch.endDate ?? existing.endDate;
        if (String(newEnd) < String(newStart)) return badRequest("종료일이 시작일보다 빠를 수 없습니다");
        if (body.color !== undefined) patch.color = body.color ? String(body.color).slice(0, 20) : null;
        if (body.sortOrder !== undefined) patch.sortOrder = Number(body.sortOrder) || 0;

        const [row] = await db.update(roadmapPhases).set(patch).where(eq(roadmapPhases.id, id)).returning();
        await logAudit({ userId: meId, userType: "admin", userName: (me as any).name, action: "roadmap.phase.update", target: `phase:${id}`, detail: { fields: Object.keys(patch) }, req });
        return ok({ phase: row }, "단계가 수정되었습니다");
      }

      return badRequest("resource는 objective 또는 phase 여야 합니다");
    }

    /* ════════════════════════════════════════════ DELETE ════════════════════════════════════════════ */
    if (req.method === "DELETE") {
      const id = Number(url.searchParams.get("id"));
      const resource = url.searchParams.get("resource");
      if (!Number.isInteger(id)) return badRequest("id 필수");

      if (resource === "objective") {
        const [existing] = await db.select({ id: roadmapObjectives.id }).from(roadmapObjectives).where(eq(roadmapObjectives.id, id)).limit(1);
        if (!existing) return notFound("목표를 찾을 수 없습니다");
        await db.delete(roadmapObjectives).where(eq(roadmapObjectives.id, id)); // 단계는 FK cascade
        await logAudit({ userId: meId, userType: "admin", userName: (me as any).name, action: "roadmap.objective.delete", target: `objective:${id}`, detail: {}, req });
        return ok({ id }, "목표가 삭제되었습니다 (하위 단계 포함)");
      }
      if (resource === "phase") {
        const [existing] = await db.select({ id: roadmapPhases.id }).from(roadmapPhases).where(eq(roadmapPhases.id, id)).limit(1);
        if (!existing) return notFound("단계를 찾을 수 없습니다");
        await db.delete(roadmapPhases).where(eq(roadmapPhases.id, id));
        await logAudit({ userId: meId, userType: "admin", userName: (me as any).name, action: "roadmap.phase.delete", target: `phase:${id}`, detail: {}, req });
        return ok({ id }, "단계가 삭제되었습니다");
      }
      return badRequest("resource=objective 또는 phase 필요");
    }

    return methodNotAllowed();
  } catch (err: any) {
    console.error("[admin-roadmap] error:", err);
    return serverError("로드맵 처리 중 오류", err);
  }
};

export const config = { path: "/api/admin-roadmap" };
