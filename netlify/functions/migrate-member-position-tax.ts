/**
 * /api/migrate-member-position-tax?run=1   — 1회용 (호출 후 파일 삭제)
 *
 * 직원 정보에 '직책'과 '소득세 계산에 필요한 가족 정보'를 추가한다.
 *
 * 왜 필요한가:
 *   1) 급여명세서의 '직책'이 지금은 milestone_role(성과관리 역할 · 예 "PM")을 그대로 쓰고 있다.
 *      실제 직책(정책국장·사무국장)을 담을 곳이 아예 없었다.
 *   2) 소득세는 근로소득 간이세액표로 계산하는데, '공제대상가족의 수'(본인 포함)와
 *      '8세 이상 20세 이하 자녀 수'가 있어야 정확히 산출된다. 저장할 곳이 없었다.
 *      → 기본값: 공제대상가족 1명(본인만) · 자녀 0명 (Swain: 현 직원 둘 다 부양가족 없음)
 *
 * 안전: 컬럼 추가만 (기존 값 손실 없음). 멱등.
 *
 * GET (기본) : 진단 (인증 불필요)
 * GET ?run=1 : 어드민 인증 후 실행
 */
import { db } from "../../db/index";
import { sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-member-position-tax" };

const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), { status, headers: JSON_HEADER });
}
const rows = (r: any) => ((r as any).rows ?? r ?? []) as any[];

async function inspect() {
  const r: any = await db.execute(sql`
    SELECT column_name FROM information_schema.columns
     WHERE table_name = 'members'
       AND column_name IN ('position', 'tax_dependents', 'tax_children')
  `);
  const cols = rows(r).map((c: any) => c.column_name).sort();
  return { 컬럼: cols, done: cols.length === 3 };
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

  try {
    await db.execute(sql`
      ALTER TABLE members
        ADD COLUMN IF NOT EXISTS position       varchar(50),
        ADD COLUMN IF NOT EXISTS tax_dependents integer NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS tax_children   integer NOT NULL DEFAULT 0
    `);
  } catch (err: any) {
    return json({ ok: false, step: "alter", detail: String(err?.message ?? err).slice(0, 500) }, 500);
  }

  /* 현 직원 직책 시드 (Swain 확인) — 이미 값이 있으면 건드리지 않는다 */
  let seeded = 0;
  const SEED: Array<[number, string]> = [
    [65, "정책국장"],   // 김광일
    [101, "사무국장"],  // 김주안
  ];
  for (const [id, pos] of SEED) {
    try {
      const r: any = await db.execute(sql`
        UPDATE members SET position = ${pos}
         WHERE id = ${id} AND (position IS NULL OR position = '')
         RETURNING id
      `);
      seeded += rows(r).length;
    } catch (err) {
      console.warn(`[migrate-member-position-tax] 직책 시드 실패 id=${id}:`, err);
    }
  }

  const after = await inspect().catch(() => null);
  return json({
    ok: true, mode: "run",
    message: `직책·소득세 가족정보 컬럼 추가 완료 (직책 ${seeded}명 시드)`,
    after,
    안내: "직책·공제대상가족 수는 급여관리 → 직원 설정에서 수정할 수 있습니다",
  });
}
