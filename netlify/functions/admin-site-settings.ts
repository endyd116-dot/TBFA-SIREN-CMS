// netlify/functions/admin-site-settings.ts
// ★ 2026-05: 어드민 site-settings CRUD + Draft/Publish
//
// GET    /api/admin/site-settings              — 전체 (또는 ?scope=stats)
// PATCH  /api/admin/site-settings              — Draft 저장 (body: { id, valueText?, valueJson?, valueBlobId? })
// POST   /api/admin/site-settings              — Publish (body: { scope?, action: 'publish' })
// DELETE /api/admin/site-settings?id=N&action=discard  — Draft 폐기
//
// 권한: super_admin 또는 'stats_management' / 'all' / 'content' 카테고리

import { eq, and, sql } from "drizzle-orm";
import { db } from "../../db";
import { siteSettings } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, badRequest, forbidden, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import {
  getAdminSettings, saveDraft, publishDrafts, discardDraft,
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
    /* ===== GET ===== */
    if (req.method === "GET") {
      const url = new URL(req.url);
      const scope = url.searchParams.get("scope") || undefined;

      const list = await getAdminSettings(scope);

      /* 전체 통계 */
      const totalRow: any = await db.execute(sql`
        SELECT
          COUNT(*)::int AS "totalCount",
          COUNT(*) FILTER (WHERE has_draft = true)::int AS "draftCount",
          COUNT(DISTINCT scope)::int AS "scopeCount"
        FROM site_settings
      `);
      const tRows = Array.isArray(totalRow) ? totalRow : (totalRow?.rows || []);
      const stats = tRows[0] || {};

      return ok({
        list,
        stats: {
          total: stats.totalCount || 0,
          drafts: stats.draftCount || 0,
          scopes: stats.scopeCount || 0,
        },
      });
    }

    /* ===== PATCH: Draft 저장 ===== */
    if (req.method === "PATCH") {
      if (!canEdit(adminMember)) {
        return forbidden("편집 권한이 없습니다");
      }

      const body = await parseJson(req);
      if (!body?.id) return badRequest("id가 필요합니다");

      const id = Number(body.id);
      if (!Number.isFinite(id)) return badRequest("유효하지 않은 ID");

      const [existing] = await db
        .select()
        .from(siteSettings)
        .where(eq(siteSettings.id, id))
        .limit(1);
      if (!existing) return notFound("설정을 찾을 수 없습니다");

      const draftPayload: any = {};
      if (body.valueText !== undefined) draftPayload.valueText = String(body.valueText);
      if (body.valueBlobId !== undefined) {
        draftPayload.valueBlobId = body.valueBlobId === null ? null : Number(body.valueBlobId);
      }
      if (body.valueJson !== undefined) draftPayload.valueJson = body.valueJson;

      if (Object.keys(draftPayload).length === 0) {
        return badRequest("변경할 값이 없습니다");
      }

      const success = await saveDraft(id, draftPayload, admin.uid);
      if (!success) return serverError("Draft 저장 실패");

      try {
        await logAdminAction(req, admin.uid, admin.name, "site_setting_draft_save", {
          target: `${(existing as any).scope}.${(existing as any).key}`,
          detail: { id, fields: Object.keys(draftPayload) },
        });
      } catch (_) {}

      return ok({ id, hasDraft: true }, "Draft가 저장되었습니다 (운영 미반영 — 배포 필요)");
    }

    /* ===== POST: Publish (Draft → 운영 일괄 적용) ===== */
    if (req.method === "POST") {
      if (!canEdit(adminMember)) {
        return forbidden("배포 권한이 없습니다");
      }

      const body = await parseJson(req);
      const action = body?.action || "publish";
      const scope = body?.scope ? String(body.scope) : undefined;

      if (action === "publish") {
        const count = await publishDrafts(scope);

        /* publish_log에 이력 기록 */
        try {
          await db.execute(sql`
            INSERT INTO site_publish_log (published_by, published_by_name, affected_settings, scopes, note)
            VALUES (${admin.uid}, ${admin.name || "관리자"}, ${count}, ${scope || "all"}, ${body?.note || null})
          `);
        } catch (_) {}

        try {
          await logAdminAction(req, admin.uid, admin.name, "site_setting_publish", {
            target: scope || "all",
            detail: { affectedCount: count },
          });
        } catch (_) {}

        return ok(
          { affectedCount: count },
          count > 0
            ? `${count}건의 변경사항이 운영에 적용되었습니다`
            : "배포할 변경사항이 없습니다"
        );
      }

      return badRequest("지원하지 않는 action");
    }

    /* ===== DELETE: Draft 폐기 ===== */
    if (req.method === "DELETE") {
      if (!canEdit(adminMember)) {
        return forbidden("권한이 없습니다");
      }

      const url = new URL(req.url);
      const id = Number(url.searchParams.get("id"));
      const action = url.searchParams.get("action") || "discard";

      if (!Number.isFinite(id)) return badRequest("id가 필요합니다");

      if (action === "discard") {
        const success = await discardDraft(id);
        if (!success) return serverError("Draft 폐기 실패");

        try {
          await logAdminAction(req, admin.uid, admin.name, "site_setting_draft_discard", {
            target: `id-${id}`,
            detail: { id },
          });
        } catch (_) {}

        return ok({ id }, "Draft가 폐기되었습니다");
      }

      return badRequest("지원하지 않는 action");
    }

    return methodNotAllowed();
  } catch (e: any) {
    console.error("[admin-site-settings]", e);
    return serverError("처리 실패", e?.message);
  }
};

export const config = { path: "/api/admin/site-settings" };