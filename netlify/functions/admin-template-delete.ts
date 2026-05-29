// netlify/functions/admin-template-delete.ts
// Phase 10 R1 — 발송 템플릿 soft delete (is_active=false)

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/admin-template-delete" };

const JSON_HEADER = { "Content-Type": "application/json" };

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  const url = new URL(req.url);
  const id = parseInt(url.searchParams.get("id") || "0", 10);
  if (!id) {
    return new Response(JSON.stringify({ ok: false, error: "id 파라미터가 필요합니다." }), {
      status: 400,
      headers: JSON_HEADER,
    });
  }

  try {
    const existRes: any = await db.execute(
      sql`SELECT id FROM communication_templates WHERE id = ${id} LIMIT 1`
    );
    const exist = (existRes?.rows ?? existRes ?? [])[0];
    if (!exist) {
      return new Response(JSON.stringify({ ok: false, error: "템플릿을 찾을 수 없습니다." }), {
        status: 404,
        headers: JSON_HEADER,
      });
    }
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false, error: "템플릿 조회 실패", step: "select_exist",
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }),
      { status: 500, headers: JSON_HEADER },
    );
  }

  /* AD-061: 사용 중(예약·대기 발송 작업·자동발송 트리거) 검사 — 삭제 시 발송 시점 실패 방지. force=1로 강제 삭제 가능. */
  const force = url.searchParams.get("force") === "1";
  if (!force) {
    let usedJobs = 0, usedTriggers = 0;
    try {
      const jr: any = await db.execute(sql`SELECT COUNT(*)::int AS n FROM communication_send_jobs WHERE template_id = ${id} AND status IN ('pending','scheduled','processing')`);
      usedJobs = Number((jr?.rows ?? jr ?? [])[0]?.n || 0);
    } catch {}
    try {
      const tr: any = await db.execute(sql`SELECT COUNT(*)::int AS n FROM communication_auto_triggers WHERE template_id = ${id} AND is_active = true`);
      usedTriggers = Number((tr?.rows ?? tr ?? [])[0]?.n || 0);
    } catch {}
    if (usedJobs > 0 || usedTriggers > 0) {
      return new Response(JSON.stringify({
        ok: false, step: "in_use",
        error: `이 템플릿은 예약·대기 발송 ${usedJobs}건, 자동발송 트리거 ${usedTriggers}건에서 사용 중입니다. 삭제하면 해당 발송이 발송 시점에 실패합니다. 먼저 발송을 취소·변경하거나, 강제 삭제(force=1)로 진행하세요.`,
        inUse: { jobs: usedJobs, triggers: usedTriggers },
      }), { status: 409, headers: JSON_HEADER });
    }
  }

  try {
    const adminId = auth.ctx.admin.uid;
    await db.execute(
      sql`UPDATE communication_templates
          SET is_active  = false,
              updated_by = ${adminId},
              updated_at = NOW()
          WHERE id = ${id}`
    );

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: JSON_HEADER,
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false, error: "템플릿 삭제 실패", step: "soft_delete",
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }),
      { status: 500, headers: JSON_HEADER },
    );
  }
}
