import type { Context } from "@netlify/functions";
import { neon } from "@neondatabase/serverless";

export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  const key = url.searchParams.get("key");

  if (key !== "hyosung2026") {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  const sql = neon(process.env.NETLIFY_DATABASE_URL!);

  const results: string[] = [];

  try {
    // 1. members 테이블에 hyosung_member_no 컬럼 추가
    await sql`ALTER TABLE members ADD COLUMN IF NOT EXISTS hyosung_member_no INTEGER`;
    results.push("✅ members.hyosung_member_no 컬럼 추가");

    await sql`CREATE INDEX IF NOT EXISTS idx_members_hyosung_no ON members(hyosung_member_no)`;
    results.push("✅ idx_members_hyosung_no 인덱스 생성");

    // 2. hyosung_contracts 테이블 생성
    await sql`
      CREATE TABLE IF NOT EXISTS hyosung_contracts (
        id              SERIAL PRIMARY KEY,
        member_id       INTEGER REFERENCES members(id),
        hyosung_no      INTEGER NOT NULL,
        contract_no     INTEGER DEFAULT 1,
        member_name     VARCHAR(50) NOT NULL,
        phone           VARCHAR(20),
        member_status   VARCHAR(20) DEFAULT 'active',
        contract_status VARCHAR(20) DEFAULT 'active',
        promise_day     INTEGER,
        pay_method_type VARCHAR(20),
        pay_instrument  VARCHAR(20),
        pay_info        VARCHAR(100),
        account_holder  VARCHAR(50),
        reg_status      VARCHAR(30),
        consent         VARCHAR(10),
        product_name    VARCHAR(50),
        product_amount  INTEGER DEFAULT 0,
        billing_start   DATE,
        billing_end     DATE,
        billing_auto    VARCHAR(10) DEFAULT 'auto',
        send_method     VARCHAR(20) DEFAULT 'none',
        manager         VARCHAR(50),
        member_group    VARCHAR(30),
        raw_data        JSONB,
        created_at      TIMESTAMPTZ DEFAULT NOW(),
        updated_at      TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    results.push("✅ hyosung_contracts 테이블 생성");

    await sql`CREATE INDEX IF NOT EXISTS idx_hyosung_contracts_member ON hyosung_contracts(member_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_hyosung_contracts_hyosung_no ON hyosung_contracts(hyosung_no)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_hyosung_contracts_status ON hyosung_contracts(contract_status)`;
    results.push("✅ hyosung_contracts 인덱스 3개 생성");

    // 3. hyosung_billings 테이블 생성
    await sql`
      CREATE TABLE IF NOT EXISTS hyosung_billings (
        id               SERIAL PRIMARY KEY,
        contract_id      INTEGER REFERENCES hyosung_contracts(id),
        hyosung_no       INTEGER NOT NULL,
        contract_no      INTEGER DEFAULT 1,
        member_name      VARCHAR(50) NOT NULL,
        first_bill_month VARCHAR(10),
        bill_month       VARCHAR(10) NOT NULL,
        phone            VARCHAR(20),
        product_name     VARCHAR(50),
        bill_status      VARCHAR(20) DEFAULT 'pending',
        pay_status       VARCHAR(20) DEFAULT 'pending',
        pay_method_type  VARCHAR(20),
        pay_instrument   VARCHAR(20),
        promise_day      INTEGER,
        pay_date         DATE,
        bill_type        VARCHAR(20) DEFAULT 'regular',
        overdue_status   VARCHAR(20),
        bill_amount      INTEGER DEFAULT 0,
        supply_amount    INTEGER DEFAULT 0,
        vat_amount       INTEGER DEFAULT 0,
        paid_amount      INTEGER DEFAULT 0,
        unpaid_amount    INTEGER DEFAULT 0,
        cancel_amount    INTEGER DEFAULT 0,
        refund_amount    INTEGER DEFAULT 0,
        paid_complete_at DATE,
        pay_result       VARCHAR(50),
        bill_created_at  DATE,
        bill_create_type VARCHAR(10),
        send_method      VARCHAR(20),
        send_status      VARCHAR(30),
        last_sent_at     DATE,
        note             TEXT,
        raw_data         JSONB,
        created_at       TIMESTAMPTZ DEFAULT NOW(),
        updated_at       TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    results.push("✅ hyosung_billings 테이블 생성");

    await sql`CREATE INDEX IF NOT EXISTS idx_hyosung_billings_contract ON hyosung_billings(contract_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_hyosung_billings_month ON hyosung_billings(bill_month)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_hyosung_billings_status ON hyosung_billings(bill_status)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_hyosung_billings_hyosung_no ON hyosung_billings(hyosung_no)`;
    results.push("✅ hyosung_billings 인덱스 4개 생성");

    // 4. 검증
    const tables = await sql`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('hyosung_contracts', 'hyosung_billings')
      ORDER BY table_name
    `;
    results.push(`✅ 검증: ${tables.length}개 테이블 확인 (${tables.map((t: any) => t.table_name).join(', ')})`);

    const col = await sql`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'members' AND column_name = 'hyosung_member_no'
    `;
    results.push(`✅ 검증: members.hyosung_member_no ${col.length > 0 ? '존재' : '❌ 미존재'}`);

    return new Response(JSON.stringify({ ok: true, results }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ ok: false, error: err.message, results }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
};

export const config = {
  path: "/migrate-hyosung"
};