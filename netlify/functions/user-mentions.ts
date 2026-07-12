// user-mentions.ts — 내 멘션 목록 조회
// GET /api/user-mentions?page=1&unreadOnly=true
import { jsonKST } from "../../lib/kst";
import { requireActiveUser } from "../../lib/auth";
import { db } from "../../db";
import { mentions, members } from "../../db/schema";
import { eq, desc, and, inArray } from "drizzle-orm";

export const config = { path: "/api/user-mentions" };

function jsonError(step: string, err: any) {
  return new Response(jsonKST({
    ok: false, error: "멘션 목록 조회 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async (req: Request) => {
  if (req.method !== "GET") {
    return new Response(jsonKST({ ok: false, error: "허용되지 않는 메서드" }), {
      status: 405, headers: { "Content-Type": "application/json" },
    });
  }

  let auth: any;
  try {
    auth = await requireActiveUser(req);
  } catch (err) {
    return jsonError("auth", err);
  }
  if (!auth.ok) return auth.res;

  const memberId = auth.user.uid as number;
  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const unreadOnly = url.searchParams.get("unreadOnly") === "true";
  const limit = 30;
  const offset = (page - 1) * limit;

  let rows: any[] = [];
  try {
    const cond = unreadOnly
      ? and(eq(mentions.mentionedId, memberId), eq(mentions.isRead, false))
      : eq(mentions.mentionedId, memberId);

    rows = await db
      .select({
        id: mentions.id,
        mentionerId: mentions.mentionerId,
        sourceType: mentions.sourceType,
        sourceId: mentions.sourceId,
        isRead: mentions.isRead,
        readAt: mentions.readAt,
        createdAt: mentions.createdAt,
      })
      .from(mentions)
      .where(cond)
      .orderBy(desc(mentions.createdAt))
      .limit(limit)
      .offset(offset);
  } catch (err) {
    return jsonError("select_mentions", err);
  }

  // 멘셔너 이름 보강 (separate query)
  const mentionerIds = [...new Set(rows.map((r) => r.mentionerId).filter(Boolean) as number[])];
  const nameMap = new Map<number, string>();
  if (mentionerIds.length > 0) {
    try {
      const ms = await db
        .select({ id: members.id, name: members.name })
        .from(members)
        .where(inArray(members.id, mentionerIds));
      ms.forEach((m) => nameMap.set(m.id, m.name));
    } catch (err) {
      console.warn("[user-mentions] mentioner name 조회 실패", err);
    }
  }

  return new Response(jsonKST({
    ok: true,
    page,
    items: rows.map((r) => ({
      ...r,
      mentionerName: r.mentionerId ? (nameMap.get(r.mentionerId) || "") : "알 수 없음",
    })),
  }), { headers: { "Content-Type": "application/json" } });
};
