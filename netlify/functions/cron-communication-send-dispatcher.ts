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
import { baseLayout } from "../../lib/email";
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
/* 수신자 1건 발송 상한 — 외부 API(Resend/Aligo)가 응답 없이 멈추면
   함수 전체가 타임아웃되어 수신자가 'sending'에 갇힘. 건별 상한으로 차단.
   2026-05-16: 15s → 8s. Netlify Functions sync timeout(10s) 안에서
   우리 timeout 발화 + recipient 'failed' 갱신까지 끝내기 위해 단축. */
/* ★ 2026-05-16: MMS 발송은 sharp 이미지 압축(1~3초) + 프록시 base64 전송(1~2초) +
   알리고 API 응답(2~3초) → 합쳐 최대 8초 부족. 15초로 늘려 timeout 여유 확보.
   Netlify Functions 30초 한계 안에서 안전. */
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

/* ★ 2026-05-16 BUG-FIX: drizzle-orm/postgres-js 드라이버에서 UPDATE/DELETE 결과의
   영향받은 행 수는 `count` 프로퍼티에 들어있음. node-postgres의 `rowCount`로
   접근하면 항상 undefined → 모든 발송이 "이미 sending" 분기로 continue되어
   어댑터 호출 자체가 안 됨. 두 필드 모두 fallback으로 처리. */
function affectedRows(r: any): number {
  if (r == null) return 0;
  const c = (r as any).count;
  if (typeof c === "number") return c;
  const rc = (r as any).rowCount;
  if (typeof rc === "number") return rc;
  return 0;
}

