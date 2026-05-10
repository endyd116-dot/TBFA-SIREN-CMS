import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { adminRecentViews } from "../../db/schema";
import { eq, desc } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";
import { ok } from "../../lib/response";

export const config = { path: "/api/admin-recent-views-list" };

export default async function handler(req: Request, _ctx: Context) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });

  const auth: any = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  const memberId: number = auth.ctx.member.id;

  const url = new URL(req.url);
  const limitParam = parseInt(url.searchParams.get("limit") || "20", 10);
  const limit = Math.min(Math.max(limitParam, 1), 50);

  let recentViews: { menuKey: string; viewedAt: Date; count: number }[] = [];
  try {
    const rows = await db
      .select({
        menuKey:  adminRecentViews.menuKey,
        viewedAt: adminRecentViews.viewedAt,
        count:    adminRecentViews.count,
      })
      .from(adminRecentViews)
      .where(eq(adminRecentViews.memberId, memberId))
      .orderBy(desc(adminRecentViews.viewedAt))
      .limit(limit);
    recentViews = rows.map((r) => ({ menuKey: r.menuKey, viewedAt: r.viewedAt, count: r.count }));
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false,
      error: "최근 방문 목록 조회 실패",
      step: "select_recent_views",
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  return ok({ recentViews });
}
