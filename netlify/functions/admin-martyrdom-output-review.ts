/**
 * admin-martyrdom-output-review — AI 산출물 검토 상태 변경 (⑤ 전문가 검토 루프)
 *
 * PATCH { outputId, status: 'reviewed'|'discarded', reviewNote? }
 *   reviewed/discarded + reviewedBy(현재 운영자)·reviewedAt·reviewNote 저장.
 *
 * 응답: { ok, outputId, status }
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { logAdminAction } from "../../lib/audit";

export const config = { path: "/api/admin-martyrdom-output-review" };

function jsonError(step: string, err: any) {
  return new Response(jsonKST({
    ok: false, error: "처리 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}
function badRequest(msg: string) {
  return new Response(jsonKST({ ok: false, error: msg }), {
    status: 400, headers: { "Content-Type": "application/json" },
  });
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "PATCH") {
    return new Response(jsonKST({ ok: false, error: "PATCH만 허용" }), { status: 405 });
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  const { admin, member } = auth.ctx;

  let body: any;
  try { body = await req.json(); } catch { return badRequest("요청 본문 파싱 실패"); }

  const outputId = Number(body.outputId);
  const status = String(body.status || "");
  if (!outputId) return badRequest("outputId 필수");
  if (!["reviewed", "discarded"].includes(status)) return badRequest("status는 reviewed|discarded");

  const reviewNote = body.reviewNote ? String(body.reviewNote).slice(0, 2000) : null;

  try {
    const exists: any = await db.execute(sql.raw(`SELECT id FROM martyrdom_ai_outputs WHERE id = ${outputId} LIMIT 1`));
    if (!(exists?.rows ?? exists ?? []).length) {
      return new Response(jsonKST({ ok: false, error: "산출물을 찾을 수 없습니다" }), {
        status: 404, headers: { "Content-Type": "application/json" },
      });
    }

    const noteSql = reviewNote ? `'${reviewNote.replace(/'/g, "''")}'` : "NULL";
    await db.execute(sql.raw(`
      UPDATE martyrdom_ai_outputs
      SET status = '${status}',
          reviewed_by = ${admin.uid},
          reviewed_at = NOW(),
          review_note = ${noteSql}
      WHERE id = ${outputId}
    `));

    void logAdminAction(req, admin.uid, member.name || String(admin.uid), "martyrdom_output_review", {
      target: String(outputId), detail: { status },
    });

    return new Response(jsonKST({ ok: true, outputId, status }), {
      headers: { "Content-Type": "application/json" },
    });

  } catch (err: any) {
    return jsonError("review", err);
  }
};
