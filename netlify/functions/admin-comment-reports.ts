// netlify/functions/admin-comment-reports.ts
// 라운드 10 — 어드민 신고 목록 조회
//
// GET /api/admin-comment-reports?status=pending&page=1&limit=20
// 응답: { ok, reports:[{id, reportType, commentId, reason, status, reporterName, createdAt}], total }

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/admin-comment-reports" };

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function jsonError(step: string, err: any, status = 500) {
  return json({
    ok: false,
    error: "신고 목록 조회 실패",
    step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }, status);
}

const VALID_STATUS = new Set(["pending", "reviewed", "dismissed", "resolved"]);

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "GET") return json({ ok: false, error: "GET only" }, 405);

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  const url = new URL(req.url);
  const status = url.searchParams.get("status") || "";
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 20)));
  const offset = (page - 1) * limit;

  const useStatus = VALID_STATUS.has(status);

  try {
    // total
    const totalRes: any = useStatus
      ? await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM comment_reports WHERE status = ${status}`)
      : await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM comment_reports`);
    const total = Number((totalRes?.rows ?? totalRes)?.[0]?.cnt || 0);

    // list (separate query + JS map for reporter name)
    const listRes: any = useStatus
      ? await db.execute(sql`
          SELECT id, report_type, comment_id, incident_id, member_id, reason, status, created_at
          FROM comment_reports
          WHERE status = ${status}
          ORDER BY created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `)
      : await db.execute(sql`
          SELECT id, report_type, comment_id, incident_id, member_id, reason, status, created_at
          FROM comment_reports
          ORDER BY created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `);
    const rows = (listRes?.rows ?? listRes) as any[];

    // reporter name 매핑 (separate query + Map)
    const memberIds = Array.from(new Set(rows.map(r => r.member_id).filter((x: any) => x != null))) as number[];
    const nameMap = new Map<number, string>();
    if (memberIds.length > 0) {
      try {
        const memRes: any = await db.execute(sql`
          SELECT id, name FROM members WHERE id IN ${sql.raw(`(${memberIds.join(",")})`)}
        `);
        for (const m of (memRes?.rows ?? memRes) as any[]) {
          nameMap.set(Number(m.id), m.name || "");
        }
      } catch (e) { console.warn("[admin-comment-reports] name 조회 실패:", e); }
    }

    const reports = rows.map(r => ({
      id: r.id,
      reportType: r.report_type,
      commentId: r.comment_id,
      incidentId: r.incident_id,
      reason: r.reason,
      status: r.status,
      reporterName: r.member_id ? (nameMap.get(Number(r.member_id)) || null) : null,
      createdAt: r.created_at,
    }));

    return json({ ok: true, reports, total });
  } catch (err: any) {
    return jsonError("select", err);
  }
};
