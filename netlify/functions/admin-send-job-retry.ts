// netlify/functions/admin-send-job-retry.ts
// Phase 10 R4 — 개별 수신자 재발송 (어드민)
//
// POST ?id={recipientId}
// 조건: recipient.status === 'failed' 인 경우만 허용
// 처리: status → 'pending', retry_count++, updated_at 갱신
//        → cron이 다음 tick에 자동 처리

import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-send-job-retry" };

export default async function handler(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "POST만 허용" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const recipientId = Number(url.searchParams.get("id"));
  if (!recipientId || isNaN(recipientId)) {
    return new Response(
      JSON.stringify({ ok: false, error: "수신자 ID(id)가 필요합니다" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  try {
    /* 수신자 조회 */
    const r: any = await db.execute(sql`
      SELECT id, job_id, status, retry_count
        FROM communication_send_recipients
       WHERE id = ${recipientId}
       LIMIT 1
    `);
    const recipient = (r?.rows ?? r ?? [])[0];
    if (!recipient) {
      return new Response(
        JSON.stringify({ ok: false, error: "수신자를 찾을 수 없습니다" }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }

    if (recipient.status !== "failed") {
      return new Response(
        JSON.stringify({
          ok: false,
          error: `재발송은 실패 상태에서만 가능합니다 (현재: ${recipient.status})`,
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    /* pending으로 복구 — cron이 다음 tick에 재시도 */
    await db.execute(sql`
      UPDATE communication_send_recipients
         SET status      = 'pending',
             error       = NULL,
             retry_count = retry_count + 1,
             updated_at  = NOW()
       WHERE id = ${recipientId} AND status = 'failed'
    `);

    /* 부모 job이 completed/cancelled 상태면 processing으로 복구 (cron이 처리하게) */
    const jobRes: any = await db.execute(sql`
      SELECT id, status FROM communication_send_jobs WHERE id = ${recipient.job_id} LIMIT 1
    `);
    const job = (jobRes?.rows ?? jobRes ?? [])[0];
    if (job && (job.status === "completed" || job.status === "failed")) {
      await db.execute(sql`
        UPDATE communication_send_jobs
           SET status     = 'processing',
               completed_at = NULL,
               updated_at = NOW()
         WHERE id = ${recipient.job_id}
      `);
    }

    return new Response(
      JSON.stringify({ ok: true, recipientId, message: "재발송 대기열에 추가됐습니다" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "재발송 처리 실패",
        step: "update",
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
