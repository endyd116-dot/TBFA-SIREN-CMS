/**
 * GET  /api/admin-ledger-close?year=2026   월별 마감 현황
 * POST /api/admin-ledger-close             { action:'close', year, month } / { action:'reopen', year, month, reason }
 *
 * 마감은 «이 날까지 마감» 날짜 하나로 관리하므로 첫 달부터 순서대로만 닫는다.
 * 미결 전표와 합계 불일치는 막고, 미확인 통장 거래와 임시 계정 잔액은 경고만 한다.
 * 해제는 이사장만, 사유를 남긴다. 트랜잭션 안에서는 tx만 쓴다(연결 1개).
 */
import { jsonKST, yearKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { canAccess } from "../../lib/role-permission-check";
import { sql } from "drizzle-orm";
import { LedgerError, ledgerActor, ledgerErrorBody, recordHistory, ymd } from "../../lib/ledger-post";
import { closeStatus, monthEnd, suspenseBalances } from "../../lib/ledger-report";

export const config = { path: "/api/admin-ledger-close" };

const rowsOf = (r: any): any[] => r?.rows ?? r ?? [];
const JSON_HEADERS = { "Content-Type": "application/json" };

async function statusResponse(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const year = Number(url.searchParams.get("year")) || yearKST();
  try {
    const status = await closeStatus(year);
    if (!status) {
      return new Response(jsonKST({ ok: false, error: `${year}년 회계연도가 없습니다` }), { status: 404, headers: JSON_HEADERS });
    }
    const last = status.months[status.months.length - 1];
    let suspense: any[] = [];
    try {
      suspense = await suspenseBalances(last.to);
    } catch (err: any) {
      console.warn("[ledger-close] 임시 계정 잔액 조회 실패:", err?.message);
    }
    return new Response(jsonKST({ ok: true, data: { ...status, suspense } }), { status: 200, headers: JSON_HEADERS });
  } catch (err: any) {
    return new Response(jsonKST({
      ok: false, error: "마감 현황 조회 실패", step: "select",
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: JSON_HEADERS });
  }
}

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  if (req.method === "GET") return statusResponse(req);
  if (req.method !== "POST") {
    return new Response(jsonKST({ ok: false, error: "GET, POST만 허용" }), { status: 405, headers: JSON_HEADERS });
  }

  let body: any;
  try { body = await req.json(); } catch { body = {}; }
  const action = body?.action === "reopen" ? "reopen" : body?.action === "close" ? "close" : "";
  const year = Number(body?.year) || 0;
  const month = Number(body?.month) || 0;
  const reason = String(body?.reason ?? "").trim().slice(0, 300);
  if (!action || !year || month < 1 || month > 12) {
    return new Response(jsonKST({ ok: false, error: "action, year, month 필수" }), { status: 400, headers: JSON_HEADERS });
  }

  const role = String(auth.ctx.member.role ?? "");
  if (action === "reopen") {
    if (role !== "super_admin") {
      return new Response(jsonKST({ ok: false, error: "마감 해제는 이사장만 할 수 있습니다" }), { status: 403, headers: JSON_HEADERS });
    }
    if (!reason) {
      return new Response(jsonKST({ ok: false, error: "해제 사유를 입력하세요" }), { status: 400, headers: JSON_HEADERS });
    }
  } else if (!(await canAccess(role, "finance_ledger_manage"))) {
    return new Response(jsonKST({ ok: false, error: "이 기능에 대한 접근 권한이 없습니다" }), { status: 403, headers: JSON_HEADERS });
  }

  const actor = ledgerActor(auth);
  try {
    const closedThrough = await db.transaction(async (tx) => {
      const fy = rowsOf(await tx.execute(sql`SELECT * FROM ledger_fiscal_years WHERE year = ${year} FOR UPDATE`))[0];
      if (!fy) throw new LedgerError(`${year}년 회계연도가 없습니다`, 404);
      if (fy.status !== "open") throw new LedgerError("결산이 끝난 회계연도입니다.");

      const startDate = ymd(fy.start_date);
      const endDate = ymd(fy.end_date);
      const startMonth = Number(startDate.slice(5, 7));
      const endMonth = Number(endDate.slice(5, 7));
      if (month < startMonth || month > endMonth) throw new LedgerError("장부 기간 밖의 달입니다.");

      const currentEnd = monthEnd(year, month) > endDate ? endDate : monthEnd(year, month);
      const previousEnd = month === startMonth ? null : monthEnd(year, month - 1);
      const closed: string | null = fy.closed_through ? ymd(fy.closed_through) : null;

      if (action === "reopen") {
        if (!closed || closed < currentEnd) throw new LedgerError("마감되지 않은 달입니다.");
        await tx.execute(sql`
          UPDATE ledger_fiscal_years SET closed_through = ${previousEnd}, updated_at = NOW() WHERE year = ${year}`);
        await recordHistory(tx, {
          entity: "fiscal_year", entityId: year, action: "month_reopened", actor, reason,
          before: { closedThrough: closed }, after: { closedThrough: previousEnd },
        });
        return previousEnd;
      }

      if (closed && closed >= currentEnd) throw new LedgerError("이미 마감된 달입니다.");
      if (closed !== previousEnd) {
        throw new LedgerError(previousEnd ? `${previousEnd}까지 먼저 마감하세요.` : "첫 달부터 순서대로 마감하세요.");
      }

      const open = Number(rowsOf(await tx.execute(sql`
        SELECT COUNT(*)::int AS n FROM vouchers
         WHERE is_template = FALSE AND status IN ('draft','submitted','rejected')
           AND voucher_date BETWEEN ${startDate} AND ${currentEnd}`))[0]?.n ?? 0);
      if (open > 0) throw new LedgerError(`미결 전표 ${open}건이 있어 마감할 수 없습니다.`);

      const totals = rowsOf(await tx.execute(sql`
        SELECT COALESCE(SUM(l.debit), 0)::bigint AS dr, COALESCE(SUM(l.credit), 0)::bigint AS cr
          FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
         WHERE v.status = 'approved' AND v.is_template = FALSE AND v.voucher_date <= ${currentEnd}`))[0];
      if (Number(totals?.dr) !== Number(totals?.cr)) throw new LedgerError("차변과 대변 합계가 맞지 않아 마감할 수 없습니다.");

      await tx.execute(sql`
        UPDATE ledger_fiscal_years SET closed_through = ${currentEnd}, updated_at = NOW() WHERE year = ${year}`);
      await recordHistory(tx, {
        entity: "fiscal_year", entityId: year, action: "month_closed", actor,
        before: { closedThrough: closed }, after: { closedThrough: currentEnd },
      });
      return currentEnd;
    });

    const warnings: { code: string; message: string }[] = [];
    if (action === "close") {
      try {
        const to = closedThrough ?? monthEnd(year, month);
        const pending = Number(rowsOf(await db.execute(sql`
          SELECT COUNT(*)::int AS n FROM bank_transactions
           WHERE status = 'pending' AND txn_date >= ${`${year}-${String(month).padStart(2, "0")}-01`} AND txn_date <= ${to}`))[0]?.n ?? 0);
        if (pending) warnings.push({ code: "bank_pending", message: `미확인 통장 거래 ${pending}건` });
        for (const s of await suspenseBalances(to)) {
          warnings.push({ code: "suspense_balance", message: `${s.name} 잔액 ${s.amount.toLocaleString("ko-KR")}원` });
        }
      } catch (err: any) {
        console.warn("[ledger-close] 경고 집계 실패:", err?.message);
      }
    }

    return new Response(jsonKST({ ok: true, data: { closedThrough, warnings } }), { status: 200, headers: JSON_HEADERS });
  } catch (err: any) {
    const { status, body: payload } = ledgerErrorBody("close", "마감 처리 실패", err);
    return new Response(jsonKST(payload), { status, headers: JSON_HEADERS });
  }
}
