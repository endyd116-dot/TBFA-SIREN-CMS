// netlify/functions/admin-service-rnr.ts
// ★ 2026-05-12 워크스페이스 v2 — 서비스별 R&R 매핑 CRUD
//
// 권한
//   GET    : requireAdmin (운영자 누구나 — 본인 책임 영역 확인 용)
//   PATCH  : super_admin 전용 (담당자/백업/SLA 변경)
//   POST   : super_admin 전용 (신규 service_type 추가)
//   DELETE : super_admin 전용 (service_type 삭제)
//
// 응답
//   GET 응답에 매핑 행 + 후보 운영자 명단(role 보유 + operatorActive=true) 동시 반환.
//   클라이언트는 드롭다운에 곧장 사용 가능.

import { eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { serviceRnr, members } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, badRequest, forbidden, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logAdminAction } from "../../lib/audit";

export const config = { path: "/api/admin/service-rnr" };

function isSuperAdmin(adminMember: any): boolean {
  return adminMember && String(adminMember.role || "") === "super_admin";
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();

  const guard: any = await requireAdmin(req);
  if (!guard.ok) return (guard as { ok: false; res: Response }).res;
  const { admin, member: adminMember } = guard.ctx;

  try {
    /* ===== GET — 매핑 전체 + 운영자 후보 명단 ===== */
    if (req.method === "GET") {
      const rows: any = await db.execute(sql`
        SELECT
          r.id,
          r.service_type   AS "serviceType",
          r.service_label  AS "serviceLabel",
          r.primary_assignee_id  AS "primaryAssigneeId",
          r.backup_assignee_id   AS "backupAssigneeId",
          r.sla_hours      AS "slaHours",
          p.name           AS "primaryAssigneeName",
          p.email          AS "primaryAssigneeEmail",
          p.operator_active AS "primaryActive",
          b.name           AS "backupAssigneeName",
          b.email          AS "backupAssigneeEmail",
          b.operator_active AS "backupActive",
          r.updated_at     AS "updatedAt",
          r.updated_by     AS "updatedBy",
          u.name           AS "updatedByName"
        FROM service_rnr r
        LEFT JOIN members p ON p.id = r.primary_assignee_id
        LEFT JOIN members b ON b.id = r.backup_assignee_id
        LEFT JOIN members u ON u.id = r.updated_by
        ORDER BY r.id ASC
      `);
      const list = Array.isArray(rows) ? rows : (rows?.rows || []);

      /* 후보 운영자 = role 부여 + operator_active=true */
      const operatorsRaw: any = await db.execute(sql`
        SELECT id, name, email, role, operator_active AS "operatorActive"
        FROM members
        WHERE role IS NOT NULL
        ORDER BY operator_active DESC, name ASC
      `);
      const operators = Array.isArray(operatorsRaw) ? operatorsRaw : (operatorsRaw?.rows || []);

      return ok({
        list,
        operators,
        canEdit: isSuperAdmin(adminMember),
      });
    }

    /* ===== PATCH — super_admin 전용 ===== */
    if (req.method === "PATCH") {
      if (!isSuperAdmin(adminMember)) {
        return forbidden("서비스 R&R 매핑은 super_admin만 수정 가능합니다");
      }
      const body: any = await parseJson(req);
      if (!body?.id) return badRequest("id 필수");
      const id = Number(body.id);
      if (!Number.isFinite(id)) return badRequest("유효하지 않은 ID");

      const [existing] = await db.select().from(serviceRnr).where(eq(serviceRnr.id, id)).limit(1);
      if (!existing) return notFound("매핑을 찾을 수 없습니다");

      const updateData: any = { updatedAt: new Date(), updatedBy: admin.uid };
      if (body.primaryAssigneeId !== undefined) {
        updateData.primaryAssigneeId = body.primaryAssigneeId === null ? null : Number(body.primaryAssigneeId);
      }
      if (body.backupAssigneeId !== undefined) {
        updateData.backupAssigneeId = body.backupAssigneeId === null ? null : Number(body.backupAssigneeId);
      }
      if (body.slaHours !== undefined) {
        updateData.slaHours = body.slaHours === null ? null : Number(body.slaHours);
      }
      if (body.serviceLabel !== undefined) {
        updateData.serviceLabel = String(body.serviceLabel).trim().slice(0, 100);
      }

      /* primary/backup이 운영자인지 검증 (role NOT NULL) */
      for (const key of ["primaryAssigneeId", "backupAssigneeId"]) {
        const val = updateData[key];
        if (val) {
          const [m] = await db.select({ id: members.id, role: members.role })
            .from(members).where(eq(members.id, val)).limit(1);
          if (!m) return badRequest(`담당자(id=${val})를 찾을 수 없습니다`);
          if (!m.role) return badRequest(`담당자(id=${val})는 운영자가 아닙니다 (role 미부여)`);
        }
      }

      await db.update(serviceRnr).set(updateData).where(eq(serviceRnr.id, id));

      try {
        await logAdminAction(req, admin.uid, admin.name, "service_rnr_update", {
          target: (existing as any).serviceType,
          detail: updateData,
        });
      } catch (_) {}

      return ok({ id }, "R&R 매핑이 수정되었습니다");
    }

    /* ===== POST — super_admin 전용 (신규 service_type 추가) ===== */
    if (req.method === "POST") {
      if (!isSuperAdmin(adminMember)) {
        return forbidden("서비스 R&R 매핑은 super_admin만 추가 가능합니다");
      }
      const body: any = await parseJson(req);
      const serviceType = String(body?.serviceType || "").trim().toLowerCase();
      const serviceLabel = String(body?.serviceLabel || "").trim().slice(0, 100);
      if (!serviceType) return badRequest("serviceType은 필수입니다");
      if (!serviceLabel) return badRequest("serviceLabel은 필수입니다");
      if (!/^[a-z0-9_-]+$/.test(serviceType)) {
        return badRequest("serviceType은 영문 소문자/숫자/언더스코어/하이픈만 가능");
      }

      const [dup] = await db.select({ id: serviceRnr.id })
        .from(serviceRnr).where(eq(serviceRnr.serviceType, serviceType)).limit(1);
      if (dup) return badRequest("이미 존재하는 serviceType");

      const insertData: any = {
        serviceType,
        serviceLabel,
        primaryAssigneeId: body.primaryAssigneeId ? Number(body.primaryAssigneeId) : null,
        backupAssigneeId: body.backupAssigneeId ? Number(body.backupAssigneeId) : null,
        slaHours: body.slaHours ? Number(body.slaHours) : null,
        updatedBy: admin.uid,
      };
      const [row] = await db.insert(serviceRnr).values(insertData).returning();

      try {
        await logAdminAction(req, admin.uid, admin.name, "service_rnr_create", {
          target: serviceType, detail: { serviceLabel },
        });
      } catch (_) {}

      return ok({ row }, "신규 서비스 매핑이 추가되었습니다");
    }

    /* ===== DELETE — super_admin 전용 ===== */
    if (req.method === "DELETE") {
      if (!isSuperAdmin(adminMember)) {
        return forbidden("서비스 R&R 매핑은 super_admin만 삭제 가능합니다");
      }
      const url = new URL(req.url);
      const id = Number(url.searchParams.get("id"));
      if (!Number.isFinite(id)) return badRequest("id 필수");

      const [existing] = await db.select().from(serviceRnr).where(eq(serviceRnr.id, id)).limit(1);
      if (!existing) return notFound("매핑을 찾을 수 없습니다");

      await db.delete(serviceRnr).where(eq(serviceRnr.id, id));

      try {
        await logAdminAction(req, admin.uid, admin.name, "service_rnr_delete", {
          target: (existing as any).serviceType,
        });
      } catch (_) {}

      return ok({ id }, "삭제되었습니다");
    }

    return methodNotAllowed();
  } catch (e: any) {
    console.error("[admin-service-rnr]", e);
    return serverError("처리 실패", e?.message);
  }
};
