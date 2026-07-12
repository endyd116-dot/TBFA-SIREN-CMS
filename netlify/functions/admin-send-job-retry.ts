// netlify/functions/admin-send-job-retry.ts
// Phase 10 R4 — 개별 수신자 재발송 (어드민)
//
// POST ?id={recipientId}
// 조건: recipient.status === 'failed' 인 경우만 허용
// 처리: status → 'pending', retry_count++, updated_at 갱신
//        → cron이 다음 tick에 자동 처리

import { jsonKST } from "../../lib/kst";
import { requireAdmin } from "../../lib/admin-guard";
import { canAccess } from "../../lib/role-permission-check";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { triggerDispatchBackground } from "../../lib/communication-dispatcher-core";

export const config = { path: "/api/admin-send-job-retry" };

export default async function handler(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;
  // R45 §4-7: 개별 재발송은 admin+ (운영자 차단·권한정책 토글)
  if (!(await canAccess((auth as any).ctx.member.role ?? "", "send_job"))) {
    return new Response(jsonKST({ ok: false, error: "대량 발송 권한이 없습니다", step: "auth_role" }), { status: 403, headers: { "Content-Type": "application/json" } });
  }

  if (req.method !== "POST") {
    return new Response(jsonKST({ ok: false, error: "POST만 허용" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  /* 수신자 ID는 URL 쿼리(?id=N) 또는 본문({recipientId|id}) 둘 다 허용 —
     호출 지점이 화면별로 달라 한쪽만 받으면 400 발생함. */
  const url = new URL(req.url);
  let recipientId = Number(url.searchParams.get("id"));
  if (!recipientId || isNaN(recipientId)) {
    try {
      const body = await req.json().catch(() => null);
      if (body && typeof body === "object") {
        recipientId = Number((body as any).recipientId ?? (body as any).id);
      }
    } catch (_) { /* body 파싱 실패는 무시 */ }
  }
  if (!recipientId || isNaN(recipientId)) {
    return new Response(
      jsonKST({ ok: false, error: "수신자 ID(id)가 필요합니다" }),
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
        jsonKST({ ok: false, error: "수신자를 찾을 수 없습니다" }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }

    if (recipient.status !== "failed") {
      return new Response(
        jsonKST({
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

    /* 2026-06-25 즉시 처리: 30분 안전망 크론 대기 없이 백그라운드 드레이너 즉시 fire.
       fire 실패해도 안전망 크론이 줍게 이중화(여기서 throw 금지). */
    void triggerDispatchBackground().catch(() => {});

    return new Response(
      jsonKST({ ok: true, recipientId, message: "재발송 대기열에 추가됐습니다" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    return new Response(
      jsonKST({
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
