// netlify/functions/migrate-m11.ts
// ★ Phase M-11: content_pages + activity_posts + media_posts + 시드

import type { Context } from "@netlify/functions";
import postgres from "postgres";

export const config = { path: "/api/migrate-m11" };

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  if (key !== "siren-m11-2026") {
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
  const log: string[] = [];

  try {
    /* ENUM */
    try {
      await sql`CREATE TYPE activity_category AS ENUM ('report', 'photo', 'news')`;
      log.push("✅ ENUM activity_category 생성");
    } catch (e: any) {
      if (e.code === "42710") log.push("ℹ️ ENUM activity_category 이미 존재");
      else throw e;
    }
    try {
      await sql`CREATE TYPE media_category AS ENUM ('press', 'photo', 'event')`;
      log.push("✅ ENUM media_category 생성");
    } catch (e: any) {
      if (e.code === "42710") log.push("ℹ️ ENUM media_category 이미 존재");
      else throw e;
    }

    /* content_pages */
    await sql`
      CREATE TABLE IF NOT EXISTS content_pages (
        id SERIAL PRIMARY KEY,
        page_key VARCHAR(100) NOT NULL UNIQUE,
        title VARCHAR(200),
        content_html TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        updated_by INTEGER REFERENCES members(id) ON DELETE SET NULL
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS content_pages_key_idx ON content_pages(page_key)`;
    log.push("✅ content_pages 테이블 생성");

    /* activity_posts */
    await sql`
      CREATE TABLE IF NOT EXISTS activity_posts (
        id SERIAL PRIMARY KEY,
        slug VARCHAR(100) NOT NULL UNIQUE,
        year INTEGER NOT NULL,
        month INTEGER,
        category activity_category NOT NULL DEFAULT 'news',
        title VARCHAR(200) NOT NULL,
        summary VARCHAR(500),
        content_html TEXT,
        thumbnail_blob_id INTEGER,
        attachment_ids TEXT,
        is_published BOOLEAN NOT NULL DEFAULT TRUE,
        is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
        sort_order INTEGER DEFAULT 0,
        views INTEGER NOT NULL DEFAULT 0,
        published_at TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        updated_by INTEGER REFERENCES members(id) ON DELETE SET NULL
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS activity_posts_slug_idx ON activity_posts(slug)`;
    await sql`CREATE INDEX IF NOT EXISTS activity_posts_year_idx ON activity_posts(year, month)`;
    await sql`CREATE INDEX IF NOT EXISTS activity_posts_category_idx ON activity_posts(category)`;
    await sql`CREATE INDEX IF NOT EXISTS activity_posts_published_idx ON activity_posts(is_published)`;
    await sql`CREATE INDEX IF NOT EXISTS activity_posts_pinned_idx ON activity_posts(is_pinned)`;
    log.push("✅ activity_posts 테이블 생성");

    /* media_posts */
    await sql`
      CREATE TABLE IF NOT EXISTS media_posts (
        id SERIAL PRIMARY KEY,
        category media_category NOT NULL DEFAULT 'press',
        title VARCHAR(200) NOT NULL,
        summary VARCHAR(500),
        content_html TEXT,
        thumbnail_blob_id INTEGER,
        external_url VARCHAR(500),
        source VARCHAR(100),
        is_published BOOLEAN NOT NULL DEFAULT TRUE,
        views INTEGER NOT NULL DEFAULT 0,
        published_at TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        updated_by INTEGER REFERENCES members(id) ON DELETE SET NULL
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS media_posts_category_idx ON media_posts(category)`;
    await sql`CREATE INDEX IF NOT EXISTS media_posts_published_idx ON media_posts(is_published)`;
    await sql`CREATE INDEX IF NOT EXISTS media_posts_published_at_idx ON media_posts(published_at)`;
    log.push("✅ media_posts 테이블 생성");

    /* ============ 시드: content_pages 8개 ============ */
    const seedPages: Array<[string, string, string]> = [
      ["about_greeting_text", "인사말 본문",
        `<p>교사유가족협의회는 사랑하는 가족을 잃은 슬픔 속에서도 다시 일어서야 했던 유가족들이 서로의 손을 잡으며 시작되었습니다. 우리는 고인의 명예를 회복하고, 남겨진 가족이 일상으로 돌아갈 수 있도록 곁에 머무르며, 같은 비극이 되풀이되지 않는 교육 환경을 만들어 가기 위해 노력합니다.</p>
<p>이 작은 홈페이지는 우리의 약속이자 시작입니다. 따뜻한 응원과 단단한 연대를 부탁드립니다. 앞으로도 투명한 운영과 정직한 활동으로 보답하겠습니다.</p>`],
      ["about_greeting_sign", "대표자 서명",
        `<p>교사유가족협의회 대표</p><p style="font-size:22px;font-weight:600">김 ○ ○ 드림</p>`],
      ["about_vision_card_1", "약속 카드 1 (존엄)",
        `<h3>존엄 (Dignity)</h3><p>고인이 된 교사들의<br />명예를 회복하고<br />기억을 정중히 기립니다.</p>`],
      ["about_vision_card_2", "약속 카드 2 (투명)",
        `<h3>투명 (Transparency)</h3><p>모든 후원금의 사용처를<br />실시간으로 공개하여<br />신뢰를 쌓아갑니다.</p>`],
      ["about_vision_card_3", "약속 카드 3 (연대)",
        `<h3>연대 (Solidarity)</h3><p>유가족과 후원자, 그리고<br />모든 교육 공동체가<br />함께 손잡고 나아갑니다.</p>`],
      ["about_history", "주요 연혁",
        `<div class="history-item"><strong>2024</strong><p>교사유가족협의회 발족 및 첫 추모식 개최<br />지정기부금단체 등록 / 자원봉사자 12명 위촉</p></div>
<div class="history-item"><strong>2025</strong><p>법률·심리 지원 사업 정식 런칭<br />누적 후원자 1,000명 돌파 / 1차 활동 보고서 발간</p></div>
<div class="history-item"><strong>2026</strong><p>싸이렌 통합 플랫폼 오픈<br />장학사업 첫 수혜자 배출 / "기억의 약속" 추모 캠페인 진행</p></div>`],
      ["about_org", "조직 구성",
        `<table class="tbl"><thead><tr><th>구분</th><th>역할</th><th>인원</th></tr></thead><tbody>
<tr><td>대표</td><td>총괄 및 대외 활동</td><td>1명</td></tr>
<tr><td>사무국장</td><td>재무 / 기부금 관리</td><td>1명</td></tr>
<tr><td>상담사</td><td>유가족 지원사업</td><td>4명</td></tr>
<tr><td>법률 패널</td><td>법률 자문 (협력)</td><td>12명</td></tr>
<tr><td>봉사자</td><td>자원봉사 활동</td><td>186명</td></tr>
</tbody></table>`],
      ["about_location", "오시는 길",
        `<p><strong>주소</strong><br />서울특별시 종로구 세종대로 OO길 OO, O층 (우 03000)</p>
<p><strong>대표전화</strong> 02-0000-0000<br /><strong>이메일</strong> contact@siren-org.kr<br /><strong>운영시간</strong> 평일 09:30 ~ 18:00 (점심 12:30~13:30)</p>`],
    ];

    for (const [pageKey, title, html] of seedPages) {
      await sql`
        INSERT INTO content_pages (page_key, title, content_html)
        VALUES (${pageKey}, ${title}, ${html})
        ON CONFLICT (page_key) DO NOTHING
      `;
    }
    log.push(`✅ content_pages 시드 ${seedPages.length}건`);

    /* ============ 시드: activity_posts 3건 ============ */
    const seedActivities: Array<[string, number, number, string, string, string, string]> = [
      ["activity-2026-spring-memorial", 2026, 4, "news", "2026 봄 추모식 개최",
        "사랑하는 동료 교사들을 기리는 봄 추모식이 4월 20일 협의회 강당에서 진행되었습니다.",
        `<p>2026년 4월 20일, 사랑하는 동료 교사들을 기리는 봄 추모식이 협의회 강당에서 진행되었습니다.</p><p>유가족 87명과 동료 교사 220여 명이 참석한 가운데, 고인의 이름을 한 분 한 분 호명하며 함께 묵념했습니다.</p>`],
      ["activity-2025-annual-report", 2025, 12, "report", "2025년 연간 활동 보고서",
        "2025년 한 해 동안의 협의회 활동 내역과 후원금 집행 결과를 투명하게 공개합니다.",
        `<h3>2025년 활동 요약</h3><ul><li>유가족 지원 건수: 128건</li><li>법률 자문 매칭: 47건</li><li>심리상담 프로그램 운영: 21회</li><li>장학금 지원: 14명</li></ul><p>자세한 내용은 첨부 보고서를 참고해 주세요.</p>`],
      ["activity-2024-launch", 2024, 11, "news", "교사유가족협의회 공식 출범",
        "2024년 11월 5일, 교사유가족협의회가 공식 출범했습니다.",
        `<p>2024년 11월 5일, 사단법인 교사유가족협의회가 공식 출범했습니다.</p><p>고인이 된 동료 교사들의 명예 회복과 유가족 지원을 위한 첫걸음을 내딛게 되었습니다.</p>`],
    ];

    for (const [slug, year, month, category, title, summary, html] of seedActivities) {
      await sql`
        INSERT INTO activity_posts (slug, year, month, category, title, summary, content_html, is_published)
        VALUES (${slug}, ${year}, ${month}, ${category}::activity_category, ${title}, ${summary}, ${html}, TRUE)
        ON CONFLICT (slug) DO NOTHING
      `;
    }
    log.push(`✅ activity_posts 시드 ${seedActivities.length}건`);

    /* ============ 시드: media_posts 4건 ============ */
    const seedMedia: Array<[string, string, string, string, string, string]> = [
      ["press", "한겨레", "[한겨레] 교사유가족협의회, '기억의 약속' 캠페인 전개",
        "교사유가족협의회가 4월 한 달간 '기억의 약속' 추모 캠페인을 전개합니다...",
        "https://www.hani.co.kr/article/example",
        `<p>한겨레신문 2026년 4월 보도</p><p>교사유가족협의회가 4월 한 달간 '기억의 약속' 추모 캠페인을 전개합니다. 이번 캠페인은...</p>`],
      ["press", "교육신문", "[교육신문] 유가족 심리상담 프로그램 1주년... 누적 128건 지원",
        "교사유가족협의회의 심리상담 프로그램이 1주년을 맞아 누적 128건의 지원을 기록했습니다...",
        "https://www.edunews.co.kr/article/example",
        `<p>교육신문 2025년 12월 보도</p>`],
      ["photo", "", "2026 봄 추모식 사진",
        "협의회 강당에서 진행된 봄 추모식의 모습입니다.",
        "",
        `<p>2026년 4월 20일 봄 추모식 현장 사진입니다.</p>`],
      ["event", "", "5월 유가족 자조 모임 안내",
        "5월 셋째 주 토요일, 유가족 자조 모임이 진행됩니다.",
        "",
        `<p>일시: 2026년 5월 18일(토) 14:00<br />장소: 협의회 강당<br />참가비: 무료</p>`],
    ];

    for (const [category, source, title, summary, externalUrl, html] of seedMedia) {
      await sql`
        INSERT INTO media_posts (category, source, title, summary, external_url, content_html, is_published)
        VALUES (${category}::media_category, ${source || null}, ${title}, ${summary}, ${externalUrl || null}, ${html}, TRUE)
      `;
    }
    log.push(`✅ media_posts 시드 ${seedMedia.length}건`);

    /* 검증 */
    const counts = await sql`
      SELECT
        (SELECT COUNT(*)::int FROM content_pages) AS content_pages,
        (SELECT COUNT(*)::int FROM activity_posts) AS activity_posts,
        (SELECT COUNT(*)::int FROM media_posts) AS media_posts
    `;

    await sql.end();

    return new Response(JSON.stringify({
      ok: true, message: "✅ Phase M-11 마이그레이션 완료", log,
      counts: counts[0],
    }, null, 2), {
      status: 200, headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (e: any) {
    await sql.end().catch(() => {});
    return new Response(JSON.stringify({ ok: false, error: e.message, log, stack: e.stack }, null, 2),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } });
  }
};