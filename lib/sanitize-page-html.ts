/**
 * lib/sanitize-page-html.ts — 페이지 본문 HTML 정화 (허용 목록 방식)
 * 설계서: docs/active/2026-08-03-page-menu-redesign.md §5.4
 *
 * 편집기에서 저장된 HTML을 **저장 직전 서버에서** 거른다.
 * 편집 주체가 로그인한 관리자라 공격 위험 자체는 낮지만, 다음을 막는 게 목적이다.
 *   · 외부 문서에서 붙여넣을 때 딸려오는 스크립트·추적 코드
 *   · 화면 전체를 덮어버리는 위치 지정으로 사이트가 깨지는 사고
 *   · 관리자 계정이 탈취됐을 때의 피해 확대
 *
 * 방식: 새 패키지를 들이지 않고 허용 목록으로 직접 거른다.
 *   ① 위험 블록(스크립트·폼 등)은 내용까지 통째로 제거
 *   ② 허용 목록에 없는 태그는 태그만 벗기고 안쪽 글은 살린다(글이 사라지면 운영자가 당황한다)
 *   ③ 속성은 허용 목록만 통과. on클릭 류는 전부 제거, 주소는 스킴 검사
 *   ④ style은 허용된 꾸밈 속성만 남긴다
 *
 * 한계: 정규식 기반이라 악의적으로 조작된 입력에 완벽하지는 않다.
 *       외부 사용자가 쓰는 입력에는 쓰지 말 것. 관리자 편집 전용이다.
 */

/** 내용까지 통째로 지울 태그 (여는 태그~닫는 태그 전부) */
const STRIP_BLOCKS = [
  "script", "style", "form", "input", "textarea", "select", "option", "button",
  "object", "embed", "applet", "meta", "link", "base", "svg", "math", "noscript",
  "template", "frame", "frameset", "canvas",
];

/** 남길 태그 */
const ALLOWED_TAGS = new Set([
  "p", "br", "hr", "div", "span", "section", "article", "header", "footer", "aside",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "strong", "b", "em", "i", "u", "s", "strike", "del", "ins", "mark", "small", "sub", "sup",
  "ul", "ol", "li", "dl", "dt", "dd",
  "blockquote", "pre", "code",
  "a", "img", "figure", "figcaption",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col",
  "iframe",   // 아래 IFRAME_HOSTS 도메인만
]);

/** 모든 태그 공통 허용 속성 */
const COMMON_ATTRS = new Set(["class", "id", "style", "title", "dir", "lang"]);

/** 태그별 추가 허용 속성 */
const TAG_ATTRS: Record<string, string[]> = {
  a: ["href", "target", "rel", "download", "name"],
  img: ["src", "alt", "width", "height", "loading", "srcset", "sizes"],
  table: ["border", "cellpadding", "cellspacing", "width", "align", "summary"],
  th: ["colspan", "rowspan", "align", "valign", "width", "height", "scope"],
  td: ["colspan", "rowspan", "align", "valign", "width", "height"],
  tr: ["align", "valign"],
  col: ["span", "width"],
  colgroup: ["span", "width"],
  ol: ["start", "type", "reversed"],
  li: ["value"],
  iframe: ["src", "width", "height", "allow", "allowfullscreen", "frameborder", "loading", "referrerpolicy"],
};

/** 영상·지도 삽입을 허용할 도메인 — 이 목록 밖의 iframe은 통째로 제거 */
const IFRAME_HOSTS = [
  "www.youtube.com", "youtube.com", "www.youtube-nocookie.com", "youtube-nocookie.com",
  "player.vimeo.com", "vimeo.com",
  "www.google.com", "maps.google.com",
];

/** style에서 남길 꾸밈 속성. position·z-index처럼 화면을 덮을 수 있는 것은 뺐다. */
const ALLOWED_STYLE_PROPS = new Set([
  "color", "background", "background-color", "background-image", "background-size",
  "background-position", "background-repeat",
  "font-size", "font-weight", "font-style", "font-family", "font-variant",
  "text-align", "text-decoration", "text-indent", "text-transform", "text-shadow",
  "line-height", "letter-spacing", "word-spacing", "white-space", "word-break", "overflow-wrap",
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "width", "height", "max-width", "min-width", "max-height", "min-height",
  "border", "border-top", "border-right", "border-bottom", "border-left",
  "border-color", "border-width", "border-style", "border-radius", "border-collapse", "border-spacing",
  "display", "float", "clear", "vertical-align", "opacity", "box-shadow",
  "list-style", "list-style-type", "list-style-position",
  "flex", "flex-direction", "flex-wrap", "justify-content", "align-items", "align-self", "gap",
  "grid-template-columns", "grid-template-rows", "grid-column", "grid-row",
  "table-layout", "caption-side", "object-fit",
]);

