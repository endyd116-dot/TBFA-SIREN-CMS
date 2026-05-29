// netlify/functions/admin-send-job-create.ts
// Phase 10 R3 — 신규 발송 작업 등록 (즉시·예약)
// 등록 시점에는 수신자 INSERT 안 함. cron이 pending → processing 전환 시 그룹 resolve + 수신자 스냅샷 생성.

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import { canAccess } from "../../lib/role-permission-check";
import { validateSendJob } from "../../lib/communication-send";

export const config = { path: "/api/admin-send-job-create" };

const JSON_HEADER = { "Content-Type": "application/json" };

function jsonError(step: string, err: any, status = 500) {
  return new Response(
    JSON.stringify({
      ok: false,
      error: "발송 작업 등록 실패",
      step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }),
    { status, headers: JSON_HEADER },
  );
}

export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ ok: false, error: "POST만 허용", step: "method" }),
      { status: 405, headers: JSON_HEADER },
    );
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;
  // R45 §4-7: 대량 발송은 admin+ (비용·평판 비가역·운영자 차단·권한정책 토글)
  if (!(await canAccess((auth as any).ctx.member.role ?? "", "send_job"))) {
    return new Response(JSON.stringify({ ok: false, error: "대량 발송 권한이 없습니다", step: "auth_role" }), { status: 403, headers: JSON_HEADER });
  }
  /* fix(R3): BUG-5 패턴 회귀 — auth.admin?.id / user?.id는 항상 undefined.
     실제 어드민 ID는 auth.ctx.admin.uid에 있음. silent NULL 저장 방지. */
  const adminId = (auth as any).ctx?.admin?.uid ?? null;

  let body: any;
  try {
    body = await req.json();
  } catch (err: any) {
    return jsonError("parse_body", err, 400);
  }

  const name = String(body?.name || "").trim();
  const templateId = parseInt(body?.templateId, 10);
  const recipientGroupId = parseInt(body?.recipientGroupId, 10);
  const scheduleType = body?.scheduleType === "now" ? "now" : "scheduled";
  const scheduledAtRaw = body?.scheduledAt || null;

  /* 신규: 임시 수정 본문/제목 (템플릿 원본 변경 없음) */
  const subjectOverrideRaw = typeof body?.subjectOverride === "string" ? body.subjectOverride.trim() : "";
  const bodyOverrideRaw    = typeof body?.bodyOverride === "string" ? body.bodyOverride.trim() : "";
  const subjectOverride = subjectOverrideRaw.length > 0 ? subjectOverrideRaw.slice(0, 4000) : null;
  const bodyOverride    = bodyOverrideRaw.length > 0 ? bodyOverrideRaw.slice(0, 100000) : null;

  /* 신규: 채널 다중 선택 — 각 채널마다 별도 job 생성 */
  const VALID_CHANNELS = ["email", "sms", "kakao", "inapp"];
  const rawChannels: string[] = Array.isArray(body?.channels)
    ? body.channels.map((c: any) => String(c))
    : [];
  const invalidChannels = rawChannels.filter((c) => !VALID_CHANNELS.includes(c));
  if (invalidChannels.length > 0) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: `지원하지 않는 채널: ${invalidChannels.join(", ")}`,
        step: "validate_channels",
        validChannels: VALID_CHANNELS,
      }),
      { status: 400, headers: JSON_HEADER },
    );
  }
  let channels: string[] = rawChannels.filter((c) => VALID_CHANNELS.includes(c));
  channels = Array.from(new Set(channels));

  /* 신규: 미리보기에서 사용자가 체크 해제한 회원 ID 배열 (발송 제외) */
  const excludedMemberIds: number[] = Array.isArray(body?.excludedMemberIds)
    ? body.excludedMemberIds.map((n: any) => Number(n)).filter((n: number) => Number.isInteger(n) && n > 0)
    : [];
  const excludedJson = JSON.stringify(excludedMemberIds);

  /* ★ 2026-05-16: 이메일 전용 옵션 — 웹 감싸기 + 첨부파일 */
  const wrapEmailWithLayout = body?.wrapEmailWithLayout === true;
  const attachmentBlobIds: number[] = Array.isArray(body?.attachmentBlobIds)
    ? body.attachmentBlobIds.map((n: any) => Number(n)).filter((n: number) => Number.isInteger(n) && n > 0)
    : [];
  const attachmentJson = JSON.stringify(attachmentBlobIds);

  /* ★ 2026-05-17: 이미지 override — 발송 시점에 템플릿 이미지를 임시 수정.
     NULL이면 템플릿의 images 그대로 사용. 빈 배열 []이면 이미지 모두 제거. */
  const imagesOverride = Array.isArray(body?.imagesOverride) ? body.imagesOverride.slice(0, 20) : null;
  const imagesOverrideJson = imagesOverride ? JSON.stringify(imagesOverride) : null;

  if (name.length < 1 || name.length > 200) {
    return new Response(
      JSON.stringify({ ok: false, error: "발송 이름은 1~200자여야 합니다.", step: "validate_name" }),
      { status: 400, headers: JSON_HEADER },
    );
  }

  /* 검증 (템플릿·그룹 활성·시각 미래) */
  let validation: Awaited<ReturnType<typeof validateSendJob>>;
  try {
    validation = await validateSendJob({
      templateId,
      recipientGroupId,
      scheduleType,
      scheduledAt: scheduledAtRaw,
    });
  } catch (err: any) {
    return jsonError("validate", err);
  }

  if (!validation.ok) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: validation.errors[0] || "검증 실패",
        errors: validation.errors,
        step: "validate",
      }),
      { status: 400, headers: JSON_HEADER },
    );
  }

  /* 채널 미지정 시 템플릿 기본 채널 사용 */
  if (channels.length === 0) channels = [validation.template!.channel];

  const effectiveAt = validation.effectiveScheduledAt!;

  const CHANNEL_LABEL: Record<string,string> = { email:"이메일", sms:"SMS", kakao:"카카오", inapp:"앱 알림" };

  /* INSERT — 채널마다 1개 job. 새 컬럼(override·excluded) 미존재 시 자동 폴백.
   * scheduledAt도 'now'면 NULL로 보내야 함 (DB가 'now' 문자열을 timestamp로 파싱 못함). */
  const effectiveAtForDb = scheduleType === "now" ? null : effectiveAt;
  const createdIds: number[] = [];
  let lastInsertError: any = null;
  for (const channel of channels) {
    const jobName = channels.length > 1 ? `${name} (${CHANNEL_LABEL[channel] || channel})` : name;
    try {
      /* 1차: 모든 새 컬럼 포함 — wrap_email_with_layout·attachment_blob_ids는 이메일 채널에서만 의미 */
      const isEmail = channel === "email";
      const r: any = await db.execute(sql`
        INSERT INTO communication_send_jobs
          (name, template_id, recipient_group_id, channel, schedule_type, scheduled_at,
           status, total_recipients, success_count, failure_count, created_by,
           subject_override, body_override, excluded_member_ids, images_override,
           wrap_email_with_layout, attachment_blob_ids)
        VALUES
          (${jobName}, ${templateId}, ${recipientGroupId}, ${channel}, ${scheduleType},
           ${effectiveAtForDb}, 'pending', 0, 0, 0, ${adminId},
           ${subjectOverride}, ${bodyOverride}, ${excludedJson}::jsonb,
           ${imagesOverrideJson ? sql`${imagesOverrideJson}::jsonb` : sql`NULL`},
           ${isEmail ? wrapEmailWithLayout : false},
           ${isEmail ? sql`${attachmentJson}::jsonb` : sql`'[]'::jsonb`})
        RETURNING id
      `);
      const row = (r?.rows ?? r ?? [])[0];
      if (row?.id) createdIds.push(Number(row.id));
    } catch (err1: any) {
      lastInsertError = err1;
      console.error("[send-job-create] 1차 INSERT 실패", err1?.message);
      try {
        /* 2차 폴백: images_override 컬럼 미존재 환경 — 그것 빼고 INSERT */
        const r1b: any = await db.execute(sql`
          INSERT INTO communication_send_jobs
            (name, template_id, recipient_group_id, channel, schedule_type, scheduled_at,
             status, total_recipients, success_count, failure_count, created_by,
             subject_override, body_override, excluded_member_ids)
          VALUES
            (${jobName}, ${templateId}, ${recipientGroupId}, ${channel}, ${scheduleType},
             ${effectiveAtForDb}, 'pending', 0, 0, 0, ${adminId},
             ${subjectOverride}, ${bodyOverride}, ${excludedJson}::jsonb)
          RETURNING id
        `);
        const row1b = (r1b?.rows ?? r1b ?? [])[0];
        if (row1b?.id) createdIds.push(Number(row1b.id));
        lastInsertError = null;
      } catch (err1b: any) {
        try {
          /* 3차 폴백: 새 컬럼 모두 없이 기본 컬럼만 */
          const r2: any = await db.execute(sql`
            INSERT INTO communication_send_jobs
              (name, template_id, recipient_group_id, channel, schedule_type, scheduled_at,
               status, total_recipients, success_count, failure_count, created_by)
            VALUES
              (${jobName}, ${templateId}, ${recipientGroupId}, ${channel}, ${scheduleType},
               ${effectiveAtForDb}, 'pending', 0, 0, 0, ${adminId})
            RETURNING id
          `);
          const row2 = (r2?.rows ?? r2 ?? [])[0];
          if (row2?.id) createdIds.push(Number(row2.id));
          lastInsertError = null;
        } catch (err2: any) {
          return jsonError("insert_job_fallback", err2);
        }
      }
    }
  }
  if (createdIds.length === 0) {
    return jsonError("insert_job_no_id", lastInsertError || "INSERT는 성공했으나 id를 받지 못함");
  }

  return new Response(
    JSON.stringify({ ok: true, id: createdIds[0] || 0, ids: createdIds, channels }),
    { status: 200, headers: JSON_HEADER },
  );
}
