/**
 * netlify/functions/admin-memorial-spotlights.ts — "이달에 기억할 선생님" 관리
 *
 * GET    /api/admin-memorial-spotlights        — 전체 목록 + 코너 제목·설명 + 선생님 후보
 * POST   /api/admin-memorial-spotlights        — 등록
 * PATCH  /api/admin-memorial-spotlights        — 수정 { id, ... }
 * PATCH  /api/admin-memorial-spotlights?action=text — 코너 제목·설명 저장
 * DELETE /api/admin-memorial-spotlights?id=N   — 삭제
 *
 * 권한: 관리자 + cms_memorial (추모관 관리와 같은 권한키)
 */
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import {
  ok, created, badRequest, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import {
  listSpotlights, createSpotlight, updateSpotlight, deleteSpotlight,
  getSpotlightText, saveSpotlightText, spotlightReady,
} from "../../lib/memorial-spotlight";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { logAdminAction } from "../../lib/audit";

export const config = { path: "/api/admin-memorial-spotlights" };

function rowsOf(result: any): any[] {
  if (!result) return [];
  return Array.isArray(result) ? result : (result.rows ?? []);
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();

  const guard = await requireAdmin(req);
  if (guardFailed(guard)) return guard.res;
  const { admin } = guard.ctx;

  let step = "start";
  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "";

    /* ===== GET ===== */
    if (req.method === "GET") {
      step = "list";
      const [items, text, ready] = await Promise.all([
        listSpotlights(), getSpotlightText(), spotlightReady(),
      ]);

      /* 등록할 때 고를 수 있는 선생님 목록 */
      let teachers: any[] = [];
      try {
        teachers = rowsOf(await db.execute(sql`
          SELECT id, name FROM memorial_teachers ORDER BY sort_order ASC, id ASC
        `)).map((r: any) => ({ id: Number(r.id), name: r.name }));
      } catch (_) { /* 없으면 빈 목록 */ }

      return ok({ items, ...text, teachers, ready });
    }

    /* ===== POST: 등록 ===== */
    if (req.method === "POST") {
      step = "create";
      const body = await parseJson<any>(req);
      const res = await createSpotlight(body || {});
      if (!res.ok) return badRequest(res.error || "등록하지 못했습니다");

      try {
        await logAdminAction(req, admin.uid, admin.name, "memorial_spotlight_create", {
          target: `spotlight-${res.id}`, detail: { name: body?.displayName, date: body?.occasionDate },
        });
      } catch (_) {}

      return created({ id: res.id }, "등록되었습니다");
    }

    /* ===== PATCH: 수정 / 코너 문구 ===== */
    if (req.method === "PATCH") {
      const body = await parseJson<any>(req);

      if (action === "text") {
        step = "save_text";
        await saveSpotlightText(body?.title, body?.desc);
        return ok(await getSpotlightText(), "코너 문구가 저장되었습니다");
      }

      step = "update";
      const id = Number(body?.id);
      if (!Number.isFinite(id)) return badRequest("수정할 항목을 지정해주세요");

      const res = await updateSpotlight(id, body || {});
      if (!res.ok) return badRequest(res.error || "저장하지 못했습니다");

      try {
        await logAdminAction(req, admin.uid, admin.name, "memorial_spotlight_update", {
          target: `spotlight-${id}`, detail: { name: body?.displayName },
        });
      } catch (_) {}

      return ok({ id }, "저장되었습니다");
    }

    /* ===== DELETE ===== */
    if (req.method === "DELETE") {
      step = "delete";
      const id = Number(url.searchParams.get("id"));
      if (!Number.isFinite(id)) return badRequest("삭제할 항목을 지정해주세요");

      const res = await deleteSpotlight(id);
      if (!res.ok) return notFound(res.error || "삭제하지 못했습니다");

      try {
        await logAdminAction(req, admin.uid, admin.name, "memorial_spotlight_delete", {
          target: `spotlight-${id}`, detail: { id },
        });
      } catch (_) {}

      return ok({ id }, "삭제되었습니다");
    }

    return methodNotAllowed();
  } catch (e: any) {
    console.error("[admin-memorial-spotlights]", step, e);
    return serverError("처리에 실패했습니다", e, step);
  }
};
