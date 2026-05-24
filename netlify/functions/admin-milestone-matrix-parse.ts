import type { Context } from "@netlify/functions";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { callGeminiJSON } from "../../lib/ai-gemini";

export const config = { path: "/api/admin-milestone-matrix-parse" };

/* ③ 마일스톤 매트릭스 AI 매핑 — 파싱 엔드포인트 (읽기 전용·DB 쓰기 0)
   분기 성과 기준표(매트릭스) 텍스트를 받아 Gemini로 마일스톤 정의 후보를 추출하고,
   기존 활성 정의와의 충돌(UPDATE)·삭제 후보(orphans)를 판정해 반환한다.
   실제 적용(INSERT/UPDATE/비활성화)은 프론트가 기존 milestone-definitions API로 수행. */

const CATEGORIES = new Set(["REVENUE_LINKED", "NON_REVENUE"]);
const BUSINESS_UNITS = new Set(["ASSOCIATION", "HAMKEWORK", "PLEO", "POLICY"]);
const FORMULA_TYPES = new Set(["FLAT", "PERCENT", "BRACKET", "EVENT_RANGE"]);

function jsonError(step: string, err: any) {
  return Response.json({
    ok: false, error: "매트릭스 분석 오류", step,
    detail: String(err?.message || err).slice(0, 500),
  }, { status: 500 });
}

