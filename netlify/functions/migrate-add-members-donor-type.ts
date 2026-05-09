// netlify/functions/migrate-add-members-donor-type.ts
/**
 * 1회용 마이그레이션 — 마일스톤 #16 단계 C (Phase 2)
 *
 * 회원(members) 테이블에 후원 분류 칸 4개 추가 + 인덱스 + 최초 1회 식별 실행.
 *
 * 신규 컬럼:
 *   - donor_type          varchar(20)   'regular'|'prospect'|'none'|NULL
 *   - donor_channels      jsonb         ['toss']|['hyosung']|['toss','hyosung']|[]
 *   - prospect_subtype    varchar(20)   'onetime'|'cancelled'|NULL
 *   - donor_evaluated_at  timestamp     마지막 평가 시각
 *
 * 식별 기준 (마일스톤 §3.2):
 *   - 정기: 토스 next_billing_date 잡힘 OR 효성 hyosung_contract_status='active'
 *   - 잠재 cancelled: 효성 cancelled (토스 cancelled는 cron에서 정교화)
 *   - 잠재 onetime: donations에 completed 1건+
 *   - 비후원: 위 어느 것도 아님
 *
 * 호출:
 *   GET ?run=1     → requireAdmin 후 실행
 *   GET (기본)     → 진단 모드 (인증 불필요)
 *
 * 호출 성공 후:
 *   1. schema.ts에 4개 컬럼 정의 추가 + 인덱스 정의 추가
 *   2. 본 파일 삭제
 *   3. 커밋 + push
 */
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-add-members-donor-type" };

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const run = url.searchParams.get("run");

  // 진단 모드 (인증 불필요)
  if (run !== "1") {
    return new Response(JSON.stringify({
      ok: true,
      mode: "diagnose",
      message: "Phase 2 단계 C 마이그레이션. GET ?run=1로 어드민 인증 후 실행됩니다.",
      operations: [
        "ALTER TABLE members ADD COLUMN IF NOT EXISTS donor_type varchar(20)",
        "ALTER TABLE members ADD COLUMN IF NOT EXISTS donor_channels jsonb DEFAULT '[]'::jsonb",
        "ALTER TABLE members ADD COLUMN IF NOT EXISTS prospect_subtype varchar(20)",
        "ALTER TABLE members ADD COLUMN IF NOT EXISTS donor_evaluated_at timestamp",
        "CREATE INDEX IF NOT EXISTS members_donor_type_idx ON members(donor_type)",
        "CREATE INDEX IF NOT EXISTS members_prospect_subtype_idx ON members(prospect_subtype)",
        "최초 1회 식별: 정기(next_billing_date OR hyosung_contract_status=active) → regular",
        "최초 1회 식별: 효성 cancelled → prospect/cancelled",
        "최초 1회 식별: donations completed 1건+ → prospect/onetime",
        "최초 1회 식별: 나머지 → none",
        "donor_evaluated_at = now()",
      ],
      idempotent: true,
      note: "ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS — 멱등 보장. 식별 UPDATE는 donor_type IS NULL 조건으로 재실행 안전.",
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  // 실행 모드 — requireAdmin
  const auth = await requireAdmin(req);
  if (!auth.ok) {
    return (auth as { ok: false; res: Response }).res;
  }

  const steps: Array<{ step: string; ok?: boolean; count?: number; detail?: string }> = [];

  try {
    // ─── 1. ALTER TABLE 4개 ───
    await db.execute(sql`ALTER TABLE members ADD COLUMN IF NOT EXISTS donor_type varchar(20)`);
    steps.push({ step: "alter_donor_type", ok: true });

    await db.execute(sql`ALTER TABLE members ADD COLUMN IF NOT EXISTS donor_channels jsonb DEFAULT '[]'::jsonb`);
    steps.push({ step: "alter_donor_channels", ok: true });

    await db.execute(sql`ALTER TABLE members ADD COLUMN IF NOT EXISTS prospect_subtype varchar(20)`);
    steps.push({ step: "alter_prospect_subtype", ok: true });

    await db.execute(sql`ALTER TABLE members ADD COLUMN IF NOT EXISTS donor_evaluated_at timestamp`);
    steps.push({ step: "alter_donor_evaluated_at", ok: true });

    // ─── 2. 인덱스 2개 ───
    await db.execute(sql`CREATE INDEX IF NOT EXISTS members_donor_type_idx ON members(donor_type)`);
    steps.push({ step: "create_index_donor_type", ok: true });

    await db.execute(sql`CREATE INDEX IF NOT EXISTS members_prospect_subtype_idx ON members(prospect_subtype)`);
    steps.push({ step: "create_index_prospect_subtype", ok: true });

    // ─── 3. 최초 1회 식별 ───

    // 3-1. 정기 후원자 — 토스(next_billing_date) OR 효성(active)
    const regularResult: any = await db.execute(sql`
      UPDATE members SET
        donor_type = 'regular',
        donor_channels = (
          CASE
            WHEN next_billing_date IS NOT NULL AND hyosung_contract_status = 'active'
              THEN '["toss","hyosung"]'::jsonb
            WHEN next_billing_date IS NOT NULL
              THEN '["toss"]'::jsonb
            WHEN hyosung_contract_status = 'active'
              THEN '["hyosung"]'::jsonb
            ELSE '[]'::jsonb
          END
        ),
        donor_evaluated_at = now()
      WHERE donor_type IS NULL
        AND (next_billing_date IS NOT NULL OR hyosung_contract_status = 'active')
    `);
    steps.push({ step: "identify_regular", count: regularResult?.rowCount ?? regularResult?.count ?? 0 });

    // 3-2. 잠재 cancelled — 효성 cancelled (토스 cancelled는 cron에서 정교화)
    const cancelledResult: any = await db.execute(sql`
      UPDATE members SET
        donor_type = 'prospect',
        prospect_subtype = 'cancelled',
        donor_evaluated_at = now()
      WHERE donor_type IS NULL
        AND hyosung_contract_status = 'cancelled'
    `);
    steps.push({ step: "identify_prospect_cancelled", count: cancelledResult?.rowCount ?? cancelledResult?.count ?? 0 });

    // 3-3. 잠재 onetime — donations completed 1건 이상 (정기 아닌 회원)
    const onetimeResult: any = await db.execute(sql`
      UPDATE members SET
        donor_type = 'prospect',
        prospect_subtype = 'onetime',
        donor_evaluated_at = now()
      WHERE donor_type IS NULL
        AND id IN (
          SELECT DISTINCT member_id FROM donations
          WHERE status = 'completed' AND member_id IS NOT NULL
        )
    `);
    steps.push({ step: "identify_prospect_onetime", count: onetimeResult?.rowCount ?? onetimeResult?.count ?? 0 });

    // 3-4. 비후원 — 나머지
    const noneResult: any = await db.execute(sql`
      UPDATE members SET
        donor_type = 'none',
        donor_evaluated_at = now()
      WHERE donor_type IS NULL
    `);
    steps.push({ step: "identify_none", count: noneResult?.rowCount ?? noneResult?.count ?? 0 });

    // ─── 4. 최종 분포 통계 ───
    const distRes: any = await db.execute(sql`
      SELECT donor_type, COUNT(*)::int AS count FROM members GROUP BY donor_type ORDER BY donor_type
    `);
    const distribution = (distRes?.rows ?? distRes ?? []).map((r: any) => ({
      donor_type: r.donor_type,
      count: Number(r.count),
    }));

    return new Response(JSON.stringify({
      ok: true,
      message: "Phase 2 단계 C 마이그레이션 성공.",
      steps,
      distribution,
      next: [
        "1. 메인 채팅에 본 응답 캡처 알림",
        "2. Main이 schema.ts에 donor_type / donor_channels / prospect_subtype / donor_evaluated_at + 인덱스 2개 정의 추가",
        "3. Main이 본 마이그 함수 파일 삭제",
        "4. Main이 커밋·push (1회용 보안 원칙)",
        "5. A·B 재활성화 통보문 전달 (DESIGN_PHASE2.md §9.4·§9.5)",
      ],
    }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (err: any) {
    const lastStep = steps.length > 0 ? steps[steps.length - 1].step : "unknown";
    return new Response(JSON.stringify({
      ok: false,
      error: "마이그레이션 실패",
      step: lastStep,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
      steps,
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
