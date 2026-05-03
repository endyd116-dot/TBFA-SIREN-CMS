/**
 * GET    /api/admin/notices            — 목록 (페이징, isPublished 무관)
 * GET    /api/admin/notices?id=N       — 상세
 * POST   /api/admin/notices            — 새 공지 작성
 * PATCH  /api/admin/notices            — 공지 수정 (body.id 필요)
 * DELETE /api/admin/notices?id=N       — 공지 삭제
 *
 * 권한: 관리자/슈퍼관리자/운영자
 */
import { eq, desc, and, or, like, count } from "drizzle-orm";
import { db, notices, members } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import { noticeSchema, safeValidate } from "../../lib/validation";
import {
  ok, created, badRequest, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logAdminAction } from "../../lib/audit";

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();

  /* 관리자 인증 */
  const guard: any = await requireAdmin(req);
  if (!guard.ok) return guard.res;
  const { admin, member: adminMember } = guard.ctx;

  try {
    /* ===== GET ===== */
    if (req.method === "GET") {
      const url = new URL(req.url);
      const id = url.searchParams.get("id");

      /* 상세 조회 */
      if (id) {
        const noticeId = Number(id);
        if (!Number.isFinite(noticeId)) return badRequest("유효하지 않은 ID");

        const [item] = await db
          .select()
          .from(notices)
          .where(eq(notices.id, noticeId))
          .limit(1);

        if (!item) return notFound("공지사항을 찾을 수 없습니다");
        return ok({ notice: item });
      }

      /* 목록 조회 (관리자는 미발행 포함 전체) */
      const page = Math.max(1, Number(url.searchParams.get("page") || 1));
      const limit = Math.min(100, Math.max(10, Number(url.searchParams.get("limit") || 50)));
      const category = url.searchParams.get("category") || "";
      const q = (url.searchParams.get("q") || "").trim();
      const publishedFilter = url.searchParams.get("published") || ""; // "true"/"false"/""

      const conditions: any[] = [];

      if (category && ["general", "member", "event", "media"].includes(category)) {
        conditions.push(eq(notices.category, category as any));
      }

      if (q && q.length >= 2) {
        const pattern = `%${q}%`;
        conditions.push(or(like(notices.title, pattern), like(notices.content, pattern)));
      }

      if (publishedFilter === "true") {
        conditions.push(eq(notices.isPublished, true));
      } else if (publishedFilter === "false") {
        conditions.push(eq(notices.isPublished, false));
      }

      const where: any =
        conditions.length === 0
          ? undefined
          : conditions.length === 1
            ? conditions[0]
            : and(...conditions);

      /* 총 개수 */
      const totalRows = await db
        .select({ total: count() })
        .from(notices)
        .where(where);
      const total = Number(totalRows[0]?.total ?? 0);

      /* 목록 (고정 우선 → 최신순) */
      const list = await db
        .select({
          id: notices.id,
          category: notices.category,
          title: notices.title,
          excerpt: notices.excerpt,
          authorId: notices.authorId,
          authorName: notices.authorName,
          isPinned: notices.isPinned,
          isPublished: notices.isPublished,
          views: notices.views,
          thumbnailUrl: notices.thumbnailUrl,
          publishedAt: notices.publishedAt,
          createdAt: notices.createdAt,
          updatedAt: notices.updatedAt,
        })
        .from(notices)
        .where(where)
        .orderBy(desc(notices.isPinned), desc(notices.createdAt))
        .limit(limit)
        .offset((page - 1) * limit);

      return ok({
        list,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    }

    /* ===== POST (신규 작성) ===== */
    if (req.method === "POST") {
      const body = await parseJson(req);
      if (!body) return badRequest("요청 본문이 비어있습니다");

      const v: any = safeValidate(noticeSchema, body);
      if (!v.ok) return badRequest("입력값을 확인해 주세요", v.errors);

      const data = v.data;
      const insertPayload: any = {
        category: data.category || "general",
        title: data.title,
        content: data.content,
        excerpt: data.excerpt || null,
        thumbnailUrl: data.thumbnailUrl || null,
        isPinned: data.isPinned === true,
        isPublished: data.isPublished !== false,
        authorId: adminMember.id,
        authorName: adminMember.name || "관리자",
        publishedAt: data.isPublished !== false ? new Date() : null,
      };

      const [inserted] = await db
        .insert(notices)
        .values(insertPayload)
        .returning({
          id: notices.id,
          title: notices.title,
          category: notices.category,
          isPublished: notices.isPublished,
        });

      await logAdminAction(req, admin.uid, admin.name, "notice_create", {
        target: `N-${inserted.id}`,
        detail: {
          title: inserted.title,
          category: inserted.category,
          isPublished: inserted.isPublished,
        },
      });

      return created({ notice: inserted }, "공지사항이 등록되었습니다");
    }

    /* ===== PATCH (수정) ===== */
    if (req.method === "PATCH") {
      const body = await parseJson(req);
      if (!body?.id) return badRequest("id가 필요합니다");

      const noticeId = Number(body.id);
      if (!Number.isFinite(noticeId)) return badRequest("유효하지 않은 ID");

      /* 기존 공지 확인 */
      const [existing] = await db
        .select({ id: notices.id, isPublished: notices.isPublished })
        .from(notices)
        .where(eq(notices.id, noticeId))
        .limit(1);

      if (!existing) return notFound("공지사항을 찾을 수 없습니다");

      /* 입력 검증 (id 제외) */
      const { id: _ignore, ...patchData } = body;
      const v: any = safeValidate(noticeSchema, patchData);
      if (!v.ok) return badRequest("입력값을 확인해 주세요", v.errors);

      const data = v.data;
      const updatePayload: any = {
        category: data.category || "general",
        title: data.title,
        content: data.content,
        excerpt: data.excerpt || null,
        thumbnailUrl: data.thumbnailUrl || null,
        isPinned: data.isPinned === true,
        isPublished: data.isPublished !== false,
        updatedAt: new Date(),
      };

      /* 비공개 → 공개로 전환 시 publishedAt 갱신 */
      if (existing.isPublished === false && updatePayload.isPublished === true) {
        updatePayload.publishedAt = new Date();
      }

      const [updated] = await db
        .update(notices)
        .set(updatePayload)
        .where(eq(notices.id, noticeId))
        .returning({
          id: notices.id,
          title: notices.title,
          category: notices.category,
          isPublished: notices.isPublished,
          isPinned: notices.isPinned,
        });

      await logAdminAction(req, admin.uid, admin.name, "notice_update", {
        target: `N-${noticeId}`,
        detail: {
          title: updated.title,
          category: updated.category,
          isPublished: updated.isPublished,
          isPinned: updated.isPinned,
        },
      });

      return ok({ notice: updated }, "공지사항이 수정되었습니다");
    }

    /* ===== DELETE ===== */
    if (req.method === "DELETE") {
      const url = new URL(req.url);
      const idStr = url.searchParams.get("id");
      if (!idStr) return badRequest("id 파라미터가 필요합니다");

      const noticeId = Number(idStr);
      if (!Number.isFinite(noticeId)) return badRequest("유효하지 않은 ID");

      const [existing] = await db
        .select({ id: notices.id, title: notices.title })
        .from(notices)
        .where(eq(notices.id, noticeId))
        .limit(1);

      if (!existing) return notFound("공지사항을 찾을 수 없습니다");

      await db.delete(notices).where(eq(notices.id, noticeId));

      await logAdminAction(req, admin.uid, admin.name, "notice_delete", {
        target: `N-${noticeId}`,
        detail: { title: existing.title },
      });

      return ok({}, "공지사항이 삭제되었습니다");
    }

    return methodNotAllowed();
  } catch (err) {
    console.error("[admin-notices]", err);
    return serverError("공지사항 관리 중 오류", err);
  }
};

export const config = { path: "/api/admin/notices" };