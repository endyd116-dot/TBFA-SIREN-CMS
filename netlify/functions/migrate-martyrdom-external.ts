// netlify/functions/migrate-martyrdom-external.ts
// R43 딥릴리프 데이터 축적 하이브리드 — 1회용 마이그레이션 (멱등).
//
//   1) martyrdom_external_research (외부 자료 신규 테이블) CREATE IF NOT EXISTS
//   2) martyrdom_external_settings (화이트리스트·기본 검색어) CREATE IF NOT EXISTS
//   3) martyrdom_external_settings 1행 시드 (화이트리스트 19개 도메인 + 기본 검색어 5종)
//   4) ai_feature_settings에 'martyrdom_ai_external' 시드 (월 cap $30·enabled=true)
//   5) role_permissions에 'martyrdom_external_review' 시드 (admin ON·operator OFF)
//
// 사용:
//   GET  /api/migrate-martyrdom-external           — 진단(인증 불필요)
//   GET  /api/migrate-martyrdom-external?run=1     — 실행(어드민 세션 필요)
//
// 호출 성공 후 즉시 파일 삭제 + 커밋. (CLAUDE.md §6.8 1회용 보안 원칙)

import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-martyrdom-external" };

const WHITELIST_DOMAINS_SEED = [
  /* 정부·공공기관 */
  "gov.kr", "moe.go.kr", "moel.go.kr", "mpm.go.kr", "geps.or.kr",
  /* 법원·법제처 */
  "scourt.go.kr", "glaw.scourt.go.kr", "casenote.kr", "law.go.kr",
  /* 주요 언론 */
  "kbs.co.kr", "imnews.imbc.com", "news.sbs.co.kr", "yna.co.kr",
  "hani.co.kr", "joongang.co.kr", "chosun.com", "jtbc.co.kr",
  "mk.co.kr", "hankyung.com",
];

const DEFAULT_QUERIES_SEED = [
  "교사 순직 인정",
  "공무상 사망 인정 판례",
  "교사 공무상 재해 인정",
  "교권 침해 사망 사건",
  "공무원 순직 인정 기준",
];

