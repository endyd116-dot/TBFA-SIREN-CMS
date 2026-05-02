// netlify/functions/chat-image.ts
import type { Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { eq } from "drizzle-orm";
import { db, chatAttachments, chatRooms } from "../../db";
import { authenticateUser, authenticateAdmin } from "../../lib/auth";

export const config = { path: "/api/chat/image" };

export default async (req: Request, _ctx: Context) => {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    const download = url.searchParams.get("download") === "1";

    if (!id || !/^\d+$/.test(id)) {
      return new Response(JSON.stringify({ error: "id required" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    /* 1) 첨부 정보 조회 */
    const [att] = await db
      .select()
      .from(chatAttachments)
      .where(eq(chatAttachments.id, Number(id)))
      .limit(1);

    if (!att) {
      return new Response("Not Found", { status: 404 });
    }

    /* 2) 권한 검증 (관리자 우선 → 사용자 본인 채팅방) */
    const admin = authenticateAdmin(req);

    if (!admin) {
      const user = authenticateUser(req);
      if (!user) {
        return new Response("Unauthorized", { status: 401 });
      }
      /* 첨부 → 채팅방 → 소유자(memberId) 일치 여부 */
      const [room] = await db
        .select({ id: chatRooms.id, memberId: chatRooms.memberId })
        .from(chatRooms)
        .where(eq(chatRooms.id, (att as any).roomId))
        .limit(1);

      if (!room) return new Response("Not Found", { status: 404 });
      if (room.memberId !== user.uid) {
        return new Response("Forbidden", { status: 403 });
      }
    }

    /* 3) Blob 읽기 */
    const store = getStore({ name: "chat-images", consistency: "strong" });
    const blob = await store.get((att as any).blobKey, { type: "arrayBuffer" });
    if (!blob) {
      return new Response("Image not found", { status: 404 });
    }

    /* 4) 응답 헤더 */
    const headers: Record<string, string> = {
      "content-type": (att as any).mimeType || "image/jpeg",
      "cache-control": "private, max-age=3600",
    };

    if (download) {
      const fileName = (att as any).originalName || `chat-image-${id}.jpg`;
      const encoded = encodeURIComponent(fileName);
      headers["content-disposition"] =
        `attachment; filename="${encoded}"; filename*=UTF-8''${encoded}`;
    } else {
      headers["content-disposition"] = "inline";
    }

    return new Response(blob as ArrayBuffer, { status: 200, headers });
  } catch (e: any) {
    console.error("[chat-image] error", e);
    return new Response(
      JSON.stringify({ error: e?.message || "internal error" }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
};