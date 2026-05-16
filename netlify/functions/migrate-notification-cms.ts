/**
 * 1회용 마이그레이션 — 자동 발송 통합 CMS (B안)
 *
 * 목적:
 *   현재 cron(billing·card-expiry 등)이 dispatch하는 메시지 본문이
 *   lib/email.ts와 lib/notify-adapters/kakao-aligo.ts에 하드코딩 → 운영자
 *   어드민에서 못 고침. 박새로이가 받은 카톡 본문이 그 사례.
 *
 *   이 마이그레이션은:
 *   1) notification_admin_settings 테이블에 컬럼 6개 추가
 *      (채널별 templateId 4개 + isActive + displayLabel/description)
 *   2) 9개 NotifyEvent 시드 row INSERT (이미 있으면 ON CONFLICT DO UPDATE로
 *      label·description만 갱신, defaultChannels·forcedChannels는 기존 유지)
 *   3) communication_templates에 카카오 알림톡 2건(BILLING_FAILED·CARD_EXPIRING)
 *      본문 시드 INSERT — 박새로이 사례가 어드민에서 수정 가능해짐
 *   4) 시드된 카카오 템플릿 id를 notification_admin_settings.kakao_template_id에 연결
 *
 *   이메일·인앱·SMS 본문은 다음 단계에서 어댑터 리팩토링과 함께 점진
 *   추가. 그때까지 어댑터는 templateId가 NULL이면 기존 코드 함수로 폴백.
 *
 * GET           : 진단 (인증 불필요)
 * GET ?run=1    : 어드민 인증 후 실행 (멱등 — IF NOT EXISTS, ON CONFLICT)
 */

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-notification-cms" };

const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

/* 9개 NotifyEvent 시드 — [eventType, defaultChannels, forcedChannels, displayLabel, description] */
const EVENT_SEEDS: Array<[string, string[], string[], string, string]> = [
  ["billing.success",            ["inapp", "email"],                    [],                   "정기 결제 성공",                  "매월 약정일에 정기 후원 결제가 성공했을 때 회원에게 발송"],
  ["billing.failed",             ["inapp", "email", "sms", "kakao"],    ["inapp", "email"],   "정기 결제 실패",                  "정기 후원 자동 결제가 실패했을 때 회원에게 발송 (예: 한도초과)"],
  ["billing.canceled",           ["inapp", "email"],                    [],                   "정기 후원 자동 해지",             "결제 3회 연속 실패로 정기 후원이 자동 해지될 때 발송"],
  ["card.expiring",              ["inapp", "email", "sms", "kakao"],    ["inapp", "email"],   "등록 카드 만료 임박",             "정기 후원 등록 카드 만료 30일·14일 전 안내"],
  ["workspace.activity",         ["inapp"],                             [],                   "워크스페이스 활동 알림",          "작업 카드·댓글·멘션 등 어드민 워크스페이스 활동 인앱 알림"],
  ["admin.daily_briefing",       ["email"],                             [],                   "관리자 일일 브리핑",              "매일 새벽 관리자에게 보내는 운영 일일 요약 이메일"],
  ["support.reply",              ["inapp", "email"],                    [],                   "유족 지원 답변",                  "심리상담·법률·장학 신청에 운영자가 답변을 등록했을 때 회원에게 발송"],
  ["siren.assigned",             ["inapp", "email"],                    [],                   "SIREN 신고 담당자 배정",          "사건·악성민원·법률 신고에 담당 운영자가 배정되었을 때 회원에게 발송"],
  ["member.eligibility_decided", ["inapp", "email"],                    [],                   "회원 자격 심사 결과",             "유족·교사 자격 심사 승인·반려 결과 발송"],
];

/* 카카오 알림톡 본문 시드 — 박새로이가 받은 메시지 그대로, Handlebars 변수로 추출.
   카카오 심사 통과 본문과 정확히 일치해야 발송됨 (운영자 수정 시 카카오 콘솔 재심사 필요). */