/** style 값에서 걸러낼 패턴 (구형 브라우저 스크립트 실행·외부 리소스 끌어오기) */
const BLOCKED_STYLE_VALUE =
  /(?:expression|javascript:|vbscript:|behavior|@import|url\s*\(\s*['"]?\s*(?:javascript|vbscript|data:text))/i;

/**
 * 주소 스킴 검사 — 상대경로·http(s)·mailto·tel·앵커만 허용. data:는 이미지에만.
 * 공백·제어문자를 끼워 검사를 피하는 수법을 막으려 먼저 걷어낸다.
 */
function isSafeUrl(raw: string, allowDataImage = false): boolean {
  const v = String(raw || "").replace(/[\u0000-\u0020]/g, "");
  if (!v) return false;
  if (/^(?:https?:|mailto:|tel:)/i.test(v)) return true;
  if (/^[#/]/.test(v)) return true;                       // #앵커, /절대경로
  if (allowDataImage && /^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(v)) return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return false;       // 그 외 스킴(javascript: 등) 차단
  return true;                                            // 스킴 없는 상대경로
}

function sanitizeStyle(raw: string): string {
  const out: string[] = [];
  for (const decl of String(raw || "").split(";")) {
    const idx = decl.indexOf(":");
    if (idx < 0) continue;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    const value = decl.slice(idx + 1).trim();
    if (!prop || !value) continue;
    if (!ALLOWED_STYLE_PROPS.has(prop)) continue;
    if (BLOCKED_STYLE_VALUE.test(value)) continue;
    if (prop === "display" && /^none$/i.test(value)) continue;   // 숨김으로 덮어쓰기 방지
    out.push(prop + ": " + value);
  }
  return out.join("; ");
}

/** iframe src가 허용 도메인인지 */
function isAllowedIframe(src: string): boolean {
  try {
    const u = new URL(String(src), "https://tbfa.co.kr");
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    return IFRAME_HOSTS.includes(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** 태그의 속성을 훑어 허용된 것만 남긴다. null을 돌려주면 태그를 통째로 버린다. */
function sanitizeAttrs(tagName: string, attrText: string): string | null {
  const allowed = new Set([...COMMON_ATTRS, ...(TAG_ATTRS[tagName] || [])]);
  const kept: string[] = [];
  let iframeSrcOk = false;

  /* name="value" | name='value' | name=value | name */
  const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(attrText)) !== null) {
    const name = m[1].toLowerCase();
    const value = (m[2] ?? m[3] ?? m[4] ?? "").trim();

    if (name.startsWith("on")) continue;                  // 이벤트 핸들러 전면 차단
    if (name === "srcdoc" || name === "formaction") continue;

    const isData = name.startsWith("data-");               // 위젯·숏코드용으로 허용
    if (!allowed.has(name) && !isData) continue;

    if (name === "href") {
      if (!isSafeUrl(value)) continue;
    } else if (name === "src") {
      if (tagName === "iframe") {
        if (!isAllowedIframe(value)) return null;          // 허용 도메인 밖 → 태그 통째 제거
        iframeSrcOk = true;
      } else if (!isSafeUrl(value, tagName === "img")) {
        continue;
      }
    } else if (name === "style") {
      const s = sanitizeStyle(value);
      if (!s) continue;
      kept.push('style="' + s.replace(/"/g, "&quot;") + '"');
      continue;
    } else if (name === "target") {
      if (value === "_blank") {
        kept.push('target="_blank"', 'rel="noopener noreferrer"');
      } else {
        kept.push('target="_self"');
      }
      continue;
    } else if (name === "rel") {
      continue;                                            // target 처리에서 직접 붙인다
    }

    kept.push(value ? name + '="' + value.replace(/"/g, "&quot;") + '"' : name);
  }

  if (tagName === "iframe" && !iframeSrcOk) return null;    // src 없는 iframe은 무의미
  return kept.length ? " " + kept.join(" ") : "";
}

/**
 * 페이지 본문 HTML을 정화한다.
 * @param html 편집기가 만든 원본 HTML
 * @returns 저장해도 되는 HTML
 */
export function sanitizePageHtml(html: string): string {
  let s = String(html ?? "");
  if (!s.trim()) return "";

  /* ① 주석 제거 (조건부 주석에 스크립트를 숨기는 수법 차단) */
  s = s.replace(/<!--[\s\S]*?-->/g, "");

  /* ② 위험 블록은 내용까지 통째로 제거 */
  for (const tag of STRIP_BLOCKS) {
    s = s.replace(new RegExp("<" + tag + "\\b[^>]*>[\\s\\S]*?</" + tag + "\\s*>", "gi"), "");
    s = s.replace(new RegExp("</?" + tag + "\\b[^>]*/?>", "gi"), "");   // 닫는 태그 없는 단독형
  }

  /* ③ 남은 태그를 하나씩 검사 */
  s = s.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g,
    (_full: string, closing: string, rawName: string, attrText: string) => {
      const name = String(rawName).toLowerCase();
      if (!ALLOWED_TAGS.has(name)) return "";              // 태그만 제거, 안쪽 글은 남는다
      if (closing === "/") return "</" + name + ">";

      const attrs = sanitizeAttrs(name, attrText || "");
      if (attrs === null) return "";                       // 허용 안 되는 iframe 등
      return "<" + name + attrs + ">";
    });

  /* ④ 속성 밖으로 흘러든 위험 스킴 흔적 정리 */
  s = s.replace(/javascript\s*:/gi, "");
  s = s.replace(/vbscript\s*:/gi, "");

  return s.trim();
}

/** 본문에서 글자만 뽑는다 — 검색 설명 자동 생성·목록 미리보기에 쓴다. */
export function htmlToPlainText(html: string, maxLen = 300): string {
  const text = String(html || "")
    .replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)\s*>/gi, "")
    /* ★ 2026-09-03: 지도 자리표시("지도를 불러오는 중…")가 검색 결과 설명에 그대로
       나가던 문제 — 조직도 페이지의 검색 설명이 "오시는 길 지도를 불러오는 중…"으로
       노출됐다(광고그랜트 재심사 진단). 위젯 자리표시 글자는 설명에서 뺀다. */
    .replace(/<div\b[^>]*\bpw-map-fallback\b[^>]*>[\s\S]*?<\/div>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(?:p|div|h[1-6]|li|tr)>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLen ? text.slice(0, maxLen - 1) + "…" : text;
}
