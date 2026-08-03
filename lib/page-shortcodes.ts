/**
 * lib/page-shortcodes.ts — 페이지 본문의 특수 요소 자리표시 처리
 * 설계서: docs/active/2026-08-03-page-menu-redesign.md §4.3
 *
 * 지도·후원 버튼처럼 **글자만으로는 표현할 수 없는 것**을 본문에 넣기 위한 장치.
 * 편집기에서는 `{{map:서울시 강서구 공항대로 426}}` 같은 짧은 글로 저장되고,
 * 화면에 보여줄 때 이 파일이 실제 요소로 바꾼다.
 *
 * 왜 이렇게 하나: '오시는 길'에는 지도가 들어간다. 본문을 통짜 HTML로 옮기면
 * 지도를 띄우는 코드가 사라지므로, 자리만 표시해두고 화면에서 채우는 방식이 필요하다.
 *
 * 운영자는 문법을 외울 필요가 없다 — 편집 화면의 [지도 넣기] 버튼이 대신 넣어준다.
 *
 * ⚠️ 모르는 코드는 조용히 지운다. 근로계약 때 치환 안 된 `{{ }}`가 그대로 화면에 노출된
 *    사고가 있었다(2026-07-27). 다만 관리자 미리보기에서는 오타를 알 수 있게 표시한다.
 */

/** 본문에 넣을 수 있는 코드 목록 — 편집 화면 안내에도 그대로 쓴다 */
export const SHORTCODE_HELP: Array<{ code: string; label: string; desc: string }> = [
  { code: "{{map:주소}}", label: "지도", desc: "입력한 주소로 지도를 표시합니다. 예) {{map:서울시 강서구 공항대로 426}}" },
  { code: "{{donate}}", label: "후원 버튼", desc: "누르면 후원하기 창이 열립니다." },
  { code: "{{apply:support}}", label: "신청 버튼", desc: "누르면 유가족 지원 신청 창이 열립니다." },
  { code: "{{button:라벨|주소}}", label: "일반 버튼", desc: "원하는 곳으로 가는 버튼. 예) {{button:자료실 가기|/resources.html}}" },
  { code: "{{modal:창키|문구}}", label: "창 열기", desc: "후원·신청 외의 창을 엽니다. 예) {{modal:signupModal|회원가입 후 신청}}" },
];

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 링크 주소로 써도 되는지 — 자바스크립트 주소 등을 막는다 */
function safeHref(raw: string): string {
  const v = String(raw || "").trim();
  if (!v) return "#";
  if (/^(?:https?:\/\/|mailto:|tel:|[#/])/i.test(v)) return v;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return "#";   // 그 외 스킴 차단
  return "/" + v.replace(/^\/+/, "");
}

export interface ShortcodeOptions {
  /** 관리자 미리보기 — 모르는 코드를 지우지 않고 눈에 띄게 표시한다 */
  preview?: boolean;
}

/**
 * 본문 속 `{{...}}`를 실제 요소로 바꾼다.
 * 정화(sanitizePageHtml) **다음에** 부르는 것을 전제로 한다 — 여기서 만든 요소는 신뢰된 출력이다.
 */
export function renderShortcodes(html: string, opts: ShortcodeOptions = {}): string {
  let s = String(html ?? "");
  if (!s) return "";

  s = s.replace(/\{\{\s*([a-zA-Z_-]+)\s*(?::\s*([^}]*))?\}\}/g, (full, rawName: string, rawArg?: string) => {
    const name = String(rawName || "").toLowerCase();
    const arg = String(rawArg ?? "").trim();

    switch (name) {
      /* 지도 — 주소[|안내문]. 실제 지도는 화면에서 page-widgets.js가 띄운다. */
      case "map": {
        const [addr, info] = arg.split("|").map((v) => v.trim());
        if (!addr) return unknown(full, opts);
        return (
          `<div class="pw-map" data-address="${escapeHtml(addr)}"` +
          (info ? ` data-info="${escapeHtml(info)}"` : "") +
          `><div class="pw-map-fallback">지도를 불러오는 중…</div></div>`
        );
      }

      /* 후원하기 — 기존 후원 창을 연다 */
      case "donate":
        return `<p class="pw-btn-wrap"><button type="button" class="btn btn-primary pw-btn" ` +
          `data-action="open-modal" data-target="donateModal">후원하기</button></p>`;

      /* 신청 — 지금은 유가족 지원 신청 하나. 종류가 늘면 여기에 추가한다. */
      case "apply": {
        const kind = arg || "support";
        if (kind !== "support") return unknown(full, opts);
        return `<p class="pw-btn-wrap"><button type="button" class="btn btn-primary pw-btn" ` +
          `data-action="open-modal" data-target="supportModal">지원 신청하기</button></p>`;
      }

      /* 창 열기 — 창키|버튼문구. 후원·신청 외의 창(회원가입 등)에 쓴다. */
      case "modal": {
        const [key, label] = arg.split("|").map((v) => v.trim());
        if (!key || !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(key)) return unknown(full, opts);
        return `<p class="pw-btn-wrap"><button type="button" class="btn btn-primary pw-btn" ` +
          `data-action="open-modal" data-target="${escapeHtml(key)}">${escapeHtml(label || "자세히 보기")}</button></p>`;
      }

      /* 일반 버튼 — 라벨|주소 */
      case "button": {
        const [label, href] = arg.split("|").map((v) => v.trim());
        if (!label) return unknown(full, opts);
        return `<p class="pw-btn-wrap"><a class="btn btn-primary pw-btn" ` +
          `href="${escapeHtml(safeHref(href || "#"))}">${escapeHtml(label)}</a></p>`;
      }

      default:
        return unknown(full, opts);
    }
  });

  return s;
}

/** 모르는 코드 처리 — 공개 화면에서는 지우고, 미리보기에서는 알려준다 */
function unknown(full: string, opts: ShortcodeOptions): string {
  if (!opts.preview) return "";
  return `<span class="pw-unknown" title="사용할 수 없는 코드입니다">${escapeHtml(full)}</span>`;
}

/** 본문에 지도가 들어 있는지 — 지도 기능을 그때만 불러오려고 확인한다 */
export function hasMapWidget(html: string): boolean {
  return /\{\{\s*map\s*:/i.test(String(html || "")) || /class="pw-map"/.test(String(html || ""));
}
