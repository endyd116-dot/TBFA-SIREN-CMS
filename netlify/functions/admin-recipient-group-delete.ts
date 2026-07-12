// netlify/functions/admin-recipient-group-delete.ts
// Phase 10 R2 — 수신자 그룹 soft delete (is_active=false)

import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/admin-recipient-group-delete" };

const JSON_HEADER = { "Content-Type": "application/json" };

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  const url = new URL(req.url);
  const id = parseInt(url.searchParams.get("id") || "0", 10);
  if (!Number.isInteger(id) || id <= 0) {
    return new Response(
      jsonKST({ ok: false, error: "id가 올바르지 않습니다.", step: "validate" }),
      { status: 400, headers: JSON_HEADER },
    );
  }

  try {
    const existsRes: any = await db.execute(
      sql`SELECT id, is_active FROM recipient_groups WHERE id = ${id} LIMIT 1`,
    );
    const rows = existsRes?.rows ?? existsRes ?? [];
    if (rows.length === 0) {
      return new Response(
        jsonKST({ ok: false, error: "그룹을 찾을 수 없습니다.", step: "not_found" }),
        { status: 404, headers: JSON_HEADER },
      );
    }
  } catch (err: any) {
    return new Response(
      jsonKST({
        ok: false, error: "그룹 조회 실패", step: "select_existing",
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }),
      { status: 500, headers: JSON_HEADER },
    );
  }

  /* AD-061: 사용 중(예약·대기 발송 작업·자동발송 트리거) 검사 — 삭제 시 해당 발송이 발송일에 조용히 실패하는 것 방지.
     force=1이면 경고를 무시하고 강제 삭제. */
  const force = url.searchParams.get("force") === "1";
  if (!force) {
    let usedJobs = 0, usedTriggers = 0;
    try {
      const jr: any = await db.execute(sql`SELECT COUNT(*)::int AS n FROM communication_send_jobs WHERE recipient_group_id = ${id} AND status IN ('pending','scheduled','processing')`);
      usedJobs = Number((jr?.rows ?? jr ?? [])[0]?.n || 0);
    } catch {}
    try {
      const tr: any = await db.execute(sql`SELECT COUNT(*)::int AS n FROM communication_auto_triggers WHERE recipient_group_id = ${id} AND is_active = true`);
      usedTriggers = Number((tr?.rows ?? tr ?? [])[0]?.n || 0);
    } catch {}
    if (usedJobs > 0 || usedTriggers > 0) {
      return new Response(jsonKST({
        ok: false, step: "in_use",
        error: `이 그룹은 예약·대기 발송 ${usedJobs}건, 자동발송 트리거 ${usedTriggers}건에서 사용 중입니다. 삭제하면 해당 발송이 발송 시점에 실패합니다. 먼저 발송을 취소·변경하거나, 강제 삭제(force=1)로 진행하세요.`,
        inUse: { jobs: usedJobs, triggers: usedTriggers },
      }), { status: 409, headers: JSON_HEADER });
    }
  }

  try {
    const adminId = (auth as any).ctx.admin.uid;
    await db.execute(sql`
      UPDATE recipient_groups
      SET is_active = false, updated_by = ${adminId}, updated_at = NOW()
      WHERE id = ${id}
    `);
    return new Response(jsonKST({ ok: true }), { status: 200, headers: JSON_HEADER });
  } catch (err: any) {
    return new Response(
      jsonKST({
        ok: false, error: "그룹 삭제 실패", step: "update",
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }),
      { status: 500, headers: JSON_HEADER },
    );
  }
}
