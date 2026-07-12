/**
 * POST /api/ms-ai-classify
 * 매출 실적 입력 시 비고·금액·날짜를 보고 가장 적합한 마일스톤을 AI가 추천.
 *
 * body: { note, amount, unit, date, milestones: [{id, name}] }
 * response: { ok: true, milestoneId: number|null, confidence: 0~1, reason: string }
 *
 * AI 실패·파싱 실패 시 throw 없이 { milestoneId: null, confidence: 0, reason: '' } 반환.
 */
import { jsonRes } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { callGeminiJSON } from "../../lib/ai-gemini";

export const config = { path: "/api/ms-ai-classify" };

const FALLBACK = { ok: true, milestoneId: null, confidence: 0, reason: "" };

export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "POST") {
    return jsonRes({ ok: false, error: "POST만 지원합니다" }, { status: 405 });
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  let body: any;
  try { body = await req.json(); }
  catch { return jsonRes({ ok: false, error: "JSON 파싱 실패" }, { status: 400 }); }

  const { note, amount, unit, date, milestones } = body || {};
  if (!Array.isArray(milestones) || milestones.length === 0) {
    return jsonRes(FALLBACK);
  }

  // 비고가 너무 짧으면 분류 의미 없음 (비용 절약)
  if (!note || String(note).trim().length < 4) {
    return jsonRes(FALLBACK);
  }

  const idList = milestones.map((m: any) => String(m.id));
  const selectionJson = JSON.stringify(
    milestones.slice(0, 30).map((m: any) => ({ id: String(m.id), name: String(m.name || "").slice(0, 80) }))
  );

  const prompt = `아래 실적 정보와 선택지를 보고 가장 적합한 마일스톤 ID 하나를 골라줘.
선택지(JSON): ${selectionJson}
비고="${String(note).slice(0, 300)}", 금액=${amount}${unit || ""}, 날짜=${date || ""}
반드시 JSON으로만 응답: {"milestoneId":"<ID>","confidence":0~1,"reason":"한줄"}
확신 없으면 confidence 0.3 이하 설정. 선택지 외 ID 반환 금지.`;

  try {
    const result = await callGeminiJSON<{ milestoneId?: string | number; confidence?: number; reason?: string }>(
      prompt,
      { mode: "flash", featureKey: "ms_ai_classify", maxOutputTokens: 200, temperature: 0.2 }
    );

    if (!result.ok || !result.data) {
      return jsonRes(FALLBACK);
    }

    const idStr = String(result.data.milestoneId ?? "").trim();
    const conf = Number(result.data.confidence ?? 0);
    const reason = String(result.data.reason ?? "").slice(0, 200);

    if (!idStr || !idList.includes(idStr) || !Number.isFinite(conf)) {
      return jsonRes(FALLBACK);
    }

    return jsonRes({
      ok: true,
      milestoneId: Number(idStr),
      confidence: Math.max(0, Math.min(1, conf)),
      reason,
    });
  } catch (e: any) {
    console.warn("[ms-ai-classify]", e?.message);
    return jsonRes(FALLBACK);
  }
}
