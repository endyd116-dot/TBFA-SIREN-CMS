// lib/communication-auto-trigger.ts
// Phase 10 R4 — 자동 발송 트리거 평가·실행 헬퍼
//
// evaluateTrigger  — 트리거 타입별 발송 대상 후보 추출 + 쿨다운 필터
// executeTrigger   — send_job 생성 + 수신자 스냅샷 INSERT (cron에서 호출)

import { db } from "../db";
import { sql } from "drizzle-orm";
import { generateTrackingToken, injectTrackingIntoHtml } from "./communication-tracking";
import { renderTemplate } from "./template-render";
import { buildMemberRenderData } from "./communication-send";
import { unsubUrl } from "./unsubscribe-token";

const BASE_URL = process.env.SITE_URL || "https://tbfa-siren-cms.netlify.app";

export type TriggerType =
  | "new_member"
  | "donation_complete"
  | "support_approved"
  | "birthday"
  | "anniversary";

export interface TriggerEvalResult {
  /** 발송 대상 회원 ID 목록 (쿨다운 제외 후) */
  memberIds: number[];
  /** 쿨다운으로 제외된 회원 수 */
  skippedByCooldown: number;
}

/* =========================================================
   evaluateTrigger — 타입별 후보 추출 + 쿨다운 체크
   ========================================================= */

export async function evaluateTrigger(trigger: {
  id: number;
  triggerType: TriggerType;
  delayHours: number;
  cooldownDays: number;
  conditions: any;
}): Promise<TriggerEvalResult> {
  const rawCandidates = await getCandidates(trigger);

  if (rawCandidates.length === 0) {
    return { memberIds: [], skippedByCooldown: 0 };
  }

  /* 쿨다운 체크 — auto_trigger_runs에 triggerId+memberId 최근 N일 이내 ok 기록이 있으면 제외 */
  const cooldownCutoff = new Date(Date.now() - trigger.cooldownDays * 24 * 60 * 60 * 1000);

  /* trigger_runs에는 job_id가 있고 수신자 단위 기록이 없으므로, recipients 테이블로 체크 */
  const recentRes: any = await db.execute(sql`
    SELECT DISTINCT r.member_id
      FROM communication_send_recipients r
      JOIN communication_send_jobs j ON j.id = r.job_id
     WHERE r.member_id = ANY(${rawCandidates}::int[])
       AND r.status = 'sent'
       AND r.created_at >= ${cooldownCutoff}
       AND j.id IN (
         SELECT COALESCE(job_id, -1) FROM communication_auto_trigger_runs
          WHERE trigger_id = ${trigger.id}
            AND status = 'ok'
            AND triggered_at >= ${cooldownCutoff}
       )
  `);
  const cooledDown = new Set(
    (recentRes?.rows ?? recentRes ?? []).map((r: any) => r.member_id),
  );

  const eligible = rawCandidates.filter((id) => !cooledDown.has(id));
  return {
    memberIds: eligible,
    skippedByCooldown: rawCandidates.length - eligible.length,
  };
}

/* =========================================================
   getCandidates — 트리거 타입별 DB 조회
   ========================================================= */

async function getCandidates(trigger: {
  triggerType: TriggerType;
  delayHours: number;
  conditions: any;
}): Promise<number[]> {
  const { triggerType, delayHours, conditions } = trigger;

  switch (triggerType) {
    case "new_member": {
      // 가입 후 delayHours 경과된 활성 회원
      const since = new Date(Date.now() - (delayHours + 1) * 60 * 60 * 1000);
      const until = new Date(Date.now() - delayHours * 60 * 60 * 1000);
      const r: any = await db.execute(sql`
        SELECT id FROM members
         WHERE status = 'active'
           AND created_at >= ${since} AND created_at <= ${until}
           AND withdrawn_at IS NULL
      `);
      return (r?.rows ?? r ?? []).map((m: any) => m.id);
    }

    case "donation_complete": {
      // 후원 완료 후 delayHours 경과된 회원 (중복 제거)
      const since = new Date(Date.now() - (delayHours + 1) * 60 * 60 * 1000);
      const until = new Date(Date.now() - delayHours * 60 * 60 * 1000);
      const minAmount = conditions?.minAmount ?? 0;
      const r: any = await db.execute(sql`
        SELECT DISTINCT d.member_id AS id
          FROM donations d
          JOIN members m ON m.id = d.member_id
         WHERE d.status = 'completed'
           AND d.created_at >= ${since} AND d.created_at <= ${until}
           AND d.amount >= ${minAmount}
           AND m.status = 'active'
           AND m.withdrawn_at IS NULL
      `);
      return (r?.rows ?? r ?? []).map((m: any) => m.id);
    }

    case "support_approved": {
      // 지원 승인 후 delayHours 경과된 회원
      const since = new Date(Date.now() - (delayHours + 1) * 60 * 60 * 1000);
      const until = new Date(Date.now() - delayHours * 60 * 60 * 1000);
      const r: any = await db.execute(sql`
        SELECT DISTINCT sa.member_id AS id
          FROM support_applications sa
          JOIN members m ON m.id = sa.member_id
         WHERE sa.status = 'approved'
           AND sa.reviewed_at >= ${since} AND sa.reviewed_at <= ${until}
           AND m.status = 'active'
           AND m.withdrawn_at IS NULL
      `);
      return (r?.rows ?? r ?? []).map((m: any) => m.id);
    }

    case "birthday": {
      // 오늘 생일인 활성 회원
      const r: any = await db.execute(sql`
        SELECT id FROM members
         WHERE status = 'active'
           AND withdrawn_at IS NULL
           AND birth_date IS NOT NULL
           AND TO_CHAR(birth_date, 'MM-DD') = TO_CHAR(NOW(), 'MM-DD')
      `);
      return (r?.rows ?? r ?? []).map((m: any) => m.id);
    }

    case "anniversary": {
      // 정기 후원 시작 기념일 (created_at 기준 같은 월일)
      const r: any = await db.execute(sql`
        SELECT DISTINCT d.member_id AS id
          FROM donations d
          JOIN members m ON m.id = d.member_id
         WHERE d.donation_type = 'regular'
           AND d.status = 'completed'
           AND m.status = 'active'
           AND m.withdrawn_at IS NULL
           AND TO_CHAR(d.created_at, 'MM-DD') = TO_CHAR(NOW(), 'MM-DD')
      `);
      return (r?.rows ?? r ?? []).map((m: any) => m.id);
    }

    default:
      return [];
  }
}

