/**
 * POST /api/admin/ai/reply-draft
 * Body: { id: number }
 * 응답: { ok, draft }
 *
 * 지정한 지원 신청 ID에 대한 AI 답변 초안 생성
 */
import { eq } from "drizzle-orm";
import { db, supportRequests, members } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, badRequest, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { generateReplyDraft } from "../../lib/ai-reply";

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  const guard: any = await requireAdmin(req);
  if (!guard.ok) return guard.res;

  try {
    const body = await parseJson(req);
    if (!body?.id) return badRequest("id가 필요합니다");

    const id = Number(body.id);
    if (!Number.isFinite(id)) return badRequest("유효하지 않은 ID");

    /* 신청 조회 */
    const [request] = await db
      .select()
      .from(supportRequests)
      .where(eq(supportRequests.id, id))
      .limit(1);

    if (!request) return notFound("신청 내역 없음");

    /* 신청자 이름 */
    const [member] = await db
      .select({ name: members.name })
      .from(members)
      .where(eq(members.id, request.memberId))
      .limit(1);

    const applicantName = member?.name || "회원";

    /* AI 호출 */
    const result = await generateReplyDraft({
      applicantName,
      category: request.category,
      title: request.title,
      content: request.content,
      priority: request.priority || "normal",
      currentStatus: request.status,
    });

    if (!result.ok) {
      return serverError("AI 답변 초안 생성 실패", { error: result.error });
    }

    return ok({ draft: result.draft }, "답변 초안이 생성되었습니다");
  } catch (err) {
    console.error("[admin-ai-reply]", err);
    return serverError("AI 호출 중 오류", err);
  }
};

export const config = { path: "/api/admin/ai/reply-draft" };