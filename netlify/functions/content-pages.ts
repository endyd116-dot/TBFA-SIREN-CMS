// netlify/functions/content-pages.ts
// ★ M-11: 공개 콘텐츠 페이지 조회 (about.html 등에서 사용)

import { eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { contentPages } from "../../db/schema";
import {
  ok, badRequest, notFound, serverError,
  corsPreflight, methodNotAllowed,
} from "../../lib/response";

export const config = { path: "/api/content-pages" };

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  try {
    const url = new URL(req.url);
    const key = url.searchParams.get("key");
    const keys = url.searchParams.get("keys");  // 콤마 구분 다중

    /* 다중 키 (about_greeting_text,about_history,...) */
    if (keys) {
      const keyArr = keys.split(",").map((k) => k.trim()).filter(Boolean).slice(0, 20);
      if (keyArr.length === 0) return badRequest("keys 파라미터 필요");

      const list = await db.select({
        pageKey: contentPages.pageKey,
        title: contentPages.title,
        contentHtml: contentPages.contentHtml,
      }).from(contentPages).where(inArray(contentPages.pageKey, keyArr));

      const map: any = {};
      for (const item of list) {
        map[(item as any).pageKey] = {
          title: (item as any).title,
          contentHtml: (item as any).contentHtml,
        };
      }

      return ok({ pages: map });
    }

    /* 단일 키 */
    if (!key) return badRequest("key 파라미터 필요");

    const [item] = await db.select({
      pageKey: contentPages.pageKey,
      title: contentPages.title,
      contentHtml: contentPages.contentHtml,
    }).from(contentPages).where(eq(contentPages.pageKey, key)).limit(1);

    if (!item) return notFound("페이지를 찾을 수 없습니다");

    return ok({ page: item });
  } catch (e: any) {
    console.error("[content-pages]", e);
    return serverError("조회 실패", e);
  }
};