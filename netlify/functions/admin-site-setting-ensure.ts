/**
 * POST /api/admin/site-setting-ensure   body: { scope, key, valueType?, valueText?, valueJson?, description? }
 *
 * 설정 행이 없으면 만들고(발행값으로), 있으면 그대로 돌려준다.
 * 메인 편집에 새 섹션(후원 계좌 안내 배너 등)이 생겨도 1회용 마이그 없이 바로 편집할 수 있게 한다.
 * 아무 키나 만들지 못하게 허용 키 목록으로 제한한다.
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/admin/site-setting-ensure" };
const HEADERS = { "Content-Type": "application/json; charset=utf-8" };
const rowsOf = (r: any): any[] => (r?.rows ?? r ?? []) as any[];

/** 만들 수 있는 설정 키 — 새 섹션을 추가할 때 여기에 함께 등록한다 */
const ALLOWED: Record<string, { scope: string; valueType: "text" | "json"; description: string }> = {
  "home.bankBanner.visible": { scope: "home", valueType: "text", description: "홈 회비 납부 계좌 안내 배너 노출(true/false)" },
  "home.bankBanner.title": { scope: "home", valueType: "text", description: "홈 회비 납부 계좌 안내 배너 제목" },
  "home.bankBanner.lead": { scope: "home", valueType: "text", description: "홈 회비 납부 계좌 안내 배너 문구" },
};

export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "POST") {
    return new Response(jsonKST({ ok: false, error: "POST만 허용" }), { status: 405, headers: HEADERS });
  }
  let step = "auth";
  try {
    const auth = await requireAdmin(req);
    if (!auth.ok) return (auth as { ok: false; res: Response }).res;
    const admin = (auth as any).ctx?.admin;

    step = "parse";
    const body: any = await req.json().catch(() => null);
    const key = String(body?.key || "").trim();
    const spec = ALLOWED[key];
    if (!spec) {
      return new Response(jsonKST({ ok: false, error: "만들 수 없는 설정 키입니다", key }), { status: 400, headers: HEADERS });
    }
    const scope = spec.scope;

    step = "select";
    const found = rowsOf(await db.execute(sql`SELECT id FROM site_settings WHERE scope = ${scope} AND key = ${key} LIMIT 1`))[0];
    if (found) {
      return new Response(jsonKST({ ok: true, data: { id: Number(found.id), key, created: false } }), { headers: HEADERS });
    }

    step = "insert";
    const valueText = body?.valueText == null ? null : String(body.valueText);
    const valueJson = spec.valueType === "json" && body?.valueJson !== undefined ? JSON.stringify(body.valueJson) : null;
    const inserted = rowsOf(await db.execute(sql`
      INSERT INTO site_settings (scope, key, value_type, value_text, value_json, description, sort_order, is_active, updated_at, updated_by)
      VALUES (${scope}, ${key}, ${spec.valueType}, ${valueText}, ${valueJson}::jsonb, ${spec.description}, 0, true, NOW(), ${Number(admin?.uid) || null})
      RETURNING id`))[0];

    return new Response(jsonKST({ ok: true, data: { id: Number(inserted?.id), key, created: true } }), { headers: HEADERS });
  } catch (err: any) {
    return new Response(jsonKST({
      ok: false, error: "설정 행 생성 실패", step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: HEADERS });
  }
}
