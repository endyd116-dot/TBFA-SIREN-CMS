import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { members } from "../../db/schema";
import { and, eq } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-round4-rbac" };

export default async function handler(req: Request, _ctx: Context) {
  const url = new URL(req.url);
  const run = url.searchParams.get("run");

  if (run !== "1") {
    return new Response(
      JSON.stringify({
        ok: true,
        mode: "diagnostic",
        message: "?run=1 파라미터를 추가하면 마이그레이션이 실행됩니다",
        plan: "기존 role=operator(type=admin) → role=admin 일괄 변환",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  const auth: any = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  const results: string[] = [];

  try {
    // 기존 운영자(type=admin, role=operator) → admin 승격
    const updated = await db
      .update(members)
      .set({ role: "admin" } as any)
      .where(
        and(
          eq(members.type, "admin"),
          eq(members.role, "operator")
        )
      )
      .returning({ id: members.id });

    results.push(`role=operator → admin 변환: ${updated.length}건`);
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "마이그레이션 실패",
        step: "update_role",
        detail: String(err?.message || err).slice(0, 500),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({ ok: true, results }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
