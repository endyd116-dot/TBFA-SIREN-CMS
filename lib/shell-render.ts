// lib/shell-render.ts
// ★ 2026-08-20 (구글 광고그랜트 심사 대응 B단계)
//
// 지금까지 상단 메뉴·단체 정보란은 "화면이 열린 뒤" 브라우저가 따로 받아와 채웠다.
// 그래서 검색엔진·심사기관이 읽는 페이지 원본에는 메뉴도 단체 정보도 없었고,
// 운영자가 어드민에서 고친 값은 그들에게 영영 전달되지 않았다.
//
// 이 모듈은 서버가 페이지를 내보내기 전에 그 자리를 미리 채워 넣는다.
// 브라우저 동작은 그대로 둔다 — 채워진 값과 같은 값을 다시 그리므로 화면 변화가 없다.
//
// 화면 조립 자체는 lib/shell-html.ts (저장소 조회 없음)가 담당하고,
// 여기서는 필요한 값을 조회해서 그쪽에 넘긴다.

import { getPublishedSettings, getNavMenus, getRelatedSites } from "./site-settings";
import { enrichMenuLinks } from "./nav-menu-links";
import {
  readPublicFile, renderNavItems, replaceGnb, applyFooterValues, fillSlot,
} from "./shell-html";

/* 쓰는 쪽이 한 곳만 보게 조립 도구도 그대로 내보낸다 */
export {
  readPublicFile, esc, renderNavItems, replaceGnb, applyFooterValues, fillSlot,
  injectPreload, revealHomePending, replaceById, applyStatValues, withTimeout,
} from "./shell-html";

import { withTimeout } from "./shell-html";

export interface ShellData {
  navItems: any[];
  footer: Record<string, any>;
  brand: Record<string, any>;
  relatedSites: any[];
}

/** 뼈대에 필요한 값을 한꺼번에 조회한다 */
export async function loadShellData(): Promise<ShellData> {
  const [navItems, footerSettings, brandSettings, relatedSites] = await Promise.all([
    withTimeout(getNavMenus("header", false).then(enrichMenuLinks), 2500, [] as any[]),
    withTimeout(getPublishedSettings("footer"), 2500, {} as any),
    withTimeout(getPublishedSettings("brand"), 2500, {} as any),
    withTimeout(getRelatedSites(true), 2500, [] as any[]),
  ]);
  return {
    navItems: (navItems as any[]) || [],
    footer: (footerSettings && (footerSettings as any).footer) || {},
    brand: (brandSettings && (brandSettings as any).brand) || {},
    relatedSites: (relatedSites as any[]) || [],
  };
}

/** 머리말·공용 창·꼬리말을 페이지 안에 넣고, 브라우저 재조회용 값도 함께 돌려준다 */
export function applyShell(html: string, data: ShellData): { html: string; preload: Record<string, any> } {
  let out = html;

  try {
    const headerPartial = readPublicFile("/partials/header.html");
    if (headerPartial) {
      out = fillSlot(out, "header-slot", replaceGnb(headerPartial, renderNavItems(data.navItems)));
    }
  } catch (e) { console.warn("[shell] 머리말 채우기 실패", e); }

  try {
    const modalsPartial = readPublicFile("/partials/modals.html");
    if (modalsPartial) out = fillSlot(out, "modals-slot", modalsPartial);
  } catch (e) { console.warn("[shell] 공용 창 채우기 실패", e); }

  try {
    const footerPartial = readPublicFile("/partials/footer.html");
    if (footerPartial) {
      out = fillSlot(out, "footer-slot", applyFooterValues(footerPartial, data.footer));
    }
  } catch (e) { console.warn("[shell] 꼬리말 채우기 실패", e); }

  const preload: Record<string, any> = {
    "/api/public/nav-menus": { ok: true, data: { location: "header", items: data.navItems, preview: false } },
    "/api/public/footer-content": { ok: true, data: { footer: data.footer, _meta: { mode: "published" } } },
    "/api/public/related-sites": { ok: true, data: { items: data.relatedSites } },
  };
  if (data.brand && Object.keys(data.brand).length) {
    preload["/api/public/brand"] = data.brand;
  }

  return { html: out, preload };
}
