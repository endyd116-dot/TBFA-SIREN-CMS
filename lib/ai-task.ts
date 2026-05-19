/**
 * Phase 3 Step 7-C.2 — 워크스페이스 작업 AI 인사이트 라이브러리
 *
 * 3종 함수:
 *   - generateTaskSummary(taskId)        : 3줄 요약 → ai_summary 저장
 *   - calculateTaskRisk(taskId)          : 0~100 리스크 점수 → ai_risk_score 저장
 *   - generateCompletionReport(taskId)   : 완료 보고서 초안 → workspace_task_reports INSERT
 *
 * 모든 함수는 실패해도 throw 안 함 (fire-and-forget 안전).
 * 호출처: admin-workspace-tasks(자동) / cron-task-risk(매일) / admin-task-ai-regenerate(수동)
 */
import { db } from "../db";
import {
  workspaceTasks,
  workspaceTaskComments,
  workspaceActivityLog,
  workspaceTaskReports,
} from "../db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { callGeminiJSON } from "./ai-gemini";

const PRIORITY_WEIGHT: Record<string, number> = {
  urgent: 30,
  high: 20,
  normal: 10,
  low: 0,
};

/* ═══════════════════════════════════════════════════════
   AI-1 요약 — 3줄, 100자 이내씩
═══════════════════════════════════════════════════════ */
export async function generateTaskSummary(taskId: number): Promise<{ ok: boolean; summary?: string; error?: string }> {
  try {
    const [task]: any = await db.select().from(workspaceTasks).where(eq(workspaceTasks.id, taskId)).limit(1);
    if (!task) return { ok: false, error: "task not found" };

    const desc = (task.description || "").slice(0, 3000);
    if (!desc.trim() || desc.length < 30) {
      return { ok: false, error: "description too short" };
    }

    const prompt = `당신은 NPO 워크스페이스의 AI 비서입니다. 아래 작업을 3줄로 요약하세요.

# 작업 정보
- 제목: ${task.title}
- 우선순위: ${task.priority}
- 마감일: ${task.dueDate}
- 설명: ${desc}

# 응답 형식 (JSON only, 설명 금지)
{
  "summary": "3줄 요약. 각 줄은 100자 이내. 줄바꿈은 \\n으로."
}

규칙:
- 첫째 줄: 작업의 본질 (무엇을 하는지)
- 둘째 줄: 핵심 산출물 또는 마감 압박
- 셋째 줄: 주의할 점 또는 의존성`;

    const result = await callGeminiJSON<{ summary: string }>(prompt, {
      mode: "flash",
      temperature: 0.3,
      maxOutputTokens: 700,
      featureKey: "task_auto_summary",
    });

    if (!result.ok || !result.data?.summary) {
      return { ok: false, error: result.error || "AI 응답 없음" };
    }

    const summary = String(result.data.summary).slice(0, 1000);

    await db
      .update(workspaceTasks)
      .set({ aiSummary: summary, updatedAt: new Date() } as Partial<typeof workspaceTasks.$inferInsert>)
      .where(eq(workspaceTasks.id, taskId));

    return { ok: true, summary };
  } catch (err: any) {
    console.error("[ai-task.summary] 실패:", err?.message || err);
    return { ok: false, error: err?.message || String(err) };
  }
}

/* ═══════════════════════════════════════════════════════
   AI-2 리스크 점수 — 0(안전) ~ 100(매우 지연 가능성)
   결정: AI 호출 + 휴리스틱 보정 (둘 다 사용 — AI 실패 시 휴리스틱만)
═══════════════════════════════════════════════════════ */
export async function calculateTaskRisk(taskId: number): Promise<{ ok: boolean; score?: number; reason?: string; error?: string }> {
  try {
    const [task]: any = await db.select().from(workspaceTasks).where(eq(workspaceTasks.id, taskId)).limit(1);
    if (!task) return { ok: false, error: "task not found" };
    if (task.status === "done" || task.status === "archived") {
      return { ok: false, error: "completed or archived task" };
    }

    // ── 휴리스틱 ──
    const now = Date.now();
    const dueMs = task.dueDate ? new Date(task.dueDate).getTime() : Infinity;
    const daysToDue = (dueMs - now) / 86400000;
    const progress = Number(task.progress || 0);

    let score = 0;
    // 마감 압박
    if (daysToDue < 0) score += 60;
    else if (daysToDue < 1) score += 45;
    else if (daysToDue < 3) score += 30;
    else if (daysToDue < 7) score += 15;
    // 진행률 미진
    if (progress < 30 && daysToDue < 3) score += 20;
    else if (progress < 50 && daysToDue < 7) score += 10;
    // 우선순위
    score += PRIORITY_WEIGHT[task.priority] || 0;
    // 보류 상태
    if (task.status === "blocked" && task.holdStartedAt) {
      const holdDays = (now - new Date(task.holdStartedAt).getTime()) / 86400000;
      if (holdDays > 7) score += 30;
      else if (holdDays > 3) score += 20;
      else score += 10;
    }
    score = Math.max(0, Math.min(100, Math.round(score)));

    // ── AI 호출 (휴리스틱 점수를 보정) — 분량 큰 task만 (description 200자+) ──
    let aiAdjusted = score;
    let reason = `휴리스틱: 마감 ${daysToDue.toFixed(1)}일, 진행 ${progress}%, 우선순위 ${task.priority}`;
    if ((task.description || "").length >= 200) {
      try {
        const prompt = `다음 작업의 지연 위험을 0~100 점수로 평가하세요.

# 작업
- 제목: ${task.title}
- 상태: ${task.status}
- 우선순위: ${task.priority}
- 마감까지: ${daysToDue.toFixed(1)}일
- 진행률: ${progress}%
- 설명: ${(task.description || "").slice(0, 1500)}
${task.holdReason ? `- 보류 사유: ${task.holdReason}` : ""}

# 응답 (JSON only)
{
  "score": 0~100 정수,
  "reason": "한 문장 (50자 이내)"
}`;
        const aiResult = await callGeminiJSON<{ score: number; reason: string }>(prompt, {
          mode: "flash",
          temperature: 0.2,
          maxOutputTokens: 300,
          featureKey: "task_daily_risk_evaluation",
        });
        if (aiResult.ok && aiResult.data && Number.isFinite(Number(aiResult.data.score))) {
          // 휴리스틱과 AI 점수의 평균 (안정성)
          const aiScore = Math.max(0, Math.min(100, Math.round(Number(aiResult.data.score))));
          aiAdjusted = Math.round((score + aiScore) / 2);
          reason = String(aiResult.data.reason || reason).slice(0, 100);
        }
      } catch (err) {
        console.warn("[ai-task.risk] AI 보정 실패, 휴리스틱만:", err);
      }
    }

    await db
      .update(workspaceTasks)
      .set({
        aiRiskScore: aiAdjusted,
        aiRiskUpdatedAt: new Date(),
        updatedAt: new Date(),
      } as Partial<typeof workspaceTasks.$inferInsert>)
      .where(eq(workspaceTasks.id, taskId));

    return { ok: true, score: aiAdjusted, reason };
  } catch (err: any) {
    console.error("[ai-task.risk] 실패:", err?.message || err);
    return { ok: false, error: err?.message || String(err) };
  }
}

