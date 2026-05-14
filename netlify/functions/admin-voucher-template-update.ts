/**
 * PUT /api/admin-voucher-template-update
 * 반복 전표 템플릿 주기 설정 — recurring_day / recurring_active 갱신
 *
 * Body: { id, recurringDay (1~31, 0=말일, null=해제), recurringActive (boolean) }
 *
 * Phase 22-D-R3 §4.1 — is_template=true 전표만 대상
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-voucher-template-update" };

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "반복 템플릿 설정 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "PUT") {
    return new Response(JSON.stringify({ ok: false, error: "PUT 메서드만 허용" }),
      { status: 405, headers: { "Content-Type": "application/json" } });
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  let body: any;
  try { body = await req.json(); } catch { body = {}; }

  const { id, recurringDay, recurringActive } = body;

  if (!id) {
    return new Response(JSON.stringify({ ok: false, error: "id 필수" }),
      { status: 400, headers: { "Content-Type": "application/json" } });
  }

  // recurringDay 검증: null 허용, 또는 0~31 정수
  let day: number | null = null;
  if (recurringDay !== undefined && recurringDay !== null && recurringDay !== "") {
    day = parseInt(String(recurringDay));
    if (!Number.isFinite(day) || day < 0 || day > 31) {
      return new Response(JSON.stringify({ ok: false, error: "recurringDay는 0~31 사이 (0=말일)" }),
        { status: 422, headers: { "Content-Type": "application/json" } });
    }
  }
  const active = Boolean(recurringActive);

  // active=true 인데 day 없으면 거절 (자동 생성일 미지정)
  if (active && day === null) {
    return new Response(JSON.stringify({ ok: false, error: "자동 생성을 켜려면 생성일(recurringDay)을 지정해야 합니다" }),
      { status: 422, headers: { "Content-Type": "application/json" } });
  }

  // 템플릿 존재·is_template 확인
  let tpl: any;
  try {
    const rows: any = await db.execute(sql`
      SELECT id, is_template, template_name, voucher_number
      FROM vouchers WHERE id = ${Number(id)} LIMIT 1
    `);
    tpl = (rows?.rows ?? rows ?? [])[0];
    if (!tpl) {
      return new Response(JSON.stringify({ ok: false, error: "전표를 찾을 수 없습니다" }),
        { status: 404, headers: { "Content-Type": "application/json" } });
    }
    if (!tpl.is_template) {
      return new Response(JSON.stringify({ ok: false, error: "반복 주기는 템플릿 전표에만 설정 가능합니다" }),
        { status: 422, headers: { "Content-Type": "application/json" } });
    }
  } catch (err: any) {
    return jsonError("select", err);
  }

  try {
    await db.execute(sql`
      UPDATE vouchers SET
        recurring_day    = ${day},
        recurring_active = ${active},
        updated_at       = NOW()
      WHERE id = ${Number(id)}
    `);

    return new Response(JSON.stringify({
      ok: true,
      data: {
        id: Number(id),
        recurringDay: day,
        recurringActive: active,
        message: active
          ? `템플릿 "${tpl.template_name || tpl.voucher_number}" — 매월 ${day === 0 ? "말일" : day + "일"} 자동 생성 ON`
          : `템플릿 "${tpl.template_name || tpl.voucher_number}" — 자동 생성 OFF`,
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    return jsonError("update", err);
  }
}
