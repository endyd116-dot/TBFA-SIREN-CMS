import { isoUTC, jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { forbidden } from "../../lib/response";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-approval-delegations" };

/* =========================================================
   결재 위임(approval_delegations) 설정 API
   - GET  : 위임 목록 (최신순, ?activeOnly=1 이면 오늘 유효한 것만)
   - POST : action 분기 (create·deactivate) — mutation은 super_admin 전용
   ========================================================= */

function jsonError(step: string, err: any) {
  return new Response(jsonKST({
    ok: false, error: "결재 위임 처리 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

function jsonBad(step: string, message: string, extra?: any) {
  return new Response(jsonKST({
    ok: false, error: message, step, ...(extra || {}),
  }), { status: 400, headers: { "Content-Type": "application/json" } });
}

function rowsOf(res: any): any[] {
  return (res?.rows ?? res ?? []) as any[];
}

const ALLOWED_DELEGATE_ROLES = ["admin", "super_admin"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function mapDelegation(r: any) {
  return {
    id:           Number(r.id),
    delegateRole: r.delegate_role,
    toMemberId:   r.to_member_id == null ? null : Number(r.to_member_id),
    toMemberName: r.to_member_name,
    startAt:      isoUTC(r.start_at),
    endAt:        isoUTC(r.end_at),
    reason:       r.reason,
    isActive:     r.is_active === true || r.is_active === "t",
    createdBy:    r.created_by == null ? null : Number(r.created_by),
    createdAt:    isoUTC(r.created_at),
  };
}

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  if (req.method === "GET") return handleGet(req);
  if (req.method === "POST") return handlePost(req, auth);

  return new Response(jsonKST({ ok: false, error: "허용되지 않은 메서드입니다" }),
    { status: 405, headers: { "Content-Type": "application/json" } });
}

/* =========================================================
   GET — 위임 목록 (조회는 requireAdmin 통과면 OK)
   ========================================================= */
async function handleGet(req: Request) {
  let activeOnly = false;
  try {
    const url = new URL(req.url);
    const v = url.searchParams.get("activeOnly");
    activeOnly = v === "1" || v === "true";
  } catch { /* URL 파싱 실패 시 전체 반환 */ }

  try {
    const res: any = activeOnly
      ? await db.execute(sql`
          SELECT id, delegate_role, to_member_id, to_member_name,
                 start_at, end_at, reason, is_active, created_by, created_at
          FROM approval_delegations
          WHERE is_active = true
            AND (NOW() AT TIME ZONE 'Asia/Seoul')::date BETWEEN start_at AND end_at
          ORDER BY created_at DESC, id DESC
        `)
      : await db.execute(sql`
          SELECT id, delegate_role, to_member_id, to_member_name,
                 start_at, end_at, reason, is_active, created_by, created_at
          FROM approval_delegations
          ORDER BY created_at DESC, id DESC
        `);
    const delegations = rowsOf(res).map(mapDelegation);
    return new Response(
      jsonKST({ ok: true, data: { delegations } }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) { return jsonError("select_delegations", err); }
}

/* =========================================================
   POST — action 분기 (mutation은 super_admin 전용)
   ========================================================= */
async function handlePost(req: Request, auth: any) {
  // 위임 설정은 super_admin(이사장) 전용
  if (auth.ctx.member.role !== "super_admin") {
    return forbidden("결재 위임 설정은 super_admin(이사장) 전용입니다");
  }

  let body: any;
  try { body = await req.json(); }
  catch { return jsonBad("parse_body", "요청 본문(JSON) 파싱 실패"); }

  const action = String(body?.action || "");
  switch (action) {
    case "create":     return actionCreate(body, auth);
    case "deactivate": return actionDeactivate(body);
    default:           return jsonBad("action", `알 수 없는 action: ${action || "(없음)"}`);
  }
}

async function actionCreate(body: any, auth: any) {
  const delegateRole = String(body?.delegateRole || "");
  if (!ALLOWED_DELEGATE_ROLES.includes(delegateRole)) {
    return jsonBad("validate", "delegateRole은 admin|super_admin 중 하나여야 합니다");
  }

  const toMemberId = Number(body?.toMemberId);
  if (!Number.isFinite(toMemberId)) return jsonBad("validate", "toMemberId는 필수입니다");

  const startAt = String(body?.startAt || "").trim();
  const endAt = String(body?.endAt || "").trim();
  if (!DATE_RE.test(startAt)) return jsonBad("validate", "startAt은 YYYY-MM-DD 형식이어야 합니다");
  if (!DATE_RE.test(endAt)) return jsonBad("validate", "endAt은 YYYY-MM-DD 형식이어야 합니다");
  if (endAt < startAt) return jsonBad("validate", "endAt은 startAt 이상이어야 합니다");

  const reason = body?.reason == null ? null : String(body.reason);

  // toMemberId가 실제 type='admin' 회원인지 확인 + 이름 조회
  let toMemberName: string;
  try {
    const res: any = await db.execute(sql`
      SELECT id, name FROM members WHERE id = ${toMemberId} AND type = 'admin' LIMIT 1
    `);
    const row = rowsOf(res)[0];
    if (!row) return jsonBad("validate", "toMemberId에 해당하는 관리자(type=admin) 회원을 찾을 수 없습니다");
    toMemberName = String(row.name ?? "");
  } catch (err: any) { return jsonError("select_member", err); }

  const createdBy = auth.ctx.admin.uid;

  try {
    const res: any = await db.execute(sql`
      INSERT INTO approval_delegations
        (delegate_role, to_member_id, to_member_name, start_at, end_at, reason, is_active, created_by)
      VALUES
        (${delegateRole}, ${toMemberId}, ${toMemberName}, ${startAt}, ${endAt}, ${reason}, true, ${createdBy})
      RETURNING id, delegate_role, to_member_id, to_member_name,
                start_at, end_at, reason, is_active, created_by, created_at
    `);
    const r = rowsOf(res)[0];
    return new Response(jsonKST({ ok: true, data: { delegation: mapDelegation(r) } }),
      { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err: any) { return jsonError("insert", err); }
}

async function actionDeactivate(body: any) {
  const id = Number(body?.id);
  if (!Number.isFinite(id)) return jsonBad("validate", "id는 필수입니다");

  try {
    const res: any = await db.execute(sql`SELECT id FROM approval_delegations WHERE id = ${id} LIMIT 1`);
    if (rowsOf(res).length === 0) return jsonBad("validate", "대상 위임을 찾을 수 없습니다");
  } catch (err: any) { return jsonError("select_target", err); }

  try {
    const res: any = await db.execute(sql`
      UPDATE approval_delegations
      SET is_active = false
      WHERE id = ${id}
      RETURNING id, delegate_role, to_member_id, to_member_name,
                start_at, end_at, reason, is_active, created_by, created_at
    `);
    const r = rowsOf(res)[0];
    return new Response(jsonKST({ ok: true, data: { delegation: mapDelegation(r) } }),
      { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err: any) { return jsonError("deactivate", err); }
}
