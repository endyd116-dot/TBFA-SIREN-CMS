/**
 * 1회용 마이그레이션: expenditures → expenses
 * - GET (기본): 진단 모드 — budget_categories 목록, expenditures/expenses 행 수, 카테고리 매핑 미리보기
 * - GET ?run=1 : requireAdmin 후 실행 모드 — 컬럼 매핑 + 카테고리 매핑 적용
 * 호출 성공 후 즉시 삭제할 것 (1회용 보안 원칙)
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-phase22b-expenditures-to-expenses" };

/**
 * budget_categories(옛) → expense_categories(22-C) 카테고리 매핑 테이블
 * 키: budget_categories.code, 값: expense_categories.code
 * 매핑 불가한 항목은 null → expense_categories에 isSystem=false로 신규 생성
 *
 * ⚠️ 진단 모드에서 실제 budget_categories 코드를 확인 후 아래 표를 보정할 것
 * (현재는 일반적인 Phase 5~7 카테고리 코드를 가정)
 */
const CATEGORY_CODE_MAP: Record<string, string | null> = {
  // 옛 budget_categories.code → expense_categories.code
  "personnel":    "personnel",    // 인건비
  "salary":       "personnel",    // 급여 → 인건비
  "program":      "program",      // 사업비
  "project":      "program",      // 프로그램 → 사업비
  "event":        "program",      // 행사 → 사업비
  "admin":        "admin_ops",    // 관리 → 관리운영비
  "admin_ops":    "admin_ops",    // 관리운영비
  "operations":   "admin_ops",    // 운영 → 관리운영비
  "office":       "admin_ops",    // 사무비 → 관리운영비
  "fundraising":  "fundraising",  // 모금비
  "marketing":    "fundraising",  // 마케팅 → 모금비
  // 매핑 불가 → null (expense_categories에 신규 생성됨)
};

