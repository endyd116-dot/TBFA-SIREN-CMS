// netlify/functions/admin-campaigns.ts
// ★ Phase M-19-2: 캠페인 관리 (어드민 CRUD)
//
// GET    /api/admin/campaigns                  — 목록 (페이지네이션 + 통계)
// GET    /api/admin/campaigns?id=N             — 단건 상세
// POST   /api/admin/campaigns                  — 신규 생성
// PATCH  /api/admin/campaigns                  — 수정 (body: { id, ...fields })
// DELETE /api/admin/campaigns?id=N             — 삭제 (관련 donations.campaignId는 SET NULL)
//
// 권한:
//  - GET: 모든 운영자
//  - POST/PATCH/DELETE: super_admin 또는 donation/all 카테고리 담당자

import { eq, and, desc, sql, or, like } from "drizzle-orm";
import { db } from "../../db";
import { campaigns, donations, members } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, badRequest, forbidden, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logAdminAction } from "../../lib/audit";

const VALID_TYPES = ["fundraising", "memorial", "awareness"];
const VALID_STATUSES = ["draft", "active", "closed", "archived"];

/* ───────── 권한 체크 헬퍼 ───────── */
function canEdit(adminMember: any): boolean {
  if (!adminMember) return false;
  if (adminMember.role === "super_admin") return true;
  const cats: string[] = Array.isArray(adminMember.assignedCategories) ? adminMember.assignedCategories : [];
  return cats.includes("all") || cats.includes("donation");
}

/* ───────── slug 생성/검증 ───────── */
function normalizeSlug(input: string): string {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
}

