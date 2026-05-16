/**
 * GET /api/admin-system-notification-list
 *
 * 자동 발송 통합 CMS — 9개 NotifyEvent별 설정 + 각 채널 템플릿 본문 일괄 조회.
 *
 * 응답: { ok, events: [{ eventType, displayLabel, description, isActive,
 *           defaultChannels, forcedChannels,
 *           channels: { email: {templateId, name, subject, body, variables} | null,
 *                       sms:   ..., kakao: ..., inapp: ... } }] }
 */

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/admin-system-notification-list" };

const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ ok: false, error: "GET만 허용" }),
      { status: 405, headers: JSON_HEADER });
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  try {
    /* 9개 이벤트 설정 + 채널별 템플릿 4개 LEFT JOIN — 한 쿼리로 일괄 */
    const res: any = await db.execute(sql`
      SELECT
        s.event_type,
        s.display_label,
        s.description,
        s.is_active,
        s.default_channels,
        s.forced_channels,
        s.email_template_id, te.name AS te_name, te.subject AS te_subject, te.body_template AS te_body, te.variables AS te_vars,
        s.sms_template_id,   ts.name AS ts_name, ts.subject AS ts_subject, ts.body_template AS ts_body, ts.variables AS ts_vars,
        s.kakao_template_id, tk.name AS tk_name, tk.subject AS tk_subject, tk.body_template AS tk_body, tk.variables AS tk_vars,
        s.inapp_template_id, ti.name AS ti_name, ti.subject AS ti_subject, ti.body_template AS ti_body, ti.variables AS ti_vars
      FROM notification_admin_settings s
      LEFT JOIN communication_templates te ON te.id = s.email_template_id
      LEFT JOIN communication_templates ts ON ts.id = s.sms_template_id
      LEFT JOIN communication_templates tk ON tk.id = s.kakao_template_id
      LEFT JOIN communication_templates ti ON ti.id = s.inapp_template_id
      ORDER BY s.event_type ASC
    `);
    const rows = res?.rows ?? res ?? [];

    const events = rows.map((r: any) => ({
      eventType:       r.event_type,
      displayLabel:    r.display_label || r.event_type,
      description:     r.description || "",
      isActive:        r.is_active !== false,
      defaultChannels: r.default_channels || [],
      forcedChannels:  r.forced_channels  || [],
      channels: {
        email: r.email_template_id ? {
          templateId: Number(r.email_template_id), name: r.te_name,
          subject: r.te_subject, body: r.te_body, variables: r.te_vars,
        } : null,
        sms: r.sms_template_id ? {
          templateId: Number(r.sms_template_id), name: r.ts_name,
          subject: r.ts_subject, body: r.ts_body, variables: r.ts_vars,
        } : null,
        kakao: r.kakao_template_id ? {
          templateId: Number(r.kakao_template_id), name: r.tk_name,
          subject: r.tk_subject, body: r.tk_body, variables: r.tk_vars,
        } : null,
        inapp: r.inapp_template_id ? {
          templateId: Number(r.inapp_template_id), name: r.ti_name,
          subject: r.ti_subject, body: r.ti_body, variables: r.ti_vars,
        } : null,
      },
    }));

    return new Response(JSON.stringify({ ok: true, events }, null, 2),
      { status: 200, headers: JSON_HEADER });
  } catch (e: any) {
    return new Response(JSON.stringify({
      ok: false, error: "조회 실패", detail: String(e?.message || e).slice(0, 500),
    }), { status: 500, headers: JSON_HEADER });
  }
};
