// netlify/functions/migrate-m4.ts
// ★ Phase M-4: donation_status enum 확장 + donations 컬럼 2개 + donation_policies 테이블

import type { Context } from "@netlify/functions";
import postgres from "postgres";

export const config = { path: "/api/migrate-m4" };

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  if (key !== "siren-m4-2026") {
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
  const log: any[] = [];

  try {
    /* 1) donation_status ENUM에 값 추가 (IF NOT EXISTS로 멱등 처리) */
    try {
      await sql`ALTER TYPE donation_status ADD VALUE IF NOT EXISTS 'pending_hyosung'`;
      log.push("✅ donation_status: pending_hyosung 추가");
    } catch (e: any) {
      log.push(`⚠️ pending_hyosung: ${e.message}`);
    }
    try {
      await sql`ALTER TYPE donation_status ADD VALUE IF NOT EXISTS 'pending_bank'`;
      log.push("✅ donation_status: pending_bank 추가");
    } catch (e: any) {
      log.push(`⚠️ pending_bank: ${e.message}`);
    }

    /* 2) donations 컬럼 2개 추가 */
    await sql`ALTER TABLE donations ADD COLUMN IF NOT EXISTS bank_depositor_name VARCHAR(50)`;
    log.push("✅ donations.bank_depositor_name 추가");

    await sql`ALTER TABLE donations ADD COLUMN IF NOT EXISTS deposit_expected_at TIMESTAMPTZ`;
    log.push("✅ donations.deposit_expected_at 추가");

    /* 3) donation_policies 테이블 생성 */
    await sql`
      CREATE TABLE IF NOT EXISTS donation_policies (
        id SERIAL PRIMARY KEY,
        regular_amounts TEXT,
        onetime_amounts TEXT,
        bank_name VARCHAR(50),
        bank_account_no VARCHAR(50),
        bank_account_holder VARCHAR(50),
        bank_guide_text TEXT,
        hyosung_url VARCHAR(500),
        hyosung_guide_text TEXT,
        modal_title VARCHAR(200),
        modal_subtitle VARCHAR(500),
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        updated_by INTEGER REFERENCES members(id) ON DELETE SET NULL
      )
    `;
    log.push("✅ donation_policies 테이블 생성");

    /* 4) 기본값 시드 (id=1 없으면 INSERT) */
    const [existing] = await sql`SELECT id FROM donation_policies WHERE id = 1`;
    if (!existing) {
      await sql`
        INSERT INTO donation_policies (
          id, regular_amounts, onetime_amounts,
          bank_name, bank_account_no, bank_account_holder, bank_guide_text,
          hyosung_url, hyosung_guide_text,
          modal_title, modal_subtitle
        ) VALUES (
          1,
          ${JSON.stringify([10000, 30000, 50000, 100000, 300000, 500000])},
          ${JSON.stringify([10000, 30000, 50000, 100000, 300000, 500000])},
          '국민은행',
          '(계좌번호 미등록)',
          '(사)교사유가족협의회',
          '입금 확인까지 1~3일 이내 소요될 수 있습니다. 입금자명을 정확히 입력해 주세요.',
          'https://ap.hyosungcmsplus.co.kr/external/shorten/20240709hAxVVDFECf',
          '효성 CMS+에서 등록한 경우 등록 완료까지 2~3일 정도 소요됩니다. 확인 버튼을 누르면 효성 CMS+ 등록 페이지로 이동합니다.',
          '🎗 후원 동참하기',
          '여러분의 따뜻한 마음이 유가족에게 큰 힘이 됩니다.'
        )
      `;
      log.push("✅ donation_policies 기본값 시드 완료");
    } else {
      log.push("ℹ️ donation_policies 기존 레코드 유지");
    }

    /* 5) 검증 */
    const cols = await sql`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'donation_policies'
      ORDER BY ordinal_position
    `;

    const newCols = await sql`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'donations'
        AND column_name IN ('bank_depositor_name', 'deposit_expected_at')
    `;

    const enumValues = await sql`
      SELECT enumlabel FROM pg_enum
      WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'donation_status')
      ORDER BY enumsortorder
    `;

    await sql.end();

    return new Response(JSON.stringify({
      ok: true,
      message: "✅ Phase M-4 마이그레이션 완료",
      log,
      verification: {
        donationPoliciesColumns: cols,
        donationsNewColumns: newCols,
        donationStatusEnum: enumValues.map((r: any) => r.enumlabel),
      },
    }, null, 2), {
      status: 200, headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (e: any) {
    await sql.end().catch(() => {});
    return new Response(JSON.stringify({
      ok: false, error: e.message, log, stack: e.stack,
    }, null, 2), {
      status: 500, headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
};