// netlify/functions/cron-communication-send-dispatcher.ts
// Phase 10 R3 — 발송 큐 디스패처 (1분 단위)
//
// 처리 단계:
//   1단계 — pending 작업 픽업 (scheduledAt <= NOW()): 그룹 resolve → 수신자 스냅샷 INSERT → status='processing'
//   2단계 — processing 작업 chunk 처리: 50건/회 어댑터 호출 → status sent/failed → 카운터 갱신 → 잔여 0이면 'completed'
//   3단계 — cancelled 정리: status='cancelled' 작업의 잔여 수신자 일괄 cancelled
//
// 한도:
//   pending 픽업: 1회당 10개
//   processing 동시 처리: 5개 작업 × 50건 = 250건/min = 시간당 15,000건
//
// 카카오 알림톡은 sendViaAdapter에서 skipped=true 반환 → status='sent'로 기록 (실제 발송 X 표시는 providerMessageId로)

import { sql } from "drizzle-orm";
import { db } from "../../db";
import { resolveRecipients } from "../../lib/recipient-resolve";
import { renderTemplate } from "../../lib/template-render";
import {
  sendViaAdapter,
  buildMemberRenderData,
  type SendChannel,
} from "../../lib/communication-send";
import {
  generateTrackingToken,
  injectTrackingIntoHtml,
} from "../../lib/communication-tracking";

const BASE_URL = process.env.SITE_URL || "https://tbfa-siren-cms.netlify.app";

export const config = { schedule: "* * * * *" };

const PENDING_PICKUP_LIMIT = 10;
const PROCESSING_JOB_LIMIT = 5;
const CHUNK_SIZE = 50;

