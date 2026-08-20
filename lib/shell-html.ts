// lib/shell-html.ts
// ★ 2026-08-20: 페이지 뼈대를 문자열로 조립하는 부분만 모았다.
//   저장소 조회가 전혀 없어서 따로 떼어 검증하기 쉽다 (lib/shell-render.ts가 감싸서 쓴다).

import fs from "node:fs";
import path from "node:path";

/* ------------------------------------------------------------------ */
/* 파일 읽기 — 배포 환경마다 작업 폴더가 달라 후보 경로를 차례로 시도한다.      */
/* ------------------------------------------------------------------ */
const _fileCache = new Map<string, string | null>();

export function readPublicFile(rel: string): string | null {
  if (_fileCache.has(rel)) return _fileCache.get(rel)!;
  const fname = rel.replace(/^\//, "");
  const candidates = [
    path.join(process.cwd(), "public", fname),
    path.join(__dirname, "..", "public", fname),
    path.join(__dirname, "..", "..", "public", fname),
    path.join(__dirname, "..", "..", "..", "public", fname),
  ];
  let found: string | null = null;
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) { found = fs.readFileSync(p, "utf8"); break; }
    } catch { /* 다음 후보 */ }
  }
  _fileCache.set(rel, found);
  return found;
}

/* ------------------------------------------------------------------ */
/* 문자열 안전 처리                                                      */
/* ------------------------------------------------------------------ */
export function esc(v: any): string {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/* 페이지 안에 <script>로 심을 값 — </script> 조기 종료·주석 깨짐 방지 */
function safeJson(value: any): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e");
}

/* ------------------------------------------------------------------ */
/* 상단 메뉴 — public/js/common.js 의 그리기 규칙을 서버로 옮긴 것          */
/*   아이콘은 자리만 만들어 둔다(브라우저의 아이콘 모듈이 채운다).           */
/* ------------------------------------------------------------------ */
function iconSlot(value: any): string {
  const v = String(value == null ? "" : value).trim();
  if (!v) return "";
  return `<span class="siren-icon-wrap" data-icon="${esc(v)}"></span> `;
}

function linkAttrs(item: any): string {
  const opensModal = item.opensModal ?? item.opens_modal;
  if (opensModal) {
    return `href="#" data-action="open-modal" data-target="${esc(opensModal)}"`;
  }
  const target = item.target || "_self";
  const tgt = target === "_blank" ? ` target="_blank" rel="noopener"` : "";
  return `href="${esc(item.href || "#")}"${tgt}`;
}

function renderChildMenu(child: any): string {
  const cssClass = child.cssClass ?? child.css_class;
  if (cssClass === "dropdown-divider") return `<li class="dropdown-divider"></li>`;
  return `<li><a ${linkAttrs(child)}>${esc(child.label || "")}</a></li>`;
}

function renderTopLevelMenu(parent: any): string {
  const pageKey = parent.pageKey ?? parent.page_key;
  const cssClass = parent.cssClass ?? parent.css_class;
  const dataPageAttr = pageKey ? ` data-page="${esc(pageKey)}"` : "";
  const classAttr = cssClass ? ` class="${esc(cssClass)}"` : "";

  const children = (parent.children || []).slice().sort(
    (a: any, b: any) => (a.sortOrder ?? a.sort_order ?? 0) - (b.sortOrder ?? b.sort_order ?? 0)
  );
  const dropdown = children.length
    ? `<ul class="dropdown">${children.map(renderChildMenu).join("")}</ul>`
    : "";

  return `<li${dataPageAttr}${classAttr}>` +
         `<a ${linkAttrs(parent)}>${iconSlot(parent.icon)}${esc(parent.label || "")}</a>` +
         `${dropdown}</li>`;
}

export function renderNavItems(items: any[]): string {
  if (!Array.isArray(items) || items.length === 0) return "";
  const roots = items
    .filter((it) => (it.parentId ?? it.parent_id ?? null) == null)
    .sort((a, b) => (a.sortOrder ?? a.sort_order ?? 0) - (b.sortOrder ?? b.sort_order ?? 0));
  if (roots.length === 0) return "";
  return roots.map(renderTopLevelMenu).join("");
}

/* 메뉴 목록(<ul class="gnb" ...>…</ul>) 통째 교체 — 안쪽 목록 중첩을 세어 끝을 찾는다 */
export function replaceGnb(html: string, innerHtml: string): string {
  if (!innerHtml) return html;
  const openMatch = html.match(/<ul\b[^>]*\bclass="[^"]*\bgnb\b[^"]*"[^>]*>/);
  if (!openMatch || openMatch.index == null) return html;

  const start = openMatch.index;
  const afterOpen = start + openMatch[0].length;

  /* 여는 목록 / 닫는 목록을 세어 짝이 맞는 지점을 찾는다 */
  let depth = 1;
  let i = afterOpen;
  const re = /<ul\b[^>]*>|<\/ul>/gi;
  re.lastIndex = afterOpen;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[0][1] === "/") depth--; else depth++;
    if (depth === 0) { i = m.index + m[0].length; break; }
  }
  if (depth !== 0) return html;   /* 짝이 안 맞으면 건드리지 않는다 */

  /* data-gnb-pending(감춤 표시)은 서버가 이미 그렸으므로 뗀다 */
  const openTag = openMatch[0].replace(/\s*data-gnb-pending(?:="[^"]*")?/, "");
  return html.slice(0, start) + openTag + innerHtml + "</ul>" + html.slice(i);
}

