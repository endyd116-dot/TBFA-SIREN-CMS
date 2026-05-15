// netlify/functions/admin-members-search.ts
// Phase 10 R2 — 수신자 그룹 편집의 '수동 명단' 검색 전용 가벼운 API
//
// GET /api/admin-members-search?q=...&limit=50
//
// 응답: { ok: true, members: [{id, name, email, phone, type, status}], total }
//
// admin-members 함수는 list·pagination·donorTypeCounts·typeCounts 등 무거운
// 응답이라 수동 명단 검색 화면에는 과함. 검색 전용 가벼운 응답.

import { db, members } from "../../db";
import { or, like, desc, and, sql } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/admin-members-search" };

const JSON_HEADER = { "Content-Type": "application/json" };

function jsonError(step: string, err: any, status = 500) {
  return new Response(
    JSON.stringify({
      ok: false,
      error: "회원 검색 실패",
      step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }),
    { status, headers: JSON_HEADER },
  );
}

export default async function handler(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  if (req.method !== "GET") {
    return new Response(
      JSON.stringify({ ok: false, error: "GET만 허용" }),
      { status: 405, headers: JSON_HEADER },
    );
  }

  try {
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") || "").trim();
    const limitRaw = parseInt(url.searchParams.get("limit") || "50", 10);
    const limit = Math.min(200, Math.max(1, isNaN(limitRaw) ? 50 : limitRaw));

    if (q.length < 1) {
      return new Response(
        JSON.stringify({ ok: true, members: [], total: 0 }),
        { status: 200, headers: JSON_HEADER },
      );
    }

    /* 이름·이메일·전화번호 부분 일치 검색 — 탈퇴만 제외 */
    const pattern = `%${q}%`;
    const rows = await db
      .select({
        id: members.id,
        name: members.name,
        email: members.email,
        phone: members.phone,
        type: members.type,
        status: members.status,
      })
      .from(members)
      .where(
        and(
          sql`${members.status} <> 'withdrawn'`,
          or(
            like(members.name, pattern),
            like(members.email, pattern),
            like(members.phone, pattern),
          )!,
        ),
      )
      .orderBy(desc(members.id))
      .limit(limit);

    return new Response(
      JSON.stringify({ ok: true, members: rows, total: rows.length }),
      { status: 200, headers: JSON_HEADER },
    );
  } catch (err) {
    return jsonError("search", err);
  }
}
