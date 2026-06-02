/* =========================================================
   migrate-seed-holidays-2026.ts — 1회용 마이그레이션
   2026년 대한민국 공휴일(대체공휴일 포함) att_holidays 시드.
   ※ 5인 미만 사업장이라 공휴일은 '무급휴가' — att_holidays는 날짜·명칭만 보관하고,
     무급 처리는 급여 계산 정책에서 반영(별도). 여기선 달력/근태 인식용 공휴일만 등록.

   호출(★ tbfa.co.kr):
   - GET            : 진단 (인증 불필요) — 이미 있는/추가될 날짜
   - GET ?run=1     : 어드민 인증 후 시드 (멱등 — date UNIQUE, ON CONFLICT DO NOTHING)
   호출 성공 후 파일 삭제 + 커밋.
   ========================================================= */
import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

/* [date, name] — 2026 공휴일 + 대체공휴일 (확정 기준) */
const HOLIDAYS: Array<[string, string]> = [
  ["2026-01-01", "신정"],
  ["2026-02-16", "설날 연휴"],
  ["2026-02-17", "설날"],
  ["2026-02-18", "설날 연휴"],
  ["2026-03-01", "삼일절"],
  ["2026-03-02", "삼일절 대체공휴일"],
  ["2026-05-05", "어린이날"],
  ["2026-05-24", "부처님오신날"],
  ["2026-05-25", "부처님오신날 대체공휴일"],
  ["2026-06-06", "현충일"],
  ["2026-08-15", "광복절"],
  ["2026-08-17", "광복절 대체공휴일"],
  ["2026-09-24", "추석 연휴"],
  ["2026-09-25", "추석"],
  ["2026-09-26", "추석 연휴"],
  ["2026-09-28", "추석 대체공휴일"],
  ["2026-10-03", "개천절"],
  ["2026-10-05", "개천절 대체공휴일"],
  ["2026-10-09", "한글날"],
  ["2026-12-25", "기독탄신일(성탄절)"],
];

export default async (req: Request, _ctx: Context) => {
  const run = new URL(req.url).searchParams.get("run") === "1";
  try {
    const exist: any = await db.execute(sql`SELECT to_char(date,'YYYY-MM-DD') AS d FROM att_holidays WHERE date >= '2026-01-01' AND date <= '2026-12-31'`);
    const have = new Set((exist?.rows ?? exist ?? []).map((r: any) => String(r.d)));
    const toAdd = HOLIDAYS.filter(h => !have.has(h[0])).map(h => h[0]);

    if (!run) {
      return new Response(JSON.stringify({
        ok: true, mode: "diagnostic", total2026: HOLIDAYS.length,
        alreadyExists: HOLIDAYS.map(h => h[0]).filter(d => have.has(d)),
        willAdd: toAdd,
      }), { headers: JSON_HEADER });
    }

    const auth = await requireAdmin(req);
    if (!auth.ok) return (auth as any).res;

    let added = 0;
    for (const [date, name] of HOLIDAYS) {
      await db.execute(sql`
        INSERT INTO att_holidays (date, name, type, created_at)
        VALUES (${date}::date, ${name}, 'PUBLIC', NOW())
        ON CONFLICT (date) DO NOTHING
      `);
    }
    const after: any = await db.execute(sql`SELECT COUNT(*)::int AS c FROM att_holidays WHERE date >= '2026-01-01' AND date <= '2026-12-31'`);
    added = Number((after?.rows ?? after ?? [])[0]?.c ?? 0);
    return new Response(JSON.stringify({
      ok: true, mode: "executed", total2026Now: added,
      message: `2026 공휴일 시드 완료 (총 ${added}일). 5인 미만 무급 처리는 급여 정책에서 반영.`,
    }), { headers: JSON_HEADER });
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false, error: "공휴일 시드 실패", detail: String(err?.message || err).slice(0, 500),
    }), { status: 500, headers: JSON_HEADER });
  }
};

export const config = { path: "/api/migrate-seed-holidays-2026" };
