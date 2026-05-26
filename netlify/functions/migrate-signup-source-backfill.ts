// netlify/functions/migrate-signup-source-backfill.ts
// ★ 2026-05-26 1회용 마이그레이션 — 과거 웹 가입자 가입경로(signup_source_id) 백필
//
// 배경: auth-signup이 가입경로를 기록하지 않아 그간 웹 가입 회원의 signup_source_id가
//       모두 NULL → 대시보드·통합분석·가입회원관리 집계에서 '웹 가입'으로 잡히지 않음.
//       신규 가입은 코드 fix로 'website' 기록되나, 기존 NULL 회원은 본 백필로 정정.
//
// 대상: signup_source_id IS NULL AND hyosung_member_no IS NULL (효성 자동회원 제외)
//       → 'website' 코드의 signup_sources.id 부여.
//
// 사용:
//   - GET (인증 불필요)       : 진단 — 영향 건수·유형별 분포 미리보기 (변경 없음)
//   - GET ?run=1 (어드민 인증) : 실제 백필 실행 (멱등 — 이미 채워진 행은 미대상)
//
// 호출 성공 후 즉시 파일 삭제 + 커밋 (1회용 보안 원칙·CLAUDE.md §6.8)

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  try {
    /* 'website' 가입경로 id·현재 라벨 확인 (없으면 백필 불가) */
    const srcRows: any[] = await db.execute(sql`
      SELECT id, label FROM signup_sources WHERE code = 'website' LIMIT 1
    `);
    const websiteId = srcRows?.[0]?.id ?? null;
    const currentLabel = srcRows?.[0]?.label ?? null;
    const TARGET_LABEL = "싸이렌웹"; // Swain 2026-05-26: 웹 가입자는 '싸이렌웹'으로 표시

    /* 백필 대상 진단 (항상 계산) */
    const diagRows: any[] = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE signup_source_id IS NULL)::int                              AS null_total,
        COUNT(*) FILTER (WHERE signup_source_id IS NULL AND hyosung_member_no IS NULL)::int AS will_backfill,
        COUNT(*) FILTER (WHERE signup_source_id IS NULL AND hyosung_member_no IS NOT NULL)::int AS null_hyosung
      FROM members
    `);
    const byTypeRows: any[] = await db.execute(sql`
      SELECT type, COUNT(*)::int AS cnt
      FROM members
      WHERE signup_source_id IS NULL AND hyosung_member_no IS NULL
      GROUP BY type
      ORDER BY cnt DESC
    `);
    const diag = {
      websiteSourceId: websiteId,
      currentLabel,
      targetLabel: TARGET_LABEL,
      nullTotal: diagRows?.[0]?.null_total ?? 0,
      willBackfill: diagRows?.[0]?.will_backfill ?? 0,
      nullHyosungExcluded: diagRows?.[0]?.null_hyosung ?? 0,
      byType: byTypeRows.map((r) => ({ type: r.type, count: r.cnt })),
    };

    if (!run) {
      return json({
        ok: true,
        mode: "diagnose",
        hint: "?run=1 (어드민 로그인) 으로 실제 백필 실행",
        diag,
      });
    }

    /* 실행 모드 — 어드민 인증 */
    const auth = await requireAdmin(req);
    if (guardFailed(auth)) return auth.res;

    if (!websiteId) {
      return json({ ok: false, step: "website_source", error: "signup_sources에 'website' 코드가 없습니다. 시드 먼저 필요." }, 400);
    }

    /* 웹 가입경로 라벨을 '싸이렌웹'으로 통일 (회원 목록 가입경로 컬럼 표시) */
    await db.execute(sql`
      UPDATE signup_sources
      SET label = ${TARGET_LABEL}, updated_at = NOW()
      WHERE code = 'website' AND label IS DISTINCT FROM ${TARGET_LABEL}
    `);

    const updRes: any = await db.execute(sql`
      UPDATE members
      SET signup_source_id = ${websiteId}, updated_at = NOW()
      WHERE signup_source_id IS NULL
        AND hyosung_member_no IS NULL
    `);
    /* postgres-js: execute는 영향 행 배열/메타를 반환 — count는 재조회로 확정 */
    const afterRows: any[] = await db.execute(sql`
      SELECT COUNT(*) FILTER (WHERE signup_source_id IS NULL AND hyosung_member_no IS NULL)::int AS remaining
      FROM members
    `);

    return json({
      ok: true,
      mode: "run",
      backfilledTo: websiteId,
      labelSetTo: TARGET_LABEL,
      labelWas: currentLabel,
      beforeWillBackfill: diag.willBackfill,
      remainingNullNonHyosung: afterRows?.[0]?.remaining ?? 0,
      note: "remaining이 0이면 백필 완료. 웹 가입경로 라벨='싸이렌웹'. 효성 자동회원(hyosung_member_no)은 의도적으로 제외.",
    });
  } catch (err: any) {
    return json({
      ok: false,
      step: "backfill",
      error: "가입경로 백필 실패",
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }, 500);
  }
};

export const config = { path: "/api/migrate-signup-source-backfill" };
