// netlify/functions/admin-send-job-recipients.ts
// Phase 10 R3 — 작업의 수신자 목록 (status 필터·페이지네이션)

import { isoUTC, jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import { resolveRecipients } from "../../lib/recipient-resolve";

export const config = { path: "/api/admin-send-job-recipients" };

const JSON_HEADER = { "Content-Type": "application/json" };

const VALID_STATUS = ["pending", "sending", "sent", "failed", "cancelled"];

function jsonError(step: string, err: any) {
  return new Response(
    jsonKST({
      ok: false,
      error: "수신자 목록 조회 실패",
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
  const status = url.searchParams.get("status") || "";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "100", 10), 500);
  const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10), 0);

  if (!Number.isInteger(id) || id <= 0) {
    return new Response(
      jsonKST({ ok: false, error: "id가 올바르지 않습니다.", step: "validate" }),
      { status: 400, headers: JSON_HEADER },
    );
  }

  let rows: any[] = [];
  let total = 0;

  try {
    const conditions: ReturnType<typeof sql>[] = [sql`r.job_id = ${id}`];
    if (status && VALID_STATUS.includes(status)) {
      conditions.push(sql`r.status = ${status}`);
    }
    const whereFragment = sql`WHERE ${conditions.reduce((a, b) => sql`${a} AND ${b}`)}`;

    const rowsRes: any = await db.execute(sql`
      SELECT r.id, r.member_id, r.channel, r.status, r.sent_at, r.error,
             r.retry_count, r.rendered_subject, r.created_at,
             m.name AS member_name, m.email AS member_email, m.phone AS member_phone
        FROM communication_send_recipients r
        LEFT JOIN members m ON m.id = r.member_id
        ${whereFragment}
        ORDER BY r.id ASC
        LIMIT ${limit} OFFSET ${offset}
    `);
    rows = (rowsRes?.rows ?? rowsRes ?? []).map((r: any) => ({
      id: r.id,
      memberId: r.member_id,
      memberName: r.member_name || null,
      memberEmail: r.member_email || null,
      memberPhone: r.member_phone || null,
      channel: r.channel,
      status: r.status,
      sentAt: isoUTC(r.sent_at),
      error: r.error,
      retryCount: r.retry_count,
      renderedSubject: r.rendered_subject,
      createdAt: isoUTC(r.created_at),
    }));

    const cntRes: any = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM communication_send_recipients r ${whereFragment}
    `);
    total = ((cntRes?.rows ?? cntRes)[0] ?? {}).n ?? 0;
  } catch (err: any) {
    return jsonError("select_recipients", err);
  }

  /* 2026-05-17: 작업이 'pending'이면 cron이 아직 수신자 스냅샷을 INSERT하지
     않은 상태 → recipients 0건 → 화면이 텅 비어 누구한테 보내는지 확인 불가.
     pending 상태일 때만 그룹 criteria로 미리보기 멤버 목록을 즉시 resolve해
     동일 형식으로 반환. isPreview=true 플래그로 클라이언트 식별 가능. */
  let isPreview = false;
  if (rows.length === 0 && offset === 0) {
    try {
      const jobRes: any = await db.execute(sql`
        SELECT status, channel, recipient_group_id, excluded_member_ids
          FROM communication_send_jobs WHERE id = ${id} LIMIT 1
      `);
      const job = (jobRes?.rows ?? jobRes ?? [])[0];
      if (job && job.status === "pending") {
        const grpRes: any = await db.execute(sql`
          SELECT criteria FROM recipient_groups WHERE id = ${job.recipient_group_id} LIMIT 1
        `);
        const group = (grpRes?.rows ?? grpRes ?? [])[0];
        if (group) {
          const resolved = await resolveRecipients(group.criteria, { limit: 0 });
          const excluded: number[] = Array.isArray(job.excluded_member_ids)
            ? job.excluded_member_ids.map((n: any) => Number(n)).filter((n: number) => Number.isInteger(n))
            : [];
          const exSet = new Set(excluded);
          const allIds = (resolved.memberIds || []).filter((mid: number) => !exSet.has(mid));
          total = allIds.length;
          const pageIds = allIds.slice(0, limit);
          if (pageIds.length > 0) {
            const idsLiteral = `ARRAY[${pageIds.map((n: number) => Number(n) || 0).join(",")}]::int[]`;
            const mRes: any = await db.execute(sql`
              SELECT id, name, email, phone FROM members WHERE id = ANY(${sql.raw(idsLiteral)})
            `);
            const mMap = new Map<number, any>();
            for (const m of (mRes?.rows ?? mRes ?? [])) mMap.set(m.id, m);
            rows = pageIds.map((mid: number) => {
              const m = mMap.get(mid) || {};
              return {
                id: null,
                memberId: mid,
                memberName: m.name || null,
                memberEmail: m.email || null,
                memberPhone: m.phone || null,
                channel: job.channel,
                status: "pending",
                sentAt: null,
                error: null,
                retryCount: 0,
                renderedSubject: null,
                createdAt: null,
              };
            });
            isPreview = true;
          }
        }
      }
    } catch (err) {
      console.warn("[recipients] pending preview 실패:", err);
      /* 미리보기 실패는 본 응답에 영향 X — 빈 recipients로 응답 */
    }
  }

  return new Response(
    jsonKST({ ok: true, recipients: rows, total, isPreview }),
    { status: 200, headers: JSON_HEADER },
  );
}
