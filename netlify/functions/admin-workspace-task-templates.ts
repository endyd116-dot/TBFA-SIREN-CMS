/**
 * Phase 3 Step 7-C.4 — 워크스페이스 작업 템플릿 CRUD
 *
 * GET    ?list=1                    : 공유 + 본인 템플릿 목록 (usageCount 내림차순)
 * GET    ?id=N                      : 단건
 * POST   {name, description?, priority?, estimatedHours?, defaultSubtasks?, defaultTags?, isShared?}
 * PATCH  ?id=N {위와 동일 필드}
 * DELETE ?id=N
 *
 * 권한:
 * - 본인 템플릿: 모두 가능
 * - 공유 템플릿(isShared=true): 모두 조회 가능, 수정·삭제는 작성자 + super_admin
 *
 * usageCount 증가는 admin-workspace-tasks 의 POST {templateId: N} 처리부에서 (Step 7-C.4.b).
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import {
  workspaceTaskTemplates,
  members,
} from "../../db/schema";
import { eq, and, or, desc } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, badRequest, forbidden, notFound, methodNotAllowed,
  serverError, parseJson,
} from "../../lib/response";
import { logAudit } from "../../lib/audit";

const MAX_NAME = 200;
const MAX_DESC = 5000;
const MAX_TAGS = 20;
const MAX_SUBTASKS = 30;

function sanitizeStr(s: any, max: number): string {
  return String(s == null ? "" : s).trim().slice(0, max);
}

function normalizeSubtasks(input: any): any[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter(it => it && typeof it === "object")
    .map(it => ({
      text: sanitizeStr(it.text, 200),
      done: !!it.done,
    }))
    .filter(it => it.text)
    .slice(0, MAX_SUBTASKS);
}

function normalizeTags(input: any): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((x: any) => sanitizeStr(x, 30))
    .filter((x: string) => x)
    .slice(0, MAX_TAGS);
}

export default async (req: Request, _ctx: Context) => {
  const guard = await requireAdmin(req);
  if (!guard.ok) return (guard as { ok: false; res: Response }).res;
  const adminMember = guard.ctx.member as any;
  const meId = adminMember.id as number;
  const isSuperAdmin = (adminMember.role || "") === "super_admin";

  const url = new URL(req.url);

  try {
    /* ════════ GET ════════ */
    if (req.method === "GET") {
      const id = url.searchParams.get("id");
      const listFlag = url.searchParams.get("list");

      if (id) {
        const rows: any = await db
          .select({
            id: workspaceTaskTemplates.id,
            name: workspaceTaskTemplates.name,
            description: workspaceTaskTemplates.description,
            priority: workspaceTaskTemplates.priority,
            estimatedHours: workspaceTaskTemplates.estimatedHours,
            defaultSubtasks: workspaceTaskTemplates.defaultSubtasks,
            defaultTags: workspaceTaskTemplates.defaultTags,
            createdBy: workspaceTaskTemplates.createdBy,
            usageCount: workspaceTaskTemplates.usageCount,
            isShared: workspaceTaskTemplates.isShared,
            createdAt: workspaceTaskTemplates.createdAt,
            updatedAt: workspaceTaskTemplates.updatedAt,
            authorName: members.name,
          })
          .from(workspaceTaskTemplates)
          .leftJoin(members, eq(workspaceTaskTemplates.createdBy, members.id))
          .where(eq(workspaceTaskTemplates.id, Number(id)))
          .limit(1);
        const tmpl = rows[0];
        if (!tmpl) return notFound("템플릿을 찾을 수 없습니다");
        // 비공개 템플릿은 본인 또는 super_admin만 조회
        if (!tmpl.isShared && tmpl.createdBy !== meId && !isSuperAdmin) {
          return forbidden("이 템플릿은 비공개입니다");
        }
        return ok(tmpl);
      }

      if (listFlag === "1") {
        const items: any = await db
          .select({
            id: workspaceTaskTemplates.id,
            name: workspaceTaskTemplates.name,
            description: workspaceTaskTemplates.description,
            priority: workspaceTaskTemplates.priority,
            estimatedHours: workspaceTaskTemplates.estimatedHours,
            defaultSubtasks: workspaceTaskTemplates.defaultSubtasks,
            defaultTags: workspaceTaskTemplates.defaultTags,
            createdBy: workspaceTaskTemplates.createdBy,
            usageCount: workspaceTaskTemplates.usageCount,
            isShared: workspaceTaskTemplates.isShared,
            createdAt: workspaceTaskTemplates.createdAt,
            authorName: members.name,
          })
          .from(workspaceTaskTemplates)
          .leftJoin(members, eq(workspaceTaskTemplates.createdBy, members.id))
          .where(
            isSuperAdmin
              ? undefined
              : or(
                  eq(workspaceTaskTemplates.isShared, true),
                  eq(workspaceTaskTemplates.createdBy, meId)
                )
          )
          .orderBy(desc(workspaceTaskTemplates.usageCount), desc(workspaceTaskTemplates.createdAt))
          .limit(200);
        return ok({ items, total: items.length });
      }

      return badRequest("list=1 또는 id=N 필수");
    }

    /* ════════ POST ════════ */
    if (req.method === "POST") {
      const body: any = await parseJson(req);
      if (!body) return badRequest("body 필수");

      const name = sanitizeStr(body.name, MAX_NAME);
      if (!name) return badRequest("name 필수");

      const priority = ["urgent", "high", "normal", "low"].includes(body.priority) ? body.priority : "normal";
      const description = body.description ? sanitizeStr(body.description, MAX_DESC) : null;
      const estimatedHours = body.estimatedHours == null || body.estimatedHours === ""
        ? null
        : String(body.estimatedHours);
      const defaultSubtasks = normalizeSubtasks(body.defaultSubtasks);
      const defaultTags = normalizeTags(body.defaultTags);
      const isShared = body.isShared !== false;  // 기본 true

      const inserted: any = await db
        .insert(workspaceTaskTemplates)
        .values({
          name,
          description,
          priority,
          estimatedHours: estimatedHours as any,
          defaultSubtasks: defaultSubtasks as any,
          defaultTags: defaultTags as any,
          createdBy: meId,
          usageCount: 0,
          isShared,
        } as any)
        .returning();

      await logAudit({
        userId: meId, userType: "admin", userName: adminMember.name,
        action: "workspace.template.create",
        target: `template:${inserted[0].id}`,
        detail: { name, isShared },
        req,
      });

      return ok(inserted[0], "템플릿이 생성되었습니다");
    }

    /* ════════ PATCH ════════ */
    if (req.method === "PATCH") {
      const id = Number(url.searchParams.get("id"));
      if (!id) return badRequest("id 필수");
      const body: any = await parseJson(req);
      if (!body) return badRequest("body 필수");

      const [tmpl]: any = await db
        .select()
        .from(workspaceTaskTemplates)
        .where(eq(workspaceTaskTemplates.id, id))
        .limit(1);
      if (!tmpl) return notFound("템플릿을 찾을 수 없습니다");

      if (!isSuperAdmin && tmpl.createdBy !== meId) {
        return forbidden("작성자만 수정할 수 있습니다");
      }

      const updateData: any = { updatedAt: new Date() };
      if (body.name !== undefined) {
        const n = sanitizeStr(body.name, MAX_NAME);
        if (!n) return badRequest("name 비어있음");
        updateData.name = n;
      }
      if (body.description !== undefined) {
        updateData.description = body.description ? sanitizeStr(body.description, MAX_DESC) : null;
      }
      if (body.priority !== undefined && ["urgent", "high", "normal", "low"].includes(body.priority)) {
        updateData.priority = body.priority;
      }
      if (body.estimatedHours !== undefined) {
        updateData.estimatedHours = body.estimatedHours == null || body.estimatedHours === "" ? null : String(body.estimatedHours);
      }
      if (body.defaultSubtasks !== undefined) {
        updateData.defaultSubtasks = normalizeSubtasks(body.defaultSubtasks) as any;
      }
      if (body.defaultTags !== undefined) {
        updateData.defaultTags = normalizeTags(body.defaultTags) as any;
      }
      if (body.isShared !== undefined) {
        updateData.isShared = !!body.isShared;
      }

      const updated: any = await db
        .update(workspaceTaskTemplates)
        .set(updateData)
        .where(eq(workspaceTaskTemplates.id, id))
        .returning();

      await logAudit({
        userId: meId, userType: "admin", userName: adminMember.name,
        action: "workspace.template.update",
        target: `template:${id}`,
        detail: { changedKeys: Object.keys(updateData) },
        req,
      });

      return ok(updated[0], "템플릿이 수정되었습니다");
    }

    /* ════════ DELETE ════════ */
    if (req.method === "DELETE") {
      const id = Number(url.searchParams.get("id"));
      if (!id) return badRequest("id 필수");

      const [tmpl]: any = await db
        .select()
        .from(workspaceTaskTemplates)
        .where(eq(workspaceTaskTemplates.id, id))
        .limit(1);
      if (!tmpl) return notFound("템플릿을 찾을 수 없습니다");

      if (!isSuperAdmin && tmpl.createdBy !== meId) {
        return forbidden("작성자만 삭제할 수 있습니다");
      }

      await db.delete(workspaceTaskTemplates).where(eq(workspaceTaskTemplates.id, id));

      await logAudit({
        userId: meId, userType: "admin", userName: adminMember.name,
        action: "workspace.template.delete",
        target: `template:${id}`,
        detail: { name: tmpl.name },
        req,
      });

      return ok({ id }, "템플릿이 삭제되었습니다");
    }

    return methodNotAllowed();
  } catch (err: any) {
    console.error("[admin-workspace-task-templates] error:", err);
    return serverError("템플릿 처리 중 오류", err);
  }
};

export const config = { path: "/api/admin-workspace-task-templates" };
