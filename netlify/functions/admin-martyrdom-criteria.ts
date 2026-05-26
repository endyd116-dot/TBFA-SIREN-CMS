/**
 * admin-martyrdom-criteria — 인정요건 master CRUD (② 요건 대조 기준)
 *
 * GET                       : 요건 목록 (admin·읽기) ?active=1 필터
 * POST   {code,category,title,description?,evidenceHint?,lawRef?,weight?,sortOrder?,active?} : 생성 (super_admin)
 * PATCH  {id, ...필드}       : 수정 (super_admin)
 * DELETE ?id=N              : 삭제 (super_admin)
 *
 * 쓰기는 super_admin 전용(외부 발간·심사 기준 변경 책임).
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { requireRole, roleForbidden } from "../../lib/admin-role";
import { logAdminAction } from "../../lib/audit";

export const config = { path: "/api/admin-martyrdom-criteria" };

function jsonOk(data: object) {
  return new Response(JSON.stringify({ ok: true, ...data }), { headers: { "Content-Type": "application/json" } });
}
function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "처리 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}
function badRequest(msg: string) {
  return new Response(JSON.stringify({ ok: false, error: msg }), { status: 400, headers: { "Content-Type": "application/json" } });
}
const q = (v: any, max: number) => `'${String(v).slice(0, max).replace(/'/g, "''")}'`;

export default async (req: Request, _ctx: Context) => {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  const { admin, member } = auth.ctx;
  const method = req.method;

  /* ── GET: 목록 (admin 읽기) ── */
  if (method === "GET") {
    try {
      const url = new URL(req.url);
      const activeOnly = url.searchParams.get("active") === "1";
      const where = activeOnly ? "WHERE active = true" : "";
      const r: any = await db.execute(sql.raw(`
        SELECT id, code, category, title, description, evidence_hint AS "evidenceHint",
               law_ref AS "lawRef", weight, sort_order AS "sortOrder", active,
               created_at AS "createdAt", updated_at AS "updatedAt"
        FROM martyrdom_criteria ${where}
        ORDER BY sort_order ASC, id ASC
      `));
      const criteria = (r?.rows ?? r ?? []).map((c: any) => ({
        id: Number(c.id), code: String(c.code), category: String(c.category || ""),
        title: String(c.title || ""), description: c.description ? String(c.description) : null,
        evidenceHint: c.evidenceHint ? String(c.evidenceHint) : null,
        lawRef: c.lawRef ? String(c.lawRef) : null,
        weight: Number(c.weight || 1), sortOrder: Number(c.sortOrder || 0), active: Boolean(c.active),
        createdAt: c.createdAt ? new Date(c.createdAt).toISOString() : null,
      }));
      return jsonOk({ criteria, total: criteria.length });
    } catch (err: any) { return jsonError("list", err); }
  }

  /* ── 쓰기: super_admin 전용 ── */
  if (method === "POST" || method === "PATCH" || method === "DELETE") {
    if (!requireRole(member, "super_admin")) return roleForbidden("super_admin");
  }

  if (method === "POST") {
    let body: any;
    try { body = await req.json(); } catch { return badRequest("요청 본문 파싱 실패"); }
    const code = String(body.code || "").trim();
    const category = String(body.category || "").trim();
    const title = String(body.title || "").trim();
    if (!code || !category || !title) return badRequest("code·category·title 필수");
    try {
      const ins: any = await db.execute(sql.raw(`
        INSERT INTO martyrdom_criteria (code, category, title, description, evidence_hint, law_ref, weight, sort_order, active, updated_at)
        VALUES (${q(code, 50)}, ${q(category, 60)}, ${q(title, 200)},
                ${body.description ? q(body.description, 2000) : "NULL"},
                ${body.evidenceHint ? q(body.evidenceHint, 2000) : "NULL"},
                ${body.lawRef ? q(body.lawRef, 300) : "NULL"},
                ${Number(body.weight) || 1}, ${Number(body.sortOrder) || 0},
                ${body.active === false ? "false" : "true"}, NOW())
        ON CONFLICT (code) DO NOTHING
        RETURNING id
      `));
      const row = (ins?.rows ?? ins ?? [])[0];
      if (!row) return badRequest(`이미 존재하는 code: ${code}`);
      void logAdminAction(req, admin.uid, member.name || String(admin.uid), "martyrdom_criteria_create", { target: code });
      return jsonOk({ id: Number(row.id), code });
    } catch (err: any) { return jsonError("insert", err); }
  }

  if (method === "PATCH") {
    let body: any;
    try { body = await req.json(); } catch { return badRequest("요청 본문 파싱 실패"); }
    const id = Number(body.id);
    if (!id) return badRequest("id 필수");
    const sets: string[] = [];
    if (body.category !== undefined)     sets.push(`category = ${q(body.category, 60)}`);
    if (body.title !== undefined)        sets.push(`title = ${q(body.title, 200)}`);
    if (body.description !== undefined)  sets.push(`description = ${body.description ? q(body.description, 2000) : "NULL"}`);
    if (body.evidenceHint !== undefined) sets.push(`evidence_hint = ${body.evidenceHint ? q(body.evidenceHint, 2000) : "NULL"}`);
    if (body.lawRef !== undefined)       sets.push(`law_ref = ${body.lawRef ? q(body.lawRef, 300) : "NULL"}`);
    if (body.weight !== undefined)       sets.push(`weight = ${Number(body.weight) || 1}`);
    if (body.sortOrder !== undefined)    sets.push(`sort_order = ${Number(body.sortOrder) || 0}`);
    if (body.active !== undefined)       sets.push(`active = ${body.active ? "true" : "false"}`);
    if (sets.length === 0) return badRequest("변경할 필드 없음");
    sets.push("updated_at = NOW()");
    try {
      await db.execute(sql.raw(`UPDATE martyrdom_criteria SET ${sets.join(", ")} WHERE id = ${id}`));
      void logAdminAction(req, admin.uid, member.name || String(admin.uid), "martyrdom_criteria_update", { target: String(id) });
      return jsonOk({ id });
    } catch (err: any) { return jsonError("update", err); }
  }

  if (method === "DELETE") {
    const url = new URL(req.url);
    const id = Number(url.searchParams.get("id"));
    if (!id) return badRequest("id 필수");
    try {
      await db.execute(sql.raw(`DELETE FROM martyrdom_criteria WHERE id = ${id}`));
      void logAdminAction(req, admin.uid, member.name || String(admin.uid), "martyrdom_criteria_delete", { target: String(id) });
      return jsonOk({ id });
    } catch (err: any) { return jsonError("delete", err); }
  }

  return new Response(JSON.stringify({ ok: false, error: "지원하지 않는 메서드" }), { status: 405 });
};
