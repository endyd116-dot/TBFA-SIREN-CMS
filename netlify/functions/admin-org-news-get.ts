/**
 * 뉴스·여론 보고서 단건 조회 API
 *
 * GET /api/admin-org-news-get?id=N  — admin (id 없으면 최신 1건)
 */

import { jsonRes } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-org-news-get" };

function jsonError(step: string, err: any) {
  return jsonRes(
    {
      ok: false,
      error: "보고서 조회 오류",
      step,
      detail: String(err?.message || err).slice(0, 500),
      stack:  String(err?.stack   || "").slice(0, 1000),
    },
    { status: 500 },
  );
}

export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "GET") {
    return jsonRes({ ok: false, error: "GET 전용" }, { status: 405 });
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const url = new URL(req.url);
  const idParam = url.searchParams.get("id");

  try {
    let r: any;
    if (idParam) {
      r = await db.execute(sql`
        SELECT * FROM org_news_reports WHERE id = ${Number(idParam)} LIMIT 1
      `);
    } else {
      r = await db.execute(sql`
        SELECT * FROM org_news_reports ORDER BY created_at DESC LIMIT 1
      `);
    }

    const row = (r?.rows ?? r ?? [])[0];
    if (!row) {
      return jsonRes({ ok: false, error: "보고서 없음" }, { status: 404 });
    }

    return jsonRes({
      ok: true,
      data: {
        id:              Number(row.id),
        keywords:        row.keywords        || [],
        scopes:          row.scopes          || [],
        perCombo:        row.per_combo       || 20,
        collectedCount:  Number(row.collected_count) || 0,
        items:           row.items           || [],
        summary:         row.summary         || "",
        keywordCloud:    row.keyword_cloud   || [],
        sentiment:       row.sentiment       || {},
        recommendations: row.recommendations || [],
        diffSummary:     row.diff_summary    || "",
        aiStatus:        row.ai_status       || "partial",
        incidents:       row.incidents       || [],
        triggerType:     row.trigger_type    || "manual",
        generatedBy:     row.generated_by    || null,
        createdAt:       row.created_at      || null,
      },
    });
  } catch (err) {
    return jsonError("select", err);
  }
}
