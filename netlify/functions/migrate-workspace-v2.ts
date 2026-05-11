// netlify/functions/migrate-workspace-v2.ts
// ★ 2026-05-11 워크스페이스 재설계 v2 (1회용 마이그레이션)
//
// 추가/변경 항목
//   ① workspace_task_transfers (신규)         — 토스/할당 이력 통합
//   ② workspace_memos 컬럼 4종 (확장)          — show_in_calendar/start_at/end_at/mirrored_event_id
//   ③ service_rnr (신규 + 기본 시드 7종)       — 서비스별 기본/백업 담당자 매핑 + SLA
//   ④ workspace_task_watchers (신규)           — 카드 관전자
//   ⑤ workspace_task_mentions (신규)           — 댓글/카드 멘션
//   ⑥ 서비스 테이블 assigned_to + assigned_at + sla_due_at 추가
//       (incident_reports, harassment_reports, legal_consultations)
//       support_requests 는 기존 assigned_member_id 활용 (sla_due_at만 추가)
//   ⑦ workspace_task_templates 시드 10종 (NPO 운영 컨텍스트)
//
// 호출
//   진단: GET  /api/migrate-workspace-v2          (인증 불필요, 현재 상태 점검)
//   실행: GET  /api/migrate-workspace-v2?run=1    (super_admin 로그인 필요)
//
// 호출 성공 후 절차
//   1) 본 함수 호출 결과(steps + diagnosis) 확인
//   2) AI에게 알림 → schema.ts 정의 append + 본 함수 파일 삭제 + 커밋

import { requireAdmin } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";
import { db } from "../../db";

export const config = { path: "/api/migrate-workspace-v2" };

function pickRows(r: any): any[] {
  return Array.isArray(r) ? r : (r?.rows || []);
}

