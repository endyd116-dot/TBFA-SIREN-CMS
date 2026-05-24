import type { Context } from "@netlify/functions";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-org-news" };

/* ④ 교유협 뉴스·여론 분석 — 1회용 마이그레이션 (호출 성공 후 삭제)
   - org_news_reports : 보고서 행 누적(=히스토리)
   - org_news_settings: 단일 행(id=1) 키워드·범위·자동토글
   GET            : 진단(인증 불필요) — 테이블 존재 여부
   GET ?run=1     : requireAdmin 후 실제 생성(멱등 IF NOT EXISTS + 시드 ON CONFLICT) */

const SEED_KEYWORDS = [
  "교사유가족협의회", "박두용", "교유협",
  "교사 순직", "교사 사망", "공무상 재해", "교권 보호",
];

export default async function handler(req: Request, _ctx: Context) {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  // 진단 모드 (인증 불필요)
  if (!run) {
    try {
      const r: any = await db.execute(sql`
        SELECT
          to_regclass('public.org_news_reports')  IS NOT NULL AS reports,
          to_regclass('public.org_news_settings') IS NOT NULL AS settings
      `);
      const row = (r?.rows ?? r ?? [])[0] || {};
      return Response.json({ ok: true, mode: "diagnostic", exists: { reports: !!row.reports, settings: !!row.settings },
        hint: "생성하려면 어드민 로그인 후 ?run=1" });
    } catch (err: any) {
      return Response.json({ ok: false, error: String(err?.message || err).slice(0, 300) }, { status: 500 });
    }
  }

  // 실행 모드 (어드민 인증)
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const done: string[] = [];
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS org_news_reports (
        id              SERIAL PRIMARY KEY,
        generated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        trigger_type    VARCHAR(10) NOT NULL DEFAULT 'manual',
        generated_by    INTEGER,
        period_from     DATE,
        period_to       DATE,
        keywords        JSONB NOT NULL DEFAULT '[]'::jsonb,
        source_count    INTEGER NOT NULL DEFAULT 0,
        sources         JSONB NOT NULL DEFAULT '[]'::jsonb,
        summary         TEXT,
        keyword_cloud   JSONB NOT NULL DEFAULT '[]'::jsonb,
        sentiment       JSONB,
        recommendations JSONB NOT NULL DEFAULT '[]'::jsonb,
        diff_summary    TEXT,
        ai_model        VARCHAR(60),
        status          VARCHAR(10) NOT NULL DEFAULT 'ok',
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    done.push("org_news_reports");

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS org_news_reports_gen_idx ON org_news_reports (generated_at DESC)
    `);
    done.push("org_news_reports_gen_idx");

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS org_news_settings (
        id           INTEGER PRIMARY KEY DEFAULT 1,
        keywords     JSONB NOT NULL DEFAULT '[]'::jsonb,
        scopes       JSONB NOT NULL DEFAULT '["news","blog","webkr"]'::jsonb,
        auto_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT org_news_settings_singleton CHECK (id = 1)
      )
    `);
    done.push("org_news_settings");

    await db.execute(sql`
      INSERT INTO org_news_settings (id, keywords)
      VALUES (1, ${JSON.stringify(SEED_KEYWORDS)}::jsonb)
      ON CONFLICT (id) DO NOTHING
    `);
    done.push("seed_settings");

    return Response.json({ ok: true, mode: "run", created: done });
  } catch (err: any) {
    return Response.json({ ok: false, error: String(err?.message || err).slice(0, 500), done }, { status: 500 });
  }
}
