// netlify/functions/migrate-seed-home-content-v2.ts
// ★ 1회용 마이그레이션 — Phase B Step 6-A (재시도)
// scope='home' + value_type 명시 + 27개 home.* 키 INSERT
// 호출 후 즉시 파일 삭제할 것

import type { Context } from "@netlify/functions";
import { db } from "../../db/index.js";
import { sql } from "drizzle-orm";

const MIGRATE_KEY = "siren-seed-home-v10b";

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
       텍스트 시드 24개 — value_type 명시
       valueType: 'text' | 'html' | 'number'
       ============================================================ */
    const seedTexts: { key: string; valueType: string; value: string; sortOrder: number }[] = [
      // HERO
      { key: "home.hero.eyebrow",          valueType: "text",   value: "기억 · 지원 · 연대 (REMEMBER · SUPPORT · SOLIDARITY)", sortOrder: 1 },
      { key: "home.hero.lead",             valueType: "text",   value: "존엄한 기억과 투명한 동행, 그리고 따뜻한 연대로 교육 공동체의 회복을 함께 만들어 갑니다.", sortOrder: 2 },
      { key: "home.hero.autoplaySpeed",    valueType: "number", value: "7", sortOrder: 3 },
      { key: "home.hero.autoplayEnabled",  valueType: "text",   value: "true", sortOrder: 4 },

      // 퀵메뉴
      { key: "home.quickMenu.sectionVisible", valueType: "text", value: "true", sortOrder: 10 },

      // 캠페인 영역
      { key: "home.campaign.sectionVisible", valueType: "text",   value: "true", sortOrder: 20 },
      { key: "home.campaign.title",          valueType: "text",   value: "🎗 진행 중인 캠페인", sortOrder: 21 },
      { key: "home.campaign.subtitle",       valueType: "text",   value: "여러분의 따뜻한 마음이 모여 큰 변화를 만듭니다.\n교사 유가족과 동료 교사들의 회복을 함께 지원해주세요.", sortOrder: 22 },
      { key: "home.campaign.maxItems",       valueType: "number", value: "3", sortOrder: 23 },

      // 공지
      { key: "home.notice.sectionVisible", valueType: "text",   value: "true", sortOrder: 30 },
      { key: "home.notice.title",          valueType: "text",   value: "통합 공지사항", sortOrder: 31 },
      { key: "home.notice.maxItems",       valueType: "number", value: "5", sortOrder: 32 },

      // FAQ
      { key: "home.faq.sectionVisible", valueType: "text",   value: "true", sortOrder: 40 },
      { key: "home.faq.title",          valueType: "text",   value: "자주 묻는 질문", sortOrder: 41 },
      { key: "home.faq.maxItems",       valueType: "number", value: "4", sortOrder: 42 },

      // 특별 캠페인 배너
      { key: "home.specialBanner.visible",      valueType: "text",   value: "true", sortOrder: 50 },
      { key: "home.specialBanner.tag",          valueType: "text",   value: "특별 캠페인 (SPECIAL CAMPAIGN)", sortOrder: 51 },
      { key: "home.specialBanner.title",        valueType: "html",   value: '"기억의 약속" 추모 주간<br />특별 모금함이 진행 중입니다', sortOrder: 52 },
      { key: "home.specialBanner.lead",         valueType: "text",   value: "고인이 된 동료 교사를 기리고, 남은 가족들이 다시 일상으로 돌아갈 수 있도록 함께해 주세요. 모금액은 전액 유가족 직접 지원과 추모 사업에 사용됩니다.", sortOrder: 53 },
      { key: "home.specialBanner.goalAmount",   valueType: "number", value: "100000000", sortOrder: 54 },
      { key: "home.specialBanner.raisedAmount", valueType: "number", value: "68420000", sortOrder: 55 },

      // 효과/애니메이션
      { key: "home.effects.counterDuration",     valueType: "number", value: "1600", sortOrder: 60 },
      { key: "home.effects.sirenPulseEnabled",   valueType: "text",   value: "true", sortOrder: 61 },
      { key: "home.effects.progressBarDuration", valueType: "number", value: "1200", sortOrder: 62 },
    ];

    /* ============================================================
       JSON 시드 3개
       ============================================================ */
    const heroSlides = [
      {
        title: '교사 유가족들의 <em>지원과 수사</em>,<br />모든 교사들의 <em>사회적 문제 해결</em>을 위해<br />싸이렌 홈페이지의 문을 열었습니다.',
        ctaPrimary: { label: '후원 동참하기', action: 'modal', target: 'donateModal' },
        ctaSecondary: { label: '지원 신청 안내 →', action: 'link', href: '/support.html' },
        sortOrder: 1,
        isActive: true,
      },
      {
        title: '<em>"기억의 약속"</em> 추모 주간이<br />4월 한 달간 진행되고 있습니다.<br />여러분의 동참을 기다립니다.',
        ctaPrimary: { label: '후원 동참하기', action: 'modal', target: 'donateModal' },
        ctaSecondary: { label: '지원 신청 안내 →', action: 'link', href: '/support.html' },
        sortOrder: 2,
        isActive: true,
      },
      {
        title: '투명한 회계, 정직한 동행.<br /><em>2025년 활동 보고서</em>가<br />지금 공개되었습니다.',
        ctaPrimary: { label: '후원 동참하기', action: 'modal', target: 'donateModal' },
        ctaSecondary: { label: '활동 보고서 →', action: 'link', href: '/report.html' },
        sortOrder: 3,
        isActive: true,
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
       INSERT (재실행 안전 — 키 단위 존재 확인)
       ★ scope='home' + value_type + is_active 명시
       ============================================================ */
    let textInserted = 0;
    let textSkipped = 0;
    for (const item of seedTexts) {
      const beforeRes: any = await db.execute(sql`
        SELECT key FROM site_settings WHERE key = ${item.key}
      `);
      const beforeRows = Array.isArray(beforeRes) ? beforeRes : (beforeRes?.rows || []);
      if (beforeRows.length > 0) { textSkipped++; continue; }

      await db.execute(sql`
        INSERT INTO site_settings
          (scope, key, value_type, value_text,
           has_draft, sort_order, is_active,
           created_at, updated_at)
        VALUES
          ('home', ${item.key}, ${item.valueType}, ${item.value},
           false, ${item.sortOrder}, true,
           NOW(), NOW())
      `);
      textInserted++;
    }

    let jsonInserted = 0;
    let jsonSkipped = 0;
    for (const item of seedJsons) {
      const beforeRes: any = await db.execute(sql`
        SELECT key FROM site_settings WHERE key = ${item.key}
      `);
      const beforeRows = Array.isArray(beforeRes) ? beforeRes : (beforeRes?.rows || []);
      if (beforeRows.length > 0) { jsonSkipped++; continue; }

      const jsonStr = JSON.stringify(item.json);
      await db.execute(sql`
        INSERT INTO site_settings
          (scope, key, value_type, value_json,
           has_draft, sort_order, is_active,
           created_at, updated_at)
        VALUES
          ('home', ${item.key}, 'json', ${jsonStr}::jsonb,
           false, ${item.sortOrder}, true,
           NOW(), NOW())
      `);
      jsonInserted++;
    }

    /* ============================================================
       검증
       ============================================================ */
    const afterRes: any = await db.execute(sql`
      SELECT 
        key, scope, value_type,
        (value_text IS NOT NULL) AS has_text,
        (value_json IS NOT NULL) AS has_json,
        has_draft, sort_order, is_active
      FROM site_settings
      WHERE key LIKE 'home.%'
      ORDER BY sort_order, key
    `);
    const afterRows = Array.isArray(afterRes) ? afterRes : (afterRes?.rows || []);

    return new Response(
      JSON.stringify({
        ok: true,
        message: '메인 페이지 시드 완료 (v2)',
        result: {
          textInserted,
          textSkipped,
          jsonInserted,
          jsonSkipped,
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