export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ ok: false, error: "GET only" }), {
      status: 405, headers: { "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const runMode = url.searchParams.get("run") === "1";

  // ─── 진단 모드 (인증 불필요) ──────────────────────────────────────────────
  if (!runMode) {
    try {
      const budgetCatsR: any = await db.execute(sql`
        SELECT id, code, name, is_active
          FROM budget_categories
         ORDER BY id ASC
      `);
      const budgetCats: any[] = budgetCatsR?.rows ?? budgetCatsR ?? [];

      const expenseCatsR: any = await db.execute(sql`
        SELECT id, code, name, is_system, is_active
          FROM expense_categories
         ORDER BY id ASC
      `);
      const expenseCats: any[] = expenseCatsR?.rows ?? expenseCatsR ?? [];

      const expendCountR: any = await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM expenditures`);
      const expendCount = (expendCountR?.rows ?? expendCountR ?? [])[0]?.cnt ?? 0;

      const expenseCountR: any = await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM expenses`);
      const expenseCount = (expenseCountR?.rows ?? expenseCountR ?? [])[0]?.cnt ?? 0;

      const migratedR: any = await db.execute(sql`
        SELECT COUNT(*)::int AS cnt FROM expenses WHERE description LIKE '%[구지출이관]'
      `);
      const alreadyMigrated = (migratedR?.rows ?? migratedR ?? [])[0]?.cnt ?? 0;

      // 카테고리별 매핑 미리보기
      const mappingPreview = budgetCats.map((bc: any) => {
        const targetCode = CATEGORY_CODE_MAP[bc.code] ?? null;
        const targetCat = expenseCats.find((ec: any) => ec.code === targetCode);
        return {
          budgetCategoryId: bc.id,
          budgetCode: bc.code,
          budgetName: bc.name,
          mappedTo: targetCode,
          targetName: targetCat?.name ?? (targetCode ? "(expense_categories에 없음)" : "(신규 생성 예정)"),
          action: targetCat ? "기존 expense_category 사용" : (targetCode ? "expense_categories 코드 확인 필요" : "expense_categories에 신규 생성"),
        };
      });

      return new Response(JSON.stringify({
        ok: true,
        mode: "진단",
        summary: {
          expendituresTotal: Number(expendCount),
          expensesTotal: Number(expenseCount),
          alreadyMigrated: Number(alreadyMigrated),
          pendingMigration: Number(expendCount) - Number(alreadyMigrated),
        },
        budgetCategories: budgetCats,
        expenseCategories: expenseCats,
        categoryMappingPreview: mappingPreview,
        unmappedCodes: budgetCats.filter((bc: any) => !CATEGORY_CODE_MAP[bc.code]).map((bc: any) => bc.code),
        instruction: "카테고리 매핑이 올바르면 ?run=1 로 실행 (어드민 로그인 필요)",
      }, null, 2), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    } catch (err: any) {
      return new Response(JSON.stringify({
        ok: false, error: "진단 실패", step: "diagnose",
        detail: String(err?.message ?? err).slice(0, 500),
        stack: String(err?.stack ?? "").slice(0, 1000),
      }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  }

  // ─── 실행 모드 (?run=1, 어드민 인증 필요) ─────────────────────────────────
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  const results = {
    inserted: 0,
    skipped: 0,
    newCategoriesCreated: [] as string[],
    errors: [] as string[],
  };

  try {
    // 1. 현재 expense_categories 로드 (코드 → id 맵)
    const expCatR: any = await db.execute(sql`SELECT id, code FROM expense_categories`);
    const expCatRows: any[] = expCatR?.rows ?? expCatR ?? [];
    const expCatMap = new Map<string, number>(expCatRows.map((r: any) => [r.code, Number(r.id)]));

    // 2. budget_categories 로드
    const budCatR: any = await db.execute(sql`SELECT id, code, name FROM budget_categories`);
    const budCatRows: any[] = budCatR?.rows ?? budCatR ?? [];
    const budCatById = new Map<number, { code: string; name: string }>(
      budCatRows.map((r: any) => [Number(r.id), { code: r.code, name: r.name }])
    );

    // 3. 매핑 불가 카테고리 → expense_categories에 신규 생성
    for (const bc of budCatRows) {
      const targetCode = CATEGORY_CODE_MAP[bc.code];
      if (targetCode === undefined) {
        // CATEGORY_CODE_MAP에 없는 코드 → 신규 생성
        if (!expCatMap.has(bc.code)) {
          try {
            const newCatR: any = await db.execute(sql`
              INSERT INTO expense_categories (code, name, is_system, sort_order, is_active)
              VALUES (${bc.code}, ${bc.name}, false, 99, true)
              ON CONFLICT (code) DO NOTHING
              RETURNING id, code
            `);
            const newCat = (newCatR?.rows ?? newCatR ?? [])[0];
            if (newCat) {
              expCatMap.set(newCat.code, Number(newCat.id));
              results.newCategoriesCreated.push(`${bc.code} (${bc.name})`);
            } else {
              // ON CONFLICT DO NOTHING 발동 → 재조회
              const existR: any = await db.execute(sql`SELECT id FROM expense_categories WHERE code = ${bc.code}`);
              const existId = (existR?.rows ?? existR ?? [])[0]?.id;
              if (existId) expCatMap.set(bc.code, Number(existId));
            }
          } catch (e: any) {
            results.errors.push(`카테고리 생성 실패 (${bc.code}): ${String(e?.message).slice(0, 100)}`);
          }
        }
        // CATEGORY_CODE_MAP에 없으면 code를 그대로 사용 (위에서 생성했으므로)
        CATEGORY_CODE_MAP[bc.code] = bc.code;
      }
    }

    // 4. 아직 마이그되지 않은 expenditures 조회
    const expendR: any = await db.execute(sql`
      SELECT e.id, e.category_id, e.amount::numeric AS amount,
             e.spent_at, e.description, e.payee, e.status,
             e.receipt_url, e.created_by, e.approved_by, e.approved_at, e.note
        FROM expenditures e
       WHERE e.id NOT IN (
         SELECT (regexp_match(description, '\\[구지출이관:([0-9]+)\\]'))[1]::int
           FROM expenses
          WHERE description LIKE '%[구지출이관:%'
            AND (regexp_match(description, '\\[구지출이관:([0-9]+)\\]'))[1] IS NOT NULL
       )
       ORDER BY e.id ASC
    `);
    const expendRows: any[] = expendR?.rows ?? expendR ?? [];

    // 5. 행별 마이그레이션
    for (const ex of expendRows) {
      try {
        const budCat = budCatById.get(Number(ex.category_id));
        const oldCode = budCat?.code ?? null;
        const newCode = oldCode ? (CATEGORY_CODE_MAP[oldCode] ?? oldCode) : null;
        const newCategoryId = newCode ? (expCatMap.get(newCode) ?? null) : null;

        if (!newCategoryId) {
          results.errors.push(`expenditure id=${ex.id}: 카테고리 매핑 실패 (code=${oldCode})`);
          results.skipped++;
          continue;
        }

        // spent_at → occurred_at (date 타입, YYYY-MM-DD 변환)
        const spentAtDate = ex.spent_at
          ? new Date(ex.spent_at).toISOString().slice(0, 10)
          : null;
        if (!spentAtDate) {
          results.errors.push(`expenditure id=${ex.id}: spent_at 없음, 스킵`);
          results.skipped++;
          continue;
        }

        const fiscalYear = new Date(ex.spent_at).getFullYear();
        const amount = Math.round(Number(ex.amount));
        const status = (ex.status === "approved" || ex.status === "rejected") ? ex.status : "draft";

        // description: 기존 + note 합치기 + 마커
        const descParts = [ex.description, ex.note].filter(Boolean);
        const description = `${descParts.join(" / ")} [구지출이관:${ex.id}]`.trim();

        await db.execute(sql`
          INSERT INTO expenses (
            fiscal_year, occurred_at, category_id, amount,
            payee_name, description, receipt_url, status,
            refund_amount, recorded_by, approved_by, approved_at,
            created_at, updated_at
          )
          VALUES (
            ${fiscalYear}, ${spentAtDate}::date, ${newCategoryId}, ${amount},
            ${ex.payee ?? null}, ${description}, ${ex.receipt_url ?? null}, ${status},
            0, ${ex.created_by ?? null}, ${ex.approved_by ?? null},
            ${ex.approved_at ? new Date(ex.approved_at).toISOString() : null},
            NOW(), NOW()
          )
          ON CONFLICT DO NOTHING
        `);
        results.inserted++;
      } catch (e: any) {
        results.errors.push(`expenditure id=${ex.id}: ${String(e?.message).slice(0, 150)}`);
        results.skipped++;
      }
    }

    // 6. 결과 검증
    const finalCountR: any = await db.execute(sql`
      SELECT COUNT(*)::int AS cnt FROM expenses WHERE description LIKE '%[구지출이관:%'
    `);
    const finalMigratedCount = (finalCountR?.rows ?? finalCountR ?? [])[0]?.cnt ?? 0;

    return new Response(JSON.stringify({
      ok: true,
      mode: "실행",
      results: {
        ...results,
        totalMigratedInDB: Number(finalMigratedCount),
      },
      message: results.errors.length === 0
        ? `마이그레이션 완료: ${results.inserted}건 이관, 신규 카테고리 ${results.newCategoriesCreated.length}개`
        : `마이그레이션 완료 (일부 오류): ${results.inserted}건 성공, ${results.skipped}건 실패`,
    }, null, 2), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false, error: "마이그레이션 실패", step: "migrate",
      detail: String(err?.message ?? err).slice(0, 500),
      stack: String(err?.stack ?? "").slice(0, 1000),
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
