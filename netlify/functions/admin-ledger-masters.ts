/**
 * GET /api/admin-ledger-masters?year=2026
 * 장부 화면과 전표 작성 창이 쓰는 기준 정보 묶음.
 */
import { jsonKST, yearKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";
import { ORG_BIZ_NO } from "../../lib/ledger-auto";
import { LEDGER_FUNCTIONS } from "../../lib/ledger-post";
import { charterGap, loadFiscalYears } from "../../lib/ledger-report";
import { loadAllocationRules } from "../../lib/ledger-settlement";

export const config = { path: "/api/admin-ledger-masters" };

const rowsOf = (r: any): any[] => r?.rows ?? r ?? [];

function jsonError(step: string, err: any) {
  return new Response(jsonKST({
    ok: false, error: "장부 기준 정보 조회 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "GET") {
    return new Response(jsonKST({ ok: false, error: "GET 메서드만 허용" }),
      { status: 405, headers: { "Content-Type": "application/json" } });
  }
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  let step = "accounts";
  try {
    const accounts = rowsOf(await db.execute(sql`
      SELECT a.id, a.code, a.name, a.parent_code, a.category, a.kind, a.normal_side, a.statement_line,
             a.nature, a.default_function, a.system_role, a.is_active, a.sort_order,
             EXISTS (SELECT 1 FROM account_codes c WHERE c.parent_code = a.code) AS has_children,
             EXISTS (SELECT 1 FROM voucher_lines l WHERE l.account_code = a.code) AS used
        FROM account_codes a
       ORDER BY a.code`)).map((r: any) => ({
      id: Number(r.id), code: r.code, name: r.name, parentCode: r.parent_code, category: r.category,
      kind: r.kind, normalSide: r.normal_side, statementLine: r.statement_line, nature: r.nature,
      defaultFunction: r.default_function, systemRole: r.system_role, isActive: r.is_active,
      sortOrder: Number(r.sort_order), hasChildren: r.has_children === true, used: r.used === true,
    }));

    step = "programs";
    const programs = rowsOf(await db.execute(sql`
      SELECT p.id, p.code, p.name, p.segment, p.charter_ref, p.disclosure_code, p.description, p.is_active, p.sort_order,
             EXISTS (SELECT 1 FROM voucher_lines l WHERE l.program_id = p.id) AS used
        FROM ledger_programs p ORDER BY p.sort_order, p.code`)).map((r: any) => ({
      id: Number(r.id), code: r.code, name: r.name, segment: r.segment, charterRef: r.charter_ref,
      disclosureCode: r.disclosure_code, description: r.description, isActive: r.is_active,
      sortOrder: Number(r.sort_order), used: r.used === true,
    }));

    step = "funds";
    const funds = rowsOf(await db.execute(sql`
      SELECT f.id, f.code, f.name, f.restricted, f.is_system, f.is_active, f.sort_order,
             EXISTS (SELECT 1 FROM voucher_lines l WHERE l.fund_id = f.id) AS used
        FROM ledger_funds f ORDER BY f.sort_order, f.code`)).map((r: any) => ({
      id: Number(r.id), code: r.code, name: r.name, restricted: r.restricted, isSystem: r.is_system,
      isActive: r.is_active, sortOrder: Number(r.sort_order), used: r.used === true,
    }));

    step = "fiscal_years";
    const fiscalYears = await loadFiscalYears();

    /* 수입 분류 연결과 인건비 배부: 보조 조회 */
    let revenueCategories: any[] = [];
    let staff: any[] = [];
    let allocationRules: any[] = [];
    try {
      revenueCategories = rowsOf(await db.execute(sql`
        SELECT id, code, name, account_code FROM revenue_categories WHERE is_active = TRUE ORDER BY sort_order, id`))
        .map((r: any) => ({ id: Number(r.id), code: r.code, name: r.name, accountCode: r.account_code }));
      staff = rowsOf(await db.execute(sql`
        SELECT m.id, m.name, s.member_id AS allocated, s.function_code, s.program_id, s.fund_id, s.rule_id,
               (SELECT e.name FROM employment_contracts c JOIN contract_business_entities e ON e.id = c.entity_id
                 WHERE c.member_id = m.id AND c.status = 'completed' ORDER BY c.id DESC LIMIT 1) AS employer,
               (SELECT regexp_replace(COALESCE(e.biz_no, ''), '[^0-9]', '', 'g') FROM employment_contracts c JOIN contract_business_entities e ON e.id = c.entity_id
                 WHERE c.member_id = m.id AND c.status = 'completed' ORDER BY c.id DESC LIMIT 1) AS employer_biz_no
          FROM members m
          LEFT JOIN ledger_staff_allocations s ON s.member_id = m.id
         WHERE m.type = 'admin' AND m.status = 'active' AND m.operator_active = TRUE
         ORDER BY m.name`)).map((r: any) => ({
        memberId: Number(r.id), name: r.name, functionCode: r.function_code,
        employer: r.employer ?? null,
        /* 판단 기준은 lib/ledger-auto.ts collectPayroll과 같다 */
        inLedger: r.employer ? r.employer_biz_no === ORG_BIZ_NO : r.allocated != null,
        programId: r.program_id == null ? null : Number(r.program_id),
        fundId: r.fund_id == null ? null : Number(r.fund_id),
        ruleId: r.rule_id == null ? null : Number(r.rule_id),
      }));
      allocationRules = await loadAllocationRules();
    } catch (err: any) {
      console.warn("[ledger-masters] 수입 분류·배부 조회 실패:", err?.message);
    }

    /* 보조 지표: 실패해도 기준 정보는 그대로 응답 */
    let gap: any = null;
    try {
      const url = new URL(req.url);
      const year = Number(url.searchParams.get("year")) || yearKST();
      gap = await charterGap(year);
    } catch (err: any) {
      console.warn("[ledger-masters] 정관 근거 지표 실패:", err?.message);
    }

    return new Response(jsonKST({
      ok: true,
      data: { accounts, programs, funds, functions: LEDGER_FUNCTIONS, fiscalYears, charterGap: gap, revenueCategories, staff, allocationRules },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    return jsonError(step, err);
  }
}
