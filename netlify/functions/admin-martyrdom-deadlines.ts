/**
 * admin-martyrdom-deadlines — 절차·기한 트래커 CRUD (보완① P2 풀)
 *
 * GET    ?caseId=N            : 사건별 기한 목록 (due_date ASC·D-day 계산용 dueDate 반환)
 * POST   {caseId,label,dueDate,kind?,stage?,note?} : 생성
 * PATCH  {id, label?,dueDate?,kind?,stage?,status?,note?} : 수정
 * DELETE ?id=N                : 삭제
 *
 * kind: statute_limit(소멸시효) | submission(자료제출) | hearing(심의) | custom
 * status: pending | done | overdue
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { logAdminAction } from "../../lib/audit";

export const config = { path: "/api/admin-martyrdom-deadlines" };

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
        SELECT id, case_id AS "caseId", label, kind, due_date AS "dueDate", stage, status,
               alerted_at AS "alertedAt", note, created_at AS "createdAt"
        FROM martyrdom_deadlines WHERE case_id = ${caseId}
        ORDER BY due_date ASC, id ASC
      `));
      const deadlines = (r?.rows ?? r ?? []).map((d: any) => ({
        id: Number(d.id), caseId: Number(d.caseId),
        label: String(d.label || ""), kind: String(d.kind || "custom"),
        dueDate: d.dueDate ? String(d.dueDate).slice(0, 10) : null,
        stage: d.stage ? String(d.stage) : null,
        status: String(d.status || "pending"),
        note: d.note ? String(d.note) : null,
        alertedAt: d.alertedAt ? new Date(d.alertedAt).toISOString() : null,
        createdAt: d.createdAt ? new Date(d.createdAt).toISOString() : null,
      }));
      return jsonOk({ deadlines, total: deadlines.length });
    } catch (err: any) { return jsonError("list", err); }
  }

  if (method === "POST") {
    let body: any;
    try { body = await req.json(); } catch { return badRequest("요청 본문 파싱 실패"); }
    const caseId = Number(body.caseId);
    const label = String(body.label || "").trim();
    const dueDate = body.dueDate ? String(body.dueDate).slice(0, 10) : "";
    if (!caseId) return badRequest("caseId 필수");
    if (!label) return badRequest("label 필수");
    if (!dueDate) return badRequest("dueDate 필수");
    try {
      const ins: any = await db.execute(sql.raw(`
        INSERT INTO martyrdom_deadlines (case_id, label, kind, due_date, stage, status, note, created_by, updated_at)
        VALUES (${caseId}, ${q(label, 200)}, ${body.kind ? q(body.kind, 30) : "'custom'"},
                '${dueDate}', ${body.stage ? q(body.stage, 40) : "NULL"}, 'pending',
                ${body.note ? q(body.note, 2000) : "NULL"}, ${admin.uid}, NOW())
        RETURNING id
      `));
      const id = Number((ins?.rows ?? ins ?? [])[0]?.id || 0);
      void logAdminAction(req, admin.uid, member.name || String(admin.uid), "martyrdom_deadline_create", { target: String(caseId), detail: { label } });
      return jsonOk({ id });
    } catch (err: any) { return jsonError("insert", err); }
  }

  if (method === "PATCH") {
    let body: any;
    try { body = await req.json(); } catch { return badRequest("요청 본문 파싱 실패"); }
    const id = Number(body.id);
    if (!id) return badRequest("id 필수");
    const sets: string[] = [];
    if (body.label !== undefined)   sets.push(`label = ${q(body.label, 200)}`);
    if (body.kind !== undefined)    sets.push(`kind = ${q(body.kind, 30)}`);
    if (body.dueDate !== undefined) sets.push(`due_date = '${String(body.dueDate).slice(0, 10)}'`);
    if (body.stage !== undefined)   sets.push(`stage = ${body.stage ? q(body.stage, 40) : "NULL"}`);
    if (body.status !== undefined)  sets.push(`status = ${q(body.status, 20)}`);
    if (body.note !== undefined)    sets.push(`note = ${body.note ? q(body.note, 2000) : "NULL"}`);
    /* status 수동 변경 시 알림 중복방지 플래그 리셋(다시 임박 알림 가능) */
    if (body.status === "pending")  sets.push(`alerted_at = NULL`);
    if (sets.length === 0) return badRequest("변경할 필드 없음");
    sets.push("updated_at = NOW()");
    try {
      await db.execute(sql.raw(`UPDATE martyrdom_deadlines SET ${sets.join(", ")} WHERE id = ${id}`));
      void logAdminAction(req, admin.uid, member.name || String(admin.uid), "martyrdom_deadline_update", { target: String(id) });
      return jsonOk({ id });
    } catch (err: any) { return jsonError("update", err); }
  }

  if (method === "DELETE") {
    const url = new URL(req.url);
    const id = Number(url.searchParams.get("id"));
    if (!id) return badRequest("id 필수");
    try {
      await db.execute(sql.raw(`DELETE FROM martyrdom_deadlines WHERE id = ${id}`));
      void logAdminAction(req, admin.uid, member.name || String(admin.uid), "martyrdom_deadline_delete", { target: String(id) });
      return jsonOk({ id });
    } catch (err: any) { return jsonError("delete", err); }
  }

  return new Response(JSON.stringify({ ok: false, error: "지원하지 않는 메서드" }), { status: 405 });
};
