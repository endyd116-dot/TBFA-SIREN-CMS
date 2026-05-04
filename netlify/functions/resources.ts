// netlify/functions/resources.ts
// ★ Phase M-19-8: 공개 자료실 API (Public)
//
// GET /api/resources                            — 공개 자료 목록 (권한별 필터)
// GET /api/resources?slug=xxx                   — 단건 상세 (slug)
// GET /api/resources?id=N                       — 단건 상세 (id)
// GET /api/resources?id=N&download=1            — 다운로드 (count 증가 + R2 redirect)
// GET /api/resources?categoryId=N               — 카테고리 필터
// GET /api/resources?tag=xxx                    — 태그 필터
//
// 권한 분기:
//   - 비로그인:  public 자료만 조회/다운로드
//   - 로그인:    public + members_only 자료까지
//   - 어드민:    모든 자료 (private 포함)
//
// private 자료는 어드민이 아닌 사용자에게는 404로 위장 (존재 노출 차단)

import { eq, and, desc, sql, or, like, inArray } from "drizzle-orm";
import { db } from "../../db";
import { resources, resourceCategories, members, blobUploads } from "../../db/schema";
import {
  ok, badRequest, notFound, serverError,
  corsPreflight, methodNotAllowed,
} from "../../lib/response";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "";
const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || "";

const VALID_ACCESS_LEVELS = ["public", "members_only", "private"];

