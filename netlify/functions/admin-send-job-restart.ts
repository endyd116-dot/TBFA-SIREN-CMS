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
import { canAccess } from "../../lib/role-permission-check";
import { triggerDispatchBackground } from "../../lib/communication-dispatcher-core";

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
  // R45 §4-7: 대량 발송 재시작은 admin+ (운영자 차단·권한정책 토글)
  if (!(await canAccess((auth as any).ctx.member.role ?? "", "send_job"))) {
    return new Response(JSON.stringify({ ok: false, error: "대량 발송 권한이 없습니다", step: "auth_role" }), { status: 403, headers: JSON_HEADER });
  }

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

  /* Q4-011: 이미 발송된 수신자가 있으면(부분발송 후 취소 등) 스냅샷 전체삭제·재발송 시
     기수신자에게 중복 발송됨. 발송 이력 유무로 분기한다. */
  let sentCount = 0;
  try {
    const r: any = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM communication_send_recipients
       WHERE job_id = ${id} AND status = 'sent'
    `);
    sentCount = ((r?.rows ?? r)[0] ?? {}).n ?? 0;
  } catch (err) { return jsonError("count_sent", err); }

  if (sentCount > 0) {
    /* 부분발송 재개 — 기수신자(sent)는 보존, 미발송분(failed/cancelled/sending)만 pending 복구.
       스냅샷을 지우지 않으므로 startJob 재실행(전원 재INSERT) 없이 미발송분만 다시 보냄. */
    try {
      await db.execute(sql`
        UPDATE communication_send_recipients
           SET status = 'pending', error = NULL, retry_count = retry_count + 1, updated_at = NOW()
         WHERE job_id = ${id} AND status IN ('failed','cancelled','sending')
      `);
      await db.execute(sql`
        UPDATE communication_send_jobs
           SET status = 'processing',
               last_error = NULL,
               failure_count = 0,
               success_count = (SELECT COUNT(*) FROM communication_send_recipients WHERE job_id = ${id} AND status = 'sent'),
               completed_at = NULL,
               updated_at = NOW()
         WHERE id = ${id}
      `);
    } catch (err) { return jsonError("resume_job", err); }

    /* ★ 2026-06-25 즉시 처리: 안전망 크론 대기 없이 백그라운드 드레이너 즉시 fire. */
    void triggerDispatchBackground().catch(() => {});

    return new Response(JSON.stringify({
      ok: true, id, resumed: true,
      message: "이미 발송된 수신자는 제외하고 미발송분만 재개합니다 (즉시 시작).",
    }), { status: 200, headers: JSON_HEADER });
  }

  /* 발송 이력 없음 — 깨끗한 전체 재시작(스냅샷 삭제 후 startJob이 재생성) */
  try {
    await db.execute(sql`
      DELETE FROM communication_send_recipients WHERE job_id = ${id}
    `);
  } catch (err) { return jsonError("delete_recipients", err); }

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

  /* ★ 2026-06-25 즉시 처리: 안전망 크론 대기 없이 백그라운드 드레이너 즉시 fire. */
  void triggerDispatchBackground().catch(() => {});

  return new Response(JSON.stringify({
    ok: true, id, message: "재시도 대기열에 등록되었습니다 (즉시 시작)",
  }), { status: 200, headers: JSON_HEADER });
}
