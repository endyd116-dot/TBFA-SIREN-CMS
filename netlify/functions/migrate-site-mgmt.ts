// netlify/functions/migrate-site-mgmt.ts
// ★ 1회용 마이그레이션 — 메인 화면 관리 시스템
// 호출: GET /.netlify/functions/migrate-site-mgmt?key=siren-site-mgmt-2026
// ★ 응답 ok:true 확인 후 즉시 이 파일 삭제 + git push (보안)

import type { Handler } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";

const MIGRATION_KEY = "siren-site-mgmt-2026";

export const handler: Handler = async (event) => {
  if (event.queryStringParameters?.key !== MIGRATION_KEY) {
    return { statusCode: 401, body: JSON.stringify({ ok: false, error: "Unauthorized" }) };
  }

  const log: string[] = [];

  try {
    /* ===== 1. 테이블 생성 ===== */

    /* site_settings — Key-Value 콘텐츠 + Draft 시스템 */
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS site_settings (
        id SERIAL PRIMARY KEY,
        scope VARCHAR(50) NOT NULL,
        key VARCHAR(150) NOT NULL,
        value_type VARCHAR(20) NOT NULL DEFAULT 'text',
        value_text TEXT,
        value_blob_id INTEGER,
        value_json JSONB,
        draft_value_text TEXT,
        draft_value_blob_id INTEGER,
        draft_value_json JSONB,
        has_draft BOOLEAN DEFAULT false NOT NULL,
        description VARCHAR(300),
        sort_order INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT true NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_by INTEGER,
        UNIQUE(scope, key)
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS site_settings_scope_idx ON site_settings(scope)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS site_settings_active_idx ON site_settings(is_active)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS site_settings_draft_idx ON site_settings(has_draft)`);
    log.push("✅ site_settings 테이블 생성");

    /* nav_menu_items — 계층형 메뉴 */
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS nav_menu_items (
        id SERIAL PRIMARY KEY,
        parent_id INTEGER REFERENCES nav_menu_items(id) ON DELETE CASCADE,
        menu_location VARCHAR(20) NOT NULL,
        label VARCHAR(100) NOT NULL,
        href VARCHAR(500),
        icon VARCHAR(20),
        sort_order INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT true NOT NULL,
        opens_modal VARCHAR(50),
        page_key VARCHAR(50),
        target VARCHAR(20) DEFAULT '_self',
        css_class VARCHAR(100),
        draft_label VARCHAR(100),
        draft_href VARCHAR(500),
        draft_sort_order INTEGER,
        has_draft BOOLEAN DEFAULT false NOT NULL,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS nav_menu_loc_idx ON nav_menu_items(menu_location, sort_order)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS nav_menu_parent_idx ON nav_menu_items(parent_id)`);
    log.push("✅ nav_menu_items 테이블 생성");

    /* related_sites */
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS related_sites (
        id SERIAL PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        url VARCHAR(500) NOT NULL,
        description VARCHAR(300),
        sort_order INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT true NOT NULL,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);
    log.push("✅ related_sites 테이블 생성");

    /* site_publish_log — 배포 이력 */
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS site_publish_log (
        id SERIAL PRIMARY KEY,
        published_by INTEGER,
        published_by_name VARCHAR(100),
        affected_settings INTEGER DEFAULT 0,
        affected_menus INTEGER DEFAULT 0,
        scopes TEXT,
        note VARCHAR(500),
        published_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);
    log.push("✅ site_publish_log 테이블 생성");

    /* ===== 2. site_settings 시드 (멱등) ===== */
    const SETTINGS_SEEDS: Array<[string, string, string, any, string, number]> = [
      // [scope, key, valueType, valueText, description, sortOrder]
      
      // === HEADER ===
      ['header', 'brand.name', 'text', '교사유가족협의회', '메인 로고 옆 협회명', 1],
      ['header', 'brand.subtitle', 'text', '연대 · 존엄 (SOLIDARITY · DIGNITY)', '협회명 아래 영문 부제', 2],
      ['header', 'topbar.searchPlaceholder', 'text', '검색어를 입력하세요', '상단 검색창 placeholder', 3],

      // === HERO ===
      ['home', 'hero.eyebrow', 'text', '기억 · 지원 · 연대 (REMEMBER · SUPPORT · SOLIDARITY)', '히어로 영역 상단 라벨', 1],
      ['home', 'hero.title.line1', 'html', '교사 유가족들의 <em>지원과 수사</em>,', '히어로 제목 1줄', 2],
      ['home', 'hero.title.line2', 'html', '모든 교사들의 <em>사회적 문제 해결</em>을 위해', '히어로 제목 2줄', 3],
      ['home', 'hero.title.line3', 'text', '싸이렌 홈페이지의 문을 열었습니다.', '히어로 제목 3줄', 4],
      ['home', 'hero.lead', 'text', '존엄한 기억과 투명한 동행, 그리고 따뜻한 연대로 교육 공동체의 회복을 함께 만들어 갑니다.', '히어로 부제', 5],
      ['home', 'hero.cta1.label', 'text', '후원 동참하기', '히어로 메인 버튼', 6],
      ['home', 'hero.cta2.label', 'text', '지원 신청 안내', '히어로 보조 버튼', 7],

      // === STATS (활동 보고서/메인 공통) ===
      ['stats', 'donations.totalAmount', 'number', '1283000000', '누적 후원금 (원, 표시는 자동 변환)', 1],
      ['stats', 'donations.monthlyTrend', 'json', '[{"month":"1월","amount":84200000},{"month":"2월","amount":96500000},{"month":"3월","amount":118000000},{"month":"4월","amount":112400000}]', '월별 후원금 추이 (활동보고서)', 2],
      ['stats', 'support.totalCount', 'number', '847', '유가족 지원 건수', 3],
      ['stats', 'members.regularDonors', 'number', '3527', '정기 후원 회원 수', 4],
      ['stats', 'members.volunteers', 'number', '186', '전문 봉사자 수', 5],
      ['stats', 'distribution.directSupport', 'number', '58', '집행비율 - 직접지원 (%)', 6],
      ['stats', 'distribution.memorial', 'number', '17', '집행비율 - 추모사업 (%)', 7],
      ['stats', 'distribution.scholarship', 'number', '15', '집행비율 - 장학사업 (%)', 8],
      ['stats', 'distribution.operation', 'number', '10', '집행비율 - 운영비 (%)', 9],
      ['stats', 'transparency.grade', 'text', 'A+', '투명성 등급', 10],

      // === FEATURED CAMPAIGN (메인 페이지 하단 특별 캠페인) ===
      ['campaign', 'featured.tag', 'text', '특별 캠페인 (SPECIAL CAMPAIGN)', '특별 캠페인 태그', 1],
      ['campaign', 'featured.title.line1', 'text', '"기억의 약속" 추모 주간', '특별 캠페인 제목 1줄', 2],
      ['campaign', 'featured.title.line2', 'text', '특별 모금함이 진행 중입니다', '특별 캠페인 제목 2줄', 3],
      ['campaign', 'featured.lead', 'text', '고인이 된 동료 교사를 기리고, 남은 가족들이 다시 일상으로 돌아갈 수 있도록 함께해 주세요. 모금액은 전액 유가족 직접 지원과 추모 사업에 사용됩니다.', '특별 캠페인 부제', 4],
      ['campaign', 'featured.goalAmount', 'number', '100000000', '캠페인 목표액', 5],
      ['campaign', 'featured.raisedAmount', 'number', '68420000', '캠페인 모금액', 6],

      // === SECTION EYEBROWS (섹션 상단 라벨) ===
      ['home', 'section.transparency.eyebrow', 'text', '투명성 (TRANSPARENCY)', '실시간 활동 지표 섹션 라벨', 10],
      ['home', 'section.transparency.title', 'text', '실시간 활동 지표', '실시간 활동 지표 섹션 제목', 11],
      ['home', 'section.community.eyebrow', 'text', '커뮤니티 (COMMUNITY)', '공지사항 섹션 라벨', 12],
      ['home', 'section.community.title', 'text', '통합 공지사항', '공지사항 섹션 제목', 13],
      ['home', 'section.help.eyebrow', 'text', '도움말 센터 (HELP CENTER)', 'FAQ 섹션 라벨', 14],
      ['home', 'section.help.title', 'text', '자주 묻는 질문', 'FAQ 섹션 제목', 15],
      ['home', 'section.campaign.eyebrow', 'text', '캠페인 (CAMPAIGN)', '진행 캠페인 섹션 라벨', 16],
      ['home', 'section.campaign.title', 'text', '🎗 진행 중인 캠페인', '진행 캠페인 섹션 제목', 17],

      // === FOOTER ===
      ['footer', 'org.name', 'text', '(사) 교사유가족협의회', '협회 정식명', 1],
      ['footer', 'org.representative', 'text', '대표 김◯◯', '대표자', 2],
      ['footer', 'org.businessNo', 'text', '123-45-67890', '사업자등록번호', 3],
      ['footer', 'org.donationNo', 'text', '678-90-12345', '지정기부금단체 고유번호', 4],
      ['footer', 'org.email', 'text', 'contact@siren-org.kr', '대표 이메일', 5],
      ['footer', 'org.address', 'text', '서울특별시 종로구 세종대로 OO길 OO, O층 (우 03000)', '주소', 6],
      ['footer', 'org.phone', 'text', '02-0000-0000', '대표전화', 7],
      ['footer', 'org.businessHours', 'text', '평일 09:30 ~ 18:00 (점심 12:30~13:30)', '운영시간', 8],
      ['footer', 'sns.youtube', 'text', '#', 'YouTube URL', 9],
      ['footer', 'sns.instagram', 'text', '#', 'Instagram URL', 10],
      ['footer', 'sns.facebook', 'text', '#', 'Facebook URL', 11],
      ['footer', 'sns.blog', 'text', '#', 'Blog URL', 12],
      ['footer', 'brand.tagline', 'html', '존엄한 기억, 투명한 동행<br />모든 교사와 함께합니다.', '푸터 슬로건', 13],
      ['footer', 'donation.notice', 'text', '기부금 영수증 발급 등 모든 후원금은 지정기부금으로 처리되어 세제 혜택을 받으실 수 있습니다.', '기부금 안내', 14],
    ];

    let seedSettingsCount = 0;
    for (const [scope, key, valueType, valueText, description, sortOrder] of SETTINGS_SEEDS) {
      try {
        if (valueType === 'json') {
          await db.execute(sql`
            INSERT INTO site_settings (scope, key, value_type, value_json, description, sort_order)
            VALUES (${scope}, ${key}, ${valueType}, ${valueText}::jsonb, ${description}, ${sortOrder})
            ON CONFLICT (scope, key) DO NOTHING
          `);
        } else if (valueType === 'number') {
          await db.execute(sql`
            INSERT INTO site_settings (scope, key, value_type, value_text, description, sort_order)
            VALUES (${scope}, ${key}, ${valueType}, ${valueText}, ${description}, ${sortOrder})
            ON CONFLICT (scope, key) DO NOTHING
          `);
        } else {
          await db.execute(sql`
            INSERT INTO site_settings (scope, key, value_type, value_text, description, sort_order)
            VALUES (${scope}, ${key}, ${valueType}, ${valueText}, ${description}, ${sortOrder})
            ON CONFLICT (scope, key) DO NOTHING
          `);
        }
        seedSettingsCount++;
      } catch (e) {
        console.warn(`Seed failed: ${scope}.${key}`, (e as any)?.message);
      }
    }
    log.push(`✅ site_settings 시드 ${seedSettingsCount}건`);

    /* ===== 3. nav_menu_items 시드 (계층형) ===== */
    
    /* 1뎁스부터 시드 (parent_id = null) */
    const level1Items = [
      { menu_location: 'header', label: '협의회 소개', href: '/about.html', sort_order: 1, page_key: 'about' },
      { menu_location: 'header', label: '주요 활동', href: '/support.html', sort_order: 2, page_key: 'support' },
      { menu_location: 'header', label: '사이렌', href: '/incidents.html', sort_order: 3, page_key: 'siren', icon: '🚨', css_class: 'gnb-siren' },
      { menu_location: 'header', label: '소식 / 참여', href: '/news.html', sort_order: 4, page_key: 'news' },
      { menu_location: 'header', label: '후원 안내', href: '#', sort_order: 5, page_key: 'donate', opens_modal: 'donateModal' },
      { menu_location: 'header', label: '마이페이지', href: '/mypage.html', sort_order: 6, page_key: 'mypage' },
    ];

    const level1Ids: Record<string, number> = {};
    for (const it of level1Items) {
      const result: any = await db.execute(sql`
        INSERT INTO nav_menu_items (menu_location, label, href, sort_order, page_key, opens_modal, icon, css_class, is_active)
        VALUES (
          ${it.menu_location}, 
          ${it.label}, 
          ${it.href}, 
          ${it.sort_order}, 
          ${it.page_key}, 
          ${it.opens_modal || null}, 
          ${it.icon || null}, 
          ${it.css_class || null},
          true
        )
        ON CONFLICT DO NOTHING
        RETURNING id
      `);
      const rows = Array.isArray(result) ? result : (result?.rows || []);
      if (rows[0]?.id) level1Ids[it.page_key!] = Number(rows[0].id);
      else {
        /* 이미 존재하면 조회 */
        const ex: any = await db.execute(sql`
          SELECT id FROM nav_menu_items WHERE menu_location = 'header' AND page_key = ${it.page_key} AND parent_id IS NULL LIMIT 1
        `);
        const exRows = Array.isArray(ex) ? ex : (ex?.rows || []);
        if (exRows[0]?.id) level1Ids[it.page_key!] = Number(exRows[0].id);
      }
    }

    /* 2뎁스 시드 */
    const level2Items = [
      // 협의회 소개
      { parent: 'about', label: '인사말 / 비전', href: '/about.html#greeting', sort_order: 1 },
      { parent: 'about', label: '설립 취지 / 연혁', href: '/about.html#history', sort_order: 2 },
      { parent: 'about', label: '조직도 / 오시는 길', href: '/about.html#org', sort_order: 3 },
      // 주요 활동
      { parent: 'support', label: '유가족 지원사업', href: '/support.html#family', sort_order: 1 },
      { parent: 'support', label: '추모 / 장학사업', href: '/support.html#memorial', sort_order: 2 },
      { parent: 'support', label: '활동 보고서', href: '/report.html', sort_order: 3 },
      // 사이렌
      { parent: 'siren', label: '🔍 사건 제보', href: '/incidents.html', sort_order: 1 },
      { parent: 'siren', label: '⚠️ 악성민원 신고', href: '/report-harassment.html', sort_order: 2 },
      { parent: 'siren', label: '⚖️ 법률 지원', href: '/legal-support.html', sort_order: 3 },
      { parent: 'siren', label: '💬 자유게시판', href: '/board.html', sort_order: 4 },
      { parent: 'siren', label: '📋 신청 내역 확인', href: '/mypage.html#support', sort_order: 5 },
      // 소식 / 참여
      { parent: 'news', label: '공지사항', href: '/news.html#notice', sort_order: 1 },
      { parent: 'news', label: '언론보도 / 갤러리', href: '/news.html#media', sort_order: 2 },
      { parent: 'news', label: '자주 묻는 질문', href: '/news.html#faq', sort_order: 3 },
      { parent: 'news', label: '📚 자료실', href: '/resources.html', sort_order: 4 },
      // 후원 안내
      { parent: 'donate', label: '정기 / 일시 후원', href: '#', sort_order: 1, opens_modal: 'donateModal' },
      { parent: 'donate', label: '📢 캠페인', href: '/campaigns.html', sort_order: 2 },
      { parent: 'donate', label: '기부금 영수증', href: '/mypage.html', sort_order: 3 },
    ];

    let menuSeedCount = level1Items.length;
    for (const it of level2Items) {
      const parentId = level1Ids[it.parent];
      if (!parentId) continue;
      try {
        await db.execute(sql`
          INSERT INTO nav_menu_items (parent_id, menu_location, label, href, sort_order, opens_modal, is_active)
          VALUES (${parentId}, 'header', ${it.label}, ${it.href}, ${it.sort_order}, ${(it as any).opens_modal || null}, true)
          ON CONFLICT DO NOTHING
        `);
        menuSeedCount++;
      } catch (e) {}
    }
    log.push(`✅ nav_menu_items 시드 ${menuSeedCount}건`);

    /* ===== 4. related_sites 시드 ===== */
    const RELATED_SITES = [
      { name: '전국교직원노동조합', url: 'https://www.eduhope.net', sort_order: 1 },
      { name: '한국교원단체총연합회', url: 'https://www.kfta.or.kr', sort_order: 2 },
      { name: '전국초등교사노동조합', url: 'https://www.kpu.or.kr', sort_order: 3 },
      { name: '교사노동조합연맹', url: 'https://www.kfta.or.kr', sort_order: 4 },
    ];

    let rsSeedCount = 0;
    for (const r of RELATED_SITES) {
      try {
        const ex: any = await db.execute(sql`SELECT id FROM related_sites WHERE name = ${r.name} LIMIT 1`);
        const exRows = Array.isArray(ex) ? ex : (ex?.rows || []);
        if (exRows.length === 0) {
          await db.execute(sql`
            INSERT INTO related_sites (name, url, sort_order, is_active)
            VALUES (${r.name}, ${r.url}, ${r.sort_order}, true)
          `);
          rsSeedCount++;
        }
      } catch (e) {}
    }
    log.push(`✅ related_sites 시드 ${rsSeedCount}건`);

    /* ===== 5. 검증 ===== */
    const verify1: any = await db.execute(sql`SELECT COUNT(*)::int AS c FROM site_settings`);
    const verify2: any = await db.execute(sql`SELECT COUNT(*)::int AS c FROM nav_menu_items`);
    const verify3: any = await db.execute(sql`SELECT COUNT(*)::int AS c FROM related_sites`);
    const v1Rows = Array.isArray(verify1) ? verify1 : (verify1?.rows || []);
    const v2Rows = Array.isArray(verify2) ? verify2 : (verify2?.rows || []);
    const v3Rows = Array.isArray(verify3) ? verify3 : (verify3?.rows || []);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: true,
        log,
        verify: {
          siteSettingsCount: v1Rows[0]?.c || 0,
          navMenuCount: v2Rows[0]?.c || 0,
          relatedSitesCount: v3Rows[0]?.c || 0,
        },
      }, null, 2),
    };
  } catch (e: any) {
    log.push(`❌ 에러: ${e.message}`);
    console.error("[migrate-site-mgmt]", e);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: false,
        error: e.message,
        log,
      }, null, 2),
    };
  }
};