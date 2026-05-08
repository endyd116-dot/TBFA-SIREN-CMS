/**
 * Phase 3 Step 7-C.2.b — AI-1 요약 백그라운드 함수
 *
 * Netlify Background Function (-background suffix)
 *   · 응답 즉시 202 반환, 백그라운드에서 최대 15분 실행
 *   · 사용자 응답 지연 없이 AI 호출 가능
 *
 * POST body: { taskId, secret? }
 *   secret: 내부 호출 검증용 (process.env.INTERNAL_TRIGGER_SECRET)
 *           설정 없으면 모두 허용 (어차피 Netlify Functions 외부 노출 제한적)
 */
import type { Context } from "@netlify/functions";
import { generateTaskSummary } from "../../lib/ai-task";

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false }), { status: 405 });
  }

  let body: any = {};
  try { body = await req.json(); } catch (_) {}

  const taskId = Number(body?.taskId || 0);
  if (!taskId) {
    return new Response(JSON.stringify({ ok: false, error: "taskId 필수" }), { status: 400 });
  }

  const secret = String(body?.secret || "");
  const expected = process.env.INTERNAL_TRIGGER_SECRET || "";
  if (expected && secret !== expected) {
    return new Response(JSON.stringify({ ok: false, error: "권한 없음" }), { status: 403 });
  }

  console.info(`[ai-summary-bg] start taskId=${taskId}`);
  const r = await generateTaskSummary(taskId);
  console.info(`[ai-summary-bg] done taskId=${taskId} ok=${r.ok}`);
  return new Response(JSON.stringify(r), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
