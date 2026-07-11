/**
 * SIREN — 장기 방치 1:1 상담 자동 종료 (OP-061)
 *
 * 동작:
 *   - 매일 KST 02:30 (UTC 17:30) 자동 실행
 *   - 마지막 메시지가 14일 이상 없는 active 일반 상담방을 closed로 자동 전환
 *   - 전문가 1:1 상담(expert_1on1)은 제외 — 법률·심리 상담은 장기 공백이 정상이라 자동 종료 위험
 *   - 1회 실행당 최대 500건 (Netlify 함수 시간 제한 회피)
 *   - 멱등: 이미 closed/archived면 대상에서 자연 제외(status='active' 조건)
 *
 * 배경: 기존엔 상담 종료가 admin-chat-rooms 수동 PATCH뿐이라 방치 방이 active로 쌓여
 *       운영자 목록·unread 통계를 오염시키고, cleanup-chat-images가 active 방 첨부를
 *       영구 보존해 저장소 누수로 이어졌다(R45 OP-061).
 *
 * Scheduled Functions는 path 지정 불가 — schedule만 선언(cron 전용 호출).
 */
import type { Context } from "@netlify/functions";
import { and, eq, lt, ne, inArray } from "drizzle-orm";
import { db, chatRooms } from "../../db";
import { ROOM_TYPE_EXPERT } from "../../lib/expert-match";

export const config = {
  schedule: "30 17 * * *", // 매일 UTC 17:30 = KST 02:30 (이미지 정리 03:00보다 먼저 — 종료된 방 첨부가 다음 정리 대상이 되도록)
};

const INACTIVE_DAYS = 14;
const BATCH_LIMIT = 500;

export default async (_req: Request, _ctx: Context) => {
  const startedAt = Date.now();
  const stats = { scanned: 0, closed: 0 };
  try {
    const cutoff = new Date(Date.now() - INACTIVE_DAYS * 24 * 60 * 60 * 1000);

    /* 14일 이상 무응답 active 일반 상담방 (전문가 1:1 제외) */
    const stale = await db
      .select({ id: chatRooms.id })
      .from(chatRooms)
      .where(
        and(
          eq(chatRooms.status, "active"),
          ne(chatRooms.roomType, ROOM_TYPE_EXPERT),
          lt(chatRooms.lastMessageAt, cutoff)
        )
      )
      .limit(BATCH_LIMIT);

    stats.scanned = stale.length;

    if (stale.length > 0) {
      const ids = stale.map((r) => r.id);
      await db
        .update(chatRooms)
        .set({
          status: "closed",
          closedAt: new Date(),
          updatedAt: new Date(),
        } as any)
        .where(inArray(chatRooms.id, ids));
      stats.closed = ids.length;
    }

    const elapsedMs = Date.now() - startedAt;
    console.log(`[cron-chat-auto-close] scanned=${stats.scanned} closed=${stats.closed} elapsed=${elapsedMs}ms`);
    return new Response(
      JSON.stringify({ ok: true, message: "장기 방치 상담 자동 종료 완료", stats, elapsedMs }, null, 2),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[cron-chat-auto-close] 오류:", err);
    return new Response(
      JSON.stringify({ ok: false, error: err?.message || String(err), stats }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
};
