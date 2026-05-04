// netlify/functions/migrate-m19-7.ts
// ★ Phase M-19-7: 기념일 축하 메일 시스템
// - anniversary_emails_log 테이블 (발송 이력 추적)
// - anniversary_type ENUM
// 호출: GET /api/migrate-m19-7?key=siren-m19-7-2026
// 호출 후 ★ 즉시 삭제 + push

import { sql } from "drizzle-orm";
import { db } from "../../db";
import { ok, badRequest, forbidden, serverError, corsPreflight, methodNotAllowed } from "../../lib/response";

const MIGRATION_KEY = "siren-m19-7-2026";

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  try {
    const url = new URL(req.url);
    const key = url.searchParams.get("key");
    if (!key) return badRequest("key 파라미터가 필요합니다");
    if (key !== MIGRATION_KEY) return forbidden("invalid key");

    const results: any = {};

    /* ===== 1. ENUM ===== */
    await db.execute(sql`
      DO $$ BEGIN
        CREATE TYPE anniversary_type AS ENUM (
          'signup_1month',
          'signup_1year',
          'first_donation_1year',
          'donation_milestone',
          'regular_donation_6months',
          'regular_donation_1year'
        );
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);
    results.step1_enum = "ok";

    /* ===== 2. anniversary_emails_log 테이블 ===== */
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS anniversary_emails_log (
        id SERIAL PRIMARY KEY,
        member_id INTEGER REFERENCES members(id) ON DELETE CASCADE NOT NULL,
        anniversary_type anniversary_type NOT NULL,
        anniversary_date DATE NOT NULL,
        milestone_amount INTEGER,
        email_sent_at TIMESTAMP DEFAULT NOW() NOT NULL,
        email_status VARCHAR(20) DEFAULT 'sent' NOT NULL,
        recipient_email VARCHAR(100),
        error_message TEXT,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ael_member_idx ON anniversary_emails_log(member_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ael_type_idx ON anniversary_emails_log(anniversary_type)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ael_sent_idx ON anniversary_emails_log(email_sent_at DESC)`);
    /* 중복 방지용 UNIQUE: (member_id, anniversary_type, anniversary_date, milestone_amount) */
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS ael_unique_idx
      ON anniversary_emails_log(member_id, anniversary_type, anniversary_date, COALESCE(milestone_amount, 0))
    `);
    results.step2_table = "ok";

    /* ===== 3. 검증 ===== */
    const verifyRow: any = await db.execute(sql`
      SELECT
        EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='anniversary_emails_log') AS "hasTable",
        (SELECT typname FROM pg_type WHERE typname='anniversary_type') AS "enumName"
    `);
    const v: any = (verifyRow as any).rows ? (verifyRow as any).rows[0] : (verifyRow as any)[0] || {};
    results.verify = {
      hasTable: !!v.hasTable,
      enumExists: !!v.enumName,
    };

    return ok({
      migration: "m19-7",
      ...results,
      reminder: "★ 호출 성공 후 즉시 이 파일을 삭제하고 push하세요",
    }, "M-19-7 마이그레이션 완료");
  } catch (err: any) {
    console.error("[migrate-m19-7]", err);
    return serverError("M-19-7 마이그레이션 실패", err?.message || String(err));
  }
};

export const config = { path: "/api/migrate-m19-7" };