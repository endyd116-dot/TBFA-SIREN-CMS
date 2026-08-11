/**
 * GET /api/migrate-news-split        — 진단 (인증 불필요·읽기만)
 * GET /api/migrate-news-split?run=1  — 실행 (어드민 인증)
 *
 * 주요활동 메뉴 "1 서브메뉴 = 1 화면" 개편에 필요한 저장 공간을 만든다.
 *
 *  ① notice_categories  — 공지 분류를 운영자가 만들고 지울 수 있게 (기본 일반공지·긴급공지)
 *  ② notices.category   — 고정 4종(단체/회원/사업/언론)에서 자유 분류로 전환. 기존 글은 전부 일반공지로.
 *  ③ notices.sort_order — 화면에 보이는 순서. 이 순서대로 번호 1, 2, 3 을 매긴다.
 *  ④ site_pages         — 세 화면 위쪽 "꾸미는 말"(제목·부제·본문) 3건을 만들어 둔다.
 *  ⑤ nav_menu_items     — 주요활동 하위 메뉴 3개가 각자의 화면을 가리키게 주소 교체.
 *
 * 멱등: 이미 적용된 항목은 건너뛴다. 여러 번 호출해도 안전.
 * 호출 성공 후 이 파일 삭제 + commit.
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-news-split" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

function rowsOf(result: any): any[] {
  if (!result) return [];
  return Array.isArray(result) ? result : (result.rows ?? []);
}

/** 주요활동 하위 메뉴가 가리킬 새 주소 — 라벨에 이 낱말이 들어가면 그 화면으로 연결한다. */
const MENU_TARGETS: Array<{ match: RegExp; href: string; note: string }> = [
  { match: /활동\s*내용|주요\s*활동|활동\s*보고/, href: "/activities.html", note: "활동 내용" },
  { match: /공지/,                                 href: "/notice.html",     note: "공지사항" },
  { match: /언론|보도|갤러리/,                      href: "/press.html",      note: "언론보도" },
];

async function diagnose() {
  const catTable = rowsOf(await db.execute(sql.raw(`
    SELECT table_name FROM information_schema.tables
     WHERE table_schema='public' AND table_name='notice_categories'
  `))).length > 0;

  const noticeCols = rowsOf(await db.execute(sql.raw(`
    SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema='public' AND table_name='notices'
       AND column_name IN ('category','sort_order')
  `)));
  const categoryType = noticeCols.find((c: any) => c.column_name === "category")?.data_type ?? null;
  const hasSortOrder = noticeCols.some((c: any) => c.column_name === "sort_order");

  const introPages = rowsOf(await db.execute(sql.raw(`
    SELECT slug, title, status FROM site_pages
     WHERE slug IN ('intro-activities','intro-notice','intro-press')
     ORDER BY slug
  `)));

  /* 지금 헤더 메뉴가 어떻게 걸려 있는지 그대로 보여준다 — 주소를 바꾸기 전에 눈으로 확인용. */
  const headerMenu = rowsOf(await db.execute(sql.raw(`
    SELECT c.id, p.label AS parent_label, c.label, c.href, c.sort_order, c.is_active
      FROM nav_menu_items c
      LEFT JOIN nav_menu_items p ON p.id = c.parent_id
     WHERE c.menu_location = 'header'
     ORDER BY COALESCE(p.sort_order, c.sort_order), p.id NULLS FIRST, c.sort_order
  `)));

  const noticeCount = Number(rowsOf(await db.execute(sql.raw(
    `SELECT COUNT(*)::int AS c FROM notices`
  )))[0]?.c || 0);

  return {
    notice_categories_table: catTable,
    notices_category_type: categoryType,          // 'USER-DEFINED'(옛 고정분류) → 'character varying'(자유분류)
    notices_sort_order: hasSortOrder,
    intro_pages: introPages,
    notice_count: noticeCount,
    header_menu: headerMenu,
    ready: catTable && hasSortOrder && categoryType === "character varying" && introPages.length === 3,
  };
}

