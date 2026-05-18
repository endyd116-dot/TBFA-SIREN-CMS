import type { Context } from "@netlify/functions";
import { eq, and } from "drizzle-orm";
import { db } from "../../db";
import { workspaceFileShares } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import { badRequest, serverError, corsPreflight, methodNotAllowed, parseJson } from "../../lib/response";

function jsonOk(data: object) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  if (req.method === "POST") {
    // 공유 생성
    let targetType: string, targetId: number, sharedWith: number, permission: string, expiresAt: Date | null;
    try {
      const body: any = await parseJson(req);
      if (!body) return badRequest("요청 본문이 비어있습니다");
      targetType = String(body.targetType || "").trim();
      targetId = Number(body.targetId);
      sharedWith = Number(body.sharedWith);
      permission = ["view", "edit"].includes(body.permission) ? body.permission : "view";
      expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
    } catch (_) {
      return badRequest("잘못된 요청 형식입니다");
    }

    if (!targetType || !targetId || !sharedWith) {
      return badRequest("targetType, targetId, sharedWith는 필수입니다");
    }

    try {
      const [inserted] = await db
        .insert(workspaceFileShares)
        .values({
          targetType,
          targetId,
          sharedBy: auth.ctx.admin.uid,
          sharedWith,
          permission,
          expiresAt: expiresAt ?? undefined,
        } as any)
        .returning({ id: workspaceFileShares.id });

      return jsonOk({ ok: true, shareId: (inserted as any).id });
    } catch (err: any) {
      return serverError("파일 공유 생성 중 오류가 발생했습니다", err);
    }
  }

  if (req.method === "GET") {
    // 공유 목록 조회
    const url = new URL(req.url);
    const targetType = url.searchParams.get("targetType") || "";
    const targetId = Number(url.searchParams.get("targetId") || "0");

    if (!targetType || !targetId) {
      return badRequest("targetType과 targetId는 필수입니다");
    }

    try {
      const rows = await db
        .select({
          id: workspaceFileShares.id,
          sharedWith: workspaceFileShares.sharedWith,
          permission: workspaceFileShares.permission,
          expiresAt: workspaceFileShares.expiresAt,
        })
        .from(workspaceFileShares)
        .where(
          and(
            eq(workspaceFileShares.targetType, targetType),
            eq(workspaceFileShares.targetId, targetId)
          )
        );

      return jsonOk({ ok: true, shares: rows });
    } catch (err: any) {
      return serverError("파일 공유 목록 조회 중 오류가 발생했습니다", err);
    }
  }

  if (req.method === "DELETE") {
    // 공유 취소
    let shareId: number;
    try {
      const body: any = await parseJson(req);
      if (!body) return badRequest("요청 본문이 비어있습니다");
      shareId = Number(body.shareId);
    } catch (_) {
      return badRequest("잘못된 요청 형식입니다");
    }

    if (!shareId) return badRequest("shareId는 필수입니다");

    try {
      await db.delete(workspaceFileShares).where(eq(workspaceFileShares.id, shareId));
      return jsonOk({ ok: true });
    } catch (err: any) {
      return serverError("파일 공유 취소 중 오류가 발생했습니다", err);
    }
  }

  return methodNotAllowed();
};

export const config = { path: "/api/workspace-file-share" };

