/**
 * GET /api/migrate-budget-hierarchy       — 진단 (인증 불필요·readonly)
 * GET /api/migrate-budget-hierarchy?run=1 — 실행 (super_admin 인증)
 *
 * 배치 1 — 예산안 구조 고도화: 관(款)-항(項)-목(目) 3계층 예산과목 도입.
 *
 * 만드는 것 (모두 멱등 · IF NOT EXISTS / ON CONFLICT):
 *   1) budget_accounts          예산과목 트리 (level 관/항/목, parent_id 자기참조)
 *   2) budget_account_code_map  목 ↔ 회계 계정과목(account_codes.code) 연결 (다대다)
 *   3) budget_lines.budget_account_id / expenses.budget_account_id  (목 참조 컬럼 추가·nullable)
 *   4) 표준 관-항-목 시드 (인건비/사업비/관리운영비/모금비 4관 + 표준 항·목 + 관별 '기타>미분류')
 *   5) 기존 편성·지출 무손실 백필: 현재 대분류(expense_categories.code)를 해당 관의 '미분류' 목에 연결
 *
 * 안전:
 *   - 기존 account_codes / vouchers / bank_transactions 는 건드리지 않음 (A안: 계정과목 유지·연결)
 *   - budget_lines.category_id / expenses.category_id 는 그대로 유지 (신규 컬럼만 추가)
 *   - 재실행해도 중복 시드·중복 백필 없음
 *
 * 실행 성공 후: schema.ts 정의 활성화 + 이 파일 삭제 + commit (§6.8 1회용).
 */
import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-budget-hierarchy" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

/* 표준 관-항-목 시드 (운영자가 이후 CMS 트리 편집기에서 항·목 추가·재분류) */
const TREE: {
  code: string; name: string; ecCode: string;
  hang: { code: string; name: string; mok: [string, string][] }[];
}[] = [
  { code: "1", name: "인건비", ecCode: "personnel", hang: [
    { code: "1-1", name: "급여",     mok: [["1-1-01","기본급"],["1-1-02","상여금"],["1-1-03","제수당"]] },
    { code: "1-2", name: "복리후생", mok: [["1-2-01","4대보험"],["1-2-02","복리후생비"]] },
    { code: "1-9", name: "기타",     mok: [["1-9-99","미분류"]] },
  ]},
  { code: "2", name: "사업비", ecCode: "program", hang: [
    { code: "2-1", name: "유가족지원", mok: [["2-1-01","심리상담비"],["2-1-02","장학금"],["2-1-03","긴급생계비"]] },
    { code: "2-2", name: "사건대응",   mok: [["2-2-01","법률자문비"],["2-2-02","활동비"]] },
    { code: "2-9", name: "기타",       mok: [["2-9-99","미분류"]] },
  ]},
  { code: "3", name: "관리운영비", ecCode: "admin_ops", hang: [
    { code: "3-1", name: "사무운영",   mok: [["3-1-01","임차료"],["3-1-02","공과금"],["3-1-03","사무용품비"],["3-1-04","통신비"]] },
    { code: "3-2", name: "지급수수료", mok: [["3-2-01","지급수수료"],["3-2-02","회의비"]] },
    { code: "3-9", name: "기타",       mok: [["3-9-99","미분류"]] },
  ]},
  { code: "4", name: "모금비", ecCode: "fundraising", hang: [
    { code: "4-1", name: "모금활동", mok: [["4-1-01","홍보비"],["4-1-02","캠페인비"]] },
    { code: "4-9", name: "기타",     mok: [["4-9-99","미분류"]] },
  ]},
];

