/**
 * 뉴스·여론 보고서 목록 API
 *
 * GET /api/admin-org-news-list?limit=60  — admin
 *
 * 반환: 최신순, 요약 필드만 (summaryShort·sentimentLabel)
 */

import type { Context } from "@netlify/functions";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-org-news-list" };

function jsonError(step: string, err: any) {
  return Response.json(
    {
      ok: false,
      error: "보고서 목록 조회 오류",
      step,
      detail: String(err?.message || err).slice(0, 500),
      stack:  String(err?.stack   || "").slice(0, 1000),
    },
    { status: 500 },
  );
}

export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "GET") {
    return Response.json({ ok: false, error: "GET 전용" }, { status: 405 });
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const url   = new URL(req.url);
  const limit = Math.min(Math.max(1, Number(url.searchParams.get("limit") || 60)), 200);

  try {
    const r: any = await db.execute(sql`
      SELECT id, keywords, scopes, collected_count,
             summary, sentiment, ai_status, trigger_type, generated_by,
             created_at
        FROM org_news_reports
       ORDER BY created_at DESC
       LIMIT ${limit}
    `);
    const rows = (r?.rows ?? r ?? []) as any[];

    const reports = rows.map(row => ({
      id:             Number(row.id),
      keywords:       row.keywords      || [],
      scopes:         row.scopes        || [],
      collectedCount: Number(row.collected_count) || 0,
      /* 요약 앞 120자 */
      summaryShort:   String(row.summary || "").slice(0, 120),
      sentimentLabel: (row.sentiment as any)?.label || "neutral",
      aiStatus:       row.ai_status    || "partial",
      triggerType:    row.trigger_type || "manual",
      generatedBy:    row.generated_by || null,
      createdAt:      row.created_at   || null,
    }));

    return Response.json({ ok: true, data: { reports } });
  } catch (err) {
    return jsonError("select", err);
  }
}
