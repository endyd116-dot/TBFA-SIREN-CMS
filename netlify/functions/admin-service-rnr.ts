/**
 * /api/admin-service-rnr
 *
 * R&R(Role & Responsibility) 매핑 CRUD.
 *
 *  GET                     : 매핑 전체 (운영자 누구나 조회)
 *  POST { serviceKind, serviceCategory?, primaryUid?, backupUid?, isFallback? }
 *                          : upsert (UNIQUE: serviceKind + serviceCategory) — super_admin 만
 *  DELETE ?id=N            : 매핑 삭제 — super_admin 만
 *
 * Fallback 슬롯: serviceKind="_global", serviceCategory="_fallback", isFallback=true (1행 전역)
 */
import type { Context } from "@netlify/functions";
import { eq, and, sql, isNull } from "drizzle-orm";
import { db } from "../../db";
import { serviceRnr, members } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/admin-service-rnr" };

const ALLOWED_KINDS = new Set(["incident", "harassment", "legal", "support", "_global"]);

function jsonError(status: number, error: string, step?: string, err?: any) {
  return new Response(JSON.stringify({
    ok: false, error, step,
    detail: err ? String(err?.message || err).slice(0, 500) : undefined,
    stack:  err?.stack ? String(err.stack).slice(0, 1000) : undefined,
  }), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

function jsonOk(data: any, message?: string) {
  return new Response(JSON.stringify({ ok: true, message: message ?? null, data }),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

export default async (req: Request, _ctx: Context) => {
  let step = "auth";
  try {
    const guard = await requireAdmin(req);
    if (!guard.ok) return (guard as { ok: false; res: Response }).res;
    const meId = guard.ctx.member.id as number;
    const isSuperAdmin = (guard.ctx.member.role || "") === "super_admin";

    /* ───── GET — 전체 조회 (운영자 누구나) ───── */
    if (req.method === "GET") {
      step = "select_rnr";
      /* members 별칭 두 번 leftJoin 방지: separate query로 이름 매핑 */
      const rows = await db
        .select({
          id:              serviceRnr.id,
          serviceKind:     serviceRnr.serviceKind,
          serviceCategory: serviceRnr.serviceCategory,
          primaryUid:      serviceRnr.primaryUid,
          backupUid:       serviceRnr.backupUid,
          isFallback:      serviceRnr.isFallback,
          updatedBy:       serviceRnr.updatedBy,
          updatedAt:       serviceRnr.updatedAt,
        })
        .from(serviceRnr);

      step = "select_member_names";
      const uids = new Set<number>();
      rows.forEach(r => {
        if (r.primaryUid) uids.add(r.primaryUid);
        if (r.backupUid)  uids.add(r.backupUid);
      });
      let nameMap = new Map<number, string>();
      if (uids.size > 0) {
        try {
          const ms = await db
            .select({ id: members.id, name: members.name })
            .from(members)
            .where(sql`${members.id} IN (${sql.join([...uids].map(u => sql`${u}`), sql`, `)})`);
          ms.forEach((m: any) => nameMap.set(m.id, m.name));
        } catch (e) {
          console.warn("[rnr] 이름 매핑 실패:", e);
        }
      }

      const mappings = rows.map(r => ({
        ...r,
        primaryName: r.primaryUid ? (nameMap.get(r.primaryUid) ?? null) : null,
        backupName:  r.backupUid  ? (nameMap.get(r.backupUid)  ?? null) : null,
      }));

      /* fallback 분리 */
      const fallback = mappings.find(r => r.isFallback) ?? null;
      const items    = mappings.filter(r => !r.isFallback);

      return jsonOk({ fallback, items, total: items.length, canEdit: isSuperAdmin });
    }

    /* ───── POST — upsert (super_admin 만) ───── */
    if (req.method === "POST") {
      step = "post_perm";
      if (!isSuperAdmin) return jsonError(403, "어드민만 편집할 수 있어요", step);

      step = "post_parse";
      let body: any;
      try { body = await req.json(); } catch { return jsonError(400, "JSON 본문 파싱 실패", step); }

      const serviceKind = String(body?.serviceKind || "").trim();
      const serviceCategoryRaw = body?.serviceCategory;
      const serviceCategory = (serviceCategoryRaw === null || serviceCategoryRaw === undefined || serviceCategoryRaw === "")
        ? null : String(serviceCategoryRaw).trim().slice(0, 50);
      const primaryUid = body?.primaryUid ? Number(body.primaryUid) : null;
      const backupUid  = body?.backupUid  ? Number(body.backupUid)  : null;
      const isFallback = body?.isFallback === true;

      step = "post_validate";
      if (!ALLOWED_KINDS.has(serviceKind)) return jsonError(400, "serviceKind 값 오류", step);
      if (primaryUid !== null && (!Number.isFinite(primaryUid) || primaryUid <= 0)) return jsonError(400, "primaryUid 형식 오류", step);
      if (backupUid !== null && (!Number.isFinite(backupUid)  || backupUid  <= 0)) return jsonError(400, "backupUid 형식 오류", step);

      step = "post_upsert";
      /* UNIQUE(service_kind, service_category) 충돌 시 UPDATE */
      const existing = await db
        .select({ id: serviceRnr.id })
        .from(serviceRnr)
        .where(
          serviceCategory === null
            ? and(eq(serviceRnr.serviceKind, serviceKind), isNull(serviceRnr.serviceCategory))
            : and(eq(serviceRnr.serviceKind, serviceKind), eq(serviceRnr.serviceCategory, serviceCategory))
        )
        .limit(1);

      if (existing[0]) {
        await db
          .update(serviceRnr)
          .set({
            primaryUid,
            backupUid,
            isFallback,
            updatedBy: meId,
            updatedAt: new Date(),
          } as any)
          .where(eq(serviceRnr.id, existing[0].id));
        return jsonOk({ id: existing[0].id, updated: true }, "매핑이 저장됐어요");
      } else {
        const ins: any = await db
          .insert(serviceRnr)
          .values({
            serviceKind,
            serviceCategory,
            primaryUid,
            backupUid,
            isFallback,
            updatedBy: meId,
          } as any)
          .returning({ id: serviceRnr.id });
        return jsonOk({ id: Number(ins[0]?.id), updated: false }, "매핑이 저장됐어요");
      }
    }

    /* ───── DELETE ?id=N — super_admin 만 ───── */
    if (req.method === "DELETE") {
      step = "delete_perm";
      if (!isSuperAdmin) return jsonError(403, "어드민만 편집할 수 있어요", step);

      step = "delete_validate";
      const url = new URL(req.url);
      const id = Number(url.searchParams.get("id"));
      if (!Number.isFinite(id) || id <= 0) return jsonError(400, "id 필수", step);

      step = "delete_row";
      /* Fallback 슬롯은 삭제 금지 (초기화는 primary/backup null로 update) */
      const [row]: any = await db.select({ isFallback: serviceRnr.isFallback })
        .from(serviceRnr).where(eq(serviceRnr.id, id)).limit(1);
      if (!row) return jsonError(404, "매핑을 찾을 수 없습니다", step);
      if (row.isFallback) return jsonError(400, "Fallback 슬롯은 삭제 불가 (담당자 null로 초기화)", step);

      await db.delete(serviceRnr).where(eq(serviceRnr.id, id));
      return jsonOk({ id }, "매핑이 삭제됐어요");
    }

    return jsonError(405, "허용되지 않은 메서드", "method");
  } catch (err: any) {
    console.error("[admin-service-rnr] error:", err);
    return jsonError(500, "R&R 처리 중 오류", step, err);
  }
};
