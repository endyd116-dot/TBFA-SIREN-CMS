/**
 * cron-ai-schedule-runner — AI 스케줄 명령 자동 실행
 *
 * 10분마다 실행 (UTC: every 10 minutes — cron "\/10 * * * *")
 *
 * 동작:
 *   1. next_run_at <= NOW() AND is_active = true 인 스케줄 조회
 *   2. 각 명령 텍스트를 Gemini AI에 전달하여 실행
 *   3. 결과를 last_result, last_run_at, next_run_at에 저장
 *   4. 에러 시 last_result에 에러 저장, throw 안 함 (fire-and-forget)
 */

import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { callGemini } from "../../lib/ai-gemini";

const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

/** cron 표현식 파싱 — 다음 실행 시각 계산 (단순 분 단위 지원) */
function calcNextRunAt(cronExpr: string): Date {
  const now = new Date();
  const parts = cronExpr.trim().split(/\s+/);
  // 기본값: 10분 후
  const next = new Date(now.getTime() + 10 * 60 * 1000);

  // */N 분 패턴 처리
  if (parts.length >= 1 && parts[0].startsWith("*/")) {
    const mins = parseInt(parts[0].slice(2), 10);
    if (!isNaN(mins) && mins > 0) {
      return new Date(now.getTime() + mins * 60 * 1000);
    }
  }

  // 특정 시각(0 21 * * * 등) — cron 시각을 KST로 해석해 UTC next_run_at 계산 (시스템 전반 KST 기준).
  // ★ Q3-050 fix: 기존 setHours(컨테이너 로컬=UTC) → KST 의도와 9시간 어긋남. setUTCHours로 KST 벽시계 적용.
  // (요일/일 필드는 미지원 — 매일로 처리. 정밀 cron은 별도 라이브러리 필요 — P3 범위 외.)
  if (parts.length >= 2) {
    const minute = parseInt(parts[0], 10);
    const hour = parseInt(parts[1], 10);
    if (!isNaN(hour) && !isNaN(minute)) {
      const kst = new Date(now.getTime() + 9 * 3600 * 1000); // now를 KST로
      kst.setUTCHours(hour, minute, 0, 0);                    // KST 벽시계로 목표 시각 설정
      let nextUtcMs = kst.getTime() - 9 * 3600 * 1000;        // 다시 UTC로
      if (nextUtcMs <= now.getTime()) nextUtcMs += 24 * 3600 * 1000; // 항상 미래
      return new Date(nextUtcMs);
    }
  }

  return next;
}

async function runSchedule(schedule: {
  id: number;
  name: string;
  cron_expr: string;
  command: string;
  admin_id: number | null;
}): Promise<{ ok: boolean; result: string }> {
  try {
    const aiResult = await callGemini(schedule.command, {
      featureKey: "schedule_runner",
      adminId: schedule.admin_id ?? undefined,
      mode: "flash",
    });

    if (!aiResult.ok) {
      return { ok: false, result: `AI 실패: ${aiResult.error?.slice(0, 300)}` };
    }

    return { ok: true, result: (aiResult.text || "").slice(0, 1000) };
  } catch (e: any) {
    return { ok: false, result: `실행 오류: ${e?.message?.slice(0, 300)}` };
  }
}

export default async (_req: Request, _ctx: Context) => {
  const start = Date.now();
  console.info("[cron-ai-schedule-runner] 시작", new Date().toISOString());

  try {
    const dueRows = await db.execute(sql`
      SELECT id, name, cron_expr, command, admin_id
      FROM ai_scheduled_commands
      WHERE next_run_at <= NOW() AND is_active = true
      ORDER BY next_run_at ASC
      LIMIT 50
    `) as any;

    const schedules = Array.isArray(dueRows) ? dueRows : (dueRows?.rows || []);

    if (!schedules.length) {
      console.info("[cron-ai-schedule-runner] 실행 대상 없음");
      return new Response(
        JSON.stringify({ ok: true, processed: 0, message: "실행 대상 없음" }),
        { status: 200, headers: JSON_HEADER }
      );
    }

    let success = 0;
    const errors: Array<{ id: number; name: string; error: string }> = [];

    for (const schedule of schedules) {
      const r = await runSchedule(schedule);
      const nextRunAt = calcNextRunAt(schedule.cron_expr);

      try {
        await db.execute(sql`
          UPDATE ai_scheduled_commands
          SET
            last_run_at = NOW(),
            next_run_at = ${nextRunAt.toISOString()},
            last_result  = ${r.result},
            updated_at   = NOW()
          WHERE id = ${schedule.id}
        `);
      } catch (updateErr: any) {
        console.warn(`[cron-ai-schedule-runner] id=${schedule.id} 결과 저장 실패:`, updateErr?.message);
      }

      if (r.ok) success++;
      else errors.push({ id: schedule.id, name: schedule.name, error: r.result });
    }

    const durationMs = Date.now() - start;
    console.info(`[cron-ai-schedule-runner] 완료 ${success}/${schedules.length}건 (${durationMs}ms)`);

    return new Response(
      JSON.stringify({
        ok: true,
        total: schedules.length,
        success,
        failed: errors.length,
        durationMs,
        errors: errors.slice(0, 10),
      }),
      { status: 200, headers: JSON_HEADER }
    );
  } catch (err: any) {
    console.error("[cron-ai-schedule-runner] fatal:", err);
    return new Response(
      JSON.stringify({ ok: false, error: err?.message || "unknown" }),
      { status: 500, headers: JSON_HEADER }
    );
  }
};

export const config = {
  // ★ 2026-06-25 DB 비용 절감(wake-on-demand): 10분 → 30분. AI 예약 명령은 30분 지연 무해.
  schedule: "*/30 * * * *",
};
