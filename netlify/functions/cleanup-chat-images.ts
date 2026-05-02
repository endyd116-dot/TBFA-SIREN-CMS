/**
 * SIREN — 채팅 이미지 자동 정리 스케줄 함수 (STEP I-2)
 *
 * 동작:
 *   - 매일 새벽 3시 KST (UTC 18:00) 자동 실행
 *   - chat_attachments.expires_at < NOW() 조건
 *   - 단, 결정 4-C안: 채팅방이 active 상태면 보존 (진행 중 상담 보호)
 *   - Netlify Blobs + DB 행 동시 삭제
 *   - 1회 실행당 최대 500건 처리 (Netlify 함수 시간 제한 10초 회피)
 *
 * 수동 실행 (테스트용):
 *   Netlify 대시보드 → Functions → cleanup-chat-images → "Test invoke" 버튼
 *   (Scheduled Functions는 URL 직접 호출 불가)
 *
 * 스케줄 설정: export const config 의 schedule 또는 netlify.toml
 */
import type { Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { eq, lt, and, inArray, isNotNull } from "drizzle-orm";
import { db, chatAttachments, chatRooms } from "../../db";

/* ★ Scheduled Functions는 path를 지정할 수 없음 (Netlify 제약)
   schedule만 선언하면 자동으로 cron으로만 호출되며, URL 라우팅은 불가 */
export const config = {
  schedule: "0 18 * * *", // 매일 UTC 18:00 = KST 03:00
};

const BATCH_LIMIT = 500;            // 1회 실행 최대 처리 건수

export default async (req: Request, _ctx: Context) => {
  const startedAt = Date.now();
  const log: string[] = [];
  const stats = {
    scanned: 0,
    deleted: 0,
    skippedActive: 0,
    blobErrors: 0,
    dbErrors: 0,
  };

  try {
    log.push(`▶ Cleanup 시작 (Scheduled invocation)`);
    log.push(`▶ 기준 시각: ${new Date().toISOString()}`);

    /* ============ 1단계: 만료된 첨부 목록 조회 ============ */
    const now = new Date();
    const expired = await db
      .select({
        id: chatAttachments.id,
        roomId: chatAttachments.roomId,
        blobKey: chatAttachments.blobKey,
        thumbnailKey: chatAttachments.thumbnailKey,
        expiresAt: chatAttachments.expiresAt,
      })
      .from(chatAttachments)
      .where(
        and(
          isNotNull(chatAttachments.expiresAt),
          lt(chatAttachments.expiresAt, now)
        )
      )
      .limit(BATCH_LIMIT);

    stats.scanned = expired.length;
    log.push(`✅ 만료 대상 ${expired.length}건 조회 완료`);

    if (expired.length === 0) {
      log.push("ℹ️ 처리할 만료 이미지가 없습니다.");
      return responseOk(stats, log, startedAt);
    }

    /* ============ 2단계: active 채팅방 ID 조회 (보존 대상) ============ */
    const roomIds = Array.from(new Set(expired.map((e) => e.roomId)));
    const activeRooms = await db
      .select({ id: chatRooms.id })
      .from(chatRooms)
      .where(
        and(
          inArray(chatRooms.id, roomIds),
          eq(chatRooms.status, "active")
        )
      );
    const activeRoomSet = new Set(activeRooms.map((r) => r.id));
    log.push(`🛡 보존 대상 active 채팅방: ${activeRoomSet.size}개`);

    /* ============ 3단계: Blob 삭제 + DB 삭제 ============ */
    const store = getStore({ name: "chat-images", consistency: "strong" });
    const idsToDelete: number[] = [];

    for (const att of expired as any[]) {
      /* 결정 4-C: active 채팅방은 보존 */
      if (activeRoomSet.has(att.roomId)) {
        stats.skippedActive++;
        continue;
      }

      /* Blob 삭제 — 이미지 본체 */
      try {
        if (att.blobKey) {
          await store.delete(att.blobKey);
        }
      } catch (e: any) {
        stats.blobErrors++;
        log.push(`⚠️ Blob 삭제 실패 (id=${att.id}, key=${att.blobKey}): ${e.message}`);
        /* Blob 삭제 실패해도 DB는 정리 (orphan 방지) */
      }

      /* Blob 삭제 — 썸네일 (있는 경우) */
      try {
        if (att.thumbnailKey) {
          await store.delete(att.thumbnailKey);
        }
      } catch (e: any) {
        stats.blobErrors++;
        log.push(`⚠️ Thumbnail 삭제 실패 (id=${att.id}): ${e.message}`);
      }

      idsToDelete.push(att.id);
    }

    /* DB 일괄 삭제 (성능 ↑) */
    if (idsToDelete.length > 0) {
      try {
        await db
          .delete(chatAttachments)
          .where(inArray(chatAttachments.id, idsToDelete));
        stats.deleted = idsToDelete.length;
        log.push(`✅ DB 일괄 삭제 완료: ${idsToDelete.length}건`);
      } catch (e: any) {
        stats.dbErrors++;
        log.push(`❌ DB 일괄 삭제 실패: ${e.message}`);
      }
    }

    /* ============ 결과 반환 ============ */
    log.push("▶ Cleanup 완료");
    return responseOk(stats, log, startedAt);
  } catch (err: any) {
    console.error("[cleanup-chat-images] 치명적 오류:", err);
    log.push(`❌ 치명적 오류: ${err.message}`);
    return new Response(
      JSON.stringify(
        {
          ok: false,
          error: err.message,
          stats,
          log,
          elapsedMs: Date.now() - startedAt,
        },
        null,
        2
      ),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
};

/* ============ 헬퍼: 성공 응답 ============ */
function responseOk(
  stats: any,
  log: string[],
  startedAt: number
) {
  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[cleanup-chat-images] scanned=${stats.scanned} deleted=${stats.deleted} ` +
    `skipped=${stats.skippedActive} blobErr=${stats.blobErrors} dbErr=${stats.dbErrors} ` +
    `elapsed=${elapsedMs}ms`
  );

  return new Response(
    JSON.stringify(
      {
        ok: true,
        message: "채팅 이미지 정리 완료",
        stats,
        log,
        elapsedMs,
        nextRun: "매일 새벽 3시 KST",
      },
      null,
      2
    ),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}