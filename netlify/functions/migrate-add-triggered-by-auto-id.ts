// netlify/functions/migrate-add-triggered-by-auto-id.ts
// 1회용 마이그레이션 — communication_send_jobs.triggered_by_auto_id 컬럼 추가
//
// schema.ts 2261번째 줄에 정의된 컬럼이 실제 DB에 ALTER 안 됐던 상태.
// 발송 분석 'AI 트리거 효과' 카드가 표시되지 않던 결함의 근본 원인.
//
// 호출:
//   진단: https://tbfa.co.kr/api/migrate-add-triggered-by-auto-id
//   실행: https://tbfa.co.kr/api/migrate-add-triggered-by-auto-id?run=1 (어드민 로그인 후 주소창)
//
// 호출 후 본 파일 삭제 + push.

import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-add-triggered-by-auto-id" };

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  /* ── 진단 모드 (인증 불필요) ── */
  try {
    const colCheck: any = await db.execute(sql`
      SELECT 1 AS ok FROM information_schema.columns
       WHERE table_name = 'communication_send_jobs'
         AND column_name = 'triggered_by_auto_id'
       LIMIT 1
    `);
    const exists = ((colCheck?.rows ?? colCheck ?? [])[0] || {}).ok === 1;

    if (!run) {
      return new Response(
        JSON.stringify({
          ok: true,
          mode: "diagnose",
          columnExists: exists,
          hint: exists
            ? "이미 컬럼이 존재합니다. ?run=1 실행 시 멱등으로 추가 작업 없이 종료."
            : "컬럼 없음. ?run=1 호출로 ALTER TABLE 적용 필요(어드민 로그인 상태).",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    /* ── 실행 모드 (어드민 인증 필수) ── */
    const auth = await requireAdmin(req);
    if (!auth.ok) return (auth as { ok: false; res: Response }).res;

    if (exists) {
      return new Response(
        JSON.stringify({
          ok: true,
          mode: "run",
          changed: false,
          message: "이미 컬럼이 존재합니다(no-op).",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    /* ALTER TABLE — IF NOT EXISTS로 멱등 보장 */
    await db.execute(sql`
      ALTER TABLE communication_send_jobs
        ADD COLUMN IF NOT EXISTS triggered_by_auto_id integer
          REFERENCES communication_auto_triggers(id) ON DELETE SET NULL
    `);

    /* 인덱스 추가 — 조회 성능 (AI 트리거 효과 분석에서 GROUP BY 키) */
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS send_jobs_triggered_by_auto_idx
        ON communication_send_jobs(triggered_by_auto_id)
    `);

    return new Response(
      JSON.stringify({
        ok: true,
        mode: "run",
        changed: true,
        message: "triggered_by_auto_id 컬럼 + FK + 인덱스 추가 완료.",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "마이그레이션 실패",
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
