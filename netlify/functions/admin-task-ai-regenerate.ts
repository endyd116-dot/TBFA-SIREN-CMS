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
import { db, workspaceTasks } from "../../db";
import { eq } from "drizzle-orm";
import { generateTaskSummary, calculateTaskRisk, generateCompletionReport } from "../../lib/ai-task";
import { ok, badRequest, methodNotAllowed, serverError } from "../../lib/response";

/* OP-047: best-effort 연타 방지 — 같은 (task,type) 재생성을 짧은 쿨다운으로 제한.
   인메모리라 콜드스타트 시 리셋되지만, 웜 인스턴스 연타(비용 폭증의 가장 흔한 경로)는 차단.
   근본적 분당 상한은 ai-feature 월예산 가드와 병행. */
const REGEN_COOLDOWN_MS = 15_000;
const lastRegenAt = new Map<string, number>();

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "POST") return methodNotAllowed();

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;
  const meId = (auth.ctx.member as any).id as number;

  const url = new URL(req.url);
  const id = Number(url.searchParams.get("id") || 0);
  if (!id) return badRequest("id 필수");

  const type = String(url.searchParams.get("type") || "");
  if (!["summary", "risk", "completion"].includes(type)) {
    return badRequest("type은 summary | risk | completion 중 하나");
  }

  /* R45 OP-042: 작업 소유권 검증 — 타인 작업 AI 강제 재생성(비용·덮어쓰기) 차단 */
  if ((auth.ctx.member as any).role !== "super_admin") {
    const [t] = await db
      .select({ memberId: workspaceTasks.memberId, assignedTo: workspaceTasks.assignedTo, assignedBy: workspaceTasks.assignedBy, completedBy: workspaceTasks.completedBy })
      .from(workspaceTasks).where(eq(workspaceTasks.id, id)).limit(1);
    if (!t) return badRequest("작업을 찾을 수 없습니다");
    if (!(t.memberId === meId || t.assignedTo === meId || t.assignedBy === meId || t.completedBy === meId)) {
      return new Response(JSON.stringify({ ok: false, error: "본인 관련 작업만 재생성할 수 있습니다", step: "auth" }), { status: 403, headers: { "Content-Type": "application/json" } });
    }
  }

  /* OP-047: 쿨다운 검사 */
  const cooldownKey = `${id}:${type}`;
  const nowMs = Date.now();
  if (nowMs - (lastRegenAt.get(cooldownKey) || 0) < REGEN_COOLDOWN_MS) {
    return new Response(
      JSON.stringify({ ok: false, error: "방금 재생성했습니다. 잠시 후 다시 시도해 주세요.", step: "cooldown" }),
      { status: 429, headers: { "Content-Type": "application/json" } }
    );
  }
  lastRegenAt.set(cooldownKey, nowMs);

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
      /* OP-048: AI 실패를 HTTP 200으로 감싸 보내면 프론트가 성공으로 오인 → 비-200 + step 표준 에러 */
      return new Response(
        JSON.stringify({ ok: false, error: result.error || "AI 처리 실패", step: "ai_generate" }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }
    return ok(result, `${type} 재생성 완료`);
  } catch (err: any) {
    return serverError("AI 재생성 중 오류", err);
  }
};

export const config = { path: "/api/admin-task-ai-regenerate" };
