/**
 * admin-martyrdom-cases — 순직 사건 CRUD
 *
 * GET  ?kind=active|reference&status=&q=&page=  : 목록 (docCount·hasExtraction 포함)
 * POST { title, deceasedName, schoolName, position, deceasedAt, caseKind, occurredSummary } : 생성 (caseNo 자동)
 * PATCH { id, status?, outcome?, outcomeNote?, assignedAdminId?, procedureStage?, nextDeadlineAt?, nextDeadlineLabel?, title?, occurredSummary? } : 수정
 * DELETE ?id=N : 삭제 (super_admin 전용)
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { requireRole, roleForbidden } from "../../lib/admin-role";
import { logAdminAction } from "../../lib/audit";

export const config = { path: "/api/admin-martyrdom-cases" };

function jsonOk(data: object) {
  return new Response(JSON.stringify({ ok: true, ...data }), {
    headers: { "Content-Type": "application/json" },
  });
}
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

/* ── caseNo 생성: MTR-YYYYMMDD-XXXX ── */
function buildCaseNoPrefix() {
  const now = new Date();
  const ymd = now.toISOString().slice(0, 10).replace(/-/g, "");
  return `MTR-${ymd}-`;
}

export default async (req: Request, _ctx: Context) => {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  const { admin, member } = auth.ctx;

  const method = req.method;

  /* ─────────────── GET — 목록 ─────────────── */
  if (method === "GET") {
    const url = new URL(req.url);
    const kind   = url.searchParams.get("kind") || "";
    const status = url.searchParams.get("status") || "";
    const q      = url.searchParams.get("q") || "";
    const page   = Math.max(1, Number(url.searchParams.get("page") || "1"));
    const limit  = 20;
    const offset = (page - 1) * limit;

    try {
      const filters: string[] = [];
      if (kind) filters.push(`mc.case_kind = '${kind.replace(/'/g, "''")}'`);
      if (status) filters.push(`mc.status = '${status.replace(/'/g, "''")}'`);
      if (q) {
        const safe = q.replace(/'/g, "''");
        filters.push(`(mc.title ILIKE '%${safe}%' OR mc.deceased_name ILIKE '%${safe}%' OR mc.school_name ILIKE '%${safe}%')`);
      }
      const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

      const countRes: any = await db.execute(sql.raw(`
        SELECT COUNT(*) AS cnt FROM martyrdom_cases mc ${where}
      `));
      const total = Number((countRes?.rows ?? countRes ?? [])[0]?.cnt ?? 0);

      const rows: any = await db.execute(sql.raw(`
        SELECT
          mc.id, mc.case_no AS "caseNo", mc.case_kind AS "caseKind",
          mc.title, mc.deceased_name AS "deceasedName",
          mc.school_name AS "schoolName", mc.deceased_at AS "deceasedAt",
          mc.status, mc.outcome, mc.procedure_stage AS "procedureStage",
          mc.next_deadline_at AS "nextDeadlineAt",
          mc.next_deadline_label AS "nextDeadlineLabel",
          mc.extracted_at AS "extractedAt",
          (mc.extraction_json IS NOT NULL)::boolean AS "hasExtraction",
          (SELECT COUNT(*)::int FROM martyrdom_case_documents md WHERE md.case_id = mc.id) AS "docCount",
          m.name AS "assignedAdminName",
          mc.created_at AS "createdAt"
        FROM martyrdom_cases mc
        LEFT JOIN members m ON m.id = mc.assigned_admin_id
        ${where}
        ORDER BY mc.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `));

      const cases = (rows?.rows ?? rows ?? []).map((r: any) => ({
        id: Number(r.id),
        caseNo: String(r.caseNo || ""),
        caseKind: String(r.caseKind || "active"),
        title: String(r.title || ""),
        deceasedName: r.deceasedName ? String(r.deceasedName) : null,
        schoolName: r.schoolName ? String(r.schoolName) : null,
        deceasedAt: r.deceasedAt ? String(r.deceasedAt).slice(0, 10) : null,
        status: String(r.status || ""),
        outcome: r.outcome ? String(r.outcome) : null,
        procedureStage: r.procedureStage ? String(r.procedureStage) : null,
        nextDeadlineAt: r.nextDeadlineAt ? String(r.nextDeadlineAt).slice(0, 10) : null,
        nextDeadlineLabel: r.nextDeadlineLabel ? String(r.nextDeadlineLabel) : null,
        hasExtraction: Boolean(r.hasExtraction),
        docCount: Number(r.docCount || 0),
        assignedAdminName: r.assignedAdminName ? String(r.assignedAdminName) : null,
        createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
      }));

      return jsonOk({ cases, total, page, limit });
    } catch (err: any) {
      return jsonError("list", err);
    }
  }

  /* ─────────────── POST — 생성 ─────────────── */
  if (method === "POST") {
    let body: any;
    try { body = await req.json(); } catch { return badRequest("요청 본문 파싱 실패"); }

    const title = String(body.title || "").trim();
    if (!title) return badRequest("title 필수");

    try {
      /* caseNo 자동: MTR-YYYYMMDD-XXXX (당일 순번 4자리) */
      const prefix = buildCaseNoPrefix();
      const lastRes: any = await db.execute(sql.raw(`
        SELECT case_no FROM martyrdom_cases
        WHERE case_no LIKE '${prefix}%'
        ORDER BY case_no DESC LIMIT 1
      `));
      const lastRow = (lastRes?.rows ?? lastRes ?? [])[0];
      let seq = 1;
      if (lastRow?.case_no) {
        const parts = String(lastRow.case_no).split("-");
        seq = (Number(parts[parts.length - 1]) || 0) + 1;
      }
      const caseNo = `${prefix}${String(seq).padStart(4, "0")}`;

      const caseKind     = body.caseKind === "reference" ? "reference" : "active";
      const deceasedName = body.deceasedName ? String(body.deceasedName).slice(0, 50) : null;
      const schoolName   = body.schoolName   ? String(body.schoolName).slice(0, 150)  : null;
      const position     = body.position     ? String(body.position).slice(0, 50)     : null;
      const deceasedAt   = body.deceasedAt   ? String(body.deceasedAt).slice(0, 10)   : null;
      const occurredSummary = body.occurredSummary ? String(body.occurredSummary).slice(0, 2000) : null;

      const inserted: any = await db.execute(sql.raw(`
        INSERT INTO martyrdom_cases
          (case_no, case_kind, title, deceased_name, school_name, position, deceased_at, occurred_summary, created_by, updated_at)
        VALUES
          ('${caseNo}', '${caseKind}', '${title.replace(/'/g, "''")}',
           ${deceasedName ? `'${deceasedName.replace(/'/g, "''")}'` : "NULL"},
           ${schoolName   ? `'${schoolName.replace(/'/g, "''")}'`   : "NULL"},
           ${position     ? `'${position.replace(/'/g, "''")}'`     : "NULL"},
           ${deceasedAt   ? `'${deceasedAt}'`                        : "NULL"},
           ${occurredSummary ? `'${occurredSummary.replace(/'/g, "''")}'` : "NULL"},
           ${admin.uid}, NOW())
        RETURNING id, case_no AS "caseNo", created_at AS "createdAt"
      `));
      const row = (inserted?.rows ?? inserted ?? [])[0];
      const newId = Number(row?.id);

      await logAdminAction(req, admin.uid, member.name || String(admin.uid), "martyrdom_case_create", {
        target: caseNo,
        detail: { title, caseKind, deceasedName },
      });

      return jsonOk({ id: newId, caseNo: row?.caseNo || caseNo, createdAt: row?.createdAt });
    } catch (err: any) {
      return jsonError("insert", err);
    }
  }

  /* ─────────────── PATCH — 수정 ─────────────── */
  if (method === "PATCH") {
    let body: any;
    try { body = await req.json(); } catch { return badRequest("요청 본문 파싱 실패"); }

    const id = Number(body.id);
    if (!id) return badRequest("id 필수");

    const allowed = ["status","outcome","outcomeNote","assignedAdminId","procedureStage",
                     "nextDeadlineAt","nextDeadlineLabel","title","occurredSummary","caseKind"];
    const sets: string[] = [];

    if (body.status !== undefined)           sets.push(`status = '${String(body.status).replace(/'/g, "''")}'`);
    if (body.outcome !== undefined)          sets.push(`outcome = ${body.outcome ? `'${String(body.outcome).replace(/'/g, "''")}'` : "NULL"}`);
    if (body.outcomeNote !== undefined)      sets.push(`outcome_note = ${body.outcomeNote ? `'${String(body.outcomeNote).slice(0,2000).replace(/'/g,"''")}'` : "NULL"}`);
    if (body.assignedAdminId !== undefined)  sets.push(`assigned_admin_id = ${body.assignedAdminId ? Number(body.assignedAdminId) : "NULL"}`);
    if (body.procedureStage !== undefined)   sets.push(`procedure_stage = ${body.procedureStage ? `'${String(body.procedureStage).replace(/'/g, "''")}'` : "NULL"}`);
    if (body.nextDeadlineAt !== undefined)   sets.push(`next_deadline_at = ${body.nextDeadlineAt ? `'${String(body.nextDeadlineAt).slice(0,10)}'` : "NULL"}`);
    if (body.nextDeadlineLabel !== undefined) sets.push(`next_deadline_label = ${body.nextDeadlineLabel ? `'${String(body.nextDeadlineLabel).slice(0,100).replace(/'/g,"''")}'` : "NULL"}`);
    if (body.title !== undefined && body.title) sets.push(`title = '${String(body.title).slice(0,200).replace(/'/g,"''")}'`);
    if (body.occurredSummary !== undefined)  sets.push(`occurred_summary = ${body.occurredSummary ? `'${String(body.occurredSummary).slice(0,2000).replace(/'/g,"''")}'` : "NULL"}`);

    if (sets.length === 0) return badRequest("변경할 필드 없음");
    sets.push("updated_at = NOW()");

    try {
      await db.execute(sql.raw(`
        UPDATE martyrdom_cases SET ${sets.join(", ")} WHERE id = ${id}
      `));

      await logAdminAction(req, admin.uid, member.name || String(admin.uid), "martyrdom_case_update", {
        target: String(id),
        detail: { fields: Object.keys(body).filter(k => allowed.includes(k)) },
      });

      return jsonOk({ id });
    } catch (err: any) {
      return jsonError("update", err);
    }
  }

  /* ─────────────── DELETE — super_admin 전용 ─────────────── */
  if (method === "DELETE") {
    if (!requireRole(member, "super_admin")) return roleForbidden("super_admin");

    const url = new URL(req.url);
    const id = Number(url.searchParams.get("id"));
    if (!id) return badRequest("id 필수");

    try {
      await db.execute(sql.raw(`DELETE FROM martyrdom_cases WHERE id = ${id}`));

      await logAdminAction(req, admin.uid, member.name || String(admin.uid), "martyrdom_case_delete", {
        target: String(id),
      });

      return jsonOk({ id });
    } catch (err: any) {
      return jsonError("delete", err);
    }
  }

  return new Response(JSON.stringify({ ok: false, error: "지원하지 않는 메서드" }), { status: 405 });
};
