/**
 * GET /api/migrate-site-pages        — 진단 (인증 불필요·readonly)
 * GET /api/migrate-site-pages?run=1  — 실행 (어드민 인증)
 *
 * 메뉴·페이지 통합 편집 개편 **1단계 — 저장소 구조 3종**.
 * 설계서: docs/active/2026-08-03-page-menu-redesign.md §3
 *
 *   ① site_pages           — 페이지 본체. 통짜 본문 + Draft(임시저장) + SEO + 레이아웃
 *   ② site_page_revisions  — 저장·배포 직전 자동 백업(되돌리기). 페이지당 최근 20개 유지
 *   ③ nav_menu_items 확장  — link_type / site_page_id / draft_site_page_id 3컬럼 추가
 *                            + 기존 메뉴 행의 연결 유형 자동 분류(divider/modal/none/url)
 *
 * ⚠️ 호출 순서 (CLAUDE.md §9.1.1 — 역순이면 헤더 메뉴 전체가 깨진다):
 *    getNavMenus()가 `db.select()` 전체 컬럼 조회라, DB에 컬럼이 없는 상태에서
 *    schema.ts에 신규 컬럼 정의를 활성화하면 메뉴 SELECT가 즉시 실패한다.
 *    ① 이 함수 호출 → ② 성공 확인 → ③ schema.ts navMenuItems 신규 컬럼 주석 해제 → ④ 이 파일 삭제
 *
 * 멱등: CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / 분류 UPDATE는 미분류(NULL) 행만.
 *       몇 번 호출해도 안전하다.
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-site-pages" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

/** db.execute 결과에서 행 배열을 꺼낸다 (postgres-js는 배열, 드라이버에 따라 .rows) */
function rowsOf(result: any): any[] {
  if (!result) return [];
  return Array.isArray(result) ? result : (result.rows ?? []);
}

/** 현재 저장소 상태 진단 — 실행 전후 모두 같은 함수로 확인 */
async function diagnose() {
  const tables = rowsOf(await db.execute(sql.raw(`
    SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name IN ('site_pages', 'site_page_revisions')
  `))).map((r: any) => r.table_name);

  const menuCols = rowsOf(await db.execute(sql.raw(`
    SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'nav_menu_items'
       AND column_name IN ('link_type', 'site_page_id', 'draft_site_page_id')
  `))).map((r: any) => r.column_name);

  /* link_type이 아직 없으면 분포 조회 자체가 에러 → 컬럼 있을 때만 */
  let linkTypeDist: any[] = [];
  let unclassified = 0;
  if (menuCols.includes("link_type")) {
    linkTypeDist = rowsOf(await db.execute(sql.raw(`
      SELECT COALESCE(link_type, '(미분류)') AS link_type, COUNT(*)::int AS cnt
        FROM nav_menu_items GROUP BY 1 ORDER BY 2 DESC
    `)));
    unclassified = Number(
      rowsOf(await db.execute(sql.raw(
        `SELECT COUNT(*)::int AS cnt FROM nav_menu_items WHERE link_type IS NULL`,
      )))[0]?.cnt || 0,
    );
  }

  const menuTotal = Number(
    rowsOf(await db.execute(sql.raw(`SELECT COUNT(*)::int AS cnt FROM nav_menu_items`)))[0]?.cnt || 0,
  );
  const pageTotal = tables.includes("site_pages")
    ? Number(rowsOf(await db.execute(sql.raw(`SELECT COUNT(*)::int AS cnt FROM site_pages`)))[0]?.cnt || 0)
    : null;

  return {
    site_pages_exists: tables.includes("site_pages"),
    site_page_revisions_exists: tables.includes("site_page_revisions"),
    nav_menu_new_columns: menuCols,
    nav_menu_columns_ready: menuCols.length === 3,
    nav_menu_total: menuTotal,
    nav_menu_link_type_dist: linkTypeDist,
    nav_menu_unclassified: unclassified,
    site_pages_count: pageTotal,
  };
}

