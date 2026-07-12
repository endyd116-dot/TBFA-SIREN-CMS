/**
 * POST /api/admin-service-assignee
 *
 * 서비스 담당자 변경 + 연결 카드 동기화.
 *
 * body: { serviceKind: "incident"|"harassment"|"legal"|"support", serviceId, newAssigneeUid, reason? }
 *
 * 1) 서비스 행 단건 조회 (현재 담당자 확인)
 * 2) 서비스 assigned_to(=support는 assigned_admin_id) 갱신
 * 3) 연결된 workspace_task_id 가 있으면 카드 담당자도 인계 형식으로 동기
 * 4) 알림·활동 로그
 * 5) 무한 루프 방지 — workspace-sync 내부 origin 잠금
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { members } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import { syncAssigneeFromService } from "../../lib/workspace-sync";

export const config = { path: "/api/admin-service-assignee" };

const KIND_TABLE: Record<string, { table: string; col: string }> = {
  incident:   { table: "incident_reports",     col: "assigned_to" },
  harassment: { table: "harassment_reports",   col: "assigned_to" },
  legal:      { table: "legal_consultations",  col: "assigned_to" },
  support:    { table: "support_requests",     col: "assigned_admin_id" },
};

function jsonError(status: number, error: string, step?: string, err?: any) {
  return new Response(jsonKST({
    ok: false, error, step,
    detail: err ? String(err?.message || err).slice(0, 500) : undefined,
    stack:  err?.stack ? String(err.stack).slice(0, 1000) : undefined,
  }), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

function jsonOk(data: any, message?: string) {
  return new Response(jsonKST({ ok: true, message: message ?? null, data }),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "POST") return jsonError(405, "POST만 허용됩니다", "method");

  let step = "auth";
  try {
    const guard = await requireAdmin(req);
    if (!guard.ok) return (guard as { ok: false; res: Response }).res;
    const meId = guard.ctx.member.id as number;

    step = "parse";
    let body: any;
    try { body = await req.json(); } catch { return jsonError(400, "JSON 본문 파싱 실패", step); }

    step = "validate";
    const serviceKind = String(body?.serviceKind || "").trim();
    const serviceId   = Number(body?.serviceId);
    const newAssigneeUid = Number(body?.newAssigneeUid);
    const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 500) : "";

    if (!KIND_TABLE[serviceKind]) return jsonError(400, "serviceKind 값 오류 (incident/harassment/legal/support)", step);
    if (!Number.isFinite(serviceId) || serviceId <= 0) return jsonError(400, "serviceId 필수", step);
    if (!Number.isFinite(newAssigneeUid) || newAssigneeUid <= 0) return jsonError(400, "newAssigneeUid 필수", step);

    step = "select_recipient";
    const rec: any = await db.execute(sql`SELECT id, name, type, status FROM members WHERE id = ${newAssigneeUid} LIMIT 1`);
    const recipient = Array.isArray(rec) ? rec[0] : (rec as any).rows?.[0];
    if (!recipient) return jsonError(404, "받는 사람을 찾을 수 없습니다", step);
    if (recipient.type !== "admin" || recipient.status !== "active") {
      return jsonError(400, "활성 운영자에게만 인계할 수 있습니다", step);
    }

    step = "select_service";
    const tableMeta = KIND_TABLE[serviceKind];
    const cur: any = await db.execute(sql.raw(
      `SELECT id, ${tableMeta.col} AS current_assignee, workspace_task_id, title FROM ${tableMeta.table} WHERE id = ${serviceId} LIMIT 1`
    ));
    const svc = Array.isArray(cur) ? cur[0] : (cur as any).rows?.[0];
    if (!svc) return jsonError(404, "서비스 행을 찾을 수 없습니다", step);

    step = "sync";
    await syncAssigneeFromService({
      serviceKind: serviceKind as any,
      serviceId,
      newAssigneeUid,
      reason: reason || null,
      changedBy: meId,
    });

    step = "respond";
    return jsonOk({
      serviceKind,
      serviceId,
      previousAssignee: svc.current_assignee ?? null,
      newAssigneeUid,
      newAssigneeName: recipient.name,
      taskId: svc.workspace_task_id ?? null,
      broadcast: svc.workspace_task_id ? { event: "task:updated", taskId: Number(svc.workspace_task_id) } : null,
    }, `${recipient.name}님께 인계됐어요`);
  } catch (err: any) {
    console.error("[admin-service-assignee] error:", err);
    return jsonError(500, "담당자 변경 중 오류", step, err);
  }
};
