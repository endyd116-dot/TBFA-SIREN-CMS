// netlify/functions/admin-workspace-memos.ts
// ★ Phase 3 Step 2-A — 워크스페이스 Memo CRUD API
//
// ⚠️ 메모는 완전 개인 — 본인(memberId = meId)만 접근 가능 (super_admin도 조회 불가)
//
// GET ?list=1          : 내 메모 목록 (핀 고정 먼저)
// GET ?list=1&pinned=1 : 고정 메모만
// GET ?list=1&taskId=N : 특정 task 연관
// GET ?list=1&q=검색   : 제목/본문 검색
// GET ?id=N            : 단일
// POST                 : 생성
// PATCH ?id=N          : 수정
// PATCH ?id=N&action=pin : 고정 토글
// DELETE ?id=N         : 삭제

import { Context } from "@netlify/functions";
import { db } from "../../db";
import { workspaceMemos } from "../../db/schema";
import { eq, and, desc, asc, sql } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, badRequest, methodNotAllowed, serverError,
  notFound, forbidden, parseJson,
} from "../../lib/response";
import { logAudit } from "../../lib/audit";
import { logWorkspaceActivity } from "../../lib/workspace-logger";

export default async (req: Request, _ctx: Context) => {
  const guard = await requireAdmin(req);
  if (!guard.ok) return (guard as { ok: false; res: Response }).res;
  const adminMember = guard.ctx.member;
  const meId = adminMember.id;

  const url = new URL(req.url);

  try {
    /* ════════════════════════════════════════════
       GET
    ════════════════════════════════════════════ */
    if (req.method === "GET") {
      const id = url.searchParams.get("id");
      const listFlag = url.searchParams.get("list");

      // ─── 단일 조회 ───
      if (id) {
        const rowId = Number(id);
        if (!rowId) return badRequest("id가 유효하지 않습니다");

        const [memo]: any = await db
          .select()
          .from(workspaceMemos)
          .where(and(eq(workspaceMemos.id, rowId), eq(workspaceMemos.memberId, meId)))
          .limit(1);

        if (!memo) return notFound("메모를 찾을 수 없습니다");
        return ok(memo);
      }

      // ─── 목록 ───
      if (listFlag === "1") {
        const pinned = url.searchParams.get("pinned");
        const color = url.searchParams.get("color");
        const taskId = url.searchParams.get("taskId");
        const eventId = url.searchParams.get("eventId");
        const q = url.searchParams.get("q");
        const limit = Math.min(Number(url.searchParams.get("limit") || 200), 500);

        const conds: any[] = [eq(workspaceMemos.memberId, meId)];

        if (pinned === "1") conds.push(eq(workspaceMemos.isPinned, true));
        if (color) conds.push(eq(workspaceMemos.color, color));
        if (taskId) conds.push(eq(workspaceMemos.relatedTaskId, Number(taskId)));
        if (eventId) conds.push(eq(workspaceMemos.relatedEventId, Number(eventId)));
        if (q) {
          conds.push(sql`(${workspaceMemos.title} ILIKE ${"%" + q + "%"}
                       OR ${workspaceMemos.contentHtml} ILIKE ${"%" + q + "%"})`);
        }

        const items: any = await db
          .select()
          .from(workspaceMemos)
          .where(and(...conds))
          .orderBy(
            desc(workspaceMemos.isPinned),
            asc(workspaceMemos.sortOrder),
            desc(workspaceMemos.updatedAt)
          )
          .limit(limit);

        return ok({ items, total: items.length });
      }

      return badRequest("list=1 또는 id=N 필수");
    }

    /* ════════════════════════════════════════════
       POST — 신규 생성
    ════════════════════════════════════════════ */
    if (req.method === "POST") {
      const body: any = await parseJson(req);
      if (!body) return badRequest("JSON body 필요");

      const title = body.title ? String(body.title).trim().slice(0, 200) : null;
      const contentHtml = body.contentHtml ? String(body.contentHtml) : null;

      if (!title && !contentHtml) {
        return badRequest("title 또는 contentHtml 중 하나는 필수입니다");
      }

      const [newMemo]: any = await db
        .insert(workspaceMemos)
        .values({
          memberId: meId,
          title,
          contentHtml,
          color: body.color || "yellow",
          isPinned: !!body.isPinned,
          sortOrder: body.sortOrder || 0,
          relatedTaskId: body.relatedTaskId || null,
          relatedEventId: body.relatedEventId || null,
          attachments: Array.isArray(body.attachments) ? body.attachments : [],
        } as any)
        .returning();

      await logAudit({
        userId: meId, userType: "admin", userName: adminMember.name,
        action: "workspace.memo.create", target: `memo:${newMemo.id}`,
        detail: { title: newMemo.title || "(제목 없음)" }, req,
      });

      await logWorkspaceActivity({
        actorId: meId,
        actorName: adminMember.name,
        actionType: "memo.create",
        targetType: "memo",
        targetId: newMemo.id,
        targetTitle: newMemo.title || "(제목 없음)",
        metadata: { color: newMemo.color, pinned: newMemo.isPinned },
        visibility: "private",
      });

      return ok(newMemo, "메모가 생성되었습니다");
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

      const [memo]: any = await db
        .select()
        .from(workspaceMemos)
        .where(and(eq(workspaceMemos.id, id), eq(workspaceMemos.memberId, meId)))
        .limit(1);
      if (!memo) return notFound("메모를 찾을 수 없습니다");

      if (action === "pin") {
        const isPinned = body.isPinned !== undefined ? !!body.isPinned : !memo.isPinned;
        const [updated]: any = await db
          .update(workspaceMemos)
          .set({ isPinned, updatedAt: new Date() } as any)
          .where(eq(workspaceMemos.id, id))
          .returning();

        await logWorkspaceActivity({
          actorId: meId,
          actorName: adminMember.name,
          actionType: "memo.pin",
          targetType: "memo",
          targetId: id,
          targetTitle: memo.title || "(제목 없음)",
          metadata: { pinned: isPinned },
          visibility: "private",
        });

        return ok(updated, isPinned ? "고정되었습니다" : "고정이 해제되었습니다");
      }

      const updateData: any = { updatedAt: new Date() };
      if (body.title !== undefined) {
        updateData.title = body.title ? String(body.title).trim().slice(0, 200) : null;
      }
      if (body.contentHtml !== undefined) updateData.contentHtml = body.contentHtml;
      if (body.color !== undefined) updateData.color = body.color;
      if (body.isPinned !== undefined) updateData.isPinned = !!body.isPinned;
      if (body.sortOrder !== undefined) updateData.sortOrder = Number(body.sortOrder);
      if (body.relatedTaskId !== undefined) updateData.relatedTaskId = body.relatedTaskId;
      if (body.relatedEventId !== undefined) updateData.relatedEventId = body.relatedEventId;
      if (body.attachments !== undefined && Array.isArray(body.attachments)) {
        updateData.attachments = body.attachments;
      }

      const [updated]: any = await db
        .update(workspaceMemos)
        .set(updateData)
        .where(eq(workspaceMemos.id, id))
        .returning();

      await logAudit({
        userId: meId, userType: "admin", userName: adminMember.name,
        action: "workspace.memo.update", target: `memo:${id}`,
        detail: { changed: Object.keys(updateData) }, req,
      });

      await logWorkspaceActivity({
        actorId: meId,
        actorName: adminMember.name,
        actionType: "memo.update",
        targetType: "memo",
        targetId: id,
        targetTitle: updated.title || "(제목 없음)",
        metadata: { changedKeys: Object.keys(updateData) },
        visibility: "private",
      });

      return ok(updated, "메모가 수정되었습니다");
    }

    /* ════════════════════════════════════════════
       DELETE
    ════════════════════════════════════════════ */
    if (req.method === "DELETE") {
      const id = Number(url.searchParams.get("id"));
      if (!id) return badRequest("id 필수");

      const [memo]: any = await db
        .select()
        .from(workspaceMemos)
        .where(and(eq(workspaceMemos.id, id), eq(workspaceMemos.memberId, meId)))
        .limit(1);
      if (!memo) return notFound("메모를 찾을 수 없습니다");

      await db.delete(workspaceMemos).where(eq(workspaceMemos.id, id));

      await logAudit({
        userId: meId, userType: "admin", userName: adminMember.name,
        action: "workspace.memo.delete", target: `memo:${id}`,
        detail: { title: memo.title || "(제목 없음)" }, req,
      });

      await logWorkspaceActivity({
        actorId: meId,
        actorName: adminMember.name,
        actionType: "memo.delete",
        targetType: "memo",
        targetId: id,
        targetTitle: memo.title || "(제목 없음)",
        metadata: {},
        visibility: "private",
      });

      return ok({ id }, "메모가 삭제되었습니다");
    }

    return methodNotAllowed();
  } catch (err: any) {
    console.error("[admin-workspace-memos] error:", err);
    return serverError("메모 처리 중 오류", err);
  }
};

export const config = { path: "/api/admin-workspace-memos" };
