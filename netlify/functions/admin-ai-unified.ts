/**
 * GET /api/admin-ai-unified
 * AI 에이전트 통합 응답: recommendations[], activityReports[], autoTriggers[]
 * super_admin: 전체 / admin: 자기 활동 데이터만
 * DB에 ai_recommendations / ai_activity_reports 테이블 없음 →
 *   communicationAutoTriggers + communicationAutoTriggerRuns로 대체
 */
import { desc, eq } from "drizzle-orm";
import { db } from "../../db";
import {
  communicationAutoTriggers,
  communicationAutoTriggerRuns,
} from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import { corsPreflight, methodNotAllowed } from "../../lib/response";

export const config = { path: "/api/admin-ai-unified" };

function jsonError(step: string, err: any) {
  return new Response(
    JSON.stringify({
      ok: false,
      error: "AI 통합 조회 실패",
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

  let step = "select_auto_triggers";
  let autoTriggerRows: any[] = [];
  try {
    autoTriggerRows = isSuperAdmin
      ? await db
          .select({
            id: communicationAutoTriggers.id,
            name: communicationAutoTriggers.name,
            description: communicationAutoTriggers.description,
            triggerType: communicationAutoTriggers.triggerType,
            templateId: communicationAutoTriggers.templateId,
            recipientGroupId: communicationAutoTriggers.recipientGroupId,
            channel: communicationAutoTriggers.channel,
            delayHours: communicationAutoTriggers.delayHours,
            isActive: communicationAutoTriggers.isActive,
            cooldownDays: communicationAutoTriggers.cooldownDays,
            conditions: communicationAutoTriggers.conditions,
            createdBy: communicationAutoTriggers.createdBy,
            createdAt: communicationAutoTriggers.createdAt,
            updatedAt: communicationAutoTriggers.updatedAt,
          })
          .from(communicationAutoTriggers)
          .orderBy(desc(communicationAutoTriggers.createdAt))
          .limit(100)
      : await db
          .select({
            id: communicationAutoTriggers.id,
            name: communicationAutoTriggers.name,
            description: communicationAutoTriggers.description,
            triggerType: communicationAutoTriggers.triggerType,
            templateId: communicationAutoTriggers.templateId,
            recipientGroupId: communicationAutoTriggers.recipientGroupId,
            channel: communicationAutoTriggers.channel,
            delayHours: communicationAutoTriggers.delayHours,
            isActive: communicationAutoTriggers.isActive,
            cooldownDays: communicationAutoTriggers.cooldownDays,
            conditions: communicationAutoTriggers.conditions,
            createdBy: communicationAutoTriggers.createdBy,
            createdAt: communicationAutoTriggers.createdAt,
            updatedAt: communicationAutoTriggers.updatedAt,
          })
          .from(communicationAutoTriggers)
          .where(eq(communicationAutoTriggers.createdBy, adminId))
          .orderBy(desc(communicationAutoTriggers.createdAt))
          .limit(100);
  } catch (err: any) {
    return jsonError(step, err);
  }

  step = "select_trigger_runs";
  let triggerRunRows: any[] = [];
  try {
    triggerRunRows = await db
      .select({
        id: communicationAutoTriggerRuns.id,
        triggerId: communicationAutoTriggerRuns.triggerId,
        jobId: communicationAutoTriggerRuns.jobId,
        triggeredAt: communicationAutoTriggerRuns.triggeredAt,
        memberCount: communicationAutoTriggerRuns.memberCount,
        status: communicationAutoTriggerRuns.status,
        error: communicationAutoTriggerRuns.error,
        meta: communicationAutoTriggerRuns.meta,
      })
      .from(communicationAutoTriggerRuns)
      .orderBy(desc(communicationAutoTriggerRuns.triggeredAt))
      .limit(200);
  } catch (err: any) {
    console.warn("[admin-ai-unified] triggerRuns select 실패:", err);
    triggerRunRows = [];
  }

  step = "build_recommendations";
  // ai_recommendations 테이블 미존재 → 트리거 실행 이력 기반 인사이트 생성
  let recommendations: any[] = [];
  try {
    const triggerIds = new Set(autoTriggerRows.map((t) => t.id));
    const runMap = new Map<number, { total: number; ok: number; lastRun: string | null }>();

    for (const run of triggerRunRows) {
      const tid = Number(run.triggerId);
      if (!triggerIds.has(tid)) continue;
      const entry = runMap.get(tid) ?? { total: 0, ok: 0, lastRun: null };
      entry.total += 1;
      if (run.status === "ok") entry.ok += 1;
      if (!entry.lastRun || run.triggeredAt > entry.lastRun) {
        entry.lastRun = run.triggeredAt;
      }
      runMap.set(tid, entry);
    }

    recommendations = autoTriggerRows
      .filter((t) => {
        const r = runMap.get(t.id);
        if (!r) return true; // 한 번도 실행 안 된 활성 트리거 추천
        return r.total > 0 && r.ok / r.total < 0.8; // 성공률 80% 미만
      })
      .slice(0, 20)
      .map((t) => {
        const r = runMap.get(t.id);
        return {
          triggerId: t.id,
          triggerName: t.name,
          triggerType: t.triggerType,
          isActive: t.isActive,
          successRate: r ? Math.round((r.ok / r.total) * 10000) / 100 : null,
          totalRuns: r?.total ?? 0,
          lastRun: r?.lastRun ?? null,
          suggestion: r
            ? "성공률이 낮아 템플릿 또는 대상 그룹 점검이 필요합니다"
            : "아직 실행 이력이 없습니다. 활성화 여부를 확인하세요",
        };
      });
  } catch (err: any) {
    console.warn("[admin-ai-unified] recommendations build 실패:", err);
    recommendations = [];
  }

  step = "build_activity_reports";
  // ai_activity_reports 테이블 미존재 → 트리거 실행 이력 집계로 대체
  let activityReports: any[] = [];
  try {
    const byDate: Record<string, { total: number; ok: number; skipped: number; error: number }> = {};
    for (const run of triggerRunRows) {
      const day = String(run.triggeredAt ?? "").slice(0, 10);
      if (!day) continue;
      if (!byDate[day]) byDate[day] = { total: 0, ok: 0, skipped: 0, error: 0 };
      byDate[day].total += 1;
      if (run.status === "ok") byDate[day].ok += 1;
      else if (run.status === "skipped") byDate[day].skipped += 1;
      else if (run.status === "error") byDate[day].error += 1;
    }
    activityReports = Object.entries(byDate)
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, 30)
      .map(([date, counts]) => ({ date, ...counts }));
  } catch (err: any) {
    console.warn("[admin-ai-unified] activityReports build 실패:", err);
    activityReports = [];
  }

  return new Response(
    JSON.stringify({
      ok: true,
      recommendations,
      activityReports,
      autoTriggers: autoTriggerRows,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
};
