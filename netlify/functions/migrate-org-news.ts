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
    /* ★ C 검증 fix(2026-05-24): 백엔드(naver-search·org-news-analyze·5엔드포인트·cron)가
       실제로 쓰는 컬럼·타입에 맞춤. 기존 설계 §4 스키마(source_count·sources·status·jsonb keywords)는
       서버 INSERT/SELECT(collected_count·items·ai_status·text[] keywords)와 어긋나 호출 시 전부 500이었음.
       keywords·scopes 는 서버가 raw 배열 바인딩(${'${'}keywords${'}'}) → text[]. items·keyword_cloud 등은 ::jsonb. */
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS org_news_reports (
        id              SERIAL PRIMARY KEY,
        keywords        TEXT[] NOT NULL DEFAULT '{}',
        scopes          TEXT[] NOT NULL DEFAULT '{}',
        per_combo       INTEGER NOT NULL DEFAULT 20,
        collected_count INTEGER NOT NULL DEFAULT 0,
        items           JSONB NOT NULL DEFAULT '[]'::jsonb,
        summary         TEXT,
        keyword_cloud   JSONB NOT NULL DEFAULT '[]'::jsonb,
        sentiment       JSONB,
        recommendations JSONB NOT NULL DEFAULT '[]'::jsonb,
        diff_summary    TEXT,
        ai_status       VARCHAR(10) NOT NULL DEFAULT 'partial',
        trigger_type    VARCHAR(10) NOT NULL DEFAULT 'manual',
        generated_by    INTEGER,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    done.push("org_news_reports");

    /* 옛 마이그가 이미 돈 경우(부분 테이블)를 위한 방어적 컬럼 추가 — 누락분만 채움(멱등). */
    await db.execute(sql`
      ALTER TABLE org_news_reports
        ADD COLUMN IF NOT EXISTS scopes          TEXT[]      NOT NULL DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS per_combo       INTEGER     NOT NULL DEFAULT 20,
        ADD COLUMN IF NOT EXISTS collected_count INTEGER     NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS items           JSONB       NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS ai_status       VARCHAR(10) NOT NULL DEFAULT 'partial'
    `);
    done.push("org_news_reports_columns");

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS org_news_reports_created_idx ON org_news_reports (created_at DESC)
    `);
    done.push("org_news_reports_created_idx");

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS org_news_settings (
        id            INTEGER PRIMARY KEY DEFAULT 1,
        keywords      TEXT[] NOT NULL DEFAULT '{}',
        scopes        TEXT[] NOT NULL DEFAULT ARRAY['news','blog','webkr'],
        per_combo     INTEGER NOT NULL DEFAULT 20,
        auto_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
        cron_hour_kst INTEGER NOT NULL DEFAULT 9,
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_by    INTEGER,
        CONSTRAINT org_news_settings_singleton CHECK (id = 1)
      )
    `);
    done.push("org_news_settings");

    await db.execute(sql`
      ALTER TABLE org_news_settings
        ADD COLUMN IF NOT EXISTS per_combo     INTEGER NOT NULL DEFAULT 20,
        ADD COLUMN IF NOT EXISTS cron_hour_kst INTEGER NOT NULL DEFAULT 9,
        ADD COLUMN IF NOT EXISTS updated_by    INTEGER
    `);
    done.push("org_news_settings_columns");

    await db.execute(sql`
      INSERT INTO org_news_settings (id, keywords)
      VALUES (1, ${SEED_KEYWORDS})
      ON CONFLICT (id) DO NOTHING
    `);
    done.push("seed_settings");

    return Response.json({ ok: true, mode: "run", created: done });
  } catch (err: any) {
    return Response.json({ ok: false, error: String(err?.message || err).slice(0, 500), done }, { status: 500 });
  }
}
