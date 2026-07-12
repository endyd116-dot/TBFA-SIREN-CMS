/**
 * admin-martyrdom-external-review — R43 외부 자료 검토(승급/기각)
 *
 * POST { id, action:'approve'|'reject', rejectionReason? }
 *   approve → promoteToCase 호출 + RAG 'martyr_external' → 'martyr_case' 전환
 *           → { ok, promotedCaseId }
 *   reject  → status='rejected', rejection_reason 저장 → { ok }
 *
 * 권한: requireAdmin + canAccess('martyrdom_external_review')
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { roleForbidden } from "../../lib/admin-role";
import { canAccess } from "../../lib/role-permission-check";
import { promoteToCase } from "../../lib/martyrdom-external";

export const config = { path: "/api/admin-martyrdom-external-review" };

const FEATURE = "martyrdom_external_review";

function jsonError(step: string, err: any) {
  return new Response(jsonKST({
    ok: false, error: "검토 처리 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}
function badRequest(msg: string) {
  return new Response(jsonKST({ ok: false, error: msg }),
    { status: 400, headers: { "Content-Type": "application/json" } });
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "POST") return badRequest("POST만 허용");

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  const { admin, member } = auth.ctx;

  if (!(await canAccess(member.role ?? "", FEATURE))) return roleForbidden("admin");

  let body: any;
  try { body = await req.json(); } catch { return badRequest("요청 본문 파싱 실패"); }

  const id = Number(body?.id || 0);
  const action = String(body?.action || "").toLowerCase();
  if (!id) return badRequest("id 필수");
  if (action !== "approve" && action !== "reject") return badRequest("action은 approve|reject");

  /* 사전 확인 — 존재·미처리 */
  try {
    const r: any = await db.execute(sql`
      SELECT id, status FROM martyrdom_external_research WHERE id = ${id} LIMIT 1
    `);
    const row = (r?.rows ?? r ?? [])[0];
    if (!row) {
      return new Response(jsonKST({ ok: false, error: "외부 자료를 찾을 수 없습니다" }),
        { status: 404, headers: { "Content-Type": "application/json" } });
    }
    if (String(row.status) === "approved") return badRequest("이미 승급된 자료입니다");
    if (String(row.status) === "rejected" && action === "approve") return badRequest("기각된 자료는 승급할 수 없습니다");
  } catch (err: any) {
    return jsonError("select_pending", err);
  }

  if (action === "approve") {
    try {
      const r = await promoteToCase(id, admin.uid);
      if (!r.ok || !r.promotedCaseId) {
        return jsonError("promote_index", new Error(r.error || "promoteToCase 실패"));
      }
      return new Response(jsonKST({ ok: true, promotedCaseId: r.promotedCaseId }),
        { status: 200, headers: { "Content-Type": "application/json" } });
    } catch (err: any) {
      return jsonError("promote_index", err);
    }
  }

  /* reject */
  const reason = String(body?.rejectionReason || "").trim().slice(0, 500) || null;
  try {
    await db.execute(sql`
      UPDATE martyrdom_external_research
         SET status='rejected', reviewed_by_uid=${admin.uid}, reviewed_at=NOW(),
             rejection_reason=${reason}
       WHERE id = ${id}
    `);
    return new Response(jsonKST({ ok: true }),
      { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    return jsonError("update_reject", err);
  }
};
