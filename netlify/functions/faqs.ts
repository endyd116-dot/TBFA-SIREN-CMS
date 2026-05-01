/**
 * GET /api/faqs             → 전체 활성 FAQ
 * GET /api/faqs?category=X  → 카테고리 필터
 */
import { eq, asc, and } from "drizzle-orm";
import { db, faqs } from "../../db";
import {
  ok, serverError, corsPreflight, methodNotAllowed,
} from "../../lib/response";

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  try {
    const url = new URL(req.url);
    const category = url.searchParams.get("category");

    const conditions = [eq(faqs.isActive, true)];
    if (category) conditions.push(eq(faqs.category, category));

    const list = await db
      .select({
        id: faqs.id,
        category: faqs.category,
        question: faqs.question,
        answer: faqs.answer,
        sortOrder: faqs.sortOrder,
      })
      .from(faqs)
      .where(conditions.length === 1 ? conditions[0] : and(...conditions))
      .orderBy(asc(faqs.sortOrder), asc(faqs.id));

    return ok({ list });
  } catch (err) {
    console.error("[faqs]", err);
    return serverError("FAQ 조회 중 오류", err);
  }
};

export const config = { path: "/api/faqs" };