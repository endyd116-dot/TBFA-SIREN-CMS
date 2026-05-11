// netlify/functions/migrate-workspace-v2-rollback.ts
// ★ 2026-05-12 워크스페이스 v2 재설계 — DB 잔재 완전 정리 (1회용)
//
// 원본 마이그레이션 migrate-workspace-v2.ts가 추가한 항목 전부 되돌림:
//   ① 신규 테이블 4종 DROP — workspace_task_transfers, service_rnr,
//      workspace_task_watchers, workspace_task_mentions
//   ② workspace_memos 컬럼 4개 DROP — show_in_calendar, start_at, end_at, mirrored_event_id
//   ③ 서비스 테이블 추가 컬럼 DROP
//      - incident_reports: assigned_to, assigned_at, sla_due_at, workspace_task_id
//      - harassment_reports: assigned_to, assigned_at, sla_due_at, workspace_task_id
//      - legal_consultations: assigned_to, sla_due_at, workspace_task_id
//      - support_requests: sla_due_at, workspace_task_id
//   ④ workspace_task_templates 시드 10행 DELETE (테이블 자체는 v2 이전부터 존재 → 유지)
//
// 호출
//   진단: GET  /api/migrate-workspace-v2-rollback        (인증 불필요)
//   실행: GET  /api/migrate-workspace-v2-rollback?run=1  (super_admin 필요)
//
// 호출 성공 후 절차
//   1) 응답 결과 확인
//   2) AI에게 알림 → 본 함수 파일 삭제 + 커밋 (1회용 보안 원칙)

import { requireAdmin } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";
import { db } from "../../db";

export const config = { path: "/api/migrate-workspace-v2-rollback" };

function pickRows(r: any): any[] {
  return Array.isArray(r) ? r : (r?.rows || []);
}

const V2_TEMPLATE_NAMES = [
  "📋 월간 운영 보고서 작성",
  "💰 후원금 입금 확인 + 영수증 발급",
  "🎗 유족 회원 신규 가입 환영 전화",
  "🚨 SIREN 신고 1차 검토 (24h 이내)",
  "📨 정기 후원자 감사 인사 발송",
  "📅 운영위원회 안건 준비",
  "🤝 전문가 매칭 follow-up",
  "📊 캠페인 성과 분석 리포트",
  "🧾 연말정산 영수증 일괄 발급 점검",
  "🗂 회원 DB 클렌징 (중복/연락두절)",
];

