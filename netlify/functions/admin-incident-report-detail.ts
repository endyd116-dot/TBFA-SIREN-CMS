// netlify/functions/admin-incident-report-detail.ts
// ★ M-10: 사건 제보 상세 조회 + 답변 등록

import type { Context } from "@netlify/functions";
import { eq, and, inArray } from "drizzle-orm";
import { db } from "../../db";
import { incidentReports, incidents, members, blobUploads } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import { sendEmail, tplIncidentResponseUser } from "../../lib/email";
import { createNotification } from "../../lib/notify";
import { logAdminAction } from "../../lib/audit";
import {
  ok, badRequest, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";

export const config = { path: "/api/admin/incident-report-detail" };

const VALID_STATUSES = ["submitted", "ai_analyzed", "reviewing", "responded", "closed", "rejected"];

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();

  const guard: any = await requireAdmin(req);
  if (!guard.ok) return guard.res;
  const { admin } = guard.ctx;

  try {
    /* ===== GET: 상세 조회 ===== */
    if (req.method === "GET") {
      const url = new URL(req.url);
      const id = Number(url.searchParams.get("id"));
      if (!Number.isFinite(id)) return badRequest("id 필요");

      const [row] = await db.select({
        report: incidentReports,
        incidentTitle: incidents.title,
        incidentSlug: incidents.slug,
        memberName: members.name,
        memberEmail: members.email,
        memberPhone: members.phone,
      })
        .from(incidentReports)
        .leftJoin(incidents, eq(incidentReports.incidentId, incidents.id))
        .leftJoin(members, eq(incidentReports.memberId, members.id))
        .where(eq(incidentReports.id, id))
        .limit(1);

      if (!row) return notFound("제보를 찾을 수 없습니다");

      /* 첨부파일 조회 */
      const r: any = row.report;
      let attachments: any[] = [];
      if (r.attachmentIds) {
        try {
          const ids = JSON.parse(r.attachmentIds);
          if (Array.isArray(ids) && ids.length) {
            const files = await db.select().from(blobUploads).where(inArray(blobUploads.id, ids));
            attachments = files.map((f: any) => ({
              id: f.id, originalName: f.originalName, mimeType: f.mimeType,
              sizeBytes: f.sizeBytes, url: `/api/blob-image?id=${f.id}`,
            }));
          }
        } catch (_) {}
      }

      /* 답변자 정보 */
      let responder = null;
      if (r.respondedBy) {
        const [resp] = await db.select({ id: members.id, name: members.name })
          .from(members).where(eq(members.id, r.respondedBy)).limit(1);
        responder = resp || null;
      }

      return ok({
        report: {
          ...r,
          incidentTitle: row.incidentTitle,
          incidentSlug: row.incidentSlug,
          memberName: row.memberName,
          memberEmail: row.memberEmail,
          memberPhone: row.memberPhone,
          attachments,
          responder,
        },
      });
    }

    /* ===== PATCH: 답변 등록 / 상태 변경 ===== */
    if (req.method === "PATCH") {
      const body: any = await parseJson(req);
      if (!body) return badRequest("요청 본문이 비어있습니다");

      const id = Number(body.id);
      if (!Number.isFinite(id)) return badRequest("id 유효하지 않음");

      const status = body.status;
      const adminResponse = body.adminResponse !== undefined
        ? String(body.adminResponse).trim()
        : undefined;
      const sendMailFlag = body.sendEmail === true;
      const sendNotifyFlag = body.sendNotify !== false; /* 기본 true */

      if (status && !VALID_STATUSES.includes(status)) return badRequest("유효하지 않은 상태");

      /* 기존 행 조회 */
      const [row] = await db.select().from(incidentReports).where(eq(incidentReports.id, id)).limit(1);
      if (!row) return notFound("제보를 찾을 수 없습니다");

      const updateData: any = { updatedAt: new Date() };
      if (status) updateData.status = status;
      if (adminResponse !== undefined) {
        updateData.adminResponse = adminResponse || null;
        if (adminResponse) {
          updateData.respondedBy = (admin as any).uid;
          updateData.respondedAt = new Date();
        }
      }

      await db.update(incidentReports).set(updateData).where(eq(incidentReports.id, id));

      /* 신청자 정보 (메일/알림용) */
      const [member] = await db.select({ id: members.id, name: members.name, email: members.email })
        .from(members).where(eq(members.id, (row as any).memberId)).limit(1);

      /* 메일 발송 (A안: 메일 + 벨 동시) */
      let emailSent = false;
      if (sendMailFlag && adminResponse && member?.email) {
        try {
          const tpl = tplIncidentResponseUser({
            applicantName: member.name,
            reportNo: (row as any).reportNo,
            title: (row as any).title,
            newStatus: status || (row as any).status,
          });
          const result = await sendEmail({ to: member.email, subject: tpl.subject, html: tpl.html });
          emailSent = !!result.ok;
        } catch (e) {
          console.error("[admin-incident-report-detail] 메일 발송 실패:", e);
        }
      }

      /* 사용자 in-app 벨 알림 */
      if (sendNotifyFlag && adminResponse && member) {
        try {
          await createNotification({
            recipientId: member.id,
            recipientType: "user",
            category: "support",
            severity: "info",
            title: "🔍 사건 제보에 답변이 등록되었습니다",
            message: (row as any).title,
            link: `/mypage.html#support`,
            refTable: "incident_reports",
            refId: id,
          });
        } catch (e) {
          console.warn("[admin-incident-report-detail] 알림 실패:", e);
        }
      }

      /* 감사 로그 */
      try {
        await logAdminAction(req, (admin as any).uid, (admin as any).name, "incident_report_response", {
          target: (row as any).reportNo,
          detail: { status: updateData.status, hasResponse: !!adminResponse, emailSent },
        });
      } catch (_) {}

      return ok({
        id,
        reportNo: (row as any).reportNo,
        emailSent,
      }, sendMailFlag ? "답변이 등록되고 이메일이 발송되었습니다" : "답변이 등록되었습니다");
    }

    return methodNotAllowed();
  } catch (e: any) {
    console.error("[admin-incident-report-detail]", e);
    return serverError("처리 실패", e);
  }
};