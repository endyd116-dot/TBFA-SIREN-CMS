import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { adminFavorites } from "../../db/schema";
import { eq, asc } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";
import { ok } from "../../lib/response";

export const config = { path: "/api/admin-favorites-list" };

export default async function handler(req: Request, _ctx: Context) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });

  const auth: any = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  const memberId: number = auth.ctx.member.id;

  let favorites: { menuKey: string; createdAt: Date }[] = [];
  try {
    const rows = await db
      .select({ menuKey: adminFavorites.menuKey, createdAt: adminFavorites.createdAt })
      .from(adminFavorites)
      .where(eq(adminFavorites.memberId, memberId))
      .orderBy(asc(adminFavorites.createdAt));
    favorites = rows.map((r) => ({ menuKey: r.menuKey, createdAt: r.createdAt }));
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false,
      error: "즐겨찾기 목록 조회 실패",
      step: "select_favorites",
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  return ok({ favorites });
}
