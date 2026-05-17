// netlify/functions/workspace-task-mentions.ts
// GET  /api/workspace-task-mentions?workspaceId=N&unreadOnly=true  : 내 멘션 목록
// PATCH /api/workspace-task-mentions                                : 읽음 처리 { ids: number[] }

import { Context } from "@netlify/functions";
import { db } from "../../db";
import { workspaceTaskMentions, workspaceTasks, members } from "../../db/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";
import { ok, badRequest, methodNotAllowed, serverError, parseJson } from "../../lib/response";

export default async (req: Request, _ctx: Context) => {
  const guard = await requireAdmin(req);
  if (!guard.ok) return (guard as { ok: false; res: Response }).res;
  const adminMember = guard.ctx.member;
  const meId = adminMember.id;

  const url = new URL(req.url);

  try {
    /* ── GET : 내 멘션 목록 ── */
    if (req.method === "GET") {
      const workspaceId = Number(url.searchParams.get("workspaceId") || 0);
      const unreadOnly = url.searchParams.get("unreadOnly") === "true";

      const conds: any[] = [eq(workspaceTaskMentions.mentionedMemberId, meId)];
      if (workspaceId) conds.push(eq(workspaceTaskMentions.workspaceId, workspaceId));
      if (unreadOnly) conds.push(eq(workspaceTaskMentions.isRead, false));

      const rows: any = await db
        .select()
        .from(workspaceTaskMentions)
        .where(and(...conds))
        .orderBy(sql`${workspaceTaskMentions.createdAt} DESC`)
        .limit(200);

      // 연관 task 제목 조회 (별도 query)
      const taskIds = [...new Set((rows as any[]).map((r: any) => r.taskId).filter(Boolean))] as number[];
      let taskTitleMap: Record<number, string> = {};
      if (taskIds.length > 0) {
        try {
          const taskRows: any = await db
            .select({ id: workspaceTasks.id, title: workspaceTasks.title })
            .from(workspaceTasks)
            .where(inArray(workspaceTasks.id, taskIds));
          for (const t of taskRows as any[]) taskTitleMap[t.id] = t.title;
        } catch { /* 보조 쿼리 실패 무시 */ }
      }

      // 멘션한 사람 이름 조회 (별도 query)
      const mentionerIds = [...new Set((rows as any[]).map((r: any) => r.mentionerMemberId).filter(Boolean))] as number[];
      let mentionerNameMap: Record<number, string> = {};
      if (mentionerIds.length > 0) {
        try {
          const memberRows: any = await db
            .select({ id: members.id, name: members.name })
            .from(members)
            .where(inArray(members.id, mentionerIds));
          for (const m of memberRows as any[]) mentionerNameMap[m.id] = m.name;
        } catch { /* 보조 쿼리 실패 무시 */ }
      }

      const mentions = (rows as any[]).map((r: any) => ({
        id: r.id,
        taskId: r.taskId,
        taskTitle: taskTitleMap[r.taskId] || null,
        mentionerName: mentionerNameMap[r.mentionerMemberId] || null,
        context: r.context,
        isRead: r.isRead,
        readAt: r.readAt,
        createdAt: r.createdAt,
      }));

      return ok({ mentions });
    }

    /* ── PATCH : 읽음 처리 ── */
    if (req.method === "PATCH") {
      const body: any = await parseJson(req);
      if (!body) return badRequest("JSON body 필요");

      const ids: number[] = Array.isArray(body.ids) ? body.ids.map(Number).filter(Boolean) : [];
      if (ids.length === 0) return badRequest("ids 배열 필수");

      await db
        .update(workspaceTaskMentions)
        .set({ isRead: true, readAt: new Date() } as any)
        .where(
          and(
            inArray(workspaceTaskMentions.id, ids),
            eq(workspaceTaskMentions.mentionedMemberId, meId)
          )
        );

      return ok({ updated: ids.length });
    }

    return methodNotAllowed();
  } catch (err: any) {
    console.error("[workspace-task-mentions] error:", err);
    return serverError("멘션 처리 중 오류", err);
  }
};

export const config = { path: "/api/workspace-task-mentions" };
