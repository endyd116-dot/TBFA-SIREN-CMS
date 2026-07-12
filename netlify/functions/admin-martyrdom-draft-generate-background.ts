/**
 * admin-martyrdom-draft-generate-background — 섹션 순차 생성 (INTERNAL·Background)
 *
 * 백그라운드 함수(-background)는 config.path 금지.
 *
 * POST { caseId, outputId, secret }
 *   'generating' 상태 섹션을 순서대로 draftSection 생성 → done(성공)·pending(실패·재시도 가능).
 *   실패해도 throw 안 함. 완료 알림으로 가시화(나 처리상태).
 *
 * fail-closed(INTERNAL_TRIGGER_SECRET).
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { draftSection } from "../../lib/martyrdom-ai";
import { notifyMartyrdomAdmins } from "../../lib/martyrdom-notify";

function q(v: string): string { return `'${String(v).replace(/'/g, "''")}'`; }

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "POST") {
    return new Response(jsonKST({ ok: false }), { status: 405 });
  }

  let body: any = {};
  try { body = await req.json(); } catch (_) {}

  const secret = String(body?.secret || "");
  const expected = process.env.INTERNAL_TRIGGER_SECRET || "";
  if (!expected || secret !== expected) {
    return new Response(jsonKST({ ok: false, error: "권한 없음" }), { status: 403 });
  }

  const caseId = Number(body?.caseId || 0);
  const outputId = Number(body?.outputId || 0);
  if (!caseId || !outputId) {
    return new Response(jsonKST({ ok: false, error: "caseId·outputId 필수" }), { status: 400 });
  }

  console.info(`[martyrdom-draft-gen-bg] start caseId=${caseId} outputId=${outputId}`);

  try {
    /* 전체 섹션 제목(앞 섹션 중복 방지용) */
    const allRes: any = await db.execute(sql.raw(`
      SELECT id, section_key AS "sectionKey", title, intent, section_order AS "sectionOrder", status
      FROM martyrdom_draft_sections
      WHERE output_id = ${outputId}
      ORDER BY section_order ASC, id ASC
    `));
    const all = (allRes?.rows ?? allRes ?? []).map((r: any) => ({
      id: Number(r.id),
      sectionKey: String(r.sectionKey || ""),
      title: String(r.title || ""),
      intent: r.intent ? String(r.intent) : "",
      order: Number(r.sectionOrder || 0),
      status: String(r.status || "pending"),
    }));

    const targets = all.filter(s => s.status === "generating");
    let done = 0, failed = 0;

    for (const sec of targets) {
      const priorTitles = all.filter(s => s.order < sec.order).map(s => s.title);
      try {
        const gen = await draftSection(caseId, { sectionKey: sec.sectionKey, title: sec.title, intent: sec.intent }, priorTitles);
        const content = gen.contentJson.content;
        const ragSources = gen.contentJson.ragSources;
        const status = gen.ok ? "done" : "pending";
        if (gen.ok) done++; else failed++;
        await db.execute(sql.raw(`
          UPDATE martyrdom_draft_sections
          SET content = ${q(content)}, rag_sources = ${q(JSON.stringify(ragSources))}::jsonb,
              status = '${status}', word_count = ${content.length}, updated_at = NOW()
          WHERE id = ${sec.id}
        `));
      } catch (secErr: any) {
        failed++;
        await db.execute(sql.raw(`
          UPDATE martyrdom_draft_sections
          SET content = ${q(`(섹션 생성 실패: ${String(secErr?.message || secErr).slice(0, 120)}) — [재생성] 또는 직접 작성하세요.`)},
              status = 'pending', updated_at = NOW()
          WHERE id = ${sec.id}
        `)).catch(() => {});
        console.warn(`[martyrdom-draft-gen-bg] 섹션 ${sec.sectionKey} 실패: ${secErr?.message}`);
      }
    }

    await notifyMartyrdomAdmins({
      caseId,
      title: failed === 0 ? "순직 지원 — 서면 초안 생성 완료" : "순직 지원 — 서면 초안 일부 실패",
      message: `유족급여신청서 섹션 ${done}개 생성 완료${failed ? `, ${failed}개 실패(재생성 필요)` : ""} — 검토 대기`,
      severity: failed === 0 ? "info" : "warning",
    });

    console.info(`[martyrdom-draft-gen-bg] done caseId=${caseId} outputId=${outputId} done=${done} failed=${failed}`);
    return new Response(jsonKST({ ok: true, caseId, outputId, done, failed }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error(`[martyrdom-draft-gen-bg] caseId=${caseId} 예외:`, err?.message, err?.stack);
    return new Response(jsonKST({ ok: false, error: String(err?.message || err).slice(0, 300) }), { status: 500 });
  }
};
