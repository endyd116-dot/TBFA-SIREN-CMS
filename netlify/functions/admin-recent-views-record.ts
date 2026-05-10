import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { adminRecentViews } from "../../db/schema";
import { eq, and, sql } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";
import { ok } from "../../lib/response";

export const config = { path: "/api/admin-recent-views-record" };

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

  // 기존 레코드 확인
  let existing: any[] = [];
  try {
    existing = await db
      .select({ id: adminRecentViews.id })
      .from(adminRecentViews)
      .where(and(eq(adminRecentViews.memberId, memberId), eq(adminRecentViews.menuKey, menuKey)));
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false, error: "최근 방문 확인 실패", step: "select_existing",
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  if (existing.length > 0) {
    // 이미 있음 → viewed_at 갱신 + count 증가
    try {
      await db
        .update(adminRecentViews)
        .set({
          viewedAt: sql`NOW()`,
          count: sql`${adminRecentViews.count} + 1`,
        } as any)
        .where(and(eq(adminRecentViews.memberId, memberId), eq(adminRecentViews.menuKey, menuKey)));
    } catch (err: any) {
      return new Response(JSON.stringify({
        ok: false, error: "최근 방문 갱신 실패", step: "update",
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  } else {
    // 신규 → 삽입
    try {
      await db.insert(adminRecentViews).values({ memberId, menuKey });
    } catch (err: any) {
      return new Response(JSON.stringify({
        ok: false, error: "최근 방문 기록 실패", step: "insert",
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  }

  return ok({});
}
