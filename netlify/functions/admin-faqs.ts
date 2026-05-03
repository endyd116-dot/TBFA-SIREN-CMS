/**
 * GET    /api/admin/faqs               — 목록 (관리자는 비활성 포함 전체)
 * GET    /api/admin/faqs?id=N          — 상세
 * POST   /api/admin/faqs               — 새 FAQ 작성
 * PATCH  /api/admin/faqs               — FAQ 수정 (body.id 필요)
 * DELETE /api/admin/faqs?id=N          — FAQ 삭제
 *
 * 권한: 관리자/슈퍼관리자/운영자
 */
import { eq, desc, asc, and, or, like, count } from "drizzle-orm";
import { db, faqs } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import { faqSchema, safeValidate } from "../../lib/validation";
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
  const { admin } = guard.ctx;

  try {
    /* ===== GET ===== */
    if (req.method === "GET") {
      const url = new URL(req.url);
      const id = url.searchParams.get("id");

      /* 상세 조회 */
      if (id) {
        const faqId = Number(id);
        if (!Number.isFinite(faqId)) return badRequest("유효하지 않은 ID");

        const [item] = await db
          .select()
          .from(faqs)
          .where(eq(faqs.id, faqId))
          .limit(1);

        if (!item) return notFound("FAQ를 찾을 수 없습니다");
        return ok({ faq: item });
      }

      /* 목록 조회 (비활성 포함) */
      const page = Math.max(1, Number(url.searchParams.get("page") || 1));
      const limit = Math.min(200, Math.max(10, Number(url.searchParams.get("limit") || 100)));
      const category = (url.searchParams.get("category") || "").trim();
      const q = (url.searchParams.get("q") || "").trim();
      const activeFilter = url.searchParams.get("active") || ""; // "true"/"false"/""

      const conditions: any[] = [];

      if (category) {
        conditions.push(eq(faqs.category, category));
      }

      if (q && q.length >= 2) {
        const pattern = `%${q}%`;
        conditions.push(or(like(faqs.question, pattern), like(faqs.answer, pattern)));
      }

      if (activeFilter === "true") {
        conditions.push(eq(faqs.isActive, true));
      } else if (activeFilter === "false") {
        conditions.push(eq(faqs.isActive, false));
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
        .from(faqs)
        .where(where);
      const total = Number(totalRows[0]?.total ?? 0);

      /* 목록 (sortOrder 오름차순 → id 오름차순) */
      const list = await db
        .select({
          id: faqs.id,
          category: faqs.category,
          question: faqs.question,
          answer: faqs.answer,
          sortOrder: faqs.sortOrder,
          isActive: faqs.isActive,
          views: faqs.views,
          createdAt: faqs.createdAt,
          updatedAt: faqs.updatedAt,
        })
        .from(faqs)
        .where(where)
        .orderBy(asc(faqs.sortOrder), asc(faqs.id))
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

      const v: any = safeValidate(faqSchema, body);
      if (!v.ok) return badRequest("입력값을 확인해 주세요", v.errors);

      const data = v.data;
      const insertPayload: any = {
        category: data.category || "general",
        question: data.question,
        answer: data.answer,
        sortOrder: typeof data.sortOrder === "number" ? data.sortOrder : 0,
        isActive: data.isActive !== false,
      };

      const [inserted] = await db
        .insert(faqs)
        .values(insertPayload)
        .returning({
          id: faqs.id,
          question: faqs.question,
          category: faqs.category,
          isActive: faqs.isActive,
        });

      await logAdminAction(req, admin.uid, admin.name, "faq_create", {
        target: `F-${inserted.id}`,
        detail: {
          question: inserted.question,
          category: inserted.category,
          isActive: inserted.isActive,
        },
      });

      return created({ faq: inserted }, "FAQ가 등록되었습니다");
    }

    /* ===== PATCH (수정) ===== */
    if (req.method === "PATCH") {
      const body = await parseJson(req);
      if (!body?.id) return badRequest("id가 필요합니다");

      const faqId = Number(body.id);
      if (!Number.isFinite(faqId)) return badRequest("유효하지 않은 ID");

      /* 기존 FAQ 확인 */
      const [existing] = await db
        .select({ id: faqs.id })
        .from(faqs)
        .where(eq(faqs.id, faqId))
        .limit(1);

      if (!existing) return notFound("FAQ를 찾을 수 없습니다");

      /* ★ 빠른 인라인 수정 분기: sortOrder/isActive만 변경 */
      if (body.inlineOnly === true) {
        const inlinePayload: any = { updatedAt: new Date() };
        if (typeof body.sortOrder === "number") inlinePayload.sortOrder = body.sortOrder;
        if (typeof body.isActive === "boolean") inlinePayload.isActive = body.isActive;

        const [updated] = await db
          .update(faqs)
          .set(inlinePayload)
          .where(eq(faqs.id, faqId))
          .returning({
            id: faqs.id,
            sortOrder: faqs.sortOrder,
            isActive: faqs.isActive,
          });

        await logAdminAction(req, admin.uid, admin.name, "faq_inline_update", {
          target: `F-${faqId}`,
          detail: { sortOrder: updated.sortOrder, isActive: updated.isActive },
        });

        return ok({ faq: updated }, "FAQ가 갱신되었습니다");
      }

      /* 전체 수정 — 입력 검증 */
      const { id: _ignore, ...patchData } = body;
      const v: any = safeValidate(faqSchema, patchData);
      if (!v.ok) return badRequest("입력값을 확인해 주세요", v.errors);

      const data = v.data;
      const updatePayload: any = {
        category: data.category || "general",
        question: data.question,
        answer: data.answer,
        sortOrder: typeof data.sortOrder === "number" ? data.sortOrder : 0,
        isActive: data.isActive !== false,
        updatedAt: new Date(),
      };

      const [updated] = await db
        .update(faqs)
        .set(updatePayload)
        .where(eq(faqs.id, faqId))
        .returning({
          id: faqs.id,
          question: faqs.question,
          category: faqs.category,
          isActive: faqs.isActive,
          sortOrder: faqs.sortOrder,
        });

      await logAdminAction(req, admin.uid, admin.name, "faq_update", {
        target: `F-${faqId}`,
        detail: {
          question: updated.question,
          category: updated.category,
          isActive: updated.isActive,
          sortOrder: updated.sortOrder,
        },
      });

      return ok({ faq: updated }, "FAQ가 수정되었습니다");
    }

    /* ===== DELETE ===== */
    if (req.method === "DELETE") {
      const url = new URL(req.url);
      const idStr = url.searchParams.get("id");
      if (!idStr) return badRequest("id 파라미터가 필요합니다");

      const faqId = Number(idStr);
      if (!Number.isFinite(faqId)) return badRequest("유효하지 않은 ID");

      const [existing] = await db
        .select({ id: faqs.id, question: faqs.question })
        .from(faqs)
        .where(eq(faqs.id, faqId))
        .limit(1);

      if (!existing) return notFound("FAQ를 찾을 수 없습니다");

      await db.delete(faqs).where(eq(faqs.id, faqId));

      await logAdminAction(req, admin.uid, admin.name, "faq_delete", {
        target: `F-${faqId}`,
        detail: { question: existing.question },
      });

      return ok({}, "FAQ가 삭제되었습니다");
    }

    return methodNotAllowed();
  } catch (err) {
    console.error("[admin-faqs]", err);
    return serverError("FAQ 관리 중 오류", err);
  }
};

export const config = { path: "/api/admin/faqs" };