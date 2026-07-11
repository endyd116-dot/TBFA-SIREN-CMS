// lib/communication-dispatcher-core.ts
// Phase 10 R3 발송 큐 디스패처 — 핵심 로직 (2026-06-25 추출·이벤트 기반 전환)
//
// 배경(2026-06-25 DB 비용 절감 · wake-on-demand):
//   기존 cron-communication-send-dispatcher가 */10로 DB를 24/7 깨워 비용 폭증.
//   → 이 모듈로 로직을 추출해 ① 발송 큐 적재 시 백그라운드 함수가 "즉시" drain
//      ② 안전망 크론은 */30으로 낮추고 "할 일 있을 때만" 백그라운드를 깨우게 함.
//   결과: 유휴 시 DB 잠(비용↓) · 발송 발생 시 즉시 처리(지연↓·오히려 더 빠름).
//
// 동시성 안전 (즉시-fire + 안전망 크론이 같은 job을 동시에 잡아도 중복/누락 0):
//   1) 작업 픽업 = 원자적 status 전이 pending → 'preparing' (UPDATE ... WHERE status='pending' RETURNING).
//      claim 성공한 러너만 수신자 스냅샷 INSERT. 'preparing'은 다른 러너의 2단계(processing)·
//      완료판정에서 보이지 않음 → 스냅샷 INSERT 중 조기 completed 마킹 불가.
//      INSERT 완료 후 'preparing' → 'processing'으로 전환해야 발송 단계가 픽업.
//   2) 수신자 발송 = 원자적 'pending' → 'sending' (UPDATE ... WHERE status='pending').
//      claim 0행이면 다른 tick이 가져간 것 → 스킵. 한 수신자는 한 번만 발송.
//   3) fire 실패해도 안전망 크론이 동일 job을 줍게(이중화) → 발송 누락 0.
//
// 처리 단계 (1 pass):
//   0단계 — 고아 'sending' 복구 + 멈춘 'preparing' 회수(스냅샷 미발송분 삭제 후 pending 환원)
//   1단계 — pending 작업 픽업(원자적 claim) → 그룹 resolve → 수신자 스냅샷 INSERT → 'processing'
//   2단계 — processing 작업 chunk 처리: 50건/회 어댑터 호출 → sent/failed → 카운터 → 잔여 0이면 'completed'
//   3단계 — cancelled 정리
//
// runDispatcher({ maxMs }) — maxMs 예산 안에서 할 일이 없을 때까지 pass 반복(drain).
//   백그라운드(즉시-fire)는 큰 예산으로 끝까지 완주, 안전망 크론은 백그라운드를 깨우는 용도.

import { sql } from "drizzle-orm";
import { db } from "../db";
import { resolveRecipients } from "./recipient-resolve";
import { renderTemplate } from "./template-render";
import { baseLayout } from "./email";
import {
  sendViaAdapter,
  buildMemberRenderData,
  type SendChannel,
} from "./communication-send";
import {
  generateTrackingToken,
  injectTrackingIntoHtml,
} from "./communication-tracking";

const BASE_URL = process.env.SITE_URL || "https://tbfa-siren-cms.netlify.app";

const PENDING_PICKUP_LIMIT = 10;
const PROCESSING_JOB_LIMIT = 5;
const CHUNK_SIZE = 50;
/* 수신자 1건 발송 상한 — 외부 API가 응답 없이 멈추면 함수 전체가 타임아웃되어
   수신자가 'sending'에 갇힘. 건별 상한으로 차단.
   MMS(이미지 압축+전송)까지 고려해 15초. */
const SEND_TIMEOUT_MS = 15000;

