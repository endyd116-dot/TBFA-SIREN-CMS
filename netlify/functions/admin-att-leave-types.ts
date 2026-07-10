/**
 * /api/admin-att-leave-types — 휴가 종류 CRUD (슈퍼어드민 전용)
 *
 * FE 확장 컬럼(code, max_days, allow_half_day, description)은
 * migrate-att-r29-leave-type-cols 적용 후 DB에 존재.
 * 적용 전이라도 동작하도록 raw SQL + COALESCE 으로 안전 처리.
 */
import { db } from "../../db/index";
import { sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { canAccess } from "../../lib/role-permission-check";

export const config = { path: "/api/admin-att-leave-types" };

function jsonOk(data: unknown, status = 200) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status, headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "휴가 종류 처리 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}

async function hasExtCols(): Promise<boolean> {
  try {
    const res: any = await db.execute(sql`
      SELECT COUNT(*)::int AS cnt FROM information_schema.columns
      WHERE table_name = 'att_leave_types'
        AND column_name IN ('code', 'max_days', 'allow_half_day', 'description')
    `);
    const row = (Array.isArray(res) ? res[0] : (res?.rows ?? [])[0]) ?? {};
    return Number(row.cnt ?? 0) >= 4;
  } catch { return false; }
}

export default async function handler(req: Request) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  // P2-39 fix: 조회(GET)는 근태 설정 권한(att_config) 국장 허용, 변경은 이사장(super_admin) 전용
  const _role = auth.ctx.member.role ?? "";
  if (req.method === "GET"
        ? !(_role === "super_admin" || await canAccess(_role, "att_config"))
        : _role !== "super_admin") {
    return new Response(JSON.stringify({ ok: false, error: req.method === "GET" ? "근태 설정 조회 권한이 없습니다" : "슈퍼어드민 전용" }), {
      status: 403, headers: { "Content-Type": "application/json" },
    });
  }

  const method = req.method;
  const url = new URL(req.url);
  const extOk = await hasExtCols();

  // GET — 휴가 종류 목록
  if (method === "GET") {
    try {
      const result = await db.execute(extOk ? sql`
        SELECT
          id, name, is_paid, unit, requires_approval, default_days, is_active, display_order,
          code, max_days, allow_half_day, description,
          created_at, updated_at
        FROM att_leave_types
        ORDER BY display_order, id
      ` : sql`
        SELECT
          id, name, is_paid, unit, requires_approval, default_days, is_active, display_order,
          NULL::varchar AS code, NULL::numeric AS max_days,
          false AS allow_half_day, NULL::text AS description,
          created_at, updated_at
        FROM att_leave_types
        ORDER BY display_order, id
      `);
      const rows = (((result as any).rows ?? result) as any[]).map(r => ({
        id:               Number(r.id),
        name:             r.name,
        isPaid:           r.is_paid,
        unit:             r.unit,
        requiresApproval: r.requires_approval,
        defaultDays:      r.default_days != null ? Number(r.default_days) : null,
        maxDays:          r.max_days != null ? Number(r.max_days) : null,
        allowHalfDay:     r.allow_half_day === true,
        code:             r.code,
        description:      r.description,
        isActive:         r.is_active,
        displayOrder:     r.display_order,
        createdAt:        r.created_at,
        updatedAt:        r.updated_at,
      }));
      return jsonOk(rows);
    } catch (err) {
      return jsonError("select_leave_types", err);
    }
  }

  // POST — 신규 등록
  if (method === "POST") {
    let body: any;
    try { body = await req.json(); } catch { body = {}; }

    const { name, isPaid, unit, requiresApproval, defaultDays, isActive, displayOrder,
            code, maxDays, allowHalfDay, description } = body;
    if (!name) return jsonError("validate", new Error("name 필수"), 400);

    try {
      const result: any = await (extOk ? db.execute(sql`
        INSERT INTO att_leave_types
          (name, is_paid, unit, requires_approval, default_days, is_active, display_order,
           code, max_days, allow_half_day, description)
        VALUES
          (${name},
           ${isPaid !== false},
           ${unit ?? "day"},
           ${requiresApproval !== false},
           ${defaultDays != null ? String(defaultDays) : "0"},
           ${isActive !== false},
           ${displayOrder ?? 0},
           ${code ?? null},
           ${maxDays != null ? String(maxDays) : null},
           ${allowHalfDay === true},
           ${description ?? null})
        RETURNING id
      `) : db.execute(sql`
        INSERT INTO att_leave_types
          (name, is_paid, unit, requires_approval, default_days, is_active, display_order)
        VALUES
          (${name},
           ${isPaid !== false},
           ${unit ?? "day"},
           ${requiresApproval !== false},
           ${defaultDays != null ? String(defaultDays) : "0"},
           ${isActive !== false},
           ${displayOrder ?? 0})
        RETURNING id
      `));
      const row = (result.rows ?? [])[0];
      return jsonOk({ id: row?.id }, 201);
    } catch (err) {
      return jsonError("insert_leave_type", err);
    }
  }

  // PUT — 수정 (?id=)
  if (method === "PUT") {
    const id = Number(url.searchParams.get("id"));
    if (!id) return jsonError("validate_id", new Error("id 필수"), 400);

    let body: any;
    try { body = await req.json(); } catch { body = {}; }

    try {
      // 기존 row 조회 → undefined 필드는 기존값 유지
      const cur: any = await db.execute(sql`
        SELECT * FROM att_leave_types WHERE id = ${id} LIMIT 1
      `);
      const existing = (cur.rows ?? [])[0];
      if (!existing) return jsonError("not_found", new Error("휴가 종류 없음"), 404);

      const m = (k: string, v: any) => v === undefined ? existing[k] : v;
      const next = {
        name:             m("name", body.name),
        is_paid:          body.isPaid           !== undefined ? !!body.isPaid           : existing.is_paid,
        unit:             m("unit", body.unit),
        requires_approval: body.requiresApproval !== undefined ? !!body.requiresApproval : existing.requires_approval,
        default_days:     body.defaultDays      !== undefined
                            ? (body.defaultDays != null ? String(body.defaultDays) : "0")
                            : existing.default_days,
        is_active:        body.isActive         !== undefined ? !!body.isActive         : existing.is_active,
        display_order:    body.displayOrder     !== undefined ? Number(body.displayOrder) : existing.display_order,
      };

      if (extOk) {
        const ext = {
          max_days:       body.maxDays      !== undefined
                            ? (body.maxDays != null ? String(body.maxDays) : null)
                            : existing.max_days,
          allow_half_day: body.allowHalfDay !== undefined ? !!body.allowHalfDay : existing.allow_half_day,
          description:    body.description  !== undefined ? (body.description ?? null) : existing.description,
        };
        await db.execute(sql`
          UPDATE att_leave_types SET
            name = ${next.name},
            is_paid = ${next.is_paid},
            unit = ${next.unit},
            requires_approval = ${next.requires_approval},
            default_days = ${next.default_days},
            is_active = ${next.is_active},
            display_order = ${next.display_order},
            max_days = ${ext.max_days},
            allow_half_day = ${ext.allow_half_day},
            description = ${ext.description},
            updated_at = NOW()
          WHERE id = ${id}
        `);
      } else {
        await db.execute(sql`
          UPDATE att_leave_types SET
            name = ${next.name},
            is_paid = ${next.is_paid},
            unit = ${next.unit},
            requires_approval = ${next.requires_approval},
            default_days = ${next.default_days},
            is_active = ${next.is_active},
            display_order = ${next.display_order},
            updated_at = NOW()
          WHERE id = ${id}
        `);
      }
      return jsonOk({ id });
    } catch (err) {
      return jsonError("update_leave_type", err);
    }
  }

  // DELETE — soft delete (is_active=false) — R34-P2 (round3 M-G1)
  // 기존 hard DELETE는 attLeaveBalances cascade로 잔액 손실, attLeaveRequests RESTRICT로 실패.
  // 사용 이력이 있는 경우 비활성화로 처리 — 화면 조회에서는 is_active=true만 표시.
  if (method === "DELETE") {
    const id = Number(url.searchParams.get("id"));
    if (!id) return jsonError("validate_id", new Error("id 필수"), 400);

    try {
      // 사용 이력 확인
      const usageRes: any = await db.execute(sql`
        SELECT
          (SELECT COUNT(*)::int FROM att_leave_requests WHERE leave_type_id = ${id}) AS req_cnt,
          (SELECT COUNT(*)::int FROM att_leave_balances WHERE leave_type_id = ${id}) AS bal_cnt
      `);
      const usage = (Array.isArray(usageRes) ? usageRes[0] : (usageRes.rows ?? [])[0]) ?? {};
      const reqCnt = Number(usage.req_cnt ?? 0);
      const balCnt = Number(usage.bal_cnt ?? 0);

      if (reqCnt > 0 || balCnt > 0) {
        // 사용 이력 있음 — soft delete
        await db.execute(sql`
          UPDATE att_leave_types SET is_active = false, updated_at = NOW() WHERE id = ${id}
        `);
        return jsonOk({ softDeleted: id, reason: "사용 이력 존재 — 비활성화로 처리", reqCnt, balCnt });
      }

      // 사용 이력 없음 — 진짜 삭제
      await db.execute(sql`DELETE FROM att_leave_types WHERE id = ${id}`);
      return jsonOk({ deleted: id });
    } catch (err) {
      return jsonError("delete_leave_type", err);
    }
  }

  return new Response("Method Not Allowed", { status: 405 });
}
