// netlify/functions/admin-send-job-retry-failed.ts
// Phase 10 R4 — 발송 작업의 실패 수신자 전체 재발송 (어드민)
//
// POST ?id={jobId}
// 조건: 해당 job의 failed 수신자 전체를 pending으로 일괄 전환
// 처리: failed → pending 일괄 UPDATE, job status 복구

import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-send-job-retry-failed" };

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
  const jobId = Number(url.searchParams.get("id"));
  if (!jobId || isNaN(jobId)) {
    return new Response(
      JSON.stringify({ ok: false, error: "작업 ID(id)가 필요합니다" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  try {
    /* job 조회 */
    const jobRes: any = await db.execute(sql`
      SELECT id, status, failure_count FROM communication_send_jobs WHERE id = ${jobId} LIMIT 1
    `);
    const job = (jobRes?.rows ?? jobRes ?? [])[0];
    if (!job) {
      return new Response(
        JSON.stringify({ ok: false, error: "발송 작업을 찾을 수 없습니다" }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }

    if (job.status === "cancelled") {
      return new Response(
        JSON.stringify({ ok: false, error: "취소된 작업은 재발송할 수 없습니다" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    /* 실패 수신자 수 확인 */
    const countRes: any = await db.execute(sql`
      SELECT COUNT(*)::int AS n
        FROM communication_send_recipients
       WHERE job_id = ${jobId} AND status = 'failed'
    `);
    const failedCount = ((countRes?.rows ?? countRes)[0] ?? {}).n ?? 0;

    if (failedCount === 0) {
      return new Response(
        JSON.stringify({ ok: true, retriedCount: 0, message: "재발송할 실패 수신자가 없습니다" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    /* 실패 수신자 전체 pending 복구 */
    await db.execute(sql`
      UPDATE communication_send_recipients
         SET status      = 'pending',
             error       = NULL,
             retry_count = retry_count + 1,
             updated_at  = NOW()
       WHERE job_id = ${jobId} AND status = 'failed'
    `);

    /* job failure_count 초기화 + processing 복구 */
    await db.execute(sql`
      UPDATE communication_send_jobs
         SET status       = 'processing',
             failure_count = 0,
             completed_at = NULL,
             updated_at   = NOW()
       WHERE id = ${jobId}
    `);

    return new Response(
      JSON.stringify({
        ok: true,
        jobId,
        retriedCount: failedCount,
        message: `실패한 ${failedCount}명을 재발송 대기열에 추가했습니다`,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "일괄 재발송 처리 실패",
        step: "bulk_update",
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