/* ───────── 입력 검증 ───────── */
function validateCampaignInput(body: any, isCreate: boolean): { ok: true; data: any } | { ok: false; error: string } {
  const data: any = {};

  if (isCreate || body.slug !== undefined) {
    const slug = normalizeSlug(body.slug || "");
    if (!slug || slug.length < 3) return { ok: false, error: "slug는 3자 이상이어야 합니다" };
    if (slug.length > 100) return { ok: false, error: "slug는 100자를 초과할 수 없습니다" };
    data.slug = slug;
  }

  if (isCreate || body.type !== undefined) {
    if (!VALID_TYPES.includes(body.type)) return { ok: false, error: "type 값이 유효하지 않습니다" };
    data.type = body.type;
  }

  if (isCreate || body.title !== undefined) {
    const title = String(body.title || "").trim();
    if (!title) return { ok: false, error: "제목은 필수입니다" };
    if (title.length > 200) return { ok: false, error: "제목은 200자를 초과할 수 없습니다" };
    data.title = title;
  }

  if (body.summary !== undefined) {
    data.summary = body.summary === null ? null : String(body.summary).slice(0, 500);
  }

  if (body.contentHtml !== undefined) {
    data.contentHtml = body.contentHtml === null ? null : String(body.contentHtml).slice(0, 100000);
  }

  if (body.thumbnailBlobId !== undefined) {
    if (body.thumbnailBlobId === null) {
      data.thumbnailBlobId = null;
    } else {
      const n = Number(body.thumbnailBlobId);
      if (!Number.isInteger(n) || n < 1) return { ok: false, error: "thumbnailBlobId는 양의 정수여야 합니다" };
      data.thumbnailBlobId = n;
    }
  }

  if (body.status !== undefined) {
    if (!VALID_STATUSES.includes(body.status)) return { ok: false, error: "status 값이 유효하지 않습니다" };
    data.status = body.status;
  }

  if (body.goalAmount !== undefined) {
    if (body.goalAmount === null) {
      data.goalAmount = null;
    } else {
      const n = Number(body.goalAmount);
      if (!Number.isInteger(n) || n < 0) return { ok: false, error: "goalAmount는 0 이상의 정수여야 합니다" };
      data.goalAmount = n;
    }
  }

  if (body.startDate !== undefined) {
    if (body.startDate === null || body.startDate === "") {
      data.startDate = null;
    } else {
      const d = new Date(body.startDate);
      if (isNaN(d.getTime())) return { ok: false, error: "startDate 형식이 잘못되었습니다" };
      data.startDate = d;
    }
  }

  if (body.endDate !== undefined) {
    if (body.endDate === null || body.endDate === "") {
      data.endDate = null;
    } else {
      const d = new Date(body.endDate);
      if (isNaN(d.getTime())) return { ok: false, error: "endDate 형식이 잘못되었습니다" };
      data.endDate = d;
    }
  }

  if (body.isPublished !== undefined) data.isPublished = !!body.isPublished;
  if (body.isPinned !== undefined) data.isPinned = !!body.isPinned;

  if (body.sortOrder !== undefined) {
    const n = Number(body.sortOrder);
    if (!Number.isFinite(n)) return { ok: false, error: "sortOrder는 숫자여야 합니다" };
    data.sortOrder = Math.max(0, Math.min(9999, Math.floor(n)));
  }

  return { ok: true, data };
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
      const idParam = url.searchParams.get("id");

      /* ── 단건 상세 ── */
      if (idParam) {
        const id = Number(idParam);
        if (!Number.isFinite(id)) return badRequest("유효하지 않은 ID");

        const [row] = await db
          .select()
          .from(campaigns)
          .where(eq(campaigns.id, id))
          .limit(1);

        if (!row) return notFound("캠페인을 찾을 수 없습니다");

        /* 작성자 정보 */
        let creator: any = null;
        if ((row as any).createdBy) {
          const [c] = await db
            .select({ id: members.id, name: members.name })
            .from(members)
            .where(eq(members.id, (row as any).createdBy))
            .limit(1);
          creator = c || null;
        }

        return ok({ campaign: row, creator });
      }

      /* ── 목록 ── */
      const page = Math.max(1, Number(url.searchParams.get("page") || 1));
      const limit = Math.min(100, Math.max(10, Number(url.searchParams.get("limit") || 50)));
      const status = url.searchParams.get("status") || "";
      const type = url.searchParams.get("type") || "";
      const published = url.searchParams.get("published") || "";
      const q = (url.searchParams.get("q") || "").trim().slice(0, 100);

      const conds: any[] = [];
      if (VALID_STATUSES.includes(status)) conds.push(eq(campaigns.status, status));
      if (VALID_TYPES.includes(type)) conds.push(eq(campaigns.type, type as any));
      if (published === "true") conds.push(eq(campaigns.isPublished, true));
      else if (published === "false") conds.push(eq(campaigns.isPublished, false));
      if (q && q.length >= 2) {
        conds.push(or(
          like(campaigns.title, `%${q}%`),
          like(campaigns.slug, `%${q}%`),
        ));
      }
      const where = conds.length === 0 ? undefined : (conds.length === 1 ? conds[0] : and(...conds));

      const totalRow: any = await db
        .select({ c: sql<number>`COUNT(*)::int` })
        .from(campaigns)
        .where(where as any);
      const total = Number(totalRow[0]?.c ?? 0);

      const list = await db
        .select()
        .from(campaigns)
        .where(where as any)
        .orderBy(desc(campaigns.isPinned), desc(campaigns.createdAt))
        .limit(limit)
        .offset((page - 1) * limit);

      /* 통계 */
      const statsRows: any = await db.execute(sql`
        SELECT
          COUNT(*)::int AS "totalCount",
          COUNT(*) FILTER (WHERE status = 'draft')::int AS "draftCount",
          COUNT(*) FILTER (WHERE status = 'active')::int AS "activeCount",
          COUNT(*) FILTER (WHERE status = 'closed')::int AS "closedCount",
          COUNT(*) FILTER (WHERE status = 'archived')::int AS "archivedCount",
          COUNT(*) FILTER (WHERE is_published = true)::int AS "publishedCount",
          COALESCE(SUM(raised_amount) FILTER (WHERE status = 'active'), 0)::bigint AS "totalRaisedActive",
          COALESCE(SUM(donor_count) FILTER (WHERE status = 'active'), 0)::int AS "totalDonorsActive"
        FROM campaigns
      `);
      const s: any = statsRows.rows ? statsRows.rows[0] : statsRows[0] || {};

      return ok({
        list,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
        stats: {
          total: s.totalCount || 0,
          draft: s.draftCount || 0,
          active: s.activeCount || 0,
          closed: s.closedCount || 0,
          archived: s.archivedCount || 0,
          published: s.publishedCount || 0,
          totalRaisedActive: Number(s.totalRaisedActive || 0),
          totalDonorsActive: s.totalDonorsActive || 0,
        },
      });
    }

    /* ===== POST: 신규 생성 ===== */
    if (req.method === "POST") {
      if (!canEdit(adminMember)) {
        return forbidden("캠페인 생성 권한이 없습니다 (super_admin 또는 donation 담당자만 가능)");
      }

      const body = await parseJson(req);
      if (!body) return badRequest("요청 본문이 비어있습니다");

      const v = validateCampaignInput(body, true);
      if (!v.ok) return badRequest(v.error);

      /* slug 중복 체크 */
      const [dup] = await db
        .select({ id: campaigns.id })
        .from(campaigns)
        .where(eq(campaigns.slug, v.data.slug))
        .limit(1);
      if (dup) return badRequest("이미 사용 중인 slug입니다");

      /* fundraising인데 goalAmount 없으면 경고 (차단은 아님) */
      const insertData: any = {
        ...v.data,
        createdBy: admin.uid,
      };

      const [created] = await db.insert(campaigns).values(insertData).returning();

      try {
        await logAdminAction(req, admin.uid, admin.name, "campaign_create", {
          target: `C-${created.id}`,
          detail: { slug: created.slug, title: created.title, type: created.type },
        });
      } catch (_) {}

      return ok({ campaign: created }, "캠페인이 생성되었습니다");
    }

    /* ===== PATCH: 수정 ===== */
    if (req.method === "PATCH") {
      if (!canEdit(adminMember)) {
        return forbidden("캠페인 수정 권한이 없습니다");
      }

      const body = await parseJson(req);
      if (!body) return badRequest("요청 본문이 비어있습니다");

      const id = Number(body.id);
      if (!Number.isFinite(id)) return badRequest("유효하지 않은 ID");

      /* 기존 행 조회 */
      const [existing] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
      if (!existing) return notFound("캠페인을 찾을 수 없습니다");

      const v = validateCampaignInput(body, false);
      if (!v.ok) return badRequest(v.error);

      const updateData: any = {
        ...v.data,
        updatedAt: new Date(),
      };

      /* slug 변경 시 중복 체크 */
      if (updateData.slug && updateData.slug !== existing.slug) {
        const [dup] = await db
          .select({ id: campaigns.id })
          .from(campaigns)
          .where(and(eq(campaigns.slug, updateData.slug), sql`${campaigns.id} <> ${id}`))
          .limit(1);
        if (dup) return badRequest("이미 사용 중인 slug입니다");
      }

      const [updated] = await db
        .update(campaigns)
        .set(updateData)
        .where(eq(campaigns.id, id))
        .returning();

      try {
        await logAdminAction(req, admin.uid, admin.name, "campaign_update", {
          target: `C-${id}`,
          detail: { changedFields: Object.keys(v.data) },
        });
      } catch (_) {}

      return ok({ campaign: updated }, "캠페인이 수정되었습니다");
    }

    /* ===== DELETE ===== */
    if (req.method === "DELETE") {
      if (!canEdit(adminMember)) {
        return forbidden("캠페인 삭제 권한이 없습니다");
      }

      const url = new URL(req.url);
      const id = Number(url.searchParams.get("id"));
      if (!Number.isFinite(id)) return badRequest("유효하지 않은 ID");

      const [existing] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
      if (!existing) return notFound("캠페인을 찾을 수 없습니다");

      /* 연결된 후원 건수 확인 */
      const linkedRow: any = await db
        .select({ c: sql<number>`COUNT(*)::int` })
        .from(donations)
        .where(eq(donations.campaignId, id));
      const linkedCount = Number(linkedRow[0]?.c ?? 0);

      /* 삭제 (donations.campaignId는 SET NULL로 자동 처리) */
      await db.delete(campaigns).where(eq(campaigns.id, id));

      try {
        await logAdminAction(req, admin.uid, admin.name, "campaign_delete", {
          target: `C-${id}`,
          detail: { slug: existing.slug, title: existing.title, linkedDonations: linkedCount },
        });
      } catch (_) {}

      return ok({
        deletedId: id,
        linkedDonations: linkedCount,
      }, `캠페인이 삭제되었습니다${linkedCount > 0 ? ` (연결된 후원 ${linkedCount}건은 캠페인 연결이 해제됨)` : ""}`);
    }

    return methodNotAllowed();
  } catch (err: any) {
    console.error("[admin-campaigns]", err);
    return serverError("캠페인 처리 중 오류", err?.message);
  }
};

export const config = { path: "/api/admin/campaigns" };