/** bonusFormula 객체·type 유효성 (결산 계산기와 동일 키 기준) */
function isValidFormula(f: any): boolean {
  if (!f || typeof f !== "object" || !FORMULA_TYPES.has(f.type)) return false;
  if (f.type === "FLAT")    return typeof f.unitAmount === "number";
  if (f.type === "PERCENT") return typeof f.rate === "number";
  if (f.type === "BRACKET") return Array.isArray(f.brackets) && f.brackets.length > 0;
  if (f.type === "EVENT_RANGE") return true;
  return false;
}

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  const admin = auth.ctx?.member as any;
  if (admin?.role !== "super_admin") {
    return Response.json({ ok: false, error: "슈퍼어드민 전용" }, { status: 403 });
  }
  if (req.method !== "POST") {
    return Response.json({ ok: false, error: "지원하지 않는 메서드" }, { status: 405 });
  }

  let body: any;
  try { body = await req.json(); } catch { return Response.json({ ok: false, error: "JSON 파싱 실패" }, { status: 400 }); }
  const text = String(body?.text || "").trim();
  const roleHint = body?.roleHint ? String(body.roleHint).trim() : "";
  if (text.length < 10) {
    return Response.json({ ok: false, error: "매트릭스 텍스트가 너무 짧습니다 (최소 10자)." }, { status: 400 });
  }
  if (text.length > 12000) {
    return Response.json({ ok: false, error: "매트릭스 텍스트가 너무 깁니다 (최대 12,000자). 나눠서 분석하세요." }, { status: 400 });
  }

  // 1) 기존 활성 정의 + 활성 역할 로드
  let existing: any[] = [];
  let roles: any[] = [];
  try {
    const exRows = await db.execute(sql`
      SELECT id, code, name, category, target_milestone_role,
             business_unit, revenue_source, threshold_enabled, threshold_value,
             threshold_unit, bonus_formula, quarter_applicable
        FROM milestone_definitions WHERE is_active = TRUE ORDER BY sort_order, id
    `);
    existing = ((exRows as any).rows || (exRows as any[])).map((r: any) => ({
      id: r.id, code: r.code, name: r.name, category: r.category,
      role: r.target_milestone_role, businessUnit: r.business_unit,
      revenueSource: r.revenue_source, thresholdEnabled: r.threshold_enabled,
      thresholdValue: r.threshold_value, thresholdUnit: r.threshold_unit,
      bonusFormula: r.bonus_formula, quarterApplicable: r.quarter_applicable,
    }));
  } catch (err) { return jsonError("select_definitions", err); }
  try {
    const rRows = await db.execute(sql`SELECT code, name FROM milestone_roles WHERE is_active = TRUE ORDER BY sort_order, id`);
    roles = ((rRows as any).rows || (rRows as any[])).map((r: any) => ({ code: r.code, name: r.name }));
  } catch (err) { /* 역할 로드 실패는 빈 배열로 계속 (메인 분석 가능) */ roles = []; }

  const roleCodes = new Set(roles.map((r) => r.code));
  const existingByCode = new Map(existing.map((e) => [String(e.code).toLowerCase(), e]));

  // 2) Gemini 프롬프트 — 매트릭스 → 정의 후보 + 충돌 판정
  const existingBrief = existing.map((e) =>
    `#${e.id} [${e.code}] ${e.name} | 역할:${e.role} | ${e.category} | 공식:${JSON.stringify(e.bonusFormula)}`
  ).join("\n") || "(기존 정의 없음)";
  const rolesBrief = roles.map((r) => `${r.code}=${r.name}`).join(", ") || "(역할 카탈로그 비어있음)";

  const prompt = [
    "너는 비영리단체의 분기 성과(마일스톤) 운영 담당자다. 아래 '분기 성과 기준표(매트릭스)' 텍스트를 읽고,",
    "각 성과 항목을 마일스톤 정의 후보로 구조화 추출하라. 그리고 '기존 정의 목록'과 겹치는지 판정하라.",
    "",
    "[활성 역할 코드] (targetMilestoneRole 은 반드시 이 중 하나, 표의 역할명을 코드로 매핑):",
    rolesBrief,
    roleHint ? `\n[힌트] 이 매트릭스는 주로 역할 '${roleHint}' 대상이다. 명시 없는 항목은 이 역할로.` : "",
    "",
    "[기존 정의 목록] (matchExistingId 로 충돌 표시):",
    existingBrief,
    "",
    "[분기 성과 기준표(매트릭스) — 사용자 붙여넣기]:",
    text,
    "",
    "[bonusFormula 규칙] — 표의 보상 문구를 다음 JSON 중 하나로:",
    '- 건당 정액 "1건당 N원" → {"type":"FLAT","unitAmount":N}',
    '- 비율 "매출의 N%" → {"type":"PERCENT","rate":소수}  (5% → 0.05)',
    '- 구간별 "X원~Y원 구간 Z원" → {"type":"BRACKET","brackets":[{"min":X,"max":Y,"amount":Z}]}  (상한없으면 max:null)',
    '- 행사·이벤트 등 어드민이 건별 금액 결정 → {"type":"EVENT_RANGE"}',
    "보상 공식을 확실히 못 정하면 EVENT_RANGE 로 두고 confidence 를 낮춰라.",
    "",
    "[출력] 오직 JSON. 마크다운·설명 금지. 형식:",
    `{"candidates":[{
  "name":"마일스톤 이름",
  "code":"제안코드(영소문자-숫자, 기존 코드와 겹치지 않게. 겹치면 그 기존 코드 그대로)",
  "category":"REVENUE_LINKED|NON_REVENUE",
  "targetMilestoneRole":"역할코드",
  "businessUnit":"ASSOCIATION|HAMKEWORK|PLEO|POLICY|null",
  "revenueSource":"문자열 또는 null",
  "thresholdEnabled":true|false,
  "thresholdValue":숫자 또는 null,
  "thresholdUnit":"명|원|팀 등 또는 null",
  "bonusFormula":{...위 규칙...},
  "quarterApplicable":"Q1|Q2|Q3|Q4|ALL|null",
  "confidence":0.0~1.0,
  "matchExistingId":기존정의id 또는 null,
  "action":"NEW|UPDATE|KEEP",
  "reason":"판단 근거 한 줄"
}]}`,
    "action 규칙: 기존에 없으면 NEW(matchExistingId=null). 기존과 같은 항목인데 값이 바뀌면 UPDATE(matchExistingId=해당id). 기존과 동일하면 KEEP.",
  ].filter(Boolean).join("\n");

  let parsed: any;
  let modelUsed = "";
  try {
    const r = await callGeminiJSON<{ candidates: any[] }>(prompt, {
      featureKey: "milestone_matrix_mapping",
      mode: "pro",
      maxOutputTokens: 4000,
      temperature: 0.2,
      adminId: admin?.id ?? null,
    });
    if (!r.ok || !r.data) {
      return Response.json({ ok: false, error: r.error || "AI 분석 실패", step: "ai" }, { status: 502 });
    }
    parsed = r.data;
    modelUsed = r.modelUsed || "";
  } catch (err) { return jsonError("ai", err); }

  // 3) 결정론적 후처리 — AI 출력 신뢰하지 않고 검증·정규화
  const rawCands: any[] = Array.isArray(parsed?.candidates) ? parsed.candidates : [];
  const seenCodes = new Set<string>();
  const candidates = rawCands.map((c: any, i: number) => {
    const flags: string[] = [];
    let confidence = typeof c.confidence === "number" ? Math.max(0, Math.min(1, c.confidence)) : 0.5;

    // 카테고리
    let category = String(c.category || "").toUpperCase();
    if (!CATEGORIES.has(category)) { category = "NON_REVENUE"; flags.push("카테고리 추정"); confidence = Math.min(confidence, 0.6); }

    // 역할
    let role = String(c.targetMilestoneRole || roleHint || "").trim();
    if (!roleCodes.has(role)) { flags.push("역할 미확인"); confidence = Math.min(confidence, 0.5); }

    // 사업체
    let bu = c.businessUnit == null ? null : String(c.businessUnit).toUpperCase();
    if (bu && !BUSINESS_UNITS.has(bu)) bu = null;

    // 공식
    let formula = c.bonusFormula;
    if (!isValidFormula(formula)) { formula = { type: "EVENT_RANGE" }; flags.push("공식 추정(검토 요망)"); confidence = Math.min(confidence, 0.55); }

    // 코드 — 기존 충돌·내부 중복 정규화
    let code = String(c.code || "").trim().toLowerCase().replace(/[^a-z0-9\-]/g, "-").slice(0, 20);
    if (!code) { code = `ms-${Date.now().toString(36)}-${i}`.slice(0, 20); flags.push("코드 자동 생성"); }

    // 충돌 판정 — 코드 또는 AI가 준 matchExistingId
    let matchExistingId: number | null =
      typeof c.matchExistingId === "number" ? c.matchExistingId : null;
    const byCode = existingByCode.get(code);
    if (byCode) matchExistingId = byCode.id;
    const matched = matchExistingId != null ? existing.find((e) => e.id === matchExistingId) : null;
    if (matchExistingId != null && !matched) matchExistingId = null; // 환각 id 방어

    let action = String(c.action || "").toUpperCase();
    if (matched) {
      if (!["UPDATE", "KEEP"].includes(action)) action = "UPDATE";
    } else {
      action = "NEW";
      // NEW인데 코드가 기존과 겹치면 위 byCode에서 이미 matched 처리됨
    }

    // 내부 중복 코드 회피
    if (action === "NEW") {
      let unique = code; let n = 1;
      while (seenCodes.has(unique) || existingByCode.has(unique)) { unique = `${code}-${n++}`.slice(0, 20); }
      code = unique;
    }
    seenCodes.add(code);

    // 자동 적용 가능 여부 (고신뢰·충돌 없음·검토 플래그 없음)
    const autoApply = action === "NEW" && confidence >= 0.8 && flags.length === 0;

    return {
      tempId: `c${i}`,
      name: String(c.name || "").slice(0, 200),
      code,
      category,
      targetMilestoneRole: role,
      businessUnit: bu,
      revenueSource: c.revenueSource ? String(c.revenueSource).slice(0, 100) : null,
      thresholdEnabled: !!c.thresholdEnabled,
      thresholdValue: c.thresholdValue == null ? null : Number(c.thresholdValue),
      thresholdUnit: c.thresholdUnit ? String(c.thresholdUnit).slice(0, 30) : null,
      bonusFormula: formula,
      quarterApplicable: c.quarterApplicable ? String(c.quarterApplicable).slice(0, 5) : null,
      confidence,
      matchExistingId,
      matchExisting: matched ? { id: matched.id, code: matched.code, name: matched.name, role: matched.role, category: matched.category, bonusFormula: matched.bonusFormula } : null,
      action,
      autoApply,
      flags,
      reason: c.reason ? String(c.reason).slice(0, 200) : "",
    };
  }).filter((c: any) => c.name);

  // 4) orphans — 활성 기존 정의 중 어떤 후보에도 매칭 안 된 것 (삭제 후보)
  const matchedIds = new Set(candidates.map((c: any) => c.matchExistingId).filter((x: any) => x != null));
  const orphans = existing
    .filter((e) => !matchedIds.has(e.id))
    .map((e) => ({ id: e.id, code: e.code, name: e.name, role: e.role, category: e.category }));

  const summary = {
    total: candidates.length,
    autoApply: candidates.filter((c: any) => c.autoApply).length,
    conflicts: candidates.filter((c: any) => c.action === "UPDATE").length,
    keep: candidates.filter((c: any) => c.action === "KEEP").length,
    needsReview: candidates.filter((c: any) => !c.autoApply && c.action === "NEW").length,
    orphans: orphans.length,
  };

  return Response.json({ ok: true, data: { candidates, orphans, existingCount: existing.length, modelUsed, summary } });
}