export default async function handler(_req: Request) {
  const t0 = Date.now();
  const stats = {
    pendingPicked: 0,
    pendingFailed: 0,
    chunksSent: 0,
    chunksFailed: 0,
    cancelledCleaned: 0,
  };

  /* ★ 버그픽스3 #14: 1단계에서 startJob+processChunk 한 job 을 2단계가 다시 픽업하면
     같은 핸들러 실행 안에서 processChunk 가 중복 호출 → 한 쪽이 pending 0건을 보고
     job 을 completed 로 조기 마킹(성공/실패 0건인데 완료). 1단계 처리분을 2단계에서 제외. */
  const handledJobIds = new Set<number>();

  /* ============================================================
     0단계 — 고아 'sending' 수신자 복구 (버그픽스3 #14-B)
       발송 도중 함수 타임아웃/중단 시 수신자가 'sending'에 영구히 갇힘.
       processChunk는 'pending'만 재픽업 → 자력 복구 불가 → 작업이 영원히 'processing'.
       5분 이상 'sending'이면 고아로 간주:
         retry_count<3 → 'pending' 재시도 (retry_count++)
         retry_count>=3 → 'failed' 종결 + 작업 failure_count 동기화
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
      console.warn(`[cron-dispatcher] 고아 sending 복구 — 재시도=${recCnt} 실패종결=${failCnt}`);
    }
  } catch (err) {
    console.error("[cron-dispatcher] 0단계 고아 sending 복구 실패", err);
  }

  /* ============================================================
     1단계 — pending 작업 픽업
     ============================================================ */
  try {
    /* ★ 2026-05-16 진단: 새 발송 작업이 picking 안 되는 원인 추적용.
       전체 communication_send_jobs 의 status·scheduled_at 분포를 한 줄로 로그 */
    try {
      const diag: any = await db.execute(sql`
        SELECT status,
               COUNT(*)::int AS cnt,
               COUNT(CASE WHEN scheduled_at IS NULL THEN 1 END)::int AS sched_null,
               COUNT(CASE WHEN scheduled_at <= NOW() THEN 1 END)::int AS sched_past,
               COUNT(CASE WHEN scheduled_at > NOW() THEN 1 END)::int AS sched_future,
               MAX(id) AS max_id
          FROM communication_send_jobs
         GROUP BY status
      `);
      const diagRows = diag?.rows ?? diag ?? [];
      if (diagRows.length > 0) {
        console.log("[cron-dispatcher] DIAG status 분포:", JSON.stringify(diagRows));
      }
    } catch (_) {}

    /* ★ 2026-05-17: images_override 컬럼 존재 시 조건부 SELECT */
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
      handledJobIds.add(Number(job.id));
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
    /* ★ 2026-05-17: images_override 포함 (조건부) */
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
      /* 1단계에서 이미 processChunk 한 job 은 이번 tick에서 재처리 금지
         (중복 processChunk → pending 0건 조기 completed 마킹 방지) */
      if (handledJobIds.has(Number(job.id))) continue;
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
    stats.cancelledCleaned = affectedRows(r);
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
  /* 템플릿·그룹 조회 — ★ 2026-05-16 (재수정): drizzle SQL fragment embedding
     (sql`...${embedFragment}...`)이 dispatcher 환경에서 'syntax error near LIMIT'
     야기 → 조건 분기로 명시 SELECT 두 가지 작성. 컬럼 존재 여부에 따라 분기. */
  const colCheck: any = await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM information_schema.columns
     WHERE table_name = 'communication_templates'
       AND column_name IN ('alimtalk_template_code','alimtalk_review_status','alimtalk_button_json')
  `);
  const hasAlimtalkCols = (((colCheck?.rows ?? colCheck)[0] ?? {}).n ?? 0) === 3;

  let tplRes: any;
  /* ★ 2026-05-17: images jsonb 컬럼 조건부 SELECT */
  const imgCheck: any = await db.execute(sql`
    SELECT 1 AS ok FROM information_schema.columns
     WHERE table_name = 'communication_templates' AND column_name = 'images' LIMIT 1
  `);
  const hasImagesCol = ((imgCheck?.rows ?? imgCheck ?? [])[0] || {}).ok === 1;

  /* ★ 2026-05-17: use_siren_layout 컬럼 조건부 */
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

  /* 회원 정보 조회 — 변수 치환에 필요한 name/email/phone
   * sql.raw로 명시 array literal — drizzle/postgres-js array binding의
   * byteLength(number) 에러 회피 */
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
      let effectiveBodyTpl = (job.body_override && String(job.body_override).trim().length > 0)
        ? job.body_override
        : template.body_template;

      /* ★ 2026-05-16: 카카오 채널은 알리고 표준 변수 표기 #{변수} → renderTemplate가
         인식하는 {{변수}}로 변환. 변환 후 동일 치환 로직 사용. 또 회원 변수 외 다른
         변수(금액·실패사유 등)는 variables[].sample fallback 허용 (자동 트리거 컨텍스트
         없이 수동 발송 시 빈 본문이 알리고 발송 거부되는 결함 차단). */
      const renderOptions = channel === "kakao" ? { useSampleFallback: true } : {};
      if (channel === "kakao") {
        effectiveBodyTpl = String(effectiveBodyTpl).replace(/#\{([^{}]+)\}/g, "{{$1}}");
      }

      const subjectStr = effectiveSubjectTpl
        ? renderTemplate(effectiveSubjectTpl, variables, data, renderOptions).rendered
        : null;
      let bodyStr = renderTemplate(effectiveBodyTpl, variables, data, renderOptions).rendered;

      /* 이메일 채널: 추적 픽셀 + 클릭 추적 URL 주입 */
      const trackingToken = generateTrackingToken();
      if (channel === "email") {
        /* ★ 2026-05-17: 이메일 채널 — job.images_override 우선, 없으면 템플릿의 images.
           NULL이면 템플릿 그대로. 빈 배열 []이면 의도적으로 이미지 모두 제거. */
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
        /* ★ 2026-05-17: use_siren_layout=true 템플릿은 깔끔한 SIREN 헤더·푸터로 wrap.
           subject를 title로, 본문(이미지 포함)을 bodyHtml로 전달. CTA 버튼은
           추후 컬럼 추가 시 확장. */
        if ((template as any).use_siren_layout === true) {
          bodyStr = baseLayout({
            title: subjectStr || "(제목 없음)",
            bodyHtml: bodyStr,
          });
        }
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
   ★ 2026-05-16: 이메일 첨부파일 — attachment_blob_ids → blob_uploads 조회 →
   sendEmailDirect가 R2 다운로드해서 base64 첨부할 수 있도록 blob_key·filename 전달.
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
    console.warn(`[cron-dispatcher] 첨부 blob 조회 실패`, e);
    return [];
  }
}

/* =========================================================
   processChunk — processing 작업 1개 chunk 처리
   ========================================================= */

async function processChunk(job: any) {
  const channel: SendChannel = job.channel;

  /* ★ 2026-05-17: SMS 채널이면 이미지 첨부 시 자동 MMS로 분기. 첫 이미지 URL만 사용. */
  let smsImageUrl: string | null = null;
  if (channel === "sms") {
    /* job.images_override 우선, 없으면 template.images */
    const jobImagesOv = (job as any).images_override;
    let imgs: any[] = [];
    if (jobImagesOv !== null && jobImagesOv !== undefined) {
      imgs = Array.isArray(jobImagesOv) ? jobImagesOv : [];
    } else {
      /* template.images 조회 */
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

  /* ★ 2026-05-16: 카카오 채널이면 작업의 템플릿에서 알리고 정보 1회 조회 (chunk 공유) */
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
    /* ★ 버그픽스3 #14: pending 0건이어도 sending 상태(다른 처리가 진행 중)가 남아있으면
       아직 완료 아님. pending+sending 둘 다 0일 때만 completed 마킹. */
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

  console.log(`[cron-dispatcher] processChunk jobId=${job.id} channel=${channel} chunk=${chunk.length}`);

  for (const rec of chunk) {
    /* sending 마킹 (race 방지 — 같은 cron 중첩 시 중복 발송 차단) */
    const upd: any = await db.execute(sql`
      UPDATE communication_send_recipients
         SET status = 'sending', updated_at = NOW()
       WHERE id = ${rec.id} AND status = 'pending'
    `);
    if (affectedRows(upd) === 0) {
      /* 다른 cron tick이 이미 가져감 — 스킵 */
      console.log(`[cron-dispatcher] rec#${rec.id} skip — 이미 sending`);
      continue;
    }

    const adapterStartedAt = Date.now();
    console.log(`[cron-dispatcher] rec#${rec.id} member#${rec.member_id} email=${rec.member_email || '-'} phone=${rec.member_phone || '-'} → ${channel} 발송 시도`);

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
            /* ★ 2026-05-17: SMS 채널 + 이미지 있으면 MMS 자동 전환. 첫 번째 이미지만 사용. */
            ...(channel === "sms" && smsImageUrl ? { mmsImageUrl: smsImageUrl } : {}),
            /* ★ 2026-05-16: 이메일 채널 전용 — 웹 감싸기 + 첨부파일 */
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
      /* 타임아웃·예외 — 수신자를 'sending'에 남기지 않고 즉시 failed 처리 */
      result = { ok: false, error: String(err?.message || err).slice(0, 500) };
    }
    const adapterMs = Date.now() - adapterStartedAt;
    console.log(`[cron-dispatcher] rec#${rec.id} → ${result.ok ? "OK" : "FAIL"} (${adapterMs}ms) ${result.error ? "err=" + result.error.slice(0, 200) : ""}`);

    if (result.ok) {
      /* ★ 2026-05-16: 정책 스킵 케이스(result.skipped=true)는 status='sent'로 박되
         error 컬럼에 result.error에 담긴 사유를 적어 화면에서 '발송 안 함'으로 라벨
         분기 가능. 옛 코드는 카카오만 하드코딩된 문구였는데 result.error 사용으로
         변경 → 카카오 외 다른 정책 스킵 사유(예: alimtalk_template_code 미등록)도
         정확히 표시. */
      const skipMark = (result as any).skipped === true
        ? ((result as any).error || "정책 스킵 (발송 안 함)")
        : "";
      await db.execute(sql`
        UPDATE communication_send_recipients
           SET status = 'sent', sent_at = NOW(), error = ${skipMark || null}, updated_at = NOW()
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
