// netlify/functions/public-disclosures.ts — 재정 공개 (2026-11-06)
//
// GET /api/public/disclosures   공개한 연도별 재정 자료. 공개 순간의 숫자로 고정돼 있다.
// 정관 제35조②: 매년 4월 안에 홈페이지에 공개한다. 개인정보는 들어 있지 않다.
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { corsPreflight, methodNotAllowed, ok, serverError } from "../../lib/response";

export const config = { path: "/api/public/disclosures" };

const rowsOf = (r: any): any[] => r?.rows ?? r ?? [];

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();
  try {
    const rows = rowsOf(await db.execute(sql`
      SELECT year, title, intro, data, published_at FROM ledger_disclosures
       WHERE status = 'published' ORDER BY year DESC LIMIT 20`));
    return ok({
      items: rows.map((r: any) => ({
        year: Number(r.year), title: r.title, intro: r.intro, data: r.data, publishedAt: r.published_at,
      })),
    });
  } catch (err: any) {
    return serverError("재정 공개 자료를 불러오지 못했습니다", err, "select");
  }
};
