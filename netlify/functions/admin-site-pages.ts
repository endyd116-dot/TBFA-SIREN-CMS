/**
 * netlify/functions/admin-site-pages.ts — 페이지 관리 (메인 화면 편집)
 * 설계서: docs/active/2026-08-03-page-menu-redesign.md §7 2단계
 *
 * GET    /api/admin/site-pages                    — 목록(본문 제외) + 임시저장 건수
 * GET    /api/admin/site-pages?id=N               — 상세(본문 포함, 편집 화면용)
 * GET    /api/admin/site-pages?slug=xxx           — 주소로 상세
 * POST   /api/admin/site-pages                    — 생성 { title, slug?, eyebrow?, subtitle?, ... }
 * POST   /api/admin/site-pages?action=publish     — 배포 (body.id 있으면 그 페이지만, 없으면 전체)
 * PATCH  /api/admin/site-pages                    — 본문 임시저장 { id, title?, eyebrow?, subtitle?, contentHtml? }
 * PATCH  /api/admin/site-pages?action=meta        — 노출·주소·레이아웃·검색설정 즉시 반영 { id, ... }
 * DELETE /api/admin/site-pages?id=N               — 삭제 (연결된 메뉴는 '연결 없음'으로 되돌림)
 * DELETE /api/admin/site-pages?id=N&action=discard— 임시저장 폐기
 *
 * 권한: 관리자 + content_edit (메뉴·사이트 설정과 동일 권한키)
 * 본문은 저장 직전 서버에서 정화한다(lib/sanitize-page-html).
 */
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import {
  ok, created, badRequest, forbidden, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import {
  listAdminPages, getAdminPage, getAdminPageBySlug, createPage,
  savePageDraft, updatePageMeta, publishPages, discardPageDraft,
  deletePage, countPageDrafts, countLinkedMenus,
} from "../../lib/site-pages";
import { sanitizePageHtml } from "../../lib/sanitize-page-html";
import { logAdminAction } from "../../lib/audit";
import { canAccess } from "../../lib/role-permission-check";

export const config = { path: "/api/admin/site-pages" };

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();

  const guard = await requireAdmin(req);
  if (guardFailed(guard)) return guard.res;
  const { admin, member: adminMember } = guard.ctx;
  const actor = { uid: admin.uid, name: admin.name };

  const canEdit = await canAccess(String((adminMember as any)?.role || ""), "content_edit");

  let step = "start";
  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "";

    /* ===== GET ===== */
    if (req.method === "GET") {
      step = "get";
      const idParam = url.searchParams.get("id");
      const slugParam = url.searchParams.get("slug");

      if (idParam || slugParam) {
        step = "get_detail";
        const page = idParam
          ? await getAdminPage(Number(idParam))
          : await getAdminPageBySlug(String(slugParam));
        if (!page) return notFound("페이지를 찾을 수 없습니다");

        /* 연결된 메뉴 수 — 삭제 경고에 쓴다 (마이그 전이면 0) */
        let linkedMenus = 0;
        try { linkedMenus = await countLinkedMenus(page.id); } catch (_) {}

        return ok({ page, linkedMenus });
      }

      step = "get_list";
      const list = await listAdminPages();
      const drafts = await countPageDrafts();
      return ok({
        list,
        stats: { total: list.length, drafts },
      });
    }

    /* 이하 쓰기 동작 — 편집 권한 필요 */
    if (!canEdit) return forbidden("페이지 편집 권한이 없습니다");

    /* ===== POST: 생성 / 배포 ===== */
    if (req.method === "POST") {
      const body = await parseJson<any>(req);

      if (action === "publish" || body?.action === "publish") {
        step = "publish";
        const id = body?.id ? Number(body.id) : undefined;
        const count = await publishPages(id, actor);

        try {
          await logAdminAction(req, admin.uid, admin.name, "site_page_publish", {
            target: id ? `page-${id}` : "all",
            detail: { affectedCount: count },
          });
        } catch (_) {}

        return ok(
          { affectedCount: count },
          count > 0 ? `${count}개 페이지가 사이트에 반영되었습니다` : "배포할 변경사항이 없습니다",
        );
      }

      step = "create";
      const title = String(body?.title || "").trim();
      if (!title) return badRequest("페이지 이름을 입력해주세요");

      const contentHtml = body?.contentHtml !== undefined
        ? sanitizePageHtml(String(body.contentHtml)) : "";

      const res = await createPage({
        title,
        slug: body?.slug ?? null,
        eyebrow: body?.eyebrow ?? null,
        subtitle: body?.subtitle ?? null,
        contentHtml,
        layout: body?.layout ?? null,
        status: body?.status ?? null,     // 미지정이면 숨김으로 시작 (빈 페이지 노출 방지)
        seoTitle: body?.seoTitle ?? null,
        seoDescription: body?.seoDescription ?? null,
        ogImageUrl: body?.ogImageUrl ?? null,
        sortOrder: body?.sortOrder ?? null,
      }, actor);

      try {
        await logAdminAction(req, admin.uid, admin.name, "site_page_create", {
          target: res.slug,
          detail: { id: res.id, title },
        });
      } catch (_) {}

      return created(
        { id: res.id, slug: res.slug, url: `/p/${res.slug}` },
        `페이지가 만들어졌습니다 (주소 /p/${res.slug})`,
      );
    }

    /* ===== PATCH: 본문 임시저장 / 메타 즉시반영 ===== */
    if (req.method === "PATCH") {
      const body = await parseJson<any>(req);
      const id = Number(body?.id);
      if (!Number.isFinite(id)) return badRequest("페이지를 지정해주세요");

      const existing = await getAdminPage(id);
      if (!existing) return notFound("페이지를 찾을 수 없습니다");

      /* 노출·주소·레이아웃·검색설정 — 배포를 기다리지 않고 바로 반영 */
      if (action === "meta") {
        step = "update_meta";
        const meta: any = {};
        if (body.slug !== undefined) meta.slug = String(body.slug);
        if (body.status !== undefined) meta.status = String(body.status);
        if (body.layout !== undefined) meta.layout = String(body.layout);
        if (body.seoTitle !== undefined) meta.seoTitle = body.seoTitle;
        if (body.seoDescription !== undefined) meta.seoDescription = body.seoDescription;
        if (body.ogImageUrl !== undefined) meta.ogImageUrl = body.ogImageUrl;
        if (body.sortOrder !== undefined) meta.sortOrder = Number(body.sortOrder);

        const result = await updatePageMeta(id, meta, actor);
        if (!result.ok) return badRequest(result.error || "저장에 실패했습니다");

        try {
          await logAdminAction(req, admin.uid, admin.name, "site_page_meta_update", {
            target: result.slug || existing.slug,
            detail: { id, fields: Object.keys(meta) },
          });
        } catch (_) {}

        return ok(
          { id, slug: result.slug || existing.slug },
          "설정이 반영되었습니다",
        );
      }

      /* 본문 — 임시저장. [배포]를 눌러야 사이트에 나간다 */
      step = "save_draft";
      const draft: any = {};
      if (body.title !== undefined) draft.title = String(body.title);
      if (body.eyebrow !== undefined) draft.eyebrow = body.eyebrow;
      if (body.subtitle !== undefined) draft.subtitle = body.subtitle;
      if (body.contentHtml !== undefined) draft.contentHtml = sanitizePageHtml(String(body.contentHtml));

      if (Object.keys(draft).length === 0) return badRequest("변경된 내용이 없습니다");

      const saved = await savePageDraft(id, draft, actor);
      if (!saved) return serverError("임시저장에 실패했습니다");

      try {
        await logAdminAction(req, admin.uid, admin.name, "site_page_draft_save", {
          target: existing.slug,
          detail: { id, fields: Object.keys(draft) },
        });
      } catch (_) {}

      return ok(
        { id, hasDraft: true, preview: `/p/${existing.slug}?preview=1` },
        "임시저장했습니다 (사이트 반영은 [배포] 필요)",
      );
    }

    /* ===== DELETE: 삭제 / 임시저장 폐기 ===== */
    if (req.method === "DELETE") {
      const id = Number(url.searchParams.get("id"));
      if (!Number.isFinite(id)) return badRequest("페이지를 지정해주세요");

      const existing = await getAdminPage(id);
      if (!existing) return notFound("페이지를 찾을 수 없습니다");

      if (action === "discard") {
        step = "discard_draft";
        const done = await discardPageDraft(id);
        if (!done) return serverError("임시저장 취소에 실패했습니다");

        try {
          await logAdminAction(req, admin.uid, admin.name, "site_page_draft_discard", {
            target: existing.slug, detail: { id },
          });
        } catch (_) {}

        return ok({ id }, "임시저장한 내용을 버리고 발행본으로 되돌렸습니다");
      }

      step = "delete";
      const linked = await countLinkedMenus(id);
      const done = await deletePage(id);
      if (!done) return serverError("삭제에 실패했습니다");

      try {
        await logAdminAction(req, admin.uid, admin.name, "site_page_delete", {
          target: existing.slug,
          detail: { id, title: existing.title, linkedMenus: linked },
        });
      } catch (_) {}

      return ok(
        { id, linkedMenus: linked },
        linked > 0
          ? `페이지를 삭제했습니다. 이 페이지를 가리키던 메뉴 ${linked}개는 '연결 없음'이 되었습니다`
          : "페이지를 삭제했습니다",
      );
    }

    return methodNotAllowed();
  } catch (e: any) {
    console.error("[admin-site-pages]", step, e);
    return serverError("페이지 처리에 실패했습니다", e, step);
  }
};
