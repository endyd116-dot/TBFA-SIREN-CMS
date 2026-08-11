/**
 * GET /api/migrate-news-menu        — 진단 (인증 불필요·읽기만)
 * GET /api/migrate-news-menu?run=1  — 실행 (어드민 인증)
 *
 * 주요활동 메뉴 마무리.
 *
 *  ① 주요 활동 밑에 '공지사항' 메뉴가 없어서 새 공지 화면으로 갈 길이 없다 → 만들어 넣는다.
 *  ② 앞서 주소를 바꾼 '활동 보고'·'언론 보도'가 혹시 '페이지 연결' 방식으로 잡혀 있으면
 *     적어둔 주소를 무시하고 엉뚱한 곳으로 간다 → '주소 직접 입력' 방식으로 확정한다.
 *
 * 멱등: 이미 있으면 건너뛴다. 여러 번 호출해도 안전.
 * 호출 성공 후 이 파일 삭제 + commit.
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-news-menu" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

function rowsOf(result: any): any[] {
  if (!result) return [];
  return Array.isArray(result) ? result : (result.rows ?? []);
}

/** 주소를 직접 적어 쓰는 메뉴들 — 여기 적힌 주소가 그대로 쓰이도록 확정한다 */
const FORCE_URL = ["/activities.html", "/notice.html", "/press.html"];

async function hasLinkTypeColumn() {
  return rowsOf(await db.execute(sql.raw(`
    SELECT column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name='nav_menu_items' AND column_name='link_type'
  `))).length > 0;
}

async function diagnose() {
  const sub = rowsOf(await db.execute(sql.raw(`
    SELECT c.id, c.label, c.href, c.sort_order, c.is_active
      FROM nav_menu_items c
      JOIN nav_menu_items p ON p.id = c.parent_id
     WHERE c.menu_location = 'header' AND p.label LIKE '%주요%활동%'
     ORDER BY c.sort_order
  `)));

  const linkTypes = (await hasLinkTypeColumn())
    ? rowsOf(await db.execute(sql.raw(`
        SELECT id, label, href, link_type, site_page_id
          FROM nav_menu_items
         WHERE menu_location='header' AND href IN ('/activities.html','/notice.html','/press.html')
      `)))
    : null;

  return {
    activity_submenu: sub,
    has_notice_menu: sub.some((r: any) => String(r.href || "") === "/notice.html"),
    link_types: linkTypes,
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
        hint: before.has_notice_menu ? "이미 적용됨. 재실행해도 안전." : "?run=1 로 실행하세요 (관리자 로그인 상태).",
      }, null, 2), { headers: JSON_HEADER });
    }

    step = "auth";
    const auth = await requireAdmin(req);
    if (guardFailed(auth)) return auth.res;

    const done: string[] = [];

    /* ── ① 공지사항 메뉴 만들어 넣기 ─────────────────────────── */
    step = "find_parent";
    const parent = rowsOf(await db.execute(sql.raw(`
      SELECT id FROM nav_menu_items
       WHERE menu_location='header' AND parent_id IS NULL AND label LIKE '%주요%활동%'
       ORDER BY sort_order LIMIT 1
    `)))[0];

    if (!parent) {
      done.push("'주요 활동' 상위 메뉴를 찾지 못해 공지사항 메뉴를 만들지 못했습니다");
    } else {
      step = "insert_notice_menu";
      const exists = rowsOf(await db.execute(sql`
        SELECT id FROM nav_menu_items
         WHERE menu_location='header' AND parent_id = ${Number(parent.id)}
           AND (href = '/notice.html' OR label LIKE '%공지%')
         LIMIT 1
      `))[0];

      if (exists) {
        /* 이름만 있고 주소가 비어 있던 경우까지 여기서 맞춰 준다 */
        await db.execute(sql`
          UPDATE nav_menu_items
             SET href = '/notice.html', draft_href = NULL, has_draft = false,
                 is_active = true, updated_at = NOW()
           WHERE id = ${Number(exists.id)}
        `);
        done.push("이미 있던 공지 메뉴의 주소를 공지사항 화면으로 맞춤");
      } else {
        /* '활동 보고'(10) 와 '언론 보도'(20) 사이에 놓는다 */
        await db.execute(sql`
          INSERT INTO nav_menu_items (parent_id, menu_location, label, href, sort_order, is_active, target)
          VALUES (${Number(parent.id)}, 'header', '공지사항', '/notice.html', 15, true, '_self')
        `);
        done.push("주요 활동 밑에 '공지사항' 메뉴 추가");
      }
    }

    /* ── ② 주소 직접 입력 방식으로 확정 ──────────────────────── */
    step = "force_url_type";
    if (await hasLinkTypeColumn()) {
      const fixed = rowsOf(await db.execute(sql`
        UPDATE nav_menu_items
           SET link_type = 'url', site_page_id = NULL, draft_site_page_id = NULL, updated_at = NOW()
         WHERE menu_location = 'header'
           AND href IN (${sql.join(FORCE_URL.map(h => sql`${h}`), sql`, `)})
           AND COALESCE(link_type, 'url') <> 'url'
        RETURNING id, label
      `));
      done.push(fixed.length
        ? `메뉴 ${fixed.length}개를 '주소 직접 입력' 방식으로 확정`
        : "메뉴 연결 방식은 이미 '주소 직접 입력'이었음");
    } else {
      done.push("메뉴 연결 방식 칸이 없어 확인을 건너뜀 (문제 없음)");
    }

    step = "diag_after";
    const after = await diagnose();

    return new Response(jsonKST({ ok: true, mode: "run", done, before, after }, null, 2), { headers: JSON_HEADER });
  } catch (err: any) {
    return new Response(jsonKST({
      ok: false, error: "마이그레이션 실패", step,
      detail: String(err?.message ?? err).slice(0, 500),
      stack: String(err?.stack ?? "").slice(0, 1000),
    }, null, 2), { status: 500, headers: JSON_HEADER });
  }
}
