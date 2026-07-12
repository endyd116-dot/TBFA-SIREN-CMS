/**
 * GET /api/admin-bank-reconcile-summary
 * 대사 현황 요약 — 입금 N매칭/M미확인, 출금 전표생성/대기, 묶음정산
 *
 * Query: ?startDate=&endDate=  기간 필터 (선택, 생략 시 전체)
 *        ?importId=N           특정 업로드 건만 (선택)
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-bank-reconcile-summary" };

function jsonError(step: string, err: any) {
  return new Response(jsonKST({
    ok: false, error: "대사 현황 조회 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const url = new URL(req.url);
  const startDate = url.searchParams.get("startDate");
  const endDate   = url.searchParams.get("endDate");
  const importId  = url.searchParams.get("importId");

  try {
    const r: any = await db.execute(sql`
      SELECT txn_type, match_type, status,
             COUNT(*) AS cnt, COALESCE(SUM(ABS(amount)), 0) AS total
      FROM bank_transactions
      WHERE 1=1
        ${startDate ? sql`AND txn_date >= ${startDate}` : sql``}
        ${endDate   ? sql`AND txn_date <= ${endDate}` : sql``}
        ${importId  ? sql`AND import_id = ${Number(importId)}` : sql``}
      GROUP BY txn_type, match_type, status`);
    const rows = (r?.rows ?? r ?? []) as any[];

    const summary = {
      income: {
        total: 0, totalAmount: 0,
        matched: 0,        // 개별 후원 매칭 confirmed
        batch: 0,          // 묶음 정산
        revenue: 0,        // 매출 확정
        pending: 0,        // 관리자 확인 대기
        ignored: 0,
      },
      expense: {
        total: 0, totalAmount: 0,
        voucherCreated: 0, // 전표 자동/수동 생성
        pending: 0,        // 관리자 확인 대기
        ignored: 0,
      },
      overall: {
        total: 0,
        confirmed: 0,      // confirmed + voucher_created
        pending: 0,
        ignored: 0,
      },
    };

    for (const x of rows) {
      const cnt = Number(x.cnt);
      const amt = Number(x.total);
      const isCredit = x.txn_type === "credit";
      const bucket = isCredit ? summary.income : summary.expense;
      bucket.total += cnt;
      bucket.totalAmount += amt;
      summary.overall.total += cnt;

      if (x.status === "ignored") {
        bucket.ignored += cnt;
        summary.overall.ignored += cnt;
      } else if (x.status === "confirmed" || x.status === "voucher_created") {
        summary.overall.confirmed += cnt;
        if (isCredit) {
          if (x.match_type === "donation_batch") summary.income.batch += cnt;
          else if (x.match_type === "revenue")   summary.income.revenue += cnt;
          else                                   summary.income.matched += cnt;
        } else {
          summary.expense.voucherCreated += cnt;
        }
      } else {
        // pending
        bucket.pending += cnt;
        summary.overall.pending += cnt;
      }
    }

    return new Response(jsonKST({
      ok: true,
      data: {
        ...summary,
        period: { startDate: startDate || null, endDate: endDate || null },
        importId: importId ? Number(importId) : null,
      },
    }), { headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    return jsonError("aggregate", err);
  }
}
