// netlify/functions/admin-workspace-feed.ts
// ★ 2026-05-12 워크스페이스 v2 — 팀 활동 피드 (자연어 한 줄 + 시간 그룹)
//
// 라우트
//   GET /api/admin/workspace-feed?limit=80&since=ISO&filter=all|me|team
//
// 응답
//   { items: [{ id, actionType, message, actorId, actorName, targetType, targetId, targetTitle, link, createdAt }, ... ],
//     totalCount, generatedAt }
//
// 시간 그룹화는 클라이언트가 createdAt 기준으로 처리 (오늘/어제/이번 주/이전).
// 메시지는 자연어로 미리 조립해서 클라이언트는 그대로 렌더만 하면 됨.
//
// 필터
//   filter=me   : actorId = 나 OR targetId in (내가 담당/관전 중인 카드)
//   filter=team : 본인 외 다른 운영자 활동 (협업 시야)
//   filter=all  : 기본 — 가시성='team' OR 'public' OR (actorId=나)

import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import { ok, badRequest, serverError, corsPreflight, methodNotAllowed } from "../../lib/response";

export const config = { path: "/api/admin/workspace-feed" };

/* ────────── 자연어 라벨 매핑 ────────── */
const ACTION_TEMPLATES: Record<string, { icon: string; verb: string }> = {
  "task.create":       { icon: "📝", verb: "{actor}님이 「{target}」 작업을 만들었어요" },
  "task.update":       { icon: "✏️", verb: "{actor}님이 「{target}」을 수정했어요" },
  "task.complete":     { icon: "✅", verb: "{actor}님이 「{target}」을 완료했어요" },
  "task.reopen":       { icon: "↩️", verb: "{actor}님이 「{target}」을 다시 진행 중으로 되돌렸어요" },
  "task.assign":       { icon: "🎯", verb: "{actor}님이 「{target}」을 {assignee}님에게 할당했어요" },
  "task.transfer":     { icon: "📨", verb: "{actor}님이 「{target}」을 {assignee}님에게 토스했어요" },
  "task.delete":       { icon: "🗑", verb: "{actor}님이 「{target}」을 삭제했어요" },
  "task.archive":      { icon: "📦", verb: "{actor}님이 「{target}」을 보관했어요" },
  "task.priority":     { icon: "🔥", verb: "{actor}님이 「{target}」의 우선순위를 {priority}로 변경했어요" },
  "task.due_change":   { icon: "📅", verb: "{actor}님이 「{target}」의 마감일을 변경했어요" },
  "task.comment":      { icon: "💬", verb: "{actor}님이 「{target}」에 댓글을 남겼어요" },
  "task.mention":      { icon: "📣", verb: "{actor}님이 「{target}」에서 {assignee}님을 언급했어요" },
  "task.watch":        { icon: "👀", verb: "{actor}님이 「{target}」을 관전 중이에요" },

  "event.create":      { icon: "📅", verb: "{actor}님이 「{target}」 일정을 등록했어요" },
  "event.update":      { icon: "🗓", verb: "{actor}님이 「{target}」 일정을 수정했어요" },
  "event.delete":      { icon: "🗑", verb: "{actor}님이 「{target}」 일정을 삭제했어요" },

  "memo.create":       { icon: "🗒", verb: "{actor}님이 「{target}」 메모를 작성했어요" },
  "memo.update":       { icon: "✏️", verb: "{actor}님이 「{target}」 메모를 수정했어요" },
  "memo.pin":          { icon: "📌", verb: "{actor}님이 「{target}」 메모를 고정했어요" },
  "memo.delete":       { icon: "🗑", verb: "{actor}님이 「{target}」 메모를 삭제했어요" },

  "due.request":       { icon: "⏰", verb: "{actor}님이 「{target}」의 마감일 변경을 요청했어요" },
  "due.approve":       { icon: "👍", verb: "{actor}님이 「{target}」의 마감일 변경을 승인했어요" },
  "due.reject":        { icon: "👎", verb: "{actor}님이 「{target}」의 마감일 변경을 거절했어요" },

  "rnr.update":        { icon: "🔧", verb: "{actor}님이 R&R 매핑을 변경했어요 — {target}" },
};

function renderMessage(actorName: string, row: any): string {
  const tpl = ACTION_TEMPLATES[row.actionType];
  const targetTitle = row.targetTitle || "(제목 없음)";
  if (!tpl) {
    return `${actorName}님이 ${row.actionType} (${targetTitle})`;
  }
  let msg = tpl.verb
    .replace("{actor}", actorName)
    .replace("{target}", targetTitle);
  const meta = row.metadata || {};
  if (meta.assigneeName) msg = msg.replace("{assignee}", meta.assigneeName);
  if (meta.priority)    msg = msg.replace("{priority}", String(meta.priority));
  /* 치환되지 않은 토큰 정리 */
  msg = msg.replace(/\{[a-z]+\}/g, "—");
  return `${tpl.icon} ${msg}`;
}

function buildLink(row: any): string | null {
  if (!row.targetType || !row.targetId) return null;
  switch (row.targetType) {
    case "task":  return `/workspace-kanban.html?taskId=${row.targetId}`;
    case "event": return `/workspace-calendar.html?eventId=${row.targetId}`;
    case "memo":  return `/workspace.html?memoId=${row.targetId}`;
    case "rnr":   return `/admin.html?page=operators#rnr`;
    default:      return null;
  }
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  const guard: any = await requireAdmin(req);
  if (!guard.ok) return (guard as { ok: false; res: Response }).res;
  const { admin } = guard.ctx;
  const meId = admin.uid;

  try {
    const url = new URL(req.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 80, 1), 200);
    const filter = (url.searchParams.get("filter") || "all").toLowerCase();
    const since = url.searchParams.get("since");

    /* visibility: 'team' / 'public'은 모두 가시, 'private'은 본인만 */
    let whereClause = sql`(visibility IN ('team','public') OR actor_id = ${meId})`;
    if (filter === "me") {
      whereClause = sql`(actor_id = ${meId})`;
    } else if (filter === "team") {
      whereClause = sql`(visibility IN ('team','public') AND actor_id != ${meId})`;
    }
    if (since) {
      const sinceDate = new Date(since);
      if (!isNaN(sinceDate.getTime())) {
        whereClause = sql`${whereClause} AND created_at > ${sinceDate}`;
      }
    }

    const rows: any = await db.execute(sql`
      SELECT
        a.id,
        a.actor_id     AS "actorId",
        a.actor_name   AS "actorName",
        a.action_type  AS "actionType",
        a.target_type  AS "targetType",
        a.target_id    AS "targetId",
        a.target_title AS "targetTitle",
        a.metadata,
        a.visibility,
        a.created_at   AS "createdAt"
      FROM workspace_activity_log a
      WHERE ${whereClause}
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT ${limit}
    `);
    const list = (Array.isArray(rows) ? rows : (rows?.rows || [])) as any[];

    const items = list.map((r: any) => ({
      id: r.id,
      actorId: r.actorId,
      actorName: r.actorName || "—",
      actionType: r.actionType,
      targetType: r.targetType,
      targetId: r.targetId,
      targetTitle: r.targetTitle,
      message: renderMessage(r.actorName || "누군가", r),
      link: buildLink(r),
      visibility: r.visibility,
      createdAt: r.createdAt,
    }));

    return ok({
      items,
      totalCount: items.length,
      filter,
      generatedAt: new Date().toISOString(),
    });
  } catch (e: any) {
    console.error("[admin-workspace-feed]", e);
    return serverError("피드 조회 실패", e?.message);
  }
};
