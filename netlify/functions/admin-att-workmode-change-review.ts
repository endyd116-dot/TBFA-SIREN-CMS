/**
 * R36-Att-Optional A-1: 슈퍼어드민 — 직원 근무형태 변경 신청 결재
 *
 * GET  /api/admin-att-workmode-change-review?status=PENDING|APPROVED|REJECTED
 * POST /api/admin-att-workmode-change-review
 *   body: { requestId, action: 'APPROVED'|'REJECTED', note? }
 *
 * APPROVED 시 att_schedule_overrides UPSERT (해당 날짜 근무형태 재정의)
 */
import { db } from "../../db/index";
import { attWorkmodeChangeRequests, attScheduleOverrides, members } from "../../db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { canAccess } from "../../lib/role-permission-check";
import { sendWorkspaceNotification } from "../../lib/workspace-logger";

export const config = { path: "/api/admin-att-workmode-change-review" };

function jsonOk(data: unknown) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "근무형태 변경 결재 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  // R45 §4-1: 근무형태 변경 결재는 운영자 허용(att_manage)
  if (!(await canAccess((auth as any).ctx.member.role ?? "", "att_manage"))) {
    return new Response(JSON.stringify({ ok: false, error: "근태 관리 권한이 없습니다" }), {
      status: 403, headers: { "Content-Type": "application/json" },
    });
  }

  if (req.method === "GET") {
    try {
      const url = new URL(req.url);
      const status = url.searchParams.get("status") ?? "PENDING";
      const rows = await db
        .select()
        .from(attWorkmodeChangeRequests)
        .where(eq(attWorkmodeChangeRequests.status, status))
        .orderBy(sql`created_at DESC`)
        .limit(100);

      const memberIds = Array.from(
        new Set(rows.map(r => Number(r.memberUid)).filter(n => Number.isFinite(n) && n > 0))
      );
      const memberMap = new Map<number, { name: string; email: string }>();
      if (memberIds.length > 0) {
        try {
          const mRows = await db
            .select({ id: members.id, name: members.name, email: members.email })
            .from(members)
            .where(inArray(members.id, memberIds));
          for (const m of mRows) memberMap.set(m.id, { name: m.name, email: m.email });
        } catch (e) {
          console.warn("[admin-att-workmode-change-review] member 조인 실패:", e);
        }
      }

      const list = rows.map(r => {
        const info = memberMap.get(Number(r.memberUid));
        return {
          id: r.id,
          memberUid: r.memberUid,
          memberName: info?.name ?? "—",
          memberEmail: info?.email ?? "",
          targetMode: r.targetMode,
          targetDate: r.targetDate,
          reason: r.reason,
          status: r.status,
          reviewedBy: r.reviewedBy,
          reviewNote: r.reviewNote,
          submittedAt: r.createdAt,
        };
      });
      return jsonOk({ requests: list });
    } catch (err) {
      return jsonError("select_requests", err);
    }
  }

  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  let body: any;
  try { body = await req.json(); } catch { body = {}; }

  const { requestId, action, note } = body;
  if (!requestId || !action) {
    return jsonError("validate", new Error("requestId, action 필수"), 400);
  }
  if (!["APPROVED", "REJECTED"].includes(action)) {
    return jsonError("validate_action", new Error("action은 APPROVED|REJECTED"), 400);
  }

  try {
    const [reqRow] = await db
      .select()
      .from(attWorkmodeChangeRequests)
      .where(eq(attWorkmodeChangeRequests.id, requestId))
      .limit(1);

    if (!reqRow) return jsonError("not_found", new Error("신청 내역 없음"), 404);
    if (reqRow.status !== "PENDING") {
      return jsonError("already_reviewed", new Error("이미 처리된 신청"), 409);
    }

    const [updated] = await db
      .update(attWorkmodeChangeRequests)
      .set({
        status: action,
        reviewedBy: String((auth as any).ctx.member.id),
        reviewNote: note ?? null,
        updatedAt: new Date(),
      } as any)
      .where(eq(attWorkmodeChangeRequests.id, requestId))
      .returning();

    // APPROVED: att_schedule_overrides UPSERT
    if (action === "APPROVED") {
      try {
        await db.execute(sql`
          INSERT INTO att_schedule_overrides
            (member_uid, date, work_mode, reason, created_by)
          VALUES
            (${reqRow.memberUid}, ${String(reqRow.targetDate)}::date, ${reqRow.targetMode},
             ${reqRow.reason ?? null}, ${String((auth as any).ctx.member.id)})
          ON CONFLICT (member_uid, date)
          DO UPDATE SET
            work_mode = EXCLUDED.work_mode,
            reason    = EXCLUDED.reason,
            created_by = EXCLUDED.created_by
        `);
      } catch (err) {
        console.warn("[admin-att-workmode-change-review] override UPSERT 실패:", err);
      }
    }

    // 신청자에게 결과 알림
    try {
      const recipientId = Number(reqRow.memberUid);
      if (Number.isFinite(recipientId) && recipientId > 0) {
        await sendWorkspaceNotification({
          memberId: recipientId,
          sourceType: "event" as any,
          sourceId: reqRow.id,
          notifType: action === "APPROVED" ? "approved" : "rejected",
          channel: "bell",
          title: action === "APPROVED" ? "근무형태 변경 승인" : "근무형태 변경 반려",
          body: `${reqRow.targetDate} ${reqRow.targetMode} 변경이 ${action === "APPROVED" ? "승인" : "반려"}되었습니다.${note ? ` · ${String(note).slice(0, 100)}` : ""}`,
          actionUrl: "/workspace-attendance.html",
          category: "system",
        });
      }
    } catch (err) {
      console.warn("[admin-att-workmode-change-review] 결과 알림 실패:", err);
    }

    return jsonOk(updated);
  } catch (err) {
    return jsonError("review_request", err);
  }
}
