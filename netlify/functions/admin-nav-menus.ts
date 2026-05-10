// netlify/functions/admin-nav-menus.ts
// ★ Phase B: 어드민 메뉴 CRUD + Draft/Publish
//
// GET    /api/admin/nav-menus?location=header&tree=1   — 트리 조회 (preferDraft=1 옵션)
// GET    /api/admin/nav-menus?location=header           — flat 리스트
// POST   /api/admin/nav-menus                           — 신규 생성
// PATCH  /api/admin/nav-menus                           — Draft 저장 (label/href/sortOrder)
//        body: { id, label?, href?, sortOrder? }
// PATCH  /api/admin/nav-menus?action=meta               — 메타 즉시 수정 (icon/parent/active 등)
//        body: { id, icon?, opensModal?, pageKey?, target?, cssClass?, parentId?, menuLocation?, isActive? }
// POST   /api/admin/nav-menus?action=publish            — Draft 일괄 적용
//        body: { location? }
// POST   /api/admin/nav-menus?action=reorder            — 순서 일괄 변경 (draft)
//        body: { items: [{id, sortOrder}, ...] }
// DELETE /api/admin/nav-menus?id=N                      — 삭제 (자식 포함)
// DELETE /api/admin/nav-menus?id=N&action=discard       — Draft 폐기

import { eq } from "drizzle-orm";
import { db } from "../../db";
import { navMenuItems } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, created, badRequest, forbidden, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import {
  getNavMenus, getAdminNavMenus, createMenuItem,
  saveMenuDraft, updateMenuMeta, publishMenuDrafts,
  discardMenuDraft, deleteMenuItem, countMenuDrafts,
} from "../../lib/site-settings";
import { logAdminAction } from "../../lib/audit";

