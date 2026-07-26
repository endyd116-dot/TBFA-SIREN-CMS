/**
 * 직원 근로계약 조회 API (본인 것만)
 *   GET /api/contract-my         — 내게 전달된 계약 목록(초안 제외)
 *   GET /api/contract-my?id=N    — 상세(본문·상태·서명여부). 주민번호는 마스킹만.
 *
 * 인증: requireOperator (로그인한 직원 본인). 다른 직원 계약은 절대 조회 불가(member_id 대조).
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { requireOperator, operatorGuardFailed } from "../../lib/operator-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { loadContractRow } from "../../lib/contract-document";

export const config = { path: "/api/contract-my" };
const H = { "Content-Type": "application/json; charset=utf-8" };
const ok = (data: any) => new Response(jsonKST({ ok: true, data }), { status: 200, headers: H });
const bad = (msg: string, status = 400) => new Response(jsonKST({ ok: false, error: msg }), { status, headers: H });
const rows = (r: any) => (r?.rows ?? r ?? []);

export default async function handler(req: Request, _ctx: Context) {
  let step = "start";
  try {
    step = "auth";
    const auth = await requireOperator(req);
    if (operatorGuardFailed(auth)) return auth.res;
    const me = auth.ctx.member;

    const url = new URL(req.url);
    const id = url.searchParams.get("id");

    if (id) {
      step = "detail";
      const row = await loadContractRow(Number(id));
      if (!row) return bad("계약을 찾을 수 없습니다", 404);
      if (Number(row.member_id) !== Number(me.id)) return bad("본인 계약만 볼 수 있습니다", 403);
      if (row.status === "draft") return bad("아직 전달되지 않은 계약입니다", 404);

      let fields: any = {};
      try { fields = typeof row.fields === "string" ? JSON.parse(row.fields) : (row.fields || {}); } catch { fields = {}; }

      /* 열람 증적 (최초 1회만 기록) */
      try {
        if (row.status === "sent") {
          await db.execute(sql`INSERT INTO contract_signature_events (contract_id, actor, action) VALUES (${Number(id)}, 'employee', 'VIEWED')`);
        }
      } catch { /* 증적 실패는 비차단 */ }

      const att = await db.execute(sql`
        SELECT id, kind, label, file_name, mime_type, size_bytes, created_at
          FROM contract_attachments WHERE contract_id = ${Number(id)} AND deleted_at IS NULL ORDER BY created_at DESC`);

      return ok({
        id: row.id, status: row.status, title: row.title,
        entityName: row.ent_name, entityRepresentative: row.ent_rep, entityBizNo: row.ent_bizno, entityAddress: row.ent_address,
        memberName: row.m_name, fields,
        residentNoMask: row.resident_no_mask || null,
        bodySnapshot: row.body_snapshot,
        companySignedAt: row.company_signed_at, sentAt: row.sent_at,
        employeeSignedAt: row.employee_signed_at, employeeSigType: row.employee_sig_type,
        rejectedReason: row.rejected_reason, rejectedAt: row.rejected_at,
        documentVersion: row.document_version, hasDocument: !!row.document_r2_key,
        attachments: rows(att),
      });
    }

    step = "list";
    const list = await db.execute(sql`
      SELECT c.id, c.status, c.title, c.document_version, c.sent_at, c.employee_signed_at, c.created_at,
             e.name AS ent_name
        FROM employment_contracts c
        JOIN contract_business_entities e ON e.id = c.entity_id
       WHERE c.member_id = ${Number(me.id)} AND c.status <> 'draft'
       ORDER BY c.created_at DESC
       LIMIT 100`);
    return ok({ items: rows(list) });
  } catch (err: any) {
    return new Response(jsonKST({
      ok: false, error: "내 계약 조회 실패", step,
      detail: String(err?.message || err).slice(0, 500),
    }), { status: 500, headers: H });
  }
}
