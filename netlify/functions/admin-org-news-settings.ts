/**
 * 뉴스·여론 분석 설정 API
 *
 * GET  /api/admin-org-news-settings  — admin: 현재 설정 반환 (없으면 기본값)
 * PUT  /api/admin-org-news-settings  — super_admin: 설정 UPSERT
 *
 * org_news_settings 테이블 (raw SQL — 신규 테이블, schema.ts 건드리지 않음)
 * 컬럼: id, keywords text[], scopes text[], per_combo int, auto_enabled bool,
 *       cron_hour_kst int, updated_at, updated_by int
 */

import type { Context } from "@netlify/functions";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-org-news-settings" };

const DEFAULT_SETTINGS = {
  keywords:    ["교사유가족협의회", "교권침해", "교사 순직", "사립학교 교권"],
  scopes:      ["news"],
  perCombo:    20,
  autoEnabled: true,
  cronHourKst: 9,
};

function jsonError(step: string, err: any) {
  return Response.json(
    {
      ok: false,
      error: "설정 처리 오류",
      step,
      detail: String(err?.message || err).slice(0, 500),
      stack:  String(err?.stack   || "").slice(0, 1000),
    },
    { status: 500 },
  );
}

async function getSettings() {
  try {
    const r: any = await db.execute(sql`
      SELECT keywords, scopes, per_combo, auto_enabled, cron_hour_kst, updated_at, updated_by
        FROM org_news_settings
       LIMIT 1
    `);
    const row = (r?.rows ?? r ?? [])[0];
    if (!row) return null;
    return {
      keywords:    row.keywords    || DEFAULT_SETTINGS.keywords,
      scopes:      row.scopes      || DEFAULT_SETTINGS.scopes,
      perCombo:    row.per_combo   ?? DEFAULT_SETTINGS.perCombo,
      autoEnabled: row.auto_enabled ?? DEFAULT_SETTINGS.autoEnabled,
      cronHourKst: row.cron_hour_kst ?? DEFAULT_SETTINGS.cronHourKst,
      updatedAt:   row.updated_at  || null,
      updatedBy:   row.updated_by  || null,
    };
  } catch {
    return null;
  }
}

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  const admin   = auth.ctx?.member as any;
  const isSuper = admin?.role === "super_admin";

  /* GET — 모든 어드민 */
  if (req.method === "GET") {
    try {
      const settings = await getSettings();
      return Response.json({
        ok:   true,
        data: settings ?? DEFAULT_SETTINGS,
      });
    } catch (err) {
      return jsonError("select", err);
    }
  }

  /* PUT — super_admin 전용 */
  if (req.method === "PUT") {
    if (!isSuper) {
      return Response.json({ ok: false, error: "슈퍼어드민 전용" }, { status: 403 });
    }

    let body: any;
    try { body = await req.json(); } catch {
      return Response.json({ ok: false, error: "JSON 파싱 실패" }, { status: 400 });
    }

    const keywords    = Array.isArray(body.keywords)    ? body.keywords    : DEFAULT_SETTINGS.keywords;
    const scopes      = Array.isArray(body.scopes)      ? body.scopes      : DEFAULT_SETTINGS.scopes;
    const perCombo    = Number(body.perCombo    ?? DEFAULT_SETTINGS.perCombo);
    const autoEnabled = body.autoEnabled != null ? Boolean(body.autoEnabled) : DEFAULT_SETTINGS.autoEnabled;
    const cronHourKst = Number(body.cronHourKst ?? DEFAULT_SETTINGS.cronHourKst);

    if (!keywords.length) {
      return Response.json({ ok: false, error: "keywords는 1개 이상 필요합니다" }, { status: 400 });
    }
    if (!scopes.length) {
      return Response.json({ ok: false, error: "scopes는 1개 이상 필요합니다" }, { status: 400 });
    }

    try {
      await db.execute(sql`
        INSERT INTO org_news_settings
          (id, keywords, scopes, per_combo, auto_enabled, cron_hour_kst, updated_at, updated_by)
        VALUES
          (1, ${keywords}, ${scopes}, ${perCombo}, ${autoEnabled}, ${cronHourKst}, NOW(), ${admin.id})
        ON CONFLICT (id) DO UPDATE SET
          keywords     = EXCLUDED.keywords,
          scopes       = EXCLUDED.scopes,
          per_combo    = EXCLUDED.per_combo,
          auto_enabled = EXCLUDED.auto_enabled,
          cron_hour_kst = EXCLUDED.cron_hour_kst,
          updated_at   = NOW(),
          updated_by   = EXCLUDED.updated_by
      `);
      return Response.json({ ok: true });
    } catch (err) {
      return jsonError("upsert", err);
    }
  }

  return Response.json({ ok: false, error: "지원하지 않는 메서드" }, { status: 405 });
}