export default async (req: Request) => {
  const url = new URL(req.url);
  const isRun = url.searchParams.get("run") === "1";

  /* run 모드는 super_admin 권한 필요 */
  if (isRun) {
    const guard: any = await requireAdmin(req);
    if (!guard.ok) {
      return (guard as { ok: false; res: Response }).res;
    }
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
      /* ─────────── ① workspace_task_transfers ─────────── */
      await step("create_table:workspace_task_transfers", async () => {
        await db.execute(sql`
          CREATE TABLE IF NOT EXISTS workspace_task_transfers (
            id SERIAL PRIMARY KEY,
            task_id INTEGER NOT NULL REFERENCES workspace_tasks(id) ON DELETE CASCADE,
            from_member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
            to_member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
            message TEXT,
            transfer_type VARCHAR(30) NOT NULL DEFAULT 'manual',
            snapshot_progress INTEGER,
            snapshot_status VARCHAR(20),
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
          )
        `);
        await db.execute(sql`CREATE INDEX IF NOT EXISTS workspace_task_transfers_task_idx ON workspace_task_transfers(task_id)`);
        await db.execute(sql`CREATE INDEX IF NOT EXISTS workspace_task_transfers_from_idx ON workspace_task_transfers(from_member_id)`);
        await db.execute(sql`CREATE INDEX IF NOT EXISTS workspace_task_transfers_to_idx ON workspace_task_transfers(to_member_id)`);
        await db.execute(sql`CREATE INDEX IF NOT EXISTS workspace_task_transfers_created_idx ON workspace_task_transfers(created_at)`);
      });

      /* ─────────── ② workspace_memos 컬럼 4종 ─────────── */
      await step("alter_table:workspace_memos columns", async () => {
        await db.execute(sql`ALTER TABLE workspace_memos ADD COLUMN IF NOT EXISTS show_in_calendar BOOLEAN NOT NULL DEFAULT FALSE`);
        await db.execute(sql`ALTER TABLE workspace_memos ADD COLUMN IF NOT EXISTS start_at TIMESTAMP`);
        await db.execute(sql`ALTER TABLE workspace_memos ADD COLUMN IF NOT EXISTS end_at TIMESTAMP`);
        await db.execute(sql`ALTER TABLE workspace_memos ADD COLUMN IF NOT EXISTS mirrored_event_id INTEGER REFERENCES workspace_events(id) ON DELETE SET NULL`);
        await db.execute(sql`CREATE INDEX IF NOT EXISTS workspace_memos_calendar_idx ON workspace_memos(show_in_calendar, start_at)`);
      });

      /* ─────────── ③ service_rnr (운영자만 매핑) + 기본 시드 7종 ─────────── */
      await step("create_table:service_rnr", async () => {
        await db.execute(sql`
          CREATE TABLE IF NOT EXISTS service_rnr (
            id SERIAL PRIMARY KEY,
            service_type VARCHAR(50) NOT NULL UNIQUE,
            service_label VARCHAR(100) NOT NULL,
            primary_assignee_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
            backup_assignee_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
            sla_hours INTEGER,
            updated_by INTEGER REFERENCES members(id) ON DELETE SET NULL,
            updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
          )
        `);
        await db.execute(sql`CREATE INDEX IF NOT EXISTS service_rnr_type_idx ON service_rnr(service_type)`);
      });

      await step("seed:service_rnr 7 default rows", async () => {
        /* 담당자는 미지정 (어드민이 운영자 관리 → "업무별 R&R" 탭에서 지정) */
        await db.execute(sql`
          INSERT INTO service_rnr (service_type, service_label, sla_hours) VALUES
            ('incident_report',     '🚨 SIREN — 사건 제보',     24),
            ('harassment_report',   '⚠️ SIREN — 악성민원',       48),
            ('legal_consultation',  '⚖️ SIREN — 법률 상담',      72),
            ('support_request',     '🎗 유족지원 신청',          168),
            ('donation_inquiry',    '💝 후원 문의',              48),
            ('member_signup',       '👤 회원 가입 검토',         72),
            ('expert_application',  '🎓 전문가 신청 검토',       168)
          ON CONFLICT (service_type) DO NOTHING
        `);
      });

      /* ─────────── ④ workspace_task_watchers ─────────── */
      await step("create_table:workspace_task_watchers", async () => {
        await db.execute(sql`
          CREATE TABLE IF NOT EXISTS workspace_task_watchers (
            id SERIAL PRIMARY KEY,
            task_id INTEGER NOT NULL REFERENCES workspace_tasks(id) ON DELETE CASCADE,
            member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            UNIQUE (task_id, member_id)
          )
        `);
        await db.execute(sql`CREATE INDEX IF NOT EXISTS workspace_task_watchers_member_idx ON workspace_task_watchers(member_id)`);
      });

      /* ─────────── ⑤ workspace_task_mentions ─────────── */
      await step("create_table:workspace_task_mentions", async () => {
        await db.execute(sql`
          CREATE TABLE IF NOT EXISTS workspace_task_mentions (
            id SERIAL PRIMARY KEY,
            task_id INTEGER REFERENCES workspace_tasks(id) ON DELETE CASCADE,
            comment_id INTEGER,
            mentioned_member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
            mentioned_by INTEGER REFERENCES members(id) ON DELETE SET NULL,
            read_at TIMESTAMP,
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
          )
        `);
        await db.execute(sql`CREATE INDEX IF NOT EXISTS workspace_task_mentions_member_idx ON workspace_task_mentions(mentioned_member_id, read_at)`);
        await db.execute(sql`CREATE INDEX IF NOT EXISTS workspace_task_mentions_task_idx ON workspace_task_mentions(task_id)`);
      });

      /* ─────────── ⑥ 서비스 테이블 담당자/SLA 컬럼 ─────────── */
      await step("alter_table:incident_reports assigned_to+sla", async () => {
        await db.execute(sql`ALTER TABLE incident_reports ADD COLUMN IF NOT EXISTS assigned_to INTEGER REFERENCES members(id) ON DELETE SET NULL`);
        await db.execute(sql`ALTER TABLE incident_reports ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP`);
        await db.execute(sql`ALTER TABLE incident_reports ADD COLUMN IF NOT EXISTS sla_due_at TIMESTAMP`);
        await db.execute(sql`ALTER TABLE incident_reports ADD COLUMN IF NOT EXISTS workspace_task_id INTEGER REFERENCES workspace_tasks(id) ON DELETE SET NULL`);
        await db.execute(sql`CREATE INDEX IF NOT EXISTS incident_reports_assigned_to_idx ON incident_reports(assigned_to)`);
        await db.execute(sql`CREATE INDEX IF NOT EXISTS incident_reports_sla_idx ON incident_reports(sla_due_at)`);
      });

      await step("alter_table:harassment_reports assigned_to+sla", async () => {
        await db.execute(sql`ALTER TABLE harassment_reports ADD COLUMN IF NOT EXISTS assigned_to INTEGER REFERENCES members(id) ON DELETE SET NULL`);
        await db.execute(sql`ALTER TABLE harassment_reports ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP`);
        await db.execute(sql`ALTER TABLE harassment_reports ADD COLUMN IF NOT EXISTS sla_due_at TIMESTAMP`);
        await db.execute(sql`ALTER TABLE harassment_reports ADD COLUMN IF NOT EXISTS workspace_task_id INTEGER REFERENCES workspace_tasks(id) ON DELETE SET NULL`);
        await db.execute(sql`CREATE INDEX IF NOT EXISTS harassment_reports_assigned_to_idx ON harassment_reports(assigned_to)`);
        await db.execute(sql`CREATE INDEX IF NOT EXISTS harassment_reports_sla_idx ON harassment_reports(sla_due_at)`);
      });

      await step("alter_table:legal_consultations assigned_to+sla", async () => {
        await db.execute(sql`ALTER TABLE legal_consultations ADD COLUMN IF NOT EXISTS assigned_to INTEGER REFERENCES members(id) ON DELETE SET NULL`);
        await db.execute(sql`ALTER TABLE legal_consultations ADD COLUMN IF NOT EXISTS sla_due_at TIMESTAMP`);
        await db.execute(sql`ALTER TABLE legal_consultations ADD COLUMN IF NOT EXISTS workspace_task_id INTEGER REFERENCES workspace_tasks(id) ON DELETE SET NULL`);
        await db.execute(sql`CREATE INDEX IF NOT EXISTS legal_consultations_assigned_to_idx ON legal_consultations(assigned_to)`);
        await db.execute(sql`CREATE INDEX IF NOT EXISTS legal_consultations_sla_idx ON legal_consultations(sla_due_at)`);
      });

      await step("alter_table:support_requests sla+workspace_task_id", async () => {
        /* support_requests는 assigned_member_id 이미 있음 — sla만 추가 */
        await db.execute(sql`ALTER TABLE support_requests ADD COLUMN IF NOT EXISTS sla_due_at TIMESTAMP`);
        await db.execute(sql`ALTER TABLE support_requests ADD COLUMN IF NOT EXISTS workspace_task_id INTEGER REFERENCES workspace_tasks(id) ON DELETE SET NULL`);
        await db.execute(sql`CREATE INDEX IF NOT EXISTS support_requests_sla_idx ON support_requests(sla_due_at)`);
      });

      /* ─────────── ⑦ workspace_task_templates 시드 10종 ─────────── */
      await step("seed:workspace_task_templates 10 NPO templates", async () => {
        /* 동일 name 중복 INSERT 방지: 기존 name 조회 후 없는 것만 삽입 */
        const existing: any = await db.execute(sql`SELECT name FROM workspace_task_templates`);
        const existingNames = new Set(pickRows(existing).map((r: any) => r.name));

        const templates = [
          {
            name: "📋 월간 운영 보고서 작성",
            description: "매월 말 운영 활동·후원 현황·SIREN 신고 처리 통계를 정리해 이사회/대표에 보고하는 정기 작업.",
            priority: "normal",
            estimatedHours: "4.0",
            subtasks: [
              { text: "이번 달 후원 KPI 집계 (정기·일시·총액)" },
              { text: "SIREN 신고 처리 통계 (접수·완료·평균 처리시간)" },
              { text: "유족지원 진행 현황 정리" },
              { text: "재정 수입/지출 정리" },
              { text: "보고서 초안 작성" },
              { text: "대표/이사회 검토 요청" },
            ],
            tags: ["보고서", "월간"],
          },
          {
            name: "💰 후원금 입금 확인 + 영수증 발급",
            description: "신규 후원금 입금 확인 후 기부금 영수증 PDF 발급 및 후원자에게 이메일 발송.",
            priority: "high",
            estimatedHours: "1.0",
            subtasks: [
              { text: "입금 내역 매칭 (효성/토스/계좌이체)" },
              { text: "회원 정보 확인 (성명·주민번호)" },
              { text: "영수증 PDF 발급" },
              { text: "이메일 발송 및 발송 이력 기록" },
            ],
            tags: ["후원", "영수증"],
          },
          {
            name: "🎗 유족 회원 신규 가입 환영 전화",
            description: "신규 가입한 유족 회원에게 환영 전화 + 협의회 안내 + 필요 시 심리상담 연결.",
            priority: "high",
            estimatedHours: "0.5",
            subtasks: [
              { text: "신규 가입 정보 확인" },
              { text: "환영 전화 (가급적 가입 당일)" },
              { text: "통화 메모 작성 (욕구·필요 지원 파악)" },
              { text: "심리상담 안내 (필요 시)" },
              { text: "후속 follow-up 일정 등록" },
            ],
            tags: ["유족", "환영"],
          },
          {
            name: "🚨 SIREN 신고 1차 검토 (24h 이내)",
            description: "신규 SIREN 신고건 1차 검토 + 심각도 등급 확정 + 담당자 배정 + 신고자에게 접수 안내.",
            priority: "urgent",
            estimatedHours: "1.0",
            subtasks: [
              { text: "신고 내용 정독" },
              { text: "AI 분석 결과(심각도·요약·제안) 검토" },
              { text: "심각도 등급 확정" },
              { text: "담당 운영자 배정 (필요 시 전문가 매칭)" },
              { text: "신고자에게 접수 안내 메시지 발송" },
            ],
            tags: ["SIREN", "1차검토"],
          },
          {
            name: "📨 정기 후원자 감사 인사 발송",
            description: "월간 정기 후원자 대상 감사 메시지/이메일 발송. 캠페인 진척도 공유.",
            priority: "normal",
            estimatedHours: "1.5",
            subtasks: [
              { text: "이달 정기 후원자 명단 추출" },
              { text: "감사 메시지 템플릿 작성/수정" },
              { text: "발송 대상 검토 (수신 거부 회원 제외)" },
              { text: "발송 작업 예약 또는 즉시 발송" },
              { text: "발송 결과 모니터링" },
            ],
            tags: ["후원자", "감사"],
          },
          {
            name: "📅 운영위원회 안건 준비",
            description: "운영위원회 정기 회의 안건 작성 + 자료 PDF 준비 + 위원 사전 배포.",
            priority: "normal",
            estimatedHours: "3.0",
            subtasks: [
              { text: "이전 회의록 검토 (이월 안건 확인)" },
              { text: "이번 회의 안건 수집" },
              { text: "자료 PDF 작성" },
              { text: "위원들에게 사전 배포 (회의 3일 전)" },
              { text: "회의실/온라인 링크 예약" },
            ],
            tags: ["회의", "운영위"],
          },
          {
            name: "🤝 전문가 매칭 follow-up",
            description: "전문가 매칭 완료 건의 진행 상황 확인 + 회원/전문가 양쪽 만족도 점검.",
            priority: "normal",
            estimatedHours: "1.0",
            subtasks: [
              { text: "매칭 카드 목록 확인 (지난 2주 매칭 건)" },
              { text: "회원에게 만족도 문의 (전화/문자)" },
              { text: "전문가에게 진행 상황 문의" },
              { text: "이슈 발생 시 재매칭 또는 추가 지원" },
              { text: "결과 카드에 기록" },
            ],
            tags: ["전문가", "follow-up"],
          },
          {
            name: "📊 캠페인 성과 분석 리포트",
            description: "진행 중/종료된 캠페인의 후원 참여·전환률·SNS 노출 분석.",
            priority: "low",
            estimatedHours: "2.0",
            subtasks: [
              { text: "캠페인별 KPI 추출 (참여자·후원액·전환률)" },
              { text: "전월·전년 동기 대비 비교" },
              { text: "AI 인사이트 검토" },
              { text: "리포트 작성 (시각화 포함)" },
              { text: "관련 부서 공유" },
            ],
            tags: ["캠페인", "분석"],
          },
          {
            name: "🧾 연말정산 영수증 일괄 발급 점검",
            description: "연말정산 시즌 영수증 일괄 발급 + 미발급 건 수동 처리 + 발급 완료 통보.",
            priority: "high",
            estimatedHours: "2.0",
            subtasks: [
              { text: "전년도 후원 총액 집계 (회원별)" },
              { text: "기부금 영수증 자동 일괄 발급" },
              { text: "미발급/오류 건 수동 처리" },
              { text: "발급 완료 통보 이메일 일괄 발송" },
              { text: "감사 로그 기록" },
            ],
            tags: ["연말정산", "영수증"],
          },
          {
            name: "🗂 회원 DB 클렌징 (중복/연락두절)",
            description: "회원 DB의 중복·연락두절 데이터 정리 (분기별 정기 작업).",
            priority: "low",
            estimatedHours: "3.0",
            subtasks: [
              { text: "중복 의심 회원 추출 (이름+전화 같음)" },
              { text: "연락두절 회원 점검 (3개월 이상 무응답·반송)" },
              { text: "통합/탈퇴 처리" },
              { text: "감사 로그 기록" },
              { text: "정리 결과 보고" },
            ],
            tags: ["회원관리", "클렌징"],
          },
        ];

        let inserted = 0;
        for (const t of templates) {
          if (existingNames.has(t.name)) continue;
          await db.execute(sql`
            INSERT INTO workspace_task_templates
              (name, description, priority, estimated_hours, default_subtasks, default_tags, is_shared)
            VALUES (
              ${t.name},
              ${t.description},
              ${t.priority},
              ${t.estimatedHours},
              ${JSON.stringify(t.subtasks)}::jsonb,
              ${JSON.stringify(t.tags)}::jsonb,
              TRUE
            )
          `);
          inserted++;
        }
        steps[steps.length - 1].note = `inserted=${inserted}, skipped=${templates.length - inserted}`;
      });
    }

    /* ────────────── 진단 (run 여부 무관하게 항상 수행) ────────────── */
    const diagnosis: Record<string, any> = {};

    async function check(key: string, fn: () => Promise<any>) {
      try { diagnosis[key] = await fn(); } catch (e: any) { diagnosis[key] = "ERR: " + String(e?.message || e).slice(0, 120); }
    }

    await check("workspace_task_transfers_exists", async () => {
      const r: any = await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM information_schema.tables WHERE table_name = 'workspace_task_transfers'`);
      return (pickRows(r)[0]?.cnt || 0) > 0;
    });
    await check("workspace_memos_show_in_calendar", async () => {
      const r: any = await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM information_schema.columns WHERE table_name='workspace_memos' AND column_name='show_in_calendar'`);
      return (pickRows(r)[0]?.cnt || 0) > 0;
    });
    await check("service_rnr_rows", async () => {
      const r: any = await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM service_rnr`);
      return pickRows(r)[0]?.cnt ?? 0;
    });
    await check("workspace_task_watchers_exists", async () => {
      const r: any = await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM information_schema.tables WHERE table_name = 'workspace_task_watchers'`);
      return (pickRows(r)[0]?.cnt || 0) > 0;
    });
    await check("workspace_task_mentions_exists", async () => {
      const r: any = await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM information_schema.tables WHERE table_name = 'workspace_task_mentions'`);
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
    await check("task_templates_count", async () => {
      const r: any = await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM workspace_task_templates`);
      return pickRows(r)[0]?.cnt ?? 0;
    });

    return new Response(
      JSON.stringify({
        ok: true,
        mode: isRun ? "applied" : "diagnostic",
        steps,
        diagnosis,
        nextAction: isRun
          ? "AI에게 결과 알리면 schema.ts 정의 append + 이 함수 파일 삭제 + 커밋 진행"
          : "적용하려면 super_admin 로그인 후 ?run=1 으로 호출",
      }, null, 2),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "마이그레이션 실패",
        failedStep: steps[steps.length - 1]?.step,
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
        completedSteps: steps,
      }, null, 2),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
};
