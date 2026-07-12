/**
 * /api/migrate-purge-test-slips?run=1   — 1회용 (호출 후 파일 삭제)
 *
 * 개발 중 만든 '총괄 관리자' 테스트 명세서를 지운다.
 *
 * 왜 남았나:
 *   전자서명·PDF 기능을 검증하려고 총괄 관리자 계정으로 명세서를 만들어 발송·서명·재발행을
 *   반복했다(정정 20차). 실제 급여가 아니므로 명세서 일람에 남아 있으면 안 된다.
 *
 * 무엇을 지우는가 (실제 직원 명세서는 절대 건드리지 않는다):
 *   - 총괄 관리자(연봉 0원 = 급여 대상이 아닌 계정)의 명세서만
 *   - 딸린 서명 증적·이의제기·수정이력도 함께 (남으면 고아 데이터가 된다)
 *
 * GET (기본) : 진단 (인증 불필요)
 * GET ?run=1 : 어드민 인증 후 실행
 */
import { db } from "../../db/index";
import { sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-purge-test-slips" };

const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), { status, headers: JSON_HEADER });
}
const rows = (r: any) => ((r as any).rows ?? r ?? []) as any[];

/** 삭제 대상 = 연봉이 0인(= 급여 대상이 아닌) 계정 앞으로 만들어진 명세서 */
async function targets() {
  const r: any = await db.execute(sql`
    SELECT s.id, s.pay_year, s.pay_month, s.status, s.gross_pay,
           m.name AS member_name, COALESCE(m.base_salary, 0)::numeric AS base_salary
      FROM payroll_slips s
      JOIN members m ON m.id = NULLIF(s.member_uid, '')::int
     WHERE COALESCE(m.base_salary, 0) = 0
     ORDER BY s.id
  `);
  return rows(r);
}

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  if (!run) {
    try {
      const t = await targets();
      return json({
        ok: true, mode: "diagnose",
        message: t.length ? `삭제 대상 ${t.length}건 — 어드민 로그인 후 ?run=1 로 호출하세요` : "삭제 대상 없음",
        대상: t,
      });
    } catch (err: any) {
      return json({ ok: false, step: "diagnose", detail: String(err?.message ?? err).slice(0, 500) }, 500);
    }
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  try {
    const t = await targets();
    if (t.length === 0) return json({ ok: true, mode: "run", message: "삭제 대상 없음", 삭제: 0 });

    const ids = t.map((x: any) => Number(x.id)).filter(Number.isFinite);
    const idList = sql.raw(ids.join(","));   // 배열 파라미터는 postgres-js 직렬화 실패 → 숫자 목록으로 전개

    /* 딸린 기록부터 (FK·고아 데이터 방지) */
    for (const tbl of ["payroll_acknowledgments", "payroll_objections", "payroll_audit"]) {
      try {
        await db.execute(sql`DELETE FROM ${sql.raw(tbl)} WHERE slip_id IN (${idList})`);
      } catch (err) {
        console.warn(`[migrate-purge-test-slips] ${tbl} 정리 실패(무시하고 계속):`, err);
      }
    }
    await db.execute(sql`DELETE FROM payroll_slips WHERE id IN (${idList})`);

    const after = await targets().catch(() => []);
    return json({
      ok: true, mode: "run",
      message: `테스트 명세서 ${ids.length}건 삭제 완료`,
      삭제한_명세서: t.map((x: any) => `${x.member_name} ${x.pay_year}-${String(x.pay_month).padStart(2, "0")} (${x.status})`),
      남은_대상: after.length,
    });
  } catch (err: any) {
    return json({ ok: false, step: "purge", detail: String(err?.message ?? err).slice(0, 500) }, 500);
  }
}
