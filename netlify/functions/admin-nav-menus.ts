// netlify/functions/admin-nav-menus.ts
// Phase B: 어드민 메뉴 CRUD + Draft/Publish
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
/* 2026-07-02: assignedCategories canEdit → role_permissions canAccess('content_edit') 교체 — 권한설계 화면에서 중앙 제어 */

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
import { canAccess } from "../../lib/role-permission-check";
/* 2026-08-03 메뉴·페이지 통합 편집 — 메뉴가 무엇을 가리키는지(페이지/주소/모달/구분선) */
import {
  enrichMenuLinks, setMenuLink, applyMenuOrder, listLinkablePages,
  linkColumnsReady, VALID_LINK_TYPES,
} from "../../lib/nav-menu-links";
import { createPage } from "../../lib/site-pages";

const VALID_LOCATIONS = ["header", "footer", "siren", "mobile"];

async function canEdit(adminMember: any): Promise<boolean> {
  return canAccess(String(adminMember?.role || ""), "content_edit");
}

/**
 * 관리 화면용 메뉴 트리.
 * 공개용 조회는 켜져 있는 메뉴만 가져오지만, 관리 화면은 **꺼둔 메뉴까지** 보여야 한다.
 * 임시저장한 이름·주소·순서가 있으면 그것을 우선 보여준다(편집 중인 내용이 보여야 하므로).
 */