export default async function handler(req: Request, _ctx: Context) {
  let step = "start";
  try {
    const url = new URL(req.url);
    const run = url.searchParams.get("run") === "1";

    step = "diag";
    const before = await diagnose();
    const alreadyDone =
      before.site_pages_exists &&
      before.site_page_revisions_exists &&
      before.nav_menu_columns_ready &&
      before.nav_menu_unclassified === 0;

    if (!run) {
      return new Response(jsonKST({
        ok: true,
        mode: "diagnose",
        already_done: alreadyDone,
        before,
        will_create: {
          tables: ["site_pages (페이지 본체)", "site_page_revisions (되돌리기 백업)"],
          nav_menu_columns: ["link_type", "site_page_id", "draft_site_page_id"],
          backfill: "기존 메뉴의 연결 유형을 divider/modal/none/url로 자동 분류",
        },
        hint: alreadyDone
          ? "이미 적용됨. 재실행해도 안전(멱등)."
          : "?run=1 로 실행하세요 (관리자 로그인 상태여야 합니다).",
      }, null, 2), { headers: JSON_HEADER });
    }

    step = "auth";
    const auth = await requireAdmin(req);
    if (guardFailed(auth)) return auth.res;

    /* ── ① 페이지 본체 ───────────────────────────────────────────── */
    step = "create_site_pages";
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS site_pages (
        id                  SERIAL PRIMARY KEY,
        slug                VARCHAR(100)  NOT NULL UNIQUE,
        title               VARCHAR(200)  NOT NULL,
        eyebrow             VARCHAR(100),
        subtitle            VARCHAR(300),
        content_html        TEXT,
        draft_title         VARCHAR(200),
        draft_eyebrow       VARCHAR(100),
        draft_subtitle      VARCHAR(300),
        draft_content_html  TEXT,
        has_draft           BOOLEAN       NOT NULL DEFAULT false,
        status              VARCHAR(20)   NOT NULL DEFAULT 'published',
        layout              VARCHAR(20)   NOT NULL DEFAULT 'default',
        seo_title           VARCHAR(200),
        seo_description     VARCHAR(500),
        og_image_url        VARCHAR(500),
        sort_order          INTEGER       DEFAULT 0,
        view_count          INTEGER       DEFAULT 0,
        created_at          TIMESTAMP     NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMP     NOT NULL DEFAULT NOW(),
        updated_by          INTEGER
      )
    `));
    await db.execute(sql.raw(
      `CREATE INDEX IF NOT EXISTS site_pages_status_idx ON site_pages (status, sort_order)`,
    ));
    await db.execute(sql.raw(
      `CREATE INDEX IF NOT EXISTS site_pages_draft_idx ON site_pages (has_draft)`,
    ));

    /* ── ② 되돌리기 백업 ─────────────────────────────────────────── */
    step = "create_site_page_revisions";
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS site_page_revisions (
        id            SERIAL PRIMARY KEY,
        page_id       INTEGER      NOT NULL REFERENCES site_pages(id) ON DELETE CASCADE,
        title         VARCHAR(200),
        eyebrow       VARCHAR(100),
        subtitle      VARCHAR(300),
        content_html  TEXT,
        note          VARCHAR(200),
        saved_by      INTEGER,
        saved_by_name VARCHAR(100),
        saved_at      TIMESTAMP    NOT NULL DEFAULT NOW()
      )
    `));
    await db.execute(sql.raw(
      `CREATE INDEX IF NOT EXISTS site_page_revisions_page_idx ON site_page_revisions (page_id, saved_at DESC)`,
    ));

    /* ── ③ 메뉴 확장 ─────────────────────────────────────────────
       DEFAULT 없이 추가한다. 기존 행이 전부 NULL로 남아야 아래 분류 UPDATE가
       '미분류 행만' 골라낼 수 있고, 그래야 재실행이 멱등해진다. */
    step = "alter_nav_menu_items";
    await db.execute(sql.raw(
      `ALTER TABLE nav_menu_items ADD COLUMN IF NOT EXISTS link_type VARCHAR(20)`,
    ));
    await db.execute(sql.raw(
      `ALTER TABLE nav_menu_items ADD COLUMN IF NOT EXISTS site_page_id INTEGER`,
    ));
    await db.execute(sql.raw(
      `ALTER TABLE nav_menu_items ADD COLUMN IF NOT EXISTS draft_site_page_id INTEGER`,
    ));
    await db.execute(sql.raw(
      `CREATE INDEX IF NOT EXISTS nav_menu_items_page_idx ON nav_menu_items (site_page_id)`,
    ));

    /* 기존 메뉴의 연결 유형 자동 분류 (미분류 행만).
       'page'는 여기서 만들지 않는다 — 7단계 페이지 이관 때 연결하면서 지정한다. */
    step = "backfill_link_type";
    const backfilled = rowsOf(await db.execute(sql.raw(`
      UPDATE nav_menu_items SET link_type =
        CASE
          WHEN css_class = 'dropdown-divider'                        THEN 'divider'
          WHEN opens_modal IS NOT NULL AND opens_modal <> ''         THEN 'modal'
          WHEN href IS NULL OR href = '' OR href = '#'               THEN 'none'
          ELSE 'url'
        END
      WHERE link_type IS NULL
      RETURNING id
    `))).length;

    /* 분류가 끝난 뒤에야 기본값을 건다 (신규 INSERT 대비). */
    step = "set_link_type_default";
    await db.execute(sql.raw(
      `ALTER TABLE nav_menu_items ALTER COLUMN link_type SET DEFAULT 'url'`,
    ));

    step = "verify";
    const after = await diagnose();

    return new Response(jsonKST({
      ok: true,
      mode: "executed",
      backfilled_menu_rows: backfilled,
      before,
      after,
      next: [
        "1) 이 응답의 after.nav_menu_columns_ready 가 true 인지 확인",
        "2) 사이트 상단 메뉴가 정상 표시되는지 확인 (헤더 회귀 점검)",
        "3) 메인에게 성공 알림 → schema.ts 신규 컬럼 주석 해제 + 이 파일 삭제",
      ],
    }, null, 2), { headers: JSON_HEADER });
  } catch (err: any) {
    return new Response(jsonKST({
      ok: false,
      error: "마이그 실패",
      step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: JSON_HEADER });
  }
}
