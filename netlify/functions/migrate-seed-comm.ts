/**
 * 1회용 마이그레이션 — 알림·발송 영역 시드 데이터 5+5+5
 *  - 발송 템플릿 5개 (이메일·SMS·카카오·인앱·AI 트리거)
 *  - 수신자 그룹 5개 (정기·예비·통합·효성·신규)
 *  - 자동 트리거 5개 (신규·생일·기념일·이탈·캠페인 부진)
 *
 * 멱등: name 또는 (template_id, trigger_type) 기준으로 이미 있으면 스킵.
 *
 * GET ?run=1 : 어드민 인증 후 실행
 * GET 만     : 진단 모드
 */

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-seed-comm" };

const TEMPLATES = [
  {
    name: "월간 뉴스레터 — 이메일",
    channel: "email",
    category: "newsletter",
    subject: "[교사유가족협의회] {{memberName}}님께 드리는 이번 달 소식",
    bodyTemplate:
      "안녕하세요 {{memberName}}님,\n\n" +
      "교사유가족협의회의 이번 달 활동 소식을 전해드립니다.\n\n" +
      "1) 이번 달 주요 활동\n2) 후원 사용 내역 공개\n3) 다가오는 행사 안내\n\n" +
      "함께해 주셔서 감사합니다.\n\n— 교사유가족협의회",
    variables: [{ key: "memberName", label: "회원 이름", sample: "홍길동" }],
  },
  {
    name: "후원 감사 — SMS",
    channel: "sms",
    category: "announcement",
    subject: null,
    bodyTemplate:
      "[교사유가족협의회] {{memberName}}님, {{amount}}원 후원해 주셔서 감사합니다. 영수증은 마이페이지에서 확인하실 수 있습니다.",
    variables: [
      { key: "memberName", label: "회원 이름", sample: "홍길동" },
      { key: "amount", label: "후원 금액", sample: "30,000" },
    ],
  },
  {
    name: "캠페인 안내 — 카카오 알림톡",
    channel: "kakao",
    category: "campaign",
    subject: null,
    bodyTemplate:
      "[교사유가족협의회] {{memberName}}님, 새 캠페인 ‘{{campaignName}}’이 시작되었습니다. 자세한 내용은 홈페이지에서 확인해 주세요.",
    variables: [
      { key: "memberName", label: "회원 이름", sample: "홍길동" },
      { key: "campaignName", label: "캠페인명", sample: "2026 봄 캠페인" },
    ],
  },
  {
    name: "공지사항 — 앱 알림 (인앱)",
    channel: "inapp",
    category: "system",
    subject: "📢 새로운 공지사항이 있습니다",
    bodyTemplate:
      "{{memberName}}님, 협의회의 중요한 공지사항이 등록되었습니다. 마이페이지에서 자세한 내용을 확인해 주세요.",
    variables: [{ key: "memberName", label: "회원 이름", sample: "홍길동" }],
  },
  {
    name: "신규 가입 환영 — 이메일 (AI 트리거)",
    channel: "email",
    category: "auto_trigger",
    subject: "[교사유가족협의회] {{memberName}}님, 환영합니다",
    bodyTemplate:
      "{{memberName}}님,\n\n교사유가족협의회 회원으로 가입해 주셔서 감사합니다.\n\n" +
      "협의회는 교사 유가족의 존엄한 기억과 투명한 동행을 위해 활동하고 있습니다.\n" +
      "후원·자원봉사·법률 지원 등 다양한 방식으로 함께해 주실 수 있습니다.\n\n" +
      "궁금한 점은 언제든지 문의해 주세요.\n\n— 교사유가족협의회",
    variables: [{ key: "memberName", label: "회원 이름", sample: "홍길동" }],
  },
];

