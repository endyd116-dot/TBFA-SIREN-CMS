/**
 * POST /api/admin-ledger-master-save
 * 사업·재원 추가·수정·숨김. 전표에 쓰인 항목은 지우지 않고 숨긴다.
 * body: { type: 'program'|'fund', id?, code?, name?, segment?, charterRef?, disclosureCode?,
 *         description?, restricted?, isActive?, sortOrder?, reason? }
 *       { type: 'revenue_category', id, accountCode }   수입 분류 ↔ 계정과목
 *       { type: 'staff', memberId, functionCode, programId?, fundId?, ruleId? }   인건비 배부. ruleId가 있으면 규칙 비율로 나눈다
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";
import { LedgerError, ledgerActor, ledgerErrorBody, recordHistory } from "../../lib/ledger-post";

export const config = { path: "/api/admin-ledger-master-save" };

const rowsOf = (r: any): any[] => r?.rows ?? r ?? [];
const text = (v: unknown, max: number): string | null => {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, max) : null;
};

async function saveProgram(tx: any, id: number, body: any, actor: any, reason: string | null) {
  const segment = body?.segment === "other" ? "other" : "public";
  if (!id) {
    const code = text(body?.code, 20);
    const name = text(body?.name, 120);
    if (!code || !/^[A-Za-z0-9_-]+$/.test(code)) throw new LedgerError("코드는 영문·숫자로 입력하세요.", 400);
    if (!name) throw new LedgerError("사업 이름을 입력하세요.", 400);
    const dup = rowsOf(await tx.execute(sql`SELECT id FROM ledger_programs WHERE code = ${code} LIMIT 1`));
    if (dup.length) throw new LedgerError(`이미 있는 코드입니다: ${code}`, 409);
    const row = rowsOf(await tx.execute(sql`
      INSERT INTO ledger_programs (code, name, segment, charter_ref, disclosure_code, description, sort_order)
      VALUES (${code}, ${name}, ${segment}, ${text(body?.charterRef, 30)}, ${text(body?.disclosureCode, 10)},
              ${text(body?.description, 500)}, ${Number(body?.sortOrder) || 999})
      RETURNING *`))[0];
    await recordHistory(tx, { entity: "program", entityId: row.id, action: "created", actor, reason, after: row });
    return row;
  }

  const cur = rowsOf(await tx.execute(sql`SELECT * FROM ledger_programs WHERE id = ${id} FOR UPDATE`))[0];
  if (!cur) throw new LedgerError("사업을 찾을 수 없습니다", 404);
  const name = body?.name !== undefined ? text(body.name, 120) : cur.name;
  if (!name) throw new LedgerError("사업 이름을 입력하세요.", 400);
  const row = rowsOf(await tx.execute(sql`
    UPDATE ledger_programs SET
      name = ${name},
      segment = ${body?.segment !== undefined ? segment : cur.segment},
      charter_ref = ${body?.charterRef !== undefined ? text(body.charterRef, 30) : cur.charter_ref},
      disclosure_code = ${body?.disclosureCode !== undefined ? text(body.disclosureCode, 10) : cur.disclosure_code},
      description = ${body?.description !== undefined ? text(body.description, 500) : cur.description},
      is_active = ${body?.isActive !== undefined ? Boolean(body.isActive) : cur.is_active},
      sort_order = ${body?.sortOrder !== undefined ? Number(body.sortOrder) || 0 : cur.sort_order},
      updated_at = NOW()
    WHERE id = ${id} RETURNING *`))[0];
  await recordHistory(tx, { entity: "program", entityId: id, action: "updated", actor, reason, before: cur, after: row });
  return row;
}

async function saveFund(tx: any, id: number, body: any, actor: any, reason: string | null) {
  if (!id) {
    const code = text(body?.code, 20);
    const name = text(body?.name, 120);
    if (!code || !/^[A-Za-z0-9_-]+$/.test(code)) throw new LedgerError("코드는 영문·숫자로 입력하세요.", 400);
    if (!name) throw new LedgerError("재원 이름을 입력하세요.", 400);
    const dup = rowsOf(await tx.execute(sql`SELECT id FROM ledger_funds WHERE code = ${code} LIMIT 1`));
    if (dup.length) throw new LedgerError(`이미 있는 코드입니다: ${code}`, 409);
    const row = rowsOf(await tx.execute(sql`
      INSERT INTO ledger_funds (code, name, restricted, sort_order)
      VALUES (${code}, ${name}, ${Boolean(body?.restricted)}, ${Number(body?.sortOrder) || 999})
      RETURNING *`))[0];
    await recordHistory(tx, { entity: "fund", entityId: row.id, action: "created", actor, reason, after: row });
    return row;
  }

  const cur = rowsOf(await tx.execute(sql`SELECT * FROM ledger_funds WHERE id = ${id} FOR UPDATE`))[0];
  if (!cur) throw new LedgerError("재원을 찾을 수 없습니다", 404);
  if (cur.is_system && body?.isActive === false) throw new LedgerError("기본 재원은 숨길 수 없습니다.");
  const name = body?.name !== undefined ? text(body.name, 120) : cur.name;
  if (!name) throw new LedgerError("재원 이름을 입력하세요.", 400);
  const row = rowsOf(await tx.execute(sql`
    UPDATE ledger_funds SET
      name = ${name},
      restricted = ${body?.restricted !== undefined ? Boolean(body.restricted) : cur.restricted},
      is_active = ${body?.isActive !== undefined ? Boolean(body.isActive) : cur.is_active},
      sort_order = ${body?.sortOrder !== undefined ? Number(body.sortOrder) || 0 : cur.sort_order},
      updated_at = NOW()
    WHERE id = ${id} RETURNING *`))[0];
  await recordHistory(tx, { entity: "fund", entityId: id, action: "updated", actor, reason, before: cur, after: row });
  return row;
}

async function saveRevenueCategory(tx: any, id: number, body: any, actor: any, reason: string | null) {
  const accountCode = text(body?.accountCode, 20);
  if (!id || !accountCode) throw new LedgerError("수입 분류와 계정과목을 고르세요.", 400);
  const account = rowsOf(await tx.execute(sql`
    SELECT a.kind, EXISTS (SELECT 1 FROM account_codes c WHERE c.parent_code = a.code) AS has_children
      FROM account_codes a WHERE a.code = ${accountCode} LIMIT 1`))[0];
  if (!account || account.kind !== "revenue" || account.has_children) throw new LedgerError("수익 계정의 말단 계정을 고르세요.", 400);
  const row = rowsOf(await tx.execute(sql`
    UPDATE revenue_categories SET account_code = ${accountCode}, updated_at = NOW() WHERE id = ${id} RETURNING id, code, name`))[0];
  if (!row) throw new LedgerError("수입 분류를 찾을 수 없습니다", 404);
  await recordHistory(tx, { entity: "revenue_category", entityId: id, action: "updated", actor, reason, after: { accountCode } });
  return row;
}

async function saveStaff(tx: any, body: any, actor: any, reason: string | null) {
  const memberId = Number(body?.memberId) || 0;
  const functionCode = ["service", "admin", "fundraising"].includes(body?.functionCode) ? body.functionCode : "";
  const programId = functionCode === "service" ? (Number(body?.programId) || null) : null;
  const fundId = Number(body?.fundId) || null;
  const ruleId = Number(body?.ruleId) || null;
  if (!memberId || !functionCode) throw new LedgerError("직원과 활동을 고르세요.", 400);
  if (functionCode === "service" && !programId) throw new LedgerError("사업수행이면 사업을 고르세요.", 400);
  await tx.execute(sql`
    INSERT INTO ledger_staff_allocations (member_id, function_code, program_id, fund_id, rule_id, updated_at)
    VALUES (${memberId}, ${functionCode}, ${programId}, ${fundId}, ${ruleId}, NOW())
    ON CONFLICT (member_id) DO UPDATE SET
      function_code = EXCLUDED.function_code, program_id = EXCLUDED.program_id,
      fund_id = EXCLUDED.fund_id, rule_id = EXCLUDED.rule_id, updated_at = NOW()`);
  await recordHistory(tx, {
    entity: "staff_allocation", entityId: memberId, action: "updated", actor, reason,
    after: { functionCode, programId, fundId, ruleId },
  });
  return { id: memberId };
}

export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "POST") {
    return new Response(jsonKST({ ok: false, error: "POST 메서드만 허용" }),
      { status: 405, headers: { "Content-Type": "application/json" } });
  }
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  let body: any;
  try { body = await req.json(); } catch { body = {}; }

  const type = body?.type;
  if (!["program", "fund", "revenue_category", "staff"].includes(type)) {
    return new Response(jsonKST({ ok: false, error: "type을 확인하세요" }),
      { status: 400, headers: { "Content-Type": "application/json" } });
  }
  const id = Number(body?.id) || 0;
  const actor = ledgerActor(auth);
  const reason = text(body?.reason, 200);

  try {
    const saved = await db.transaction((tx) => {
      if (type === "program") return saveProgram(tx, id, body, actor, reason);
      if (type === "fund") return saveFund(tx, id, body, actor, reason);
      if (type === "revenue_category") return saveRevenueCategory(tx, id, body, actor, reason);
      return saveStaff(tx, body, actor, reason);
    });
    return new Response(jsonKST({ ok: true, data: { id: Number(saved.id), code: saved.code, name: saved.name } }),
      { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    const { status, body: payload } = ledgerErrorBody("save", "저장 실패", err);
    return new Response(jsonKST(payload), { status, headers: { "Content-Type": "application/json" } });
  }
}
