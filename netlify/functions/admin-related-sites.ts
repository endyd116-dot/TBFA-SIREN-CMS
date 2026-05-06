// netlify/functions/admin-related-sites.ts
// ★ Phase B: 어드민 관련사이트 CRUD (Draft 시스템 없음 — 즉시 반영)
//
// GET    /api/admin/related-sites              — 전체 목록 (비활성 포함)
// POST   /api/admin/related-sites              — 신규 생성
// PATCH  /api/admin/related-sites              — 수정
// DELETE /api/admin/related-sites?id=N         — 삭제
// POST   /api/admin/related-sites?action=reorder  — 순서 일괄 변경

import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, created, badRequest, forbidden, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import {
  getRelatedSites, createRelatedSite, updateRelatedSite, deleteRelatedSite,
} from "../../lib/site-settings";
import { logAdminAction } from "../../lib/audit";

function canEdit(adminMember: any): boolean {
  if (!adminMember) return false;
  if (adminMember.role === "super_admin") return true;
  const cats: string[] = Array.isArray(adminMember.assignedCategories)
    ? adminMember.assignedCategories : [];
  return cats.includes("all") || cats.includes("content") || cats.includes("stats_management");
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();

  const guard: any = await requireAdmin(req);
  if (!guard.ok) return guard.res;
  const { admin, member: adminMember } = guard.ctx;

  try {
    const url = new URL(req.url);

    /* ===== GET ===== */
    if (req.method === "GET") {
      const items = await getRelatedSites(false); // 비활성 포함
      return ok({ items });
    }

    /* ===== POST ===== */
    if (req.method === "POST") {
      if (!canEdit(adminMember)) return forbidden("편집 권한이 없습니다");

      const action = url.searchParams.get("action") || "create";
      const body = await parseJson(req);

      /* reorder */
      if (action === "reorder") {
        const items = Array.isArray(body?.items) ? body.items : [];
        if (items.length === 0) return badRequest("items 비어있음");

        let okCount = 0;
        for (const it of items) {
          const id = Number(it.id);
          const sortOrder = Number(it.sortOrder);
          if (!Number.isFinite(id) || !Number.isFinite(sortOrder)) continue;
          const success = await updateRelatedSite(id, { sortOrder });
          if (success) okCount++;
        }

        try {
          await logAdminAction(req, admin.uid, admin.name, "related_sites_reorder", {
            target: `${okCount}items`, detail: { count: okCount },
          });
        } catch (_) {}

        return ok({ affectedCount: okCount });
      }

      /* create */
      if (!body?.name || !body?.url) return badRequest("name과 url은 필수");

      const id = await createRelatedSite({
        name: String(body.name).slice(0, 200),
        url: String(body.url).slice(0, 500),
        description: body.description ? String(body.description).slice(0, 300) : null,
        sortOrder: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 999,
      });

      try {
        await logAdminAction(req, admin.uid, admin.name, "related_site_create", {
          target: `site-${id}`, detail: { name: body.name, url: body.url },
        });
      } catch (_) {}

      return created({ id }, "관련 사이트가 추가되었습니다");
    }

    /* ===== PATCH ===== */
    if (req.method === "PATCH") {
      if (!canEdit(adminMember)) return forbidden("편집 권한이 없습니다");

      const body = await parseJson(req);
      if (!body?.id) return badRequest("id 필수");

      const id = Number(body.id);
      if (!Number.isFinite(id)) return badRequest("유효하지 않은 ID");

      const success = await updateRelatedSite(id, {
        name: body.name !== undefined ? String(body.name).slice(0, 200) : undefined,
        url: body.url !== undefined ? String(body.url).slice(0, 500) : undefined,
        description: body.description !== undefined
          ? (body.description === null ? null : String(body.description).slice(0, 300))
          : undefined,
        sortOrder: body.sortOrder !== undefined && Number.isFinite(Number(body.sortOrder))
          ? Number(body.sortOrder) : undefined,
        isActive: body.isActive !== undefined ? !!body.isActive : undefined,
      });

      if (!success) return badRequest("변경할 항목이 없거나 실패");

      try {
        await logAdminAction(req, admin.uid, admin.name, "related_site_update", {
          target: `site-${id}`, detail: body,
        });
      } catch (_) {}

      return ok({ id }, "수정되었습니다");
    }

    /* ===== DELETE ===== */
    if (req.method === "DELETE") {
      if (!canEdit(adminMember)) return forbidden("편집 권한이 없습니다");

      const id = Number(url.searchParams.get("id"));
      if (!Number.isFinite(id)) return badRequest("id 필수");

      const success = await deleteRelatedSite(id);
      if (!success) return serverError("삭제 실패");

      try {
        await logAdminAction(req, admin.uid, admin.name, "related_site_delete", {
          target: `site-${id}`, detail: { id },
        });
      } catch (_) {}

      return ok({ id }, "삭제되었습니다");
    }

    return methodNotAllowed();
  } catch (e: any) {
    console.error("[admin-related-sites]", e);
    return serverError("처리 실패", e?.message);
  }
};

export const config = { path: "/api/admin/related-sites" };