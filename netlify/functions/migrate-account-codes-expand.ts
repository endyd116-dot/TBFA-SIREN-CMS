/**
 * 계정과목 마스터 확장 시드 — NPO 표준 회계 계정과목 (비용 27 + 수익 10 = 37건)
 *
 * GET /api/migrate-account-codes-expand            → 진단 (인증 불필요)
 * GET /api/migrate-account-codes-expand?run=1      → 37건 UPSERT (어드민 인증)
 *
 * account_codes 테이블은 이미 존재 (Phase 22-D-R1) — 스키마 변경 없음, 데이터 시드만.
 * 멱등성: ON CONFLICT (code) DO UPDATE — 기존 18건은 name/parent/category/sort_order 갱신,
 *         is_active 는 건드리지 않음 (어드민이 비활성화한 코드 보호).
 * 호출 성공 후 즉시 파일 삭제할 것 (1회용 보안 원칙).
 *
 * 코드 체계: 대분류 3자리 + 소분류 4자리, parent_code 로 계층 명시.
 *  - 수익: 401 사업수익 / 402 사업외수익
 *  - 비용: 501 인건비 / 502 사업비 / 503 관리운영비 / 504 모금비
 *  - 503 관리운영비는 소분류가 13개라 5037~5040 + 5043~5045 사용 (5041·5042는 기존 모금비 점유)
 */
import type { Context } from "@netlify/functions";
import { neon } from "@neondatabase/serverless";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-account-codes-expand" };

/** [code, name, parentCode, category, sortOrder] */
const SEED: Array<[string, string, string | null, string, number]> = [
  // ── 수익 ──────────────────────────────────────────────
  ["401",  "사업수익",             null,  "income", 10],
  ["4011", "후원금·기부금수익",    "401", "income", 20],
  ["4012", "보조금수익",           "401", "income", 30],
  ["4013", "회비수익",             "401", "income", 40],
  ["4014", "사업수익(교육·용역)",  "401", "income", 50],
  ["402",  "사업외수익",           null,  "income", 60],
  ["4021", "이자수익",             "402", "income", 70],
  ["4022", "잡수익",               "402", "income", 80],
  ["4023", "자산처분이익",         "402", "income", 90],
  // ── 인건비 ────────────────────────────────────────────
  ["501",  "인건비",               null,  "personnel", 100],
  ["5011", "급여",                 "501", "personnel", 110],
  ["5012", "퇴직급여",             "501", "personnel", 120],
  ["5013", "복리후생비",           "501", "personnel", 130],
  ["5014", "일용·외주인건비",      "501", "personnel", 140],
  // ── 사업비 ────────────────────────────────────────────
  ["502",  "사업비",               null,  "program", 150],
  ["5021", "교육·상담비",          "502", "program", 160],
  ["5022", "캠페인·행사비",        "502", "program", 170],
  ["5023", "장학금",               "502", "program", 180],
  ["5024", "지원금",               "502", "program", 190],
  ["5025", "사업도서인쇄비",       "502", "program", 200],
  // ── 관리운영비 ────────────────────────────────────────
  ["503",  "관리운영비",           null,  "admin_ops", 210],
  ["5031", "임차료",               "503", "admin_ops", 220],
  ["5032", "통신비",               "503", "admin_ops", 230],
  ["5033", "사무용품비",           "503", "admin_ops", 240],
  ["5034", "공과금(광열수도)",     "503", "admin_ops", 250],
  ["5035", "차량유지비",           "503", "admin_ops", 260],
  ["5036", "업무추진비",           "503", "admin_ops", 270],
  ["5037", "여비교통비",           "503", "admin_ops", 280],
  ["5038", "회의비",               "503", "admin_ops", 290],
  ["5039", "지급수수료",           "503", "admin_ops", 300],
  ["5040", "세금과공과",           "503", "admin_ops", 310],
  ["5043", "보험료",               "503", "admin_ops", 320],
  ["5044", "감가상각비",           "503", "admin_ops", 330],
  ["5045", "잡비",                 "503", "admin_ops", 340],
  // ── 모금비 ────────────────────────────────────────────
  ["504",  "모금비",               null,  "fundraising", 350],
  ["5041", "홍보비",               "504", "fundraising", 360],
  ["5042", "모금행사비",           "504", "fundraising", 370],
];

export default async function handler(req: Request, _ctx: Context) {
  const url   = new URL(req.url);
  const doRun = url.searchParams.get("run") === "1";
  const sql   = neon(process.env.NETLIFY_DATABASE_URL!);

  // ── 진단 모드 ──────────────────────────────────────────
  if (!doRun) {
    const [t]    = await sql`SELECT COUNT(*) AS n FROM account_codes`;
    const [act]  = await sql`SELECT COUNT(*) AS n FROM account_codes WHERE is_active = TRUE`;
    return new Response(JSON.stringify({
      ok: true, mode: "diagnostic",
      currentTotal:  Number(t.n),
      currentActive: Number(act.n),
      seedTarget:    SEED.length,
      hint: "?run=1 으로 37건 UPSERT (어드민 인증 필요)",
    }), { headers: { "Content-Type": "application/json" } });
  }

  // ── 인증 ──────────────────────────────────────────────
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  // ── Run 모드 — UPSERT ─────────────────────────────────
  let inserted = 0;
  let updated  = 0;
  try {
    for (const [code, name, parentCode, category, sortOrder] of SEED) {
      const result = await sql`
        INSERT INTO account_codes (code, name, parent_code, category, is_active, sort_order)
        VALUES (${code}, ${name}, ${parentCode}, ${category}, TRUE, ${sortOrder})
        ON CONFLICT (code) DO UPDATE SET
          name        = EXCLUDED.name,
          parent_code = EXCLUDED.parent_code,
          category    = EXCLUDED.category,
          sort_order  = EXCLUDED.sort_order
        RETURNING (xmax = 0) AS is_insert`;
      if (result[0]?.is_insert) inserted++;
      else updated++;
    }
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false, error: "UPSERT 실패",
      insertedSoFar: inserted, updatedSoFar: updated,
      detail: String(err?.message || err).slice(0, 500),
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  return new Response(JSON.stringify({
    ok: true, mode: "executed",
    inserted, updated, total: SEED.length,
    message: `계정과목 시드 완료 — 신규 ${inserted}건 / 갱신 ${updated}건 (전체 ${SEED.length}건)`,
  }), { headers: { "Content-Type": "application/json" } });
}
