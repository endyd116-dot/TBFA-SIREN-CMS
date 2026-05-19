/**
 * Phase 25 — WBS 카드 완료 시 비매출 마일스톤 AI 자동 매칭 백그라운드 함수
 *
 * 호출: admin-workspace-tasks.ts의 status=done 처리 후 fire-and-forget
 * POST body: { taskId, memberId, secret }
 *
 * 처리 흐름:
 * 1. 카드 정보 + 멤버 milestoneRole 조회
 * 2. 활성 분기의 비매출 마일스톤 정의 목록 조회 (category != 'REVENUE_LINKED')
 * 3. Gemini로 가장 관련 높은 마일스톤 매칭
 * 4. 신뢰도 ≥90% → 자동 저장 + 목표 달성 시 비매출 성과 자동 제출 생성
 *    신뢰도 <90% → milestone_match_status=null 유지 (보류 큐)
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { callGeminiJSON } from "../../lib/ai-gemini";
/* ★ R35-GAP-P1-B-H3: 자동 제출 시 슈퍼어드민 알림 (사용자 직접 제출과 알림 정책 일관) */
import { notifyAllSuperAdmins } from "../../lib/notify";

export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  let body: any = {};
  try { body = await req.json(); } catch (_) {}

  const taskId = Number(body?.taskId || 0);
  const memberId = Number(body?.memberId || 0);
  if (!taskId || !memberId) {
    return Response.json({ ok: false, error: "taskId, memberId 필수" }, { status: 400 });
  }

  const secret = String(body?.secret || "");
  const expected = process.env.INTERNAL_TRIGGER_SECRET || "";
  if (expected && secret !== expected) {
    return Response.json({ ok: false, error: "권한 없음" }, { status: 403 });
  }

  console.info(`[ms-match-bg] start taskId=${taskId} memberId=${memberId}`);

  try {
    // 1. 카드 정보 조회 (milestone_def_id 이미 있으면 스킵)
    const taskRows = await db.execute(sql`
      SELECT id, title, description, tags, checklist_items, milestone_def_id, milestone_match_status, member_id
      FROM workspace_tasks WHERE id = ${taskId}
    `);
    const task = (taskRows as any).rows?.[0] || (taskRows as any[])[0];
    if (!task) { console.warn(`[ms-match-bg] task ${taskId} not found`); return Response.json({ ok: false }); }
    if (task.milestone_def_id) { console.info(`[ms-match-bg] already matched, skip`); return Response.json({ ok: true, skipped: true }); }

    // 2. 멤버 milestoneRole 조회
    const memRows = await db.execute(sql`
      SELECT milestone_role FROM members WHERE id = ${memberId}
    `);
    const member = (memRows as any).rows?.[0] || (memRows as any[])[0];
    const milestoneRole = member?.milestone_role;
    if (!milestoneRole) { console.info(`[ms-match-bg] no milestoneRole for member ${memberId}`); return Response.json({ ok: true, skipped: true }); }

    // 3. 활성 분기 조회
    const qRows = await db.execute(sql`
      SELECT id, year, quarter, start_date, end_date FROM quarters
      WHERE status = 'ACTIVE' ORDER BY year DESC, quarter DESC LIMIT 1
    `);
    const quarter = (qRows as any).rows?.[0] || (qRows as any[])[0];
    if (!quarter) { console.info(`[ms-match-bg] no active quarter`); return Response.json({ ok: true, skipped: true }); }

    // 4. 비매출 마일스톤 정의 목록 (category != 'REVENUE_LINKED')
    const defRows = await db.execute(sql`
      SELECT id, code, name, category, threshold_value, threshold_unit
      FROM milestone_definitions
      WHERE target_milestone_role = ${milestoneRole}
        AND category != 'REVENUE_LINKED'
        AND is_active = TRUE
      ORDER BY sort_order
    `);
    const defs: any[] = (defRows as any).rows || (defRows as any[]);
    if (!defs.length) { console.info(`[ms-match-bg] no non-revenue milestones`); return Response.json({ ok: true, skipped: true }); }

    // 5. Gemini 매칭
    const checklistText = (() => {
      try {
        const items = typeof task.checklist_items === "string" ? JSON.parse(task.checklist_items) : (task.checklist_items || []);
        return items.map((i: any) => `- ${i.text || i}`).join("\n");
      } catch { return ""; }
    })();

    const defsText = defs.map((d: any, i: number) =>
      `[${i + 1}] id=${d.id}, code=${d.code}, name=${d.name}, category=${d.category}, unit=${d.threshold_unit || ""}`
    ).join("\n");

    const prompt = `다음 WBS 업무 카드가 어느 비매출 성과 마일스톤에 해당하는지 분석하시오.

[업무 카드]
제목: ${task.title || ""}
설명: ${String(task.description || "").slice(0, 300)}
체크리스트:
${checklistText}

[비매출 마일스톤 목록]
${defsText}

규칙:
- 가장 관련성 높은 마일스톤 1개를 선택하시오.
- 관련 없으면 milestoneDefId를 null로.
- confidence는 0~100 정수 (90 이상이면 자동 처리됨).

응답 형식 (JSON만):
{"milestoneDefId": <id 또는 null>, "confidence": <0~100>, "reason": "<한 줄>"}`;

    const aiResult = await callGeminiJSON<{ milestoneDefId: number | null; confidence: number; reason: string }>(
      prompt, { mode: "flash", featureKey: "milestone_match" }
    );

    if (!aiResult.ok || !aiResult.data) {
      console.warn(`[ms-match-bg] Gemini 실패 taskId=${taskId}:`, aiResult.error);
      return Response.json({ ok: true, skipped: true, reason: "gemini_fail" });
    }

    const { milestoneDefId, confidence, reason } = aiResult.data;
    console.info(`[ms-match-bg] match defId=${milestoneDefId} confidence=${confidence}%`);

    if (!milestoneDefId) {
      console.info(`[ms-match-bg] AI: 관련 마일스톤 없음`);
      return Response.json({ ok: true, matched: false });
    }

    // milestoneDefId가 실제로 유효한지 확인
    const validDef = defs.find((d: any) => d.id === milestoneDefId);
    if (!validDef) {
      console.warn(`[ms-match-bg] AI 반환 defId=${milestoneDefId} 유효하지 않음`);
      return Response.json({ ok: true, skipped: true });
    }

    /* ★ R35-GAP-P2-🟡A: 신뢰도 임계점 환경변수화 (기본 90%·운영 누적 후 조정 가능) */
    const threshold = Number(process.env.MILESTONE_AI_CONFIDENCE_THRESHOLD || 90);
    if (confidence >= threshold) {
      // 자동 매칭 저장
      await db.execute(sql`
        UPDATE workspace_tasks
        SET milestone_def_id = ${milestoneDefId},
            milestone_match_status = 'auto',
            milestone_match_confidence = ${confidence}
        WHERE id = ${taskId}
      `);
      console.info(`[ms-match-bg] 자동 매칭 완료 taskId=${taskId} defId=${milestoneDefId}`);

      // 목표 달성 체크 → 비매출 성과 자동 제출
      await checkAndAutoSubmitAchievement({ memberId, milestoneDefId, quarterId: quarter.id, def: validDef });

    } else {
      // 보류 — milestone_match_status = null 그대로 (클라이언트에서 pending 큐 표시)
      console.info(`[ms-match-bg] 신뢰도 낮음(${confidence}%), 보류 처리 taskId=${taskId}`);
    }

    return Response.json({ ok: true, milestoneDefId, confidence, reason });

  } catch (err: any) {
    console.error(`[ms-match-bg] 오류:`, err?.message || err);
    return Response.json({ ok: false, error: String(err?.message || err).slice(0, 200) }, { status: 500 });
  }
}

