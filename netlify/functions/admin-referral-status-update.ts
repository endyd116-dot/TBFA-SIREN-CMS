/**
 * POST /api/admin-referral-status-update
 * 인계 건 상태 및 메모 갱신
 *
 * Body: { referralId, status, statusMemo? }
 */
import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { createNotification } from "../../lib/notify";

export const config = { path: "/api/admin-referral-status-update" };

const VALID_STATUSES = ["pending", "sent", "reviewing", "in_progress", "completed", "rejected"];
const STATUS_LABEL: Record<string, string> = {
  pending: "대기", sent: "전달됨", reviewing: "검토 중", in_progress: "처리 중", completed: "처리 완료", rejected: "반려",
};
const SOURCE_TABLE: Record<string, string> = {
  incident: "incident_reports", harassment: "harassment_reports", legal: "legal_consultations",
};

function jsonError(step: string, err: any) {
  return new Response(
    JSON.stringify({
      ok: false,
      error: "인계 상태 갱신 실패",
      step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }),
    { status: 500, headers: { "Content-Type": "application/json" } }
  );
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "POST only" }), {
      status: 405, headers: { "Content-Type": "application/json" },
    });
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;
  const adminId: number = auth.ctx.admin.uid;

  let body: any;
  try {
    body = await req.json();
  } catch (err) {
    return jsonError("parse_body", err);
  }

  const { referralId, status, statusMemo } = body;

  if (!referralId || isNaN(Number(referralId))) {
    return new Response(
      JSON.stringify({ ok: false, error: "referralId는 필수입니다" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }
  if (!status || !VALID_STATUSES.includes(status)) {
    return new Response(
      JSON.stringify({ ok: false, error: `status는 ${VALID_STATUSES.join("|")} 중 하나여야 합니다` }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    /* Q2-035: RETURNING id로 실제 갱신 행 확인 — 0행이면 존재하지 않는 인계 건이므로 404.
       (기존에는 0행 갱신도 ok 반환해 잘못된 referralId가 성공으로 보였음) */
    const result = await db.execute(sql`
      UPDATE referral_logs SET
        status            = ${status},
        status_memo       = ${statusMemo ?? null},
        status_updated_by = ${adminId},
        status_updated_at = NOW(),
        updated_at        = NOW()
      WHERE id = ${Number(referralId)}
      RETURNING id, source_type, source_id, source_no, agency_name
    `);
    const rows = Array.isArray(result) ? result : ((result as any)?.rows ?? []);
    if (rows.length === 0) {
      return new Response(
        JSON.stringify({ ok: false, error: "인계 건을 찾을 수 없습니다" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    /* AD-047/117: 인계 상태 변경을 원본 신고 담당 운영자에게 통지 — 원본 신고 화면과 단절 해소(best-effort) */
    try {
      const ref: any = rows[0];
      const table = SOURCE_TABLE[String(ref.source_type)];
      if (table) {
        const r: any = await db.execute(sql`SELECT assigned_to FROM ${sql.raw(table)} WHERE id = ${Number(ref.source_id)} LIMIT 1`);
        const srow = (Array.isArray(r) ? r : (r?.rows ?? []))[0];
        const assignedTo = srow?.assigned_to ?? null;
        if (assignedTo) {
          await createNotification({
            recipientId: Number(assignedTo),
            recipientType: "admin",
            category: "support",
            severity: "info",
            title: `🏢 외부기관 인계 상태: ${STATUS_LABEL[status] || status}`,
            message: `[${ref.source_no}] ${ref.agency_name} 인계 건이 '${STATUS_LABEL[status] || status}'(으)로 변경되었습니다.${statusMemo ? ` — ${String(statusMemo).slice(0, 100)}` : ""}`,
            link: `/admin.html#${ref.source_type}-reports`,
            refTable: "referral_logs",
            refId: Number(referralId),
          });
        }
      }
    } catch (e) {
      console.warn("[admin-referral-status-update] 담당자 통지 실패:", (e as any)?.message);
    }

    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return jsonError("update_status", err);
  }
};
