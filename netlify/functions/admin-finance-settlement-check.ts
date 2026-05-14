/**
 * GET /api/admin-finance-settlement-check
 * 월말 결산 보조 — 미결 전표·미확인 통장 거래 카운트 (감지·체크리스트만, 마감 잠금 없음)
 *
 * Query: ?year=YYYY&month=MM  (생략 시 KST 현재 월)
 *
 * Phase 22-D-R3 §3.1
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-finance-settlement-check" };

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "결산 점검 조회 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const url = new URL(req.url);
  // KST 현재 월 기본값
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const year  = parseInt(url.searchParams.get("year")  || String(kstNow.getUTCFullYear()));
  const month = parseInt(url.searchParams.get("month") || String(kstNow.getUTCMonth() + 1));

  const mm        = String(month).padStart(2, "0");
  const monthStart = `${year}-${mm}-01`;
  // 다음 달 1일 (말일 계산 회피)
  const nextMonth  = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;

  // 1. 미결 전표 카운트 (draft / submitted)
  let draftCount = 0, submittedCount = 0;
  try {
    const r: any = await db.execute(sql`
      SELECT status, COUNT(*) AS cnt
      FROM vouchers
      WHERE is_template = FALSE
        AND voucher_date >= ${monthStart} AND voucher_date < ${nextMonth}
        AND status IN ('draft', 'submitted')
      GROUP BY status
    `);
    for (const x of (r?.rows ?? r ?? [])) {
      if (x.status === "draft")     draftCount = Number(x.cnt);
      if (x.status === "submitted") submittedCount = Number(x.cnt);
    }
  } catch (err: any) {
    return jsonError("count_vouchers", err);
  }

  // 2. 미확인 통장 거래 카운트 (status='pending') — 보조 집계, 실패해도 계속
  let pendingBankTxn = 0;
  try {
    const r: any = await db.execute(sql`
      SELECT COUNT(*) AS cnt
      FROM bank_transactions
      WHERE txn_date >= ${monthStart} AND txn_date < ${nextMonth}
        AND status = 'pending'
    `);
    pendingBankTxn = Number((r?.rows ?? r ?? [])[0]?.cnt ?? 0);
  } catch (err: any) {
    console.warn("[settlement-check] 미확인 통장 거래 집계 실패 (0으로 계속):", err?.message);
  }

  const unsettledVouchers = draftCount + submittedCount;
  const totalIssues = unsettledVouchers + pendingBankTxn;

  return new Response(JSON.stringify({
    ok: true,
    data: {
      year, month,
      period: { start: monthStart, end: nextMonth },
      unsettledVouchers,        // draft + submitted 합
      draftCount,
      submittedCount,
      pendingBankTxn,           // 미확인 통장 거래
      totalIssues,              // 결산 전 처리 필요 건 총합
      clean: totalIssues === 0, // 미결 0건이면 결산 가능
      message: totalIssues === 0
        ? `${year}년 ${month}월 미결 항목 없음 — 결산 가능`
        : `${year}년 ${month}월 미결 전표 ${unsettledVouchers}건 / 미확인 통장 거래 ${pendingBankTxn}건`,
    },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}
