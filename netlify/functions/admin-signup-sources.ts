// netlify/functions/admin-signup-sources.ts
// ★ Phase M-12: 가입 경로 마스터 CRUD
// GET    /api/admin/signup-sources           — 전체 목록
// POST   /api/admin/signup-sources           — 신규 추가
// PATCH  /api/admin/signup-sources           — 수정 (id 필수)
// DELETE /api/admin/signup-sources?id=N      — 삭제 (사용 중이면 거부)

import { eq, asc, sql, count } from "drizzle-orm";
import { db } from "../../db";
import { signupSources, members } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, created, badRequest, notFound, forbidden, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logAdminAction } from "../../lib/audit";

export const config = { path: "/api/admin/signup-sources" };

/* code 검증: 영문 소문자/숫자/언더스코어/하이픈만 */
const CODE_PATTERN = /^[a-z0-9_-]+$/;

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();

  const guard: any = await requireAdmin(req);
  if (!guard.ok) return guard.res;
  const { admin } = guard.ctx;

  try {
    /* ===== GET: 전체 목록 + 회원 카운트 ===== */
    if (req.method === "GET") {
      const url = new URL(req.url);
      const includeInactive = url.searchParams.get("includeInactive") === "1";

      /* 가입경로 + 사용 중인 회원 수 */
      const list = await db.execute(sql`
        SELECT
          s.id,
          s.code,
          s.label,
          s.description,
          s.is_active AS "isActive",
          s.sort_order AS "sortOrder",
          s.created_at AS "createdAt",
          s.updated_at AS "updatedAt",
          COUNT(m.id) FILTER (WHERE m.status != 'withdrawn')::int AS "memberCount"
        FROM signup_sources s
        LEFT JOIN members m ON m.signup_source_id = s.id
        ${includeInactive ? sql`` : sql`WHERE s.is_active = TRUE`}
        GROUP BY s.id
        ORDER BY s.sort_order ASC, s.id ASC
      `);

      return ok({ list });
    }

    /* ===== POST: 신규 추가 ===== */
    if (req.method === "POST") {
      const body: any = await parseJson(req);
      if (!body) return badRequest("요청 본문이 비어있습니다");

      const code = String(body.code || "").trim().toLowerCase();
      const label = String(body.label || "").trim().slice(0, 100);
      const description = String(body.description || "").trim().slice(0, 300) || null;
      const isActive = body.isActive !== false;
      const sortOrder = Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0;

      if (!code) return badRequest("code는 필수입니다");
      if (!CODE_PATTERN.test(code)) {
        return badRequest("code는 영문 소문자/숫자/언더스코어/하이픈만 가능합니다");
      }
      if (code.length > 50) return badRequest("code는 50자 이하여야 합니다");
      if (!label) return badRequest("label은 필수입니다");

      /* 중복 확인 */
      const [existing] = await db.select({ id: signupSources.id })
        .from(signupSources).where(eq(signupSources.code, code)).limit(1);
      if (existing) return badRequest("이미 존재하는 code입니다");

      const insertData: any = {
        code, label, description, isActive, sortOrder,
      };
      const [row] = await db.insert(signupSources).values(insertData).returning();

      try {
        await logAdminAction(req, admin.uid, admin.name, "signup_source_create", {
          target: code, detail: { label, sortOrder },
        });
      } catch (_) {}

      return created({ source: row }, "가입 경로가 추가되었습니다");
    }

    /* ===== PATCH: 수정 ===== */
    if (req.method === "PATCH") {
      const body: any = await parseJson(req);
      if (!body?.id) return badRequest("id 필요");

      const id = Number(body.id);
      if (!Number.isFinite(id)) return badRequest("id 유효하지 않음");

      const [existing] = await db.select().from(signupSources).where(eq(signupSources.id, id)).limit(1);
      if (!existing) return notFound("가입 경로를 찾을 수 없습니다");

      /* 시드된 항목(website/admin/hyosung_csv) code 변경 거부 */
      const PROTECTED_CODES = ["website", "admin", "hyosung_csv"];
      if (body.code !== undefined && body.code !== (existing as any).code) {
        if (PROTECTED_CODES.includes((existing as any).code)) {
          return forbidden(`시스템 기본 항목(${(existing as any).code})의 code는 변경할 수 없습니다`);
        }
        const newCode = String(body.code).trim().toLowerCase();
        if (!CODE_PATTERN.test(newCode)) {
          return badRequest("code는 영문 소문자/숫자/언더스코어/하이픈만 가능합니다");
        }
        const [dup] = await db.select({ id: signupSources.id })
          .from(signupSources).where(eq(signupSources.code, newCode)).limit(1);
        if (dup) return badRequest("이미 존재하는 code입니다");
      }

      const updateData: any = { updatedAt: new Date() };
      if (body.code !== undefined) updateData.code = String(body.code).trim().toLowerCase();
      if (body.label !== undefined) updateData.label = String(body.label).trim().slice(0, 100);
      if (body.description !== undefined) {
        updateData.description = String(body.description).trim().slice(0, 300) || null;
      }
      if (body.isActive !== undefined) updateData.isActive = body.isActive !== false;
      if (body.sortOrder !== undefined) {
        updateData.sortOrder = Number(body.sortOrder) || 0;
      }

      await db.update(signupSources).set(updateData).where(eq(signupSources.id, id));

      try {
        await logAdminAction(req, admin.uid, admin.name, "signup_source_update", {
          target: (existing as any).code, detail: updateData,
        });
      } catch (_) {}

      return ok({ id, code: (existing as any).code }, "수정되었습니다");
    }

    /* ===== DELETE: 삭제 (사용 중이면 거부) ===== */
    if (req.method === "DELETE") {
      const url = new URL(req.url);
      const id = Number(url.searchParams.get("id"));
      if (!Number.isFinite(id)) return badRequest("id 필요");

      const [existing] = await db.select().from(signupSources).where(eq(signupSources.id, id)).limit(1);
      if (!existing) return notFound("가입 경로를 찾을 수 없습니다");

      /* 시스템 기본 항목 삭제 거부 */
      const PROTECTED_CODES = ["website", "admin", "hyosung_csv"];
      if (PROTECTED_CODES.includes((existing as any).code)) {
        return forbidden(`시스템 기본 항목(${(existing as any).code})은 삭제할 수 없습니다. 비활성화로 대체하세요.`);
      }

      /* 사용 중인 회원이 있는지 확인 */
      const [{ usingCount }]: any = await db
        .select({ usingCount: count() })
        .from(members)
        .where(eq(members.signupSourceId, id));

      if (Number(usingCount) > 0) {
        return forbidden(
          `이 가입 경로를 사용 중인 회원이 ${usingCount}명 있습니다. 먼저 다른 경로로 변경하거나 비활성화하세요.`,
        );
      }

      await db.delete(signupSources).where(eq(signupSources.id, id));

      try {
        await logAdminAction(req, admin.uid, admin.name, "signup_source_delete", {
          target: (existing as any).code,
        });
      } catch (_) {}

      return ok({ id }, "가입 경로가 삭제되었습니다");
    }

    return methodNotAllowed();
  } catch (e: any) {
    console.error("[admin-signup-sources]", e);
    return serverError("처리 실패", e);
  }
};