export default async (req: Request) => {
  const url = new URL(req.url);
  const isRun = url.searchParams.get("run") === "1";

  if (isRun) {
    const guard: any = await requireAdmin(req);
    if (!guard.ok) return (guard as { ok: false; res: Response }).res;
    const role = (guard.ctx?.admin?.role || "").toString();
    if (role !== "super_admin") {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "super_admin 권한이 필요합니다",
          currentRole: role || "(없음)",
        }, null, 2),
        { status: 403, headers: { "Content-Type": "application/json" } },
      );
    }
  }

  const steps: { step: string; ok: boolean; note?: string }[] = [];

  async function step(name: string, fn: () => Promise<any>, note?: string) {
    try {
      await fn();
      steps.push({ step: name, ok: true, note });
    } catch (e: any) {
      steps.push({ step: name, ok: false, note: String(e?.message || e).slice(0, 300) });
      throw e;
    }
  }

  try {
    if (isRun) {
      /* ─────────── ① 신규 테이블 4종 DROP ─────────── */
      await step("drop_table:workspace_task_transfers", async () => {
        await db.execute(sql`DROP TABLE IF EXISTS workspace_task_transfers CASCADE`);
      });
      await step("drop_table:service_rnr", async () => {
        await db.execute(sql`DROP TABLE IF EXISTS service_rnr CASCADE`);
      });
      await step("drop_table:workspace_task_watchers", async () => {
        await db.execute(sql`DROP TABLE IF EXISTS workspace_task_watchers CASCADE`);
      });
      await step("drop_table:workspace_task_mentions", async () => {
        await db.execute(sql`DROP TABLE IF EXISTS workspace_task_mentions CASCADE`);
      });

      /* ─────────── ② workspace_memos 컬럼 DROP ─────────── */
      await step("alter_table:workspace_memos drop v2 columns", async () => {
        await db.execute(sql`DROP INDEX IF EXISTS workspace_memos_calendar_idx`);
        await db.execute(sql`ALTER TABLE workspace_memos DROP COLUMN IF EXISTS show_in_calendar`);
        await db.execute(sql`ALTER TABLE workspace_memos DROP COLUMN IF EXISTS start_at`);
        await db.execute(sql`ALTER TABLE workspace_memos DROP COLUMN IF EXISTS end_at`);
        await db.execute(sql`ALTER TABLE workspace_memos DROP COLUMN IF EXISTS mirrored_event_id`);
      });

      /* ─────────── ③ 서비스 테이블 추가 컬럼 DROP ─────────── */
      await step("alter_table:incident_reports drop v2 columns", async () => {
        await db.execute(sql`DROP INDEX IF EXISTS incident_reports_assigned_to_idx`);
        await db.execute(sql`DROP INDEX IF EXISTS incident_reports_sla_idx`);
        await db.execute(sql`ALTER TABLE incident_reports DROP COLUMN IF EXISTS assigned_to`);
        await db.execute(sql`ALTER TABLE incident_reports DROP COLUMN IF EXISTS assigned_at`);
        await db.execute(sql`ALTER TABLE incident_reports DROP COLUMN IF EXISTS sla_due_at`);
        await db.execute(sql`ALTER TABLE incident_reports DROP COLUMN IF EXISTS workspace_task_id`);
      });

      await step("alter_table:harassment_reports drop v2 columns", async () => {
        await db.execute(sql`DROP INDEX IF EXISTS harassment_reports_assigned_to_idx`);
        await db.execute(sql`DROP INDEX IF EXISTS harassment_reports_sla_idx`);
        await db.execute(sql`ALTER TABLE harassment_reports DROP COLUMN IF EXISTS assigned_to`);
        await db.execute(sql`ALTER TABLE harassment_reports DROP COLUMN IF EXISTS assigned_at`);
        await db.execute(sql`ALTER TABLE harassment_reports DROP COLUMN IF EXISTS sla_due_at`);
        await db.execute(sql`ALTER TABLE harassment_reports DROP COLUMN IF EXISTS workspace_task_id`);
      });

      await step("alter_table:legal_consultations drop v2 columns", async () => {
        await db.execute(sql`DROP INDEX IF EXISTS legal_consultations_assigned_to_idx`);
        await db.execute(sql`DROP INDEX IF EXISTS legal_consultations_sla_idx`);
        await db.execute(sql`ALTER TABLE legal_consultations DROP COLUMN IF EXISTS assigned_to`);
        await db.execute(sql`ALTER TABLE legal_consultations DROP COLUMN IF EXISTS sla_due_at`);
        await db.execute(sql`ALTER TABLE legal_consultations DROP COLUMN IF EXISTS workspace_task_id`);
      });

      await step("alter_table:support_requests drop v2 columns", async () => {
        await db.execute(sql`DROP INDEX IF EXISTS support_sla_idx`);
        await db.execute(sql`ALTER TABLE support_requests DROP COLUMN IF EXISTS sla_due_at`);
        await db.execute(sql`ALTER TABLE support_requests DROP COLUMN IF EXISTS workspace_task_id`);
      });

      /* ─────────── ④ workspace_task_templates 시드 10행 DELETE ─────────── */
      await step("delete:workspace_task_templates v2 seed rows", async () => {
        const before: any = await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM workspace_task_templates`);
        const beforeCnt = pickRows(before)[0]?.cnt || 0;
        let deleted = 0;
        for (const name of V2_TEMPLATE_NAMES) {
          const r: any = await db.execute(sql`DELETE FROM workspace_task_templates WHERE name = ${name}`);
          /* drizzle execute는 rowCount를 직접 안 줄 수 있어서 명시적 카운트 사용 안 함 */
          deleted++;
        }
        const after: any = await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM workspace_task_templates`);
        const afterCnt = pickRows(after)[0]?.cnt || 0;
        steps[steps.length - 1].note = `before=${beforeCnt}, after=${afterCnt}, attempted=${V2_TEMPLATE_NAMES.length}`;
      });
    }

    /* ────────────── 진단 (run 여부 무관) ────────────── */
    const diagnosis: Record<string, any> = {};
    async function check(key: string, fn: () => Promise<any>) {
      try { diagnosis[key] = await fn(); } catch (e: any) { diagnosis[key] = "ERR: " + String(e?.message || e).slice(0, 120); }
    }

    await check("workspace_task_transfers_exists", async () => {
      const r: any = await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM information_schema.tables WHERE table_name = 'workspace_task_transfers'`);
      return (pickRows(r)[0]?.cnt || 0) > 0;
    });
    await check("service_rnr_exists", async () => {
      const r: any = await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM information_schema.tables WHERE table_name = 'service_rnr'`);
      return (pickRows(r)[0]?.cnt || 0) > 0;
    });
    await check("workspace_task_watchers_exists", async () => {
      const r: any = await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM information_schema.tables WHERE table_name = 'workspace_task_watchers'`);
      return (pickRows(r)[0]?.cnt || 0) > 0;
    });
    await check("workspace_task_mentions_exists", async () => {
      const r: any = await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM information_schema.tables WHERE table_name = 'workspace_task_mentions'`);
      return (pickRows(r)[0]?.cnt || 0) > 0;
    });
    await check("workspace_memos_show_in_calendar", async () => {
      const r: any = await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM information_schema.columns WHERE table_name='workspace_memos' AND column_name='show_in_calendar'`);
      return (pickRows(r)[0]?.cnt || 0) > 0;
    });
    await check("incident_reports_assigned_to", async () => {
      const r: any = await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM information_schema.columns WHERE table_name='incident_reports' AND column_name='assigned_to'`);
      return (pickRows(r)[0]?.cnt || 0) > 0;
    });
    await check("harassment_reports_assigned_to", async () => {
      const r: any = await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM information_schema.columns WHERE table_name='harassment_reports' AND column_name='assigned_to'`);
      return (pickRows(r)[0]?.cnt || 0) > 0;
    });
    await check("legal_consultations_assigned_to", async () => {
      const r: any = await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM information_schema.columns WHERE table_name='legal_consultations' AND column_name='assigned_to'`);
      return (pickRows(r)[0]?.cnt || 0) > 0;
    });
    await check("support_requests_sla_due_at", async () => {
      const r: any = await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM information_schema.columns WHERE table_name='support_requests' AND column_name='sla_due_at'`);
      return (pickRows(r)[0]?.cnt || 0) > 0;
    });
    await check("workspace_task_templates_count", async () => {
      const r: any = await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM workspace_task_templates`);
      return pickRows(r)[0]?.cnt ?? 0;
    });

    return new Response(
      JSON.stringify({
        ok: true,
        mode: isRun ? "rolled_back" : "diagnostic",
        steps,
        diagnosis,
        nextAction: isRun
          ? "AI에게 결과 알리면 본 함수 파일 삭제 + 커밋 진행 (1회용 보안 원칙)"
          : "롤백하려면 super_admin 로그인 후 ?run=1 으로 호출",
        expectAfterRollback: {
          workspace_task_transfers_exists: false,
          service_rnr_exists: false,
          workspace_task_watchers_exists: false,
          workspace_task_mentions_exists: false,
          workspace_memos_show_in_calendar: false,
          incident_reports_assigned_to: false,
          harassment_reports_assigned_to: false,
          legal_consultations_assigned_to: false,
          support_requests_sla_due_at: false,
          workspace_task_templates_count: "기존 행 수 (v2 시드 10개 빠진 값)",
        },
      }, null, 2),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "롤백 마이그레이션 실패",
        failedStep: steps[steps.length - 1]?.step,
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
        completedSteps: steps,
      }, null, 2),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
};