function jsonOk(body: any) {
  return new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
function jsonError(status: number, error: string, detail?: any) {
  return new Response(JSON.stringify({ ok: false, error, detail }, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export default async (req: Request) => {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  if (!run) {
    /* 진단 모드 — 인증 불필요 + 현재 상태 조회 */
    const diag: any = { mode: "diagnostic", tables: {}, seeds: {} };
    try {
      const tr: any = await db.execute(sql`
        SELECT table_name FROM information_schema.tables
         WHERE table_schema='public' AND table_name IN
               ('martyrdom_external_research','martyrdom_external_settings')
      `);
      const rows = (tr?.rows ?? tr ?? []) as any[];
      diag.tables.martyrdom_external_research = rows.some(r => r.table_name === "martyrdom_external_research");
      diag.tables.martyrdom_external_settings = rows.some(r => r.table_name === "martyrdom_external_settings");
    } catch (e: any) { diag.tables.error = String(e?.message || e).slice(0, 200); }
    try {
      const sr: any = await db.execute(sql`SELECT COUNT(*)::int AS n FROM martyrdom_external_settings`);
      diag.seeds.settingsRows = Number((sr?.rows ?? sr ?? [])[0]?.n) || 0;
    } catch { diag.seeds.settingsRows = "(table missing)"; }
    try {
      const fr: any = await db.execute(sql`SELECT enabled, monthly_budget_usd::float AS budget FROM ai_feature_settings WHERE feature_key='martyrdom_ai_external' LIMIT 1`);
      diag.seeds.aiFeature = (fr?.rows ?? fr ?? [])[0] || null;
    } catch { diag.seeds.aiFeature = null; }
    try {
      const pr: any = await db.execute(sql`SELECT admin_allowed, operator_allowed FROM role_permissions WHERE feature_key='martyrdom_external_review' LIMIT 1`);
      diag.seeds.rolePerm = (pr?.rows ?? pr ?? [])[0] || null;
    } catch { diag.seeds.rolePerm = null; }
    return jsonOk({
      ok: true,
      ...diag,
      hint: "실행하려면 ?run=1 을 붙이세요 (어드민 세션 필요).",
      willDo: [
        "CREATE TABLE IF NOT EXISTS martyrdom_external_research (수집·검토용 외부 자료)",
        "CREATE TABLE IF NOT EXISTS martyrdom_external_settings (화이트리스트·기본 검색어)",
        "INSERT INTO martyrdom_external_settings (whitelist 19·queries 5) IF empty",
        "INSERT INTO ai_feature_settings 'martyrdom_ai_external' (월 $30·enabled=true) ON CONFLICT DO NOTHING",
        "INSERT INTO role_permissions 'martyrdom_external_review' (admin ON·operator OFF) ON CONFLICT DO NOTHING",
      ],
    });
  }

  /* 실행 모드 — 어드민 인증 */
  const g = await requireAdmin(req);
  if (guardFailed(g)) return g.res;

  const summary: any = { tablesCreated: [], seeded: {}, warnings: [], appliedCount: 0 };

  /* 1) 외부 자료 테이블 */
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS martyrdom_external_research (
        id                serial PRIMARY KEY,
        title             varchar(500) NOT NULL,
        source_url        text,
        source_domain     varchar(200),
        search_engine     varchar(20)  NOT NULL,
        search_query      text,
        published_at      timestamptz,
        snippet           text,
        content_full      text,
        status            varchar(20)  NOT NULL DEFAULT 'pending',
        reviewed_by_uid   integer,
        reviewed_at       timestamptz,
        rejection_reason  text,
        promoted_case_id  integer,
        meta              jsonb,
        created_at        timestamptz NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS martyrdom_external_status_idx  ON martyrdom_external_research(status)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS martyrdom_external_engine_idx  ON martyrdom_external_research(search_engine)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS martyrdom_external_created_idx ON martyrdom_external_research(created_at)`);
    summary.tablesCreated.push("martyrdom_external_research");
    summary.appliedCount++;
  } catch (e: any) {
    summary.warnings.push(`외부 자료 테이블 생성 실패: ${e?.message || e}`);
  }

  /* 2) 설정 테이블 */
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS martyrdom_external_settings (
        id                 serial PRIMARY KEY,
        whitelist_domains  jsonb NOT NULL DEFAULT '[]'::jsonb,
        default_queries    jsonb NOT NULL DEFAULT '[]'::jsonb,
        last_cron_at       timestamptz
      )
    `);
    summary.tablesCreated.push("martyrdom_external_settings");
    summary.appliedCount++;
  } catch (e: any) {
    summary.warnings.push(`설정 테이블 생성 실패: ${e?.message || e}`);
  }

  /* 3) 설정 1행 시드 (멱등 — 이미 행이 있으면 스킵) */
  try {
    const cr: any = await db.execute(sql`SELECT COUNT(*)::int AS n FROM martyrdom_external_settings`);
    const cnt = Number((cr?.rows ?? cr ?? [])[0]?.n) || 0;
    if (cnt === 0) {
      const whitelistJson = JSON.stringify(WHITELIST_DOMAINS_SEED);
      const queriesJson   = JSON.stringify(DEFAULT_QUERIES_SEED);
      await db.execute(sql`
        INSERT INTO martyrdom_external_settings (whitelist_domains, default_queries, last_cron_at)
        VALUES (${whitelistJson}::jsonb, ${queriesJson}::jsonb, NULL)
      `);
      summary.seeded.settings = { whitelistDomains: WHITELIST_DOMAINS_SEED.length, defaultQueries: DEFAULT_QUERIES_SEED.length };
      summary.appliedCount++;
    } else {
      summary.seeded.settings = "exists (skip)";
    }
  } catch (e: any) {
    summary.warnings.push(`설정 시드 실패: ${e?.message || e}`);
  }

  /* 4) ai_feature_settings — martyrdom_ai_external */
  try {
    await db.execute(sql`
      INSERT INTO ai_feature_settings
        (feature_key, feature_name, category, description,
         enabled, monthly_budget_usd, sort_order, created_at, updated_at)
      VALUES
        ('martyrdom_ai_external', '딥릴리프 외부 자료 검색', 'cron_daily',
         '교사 순직 인정 외부 자료 수집(Gemini Search Grounding·네이버 검색)·매 2주 자동 수집',
         true, 30.00, 435, NOW(), NOW())
      ON CONFLICT (feature_key) DO NOTHING
    `);
    summary.seeded.aiFeature = "ensured (martyrdom_ai_external)";
    summary.appliedCount++;
  } catch (e: any) {
    summary.warnings.push(`ai_feature_settings 시드 실패: ${e?.message || e}`);
  }

  /* 5) role_permissions — martyrdom_external_review */
  try {
    await db.execute(sql`
      INSERT INTO role_permissions
        (feature_key, feature_label, category, admin_allowed, operator_allowed, updated_at)
      VALUES
        ('martyrdom_external_review', '딥릴리프 외부 자료 검토·승급', 'deeprelief', true, false, NOW())
      ON CONFLICT (feature_key) DO NOTHING
    `);
    summary.seeded.rolePerm = "ensured (martyrdom_external_review)";
    summary.appliedCount++;
  } catch (e: any) {
    summary.warnings.push(`role_permissions 시드 실패: ${e?.message || e}`);
  }

  return jsonOk({
    ok: true,
    mode: "executed",
    ...summary,
    hint: "성공이면 파일 즉시 삭제 + 커밋·푸시. (CLAUDE.md §6.8)",
  });
};
