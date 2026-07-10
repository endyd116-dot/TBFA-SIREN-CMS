/**
 * admin-att-leave-policy: 연차 산정 정책 설정 (슈퍼어드민 전용)
 *
 *  att_policies 기본행(is_default=true)의 연차 산정 6필드만 다룬다.
 *  근무 정책 본체(출퇴근 시각·지각 유예 등)는 admin-att-policy 가 별도 관리
 *  (같은 행·다른 컬럼이라 충돌 없음).
 *
 *  GET  /api/admin-att-leave-policy           → 현재 연차 정책 (행 없으면 시드 후 반환)
 *  PUT  /api/admin-att-leave-policy  { ... }  → 수정 (행 없으면 UPSERT 시드 — P1-17 교훈)
 *
 *  super_admin 판정 = ctx.member.role (DB값). admin JWT의 role은 type=admin이면
 *  전부 super_admin으로 취급되어 신뢰 불가 → admin-att-policy 와 동일 패턴.
 *
 *  모드 A (5인 이하): 월 만근 시 +perfect_bonus_per_month 일
 *  모드 B (5인 이상): 1주년 annual_base_days + floor(근속년수/increment_years)*increment_days
 *                     (상한 annual_cap_days)
 */
import { db } from "../../db/index";
import { attPolicies } from "../../db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { canAccess } from "../../lib/role-permission-check";

export const config = { path: "/api/admin-att-leave-policy" };

function jsonOk(data: unknown) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "연차 정책 처리 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}

// is_default=true 기본행 조회 — 없으면 시드 (P1-17: 설정 행 부재 시 UPSERT 시드 보장)
async function getOrSeedDefault() {
  const rows = await db.select().from(attPolicies)
    .where(eq(attPolicies.isDefault, true)).limit(1);
  if (rows[0]) return rows[0];
  const [seeded] = await db.insert(attPolicies)
    .values({ name: "기본 근무 정책", isDefault: true } as any)
    .returning();
  return seeded;
}

// 연차 산정 6필드만 추출 (numeric 컬럼은 number로 정규화해 클라이언트 전달)
function pickLeaveFields(row: any) {
  return {
    leaveAccrualMode:     row.leaveAccrualMode,
    annualBaseDays:       Number(row.annualBaseDays),
    annualIncrementDays:  Number(row.annualIncrementDays),
    annualIncrementYears: Number(row.annualIncrementYears),
    annualCapDays:        Number(row.annualCapDays),
    perfectBonusPerMonth: Number(row.perfectBonusPerMonth),
  };
}

// 값 검증 — 숫자 아니면 기존값 유지, 범위 클램프
function toNum(v: any, fallback: number, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export default async function handler(req: Request) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  // P2-39 fix: 조회(GET)는 근태 설정 권한(att_config) 국장 허용, 변경은 이사장(super_admin) 전용
  const _role = (auth as any).ctx.member.role ?? "";
  if (req.method === "GET"
        ? !(_role === "super_admin" || await canAccess(_role, "att_config"))
        : _role !== "super_admin") {
    return new Response(JSON.stringify({ ok: false, error: req.method === "GET" ? "근태 설정 조회 권한이 없습니다" : "슈퍼어드민 전용" }), {
      status: 403, headers: { "Content-Type": "application/json" },
    });
  }

  if (req.method === "GET") {
    try {
      const row = await getOrSeedDefault();
      return jsonOk(pickLeaveFields(row));
    } catch (err) {
      return jsonError("select_policy", err);
    }
  }

  if (req.method === "PUT") {
    let body: any;
    try { body = await req.json(); } catch { body = {}; }

    try {
      const existing = await getOrSeedDefault();
      const mode = body.leaveAccrualMode === "B" ? "B" : "A";
      const next = {
        leaveAccrualMode:     mode,
        annualBaseDays:       String(toNum(body.annualBaseDays,       Number(existing.annualBaseDays),       0, 365)),
        annualIncrementDays:  String(toNum(body.annualIncrementDays,  Number(existing.annualIncrementDays),  0, 365)),
        annualIncrementYears: Math.round(toNum(body.annualIncrementYears, Number(existing.annualIncrementYears), 1, 50)),
        annualCapDays:        String(toNum(body.annualCapDays,        Number(existing.annualCapDays),        0, 365)),
        perfectBonusPerMonth: String(toNum(body.perfectBonusPerMonth, Number(existing.perfectBonusPerMonth), 0, 31)),
        updatedAt:            new Date(),
      };
      const [row] = await db.update(attPolicies)
        .set(next as any)
        .where(eq(attPolicies.id, existing.id))
        .returning();
      return jsonOk(pickLeaveFields(row));
    } catch (err) {
      return jsonError("update_policy", err);
    }
  }

  return new Response("Method Not Allowed", { status: 405 });
}
