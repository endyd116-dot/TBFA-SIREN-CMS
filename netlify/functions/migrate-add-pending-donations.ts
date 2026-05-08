/**
 * 6순위 #15 — 효성 + 기업은행 CSV 자동 매핑 1회용 마이그레이션
 *
 * 신규 테이블 2개:
 *   1. pending_donations         — CSV 행 미확정 적재
 *   2. donation_matching_rules   — 매칭 룰 가중치 (5건 기본 시드)
 *
 * 호출 (어드민 로그인 상태):
 *   https://tbfa-siren-cms.netlify.app/api/migrate-add-pending-donations?run=1
 *
 * 진단 (인증 불필요):
 *   https://tbfa-siren-cms.netlify.app/api/migrate-add-pending-donations
 *
 * ⚠️ 호출 성공 후 즉시 이 파일 삭제 + 커밋·푸시 (1회용 보안 원칙)
 *
 * 멱등: CREATE TABLE IF NOT EXISTS / INSERT ... ON CONFLICT DO NOTHING
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";

const TABLE_QUERIES: string[] = [
  /* 1. pending_donations */
  `CREATE TABLE IF NOT EXISTS pending_donations (
    id serial PRIMARY KEY,
    source varchar(20) NOT NULL,
    source_file_name varchar(200),
    source_row_index integer,
    raw_data jsonb DEFAULT '{}'::jsonb,
    parsed_name varchar(100),
    parsed_amount integer,
    parsed_date timestamp,
    parsed_memo text,
    parsed_account_tail4 varchar(4),
    matched_member_id integer REFERENCES members(id) ON DELETE SET NULL,
    match_score numeric(4,2),
    match_reason varchar(200),
    status varchar(20) NOT NULL DEFAULT 'pending',
    confirmed_donation_id integer REFERENCES donations(id) ON DELETE SET NULL,
    imported_by integer REFERENCES members(id) ON DELETE SET NULL,
    confirmed_by integer REFERENCES members(id) ON DELETE SET NULL,
    confirmed_at timestamp,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS pending_donations_source_idx ON pending_donations(source)`,
  `CREATE INDEX IF NOT EXISTS pending_donations_status_idx ON pending_donations(status)`,
  `CREATE INDEX IF NOT EXISTS pending_donations_matched_idx ON pending_donations(matched_member_id)`,
  `CREATE INDEX IF NOT EXISTS pending_donations_date_idx ON pending_donations(parsed_date)`,
  `CREATE INDEX IF NOT EXISTS pending_donations_created_idx ON pending_donations(created_at)`,

  /* 2. donation_matching_rules */
  `CREATE TABLE IF NOT EXISTS donation_matching_rules (
    id serial PRIMARY KEY,
    rule_key varchar(30) NOT NULL UNIQUE,
    weight numeric(4,2) NOT NULL DEFAULT 1.00,
    threshold numeric(4,2),
    is_active boolean NOT NULL DEFAULT true,
    description varchar(200),
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now()
  )`,
];

/* 매칭 룰 기본 시드 (멱등: ON CONFLICT(rule_key) DO NOTHING) */
const SEED_QUERIES: string[] = [
  `INSERT INTO donation_matching_rules (rule_key, weight, threshold, description) VALUES
    ('name_exact',    1.00, NULL, '회원명 완전일치 (공백·특수문자 제거 후)'),
    ('name_partial',  0.40, NULL, '회원명 부분일치 (성+이름 일부)'),
    ('amount_exact',  0.80, NULL, '금액 완전일치 (정기후원 약정금액 또는 직전 후원금액)'),
    ('date_window',   0.30, 7,    '날짜 ±N일 윈도우 (기본 7일)'),
    ('account_tail4', 0.50, NULL, '입금자 계좌 끝4자리 일치 (기업은행)')
   ON CONFLICT (rule_key) DO NOTHING`,
];

const EXPECTED_TABLES = ["pending_donations", "donation_matching_rules"];

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);

  if (req.method !== "GET") {
    return new Response(
      JSON.stringify({ ok: false, error: "GET 만 허용 (?run=1로 실행, 그 외 진단)" }),
      { status: 405, headers: { "Content-Type": "application/json" } }
    );
  }

  const runFlag = url.searchParams.get("run");

  /* GET ?run=1 : 어드민 세션으로 즉시 실행 */
  if (runFlag === "1") {
    const auth = await requireAdmin(req);
    if (!auth.ok) return auth.res;

    const start = Date.now();
    const results: Array<{ sql: string; ok: boolean; error?: string }> = [];
    const allQueries = [...TABLE_QUERIES, ...SEED_QUERIES];

    try {
      for (const q of allQueries) {
        try {
          await db.execute(sql.raw(q));
          results.push({ sql: q.replace(/\s+/g, " ").slice(0, 90) + "...", ok: true });
        } catch (err: any) {
          results.push({
            sql: q.replace(/\s+/g, " ").slice(0, 90) + "...",
            ok: false,
            error: err?.message || String(err),
          });
        }
      }
      const successCount = results.filter(r => r.ok).length;
      const allOk = successCount === allQueries.length;
      return new Response(JSON.stringify({
        ok: allOk,
        mode: "run",
        executor: (auth.ctx.member as any).name || (auth.ctx.member as any).email || "admin",
        total: allQueries.length,
        success: successCount,
        failed: allQueries.length - successCount,
        durationMs: Date.now() - start,
        results,
        nextAction: allOk
          ? "✅ 모두 성공. AI에게 결과를 알려주세요. AI가 자동으로 이 파일을 삭제·푸시합니다."
          : "⚠️ 일부 실패. results 확인 후 재시도 가능 (멱등 보장).",
      }, null, 2), {
        status: allOk ? 200 : 207,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err: any) {
      return new Response(JSON.stringify({
        ok: false, mode: "run", error: err?.message || "unknown", results,
      }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  }

  /* GET (기본) : 진단 */
  try {
    const tableRows: any = await db.execute(sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY(ARRAY['pending_donations','donation_matching_rules'])
    `);
    const tables = (Array.isArray(tableRows) ? tableRows : (tableRows as any).rows || [])
      .map((r: any) => r.table_name);

    let ruleCount = 0;
    if (tables.includes("donation_matching_rules")) {
      const cntRows: any = await db.execute(sql`SELECT COUNT(*)::int AS c FROM donation_matching_rules`);
      ruleCount = (Array.isArray(cntRows) ? cntRows : (cntRows as any).rows || [])[0]?.c ?? 0;
    }

    return new Response(JSON.stringify({
      ok: true,
      mode: "diagnose",
      csv_mapping: {
        status: tables.length === 2 && ruleCount >= 5
          ? "✅ 완료"
          : `⚠️ 미완료 (테이블 ${tables.length}/2, 룰 ${ruleCount}/5)`,
        existing_tables: tables,
        missing_tables: EXPECTED_TABLES.filter(t => !tables.includes(t)),
        seeded_rules: ruleCount,
      },
      howToMigrate: "어드민 로그인된 상태에서 주소창에 ?run=1 붙여 호출: /api/migrate-add-pending-donations?run=1",
    }, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false, mode: "diagnose", error: err?.message || String(err),
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};

export const config = { path: "/api/migrate-add-pending-donations" };
