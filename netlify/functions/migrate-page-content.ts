/**
 * GET /api/migrate-page-content        — 진단 (인증 불필요·readonly)
 * GET /api/migrate-page-content?run=1  — 실행 (어드민 인증)
 *
 * 메뉴·페이지 통합 편집 개편 **7단계 — 기존 내용 옮기기**.
 * 설계서: docs/active/2026-08-03-page-menu-redesign.md §6
 *
 * 지금 코드 안에 박혀 있거나 조각으로 흩어져 있는 내용을 **편집 가능한 페이지 9개**로 옮긴다.
 *
 *   협의회 소개 3개 — 인사말(+우리의 약속) / 주요 연혁 / 조직도·오시는 길
 *   주요 활동  2개 — 유가족 지원사업 / 추모·장학사업   (각 끝에 신청 안내 붙임)
 *   하단 정책 4개 — 이용약관 / 개인정보처리방침 / 윤리경영 / 이메일 무단수집 거부
 *
 * 옮기고 나면 상단 메뉴가 이 페이지들을 가리키도록 연결까지 해준다.
 *
 * 원본이 어디에 있나
 *   · 협의회 소개 → 이미 저장소(content_pages)에 조각으로 들어 있다. 조각을 합쳐 한 페이지로 만든다.
 *   · 주요 활동·정책 → HTML 파일에 박혀 있다. 파일을 읽어 본문 부분만 떼어낸다.
 *
 * 안전장치
 *   · 같은 주소의 페이지가 이미 있으면 **건너뛴다**(덮어쓰지 않는다). 몇 번 호출해도 안전하다.
 *   · 옮긴 뒤에도 원래 파일은 그대로 둔다. 8단계에서 새 주소로 넘겨주는 처리를 한다.
 *   · 새 페이지는 **바로 공개**로 만든다 — 기존에 이미 공개돼 있던 내용이라 감출 이유가 없다.
 *
 * ⚠️ 먼저 /api/migrate-site-pages 를 실행해 저장소가 준비돼 있어야 한다.
 */
import fs from "node:fs";
import path from "node:path";
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { sanitizePageHtml } from "../../lib/sanitize-page-html";

export const config = { path: "/api/migrate-page-content" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

function rowsOf(result: any): any[] {
  if (!result) return [];
  return Array.isArray(result) ? result : (result.rows ?? []);
}

function readPublic(fileName: string): string | null {
  const candidates = [
    path.join(process.cwd(), "public", fileName),
    path.join(__dirname, "..", "..", "public", fileName),
    path.join(__dirname, "..", "..", "..", "public", fileName),
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return fs.readFileSync(p, "utf8"); } catch { /* 다음 후보 */ }
  }
  return null;
}

/** 약관류 4종의 본문 — `<article class="legal-doc">` 통째로 (스타일이 이 클래스에 걸려 있다) */
function extractLegal(html: string | null): string | null {
  if (!html) return null;
  const m = html.match(/<article class="legal-doc">([\s\S]*?)<\/article>/i);
  if (!m) return null;
  return `<article class="legal-doc">${m[1].trim()}</article>`;
}

/** id로 섹션 하나를 떼어낸다 (섹션 안에 또 섹션이 없다는 전제 — 실제 구조가 그렇다) */
function extractSection(html: string | null, id: string): string | null {
  if (!html) return null;
  const re = new RegExp(`<section[^>]*id="${id}"[^>]*>`, "i");
  const m = html.match(re);
  if (!m || m.index == null) return null;
  const from = m.index + m[0].length;
  const rest = html.slice(from);
  const end = rest.search(/<\/section>/i);
  if (end < 0) return null;
  return rest.slice(0, end).trim();
}

/** id 없는 섹션을 앞뒤 주석으로 찾아낸다 (support.html의 '신청 안내') */
function extractSectionAfterComment(html: string | null, comment: string): string | null {
  if (!html) return null;
  const at = html.indexOf(`<!-- ${comment} -->`);
  if (at < 0) return null;
  const rest = html.slice(at);
  const open = rest.match(/<section[^>]*>/i);
  if (!open || open.index == null) return null;
  const from = open.index + open[0].length;
  const body = rest.slice(from);
  const end = body.search(/<\/section>/i);
  if (end < 0) return null;
  return body.slice(0, end).trim();
}

/**
 * 옮기기 전에 손봐야 하는 것들.
 *  · 창을 여는 버튼은 정화 과정에서 사라지므로 자리표시 문법으로 바꾼다
 *  · 이관 뒤에는 페이지가 자체 제목을 갖게 되므로, 본문 안 중복 제목(eyebrow·h2)을 뺀다
 */
