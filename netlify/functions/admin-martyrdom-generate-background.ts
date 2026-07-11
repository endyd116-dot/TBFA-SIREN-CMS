/**
 * admin-martyrdom-generate-background — AI 산출물 생성 (INTERNAL·Background)
 *
 * 백그라운드 함수(-background)는 config.path 금지 (2026-05-26 자동체인 멈춤 근본 원인).
 *
 * POST { caseId, type, outputId?, secret }
 *   type = 'strategy' (③+⑨+⑩+⑪ 1콜 통합) | 'golden' (①) | 'criteria' (②)
 *   outputId 있으면 그 'processing' 행을 draft로 UPDATE.
 *   없으면(자동체인: analyze-bg→strategy) version++ 새 draft 행 INSERT.
 *
 * fail-closed(INTERNAL_TRIGGER_SECRET) · throw 안 함 · notify로 완료/실패 가시화.
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { analyzeStrategy, buildGoldenAdvice, checkCriteria } from "../../lib/martyrdom-ai";
import { notifyMartyrdomAdmins } from "../../lib/martyrdom-notify";

const TYPE_MAP: Record<string, string> = {
  strategy: "strategy",
  golden: "golden",
  criteria: "criteria_check",
};
const TYPE_LABEL: Record<string, string> = {
  strategy: "전략 분석",
  golden: "골든타임 제언",
  criteria: "인정요건 대조",
};

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false }), { status: 405 });
  }

  let body: any = {};
  try { body = await req.json(); } catch (_) {}

  /* 인증 (fail-closed) */
  const secret = String(body?.secret || "");
  const expected = process.env.INTERNAL_TRIGGER_SECRET || "";
  if (!expected || secret !== expected) {
    return new Response(JSON.stringify({ ok: false, error: "권한 없음" }), { status: 403 });
  }

  const caseId = Number(body?.caseId || 0);
  const type = String(body?.type || "");
  const outputId = Number(body?.outputId || 0);
  if (!caseId || !TYPE_MAP[type]) {
    return new Response(JSON.stringify({ ok: false, error: "caseId·type 필수" }), { status: 400 });
  }
  const outputType = TYPE_MAP[type];

  console.info(`[martyrdom-generate-bg] start caseId=${caseId} type=${type} outputId=${outputId || "(auto)"}`);

  /* 담당 운영자 조회 (알림용) */
  let assignedAdminId: number | null = null;
  try {
    const cr: any = await db.execute(sql.raw(`SELECT assigned_admin_id AS "a" FROM martyrdom_cases WHERE id = ${caseId} LIMIT 1`));
    const row = (cr?.rows ?? cr ?? [])[0];
    if (!row) {
      return new Response(JSON.stringify({ ok: false, error: "사건 없음" }), { status: 404 });
    }
    assignedAdminId = row.a ? Number(row.a) : null;
  } catch (_) {}

  try {
    /* ── lib 호출 (type별) ── */
    let contentJson: any;
    let ragSources: any[] = [];
    let modelUsed = process.env.GEMINI_MODEL_PRO || "gemini-3-flash";

    if (type === "strategy") {
      const caseKindRes: any = await db.execute(sql.raw(`SELECT case_kind AS "k" FROM martyrdom_cases WHERE id = ${caseId} LIMIT 1`));
      const caseKind = String((caseKindRes?.rows ?? caseKindRes ?? [])[0]?.k || "active");
      const r = await analyzeStrategy(caseId, caseKind);
      contentJson = r.contentJson; ragSources = r.ragSources; modelUsed = r.modelUsed;
    } else if (type === "golden") {
      const r = await buildGoldenAdvice(caseId);
      contentJson = r.contentJson; ragSources = r.ragSources; modelUsed = r.modelUsed;
    } else { /* criteria */
      const r = await checkCriteria(caseId);
      contentJson = r.contentJson; ragSources = r.ragSources; modelUsed = r.modelUsed;
    }

    const safeJson = JSON.stringify(contentJson).replace(/'/g, "''");
    const safeRag = JSON.stringify(ragSources || []).replace(/'/g, "''");
    const safeModel = String(modelUsed || "").replace(/'/g, "''");

    /* ── 저장: outputId 있으면 UPDATE(processing→draft), 없으면 version++ INSERT ── */
    let finalOutputId = outputId;
    if (outputId) {
      await db.execute(sql.raw(`
        UPDATE martyrdom_ai_outputs
        SET content_json = '${safeJson}'::jsonb,
            rag_sources  = '${safeRag}'::jsonb,
            model_used   = '${safeModel}',
            status       = 'draft'
        WHERE id = ${outputId}
      `));
    } else {
      const verRes: any = await db.execute(sql.raw(`
        SELECT COALESCE(MAX(version), 0) AS v FROM martyrdom_ai_outputs
        WHERE case_id = ${caseId} AND output_type = '${outputType}'
      `));
      const ver = Number((verRes?.rows ?? verRes ?? [])[0]?.v || 0) + 1;
      const ins: any = await db.execute(sql.raw(`
        INSERT INTO martyrdom_ai_outputs (case_id, output_type, version, content_json, rag_sources, model_used, status, created_at)
        VALUES (${caseId}, '${outputType}', ${ver}, '${safeJson}'::jsonb, '${safeRag}'::jsonb, '${safeModel}', 'draft', NOW())
        RETURNING id
      `));
      finalOutputId = Number((ins?.rows ?? ins ?? [])[0]?.id || 0);
    }

    await notifyMartyrdomAdmins({
      caseId, assignedAdminId,
      title: "순직 지원 — AI 분석 완료",
      message: `[${TYPE_LABEL[type]}] 초안 생성 완료 — 검토 대기`,
      severity: "info",
    });

    console.info(`[martyrdom-generate-bg] done caseId=${caseId} type=${type} outputId=${finalOutputId}`);
    return new Response(JSON.stringify({ ok: true, caseId, type, outputId: finalOutputId }), {
      headers: { "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error(`[martyrdom-generate-bg] caseId=${caseId} type=${type} 예외:`, err?.message, err?.stack);
    /* processing 행을 discarded로 표시(조용한 멈춤 방지·나 처리상태 가시화) */
    if (outputId) {
      await db.execute(sql.raw(`
        UPDATE martyrdom_ai_outputs SET status = 'discarded',
          review_note = '생성 실패: ${String(err?.message || err).replace(/'/g, "''").slice(0, 300)}'
        WHERE id = ${outputId}
      `)).catch(() => {});
    }
    await notifyMartyrdomAdmins({
      caseId, assignedAdminId,
      title: "순직 지원 — AI 분석 실패",
      message: `[${TYPE_LABEL[type] || type}] 생성 실패 — 재시도 필요`,
      severity: "warning",
    });
    return new Response(JSON.stringify({ ok: false, error: String(err?.message || err).slice(0, 300) }), { status: 500 });
  }
};
