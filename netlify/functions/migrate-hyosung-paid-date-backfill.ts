// netlify/functions/migrate-hyosung-paid-date-backfill.ts
// #BACKFILL-1 — 옛 효성 후원 7건 결제일 백필 (1회용)
//
// 실행: 어드민 로그인 후 주소창에
//   https://tbfa-siren-cms.netlify.app/api/migrate-hyosung-paid-date-backfill?run=1
// 진단: ?run=1 없이 접속 (인증 불필요) — 후보 행 수만 응답
// 멱등: hyosung_paid_date IS NULL 조건이라 재실행해도 부작용 없음
// 출처: docs/issues/2026-05-10-hyosung-paid-date-backfill.md (옵션 A)

import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-hyosung-paid-date-backfill" };

export default async function handler(req: Request, _ctx: Context) {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  /* ── 진단 모드 ── */
  if (!run) {
    try {
      const res: any = await db.execute(sql`
        SELECT
          (SELECT COUNT(*)::int FROM donations
            WHERE pg_provider = 'hyosung_cms'
              AND hyosung_paid_date IS NULL
              AND memo ~ '결제일: \\d{4}-\\d{2}-\\d{2}'
          ) AS candidates,
          (SELECT COUNT(*)::int FROM donations
            WHERE pg_provider = 'hyosung_cms'
              AND hyosung_paid_date IS NULL
          ) AS hyosung_null_total,
          (SELECT COUNT(*)::int FROM donations
            WHERE pg_provider = 'hyosung_cms'
          ) AS hyosung_total
      `);
      const row = (res?.rows ?? res)[0] ?? {};
      return new Response(
        JSON.stringify({ ok: true, mode: "diagnostic", state: row }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    } catch (err: any) {
      return new Response(
        JSON.stringify({ ok: false, error: String(err?.message || err) }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  }

  /* ── 실행 모드 — 어드민 인증 ── */
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  try {
    const before: any = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM donations
       WHERE pg_provider = 'hyosung_cms'
         AND hyosung_paid_date IS NULL
         AND memo ~ '결제일: \\d{4}-\\d{2}-\\d{2}'
    `);
    const candidatesBefore = ((before?.rows ?? before)[0] ?? {}).n ?? 0;

    const result: any = await db.execute(sql`
      UPDATE donations
         SET hyosung_paid_date = (regexp_match(memo, '결제일: (\\d{4}-\\d{2}-\\d{2})'))[1]::timestamp
       WHERE pg_provider = 'hyosung_cms'
         AND hyosung_paid_date IS NULL
         AND memo ~ '결제일: \\d{4}-\\d{2}-\\d{2}'
       RETURNING id, hyosung_paid_date
    `);
    const updatedRows = result?.rows ?? result ?? [];
    const updatedCount = Array.isArray(updatedRows) ? updatedRows.length : 0;

    const after: any = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM donations
       WHERE pg_provider = 'hyosung_cms'
         AND hyosung_paid_date IS NULL
    `);
    const hyosungNullAfter = ((after?.rows ?? after)[0] ?? {}).n ?? 0;

    return new Response(
      JSON.stringify({
        ok: true,
        candidates_before: candidatesBefore,
        updated: updatedCount,
        hyosung_null_after: hyosungNullAfter,
        sample: Array.isArray(updatedRows) ? updatedRows.slice(0, 10) : [],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "백필 실패",
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
