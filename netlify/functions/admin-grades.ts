// netlify/functions/admin-grades.ts
// ★ Phase M-19-1: 회원 등급 마스터 CRUD
// ★ Pass 1-C 패치: schema.ts 정합화 (color → colorHex, benefits 제거, description 추가)
//
// GET    /api/admin/grades         — 전체 등급 5개 + 회원 수 (운영자)
// GET    /api/admin/grades/public  — 공개 등급 정보 (마이페이지)
// PATCH  /api/admin/grades         — 단일 등급 수정 (super_admin)

import { eq, asc, sql } from "drizzle-orm";
import { db, members, memberGrades } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, badRequest, notFound, forbidden, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logAdminAction } from "../../lib/audit";

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();

  const url = new URL(req.url);
  const isPublic = url.pathname.endsWith("/public");

  /* ===== 공개 GET ===== */
  if (req.method === "GET" && isPublic) {
    try {
      const list = await db
        .select({
          id: memberGrades.id,
          code: memberGrades.code,
          nameKo: memberGrades.nameKo,
          nameEn: memberGrades.nameEn,
          minTotalAmount: memberGrades.minTotalAmount,
          minRegularMonths: memberGrades.minRegularMonths,
          colorHex: memberGrades.colorHex,    // ★ Pass 1-C: color → colorHex
          icon: memberGrades.icon,
          sortOrder: memberGrades.sortOrder,
          description: memberGrades.description,  // ★ Pass 1-C: 추가
        })
        .from(memberGrades)
        .orderBy(asc(memberGrades.sortOrder));
      return ok({ list });
    } catch (e) {
      return serverError("등급 조회 실패", e);
    }
  }

  /* ===== 관리자 인증 ===== */
  const guard: any = await requireAdmin(req);
  if (!guard.ok) return guard.res;
  const { admin, member: adminMember } = guard.ctx;

  try {
    /* GET — 전체 + 회원 수 */
    if (req.method === "GET") {
      const list = await db
        .select()
        .from(memberGrades)
        .orderBy(asc(memberGrades.sortOrder));

      /* 등급별 회원 수 카운트 */
      const counts: any = await db.execute(sql`
        SELECT grade_id, COUNT(*)::int AS cnt
        FROM members
        WHERE status != 'withdrawn' AND type != 'admin'
        GROUP BY grade_id
      `);

      const countMap: Record<string, number> = {};
      const rows = Array.isArray(counts) ? counts : (counts.rows || counts);
      for (const r of rows as any[]) {
        if (r.grade_id) countMap[String(r.grade_id)] = Number(r.cnt) || 0;
      }

      const enriched = list.map((g: any) => ({
        ...g,
        memberCount: countMap[String(g.id)] || 0,
      }));

      return ok({ list: enriched });
    }

    /* PATCH — 등급 수정 (super_admin) */
    if (req.method === "PATCH") {
      if (adminMember.role !== "super_admin") {
        return forbidden("등급 수정은 슈퍼 관리자만 가능합니다");
      }

      const body = await parseJson(req);
      if (!body?.id) return badRequest("id가 필요합니다");

      const id = Number(body.id);
      if (!Number.isFinite(id)) return badRequest("유효하지 않은 ID");

      const [existing] = await db
        .select()
        .from(memberGrades)
        .where(eq(memberGrades.id, id))
        .limit(1);
      if (!existing) return notFound("등급을 찾을 수 없습니다");

      const updatePayload: any = { updatedAt: new Date() };
      const changedFields: string[] = [];

      if (typeof body.nameKo === "string" && body.nameKo.trim().length > 0) {
        updatePayload.nameKo = body.nameKo.trim().slice(0, 50);
        changedFields.push("nameKo");
      }
      if (typeof body.nameEn === "string") {
        updatePayload.nameEn = body.nameEn.trim().slice(0, 50);
        changedFields.push("nameEn");
      }
      if (Number.isFinite(Number(body.minTotalAmount))) {
        updatePayload.minTotalAmount = Math.max(0, Number(body.minTotalAmount));
        changedFields.push("minTotalAmount");
      }
      if (Number.isFinite(Number(body.minRegularMonths))) {
        updatePayload.minRegularMonths = Math.max(0, Number(body.minRegularMonths));
        changedFields.push("minRegularMonths");
      }
      /* ★ Pass 1-C: color → colorHex 변경 (#RRGGBB 또는 #RRGGBBAA 검증) */
      if (typeof body.colorHex === "string" && /^#[0-9a-f]{3,8}$/i.test(body.colorHex)) {
        updatePayload.colorHex = body.colorHex;
        changedFields.push("colorHex");
      }
      if (typeof body.icon === "string" && body.icon.trim().length > 0) {
        updatePayload.icon = body.icon.trim().slice(0, 10);
        changedFields.push("icon");
      }
      /* ★ Pass 1-C: description 추가 (schema에 존재) */
      if (typeof body.description === "string") {
        updatePayload.description = body.description.trim().slice(0, 500);
        changedFields.push("description");
      }
      if (typeof body.sortOrder !== "undefined" && Number.isFinite(Number(body.sortOrder))) {
        updatePayload.sortOrder = Number(body.sortOrder);
        changedFields.push("sortOrder");
      }
      if (typeof body.isActive === "boolean") {
        updatePayload.isActive = body.isActive;
        changedFields.push("isActive");
      }
      /* ★ Pass 1-C: benefits 제거 (schema에 없음 — DB legacy 컬럼) */

      if (changedFields.length === 0) {
        return badRequest("변경할 항목이 없습니다");
      }

      const [updated] = await db
        .update(memberGrades)
        .set(updatePayload)
        .where(eq(memberGrades.id, id))
        .returning();

      await logAdminAction(req, admin.uid, admin.name, "grade_update", {
        target: `GRADE-${id}`,
        detail: { code: existing.code, changedFields },
      });

      return ok({ grade: updated }, "등급이 수정되었습니다");
    }

    return methodNotAllowed();
  } catch (err) {
    console.error("[admin-grades]", err);
    return serverError("등급 관리 중 오류", err);
  }
};

export const config = { path: "/api/admin/grades*" };