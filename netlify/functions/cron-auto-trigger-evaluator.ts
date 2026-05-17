// netlify/functions/cron-auto-trigger-evaluator.ts
// Phase 10 R4 — 자동 트리거 평가기 (30분 단위)
//
// 활성화된 모든 트리거를 순회하며:
//   1. evaluateTrigger → 발송 대상 후보 추출 + 쿨다운 필터
//   2. 대상 있으면 executeTrigger → send_job + recipients 생성
//   3. auto_trigger_runs에 실행 기록

import { db } from "../../db";
import { sql } from "drizzle-orm";
import { evaluateTrigger, executeTrigger, type TriggerType } from "../../lib/communication-auto-trigger";

export const config = { schedule: "*/30 * * * *" };

export default async function handler(_req: Request) {
  const t0 = Date.now();
  const stats = { evaluated: 0, triggered: 0, skipped: 0, errors: 0 };

  /* 활성 트리거 목록 조회 */
  let triggers: any[] = [];
  try {
    const r: any = await db.execute(sql`
      SELECT id, name, trigger_type, template_id, recipient_group_id,
             channel, delay_hours, cooldown_days, conditions
        FROM communication_auto_triggers
       WHERE is_active = true AND deleted_at IS NULL
       ORDER BY id ASC
    `);
    triggers = r?.rows ?? r ?? [];
  } catch (err) {
    console.error("[cron-auto-trigger] 트리거 목록 조회 실패", err);
    return new Response(
      JSON.stringify({ ok: false, error: "트리거 목록 조회 실패", stats }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  for (const trigger of triggers) {
    stats.evaluated++;
    let runStatus: "ok" | "skipped" | "error" = "skipped";
    let runError: string | null = null;
    let jobId: number | null = null;
    let memberCount = 0;

    try {
      /* 트리거 단위 쿨다운 체크 — 이 트리거가 cooldownDays 내에 'ok'로 실행된 이력이 있으면 스킵 */
      const cooldownDays = Number(trigger.cooldown_days ?? 30);
      const cooldownCutoff = new Date(Date.now() - cooldownDays * 86400_000);
      const recentRunRes: any = await db.execute(sql`
        SELECT id FROM communication_auto_trigger_runs
         WHERE trigger_id = ${trigger.id}
           AND status = 'ok'
           AND triggered_at >= ${cooldownCutoff}
         LIMIT 1
      `);
      const recentRun = (recentRunRes?.rows ?? recentRunRes ?? []);
      if (recentRun.length > 0) {
        runStatus = "skipped";
        try {
          await db.execute(sql`
            INSERT INTO communication_auto_trigger_runs
              (trigger_id, job_id, triggered_at, member_count, status, error)
            VALUES
              (${trigger.id}, ${null}, NOW(), ${0}, ${'skipped'}, ${'cooldown 내 실행 이력 있음'})
          `);
        } catch (e) {
          console.warn(`[cron-auto-trigger] skipped runs 기록 실패 triggerId=${trigger.id}`, e);
        }
        stats.skipped++;
        continue;
      }

      /* 발송 대상 평가 */
      const evalResult = await evaluateTrigger({
        id:          trigger.id,
        triggerType: trigger.trigger_type as TriggerType,
        delayHours:  Number(trigger.delay_hours ?? 0),
        cooldownDays: cooldownDays,
        conditions:  trigger.conditions,
      });

      memberCount = evalResult.memberIds.length;

      if (memberCount === 0) {
        runStatus = "skipped";
      } else {
        /* 발송 실행 */
        const execResult = await executeTrigger(
          {
            id:         trigger.id,
            name:       trigger.name,
            templateId: Number(trigger.template_id),
            channel:    trigger.channel,
          },
          evalResult.memberIds,
        );

        if (execResult.jobId) {
          jobId = execResult.jobId;
          runStatus = "ok";
          stats.triggered++;
        } else {
          runStatus = "error";
          runError = execResult.error || "실행 결과 없음";
          stats.errors++;
        }
      }
    } catch (err: any) {
      runStatus = "error";
      runError = String(err?.message || err).slice(0, 500);
      stats.errors++;
      console.error(`[cron-auto-trigger] triggerId=${trigger.id} 평가 실패`, err);
    }

    if (runStatus === "skipped") {
      stats.skipped++;
    }

    /* 실행 이력 기록 */
    try {
      await db.execute(sql`
        INSERT INTO communication_auto_trigger_runs
          (trigger_id, job_id, triggered_at, member_count, status, error)
        VALUES
          (${trigger.id}, ${jobId}, NOW(), ${memberCount}, ${runStatus}, ${runError})
      `);
    } catch (e) {
      console.warn(`[cron-auto-trigger] runs 기록 실패 triggerId=${trigger.id}`, e);
    }
  }

  console.log(
    `[cron-auto-trigger] done ${Date.now() - t0}ms — ` +
      `evaluated=${stats.evaluated} triggered=${stats.triggered} ` +
      `skipped=${stats.skipped} errors=${stats.errors}`,
  );

  return new Response(
    JSON.stringify({ ok: true, durationMs: Date.now() - t0, stats }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}
