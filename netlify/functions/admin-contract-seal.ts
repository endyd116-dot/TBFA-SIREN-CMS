/**
 * 사업자 도장 미리보기 이미지 (슈퍼어드민 전용)
 *   GET /api/admin-contract-seal?entityId=N
 * 등록된 도장 이미지를 그대로 반환(설정 화면 미리보기용).
 */
import type { Context } from "@netlify/functions";
import { jsonKST } from "../../lib/kst";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { downloadFromR2 } from "../../lib/r2-server";

export const config = { path: "/api/admin-contract-seal" };
const JH = { "Content-Type": "application/json; charset=utf-8" };

export default async function handler(req: Request, _ctx: Context) {
  try {
    const auth = await requireAdmin(req);
    if (!auth.ok) return (auth as any).res;
    if ((auth as any).ctx.member.role !== "super_admin") return new Response(jsonKST({ ok: false, error: "권한 없음" }), { status: 403, headers: JH });

    const entityId = Number(new URL(req.url).searchParams.get("entityId"));
    if (!entityId) return new Response(jsonKST({ ok: false, error: "entityId 없음" }), { status: 400, headers: JH });

    const r: any = await db.execute(sql`SELECT seal_r2_key FROM contract_business_entities WHERE id = ${entityId} LIMIT 1`);
    const key = (r?.rows ?? r ?? [])[0]?.seal_r2_key;
    if (!key) return new Response(jsonKST({ ok: false, error: "등록된 도장이 없습니다" }), { status: 404, headers: JH });

    const bytes = await downloadFromR2(key);
    if (!bytes || !bytes.length) return new Response(jsonKST({ ok: false, error: "도장을 불러오지 못했습니다" }), { status: 404, headers: JH });

    return new Response(Buffer.from(bytes), {
      status: 200,
      headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=300" },
    });
  } catch (err: any) {
    return new Response(jsonKST({ ok: false, error: "도장 조회 실패", detail: String(err?.message || err).slice(0, 300) }), { status: 500, headers: JH });
  }
}
