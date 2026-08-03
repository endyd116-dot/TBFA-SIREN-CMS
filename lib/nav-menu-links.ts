/**
 * lib/nav-menu-links.ts — 메뉴가 무엇을 가리키는지 다루는 헬퍼
 * 설계서: docs/active/2026-08-03-page-menu-redesign.md §3.3
 *
 * 메뉴에 새로 붙는 세 가지(연결 유형·연결 페이지·임시저장)를 **직접 SQL로** 읽고 쓴다.
 *
 * 왜 일반적인 방식(스키마 정의)을 안 쓰나
 *   메뉴 조회가 테이블의 모든 칸을 한꺼번에 가져오는 방식이라, 저장소에 칸이 만들어지기 전에
 *   정의부터 추가하면 조회가 통째로 실패한다. 그러면 **사이트 상단 메뉴가 전부 사라진다**
 *   (CLAUDE.md §9.1.1). 그래서 새 칸만 따로 읽고, 아직 칸이 없으면 조용히 기본값으로 넘어간다.
 *   → 저장소 준비 전에 배포돼도 사이트는 멀쩡하고, 준비되는 순간 자동으로 동작한다.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";

export type MenuLinkType = "page" | "url" | "modal" | "divider" | "none";
export const VALID_LINK_TYPES: MenuLinkType[] = ["page", "url", "modal", "divider", "none"];

export interface MenuLinkInfo {
  id: number;
  linkType: MenuLinkType;
  sitePageId: number | null;
  draftSitePageId: number | null;
  pageSlug: string | null;
  pageTitle: string | null;
  pageStatus: string | null;
  pageHasDraft: boolean;
}

function rowsOf(result: any): any[] {
  if (!result) return [];
  return Array.isArray(result) ? result : (result.rows ?? []);
}

/** 저장소에 새 칸이 준비됐는지 — 한 번 확인하면 함수 인스턴스가 사는 동안 기억한다 */
let _ready: boolean | null = null;

export async function linkColumnsReady(): Promise<boolean> {
  if (_ready !== null) return _ready;
  try {
    const rows = rowsOf(await db.execute(sql`
      SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'nav_menu_items'
         AND column_name IN ('link_type', 'site_page_id', 'draft_site_page_id')
    `));
    _ready = rows.length === 3;
  } catch {
    _ready = false;
  }
  return _ready;
}

/** 메뉴들이 무엇을 가리키는지 한 번에 읽는다. 준비 전이면 빈 Map. */
export async function getMenuLinks(ids: number[]): Promise<Map<number, MenuLinkInfo>> {
  const map = new Map<number, MenuLinkInfo>();
  const uniq = Array.from(new Set(ids.filter((n) => Number.isFinite(n))));
  if (uniq.length === 0) return map;
  if (!(await linkColumnsReady())) return map;

  try {
    const rows = rowsOf(await db.execute(sql`
      SELECT n.id,
             n.link_type,
             n.site_page_id,
             n.draft_site_page_id,
             p.slug     AS page_slug,
             p.title    AS page_title,
             p.status   AS page_status,
             p.has_draft AS page_has_draft
        FROM nav_menu_items n
        LEFT JOIN site_pages p ON p.id = n.site_page_id
       WHERE n.id = ANY(${uniq})
    `));

    for (const r of rows) {
      map.set(Number(r.id), {
        id: Number(r.id),
        linkType: (r.link_type || "url") as MenuLinkType,
        sitePageId: r.site_page_id == null ? null : Number(r.site_page_id),
        draftSitePageId: r.draft_site_page_id == null ? null : Number(r.draft_site_page_id),
        pageSlug: r.page_slug ?? null,
        pageTitle: r.page_title ?? null,
        pageStatus: r.page_status ?? null,
        pageHasDraft: !!r.page_has_draft,
      });
    }
  } catch (e) {
    console.warn("[nav-menu-links.getMenuLinks]", e);
  }
  return map;
}

/** 트리(자식 포함)에서 모든 메뉴 id를 모은다 */
function collectIds(items: any[], out: number[] = []): number[] {
  for (const it of items || []) {
    if (it && Number.isFinite(it.id)) out.push(Number(it.id));
    if (it && it.children && it.children.length) collectIds(it.children, out);
  }
  return out;
}

export interface EnrichOptions {
  /** 관리자 화면 — 숨김 페이지를 가리키는 메뉴도 남기고 상태를 알려준다 */
  admin?: boolean;
}

/**
 * 메뉴 트리에 "무엇을 가리키는지"를 채워 넣는다.
 *
 * 핵심: 연결 유형이 '페이지'면 **주소를 자동으로 만든다**(`/p/{페이지주소}`).
 * 운영자가 주소를 직접 관리할 필요가 없어지고, 페이지 주소를 바꿔도 메뉴가 따라간다.
 *
 * 공개 화면에서는 숨김 페이지를 가리키는 메뉴를 아예 빼버린다 —
 * 눌렀는데 "페이지를 찾을 수 없습니다"가 뜨는 것보다 안 보이는 게 낫다.
 */
