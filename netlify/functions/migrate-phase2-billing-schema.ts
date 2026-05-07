// netlify/functions/migrate-phase2-billing-schema.ts
// ★ Phase 2 Step 1: 토스 빌링 자동 청구 스키마 마이그레이션
// - members 빌링 컬럼 4개 + 인덱스
// - donations.billing_log_id + FK
// - billing_logs 테이블 + 인덱스 4개
// - card_expiry_alerts 테이블 + 인덱스 2개
// - 기존 빌링키 보유자 스케줄 자동 추출

import { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = {
  path: "/migrate-phase2-billing-schema",
};

const MIGRATION_KEY = "siren-phase2-billing-20260507";

export default async (req: Request, _ctx: Context) => {
  try {
    const url = new URL(req.url);
    const key = url.searchParams.get("key");

    if (key !== MIGRATION_KEY) {
      return new Response(
        JSON.stringify({ ok: false, error: "invalid key" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    const results: string[] = [];

    // ─── 1. members 빌링 컬럼 4개 ───
    const memberCols = [
      { name: "next_billing_date", ddl: "DATE" },
      { name: "billing_day", ddl: "INTEGER" },
      { name: "billing_retry_count", ddl: "INTEGER DEFAULT 0 NOT NULL" },
      { name: "billing_last_failed_at", ddl: "TIMESTAMP" },
    ];
    for (const col of memberCols) {
      await db.execute(sql.raw(
        `ALTER TABLE members ADD COLUMN IF NOT EXISTS ${col.name} ${col.ddl}`
      ));
      results.push(`✅ members.${col.name} 추가`);
    }
    await db.execute(sql.raw(
      `CREATE INDEX IF NOT EXISTS idx_members_next_billing ON members(next_billing_date)`
    ));
    results.push(`✅ idx_members_next_billing 생성`);

    // ─── 2. donations.billing_log_id ───
    await db.execute(sql.raw(
      `ALTER TABLE donations ADD COLUMN IF NOT EXISTS billing_log_id INTEGER`
    ));
    results.push(`✅ donations.billing_log_id 추가`);

    // ─── 3. billing_logs 테이블 ───
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS billing_logs (
        id SERIAL PRIMARY KEY,
        member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
        billing_key VARCHAR(200),
        attempt_type VARCHAR(20) NOT NULL,
        attempt_number INTEGER DEFAULT 1 NOT NULL,
        amount INTEGER NOT NULL,
        status VARCHAR(20) NOT NULL,
        toss_order_id VARCHAR(100),
        toss_payment_key VARCHAR(200),
        toss_response_code VARCHAR(50),
        toss_response_message VARCHAR(500),
        error_detail JSONB,
        donation_id INTEGER REFERENCES donations(id) ON DELETE SET NULL,
        requested_at TIMESTAMP DEFAULT NOW() NOT NULL,
        completed_at TIMESTAMP,
        next_retry_at TIMESTAMP,
        notified_channels VARCHAR(50),
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `));
    results.push(`✅ billing_logs 테이블 생성`);

    const billingLogsIndexes = [
      `CREATE INDEX IF NOT EXISTS idx_billing_logs_member ON billing_logs(member_id)`,
      `CREATE INDEX IF NOT EXISTS idx_billing_logs_status ON billing_logs(status)`,
      `CREATE INDEX IF NOT EXISTS idx_billing_logs_next_retry ON billing_logs(next_retry_at)`,
      `CREATE INDEX IF NOT EXISTS idx_billing_logs_requested ON billing_logs(requested_at)`,
    ];
    for (const ddl of billingLogsIndexes) {
      await db.execute(sql.raw(ddl));
    }
    results.push(`✅ billing_logs 인덱스 4개 생성`);

    // ─── donations FK 제약 (billing_logs 생성 후) ───
    try {
      await db.execute(sql.raw(`
        ALTER TABLE donations
        ADD CONSTRAINT fk_donations_billing_log
        FOREIGN KEY (billing_log_id) REFERENCES billing_logs(id) ON DELETE SET NULL
      `));
      results.push(`✅ donations FK 제약 추가`);
    } catch (e: any) {
      if (e.message?.includes("already exists")) {
        results.push(`⏭ donations FK 이미 존재`);
      } else {
        throw e;
      }
    }

    // ─── 4. card_expiry_alerts 테이블 ───
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS card_expiry_alerts (
        id SERIAL PRIMARY KEY,
        member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        billing_key VARCHAR(200) NOT NULL,
        card_expiry_month VARCHAR(10),
        alert_type VARCHAR(20) NOT NULL,
        channels_sent VARCHAR(50),
        sent_at TIMESTAMP DEFAULT NOW() NOT NULL,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `));
    results.push(`✅ card_expiry_alerts 테이블 생성`);

    await db.execute(sql.raw(
      `CREATE INDEX IF NOT EXISTS idx_card_expiry_member ON card_expiry_alerts(member_id)`
    ));
    await db.execute(sql.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_card_expiry_alert ON card_expiry_alerts(member_id, alert_type, card_expiry_month)`
    ));
    results.push(`✅ card_expiry_alerts 인덱스 2개 생성`);

    // ─── 5. 기존 정기후원자 빌링 스케줄 자동 추출 ───
    const existing: any = await db.execute(sql.raw(`
      SELECT bk.member_id AS id,
             bk.next_charge_at,
             bk.created_at AS bk_created,
             m.created_at AS m_created
      FROM billing_keys bk
      INNER JOIN members m ON m.id = bk.member_id
      WHERE bk.is_active = true
        AND (m.withdrawn_at IS NULL)
        AND m.next_billing_date IS NULL
    `));
    const rows = Array.isArray(existing) ? existing : (existing as any).rows || [];

    let migrated = 0;
    for (const r of rows) {
      const baseDate = r.next_charge_at || r.bk_created || r.m_created;
      if (!baseDate) continue;

      const d = new Date(baseDate);
      const billingDay = d.getDate();

      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth();
      const currentDay = now.getDate();

      let nextYear: number;
      let nextMonth: number;
      if (currentDay < billingDay) {
        nextYear = currentYear;
        nextMonth = currentMonth;
      } else {
        nextYear = currentMonth === 11 ? currentYear + 1 : currentYear;
        nextMonth = currentMonth === 11 ? 0 : currentMonth + 1;
      }

      const lastDay = new Date(nextYear, nextMonth + 1, 0).getDate();
      const safeDay = Math.min(billingDay, lastDay);
      const nextDateStr = `${nextYear}-${String(nextMonth + 1).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`;

      await db.execute(sql.raw(`
        UPDATE members
        SET billing_day = ${billingDay},
            next_billing_date = '${nextDateStr}'
        WHERE id = ${r.id}
      `));
      migrated++;
    }
    results.push(`✅ 기존 빌링키 보유자 ${migrated}/${rows.length}명 스케줄 자동 추출`);

    // ─── 6. 검증 ───
    const verifyCols: any = await db.execute(sql.raw(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'members'
        AND column_name IN ('next_billing_date', 'billing_day', 'billing_retry_count', 'billing_last_failed_at')
    `));
    const verifyColRows = Array.isArray(verifyCols) ? verifyCols : (verifyCols as any).rows || [];
    results.push(`🔍 members 검증: ${verifyColRows.length}/4 컬럼`);

    const verifyTbl: any = await db.execute(sql.raw(`
      SELECT table_name FROM information_schema.tables
      WHERE table_name IN ('billing_logs', 'card_expiry_alerts')
    `));
    const verifyTblRows = Array.isArray(verifyTbl) ? verifyTbl : (verifyTbl as any).rows || [];
    results.push(`🔍 신규 테이블 검증: ${verifyTblRows.length}/2`);

    return new Response(
      JSON.stringify({
        ok: true,
        phase: "Phase 2 Step 1 - Billing Schema",
        results,
        migratedMembers: migrated,
      }, null, 2),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("[migrate-phase2] 실패:", error);
    return new Response(
      JSON.stringify({
        ok: false,
        error: error?.message || "unknown",
        stack: error?.stack,
      }, null, 2),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
