/**
 * GET /api/admin-finance-balance-sheet
 * 재정상태표 (간이판) — 통장 잔액 기반 현금성 자산만
 *
 * Query: ?asOf=YYYY-MM-DD  (생략 시 오늘 KST — 해당 일자까지의 최신 잔액)
 *
 * Phase 22-D-R3 §5.1
 * 데이터 소스: bank_transactions 최신 balance_after (asOf 이하 거래 중 가장 최근)
 * 비현금 자산·부채는 SIREN 데이터 한계상 "해당 없음" 명시
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-finance-balance-sheet" };

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "재정상태표 조회 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const url = new URL(req.url);
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const asOf = url.searchParams.get("asOf") || kstNow.toISOString().slice(0, 10);

  // 1. 현금성 자산 — asOf 이하 거래 중 가장 최근 거래의 balance_after
  //    (txn_date DESC, id DESC 로 최신 1건)
  let cashAsset = 0;
  let balanceTxnDate: string | null = null;
  let hasBalanceData = false;
  try {
    const r: any = await db.execute(sql`
      SELECT balance_after, txn_date
      FROM bank_transactions
      WHERE txn_date <= ${asOf}
        AND balance_after IS NOT NULL
      ORDER BY txn_date DESC, id DESC
      LIMIT 1
    `);
    const row = (r?.rows ?? r ?? [])[0];
    if (row) {
      cashAsset = Number(row.balance_after);
      balanceTxnDate = row.txn_date;
      hasBalanceData = true;
    }
  } catch (err: any) {
    return jsonError("select_balance", err);
  }

  const totalAsset    = cashAsset;        // 현금성 자산만 (비현금 자산 데이터 없음)
  const totalLiability = 0;               // 부채 데이터 없음
  const netAsset      = totalAsset - totalLiability;

  return new Response(JSON.stringify({
    ok: true,
    data: {
      asOf,
      balanceTxnDate,                     // 잔액 기준이 된 실제 거래일 (asOf와 다를 수 있음)
      hasBalanceData,                     // false = 통장 거래 내역 없음 (업로드 필요)
      assets: {
        cash:        cashAsset,           // 현금성 자산 (통장 잔액)
        nonCash:     null,                // 비현금 자산 — 데이터 없음 ("해당 없음")
        total:       totalAsset,
      },
      liabilities: {
        total:       totalLiability,      // 부채 — 데이터 없음 ("해당 없음")
        hasData:     false,
      },
      netAsset,                           // 순자산 = 자산 − 부채
      note: "간이 재정상태표 — 통장 잔액 기반 현금성 자산만 집계. 비현금 자산·부채는 SIREN 데이터 한계상 해당 없음.",
      message: hasBalanceData
        ? `${asOf} 기준 순자산 ${netAsset.toLocaleString("ko-KR")}원`
        : "통장 거래 내역이 없습니다. 통장거래내역을 먼저 업로드해 주세요.",
    },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}
