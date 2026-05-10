import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-finance-tables" };

export default async function handler(req: Request, _ctx: Context) {
  const url = new URL(req.url);
  const run = url.searchParams.get("run");

  // 진단 모드 (인증 불필요)
  if (!run) {
    return new Response(
      JSON.stringify({
        ok: true,
        mode: "diagnostic",
        description: "Phase 6 재정 관리 테이블 3개 생성 + 초기 카테고리 5개 INSERT",
        tables: ["budget_categories", "budgets", "expenditures"],
        action: "GET ?run=1 (어드민 로그인 필요) 로 실행",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  const steps: string[] = [];

  try {
    // 1. budget_categories
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS budget_categories (
        id          SERIAL PRIMARY KEY,
        name        VARCHAR(50)  NOT NULL,
        code        VARCHAR(20)  UNIQUE NOT NULL,
        description TEXT,
        is_active   BOOLEAN      DEFAULT TRUE,
        created_at  TIMESTAMP    DEFAULT NOW()
      )
    `);
    steps.push("budget_categories 테이블 생성 완료");

    // 2. budgets
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS budgets (
        id              SERIAL PRIMARY KEY,
        fiscal_year     INTEGER      NOT NULL,
        category_id     INTEGER      REFERENCES budget_categories(id),
        planned_amount  NUMERIC(12,0) NOT NULL,
        note            TEXT,
        created_by      INTEGER,
        created_at      TIMESTAMP    DEFAULT NOW(),
        UNIQUE(fiscal_year, category_id)
      )
    `);
    steps.push("budgets 테이블 생성 완료");

    // 3. expenditures
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS expenditures (
        id            SERIAL PRIMARY KEY,
        category_id   INTEGER      REFERENCES budget_categories(id),
        amount        NUMERIC(12,0) NOT NULL,
        spent_at      DATE          NOT NULL,
        description   VARCHAR(500)  NOT NULL,
        payee         VARCHAR(100),
        status        VARCHAR(20)   DEFAULT 'draft',
        receipt_url   TEXT,
        created_by    INTEGER,
        approved_by   INTEGER,
        approved_at   TIMESTAMP,
        note          TEXT,
        created_at    TIMESTAMP    DEFAULT NOW()
      )
    `);
    steps.push("expenditures 테이블 생성 완료");

    // 4. 초기 카테고리 5개 (중복 방지)
    await db.execute(sql`
      INSERT INTO budget_categories (name, code, description)
      VALUES
        ('심리상담', 'psych',   '심리상담사 지원 사업 관련 비용'),
        ('법률지원', 'legal',   '법률 지원 및 소송 관련 비용'),
        ('장학사업', 'scholar', '자녀 장학금 및 교육 지원 비용'),
        ('운영비',   'ops',     '단체 운영·행정·인건비'),
        ('홍보',     'pr',      '캠페인·홍보·행사 비용')
      ON CONFLICT (code) DO NOTHING
    `);
    steps.push("초기 카테고리 5개 삽입 완료 (중복 무시)");

    return new Response(
      JSON.stringify({ ok: true, steps }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "재정 테이블 마이그레이션 실패",
        steps,
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