const KAKAO_TEMPLATES = [
  {
    eventType: "billing.failed",
    name: "정기 결제 실패 안내 (카카오)",
    subject: null,
    bodyTemplate: `[교사유가족협의회] {{name}}님, 이번 달 후원 결제 안내드려요

{{name}}님, 안녕하세요.
교사유가족협의회입니다.

이번 달 보내주시기로 한 정기 후원 {{amountFmt}}원이
안타깝게도 결제되지 못했어요.

▪ 사유: {{failureReason}}
▪ 연속 실패: {{failCount}}회
▪ 다음 시도일: {{retryStr}}

카드 한도와 잔액, 카드 정보를
한 번만 살펴봐 주시면 좋겠습니다.

{{name}}님의 따뜻한 마음이
유가족 곁에 끊김 없이 닿을 수 있도록
[후원 정보 확인] 버튼으로 잠시 점검해 주세요.

언제나 함께해 주셔서 진심으로 감사드립니다.`,
    variables: [
      { name: "name", description: "회원 이름", example: "박새로이" },
      { name: "amountFmt", description: "결제 금액 (천 단위 콤마 포함)", example: "30,000" },
      { name: "failureReason", description: "결제 실패 사유", example: "한도초과" },
      { name: "failCount", description: "연속 실패 횟수", example: "1" },
      { name: "retryStr", description: "다음 재시도 일자 (YYYY-MM-DD)", example: "2026-05-22" },
    ],
  },
  {
    eventType: "card.expiring",
    name: "등록 카드 만료 임박 안내 (카카오)",
    subject: null,
    bodyTemplate: `[교사유가족협의회] {{name}}님, 등록 카드 만료가 {{daysUntilExpiry}}일 남았어요

{{name}}님, 안녕하세요.
교사유가족협의회입니다.

정기 후원에 등록해 주신 카드의
만료일이 가까워졌습니다.

▪ 카드 만료일: {{cardExpiryStr}}
▪ 잔여 일수: {{daysUntilExpiry}}일

만료 전에 새 카드 정보로 갱신해 주시면
{{name}}님께서 보내주시는 마음이
유가족 곁에 끊김 없이 계속 닿을 수 있어요.

[카드 정보 갱신] 버튼으로 잠깐만 시간 내 주세요.

오늘도 함께해 주셔서 진심으로 감사드립니다.`,
    variables: [
      { name: "name", description: "회원 이름", example: "박새로이" },
      { name: "cardExpiryStr", description: "카드 만료일 (YYYY-MM)", example: "2026-12" },
      { name: "daysUntilExpiry", description: "만료까지 남은 일수", example: "30" },
    ],
  },
];

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);

  if (req.method === "GET" && !url.searchParams.get("run")) {
    return new Response(JSON.stringify({
      ok: true,
      mode: "diagnostic",
      will_alter_table: "notification_admin_settings",
      will_add_columns: [
        "email_template_id (bigint, FK)",
        "sms_template_id (bigint, FK)",
        "kakao_template_id (bigint, FK)",
        "inapp_template_id (bigint, FK)",
        "is_active (boolean, default true)",
        "display_label (text)",
        "description (text)",
      ],
      will_seed_events: EVENT_SEEDS.length,
      will_seed_kakao_templates: KAKAO_TEMPLATES.length,
      note: "GET ?run=1 로 어드민 인증 후 실제 적용",
    }, null, 2), { status: 200, headers: JSON_HEADER });
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  const results: { step: string; result: string }[] = [];
  async function run(step: string, fn: () => Promise<void>) {
    try {
      await fn();
      results.push({ step, result: "ok" });
    } catch (e: any) {
      results.push({ step, result: `error: ${String(e?.message || e).slice(0, 300)}` });
    }
  }

  /* 1) notification_admin_settings에 컬럼 7개 추가 (IF NOT EXISTS) */
  await run("alter_table_add_columns", async () => {
    await db.execute(sql`
      ALTER TABLE notification_admin_settings
        ADD COLUMN IF NOT EXISTS email_template_id  BIGINT REFERENCES communication_templates(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS sms_template_id    BIGINT REFERENCES communication_templates(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS kakao_template_id  BIGINT REFERENCES communication_templates(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS inapp_template_id  BIGINT REFERENCES communication_templates(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS is_active          BOOLEAN NOT NULL DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS display_label      TEXT,
        ADD COLUMN IF NOT EXISTS description        TEXT
    `);
  });

  /* 2) 9개 NotifyEvent 시드 (멱등 — UPSERT) */
  for (const [eventType, defaultChannels, forcedChannels, displayLabel, description] of EVENT_SEEDS) {
    await run(`seed_event:${eventType}`, async () => {
      await db.execute(sql`
        INSERT INTO notification_admin_settings (event_type, default_channels, forced_channels, is_active, display_label, description, updated_at)
        VALUES (${eventType}, ${JSON.stringify(defaultChannels)}::jsonb, ${JSON.stringify(forcedChannels)}::jsonb, TRUE, ${displayLabel}, ${description}, NOW())
        ON CONFLICT (event_type) DO UPDATE
          SET display_label = EXCLUDED.display_label,
              description   = EXCLUDED.description,
              updated_at    = NOW()
      `);
    });
  }

  /* 3) 카카오 알림톡 본문 시드 INSERT + notification_admin_settings.kakao_template_id 연결 */
  for (const t of KAKAO_TEMPLATES) {
    await run(`seed_kakao_template:${t.eventType}`, async () => {
      /* 이미 같은 name+channel='kakao'+category='system_notification'로 있는지 확인 (멱등) */
      const existing: any = await db.execute(sql`
        SELECT id FROM communication_templates
         WHERE name = ${t.name} AND channel = 'kakao' AND category = 'system_notification'
         LIMIT 1
      `);
      const rows = existing?.rows ?? existing ?? [];
      let templateId: number;
      if (rows.length > 0) {
        templateId = Number(rows[0].id);
      } else {
        const inserted: any = await db.execute(sql`
          INSERT INTO communication_templates (name, channel, category, subject, body_template, variables, is_active, created_at, updated_at)
          VALUES (${t.name}, 'kakao', 'system_notification', ${t.subject}, ${t.bodyTemplate}, ${JSON.stringify(t.variables)}::jsonb, TRUE, NOW(), NOW())
          RETURNING id
        `);
        const insertedRows = inserted?.rows ?? inserted ?? [];
        templateId = Number(insertedRows[0].id);
      }

      /* notification_admin_settings.kakao_template_id 연결 (이미 같은 값이면 no-op) */
      await db.execute(sql`
        UPDATE notification_admin_settings
           SET kakao_template_id = ${templateId}, updated_at = NOW()
         WHERE event_type = ${t.eventType}
      `);
    });
  }

  /* 결과 요약 */
  const ok = results.every(r => r.result === "ok");
  return new Response(JSON.stringify({
    ok,
    applied: results,
    next_steps: ok ? [
      "1) 본 마이그레이션 호출 결과를 메인 채팅에 알려주세요",
      "2) 메인이 schema.ts에 새 컬럼 정의 활성화 + 디스패처·어댑터 리팩토링 진행",
      "3) 마이그레이션 파일은 다음 push에 삭제됨",
    ] : ["오류 항목을 메인 채팅에 보고해주세요"],
  }, null, 2), { status: ok ? 200 : 500, headers: JSON_HEADER });
};