const GROUPS = [
  {
    name: "정기 후원자 전체",
    description: "donor_type = regular 인 모든 회원 (효성·토스 채널 무관)",
    criteria: { type: "filter", logic: "and",
      filters: [
        { field: "donorType", op: "eq", value: "regular" },
        { field: "status",    op: "eq", value: "active" },
      ],
    },
  },
  {
    name: "예비 후원자 (일시·중단)",
    description: "donor_type = prospect — 정기는 아니지만 일시 후원 또는 중단",
    criteria: { type: "filter", logic: "and",
      filters: [
        { field: "donorType", op: "eq", value: "prospect" },
        { field: "status",    op: "eq", value: "active" },
      ],
    },
  },
  {
    name: "효성 CMS+ 정기 후원자",
    description: "효성 채널로 정기 후원 중인 회원",
    criteria: { type: "filter", logic: "and",
      filters: [
        { field: "donorType",     op: "eq", value: "regular" },
        { field: "donorChannels", op: "eq", value: "hyosung" },
        { field: "status",        op: "eq", value: "active" },
      ],
    },
  },
  {
    name: "토스 빌링 정기 후원자",
    description: "토스 자동 빌링으로 정기 후원 중인 회원",
    criteria: { type: "filter", logic: "and",
      filters: [
        { field: "donorType",     op: "eq", value: "regular" },
        { field: "donorChannels", op: "eq", value: "toss" },
        { field: "status",        op: "eq", value: "active" },
      ],
    },
  },
  {
    name: "유가족 회원 전체",
    description: "type = family 인 모든 활성 회원 (유가족 지원 안내용)",
    criteria: { type: "filter", logic: "and",
      filters: [
        { field: "type",   op: "eq", value: "family" },
        { field: "status", op: "eq", value: "active" },
      ],
    },
  },
];

