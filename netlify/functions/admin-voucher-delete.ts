import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-voucher-delete" };

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "전표 삭제 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "DELETE") {
    return new Response(JSON.stringify({ ok: false, error: "DELETE 메서드만 허용" }),
      { status: 405, headers: { "Content-Type": "application/json" } });
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const url = new URL(req.url);
  const id = parseInt(url.searchParams.get("id") || "0");
  if (!id) {
    return new Response(JSON.stringify({ ok: false, error: "id 파라미터 필수" }),
      { status: 400, headers: { "Content-Type": "application/json" } });
  }

  try {
    const rows: any = await db.execute(sql`
      SELECT id, status, voucher_number, created_by FROM vouchers WHERE id = ${id} LIMIT 1
    `);
    const voucher = (rows?.rows ?? rows ?? [])[0];
    if (!voucher) {
      return new Response(JSON.stringify({ ok: false, error: "전표를 찾을 수 없습니다" }),
        { status: 404, headers: { "Content-Type": "application/json" } });
    }
    if (voucher.status !== "draft") {
      return new Response(JSON.stringify({ ok: false, error: `draft 상태에서만 삭제 가능 (현재: ${voucher.status})` }),
        { status: 422, headers: { "Content-Type": "application/json" } });
    }

    await db.execute(sql`DELETE FROM vouchers WHERE id = ${id}`);

    return new Response(JSON.stringify({
      ok: true,
      data: { message: `전표 ${voucher.voucher_number}이 삭제되었습니다.` },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    return jsonError("delete", err);
  }
}