export async function enrichMenuLinks(items: any[], opts: EnrichOptions = {}): Promise<any[]> {
  if (!items || items.length === 0) return items || [];

  const links = await getMenuLinks(collectIds(items));
  if (links.size === 0) return items;   // 저장소 준비 전 — 기존 동작 그대로

  function walk(list: any[]): any[] {
    const out: any[] = [];
    for (const it of list) {
      const info = links.get(Number(it.id));
      const node: any = { ...it };

      if (info) {
        node.linkType = info.linkType;
        node.sitePageId = info.sitePageId;
        node.pageSlug = info.pageSlug;
        node.pageTitle = info.pageTitle;
        node.pageStatus = info.pageStatus;
        node.pageHasDraft = info.pageHasDraft;

        if (info.linkType === "page") {
          if (info.pageSlug) {
            node.href = `/p/${info.pageSlug}`;
          } else if (!opts.admin) {
            /* 페이지가 지워졌는데 메뉴만 남은 경우 — 공개 화면에서는 숨긴다 */
            continue;
          }
          if (!opts.admin && info.pageStatus && info.pageStatus !== "published") continue;
        }
        if (info.linkType === "divider") node.cssClass = "dropdown-divider";
      }

      if (it.children && it.children.length) node.children = walk(it.children);
      out.push(node);
    }
    return out;
  }

  return walk(items);
}

/** 메뉴가 가리키는 대상을 저장한다. 저장소 준비 전이면 아무것도 하지 않는다. */
export async function setMenuLink(
  id: number,
  link: { linkType?: string; sitePageId?: number | null; href?: string | null; opensModal?: string | null },
): Promise<{ ok: boolean; error?: string }> {
  if (!(await linkColumnsReady())) {
    return { ok: false, error: "저장소 준비(마이그레이션)가 아직 완료되지 않았습니다" };
  }

  const type = String(link.linkType || "url") as MenuLinkType;
  if (!VALID_LINK_TYPES.includes(type)) return { ok: false, error: "연결 방식이 올바르지 않습니다" };

  try {
    /* 유형에 맞지 않는 값은 같이 비운다 — 예전 값이 남아 링크가 엉키는 것을 막는다 */
    const pageId = type === "page" ? (link.sitePageId ?? null) : null;
    const href = type === "url" ? (link.href ?? null) : (type === "modal" ? "#" : null);
    const modal = type === "modal" ? (link.opensModal ?? null) : null;
    const cssClass = type === "divider" ? "dropdown-divider" : null;

    await db.execute(sql`
      UPDATE nav_menu_items
         SET link_type    = ${type},
             site_page_id = ${pageId},
             href         = ${href},
             opens_modal  = ${modal},
             css_class    = ${cssClass},
             updated_at   = NOW()
       WHERE id = ${id}
    `);
    return { ok: true };
  } catch (e: any) {
    console.error("[nav-menu-links.setMenuLink]", e);
    return { ok: false, error: "연결 정보를 저장하지 못했습니다" };
  }
}

/**
 * 드래그로 바꾼 순서·상위 관계를 한 번에 저장한다.
 * 화면에서 여러 개를 끌어 옮긴 뒤 한 번에 보내므로, 하나씩 저장하는 것보다 안전하고 빠르다.
 *
 * 상단 메뉴는 2단까지만 보이므로 3단 이상은 여기서 거른다(화면에서도 막지만 서버가 최종 방어).
 */
export async function applyMenuOrder(
  location: string,
  rows: Array<{ id: number; parentId: number | null; sortOrder: number }>,
): Promise<{ ok: boolean; count: number; error?: string }> {
  if (!rows || rows.length === 0) return { ok: true, count: 0 };

  /* 상위로 지정된 항목이 스스로 누군가의 자식이면 3단이 된다 → 거부 */
  const parentOf = new Map<number, number | null>();
  rows.forEach((r) => parentOf.set(Number(r.id), r.parentId == null ? null : Number(r.parentId)));
  for (const r of rows) {
    const p = parentOf.get(Number(r.id));
    if (p != null && parentOf.get(p) != null) {
      return { ok: false, count: 0, error: "메뉴는 2단까지만 만들 수 있습니다" };
    }
    if (p != null && p === Number(r.id)) {
      return { ok: false, count: 0, error: "메뉴를 자기 자신의 하위로 넣을 수 없습니다" };
    }
  }

  let count = 0;
  try {
    for (const r of rows) {
      await db.execute(sql`
        UPDATE nav_menu_items
           SET parent_id = ${r.parentId == null ? null : Number(r.parentId)},
               sort_order = ${Number(r.sortOrder) || 0},
               updated_at = NOW()
         WHERE id = ${Number(r.id)} AND menu_location = ${location}
      `);
      count++;
    }
    return { ok: true, count };
  } catch (e: any) {
    console.error("[nav-menu-links.applyMenuOrder]", e);
    return { ok: false, count, error: "순서를 저장하지 못했습니다" };
  }
}

/** 메뉴에 연결할 수 있는 페이지 목록 (메뉴 만들 때 고르는 용도) */
export async function listLinkablePages(): Promise<Array<{ id: number; title: string; slug: string; status: string }>> {
  try {
    const rows = rowsOf(await db.execute(sql`
      SELECT id, title, slug, status FROM site_pages ORDER BY sort_order ASC, id ASC
    `));
    return rows.map((r: any) => ({
      id: Number(r.id), title: r.title, slug: r.slug, status: r.status,
    }));
  } catch {
    return [];   // 저장소 준비 전
  }
}
