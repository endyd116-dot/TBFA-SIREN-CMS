// lib/mention-helper.ts — @멘션 파싱 + 기록 + 알림 헬퍼
// 게시글·댓글·채팅 메시지 저장 시 호출 (fire-and-forget)
import { db } from "../db";
import { mentions, members } from "../db/schema";
import { inArray } from "drizzle-orm";
import { createNotification } from "./notify";

/**
 * 텍스트에서 @이름 패턴 추출 후 member 조회 → mentions 저장 → 알림
 * @param text         게시글/댓글/채팅 원문 (plain text or HTML)
 * @param sourceType   'post'|'comment'|'chat'
 * @param sourceId     해당 레코드 id
 * @param mentionerId  글 쓴 사람 member id (null 허용)
 * @param sourceLink   알림 클릭 시 이동할 링크
 */
export async function processMentions(
  text: string,
  sourceType: "post" | "comment" | "chat",
  sourceId: number,
  mentionerId: number | null,
  sourceLink: string,
): Promise<void> {
  try {
    // HTML 태그 제거 후 @이름 추출
    const plain = text.replace(/<[^>]+>/g, " ");
    const raw = plain.match(/@([^\s@#<>&]{1,30})/g) || [];
    const names = [...new Set(raw.map((t) => t.slice(1)))];
    if (names.length === 0) return;

    // 이름으로 회원 조회 (최대 10명 cap)
    const capped = names.slice(0, 10);
    const matched = await db
      .select({ id: members.id, name: members.name })
      .from(members)
      .where(inArray(members.name, capped))
      .limit(10);

    if (matched.length === 0) return;

    // 멘션 INSERT (fire-and-forget)
    await db.insert(mentions).values(
      matched.map((m) => ({
        mentionedId: m.id,
        mentionerId: mentionerId ?? undefined,
        sourceType,
        sourceId,
      })),
    ).onConflictDoNothing();

    // 알림 발송
    const sourceLabel = sourceType === "post" ? "게시글" : sourceType === "comment" ? "댓글" : "채팅";
    for (const m of matched) {
      try {
        await createNotification({
          recipientId: m.id,
          recipientType: "user",
          category: "system",
          severity: "info",
          title: `${sourceLabel}에서 회원님을 멘션했습니다`,
          message: plain.slice(0, 100),
          link: sourceLink,
          refTable: sourceType === "post" ? "board_posts" : sourceType === "comment" ? "board_comments" : "chat_messages",
          refId: sourceId,
          expiresInDays: 30,
        });
      } catch (_) {}
    }
  } catch (err) {
    console.warn("[mention-helper] processMentions 실패", err);
  }
}
