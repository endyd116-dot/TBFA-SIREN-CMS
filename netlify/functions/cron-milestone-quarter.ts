import type { Config, Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { notifyMany, notifyAllSuperAdmins } from "../../lib/notify";

export const config: Config = {
  schedule: "0 0 * * *",  // 매일 UTC 00:00 (KST 09:00)
};

export default async function handler(_req: Request, _ctx: Context) {
  const today = new Date().toISOString().slice(0, 10);
  const results: string[] = [];

  try {
    // UPCOMING → ACTIVE (시작일 도래)
    const activateRes = await db.execute(sql`
      UPDATE quarters SET status = 'ACTIVE', updated_at = NOW()
      WHERE status = 'UPCOMING' AND start_date <= ${today}
      RETURNING id, year, quarter
    `);
    const activated = (activateRes as any).rows || (activateRes as any[]);
    if (activated.length > 0) results.push(`ACTIVE 전환: ${activated.map((r: any) => `${r.year}Q${r.quarter}`).join(", ")}`);

    // ACTIVE → ENDED (종료일 도래)
    const endRes = await db.execute(sql`
      UPDATE quarters SET status = 'ENDED', updated_at = NOW()
      WHERE status = 'ACTIVE' AND end_date < ${today}
      RETURNING id, year, quarter
    `);
    const ended = (endRes as any).rows || (endRes as any[]);
    if (ended.length > 0) results.push(`ENDED 전환: ${ended.map((r: any) => `${r.year}Q${r.quarter}`).join(", ")}`);

    // ENDED → SETTLED (모든 결산 PAID 완료 시)
    /* ★ R34-P2-B-1: 'APPROVED' 제거 — 명세 의도는 100% PAID일 때만 SETTLED 마감.
       APPROVED 단계에서도 SETTLED 마감되면 후속 PAID 트리거가 누락될 위험 */
    const endedQRows = await db.execute(sql`SELECT id, year, quarter FROM quarters WHERE status = 'ENDED'`);
    const endedQs = (endedQRows as any).rows || (endedQRows as any[]);
    for (const q of endedQs) {
      const unpaidRows = await db.execute(sql`
        SELECT COUNT(*) as cnt FROM quarterly_settlements
        WHERE quarter_id = ${q.id} AND status NOT IN ('PAID')
      `);
      const unpaid = Number(((unpaidRows as any).rows?.[0] || unpaidRows[0])?.cnt || 0);
      if (unpaid === 0) {
        await db.execute(sql`UPDATE quarters SET status = 'SETTLED', updated_at = NOW() WHERE id = ${q.id}`);
        results.push(`SETTLED: ${q.year}Q${q.quarter}`);
      }
    }

    // ── D-7 알림: 분기 종료 7일 전 모든 어드민에게 ──
    const d7Date = new Date();
    d7Date.setDate(d7Date.getDate() + 7);
    const d7 = d7Date.toISOString().slice(0, 10);
    const d7Rows = await db.execute(sql`
      SELECT id, year, quarter FROM quarters WHERE status = 'ACTIVE' AND end_date = ${d7}
    `);
    const d7Qs = (d7Rows as any).rows || (d7Rows as any[]);
    if (d7Qs.length > 0) {
      for (const q of d7Qs) {
        try {
          const adminRows = await db.execute(sql`
            SELECT id FROM members WHERE type = 'admin' AND status = 'active' AND milestone_role IS NOT NULL
          `);
          const adminIds = ((adminRows as any).rows || (adminRows as any[])).map((r: any) => r.id);
          if (adminIds.length > 0) {
            await notifyMany(adminIds, {
              recipientType: "admin",
              category: "milestone", severity: "warning",
              title: `결산 작성 기한 D-7: ${q.year}년 ${q.quarter}분기`,
              message: "분기 종료 7일 전입니다. 결산을 제출해주세요.",
              link: "/admin#settlement-my",
            });
          }
          results.push(`D-7 알림 발송: ${q.year}Q${q.quarter} → ${adminIds.length}명`);
        } catch (e: any) {
          results.push(`D-7 알림 오류: ${String(e?.message).slice(0, 100)}`);
        }
      }
    }

    // ── 미제출 에스컬레이션: ENDED 분기 중 DRAFT/미제출 결산 ──
    const endedIds = endedQs.map((q: any) => q.id);
    if (endedIds.length > 0) {
      const milestoneMembers = await db.execute(sql`
        SELECT id, name FROM members
        WHERE type = 'admin' AND status = 'active' AND milestone_role IS NOT NULL
      `);
      const members = (milestoneMembers as any).rows || (milestoneMembers as any[]);

      for (const q of endedQs) {
        const submittedRows = await db.execute(sql`
          SELECT member_id FROM quarterly_settlements
          WHERE quarter_id = ${q.id} AND status NOT IN ('DRAFT')
        `);
        const submittedIds = new Set(
          ((submittedRows as any).rows || (submittedRows as any[])).map((r: any) => r.member_id)
        );
        const unsubmitted = members.filter((m: any) => !submittedIds.has(m.id));
        if (unsubmitted.length > 0) {
          const names = unsubmitted.map((m: any) => m.name || `ID:${m.id}`).join(", ");
          try {
            await notifyAllSuperAdmins({
              category: "milestone", severity: "warning",
              title: `결산 미제출 에스컬레이션: ${q.year}년 ${q.quarter}분기`,
              message: `미제출자: ${names}`,
              link: "/admin#settlement-review",
            });
            results.push(`미제출 에스컬레이션: ${q.year}Q${q.quarter} — ${unsubmitted.length}명`);
          } catch (e: any) {
            results.push(`에스컬레이션 오류: ${String(e?.message).slice(0, 100)}`);
          }
        }
      }
    }

    // ── 임계점 도달 체크: 매일 REVENUE_LINKED 누적치 임계점 초과 여부 ──
    /* ★ R35-GAP-P2-M4: ACTIVE → ENDED 전환된 분기도 1회 일괄 알림 발송 (분기 종료일 직전 매출 누락 방지).
       dedup은 기존 notifications(ref_table='milestone_threshold' AND ref_id=m.id AND created_at>=quarter.start_date)
       조건으로 분기 내 중복 자동 차단 — ENDED 전환 cron에서도 동일 분기 ID 매칭. */
    const activeQRows = await db.execute(sql`SELECT id, year, quarter, 'ACTIVE' as phase FROM quarters WHERE status = 'ACTIVE'`);
    const activeQsBase = (activeQRows as any).rows || (activeQRows as any[]);
    const thresholdQs = [
      ...activeQsBase,
      ...ended.map((q: any) => ({ ...q, phase: "JUST_ENDED" })), // 이번 cron에서 ACTIVE → ENDED 전환된 것
    ];
    /* 호환을 위해 기존 변수명 유지 */
    const activeQs = thresholdQs;
    for (const q of activeQs) {
      const milestonesRows = await db.execute(sql`
        SELECT id, name, target_milestone_role, threshold_enabled, threshold_value, bonus_formula
        FROM milestone_definitions
        WHERE is_active = TRUE AND category = 'REVENUE_LINKED' AND threshold_enabled = TRUE
      `);
      const milestones = (milestonesRows as any).rows || (milestonesRows as any[]);

      for (const m of milestones) {
        try {
          /* ★ R29-GAP-P2-M1: 입력자 이름·담당 admin 함께 조회 (그룹 알림용) */
          const sumRows = await db.execute(sql`
            SELECT COALESCE(SUM(re.amount::numeric), 0) as total,
                   re.entered_by,
                   mem.name as entered_by_name
            FROM revenue_entries re
            LEFT JOIN members mem ON mem.id = re.entered_by
            WHERE re.milestone_definition_id = ${m.id}
              AND re.quarter_id = ${q.id}
              AND re.status = 'VERIFIED'
            GROUP BY re.entered_by, mem.name
          `);
          const sums = (sumRows as any).rows || (sumRows as any[]);
          const thrVal = Number(m.threshold_value || 0);

          /* ★ R29-GAP-P2-M1: 담당 admin(milestone_role 일치) 조회 — 그룹 알림 대상 */
          const roleAdminRows = await db.execute(sql`
            SELECT id FROM members
            WHERE type = 'admin' AND status = 'active'
              AND milestone_role = ${m.target_milestone_role}
          `);
          const roleAdminIds: number[] = ((roleAdminRows as any).rows || (roleAdminRows as any[]))
            .map((r: any) => Number(r.id));

          /* ★ R35-GAP-P2-M4: JUST_ENDED 분기는 메시지에 "분기 종료 후" 명시 (운영자 인식 보조) */
          const phaseLabel = (q as any).phase === "JUST_ENDED" ? " (분기 종료 후)" : "";

          for (const row of sums) {
            const total = Number(row.total || 0);
            if (total <= thrVal) continue;

            const enteredById = Number(row.entered_by);
            const memberName = row.entered_by_name || `ID:${enteredById}`;

            /* 1. 입력자 본인 알림 (인센티브 대상 안내) — 기존 유지 */
            const dupRows = await db.execute(sql`
              SELECT id FROM notifications
              WHERE recipient_id = ${enteredById}
                AND ref_table = 'milestone_threshold'
                AND ref_id = ${m.id}
                AND created_at >= (SELECT start_date FROM quarters WHERE id = ${q.id})
              LIMIT 1
            `);
            const dup = (dupRows as any).rows || (dupRows as any[]);
            if (dup.length === 0) {
              await notifyMany([enteredById], {
                recipientType: "admin",
                category: "milestone", severity: "info",
                title: `임계점 달성${phaseLabel}: ${m.name}`,
                message: `누적 ${total.toLocaleString()}원으로 임계점 ${thrVal.toLocaleString()}원 초과! 인센티브 대상입니다.`,
                link: "/admin#revenue-my",
                refTable: "milestone_threshold",
                refId: m.id,
              });
            }

            /* 2. ★ R29-GAP-P2-M1: 담당 admin 그룹 알림 (입력자 본인 제외, 분기 내 중복 제외) */
            const targetAdminIds = roleAdminIds.filter((id) => id !== enteredById);
            if (targetAdminIds.length > 0) {
              const sendIds: number[] = [];
              for (const adminId of targetAdminIds) {
                const adminDupRows = await db.execute(sql`
                  SELECT id FROM notifications
                  WHERE recipient_id = ${adminId}
                    AND ref_table = 'milestone_threshold'
                    AND ref_id = ${m.id}
                    AND created_at >= (SELECT start_date FROM quarters WHERE id = ${q.id})
                  LIMIT 1
                `);
                const adminDup = (adminDupRows as any).rows || (adminDupRows as any[]);
                if (adminDup.length === 0) sendIds.push(adminId);
              }
              if (sendIds.length > 0) {
                await notifyMany(sendIds, {
                  recipientType: "admin",
                  category: "milestone", severity: "info",
                  title: `[성과 임계점${phaseLabel}] ${memberName}의 ${m.name} 임계 도달`,
                  message: `${memberName}님이 ${m.name} 임계점(${thrVal.toLocaleString()}원)을 초과했습니다. 누적 ${total.toLocaleString()}원.`,
                  link: "/admin#milestone-review",
                  refTable: "milestone_threshold",
                  refId: m.id,
                });
              }
            } else {
              /* 3. ★ R29-GAP-P2-M1: 담당 admin 0명 → 슈퍼어드민 fallback */
              await notifyAllSuperAdmins({
                category: "milestone", severity: "warning",
                title: `[성과 임계점${phaseLabel}] ${memberName}의 ${m.name} 임계 도달 (담당 미배정)`,
                message: `${m.target_milestone_role} 담당 admin이 배정되지 않았습니다. ${memberName}님 ${m.name} 임계점(${thrVal.toLocaleString()}원) 초과 — 누적 ${total.toLocaleString()}원.`,
                link: "/admin#milestone-review",
                refTable: "milestone_threshold",
                refId: m.id,
              }).catch(() => {});
            }
          }
        } catch { /* 개별 마일스톤 오류는 건너뜀 */ }
      }
    }
    if (activeQs.length > 0) results.push(`임계점 체크 완료: ${activeQs.length}개 활성 분기`);

    console.log("[cron-milestone-quarter]", results.join(" | ") || "변경 없음");
  } catch (err: any) {
    console.error("[cron-milestone-quarter] 오류:", err?.message);
  }

  return new Response("ok");
}
