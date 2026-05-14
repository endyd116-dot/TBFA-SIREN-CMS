import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-revenue-category-update" };

function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "매출 카테고리 수정 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}

/**
 * 매출 카테고리 수정 — 이름·설명·상위분류·활성여부 변경.
 * code 는 변경 불가(안정 식별자). is_active=false 가 '삭제' 대신 — 매출 기록이 참조하는 분류 보호.
 * 시스템 분류(기존 6개 시드): 이름 변경·비활성·상위분류 지정 불가, 설명·순서만 변경 가능.
 */
export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method Not Allowed" }),
      { status: 405, headers: { "Content-Type": "application/json" } });
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  let body: any;
  try {
    body = await req.json();
  } catch (err) {
    return jsonError("parse_body", err, 400);
  }

  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) {
    return jsonError("validate", new Error("유효한 id가 필요합니다."), 400);
  }

  try {
    const cur: any = await db.execute(sql`
      SELECT id, code, name, description, parent_id, is_system, sort_order, is_active
      FROM revenue_categories WHERE id = ${id} LIMIT 1`);
    const row = (cur?.rows ?? cur ?? [])[0];
    if (!row) {
      return jsonError("not_found", new Error("카테고리를 찾을 수 없습니다."), 404);
    }
    const isSystem = row.is_system === true;

    // 부분 수정 — 전달된 필드만 갱신
    let name        = row.name;
    let description = row.description;
    let parentId    = row.parent_id != null ? Number(row.parent_id) : null;
    let isActive    = row.is_active;
    const sortOrder = body?.sortOrder !== undefined && Number.isFinite(Number(body.sortOrder))
      ? Number(body.sortOrder) : Number(row.sort_order);

    if (body?.description !== undefined) {
      description = body.description ? String(body.description).trim() : null;
    }

    if (isSystem) {
      // 시스템 분류 — 이름·활성·상위분류 변경 시도 거부
      if (body?.name !== undefined && String(body.name).trim() !== row.name) {
        return jsonError("system_protected", new Error("기본 매출 분류의 이름은 변경할 수 없습니다."), 400);
      }
      if (body?.isActive !== undefined && Boolean(body.isActive) !== row.is_active) {
        return jsonError("system_protected", new Error("기본 매출 분류는 비활성할 수 없습니다."), 400);
      }
      if (body?.parentId !== undefined && body.parentId) {
        return jsonError("system_protected", new Error("기본 매출 분류는 대분류로 고정됩니다."), 400);
      }
    } else {
      if (body?.name !== undefined) {
        name = String(body.name).trim();
        if (!name) return jsonError("validate", new Error("카테고리명을 입력하세요."), 400);
      }
      if (body?.isActive !== undefined) isActive = Boolean(body.isActive);
      if (body?.parentId !== undefined) {
        const newParent = body.parentId ? Number(body.parentId) : null;
        if (newParent !== null) {
          if (newParent === id) {
            return jsonError("validate", new Error("자기 자신을 상위 분류로 지정할 수 없습니다."), 400);
          }
          // 이 카테고리에 소분류가 있으면 → 소분류로 강등 불가 (2단계 초과)
          const kids: any = await db.execute(sql`
            SELECT id FROM revenue_categories WHERE parent_id = ${id} LIMIT 1`);
          if ((kids?.rows ?? kids ?? []).length > 0) {
            return jsonError("validate", new Error("하위 분류가 있는 분류는 다른 분류 아래로 옮길 수 없습니다."), 400);
          }
          // 상위 분류 실존 + 대분류 확인
          const pa: any = await db.execute(sql`
            SELECT id, parent_id FROM revenue_categories WHERE id = ${newParent} LIMIT 1`);
          const parent = (pa?.rows ?? pa ?? [])[0];
          if (!parent) {
            return jsonError("validate", new Error("상위 분류가 존재하지 않습니다."), 400);
          }
          if (parent.parent_id != null) {
            return jsonError("validate", new Error("소분류 아래에 분류를 둘 수 없습니다 (2단계까지)."), 400);
          }
        }
        parentId = newParent;
      }
    }

    const upd: any = await db.execute(sql`
      UPDATE revenue_categories SET
        name = ${name}, description = ${description},
        parent_id = ${parentId}, is_active = ${isActive},
        sort_order = ${sortOrder}, updated_at = NOW()
      WHERE id = ${id}
      RETURNING id, code, name, description, parent_id, is_system, sort_order, is_active`);
    const updated = (upd?.rows ?? upd ?? [])[0];

    return new Response(JSON.stringify({
      ok: true,
      data: {
        id: Number(updated.id), code: updated.code, name: updated.name,
        description: updated.description,
        parentId: updated.parent_id != null ? Number(updated.parent_id) : null,
        isSystem: updated.is_system === true,
        sortOrder: Number(updated.sort_order), isActive: updated.is_active,
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return jsonError("update", err);
  }
}
