/**
 * PUT /api/admin-counterparty-update
 * 거래처 분류 룰 수정 — 학습된 거래처의 매핑 규칙 변경
 *
 * Body: {
 *   id: number,                       (필수)
 *   name?: string,
 *   accountNo?: string,
 *   bankName?: string,
 *   defaultMatchType?: 'voucher'|'revenue'|'donation',
 *   defaultAccountCode?: string,
 *   defaultBudgetLineId?: number | null,
 *   note?: string
 * }
 * 전달된 필드만 갱신.
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-counterparty-update" };

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "거래처 수정 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "PUT" && req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "PUT 메서드만 허용" }),
      { status: 405, headers: { "Content-Type": "application/json" } });
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  let body: any;
  try { body = await req.json(); } catch { body = {}; }
  const { id } = body;
  if (!id) {
    return new Response(JSON.stringify({ ok: false, error: "id 필수" }),
      { status: 400, headers: { "Content-Type": "application/json" } });
  }

  // ── 존재 확인 ──────────────────────────────────────────────
  try {
    const e: any = await db.execute(sql`SELECT id FROM counterparties WHERE id = ${Number(id)} LIMIT 1`);
    if ((e?.rows ?? e ?? []).length === 0) {
      return new Response(JSON.stringify({ ok: false, error: "거래처를 찾을 수 없음" }),
        { status: 404, headers: { "Content-Type": "application/json" } });
    }
  } catch (err: any) {
    return jsonError("select", err);
  }

  // ── 계정과목 검증 (전달된 경우) ────────────────────────────
  if (body.defaultAccountCode) {
    try {
      const ac: any = await db.execute(sql`
        SELECT 1 FROM account_codes WHERE code = ${body.defaultAccountCode} AND is_active = TRUE LIMIT 1`);
      if ((ac?.rows ?? ac ?? []).length === 0) {
        return new Response(JSON.stringify({ ok: false, error: `존재하지 않는 계정과목: ${body.defaultAccountCode}` }),
          { status: 422, headers: { "Content-Type": "application/json" } });
      }
    } catch (err: any) {
      return jsonError("validate_account_code", err);
    }
  }

  // ── 동적 부분 갱신 ─────────────────────────────────────────
  const sets: any[] = [];
  if (body.name !== undefined)                sets.push(sql`name = ${body.name}`);
  if (body.accountNo !== undefined)           sets.push(sql`account_no = ${body.accountNo || null}`);
  if (body.bankName !== undefined)            sets.push(sql`bank_name = ${body.bankName || null}`);
  if (body.defaultMatchType !== undefined)    sets.push(sql`default_match_type = ${body.defaultMatchType || null}`);
  if (body.defaultAccountCode !== undefined)  sets.push(sql`default_account_code = ${body.defaultAccountCode || null}`);
  if (body.defaultBudgetLineId !== undefined) sets.push(sql`default_budget_line_id = ${body.defaultBudgetLineId ? Number(body.defaultBudgetLineId) : null}`);
  if (body.note !== undefined)                sets.push(sql`note = ${body.note || null}`);

  if (sets.length === 0) {
    return new Response(JSON.stringify({ ok: false, error: "갱신할 필드가 없음" }),
      { status: 400, headers: { "Content-Type": "application/json" } });
  }
  sets.push(sql`updated_at = NOW()`);

  try {
    const r: any = await db.execute(sql`
      UPDATE counterparties SET ${sql.join(sets, sql`, `)}
      WHERE id = ${Number(id)}
      RETURNING id, name, account_no, bank_name, default_match_type,
                default_account_code, default_budget_line_id, txn_count, note, updated_at`);
    const updated = (r?.rows ?? r ?? [])[0];
    return new Response(JSON.stringify({
      ok: true,
      data: {
        counterparty: {
          id: Number(updated.id),
          name: updated.name,
          accountNo: updated.account_no,
          bankName: updated.bank_name,
          defaultMatchType: updated.default_match_type,
          defaultAccountCode: updated.default_account_code,
          defaultBudgetLineId: updated.default_budget_line_id ? Number(updated.default_budget_line_id) : null,
          txnCount: Number(updated.txn_count),
          note: updated.note,
          updatedAt: updated.updated_at,
        },
        message: "거래처 분류 룰을 수정했습니다",
      },
    }), { headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    return jsonError("update", err);
  }
}
