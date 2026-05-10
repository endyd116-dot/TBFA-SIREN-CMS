/**
 * lib/expert-match.ts — 6순위 #8 1:1 매칭 채팅 공용 헬퍼
 *
 * 메인 채팅 소유. A·B 채팅은 import 사용만 — 본 파일 정의 변경은 메인 채팅에서만.
 *
 * 기존 인프라 활용:
 *   - 전문가: members.type='volunteer' + member_subtype IN ('lawyer','counselor')
 *   - 1:1 채팅방: chat_rooms.room_type='expert_1on1' + expert_id 채워짐
 */

import { eq, and } from "drizzle-orm";
import { db, members } from "../db";

/* =========================================================
   1. 상수·타입
   ========================================================= */

export const EXPERT_MATCH_STATUSES = [
  "pending",
  "matched",
  "active",
  "closed",
  "rejected",
] as const;
export type ExpertMatchStatus = (typeof EXPERT_MATCH_STATUSES)[number];

export const MATCH_TYPES = ["lawyer", "counselor"] as const;
export type MatchType = (typeof MATCH_TYPES)[number];

export const SOURCE_DOMAINS = ["incident", "harassment", "legal", "support"] as const;
export type SourceDomain = (typeof SOURCE_DOMAINS)[number];

export const CLOSED_REASONS = [
  "completed",
  "expert_unavailable",
  "user_canceled",
  "admin_terminated",
] as const;
export type ClosedReason = (typeof CLOSED_REASONS)[number];

export const ROOM_TYPE_EXPERT = "expert_1on1" as const;

/* =========================================================
   2. 검증
   ========================================================= */

export function isValidStatus(s: any): s is ExpertMatchStatus {
  return typeof s === "string" && (EXPERT_MATCH_STATUSES as readonly string[]).includes(s);
}

export function isValidMatchType(t: any): t is MatchType {
  return typeof t === "string" && (MATCH_TYPES as readonly string[]).includes(t);
}

export function isValidSourceDomain(d: any): d is SourceDomain {
  return typeof d === "string" && (SOURCE_DOMAINS as readonly string[]).includes(d);
}

export function isValidClosedReason(r: any): r is ClosedReason {
  return typeof r === "string" && (CLOSED_REASONS as readonly string[]).includes(r);
}

/* =========================================================
   3. 전문가 자격 검증
      - matchType='lawyer'  → member_subtype='lawyer'
      - matchType='counselor' → member_subtype='counselor'
      - members.type='volunteer' AND status != 'blacklist','withdrawn'
   ========================================================= */

export interface ExpertCheckResult {
  ok: boolean;
  reason?: string;
  member?: {
    id: number;
    name: string | null;
    type: string | null;
    memberSubtype: string | null;
    status: string | null;
  };
}

export async function checkExpertEligibility(
  expertMemberId: number,
  matchType: MatchType,
): Promise<ExpertCheckResult> {
  const rows = await db
    .select({
      id: members.id,
      name: members.name,
      type: members.type,
      memberSubtype: members.memberSubtype,
      status: members.status,
    })
    .from(members)
    .where(eq(members.id, expertMemberId))
    .limit(1);

  if (rows.length === 0) {
    return { ok: false, reason: "전문가 회원이 존재하지 않음" };
  }
  const m = rows[0];
  if (m.status === "blacklist" || m.status === "withdrawn") {
    return { ok: false, reason: `전문가 상태가 ${m.status}임`, member: m };
  }
  if (m.type !== "volunteer") {
    return { ok: false, reason: `전문가가 아닌 회원(type=${m.type})`, member: m };
  }
  if (m.memberSubtype !== matchType) {
    return {
      ok: false,
      reason: `전문가 종류 불일치 (요청=${matchType}, 실제=${m.memberSubtype})`,
      member: m,
    };
  }
  return { ok: true, member: m };
}

/* =========================================================
   4. 채팅방 제목 생성
   ========================================================= */
export function buildExpertChatRoomTitle(
  matchType: MatchType,
  userName: string | null,
  expertName: string | null,
): string {
  const typeLabel = matchType === "lawyer" ? "변호사" : "심리상담사";
  const userLabel = userName || "사용자";
  const expertLabel = expertName || typeLabel;
  return `[${typeLabel} 1:1] ${userLabel} ↔ ${expertLabel}`.slice(0, 200);
}

/* =========================================================
   5. 권한 — 채팅방 입장 가능 여부
      memberId(사용자 본인) | expertId(전문가 본인) | 어드민이면 true
   ========================================================= */
export function canEnterExpertRoom(
  room: { memberId: number; expertId: number | null; roomType: string | null },
  viewerMemberId: number,
  viewerIsAdmin: boolean,
): boolean {
  if (viewerIsAdmin) return true;
  if (room.roomType !== ROOM_TYPE_EXPERT) return true; // 일반 룸은 본 가드 무관
  if (room.memberId === viewerMemberId) return true;
  if (room.expertId === viewerMemberId) return true;
  return false;
}
