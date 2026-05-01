/**
 * GET   /api/admin/support              — 지원 신청 목록 + 통계
 * GET   /api/admin/support?id=N         — 신청 상세
 * PATCH /api/admin/support              — 상태/매칭/메모 변경
 *                                       - body.sendEmail=true 일 때만 신청자에게 답변 알림 메일 발송
 */
import { eq, desc, and, count, sql } from "drizzle-orm";
import { db, supportRequests, members } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import { supportStatusUpdateSchema, safeValidate } from "../../lib/validation";
import {
  ok, badRequest, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logAdminAction } from "../../lib/audit";
import { sendEmail, tplSupportAnsweredUser } from "../../lib/email";

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();

  const guard = await requireAdmin(req);
  if (!guard.ok) return guard.res;
  const { admin } = guard.ctx;

  try {
    /* ===== GET ===== */
    if (req.method === "GET") {
      const url = new URL(req.url);
      const id = url.searchParams.get("id");

      /* 상세 */
      if (id) {
        const reqId = Number(id);
        if (!Number.isFinite(reqId)) return badRequest("유효하지 않은 ID");

        const [item] = await db
          .select()
          .from(supportRequests)
          .where(eq(supportRequests.id, reqId))
          .limit(1);
        if (!item) return notFound("신청 내역 없음");

        /* 신청자 정보 */
        const [requester] = await db
          .select({
            id: members.id,
            name: members.name,
            email: members.email,
            phone: members.phone,
            type: members.type,
          })
          .from(members)
          .where(eq(members.id, item.memberId))
          .limit(1);

        return ok({ request: item, requester });
      }

      /* 목록 */
      const limit = Math.min(100, Number(url.searchParams.get("limit") || 50));
      const status = url.searchParams.get("status");

      const conditions: any[] = [];
      if (status && ["submitted","reviewing","supplement","matched","in_progress","completed","rejected"].includes(status)) {
        conditions.push(eq(supportRequests.status, status as any));
      }
      const where = conditions.length === 0 ? undefined : conditions[0];

      const list = await db
        .select({
          id: supportRequests.id,
          requestNo: supportRequests.requestNo,
          memberId: supportRequests.memberId,
          category: supportRequests.category,
          title: supportRequests.title,
          status: supportRequests.status,
          assignedExpertName: supportRequests.assignedExpertName,
          createdAt: supportRequests.createdAt,
          completedAt: supportRequests.completedAt,
        })
        .from(supportRequests)
        .where(where as any)
        .orderBy(desc(supportRequests.createdAt))
        .limit(limit);

      /* 통계 */
      const submittedRows = await db.select({ c: count() }).from(supportRequests).where(eq(supportRequests.status, "submitted"));
      const inProgressRows = await db.select({ c: count() }).from(supportRequests).where(eq(supportRequests.status, "in_progress"));
      const matchedRows = await db.select({ c: count() }).from(supportRequests).where(eq(supportRequests.status, "matched"));
      const completedRows = await db.select({ c: count() }).from(supportRequests).where(eq(supportRequests.status, "completed"));

      /* 평균 처리일 */
      const avgRows = await db
        .select({
          avg: sql<number>`COALESCE(AVG(EXTRACT(EPOCH FROM (${supportRequests.completedAt} - ${supportRequests.createdAt})) / 86400), 0)`,
        })
        .from(supportRequests)
        .where(eq(supportRequests.status, "completed"));

      return ok({
        list,
        stats: {
          submitted: Number(submittedRows[0]?.c ?? 0),
          inProgress: Number(inProgressRows[0]?.c ?? 0) + Number(matchedRows[0]?.c ?? 0),
          completed: Number(completedRows[0]?.c ?? 0),
          avgDays: Number(avgRows[0]?.avg ?? 0).toFixed(1),
        },
      });
    }

    /* ===== PATCH ===== */
    if (req.method === "PATCH") {
      const body = await parseJson(req);
      if (!body?.id) return badRequest("id가 필요합니다");

      const reqId = Number(body.id);
      if (!Number.isFinite(reqId)) return badRequest("유효하지 않은 ID");

      /* sendEmail 플래그는 schema 검증 대상에서 제외 (안전하게 별도 추출) */
      const sendEmailFlag = body.sendEmail === true;

      const v = safeValidate(supportStatusUpdateSchema, body);
      if (!v.ok) return badRequest("입력값을 확인해주세요", v.errors);

      const updateData: any = {
        status: v.data.status,
        updatedAt: new Date(),
      };
      if (v.data.assignedMemberId !== undefined) updateData.assignedMemberId = v.data.assignedMemberId;
      if (v.data.assignedExpertName !== undefined) {
        updateData.assignedExpertName = v.data.assignedExpertName;
        updateData.assignedAt = new Date();
      }
      if (v.data.adminNote !== undefined) updateData.adminNote = v.data.adminNote;
      if (v.data.supplementNote !== undefined) updateData.supplementNote = v.data.supplementNote;
      if (v.data.reportContent !== undefined) updateData.reportContent = v.data.reportContent;

      /* 완료 처리 시 completedAt 자동 */
      if (v.data.status === "completed") updateData.completedAt = new Date();

      const [updated] = await db
        .update(supportRequests)
        .set(updateData)
        .where(eq(supportRequests.id, reqId))
        .returning();

      if (!updated) return notFound("신청 내역 없음");

      /* ───── 신청자 메일 발송 (sendEmail=true 일 때만) ───── */
      let emailSent = false;
      let emailError: string | null = null;

      if (sendEmailFlag) {
        try {
          const [requester] = await db
            .select({ name: members.name, email: members.email })
            .from(members)
            .where(eq(members.id, updated.memberId))
            .limit(1);

          if (requester?.email) {
            const tpl = tplSupportAnsweredUser({
              applicantName: requester.name,
              requestNo: updated.requestNo,
              title: updated.title,
              newStatus: updated.status,
            });
            const result = await sendEmail({
              to: requester.email,
              subject: tpl.subject,
              html: tpl.html,
            });
            emailSent = !!result.ok;
            if (!result.ok) emailError = "메일 발송 실패";
          } else {
            emailError = "신청자 이메일 정보 없음";
          }
        } catch (mailErr) {
          console.error("[admin-support] 메일 발송 예외:", mailErr);
          emailError = "메일 발송 중 예외 발생";
        }
      }

      await logAdminAction(req, admin.uid, admin.name, "support_status_change", {
        target: updated.requestNo,
        detail: { newStatus: v.data.status, emailSent, emailError },
      });

      const message = emailSent
        ? "상태가 변경되고 신청자에게 알림 메일이 발송되었습니다"
        : sendEmailFlag
          ? `상태는 변경되었으나 메일 발송에 실패했습니다 (${emailError || "원인 불명"})`
          : "상태가 변경되었습니다";

      return ok({ request: updated, emailSent }, message);
    }

    return methodNotAllowed();
  } catch (err) {
    console.error("[admin-support]", err);
    return serverError("지원 관리 중 오류", err);
  }
};

export const config = { path: "/api/admin/support" };