const esc = (s: string) => s.replace(/'/g, "''");
async function rows(q: string): Promise<any[]> {
  const r: any = await db.execute(sql.raw(q));
  return r?.rows ?? r ?? [];
}

export default async function handler(req: Request, _ctx: Context) {
  let step = "start";
  try {
    const url = new URL(req.url);
    const run = url.searchParams.get("run") === "1";

    /* ── 진단 (현재 상태) ── */
    step = "diag";
    const tableExists = (await rows(`SELECT to_regclass('public.budget_accounts') IS NOT NULL AS e`))[0]?.e === true;
    const ecList = await rows(`SELECT id, code, name FROM expense_categories WHERE is_active = TRUE ORDER BY sort_order, id`);
    const acCount = (await rows(`SELECT COUNT(*)::int AS n FROM account_codes`))[0]?.n || 0;
    const blCount = (await rows(`SELECT COUNT(*)::int AS n FROM budget_lines`))[0]?.n || 0;
    const exCount = (await rows(`SELECT COUNT(*)::int AS n FROM expenses`))[0]?.n || 0;
    const baCount = tableExists ? ((await rows(`SELECT COUNT(*)::int AS n FROM budget_accounts`))[0]?.n || 0) : 0;

    if (!run) {
      return new Response(JSON.stringify({
        ok: true, mode: "diagnose",
        budgetAccountsTableExists: tableExists,
        seededAccounts: baCount,
        currentExpenseCategories: ecList,
        accountCodes: acCount,
        budgetLines: blCount,
        expenses: exCount,
        plan: [
          "budget_accounts / budget_account_code_map 테이블 생성",
          "budget_lines·expenses 에 budget_account_id 컬럼 추가",
          `표준 관-항-목 시드 (관 ${TREE.length}개 + 항·목)`,
          "기존 편성·지출을 각 관의 '미분류(X-9-99)' 목에 연결(무손실)",
        ],
        hint: "?run=1 로 실행 (super_admin 인증).",
      }, null, 2), { headers: JSON_HEADER });
    }

    /* ── 실행 ── */
    step = "auth";
    const auth = await requireAdmin(req);
    if (!auth.ok) return (auth as any).res;

    /* 1) 테이블 생성 */
    step = "create_budget_accounts";
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS budget_accounts (
        id         serial PRIMARY KEY,
        level      varchar(4)  NOT NULL,
        parent_id  integer     REFERENCES budget_accounts(id) ON DELETE RESTRICT,
        code       varchar(30) NOT NULL UNIQUE,
        name       varchar(120) NOT NULL,
        sort_order integer     NOT NULL DEFAULT 0,
        is_active  boolean     NOT NULL DEFAULT TRUE,
        is_system  boolean     NOT NULL DEFAULT FALSE,
        created_at timestamptz NOT NULL DEFAULT NOW(),
        updated_at timestamptz NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS budget_accounts_parent_idx ON budget_accounts(parent_id);
      CREATE INDEX IF NOT EXISTS budget_accounts_level_idx  ON budget_accounts(level);
    `));

    step = "create_code_map";
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS budget_account_code_map (
        id                serial PRIMARY KEY,
        budget_account_id integer NOT NULL REFERENCES budget_accounts(id) ON DELETE CASCADE,
        account_code      varchar(20) NOT NULL,
        UNIQUE (budget_account_id, account_code)
      );
      CREATE INDEX IF NOT EXISTS bacm_account_code_idx ON budget_account_code_map(account_code);
      CREATE INDEX IF NOT EXISTS bacm_ba_idx           ON budget_account_code_map(budget_account_id);
    `));

    /* 2) 참조 컬럼 추가 (nullable — 레거시 호환) */
    step = "add_columns";
    await db.execute(sql.raw(`
      ALTER TABLE budget_lines ADD COLUMN IF NOT EXISTS budget_account_id integer REFERENCES budget_accounts(id);
      ALTER TABLE expenses     ADD COLUMN IF NOT EXISTS budget_account_id integer REFERENCES budget_accounts(id);
      CREATE INDEX IF NOT EXISTS budget_lines_ba_idx ON budget_lines(budget_account_id);
      CREATE INDEX IF NOT EXISTS expenses_ba_idx     ON expenses(budget_account_id);
    `));

    /* 3) 시드 — 관 → 항 → 목 순서로 삽입, 각 단계 후 code→id 매핑 재조회 */
    step = "seed_gwan";
    for (let i = 0; i < TREE.length; i++) {
      const g = TREE[i];
      await db.execute(sql.raw(`
        INSERT INTO budget_accounts (level, parent_id, code, name, sort_order, is_system)
        VALUES ('관', NULL, '${esc(g.code)}', '${esc(g.name)}', ${i}, TRUE)
        ON CONFLICT (code) DO NOTHING;
      `));
    }
    step = "seed_hang";
    for (const g of TREE) {
      const gid = (await rows(`SELECT id FROM budget_accounts WHERE code = '${esc(g.code)}'`))[0]?.id;
      if (!gid) continue;
      for (let j = 0; j < g.hang.length; j++) {
        const h = g.hang[j];
        await db.execute(sql.raw(`
          INSERT INTO budget_accounts (level, parent_id, code, name, sort_order, is_system)
          VALUES ('항', ${gid}, '${esc(h.code)}', '${esc(h.name)}', ${j}, TRUE)
          ON CONFLICT (code) DO NOTHING;
        `));
      }
    }
    step = "seed_mok";
    for (const g of TREE) {
      for (const h of g.hang) {
        const hid = (await rows(`SELECT id FROM budget_accounts WHERE code = '${esc(h.code)}'`))[0]?.id;
        if (!hid) continue;
        for (let k = 0; k < h.mok.length; k++) {
          const [mcode, mname] = h.mok[k];
          await db.execute(sql.raw(`
            INSERT INTO budget_accounts (level, parent_id, code, name, sort_order, is_system)
            VALUES ('목', ${hid}, '${esc(mcode)}', '${esc(mname)}', ${k}, TRUE)
            ON CONFLICT (code) DO NOTHING;
          `));
        }
      }
    }

    /* 4) 기존 편성·지출 무손실 백필 → 각 관의 '미분류(X-9-99)' 목 */
    step = "backfill";
    const caseExpr = TREE.map(g => `WHEN '${esc(g.ecCode)}' THEN '${esc(g.code)}-9-99'`).join(" ");
    const mapCTE = `
      WITH mok AS (
        SELECT ec.id AS ec_id, ba.id AS ba_id
        FROM expense_categories ec
        JOIN budget_accounts ba
          ON ba.code = (CASE ec.code ${caseExpr} ELSE NULL END)
      )`;
    const blRes: any = await db.execute(sql.raw(`
      ${mapCTE}
      UPDATE budget_lines bl SET budget_account_id = mok.ba_id
      FROM mok
      WHERE bl.category_id = mok.ec_id AND bl.budget_account_id IS NULL;
    `));
    const exRes: any = await db.execute(sql.raw(`
      ${mapCTE}
      UPDATE expenses e SET budget_account_id = mok.ba_id
      FROM mok
      WHERE e.category_id = mok.ec_id AND e.budget_account_id IS NULL;
    `));

    step = "done";
    const seeded = (await rows(`SELECT level, COUNT(*)::int AS n FROM budget_accounts GROUP BY level`));
    return new Response(JSON.stringify({
      ok: true, mode: "executed",
      seededByLevel: seeded,
      backfilledBudgetLines: blRes?.rowCount ?? null,
      backfilledExpenses: exRes?.rowCount ?? null,
      hint: "완료. 이제 메인 채팅에 알려주세요 → schema.ts 정의 활성화 + 예산 API·CMS 트리 화면 개발 계속. 확인 후 이 파일 삭제.",
    }, null, 2), { headers: JSON_HEADER });
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false, error: "예산 관-항-목 마이그 실패", step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: JSON_HEADER });
  }
}