/* ───────── 인증 유틸 (선택적 — 비로그인도 OK) ─────────
   사용자 토큰: siren_token 쿠키 (JWT_SECRET 검증)
   관리자 토큰: siren_admin_token 쿠키 (ADMIN_JWT_SECRET 검증)
*/
function readCookie(req: Request, name: string): string | null {
  const cookieHeader = req.headers.get("cookie") || "";
  const re = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`);
  const m = re.exec(cookieHeader);
  return m ? decodeURIComponent(m[1]) : null;
}

function getViewerContext(req: Request): {
  isLoggedIn: boolean;
  isAdmin: boolean;
  uid: number | null;
} {
  /* 어드민 토큰 우선 검증 */
  if (ADMIN_JWT_SECRET) {
    const adminToken = readCookie(req, "siren_admin_token");
    if (adminToken) {
      try {
        const payload: any = jwt.verify(adminToken, ADMIN_JWT_SECRET);
        if (payload?.uid) {
          return { isLoggedIn: true, isAdmin: true, uid: Number(payload.uid) };
        }
      } catch (_) {}
    }
  }

  /* 일반 사용자 토큰 */
  if (JWT_SECRET) {
    const userToken = readCookie(req, "siren_token");
    if (userToken) {
      try {
        const payload: any = jwt.verify(userToken, JWT_SECRET);
        if (payload?.uid) {
          return { isLoggedIn: true, isAdmin: false, uid: Number(payload.uid) };
        }
      } catch (_) {}
    }
  }

  return { isLoggedIn: false, isAdmin: false, uid: null };
}

/* ───────── 접근 권한 검사 ─────────
   - public:        누구나 OK
   - members_only:  로그인 사용자 OK
   - private:       어드민만 OK
*/
function canViewerAccess(
  resourceAccessLevel: string,
  viewer: { isLoggedIn: boolean; isAdmin: boolean }
): boolean {
  if (viewer.isAdmin) return true;
  if (resourceAccessLevel === "public") return true;
  if (resourceAccessLevel === "members_only" && viewer.isLoggedIn) return true;
  return false;
}

/* ───────── 자료가 viewer에게 보이는지 결정 (목록 필터링용) ─────────
   - 어드민:        모든 published 자료
   - 로그인 사용자: public + members_only published 자료
   - 비로그인:      public published 자료만
*/
function buildAccessLevelFilter(viewer: { isLoggedIn: boolean; isAdmin: boolean }): string[] {
  if (viewer.isAdmin) return ["public", "members_only", "private"];
  if (viewer.isLoggedIn) return ["public", "members_only"];
  return ["public"];
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  try {
    const url = new URL(req.url);
    const viewer = getViewerContext(req);

    const idParam = url.searchParams.get("id");
    const slugParam = url.searchParams.get("slug");
    const wantDownload = url.searchParams.get("download") === "1";

    /* ===================================================
       다운로드 엔드포인트 — id 필수
       =================================================== */
    if (wantDownload) {
      if (!idParam) return badRequest("id 파라미터가 필요합니다");
      const id = Number(idParam);
      if (!Number.isFinite(id)) return badRequest("유효하지 않은 ID");

      const [r] = await db
        .select()
        .from(resources)
        .where(eq(resources.id, id))
        .limit(1);

      /* 미공개 또는 미발행 → 404 위장 */
      if (!r || !r.isPublished) return notFound("자료를 찾을 수 없습니다");

      /* 권한 체크 (private는 어드민만 / members_only는 로그인) */
      if (!canViewerAccess(r.accessLevel, viewer)) {
        if (r.accessLevel === "members_only") {
          return new Response(
            JSON.stringify({
              ok: false,
              error: "로그인이 필요한 자료입니다",
              requireLogin: true,
            }),
            {
              status: 403,
              headers: { "Content-Type": "application/json; charset=utf-8" },
            }
          );
        }
        /* private: 존재 자체를 노출하지 않음 */
        return notFound("자료를 찾을 수 없습니다");
      }

      /* 첨부 파일 확인 */
      if (!r.fileBlobId) {
        return badRequest("이 자료에는 다운로드 가능한 파일이 없습니다");
      }

      /* 다운로드 카운트 증가 (race-safe) */
      try {
        await db
          .update(resources)
          .set({ downloadCount: sql`${resources.downloadCount} + 1` as any })
          .where(eq(resources.id, id));
      } catch (e) {
        console.warn("[resources] downloadCount 증가 실패:", e);
      }

      /* /api/blob-image 로 리다이렉트 (R2 presigned URL 자동 처리) */
      return new Response(null, {
        status: 302,
        headers: {
          Location: `/api/blob-image?id=${r.fileBlobId}&download=1`,
        },
      });
    }

    /* ===================================================
       단건 상세 (slug 또는 id)
       =================================================== */
    if (idParam || slugParam) {
      const conds: any[] = [eq(resources.isPublished, true)];
      if (idParam) {
        const id = Number(idParam);
        if (!Number.isFinite(id)) return badRequest("유효하지 않은 ID");
        conds.push(eq(resources.id, id));
      } else if (slugParam) {
        conds.push(eq(resources.slug, String(slugParam)));
      }

      const [r] = await db
        .select()
        .from(resources)
        .where(and(...conds))
        .limit(1);

      if (!r) return notFound("자료를 찾을 수 없습니다");

      /* 권한 체크 (private는 어드민만 / members_only는 로그인) */
      if (!canViewerAccess(r.accessLevel, viewer)) {
        if (r.accessLevel === "members_only") {
          return new Response(
            JSON.stringify({
              ok: false,
              error: "로그인이 필요한 자료입니다",
              requireLogin: true,
              preview: {
                title: r.title,
                description: r.description,
                category: r.categoryId,
              },
            }),
            {
              status: 403,
              headers: { "Content-Type": "application/json; charset=utf-8" },
            }
          );
        }
        /* private: 존재 자체를 노출하지 않음 */
        return notFound("자료를 찾을 수 없습니다");
      }

      /* 조회수 증가 (실패해도 무시) */
      try {
        await db
          .update(resources)
          .set({ views: sql`${resources.views} + 1` as any })
          .where(eq(resources.id, r.id));
      } catch (_) {}

      /* 카테고리 정보 */
      let category: any = null;
      if (r.categoryId) {
        const [c] = await db
          .select({
            id: resourceCategories.id,
            code: resourceCategories.code,
            nameKo: resourceCategories.nameKo,
            icon: resourceCategories.icon,
          })
          .from(resourceCategories)
          .where(
            and(
              eq(resourceCategories.id, r.categoryId),
              eq(resourceCategories.isActive, true)
            )
          )
          .limit(1);
        category = c || null;
      }

      /* 파일 정보 (메타데이터만 — 실제 다운로드 URL은 별도 엔드포인트) */
      let fileInfo: any = null;
      if (r.fileBlobId) {
        const [b] = await db
          .select({
            id: blobUploads.id,
            originalName: blobUploads.originalName,
            mimeType: blobUploads.mimeType,
            sizeBytes: blobUploads.sizeBytes,
          })
          .from(blobUploads)
          .where(eq(blobUploads.id, r.fileBlobId))
          .limit(1);
        if (b) {
          fileInfo = {
            originalName: b.originalName,
            mimeType: b.mimeType,
            sizeBytes: b.sizeBytes,
            downloadUrl: `/api/resources?id=${r.id}&download=1`,
          };
        }
      }

      return ok({
        resource: {
          id: r.id,
          slug: r.slug,
          title: r.title,
          description: r.description,
          contentHtml: r.contentHtml,
          accessLevel: r.accessLevel,
          tags: r.tags,
          downloadCount: r.downloadCount,
          views: (r.views || 0) + 1,
          isPinned: r.isPinned,
          publishedAt: r.publishedAt,
          createdAt: r.createdAt,
          thumbnailBlobId: r.thumbnailBlobId,
          fileBlobId: r.fileBlobId,
        },
        category,
        file: fileInfo,
      });
    }

    /* ===================================================
       목록 조회
       =================================================== */
    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const limit = Math.min(50, Math.max(6, Number(url.searchParams.get("limit") || 12)));
    const categoryId = url.searchParams.get("categoryId");
    const tag = (url.searchParams.get("tag") || "").trim();
    const q = (url.searchParams.get("q") || "").trim().slice(0, 100);

    /* 권한별 접근 가능 access_level 결정 */
    const allowedLevels = buildAccessLevelFilter(viewer);

    const conds: any[] = [
      eq(resources.isPublished, true),
      inArray(resources.accessLevel, allowedLevels as any),
    ];

    if (categoryId) {
      const cn = Number(categoryId);
      if (Number.isFinite(cn)) conds.push(eq(resources.categoryId, cn));
    }
    if (tag) {
      conds.push(sql`${resources.tags} @> ${JSON.stringify([tag])}::jsonb`);
    }
    if (q && q.length >= 2) {
      conds.push(
        or(
          like(resources.title, `%${q}%`),
          like(resources.description, `%${q}%`)
        )
      );
    }

    const where = conds.length === 1 ? conds[0] : and(...conds);

    /* 총 개수 */
    const totalRow: any = await db
      .select({ c: sql<number>`COUNT(*)::int` })
      .from(resources)
      .where(where as any);
    const total = Number(totalRow[0]?.c ?? 0);

    /* 목록 */
    const list = await db
      .select({
        id: resources.id,
        categoryId: resources.categoryId,
        title: resources.title,
        slug: resources.slug,
        description: resources.description,
        thumbnailBlobId: resources.thumbnailBlobId,
        fileBlobId: resources.fileBlobId,
        accessLevel: resources.accessLevel,
        tags: resources.tags,
        downloadCount: resources.downloadCount,
        views: resources.views,
        isPinned: resources.isPinned,
        publishedAt: resources.publishedAt,
        createdAt: resources.createdAt,
      })
      .from(resources)
      .where(where as any)
      .orderBy(
        desc(resources.isPinned),
        desc(resources.publishedAt),
        desc(resources.createdAt)
      )
      .limit(limit)
      .offset((page - 1) * limit);

    /* 카테고리명 일괄 조회 (N+1 회피) */
    const catIds = list
      .map((r: any) => r.categoryId)
      .filter((v: any) => v != null);
    const catMap: Record<string, any> = {};
    if (catIds.length > 0) {
      const cats = await db
        .select({
          id: resourceCategories.id,
          code: resourceCategories.code,
          nameKo: resourceCategories.nameKo,
          icon: resourceCategories.icon,
        })
        .from(resourceCategories)
        .where(
          and(
            inArray(resourceCategories.id, catIds as any),
            eq(resourceCategories.isActive, true)
          )
        );
      for (const c of cats) catMap[String(c.id)] = c;
    }

    /* 활성 카테고리 마스터 (사이드바 필터용) */
    const activeCategoriesRaw = await db
      .select({
        id: resourceCategories.id,
        code: resourceCategories.code,
        nameKo: resourceCategories.nameKo,
        icon: resourceCategories.icon,
        sortOrder: resourceCategories.sortOrder,
      })
      .from(resourceCategories)
      .where(eq(resourceCategories.isActive, true))
      .orderBy(resourceCategories.sortOrder, resourceCategories.id);

    /* 카테고리별 자료 카운트 (현재 viewer가 볼 수 있는 것만) */
    const catCountsRaw: any = await db.execute(sql`
      SELECT category_id, COUNT(*)::int AS cnt
      FROM resources
      WHERE is_published = true
        AND access_level = ANY(${allowedLevels})
        AND category_id IS NOT NULL
      GROUP BY category_id
    `);
    const catCountRows = catCountsRaw.rows || catCountsRaw || [];
    const catCountMap: Record<string, number> = {};
    for (const r of catCountRows as any[]) {
      if (r.category_id) catCountMap[String(r.category_id)] = Number(r.cnt) || 0;
    }

    const enrichedList = list.map((r: any) => ({
      ...r,
      category: r.categoryId ? catMap[String(r.categoryId)] || null : null,
    }));

    const enrichedCategories = activeCategoriesRaw.map((c: any) => ({
      ...c,
      resourceCount: catCountMap[String(c.id)] || 0,
    }));

    return ok({
      list: enrichedList,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      categories: enrichedCategories,
      viewer: {
        isLoggedIn: viewer.isLoggedIn,
        isAdmin: viewer.isAdmin,
      },
    });
  } catch (err: any) {
    console.error("[resources]", err);
    return serverError("자료 조회 중 오류", err?.message);
  }
};

export const config = { path: "/api/resources" };