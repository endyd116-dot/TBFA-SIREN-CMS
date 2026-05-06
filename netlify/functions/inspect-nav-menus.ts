// netlify/functions/inspect-nav-menus.ts
// ★ 1회용 진단 도구 — Phase B Step 5-A
// nav_menu_items / related_sites / site_publish_log 현황 조회
// 호출 후 즉시 파일 삭제할 것

import type { Context } from "@netlify/functions";
import { db } from "../../db/index.js";
import { sql } from "drizzle-orm";

// ★ 1회용 key — 호출 후 파일과 함께 삭제됨
const INSPECT_KEY = "siren-inspect-v10-temp";

export default async (req: Request, _context: Context) => {
  try {
    const url = new URL(req.url);
    const key = url.searchParams.get("key");

    if (key !== INSPECT_KEY) {
      return new Response(
        JSON.stringify({ ok: false, error: "forbidden" }),
        { status: 403, headers: { "content-type": "application/json" } }
      );
    }

    // -----------------------------------------------------------
    // 1. nav_menu_items 전체 조회
    // -----------------------------------------------------------
    const navResult: any = await db.execute(sql`
      SELECT 
        id, parent_id, menu_location, label, href, icon,
        sort_order, is_active, opens_modal, page_key, target, css_class,
        draft_label, draft_href, draft_sort_order, has_draft,
        created_at, updated_at
      FROM nav_menu_items
      ORDER BY menu_location, COALESCE(parent_id, 0), sort_order
    `);
    const navRows = Array.isArray(navResult) ? navResult : (navResult?.rows || []);

    // -----------------------------------------------------------
    // 2. 위치(location)별 + 부모-자식 트리 구조 정리
    // -----------------------------------------------------------
    const byLocation: Record<string, any[]> = {};
    const childrenMap: Record<number, any[]> = {};

    // 자식 먼저 분리
    for (const row of navRows) {
      if (row.parent_id) {
        if (!childrenMap[row.parent_id]) childrenMap[row.parent_id] = [];
        childrenMap[row.parent_id].push(row);
      }
    }

    // 부모에 자식 붙이기
    for (const row of navRows) {
      if (row.parent_id) continue;
      const loc = row.menu_location || "unknown";
      if (!byLocation[loc]) byLocation[loc] = [];
      byLocation[loc].push({
        ...row,
        children: childrenMap[row.id] || [],
      });
    }

    // -----------------------------------------------------------
    // 3. 텍스트 트리 (사람이 한눈에 보기 좋게)
    // -----------------------------------------------------------
    const textTree: Record<string, string[]> = {};
    for (const [loc, items] of Object.entries(byLocation)) {
      textTree[loc] = [];
      for (const parent of items) {
        const flag = parent.is_active ? "" : " [INACTIVE]";
        const draft = parent.has_draft ? " [DRAFT]" : "";
        const modal = parent.opens_modal ? ` [modal:${parent.opens_modal}]` : "";
        const css = parent.css_class ? ` [css:${parent.css_class}]` : "";
        textTree[loc].push(
          `├─ #${parent.id} ${parent.label} → ${parent.href || "(없음)"}${modal}${css}${flag}${draft}`
        );
        for (const child of parent.children) {
          const cflag = child.is_active ? "" : " [INACTIVE]";
          const cdraft = child.has_draft ? " [DRAFT]" : "";
          const cmodal = child.opens_modal ? ` [modal:${child.opens_modal}]` : "";
          const ccss = child.css_class ? ` [css:${child.css_class}]` : "";
          textTree[loc].push(
            `│   └─ #${child.id} ${child.label} → ${child.href || "(없음)"}${cmodal}${ccss}${cflag}${cdraft}`
          );
        }
      }
    }

    // -----------------------------------------------------------
    // 4. related_sites
    // -----------------------------------------------------------
    const relResult: any = await db.execute(sql`
      SELECT id, name, url, description, sort_order, is_active, created_at, updated_at
      FROM related_sites
      ORDER BY sort_order, id
    `);
    const relRows = Array.isArray(relResult) ? relResult : (relResult?.rows || []);

    // -----------------------------------------------------------
    // 5. site_publish_log (최근 5건)
    // -----------------------------------------------------------
    const logResult: any = await db.execute(sql`
      SELECT id, published_by, published_by_name, affected_settings, affected_menus, scopes, note, published_at
      FROM site_publish_log
      ORDER BY published_at DESC
      LIMIT 5
    `);
    const logRows = Array.isArray(logResult) ? logResult : (logResult?.rows || []);

    // -----------------------------------------------------------
    // 6. 요약 통계
    // -----------------------------------------------------------
    const summary = {
      navMenuItemsTotal: navRows.length,
      byLocationCount: Object.fromEntries(
        Object.entries(byLocation).map(([loc, items]) => [
          loc,
          {
            topLevel: items.length,
            totalIncludingChildren: items.reduce(
              (acc: number, i: any) => acc + 1 + (i.children?.length || 0),
              0
            ),
          },
        ])
      ),
      hasDraftCount: navRows.filter((r: any) => r.has_draft).length,
      activeCount: navRows.filter((r: any) => r.is_active).length,
      inactiveCount: navRows.filter((r: any) => !r.is_active).length,
      relatedSitesTotal: relRows.length,
      relatedSitesActive: relRows.filter((r: any) => r.is_active).length,
      publishLogTotal: logRows.length,
    };

    return new Response(
      JSON.stringify(
        {
          ok: true,
          summary,
          textTree,
          navTree: byLocation,
          relatedSites: relRows,
          recentPublishLog: logRows,
        },
        null,
        2
      ),
      {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: error.message,
        stack: error.stack,
      }, null, 2),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
};