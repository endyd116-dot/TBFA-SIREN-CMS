/**
 * GET /api/admin-send-unified
 * 발송 통합 응답: jobs[], templates[], groups[], analytics, logs[]
 * super_admin: 전체 / admin: 자기 발송만
 */
import { desc, eq } from "drizzle-orm";
import { db } from "../../db";
import {
  communicationSendJobs,
  communicationTemplates,
  recipientGroups,
  communicationAutoTriggers,
  communicationSendRecipients,
} from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import { corsPreflight, methodNotAllowed } from "../../lib/response";

export const config = { path: "/api/admin-send-unified" };

function jsonError(step: string, err: any) {
  return new Response(
    JSON.stringify({
      ok: false,
      error: "발송 통합 조회 실패",
      step,
      detail: String(err?.message ?? err).slice(0, 500),
      stack: String(err?.stack ?? "").slice(0, 1000),
    }),
    { status: 500, headers: { "Content-Type": "application/json" } }
  );
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  const isSuperAdmin = auth.ctx.member.role === "super_admin";
  const adminId = auth.ctx.admin.uid;

  let step = "select_jobs";
  let jobRows: any[] = [];
  try {
    jobRows = isSuperAdmin
      ? await db
          .select({
            id: communicationSendJobs.id,
            name: communicationSendJobs.name,
            templateId: communicationSendJobs.templateId,
            recipientGroupId: communicationSendJobs.recipientGroupId,
            channel: communicationSendJobs.channel,
            scheduleType: communicationSendJobs.scheduleType,
            scheduledAt: communicationSendJobs.scheduledAt,
            status: communicationSendJobs.status,
            totalRecipients: communicationSendJobs.totalRecipients,
            successCount: communicationSendJobs.successCount,
            failureCount: communicationSendJobs.failureCount,
            startedAt: communicationSendJobs.startedAt,
            completedAt: communicationSendJobs.completedAt,
            createdBy: communicationSendJobs.createdBy,
            createdAt: communicationSendJobs.createdAt,
          })
          .from(communicationSendJobs)
          .orderBy(desc(communicationSendJobs.createdAt))
          .limit(200)
      : await db
          .select({
            id: communicationSendJobs.id,
            name: communicationSendJobs.name,
            templateId: communicationSendJobs.templateId,
            recipientGroupId: communicationSendJobs.recipientGroupId,
            channel: communicationSendJobs.channel,
            scheduleType: communicationSendJobs.scheduleType,
            scheduledAt: communicationSendJobs.scheduledAt,
            status: communicationSendJobs.status,
            totalRecipients: communicationSendJobs.totalRecipients,
            successCount: communicationSendJobs.successCount,
            failureCount: communicationSendJobs.failureCount,
            startedAt: communicationSendJobs.startedAt,
            completedAt: communicationSendJobs.completedAt,
            createdBy: communicationSendJobs.createdBy,
            createdAt: communicationSendJobs.createdAt,
          })
          .from(communicationSendJobs)
          .where(eq(communicationSendJobs.createdBy, adminId))
          .orderBy(desc(communicationSendJobs.createdAt))
          .limit(200);
  } catch (err: any) {
    return jsonError(step, err);
  }

  step = "select_templates";
  let templateRows: any[] = [];
  try {
    templateRows = await db
      .select({
        id: communicationTemplates.id,
        name: communicationTemplates.name,
        channel: communicationTemplates.channel,
        category: communicationTemplates.category,
        subject: communicationTemplates.subject,
        isActive: communicationTemplates.isActive,
        createdBy: communicationTemplates.createdBy,
        createdAt: communicationTemplates.createdAt,
        updatedAt: communicationTemplates.updatedAt,
      })
      .from(communicationTemplates)
      .orderBy(desc(communicationTemplates.createdAt))
      .limit(200);
  } catch (err: any) {
    console.warn("[admin-send-unified] templates select 실패:", err);
    templateRows = [];
  }

  step = "select_groups";
  let groupRows: any[] = [];
  try {
    groupRows = await db
      .select({
        id: recipientGroups.id,
        name: recipientGroups.name,
        description: recipientGroups.description,
        criteria: recipientGroups.criteria,
        isActive: recipientGroups.isActive,
        createdBy: recipientGroups.createdBy,
        createdAt: recipientGroups.createdAt,
        updatedAt: recipientGroups.updatedAt,
      })
      .from(recipientGroups)
      .orderBy(desc(recipientGroups.createdAt))
      .limit(100);
  } catch (err: any) {
    console.warn("[admin-send-unified] groups select 실패:", err);
    groupRows = [];
  }

  step = "select_logs";
  let logRows: any[] = [];
  try {
    logRows = await db
      .select({
        id: communicationSendRecipients.id,
        jobId: communicationSendRecipients.jobId,
        memberId: communicationSendRecipients.memberId,
        channel: communicationSendRecipients.channel,
        status: communicationSendRecipients.status,
        sentAt: communicationSendRecipients.sentAt,
        error: communicationSendRecipients.error,
        openedAt: communicationSendRecipients.openedAt,
        clickedAt: communicationSendRecipients.clickedAt,
        createdAt: communicationSendRecipients.createdAt,
      })
      .from(communicationSendRecipients)
      .orderBy(desc(communicationSendRecipients.createdAt))
      .limit(300);
  } catch (err: any) {
    console.warn("[admin-send-unified] logs select 실패:", err);
    logRows = [];
  }

  step = "build_analytics";
  let analytics: any = null;
  try {
    const jobIds = new Set(jobRows.map((j) => j.id));
    const relevantLogs = logRows.filter((l) => jobIds.has(l.jobId));

    const totalSent = relevantLogs.length;
    const successSent = relevantLogs.filter((l) => l.status === "sent").length;
    const failedSent = relevantLogs.filter((l) => l.status === "failed").length;
    const openCount = relevantLogs.filter((l) => l.openedAt != null).length;
    const clickCount = relevantLogs.filter((l) => l.clickedAt != null).length;

    analytics = {
      totalJobs: jobRows.length,
      totalSent,
      successSent,
      failedSent,
      openRate: totalSent > 0 ? Math.round((openCount / totalSent) * 10000) / 100 : 0,
      clickRate: totalSent > 0 ? Math.round((clickCount / totalSent) * 10000) / 100 : 0,
    };
  } catch (err: any) {
    console.warn("[admin-send-unified] analytics build 실패:", err);
    analytics = null;
  }

  return new Response(
    JSON.stringify({
      ok: true,
      jobs: jobRows,
      templates: templateRows,
      groups: groupRows,
      analytics,
      logs: logRows,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
};
