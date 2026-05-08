/**
 * Phase 3 Step 7-C.2.b — AI 수동 재생성 API
 *
 * POST /api/admin-task-ai-regenerate?id=N&type=summary|risk|completion
 *
 * 어드민 인증 후 동기 호출. 사용자가 칸반 카드 모달에서 "🔄 재생성" 버튼 누르면 호출.
 * 동기 실행이라 5~15초 정도 걸릴 수 있음 (UI에서 로딩 표시 권장).
 */
import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { generateTaskSummary, calculateTaskRisk, generateCompletionReport } from "../../lib/ai-task";
import { ok, badRequest, methodNotAllowed, serverError } from "../../lib/response";

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "POST") return methodNotAllowed();

  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;
  const meId = (auth.ctx.member as any).id as number;

  const url = new URL(req.url);
  const id = Number(url.searchParams.get("id") || 0);
  if (!id) return badRequest("id 필수");

  const type = String(url.searchParams.get("type") || "");
  if (!["summary", "risk", "completion"].includes(type)) {
    return badRequest("type은 summary | risk | completion 중 하나");
  }

  try {
    let result: any;
    if (type === "summary") {
      result = await generateTaskSummary(id);
    } else if (type === "risk") {
      result = await calculateTaskRisk(id);
    } else {
      result = await generateCompletionReport(id, meId);
    }

    if (!result.ok) {
      return ok({ ok: false, error: result.error || "AI 처리 실패" }, "AI 처리 실패");
    }
    return ok(result, `${type} 재생성 완료`);
  } catch (err: any) {
    return serverError("AI 재생성 중 오류", err);
  }
};

export const config = { path: "/api/admin-task-ai-regenerate" };