const VALID_LOCATIONS = ["header", "footer", "siren", "mobile"];

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
  if (!guard.ok) return (guard as { ok: false; res: Response }).res;
  const { admin, member: adminMember } = guard.ctx;

  try {
    const url = new URL(req.url);

    /* ===== GET ===== */
    if (req.method === "GET") {
      const location = url.searchParams.get("location") || undefined;
      const tree = url.searchParams.get("tree") === "1";
      const preferDraft = url.searchParams.get("preferDraft") === "1";

      if (tree) {
        if (!location) return badRequest("location은 트리 조회 시 필수");
        const items = await getNavMenus(location, preferDraft);
        const draftCount = await countMenuDrafts(location);
        return ok({ location, items, draftCount });
      }

      const items = await getAdminNavMenus(location);
      const draftCount = await countMenuDrafts(location);
      return ok({ items, draftCount });
    }

    /* ===== POST ===== */
    if (req.method === "POST") {
      if (!canEdit(adminMember)) return forbidden("편집 권한이 없습니다");

      const action = url.searchParams.get("action") || "create";
      const body = await parseJson(req);

      /* 신규 생성 */
      if (action === "create") {
        if (!body?.menuLocation || !VALID_LOCATIONS.includes(body.menuLocation)) {
          return badRequest("menuLocation 필수: header/footer/siren/mobile");
        }
        if (!body?.label || String(body.label).trim().length === 0) {
          return badRequest("label은 필수");
        }

        const id = await createMenuItem({
          parentId: body.parentId ? Number(body.parentId) : null,
          menuLocation: String(body.menuLocation),
          label: String(body.label).slice(0, 100),
          href: body.href ? String(body.href).slice(0, 500) : null,
          icon: body.icon ? String(body.icon).slice(0, 20) : null,
          sortOrder: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
          opensModal: body.opensModal ? String(body.opensModal).slice(0, 50) : null,
          pageKey: body.pageKey ? String(body.pageKey).slice(0, 50) : null,
          target: body.target || "_self",
          cssClass: body.cssClass ? String(body.cssClass).slice(0, 100) : null,
        });

        try {
          await logAdminAction(req, admin.uid, admin.name, "nav_menu_create", {
            target: `menu-${id}`,
            detail: { menuLocation: body.menuLocation, label: body.label },
          });
        } catch (_) {}

        return created({ id }, "메뉴가 생성되었습니다 (즉시 반영)");
      }

      /* publish */
      if (action === "publish") {
        const location = body?.location ? String(body.location) : undefined;
        const count = await publishMenuDrafts(location);

        try {
          await logAdminAction(req, admin.uid, admin.name, "nav_menu_publish", {
            target: location || "all",
            detail: { affectedCount: count },
          });
        } catch (_) {}

        return ok(
          { affectedCount: count },
          count > 0 ? `${count}건의 메뉴 변경이 적용되었습니다` : "배포할 변경사항이 없습니다"
        );
      }

      /* reorder — 일괄 sort_order Draft 저장 */
      if (action === "reorder") {
        const items = Array.isArray(body?.items) ? body.items : [];
        if (items.length === 0) return badRequest("items 배열이 비어있습니다");

        let okCount = 0;
        for (const it of items) {
          const id = Number(it.id);
          const sortOrder = Number(it.sortOrder);
          if (!Number.isFinite(id) || !Number.isFinite(sortOrder)) continue;
          const success = await saveMenuDraft(id, { sortOrder });
          if (success) okCount++;
        }

        try {
          await logAdminAction(req, admin.uid, admin.name, "nav_menu_reorder", {
            target: `${okCount}items`,
            detail: { count: okCount },
          });
        } catch (_) {}

        return ok({ affectedCount: okCount }, `${okCount}건 순서 변경 (Draft 저장됨)`);
      }

      return badRequest("지원하지 않는 action");
    }

    /* ===== PATCH ===== */
    if (req.method === "PATCH") {
      if (!canEdit(adminMember)) return forbidden("편집 권한이 없습니다");

      const action = url.searchParams.get("action") || "draft";
      const body = await parseJson(req);
      if (!body?.id) return badRequest("id 필수");

      const id = Number(body.id);
      if (!Number.isFinite(id)) return badRequest("유효하지 않은 ID");

      const [existing] = await db
        .select().from(navMenuItems)
        .where(eq(navMenuItems.id, id)).limit(1);
      if (!existing) return notFound("메뉴를 찾을 수 없습니다");

      /* 메타 즉시 수정 (Draft 없음) */
      if (action === "meta") {
        const success = await updateMenuMeta(id, {
          icon: body.icon !== undefined ? body.icon : undefined,
          opensModal: body.opensModal !== undefined ? body.opensModal : undefined,
          pageKey: body.pageKey !== undefined ? body.pageKey : undefined,
          target: body.target !== undefined ? body.target : undefined,
          cssClass: body.cssClass !== undefined ? body.cssClass : undefined,
          parentId: body.parentId !== undefined ? (body.parentId ? Number(body.parentId) : null) : undefined,
          menuLocation: body.menuLocation !== undefined ? body.menuLocation : undefined,
          isActive: body.isActive !== undefined ? !!body.isActive : undefined,
        });
        if (!success) return badRequest("변경할 메타 항목이 없습니다");

        try {
          await logAdminAction(req, admin.uid, admin.name, "nav_menu_meta_update", {
            target: `menu-${id}`,
            detail: body,
          });
        } catch (_) {}

        return ok({ id }, "메타가 즉시 반영되었습니다");
      }

      /* Draft 저장 (label/href/sortOrder) */
      const draftPayload: any = {};
      if (body.label !== undefined) draftPayload.label = String(body.label).slice(0, 100);
      if (body.href !== undefined) draftPayload.href = body.href === null ? null : String(body.href).slice(0, 500);
      if (body.sortOrder !== undefined && Number.isFinite(Number(body.sortOrder))) {
        draftPayload.sortOrder = Number(body.sortOrder);
      }

      if (Object.keys(draftPayload).length === 0) {
        return badRequest("변경할 값이 없습니다 (label/href/sortOrder)");
      }

      const success = await saveMenuDraft(id, draftPayload);
      if (!success) return serverError("Draft 저장 실패");

      try {
        await logAdminAction(req, admin.uid, admin.name, "nav_menu_draft_save", {
          target: `menu-${id}`,
          detail: { fields: Object.keys(draftPayload) },
        });
      } catch (_) {}

      return ok({ id, hasDraft: true }, "Draft 저장됨 (배포 필요)");
    }

    /* ===== DELETE ===== */
    if (req.method === "DELETE") {
      if (!canEdit(adminMember)) return forbidden("편집 권한이 없습니다");

      const id = Number(url.searchParams.get("id"));
      const action = url.searchParams.get("action") || "delete";

      if (!Number.isFinite(id)) return badRequest("id 필수");

      if (action === "discard") {
        const success = await discardMenuDraft(id);
        if (!success) return serverError("Draft 폐기 실패");

        try {
          await logAdminAction(req, admin.uid, admin.name, "nav_menu_draft_discard", {
            target: `menu-${id}`, detail: { id },
          });
        } catch (_) {}

        return ok({ id }, "Draft가 폐기되었습니다");
      }

      /* 삭제 */
      const success = await deleteMenuItem(id);
      if (!success) return serverError("삭제 실패");

      try {
        await logAdminAction(req, admin.uid, admin.name, "nav_menu_delete", {
          target: `menu-${id}`, detail: { id },
        });
      } catch (_) {}

      return ok({ id }, "메뉴가 삭제되었습니다 (자식 포함)");
    }

    return methodNotAllowed();
  } catch (e: any) {
    console.error("[admin-nav-menus]", e);
    return serverError("처리 실패", e?.message);
  }
};

export const config = { path: "/api/admin/nav-menus" };