/** Promise에 타임아웃 — 초과 시 reject (원본 Promise는 함수 종료와 함께 폐기) */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} 타임아웃 (${ms}ms 초과)`)), ms),
    ),
  ]);
}

/* drizzle-orm/postgres-js는 UPDATE/DELETE 영향 행 수를 `count`에 담음.
   node-postgres의 `rowCount`도 fallback 처리. */
function affectedRows(r: any): number {
  if (r == null) return 0;
  const c = (r as any).count;
  if (typeof c === "number") return c;
  const rc = (r as any).rowCount;
  if (typeof rc === "number") return rc;
  return 0;
}

export interface DispatchStats {
  pendingPicked: number;
  pendingFailed: number;
  chunksSent: number;
  chunksFailed: number;
  cancelledCleaned: number;
}

/* =========================================================
   hasDispatchWork — 처리할 작업이 있는지 가볍게 확인 (안전망 크론용)
   due pending(예약시각 도래 포함) 또는 processing 작업이 1건이라도 있으면 true.
   ========================================================= */
export async function hasDispatchWork(): Promise<boolean> {
  try {
    const r: any = await db.execute(sql`
      SELECT
        (SELECT COUNT(*) FROM communication_send_jobs
          WHERE status = 'pending'
            AND (scheduled_at IS NULL OR scheduled_at <= NOW()))::int AS pend,
        (SELECT COUNT(*) FROM communication_send_jobs
          WHERE status IN ('preparing', 'processing'))::int AS proc
    `);
    const row = (r?.rows ?? r ?? [])[0] || {};
    return (Number(row.pend) || 0) > 0 || (Number(row.proc) || 0) > 0;
  } catch (err) {
    console.error("[dispatcher-core] hasDispatchWork 실패", err);
    /* 확인 실패 시 보수적으로 true (안전망이 백그라운드를 깨우게) */
    return true;
  }
}

/* =========================================================
   runDispatcher — maxMs 예산 안에서 할 일이 없을 때까지 pass 반복(drain)
   ========================================================= */
export async function runDispatcher(opts?: { maxMs?: number }): Promise<DispatchStats> {
  const maxMs = opts?.maxMs ?? 20000;
  const t0 = Date.now();
  const total: DispatchStats = {
    pendingPicked: 0,
    pendingFailed: 0,
    chunksSent: 0,
    chunksFailed: 0,
    cancelledCleaned: 0,
  };

  /* 2026-06-27: 야간 발송 보류(KST 23:00~06:00). 대량·마케팅·자동 발송은 이 디스패처를
     거치므로 야간엔 발송하지 않고 보류한다. 잔여 pending은 다음 시간대 크론(매시 정각)이
     06시 이후 이어받아 드레인. (영수증 등 거래성 메일은 sendEmail 직접 호출이라 무관·즉시 발송) */
  const kstHour = (new Date().getUTCHours() + 9) % 24;
  if (kstHour >= 23 || kstHour < 6) {
    return total; // quiet hours — 발송 보류(누락 아님: pending 유지 → 06시 이후 처리)
  }

  /* 안전 상한 — 예기치 못한 무한루프 차단 */
  const MAX_PASSES = 5000;
  let passes = 0;

  while (passes < MAX_PASSES) {
    passes++;
    const pass = await dispatchPass();
    total.pendingPicked += pass.stats.pendingPicked;
    total.pendingFailed += pass.stats.pendingFailed;
    total.chunksSent += pass.stats.chunksSent;
    total.chunksFailed += pass.stats.chunksFailed;
    total.cancelledCleaned += pass.stats.cancelledCleaned;

    /* 예산 초과 시 종료 — 잔여는 다음 fire/크론이 이어받음(부분 drain 안전) */
    if (Date.now() - t0 >= maxMs) break;

    /* 이번 pass에서 실질 진행이 없었으면 종료 — 남은 작업이 다른 드레이너(동시 실행)에
       이미 claim된 상태일 수 있음. 핫스핀 방지: 잔여는 그 드레이너/다음 크론이 처리. */
    const progressed =
      pass.stats.pendingPicked > 0 ||
      pass.stats.chunksSent > 0 ||
      pass.stats.chunksFailed > 0 ||
      pass.stats.cancelledCleaned > 0;
    if (!progressed) break;

    /* 할 일이 더 없으면 종료 */
    if (!(await hasDispatchWork())) break;
  }

  console.log(
    `[dispatcher-core] drain done in ${Date.now() - t0}ms (${passes} pass) — ` +
      `pending picked=${total.pendingPicked} failed=${total.pendingFailed} / ` +
      `chunks sent=${total.chunksSent} failed=${total.chunksFailed} / ` +
      `cancelled cleaned=${total.cancelledCleaned}`,
  );
  return total;
}

/* =========================================================
   dispatchPass — 1회 처리 (0~3단계)
   ========================================================= */
async function dispatchPass(): Promise<{ stats: DispatchStats }> {
  const stats: DispatchStats = {
    pendingPicked: 0,
    pendingFailed: 0,
    chunksSent: 0,
    chunksFailed: 0,
    cancelledCleaned: 0,
  };

  /* 1단계에서 startJob+processChunk 한 job을 2단계가 다시 픽업하면 중복 processChunk →
     pending 0건을 보고 job을 조기 completed 마킹. 1단계 처리분을 2단계에서 제외. */
  const handledJobIds = new Set<number>();

  /* ============================================================
     0단계 — 고아 'sending' 복구 + 멈춘 'preparing' 회수
     ============================================================ */
  try {
    const recovered: any = await db.execute(sql`
      UPDATE communication_send_recipients
         SET status = 'pending', retry_count = retry_count + 1, updated_at = NOW()
       WHERE status = 'sending'
         AND updated_at < NOW() - INTERVAL '90 seconds'
         AND retry_count < 3
    `);
    const failedOut: any = await db.execute(sql`
      WITH orphan_failed AS (
        UPDATE communication_send_recipients
           SET status = 'failed',
               error = '발송 반복 타임아웃 — 3회 재시도 후 실패 처리',
               updated_at = NOW()
         WHERE status = 'sending'
           AND updated_at < NOW() - INTERVAL '90 seconds'
           AND retry_count >= 3
         RETURNING job_id
      )
      UPDATE communication_send_jobs j
         SET failure_count = failure_count + sub.cnt, updated_at = NOW()
        FROM (SELECT job_id, COUNT(*)::int AS cnt FROM orphan_failed GROUP BY job_id) sub
       WHERE j.id = sub.job_id
    `);
    const recCnt = affectedRows(recovered);
    const failCnt = affectedRows(failedOut);
    if (recCnt > 0 || failCnt > 0) {
      console.warn(`[dispatcher-core] 고아 sending 복구 — 재시도=${recCnt} 실패종결=${failCnt}`);
    }
  } catch (err) {
    console.error("[dispatcher-core] 0단계 고아 sending 복구 실패", err);
  }

  /* 멈춘 'preparing' 회수 — claim 후 스냅샷 INSERT 중 함수가 죽으면 job이 'preparing'에 영구히 갇힘.
     'preparing'은 발송 단계(processing) 전이라 아직 한 건도 발송되지 않음 → 부분 스냅샷을 삭제하고
     pending으로 환원하면 안전하게 재시도. started_at 5분 경과분만 회수(진행 중 claim 보호). */
  try {
    const stalePrep: any = await db.execute(sql`
      SELECT id FROM communication_send_jobs
       WHERE status = 'preparing'
         AND started_at < NOW() - INTERVAL '5 minutes'
       LIMIT 50
    `);
    const staleRows = stalePrep?.rows ?? stalePrep ?? [];
    for (const row of staleRows) {
      const jid = Number(row.id);
      if (!jid) continue;
      try {
        await db.execute(sql`DELETE FROM communication_send_recipients WHERE job_id = ${jid}`);
        await db.execute(sql`
          UPDATE communication_send_jobs
             SET status = 'pending', started_at = NULL, updated_at = NOW()
           WHERE id = ${jid} AND status = 'preparing'
        `);
        console.warn(`[dispatcher-core] 멈춘 preparing 회수 jobId=${jid}`);
      } catch (e) {
        console.error(`[dispatcher-core] preparing 회수 실패 jobId=${jid}`, e);
      }
    }
  } catch (err) {
    console.error("[dispatcher-core] 멈춘 preparing 회수 단계 실패", err);
  }

  /* ============================================================
     1단계 — pending 작업 픽업 (원자적 claim)
     ============================================================ */
  try {
    /* images_override 컬럼 존재 시 조건부 SELECT */
    const colImgChk: any = await db.execute(sql`
      SELECT 1 AS ok FROM information_schema.columns
       WHERE table_name = 'communication_send_jobs' AND column_name = 'images_override' LIMIT 1
    `);
    const hasImgOverride = ((colImgChk?.rows ?? colImgChk ?? [])[0] || {}).ok === 1;

    let r: any;
    if (hasImgOverride) {
      r = await db.execute(sql`
        SELECT j.id, j.template_id, j.recipient_group_id, j.channel, j.name,
               j.subject_override, j.body_override, j.excluded_member_ids, j.images_override,
               j.wrap_email_with_layout, j.attachment_blob_ids,
               j.status, j.scheduled_at, j.schedule_type
          FROM communication_send_jobs j
         WHERE j.status = 'pending'
           AND (j.scheduled_at IS NULL OR j.scheduled_at <= NOW())
         ORDER BY j.scheduled_at ASC NULLS FIRST, j.id ASC
         LIMIT ${PENDING_PICKUP_LIMIT}
      `);
    } else {
      r = await db.execute(sql`
        SELECT j.id, j.template_id, j.recipient_group_id, j.channel, j.name,
               j.subject_override, j.body_override, j.excluded_member_ids,
               j.wrap_email_with_layout, j.attachment_blob_ids,
               j.status, j.scheduled_at, j.schedule_type
          FROM communication_send_jobs j
         WHERE j.status = 'pending'
           AND (j.scheduled_at IS NULL OR j.scheduled_at <= NOW())
         ORDER BY j.scheduled_at ASC NULLS FIRST, j.id ASC
         LIMIT ${PENDING_PICKUP_LIMIT}
      `);
    }
    const pendingJobs = r?.rows ?? r ?? [];

    for (const job of pendingJobs) {
      /* 원자적 claim: pending → preparing. 0행이면 다른 러너(즉시-fire/안전망 크론)가
         이미 가져간 것 → 스킵. 중복 startJob(중복 수신자 스냅샷) 차단. */
      let claimed = false;
      try {
        const claim: any = await db.execute(sql`
          UPDATE communication_send_jobs
             SET status = 'preparing', started_at = NOW(), updated_at = NOW()
           WHERE id = ${job.id} AND status = 'pending'
          RETURNING id
        `);
        claimed = affectedRows(claim) > 0 || (claim?.rows ?? claim ?? []).length > 0;
      } catch (err) {
        console.error(`[dispatcher-core] claim 실패 jobId=${job.id}`, err);
        continue;
      }
      if (!claimed) continue;

      try {
        await startJob(job);
        stats.pendingPicked++;
      } catch (err: any) {
        console.error(`[dispatcher-core] startJob 실패 jobId=${job.id}`, err);
        stats.pendingFailed++;
        try {
          const detail = String(err?.message || err).slice(0, 200);
          const stackLine = String(err?.stack || "").split("\n").slice(0, 6).join(" | ").slice(0, 300);
          /* 실패 시 부분 스냅샷 제거 후 failed 마킹(아직 발송 전이므로 안전) */
          await db.execute(sql`DELETE FROM communication_send_recipients WHERE job_id = ${job.id}`);
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
      handledJobIds.add(Number(job.id));
      try {
        /* startJob 직후 즉시 1차 chunk 처리 (즉시 발송) */
        await processChunk(job);
        stats.chunksSent++;
      } catch (err: any) {
        console.error(`[dispatcher-core] pending 시작 실패 jobId=${job.id}`, err);
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
          console.error("[dispatcher-core] failed 상태 기록도 실패", e2);
        }
      }
    }
  } catch (err) {
    console.error("[dispatcher-core] 1단계 pending SELECT 실패", err);
  }

  /* ============================================================
     2단계 — processing 작업 chunk 처리
     ============================================================ */
  try {
    const colChk2: any = await db.execute(sql`
      SELECT 1 AS ok FROM information_schema.columns
       WHERE table_name = 'communication_send_jobs' AND column_name = 'images_override' LIMIT 1
    `);
    const hasImgOv2 = ((colChk2?.rows ?? colChk2 ?? [])[0] || {}).ok === 1;
    let r: any;
    if (hasImgOv2) {
      r = await db.execute(sql`
        SELECT id, channel, template_id, images_override
          FROM communication_send_jobs
         WHERE status = 'processing'
         ORDER BY started_at ASC NULLS LAST, id ASC
         LIMIT ${PROCESSING_JOB_LIMIT}
      `);
    } else {
      r = await db.execute(sql`
        SELECT id, channel
          FROM communication_send_jobs
         WHERE status = 'processing'
         ORDER BY started_at ASC NULLS LAST, id ASC
         LIMIT ${PROCESSING_JOB_LIMIT}
      `);
    }
    const processingJobs = r?.rows ?? r ?? [];

    for (const job of processingJobs) {
      if (handledJobIds.has(Number(job.id))) continue;
      try {
        await processChunk(job);
        stats.chunksSent++;
      } catch (err: any) {
        console.error(`[dispatcher-core] processing chunk 실패 jobId=${job.id}`, err);
        stats.chunksFailed++;
        try {
          const detail = String(err?.message || err).slice(0, 200);
          const stackLine = String(err?.stack || "").split("\n").slice(0, 6).join(" | ").slice(0, 300);
          await db.execute(sql`
            UPDATE communication_send_jobs
               SET last_error = ${detail + " | STACK: " + stackLine},
                   updated_at = NOW()
             WHERE id = ${job.id}
          `);
        } catch (e2) {
          console.error("[dispatcher-core] last_error 기록 실패", e2);
        }
      }
    }
  } catch (err) {
    console.error("[dispatcher-core] 2단계 processing SELECT 실패", err);
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
    stats.cancelledCleaned = affectedRows(r);
  } catch (err) {
    console.error("[dispatcher-core] 3단계 cancelled 정리 실패", err);
  }

  return { stats };
}

/* =========================================================
   startJob — preparing 작업의 수신자 스냅샷 생성 → processing 전환
   (호출 전 pending → preparing claim이 끝나 있어야 함)
   ========================================================= */
async function startJob(job: any) {
  const colCheck: any = await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM information_schema.columns
     WHERE table_name = 'communication_templates'
       AND column_name IN ('alimtalk_template_code','alimtalk_review_status','alimtalk_button_json')
  `);
  const hasAlimtalkCols = (((colCheck?.rows ?? colCheck)[0] ?? {}).n ?? 0) === 3;

  let tplRes: any;
  const imgCheck: any = await db.execute(sql`
    SELECT 1 AS ok FROM information_schema.columns
     WHERE table_name = 'communication_templates' AND column_name = 'images' LIMIT 1
  `);
  const hasImagesCol = ((imgCheck?.rows ?? imgCheck ?? [])[0] || {}).ok === 1;

  const sirenColChk: any = await db.execute(sql`
    SELECT 1 AS ok FROM information_schema.columns
     WHERE table_name = 'communication_templates' AND column_name = 'use_siren_layout' LIMIT 1
  `);
  const hasSirenCol = ((sirenColChk?.rows ?? sirenColChk ?? [])[0] || {}).ok === 1;

  if (hasAlimtalkCols && hasImagesCol && hasSirenCol) {
    tplRes = await db.execute(sql`
      SELECT id, name, channel, subject, body_template, variables, is_active,
             alimtalk_template_code, alimtalk_review_status, alimtalk_button_json, images, use_siren_layout
        FROM communication_templates WHERE id = ${job.template_id} LIMIT 1
    `);
  } else if (hasAlimtalkCols && hasImagesCol) {
    tplRes = await db.execute(sql`
      SELECT id, name, channel, subject, body_template, variables, is_active,
             alimtalk_template_code, alimtalk_review_status, alimtalk_button_json, images
        FROM communication_templates WHERE id = ${job.template_id} LIMIT 1
    `);
  } else if (hasAlimtalkCols) {
    tplRes = await db.execute(sql`
      SELECT id, name, channel, subject, body_template, variables, is_active,
             alimtalk_template_code, alimtalk_review_status, alimtalk_button_json
        FROM communication_templates WHERE id = ${job.template_id} LIMIT 1
    `);
  } else {
    tplRes = await db.execute(sql`
      SELECT id, name, channel, subject, body_template, variables, is_active
        FROM communication_templates WHERE id = ${job.template_id} LIMIT 1
    `);
  }
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

  const resolved = await resolveRecipients(group.criteria, { limit: 0, channel: job.channel });
  let memberIds = resolved.memberIds || [];

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

  const idsLiteral = memberIds.length > 0
    ? `ARRAY[${memberIds.map((n: number) => Number(n) || 0).join(",")}]::int[]`
    : `ARRAY[]::int[]`;
  const membersRes: any = await db.execute(sql`
    SELECT id, name, email, phone
      FROM members
     WHERE id = ANY(${sql.raw(idsLiteral)})
  `);
  const memberRows = membersRes?.rows ?? membersRes ?? [];
  const memberMap = new Map<number, any>();
  for (const m of memberRows) memberMap.set(m.id, m);

  const variables = Array.isArray(template.variables) ? template.variables : [];
  const channel: SendChannel = job.channel;

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
      const effectiveSubjectTpl = (job.subject_override && String(job.subject_override).trim().length > 0)
        ? job.subject_override
        : template.subject;
      let effectiveBodyTpl = (job.body_override && String(job.body_override).trim().length > 0)
        ? job.body_override
        : template.body_template;

      const renderOptions = channel === "kakao" ? { useSampleFallback: true } : {};
      if (channel === "kakao") {
        effectiveBodyTpl = String(effectiveBodyTpl).replace(/#\{([^{}]+)\}/g, "{{$1}}");
      }

      const subjectStr = effectiveSubjectTpl
        ? renderTemplate(effectiveSubjectTpl, variables, data, renderOptions).rendered
        : null;
      let bodyStr = renderTemplate(effectiveBodyTpl, variables, data, renderOptions).rendered;

      const trackingToken = generateTrackingToken();
      if (channel === "email") {
        const jobImagesOverride = (job as any).images_override;
        const images = (jobImagesOverride !== null && jobImagesOverride !== undefined)
          ? (Array.isArray(jobImagesOverride) ? jobImagesOverride.slice() : [])
          : (Array.isArray((template as any).images) ? (template as any).images.slice() : []);
        if (images.length > 0) {
          images.sort((a: any, b: any) => Number(a.order || 0) - Number(b.order || 0));
          const buildImgTag = (img: any) => {
            const alignCss = img.align === "left" ? "left" : img.align === "right" ? "right" : "center";
            const width = Math.min(Math.max(Number(img.width) || 600, 50), 1200);
            const url = String(img.url || "");
            const alt = String(img.alt || "").replace(/"/g, "&quot;");
            return `<div style="text-align:${alignCss};margin:12px 0"><img src="${url}" alt="${alt}" style="max-width:100%;width:${width}px;height:auto;display:inline-block;border:0"></div>`;
          };
          const aboveImgs = images.filter((img: any) => img.position !== "below").map(buildImgTag).join("");
          const belowImgs = images.filter((img: any) => img.position === "below").map(buildImgTag).join("");
          bodyStr = aboveImgs + bodyStr + belowImgs;
        }
        if ((template as any).use_siren_layout === true) {
          bodyStr = baseLayout({
            title: subjectStr || "(제목 없음)",
            bodyHtml: bodyStr,
          });
        }
        bodyStr = injectTrackingIntoHtml(bodyStr, trackingToken, BASE_URL);
      }

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
    const valuesJoined = sql.join(valuesFragments, sql`, `);
    await db.execute(sql`
      INSERT INTO communication_send_recipients
        (job_id, member_id, channel, status, rendered_subject, rendered_body, tracking_token)
      VALUES ${valuesJoined}
    `);
  }

  /* 스냅샷 INSERT 완료 → preparing을 processing으로 전환해야 발송 단계가 픽업.
     이 시점부터 다른 러너의 2단계가 chunk를 처리할 수 있음(수신자 단위 원자 claim으로 중복 없음). */
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
   첨부파일 blob 조회 (이메일 첨부)
   ========================================================= */
async function resolveAttachmentBlobs(
  blobIds: any,
): Promise<Array<{ blobKey: string; filename: string }>> {
  const ids: number[] = Array.isArray(blobIds)
    ? blobIds.map((n: any) => Number(n)).filter((n: number) => Number.isInteger(n) && n > 0)
    : [];
  if (ids.length === 0) return [];
  try {
    const idsLit = `ARRAY[${ids.join(",")}]::int[]`;
    const r: any = await db.execute(sql`
      SELECT id, blob_key, original_name
        FROM blob_uploads
       WHERE id = ANY(${sql.raw(idsLit)}) AND upload_status = 'completed'
    `);
    return (r?.rows ?? r ?? []).map((row: any) => ({
      blobKey: String(row.blob_key),
      filename: String(row.original_name || "attachment"),
    }));
  } catch (e) {
    console.warn(`[dispatcher-core] 첨부 blob 조회 실패`, e);
    return [];
  }
}

/* =========================================================
   processChunk — processing 작업 1개 chunk 처리
   ========================================================= */
async function processChunk(job: any) {
  const channel: SendChannel = job.channel;

  let smsImageUrl: string | null = null;
  if (channel === "sms") {
    const jobImagesOv = (job as any).images_override;
    let imgs: any[] = [];
    if (jobImagesOv !== null && jobImagesOv !== undefined) {
      imgs = Array.isArray(jobImagesOv) ? jobImagesOv : [];
    } else {
      try {
        const tplImgRes: any = await db.execute(sql`
          SELECT images FROM communication_templates WHERE id = ${job.template_id} LIMIT 1
        `);
        const r = (tplImgRes?.rows ?? tplImgRes ?? [])[0];
        imgs = Array.isArray(r?.images) ? r.images : [];
      } catch (_) { imgs = []; }
    }
    if (imgs.length > 0) {
      imgs.sort((a: any, b: any) => Number(a.order || 0) - Number(b.order || 0));
      smsImageUrl = String(imgs[0].url || "") || null;
    }
  }

  let kakaoTplCode: string | null = null;
  let kakaoBtnJson: any = null;
  if (channel === "kakao") {
    const colCheck: any = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM information_schema.columns
       WHERE table_name = 'communication_templates'
         AND column_name IN ('alimtalk_template_code','alimtalk_button_json')
    `);
    const hasCols = (((colCheck?.rows ?? colCheck)[0] ?? {}).n ?? 0) === 2;
    if (hasCols) {
      const tplRes: any = await db.execute(sql`
        SELECT alimtalk_template_code, alimtalk_button_json
          FROM communication_templates WHERE id = ${job.template_id} LIMIT 1
      `);
      const tplRow = (tplRes?.rows ?? tplRes ?? [])[0];
      if (tplRow) {
        kakaoTplCode = tplRow.alimtalk_template_code || null;
        kakaoBtnJson = tplRow.alimtalk_button_json || null;
      }
    }
  }

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
    return;
  }

  let success = 0;
  let failure = 0;

  console.log(`[dispatcher-core] processChunk jobId=${job.id} channel=${channel} chunk=${chunk.length}`);

  for (const rec of chunk) {
    /* sending 마킹 (race 방지 — 같은/다른 러너 중첩 시 중복 발송 차단) */
    const upd: any = await db.execute(sql`
      UPDATE communication_send_recipients
         SET status = 'sending', updated_at = NOW()
       WHERE id = ${rec.id} AND status = 'pending'
    `);
    if (affectedRows(upd) === 0) {
      console.log(`[dispatcher-core] rec#${rec.id} skip — 이미 sending`);
      continue;
    }

    const adapterStartedAt = Date.now();

    let result: { ok: boolean; error?: string };
    try {
      result = await withTimeout(
        sendViaAdapter(
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
            ...(channel === "kakao" && kakaoTplCode ? {
              alimtalkTemplateCode: kakaoTplCode,
              alimtalkButtonJson:   kakaoBtnJson,
            } : {}),
            ...(channel === "sms" && smsImageUrl ? { mmsImageUrl: smsImageUrl } : {}),
            ...(channel === "email" ? {
              wrapEmail: job.wrap_email_with_layout === true,
              emailAttachments: await resolveAttachmentBlobs(job.attachment_blob_ids),
            } : {}),
          },
        ),
        SEND_TIMEOUT_MS,
        "수신자 발송",
      );
    } catch (err: any) {
      result = { ok: false, error: String(err?.message || err).slice(0, 500) };
    }
    const adapterMs = Date.now() - adapterStartedAt;
    console.log(`[dispatcher-core] rec#${rec.id} → ${result.ok ? "OK" : "FAIL"} (${adapterMs}ms) ${result.error ? "err=" + result.error.slice(0, 200) : ""}`);

    if (result.ok) {
      const isSkip = (result as any).skipped === true;
      const skipMark = isSkip ? ((result as any).error || "정책 스킵 (발송 안 함)") : "";
      await db.execute(sql`
        UPDATE communication_send_recipients
           SET status = ${isSkip ? "skipped" : "sent"}, sent_at = NOW(), error = ${skipMark || null}, updated_at = NOW()
         WHERE id = ${rec.id} AND status = 'sending'
      `);
      success++;
    } else {
      await db.execute(sql`
        UPDATE communication_send_recipients
           SET status = 'failed',
               error = ${(result.error || "").slice(0, 500)},
               retry_count = retry_count + 1,
               updated_at = NOW()
         WHERE id = ${rec.id} AND status = 'sending'
      `);
      failure++;
    }
  }

  await db.execute(sql`
    UPDATE communication_send_jobs
       SET success_count = success_count + ${success},
           failure_count = failure_count + ${failure},
           updated_at = NOW()
     WHERE id = ${job.id}
  `);

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

/* =========================================================
   triggerDispatchBackground — 발송 큐 백그라운드 드레이너를 fire-and-forget로 호출
   (admin-send-job-create 즉시 발송, 안전망 크론에서 공용 사용)
   await로 전송 보장하되, 백그라운드 함수는 202 즉시 반환(15분 drain).
   ========================================================= */
export async function triggerDispatchBackground(): Promise<{ ok: boolean; status: number; error?: string }> {
  const base = process.env.URL || process.env.SITE_URL || "https://tbfa-siren-cms.netlify.app";
  const baseUrl = base.startsWith("http") ? base : `https://${base}`;
  const secret = process.env.INTERNAL_TRIGGER_SECRET || "";
  try {
    const resp = await fetch(`${baseUrl}/.netlify/functions/communication-send-dispatch-background`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret }),
    });
    if (resp.status !== 202 && resp.status !== 200) {
      return { ok: false, status: resp.status, error: (await resp.text().catch(() => "")).slice(0, 200) };
    }
    return { ok: true, status: resp.status };
  } catch (err: any) {
    return { ok: false, status: 0, error: String(err?.message || err).slice(0, 200) };
  }
}
