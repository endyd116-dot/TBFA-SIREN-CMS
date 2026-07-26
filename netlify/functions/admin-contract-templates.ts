/**
 * 관리자 계약서 양식 CRUD (슈퍼어드민 전용)
 *   GET  /api/admin-contract-templates?entityId=N  — 해당 사업자 양식 목록
 *   GET  /api/admin-contract-templates?id=N        — 양식 1건(본문 포함)
 *   POST /api/admin-contract-templates { action }  — create | update | delete
 *     create: entityId, title, body
 *     update: id, title, body   (in-place 수정 — 기존 계약은 서명 당시 본문 박제라 영향 없음)
 *     delete: id                (is_active=false 소프트)
 *
 * 치환키: {{회사상호}} {{회사대표자}} {{회사사업자번호}} {{회사주소}} {{성명}} {{생년월일}} {{주소}}
 *         {{연락처}} {{주민번호}} {{계약시작일}} {{연봉}} {{월지급액}} {{지급일}} {{근무장소}}
 *         {{담당업무}} {{근무시작시각}} {{근무종료시각}} {{수습개월}} {{계약체결일}}
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-contract-templates" };
const H = { "Content-Type": "application/json; charset=utf-8" };
const ok = (data: any, message?: string) => new Response(jsonKST({ ok: true, message, data }), { status: 200, headers: H });
const bad = (msg: string, status = 400) => new Response(jsonKST({ ok: false, error: msg }), { status, headers: H });
const rows = (r: any) => (r?.rows ?? r ?? []);

export default async function handler(req: Request, _ctx: Context) {
  let step = "start";
  try {
    step = "auth";
    const auth = await requireAdmin(req);
    if (!auth.ok) return (auth as any).res;
    const me = (auth as any).ctx.member;
    if (me.role !== "super_admin") return bad("이사장(슈퍼어드민)만 가능합니다", 403);

    const url = new URL(req.url);

    if (req.method === "GET") {
      const id = url.searchParams.get("id");
      if (id) {
        step = "get_one";
        const r = await db.execute(sql`SELECT * FROM contract_templates WHERE id = ${Number(id)} LIMIT 1`);
        const t = rows(r)[0];
        if (!t) return bad("양식을 찾을 수 없습니다", 404);
        return ok(t);
      }
      step = "list";
      const entityId = url.searchParams.get("entityId");
      const where = entityId ? sql`WHERE t.entity_id = ${Number(entityId)}` : sql``;
      const list = await db.execute(sql`
        SELECT t.id, t.entity_id, t.title, t.kind, t.version, t.is_active, t.updated_at,
               e.name AS entity_name, length(t.body) AS body_len
          FROM contract_templates t
          JOIN contract_business_entities e ON e.id = t.entity_id
          ${where}
         ORDER BY t.entity_id ASC, t.version DESC`);
      return ok({ items: rows(list) });
    }

    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const action = body.action;

      if (action === "create") {
        step = "create";
        const entityId = Number(body.entityId);
        const text = String(body.body || "").trim();
        if (!entityId) return bad("사업자를 선택하세요");
        if (text.length < 20) return bad("계약서 본문을 입력하세요");
        const maxR = await db.execute(sql`SELECT COALESCE(MAX(version), 0)::int AS v FROM contract_templates WHERE entity_id = ${entityId}`);
        const nextV = (rows(maxR)[0]?.v ?? 0) + 1;
        const ins = await db.execute(sql`
          INSERT INTO contract_templates (entity_id, title, kind, body, version, is_active)
          VALUES (${entityId}, ${body.title || "근로계약서"}, ${body.kind || "employment"}, ${text}, ${nextV}, TRUE)
          RETURNING id`);
        return ok({ id: rows(ins)[0]?.id, version: nextV }, "양식을 등록했습니다");
      }

      if (action === "update") {
        step = "update";
        const id = Number(body.id);
        if (!id) return bad("id 없음");
        const text = String(body.body ?? "").trim();
        if (text.length < 20) return bad("계약서 본문을 입력하세요");
        await db.execute(sql`
          UPDATE contract_templates SET
            title = COALESCE(${body.title ?? null}, title),
            body = ${text},
            is_active = COALESCE(${body.isActive ?? null}, is_active),
            updated_at = NOW()
          WHERE id = ${id}`);
        return ok({ id }, "양식을 수정했습니다 (기존 계약서에는 영향 없음)");
      }

      if (action === "delete") {
        step = "delete";
        const id = Number(body.id);
        if (!id) return bad("id 없음");
        await db.execute(sql`UPDATE contract_templates SET is_active = FALSE, updated_at = NOW() WHERE id = ${id}`);
        return ok({ id }, "양식을 비활성화했습니다");
      }

      return bad("알 수 없는 action");
    }

    return bad("허용되지 않은 메서드", 405);
  } catch (err: any) {
    return new Response(jsonKST({ ok: false, error: "양식 처리 실패", step, detail: String(err?.message || err).slice(0, 500) }), { status: 500, headers: H });
  }
}
