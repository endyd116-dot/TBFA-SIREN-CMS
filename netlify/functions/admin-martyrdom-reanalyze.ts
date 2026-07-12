/**
 * admin-martyrdom-reanalyze — 사건 AI 분석 수동 재실행
 *
 * POST { caseId }
 *   → analyze-background 트리거 (fire-and-forget)
 *   → { ok, caseId, analyzeQueued: true }
 *
 * 자동 체인과 별개로 운영자가 수동으로 재분석을 요청할 때 사용
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";

export const config = { path: "/api/admin-martyrdom-reanalyze" };

/* background 호출은 await로 요청 전송을 보장(미await 시 함수 종료로 fetch가 취소됨·5313ce8). */
async function triggerAnalyze(caseId: number): Promise<{ bgStatus: number; bgError?: string }> {
  const base = process.env.URL || process.env.SITE_URL || "https://tbfa-siren-cms.netlify.app";
  const baseUrl = base.startsWith("http") ? base : `https://${base}`;
  const secret = process.env.INTERNAL_TRIGGER_SECRET || "";
  try {
    const resp = await fetch(`${baseUrl}/.netlify/functions/admin-martyrdom-analyze-background`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId, secret }),
    });
    if (resp.status !== 202 && resp.status !== 200) {
      return { bgStatus: resp.status, bgError: (await resp.text().catch(() => "")).slice(0, 200) };
    }
    return { bgStatus: resp.status };
  } catch (err: any) {
    console.warn("[martyrdom-reanalyze trigger]", err?.message || err);
    return { bgStatus: 0, bgError: String(err?.message || err).slice(0, 200) };
  }
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "POST") {
    return new Response(jsonKST({ ok: false, error: "POST만 허용" }), { status: 405 });
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  let body: any;
  try { body = await req.json(); } catch {
    return new Response(jsonKST({ ok: false, error: "요청 본문 파싱 실패" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const caseId = Number(body.caseId);
  if (!caseId) {
    return new Response(jsonKST({ ok: false, error: "caseId 필수" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  try {
    /* 사건 존재 확인 */
    const r: any = await db.execute(sql.raw(`
      SELECT id FROM martyrdom_cases WHERE id = ${caseId} LIMIT 1
    `));
    if (!(r?.rows ?? r ?? []).length) {
      return new Response(jsonKST({ ok: false, error: "사건을 찾을 수 없습니다" }), {
        status: 404, headers: { "Content-Type": "application/json" },
      });
    }

    const bg = await triggerAnalyze(caseId);

    return new Response(jsonKST({
      ok: true,
      caseId,
      analyzeQueued: true,
      bgStatus: bg.bgStatus,
      bgError: bg.bgError || undefined,
    }), { headers: { "Content-Type": "application/json" } });

  } catch (err: any) {
    return new Response(jsonKST({
      ok: false, error: "처리 실패",
      detail: String(err?.message || err).slice(0, 500),
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};
