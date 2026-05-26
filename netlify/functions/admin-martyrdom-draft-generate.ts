/**
 * admin-martyrdom-draft-generate — 섹션 본문 생성 디스패처 (§P3.2)
 *
 * POST { caseId, sectionKey? }
 *   sectionKey 있으면 → 그 섹션 1개 동기 생성(draftSection) → done
 *   sectionKey 없으면 → 미생성 섹션 전체 background 큐
 *
 * 응답:
 *   1섹션 : { ok, section:{ id, sectionKey, title, content, ragSources, status, wordCount } }
 *   전체  : { ok, queued:true, total, outputId }
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { logAdminAction } from "../../lib/audit";
import { draftSection } from "../../lib/martyrdom-ai";
import { notifyMartyrdomAdmins } from "../../lib/martyrdom-notify";

export const config = { path: "/api/admin-martyrdom-draft-generate" };

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
function q(v: string): string { return `'${String(v).replace(/'/g, "''")}'`; }

async function latestDraftOutputId(caseId: number): Promise<number | null> {
  const r: any = await db.execute(sql.raw(`
    SELECT id FROM martyrdom_ai_outputs
    WHERE case_id = ${caseId} AND output_type = 'draft'
    ORDER BY version DESC, id DESC LIMIT 1
  `));
  const row = (r?.rows ?? r ?? [])[0];
  return row ? Number(row.id) : null;
}

/* draft-generate-background 트리거 (await로 전송 보장) */
async function triggerBg(caseId: number, outputId: number): Promise<{ bgStatus: number; bgError?: string }> {
  const base = process.env.URL || process.env.SITE_URL || "https://tbfa-siren-cms.netlify.app";
  const baseUrl = base.startsWith("http") ? base : `https://${base}`;
  const secret = process.env.INTERNAL_TRIGGER_SECRET || "";
  try {
    const resp = await fetch(`${baseUrl}/.netlify/functions/admin-martyrdom-draft-generate-background`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId, outputId, secret }),
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
  const sectionKey = body.sectionKey ? String(body.sectionKey) : "";
  if (!caseId) return badRequest("caseId 필수");

  try {
    const outputId = await latestDraftOutputId(caseId);
    if (!outputId) return badRequest("목차를 먼저 생성하세요 (draft 없음)");

    /* ── 1섹션 동기 생성 ── */
    if (sectionKey) {
      const secRes: any = await db.execute(sql.raw(`
        SELECT id, section_key AS "sectionKey", title, intent, section_order AS "sectionOrder"
        FROM martyrdom_draft_sections
        WHERE output_id = ${outputId} AND section_key = ${q(sectionKey)} LIMIT 1
      `));
      const secRow = (secRes?.rows ?? secRes ?? [])[0];
      if (!secRow) return badRequest("섹션을 찾을 수 없습니다");
      const sectionId = Number(secRow.id);

      /* 생성중 표시 */
      await db.execute(sql.raw(`UPDATE martyrdom_draft_sections SET status = 'generating', updated_at = NOW() WHERE id = ${sectionId}`));

      /* 앞 섹션 제목(중복 방지) */
      const priorRes: any = await db.execute(sql.raw(`
        SELECT title FROM martyrdom_draft_sections
        WHERE output_id = ${outputId} AND section_order < ${Number(secRow.sectionOrder || 0)}
        ORDER BY section_order ASC
      `));
      const priorTitles = (priorRes?.rows ?? priorRes ?? []).map((r: any) => String(r.title || ""));

      const gen = await draftSection(caseId, {
        sectionKey: String(secRow.sectionKey),
        title: String(secRow.title || ""),
        intent: secRow.intent ? String(secRow.intent) : "",
      }, priorTitles);

      const content = gen.contentJson.content;
      const ragSources = gen.contentJson.ragSources;
      const status = gen.ok ? "done" : "pending";
      const wordCount = content.length;

      await db.execute(sql.raw(`
        UPDATE martyrdom_draft_sections
        SET content = ${q(content)}, rag_sources = ${q(JSON.stringify(ragSources))}::jsonb,
            status = '${status}', word_count = ${wordCount}, updated_at = NOW()
        WHERE id = ${sectionId}
      `));

      void logAdminAction(req, admin.uid, member.name || String(admin.uid), "martyrdom_draft_section_generate", {
        target: String(caseId), detail: { sectionKey, ok: gen.ok },
      });

      if (gen.ok) {
        void notifyMartyrdomAdmins({
          caseId, title: "순직 지원 — 서면 섹션 생성 완료",
          message: `[${secRow.title}] 섹션 초안 생성 완료 — 검토 대기`, severity: "info",
        });
      }

      return new Response(JSON.stringify({
        ok: true,
        section: {
          id: sectionId, sectionKey: String(secRow.sectionKey), title: String(secRow.title || ""),
          content, ragSources, status, wordCount,
        },
      }), { headers: { "Content-Type": "application/json" } });
    }

    /* ── 전체 섹션 background 큐 ── */
    const cntRes: any = await db.execute(sql.raw(`
      SELECT COUNT(*)::int AS cnt FROM martyrdom_draft_sections
      WHERE output_id = ${outputId} AND status IN ('pending','generating')
    `));
    const total = Number((cntRes?.rows ?? cntRes ?? [])[0]?.cnt || 0);

    /* 미생성 섹션 전체 'generating' 표시(가시화) */
    await db.execute(sql.raw(`
      UPDATE martyrdom_draft_sections SET status = 'generating', updated_at = NOW()
      WHERE output_id = ${outputId} AND status = 'pending'
    `));

    const bg = await triggerBg(caseId, outputId);

    void logAdminAction(req, admin.uid, member.name || String(admin.uid), "martyrdom_draft_generate_all", {
      target: String(caseId), detail: { total },
    });

    return new Response(JSON.stringify({
      ok: true, queued: true, total, outputId,
      bgStatus: bg.bgStatus, bgError: bg.bgError || undefined,
    }), { headers: { "Content-Type": "application/json" } });

  } catch (err: any) {
    return jsonError("draft_generate", err);
  }
};
