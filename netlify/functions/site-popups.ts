import { db } from "../../db";
import { sitePopups } from "../../db/schema";
import { and, eq, or, isNull, lte, gte } from "drizzle-orm";
import { ok, serverError, corsPreflight, methodNotAllowed } from "../../lib/response";
import { sql } from "drizzle-orm";

export const config = { path: "/api/site-popups" };

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  try {
    const url = new URL(req.url);
    const page = url.searchParams.get("page") || "*";
    const now = new Date();

    const rows = await db
      .select({
        id: sitePopups.id,
        title: sitePopups.title,
        content: sitePopups.content,
        imageUrl: sitePopups.imageUrl,
        linkUrl: sitePopups.linkUrl,
        targetPages: sitePopups.targetPages,
        displayFrequency: sitePopups.displayFrequency,
        startAt: sitePopups.startAt,
        endAt: sitePopups.endAt,
      })
      .from(sitePopups)
      .where(
        and(
          eq(sitePopups.isActive, true),
          or(isNull(sitePopups.startAt), lte(sitePopups.startAt, now)),
          or(isNull(sitePopups.endAt), gte(sitePopups.endAt, now)),
        )
      );

    // 페이지 필터 — targetPages에 '*' 또는 요청 페이지가 포함된 것만
    const filtered = rows.filter((r) => {
      const targets = (r.targetPages as string[]) ?? ["*"];
      return targets.includes("*") || targets.includes(page);
    });

    const popups = filtered.map((r) => ({
      id: r.id,
      title: r.title,
      content: r.content,
      imageUrl: r.imageUrl,
      linkUrl: r.linkUrl,
      displayFrequency: r.displayFrequency,
    }));

    return ok({ popups });
  } catch (err) {
    console.error("[site-popups]", err);
    return serverError("팝업 조회 중 오류가 발생했습니다", err);
  }
};