/* ------------------------------------------------------------------ */
/* 단체 정보란 — data-footer="키" 자리에 어드민 저장값을 넣는다             */
/*   브라우저(common.js paintFooter)와 같은 규칙: 값이 있는 항목만 덮어쓴다   */
/* ------------------------------------------------------------------ */
export function applyFooterValues(html: string, footer: Record<string, any>): string {
  if (!footer || typeof footer !== "object") return html;

  let out = html.replace(
    /(<(\w+)\b[^>]*\bdata-footer="([^"]+)"[^>]*>)([\s\S]*?)(<\/\2>)/g,
    (whole, open: string, _tag: string, key: string, _inner: string, close: string) => {
      const v = footer[key];
      if (v == null || String(v).trim() === "") return whole;
      return open + esc(v) + close;
    }
  );

  /* 소셜 채널 — 실제 주소가 있을 때만 연결(미설정 '#'는 그대로) */
  out = out.replace(
    /<a\b([^>]*\bdata-footer-sns="([^"]+)"[^>]*)>/g,
    (whole: string, attrs: string, name: string) => {
      const v = footer["sns." + name];
      if (!v || String(v).trim() === "" || String(v) === "#") return whole;
      const next = attrs.replace(/\bhref="[^"]*"/, `href="${esc(v)}"`);
      return `<a ${next.trim()} target="_blank" rel="noopener noreferrer">`;
    }
  );

  return out;
}

/* ------------------------------------------------------------------ */
/* 빈 자리(슬롯)에 조각 끼워 넣기                                         */
/* ------------------------------------------------------------------ */
export function fillSlot(html: string, slotId: string, inner: string): string {
  if (!inner) return html;
  const re = new RegExp(`(<div\\b[^>]*\\bid="${slotId}"[^>]*>)\\s*(</div>)`);
  if (!re.test(html)) return html;
  return html.replace(re, (_m, open: string, close: string) => open + inner + close);
}

/* ------------------------------------------------------------------ */
/* 미리 받아 둔 값 심기 — 브라우저가 같은 주소를 다시 조회하지 않게 한다      */
/* ------------------------------------------------------------------ */
export function injectPreload(html: string, preload: Record<string, any>): string {
  const keys = Object.keys(preload || {});
  if (keys.length === 0) return html;

  const tag =
    `<script>window.__SIREN_PRELOAD__=${safeJson(preload)};` +
    `window.__SIREN_SSR__=1;</script>\n`;

  /* 공용 스크립트보다 먼저 심어야 첫 조회부터 쓰인다 */
  const anchor = html.match(/<script\b[^>]*src="\/js\/common\.js[^"]*"[^>]*><\/script>/);
  if (anchor && anchor.index != null) {
    return html.slice(0, anchor.index) + tag + html.slice(anchor.index);
  }
  if (html.includes("</head>")) return html.replace("</head>", tag + "</head>");
  return html.replace("<body", tag + "<body");
}

/* ------------------------------------------------------------------ */
/* 홈 화면 '불러오는 중' 자리 채우기                                       */
/* ------------------------------------------------------------------ */

/* 감춤 표시(data-home-pending)를 뗀다 — 서버가 이미 채웠으므로 */
export function revealHomePending(html: string): string {
  return html.replace(/\s*data-home-pending(?:="[^"]*")?/g, "");
}

/** 목록 자리를 통째로 교체한다. 못 찾으면 원본 그대로(안전). */
export function replaceById(html: string, id: string, inner: string): string {
  const re = new RegExp(`(<(\\w+)\\b[^>]*\\bid="${id}"[^>]*>)([\\s\\S]*?)(</\\2>)`);
  if (!re.test(html)) return html;
  return html.replace(re, (_m, open: string, _tag: string, _old: string, close: string) =>
    open + inner + close
  );
}

/** 실시간 활동 지표 — data-stat-key 자리에 실제 숫자를 넣는다 */
export function applyStatValues(html: string, stats: Record<string, any>): string {
  if (!stats) return html;
  return html.replace(
    /(<(\w+)\b[^>]*\bdata-stat-key="([^"]+)"[^>]*>)([\s\S]*?)(<\/\2>)/g,
    (whole, open: string, _tag: string, key: string, inner: string, close: string) => {
      const v = stats[key];
      if (v == null) return whole;
      const isNum = /class="[^"]*\bstat-num\b/.test(open);
      if (!isNum) return open + esc(v) + close;
      const suffixMatch = open.match(/data-suffix="([^"]*)"/);
      const suffix = suffixMatch ? suffixMatch[1] : "";
      const shown = typeof v === "number" ? v.toLocaleString("en-US") : esc(v);
      const nextOpen = open.replace(/data-target="[^"]*"/, `data-target="${esc(v)}"`);
      const keepSmall = suffix ? `<small>${esc(suffix)}</small>` : (inner.match(/<small>[\s\S]*?<\/small>/)?.[0] || "");
      return nextOpen + shown + keepSmall + close;
    }
  );
}


/** 조회가 늦어져도 페이지가 늦어지지 않도록 상한을 둔다 */
export function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; resolve(fallback); } }, ms);
    p.then((v) => { if (!done) { done = true; clearTimeout(t); resolve(v); } })
     .catch(() => { if (!done) { done = true; clearTimeout(t); resolve(fallback); } });
  });
}
