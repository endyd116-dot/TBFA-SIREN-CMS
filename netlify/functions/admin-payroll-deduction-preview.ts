/**
 * /api/admin-payroll-deduction-preview — 명세서 편집 화면의 공제 미리보기 (GET)
 *
 * 왜 필요한가:
 *   소득세는 국세청 간이세액표에서 찾는 값이라 화면에서 요율 곱셈으로 흉내낼 수 없다.
 *   그래서 조정 라인(성과 상여 등)을 넣어도 화면 미리보기의 소득세는 옛 금액 그대로였고,
 *   저장하고 나서야 서버가 다시 계산해 실수령이 확 달라졌다(상여 250만 기준 약 38만원 차이).
 *   저장할 때와 똑같은 공식을 서버에서 그대로 계산해 돌려줘, 화면과 저장 결과를 일치시킨다.
 *
 * 요청: GET ?taxableBase=6071429&memberUid=101
 * 응답: { ok, data: { nationalPension, healthInsurance, longTermCare,
 *                     employmentInsurance, incomeTax, localTax, totalDeduction,
 *                     dependents, children, pensionCapped } }
 * 권한: super_admin 전용 (급여 화면과 동일)
 */
import { jsonRes } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { loadPayrollSettings, computeDeductions } from "../../lib/payroll-calc";

export const config = { path: "/api/admin-payroll-deduction-preview" };

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  if ((auth.ctx.member as any).role !== "super_admin") {
    return jsonRes({ ok: false, error: "슈퍼어드민 전용" }, { status: 403 });
  }

  let step = "parse";
  try {
    const url = new URL(req.url);
    const taxableBase = Math.max(0, Number(url.searchParams.get("taxableBase") || 0));
    const memberUid = url.searchParams.get("memberUid");

    step = "tax_profile";
    /* 공제대상가족·자녀 수 — 간이세액표 열을 고르는 기준. 못 읽으면 본인 1명으로 본다. */
    let dependents = 1, children = 0;
    if (memberUid) {
      try {
        const r: any = await db.execute(sql`
          SELECT COALESCE(tax_dependents, 1) AS d, COALESCE(tax_children, 0) AS c
            FROM members WHERE id = ${Number(memberUid)} LIMIT 1
        `);
        const row = ((r as any).rows ?? r ?? [])[0];
        if (row) { dependents = Number(row.d) || 1; children = Number(row.c) || 0; }
      } catch (err) {
        console.warn("[payroll-preview] 가족정보 조회 실패 — 본인 1명 기준:", err);
      }
    }

    step = "compute";
    const settings = await loadPayrollSettings();
    const d = computeDeductions(taxableBase, settings, { dependents, children });
    const totalDeduction =
      d.nationalPension + d.healthInsurance + d.longTermCare +
      d.employmentInsurance + d.incomeTax + d.localTax;

    return jsonRes({
      ok: true,
      data: {
        ...d,
        totalDeduction,
        dependents,
        children,
        /* 국민연금 상한이 걸린 달인지 — 화면에서 그 사실을 안내한다 */
        pensionCapped: settings.pensionCap > 0 && taxableBase > settings.pensionCap,
        pensionCap: settings.pensionCap,
      },
    });
  } catch (err: any) {
    return jsonRes({
      ok: false, error: "공제 미리보기 실패", step,
      detail: String(err?.message || err).slice(0, 400),
    }, { status: 500 });
  }
}
