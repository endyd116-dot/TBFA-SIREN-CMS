// netlify/functions/admin-auto-trigger-create.ts
// Phase 10 R4 — 자동 트리거 신규 등록 (어드민)
//
// POST body: { name, description?, triggerType, templateId, recipientGroupId?,
//              channel, delayHours?, cooldownDays?, conditions? }

import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-auto-trigger-create" };

const VALID_TRIGGER_TYPES = ["new_member","donation_complete","support_approved","birthday","anniversary"];
const VALID_CHANNELS = ["email","sms","kakao","inapp"];

export default async function handler(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "POST만 허용" }),
      { status: 405, headers: { "Content-Type": "application/json" } });
  }

  let body: any;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ ok: false, error: "JSON 파싱 실패" }),
      { status: 400, headers: { "Content-Type": "application/json" } });
  }

  /* 검증 */
  const errors: string[] = [];
  const name = String(body?.name || "").trim();
  if (!name || name.length > 200) errors.push("name은 1~200자 필수");
  const triggerType = String(body?.triggerType || "");
  if (!VALID_TRIGGER_TYPES.includes(triggerType)) errors.push(`triggerType은 ${VALID_TRIGGER_TYPES.join("|")} 중 하나`);
  const templateId = Number(body?.templateId);
  if (!templateId || isNaN(templateId)) errors.push("templateId 필수");
  const channel = String(body?.channel || "");
  if (!VALID_CHANNELS.includes(channel)) errors.push(`channel은 ${VALID_CHANNELS.join("|")} 중 하나`);
  const delayHours = Number(body?.delayHours ?? 0);
  const cooldownDays = Number(body?.cooldownDays ?? 30);

  if (errors.length > 0) {
    return new Response(JSON.stringify({ ok: false, error: errors.join(", ") }),
      { status: 400, headers: { "Content-Type": "application/json" } });
  }

  try {
    /* 템플릿 존재 확인 */
    const tplRes: any = await db.execute(sql`
      SELECT id, is_active FROM communication_templates WHERE id = ${templateId} LIMIT 1
    `);
    const tpl = (tplRes?.rows ?? tplRes ?? [])[0];
    if (!tpl) return new Response(JSON.stringify({ ok: false, error: "존재하지 않는 템플릿입니다" }),
      { status: 400, headers: { "Content-Type": "application/json" } });
    if (!tpl.is_active) return new Response(JSON.stringify({ ok: false, error: "비활성 템플릿입니다" }),
      { status: 400, headers: { "Content-Type": "application/json" } });

    const recipientGroupId = body?.recipientGroupId ? Number(body.recipientGroupId) : null;
    const description = body?.description ? String(body.description).slice(0, 500) : null;
    const conditions = body?.conditions ?? null;
    const adminId = auth.ctx.admin.uid;

    const insRes: any = await db.execute(sql`
      INSERT INTO communication_auto_triggers
        (name, description, trigger_type, template_id, recipient_group_id,
         channel, delay_hours, cooldown_days, conditions, is_active,
         created_by, updated_by, created_at, updated_at)
      VALUES
        (${name}, ${description}, ${triggerType}, ${templateId}, ${recipientGroupId},
         ${channel}, ${delayHours}, ${cooldownDays}, ${conditions ? JSON.stringify(conditions) : null},
         true, ${adminId}, ${adminId}, NOW(), NOW())
      RETURNING id
    `);
    const newId = ((insRes?.rows ?? insRes)[0] ?? {}).id;

    return new Response(
      JSON.stringify({ ok: true, id: newId }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false, error: "트리거 등록 실패",
        step: "insert", detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