export default async function handler(req: Request, _ctx: Context) {
  let step = "start";
  try {
    const url = new URL(req.url);
    const run = url.searchParams.get("run") === "1";

    step = "diag";
    const before = await diagnose();

    if (!run) {
      return new Response(jsonKST({
        ok: true, mode: "diagnose", before,
        hint: before.ready ? "이미 적용됨. 다시 실행해도 안전합니다." : "?run=1 로 실행하세요 (관리자 로그인 상태).",
      }, null, 2), { headers: JSON_HEADER });
    }

    step = "auth";
    const auth = await requireAdmin(req);
    if (guardFailed(auth)) return auth.res;

    const done: string[] = [];

    /* ── ① 공지 분류 표 ───────────────────────────────────────── */
    step = "create_notice_categories";
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS notice_categories (
        id         SERIAL PRIMARY KEY,
        slug       VARCHAR(30)  NOT NULL UNIQUE,
        label      VARCHAR(50)  NOT NULL,
        color      VARCHAR(20)  NOT NULL DEFAULT 'mute',
        sort_order INTEGER      NOT NULL DEFAULT 0,
        is_active  BOOLEAN      NOT NULL DEFAULT true,
        created_at TIMESTAMP    NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP    NOT NULL DEFAULT NOW()
      )
    `));
    done.push("공지 분류 표 준비");

    step = "seed_notice_categories";
    await db.execute(sql.raw(`
      INSERT INTO notice_categories (slug, label, color, sort_order)
      VALUES ('general', '일반공지', 'mute', 1),
             ('urgent',  '긴급공지', 'danger', 2)
      ON CONFLICT (slug) DO NOTHING
    `));
    done.push("기본 분류 2종(일반공지·긴급공지) 등록");

    /* ── ② 공지 분류 칸을 자유 입력으로 전환 ───────────────────── */
    step = "alter_notices_category";
    const catType = rowsOf(await db.execute(sql.raw(`
      SELECT data_type FROM information_schema.columns
       WHERE table_schema='public' AND table_name='notices' AND column_name='category'
    `)))[0]?.data_type;

    if (catType && catType !== "character varying") {
      await db.execute(sql.raw(`ALTER TABLE notices ALTER COLUMN category DROP DEFAULT`));
      await db.execute(sql.raw(`
        ALTER TABLE notices ALTER COLUMN category TYPE VARCHAR(30) USING category::text
      `));
      await db.execute(sql.raw(`ALTER TABLE notices ALTER COLUMN category SET DEFAULT 'general'`));
      done.push("공지 분류를 자유 입력으로 전환");
    }

    step = "move_old_categories";
    const moved = rowsOf(await db.execute(sql.raw(`
      UPDATE notices SET category = 'general', updated_at = NOW()
       WHERE category IS NULL
          OR category NOT IN (SELECT slug FROM notice_categories)
      RETURNING id
    `))).length;
    if (moved) done.push(`기존 공지 ${moved}건을 일반공지로 이동`);

    /* ── ③ 화면에 보이는 순서 ─────────────────────────────────── */
    step = "add_sort_order";
    await db.execute(sql.raw(`
      ALTER TABLE notices ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0
    `));
    await db.execute(sql.raw(`
      CREATE INDEX IF NOT EXISTS notices_sort_order_idx ON notices (sort_order)
    `));
    /* 아직 순서를 안 정한 글에만 현재 표시 순서(고정글 먼저·최신 먼저)를 그대로 새겨 넣는다. */
    const ordered = rowsOf(await db.execute(sql.raw(`
      WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (
                 ORDER BY is_pinned DESC NULLS LAST,
                          COALESCE(published_at, created_at) DESC,
                          id DESC
               ) AS rn
          FROM notices
      )
      UPDATE notices n SET sort_order = r.rn
        FROM ranked r
       WHERE n.id = r.id AND n.sort_order = 0
      RETURNING n.id
    `))).length;
    done.push(`표시 순서 칸 준비${ordered ? ` (기존 ${ordered}건 순서 지정)` : ""}`);

    /* ── ④ 세 화면 위쪽 "꾸미는 말" ───────────────────────────── */
    step = "seed_intro_pages";
    await db.execute(sql.raw(`
      INSERT INTO site_pages (slug, title, eyebrow, subtitle, content_html, status, layout, sort_order)
      VALUES
        ('intro-activities', '활동 내용', 'OUR ACTIVITIES',
         '교사유가족협의회가 걸어온 길을 기록합니다.', '', 'published', 'default', 91),
        ('intro-notice', '공지사항', 'NOTICE',
         '협의회의 소식과 안내를 전해드립니다.', '', 'published', 'default', 92),
        ('intro-press', '언론보도', 'PRESS & GALLERY',
         '언론에 보도된 협의회의 활동과 현장의 기록입니다.', '', 'published', 'default', 93)
      ON CONFLICT (slug) DO NOTHING
    `));
    done.push("화면 위쪽 문구(인트로) 3건 준비");

    /* ── ⑤ 주요활동 하위 메뉴 주소 교체 ───────────────────────── */
    step = "relink_nav_menu";
    const children = rowsOf(await db.execute(sql.raw(`
      SELECT c.id, c.label, c.href, p.label AS parent_label
        FROM nav_menu_items c
        JOIN nav_menu_items p ON p.id = c.parent_id
       WHERE c.menu_location = 'header'
         AND p.label LIKE '%주요%활동%'
    `)));

    const relinked: Array<{ label: string; from: string | null; to: string }> = [];
    for (const child of children) {
      const target = MENU_TARGETS.find(t => t.match.test(String(child.label || "")));
      if (!target || child.href === target.href) continue;
      await db.execute(sql`
        UPDATE nav_menu_items
           SET href = ${target.href}, draft_href = NULL, has_draft = false, updated_at = NOW()
         WHERE id = ${Number(child.id)}
      `);
      relinked.push({ label: String(child.label), from: child.href ?? null, to: target.href });
    }
    done.push(relinked.length
      ? `주요활동 하위 메뉴 ${relinked.length}개 주소 교체`
      : "주요활동 하위 메뉴는 바꿀 것이 없었음 (메뉴 편집에서 직접 확인 필요)");

    step = "diag_after";
    const after = await diagnose();

    return new Response(jsonKST({
      ok: true, mode: "run", done, relinked, before, after,
      next: "메뉴 주소가 비어 있으면 백오피스 [메뉴 편집]에서 활동 내용=/activities.html, 공지사항=/notice.html, 언론보도=/press.html 로 직접 지정하세요.",
    }, null, 2), { headers: JSON_HEADER });
  } catch (err: any) {
    return new Response(jsonKST({
      ok: false, error: "마이그레이션 실패", step,
      detail: String(err?.message ?? err).slice(0, 500),
      stack: String(err?.stack ?? "").slice(0, 1000),
    }, null, 2), { status: 500, headers: JSON_HEADER });
  }
}
