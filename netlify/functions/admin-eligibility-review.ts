/**
 * 6순위 #6 — 어드민: 자격 변경 신청 승인/반려
 *
 * POST /api/admin-eligibility-review
 *   body:
 *     - id        (number, 필수) — eligibility_change_requests.id
 *     - action    ('approve' | 'reject', 필수)
 *     - adminNote (string, 선택)
 *
 *  승인:
 *    1) UPDATE eligibility_change_requests SET status='approved', reviewed_by/reviewed_at/admin_note 갱신
 *    2) UPDATE members SET eligibility_type = requested_type
 *    3) notifications INSERT (recipient = 신청자)
 *
 *  반려:
 *    1) UPDATE eligibility_change_requests SET status='rejected', reviewed_by/reviewed_at/admin_note
 *    2) notifications INSERT (반려 사유 포함)
 *
 *  pending 상태에서만 처리 가능.
 */
import type { Context } from "@netlify/functions";
import { db, members, notifications } from "../../db";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, badRequest, notFound, methodNotAllowed,
  serverError, parseJson,
} from "../../lib/response";
import { logAudit } from "../../lib/audit";

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "POST") return methodNotAllowed();

  const guard = await requireAdmin(req);
  if (!guard.ok) return (guard as { ok: false; res: Response }).res;
  const adminMember = guard.ctx.member as any;
  const adminId = adminMember.id as number;

  try {
    const body: any = await parseJson(req);
    if (!body) return badRequest("body 필수");

    const id = Number(body.id);
    if (!id) return badRequest("id 필수");

    const action = String(body.action || "").toLowerCase();
    if (action !== "approve" && action !== "reject") {
      return badRequest("action 은 approve 또는 reject");
    }

    const adminNote = body.adminNote ? String(body.adminNote).slice(0, 1000).trim() : null;
    if (action === "reject" && (!adminNote || adminNote.length < 5)) {
      return badRequest("반려 시 사유를 5자 이상 입력해주세요");
    }

    /* 1. 대상 신청 조회 + pending 확인 */
    const reqRows: any = await db.execute(sql`
      SELECT id,
             member_id      AS "memberId",
             current_type   AS "currentType",
             requested_type AS "requestedType",
             status
        FROM eligibility_change_requests
       WHERE id = ${id}
       LIMIT 1
    `);
    const reqRow = (Array.isArray(reqRows) ? reqRows : reqRows.rows || [])[0];
    if (!reqRow) return notFound("신청을 찾을 수 없습니다");
    if (reqRow.status !== "pending") {
      return badRequest(`이미 처리된 신청입니다 (현재 상태: ${reqRow.status})`);
    }

    /* 2. 신청자 회원 확인 */
    const [target]: any = await db
      .select({ id: members.id, name: members.name, status: members.status })
      .from(members)
      .where(eq(members.id, reqRow.memberId))
      .limit(1);
    if (!target) return notFound("신청 회원을 찾을 수 없습니다");

    const newStatus = action === "approve" ? "approved" : "rejected";

    /* 3. 신청 상태 업데이트 */
    await db.execute(sql`
      UPDATE eligibility_change_requests
         SET status      = ${newStatus},
             admin_note  = ${adminNote},
             reviewed_by = ${adminId},
             reviewed_at = now(),
             updated_at  = now()
       WHERE id = ${id}
    `);

    /* 4. 승인 시 회원 자격 갱신 */
    if (action === "approve") {
      await db.execute(sql`
        UPDATE members
           SET eligibility_type = ${reqRow.requestedType},
               updated_at = now()
         WHERE id = ${reqRow.memberId}
      `);
    }

    /* 5. 알림 (실패해도 메인 흐름 영향 X) */
    try {
      const title = action === "approve"
        ? `자격 변경이 승인되었습니다: ${reqRow.requestedType}`
        : `자격 변경이 반려되었습니다`;
      const messageParts: string[] = [];
      if (action === "approve") {
        messageParts.push(`현재 자격: ${reqRow.requestedType}`);
        if (adminNote) messageParts.push(`메모: ${adminNote}`);
      } else {
        messageParts.push(`반려 사유: ${adminNote || ""}`);
      }
      await db.insert(notifications).values({
        recipientId: reqRow.memberId,
        recipientType: "user",
        category: "eligibility",
        severity: action === "approve" ? "success" : "warning",
        title: title.slice(0, 200),
        message: messageParts.join(" / ").slice(0, 500),
        link: "/mypage.html#eligibility",
        refTable: "eligibility_change_requests",
        refId: id,
      } as any);
    } catch (notifyErr: any) {
      console.warn("[admin-eligibility-review] 알림 적재 실패:", notifyErr?.message);
    }

    /* 6. 감사 로그 */
    await logAudit({
      userId: adminId, userType: "admin", userName: adminMember.name,
      action: action === "approve" ? "eligibility.approve" : "eligibility.reject",
      target: `eligibility:${id}`,
      detail: {
        memberId: reqRow.memberId,
        memberName: target.name,
        currentType: reqRow.currentType,
        requestedType: reqRow.requestedType,
        adminNote,
      },
      req,
    });

    return ok(
      { id, status: newStatus, memberId: reqRow.memberId, requestedType: reqRow.requestedType },
      action === "approve" ? "승인 처리되었습니다" : "반려 처리되었습니다"
    );
  } catch (err: any) {
    console.error("[admin-eligibility-review]", err);
    return serverError("자격 변경 심사 중 오류", err);
  }
};

export const config = { path: "/api/admin-eligibility-review" };
