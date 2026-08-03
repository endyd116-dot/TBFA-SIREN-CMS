/**
 * netlify/functions/admin-site-page-revisions.ts — 페이지 되돌리기
 * 설계서: docs/active/2026-08-03-page-menu-redesign.md §3.2
 *
 * GET  /api/admin/site-page-revisions?pageId=N   — 이 페이지의 저장 이력 목록(최근 20개)
 * GET  /api/admin/site-page-revisions?id=N       — 특정 이력의 본문 (되돌리기 전 미리보기)
 * POST /api/admin/site-page-revisions            — 되돌리기 { pageId, revisionId }
 *
 * 되돌리기는 **임시저장으로만** 복원한다. 화면에서 확인한 뒤 [배포]를 눌러야 사이트에 나간다.
 * 되돌리기 직전 상태도 이력으로 남으므로, 되돌린 것을 다시 되돌릴 수 있다.
 */
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import {
  ok, badRequest, forbidden, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { listRevisions, getRevision, restoreRevision, getAdminPage } from "../../lib/site-pages";
import { logAdminAction } from "../../lib/audit";
import { canAccess } from "../../lib/role-permission-check";

export const config = { path: "/api/admin/site-page-revisions" };

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();

  const guard = await requireAdmin(req);
  if (guardFailed(guard)) return guard.res;
  const { admin, member: adminMember } = guard.ctx;

  let step = "start";
  try {
    const url = new URL(req.url);

    /* ===== GET ===== */
    if (req.method === "GET") {
      const revisionId = url.searchParams.get("id");
      if (revisionId) {
        step = "get_revision";
        const rev = await getRevision(Number(revisionId));
        if (!rev) return notFound("저장 이력을 찾을 수 없습니다");
        return ok({ revision: rev });
      }

      step = "list_revisions";
      const pageId = Number(url.searchParams.get("pageId"));
      if (!Number.isFinite(pageId)) return badRequest("페이지를 지정해주세요");

      const page = await getAdminPage(pageId);
      if (!page) return notFound("페이지를 찾을 수 없습니다");

      const list = await listRevisions(pageId);
      return ok({ pageId, pageTitle: page.title, list });
    }

    /* ===== POST: 되돌리기 ===== */
    if (req.method === "POST") {
      if (!(await canAccess(String((adminMember as any)?.role || ""), "content_edit"))) {
        return forbidden("페이지 편집 권한이 없습니다");
      }

      step = "restore";
      const body = await parseJson<any>(req);
      const pageId = Number(body?.pageId);
      const revisionId = Number(body?.revisionId);
      if (!Number.isFinite(pageId) || !Number.isFinite(revisionId)) {
        return badRequest("페이지와 되돌릴 시점을 지정해주세요");
      }

      const page = await getAdminPage(pageId);
      if (!page) return notFound("페이지를 찾을 수 없습니다");

      const done = await restoreRevision(pageId, revisionId, { uid: admin.uid, name: admin.name });
      if (!done) return badRequest("되돌릴 수 없는 저장 이력입니다");

      try {
        await logAdminAction(req, admin.uid, admin.name, "site_page_restore", {
          target: page.slug,
          detail: { pageId, revisionId },
        });
      } catch (_) {}

      return ok(
        { pageId, revisionId, preview: `/p/${page.slug}?preview=1` },
        "선택한 시점의 내용으로 되돌렸습니다 (임시저장 상태 — 확인 후 [배포])",
      );
    }

    return methodNotAllowed();
  } catch (e: any) {
    console.error("[admin-site-page-revisions]", step, e);
    return serverError("저장 이력 처리에 실패했습니다", e, step);
  }
};
