import { isoUTC, jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { forbidden } from "../../lib/response";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-approval-lines" };

/* =========================================================
   지출 결재라인(approval_lines) 설정 API
   - GET  : 결재라인 규칙 전체 조회 (sort_order, min_amount 순)
   - POST : action 분기 (create·update·delete) — mutation은 super_admin 전용
   ========================================================= */

function jsonError(step: string, err: any) {
  return new Response(jsonKST({
    ok: false, error: "결재라인 처리 실패", step,
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

const ALLOWED_STEP_ROLES = ["admin", "super_admin"];

/** steps 배열 검증: 배열이고 각 원소가 admin|super_admin */
function validateSteps(steps: any): { ok: true; value: string[] } | { ok: false; message: string } {
  if (!Array.isArray(steps)) return { ok: false, message: "steps는 배열이어야 합니다" };
  if (steps.length === 0) return { ok: false, message: "steps는 최소 1단계 이상이어야 합니다" };
  const value: string[] = [];
  for (const s of steps) {
    const role = String(s);
    if (!ALLOWED_STEP_ROLES.includes(role)) {
      return { ok: false, message: `steps 원소는 admin|super_admin 중 하나여야 합니다 (받은 값: ${role})` };
    }
    value.push(role);
  }
  return { ok: true, value };
}

/** jsonb steps 정규화 (문자열/배열 모두 배열로) */
function parseSteps(raw: any): string[] {
  if (Array.isArray(raw)) return raw.map((x) => String(x));
  if (typeof raw === "string") {
    try { const p = JSON.parse(raw); return Array.isArray(p) ? p.map((x) => String(x)) : []; }
    catch { return []; }
  }
  return [];
}

function mapLine(r: any) {
  return {
    id:            Number(r.id),
    name:          r.name,
    minAmount:     r.min_amount == null ? 0 : Number(r.min_amount),
    maxAmount:     r.max_amount == null ? null : Number(r.max_amount),
    steps:         parseSteps(r.steps),
    boardRequired: r.board_required === true || r.board_required === "t",
    isActive:      r.is_active === true || r.is_active === "t",
    sortOrder:     Number(r.sort_order) || 0,
    createdAt:     isoUTC(r.created_at),
    updatedAt:     isoUTC(r.updated_at),
  };
}

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  if (req.method === "GET") return handleGet();
  if (req.method === "POST") return handlePost(req, auth);

  return new Response(jsonKST({ ok: false, error: "허용되지 않은 메서드입니다" }),
    { status: 405, headers: { "Content-Type": "application/json" } });
}

/* =========================================================
   GET — 결재라인 전체 (조회는 requireAdmin 통과면 OK)
   ========================================================= */
async function handleGet() {
  try {
    const res: any = await db.execute(sql`
      SELECT id, name, min_amount, max_amount, steps, board_required,
             is_active, sort_order, created_at, updated_at
      FROM approval_lines
      ORDER BY sort_order ASC, min_amount ASC
    `);
    const lines = rowsOf(res).map(mapLine);
    return new Response(
      jsonKST({ ok: true, data: { lines } }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) { return jsonError("select_lines", err); }
}

/* =========================================================
   POST — action 분기 (mutation은 super_admin 전용)
   ========================================================= */
async function handlePost(req: Request, auth: any) {
  // 위임·결재라인 변경은 super_admin(이사장) 전용
  if (auth.ctx.member.role !== "super_admin") {
    return forbidden("결재라인 설정은 super_admin(이사장) 전용입니다");
  }

  let body: any;
  try { body = await req.json(); }
  catch { return jsonBad("parse_body", "요청 본문(JSON) 파싱 실패"); }

  const action = String(body?.action || "");
  switch (action) {
    case "create": return actionCreate(body);
    case "update": return actionUpdate(body);
    case "delete": return actionDelete(body);
    default:       return jsonBad("action", `알 수 없는 action: ${action || "(없음)"}`);
  }
}

async function actionCreate(body: any) {
  const name = String(body?.name || "").trim();
  if (!name) return jsonBad("validate", "name은 필수입니다");

  const minAmount = Number(body?.minAmount);
  if (!Number.isFinite(minAmount) || minAmount < 0) {
    return jsonBad("validate", "minAmount는 0 이상의 숫자여야 합니다");
  }
  let maxAmount: number | null = null;
  if (body?.maxAmount != null) {
    const m = Number(body.maxAmount);
    if (!Number.isFinite(m) || m < 0) return jsonBad("validate", "maxAmount는 0 이상의 숫자 또는 null이어야 합니다");
    if (m < minAmount) return jsonBad("validate", "maxAmount는 minAmount 이상이어야 합니다");
    maxAmount = m;
  }

  const stepsCheck = validateSteps(body?.steps);
  if (!stepsCheck.ok) return jsonBad("validate", (stepsCheck as any).message);

  const boardRequired = !!body?.boardRequired;

  // sort_order = 현재 max + 1
  let sortOrder = 1;
  try {
    const res: any = await db.execute(sql`SELECT COALESCE(MAX(sort_order), 0) AS m FROM approval_lines`);
    sortOrder = (Number(rowsOf(res)[0]?.m) || 0) + 1;
  } catch (err: any) { return jsonError("next_sort", err); }

  try {
    const res: any = await db.execute(sql`
      INSERT INTO approval_lines (name, min_amount, max_amount, steps, board_required, is_active, sort_order)
      VALUES (${name}, ${minAmount}, ${maxAmount}, ${JSON.stringify(stepsCheck.value)}::jsonb, ${boardRequired}, true, ${sortOrder})
      RETURNING id, name, min_amount, max_amount, steps, board_required, is_active, sort_order, created_at, updated_at
    `);
    const r = rowsOf(res)[0];
    return new Response(jsonKST({ ok: true, data: { line: mapLine(r) } }),
      { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err: any) { return jsonError("insert", err); }
}

async function actionUpdate(body: any) {
  const id = Number(body?.id);
  if (!Number.isFinite(id)) return jsonBad("validate", "id는 필수입니다");

  // 대상 존재 확인
  try {
    const res: any = await db.execute(sql`SELECT id FROM approval_lines WHERE id = ${id} LIMIT 1`);
    if (rowsOf(res).length === 0) return jsonBad("validate", "대상 결재라인을 찾을 수 없습니다");
  } catch (err: any) { return jsonError("select_target", err); }

  const sets: any[] = [];

  if (body?.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return jsonBad("validate", "name은 빈 값일 수 없습니다");
    sets.push(sql`name = ${name}`);
  }
  if (body?.minAmount !== undefined) {
    const m = Number(body.minAmount);
    if (!Number.isFinite(m) || m < 0) return jsonBad("validate", "minAmount는 0 이상의 숫자여야 합니다");
    sets.push(sql`min_amount = ${m}`);
  }
  if (body?.maxAmount !== undefined) {
    if (body.maxAmount === null) {
      sets.push(sql`max_amount = ${null}`);
    } else {
      const m = Number(body.maxAmount);
      if (!Number.isFinite(m) || m < 0) return jsonBad("validate", "maxAmount는 0 이상의 숫자 또는 null이어야 합니다");
      sets.push(sql`max_amount = ${m}`);
    }
  }
  if (body?.steps !== undefined) {
    const stepsCheck = validateSteps(body.steps);
    if (!stepsCheck.ok) return jsonBad("validate", (stepsCheck as any).message);
    sets.push(sql`steps = ${JSON.stringify(stepsCheck.value)}::jsonb`);
  }
  if (body?.boardRequired !== undefined) {
    sets.push(sql`board_required = ${!!body.boardRequired}`);
  }
  if (body?.isActive !== undefined) {
    sets.push(sql`is_active = ${!!body.isActive}`);
  }
  if (body?.sortOrder !== undefined) {
    const so = Number(body.sortOrder);
    if (!Number.isFinite(so)) return jsonBad("validate", "sortOrder는 숫자여야 합니다");
    sets.push(sql`sort_order = ${so}`);
  }

  if (sets.length === 0) return jsonBad("validate", "변경할 필드가 없습니다");
  sets.push(sql`updated_at = now()`);

  try {
    const res: any = await db.execute(sql`
      UPDATE approval_lines
      SET ${sql.join(sets, sql`, `)}
      WHERE id = ${id}
      RETURNING id, name, min_amount, max_amount, steps, board_required, is_active, sort_order, created_at, updated_at
    `);
    const r = rowsOf(res)[0];
    return new Response(jsonKST({ ok: true, data: { line: mapLine(r) } }),
      { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err: any) { return jsonError("update", err); }
}

async function actionDelete(body: any) {
  const id = Number(body?.id);
  if (!Number.isFinite(id)) return jsonBad("validate", "id는 필수입니다");

  try {
    const res: any = await db.execute(sql`SELECT id FROM approval_lines WHERE id = ${id} LIMIT 1`);
    if (rowsOf(res).length === 0) return jsonBad("validate", "대상 결재라인을 찾을 수 없습니다");
  } catch (err: any) { return jsonError("select_target", err); }

  try {
    await db.execute(sql`DELETE FROM approval_lines WHERE id = ${id}`);
    return new Response(jsonKST({ ok: true, data: { id, deleted: true } }),
      { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err: any) { return jsonError("delete", err); }
}
