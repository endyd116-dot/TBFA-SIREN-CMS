/**
 * POST /api/admin-bank-transaction-confirm
 * 관리자 확인 — 미매칭 거래를 후원/매출/전표/무시로 확정
 *
 * Body: {
 *   transactionId: number,
 *   action: 'donation' | 'revenue' | 'voucher' | 'ignored',
 *   // action=donation
 *   memberId?: number,            연결할 회원 (선택)
 *   donorName?: string,           입금자명 (memberId 없으면 필수)
 *   // action=revenue
 *   revenueCategoryId?: number,   매출 카테고리 (action=revenue 필수)
 *   payerName?: string,
 *   // action=voucher
 *   accountCode?: string,         계정과목 (action=voucher 필수)
 *   budgetLineId?: number,
 *   subAccount?: string,
 *   // 공통 — 거래처 학습
 *   learnCounterparty?: boolean   true면 counterparties에 학습 등록 (기본 true)
 * }
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";
import { learnCounterparty } from "../../lib/bank-reconcile";

export const config = { path: "/api/admin-bank-transaction-confirm" };

function jsonError(step: string, err: any) {
  return new Response(jsonKST({
    ok: false, error: "거래 확인 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "POST") {
    return new Response(jsonKST({ ok: false, error: "POST 메서드만 허용" }),
      { status: 405, headers: { "Content-Type": "application/json" } });
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  const adminEmail = String(auth.ctx.member?.email || auth.ctx.admin?.uid || "admin");
  const adminMemberId = auth.ctx.member?.id ? Number(auth.ctx.member.id) : null;

  let body: any;
  try { body = await req.json(); } catch { body = {}; }
  const { transactionId, action } = body;
  const learnCp = body.learnCounterparty !== false;

  if (!transactionId || !["donation", "revenue", "voucher", "ignored", "unignore"].includes(action)) {
    return new Response(jsonKST({
      ok: false, error: "transactionId, action(donation|revenue|voucher|ignored|unignore) 필수",
    }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  // ── 거래 조회 ──────────────────────────────────────────────
  let txn: any;
  try {
    const r: any = await db.execute(sql`
      SELECT id, txn_date, amount, txn_type, description,
             counterpart_account, counterpart_bank, counterpart_name, status
      FROM bank_transactions WHERE id = ${Number(transactionId)} LIMIT 1`);
    txn = (r?.rows ?? r ?? [])[0];
  } catch (err: any) {
    return jsonError("select_txn", err);
  }
  if (!txn) {
    return new Response(jsonKST({ ok: false, error: "거래를 찾을 수 없음" }),
      { status: 404, headers: { "Content-Type": "application/json" } });
  }

  const amount = Math.abs(Number(txn.amount));
  const txnDate = String(txn.txn_date);
  const fiscalYear = parseInt(txnDate.slice(0, 4));
  let createdRefId: number | null = null;
  let resultMessage = "";

  try {
    // ════════ action=ignored ════════
    if (action === "ignored") {
      await db.execute(sql`
        UPDATE bank_transactions SET
          match_type = 'ignored', status = 'ignored',
          confirmed_at = NOW(), confirmed_by = ${adminEmail}
        WHERE id = ${txn.id}`);
      resultMessage = "거래를 무시 처리했습니다 (내부 이체 등)";

    // ════════ action=unignore — 무시 해제 → 미처리(pending)로 복원 ════════
    } else if (action === "unignore") {
      if (txn.status !== "ignored") {
        return new Response(jsonKST({ ok: false, error: "무시 상태인 거래만 해제할 수 있습니다" }),
          { status: 422, headers: { "Content-Type": "application/json" } });
      }
      await db.execute(sql`
        UPDATE bank_transactions SET
          match_type = 'pending', status = 'pending',
          confirmed_at = NULL, confirmed_by = NULL
        WHERE id = ${txn.id}`);
      resultMessage = "무시를 해제했습니다 — 미처리 상태로 복원";

    // ════════ action=donation ════════
    } else if (action === "donation") {
      if (txn.txn_type !== "credit") {
        return new Response(jsonKST({ ok: false, error: "출금 거래는 후원으로 등록할 수 없음" }),
          { status: 422, headers: { "Content-Type": "application/json" } });
      }
      const donorName = body.donorName || txn.counterpart_name;
      if (!donorName && !body.memberId) {
        return new Response(jsonKST({ ok: false, error: "donorName 또는 memberId 필수" }),
          { status: 400, headers: { "Content-Type": "application/json" } });
      }
      // 회원 연결 시 회원명 보강
      let finalDonorName = donorName;
      const memberId = body.memberId ? Number(body.memberId) : null;
      if (memberId) {
        const m: any = await db.execute(sql`SELECT name FROM members WHERE id = ${memberId} LIMIT 1`);
        const mr = (m?.rows ?? m ?? [])[0];
        if (mr?.name) finalDonorName = mr.name;
      }
      const dr: any = await db.execute(sql`
        INSERT INTO donations
          (member_id, donor_name, amount, type, pay_method, status,
           bank_depositor_name, memo, created_at, updated_at)
        VALUES
          (${memberId}, ${finalDonorName}, ${amount}, 'onetime', 'bank', 'completed',
           ${txn.counterpart_name || finalDonorName},
           ${`통장 입금 자동 등록 (거래 #${txn.id})`}, NOW(), NOW())
        RETURNING id`);
      createdRefId = Number((dr?.rows ?? dr ?? [])[0].id);
      await db.execute(sql`
        UPDATE bank_transactions SET
          match_type = 'donation', status = 'confirmed',
          donation_id = ${createdRefId},
          confirmed_at = NOW(), confirmed_by = ${adminEmail}
        WHERE id = ${txn.id}`);
      resultMessage = `후원 등록 완료 — ${finalDonorName} ${amount.toLocaleString()}원`;

    // ════════ action=revenue ════════
    } else if (action === "revenue") {
      if (txn.txn_type !== "credit") {
        return new Response(jsonKST({ ok: false, error: "출금 거래는 매출로 등록할 수 없음" }),
          { status: 422, headers: { "Content-Type": "application/json" } });
      }
      if (!body.revenueCategoryId) {
        return new Response(jsonKST({ ok: false, error: "revenueCategoryId 필수" }),
          { status: 400, headers: { "Content-Type": "application/json" } });
      }
      const payerName = body.payerName || txn.counterpart_name || "(미상)";
      const rr: any = await db.execute(sql`
        INSERT INTO other_revenues
          (fiscal_year, recognized_at, category_id, amount, payer_name,
           description, status, recorded_by, recorded_at, created_at, updated_at)
        VALUES
          (${fiscalYear}, ${txnDate}, ${Number(body.revenueCategoryId)}, ${amount}, ${payerName},
           ${`통장 입금 자동 등록 (거래 #${txn.id})`}, 'draft', ${adminMemberId}, NOW(), NOW(), NOW())
        RETURNING id`);
      createdRefId = Number((rr?.rows ?? rr ?? [])[0].id);
      await db.execute(sql`
        UPDATE bank_transactions SET
          match_type = 'revenue', status = 'confirmed',
          other_revenue_id = ${createdRefId},
          confirmed_at = NOW(), confirmed_by = ${adminEmail}
        WHERE id = ${txn.id}`);
      resultMessage = `후원 외 수입 등록 완료 — ${payerName} ${amount.toLocaleString()}원`;

    // ════════ action=voucher ════════
    } else if (action === "voucher") {
      if (txn.txn_type !== "debit") {
        return new Response(jsonKST({ ok: false, error: "입금 거래는 전표로 등록할 수 없음" }),
          { status: 422, headers: { "Content-Type": "application/json" } });
      }
      if (!body.accountCode) {
        return new Response(jsonKST({ ok: false, error: "accountCode 필수" }),
          { status: 400, headers: { "Content-Type": "application/json" } });
      }
      // 계정과목 검증
      const ac: any = await db.execute(sql`
        SELECT name FROM account_codes WHERE code = ${body.accountCode} AND is_active = TRUE LIMIT 1`);
      const acRow = (ac?.rows ?? ac ?? [])[0];
      if (!acRow) {
        return new Response(jsonKST({ ok: false, error: `존재하지 않는 계정과목: ${body.accountCode}` }),
          { status: 422, headers: { "Content-Type": "application/json" } });
      }
      // voucher_number 생성
      const yyyymm = txnDate.slice(0, 7).replace("-", "");
      const maxR: any = await db.execute(sql`
        SELECT COALESCE(MAX(CAST(SPLIT_PART(voucher_number, '-', 2) AS INTEGER)), 0) AS maxn
        FROM vouchers WHERE voucher_number LIKE ${`${yyyymm}-%`}`);
      const nextN = Number((maxR?.rows ?? maxR ?? [])[0]?.maxn ?? 0) + 1;
      const voucherNumber = `${yyyymm}-${String(nextN).padStart(3, "0")}`;

      const vr: any = await db.execute(sql`
        INSERT INTO vouchers (
          voucher_number, voucher_date, fiscal_year,
          account_code, account_name, sub_account,
          description, payee_name, amount,
          evidence_type, budget_line_id, bank_txn_id,
          status, created_by, created_at, updated_at
        ) VALUES (
          ${voucherNumber}, ${txnDate}, ${fiscalYear},
          ${body.accountCode}, ${acRow.name}, ${body.subAccount || null},
          ${txn.description || `통장 출금 — ${txn.counterpart_name || ""}`},
          ${txn.counterpart_name || null}, ${amount},
          'transfer_confirm', ${body.budgetLineId ? Number(body.budgetLineId) : null}, ${txn.id},
          'draft', ${adminEmail}, NOW(), NOW()
        ) RETURNING id`);
      createdRefId = Number((vr?.rows ?? vr ?? [])[0].id);
      await db.execute(sql`
        UPDATE bank_transactions SET
          match_type = 'voucher', status = 'voucher_created',
          admin_account_code = ${body.accountCode},
          voucher_id = ${createdRefId},
          confirmed_at = NOW(), confirmed_by = ${adminEmail}
        WHERE id = ${txn.id}`);
      resultMessage = `전표 작성 완료 — ${voucherNumber} (${acRow.name})`;
    }
  } catch (err: any) {
    return jsonError(`confirm_${action}`, err);
  }

  // ── 거래처 자동 학습 (ignored 제외) ─────────────────────────
  let learnedCounterpartyId: number | null = null;
  if (learnCp && action !== "ignored" && txn.counterpart_name) {
    try {
      const learned = await learnCounterparty({
        name: txn.counterpart_name,
        accountNo: txn.counterpart_account || null,
        bankName: txn.counterpart_bank || null,
        matchType: action,
        accountCode: action === "voucher" ? (body.accountCode || null) : null,
        budgetLineId: action === "voucher" && body.budgetLineId ? Number(body.budgetLineId) : null,
        learnedBy: adminMemberId,
      });
      if (learned) {
        learnedCounterpartyId = learned.id;
        await db.execute(sql`
          UPDATE bank_transactions SET counterparty_id = ${learned.id} WHERE id = ${txn.id}`);
      }
    } catch (e) {
      console.warn("[bank-confirm] 거래처 학습 실패:", e);
    }
  }

  return new Response(jsonKST({
    ok: true,
    data: {
      transactionId: Number(txn.id),
      action,
      createdRefId,
      learnedCounterpartyId,
      message: resultMessage,
    },
  }), { headers: { "Content-Type": "application/json" } });
}
