// netlify/functions/migrate-fix-expert-pool.ts
//
// 1회용 마이그레이션 (2026-05-16)
//
// 배경: admin-eligibility-review.ts가 자격 변경 승인 시 members.eligibility_type
//       만 박고, 매칭 풀 조건에 필요한 members.type='volunteer'·member_subtype·
//       secondary_verified 컬럼을 안 박았음. 그래서 옛날에 자격 변경 승인된
//       변호사·심리상담사 회원들이 전문가 프로필 관리·매칭 관리 화면에 안 표시됨.
//
// 조치: eligibility_type IN ('lawyer','counselor')인 회원 중 매칭 풀 조건이
//       안 맞는 사람들을 일괄 정정.
//
// 호출 (★ 공식 도메인 tbfa.co.kr 사용 — Netlify 기본 도메인 금지):
//   GET  https://tbfa.co.kr/api/migrate-fix-expert-pool        → 진단(인증 불필요)
//   GET  https://tbfa.co.kr/api/migrate-fix-expert-pool?run=1  → 실행(어드민 세션)
//
// 호출 후 본 파일은 삭제 + push.

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-fix-expert-pool" };

const JSON_HEADER = { "Content-Type": "application/json" };

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: JSON_HEADER });
}

export default async function handler(req: Request, _ctx: Context) {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  /* 진단 — 현재 상태 카운트 */
  let diagnose: any;
  try {
    const r: any = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE eligibility_type IN ('lawyer','counselor'))::int AS expert_eligibility_count,
        COUNT(*) FILTER (
          WHERE eligibility_type IN ('lawyer','counselor')
            AND type = 'volunteer'
            AND member_subtype = eligibility_type
            AND secondary_verified = true
        )::int AS already_in_pool,
        COUNT(*) FILTER (
          WHERE eligibility_type IN ('lawyer','counselor')
            AND (type <> 'volunteer'
                 OR member_subtype IS NULL
                 OR member_subtype <> eligibility_type
                 OR secondary_verified IS DISTINCT FROM true)
        )::int AS to_fix_count
      FROM members
    `);
    diagnose = (r?.rows ?? r ?? [])[0] ?? {};
  } catch (err: any) {
    return json({ ok: false, step: "diagnose", error: String(err?.message || err).slice(0, 500) }, 500);
  }

  if (!run) {
    return json({
      ok: true,
      mode: "diagnose",
      message: "진단 모드 — ?run=1 + 어드민 세션으로 실행.",
      diagnose,
    });
  }

  /* 실행 — 어드민 세션 */
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  try {
    const r: any = await db.execute(sql`
      UPDATE members
         SET type = 'volunteer',
             member_subtype = eligibility_type,
             secondary_verified = true,
             secondary_verified_at = COALESCE(secondary_verified_at, NOW()),
             updated_at = NOW()
       WHERE eligibility_type IN ('lawyer','counselor')
         AND (type <> 'volunteer'
              OR member_subtype IS NULL
              OR member_subtype <> eligibility_type
              OR secondary_verified IS DISTINCT FROM true)
    `);
    const affected = (r as any)?.count ?? (r as any)?.rowCount ?? 0;

    /* 검증 — 정정 후 잔여 확인 */
    const r2: any = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (
          WHERE eligibility_type IN ('lawyer','counselor')
            AND type = 'volunteer'
            AND member_subtype = eligibility_type
            AND secondary_verified = true
        )::int AS now_in_pool,
        COUNT(*) FILTER (
          WHERE eligibility_type IN ('lawyer','counselor')
            AND (type <> 'volunteer'
                 OR member_subtype IS NULL
                 OR member_subtype <> eligibility_type
                 OR secondary_verified IS DISTINCT FROM true)
        )::int AS leftover_count
      FROM members
    `);
    const after = (r2?.rows ?? r2 ?? [])[0] ?? {};

    return json({
      ok: true,
      mode: "executed",
      message: `옛 자격 변경 승인 회원 ${affected}명을 전문가 매칭 풀 조건에 맞게 정정 완료.`,
      affected,
      before: diagnose,
      after,
    });
  } catch (err: any) {
    return json({
      ok: false,
      step: "update",
      error: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }, 500);
  }
}
