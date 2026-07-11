// netlify/functions/admin-workspace-file-purge.ts
/**
 * DELETE /api/admin-workspace-file-purge?fileId=N
 *   파일 영구 삭제 (DB row + R2 객체)
 *   - 권한: super_admin or 소유자
 *   - [감사#77] R2 삭제 성공 후에만 DB 삭제 (실패 시 행 보존·크론 재시도 — 저장소 고아 방지)
 */
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { workspaceFiles } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import { deleteFromR2 } from "../../lib/r2-delete";
import { logAudit } from "../../lib/audit";
import {
  ok, badRequest, notFound, forbidden,
  methodNotAllowed, corsPreflight, serverError,
} from "../../lib/response";

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "DELETE" && req.method !== "POST") return methodNotAllowed();

  try {
    const auth = await requireAdmin(req);
    if (!auth.ok) return (auth as { ok: false; res: Response }).res;
    const meId = (auth.ctx.member as any)?.id || (auth.ctx.admin as any)?.id;
    const meRole = (auth.ctx.member as any)?.role || (auth.ctx.admin as any)?.role;

    const url = new URL(req.url);
    const fileId = parseInt(url.searchParams.get("fileId") || "0", 10);
    if (!fileId) return badRequest("fileId 필수");

    const rows = await db
      .select()
      .from(workspaceFiles)
      .where(eq(workspaceFiles.id, fileId))
      .limit(1);
    const file = rows[0];
    if (!file) return notFound("파일을 찾을 수 없습니다");

    const isSuper = meRole === "super_admin";
    const isOwner = (file as any).ownerId === meId;
    if (!isSuper && !isOwner) return forbidden("영구 삭제 권한이 없습니다");

    let r2Result: { success: boolean; error?: string } = { success: true };
    if ((file as any).r2Key) {
      r2Result = await deleteFromR2((file as any).r2Key);
    }

    // [감사#77] R2 삭제 실패 시 DB 행 보존 → 크론/재호출 재시도(추적 불가 고아 방지)
    if (!r2Result.success) {
      return ok(
        { success: false, r2Deleted: false, r2Error: r2Result.error },
        "저장소 파일 삭제에 실패했습니다. 기록을 보존했으니 잠시 후 다시 시도해 주세요"
      );
    }

    await db.delete(workspaceFiles).where(eq(workspaceFiles.id, fileId));

    try {
      await logAudit({
        userId: meId,
        userType: "admin",
        action: "WORKSPACE_FILE_PURGE",
        target: `workspace_file:${fileId}`,   // Q3-023 fix: logAudit 실제 필드(userId·target)로 교정 (기존 memberId/targetType/targetId는 무시돼 누락)
        detail: {
          fileName: (file as any).name,
          sizeBytes: (file as any).sizeBytes,
          r2Key: (file as any).r2Key,
          r2DeleteSuccess: r2Result.success,
          r2Error: r2Result.error,
        },
      } as any);
    } catch (e) {
      console.warn("[file-purge] audit failed:", e);
    }

    return ok({
      success: true,
      r2Deleted: r2Result.success,
      r2Error: r2Result.error,
    }, "영구 삭제되었습니다");
  } catch (err: any) {
    console.error("[file-purge] error:", err);
    return serverError(err?.message || "영구 삭제 실패");
  }
};

export const config = { path: "/api/admin-workspace-file-purge" };
