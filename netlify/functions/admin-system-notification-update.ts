/**
 * PATCH /api/admin-system-notification-update
 *
 * 자동 발송 통합 CMS — 이벤트별 설정·채널별 본문 부분 업데이트.
 *
 * 요청 body:
 * {
 *   eventType: "billing.failed",          // 필수
 *   isActive?: boolean,                   // 이벤트 자체 on/off
 *   defaultChannels?: string[],           // ["inapp","email"]
 *   forcedChannels?: string[],            // []
 *   channelBody?: {                       // 채널별 본문 수정 — 채널당 1개씩
 *     email?: { subject?: string, body: string, variables?: any },
 *     sms?:   { body: string, variables?: any },
 *     kakao?: { body: string, variables?: any },
 *     inapp?: { body: string, variables?: any },
 *   }
 * }
 *
 * 동작:
 *   - isActive·defaultChannels·forcedChannels는 notification_admin_settings UPDATE
 *   - channelBody.{channel} 있으면:
 *       기존 templateId 있으면 communication_templates UPDATE
 *       기존 templateId 없으면 새 row INSERT 후 notification_admin_settings에 연결
 *   - 카카오 본문 수정 시 응답에 카카오 콘솔 재심사 안내 메시지 포함
 */

import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/admin-system-notification-update" };

const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };
const VALID_CHANNELS = ["email", "sms", "kakao", "inapp"] as const;
/* Q4-037: 채널→템플릿 컬럼 고정 매핑 — sql.raw로 컬럼명 동적 삽입하던 패턴 제거 */
const TEMPLATE_COL = {
  email: sql`email_template_id`,
  sms:   sql`sms_template_id`,
  kakao: sql`kakao_template_id`,
  inapp: sql`inapp_template_id`,
} as const;

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "PATCH" && req.method !== "POST") {
    return new Response(jsonKST({ ok: false, error: "PATCH 또는 POST" }),
      { status: 405, headers: JSON_HEADER });
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;
  const adminId = (auth as any).ctx?.admin?.uid ?? null;

  let body: any = {};
  try { body = await req.json(); } catch {
    return new Response(jsonKST({ ok: false, error: "JSON 파싱 실패" }),
      { status: 400, headers: JSON_HEADER });
  }

  const eventType = String(body?.eventType || "").trim();
  if (!eventType) {
    return new Response(jsonKST({ ok: false, error: "eventType 필수" }),
      { status: 400, headers: JSON_HEADER });
  }

  /* 현재 row 존재 확인 */
  const cur: any = await db.execute(sql`
    SELECT event_type, email_template_id, sms_template_id, kakao_template_id, inapp_template_id
      FROM notification_admin_settings WHERE event_type = ${eventType} LIMIT 1
  `);
  const curRows = cur?.rows ?? cur ?? [];
  if (curRows.length === 0) {
    return new Response(jsonKST({ ok: false, error: `이벤트 ${eventType} 없음` }),
      { status: 404, headers: JSON_HEADER });
  }
  const setting = curRows[0];

  const updates: string[] = [];
  const warnings: string[] = [];

  /* 1) 이벤트별 isActive·defaultChannels·forcedChannels */
  const settingValues: any = {};
  if (typeof body.isActive === "boolean") {
    settingValues.isActive = body.isActive;
  }
  if (Array.isArray(body.defaultChannels)) {
    const ch = body.defaultChannels.filter((c: any) => VALID_CHANNELS.includes(c));
    settingValues.defaultChannels = ch;
  }
  if (Array.isArray(body.forcedChannels)) {
    const ch = body.forcedChannels.filter((c: any) => VALID_CHANNELS.includes(c));
    settingValues.forcedChannels = ch;
  }

  if (settingValues.defaultChannels !== undefined || settingValues.forcedChannels !== undefined || settingValues.isActive !== undefined) {
    try {
      await db.execute(sql`
        UPDATE notification_admin_settings SET
          is_active        = COALESCE(${settingValues.isActive ?? null}::boolean, is_active),
          default_channels = COALESCE(${settingValues.defaultChannels !== undefined ? JSON.stringify(settingValues.defaultChannels) : null}::jsonb, default_channels),
          forced_channels  = COALESCE(${settingValues.forcedChannels !== undefined ? JSON.stringify(settingValues.forcedChannels) : null}::jsonb, forced_channels),
          updated_by       = ${adminId},
          updated_at       = NOW()
        WHERE event_type = ${eventType}
      `);
      updates.push("setting_updated");
    } catch (e: any) {
      return new Response(jsonKST({
        ok: false, error: "설정 업데이트 실패", detail: String(e?.message || e).slice(0, 300),
      }), { status: 500, headers: JSON_HEADER });
    }
  }

  /* 2) 채널별 본문 수정 */
  if (body.channelBody && typeof body.channelBody === "object") {
    for (const ch of VALID_CHANNELS) {
      const cb = body.channelBody[ch];
      if (!cb || typeof cb.body !== "string") continue;

      const existingTemplateId = setting[`${ch}_template_id`];
      const variables = Array.isArray(cb.variables) ? cb.variables : [];

      try {
        if (existingTemplateId) {
          /* 기존 템플릿 UPDATE */
          await db.execute(sql`
            UPDATE communication_templates SET
              subject       = ${cb.subject ?? null},
              body_template = ${cb.body},
              variables     = ${JSON.stringify(variables)}::jsonb,
              updated_by    = ${adminId},
              updated_at    = NOW()
            WHERE id = ${Number(existingTemplateId)}
          `);
          updates.push(`${ch}_updated`);
        } else {
          /* 새 템플릿 INSERT + notification_admin_settings에 연결 */
          const inserted: any = await db.execute(sql`
            INSERT INTO communication_templates (name, channel, category, subject, body_template, variables, is_active, created_by, updated_by, created_at, updated_at)
            VALUES (${`${eventType} (${ch})`}, ${ch}, 'system_notification', ${cb.subject ?? null}, ${cb.body}, ${JSON.stringify(variables)}::jsonb, TRUE, ${adminId}, ${adminId}, NOW(), NOW())
            RETURNING id
          `);
          const newId = Number((inserted?.rows ?? inserted ?? [])[0]?.id);
          await db.execute(sql`
            UPDATE notification_admin_settings SET ${TEMPLATE_COL[ch]} = ${newId}, updated_at = NOW()
             WHERE event_type = ${eventType}
          `);
          updates.push(`${ch}_created_${newId}`);
        }

        if (ch === "kakao") {
          warnings.push("카카오 알림톡 본문을 수정하셨습니다. 카카오 비즈 채널 콘솔에서 새 본문으로 템플릿 재심사를 신청해야 실제 발송됩니다.");
        }
      } catch (e: any) {
        warnings.push(`${ch} 채널 본문 저장 실패: ${String(e?.message || e).slice(0, 200)}`);
      }
    }
  }

  return new Response(jsonKST({ ok: true, eventType, updates, warnings }, null, 2),
    { status: 200, headers: JSON_HEADER });
};
