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

import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import { NotifyEvent, EVENT_CHANNEL_POLICY, FORCED_CHANNELS } from "../../lib/notify-events";
import { buildEmailContent } from "../../lib/notify-adapters/email";
import { buildSmsContent } from "../../lib/notify-adapters/sms-aligo";
import { enrichKakaoParams, fallbackBodyKakao } from "../../lib/notify-adapters/kakao-aligo";

export const config = { path: "/api/admin-system-notification-list" };

/* 이벤트별 미리보기용 sample params — 코드 하드코딩 본문이 어떻게 발송되는지 운영자가 확인 */
const SAMPLE_PARAMS: Record<string, Record<string, any>> = {
  "billing.success":            { memberName: "박새로이", amount: 30000, donationId: 123, chargedAt: new Date(), nextChargeAt: new Date(Date.now() + 30*86400000), cardCompany: "신한", cardNumberMasked: "****-****-****-1234", isMember: true },
  "billing.failed":             { memberName: "박새로이", amount: 30000, failureReason: "한도초과", consecutiveFailCount: 1, willRetryAt: new Date(Date.now() + 86400000), isMember: true },
  "billing.canceled":           { memberName: "박새로이", amount: 30000, cancelReason: "3회 연속 실패", title: "정기 후원 자동 해지 안내", message: "결제 실패 누적으로 정기 후원이 자동 해지되었습니다." },
  "card.expiring":              { memberName: "박새로이", cardExpiryMonth: "2612", daysUntilExpiry: 30, daysLeft: 30 },
  "workspace.activity":         { title: "새 댓글이 달렸습니다", message: "작업 카드에 새 댓글이 등록되었습니다." },
  "admin.daily_briefing":       { title: "일일 운영 브리핑", message: "오늘의 신규 후원·회원·신고 요약" },
  "support.reply":              { memberName: "박새로이", title: "심리상담 답변", answerBody: "신청해 주신 상담 일정 안내드립니다." },
  "siren.assigned":             { memberName: "박새로이", title: "사건 신고 담당자 배정", assigneeName: "운영자" },
  "member.eligibility_decided": { memberName: "박새로이", title: "회원 자격 심사 결과", decision: "approved", reason: "유족 자격 확인 완료" },
};

/* 채널별 default 본문 빌더 — DB 템플릿이 없을 때 코드 하드코딩 본문을 호출해서 미리보기 제공 */
function buildDefaultBody(eventType: string, channel: "email" | "sms" | "kakao" | "inapp"): { subject?: string; body: string } | null {
  const params = SAMPLE_PARAMS[eventType] || {};
  const event = eventType as NotifyEvent;
  try {
    if (channel === "email") {
      const tpl = buildEmailContent(event, params);
      if (tpl) return { subject: tpl.subject, body: tpl.html };
    } else if (channel === "sms") {
      const tpl = buildSmsContent(event, params);
      if (tpl) return { body: tpl.msg };
    } else if (channel === "kakao") {
      const enriched = enrichKakaoParams(event, params, String(params.memberName || ""));
      const body = fallbackBodyKakao(event, enriched);
      if (body) return { body };
    } else if (channel === "inapp") {
      const title = String(params.title || event);
      const message = String(params.message || params.answerBody || "");
      return { body: message ? `[${title}]\n${message}` : `[${title}]\n(인앱 알림 본문은 발송 시점에 동적으로 결정됩니다)` };
    }
  } catch {
    /* 어댑터가 sample params로 호출 실패 — 폴백 메시지 */
  }
  return null;
}

const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "GET") {
    return new Response(jsonKST({ ok: false, error: "GET만 허용" }),
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

    /* Q4-020: DB에 설정 row가 없는(시드 안 된) 관리 이벤트도 코드 기본값으로 합성해서 노출.
       이전엔 DB 행만 매핑해 시드 없으면 화면이 완전히 빈 상태가 됐음. */
    const present = new Set(rows.map((r: any) => r.event_type));
    for (const et of Object.keys(SAMPLE_PARAMS)) {
      if (!present.has(et)) {
        rows.push({
          event_type: et,
          display_label: null,
          description: null,
          is_active: true,
          default_channels: (EVENT_CHANNEL_POLICY as any)[et] ?? [],
          forced_channels:  (FORCED_CHANNELS as any)[et] ?? [],
          email_template_id: null, sms_template_id: null, kakao_template_id: null, inapp_template_id: null,
        });
      }
    }
    rows.sort((a: any, b: any) => String(a.event_type).localeCompare(String(b.event_type)));

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
          subject: r.te_subject, body: r.te_body, variables: r.te_vars, isDefault: false,
        } : (() => {
          const d = buildDefaultBody(r.event_type, "email");
          return d ? { templateId: null, name: null, subject: d.subject, body: d.body, variables: [], isDefault: true } : null;
        })(),
        sms: r.sms_template_id ? {
          templateId: Number(r.sms_template_id), name: r.ts_name,
          subject: r.ts_subject, body: r.ts_body, variables: r.ts_vars, isDefault: false,
        } : (() => {
          const d = buildDefaultBody(r.event_type, "sms");
          return d ? { templateId: null, name: null, subject: null, body: d.body, variables: [], isDefault: true } : null;
        })(),
        kakao: r.kakao_template_id ? {
          templateId: Number(r.kakao_template_id), name: r.tk_name,
          subject: r.tk_subject, body: r.tk_body, variables: r.tk_vars, isDefault: false,
        } : (() => {
          const d = buildDefaultBody(r.event_type, "kakao");
          return d ? { templateId: null, name: null, subject: null, body: d.body, variables: [], isDefault: true } : null;
        })(),
        inapp: r.inapp_template_id ? {
          templateId: Number(r.inapp_template_id), name: r.ti_name,
          subject: r.ti_subject, body: r.ti_body, variables: r.ti_vars, isDefault: false,
        } : (() => {
          const d = buildDefaultBody(r.event_type, "inapp");
          return d ? { templateId: null, name: null, subject: null, body: d.body, variables: [], isDefault: true } : null;
        })(),
      },
    }));

    return new Response(jsonKST({ ok: true, events }, null, 2),
      { status: 200, headers: JSON_HEADER });
  } catch (e: any) {
    return new Response(jsonKST({
      ok: false, error: "조회 실패", detail: String(e?.message || e).slice(0, 500),
    }), { status: 500, headers: JSON_HEADER });
  }
};
