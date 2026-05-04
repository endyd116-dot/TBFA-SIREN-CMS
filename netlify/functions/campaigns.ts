// netlify/functions/campaigns.ts
// ★ Phase M-19-2: 사용자 공개 캠페인 API
//
// GET /api/campaigns                — 공개된 active 캠페인 목록
// GET /api/campaigns?slug=xxx       — 단건 상세 (slug 기반)
// GET /api/campaigns?id=N           — 단건 상세 (id 기반)
// GET /api/campaigns?featured=1     — 홈 노출용 (isPinned + 최신 active 5건)
//
// 인증 불필요 (공개 API)
// 단, isPublished=false 또는 status≠active 캠페인은 404 처리

import { eq, and, desc, sql, or, lte, gte, isNull } from "drizzle-orm";
import { db } from "../../db";
import { campaigns } from "../../db/schema";
import {
  ok, badRequest, notFound, serverError,
  corsPreflight, methodNotAllowed,
} from "../../lib/response";

const VALID_TYPES = ["fundraising", "memorial", "awareness"];

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  try {
    const url = new URL(req.url);
    const slug = url.searchParams.get("slug");
    const idParam = url.searchParams.get("id");
    const featured = url.searchParams.get("featured") === "1";

    /* ───── 단건 상세 (slug 또는 id) ───── */
    if (slug || idParam) {
      const conds: any[] = [
        eq(campaigns.isPublished, true),
        sql`${campaigns.status} IN ('active', 'closed')`,
      ];
      if (slug) {
        conds.push(eq(campaigns.slug, slug));
      } else {
        const id = Number(idParam);
        if (!Number.isFinite(id)) return badRequest("유효하지 않은 ID");
        conds.push(eq(campaigns.id, id));
      }

      const [c] = await db.select().from(campaigns).where(and(...conds)).limit(1);
      if (!c) return notFound("캠페인을 찾을 수 없습니다");

      /* 조회수 증가 (실패해도 무시) */
      try {
        await db.update(campaigns)
          .set({ views: sql`${campaigns.views} + 1` as any })
          .where(eq(campaigns.id, c.id));
      } catch (_) {}

      const goalAmount = c.goalAmount || 0;
      const raisedAmount = c.raisedAmount || 0;
      const progressPercent = goalAmount > 0
        ? Math.min(100, Math.round((raisedAmount / goalAmount) * 100 * 10) / 10)
        : null;

      const remainingDays = c.endDate
        ? Math.max(0, Math.ceil((new Date(c.endDate).getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
        : null;

      return ok({
        campaign: {
          id: c.id,
          slug: c.slug,
          type: c.type,
          title: c.title,
          summary: c.summary,
          contentHtml: c.contentHtml,
          thumbnailBlobId: c.thumbnailBlobId,
          status: c.status,
          goalAmount,
          raisedAmount,
          donorCount: c.donorCount || 0,
          progressPercent,
          remainingDays,
          startDate: c.startDate,
          endDate: c.endDate,
          views: (c.views || 0) + 1,
        },
      });
    }

    /* ───── 홈 노출용 ───── */
    if (featured) {
      const list = await db
        .select({
          id: campaigns.id,
          slug: campaigns.slug,
          type: campaigns.type,
          title: campaigns.title,
          summary: campaigns.summary,
          thumbnailBlobId: campaigns.thumbnailBlobId,
          goalAmount: campaigns.goalAmount,
          raisedAmount: campaigns.raisedAmount,
          donorCount: campaigns.donorCount,
          startDate: campaigns.startDate,
          endDate: campaigns.endDate,
          isPinned: campaigns.isPinned,
        })
        .from(campaigns)
        .where(and(
          eq(campaigns.isPublished, true),
          eq(campaigns.status, "active"),
        ))
        .orderBy(desc(campaigns.isPinned), desc(campaigns.createdAt))
        .limit(5);

      const enriched = list.map((c: any) => {
        const goal = c.goalAmount || 0;
        const raised = c.raisedAmount || 0;
        return {
          ...c,
          progressPercent: goal > 0 ? Math.min(100, Math.round((raised / goal) * 100 * 10) / 10) : null,
          remainingDays: c.endDate
            ? Math.max(0, Math.ceil((new Date(c.endDate).getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
            : null,
        };
      });

      return ok({ list: enriched });
    }

    /* ───── 일반 목록 ───── */
    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const limit = Math.min(50, Math.max(6, Number(url.searchParams.get("limit") || 12)));
    const type = url.searchParams.get("type") || "";
    const includeClosed = url.searchParams.get("includeClosed") === "1";

    const conds: any[] = [eq(campaigns.isPublished, true)];
    if (includeClosed) {
      conds.push(sql`${campaigns.status} IN ('active', 'closed')`);
    } else {
      conds.push(eq(campaigns.status, "active"));
    }
    if (VALID_TYPES.includes(type)) {
      conds.push(eq(campaigns.type, type as any));
    }

    const where = and(...conds);

    const totalRow: any = await db
      .select({ c: sql<number>`COUNT(*)::int` })
      .from(campaigns)
      .where(where as any);
    const total = Number(totalRow[0]?.c ?? 0);

    const list = await db
      .select({
        id: campaigns.id,
        slug: campaigns.slug,
        type: campaigns.type,
        title: campaigns.title,
        summary: campaigns.summary,
        thumbnailBlobId: campaigns.thumbnailBlobId,
        status: campaigns.status,
        goalAmount: campaigns.goalAmount,
        raisedAmount: campaigns.raisedAmount,
        donorCount: campaigns.donorCount,
        startDate: campaigns.startDate,
        endDate: campaigns.endDate,
        isPinned: campaigns.isPinned,
        views: campaigns.views,
        createdAt: campaigns.createdAt,
      })
      .from(campaigns)
      .where(where as any)
      .orderBy(desc(campaigns.isPinned), desc(campaigns.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);

    const enriched = list.map((c: any) => {
      const goal = c.goalAmount || 0;
      const raised = c.raisedAmount || 0;
      return {
        ...c,
        progressPercent: goal > 0 ? Math.min(100, Math.round((raised / goal) * 100 * 10) / 10) : null,
        remainingDays: c.endDate
          ? Math.max(0, Math.ceil((new Date(c.endDate).getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
          : null,
      };
    });

    return ok({
      list: enriched,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err: any) {
    console.error("[campaigns]", err);
    return serverError("캠페인 조회 중 오류", err?.message);
  }
};

export const config = { path: "/api/campaigns" };