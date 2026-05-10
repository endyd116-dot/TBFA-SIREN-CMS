// netlify/functions/admin-auto-trigger-update.ts
// Phase 10 R4 — 자동 트리거 수정 (어드민)
//
// POST ?id=X body: { name?, description?, triggerType?, templateId?, channel?,
//                    delayHours?, cooldownDays?, conditions? }

import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-auto-trigger-update" };

const VALID_TRIGGER_TYPES = ["new_member","donation_complete","support_approved","birthday","anniversary"];
const VALID_CHANNELS = ["email","sms","kakao","inapp"];

export default async function handler(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "POST만 허용" }),
      { status: 405, headers: { "Content-Type": "application/json" } });
  }

  const url = new URL(req.url);
  const id = Number(url.searchParams.get("id"));
  if (!id || isNaN(id)) {
    return new Response(JSON.stringify({ ok: false, error: "트리거 ID(id)가 필요합니다" }),
      { status: 400, headers: { "Content-Type": "application/json" } });
  }

  let body: any;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ ok: false, error: "JSON 파싱 실패" }),
      { status: 400, headers: { "Content-Type": "application/json" } });
  }

  try {
    /* 존재 확인 */
    const existRes: any = await db.execute(sql`
      SELECT id FROM communication_auto_triggers WHERE id = ${id} AND deleted_at IS NULL LIMIT 1
    `);
    if (!(existRes?.rows ?? existRes ?? [])[0]) {
      return new Response(JSON.stringify({ ok: false, error: "트리거를 찾을 수 없습니다" }),
        { status: 404, headers: { "Content-Type": "application/json" } });
    }

    /* 검증 */
    const errors: string[] = [];
    if (body.name !== undefined && (String(body.name).trim().length === 0 || String(body.name).length > 200))
      errors.push("name은 1~200자");
    if (body.triggerType !== undefined && !VALID_TRIGGER_TYPES.includes(body.triggerType))
      errors.push(`triggerType은 ${VALID_TRIGGER_TYPES.join("|")} 중 하나`);
    if (body.channel !== undefined && !VALID_CHANNELS.includes(body.channel))
      errors.push(`channel은 ${VALID_CHANNELS.join("|")} 중 하나`);
    if (errors.length > 0) {
      return new Response(JSON.stringify({ ok: false, error: errors.join(", ") }),
        { status: 400, headers: { "Content-Type": "application/json" } });
    }

    /* 템플릿 존재 확인 (변경 시) */
    if (body.templateId !== undefined) {
      const tplRes: any = await db.execute(sql`
        SELECT id, is_active FROM communication_templates WHERE id = ${Number(body.templateId)} LIMIT 1
      `);
      const tpl = (tplRes?.rows ?? tplRes ?? [])[0];
      if (!tpl) return new Response(JSON.stringify({ ok: false, error: "존재하지 않는 템플릿입니다" }),
        { status: 400, headers: { "Content-Type": "application/json" } });
      if (!tpl.is_active) return new Response(JSON.stringify({ ok: false, error: "비활성 템플릿입니다" }),
        { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const adminId = auth.ctx.admin.uid;
    const sets: ReturnType<typeof sql>[] = [];
    if (body.name !== undefined) sets.push(sql`name = ${String(body.name).trim()}`);
    if (body.description !== undefined) sets.push(sql`description = ${body.description ? String(body.description).slice(0, 500) : null}`);
    if (body.triggerType !== undefined) sets.push(sql`trigger_type = ${body.triggerType}`);
    if (body.templateId !== undefined) sets.push(sql`template_id = ${Number(body.templateId)}`);
    if (body.recipientGroupId !== undefined) sets.push(sql`recipient_group_id = ${body.recipientGroupId ? Number(body.recipientGroupId) : null}`);
    if (body.channel !== undefined) sets.push(sql`channel = ${body.channel}`);
    if (body.delayHours !== undefined) sets.push(sql`delay_hours = ${Number(body.delayHours)}`);
    if (body.cooldownDays !== undefined) sets.push(sql`cooldown_days = ${Number(body.cooldownDays)}`);
    if (body.conditions !== undefined) sets.push(sql`conditions = ${body.conditions ? JSON.stringify(body.conditions) : null}`);

    if (sets.length === 0) {
      return new Response(JSON.stringify({ ok: true, message: "변경 사항 없음" }),
        { status: 200, headers: { "Content-Type": "application/json" } });
    }

    sets.push(sql`updated_by = ${adminId}`);
    sets.push(sql`updated_at = NOW()`);
    const setClause = sets.reduce((a, b) => sql`${a}, ${b}`);

    await db.execute(sql`UPDATE communication_auto_triggers SET ${setClause} WHERE id = ${id}`);

    return new Response(JSON.stringify({ ok: true, id }),
      { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false, error: "트리거 수정 실패",
        step: "update", detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
