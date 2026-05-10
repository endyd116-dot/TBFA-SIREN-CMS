// netlify/functions/migrate-hyosung-paid-date-backfill.ts
// #BACKFILL-1 — 옛 효성 후원 결제일 백필 (1회용)
//
// 실행: 어드민 로그인 후 주소창에
//   https://tbfa-siren-cms.netlify.app/api/migrate-hyosung-paid-date-backfill?run=1
// 진단: ?run=1 없이 접속 (인증 불필요) — 보강된 진단 응답 (memo 샘플 + 후보 컬럼 점검)
// 멱등: hyosung_paid_date IS NULL 조건이라 재실행해도 부작용 없음
// 출처: docs/issues/2026-05-10-hyosung-paid-date-backfill.md (옵션 A — 진단 보강 라운드)

import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-hyosung-paid-date-backfill" };

export default async function handler(req: Request, _ctx: Context) {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  /* ── 진단 모드 (보강) ──
   * 1) 효성 후원 행수·NULL 행수·기존 정규식 매칭 행수
   * 2) 다양한 정규식 후보 매칭 행수 (한글 콜론·공백 변형)
   * 3) hyosung_billings.payment_date join 매칭 행수 (가장 안전한 후보)
   * 4) memo 샘플 10건 (id, memo 200자, 청구월 등)
   * 5) pg_provider 분포 (옛 'hyosung' vs 신 'hyosung_cms' 구분)
   */
  if (!run) {
    try {
      /* 1) 기본 카운트 */
      const baseRes: any = await db.execute(sql`
        SELECT
          (SELECT COUNT(*)::int FROM donations
            WHERE pg_provider IN ('hyosung_cms','hyosung')
          ) AS hyosung_total,
          (SELECT COUNT(*)::int FROM donations
            WHERE pg_provider IN ('hyosung_cms','hyosung')
              AND hyosung_paid_date IS NULL
          ) AS hyosung_null_total,
          (SELECT COUNT(*)::int FROM donations
            WHERE pg_provider IN ('hyosung_cms','hyosung')
              AND hyosung_paid_date IS NULL
              AND memo ~ '결제일: \\d{4}-\\d{2}-\\d{2}'
          ) AS regex_v1_match,
          (SELECT COUNT(*)::int FROM donations
            WHERE pg_provider IN ('hyosung_cms','hyosung')
              AND hyosung_paid_date IS NULL
              AND memo ~ '결제일\\s*[::]\\s*\\d{4}[-./]\\d{1,2}[-./]\\d{1,2}'
          ) AS regex_v2_match,
          (SELECT COUNT(*)::int FROM donations
            WHERE pg_provider IN ('hyosung_cms','hyosung')
              AND hyosung_paid_date IS NULL
              AND memo ~ '\\d{4}[-./]\\d{1,2}[-./]\\d{1,2}'
          ) AS regex_any_date_match
      `);
      const base = (baseRes?.rows ?? baseRes)[0] ?? {};

      /* 2) hyosung_billings join 매칭 (donations.hyosung_billing_id 경유) */
      const joinRes: any = await db.execute(sql`
        SELECT
          COUNT(*)::int AS join_match_via_billing_id,
          COUNT(*) FILTER (WHERE hb.payment_date IS NOT NULL)::int AS join_match_with_paydate
        FROM donations d
        LEFT JOIN hyosung_billings hb ON hb.id = d.hyosung_billing_id
        WHERE d.pg_provider IN ('hyosung_cms','hyosung')
          AND d.hyosung_paid_date IS NULL
          AND d.hyosung_billing_id IS NOT NULL
      `);
      const joinByBillingId = (joinRes?.rows ?? joinRes)[0] ?? {};

      /* 3) hyosung_billings join 매칭 (member_no + billing_month 경유) */
      const joinRes2: any = await db.execute(sql`
        SELECT
          COUNT(*)::int AS join_match_via_member_month,
          COUNT(*) FILTER (WHERE hb.payment_date IS NOT NULL)::int AS join_match_with_paydate
        FROM donations d
        LEFT JOIN hyosung_billings hb
          ON hb.member_no = d.hyosung_member_no
         AND hb.billing_month = d.hyosung_billing_month
        WHERE d.pg_provider IN ('hyosung_cms','hyosung')
          AND d.hyosung_paid_date IS NULL
          AND d.hyosung_member_no IS NOT NULL
          AND d.hyosung_billing_month IS NOT NULL
      `);
      const joinByMemberMonth = (joinRes2?.rows ?? joinRes2)[0] ?? {};

      /* 4) memo 샘플 10건 */
      const samplesRes: any = await db.execute(sql`
        SELECT id, pg_provider, hyosung_member_no, hyosung_billing_month, hyosung_billing_id,
               LEFT(COALESCE(memo, ''), 200) AS memo_excerpt,
               created_at
        FROM donations
        WHERE pg_provider IN ('hyosung_cms','hyosung')
          AND hyosung_paid_date IS NULL
        ORDER BY created_at DESC
        LIMIT 10
      `);
      const samples = samplesRes?.rows ?? samplesRes ?? [];

      /* 5) pg_provider 분포 */
      const providerRes: any = await db.execute(sql`
        SELECT pg_provider, COUNT(*)::int AS cnt
        FROM donations
        WHERE pg_provider IN ('hyosung_cms','hyosung')
        GROUP BY pg_provider
      `);
      const providerDist = providerRes?.rows ?? providerRes ?? [];

      /* 6) hyosung_billings 자체 상태 (payment_date 채워진 행 수) */
      const billingsRes: any = await db.execute(sql`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE payment_date IS NOT NULL)::int AS with_paydate,
          COUNT(*) FILTER (WHERE linked_donation_id IS NOT NULL)::int AS linked
        FROM hyosung_billings
      `);
      const billingsState = (billingsRes?.rows ?? billingsRes)[0] ?? {};

      return new Response(
        JSON.stringify({
          ok: true,
          mode: "diagnostic",
          state: base,
          join_via_billing_id: joinByBillingId,
          join_via_member_month: joinByMemberMonth,
          provider_distribution: providerDist,
          hyosung_billings_state: billingsState,
          samples,
        }, null, 2),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    } catch (err: any) {
      return new Response(
        JSON.stringify({
          ok: false, error: String(err?.message || err),
          stack: String(err?.stack || "").slice(0, 1000),
        }),
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
