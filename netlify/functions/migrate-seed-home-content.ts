// netlify/functions/migrate-seed-home-content.ts
// ★ 1회용 마이그레이션 — Phase B Step 6-A (v2: 컬럼 자동 감지)
// site_settings 테이블에 home.* 키 27개 초기값 INSERT
// 호출 후 즉시 파일 삭제할 것

import type { Context } from "@netlify/functions";
import { db } from "../../db/index.js";
import { sql } from "drizzle-orm";

const MIGRATE_KEY = "siren-seed-home-v10";

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
       0단계 — site_settings 실제 컬럼 구조 조회 (information_schema)
       ============================================================ */
    const colsRes: any = await db.execute(sql`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'site_settings'
      ORDER BY ordinal_position
    `);
    const colsRows = Array.isArray(colsRes) ? colsRes : (colsRes?.rows || []);
    const colNames = colsRows.map((r: any) => r.column_name);

    /* 안전장치 — 필수 컬럼 확인 */
    if (!colNames.includes('key')) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "site_settings 테이블에 'key' 컬럼이 없습니다",
          actualColumns: colsRows,
        }, null, 2),
        { status: 500, headers: { "content-type": "application/json" } }
      );
    }

    const hasValueText  = colNames.includes('value_text');
    const hasValueJson  = colNames.includes('value_json');
    const hasHasDraft   = colNames.includes('has_draft');

    /* ============================================================
       텍스트 시드 24개
       ============================================================ */
    const seedTexts: { key: string; value: string }[] = [
      { key: "home.hero.eyebrow", value: "기억 · 지원 · 연대 (REMEMBER · SUPPORT · SOLIDARITY)" },
      { key: "home.hero.lead", value: "존엄한 기억과 투명한 동행, 그리고 따뜻한 연대로 교육 공동체의 회복을 함께 만들어 갑니다." },
      { key: "home.hero.autoplaySpeed", value: "7" },
      { key: "home.hero.autoplayEnabled", value: "true" },
      { key: "home.quickMenu.sectionVisible", value: "true" },
      { key: "home.campaign.sectionVisible", value: "true" },
      { key: "home.campaign.title", value: "🎗 진행 중인 캠페인" },
      { key: "home.campaign.subtitle", value: "여러분의 따뜻한 마음이 모여 큰 변화를 만듭니다.\n교사 유가족과 동료 교사들의 회복을 함께 지원해주세요." },
      { key: "home.campaign.maxItems", value: "3" },
      { key: "home.notice.sectionVisible", value: "true" },
      { key: "home.notice.title", value: "통합 공지사항" },
      { key: "home.notice.maxItems", value: "5" },
      { key: "home.faq.sectionVisible", value: "true" },
      { key: "home.faq.title", value: "자주 묻는 질문" },
      { key: "home.faq.maxItems", value: "4" },
      { key: "home.specialBanner.visible", value: "true" },
      { key: "home.specialBanner.tag", value: "특별 캠페인 (SPECIAL CAMPAIGN)" },
      { key: "home.specialBanner.title", value: '"기억의 약속" 추모 주간<br />특별 모금함이 진행 중입니다' },
      { key: "home.specialBanner.lead", value: "고인이 된 동료 교사를 기리고, 남은 가족들이 다시 일상으로 돌아갈 수 있도록 함께해 주세요. 모금액은 전액 유가족 직접 지원과 추모 사업에 사용됩니다." },
      { key: "home.specialBanner.goalAmount", value: "100000000" },
      { key: "home.specialBanner.raisedAmount", value: "68420000" },
      { key: "home.effects.counterDuration", value: "1600" },
      { key: "home.effects.sirenPulseEnabled", value: "true" },
      { key: "home.effects.progressBarDuration", value: "1200" },
    ];

    /* ============================================================
       JSON 시드 3개
       ============================================================ */
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

    const seedJsons: { key: string; json: any }[] = [
      { key: 'home.hero.slides',       json: heroSlides },
      { key: 'home.quickMenu.items',   json: quickMenuItems },
      { key: 'home.specialBanner.cta', json: specialBannerCta },
    ];

    /* ============================================================
       INSERT — 최소 컬럼만 사용 (key + value_text/json + 선택적 has_draft)
       나머지(timestamp 등)는 DB DEFAULT에 위임
       ============================================================ */
    let textInserted = 0, textSkipped = 0;
    for (const item of seedTexts) {
      const beforeRes: any = await db.execute(sql`
        SELECT key FROM site_settings WHERE key = ${item.key}
      `);
      const beforeRows = Array.isArray(beforeRes) ? beforeRes : (beforeRes?.rows || []);
      if (beforeRows.length > 0) { textSkipped++; continue; }

      if (hasHasDraft && hasValueText) {
        await db.execute(sql`
          INSERT INTO site_settings (key, value_text, has_draft)
          VALUES (${item.key}, ${item.value}, false)
        `);
      } else if (hasValueText) {
        await db.execute(sql`
          INSERT INTO site_settings (key, value_text)
          VALUES (${item.key}, ${item.value})
        `);
      } else {
        return new Response(JSON.stringify({
          ok: false,
          error: "value_text 컬럼이 없어 텍스트 시드 불가",
          actualColumns: colsRows,
        }, null, 2), { status: 500, headers: { "content-type": "application/json" } });
      }
      textInserted++;
    }

    let jsonInserted = 0, jsonSkipped = 0;
    for (const item of seedJsons) {
      const beforeRes: any = await db.execute(sql`
        SELECT key FROM site_settings WHERE key = ${item.key}
      `);
      const beforeRows = Array.isArray(beforeRes) ? beforeRes : (beforeRes?.rows || []);
      if (beforeRows.length > 0) { jsonSkipped++; continue; }

      const jsonStr = JSON.stringify(item.json);
      if (hasHasDraft && hasValueJson) {
        await db.execute(sql`
          INSERT INTO site_settings (key, value_json, has_draft)
          VALUES (${item.key}, ${jsonStr}::jsonb, false)
        `);
      } else if (hasValueJson) {
        await db.execute(sql`
          INSERT INTO site_settings (key, value_json)
          VALUES (${item.key}, ${jsonStr}::jsonb)
        `);
      } else {
        return new Response(JSON.stringify({
          ok: false,
          error: "value_json 컬럼이 없어 JSON 시드 불가",
          actualColumns: colsRows,
        }, null, 2), { status: 500, headers: { "content-type": "application/json" } });
      }
      jsonInserted++;
    }

    /* ============================================================
       검증 — home.* 키 전체 조회 (실제 컬럼만)
       ============================================================ */
    const afterRes: any = await db.execute(sql`
      SELECT 
        key,
        (value_text IS NOT NULL) AS has_text,
        (value_json IS NOT NULL) AS has_json
      FROM site_settings
      WHERE key LIKE 'home.%'
      ORDER BY key
    `);
    const afterRows = Array.isArray(afterRes) ? afterRes : (afterRes?.rows || []);

    return new Response(
      JSON.stringify({
        ok: true,
        message: '메인 페이지 시드 완료',
        actualColumns: colsRows.map((c: any) => ({
          name: c.column_name,
          type: c.data_type,
          nullable: c.is_nullable,
        })),
        result: {
          textInserted, textSkipped,
          jsonInserted, jsonSkipped,
          totalAfter: afterRows.length,
          expectedTotal: seedTexts.length + seedJsons.length,
        },
        afterKeys: afterRows,
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