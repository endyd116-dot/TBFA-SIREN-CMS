import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { adminFavorites } from "../../db/schema";
import { eq, and } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";
import { ok } from "../../lib/response";

export const config = { path: "/api/admin-favorites-toggle" };

export default async function handler(req: Request, _ctx: Context) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "POST만 허용" }), {
      status: 405, headers: { "Content-Type": "application/json" },
    });
  }

  const auth: any = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  const memberId: number = auth.ctx.member.id;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "요청 본문 파싱 실패", step: "parse" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const menuKey = (body?.menuKey || "").trim();
  if (!menuKey) {
    return new Response(JSON.stringify({ ok: false, error: "menuKey 필수", step: "validate" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  // 현재 등록 여부 확인
  let existing: any[] = [];
  try {
    existing = await db
      .select({ id: adminFavorites.id })
      .from(adminFavorites)
      .where(and(eq(adminFavorites.memberId, memberId), eq(adminFavorites.menuKey, menuKey)));
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false, error: "즐겨찾기 확인 실패", step: "select_existing",
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  if (existing.length > 0) {
    // 이미 등록됨 → 제거
    try {
      await db
        .delete(adminFavorites)
        .where(and(eq(adminFavorites.memberId, memberId), eq(adminFavorites.menuKey, menuKey)));
    } catch (err: any) {
      return new Response(JSON.stringify({
        ok: false, error: "즐겨찾기 제거 실패", step: "delete",
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
    return ok({ action: "removed" as const });
  } else {
    // 미등록 → 추가
    try {
      await db.insert(adminFavorites).values({ memberId, menuKey });
    } catch (err: any) {
      return new Response(JSON.stringify({
        ok: false, error: "즐겨찾기 추가 실패", step: "insert",
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
    return ok({ action: "added" as const });
  }
}
