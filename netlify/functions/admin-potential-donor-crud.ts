/**
 * POST   /api/admin/potential-donor-crud   — 등록
 * PUT    /api/admin/potential-donor-crud   — 수정 (body.id 필수)
 * DELETE /api/admin/potential-donor-crud   — 삭제 (body.id 필수)
 * POST   /api/admin/potential-donor-crud?action=map-member — 정식 회원 매핑 (body.id + body.memberId)
 * POST   /api/admin/potential-donor-crud?action=unmap      — 매핑 해제 (body.id 필수)
 */

import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import { logAdminAction } from "../../lib/audit";

export const config = { path: "/api/admin/potential-donor-crud" };

function jsonError(step: string, err: any) {
  return new Response(jsonKST({
    ok: false, error: "잠재 후원자 처리 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

function ok(data: object, message?: string) {
  return new Response(jsonKST({ ok: true, message: message || null, ...data }), {
    status: 200, headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function badRequest(message: string) {
  return new Response(jsonKST({ ok: false, error: message }), {
    status: 400, headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, PUT, DELETE, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" } });

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;
  const admin = (auth as any).ctx?.admin;

  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  let body: any = {};
  try { body = await req.json(); } catch { return badRequest("JSON 파싱 실패"); }

  /* ── POST: 회원 매핑 ── */
  if (req.method === "POST" && action === "map-member") {
    const { id, memberId } = body;
    if (!id || !memberId) return badRequest("id, memberId 필수");
    try {
      /* 대상 회원 존재 확인 */
      const memberRs: any = await db.execute(sql`SELECT id, name FROM members WHERE id = ${Number(memberId)} LIMIT 1`);
      const member = (Array.isArray(memberRs) ? memberRs[0] : (memberRs as any).rows?.[0]);
      if (!member) return badRequest("해당 회원을 찾을 수 없습니다");

      await db.execute(sql`
        UPDATE potential_donors
        SET linked_member_id = ${Number(memberId)},
            linked_at = NOW(),
            linked_by = ${admin?.uid ?? null},
            updated_at = NOW()
        WHERE id = ${Number(id)}
      `);
      await logAdminAction(req as any, admin?.uid, admin?.name, "potential_donor_map", {
        target: String(id), detail: { memberId, memberName: member.name },
      }).catch(() => {});
      return ok({ memberId: Number(memberId), memberName: member.name }, "정식 회원으로 매핑 완료");
    } catch (err) { return jsonError("map-member", err); }
  }

  /* ── POST: 매핑 해제 ── */
  if (req.method === "POST" && action === "unmap") {
    const { id } = body;
    if (!id) return badRequest("id 필수");
    try {
      await db.execute(sql`
        UPDATE potential_donors
        SET linked_member_id = NULL, linked_at = NULL, linked_by = NULL, updated_at = NOW()
        WHERE id = ${Number(id)}
      `);
      return ok({}, "매핑 해제 완료");
    } catch (err) { return jsonError("unmap", err); }
  }

  /* ── POST: 등록 ── */
  if (req.method === "POST") {
    const { name, phone, email, address, birthdate, eventName, participatedAt, entryPath, memo } = body;
    if (!name?.trim()) return badRequest("이름은 필수입니다");

    try {
      const insRs: any = await db.execute(sql`
        INSERT INTO potential_donors (
          name, phone, email, address, birthdate,
          event_name, participated_at, entry_path, memo,
          created_by, created_at, updated_at
        ) VALUES (
          ${name.trim()}, ${phone?.trim() || null}, ${email?.trim() || null}, ${address?.trim() || null}, ${birthdate?.trim() || null},
          ${eventName?.trim() || null},
          ${participatedAt ? new Date(participatedAt).toISOString() : null}::timestamptz,
          ${entryPath?.trim() || null}, ${memo?.trim() || null},
          ${admin?.uid ?? null}, NOW(), NOW()
        )
        RETURNING id
      `);
      const newId = Number((Array.isArray(insRs) ? insRs[0] : (insRs as any).rows?.[0])?.id);
      await logAdminAction(req as any, admin?.uid, admin?.name, "potential_donor_create", {
        target: String(newId), detail: { name: name.trim() },
      }).catch(() => {});
      return ok({ id: newId }, "등록 완료");
    } catch (err) { return jsonError("insert", err); }
  }

  /* ── PUT: 수정 ── */
  if (req.method === "PUT") {
    const { id, name, phone, email, address, birthdate, eventName, participatedAt, entryPath, memo } = body;
    if (!id) return badRequest("id 필수");
    if (!name?.trim()) return badRequest("이름은 필수입니다");

    try {
      await db.execute(sql`
        UPDATE potential_donors SET
          name = ${name.trim()},
          phone = ${phone?.trim() || null},
          email = ${email?.trim() || null},
          address = ${address?.trim() || null},
          birthdate = ${birthdate?.trim() || null},
          event_name = ${eventName?.trim() || null},
          participated_at = ${participatedAt ? new Date(participatedAt).toISOString() : null}::timestamptz,
          entry_path = ${entryPath?.trim() || null},
          memo = ${memo?.trim() || null},
          updated_at = NOW()
        WHERE id = ${Number(id)}
      `);
      await logAdminAction(req as any, admin?.uid, admin?.name, "potential_donor_update", {
        target: String(id), detail: { name: name.trim() },
      }).catch(() => {});
      return ok({ id: Number(id) }, "수정 완료");
    } catch (err) { return jsonError("update", err); }
  }

  /* ── DELETE: 삭제 ── */
  if (req.method === "DELETE") {
    const { id } = body;
    if (!id) return badRequest("id 필수");

    try {
      await db.execute(sql`DELETE FROM potential_donors WHERE id = ${Number(id)}`);
      await logAdminAction(req as any, admin?.uid, admin?.name, "potential_donor_delete", {
        target: String(id), detail: {},
      }).catch(() => {});
      return ok({ id: Number(id) }, "삭제 완료");
    } catch (err) { return jsonError("delete", err); }
  }

  return new Response(jsonKST({ ok: false, error: "Method Not Allowed" }), {
    status: 405, headers: { "Content-Type": "application/json; charset=utf-8" },
  });
};
