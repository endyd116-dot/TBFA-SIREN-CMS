/**
 * admin-martyrdom-draft-outline — 유족급여신청서 목차 (§P3.2)
 *
 * POST  { caseId }                      : AI 목차 제안 생성 → 'draft' ai_outputs 행 upsert + 섹션 행 동기화
 * PATCH { caseId, outputId, sections }  : 운영자 목차 편집(추가·삭제·순서·제목·intent) 저장
 *
 * 응답:
 *   POST  { ok, outputId, outputType:'draft', status:'draft', outline:{ sections:[{sectionKey,title,intent,order}] } }
 *   PATCH { ok, outputId, outline:{ sections } }
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { logAdminAction } from "../../lib/audit";
import { draftOutline, OutlineSection } from "../../lib/martyrdom-ai";

export const config = { path: "/api/admin-martyrdom-draft-outline" };

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
function safeKey(v: any, fallback: string): string {
  const k = String(v || "").trim().replace(/[^a-z0-9_]/gi, "_").slice(0, 40);
  return k || fallback;
}

/* 최신 'draft' ai_outputs 행 — 없으면 version 1로 생성 */
async function ensureDraftOutput(caseId: number): Promise<number> {
  const r: any = await db.execute(sql.raw(`
    SELECT id FROM martyrdom_ai_outputs
    WHERE case_id = ${caseId} AND output_type = 'draft'
    ORDER BY version DESC, id DESC LIMIT 1
  `));
  const row = (r?.rows ?? r ?? [])[0];
  if (row) return Number(row.id);
  const ins: any = await db.execute(sql.raw(`
    INSERT INTO martyrdom_ai_outputs (case_id, output_type, version, status, created_at)
    VALUES (${caseId}, 'draft', 1, 'draft', NOW())
    RETURNING id
  `));
  return Number((ins?.rows ?? ins ?? [])[0]?.id || 0);
}

/* content_json.outline 저장 + 섹션 행 동기화 (sectionKey 기준 upsert·기존 content 보존) */
async function saveOutline(caseId: number, outputId: number, sections: OutlineSection[]) {
  const contentJson = { outline: { sections }, generatedAt: new Date().toISOString() };
  await db.execute(sql.raw(`
    UPDATE martyrdom_ai_outputs
    SET content_json = ${q(JSON.stringify(contentJson))}::jsonb, status = 'draft'
    WHERE id = ${outputId}
  `));

  /* 기존 섹션 키 */
  const exRes: any = await db.execute(sql.raw(`
    SELECT section_key AS "sectionKey" FROM martyrdom_draft_sections WHERE output_id = ${outputId}
  `));
  const existingKeys = new Set<string>((exRes?.rows ?? exRes ?? []).map((x: any) => String(x.sectionKey)));
  const incomingKeys = new Set<string>(sections.map(s => s.sectionKey));

  /* upsert */
  for (const sec of sections) {
    if (existingKeys.has(sec.sectionKey)) {
      await db.execute(sql.raw(`
        UPDATE martyrdom_draft_sections
        SET title = ${q(sec.title)}, intent = ${q(sec.intent || "")}, section_order = ${sec.order}, updated_at = NOW()
        WHERE output_id = ${outputId} AND section_key = ${q(sec.sectionKey)}
      `));
    } else {
      await db.execute(sql.raw(`
        INSERT INTO martyrdom_draft_sections
          (case_id, output_id, section_key, title, section_order, intent, status, word_count, created_at, updated_at)
        VALUES
          (${caseId}, ${outputId}, ${q(sec.sectionKey)}, ${q(sec.title)}, ${sec.order}, ${q(sec.intent || "")}, 'pending', 0, NOW(), NOW())
      `));
    }
  }
  /* 목차에서 빠진 섹션 삭제 */
  const toDelete = [...existingKeys].filter(k => !incomingKeys.has(k));
  if (toDelete.length) {
    const list = toDelete.map(k => q(k)).join(",");
    await db.execute(sql.raw(`
      DELETE FROM martyrdom_draft_sections WHERE output_id = ${outputId} AND section_key IN (${list})
    `));
  }
}

export default async (req: Request, _ctx: Context) => {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  const { admin, member } = auth.ctx;

  /* ─────────── POST — AI 목차 제안 ─────────── */
  if (req.method === "POST") {
    let body: any;
    try { body = await req.json(); } catch { return badRequest("요청 본문 파싱 실패"); }
    const caseId = Number(body.caseId);
    if (!caseId) return badRequest("caseId 필수");

    try {
      const cr: any = await db.execute(sql.raw(`SELECT id FROM martyrdom_cases WHERE id = ${caseId} LIMIT 1`));
      if (!(cr?.rows ?? cr ?? []).length) {
        return new Response(JSON.stringify({ ok: false, error: "사건을 찾을 수 없습니다" }), {
          status: 404, headers: { "Content-Type": "application/json" },
        });
      }

      const result = await draftOutline(caseId);
      const sections = result.contentJson.sections;
      const outputId = await ensureDraftOutput(caseId);
      await saveOutline(caseId, outputId, sections);

      void logAdminAction(req, admin.uid, member.name || String(admin.uid), "martyrdom_draft_outline", {
        target: String(caseId), detail: { sections: sections.length },
      });

      return new Response(JSON.stringify({
        ok: true, outputId, outputType: "draft", status: "draft",
        outline: { sections },
      }), { headers: { "Content-Type": "application/json" } });
    } catch (err: any) {
      return jsonError("outline_generate", err);
    }
  }

  /* ─────────── PATCH — 운영자 목차 편집 ─────────── */
  if (req.method === "PATCH") {
    let body: any;
    try { body = await req.json(); } catch { return badRequest("요청 본문 파싱 실패"); }
    const caseId = Number(body.caseId);
    const outputId = Number(body.outputId);
    const rawSections = Array.isArray(body.sections) ? body.sections : null;
    if (!caseId) return badRequest("caseId 필수");
    if (!outputId) return badRequest("outputId 필수");
    if (!rawSections || rawSections.length === 0) return badRequest("sections 필수");

    try {
      const sections: OutlineSection[] = rawSections.map((x: any, i: number) => ({
        sectionKey: safeKey(x.sectionKey, `sec${i + 1}`),
        title: String(x.title || "").slice(0, 200),
        intent: String(x.intent || "").slice(0, 1000),
        order: Number(x.order) || i + 1,
      })).filter((x: OutlineSection) => x.title)
        .sort((a: OutlineSection, b: OutlineSection) => a.order - b.order);

      if (sections.length === 0) return badRequest("유효한 섹션이 없습니다");

      await saveOutline(caseId, outputId, sections);

      void logAdminAction(req, admin.uid, member.name || String(admin.uid), "martyrdom_draft_outline_edit", {
        target: String(caseId), detail: { sections: sections.length },
      });

      return new Response(JSON.stringify({ ok: true, outputId, outline: { sections } }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (err: any) {
      return jsonError("outline_edit", err);
    }
  }

  return new Response(JSON.stringify({ ok: false, error: "POST·PATCH만 허용" }), { status: 405 });
};
