// netlify/functions/admin-send-job-cancel.ts
// Phase 10 R3 — 발송 취소 (pending·processing 상태만)
// pending: 즉시 'cancelled' (수신자 INSERT 안 됐음)
// processing: 'cancelled' 마킹 — cron이 다음 chunk 시점에 미발송 수신자 cancelled 처리

import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import { canAccess } from "../../lib/role-permission-check";

export const config = { path: "/api/admin-send-job-cancel" };

const JSON_HEADER = { "Content-Type": "application/json" };

function jsonError(step: string, err: any, status = 500) {
  return new Response(
    jsonKST({
      ok: false,
      error: "발송 취소 실패",
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
      jsonKST({ ok: false, error: "POST만 허용", step: "method" }),
      { status: 405, headers: JSON_HEADER },
    );
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;
  // R45 §4-7: 대량 발송 취소는 admin+ (운영자 차단·권한정책 토글)
  if (!(await canAccess((auth as any).ctx.member.role ?? "", "send_job"))) {
    return new Response(jsonKST({ ok: false, error: "대량 발송 권한이 없습니다", step: "auth_role" }), { status: 403, headers: JSON_HEADER });
  }

  const url = new URL(req.url);
  const id = parseInt(url.searchParams.get("id") || "0", 10);
  if (!Number.isInteger(id) || id <= 0) {
    return new Response(
      jsonKST({ ok: false, error: "id가 올바르지 않습니다.", step: "validate" }),
      { status: 400, headers: JSON_HEADER },
    );
  }

  /* 현재 상태 조회 */
  let currentStatus: string | null = null;
  try {
    const r: any = await db.execute(sql`
      SELECT status FROM communication_send_jobs WHERE id = ${id} LIMIT 1
    `);
    const row = (r?.rows ?? r ?? [])[0];
    if (!row) {
      return new Response(
        jsonKST({ ok: false, error: "발송 작업을 찾을 수 없습니다.", step: "not_found" }),
        { status: 404, headers: JSON_HEADER },
      );
    }
    currentStatus = row.status;
  } catch (err: any) {
    return jsonError("select_status", err);
  }

  if (currentStatus !== "pending" && currentStatus !== "processing") {
    return new Response(
      jsonKST({
        ok: false,
        error: `현재 상태(${currentStatus})에서는 취소할 수 없습니다.`,
        step: "status_invalid",
      }),
      { status: 400, headers: JSON_HEADER },
    );
  }

  /* UPDATE — 작업 + 미발송 수신자 일괄 cancelled */
  try {
    await db.execute(sql`
      UPDATE communication_send_jobs
         SET status = 'cancelled',
             completed_at = COALESCE(completed_at, NOW()),
             updated_at = NOW()
       WHERE id = ${id}
    `);
    /* processing 상태였다면 미발송 수신자도 cancelled로 (이미 발송된 sent/failed는 보존) */
    await db.execute(sql`
      UPDATE communication_send_recipients
         SET status = 'cancelled',
             updated_at = NOW()
       WHERE job_id = ${id}
         AND status IN ('pending', 'sending')
    `);
  } catch (err: any) {
    return jsonError("update_cancel", err);
  }

  return new Response(
    jsonKST({ ok: true, status: "cancelled" }),
    { status: 200, headers: JSON_HEADER },
  );
}
