// netlify/functions/admin-send-job-create.ts
// Phase 10 R3 — 신규 발송 작업 등록 (즉시·예약)
// 등록 시점에는 수신자 INSERT 안 함. cron이 pending → processing 전환 시 그룹 resolve + 수신자 스냅샷 생성.

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
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
  const adminId = (auth as any).admin?.id ?? (auth as any).user?.id ?? null;

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

  const channel = validation.template!.channel;
  const effectiveAt = validation.effectiveScheduledAt!;

  /* INSERT */
  let newId: number = 0;
  try {
    const r: any = await db.execute(sql`
      INSERT INTO communication_send_jobs
        (name, template_id, recipient_group_id, channel, schedule_type, scheduled_at,
         status, total_recipients, success_count, failure_count, created_by)
      VALUES
        (${name}, ${templateId}, ${recipientGroupId}, ${channel}, ${scheduleType},
         ${effectiveAt}, 'pending', 0, 0, 0, ${adminId})
      RETURNING id
    `);
    const row = (r?.rows ?? r ?? [])[0];
    newId = row?.id ?? 0;
  } catch (err: any) {
    return jsonError("insert_job", err);
  }

  return new Response(
    JSON.stringify({ ok: true, id: newId }),
    { status: 200, headers: JSON_HEADER },
  );
}
