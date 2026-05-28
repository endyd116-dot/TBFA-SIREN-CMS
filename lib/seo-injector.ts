// lib/seo-injector.ts
// R42 SEO — </head> 직전에 og:* / twitter:* / canonical / title / description 메타 주입.
// 기존 동일 태그가 있으면 정규식으로 교체.

import type { PageMeta, OrgMeta, DefaultMeta } from "./seo-meta";

export interface InjectInput {
  page: PageMeta;
  org?: OrgMeta;
  defaults?: DefaultMeta;
  /** 절대 URL 기준 (예: https://tbfa.co.kr). canonical/og:url에 prefix로 사용. */
  siteUrl?: string;
  /** 현재 페이지 path (canonical 기본값). 예: /campaign.html?slug=abc */
  currentPath?: string;
}

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function abs(siteUrl: string | undefined, urlOrPath: string): string {
  if (!urlOrPath) return "";
  if (/^https?:\/\//i.test(urlOrPath)) return urlOrPath;
  if (!siteUrl) return urlOrPath;
  if (urlOrPath.startsWith("/")) return siteUrl.replace(/\/+$/, "") + urlOrPath;
  return siteUrl.replace(/\/+$/, "") + "/" + urlOrPath;
}

/**
 * </head> 직전에 SEO 메타 삽입.
 * 기존 태그 제거 후 새로 삽입.
 */
export function injectMeta(html: string, input: InjectInput): string {
  if (!html) return html;
  const { page, org, defaults, siteUrl } = input;

  const titleSuffix = defaults?.title_suffix || "";
  const finalTitle = page.title
    ? (titleSuffix && !page.title.includes(titleSuffix)
        ? `${page.title}${titleSuffix}`
        : page.title)
    : (defaults?.site_name || "");

  const description = page.description || "";
  const ogTitle = page.og_title || page.title || finalTitle;
  const ogDescription = page.og_description || page.description || "";
  const ogImage = abs(siteUrl, page.og_image_url || defaults?.default_og_image_url || "");
  const canonical = page.canonical
    ? abs(siteUrl, page.canonical)
    : (input.currentPath ? abs(siteUrl, input.currentPath) : "");
  const siteName = defaults?.site_name || org?.name || "";
  const locale = defaults?.locale || "ko_KR";

  // 1) 기존 <title>, <meta name="description">, <meta property="og:*">, <meta name="twitter:*">, <link rel="canonical"> 모두 제거
  let out = html;
  out = out.replace(/<title>[\s\S]*?<\/title>/gi, "");
  out = out.replace(/<meta\s+name=["']description["'][^>]*>\s*/gi, "");
  out = out.replace(/<meta\s+property=["']og:[^"']+["'][^>]*>\s*/gi, "");
  out = out.replace(/<meta\s+name=["']twitter:[^"']+["'][^>]*>\s*/gi, "");
  out = out.replace(/<link\s+rel=["']canonical["'][^>]*>\s*/gi, "");

  // 2) JSON-LD Organization (org가 있고 name이 있으면)
  let jsonLd = "";
  if (org && org.name) {
    const orgPayload: any = {
      "@context": "https://schema.org",
      "@type": "NGO",
      name: org.name,
    };
    if (org.legal_name) orgPayload.legalName = org.legal_name;
    if (org.url) orgPayload.url = org.url;
    if (org.logo_url) orgPayload.logo = abs(siteUrl, org.logo_url);
    if (org.email) orgPayload.email = org.email;
    if (org.phone) orgPayload.telephone = org.phone;
    if (org.address) orgPayload.address = { "@type": "PostalAddress", streetAddress: org.address };
    if (org.registration_no) orgPayload.taxID = org.registration_no;
    jsonLd = `<script type="application/ld+json">${JSON.stringify(orgPayload)}</script>\n`;
  }

  // 3) 메타 블록 빌드
  const lines: string[] = [];
  if (finalTitle) lines.push(`<title>${escapeHtml(finalTitle)}</title>`);
  if (description) lines.push(`<meta name="description" content="${escapeHtml(description)}">`);
  if (canonical) lines.push(`<link rel="canonical" href="${escapeHtml(canonical)}">`);

  // Open Graph
  lines.push(`<meta property="og:type" content="website">`);
  if (siteName) lines.push(`<meta property="og:site_name" content="${escapeHtml(siteName)}">`);
  if (locale) lines.push(`<meta property="og:locale" content="${escapeHtml(locale)}">`);
  if (ogTitle) lines.push(`<meta property="og:title" content="${escapeHtml(ogTitle)}">`);
  if (ogDescription) lines.push(`<meta property="og:description" content="${escapeHtml(ogDescription)}">`);
  if (canonical) lines.push(`<meta property="og:url" content="${escapeHtml(canonical)}">`);
  if (ogImage) lines.push(`<meta property="og:image" content="${escapeHtml(ogImage)}">`);

  // Twitter Card
  lines.push(`<meta name="twitter:card" content="${ogImage ? "summary_large_image" : "summary"}">`);
  if (ogTitle) lines.push(`<meta name="twitter:title" content="${escapeHtml(ogTitle)}">`);
  if (ogDescription) lines.push(`<meta name="twitter:description" content="${escapeHtml(ogDescription)}">`);
  if (ogImage) lines.push(`<meta name="twitter:image" content="${escapeHtml(ogImage)}">`);

  const block = `\n<!-- SEO (auto) -->\n${lines.join("\n")}\n${jsonLd}<!-- /SEO -->\n`;

  // 4) </head> 직전 삽입
  if (/<\/head>/i.test(out)) {
    return out.replace(/<\/head>/i, `${block}</head>`);
  }
  // </head>가 없으면 맨 앞에 삽입
  return block + out;
}