function cleanForPage(html: string, opts: { dropHeading?: boolean } = {}): string {
  let s = html;

  /* 창 열기 버튼 → 자리표시 문법 (정화가 button을 지우기 때문) */
  s = s.replace(/<button[^>]*data-target=["']supportModal["'][^>]*>[\s\S]*?<\/button>/gi, "{{apply:support}}");
  s = s.replace(/<button[^>]*data-target=["']donateModal["'][^>]*>[\s\S]*?<\/button>/gi, "{{donate}}");
  s = s.replace(/<button[^>]*data-target=["']signupModal["'][^>]*>([\s\S]*?)<\/button>/gi,
    (_m, inner) => `{{modal:signupModal|${String(inner).replace(/<[^>]+>/g, "").trim() || "회원가입 후 신청"}}}`);

  if (opts.dropHeading) {
    s = s.replace(/<div class="sec-eyebrow"[^>]*>[\s\S]*?<\/div>/i, "");
    s = s.replace(/<h2 class="sec-title"[^>]*>[\s\S]*?<\/h2>/i, "");
  }

  return s.trim();
}

/* =========================================================
   협의회 소개 — 저장소에 흩어진 조각을 합친다
   ========================================================= */
async function getContentPieces(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  try {
    const rows = rowsOf(await db.execute(sql`
      SELECT page_key, content_html FROM content_pages WHERE page_key LIKE 'about_%'
    `));
    for (const r of rows) out[String(r.page_key)] = String(r.content_html || "");
  } catch (e) {
    console.warn("[migrate-page-content] 소개 조각 조회 실패", e);
  }
  return out;
}

function buildGreeting(p: Record<string, string>): string {
  const cards = [1, 2, 3]
    .map((n) => p[`about_vision_card_${n}`])
    .filter((v) => v && v.trim());

  return [
    p["about_greeting_text"] || "",
    p["about_greeting_sign"] ? `<div class="greeting-sign">${p["about_greeting_sign"]}</div>` : "",
    cards.length
      ? `<h2>우리의 약속</h2><div class="principle-grid">` +
        cards.map((c) => `<div class="principle-card">${c}</div>`).join("") +
        `</div>`
      : "",
  ].filter(Boolean).join("\n");
}

function buildOrganization(p: Record<string, string>): string {
  return [
    p["about_org"] ? `<h2>조직 구성</h2>${p["about_org"]}` : "",
    `<h2>오시는 길</h2>`,
    `{{map:서울특별시 강서구 공항대로 426|(사)교사유가족협의회<br>공항대로 426 VIP오피스텔 618호}}`,
    p["about_location"] || "",
  ].filter(Boolean).join("\n");
}

/* =========================================================
   옮길 페이지 목록
   ========================================================= */
interface PagePlan {
  slug: string;
  title: string;
  eyebrow: string | null;
  subtitle: string | null;
  layout: "default" | "wide" | "plain";
  /** 이 주소를 가리키던 메뉴를 새 페이지 연결로 바꾼다 */
  oldHrefs: string[];
  /**
   * 이 페이지를 가리키는 메뉴가 **하나도 없을 때** 새로 만들어 준다.
   * 실제 저장소를 확인해 보니 '주요 연혁'·'조직도' 메뉴가 아예 없었다
   * (정적 헤더 파일에만 있고 저장소에는 '인사말' 하나뿐).
   * 그대로 두면 페이지는 만들어지는데 들어갈 길이 없다.
   */
  fallbackMenu?: { location: string; parentHref: string | null; label: string };
  build: () => string | null;
}

async function buildPlans(): Promise<PagePlan[]> {
  const pieces = await getContentPieces();
  const support = readPublic("support.html");
  const applyGuide = extractSectionAfterComment(support, "신청 안내");
  const applyBlock = applyGuide ? cleanForPage(applyGuide) : "";

  return [
    {
      slug: "greeting", title: "인사말", eyebrow: "GREETING",
      subtitle: "존엄한 기억, 투명한 동행 — 교사유가족협의회가 함께합니다",
      layout: "default",
      /* 상위 '단체소개'(/about.html)는 건드리지 않는다 — 하위 '인사말'과 중복되고,
         옛 주소 넘기기(2차)로 어차피 이 페이지에 도착한다 */
      oldHrefs: ["/about.html#greeting"],
      fallbackMenu: { location: "header", parentHref: "/about.html", label: "인사말" },
      build: () => buildGreeting(pieces) || null,
    },
    {
      slug: "history", title: "주요 연혁", eyebrow: "HISTORY",
      subtitle: null, layout: "default",
      oldHrefs: ["/about.html#history"],
      fallbackMenu: { location: "header", parentHref: "/about.html", label: "주요 연혁" },
      build: () => (pieces["about_history"] ? `<div class="history-line">${pieces["about_history"]}</div>` : null),
    },
    {
      slug: "organization", title: "조직도 · 오시는 길", eyebrow: "ORGANIZATION",
      subtitle: null, layout: "default",
      oldHrefs: ["/about.html#org"],
      fallbackMenu: { location: "header", parentHref: "/about.html", label: "조직도 · 오시는 길" },
      build: () => buildOrganization(pieces) || null,
    },
    {
      slug: "family-support", title: "유가족 지원사업", eyebrow: "SUPPORT",
      subtitle: "심리 상담·법률 자문·장학 사업으로 함께합니다",
      layout: "default",
      /* 상위 '주요 사업'(/support.html)은 건드리지 않는다 — 위와 같은 이유 */
      oldHrefs: ["/support.html#family"],
      build: () => {
        const sec = extractSection(support, "family");
        if (!sec) return null;
        return [cleanForPage(sec, { dropHeading: true }), applyBlock].filter(Boolean).join("\n");
      },
    },
    {
      slug: "memorial-scholarship", title: "추모 · 장학사업", eyebrow: "MEMORIAL",
      subtitle: null, layout: "default",
      oldHrefs: ["/support.html#memorial"],
      build: () => {
        const sec = extractSection(support, "memorial");
        if (!sec) return null;
        return [cleanForPage(sec, { dropHeading: true }), applyBlock].filter(Boolean).join("\n");
      },
    },
    {
      slug: "terms", title: "이용약관", eyebrow: "TERMS",
      subtitle: null, layout: "plain",
      oldHrefs: ["/terms.html"],
      build: () => extractLegal(readPublic("terms.html")),
    },
    {
      slug: "privacy", title: "개인정보처리방침", eyebrow: "PRIVACY",
      subtitle: null, layout: "plain",
      oldHrefs: ["/privacy.html"],
      build: () => extractLegal(readPublic("privacy.html")),
    },
    {
      slug: "ethics", title: "윤리경영", eyebrow: "ETHICS",
      subtitle: null, layout: "plain",
      oldHrefs: ["/ethics.html"],
      build: () => extractLegal(readPublic("ethics.html")),
    },
    {
      slug: "email-reject", title: "이메일 무단수집 거부", eyebrow: "EMAIL",
      subtitle: null, layout: "plain",
      oldHrefs: ["/email-reject.html"],
      build: () => extractLegal(readPublic("email-reject.html")),
    },
  ];
}

/* =========================================================
   진단
   ========================================================= */
async function diagnose() {
  let ready = false;
  try {
    const cols = rowsOf(await db.execute(sql`
      SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='nav_menu_items'
         AND column_name IN ('link_type','site_page_id')
    `));
    const tbl = rowsOf(await db.execute(sql`
      SELECT table_name FROM information_schema.tables
       WHERE table_schema='public' AND table_name='site_pages'
    `));
    ready = cols.length === 2 && tbl.length === 1;
  } catch { ready = false; }

  const plans = await buildPlans();
  const preview = plans.map((p) => {
    let len = 0, err: string | null = null;
    try {
      const body = p.build();
      len = body ? sanitizePageHtml(body).length : 0;
      if (!body) err = "원본을 찾지 못했습니다";
    } catch (e: any) { err = String(e?.message || e).slice(0, 120); }
    return { slug: p.slug, title: p.title, contentLength: len, problem: err };
  });

  let existing: string[] = [];
  if (ready) {
    try {
      existing = rowsOf(await db.execute(sql`SELECT slug FROM site_pages`)).map((r: any) => String(r.slug));
    } catch { /* 무시 */ }
  }

  return { storage_ready: ready, planned: preview, existing_slugs: existing };
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
        hint: before.storage_ready
          ? "?run=1 로 실행하면 9개 페이지를 만들고 상단 메뉴를 연결합니다. 이미 있는 주소는 건너뜁니다."
          : "먼저 /api/migrate-site-pages?run=1 을 실행해 저장소를 준비해 주세요.",
      }, null, 2), { headers: JSON_HEADER });
    }

    step = "auth";
    const auth = await requireAdmin(req);
    if (guardFailed(auth)) return auth.res;

    if (!before.storage_ready) {
      return new Response(jsonKST({
        ok: false, error: "저장소가 아직 준비되지 않았습니다",
        hint: "먼저 /api/migrate-site-pages?run=1 을 실행하세요.",
      }), { status: 400, headers: JSON_HEADER });
    }

    step = "create_pages";
    const plans = await buildPlans();
    const results: any[] = [];

    for (let i = 0; i < plans.length; i++) {
      const p = plans[i];

      /* 이미 있으면 건너뛴다 — 덮어쓰면 운영자가 고친 내용이 날아간다 */
      const dup = rowsOf(await db.execute(sql`SELECT id FROM site_pages WHERE slug = ${p.slug} LIMIT 1`));
      if (dup.length > 0) {
        results.push({ slug: p.slug, status: "이미 있어 건너뜀", pageId: Number(dup[0].id) });
        continue;
      }

      let body: string | null = null;
      try { body = p.build(); } catch (e: any) {
        results.push({ slug: p.slug, status: "실패", error: String(e?.message || e).slice(0, 200) });
        continue;
      }
      if (!body || !body.trim()) {
        results.push({ slug: p.slug, status: "원본을 찾지 못해 건너뜀" });
        continue;
      }

      const clean = sanitizePageHtml(body);
      const inserted = rowsOf(await db.execute(sql`
        INSERT INTO site_pages (slug, title, eyebrow, subtitle, content_html, status, layout, sort_order, updated_by)
        VALUES (${p.slug}, ${p.title}, ${p.eyebrow}, ${p.subtitle}, ${clean},
                'published', ${p.layout}, ${(i + 1) * 10}, ${auth.ctx.admin.uid})
        RETURNING id
      `));
      const pageId = Number(inserted[0]?.id);
      results.push({ slug: p.slug, status: "만듦", pageId, contentLength: clean.length });
    }

    /* 상단 메뉴가 새 페이지를 가리키도록 연결 */
    step = "link_menus";
    const linked: any[] = [];
    const createdMenus: any[] = [];

    for (const p of plans) {
      const page = rowsOf(await db.execute(sql`SELECT id FROM site_pages WHERE slug = ${p.slug} LIMIT 1`));
      if (page.length === 0) continue;
      const pageId = Number(page[0].id);

      for (const href of p.oldHrefs) {
        const upd = rowsOf(await db.execute(sql`
          UPDATE nav_menu_items
             SET link_type = 'page', site_page_id = ${pageId}, href = ${"/p/" + p.slug},
                 draft_href = NULL, updated_at = NOW()
           WHERE (href = ${href} OR draft_href = ${href})
             AND (site_page_id IS NULL OR site_page_id <> ${pageId})
          RETURNING id, label
        `));
        upd.forEach((r: any) => linked.push({ menuId: Number(r.id), label: r.label, from: href, to: `/p/${p.slug}` }));
      }

      /* 이 페이지를 가리키는 메뉴가 하나도 없으면 새로 만든다.
         (실제 저장소에 '주요 연혁'·'조직도' 메뉴가 없어서 그냥 두면 들어갈 길이 없다) */
      if (!p.fallbackMenu) continue;
      const already = rowsOf(await db.execute(sql`
        SELECT id FROM nav_menu_items WHERE site_page_id = ${pageId} LIMIT 1
      `));
      if (already.length > 0) continue;

      let parentId: number | null = null;
      if (p.fallbackMenu.parentHref) {
        const parent = rowsOf(await db.execute(sql`
          SELECT id FROM nav_menu_items
           WHERE menu_location = ${p.fallbackMenu.location}
             AND href = ${p.fallbackMenu.parentHref}
             AND parent_id IS NULL
           ORDER BY sort_order ASC LIMIT 1
        `));
        if (parent.length > 0) parentId = Number(parent[0].id);
      }

      /* 형제 메뉴들 뒤에 붙인다 */
      const maxRow = rowsOf(await db.execute(sql`
        SELECT COALESCE(MAX(sort_order), 0) AS m FROM nav_menu_items
         WHERE menu_location = ${p.fallbackMenu.location}
           AND parent_id IS NOT DISTINCT FROM ${parentId}
      `));
      const nextOrder = Number(maxRow[0]?.m || 0) + 10;

      const ins = rowsOf(await db.execute(sql`
        INSERT INTO nav_menu_items
          (parent_id, menu_location, label, href, sort_order, is_active, target, link_type, site_page_id)
        VALUES
          (${parentId}, ${p.fallbackMenu.location}, ${p.fallbackMenu.label}, ${"/p/" + p.slug},
           ${nextOrder}, true, '_self', 'page', ${pageId})
        RETURNING id
      `));
      createdMenus.push({
        menuId: Number(ins[0]?.id), label: p.fallbackMenu.label,
        parentId, to: `/p/${p.slug}`,
      });
    }

    step = "verify";
    const after = await diagnose();

    return new Response(jsonKST({
      ok: true, mode: "executed",
      pages: results,
      menus_linked: linked,
      menus_created: createdMenus,
      after,
      next: [
        "1) 메인 화면 편집 → 페이지 관리에서 9개 페이지 내용 확인 (사진·표·지도가 제대로 들어갔는지)",
        "2) 상단 메뉴 관리에서 연결이 '페이지'로 바뀌었는지 확인",
        "3) /p/greeting 등 새 주소로 실제 화면 확인",
        "4) 확인되면 메인에게 알림 → 옛 주소 넘기기(리다이렉트) 반영 + 이 파일 삭제",
      ],
    }, null, 2), { headers: JSON_HEADER });
  } catch (err: any) {
    return new Response(jsonKST({
      ok: false, error: "이관 실패", step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: JSON_HEADER });
  }
}