async function checkAndAutoSubmitAchievement(opts: {
  memberId: number;
  milestoneDefId: number;
  quarterId: number;
  def: any;
}) {
  const { memberId, milestoneDefId, quarterId, def } = opts;
  try {
    // 이 분기 내 해당 마일스톤의 완료 카드 수
    const countRows = await db.execute(sql`
      SELECT COUNT(*) as cnt FROM workspace_tasks
      WHERE member_id = ${memberId}
        AND milestone_def_id = ${milestoneDefId}
        AND milestone_match_status IN ('auto', 'user')
        AND status = 'done'
    `);
    const achieved = Number((countRows as any).rows?.[0]?.cnt || (countRows as any[])[0]?.cnt || 0);
    const target = Number(def.threshold_value || 0);

    if (target <= 0 || achieved < target) return;

    // 이미 비매출 성과 제출 레코드가 있는지 확인 (REJECTED 제외)
    const existRows = await db.execute(sql`
      SELECT id FROM non_revenue_achievements
      WHERE submitted_by = ${memberId}
        AND milestone_definition_id = ${milestoneDefId}
        AND quarter_id = ${quarterId}
        AND status != 'REJECTED'
      LIMIT 1
    `);
    const exists = ((existRows as any).rows?.[0] || (existRows as any[])[0]);
    if (exists) return;

    // 비매출 성과 자동 제출 (PENDING 상태로 생성)
    await db.execute(sql`
      INSERT INTO non_revenue_achievements
        (milestone_definition_id, quarter_id, submitted_by, achieved_date, description, status, created_at, updated_at)
      VALUES
        (${milestoneDefId}, ${quarterId}, ${memberId}, NOW(),
         ${"WBS 카드 " + achieved + "건 완료로 자동 달성"},
         'PENDING', NOW(), NOW())
    `);
    console.info(`[ms-match-bg] 비매출 성과 자동 제출 완료: memberId=${memberId} defId=${milestoneDefId}`);

    /* ★ R35-GAP-P1-B-H3: 슈퍼어드민 검증 요청 알림 (사용자 직접 제출 milestone-nonrevenue.ts:92-97과 동일 패턴, AI 명시) */
    let memberName: string | null = null;
    try {
      const mRows = await db.execute(sql`SELECT name, email FROM members WHERE id = ${memberId}`);
      const mRow = (mRows as any).rows?.[0] || (mRows as any[])[0];
      memberName = mRow?.name || mRow?.email || null;
    } catch { /* 이름 조회 실패는 알림 영향 없음 */ }
    notifyAllSuperAdmins({
      category: "milestone", severity: "info",
      title: `비매출 성과 자동 제출 (AI): ${def.name}`,
      message: `${memberName || `회원 ID ${memberId}`}의 WBS 카드 ${achieved}건 완료로 자동 매칭·제출되었습니다. 검증 필요.`,
      link: "/admin#nonrevenue-verify",
    }).catch(() => {});
  } catch (err) {
    console.warn(`[ms-match-bg] checkAndAutoSubmitAchievement 실패:`, err);
  }
}
