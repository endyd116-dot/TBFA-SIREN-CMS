/**
 * Phase 3 Step 7-C.2.b — AI-3 완료 보고서 초안 백그라운드 함수
 *
 * Netlify Background Function (-background suffix)
 *
 * POST body: { taskId, authorMemberId, secret? }
 */
import type { Context } from "@netlify/functions";
import { generateCompletionReport } from "../../lib/ai-task";

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false }), { status: 405 });
  }

  let body: any = {};
  try { body = await req.json(); } catch (_) {}

  const taskId = Number(body?.taskId || 0);
  const authorMemberId = Number(body?.authorMemberId || 0);
  if (!taskId || !authorMemberId) {
    return new Response(JSON.stringify({ ok: false, error: "taskId, authorMemberId 필수" }), { status: 400 });
  }

  const secret = String(body?.secret || "");
  const expected = process.env.INTERNAL_TRIGGER_SECRET || "";
  /* ★ P1-5 fix: fail-closed — env 미설정 시 무인증 호출 차단(호출부가 같은 env로 secret 전달). */
  if (!expected || secret !== expected) {
    return new Response(JSON.stringify({ ok: false, error: "권한 없음" }), { status: 403 });
  }

  console.info(`[ai-completion-bg] start taskId=${taskId}`);
  const r = await generateCompletionReport(taskId, authorMemberId);
  console.info(`[ai-completion-bg] done taskId=${taskId} ok=${r.ok}`);
  return new Response(JSON.stringify(r), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
