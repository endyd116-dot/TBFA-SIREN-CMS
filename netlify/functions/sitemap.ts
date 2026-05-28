// netlify/functions/sitemap.ts
// R42 SEO — /sitemap.xml 동적 생성

import { buildSitemap } from "../../lib/sitemap-builder";

export const config = { path: "/sitemap.xml" };

export default async (req: Request) => {
  try {
    const url = new URL(req.url);
    const siteUrl = process.env.SITE_URL || `${url.protocol}//${url.host}`;
    const xml = await buildSitemap(siteUrl);
    return new Response(xml, {
      status: 200,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=3600, s-maxage=3600",
      },
    });
  } catch (e: any) {
    console.error("[sitemap]", e);
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>`,
      {
        status: 500,
        headers: { "Content-Type": "application/xml; charset=utf-8" },
      },
    );
  }
};
