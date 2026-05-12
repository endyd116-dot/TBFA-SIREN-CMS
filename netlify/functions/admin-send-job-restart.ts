/**
 * POST /api/admin-send-job-restart?id=N
 *
 * 실패/취소된 발송 작업을 다시 'pending'으로 되돌려 cron이 재픽업하게 함.
 *  - status: failed/cancelled → pending
 *  - last_error: 초기화
 *  - total_recipients/success_count/failure_count: 0 리셋
 *  - started_at/completed_at: NULL
 *  - 기존 수신자 스냅샷이 있으면 모두 삭제 (startJob이 다시 만듦)
 */

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/admin-send-job-restart" };

const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "재시도 실패", step,
    detail: String(err?.message || err).slice(0, 500),
  }), { status, headers: JSON_HEADER });
}

export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "POST만 허용" }),
      { status: 405, headers: JSON_HEADER });
  }
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  const url = new URL(req.url);
  const id = parseInt(url.searchParams.get("id") || "0", 10);
  if (!id) return jsonError("validate", "id 파라미터 필요", 400);

  /* 현재 상태 확인 */
  let job: any;
  try {
    const r: any = await db.execute(sql`
      SELECT id, status FROM communication_send_jobs WHERE id = ${id} LIMIT 1
    `);
    job = (r?.rows ?? r ?? [])[0];
  } catch (err) { return jsonError("select", err); }
  if (!job) return jsonError("not_found", "작업을 찾을 수 없습니다", 404);
  if (job.status !== "failed" && job.status !== "cancelled") {
    return jsonError("status", `현재 상태(${job.status})는 재시도할 수 없습니다. failed 또는 cancelled만 가능.`, 400);
  }

  /* 기존 수신자 스냅샷 삭제 (startJob이 새로 INSERT) */
  try {
    await db.execute(sql`
      DELETE FROM communication_send_recipients WHERE job_id = ${id}
    `);
  } catch (err) { return jsonError("delete_recipients", err); }

  /* 작업 status 리셋 */
  try {
    await db.execute(sql`
      UPDATE communication_send_jobs
         SET status = 'pending',
             last_error = NULL,
             total_recipients = 0,
             success_count = 0,
             failure_count = 0,
             started_at = NULL,
             completed_at = NULL,
             updated_at = NOW()
       WHERE id = ${id}
    `);
  } catch (err) { return jsonError("reset_job", err); }

  return new Response(JSON.stringify({
    ok: true, id, message: "재시도 대기열에 등록되었습니다 (1분 내 자동 시작)",
  }), { status: 200, headers: JSON_HEADER });
}