export default async function handler(_req: Request) {
  const t0 = Date.now();
  const stats = {
    pendingPicked: 0,
    pendingFailed: 0,
    chunksSent: 0,
    chunksFailed: 0,
    cancelledCleaned: 0,
  };

  /* ============================================================
     1단계 — pending 작업 픽업
     ============================================================ */
  try {
    const r: any = await db.execute(sql`
      SELECT j.id, j.template_id, j.recipient_group_id, j.channel, j.name,
             j.subject_override, j.body_override, j.excluded_member_ids
        FROM communication_send_jobs j
       WHERE j.status = 'pending'
         AND (j.scheduled_at IS NULL OR j.scheduled_at <= NOW())
       ORDER BY j.scheduled_at ASC NULLS FIRST, j.id ASC
       LIMIT ${PENDING_PICKUP_LIMIT}
    `);
    const pendingJobs = r?.rows ?? r ?? [];

    for (const job of pendingJobs) {
      try {
        await startJob(job);
        stats.pendingPicked++;
      } catch (err: any) {
        console.error(`[cron-dispatcher] startJob 실패 jobId=${job.id}`, err);
        stats.pendingFailed++;
        try {
          const detail = String(err?.message || err).slice(0, 200);
          const stackLine = String(err?.stack || "").split("\n").slice(0, 6).join(" | ").slice(0, 300);
          await db.execute(sql`
            UPDATE communication_send_jobs
               SET status = 'failed',
                   last_error = ${"[startJob] " + detail + " | STACK: " + stackLine},
                   updated_at = NOW()
             WHERE id = ${job.id}
          `);
        } catch (_) {}
        continue;
      }
      try {
        /* startJob 직후 즉시 1차 chunk 처리 (즉시 발송) */
        await processChunk(job);
        stats.chunksSent++;
      } catch (err: any) {
        console.error(`[cron-dispatcher] pending 시작 실패 jobId=${job.id}`, err);
        stats.pendingFailed++;
        try {
          await db.execute(sql`
            UPDATE communication_send_jobs
               SET status = 'failed',
                   last_error = ${String(err?.message || err).slice(0, 500)},
                   completed_at = NOW(),
                   updated_at = NOW()
             WHERE id = ${job.id}
          `);
        } catch (e2) {
          console.error("[cron-dispatcher] failed 상태 기록도 실패", e2);
        }
      }
    }
  } catch (err) {
    console.error("[cron-dispatcher] 1단계 pending SELECT 실패", err);
  }

  /* ============================================================
     2단계 — processing 작업 chunk 처리
     ============================================================ */
  try {
    const r: any = await db.execute(sql`
      SELECT id, channel
        FROM communication_send_jobs
       WHERE status = 'processing'
       ORDER BY started_at ASC NULLS LAST, id ASC
       LIMIT ${PROCESSING_JOB_LIMIT}
    `);
    const processingJobs = r?.rows ?? r ?? [];

    for (const job of processingJobs) {
      try {
        await processChunk(job);
        stats.chunksSent++;
      } catch (err: any) {
        console.error(`[cron-dispatcher] processing chunk 실패 jobId=${job.id}`, err);
        stats.chunksFailed++;
        try {
          /* stack 일부 포함 — 정확한 위치 파악 */
          const detail = String(err?.message || err).slice(0, 200);
          const stackLine = String(err?.stack || "").split("\n").slice(0, 6).join(" | ").slice(0, 300);
          await db.execute(sql`
            UPDATE communication_send_jobs
               SET last_error = ${detail + " | STACK: " + stackLine},
                   updated_at = NOW()
             WHERE id = ${job.id}
          `);
        } catch (e2) {
          console.error("[cron-dispatcher] last_error 기록 실패", e2);
        }
      }
    }
  } catch (err) {
    console.error("[cron-dispatcher] 2단계 processing SELECT 실패", err);
  }

  /* ============================================================
     3단계 — cancelled 작업의 잔여 수신자 정리
     ============================================================ */
  try {
    const r: any = await db.execute(sql`
      UPDATE communication_send_recipients
         SET status = 'cancelled', updated_at = NOW()
       WHERE status IN ('pending', 'sending')
         AND job_id IN (SELECT id FROM communication_send_jobs WHERE status = 'cancelled')
    `);
    stats.cancelledCleaned = r?.rowCount ?? 0;
  } catch (err) {
    console.error("[cron-dispatcher] 3단계 cancelled 정리 실패", err);
  }

  console.log(
    `[cron-dispatcher] done in ${Date.now() - t0}ms — ` +
      `pending picked=${stats.pendingPicked} failed=${stats.pendingFailed} / ` +
      `chunks sent=${stats.chunksSent} failed=${stats.chunksFailed} / ` +
      `cancelled cleaned=${stats.cancelledCleaned}`,
  );

  return new Response(
    JSON.stringify({ ok: true, durationMs: Date.now() - t0, stats }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

/* =========================================================
   startJob — pending → processing 전환
   ========================================================= */

async function startJob(job: any) {
  /* 템플릿·그룹 조회 */
  const tplRes: any = await db.execute(sql`
    SELECT id, name, channel, subject, body_template, variables, is_active
      FROM communication_templates WHERE id = ${job.template_id} LIMIT 1
  `);
  const template = (tplRes?.rows ?? tplRes ?? [])[0];
  if (!template) throw new Error(`템플릿을 찾을 수 없음 (id=${job.template_id})`);
  if (!template.is_active) throw new Error("템플릿이 비활성 상태");

  const grpRes: any = await db.execute(sql`
    SELECT id, name, criteria, is_active
      FROM recipient_groups WHERE id = ${job.recipient_group_id} LIMIT 1
  `);
  const group = (grpRes?.rows ?? grpRes ?? [])[0];
  if (!group) throw new Error(`그룹을 찾을 수 없음 (id=${job.recipient_group_id})`);
  if (!group.is_active) throw new Error("그룹이 비활성 상태");

  /* 그룹 resolve — 모든 회원 (limit 없음) */
  const resolved = await resolveRecipients(group.criteria, { limit: 0 });
  /* limit=0이면 전체 — resolveRecipients가 limit 양수일 때만 LIMIT 적용 */
  let memberIds = resolved.memberIds || [];

  /* job에 excluded_member_ids가 있으면 그룹 resolve 결과에서 제외 */
  const excluded: number[] = Array.isArray(job.excluded_member_ids)
    ? job.excluded_member_ids.map((n: any) => Number(n)).filter((n: number) => Number.isInteger(n))
    : [];
  if (excluded.length > 0) {
    const exSet = new Set(excluded);
    memberIds = memberIds.filter((id: number) => !exSet.has(id));
  }

  const totalRecipients = memberIds.length;

  /* 수신자 0명이면 즉시 completed */
  if (totalRecipients === 0) {
    await db.execute(sql`
      UPDATE communication_send_jobs
         SET status = 'completed',
             total_recipients = 0,
             started_at = NOW(),
             completed_at = NOW(),
             updated_at = NOW()
       WHERE id = ${job.id}
    `);
    return;
  }

  /* 회원 정보 조회 — 변수 치환에 필요한 name/email/phone */
  const membersRes: any = await db.execute(sql`
    SELECT id, name, email, phone
      FROM members
     WHERE id = ANY(${memberIds}::int[])
  `);
  const memberRows = membersRes?.rows ?? membersRes ?? [];
  const memberMap = new Map<number, any>();
  for (const m of memberRows) memberMap.set(m.id, m);

  /* 수신자 스냅샷 INSERT — 변수 치환된 본문 포함 */
  const variables = Array.isArray(template.variables) ? template.variables : [];
  const channel: SendChannel = job.channel;

  /* INSERT 성능 — 500건씩 끊어서 multi-row INSERT */
  const INSERT_BATCH = 500;
  for (let i = 0; i < memberIds.length; i += INSERT_BATCH) {
    const batch = memberIds.slice(i, i + INSERT_BATCH);
    const valuesFragments: ReturnType<typeof sql>[] = [];
    for (const mid of batch) {
      const member = memberMap.get(mid) || { id: mid, name: "", email: "", phone: "" };
      const data = buildMemberRenderData({
        id: member.id,
        name: member.name,
        email: member.email,
        phone: member.phone,
      });
      /* job에 임시 수정(override)이 있으면 그것을 우선 사용 — 템플릿 원본 유지 */
      const effectiveSubjectTpl = (job.subject_override && String(job.subject_override).trim().length > 0)
        ? job.subject_override
        : template.subject;
      const effectiveBodyTpl    = (job.body_override && String(job.body_override).trim().length > 0)
        ? job.body_override
        : template.body_template;

      const subjectStr = effectiveSubjectTpl
        ? renderTemplate(effectiveSubjectTpl, variables, data).rendered
        : null;
      let bodyStr = renderTemplate(effectiveBodyTpl, variables, data).rendered;

      /* 이메일 채널: 추적 픽셀 + 클릭 추적 URL 주입 */
      const trackingToken = generateTrackingToken();
      if (channel === "email") {
        bodyStr = injectTrackingIntoHtml(bodyStr, trackingToken, BASE_URL);
      }

      /* 명시 타입 변환 — postgres-js bytes.str → byteLength(number) 에러 회피 */
      const safeJobId   = Number(job.id) || 0;
      const safeMid     = Number(mid) || 0;
      const safeChannel = String(channel);
      const safeSubj    = subjectStr == null ? null : String(subjectStr);
      const safeBody    = bodyStr == null ? "" : String(bodyStr);
      const safeToken   = String(trackingToken || "");
      valuesFragments.push(
        sql`(${safeJobId}, ${safeMid}, ${safeChannel}, 'pending', ${safeSubj}, ${safeBody}, ${safeToken})`
      );
    }
    /* drizzle 표준 sql.join 사용 — reduce 방식은 parameter binding 인덱스 꼬임 발생 */
    const valuesJoined = sql.join(valuesFragments, sql`, `);
    await db.execute(sql`
      INSERT INTO communication_send_recipients
        (job_id, member_id, channel, status, rendered_subject, rendered_body, tracking_token)
      VALUES ${valuesJoined}
    `);
  }

  /* 작업 status 갱신 */
  await db.execute(sql`
    UPDATE communication_send_jobs
       SET status = 'processing',
           total_recipients = ${totalRecipients},
           started_at = NOW(),
           updated_at = NOW()
     WHERE id = ${job.id}
  `);
}

/* =========================================================
   processChunk — processing 작업 1개 chunk 처리
   ========================================================= */

async function processChunk(job: any) {
  const channel: SendChannel = job.channel;

  /* pending 수신자 50건 픽업 (회원 정보 조인) */
  const r: any = await db.execute(sql`
    SELECT r.id, r.member_id, r.rendered_subject, r.rendered_body,
           m.name AS member_name, m.email AS member_email, m.phone AS member_phone
      FROM communication_send_recipients r
      LEFT JOIN members m ON m.id = r.member_id
     WHERE r.job_id = ${job.id} AND r.status = 'pending'
     ORDER BY r.id ASC
     LIMIT ${CHUNK_SIZE}
  `);
  const chunk = r?.rows ?? r ?? [];

  if (chunk.length === 0) {
    /* 잔여 0 → completed 마킹 */
    await db.execute(sql`
      UPDATE communication_send_jobs
         SET status = 'completed',
             completed_at = NOW(),
             updated_at = NOW()
       WHERE id = ${job.id} AND status = 'processing'
    `);
    return;
  }

  let success = 0;
  let failure = 0;

  for (const rec of chunk) {
    /* sending 마킹 (race 방지 — 같은 cron 중첩 시 중복 발송 차단) */
    const upd: any = await db.execute(sql`
      UPDATE communication_send_recipients
         SET status = 'sending', updated_at = NOW()
       WHERE id = ${rec.id} AND status = 'pending'
    `);
    if ((upd?.rowCount ?? 0) === 0) {
      /* 다른 cron tick이 이미 가져감 — 스킵 */
      continue;
    }

    const result = await sendViaAdapter(
      channel,
      {
        id:    Number(rec.member_id) || 0,
        name:  rec.member_name == null ? null : String(rec.member_name),
        email: rec.member_email == null ? null : String(rec.member_email),
        phone: rec.member_phone == null ? null : String(rec.member_phone),
      },
      {
        subject: rec.rendered_subject == null ? undefined : String(rec.rendered_subject),
        body:    rec.rendered_body == null ? "" : String(rec.rendered_body),
      },
    );

    if (result.ok) {
      await db.execute(sql`
        UPDATE communication_send_recipients
           SET status = 'sent', sent_at = NOW(), updated_at = NOW()
         WHERE id = ${rec.id}
      `);
      success++;
    } else {
      await db.execute(sql`
        UPDATE communication_send_recipients
           SET status = 'failed',
               error = ${(result.error || "").slice(0, 500)},
               retry_count = retry_count + 1,
               updated_at = NOW()
         WHERE id = ${rec.id}
      `);
      failure++;
    }
  }

  /* 작업 카운터 누적 */
  await db.execute(sql`
    UPDATE communication_send_jobs
       SET success_count = success_count + ${success},
           failure_count = failure_count + ${failure},
           updated_at = NOW()
     WHERE id = ${job.id}
  `);

  /* 잔여 pending 수 확인 — 0이면 completed */
  const remRes: any = await db.execute(sql`
    SELECT COUNT(*)::int AS n
      FROM communication_send_recipients
     WHERE job_id = ${job.id} AND status IN ('pending', 'sending')
  `);
  const remaining = ((remRes?.rows ?? remRes)[0] ?? {}).n ?? 0;

  if (remaining === 0) {
    await db.execute(sql`
      UPDATE communication_send_jobs
         SET status = 'completed',
             completed_at = NOW(),
             updated_at = NOW()
       WHERE id = ${job.id} AND status = 'processing'
    `);
  }
}
