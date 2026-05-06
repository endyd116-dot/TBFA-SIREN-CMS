// netlify/functions/migrate-seed-home-content-v3.ts
// ★ 1회용 마이그레이션 — Phase B Step 6-A (재시도 v3)
// 컬럼 자동 감지 → 존재하는 컬럼만 INSERT
// 호출 후 즉시 파일 삭제할 것

import type { Context } from "@netlify/functions";
import { db } from "../../db/index.js";
import { sql } from "drizzle-orm";

const MIGRATE_KEY = "siren-seed-home-v10c";

export default async (req: Request, _context: Context) => {
  try {
    const url = new URL(req.url);
    const key = url.searchParams.get("key");
    if (key !== MIGRATE_KEY) {
      return new Response(JSON.stringify({ ok: false, error: "forbidden" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      });
    }

    /* ============================================================
       1단계 — 실제 site_settings 컬럼 목록 조회
       ============================================================ */
    const colRes: any = await db.execute(sql`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'site_settings'
      ORDER BY ordinal_position
    `);
    const columns = Array.isArray(colRes) ? colRes : (colRes?.rows || []);
    const colNames: string[] = columns.map((c: any) => c.column_name);
    const has = (name: string) => colNames.includes(name);

    /* dryRun=1 이면 컬럼 목록만 반환하고 끝 */
    if (url.searchParams.get("dryRun") === "1") {
      return new Response(
        JSON.stringify({
          ok: true,
          mode: "dryRun",
          columns,
          colNames,
        }, null, 2),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    /* ============================================================
       시드 데이터 (텍스트 24 + JSON 3)
       ============================================================ */
    const seedTexts: { key: string; valueType: string; value: string; sortOrder: number }[] = [
      { key: "home.hero.eyebrow",          valueType: "text",   value: "기억 · 지원 · 연대 (REMEMBER · SUPPORT · SOLIDARITY)", sortOrder: 1 },
      { key: "home.hero.lead",             valueType: "text",   value: "존엄한 기억과 투명한 동행, 그리고 따뜻한 연대로 교육 공동체의 회복을 함께 만들어 갑니다.", sortOrder: 2 },
      { key: "home.hero.autoplaySpeed",    valueType: "number", value: "7", sortOrder: 3 },
      { key: "home.hero.autoplayEnabled",  valueType: "text",   value: "true", sortOrder: 4 },
      { key: "home.quickMenu.sectionVisible", valueType: "text", value: "true", sortOrder: 10 },
      { key: "home.campaign.sectionVisible", valueType: "text",   value: "true", sortOrder: 20 },
      { key: "home.campaign.title",          valueType: "text",   value: "🎗 진행 중인 캠페인", sortOrder: 21 },
      { key: "home.campaign.subtitle",       valueType: "text",   value: "여러분의 따뜻한 마음이 모여 큰 변화를 만듭니다.\n교사 유가족과 동료 교사들의 회복을 함께 지원해주세요.", sortOrder: 22 },
      { key: "home.campaign.maxItems",       valueType: "number", value: "3", sortOrder: 23 },
      { key: "home.notice.sectionVisible", valueType: "text",   value: "true", sortOrder: 30 },
      { key: "home.notice.title",          valueType: "text",   value: "통합 공지사항", sortOrder: 31 },
      { key: "home.notice.maxItems",       valueType: "number", value: "5", sortOrder: 32 },
      { key: "home.faq.sectionVisible", valueType: "text",   value: "true", sortOrder: 40 },
      { key: "home.faq.title",          valueType: "text",   value: "자주 묻는 질문", sortOrder: 41 },
      { key: "home.faq.maxItems",       valueType: "number", value: "4", sortOrder: 42 },
      { key: "home.specialBanner.visible",      valueType: "text",   value: "true", sortOrder: 50 },
      { key: "home.specialBanner.tag",          valueType: "text",   value: "특별 캠페인 (SPECIAL CAMPAIGN)", sortOrder: 51 },
      { key: "home.specialBanner.title",        valueType: "html",   value: '"기억의 약속" 추모 주간<br />특별 모금함이 진행 중입니다', sortOrder: 52 },
      { key: "home.specialBanner.lead",         valueType: "text",   value: "고인이 된 동료 교사를 기리고, 남은 가족들이 다시 일상으로 돌아갈 수 있도록 함께해 주세요. 모금액은 전액 유가족 직접 지원과 추모 사업에 사용됩니다.", sortOrder: 53 },
      { key: "home.specialBanner.goalAmount",   valueType: "number", value: "100000000", sortOrder: 54 },
      { key: "home.specialBanner.raisedAmount", valueType: "number", value: "68420000", sortOrder: 55 },
      { key: "home.effects.counterDuration",     valueType: "number", value: "1600", sortOrder: 60 },
      { key: "home.effects.sirenPulseEnabled",   valueType: "text",   value: "true", sortOrder: 61 },
      { key: "home.effects.progressBarDuration", valueType: "number", value: "1200", sortOrder: 62 },
    ];

    const heroSlides = [
      {
        title: '교사 유가족들의 <em>지원과 수사</em>,<br />모든 교사들의 <em>사회적 문제 해결</em>을 위해<br />싸이렌 홈페이지의 문을 열었습니다.',
        ctaPrimary: { label: '후원 동참하기', action: 'modal', target: 'donateModal' },
        ctaSecondary: { label: '지원 신청 안내 →', action: 'link', href: '/support.html' },
        sortOrder: 1, isActive: true,
      },
      {
        title: '<em>"기억의 약속"</em> 추모 주간이<br />4월 한 달간 진행되고 있습니다.<br />여러분의 동참을 기다립니다.',
        ctaPrimary: { label: '후원 동참하기', action: 'modal', target: 'donateModal' },
        ctaSecondary: { label: '지원 신청 안내 →', action: 'link', href: '/support.html' },
        sortOrder: 2, isActive: true,
      },
      {
        title: '투명한 회계, 정직한 동행.<br /><em>2025년 활동 보고서</em>가<br />지금 공개되었습니다.',
        ctaPrimary: { label: '후원 동참하기', action: 'modal', target: 'donateModal' },
        ctaSecondary: { label: '활동 보고서 →', action: 'link', href: '/report.html' },
        sortOrder: 3, isActive: true,
      },
    ];

    const quickMenuItems = [
      { label: '후원하기',         icon: '🤝', isSirenGroup: false, href: '#',                       opensModal: 'donateModal', sortOrder: 1, isActive: true },
      { label: '사건 관련 제보',   icon: '🔍', isSirenGroup: true,  href: '/incidents.html',         opensModal: null,          sortOrder: 2, isActive: true },
      { label: '악성 민원 신고',   icon: '⚠️', isSirenGroup: true,  href: '/report-harassment.html', opensModal: null,          sortOrder: 3, isActive: true },
      { label: '법률 지원 서비스', icon: '⚖️', isSirenGroup: true,  href: '/legal-support.html',     opensModal: null,          sortOrder: 4, isActive: true },
      { label: '자유게시판',       icon: '💬', isSirenGroup: false, href: '/board.html',             opensModal: null,          sortOrder: 5, isActive: true },
      { label: '신청 내역 조회',   icon: '📋', isSirenGroup: false, href: '/mypage.html#support',    opensModal: null,          sortOrder: 6, isActive: true },
    ];

    const specialBannerCta = {
      primary:   { label: '캠페인 동참',     action: 'modal', target: 'donateModal' },
      secondary: { label: '집행 내역 보기',  action: 'link',  href: '/report.html' },
    };

    const seedJsons: { key: string; json: any; sortOrder: number }[] = [
      { key: 'home.hero.slides',       json: heroSlides,       sortOrder: 5 },
      { key: 'home.quickMenu.items',   json: quickMenuItems,   sortOrder: 11 },
      { key: 'home.specialBanner.cta', json: specialBannerCta, sortOrder: 56 },
    ];

    /* ============================================================
       2단계 — 동적 INSERT 빌더
       ============================================================ */
    async function safeInsertText(item: typeof seedTexts[0]): Promise<boolean> {
      const exists: any = await db.execute(sql`
        SELECT key FROM site_settings WHERE key = ${item.key}
      `);
      const rows = Array.isArray(exists) ? exists : (exists?.rows || []);
      if (rows.length > 0) return false;

      /* 컬럼-값 쌍 동적 구성 */
      const cols: string[] = [];
      const vals: any[] = [];

      if (has("scope"))         { cols.push("scope");         vals.push("home"); }
      if (has("key"))           { cols.push("key");           vals.push(item.key); }
      if (has("value_type"))    { cols.push("value_type");    vals.push(item.valueType); }
      if (has("value_text"))    { cols.push("value_text");    vals.push(item.value); }
      if (has("has_draft"))     { cols.push("has_draft");     vals.push(false); }
      if (has("sort_order"))    { cols.push("sort_order");    vals.push(item.sortOrder); }
      if (has("is_active"))     { cols.push("is_active");     vals.push(true); }

      /* 동적 SQL 빌드 — sql.raw로 컬럼명, 파라미터로 값 */
      const colsSql = sql.raw(cols.join(", "));
      const placeholders = vals.map((v) => sql`${v}`);
      const valsSql = sql.join(placeholders, sql`, `);

      await db.execute(sql`
        INSERT INTO site_settings (${colsSql})
        VALUES (${valsSql})
      `);
      return true;
    }

    async function safeInsertJson(item: typeof seedJsons[0]): Promise<boolean> {
      const exists: any = await db.execute(sql`
        SELECT key FROM site_settings WHERE key = ${item.key}
      `);
      const rows = Array.isArray(exists) ? exists : (exists?.rows || []);
      if (rows.length > 0) return false;

      const jsonStr = JSON.stringify(item.json);

      const cols: string[] = [];
      const vals: any[] = [];

      if (has("scope"))      { cols.push("scope");      vals.push("home"); }
      if (has("key"))        { cols.push("key");        vals.push(item.key); }
      if (has("value_type")) { cols.push("value_type"); vals.push("json"); }
      /* value_json은 jsonb 캐스팅 필요 — 별도 처리 */
      if (has("has_draft"))  { cols.push("has_draft");  vals.push(false); }
      if (has("sort_order")) { cols.push("sort_order"); vals.push(item.sortOrder); }
      if (has("is_active"))  { cols.push("is_active");  vals.push(true); }

      /* value_json 컬럼이 있는 경우만 추가 */
      if (has("value_json")) {
        cols.push("value_json");
        const colsSql = sql.raw(cols.join(", "));
        const valuePlaceholders = vals.map((v) => sql`${v}`);
        const valsSql = sql.join(valuePlaceholders, sql`, `);

        await db.execute(sql`
          INSERT INTO site_settings (${colsSql})
          VALUES (${valsSql}, ${jsonStr}::jsonb)
        `);
      } else {
        return false;
      }
      return true;
    }

    /* ============================================================
       3단계 — 실제 INSERT 수행
       ============================================================ */
    let textInserted = 0;
    let textSkipped = 0;
    const errors: any[] = [];

    for (const item of seedTexts) {
      try {
        const ok = await safeInsertText(item);
        if (ok) textInserted++; else textSkipped++;
      } catch (e: any) {
        errors.push({ key: item.key, error: e.message });
      }
    }

    let jsonInserted = 0;
    let jsonSkipped = 0;
    for (const item of seedJsons) {
      try {
        const ok = await safeInsertJson(item);
        if (ok) jsonInserted++; else jsonSkipped++;
      } catch (e: any) {
        errors.push({ key: item.key, error: e.message });
      }
    }

    /* ============================================================
       4단계 — 검증
       ============================================================ */
    const afterRes: any = await db.execute(sql`
      SELECT 
        key, 
        ${has("scope")      ? sql`scope`      : sql`NULL AS scope`},
        ${has("value_type") ? sql`value_type` : sql`NULL AS value_type`},
        (value_text IS NOT NULL) AS has_text,
        ${has("value_json") ? sql`(value_json IS NOT NULL) AS has_json` : sql`false AS has_json`},
        ${has("has_draft")  ? sql`has_draft`  : sql`false AS has_draft`}
      FROM site_settings
      WHERE key LIKE 'home.%'
      ORDER BY key
    `);
    const afterRows = Array.isArray(afterRes) ? afterRes : (afterRes?.rows || []);

    return new Response(
      JSON.stringify({
        ok: errors.length === 0,
        message: errors.length === 0
          ? '메인 페이지 시드 완료 (v3 - 동적 컬럼)'
          : '일부 INSERT 실패',
        detectedColumns: colNames,
        result: {
          textInserted,
          textSkipped,
          jsonInserted,
          jsonSkipped,
          totalAfter: afterRows.length,
          expectedTotal: seedTexts.length + seedJsons.length,
        },
        errors,
        afterKeys: afterRows.slice(0, 30),
      }, null, 2),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ ok: false, error: error.message, stack: error.stack }, null, 2),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
};