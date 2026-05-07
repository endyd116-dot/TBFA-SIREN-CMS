// netlify/functions/migrate-hyosung-schema.ts
// ★ v14: 효성 CMS+ 연동 스키마 (v3 - 잔재 제거 + 재생성)
// 호출: /migrate-hyosung-schema?key=siren-hyosung-2026
import { sql } from "drizzle-orm";
import { db } from "../../db";

export const config = { path: "/migrate-hyosung-schema" };

const SECRET_KEY = "siren-hyosung-2026";

export default async (req: Request) => {
  const url = new URL(req.url);
  if (url.searchParams.get("key") !== SECRET_KEY) {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
      status: 401, headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const log: string[] = [];

    // ===== STEP 0: 잔재 제거 (이전 부분 생성된 테이블 정리) =====
    await db.execute(sql`DROP TABLE IF EXISTS hyosung_billings CASCADE`);
    log.push("OK: 기존 hyosung_billings DROP (있었다면)");

    await db.execute(sql`DROP TABLE IF EXISTS hyosung_contracts CASCADE`);
    log.push("OK: 기존 hyosung_contracts DROP (있었다면)");

    // ===== STEP 1: members 컬럼 7개 (멱등) =====
    await db.execute(sql`
      ALTER TABLE members
        ADD COLUMN IF NOT EXISTS hyosung_member_no INTEGER,
        ADD COLUMN IF NOT EXISTS hyosung_contract_status TEXT,
        ADD COLUMN IF NOT EXISTS hyosung_payment_method TEXT,
        ADD COLUMN IF NOT EXISTS hyosung_payment_tool TEXT,
        ADD COLUMN IF NOT EXISTS hyosung_bank_info TEXT,
        ADD COLUMN IF NOT EXISTS hyosung_promise_day INTEGER,
        ADD COLUMN IF NOT EXISTS hyosung_synced_at TIMESTAMP
    `);
    log.push("OK: members 컬럼 7개");

    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_members_hyosung_no ON members(hyosung_member_no)`);
    log.push("OK: members 인덱스");

    // ===== STEP 2: donations 컬럼 4개 (멱등) =====
    await db.execute(sql`
      ALTER TABLE donations
        ADD COLUMN IF NOT EXISTS hyosung_billing_id INTEGER,
        ADD COLUMN IF NOT EXISTS hyosung_billing_month TEXT,
        ADD COLUMN IF NOT EXISTS hyosung_receipt_status TEXT,
        ADD COLUMN IF NOT EXISTS hyosung_paid_date DATE
    `);
    log.push("OK: donations 컬럼 4개");

    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_donations_hyosung_billing ON donations(hyosung_billing_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_donations_hyosung_month ON donations(hyosung_billing_month)`);
    log.push("OK: donations 인덱스 2개");

    // ===== STEP 3: hyosung_contracts 신규 생성 =====
    await db.execute(sql`
      CREATE TABLE hyosung_contracts (
        id SERIAL PRIMARY KEY,
        member_no INTEGER NOT NULL UNIQUE,
        member_name TEXT NOT NULL,
        phone TEXT,
        member_status TEXT,
        contract_status TEXT,
        promise_day INTEGER,
        payment_method TEXT,
        payment_tool TEXT,
        bank_info TEXT,
        account_holder TEXT,
        register_status TEXT,
        agreement TEXT,
        product_list TEXT,
        product_amount INTEGER,
        billing_start DATE,
        billing_end DATE,
        manager_name TEXT,
        member_category TEXT,
        generation_type TEXT,
        sending_method TEXT,
        linked_member_id INTEGER,
        raw_data JSONB,
        imported_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    log.push("OK: hyosung_contracts 신규 생성");

    await db.execute(sql`CREATE INDEX idx_hyosung_contracts_member_no ON hyosung_contracts(member_no)`);
    await db.execute(sql`CREATE INDEX idx_hyosung_contracts_linked ON hyosung_contracts(linked_member_id)`);
    await db.execute(sql`CREATE INDEX idx_hyosung_contracts_phone ON hyosung_contracts(phone)`);
    log.push("OK: hyosung_contracts 인덱스 3개");

    // ===== STEP 4: hyosung_billings 신규 생성 =====
    await db.execute(sql`
      CREATE TABLE hyosung_billings (
        id SERIAL PRIMARY KEY,
        member_no INTEGER NOT NULL,
        contract_no INTEGER NOT NULL DEFAULT 1,
        member_name TEXT NOT NULL,
        phone TEXT,
        product_name TEXT,
        billing_month TEXT NOT NULL,
        billing_amount INTEGER NOT NULL,
        paid_amount INTEGER DEFAULT 0,
        unpaid_amount INTEGER DEFAULT 0,
        refund_amount INTEGER DEFAULT 0,
        cancel_amount INTEGER DEFAULT 0,
        receipt_status TEXT,
        payment_status TEXT,
        payment_method TEXT,
        payment_tool TEXT,
        promise_day INTEGER,
        payment_date DATE,
        paid_completion_date DATE,
        billing_type TEXT,
        billing_created_at DATE,
        generation_method TEXT,
        sending_method TEXT,
        sending_status TEXT,
        last_sent_at DATE,
        note TEXT,
        linked_donation_id INTEGER,
        raw_data JSONB,
        imported_at TIMESTAMP DEFAULT NOW(),
        CONSTRAINT hyosung_billings_unique_key UNIQUE (member_no, billing_month, product_name)
      )
    `);
    log.push("OK: hyosung_billings 신규 생성");

    await db.execute(sql`CREATE INDEX idx_hyosung_billings_member ON hyosung_billings(member_no)`);
    await db.execute(sql`CREATE INDEX idx_hyosung_billings_month ON hyosung_billings(billing_month)`);
    await db.execute(sql`CREATE INDEX idx_hyosung_billings_status ON hyosung_billings(receipt_status)`);
    log.push("OK: hyosung_billings 인덱스 3개");

    // ===== STEP 5: 검증 =====
    const verify: any = await db.execute(sql`
      SELECT 
        (SELECT COUNT(*) FROM information_schema.columns WHERE table_name='members' AND column_name LIKE 'hyosung%') AS members_cols,
        (SELECT COUNT(*) FROM information_schema.columns WHERE table_name='donations' AND column_name LIKE 'hyosung%') AS donations_cols,
        (SELECT COUNT(*) FROM information_schema.columns WHERE table_name='hyosung_contracts') AS contracts_cols,
        (SELECT COUNT(*) FROM information_schema.columns WHERE table_name='hyosung_billings') AS billings_cols
    `);
    const v = Array.isArray(verify) ? verify[0] : (verify?.rows?.[0] || {});
    log.push(`검증: members.hyosung_* = ${v.members_cols}컬럼 (기대 7)`);
    log.push(`검증: donations.hyosung_* = ${v.donations_cols}컬럼 (기대 4)`);
    log.push(`검증: hyosung_contracts = ${v.contracts_cols}컬럼 (기대 25)`);
    log.push(`검증: hyosung_billings = ${v.billings_cols}컬럼 (기대 30)`);

    return new Response(JSON.stringify({ ok: true, log }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  } catch (e: any) {
    console.error("[migrate-hyosung-schema]", e);
    return new Response(JSON.stringify({ 
      ok: false, 
      error: e.message, 
      stack: e.stack?.slice(0, 800),
      hint: "에러 발생 위치를 stack에서 확인. 'member_no does not exist'면 이전 잔재가 또 있는 것."
    }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
};
