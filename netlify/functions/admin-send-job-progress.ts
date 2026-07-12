// netlify/functions/admin-send-job-progress.ts
// Phase 10 R3 — 진행률 폴링용 가벼운 응답 (5~10초 간격 호출 가정)

import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/admin-send-job-progress" };

const JSON_HEADER = { "Content-Type": "application/json" };

function jsonError(step: string, err: any) {
  return new Response(
    jsonKST({
      ok: false,
      error: "진행률 조회 실패",
      step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }),
    { status: 500, headers: JSON_HEADER },
  );
}

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  const url = new URL(req.url);
  const id = parseInt(url.searchParams.get("id") || "0", 10);
  if (!Number.isInteger(id) || id <= 0) {
    return new Response(
      jsonKST({ ok: false, error: "id가 올바르지 않습니다.", step: "validate" }),
      { status: 400, headers: JSON_HEADER },
    );
  }

  try {
    const r: any = await db.execute(sql`
      SELECT status, total_recipients, success_count, failure_count, last_error
        FROM communication_send_jobs
       WHERE id = ${id}
       LIMIT 1
    `);
    const row = (r?.rows ?? r ?? [])[0];
    if (!row) {
      return new Response(
        jsonKST({ ok: false, error: "발송 작업을 찾을 수 없습니다.", step: "not_found" }),
        { status: 404, headers: JSON_HEADER },
      );
    }
    /* 버그픽스 #14: snake_case 컬럼을 camelCase 로 명시 정규화 + Number 강제
     *  (NULL 컬럼이 undefined 로 흘러 클라이언트 카운트가 0 으로 표시되던 문제 차단).
     *  pendingCount(미발송) 도 응답에 포함 — 설계서 표준 키. */
    let totalRecipients = Number(row.total_recipients) || 0;
    /* 버그픽스2 #14: total_recipients 컬럼이 아직 갱신 안 됐거나 0 이면
     *  실제 수신자 행을 COUNT 으로 보정 — "발송 상세 전부 0" 차단. */
    if (totalRecipients === 0) {
      try {
        const cr: any = await db.execute(sql`
          SELECT COUNT(*)::int AS n
            FROM communication_send_recipients
           WHERE job_id = ${id}
        `);
        totalRecipients = Number((cr?.rows ?? cr ?? [])[0]?.n) || 0;
      } catch (e) {
        console.warn("[admin-send-job-progress] 수신자 COUNT 보정 실패", e);
      }
    }
    const successCount = Number(row.success_count) || 0;
    const failureCount = Number(row.failure_count) || 0;
    const done = successCount + failureCount;
    const pendingCount = Math.max(0, totalRecipients - done);
    const progressPercent = totalRecipients > 0 ? Math.round((done / totalRecipients) * 1000) / 10 : 0;
    return new Response(
      jsonKST({
        ok: true,
        progress: {
          status: row.status,
          totalRecipients,
          successCount,
          failureCount,
          pendingCount,
          progressPercent,
          lastError: row.last_error,
        },
      }),
      { status: 200, headers: JSON_HEADER },
    );
  } catch (err: any) {
    return jsonError("select_progress", err);
  }
}
