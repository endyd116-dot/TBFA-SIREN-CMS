import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-account-code-reorder" };

function jsonError(step: string, err: any, status = 500) {
  return new Response(jsonKST({
    ok: false, error: "계정과목 순서 변경 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}

/**
 * 계정과목 순서 변경 — orderedIds 배열 순서대로 sort_order 재할당 (10 간격).
 * 화면에서 드래그 후 전체 id 순서를 보내면 일괄 갱신.
 */
export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "POST") {
    return new Response(jsonKST({ ok: false, error: "Method Not Allowed" }),
      { status: 405, headers: { "Content-Type": "application/json" } });
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  let body: any;
  try {
    body = await req.json();
  } catch (err) {
    return jsonError("parse_body", err, 400);
  }

  const rawIds = Array.isArray(body?.orderedIds) ? body.orderedIds : [];
  const orderedIds = rawIds.map((n: any) => Number(n)).filter((n: number) => Number.isInteger(n) && n > 0);

  if (orderedIds.length === 0) {
    return jsonError("validate", new Error("orderedIds 배열이 필요합니다."), 400);
  }
  // 중복 제거 (같은 id 두 번 들어오면 sort_order 꼬임)
  if (new Set(orderedIds).size !== orderedIds.length) {
    return jsonError("validate", new Error("orderedIds에 중복된 id가 있습니다."), 400);
  }

  try {
    let updated = 0;
    for (let i = 0; i < orderedIds.length; i++) {
      const res: any = await db.execute(sql`
        UPDATE account_codes SET sort_order = ${(i + 1) * 10}
        WHERE id = ${orderedIds[i]}`);
      updated += res?.rowCount ?? 0;
    }
    return new Response(jsonKST({
      ok: true, data: { updated, total: orderedIds.length },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return jsonError("reorder", err);
  }
}
