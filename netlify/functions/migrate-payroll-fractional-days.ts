/**
 * /api/migrate-payroll-fractional-days?run=1   — 1회용 (호출 후 파일 삭제)
 *
 * payroll_slips.working_days 를 정수 → 소수(numeric)로 넓힌다.
 *
 * 왜 필요한가:
 *   지급일수를 실제 근무시간으로 산정하도록 바뀌면서(2026-07-12 Swain 정책)
 *   반차 0.5일 · 반반차 0.75일 처럼 소수 근무일수가 나온다.
 *   그런데 working_days 가 integer 라 저장이 통째로 실패한다
 *   ("invalid input syntax for type integer: 10.75" — 재집계 전체가 중단됨).
 *
 * 안전: 컬럼 폭을 넓히기만 한다(정수는 그대로 담긴다). 값 손실 없음. 멱등.
 *
 * GET (기본) : 진단 (인증 불필요)
 * GET ?run=1 : 어드민 인증 후 실행
 */
import { db } from "../../db/index";
import { sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-payroll-fractional-days" };

const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), { status, headers: JSON_HEADER });
}
const rows = (r: any) => ((r as any).rows ?? r ?? []) as any[];

async function inspect() {
  const r: any = await db.execute(sql`
    SELECT column_name, data_type, numeric_precision, numeric_scale
      FROM information_schema.columns
     WHERE table_name = 'payroll_slips'
       AND column_name IN ('working_days','paid_leave_days','unpaid_leave_days')
     ORDER BY column_name
  `);
  const cols = rows(r);
  const wd = cols.find((c: any) => c.column_name === "working_days");
  return {
    컬럼: cols.map((c: any) => ({
      이름: c.column_name,
      타입: c.data_type + (c.numeric_precision ? `(${c.numeric_precision},${c.numeric_scale})` : ""),
    })),
    done: !!wd && String(wd.data_type) === "numeric" && Number(wd.numeric_scale) >= 2,
  };
}

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  if (!run) {
    try {
      const s = await inspect();
      return json({
        ok: true, mode: "diagnose",
        message: s.done ? "이미 적용되어 있습니다" : "미적용 — 어드민 로그인 후 ?run=1 로 호출하세요",
        state: s,
      });
    } catch (err: any) {
      return json({ ok: false, step: "diagnose", detail: String(err?.message ?? err).slice(0, 500) }, 500);
    }
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const before = await inspect().catch(() => null);

  try {
    /* 지급일수는 0.25 단위 → 소수 둘째 자리까지. 최대 31일이므로 precision 6이면 충분. */
    await db.execute(sql`
      ALTER TABLE payroll_slips
        ALTER COLUMN working_days TYPE numeric(6,2) USING working_days::numeric(6,2)
    `);
    /* 휴가일수도 0.25 단위가 들어올 수 있으므로 소수 둘째 자리까지 넓힌다 (기존 numeric(5,1)) */
    await db.execute(sql`
      ALTER TABLE payroll_slips
        ALTER COLUMN paid_leave_days TYPE numeric(6,2) USING paid_leave_days::numeric(6,2)
    `);
    await db.execute(sql`
      ALTER TABLE payroll_slips
        ALTER COLUMN unpaid_leave_days TYPE numeric(6,2) USING unpaid_leave_days::numeric(6,2)
    `);
  } catch (err: any) {
    return json({ ok: false, step: "alter", detail: String(err?.message ?? err).slice(0, 500) }, 500);
  }

  const after = await inspect().catch(() => null);
  return json({
    ok: true, mode: "run",
    message: "지급일수를 소수로 저장할 수 있게 컬럼을 넓혔습니다 (반차 0.5일 · 반반차 0.75일)",
    before, after,
  });
}
