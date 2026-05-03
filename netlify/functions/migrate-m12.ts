// netlify/functions/migrate-m12.ts
// ★ Phase M-12: members 컬럼 3개 + signup_sources 테이블 + 시드 5건
//                + 기존 회원 50여명 자동 분류 (A안)
// 사용 후 즉시 삭제할 것

import type { Context } from "@netlify/functions";
import postgres from "postgres";

export const config = { path: "/api/migrate-m12" };

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  if (key !== "siren-m12-2026") {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
      status: 401, headers: { "Content-Type": "application/json" },
    });
  }

  const conn = process.env.NETLIFY_DATABASE_URL;
  if (!conn) {
    return new Response(JSON.stringify({ ok: false, error: "NETLIFY_DATABASE_URL not set" }),
      { status: 500, headers: { "Content-Type": "application/json" } });
  }

  const sql = postgres(conn, { max: 1, ssl: "require" });
  const log: string[] = [];

  try {
    /* ============================================================
       1) members 컬럼 3개 추가
       ============================================================ */
    await sql`ALTER TABLE members ADD COLUMN IF NOT EXISTS member_category VARCHAR(20)`;
    log.push("✅ members.member_category 추가");

    await sql`ALTER TABLE members ADD COLUMN IF NOT EXISTS member_subtype VARCHAR(50)`;
    log.push("✅ members.member_subtype 추가");

    await sql`ALTER TABLE members ADD COLUMN IF NOT EXISTS signup_source_id INTEGER`;
    log.push("✅ members.signup_source_id 추가");

    /* 인덱스 */
    await sql`CREATE INDEX IF NOT EXISTS members_category_idx ON members(member_category)`;
    await sql`CREATE INDEX IF NOT EXISTS members_subtype_idx ON members(member_subtype)`;
    await sql`CREATE INDEX IF NOT EXISTS members_signup_source_idx ON members(signup_source_id)`;
    log.push("✅ members 인덱스 3개 추가");

    /* ============================================================
       2) signup_sources 테이블 생성
       ============================================================ */
    await sql`
      CREATE TABLE IF NOT EXISTS signup_sources (
        id SERIAL PRIMARY KEY,
        code VARCHAR(50) NOT NULL UNIQUE,
        label VARCHAR(100) NOT NULL,
        description VARCHAR(300),
        is_active BOOLEAN DEFAULT TRUE NOT NULL,
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS signup_sources_code_idx ON signup_sources(code)`;
    await sql`CREATE INDEX IF NOT EXISTS signup_sources_active_idx ON signup_sources(is_active)`;
    log.push("✅ signup_sources 테이블 생성");

    /* ============================================================
       3) signup_sources 기본 시드 5건
       ============================================================ */
    const seedSources: Array<[string, string, string, number]> = [
      ["website", "홈페이지 직접 가입", "사용자가 회원가입 페이지에서 직접 가입한 경우", 10],
      ["admin", "관리자 직접 추가", "관리자가 백오피스에서 직접 회원을 등록한 경우", 20],
      ["hyosung_csv", "효성 CMS+ 정기후원 등록", "효성 CMS+ CSV 업로드 시 자동 매칭된 후원자", 30],
      ["event", "행사/이벤트 등록", "오프라인 행사·캠페인을 통해 등록된 회원", 40],
      ["etc", "기타", "위 항목에 해당하지 않는 경로 (수동 분류 필요)", 99],
    ];

    let seededSources = 0;
    for (const [code, label, description, sortOrder] of seedSources) {
      const inserted = await sql`
        INSERT INTO signup_sources (code, label, description, is_active, sort_order)
        VALUES (${code}, ${label}, ${description}, TRUE, ${sortOrder})
        ON CONFLICT (code) DO NOTHING
        RETURNING id
      `;
      if (inserted.length > 0) seededSources++;
    }
    log.push(`✅ signup_sources 시드 ${seededSources}건 (${seedSources.length}건 중)`);

    /* ============================================================
       4) ★ A안: 기존 회원 자동 분류 (member_category가 NULL인 경우만)
       ============================================================ */

    /* signup_sources id 매핑 */
    const sourceRows = await sql`SELECT id, code FROM signup_sources`;
    const sourceMap: Record<string, number> = {};
    for (const r of sourceRows as any) {
      sourceMap[r.code] = r.id;
    }
    const ID_WEBSITE = sourceMap["website"];
    const ID_ADMIN = sourceMap["admin"];
    const ID_HYOSUNG = sourceMap["hyosung_csv"];

    /* 4-1. type='admin' → etc */
    const r1 = await sql`
      UPDATE members
      SET member_category = 'etc',
          member_subtype = NULL,
          signup_source_id = ${ID_ADMIN}
      WHERE type = 'admin' AND member_category IS NULL
    `;
    log.push(`✅ admin 회원 분류: ${r1.count}건`);

    /* 4-2. type='family' → family */
    const r2 = await sql`
      UPDATE members
      SET member_category = 'family',
          member_subtype = NULL,
          signup_source_id = COALESCE(signup_source_id, ${ID_WEBSITE})
      WHERE type = 'family' AND member_category IS NULL
    `;
    log.push(`✅ family 회원 분류: ${r2.count}건`);

    /* 4-3. type='volunteer' → etc + volunteer */
    const r3 = await sql`
      UPDATE members
      SET member_category = 'etc',
          member_subtype = 'volunteer',
          signup_source_id = COALESCE(signup_source_id, ${ID_WEBSITE})
      WHERE type = 'volunteer' AND member_category IS NULL
    `;
    log.push(`✅ volunteer 회원 분류: ${r3.count}건`);

    /* 4-4. type='regular' + 효성 후원 있음 → sponsor + hyosung_donation */
    const r4 = await sql`
      UPDATE members m
      SET member_category = 'sponsor',
          member_subtype = 'hyosung_donation',
          signup_source_id = ${ID_HYOSUNG}
      WHERE m.type = 'regular'
        AND m.member_category IS NULL
        AND EXISTS (
          SELECT 1 FROM donations d
          WHERE d.member_id = m.id
            AND d.hyosung_member_no IS NOT NULL
        )
    `;
    log.push(`✅ regular + 효성후원 → sponsor/hyosung_donation: ${r4.count}건`);

    /* 4-5. type='regular' + 정기 후원 있음 (효성 제외) → sponsor + regular_donation */
    const r5 = await sql`
      UPDATE members m
      SET member_category = 'sponsor',
          member_subtype = 'regular_donation',
          signup_source_id = COALESCE(signup_source_id, ${ID_WEBSITE})
      WHERE m.type = 'regular'
        AND m.member_category IS NULL
        AND EXISTS (
          SELECT 1 FROM donations d
          WHERE d.member_id = m.id
            AND d.type = 'regular'
            AND d.status = 'completed'
        )
    `;
    log.push(`✅ regular + 정기후원 → sponsor/regular_donation: ${r5.count}건`);

    /* 4-6. type='regular' + 일시 후원만 → sponsor + onetime_donation */
    const r6 = await sql`
      UPDATE members m
      SET member_category = 'sponsor',
          member_subtype = 'onetime_donation',
          signup_source_id = COALESCE(signup_source_id, ${ID_WEBSITE})
      WHERE m.type = 'regular'
        AND m.member_category IS NULL
        AND EXISTS (
          SELECT 1 FROM donations d
          WHERE d.member_id = m.id
            AND d.type = 'onetime'
            AND d.status = 'completed'
        )
    `;
    log.push(`✅ regular + 일시후원 → sponsor/onetime_donation: ${r6.count}건`);

    /* 4-7. type='regular' + 후원 0건 → category=regular */
    const r7 = await sql`
      UPDATE members
      SET member_category = 'regular',
          member_subtype = NULL,
          signup_source_id = COALESCE(signup_source_id, ${ID_WEBSITE})
      WHERE type = 'regular'
        AND member_category IS NULL
    `;
    log.push(`✅ regular 일반 회원: ${r7.count}건`);

    /* ============================================================
       5) 검증
       ============================================================ */
    const verify = await sql`
      SELECT
        member_category AS category,
        COUNT(*)::int   AS count
      FROM members
      WHERE status != 'withdrawn'
      GROUP BY member_category
      ORDER BY member_category NULLS LAST
    `;

    const sourceVerify = await sql`
      SELECT
        s.code,
        s.label,
        COUNT(m.id)::int AS member_count
      FROM signup_sources s
      LEFT JOIN members m ON m.signup_source_id = s.id
      GROUP BY s.id, s.code, s.label
      ORDER BY s.sort_order
    `;

    await sql.end();

    return new Response(JSON.stringify({
      ok: true,
      message: "✅ Phase M-12 마이그레이션 완료 (자동 분류 적용)",
      log,
      verification: {
        categoryDistribution: verify,
        sourceDistribution: sourceVerify,
      },
    }, null, 2), {
      status: 200, headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (e: any) {
    await sql.end().catch(() => {});
    return new Response(JSON.stringify({ ok: false, error: e.message, log, stack: e.stack }, null, 2),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } });
  }
};