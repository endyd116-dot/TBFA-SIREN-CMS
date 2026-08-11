/**
 * GET    /api/admin/notices            — 목록 (페이징, isPublished 무관)
 * GET    /api/admin/notices?id=N       — 상세
 * POST   /api/admin/notices            — 새 공지 작성
 * PATCH  /api/admin/notices            — 공지 수정 (body.id 필요)
 * DELETE /api/admin/notices?id=N       — 공지 삭제
 *
 * 권한: 관리자/슈퍼관리자/운영자
 */
import { eq, asc, desc, and, or, ilike, count, sql, inArray } from "drizzle-orm";
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
  if (!guard.ok) return (guard as { ok: false; res: Response }).res;
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

      /* 분류는 운영자가 만들고 지우므로 고정 목록으로 막지 않는다 (2026-08-11) */
      if (category && /^[a-z0-9_-]{1,30}$/i.test(category)) {
        conditions.push(eq(notices.category, category));
      }

      if (q && q.length >= 2) {
        const pattern = `%${q}%`;
        conditions.push(or(ilike(notices.title, pattern), ilike(notices.content, pattern)));
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

      /* 목록 — 사용자 화면과 같은 순서로 보여준다. 여기서 위아래로 옮긴 순서가
         그대로 사용자 화면의 번호 1, 2, 3 이 된다. */
      const rows = await db
        .select({
          id: notices.id,
          category: notices.category,
          title: notices.title,
          excerpt: notices.excerpt,
          authorId: notices.authorId,
          authorName: notices.authorName,
          isPinned: notices.isPinned,
          isPublished: notices.isPublished,
          sortOrder: notices.sortOrder,
          views: notices.views,
          thumbnailUrl: notices.thumbnailUrl,
          publishedAt: notices.publishedAt,
          createdAt: notices.createdAt,
          updatedAt: notices.updatedAt,
        })
        .from(notices)
        .where(where)
        .orderBy(
          sql`CASE WHEN ${notices.sortOrder} = 0 THEN 1 ELSE 0 END`,
          asc(notices.sortOrder),
          desc(notices.publishedAt),
          desc(notices.id),
        )
        .limit(limit)
        .offset((page - 1) * limit);

      const startNo = (page - 1) * limit;
      const list = rows.map((r, i) => ({ ...r, displayNo: startNo + i + 1 }));

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

    /* ===== POST ?action=reorder — 화면에 보이는 순서 다시 정하기 =====
       관리자 화면에서 위아래로 옮긴 결과(보이는 순서 그대로의 id 목록)를 받아
       1, 2, 3 … 을 다시 새긴다. 이 번호가 사용자 화면의 공지 번호가 된다. */
    if (req.method === "POST" && new URL(req.url).searchParams.get("action") === "reorder") {
      const body = await parseJson(req);
      const ids: number[] = Array.isArray(body?.ids)
        ? body.ids.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n))
        : [];
      if (ids.length === 0) return badRequest("순서를 정할 공지 목록이 비어 있습니다");
      if (ids.length > 500) return badRequest("한 번에 정할 수 있는 공지는 500건까지입니다");

      /* 보내온 id가 실제로 있는 것들인지 확인 — 없는 번호가 섞이면 순서가 어긋난다 */
      const found = await db
        .select({ id: notices.id })
        .from(notices)
        .where(inArray(notices.id, ids));
      if (found.length !== ids.length) return badRequest("이미 삭제된 공지가 섞여 있습니다. 새로고침 후 다시 시도해 주세요");

      /* 한 문장으로 모두 갱신 — 한 건씩 돌리면 중간에 끊겼을 때 순서가 뒤엉킨다 */
      const cases = ids.map((id, i) => sql`WHEN ${id} THEN ${i + 1}`);
      await db.execute(sql`
        UPDATE notices
           SET sort_order = CASE id ${sql.join(cases, sql` `)} END,
               updated_at = NOW()
         WHERE id IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})
      `);

      await logAdminAction(req, admin.uid, admin.name, "notice_reorder", {
        target: `N-x${ids.length}`,
        detail: { count: ids.length, firstId: ids[0] },
      });

      return ok({ count: ids.length }, "공지 순서가 바뀌었습니다");
    }

    /* ===== POST (신규 작성) ===== */
    if (req.method === "POST") {
      const body = await parseJson(req);
      if (!body) return badRequest("요청 본문이 비어있습니다");

      const v: any = safeValidate(noticeSchema, body);
      if (!v.ok) return badRequest("입력값을 확인해 주세요", v.errors);

      const data = v.data;

      /* 새 글은 목록 맨 위(1번). 기존 글은 한 칸씩 뒤로 민다 —
         그래야 번호가 비지 않고 1, 2, 3 … 으로 이어진다. */
      await db.execute(sql`UPDATE notices SET sort_order = sort_order + 1`);

      const insertPayload: any = {
        sortOrder: 1,
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

      /* 입력 검증 (id 제외) — Q4-016: PATCH는 부분 수정 허용. 발행/고정 토글만 보내도
         제목·본문을 강제하지 않는다. 보낸 필드만 검증·반영. */
      const { id: _ignore, ...patchData } = body;
      const v: any = safeValidate(noticeSchema.partial(), patchData);
      if (!v.ok) return badRequest("입력값을 확인해 주세요", v.errors);

      const data = v.data;
      const has = (k: string) => Object.prototype.hasOwnProperty.call(patchData, k);
      const updatePayload: any = { updatedAt: new Date() };
      if (has("category"))     updatePayload.category = data.category || "general";
      if (has("title"))        updatePayload.title = data.title;
      if (has("content"))      updatePayload.content = data.content;
      if (has("excerpt"))      updatePayload.excerpt = data.excerpt || null;
      if (has("thumbnailUrl")) updatePayload.thumbnailUrl = data.thumbnailUrl || null;
      if (has("isPinned"))     updatePayload.isPinned = data.isPinned === true;
      if (has("isPublished"))  updatePayload.isPublished = data.isPublished === true;
      if (has("sortOrder") && Number.isFinite(Number(data.sortOrder))) {
        updatePayload.sortOrder = Math.max(0, Number(data.sortOrder));
      }

      /* publishedAt 동기화 — 공개 전환 시 발행시각 갱신, 비공개 전환 시 초기화(Q4-028) */
      if (has("isPublished")) {
        if (existing.isPublished === false && data.isPublished === true) {
          updatePayload.publishedAt = new Date();
        } else if (existing.isPublished === true && data.isPublished === false) {
          updatePayload.publishedAt = null;
        }
      }

      if (Object.keys(updatePayload).length <= 1) return badRequest("수정할 항목이 없습니다");

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