/* ═══════════════════════════════════════════════════════
   AI-3 완료 보고서 초안 — workspace_task_reports에 type='completion' 자동 INSERT
   조건: done 이동 시 호출, 또는 수동 호출
═══════════════════════════════════════════════════════ */
export async function generateCompletionReport(taskId: number, authorMemberId: number): Promise<{ ok: boolean; reportId?: number; error?: string }> {
  try {
    const [task]: any = await db.select().from(workspaceTasks).where(eq(workspaceTasks.id, taskId)).limit(1);
    if (!task) return { ok: false, error: "task not found" };

    // 활동 로그 (최근 30건)
    const activities: any = await db
      .select()
      .from(workspaceActivityLog)
      .where(
        and(
          eq(workspaceActivityLog.targetType, "task"),
          eq(workspaceActivityLog.targetId, taskId)
        )
      )
      .limit(30);

    // 댓글 (최근 10건)
    const comments: any = await db
      .select()
      .from(workspaceTaskComments)
      .where(
        and(
          eq(workspaceTaskComments.taskId, taskId),
          isNull(workspaceTaskComments.deletedAt)
        )
      )
      .limit(10);

    const checklist = Array.isArray(task.checklistItems) ? task.checklistItems : [];
    const doneItems = checklist.filter((c: any) => c.done).map((c: any) => `- ${c.text}`).join("\n");

    const activitySummary = activities
      .slice(0, 10)
      .map((a: any) => `- ${a.actionType}: ${a.targetTitle || ""} (${new Date(a.createdAt).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })})`)
      .join("\n");

    const commentSummary = comments
      .slice(0, 5)
      .map((c: any) => `- ${(c.content || "").slice(0, 100)}`)
      .join("\n");

    const prompt = `당신은 NPO 운영자의 완료 보고서 초안 작성자입니다. 아래 정보로 마크다운 보고서를 작성하세요.

# 작업 정보
- 제목: ${task.title}
- 우선순위: ${task.priority}
- 시작 → 완료: ${task.createdAt} → ${task.completedAt || new Date().toISOString()}
- 진행률: ${task.progress}%
- 예상 시간: ${task.estimatedHours || "미정"}h / 실제 시간: ${task.actualHours || "미기록"}h

# 완료된 체크리스트 (${doneItems ? "있음" : "없음"})
${doneItems || "(체크리스트 없음)"}

# 주요 활동 로그
${activitySummary || "(활동 없음)"}

# 댓글 발췌
${commentSummary || "(댓글 없음)"}

# 응답 형식 (JSON only)
{
  "title": "보고서 제목 (50자 이내)",
  "content": "마크다운 본문 (8~15줄). 섹션: ## 개요 / ## 진행 경과 / ## 결과 / ## 후속 조치"
}`;

    const result = await callGeminiJSON<{ title: string; content: string }>(prompt, {
      mode: "flash",
      temperature: 0.4,
      maxOutputTokens: 2400,
      featureKey: "task_completion_report",
    });

    if (!result.ok || !result.data?.content) {
      return { ok: false, error: result.error || "AI 응답 없음" };
    }

    const inserted: any = await db
      .insert(workspaceTaskReports)
      .values({
        taskId,
        memberId: authorMemberId,
        type: "completion",
        title: String(result.data.title || `${task.title} - 완료 보고서 (AI 초안)`).slice(0, 300),
        content: String(result.data.content).slice(0, 10000),
        attachedFileIds: [],
        reviewStatus: "pending",
      } as any)
      .returning();

    return { ok: true, reportId: inserted[0]?.id };
  } catch (err: any) {
    console.error("[ai-task.completion] 실패:", err?.message || err);
    return { ok: false, error: err?.message || String(err) };
  }
}
