// netlify/functions/admin-incidents-crud.ts
// ★ B-3: 사건(incidents) 게시글 CRUD (관리자 전용)

import { eq, desc, sql } from "drizzle-orm";
import { db } from "../../db";
import { incidents } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import { logAdminAction } from "../../lib/audit";
import {
  ok, created, badRequest, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";

export const config = { path: "/api/admin/incidents-crud" };

function slugify(text: string): string {
  return text.toLowerCase().trim()
    .replace(/[^\w\s가-힣-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 100);
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();

  const guard: any = await requireAdmin(req);
  if (!guard.ok) return guard.res;
  const { admin } = guard.ctx;

  try {
    /* ===== GET — 목록 또는 단건 ===== */
    if (req.method === "GET") {
      const url = new URL(req.url);
      const id = url.searchParams.get("id");

      if (id) {
        const [item] = await db.select().from(incidents).where(eq(incidents.id, Number(id))).limit(1);
        if (!item) return notFound("사건을 찾을 수 없습니다");
        return ok({ incident: item });
      }

      const list = await db.select().from(incidents).orderBy(desc(incidents.createdAt));
      return ok({ list });
    }

    /* ===== POST — 신규 생성 ===== */
    if (req.method === "POST") {
      const body = await parseJson(req);
      if (!body) return badRequest("요청 본문이 비어있습니다");

      const title = String(body.title || "").trim().slice(0, 200);
      if (!title) return badRequest("제목은 필수입니다");

      const slug = body.slug ? String(body.slug).trim().slice(0, 100) : slugify(title);
      const summary = body.summary ? String(body.summary).trim().slice(0, 500) : null;
      const contentHtml = body.contentHtml ? String(body.contentHtml).trim() : null;
      const category = ["school", "public", "other"].includes(body.category) ? body.category : "school";
      const location = body.location ? String(body.location).trim().slice(0, 200) : null;
      const occurredAt = body.occurredAt ? new Date(body.occurredAt) : null;
      const status = body.status === "inactive" ? "inactive" : "active";

      const [created_] = await db.insert(incidents).values({
        slug,
        title,
        summary,
        contentHtml,
        category,
        location,
        occurredAt: occurredAt && !isNaN(occurredAt.getTime()) ? occurredAt : null,
        status,
        sortOrder: Number(body.sortOrder) || 0,
      } as any).returning();

      await logAdminAction(req, admin.uid, admin.name, "incident_create", {
        target: `INCIDENT-${(created_ as any).id}`,
        detail: { title, slug },
      });

      return created({ incident: created_ }, "사건이 등록되었습니다");
    }

    /* ===== PATCH — 수정 ===== */
    if (req.method === "PATCH") {
      const body = await parseJson(req);
      if (!body?.id) return badRequest("id가 필요합니다");

      const id = Number(body.id);
      const [existing] = await db.select().from(incidents).where(eq(incidents.id, id)).limit(1);
      if (!existing) return notFound("사건을 찾을 수 없습니다");

      const update: any = { updatedAt: new Date() };
      if (body.title !== undefined) update.title = String(body.title).trim().slice(0, 200);
      if (body.slug !== undefined) update.slug = String(body.slug).trim().slice(0, 100);
      if (body.summary !== undefined) update.summary = body.summary ? String(body.summary).trim().slice(0, 500) : null;
      if (body.contentHtml !== undefined) update.contentHtml = body.contentHtml || null;
      if (body.category !== undefined && ["school", "public", "other"].includes(body.category)) update.category = body.category;
      if (body.location !== undefined) update.location = body.location ? String(body.location).trim().slice(0, 200) : null;
      if (body.occurredAt !== undefined) {
        const d = body.occurredAt ? new Date(body.occurredAt) : null;
        update.occurredAt = d && !isNaN(d.getTime()) ? d : null;
      }
      if (body.status !== undefined) update.status = body.status === "inactive" ? "inactive" : "active";
      if (body.sortOrder !== undefined) update.sortOrder = Number(body.sortOrder) || 0;

      const [updated] = await db.update(incidents).set(update).where(eq(incidents.id, id)).returning();

      await logAdminAction(req, admin.uid, admin.name, "incident_update", {
        target: `INCIDENT-${id}`,
        detail: { changedFields: Object.keys(update).filter(k => k !== "updatedAt") },
      });

      return ok({ incident: updated }, "사건이 수정되었습니다");
    }

    /* ===== DELETE ===== */
    if (req.method === "DELETE") {
      const url = new URL(req.url);
      const id = Number(url.searchParams.get("id"));
      if (!id) return badRequest("id가 필요합니다");

      const [existing] = await db.select({ id: incidents.id, title: incidents.title }).from(incidents).where(eq(incidents.id, id)).limit(1);
      if (!existing) return notFound("사건을 찾을 수 없습니다");

      await db.delete(incidents).where(eq(incidents.id, id));

      await logAdminAction(req, admin.uid, admin.name, "incident_delete", {
        target: `INCIDENT-${id}`,
        detail: { title: (existing as any).title },
      });

      return ok({ deleted: true }, "사건이 삭제되었습니다");
    }

    return methodNotAllowed();
  } catch (err: any) {
    console.error("[admin-incidents-crud]", err);
    return serverError("사건 관리 오류", err?.message);
  }
};