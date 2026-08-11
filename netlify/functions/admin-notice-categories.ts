/**
 * GET    /api/admin/notice-categories        — 분류 목록 (숨긴 것 포함, 글 수 함께)
 * POST   /api/admin/notice-categories        — 분류 추가
 * PATCH  /api/admin/notice-categories        — 분류 수정 (body.id 필요)
 * POST   /api/admin/notice-categories?action=reorder — 순서 다시 정하기 (body.ids)
 * DELETE /api/admin/notice-categories?id=N[&moveTo=slug] — 분류 삭제
 *
 * 삭제한 분류에 글이 남아 있으면 그 글은 갈 곳을 잃는다.
 * 그래서 지울 때 "이 글들을 어느 분류로 옮길지"를 함께 받고, 안 주면 일반공지로 옮긴다.
 *
 * 권한: 관리자/슈퍼관리자/운영자
 */
import { eq, asc, sql, count } from "drizzle-orm";
import { db } from "../../db";
import { notices, noticeCategories } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, created, badRequest, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logAdminAction } from "../../lib/audit";

export const config = { path: "/api/admin/notice-categories" };

const SLUG_RE = /^[a-z0-9_-]{1,30}$/i;
const COLORS = ["mute", "info", "warn", "danger", "success"];
const FALLBACK = "general";

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();

  const guard: any = await requireAdmin(req);
  if (!guard.ok) return (guard as { ok: false; res: Response }).res;
  const { admin } = guard.ctx;

  let step = "start";
  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "";

    /* ===== 목록 ===== */
    if (req.method === "GET") {
      step = "select_categories";
      const list = await db
        .select()
        .from(noticeCategories)
        .orderBy(asc(noticeCategories.sortOrder), asc(noticeCategories.id));

      /* 분류별 글 수 — 분류를 지우기 전에 "몇 건이 딸려 있는지" 보여주기 위해.
         실패해도 목록 자체는 보여준다. */
      const counts = new Map<string, number>();
      try {
        step = "count_by_category";
        const rows = await db
          .select({ category: notices.category, c: count() })
          .from(notices)
          .groupBy(notices.category);
        for (const r of rows) counts.set(String(r.category), Number(r.c));
      } catch (err) {
        console.warn("[admin-notice-categories] 분류별 글 수 집계 실패:", err);
      }

      return ok({ list: list.map(c => ({ ...c, noticeCount: counts.get(c.slug) ?? 0 })) });
    }

    /* ===== 순서 다시 정하기 ===== */
    if (req.method === "POST" && action === "reorder") {
      step = "reorder";
      const body = await parseJson(req);
      const ids: number[] = Array.isArray(body?.ids)
        ? body.ids.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n))
        : [];
      if (ids.length === 0) return badRequest("순서를 정할 분류 목록이 비어 있습니다");

      for (let i = 0; i < ids.length; i++) {
        await db.update(noticeCategories)
          .set({ sortOrder: i + 1, updatedAt: new Date() } as any)
          .where(eq(noticeCategories.id, ids[i]));
      }
      return ok({ count: ids.length }, "분류 순서가 바뀌었습니다");
    }

    /* ===== 추가 ===== */
    if (req.method === "POST") {
      step = "create";
      const body = await parseJson(req);
      const slug = String(body?.slug || "").trim().toLowerCase();
      const label = String(body?.label || "").trim();
      const color = String(body?.color || "mute");

      if (!SLUG_RE.test(slug)) return badRequest("분류 코드는 영문·숫자·- _ 로 30자까지 입력하세요 (예: urgent)");
      if (label.length < 1 || label.length > 50) return badRequest("분류 이름을 1~50자로 입력하세요");
      if (!COLORS.includes(color)) return badRequest("분류 색이 올바르지 않습니다");

      const [dup] = await db.select({ id: noticeCategories.id })
        .from(noticeCategories).where(eq(noticeCategories.slug, slug)).limit(1);
      if (dup) return badRequest("이미 같은 분류 코드가 있습니다");

      const [{ maxOrder }] = await db
        .select({ maxOrder: sql<number>`COALESCE(MAX(${noticeCategories.sortOrder}), 0)` })
        .from(noticeCategories);

      const [row] = await db.insert(noticeCategories).values({
        slug, label, color,
        sortOrder: Number(maxOrder) + 1,
        isActive: body?.isActive !== false,
      } as any).returning();

      await logAdminAction(req, admin.uid, admin.name, "notice_category_create", {
        target: slug, detail: { label },
      });
      return created({ category: row }, "분류가 추가되었습니다");
    }

    /* ===== 수정 ===== */
    if (req.method === "PATCH") {
      step = "update";
      const body = await parseJson(req);
      const id = Number(body?.id);
      if (!Number.isFinite(id)) return badRequest("id가 필요합니다");

      const [existing] = await db.select().from(noticeCategories)
        .where(eq(noticeCategories.id, id)).limit(1);
      if (!existing) return notFound("분류를 찾을 수 없습니다");

      const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
      const payload: any = { updatedAt: new Date() };

      if (has("label")) {
        const label = String(body.label || "").trim();
        if (label.length < 1 || label.length > 50) return badRequest("분류 이름을 1~50자로 입력하세요");
        payload.label = label;
      }
      if (has("color")) {
        if (!COLORS.includes(String(body.color))) return badRequest("분류 색이 올바르지 않습니다");
        payload.color = String(body.color);
      }
      if (has("isActive")) payload.isActive = body.isActive === true;
      if (has("sortOrder") && Number.isFinite(Number(body.sortOrder))) {
        payload.sortOrder = Math.max(0, Number(body.sortOrder));
      }

      /* 분류 코드를 바꾸면 그 분류로 저장된 글도 함께 옮겨야 짝이 유지된다 */
      let renamedFrom: string | null = null;
      if (has("slug")) {
        const slug = String(body.slug || "").trim().toLowerCase();
        if (!SLUG_RE.test(slug)) return badRequest("분류 코드는 영문·숫자·- _ 로 30자까지 입력하세요");
        if (slug !== existing.slug) {
          const [dup] = await db.select({ id: noticeCategories.id })
            .from(noticeCategories).where(eq(noticeCategories.slug, slug)).limit(1);
          if (dup) return badRequest("이미 같은 분류 코드가 있습니다");
          payload.slug = slug;
          renamedFrom = existing.slug;
        }
      }

      if (Object.keys(payload).length <= 1) return badRequest("수정할 항목이 없습니다");

      const [row] = await db.update(noticeCategories).set(payload as any)
        .where(eq(noticeCategories.id, id)).returning();

      if (renamedFrom) {
        await db.update(notices)
          .set({ category: payload.slug, updatedAt: new Date() } as any)
          .where(eq(notices.category, renamedFrom));
      }

      await logAdminAction(req, admin.uid, admin.name, "notice_category_update", {
        target: row.slug, detail: { label: row.label, renamedFrom },
      });
      return ok({ category: row }, "분류가 수정되었습니다");
    }

    /* ===== 삭제 ===== */
    if (req.method === "DELETE") {
      step = "delete";
      const id = Number(url.searchParams.get("id"));
      if (!Number.isFinite(id)) return badRequest("id 파라미터가 필요합니다");

      const [existing] = await db.select().from(noticeCategories)
        .where(eq(noticeCategories.id, id)).limit(1);
      if (!existing) return notFound("분류를 찾을 수 없습니다");

      const [{ total }] = await db.select({ total: count() })
        .from(noticeCategories);
      if (Number(total) <= 1) return badRequest("마지막 남은 분류는 지울 수 없습니다");

      /* 딸린 글을 어디로 옮길지 — 지정이 없으면 남아 있는 분류 중 첫 번째로 */
      let moveTo = String(url.searchParams.get("moveTo") || "").trim().toLowerCase();
      if (!moveTo || moveTo === existing.slug) {
        const [alt] = await db.select({ slug: noticeCategories.slug })
          .from(noticeCategories)
          .where(sql`${noticeCategories.id} <> ${id}`)
          .orderBy(asc(noticeCategories.sortOrder), asc(noticeCategories.id))
          .limit(1);
        moveTo = alt?.slug || FALLBACK;
      } else {
        const [target] = await db.select({ id: noticeCategories.id })
          .from(noticeCategories).where(eq(noticeCategories.slug, moveTo)).limit(1);
        if (!target) return badRequest("옮길 분류를 찾을 수 없습니다");
      }

      const movedRows = await db.update(notices)
        .set({ category: moveTo, updatedAt: new Date() } as any)
        .where(eq(notices.category, existing.slug))
        .returning({ id: notices.id });

      await db.delete(noticeCategories).where(eq(noticeCategories.id, id));

      await logAdminAction(req, admin.uid, admin.name, "notice_category_delete", {
        target: existing.slug, detail: { label: existing.label, moveTo, moved: movedRows.length },
      });
      return ok({ moveTo, moved: movedRows.length },
        movedRows.length
          ? `분류를 지우고 공지 ${movedRows.length}건을 다른 분류로 옮겼습니다`
          : "분류가 삭제되었습니다");
    }

    return methodNotAllowed();
  } catch (err) {
    console.error("[admin-notice-categories]", step, err);
    return serverError("공지 분류 관리 중 오류", err, step);
  }
};
