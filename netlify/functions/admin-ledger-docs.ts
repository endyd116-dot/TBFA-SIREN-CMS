/**
 * GET  /api/admin-ledger-docs?type=rules          배분 규칙
 * POST /api/admin-ledger-docs
 *   { type:'note', year, key, body }              주석 문구 저장(확인 포함)
 *   { type:'note_reset', year, key }              자동 문구로 되돌림
 *   { type:'program', year, programId, planTarget?, planPeriod?, planBody?, resultBody?, events?, beneficiaries? }
 *   { type:'property', year, id?, propertyClass, accountCode, name, detail?, quantity?, amount, note? }
 *   { type:'property_delete', year, id }
 *   { type:'property_fill', year }                장부 잔액과 다른 만큼 명세 줄을 채움
 *   { type:'rule', id?, name, basis?, lines, isActive? }  공통비 배분 규칙
 *
 * 확정된 회계연도의 서류는 바꿀 수 없다. 해제하면 다시 고칠 수 있다.
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { canAccess } from "../../lib/role-permission-check";
import { sql } from "drizzle-orm";
import { LedgerError, ledgerActor, ledgerErrorBody, normalizeRuleLines, recordHistory } from "../../lib/ledger-post";
import { loadFiscalYears } from "../../lib/ledger-report";
import { loadAllocationRules, loadProperty, NOTE_DEFS } from "../../lib/ledger-settlement";

export const config = { path: "/api/admin-ledger-docs" };

const rowsOf = (r: any): any[] => r?.rows ?? r ?? [];
const JSON_HEADERS = { "Content-Type": "application/json" };
const json = (body: unknown, status = 200) => new Response(jsonKST(body), { status, headers: JSON_HEADERS });
const text = (v: unknown, max: number): string | null => {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, max) : null;
};
const count = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

async function assertOpen(tx: any, year: number) {
  const row = rowsOf(await tx.execute(sql`SELECT status FROM ledger_settlements WHERE year = ${year}`))[0];
  if (row && row.status !== "draft") throw new LedgerError("확정된 결산입니다. 해제한 뒤 고칠 수 있습니다.");
}

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  if (req.method === "GET") {
    try {
      return json({ ok: true, data: { rules: await loadAllocationRules() } });
    } catch (err: any) {
      return json({
        ok: false, error: "배분 규칙 조회 실패", step: "select",
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }, 500);
    }
  }
  if (req.method !== "POST") return json({ ok: false, error: "GET, POST만 허용" }, 405);
  if (!(await canAccess(String(auth.ctx.member.role ?? ""), "finance_ledger_manage"))) {
    return json({ ok: false, error: "이 기능에 대한 접근 권한이 없습니다" }, 403);
  }

  let body: any;
  try { body = await req.json(); } catch { body = {}; }
  const type = String(body?.type ?? "");
  const year = Number(body?.year) || 0;
  const actor = ledgerActor(auth);

  try {
    if (type === "note" || type === "note_reset") {
      const key = String(body?.key ?? "");
      if (!year || !NOTE_DEFS.some((d) => d.key === key)) throw new LedgerError("year, key 필수", 400);
      await db.transaction(async (tx) => {
        await assertOpen(tx, year);
        if (type === "note_reset") {
          await tx.execute(sql`DELETE FROM ledger_notes WHERE year = ${year} AND note_key = ${key}`);
          return;
        }
        const noteBody = String(body?.body ?? "").trim();
        if (!noteBody) throw new LedgerError("문구를 입력하세요", 400);
        await tx.execute(sql`
          INSERT INTO ledger_notes (year, note_key, body, updated_by, updated_by_name, updated_at)
          VALUES (${year}, ${key}, ${noteBody.slice(0, 5000)}, ${actor.id}, ${actor.name}, NOW())
          ON CONFLICT (year, note_key) DO UPDATE
            SET body = EXCLUDED.body, updated_by = EXCLUDED.updated_by,
                updated_by_name = EXCLUDED.updated_by_name, updated_at = NOW()`);
      });
      return json({ ok: true, data: { key } });
    }

    if (type === "program") {
      const programId = Number(body?.programId) || 0;
      if (!year || !programId) throw new LedgerError("year, programId 필수", 400);
      await db.transaction(async (tx) => {
        await assertOpen(tx, year);
        const exists = rowsOf(await tx.execute(sql`SELECT id FROM ledger_programs WHERE id = ${programId}`))[0];
        if (!exists) throw new LedgerError("사업을 찾을 수 없습니다", 404);
        await tx.execute(sql`
          INSERT INTO ledger_program_reports
            (year, program_id, plan_target, plan_period, plan_body, result_body, events, beneficiaries, updated_by, updated_at)
          VALUES (${year}, ${programId}, ${text(body?.planTarget, 300)}, ${text(body?.planPeriod, 100)}, ${text(body?.planBody, 5000)},
                  ${text(body?.resultBody, 5000)}, ${count(body?.events)}, ${count(body?.beneficiaries)}, ${actor.id}, NOW())
          ON CONFLICT (year, program_id) DO UPDATE SET
            plan_target = EXCLUDED.plan_target, plan_period = EXCLUDED.plan_period, plan_body = EXCLUDED.plan_body,
            result_body = EXCLUDED.result_body, events = EXCLUDED.events, beneficiaries = EXCLUDED.beneficiaries,
            updated_by = EXCLUDED.updated_by, updated_at = NOW()`);
      });
      return json({ ok: true, data: { programId } });
    }

    if (type === "property" || type === "property_delete") {
      if (!year) throw new LedgerError("year 필수", 400);
      const id = Number(body?.id) || 0;
      const saved = await db.transaction(async (tx) => {
        await assertOpen(tx, year);
        if (type === "property_delete") {
          if (!id) throw new LedgerError("id 필수", 400);
          await tx.execute(sql`DELETE FROM ledger_property_items WHERE id = ${id} AND year = ${year}`);
          return id;
        }
        const name = text(body?.name, 200);
        const accountCode = text(body?.accountCode, 20);
        const amount = Math.trunc(Number(body?.amount));
        if (!name || !accountCode || !Number.isFinite(amount)) throw new LedgerError("재산명, 계정, 금액을 입력하세요", 400);
        const account = rowsOf(await tx.execute(sql`SELECT kind FROM account_codes WHERE code = ${accountCode}`))[0];
        if (account?.kind !== "asset") throw new LedgerError("자산 계정을 고르세요", 400);
        const cls = body?.propertyClass === "basic" ? "basic" : "ordinary";
        if (id) {
          await tx.execute(sql`
            UPDATE ledger_property_items
               SET property_class = ${cls}, account_code = ${accountCode}, name = ${name}, detail = ${text(body?.detail, 300)},
                   quantity = ${text(body?.quantity, 50)}, amount = ${amount}, note = ${text(body?.note, 300)}, updated_at = NOW()
             WHERE id = ${id} AND year = ${year}`);
          return id;
        }
        const row = rowsOf(await tx.execute(sql`
          INSERT INTO ledger_property_items (year, property_class, account_code, name, detail, quantity, amount, note)
          VALUES (${year}, ${cls}, ${accountCode}, ${name}, ${text(body?.detail, 300)}, ${text(body?.quantity, 50)}, ${amount}, ${text(body?.note, 300)})
          RETURNING id`))[0];
        return Number(row.id);
      });
      return json({ ok: true, data: { id: saved } });
    }

    if (type === "property_fill") {
      if (!year) throw new LedgerError("year 필수", 400);
      const fy = (await loadFiscalYears()).find((f) => f.year === year);
      if (!fy) throw new LedgerError(`${year}년 회계연도가 없습니다`, 404);
      const { reconcile } = await loadProperty(year, fy.endDate);
      const missing = reconcile.filter((r) => r.difference !== 0);
      await db.transaction(async (tx) => {
        await assertOpen(tx, year);
        for (const r of missing) {
          await tx.execute(sql`
            INSERT INTO ledger_property_items (year, property_class, account_code, name, amount)
            VALUES (${year}, 'ordinary', ${r.code}, ${r.name}, ${-r.difference})`);
        }
      });
      return json({ ok: true, data: { filled: missing.length } });
    }

    if (type === "rule") {
      const id = Number(body?.id) || 0;
      const name = text(body?.name, 120);
      if (!name) throw new LedgerError("규칙 이름을 입력하세요", 400);
      const lines = normalizeRuleLines(body?.lines);
      const isActive = body?.isActive !== false;
      const savedId = await db.transaction(async (tx) => {
        const linesJson = JSON.stringify(lines);
        if (id) {
          const cur = rowsOf(await tx.execute(sql`SELECT * FROM ledger_allocation_rules WHERE id = ${id} FOR UPDATE`))[0];
          if (!cur) throw new LedgerError("규칙을 찾을 수 없습니다", 404);
          await tx.execute(sql`
            UPDATE ledger_allocation_rules
               SET name = ${name}, basis = ${text(body?.basis, 300)}, lines = ${linesJson}::jsonb, is_active = ${isActive}, updated_at = NOW()
             WHERE id = ${id}`);
          await recordHistory(tx, { entity: "allocation_rule", entityId: id, action: "updated", actor, before: cur, after: { name, lines, isActive } });
          return id;
        }
        const dup = rowsOf(await tx.execute(sql`SELECT id FROM ledger_allocation_rules WHERE name = ${name}`))[0];
        if (dup) throw new LedgerError(`이미 있는 이름입니다: ${name}`, 409);
        const row = rowsOf(await tx.execute(sql`
          INSERT INTO ledger_allocation_rules (name, basis, lines, is_active)
          VALUES (${name}, ${text(body?.basis, 300)}, ${linesJson}::jsonb, ${isActive}) RETURNING id`))[0];
        await recordHistory(tx, { entity: "allocation_rule", entityId: row.id, action: "created", actor, after: { name, lines } });
        return Number(row.id);
      });
      return json({ ok: true, data: { id: savedId } });
    }

    return json({ ok: false, error: "알 수 없는 저장 유형입니다" }, 400);
  } catch (err: any) {
    const { status, body: payload } = ledgerErrorBody(type || "save", "저장 실패", err);
    return json(payload, status);
  }
}