/* =========================================================
   executeTrigger — send_job + recipients INSERT
   ========================================================= */

export async function executeTrigger(trigger: {
  id: number;
  name: string;
  templateId: number;
  channel: string;
}, memberIds: number[], opts?: { unsubscribe?: boolean }): Promise<{ jobId: number | null; error?: string }> {
  if (memberIds.length === 0) {
    return { jobId: null };
  }

  try {
    /* 템플릿 조회 */
    const tplRes: any = await db.execute(sql`
      SELECT id, name, channel, subject, body_template, variables, is_active
        FROM communication_templates WHERE id = ${trigger.templateId} LIMIT 1
    `);
    const template = (tplRes?.rows ?? tplRes ?? [])[0];
    if (!template || !template.is_active) {
      return { jobId: null, error: `템플릿 없음 또는 비활성 (id=${trigger.templateId})` };
    }

    /* send_job INSERT */
    const jobInsRes: any = await db.execute(sql`
      INSERT INTO communication_send_jobs
        (name, template_id, recipient_group_id, channel, schedule_type, scheduled_at,
         status, total_recipients, started_at, created_at, updated_at)
      VALUES
        (${`[자동] ${trigger.name}`}, ${trigger.templateId}, NULL, ${trigger.channel},
         'now', NOW(), 'processing', ${memberIds.length}, NOW(), NOW(), NOW())
      RETURNING id
    `);
    const jobId: number = ((jobInsRes?.rows ?? jobInsRes)[0] ?? {}).id;
    if (!jobId) throw new Error("send_job INSERT 후 id 반환 없음");

    /* 회원 정보 조회 */
    const membersRes: any = await db.execute(sql`
      SELECT id, name, email, phone FROM members WHERE id = ANY(${memberIds}::int[])
    `);
    const memberRows = membersRes?.rows ?? membersRes ?? [];
    const memberMap = new Map<number, any>();
    for (const m of memberRows) memberMap.set(m.id, m);

    const variables = Array.isArray(template.variables) ? template.variables : [];
    const channel = trigger.channel;

    /* 수신자 스냅샷 INSERT (500건씩) */
    const INSERT_BATCH = 500;
    for (let i = 0; i < memberIds.length; i += INSERT_BATCH) {
      const batch = memberIds.slice(i, i + INSERT_BATCH);
      const fragments: ReturnType<typeof sql>[] = [];
      for (const mid of batch) {
        const member = memberMap.get(mid) || { id: mid, name: "", email: "", phone: "" };
        const data = buildMemberRenderData({
          id: member.id, name: member.name, email: member.email, phone: member.phone,
        });
        const subjectStr = template.subject
          ? renderTemplate(template.subject, variables, data).rendered
          : null;
        let bodyStr = renderTemplate(template.body_template, variables, data).rendered;

        const trackingToken = generateTrackingToken();
        if (channel === "email") {
          bodyStr = injectTrackingIntoHtml(bodyStr, trackingToken, BASE_URL);
        }
        /* ★ 2026-06-26: 너처링 등 마케팅 발송엔 수신거부 링크 자동 삽입(정보통신망법·재동의 가능). */
        if (opts?.unsubscribe && (channel === "email" || channel === "sms" || channel === "kakao")) {
          const link = unsubUrl(BASE_URL, Number(mid), channel);
          if (channel === "email") {
            bodyStr += `<div style="margin-top:24px;padding-top:12px;border-top:1px solid #eee;font-size:11px;color:#9aa0a8;text-align:center">교사유가족협의회 · 더 이상 받지 않으시려면 <a href="${link}" style="color:#9aa0a8">수신거부</a> (실수로 누르셔도 같은 화면에서 다시 받기 가능)</div>`;
          } else {
            bodyStr += `\n\n[무료수신거부] ${link}`;
          }
        }
        fragments.push(
          sql`(${jobId}, ${mid}, ${channel}, 'pending', ${subjectStr}, ${bodyStr}, ${trackingToken})`
        );
      }
      const joined = fragments.reduce((a, b, idx) => (idx === 0 ? b : sql`${a}, ${b}`));
      await db.execute(sql`
        INSERT INTO communication_send_recipients
          (job_id, member_id, channel, status, rendered_subject, rendered_body, tracking_token)
        VALUES ${joined}
      `);
    }

    return { jobId };
  } catch (err: any) {
    return { jobId: null, error: String(err?.message || err).slice(0, 500) };
  }
}
