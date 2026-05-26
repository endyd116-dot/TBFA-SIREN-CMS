/**
 * admin-martyrdom-readiness — ⑫ 보고서 준비도 게이지 (규칙 % 계산 + AI 첨언)
 *
 * POST { caseId }
 *   computeReadiness(caseId): 요건40·증거30·타임라인15·모순15 가중 합산(규칙·재현 가능)
 *   + AI 첨언 1콜(정성·숫자 금지) → ai_outputs(readiness) draft 저장·반환
 *
 * 응답: { ok, output:{ id, outputType:'readiness', version, contentJson, status } }
 *   contentJson 키: score·breakdown·max·gaps·aiNote·label (§P2.2 계약 고정)
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { logAdminAction } from "../../lib/audit";
import { computeReadiness } from "../../lib/martyrdom-ai";

export const config = { path: "/api/admin-martyrdom-readiness" };

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "처리 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "POST만 허용" }), { status: 405 });
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  const { admin, member } = auth.ctx;

  let body: any;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ ok: false, error: "요청 본문 파싱 실패" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const caseId = Number(body.caseId);
  if (!caseId) {
    return new Response(JSON.stringify({ ok: false, error: "caseId 필수" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const cr: any = await db.execute(sql.raw(`SELECT id FROM martyrdom_cases WHERE id = ${caseId} LIMIT 1`));
    if (!(cr?.rows ?? cr ?? []).length) {
      return new Response(JSON.stringify({ ok: false, error: "사건을 찾을 수 없습니다" }), {
        status: 404, headers: { "Content-Type": "application/json" },
      });
    }

    const result = await computeReadiness(caseId);

    const verRes: any = await db.execute(sql.raw(`
      SELECT COALESCE(MAX(version), 0) AS v FROM martyrdom_ai_outputs
      WHERE case_id = ${caseId} AND output_type = 'readiness'
    `));
    const ver = Number((verRes?.rows ?? verRes ?? [])[0]?.v || 0) + 1;
    const safeJson = JSON.stringify(result.contentJson).replace(/'/g, "''");
    const ins: any = await db.execute(sql.raw(`
      INSERT INTO martyrdom_ai_outputs (case_id, output_type, version, content_json, model_used, status, created_at)
      VALUES (${caseId}, 'readiness', ${ver}, '${safeJson}'::jsonb,
              '${(result.modelUsed || "rule+ai").replace(/'/g, "''")}', 'draft', NOW())
      RETURNING id
    `));
    const outputId = Number((ins?.rows ?? ins ?? [])[0]?.id || 0);

    void logAdminAction(req, admin.uid, member.name || String(admin.uid), "martyrdom_readiness", {
      target: String(caseId), detail: { score: result.contentJson.score },
    });

    return new Response(JSON.stringify({
      ok: true,
      output: { id: outputId, outputType: "readiness", version: ver, contentJson: result.contentJson, status: "draft" },
    }), { headers: { "Content-Type": "application/json" } });

  } catch (err: any) {
    return jsonError("readiness", err);
  }
};