const TRIGGERS = [
  {
    name: "신규 가입 환영",
    description: "회원 가입 후 즉시 환영 메시지 자동 발송",
    triggerType: "new_member",
    channel: "email",
    cooldownDays: 0,
    conditions: { days_after_signup: 0 },
    templateName: "신규 가입 환영 — 이메일 (AI 트리거)",
    groupName: null,
  },
  {
    name: "생일 축하",
    description: "회원 생일 당일 자동 발송 (인앱)",
    triggerType: "birthday",
    channel: "inapp",
    cooldownDays: 365,
    conditions: {},
    templateName: "공지사항 — 앱 알림 (인앱)",
    groupName: null,
  },
  {
    name: "후원 1주년 기념 SMS",
    description: "정기 후원 1년 기념 자동 SMS 발송",
    triggerType: "anniversary",
    channel: "sms",
    cooldownDays: 365,
    conditions: { every_months: 12 },
    templateName: "후원 감사 — SMS",
    groupName: "정기 후원자 전체",
  },
  {
    name: "이탈 위험 후원자 재유치 이메일",
    description: "이탈 위험 점수가 70 이상인 후원자에게 자동 발송",
    triggerType: "churn_risk",
    channel: "email",
    cooldownDays: 30,
    conditions: { min_score: 70, max_score: 100, min_days_inactive: 60 },
    templateName: "월간 뉴스레터 — 이메일",
    groupName: "예비 후원자 (일시·중단)",
  },
  {
    name: "캠페인 부진 시 카카오 안내",
    description: "캠페인 목표 달성률이 낮으면 카카오 알림톡 자동 발송",
    triggerType: "campaign_slump",
    channel: "kakao",
    cooldownDays: 14,
    conditions: { threshold_percent: 50 },
    templateName: "캠페인 안내 — 카카오 알림톡",
    groupName: "정기 후원자 전체",
  },
];

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  if (req.method === "GET" && !url.searchParams.get("run")) {
    return new Response(JSON.stringify({
      ok: true, mode: "diagnostic",
      templates: TEMPLATES.length,
      groups: GROUPS.length,
      triggers: TRIGGERS.length,
    }), { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } });
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;
  const adminId = (auth as any).ctx?.admin?.uid ?? null;

  const results: { kind: string; name: string; result: string; id?: number }[] = [];

  /* 1) 템플릿 INSERT */
  const tplIdMap = new Map<string, number>();
  for (const t of TEMPLATES) {
    try {
      /* 이미 같은 name 있으면 스킵 */
      const exist: any = await db.execute(
        sql`SELECT id FROM communication_templates WHERE name = ${t.name} LIMIT 1`
      );
      const ex = (exist?.rows ?? exist ?? [])[0];
      if (ex) {
        tplIdMap.set(t.name, Number(ex.id));
        results.push({ kind: "template", name: t.name, result: "exists", id: Number(ex.id) });
        continue;
      }
      const r: any = await db.execute(sql`
        INSERT INTO communication_templates
          (name, channel, category, subject, body_template, variables, is_active, created_by)
        VALUES
          (${t.name}, ${t.channel}, ${t.category}, ${t.subject},
           ${t.bodyTemplate}, ${JSON.stringify(t.variables)}::jsonb, true, ${adminId})
        RETURNING id
      `);
      const newId = Number((r?.rows ?? r ?? [])[0]?.id);
      tplIdMap.set(t.name, newId);
      results.push({ kind: "template", name: t.name, result: "ok", id: newId });
    } catch (e: any) {
      results.push({ kind: "template", name: t.name, result: String(e?.message).slice(0, 200) });
    }
  }

  /* 2) 그룹 INSERT */
  const grpIdMap = new Map<string, number>();
  for (const g of GROUPS) {
    try {
      const exist: any = await db.execute(
        sql`SELECT id FROM recipient_groups WHERE name = ${g.name} LIMIT 1`
      );
      const ex = (exist?.rows ?? exist ?? [])[0];
      if (ex) {
        grpIdMap.set(g.name, Number(ex.id));
        results.push({ kind: "group", name: g.name, result: "exists", id: Number(ex.id) });
        continue;
      }
      const r: any = await db.execute(sql`
        INSERT INTO recipient_groups
          (name, description, criteria, is_active, created_by)
        VALUES
          (${g.name}, ${g.description},
           ${JSON.stringify(g.criteria)}::jsonb, true, ${adminId})
        RETURNING id
      `);
      const newId = Number((r?.rows ?? r ?? [])[0]?.id);
      grpIdMap.set(g.name, newId);
      results.push({ kind: "group", name: g.name, result: "ok", id: newId });
    } catch (e: any) {
      results.push({ kind: "group", name: g.name, result: String(e?.message).slice(0, 200) });
    }
  }

  /* 3) 트리거 INSERT (템플릿·그룹 ID 참조) */
  for (const t of TRIGGERS) {
    try {
      const tplId = tplIdMap.get(t.templateName);
      if (!tplId) {
        results.push({ kind: "trigger", name: t.name, result: `템플릿 '${t.templateName}' 없음 — 스킵` });
        continue;
      }
      const grpId = t.groupName ? (grpIdMap.get(t.groupName) ?? null) : null;

      const exist: any = await db.execute(
        sql`SELECT id FROM communication_auto_triggers WHERE name = ${t.name} LIMIT 1`
      );
      const ex = (exist?.rows ?? exist ?? [])[0];
      if (ex) {
        results.push({ kind: "trigger", name: t.name, result: "exists", id: Number(ex.id) });
        continue;
      }
      const r: any = await db.execute(sql`
        INSERT INTO communication_auto_triggers
          (name, description, trigger_type, template_id, recipient_group_id, channel,
           delay_hours, cooldown_days, conditions, is_active, created_by)
        VALUES
          (${t.name}, ${t.description}, ${t.triggerType}, ${tplId}, ${grpId}, ${t.channel},
           0, ${t.cooldownDays}, ${JSON.stringify(t.conditions)}::jsonb, true, ${adminId})
        RETURNING id
      `);
      const newId = Number((r?.rows ?? r ?? [])[0]?.id);
      results.push({ kind: "trigger", name: t.name, result: "ok", id: newId });
    } catch (e: any) {
      results.push({ kind: "trigger", name: t.name, result: String(e?.message).slice(0, 200) });
    }
  }

  return new Response(JSON.stringify({ ok: true, results, summary: {
    templates: TEMPLATES.length, groups: GROUPS.length, triggers: TRIGGERS.length,
  } }, null, 2), { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } });
};
