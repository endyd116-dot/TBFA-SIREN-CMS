/**
 * DELETE /api/admin-ai-conversation-delete?id=N   (OP-053)
 * POST   동일 (일부 클라이언트 편의)
 *
 * AI 비서 대화 삭제 — 대화 messages에 회원 PII·후원·재정·순직 도구 결과가 누적되는데
 * 기존엔 CMS에서 지울 방법이 없어(list·detail API만 존재) 개발자 DB 직접 작업이 필요했다(R45 OP-053).
 *
 * ★ 민감정보 삭제이므로 super_admin 전용(DB role 기준 — elevate JWT 우회 방지).
 *   대화 + 연결된 도구 실행 로그(ai_agent_logs) 함께 정리.
 */
import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import { ok, badRequest, forbidden, serverError, corsPreflight, methodNotAllowed } from "../../lib/response";
import { logAdminAction } from "../../lib/audit";

export const config = { path: "/api/admin-ai-conversation-delete" };

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "DELETE" && req.method !== "POST") return methodNotAllowed();

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  /* OP-053: 민감 대화 삭제는 super_admin 전용 — JWT가 아닌 DB role(ctx.member.role)로 판정 */
  if ((auth.ctx.member as any).role !== "super_admin") {
    return forbidden("super_admin 권한이 필요합니다");
  }

  try {
    const url = new URL(req.url);
    const id = Number(url.searchParams.get("id") || 0);
    if (!id) return badRequest("id 필수");

    /* 도구 실행 로그 먼저 정리 후 대화 삭제 (FK 고아 방지) */
    await db.execute(sql`DELETE FROM ai_agent_logs WHERE conversation_id = ${id}`);
    await db.execute(sql`DELETE FROM ai_agent_conversations WHERE id = ${id}`);

    try {
      await logAdminAction(req, auth.ctx.admin.uid, auth.ctx.admin.name, "ai_conversation_delete", {
        target: `conv-${id}`,
      });
    } catch (_) {}

    return ok({ deleted: id }, "대화가 삭제되었습니다");
  } catch (err) {
    return serverError("대화 삭제 중 오류", err);
  }
};
