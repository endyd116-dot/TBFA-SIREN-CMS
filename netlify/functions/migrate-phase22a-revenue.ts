/**
 * migrate-phase22a-revenue.ts — Phase 22-A 매출 통합 관리 1회용 마이그레이션
 *
 * 호출 방법:
 *   진단 (인증 불필요): GET /api/migrate-phase22a-revenue
 *   실행 (어드민):       GET /api/migrate-phase22a-revenue?run=1
 *
 * 작업 내용:
 *   1) revenue_categories 테이블 생성 + 인덱스 2개
 *   2) other_revenues 테이블 생성 + 인덱스 4개 (FK→revenue_categories)
 *   3) revenue_categories 시드 6건 (lecture/govgrant/corp_sponsor/twork_on/twork_si/etc)
 *   4) ai_tool_permissions 시드 6건 (Phase 22-A AI 도구 6개 권한)
 *   5) ai_feature_settings 'finance' 시드 1건 (월 한도 분리 가능)
 *
 * 멱등 보장 (IF NOT EXISTS · ON CONFLICT DO NOTHING).
 * 호출 성공 후 메인이 즉시 파일 삭제 + 커밋 (1회용 보안 원칙).
 */

import type { Context } from "@netlify/functions";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-phase22a-revenue" };

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false,
    error: "마이그레이션 실패",
    step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  /* === 진단 모드 (인증 불필요) === */
  if (!run) {
    try {
      const tablesRes: any = await db.execute(sql`
        SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name IN ('revenue_categories', 'other_revenues')
         ORDER BY table_name
      `);
      const tables = (tablesRes?.rows ?? tablesRes ?? []).map((r: any) => r.table_name);

      let revenueCategoriesCount = 0;
      let otherRevenuesCount = 0;
      let aiToolPermsCount = 0;
      let aiFeatureCount = 0;

      if (tables.includes("revenue_categories")) {
        const r: any = await db.execute(sql`SELECT COUNT(*)::int AS n FROM revenue_categories`);
        revenueCategoriesCount = Number((r?.rows ?? r)[0]?.n || 0);
      }
      if (tables.includes("other_revenues")) {
        const r: any = await db.execute(sql`SELECT COUNT(*)::int AS n FROM other_revenues`);
        otherRevenuesCount = Number((r?.rows ?? r)[0]?.n || 0);
      }

      try {
        const r: any = await db.execute(sql`
          SELECT COUNT(*)::int AS n FROM ai_tool_permissions
           WHERE tool_name IN ('revenue_categories_list','other_revenues_list','other_revenue_create','other_revenue_approve','other_revenue_refund','pl_summary')
        `);
        aiToolPermsCount = Number((r?.rows ?? r)[0]?.n || 0);
      } catch { /* 테이블 없을 수 있음 */ }

      try {
        const r: any = await db.execute(sql`
          SELECT COUNT(*)::int AS n FROM ai_feature_settings WHERE feature_key = 'finance'
        `);
        aiFeatureCount = Number((r?.rows ?? r)[0]?.n || 0);
      } catch { /* 테이블 없을 수 있음 */ }

      return new Response(JSON.stringify({
        ok: true,
        mode: "diagnostic",
        tables,
        revenueCategoriesSeed: revenueCategoriesCount,
        otherRevenuesRows: otherRevenuesCount,
        aiToolPermissionsSeeded: aiToolPermsCount,
        aiFeatureFinanceSeeded: aiFeatureCount,
        expected: {
          tables: ["revenue_categories", "other_revenues"],
          revenueCategoriesSeed: 6,
          aiToolPermissionsSeeded: 6,
          aiFeatureFinanceSeeded: 1,
        },
        hint: "실행하려면 어드민 로그인 후 ?run=1",
      }), { headers: { "Content-Type": "application/json" } });
    } catch (e: any) {
      return jsonError("diagnostic", e);
    }
  }

  /* === 실행 모드 — 어드민 인증 필수 === */
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const adminUid = auth.ctx?.admin?.uid ?? null;

  try {
    /* --- Step 1: revenue_categories 테이블 + 인덱스 --- */
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "revenue_categories" (
          "id"           serial PRIMARY KEY NOT NULL,
          "code"         varchar(32) UNIQUE NOT NULL,
          "name"         varchar(100) NOT NULL,
          "description"  text,
          "sort_order"   integer DEFAULT 0 NOT NULL,
          "is_active"    boolean DEFAULT true NOT NULL,
          "created_at"   timestamp with time zone DEFAULT now() NOT NULL,
          "updated_at"   timestamp with time zone DEFAULT now() NOT NULL
        )
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "revenue_categories_code_idx" ON "revenue_categories" ("code")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "revenue_categories_active_idx" ON "revenue_categories" ("is_active")`);
    } catch (e) { return jsonError("create_revenue_categories", e); }

    /* --- Step 2: other_revenues 테이블 + 인덱스 + FK --- */
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "other_revenues" (
          "id"                serial PRIMARY KEY NOT NULL,
          "fiscal_year"       integer NOT NULL,
          "recognized_at"     date NOT NULL,
          "category_id"       integer NOT NULL REFERENCES "revenue_categories"("id"),
          "amount"            bigint NOT NULL,
          "payer_name"        varchar(200),
          "description"       text,
          "receipt_url"       varchar(500),
          "status"            varchar(20) DEFAULT 'draft' NOT NULL,
          "refund_amount"     bigint DEFAULT 0 NOT NULL,
          "recorded_by"       integer,
          "recorded_at"       timestamp with time zone DEFAULT now() NOT NULL,
          "approved_by"       integer,
          "approved_at"       timestamp with time zone,
          "rejection_reason"  text,
          "created_at"        timestamp with time zone DEFAULT now() NOT NULL,
          "updated_at"        timestamp with time zone DEFAULT now() NOT NULL
        )
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "other_revenues_fy_idx" ON "other_revenues" ("fiscal_year")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "other_revenues_category_idx" ON "other_revenues" ("category_id")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "other_revenues_status_idx" ON "other_revenues" ("status")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "other_revenues_recognized_idx" ON "other_revenues" ("recognized_at")`);
    } catch (e) { return jsonError("create_other_revenues", e); }

    /* --- Step 3: revenue_categories 시드 6건 --- */
    try {
      await db.execute(sql`
        INSERT INTO "revenue_categories" ("code", "name", "description", "sort_order", "is_active")
        VALUES
          ('lecture',      '강연·교육 수익',                    '교사·외부 강연료·교육 워크숍 수익',             10,  true),
          ('govgrant',     '정부·지자체 지원금',                 '국고보조·지자체 공모 사업·보조금',              20,  true),
          ('corp_sponsor', '기업 협찬·제휴 수익',                '기업 협찬·제휴·후원 프로그램·회원사 수익',       30,  true),
          ('twork_on',     '함께워크_On (사업지원·자리대여)',     '함께워크_On 사업지원·자리대여 수익',             40,  true),
          ('twork_si',     '함께워크_SI (AI·AX·SI)',             '함께워크_SI AI·AX·SI 사업 수익',                50,  true),
          ('etc',          '기타',                              '위 6개에 속하지 않는 모든 수입',                999, true)
        ON CONFLICT ("code") DO NOTHING
      `);
    } catch (e) { return jsonError("seed_revenue_categories", e); }

    /* --- Step 4: ai_tool_permissions 시드 6건 (Phase 22-A AI 도구) --- */
    try {
      await db.execute(sql`
        INSERT INTO "ai_tool_permissions" ("tool_name", "enabled", "required_role", "description", "is_mutation", "category")
        VALUES
          ('revenue_categories_list',  true, NULL,          '매출 카테고리 목록',     false, 'finance'),
          ('other_revenues_list',      true, NULL,          '후원 외 매출 목록',      false, 'finance'),
          ('other_revenue_create',     true, NULL,          '후원 외 매출 작성',      true,  'finance'),
          ('other_revenue_approve',    true, 'super_admin', '매출 승인/반려',         true,  'finance'),
          ('other_revenue_refund',     true, NULL,          '매출 환불 등록',         true,  'finance'),
          ('pl_summary',               true, NULL,          '통합 손익계산서',        false, 'finance')
        ON CONFLICT ("tool_name") DO NOTHING
      `);
    } catch (e) { return jsonError("seed_ai_tool_permissions", e); }

    /* --- Step 5: ai_feature_settings 'finance' 시드 1건 --- */
    try {
      await db.execute(sql`
        INSERT INTO "ai_feature_settings" ("feature_key", "feature_name", "category", "description", "enabled", "sort_order")
        VALUES (
          'finance',
          '재정 관리 (Phase 22-A)',
          'finance',
          '후원 외 매출·손익계산서·재정 도구 6개 호출 (lib/ai-gemini.ts wrapper featureKey)',
          true,
          200
        )
        ON CONFLICT ("feature_key") DO NOTHING
      `);
    } catch (e) { return jsonError("seed_ai_feature_settings", e); }

    /* --- 결과 집계 --- */
    let catCount = 0, toolCount = 0, featCount = 0;
    try {
      const r1: any = await db.execute(sql`SELECT COUNT(*)::int AS n FROM revenue_categories`);
      catCount = Number((r1?.rows ?? r1)[0]?.n || 0);
      const r2: any = await db.execute(sql`
        SELECT COUNT(*)::int AS n FROM ai_tool_permissions
         WHERE tool_name IN ('revenue_categories_list','other_revenues_list','other_revenue_create','other_revenue_approve','other_revenue_refund','pl_summary')
      `);
      toolCount = Number((r2?.rows ?? r2)[0]?.n || 0);
      const r3: any = await db.execute(sql`SELECT COUNT(*)::int AS n FROM ai_feature_settings WHERE feature_key = 'finance'`);
      featCount = Number((r3?.rows ?? r3)[0]?.n || 0);
    } catch (e) { console.warn("verify_counts failed", e); }

    return new Response(JSON.stringify({
      ok: true,
      mode: "executed",
      adminUid,
      tablesCreated: ["revenue_categories", "other_revenues"],
      indexesCreated: 6,
      revenueCategoriesSeed: catCount,
      aiToolPermissionsSeeded: toolCount,
      aiFeatureFinanceSeeded: featCount,
      nextStep: "메인 채팅에 ok:true 보고 → 메인이 마이그 파일 삭제 + PROJECT_STATE 갱신 + B/A 트리거 발송",
    }), { headers: { "Content-Type": "application/json" } });
  } catch (e: any) {
    return jsonError("unknown", e);
  }
};
