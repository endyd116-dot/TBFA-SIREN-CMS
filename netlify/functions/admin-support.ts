/**
 * GET   /api/admin/support              — 목록 (신청자/답변자 정보 포함)
 * GET   /api/admin/support?id=N         — 상세
 * PATCH /api/admin/support              — 상태/메모/답변자 업데이트 + 메일
 */
import { eq, desc, count, sql, inArray } from "drizzle-orm";
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

  const guard: any = await requireAdmin(req);
if (!guard.ok) return guard.res;
const { admin } = guard.ctx;

  try {
    /* ===== GET ===== */
    if (req.method === "GET") {
      const url = new URL(req.url);
      const id = url.searchParams.get("id");

      /* ─── 상세 조회 ─── */
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
            createdAt: members.createdAt,
          })
          .from(members)
          .where(eq(members.id, item.memberId))
          .limit(1);

        /* 답변자 정보 */
        let answerer: any = null;
        if (item.answeredBy) {
          const [a] = await db
            .select({ id: members.id, name: members.name, email: members.email })
            .from(members)
            .where(eq(members.id, item.answeredBy))
            .limit(1);
          answerer = a || null;
        }

        return ok({ request: item, requester, answerer });
      }

      /* ─── 목록 조회 ─── */
      const limit = Math.min(100, Number(url.searchParams.get("limit") || 50));
      const status = url.searchParams.get("status");
      const validStatuses = ["submitted", "reviewing", "supplement", "matched", "in_progress", "completed", "rejected"];
      const whereClause: any = (status && validStatuses.includes(status))
        ? eq(supportRequests.status, status as any)
        : undefined;

      /* 1차: supportRequests + 신청자(members) join */
      const list = await db
        .select({
          id: supportRequests.id,
          requestNo: supportRequests.requestNo,
          memberId: supportRequests.memberId,
          category: supportRequests.category,
          title: supportRequests.title,
          status: supportRequests.status,
          assignedExpertName: supportRequests.assignedExpertName,
          adminNote: supportRequests.adminNote,
          createdAt: supportRequests.createdAt,
          completedAt: supportRequests.completedAt,
          priority: supportRequests.priority,
          priorityReason: supportRequests.priorityReason,
          answeredBy: supportRequests.answeredBy,
          answeredAt: supportRequests.answeredAt,
          requesterName: members.name,
          requesterEmail: members.email,
          requesterPhone: members.phone,
        })
        .from(supportRequests)
        .leftJoin(members, eq(supportRequests.memberId, members.id))
        .where(whereClause)
        .orderBy(desc(supportRequests.createdAt))
        .limit(limit);

      /* 2차: 답변자 ID 추출 → JS에서 매핑 */
      const answeredByIds: number[] = [];
      for (const row of list) {
        if (row.answeredBy && !answeredByIds.includes(row.answeredBy)) {
          answeredByIds.push(row.answeredBy);
        }
      }

      const answererMap = new Map<number, string>();
      if (answeredByIds.length > 0) {
        const answerers = await db
          .select({ id: members.id, name: members.name })
          .from(members)
          .where(inArray(members.id, answeredByIds));
        for (const a of answerers) {
          answererMap.set(a.id, a.name);
        }
      }

      const enrichedList = list.map((r: any) => ({
        ...r,
        answererName: r.answeredBy ? (answererMap.get(r.answeredBy) || null) : null,
      }));

      /* 통계 */
      const submittedRows = await db.select({ c: count() }).from(supportRequests).where(eq(supportRequests.status, "submitted"));
      const inProgressRows = await db.select({ c: count() }).from(supportRequests).where(eq(supportRequests.status, "in_progress"));
      const matchedRows = await db.select({ c: count() }).from(supportRequests).where(eq(supportRequests.status, "matched"));
      const completedRows = await db.select({ c: count() }).from(supportRequests).where(eq(supportRequests.status, "completed"));

      const avgRows = await db
        .select({
          avg: sql<number>`COALESCE(AVG(EXTRACT(EPOCH FROM (${supportRequests.completedAt} - ${supportRequests.createdAt})) / 86400), 0)`,
        })
        .from(supportRequests)
        .where(eq(supportRequests.status, "completed"));

      return ok({
        list: enrichedList,
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

      const sendEmailFlag = body.sendEmail === true;
      const isInlineStatusUpdate = body.inlineStatusOnly === true;

      /* ─── 인라인 단계 변경 ─── */
      if (isInlineStatusUpdate) {
        const validStatuses = ["submitted", "reviewing", "supplement", "matched", "in_progress", "completed", "rejected"];
        if (!validStatuses.includes(body.status)) return badRequest("유효하지 않은 상태");

        const updateData: any = {
          status: body.status,
          updatedAt: new Date(),
        };
        if (body.status === "completed") updateData.completedAt = new Date();

        const [updated] = await db
          .update(supportRequests)
          .set(updateData)
          .where(eq(supportRequests.id, reqId))
          .returning();

        if (!updated) return notFound("신청 내역 없음");

        await logAdminAction(req, admin.uid as any, admin.name as any, "support_inline_status", {
          target: updated.requestNo,
          detail: { newStatus: body.status },
        });

        return ok({ request: updated }, "단계가 변경되었습니다");
      }

      /* ─── 일반 PATCH (답변 작성) ─── */
      const v = safeValidate(supportStatusUpdateSchema, body);
      if (!v.ok) return badRequest("입력값을 확인해주세요", (v as any).errors);

      const data = (v as any).data;
      const updateData: any = {
        status: data.status,
        updatedAt: new Date(),
      };
      if (data.assignedMemberId !== undefined) updateData.assignedMemberId = data.assignedMemberId;
      if (data.assignedExpertName !== undefined) {
        updateData.assignedExpertName = data.assignedExpertName;
        updateData.assignedAt = new Date();
      }
      if (data.adminNote !== undefined) updateData.adminNote = data.adminNote;
      if (data.supplementNote !== undefined) updateData.supplementNote = data.supplementNote;
      if (data.reportContent !== undefined) updateData.reportContent = data.reportContent;

      if (data.status === "completed") updateData.completedAt = new Date();

      /* ★ adminNote가 채워지면 답변자/시간 자동 기록 */
      if (data.adminNote && String(data.adminNote).trim().length > 0) {
        updateData.answeredBy = admin.uid;
        updateData.answeredAt = new Date();
      }

      const [updated] = await db
        .update(supportRequests)
        .set(updateData)
        .where(eq(supportRequests.id, reqId))
        .returning();

      if (!updated) return notFound("신청 내역 없음");

      /* ───── 신청자 메일 발송 ───── */
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

      await logAdminAction(req, admin.uid as any, admin.name as any, "support_status_change", {
        target: updated.requestNo,
        detail: { newStatus: data.status, emailSent, emailError, hasNote: !!data.adminNote },
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