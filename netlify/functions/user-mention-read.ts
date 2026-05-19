// user-mention-read.ts — 멘션 읽음 처리 (단건 or 전체)
// POST /api/user-mention-read  body: { mentionId? }  (mentionId 없으면 전부 읽음)
import { requireActiveUser } from "../../lib/auth";
import { db } from "../../db";
import { mentions } from "../../db/schema";
import { eq, and } from "drizzle-orm";

export const config = { path: "/api/user-mention-read" };

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "멘션 읽음 처리 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "허용되지 않는 메서드" }), {
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

  let body: any = {};
  try {
    body = await req.json().catch(() => ({}));
  } catch (_) {}

  const mentionId: number | undefined = body.mentionId ? Number(body.mentionId) : undefined;
  const now = new Date();

  try {
    if (mentionId) {
      await db.update(mentions)
        .set({ isRead: true, readAt: now } as any)
        .where(and(eq(mentions.id, mentionId), eq(mentions.mentionedId, memberId)));
    } else {
      await db.update(mentions)
        .set({ isRead: true, readAt: now } as any)
        .where(and(eq(mentions.mentionedId, memberId), eq(mentions.isRead, false)));
    }
  } catch (err) {
    return jsonError("update_read", err);
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
};