function buildAdminTree(flat: any[], preferDraft: boolean): any[] {
  const items = (flat || []).map((r: any) => {
    const useDraft = preferDraft && r.hasDraft;
    return {
      ...r,
      label: useDraft && r.draftLabel != null ? r.draftLabel : r.label,
      href: useDraft && r.draftHref != null ? r.draftHref : r.href,
      sortOrder: useDraft && r.draftSortOrder != null ? r.draftSortOrder : (r.sortOrder || 0),
      children: [] as any[],
    };
  });

  items.sort((a: any, b: any) => (a.sortOrder || 0) - (b.sortOrder || 0) || a.id - b.id);

  const map = new Map<number, any>();
  items.forEach((i: any) => map.set(i.id, i));

  const roots: any[] = [];
  for (const it of items) {
    if (it.parentId && map.has(it.parentId)) map.get(it.parentId).children.push(it);
    else roots.push(it);
  }
  return roots;
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

      /* 메뉴에 연결할 수 있는 페이지 목록 (메뉴 만들 때 고르는 용도) */
      if (url.searchParams.get("pages") === "1") {
        const pages = await listLinkablePages();
        return ok({ pages, ready: await linkColumnsReady() });
      }

      if (tree) {
        if (!location) return badRequest("location은 트리 조회 시 필수");
        /* 활성 메뉴만 나오는 기본 조회로는 꺼둔 메뉴가 보이지 않는다 —
           관리 화면은 꺼둔 것까지 보여야 하므로 전체를 받아 직접 트리로 만든다. */
        const flat = await getAdminNavMenus(location);
        const items = buildAdminTree(flat as any[], preferDraft);
        const withLinks = await enrichMenuLinks(items, { admin: true });
        const draftCount = await countMenuDrafts(location);
        return ok({
          location, items: withLinks, draftCount,
          linkReady: await linkColumnsReady(),
        });
      }

      const items = await getAdminNavMenus(location);
      const draftCount = await countMenuDrafts(location);
      return ok({ items, draftCount });
    }

    /* ===== POST ===== */
    if (req.method === "POST") {
      if (!(await canEdit(adminMember))) return forbidden("편집 권한이 없습니다");

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

        const label = String(body.label).trim().slice(0, 100);

        /* 2026-08-03: 연결 방식에 따라 필요한 것을 함께 준비한다.
           '새 페이지 만들기'를 고르면 빈 페이지를 만들어 바로 연결한다 —
           운영자가 페이지를 따로 만들고 주소를 옮겨 적는 수고를 없앤다. */
        const linkType = body.linkType && VALID_LINK_TYPES.includes(body.linkType)
          ? String(body.linkType) : null;
        let sitePageId: number | null = body.sitePageId ? Number(body.sitePageId) : null;
        let createdPage: { id: number; slug: string } | null = null;

        if (linkType === "page" && !sitePageId) {
          if (!(await linkColumnsReady())) {
            return badRequest("저장소 준비(마이그레이션)가 아직 완료되지 않았습니다");
          }
          createdPage = await createPage({ title: label }, { uid: admin.uid, name: admin.name });
          sitePageId = createdPage.id;
        }

        const id = await createMenuItem({
          parentId: body.parentId ? Number(body.parentId) : null,
          menuLocation: String(body.menuLocation),
          label,
          href: body.href ? String(body.href).slice(0, 500) : null,
          icon: body.icon ? String(body.icon).slice(0, 20) : null,
          sortOrder: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
          opensModal: body.opensModal ? String(body.opensModal).slice(0, 50) : null,
          pageKey: body.pageKey ? String(body.pageKey).slice(0, 50) : null,
          target: body.target || "_self",
          cssClass: body.cssClass ? String(body.cssClass).slice(0, 100) : null,
        });

        if (linkType) {
          await setMenuLink(id, {
            linkType,
            sitePageId,
            href: body.href ?? null,
            opensModal: body.opensModal ?? null,
          });
        }

        try {
          await logAdminAction(req, admin.uid, admin.name, "nav_menu_create", {
            target: `menu-${id}`,
            detail: { menuLocation: body.menuLocation, label, linkType, sitePageId },
          });
        } catch (_) {}

        return created(
          { id, sitePageId, createdPage },
          createdPage
            ? `메뉴와 페이지가 만들어졌습니다. 내용을 채운 뒤 [설정]에서 '보임'으로 바꾸면 방문자에게 나타납니다.`
            : "메뉴가 만들어졌습니다",
        );
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

      /* reorder — 드래그로 바꾼 순서·상위 관계를 한 번에 저장 (즉시 반영)
         ※ 2026-08-03 정책: 순서와 상위 관계는 임시저장을 거치지 않고 바로 반영한다.
            상위 관계에는 임시저장 칸이 없어, 순서만 임시저장하면 '순서는 새 값·상위는 옛 값'인
            반쪽 상태가 되어 트리가 어긋난 채로 사이트에 나갈 수 있다.
            순서 변경은 되돌리기 쉬운 작업이라 즉시 반영이 안전하다.
            (이름·연결 대상처럼 실수 영향이 큰 것은 종전대로 임시저장 → 배포) */
      if (action === "reorder") {
        const items = Array.isArray(body?.items) ? body.items : [];
        if (items.length === 0) return badRequest("옮길 메뉴가 없습니다");

        const location = body?.location ? String(body.location) : "header";
        if (!VALID_LOCATIONS.includes(location)) return badRequest("메뉴 위치가 올바르지 않습니다");

        const rows = items
          .map((it: any) => ({
            id: Number(it.id),
            parentId: it.parentId == null || it.parentId === "" ? null : Number(it.parentId),
            sortOrder: Number(it.sortOrder) || 0,
          }))
          .filter((r: any) => Number.isFinite(r.id));

        const result = await applyMenuOrder(location, rows);
        if (!result.ok) return badRequest(result.error || "순서를 저장하지 못했습니다");

        try {
          await logAdminAction(req, admin.uid, admin.name, "nav_menu_reorder", {
            target: location,
            detail: { count: result.count },
          });
        } catch (_) {}

        return ok({ affectedCount: result.count }, "메뉴 순서가 바뀌었습니다");
      }

      return badRequest("지원하지 않는 action");
    }

    /* ===== PATCH ===== */
    if (req.method === "PATCH") {
      if (!(await canEdit(adminMember))) return forbidden("편집 권한이 없습니다");

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

      /* 2026-08-03: 연결 대상 변경 (페이지 / 주소 / 모달 / 구분선 / 연결 없음).
         유형에 맞지 않는 값은 함께 비워 링크가 엉키지 않게 한다. */
      if (action === "link") {
        const linkType = String(body.linkType || "");
        if (!VALID_LINK_TYPES.includes(linkType as any)) {
          return badRequest("연결 방식이 올바르지 않습니다");
        }

        let sitePageId: number | null = body.sitePageId ? Number(body.sitePageId) : null;

        /* '새 페이지 만들기'를 고른 경우 — 지금 메뉴 이름으로 빈 페이지를 만들어 연결 */
        if (linkType === "page" && !sitePageId) {
          const label = String((existing as any).label || "새 페이지");
          const page = await createPage({ title: label }, { uid: admin.uid, name: admin.name });
          sitePageId = page.id;
        }

        const result = await setMenuLink(id, {
          linkType,
          sitePageId,
          href: body.href ?? null,
          opensModal: body.opensModal ?? null,
        });
        if (!result.ok) return badRequest(result.error || "연결 정보를 저장하지 못했습니다");

        try {
          await logAdminAction(req, admin.uid, admin.name, "nav_menu_link_update", {
            target: `menu-${id}`,
            detail: { linkType, sitePageId },
          });
        } catch (_) {}

        return ok({ id, linkType, sitePageId }, "연결이 바뀌었습니다");
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
      if (!(await canEdit(adminMember))) return forbidden("편집 권한이 없습니다");

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