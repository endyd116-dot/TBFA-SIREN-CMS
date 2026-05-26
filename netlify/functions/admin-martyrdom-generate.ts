/**
 * admin-martyrdom-generate — AI 산출물 생성 버튼 디스패처 (§P2.2)
 *
 * POST { caseId, type }
 *   type = 'strategy' | 'golden' | 'criteria'  : ai_outputs 'processing' 행 INSERT(version++) +
 *                                                generate-background 트리거 → 백그라운드가 draft로 채움
 *   type = 'readiness'                          : 규칙 계산(inline·재현 가능) → ai_outputs(readiness) draft 즉시 저장·반환
 *
 * 응답: 비동기 type → { ok, queued:true, outputId, status:'processing' }
 *       readiness   → { ok, output:{ id, outputType, version, contentJson, status } }
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { logAdminAction } from "../../lib/audit";
import { computeReadiness } from "../../lib/martyrdom-ai";

export const config = { path: "/api/admin-martyrdom-generate" };

/* type → ai_outputs.output_type */
const TYPE_MAP: Record<string, string> = {
  strategy: "strategy",
  golden: "golden",
  criteria: "criteria_check",
  readiness: "readiness",
};

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "처리 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}
function badRequest(msg: string) {
  return new Response(JSON.stringify({ ok: false, error: msg }), {
    status: 400, headers: { "Content-Type": "application/json" },
  });
}

async function nextVersion(caseId: number, outputType: string): Promise<number> {
  const r: any = await db.execute(sql.raw(`
    SELECT COALESCE(MAX(version), 0) AS v FROM martyrdom_ai_outputs
    WHERE case_id = ${caseId} AND output_type = '${outputType}'
  `));
  return Number((r?.rows ?? r ?? [])[0]?.v || 0) + 1;
}

/* generate-background 트리거 (await로 요청 전송 보장·5313ce8) */
async function triggerGenerate(caseId: number, type: string, outputId: number): Promise<{ bgStatus: number; bgError?: string }> {
  const base = process.env.URL || process.env.SITE_URL || "https://tbfa-siren-cms.netlify.app";
  const baseUrl = base.startsWith("http") ? base : `https://${base}`;
  const secret = process.env.INTERNAL_TRIGGER_SECRET || "";
  try {
    const resp = await fetch(`${baseUrl}/.netlify/functions/admin-martyrdom-generate-background`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId, type, outputId, secret }),
    });
    if (resp.status !== 202 && resp.status !== 200) {
      return { bgStatus: resp.status, bgError: (await resp.text().catch(() => "")).slice(0, 200) };
    }
    return { bgStatus: resp.status };
  } catch (err: any) {
    return { bgStatus: 0, bgError: String(err?.message || err).slice(0, 200) };
  }
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "POST만 허용" }), { status: 405 });
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  const { admin, member } = auth.ctx;

  let body: any;
  try { body = await req.json(); } catch { return badRequest("요청 본문 파싱 실패"); }

  const caseId = Number(body.caseId);
  const type = String(body.type || "");
  if (!caseId) return badRequest("caseId 필수");
  if (!TYPE_MAP[type]) return badRequest("type은 strategy|golden|criteria|readiness 중 하나");
  const outputType = TYPE_MAP[type];

  try {
    /* 사건 존재 확인 */
    const cr: any = await db.execute(sql.raw(`SELECT id FROM martyrdom_cases WHERE id = ${caseId} LIMIT 1`));
    if (!(cr?.rows ?? cr ?? []).length) {
      return new Response(JSON.stringify({ ok: false, error: "사건을 찾을 수 없습니다" }), {
        status: 404, headers: { "Content-Type": "application/json" },
      });
    }

    void logAdminAction(req, admin.uid, member.name || String(admin.uid), "martyrdom_generate", {
      target: String(caseId), detail: { type },
    });

    /* ── readiness: 규칙 계산 inline + 저장 ── */
    if (type === "readiness") {
      const result = await computeReadiness(caseId);
      const ver = await nextVersion(caseId, "readiness");
      const safeJson = JSON.stringify(result.contentJson).replace(/'/g, "''");
      const ins: any = await db.execute(sql.raw(`
        INSERT INTO martyrdom_ai_outputs (case_id, output_type, version, content_json, model_used, status, created_at)
        VALUES (${caseId}, 'readiness', ${ver}, '${safeJson}'::jsonb,
                '${(result.modelUsed || "rule+ai").replace(/'/g, "''")}', 'draft', NOW())
        RETURNING id
      `));
      const outputId = Number((ins?.rows ?? ins ?? [])[0]?.id || 0);
      return new Response(JSON.stringify({
        ok: true,
        output: { id: outputId, outputType: "readiness", version: ver, contentJson: result.contentJson, status: "draft" },
      }), { headers: { "Content-Type": "application/json" } });
    }

    /* ── strategy / golden / criteria: processing 행 + background ── */
    const ver = await nextVersion(caseId, outputType);
    const ins: any = await db.execute(sql.raw(`
      INSERT INTO martyrdom_ai_outputs (case_id, output_type, version, status, created_at)
      VALUES (${caseId}, '${outputType}', ${ver}, 'processing', NOW())
      RETURNING id
    `));
    const outputId = Number((ins?.rows ?? ins ?? [])[0]?.id || 0);

    const bg = await triggerGenerate(caseId, type, outputId);

    return new Response(JSON.stringify({
      ok: true, queued: true, outputId, outputType, version: ver, status: "processing",
      bgStatus: bg.bgStatus, bgError: bg.bgError || undefined,
    }), { headers: { "Content-Type": "application/json" } });

  } catch (err: any) {
    return jsonError("generate", err);
  }
};
