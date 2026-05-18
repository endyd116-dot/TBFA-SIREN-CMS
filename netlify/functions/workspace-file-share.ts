// netlify/functions/workspace-file-share.ts
// 라운드 10 — 워크스페이스 파일 공유 CRUD (단순화 응답)
//
// POST   /api/workspace-file-share { targetType, targetId, sharedWith, permission, expiresAt? }
//        응답: { ok, shareId }
// GET    /api/workspace-file-share?targetType=file&targetId=10
//        응답: { ok, shares:[{id, sharedWith, permission, expiresAt}] }
// DELETE /api/workspace-file-share { shareId }
//        응답: { ok }
//
// 비고: 기존 /api/admin-workspace-file-share 와 동등 기능이나, 응답 구조가 단순화된
//       라운드 10 신규 엔드포인트 (프론트 일관성용).

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/workspace-file-share" };

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function jsonError(step: string, err: any, status = 500) {
  return json({
    ok: false,
    error: "파일 공유 처리 실패",
    step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }, status);
}

const VALID_TARGET = new Set(["file", "folder"]);
const VALID_PERM = new Set(["view", "edit"]);

export default async (req: Request, _ctx: Context) => {
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;
  const meId = (auth.ctx.member as any).id as number;

  const url = new URL(req.url);

  /* ── GET — 공유 목록 ── */
  if (req.method === "GET") {
    const targetType = url.searchParams.get("targetType") || "";
    const targetId = Number(url.searchParams.get("targetId") || 0);
    if (!VALID_TARGET.has(targetType)) return json({ ok: false, error: "targetType은 file 또는 folder" }, 400);
    if (!targetId) return json({ ok: false, error: "targetId 필요" }, 400);

    try {
      const r: any = await db.execute(sql`
        SELECT id, shared_with, permission, expires_at
        FROM workspace_file_shares
        WHERE target_type = ${targetType} AND target_id = ${targetId}
        ORDER BY created_at DESC
      `);
      const rows = (r?.rows ?? r) as any[];
      const shares = rows.map(s => ({
        id: s.id,
        sharedWith: s.shared_with,
        permission: s.permission,
        expiresAt: s.expires_at,
      }));
      return json({ ok: true, shares });
    } catch (err: any) {
      return jsonError("select", err);
    }
  }

  /* ── POST — 공유 생성 ── */
  if (req.method === "POST") {
    let body: any;
    try { body = await req.json(); } catch { return json({ ok: false, error: "JSON 파싱 오류" }, 400); }

    const targetType = String(body?.targetType || "");
    const targetId = Number(body?.targetId || 0);
    const sharedWith = body?.sharedWith != null ? Number(body.sharedWith) : null;
    const permission = VALID_PERM.has(body?.permission) ? body.permission : "view";
    const expiresAt = body?.expiresAt ? new Date(body.expiresAt) : null;

    if (!VALID_TARGET.has(targetType)) return json({ ok: false, error: "targetType은 file 또는 folder" }, 400);
    if (!targetId) return json({ ok: false, error: "targetId 필요" }, 400);
    if (expiresAt && isNaN(expiresAt.getTime())) return json({ ok: false, error: "expiresAt 형식 오류" }, 400);

    try {
      // 중복 → 업데이트
      const dupRes: any = await db.execute(sql`
        SELECT id FROM workspace_file_shares
        WHERE target_type = ${targetType} AND target_id = ${targetId}
          AND shared_with ${sharedWith == null ? sql`IS NULL` : sql`= ${sharedWith}`}
        LIMIT 1
      `);
      const dup = (dupRes?.rows ?? dupRes)?.[0];
      if (dup) {
        await db.execute(sql`
          UPDATE workspace_file_shares
             SET permission = ${permission},
                 expires_at = ${expiresAt}
           WHERE id = ${dup.id}
        `);
        return json({ ok: true, shareId: Number(dup.id) });
      }

      const insRes: any = await db.execute(sql`
        INSERT INTO workspace_file_shares
          (target_type, target_id, shared_by, shared_with, permission, expires_at, created_at)
        VALUES
          (${targetType}, ${targetId}, ${meId}, ${sharedWith}, ${permission}, ${expiresAt}, now())
        RETURNING id
      `);
      const newId = Number((insRes?.rows ?? insRes)?.[0]?.id);
      return json({ ok: true, shareId: newId });
    } catch (err: any) {
      return jsonError("insert", err);
    }
  }

  /* ── DELETE — 공유 취소 ── */
  if (req.method === "DELETE") {
    let body: any;
    try { body = await req.json(); } catch { return json({ ok: false, error: "JSON 파싱 오류" }, 400); }
    const shareId = Number(body?.shareId);
    if (!Number.isFinite(shareId) || shareId <= 0) {
      return json({ ok: false, error: "shareId 필요" }, 400);
    }

    try {
      await db.execute(sql`DELETE FROM workspace_file_shares WHERE id = ${shareId}`);
      return json({ ok: true });
    } catch (err: any) {
      return jsonError("delete", err);
    }
  }

  return json({ ok: false, error: "GET/POST/DELETE only" }, 405);
};
