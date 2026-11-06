/**
 * GET /api/admin-ledger-statements
 *   ?doc=balance&year=2026            재무상태표 (또는 &asOf=YYYY-MM-DD)
 *   ?doc=operating&year=2026          운영성과표 (또는 &from=&to=, 또는 재무 보고서의 &period=&startDate=&endDate=)
 *
 * 공식 재무제표는 장부에서만 나온다. 재무 보고서 탭과 PDF가 이 계산을 함께 쓴다.
 */
import { jsonKST, todayKST, yearKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { loadFiscalYears } from "../../lib/ledger-report";
import { balanceSheet, operatingStatement } from "../../lib/ledger-statements";
import { resolvePeriod } from "../../lib/period-filter";

export const config = { path: "/api/admin-ledger-statements" };

const JSON_HEADERS = { "Content-Type": "application/json" };
const isDate = (v: string | null) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const url = new URL(req.url);
  const doc = url.searchParams.get("doc") || "balance";
  const year = Number(url.searchParams.get("year")) || 0;
  try {
    const years = await loadFiscalYears();
    const ledgerStart = years[0]?.startDate ?? null;

    if (doc === "balance") {
      const asOfParam = url.searchParams.get("asOf");
      const fy = years.find((f) => f.year === (year || yearKST()));
      const asOf = isDate(asOfParam) ? asOfParam! : fy?.endDate ?? todayKST();
      const owner = years.find((f) => asOf >= f.startDate && asOf <= f.endDate);
      const prev = owner ? years.find((f) => f.year === owner.year - 1) : undefined;
      const data = await balanceSheet(asOf, prev?.endDate ?? null);
      return new Response(jsonKST({ ok: true, data: { ...data, ledgerStart } }), { status: 200, headers: JSON_HEADERS });
    }

    if (doc === "operating") {
      const periodParam = url.searchParams.get("period");
      const period = periodParam
        ? resolvePeriod({ period: periodParam, startDate: url.searchParams.get("startDate"), endDate: url.searchParams.get("endDate") })
        : null;
      const fromParam = period?.startDate ?? url.searchParams.get("from");
      const toParam = period?.endDate ?? url.searchParams.get("to");
      const fy = years.find((f) => f.year === (year || yearKST()));
      const from = isDate(fromParam) ? fromParam! : fy?.startDate ?? `${yearKST()}-01-01`;
      const to = isDate(toParam) ? toParam! : fy?.endDate ?? `${yearKST()}-12-31`;
      const whole = !fromParam && !toParam;
      const prev = whole && fy ? years.find((f) => f.year === fy.year - 1) : undefined;
      const data = await operatingStatement(from, to, prev?.startDate ?? null, prev?.endDate ?? null);
      return new Response(jsonKST({ ok: true, data: { ...data, ledgerStart } }), { status: 200, headers: JSON_HEADERS });
    }

    return new Response(jsonKST({ ok: false, error: "doc는 balance 또는 operating입니다" }), { status: 400, headers: JSON_HEADERS });
  } catch (err: any) {
    return new Response(jsonKST({
      ok: false, error: "재무제표 조회 실패", step: doc,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: JSON_HEADERS });
  }
}
