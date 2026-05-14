/**
 * POST /api/admin-bank-batch-voucher
 * 통장 출금 거래 일괄 전표 확정
 *
 * 미매칭(pending) 출금 거래 여러 건을 한 번에 전표(voucher)로 확정.
 * 각 거래의 AI 추정 계정과목(ai_account_code)을 사용 — 추정값이 없는 거래는 건너뜀.
 * (정책: 신뢰도 높은 것만 자동, 애매한 건 단건 화면에서 수동 처리)
 *
 * Body: {
 *   transactionIds: number[]   대상 거래 ID 배열 (1~200건)
 *   learnCounterparty?: boolean (기본 true)
 * }
 *
 * 응답: { ok, data: { total, succeeded, skipped, failed, results:[{id, ok, voucherNumber?, error?}] } }
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";
import { learnCounterparty } from "../../lib/bank-reconcile";

export const config = { path: "/api/admin-bank-batch-voucher" };

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "일괄 전표 확정 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "POST 메서드만 허용" }),
      { status: 405, headers: { "Content-Type": "application/json" } });
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  const adminEmail = String(auth.ctx.member?.email || auth.ctx.admin?.uid || "admin");
  const adminMemberId = auth.ctx.member?.id ? Number(auth.ctx.member.id) : null;

  let body: any;
  try { body = await req.json(); } catch { body = {}; }

  const ids: number[] = Array.isArray(body.transactionIds)
    ? Array.from(new Set(body.transactionIds.map((n: any) => Number(n)).filter((n: number) => Number.isInteger(n) && n > 0)))
    : [];
  const learnCp = body.learnCounterparty !== false;

  if (ids.length === 0) {
    return new Response(JSON.stringify({ ok: false, error: "transactionIds 배열 필수" }),
      { status: 400, headers: { "Content-Type": "application/json" } });
  }
  if (ids.length > 200) {
    return new Response(JSON.stringify({ ok: false, error: "한 번에 처리 가능한 건수는 200건입니다" }),
      { status: 400, headers: { "Content-Type": "application/json" } });
  }

  // ── 대상 거래 조회 — pending 출금만 ────────────────────────
  let txns: any[];
  try {
    const idsLiteral = `ARRAY[${ids.map(n => Number(n) || 0).join(",")}]::int[]`;
    const r: any = await db.execute(sql`
      SELECT id, txn_date, amount, txn_type, description,
             counterpart_account, counterpart_bank, counterpart_name,
             ai_account_code, status
      FROM bank_transactions
      WHERE id = ANY(${sql.raw(idsLiteral)})
      ORDER BY txn_date ASC, id ASC`);
    txns = r?.rows ?? r ?? [];
  } catch (err: any) {
    return jsonError("select_txns", err);
  }

  const results: Array<{ id: number; ok: boolean; voucherNumber?: string; error?: string }> = [];
  let succeeded = 0, skipped = 0, failed = 0;

  for (const txn of txns) {
    const id = Number(txn.id);
    // 출금이 아니면 스킵
    if (txn.txn_type !== "debit") {
      results.push({ id, ok: false, error: "입금 거래는 일괄 전표 대상이 아님" });
      skipped++;
      continue;
    }
    // 이미 처리된 거래는 스킵
    if (txn.status !== "pending") {
      results.push({ id, ok: false, error: "미처리(pending) 거래만 일괄 확정 가능" });
      skipped++;
      continue;
    }
    // AI 추정 계정과목이 없으면 스킵 (수동 처리 대상)
    const accountCode = txn.ai_account_code ? String(txn.ai_account_code).trim() : "";
    if (!accountCode) {
      results.push({ id, ok: false, error: "추정 계정과목 없음 — 단건 화면에서 수동 확정 필요" });
      skipped++;
      continue;
    }

    try {
      // 계정과목 검증
      const ac: any = await db.execute(sql`
        SELECT name FROM account_codes WHERE code = ${accountCode} AND is_active = TRUE LIMIT 1`);
      const acRow = (ac?.rows ?? ac ?? [])[0];
      if (!acRow) {
        results.push({ id, ok: false, error: `존재하지 않는 계정과목: ${accountCode}` });
        failed++;
        continue;
      }

      const amount = Math.abs(Number(txn.amount));
      const txnDate = String(txn.txn_date);
      const fiscalYear = parseInt(txnDate.slice(0, 4));
      const yyyymm = txnDate.slice(0, 7).replace("-", "");

      // voucher_number 생성 (월별 순번)
      const maxR: any = await db.execute(sql`
        SELECT COALESCE(MAX(CAST(SPLIT_PART(voucher_number, '-', 2) AS INTEGER)), 0) AS maxn
        FROM vouchers WHERE voucher_number LIKE ${`${yyyymm}-%`}`);
      const nextN = Number((maxR?.rows ?? maxR ?? [])[0]?.maxn ?? 0) + 1;
      const voucherNumber = `${yyyymm}-${String(nextN).padStart(3, "0")}`;

      const vr: any = await db.execute(sql`
        INSERT INTO vouchers (
          voucher_number, voucher_date, fiscal_year,
          account_code, account_name,
          description, payee_name, amount,
          evidence_type, bank_txn_id,
          status, created_by, created_at, updated_at
        ) VALUES (
          ${voucherNumber}, ${txnDate}, ${fiscalYear},
          ${accountCode}, ${acRow.name},
          ${txn.description || `통장 출금 — ${txn.counterpart_name || ""}`},
          ${txn.counterpart_name || null}, ${amount},
          'transfer_confirm', ${id},
          'draft', ${adminEmail}, NOW(), NOW()
        ) RETURNING id`);
      const voucherId = Number((vr?.rows ?? vr ?? [])[0].id);

      await db.execute(sql`
        UPDATE bank_transactions SET
          match_type = 'voucher', status = 'voucher_created',
          admin_account_code = ${accountCode},
          voucher_id = ${voucherId},
          confirmed_at = NOW(), confirmed_by = ${adminEmail}
        WHERE id = ${id}`);

      // 거래처 자동 학습 (실패해도 전표는 유지)
      if (learnCp && txn.counterpart_name) {
        try {
          await learnCounterparty({
            name: txn.counterpart_name,
            accountNo: txn.counterpart_account || null,
            bankName: txn.counterpart_bank || null,
            matchType: "voucher",
            accountCode,
            budgetLineId: null,
            learnedBy: adminMemberId,
          });
        } catch (e) {
          console.warn("[bank-batch-voucher] 거래처 학습 실패:", e);
        }
      }

      results.push({ id, ok: true, voucherNumber });
      succeeded++;
    } catch (err: any) {
      results.push({ id, ok: false, error: String(err?.message || err).slice(0, 300) });
      failed++;
    }
  }

  // 조회 결과에 없던 ID도 결과에 표기
  const foundIds = new Set(txns.map(t => Number(t.id)));
  for (const id of ids) {
    if (!foundIds.has(id)) {
      results.push({ id, ok: false, error: "거래를 찾을 수 없음" });
      skipped++;
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    data: {
      total: ids.length,
      succeeded, skipped, failed,
      results,
      message: `일괄 전표 확정 — 성공 ${succeeded}건, 건너뜀 ${skipped}건, 실패 ${failed}건`,
    },
  }), { headers: { "Content-Type": "application/json" } });
}
