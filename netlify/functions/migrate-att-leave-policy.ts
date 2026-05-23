/**
 * migrate-att-leave-policy: 연차 산정 정책 컬럼 추가 (1회용)
 *
 *  att_policies(근무 정책 기본행)에 연차 산정 정책 6컬럼:
 *    - leave_accrual_mode       'A'(만근 누적·5인 이하) | 'B'(근속 기반·5인 이상)
 *    - annual_base_days         모드B: 1주년 기준 일수 (기본 12)
 *    - annual_increment_days    모드B: 증가 일수 (기본 1)
 *    - annual_increment_years   모드B: 증가 주기(년) (기본 2)
 *    - annual_cap_days          모드B: 상한 (기본 25)
 *    - perfect_bonus_per_month  모드A: 월 만근 보너스 일수 (기본 1)
 *  members 에 hire_date(입사일·모드B 근속 계산용·NULL이면 created_at 폴백)
 *
 * 호출(어드민 로그인 상태): https://tbfa.co.kr/api/migrate-att-leave-policy?run=1
 *  - GET ?run=1 : requireAdmin 후 실제 실행 (멱등 — ADD COLUMN IF NOT EXISTS)
 *  - GET        : 진단 모드 (인증 불필요 — 현재 컬럼 존재 여부)
 * 적용 성공 확인 후 즉시: schema.ts 정의 활성화 + 본 파일 삭제 + 커밋.
 */
import { db } from "../../db/index";
import { sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-att-leave-policy" };

function json(status: number, data: unknown) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const CHECK_SQL = sql`
  SELECT table_name, column_name, data_type, column_default
  FROM information_schema.columns
  WHERE (table_name = 'att_policies' AND column_name IN
          ('leave_accrual_mode','annual_base_days','annual_increment_days',
           'annual_increment_years','annual_cap_days','perfect_bonus_per_month'))
     OR (table_name = 'members' AND column_name = 'hire_date')
  ORDER BY table_name, column_name
`;

function asRows(res: any): any[] {
  return Array.isArray(res) ? res : (res?.rows ?? []);
}

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  // ── 진단 모드 (인증 불필요) ──
  if (!run) {
    try {
      const rows = asRows(await db.execute(CHECK_SQL));
      return json(200, {
        ok: true,
        mode: "diagnose",
        message: "?run=1 로 실제 실행 (어드민 로그인 필요)",
        existing: rows,
        existingCount: rows.length,
        expectedAfterRun: 7,
      });
    } catch (err: any) {
      return json(500, { ok: false, step: "diagnose", detail: String(err?.message ?? err) });
    }
  }

  // ── 실행 모드 (어드민 인증) ──
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  try {
    // 1) att_policies — 연차 산정 정책 6컬럼 (기본행에 DEFAULT 값으로 채워짐)
    await db.execute(sql`
      ALTER TABLE att_policies
        ADD COLUMN IF NOT EXISTS leave_accrual_mode      varchar(1)   NOT NULL DEFAULT 'A',
        ADD COLUMN IF NOT EXISTS annual_base_days        numeric(5,2) NOT NULL DEFAULT 12,
        ADD COLUMN IF NOT EXISTS annual_increment_days   numeric(5,2) NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS annual_increment_years  integer      NOT NULL DEFAULT 2,
        ADD COLUMN IF NOT EXISTS annual_cap_days         numeric(5,2) NOT NULL DEFAULT 25,
        ADD COLUMN IF NOT EXISTS perfect_bonus_per_month numeric(5,2) NOT NULL DEFAULT 1
    `);

    // 2) members — 입사일(모드B 근속 계산용·NULL 허용·NULL이면 created_at 폴백)
    await db.execute(sql`
      ALTER TABLE members
        ADD COLUMN IF NOT EXISTS hire_date date
    `);

    const rows = asRows(await db.execute(CHECK_SQL));
    return json(200, {
      ok: true,
      mode: "run",
      message: "적용 완료 — schema 정의 활성화 + 본 파일 삭제 진행",
      appliedCount: rows.length,
      expected: 7,
      columns: rows,
    });
  } catch (err: any) {
    return json(500, {
      ok: false,
      step: "alter",
      detail: String(err?.message ?? err).slice(0, 500),
      stack: String(err?.stack ?? "").slice(0, 800),
    });
  }
}
