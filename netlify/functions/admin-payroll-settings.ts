/**
 * /api/admin-payroll-settings — 급여 계산 기준 (단일행 id=1)
 *   GET  현재 설정 조회
 *   PUT  설정 수정 (야근배율·기준시간·근무일수·4대보험 요율·소득세율)
 * 권한: super_admin 전용. (2026-05-20 급여 고도화)
 */
import { jsonRes } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-payroll-settings" };

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  const admin = auth.ctx.member as any;
  if (admin.role !== "super_admin") {
    return jsonRes({ ok: false, error: "슈퍼어드민 전용" }, { status: 403 });
  }

  function jsonError(step: string, err: any) {
    return jsonRes({ ok: false, error: "급여 설정 오류", step,
      detail: String(err?.message || err).slice(0, 400) }, { status: 500 });
  }

  if (req.method === "GET") {
    try {
      const r = await db.execute(sql`SELECT * FROM payroll_settings WHERE id = 1 LIMIT 1`);
      const row = (r as any).rows?.[0] || (r as any[])[0] || null;
      return jsonRes({ ok: true, data: { settings: row } });
    } catch (err) { return jsonError("select", err); }
  }

  if (req.method === "PUT") {
    let body: any;
    try { body = await req.json(); } catch { return jsonRes({ ok: false, error: "JSON 파싱 실패" }, { status: 400 }); }

    // 화이트리스트 (camelCase 입력 → snake 컬럼). 컬럼명은 코드 상수라 안전.
    const MAP: Record<string, any> = {
      overtime_multiplier: body.overtimeMultiplier,
      annual_hours:        body.annualHours,
      monthly_work_days:   body.monthlyWorkDays,
      pension_rate:        body.pensionRate,
      health_rate:         body.healthRate,
      longterm_rate:       body.longtermRate,
      employment_rate:     body.employmentRate,
      income_tax_rate:     body.incomeTaxRate,
    };

    let upd = sql`UPDATE payroll_settings SET updated_at = NOW(), updated_by = ${String(admin.id)}`;
    let changed = false;
    for (const [col, val] of Object.entries(MAP)) {
      if (val === undefined) continue;
      const n = Number(val);
      if (!Number.isFinite(n) || n < 0) {
        return jsonRes({ ok: false, error: `${col} 값 오류 (0 이상 숫자)` }, { status: 400 });
      }
      upd = sql`${upd}, ${sql.raw(col)} = ${n}`;
      changed = true;
    }
    if (!changed) return jsonRes({ ok: false, error: "변경 필드 없음" }, { status: 400 });
    upd = sql`${upd} WHERE id = 1 RETURNING *`;

    /* ★ P1-17 fix: id=1 행이 없으면 UPDATE가 0행이라 "저장 완료"로 보여도 미반영.
       기본값으로 시드 후 UPDATE 보장(모든 컬럼 NOT NULL+default라 id만으로 INSERT 가능). */
    try {
      await db.execute(sql`INSERT INTO payroll_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
    } catch (err) { return jsonError("seed", err); }

    try {
      const r = await db.execute(upd);
      const row = (r as any).rows?.[0] || (r as any[])[0];
      return jsonRes({ ok: true, data: { settings: row } });
    } catch (err) { return jsonError("update", err); }
  }

  return jsonRes({ ok: false, error: "지원하지 않는 메서드" }, { status: 405 });
}
