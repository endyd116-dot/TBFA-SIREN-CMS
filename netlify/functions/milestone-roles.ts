/**
 * /api/milestone-roles — 역할 카탈로그 CRUD
 *
 * GET    /api/milestone-roles                — 활성 역할 일람 (4계층 로그인 사용자 허용)
 *        ?includeInactive=1                  — 비활성 포함 (어드민·슈퍼어드민만)
 * POST   /api/milestone-roles                — 신규 등록 (super_admin 전용)
 *        body: { code, name, description?, sortOrder? }
 * PATCH  /api/milestone-roles/:id            — 수정 (super_admin 전용)
 *        body: { name?, description?, sortOrder?, isActive? }
 * DELETE /api/milestone-roles/:id            — soft delete (super_admin 전용·is_active=false)
 *
 * 응답 표준: { ok: true, data: { roles?: [...], role?: {...} } }
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireActiveUser } from "../../lib/auth";
import { requireAdmin } from "../../lib/admin-guard";
import {
  loadActiveRoles,
  loadAllRoles,
  invalidateRoleCache,
  isValidRoleCodeFormat,
} from "../../lib/milestone-roles";

export const config = { path: "/api/milestone-roles*" };

const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

function jsonOk(data: unknown, status = 200) {
  return new Response(jsonKST({ ok: true, data }), { status, headers: JSON_HEADER });
}
function jsonErr(error: string, status = 400, detail?: string) {
  return new Response(
    jsonKST({ ok: false, error, ...(detail ? { detail } : {}) }),
    { status, headers: JSON_HEADER },
  );
}
function jsonStepErr(step: string, err: any, status = 500) {
  return new Response(jsonKST({
    ok: false,
    error: "역할 카탈로그 오류",
    step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 800),
  }), { status, headers: JSON_HEADER });
}

/** URL → :id 파싱. /api/milestone-roles, /api/milestone-roles/, /api/milestone-roles/123 */
function parseId(pathname: string): number | null {
  // 끝 슬래시·쿼리 제거
  const clean = pathname.replace(/\/+$/, "");
  const m = clean.match(/^\/api\/milestone-roles\/(\d+)$/);
  if (m) {
    const n = Number(m[1]);
    return isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

/** super_admin 전용 가드 — admin JWT + role 확인 */
async function requireSuperAdmin(req: Request): Promise<
  | { ok: true }
  | { ok: false; res: Response }
> {
  const auth = await requireAdmin(req);
  if (!auth.ok) return { ok: false, res: (auth as any).res };
  if ((auth.ctx.member as any).role !== "super_admin") {
    return {
      ok: false,
      res: jsonErr("슈퍼어드민 전용 기능입니다", 403),
    };
  }
  return { ok: true };
}

export default async function handler(req: Request, _ctx: Context) {
  const url = new URL(req.url);
  const id = parseId(url.pathname);

  /* ─────────── GET ─────────── */
  if (req.method === "GET") {
    if (id !== null) {
      return jsonErr("GET 단건 조회는 지원하지 않습니다 (전체 일람 후 클라 필터)", 405);
    }
    // 4계층 모두 허용: 로그인된 사용자면 통과
    const auth = await requireActiveUser(req);
    if (!auth.ok) return (auth as any).res;

    const includeInactive = url.searchParams.get("includeInactive") === "1";
    try {
      const roles = includeInactive ? await loadAllRoles() : await loadActiveRoles();
      return jsonOk({ roles });
    } catch (err) {
      return jsonStepErr("select_roles", err);
    }
  }

  /* ─────────── POST: 신규 등록 (super_admin) ─────────── */
  if (req.method === "POST") {
    if (id !== null) return jsonErr("POST는 컬렉션 경로 /api/milestone-roles 만 지원", 405);
    const sa = await requireSuperAdmin(req);
    if (!sa.ok) return (sa as any).res;

    let body: any;
    try { body = await req.json(); } catch {
      return jsonErr("요청 본문 파싱 실패", 400);
    }
    const code = String(body.code ?? "").trim();
    const name = String(body.name ?? "").trim();
    const description = body.description != null ? String(body.description) : null;
    const sortOrder = Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0;

    if (!code) return jsonErr("code 필수", 400);
    if (!isValidRoleCodeFormat(code)) {
      return jsonErr("code는 영문 대문자 2~10자 (예: SM, MARKETING)", 400);
    }
    if (!name) return jsonErr("name 필수", 400);
    if (name.length > 50) return jsonErr("name은 50자 이내", 400);

    try {
      // 중복 검증
      const exists = await db.execute(sql`
        SELECT 1 FROM milestone_roles WHERE code = ${code} LIMIT 1
      `);
      const found = ((exists as any).rows ?? exists) as any[];
      if (found.length > 0) {
        return jsonErr(`code '${code}'는 이미 존재합니다`, 409);
      }

      const ins = await db.execute(sql`
        INSERT INTO milestone_roles (code, name, description, sort_order, is_active)
        VALUES (${code}, ${name}, ${description}, ${sortOrder}, TRUE)
        RETURNING id, code, name, description, sort_order, is_active, revenue_cap, non_revenue_cap
      `);
      const row = ((ins as any).rows ?? ins)[0];
      invalidateRoleCache();
      return jsonOk({
        role: {
          id: row.id,
          code: row.code,
          name: row.name,
          description: row.description,
          sortOrder: Number(row.sort_order),
          isActive: Boolean(row.is_active),
          revenueCap: row.revenue_cap != null ? Number(row.revenue_cap) : null,
          nonRevenueCap: row.non_revenue_cap != null ? Number(row.non_revenue_cap) : null,
        },
      });
    } catch (err) {
      return jsonStepErr("insert", err);
    }
  }

  /* ─────────── PATCH: 수정 (super_admin) ─────────── */
  if (req.method === "PATCH") {
    if (id === null) return jsonErr("PATCH는 /api/milestone-roles/:id 형식 필요", 400);
    const sa = await requireSuperAdmin(req);
    if (!sa.ok) return (sa as any).res;

    let body: any;
    try { body = await req.json(); } catch {
      return jsonErr("요청 본문 파싱 실패", 400);
    }

    const fields: string[] = [];
    const values: any[] = [];
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) return jsonErr("name은 빈값 불가", 400);
      if (name.length > 50) return jsonErr("name은 50자 이내", 400);
      fields.push("name"); values.push(name);
    }
    if (body.description !== undefined) {
      fields.push("description"); values.push(body.description == null ? null : String(body.description));
    }
    if (body.sortOrder !== undefined) {
      const n = Number(body.sortOrder);
      if (!Number.isFinite(n)) return jsonErr("sortOrder는 숫자", 400);
      fields.push("sort_order"); values.push(n);
    }
    if (body.isActive !== undefined) {
      fields.push("is_active"); values.push(Boolean(body.isActive));
    }
    if (body.revenueCap !== undefined) {
      const v = body.revenueCap === null ? null : Number(body.revenueCap);
      if (v !== null && !Number.isFinite(v)) return jsonErr("revenueCap은 숫자 또는 null", 400);
      fields.push("revenue_cap"); values.push(v);
    }
    if (body.nonRevenueCap !== undefined) {
      const v = body.nonRevenueCap === null ? null : Number(body.nonRevenueCap);
      if (v !== null && !Number.isFinite(v)) return jsonErr("nonRevenueCap은 숫자 또는 null", 400);
      fields.push("non_revenue_cap"); values.push(v);
    }
    if (fields.length === 0) return jsonErr("변경할 필드가 없습니다", 400);

    // SET 절을 sql 조각으로 합성 (drizzle sql template literal 패턴)
    try {
      // 동적 SET 조합 — 안전한 분기 처리
      let setExpr = sql`updated_at = now()`;
      for (let i = 0; i < fields.length; i++) {
        const f = fields[i];
        const v = values[i];
        if (f === "name") setExpr = sql`${setExpr}, name = ${v}`;
        else if (f === "description") setExpr = sql`${setExpr}, description = ${v}`;
        else if (f === "sort_order") setExpr = sql`${setExpr}, sort_order = ${v}`;
        else if (f === "is_active") setExpr = sql`${setExpr}, is_active = ${v}`;
        else if (f === "revenue_cap") setExpr = sql`${setExpr}, revenue_cap = ${v}`;
        else if (f === "non_revenue_cap") setExpr = sql`${setExpr}, non_revenue_cap = ${v}`;
      }

      const upd = await db.execute(sql`
        UPDATE milestone_roles
        SET ${setExpr}
        WHERE id = ${id}
        RETURNING id, code, name, description, sort_order, is_active, revenue_cap, non_revenue_cap
      `);
      const row = (((upd as any).rows ?? upd) as any[])[0];
      if (!row) return jsonErr("해당 역할을 찾을 수 없습니다", 404);
      invalidateRoleCache();
      return jsonOk({
        role: {
          id: row.id,
          code: row.code,
          name: row.name,
          description: row.description,
          sortOrder: Number(row.sort_order),
          isActive: Boolean(row.is_active),
          revenueCap: row.revenue_cap != null ? Number(row.revenue_cap) : null,
          nonRevenueCap: row.non_revenue_cap != null ? Number(row.non_revenue_cap) : null,
        },
      });
    } catch (err) {
      return jsonStepErr("update", err);
    }
  }

  /* ─────────── DELETE: soft delete (super_admin) ─────────── */
  if (req.method === "DELETE") {
    if (id === null) return jsonErr("DELETE는 /api/milestone-roles/:id 형식 필요", 400);
    const sa = await requireSuperAdmin(req);
    if (!sa.ok) return (sa as any).res;

    try {
      const upd = await db.execute(sql`
        UPDATE milestone_roles
        SET is_active = FALSE, updated_at = now()
        WHERE id = ${id}
        RETURNING id, code, is_active
      `);
      const row = (((upd as any).rows ?? upd) as any[])[0];
      if (!row) return jsonErr("해당 역할을 찾을 수 없습니다", 404);
      invalidateRoleCache();
      return jsonOk({
        role: {
          id: row.id,
          code: row.code,
          isActive: Boolean(row.is_active),
        },
      });
    } catch (err) {
      return jsonStepErr("delete", err);
    }
  }

  return jsonErr("지원하지 않는 메서드", 405);
}
