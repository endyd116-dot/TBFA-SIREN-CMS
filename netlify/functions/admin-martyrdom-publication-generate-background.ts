/**
 * admin-martyrdom-publication-generate-background — 발간물 본문 생성 (INTERNAL·Background)
 *
 * ⚠️ 백그라운드 함수(-background)는 config.path 금지.
 *
 * POST { pubId, pubType, caseIds, blendRatio, maskLevel, secret }
 *   INTERNAL_TRIGGER_SECRET 검증 후 buildPublication 호출 → martyrdom_publications UPDATE
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { buildPublication } from "../../lib/martyrdom-ai";
import { notifyMartyrdomAdmins } from "../../lib/martyrdom-notify";

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false }), { status: 405 });
  }

  let body: any = {};
  try { body = await req.json(); } catch (_) {}

  /* INTERNAL_TRIGGER_SECRET 검증 (fail-closed) */
  const secret   = String(body?.secret || "");
  const expected = process.env.INTERNAL_TRIGGER_SECRET || "";
  if (!expected || secret !== expected) {
    return new Response(JSON.stringify({ ok: false, error: "권한 없음" }), { status: 403 });
  }

  const pubId    = Number(body?.pubId || 0);
  const pubType  = String(body?.pubType || "");
  const caseIds  = Array.isArray(body?.caseIds) ? body.caseIds.map(Number).filter((n: number) => n > 0) : [];
  const blendRatio = body?.blendRatio || { self: 70, ai: 30 };
  const maskLevel  = ["light", "medium", "full"].includes(body?.maskLevel) ? body.maskLevel : "medium";

  if (!pubId || !pubType) {
    return new Response(JSON.stringify({ ok: false, error: "pubId·pubType 필수" }), { status: 400 });
  }

  console.info(`[publication-generate-bg] start pubId=${pubId} pubType=${pubType}`);

  try {
    const result = await buildPublication(pubType, caseIds, blendRatio, maskLevel);

    const safeHtml        = result.contentHtml.replace(/'/g, "''").slice(0, 500000);
    const safeTitle       = result.title.replace(/'/g, "''").slice(0, 200);
    const contentJsonStr  = JSON.stringify(result.contentJson).replace(/'/g, "''");
    const blendRatioStr   = JSON.stringify(result.blendRatio).replace(/'/g, "''");
    const ragSourcesStr   = JSON.stringify(result.ragSources).replace(/'/g, "''");
    const reidRisk        = result.reidRisk;

    await db.execute(sql.raw(`
      UPDATE martyrdom_publications
      SET
        title        = '${safeTitle}',
        content_html = '${safeHtml}',
        content_json = '${contentJsonStr}',
        blend_ratio  = '${blendRatioStr}',
        rag_sources  = '${ragSourcesStr}',
        reid_risk    = '${reidRisk}',
        anonymized   = true,
        status       = 'draft'
      WHERE id = ${pubId}
    `));

    console.info(`[publication-generate-bg] done pubId=${pubId} reidRisk=${reidRisk}`);
    return new Response(JSON.stringify({ ok: true, pubId }), { status: 200 });
  } catch (err: any) {
    console.error(`[publication-generate-bg] 실패 pubId=${pubId}`, err?.message);
    /* ★ R41 Q2-029: 생성 실패 시 (1) 행 제목에 실패 마커 + 본문에 안내, (2) 운영자 경고 알림 — 조용한 멈춤 방지(generate-bg:136 패턴) */
    const failMsg = String(err?.message || err).replace(/'/g, "''").slice(0, 300);
    try {
      await db.execute(sql.raw(`
        UPDATE martyrdom_publications
        SET
          title = CASE WHEN title LIKE '%(생성 실패)%' THEN title ELSE title || ' (생성 실패)' END,
          content_html = '<article class="martyrdom-publication"><h1>발간물 생성 실패</h1><p>본문 자동 생성 중 오류가 발생했습니다. 재시도가 필요합니다.</p><p class="disclaimer">오류: ${failMsg}</p></article>',
          status = 'draft'
        WHERE id = ${pubId}
      `));
    } catch (markErr: any) {
      console.warn(`[publication-generate-bg] 실패 마커 기록 실패 pubId=${pubId}`, markErr?.message);
    }
    await notifyMartyrdomAdmins({
      title: "순직 지원 — 발간물 생성 실패",
      message: `발간물(#${pubId}) 본문 생성에 실패했습니다 — 재시도가 필요합니다.`,
      severity: "warning",
    });
    return new Response(JSON.stringify({
      ok: false,
      error: String(err?.message || err).slice(0, 300),
    }), { status: 500 });
  }
};
