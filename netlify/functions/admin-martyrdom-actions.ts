/**
 * admin-martyrdom-actions — 부족 증거 → 확보 액션 CRUD (보완③ P2 추적)
 *
 * GET    ?caseId=N            : 사건별 액션 목록 (sort_order·생성순)
 * POST   {caseId,item,detail?,source?,dueDate?} : 생성 (source=missing_evidence|manual)
 * PATCH  {id, item?,detail?,status?,dueDate?,sortOrder?} : 수정 (status: todo|doing|done)
 * DELETE ?id=N                : 삭제
 *
 * 전략 분석의 missingEvidence 항목을 [+ 액션 추가] 로 등록(source='missing_evidence').
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { logAdminAction } from "../../lib/audit";

export const config = { path: "/api/admin-martyrdom-actions" };

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

  if (method === "GET") {
    const url = new URL(req.url);
    const caseId = Number(url.searchParams.get("caseId"));
    if (!caseId) return badRequest("caseId 필수");
    try {
      const r: any = await db.execute(sql.raw(`
        SELECT id, case_id AS "caseId", item, detail, status, source,
               due_date AS "dueDate", workspace_task_id AS "workspaceTaskId",
               sort_order AS "sortOrder", created_at AS "createdAt"
        FROM martyrdom_actions WHERE case_id = ${caseId}
        ORDER BY sort_order ASC, id ASC
      `));
      const actions = (r?.rows ?? r ?? []).map((a: any) => ({
        id: Number(a.id), caseId: Number(a.caseId),
        item: String(a.item || ""), detail: a.detail ? String(a.detail) : null,
        status: String(a.status || "todo"), source: String(a.source || "manual"),
        dueDate: a.dueDate ? String(a.dueDate).slice(0, 10) : null,
        workspaceTaskId: a.workspaceTaskId ? Number(a.workspaceTaskId) : null,
        sortOrder: Number(a.sortOrder || 0),
        createdAt: a.createdAt ? new Date(a.createdAt).toISOString() : null,
      }));
      return jsonOk({ actions, total: actions.length });
    } catch (err: any) { return jsonError("list", err); }
  }

  if (method === "POST") {
    let body: any;
    try { body = await req.json(); } catch { return badRequest("요청 본문 파싱 실패"); }
    const caseId = Number(body.caseId);
    const item = String(body.item || "").trim();
    if (!caseId) return badRequest("caseId 필수");
    if (!item) return badRequest("item 필수");
    const source = body.source === "missing_evidence" ? "missing_evidence" : "manual";
    try {
      const ins: any = await db.execute(sql.raw(`
        INSERT INTO martyrdom_actions (case_id, item, detail, status, source, due_date, sort_order, created_by, updated_at)
        VALUES (${caseId}, ${q(item, 300)}, ${body.detail ? q(body.detail, 2000) : "NULL"},
                'todo', '${source}', ${body.dueDate ? `'${String(body.dueDate).slice(0, 10)}'` : "NULL"},
                ${Number(body.sortOrder) || 0}, ${admin.uid}, NOW())
        RETURNING id
      `));
      const id = Number((ins?.rows ?? ins ?? [])[0]?.id || 0);
      void logAdminAction(req, admin.uid, member.name || String(admin.uid), "martyrdom_action_create", { target: String(caseId), detail: { item, source } });
      return jsonOk({ id });
    } catch (err: any) { return jsonError("insert", err); }
  }

  if (method === "PATCH") {
    let body: any;
    try { body = await req.json(); } catch { return badRequest("요청 본문 파싱 실패"); }
    const id = Number(body.id);
    if (!id) return badRequest("id 필수");
    const sets: string[] = [];
    if (body.item !== undefined)      sets.push(`item = ${q(body.item, 300)}`);
    if (body.detail !== undefined)    sets.push(`detail = ${body.detail ? q(body.detail, 2000) : "NULL"}`);
    if (body.status !== undefined)    sets.push(`status = ${q(body.status, 20)}`);
    if (body.dueDate !== undefined)   sets.push(`due_date = ${body.dueDate ? `'${String(body.dueDate).slice(0, 10)}'` : "NULL"}`);
    if (body.sortOrder !== undefined) sets.push(`sort_order = ${Number(body.sortOrder) || 0}`);
    if (sets.length === 0) return badRequest("변경할 필드 없음");
    sets.push("updated_at = NOW()");
    try {
      await db.execute(sql.raw(`UPDATE martyrdom_actions SET ${sets.join(", ")} WHERE id = ${id}`));
      void logAdminAction(req, admin.uid, member.name || String(admin.uid), "martyrdom_action_update", { target: String(id) });
      return jsonOk({ id });
    } catch (err: any) { return jsonError("update", err); }
  }

  if (method === "DELETE") {
    const url = new URL(req.url);
    const id = Number(url.searchParams.get("id"));
    if (!id) return badRequest("id 필수");
    try {
      await db.execute(sql.raw(`DELETE FROM martyrdom_actions WHERE id = ${id}`));
      void logAdminAction(req, admin.uid, member.name || String(admin.uid), "martyrdom_action_delete", { target: String(id) });
      return jsonOk({ id });
    } catch (err: any) { return jsonError("delete", err); }
  }

  return new Response(JSON.stringify({ ok: false, error: "지원하지 않는 메서드" }), { status: 405 });
};
