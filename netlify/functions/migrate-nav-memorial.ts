import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-nav-memorial" };

/* 1회용: 상단(header) DB 메뉴에 ① 추모관(2뎁스) ② 소식/참여 하위 자유게시판 추가.
 * 상단 메뉴는 nav_menu_items 테이블 + /api/public/nav-menus 로 렌더되므로
 * 정적 header.html 편집만으론 반영 안 됨(정적은 API 실패 시 폴백). 멱등. */

function json(obj: any, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { "Content-Type": "application/json" },
  });
}
function rowsOf(r: any): any[] {
  return r?.rows ?? r ?? [];
}

export default async function handler(req: Request, _ctx: Context) {
  const url = new URL(req.url);
  if (!url.searchParams.has("run")) {
    return json({ ok: true, mode: "diagnostic", message: "?run=1 로 실행 (어드민 인증 필요)" });
  }
  const guard: any = await requireAdmin(req);
  if (!guard.ok) return (guard as { ok: false; res: Response }).res;

  try {
    const done: any = {};

    /* ① 추모관 1뎁스 + 2뎁스 (소식/참여 sort=4 와 후원 안내 sort=5 사이 → sort=5) */
    const ex = rowsOf(await db.execute(sql`
      SELECT id FROM nav_menu_items
      WHERE menu_location = 'header' AND parent_id IS NULL AND label = '추모관' LIMIT 1`));
    if (ex.length === 0) {
      /* 후원 안내(5)·마이페이지(6) 등 sort>=5 를 +1 시프트해 자리 확보 */
      await db.execute(sql`
        UPDATE nav_menu_items SET sort_order = sort_order + 1, updated_at = NOW()
        WHERE menu_location = 'header' AND parent_id IS NULL AND sort_order >= 5`);
      const ins = rowsOf(await db.execute(sql`
        INSERT INTO nav_menu_items (parent_id, menu_location, label, href, page_key, sort_order, is_active)
        VALUES (NULL, 'header', '추모관', '/memorial.html', 'memorial', 5, true)
        RETURNING id`));
      const parentId = ins[0].id;
      await db.execute(sql`
        INSERT INTO nav_menu_items (parent_id, menu_location, label, href, sort_order, is_active)
        VALUES
          (${parentId}, 'header', '🕯️ 온라인 추모관', '/memorial.html', 1, true),
          (${parentId}, 'header', '🕊️ 유가족 이야기', '/family-stories.html', 2, true)`);
      done.memorialInserted = true;
      done.parentId = parentId;
    } else {
      done.memorialInserted = false;
    }

    /* ② 소식/참여(news) 하위에 자유게시판 추가 */
    const news = rowsOf(await db.execute(sql`
      SELECT id FROM nav_menu_items
      WHERE menu_location = 'header' AND parent_id IS NULL
        AND (page_key = 'news' OR label = '소식 / 참여') LIMIT 1`));
    if (news.length) {
      const newsId = news[0].id;
      const hasBoard = rowsOf(await db.execute(sql`
        SELECT id FROM nav_menu_items WHERE parent_id = ${newsId} AND href = '/board.html' LIMIT 1`));
      if (hasBoard.length === 0) {
        await db.execute(sql`
          INSERT INTO nav_menu_items (parent_id, menu_location, label, href, sort_order, is_active)
          VALUES (${newsId}, 'header', '💬 자유게시판', '/board.html', 5, true)`);
        done.boardAddedToNews = true;
      } else {
        done.boardAddedToNews = false;
      }
    } else {
      done.newsNotFound = true;
    }

    return json({ ok: true, mode: "run", done });
  } catch (err: any) {
    return json({
      ok: false, error: "메뉴 마이그레이션 실패", step: "nav",
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }, 500);
  }
}
