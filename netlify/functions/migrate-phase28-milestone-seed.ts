import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-phase28-milestone-seed" };

// 47개 마일스톤 씨드 데이터
const SEEDS = [
  // ─── 사무국장 (sm) — 매출연동 6개 ───
  { code: "sm-001", name: "신규 정기후원자 유치 (캠페인 외 직접 모집)", category: "REVENUE_LINKED", role: "sm",
    thresholdEnabled: true, thresholdValue: 20, thresholdUnit: "명",
    formula: { type: "FLAT", unitAmount: 60000 }, shared: false, sharedGroup: null },
  { code: "sm-002", name: "장기후원 전환 (캠페인 경유+3개월 유지)", category: "REVENUE_LINKED", role: "sm",
    thresholdEnabled: true, thresholdValue: 5, thresholdUnit: "명",
    formula: { type: "FLAT", unitAmount: 50000 }, shared: false, sharedGroup: null },
  { code: "sm-003", name: "월 평균 정기후원 누적액", category: "REVENUE_LINKED", role: "sm",
    thresholdEnabled: true, thresholdValue: 3000000, thresholdUnit: "원",
    formula: { type: "BRACKET", brackets: [
      { min: 4000000, max: 5999999, amount: 500000 },
      { min: 6000000, max: 7999999, amount: 1000000 },
      { min: 8000000, max: null,    amount: 2000000 },
    ]}, shared: false, sharedGroup: null },
  { code: "sm-004", name: "분기 일시후원금 총액", category: "REVENUE_LINKED", role: "sm",
    thresholdEnabled: true, thresholdValue: 5000000, thresholdUnit: "원",
    formula: { type: "BRACKET", brackets: [
      { min: 10000000, max: 19999999, amount: 1500000 },
      { min: 20000000, max: null,     amount: 4000000 },
    ]}, shared: false, sharedGroup: null },
  { code: "sm-005", name: "캠페인 모금액", category: "REVENUE_LINKED", role: "sm",
    thresholdEnabled: true, thresholdValue: 10000000, thresholdUnit: "원",
    formula: { type: "BRACKET", brackets: [
      { min: 30000000, max: 49999999, amount: 1500000 },
      { min: 50000000, max: null,     amount: 3000000 },
    ]}, shared: false, sharedGroup: null },
  { code: "sm-006", name: "기업·기관 후원 협약 체결", category: "REVENUE_LINKED", role: "sm",
    thresholdEnabled: false, thresholdValue: null, thresholdUnit: null,
    formula: { type: "EVENT_RANGE", minAmount: 500000, maxAmount: 1000000 }, shared: false, sharedGroup: null },

  // ─── 사무국장 (sm) — 비매출 Q1 4개 ───
  { code: "sm-q1-01", name: "사단법인 인가 완료", category: "NON_REVENUE", role: "sm",
    thresholdEnabled: false, thresholdValue: null, thresholdUnit: null,
    formula: { type: "FLAT", unitAmount: 1000000 }, quarterApplicable: "Q1", shared: false, sharedGroup: null },
  { code: "sm-q1-02", name: "신규 유족 회원 30명 등록", category: "NON_REVENUE", role: "sm",
    thresholdEnabled: false, thresholdValue: null, thresholdUnit: null,
    formula: { type: "FLAT", unitAmount: 1000000 }, quarterApplicable: "Q1", shared: false, sharedGroup: null },
  { code: "sm-q1-03", name: "신규 유족 회원 50명 등록", category: "NON_REVENUE", role: "sm",
    thresholdEnabled: false, thresholdValue: null, thresholdUnit: null,
    formula: { type: "FLAT", unitAmount: 2000000 }, quarterApplicable: "Q1", shared: false, sharedGroup: null },
  { code: "sm-q1-04", name: "기업·기관 후원 첫 협약 체결", category: "NON_REVENUE", role: "sm",
    thresholdEnabled: false, thresholdValue: null, thresholdUnit: null,
    formula: { type: "FLAT", unitAmount: 2000000 }, quarterApplicable: "Q1", shared: false, sharedGroup: null },

  // ─── 사무국장 (sm) — 비매출 Q2 4개 ───
  { code: "sm-q2-01", name: "지정기부금단체 지정", category: "NON_REVENUE", role: "sm",
    thresholdEnabled: false, thresholdValue: null, thresholdUnit: null,
    formula: { type: "FLAT", unitAmount: 3000000 }, quarterApplicable: "Q2", shared: false, sharedGroup: null },
  { code: "sm-q2-02", name: "신규 유족 회원 누적 80명 달성", category: "NON_REVENUE", role: "sm",
    thresholdEnabled: false, thresholdValue: null, thresholdUnit: null,
    formula: { type: "FLAT", unitAmount: 2000000 }, quarterApplicable: "Q2", shared: false, sharedGroup: null },
  { code: "sm-q2-03", name: "신규 유족 회원 누적 120명 달성", category: "NON_REVENUE", role: "sm",
    thresholdEnabled: false, thresholdValue: null, thresholdUnit: null,
    formula: { type: "FLAT", unitAmount: 3000000 }, quarterApplicable: "Q2", shared: false, sharedGroup: null },
  { code: "sm-q2-04", name: "기업·기관 후원 협약 누적 3건↑", category: "NON_REVENUE", role: "sm",
    thresholdEnabled: false, thresholdValue: null, thresholdUnit: null,
    formula: { type: "FLAT", unitAmount: 3000000 }, quarterApplicable: "Q2", shared: false, sharedGroup: null },

  // ─── 정책국장 (pm) — 매출연동 10개 ───
  { code: "pm-001", name: "함께워크 ON 분기 매출", category: "REVENUE_LINKED", role: "pm",
    thresholdEnabled: true, thresholdValue: 15000000, thresholdUnit: "원",
    formula: { type: "PERCENT", rate: 0.015 }, shared: false, sharedGroup: null },
  { code: "pm-002", name: "신규 상주 입주사", category: "REVENUE_LINKED", role: "pm",
    thresholdEnabled: true, thresholdValue: 7, thresholdUnit: "팀",
    formula: { type: "FLAT", unitAmount: 40000 }, shared: false, sharedGroup: null },
  { code: "pm-003", name: "신규 비상주 입주사", category: "REVENUE_LINKED", role: "pm",
    thresholdEnabled: true, thresholdValue: 15, thresholdUnit: "팀",
    formula: { type: "FLAT", unitAmount: 20000 }, shared: false, sharedGroup: null },
  { code: "pm-004", name: "유료 세미나·강연 매출", category: "REVENUE_LINKED", role: "pm",
    thresholdEnabled: true, thresholdValue: 5000000, thresholdUnit: "원",
    formula: { type: "PERCENT", rate: 0.04 }, shared: false, sharedGroup: null },
  { code: "pm-005", name: "유족 순직 지원 컨설팅료", category: "REVENUE_LINKED", role: "pm",
    thresholdEnabled: false, thresholdValue: null, thresholdUnit: null,
    formula: { type: "EVENT_RANGE", minAmount: 200000, maxAmount: 1100000 }, shared: false, sharedGroup: null },
  { code: "pm-006", name: "교육청·교육부 외주용역 수주", category: "REVENUE_LINKED", role: "pm",
    thresholdEnabled: false, thresholdValue: null, thresholdUnit: null,
    formula: { type: "PERCENT", rate: 0.012 }, shared: false, sharedGroup: null },
  { code: "pm-007", name: "정책연구지 발간 외주용역", category: "REVENUE_LINKED", role: "pm",
    thresholdEnabled: false, thresholdValue: null, thresholdUnit: null,
    formula: { type: "PERCENT", rate: 0.015 }, shared: false, sharedGroup: null },
  { code: "pm-008", name: "순직심의 지원 외주용역", category: "REVENUE_LINKED", role: "pm",
    thresholdEnabled: false, thresholdValue: null, thresholdUnit: null,
    formula: { type: "PERCENT", rate: 0.015 }, shared: false, sharedGroup: null },
  { code: "pm-009", name: "진상조사 외주용역", category: "REVENUE_LINKED", role: "pm",
    thresholdEnabled: false, thresholdValue: null, thresholdUnit: null,
    formula: { type: "PERCENT", rate: 0.015 }, shared: false, sharedGroup: null },
  { code: "pm-010", name: "1,000원의 행복 캠페인 운영비", category: "REVENUE_LINKED", role: "pm",
    thresholdEnabled: false, thresholdValue: null, thresholdUnit: null,
    formula: { type: "PERCENT", rate: 0.025 }, shared: false, sharedGroup: null },

  // ─── 정책국장 (pm) — 비매출 Q1 7개 ───
  { code: "pm-q1-01", name: "함께워크 ON 입주율 50% 달성", category: "NON_REVENUE", role: "pm",
    thresholdEnabled: false, thresholdValue: null, thresholdUnit: null,
    formula: { type: "FLAT", unitAmount: 800000 }, quarterApplicable: "Q1", shared: false, sharedGroup: null },
  { code: "pm-q1-02", name: "함께워크 ON 입주율 70% 달성", category: "NON_REVENUE", role: "pm",
    thresholdEnabled: false, thresholdValue: null, thresholdUnit: null,
    formula: { type: "FLAT", unitAmount: 1500000 }, quarterApplicable: "Q1", shared: false, sharedGroup: null },
  { code: "pm-q1-03", name: "비상주 입주사 누적 10팀 달성", category: "NON_REVENUE", role: "pm",
    thresholdEnabled: false, thresholdValue: null, thresholdUnit: null,
    formula: { type: "FLAT", unitAmount: 800000 }, quarterApplicable: "Q1", shared: false, sharedGroup: null },
  { code: "pm-q1-04", name: "교육청·교육부 첫 MOU 체결", category: "NON_REVENUE", role: "pm",
    thresholdEnabled: false, thresholdValue: null, thresholdUnit: null,
    formula: { type: "FLAT", unitAmount: 1500000 }, quarterApplicable: "Q1", shared: false, sharedGroup: null },
  { code: "pm-q1-05", name: "순직 인정 사건 승소 (1건)", category: "NON_REVENUE", role: "pm",
    thresholdEnabled: false, thresholdValue: null, thresholdUnit: null,
    formula: { type: "FLAT", unitAmount: 1100000 }, quarterApplicable: "Q1", shared: false, sharedGroup: null },
  { code: "pm-q1-06", name: "1,000원의 행복 협약 체결", category: "NON_REVENUE", role: "pm",
    thresholdEnabled: false, thresholdValue: null, thresholdUnit: null,
    formula: { type: "FLAT", unitAmount: 2300000 }, quarterApplicable: "Q1", shared: false, sharedGroup: null },
  { code: "pm-q1-07", name: "주요 일간지 1면·메인 방송 보도", category: "NON_REVENUE", role: "pm",
    thresholdEnabled: false, thresholdValue: null, thresholdUnit: null,
    formula: { type: "FLAT", unitAmount: 800000 }, quarterApplicable: "Q1", shared: false, sharedGroup: null },

  // ─── 정책국장 (pm) — 비매출 Q2 8개 ───
  { code: "pm-q2-01", name: "함께워크 ON 입주율 80% 달성", category: "NON_REVENUE", role: "pm",
    thresholdEnabled: false, thresholdValue: null, thresholdUnit: null,
    formula: { type: "FLAT", unitAmount: 1500000 }, quarterApplicable: "Q2", shared: false, sharedGroup: null },
  { code: "pm-q2-02", name: "비상주 입주사 누적 30팀 달성", category: "NON_REVENUE", role: "pm",
    thresholdEnabled: false, thresholdValue: null, thresholdUnit: null,
    formula: { type: "FLAT", unitAmount: 1100000 }, quarterApplicable: "Q2", shared: false, sharedGroup: null },
  { code: "pm-q2-03", name: "교육부 외주용역 첫 수주", category: "NON_REVENUE", role: "pm",
    thresholdEnabled: false, thresholdValue: null, thresholdUnit: null,
    formula: { type: "FLAT", unitAmount: 3000000 }, quarterApplicable: "Q2", shared: false, sharedGroup: null },
  { code: "pm-q2-04", name: "정책연구지 발간 첫 수주", category: "NON_REVENUE", role: "pm",
    thresholdEnabled: false, thresholdValue: null, thresholdUnit: null,
    formula: { type: "FLAT", unitAmount: 2300000 }, quarterApplicable: "Q2", shared: false, sharedGroup: null },
  { code: "pm-q2-05", name: "순직심의 지원 사업 첫 수주", category: "NON_REVENUE", role: "pm",
    thresholdEnabled: false, thresholdValue: null, thresholdUnit: null,
    formula: { type: "FLAT", unitAmount: 2300000 }, quarterApplicable: "Q2", shared: false, sharedGroup: null },
  { code: "pm-q2-06", name: "순직 인정 사건 승소 (1건당)", category: "NON_REVENUE", role: "pm",
    thresholdEnabled: false, thresholdValue: null, thresholdUnit: null,
    formula: { type: "FLAT", unitAmount: 1500000 }, quarterApplicable: "Q2", shared: false, sharedGroup: null },
  { code: "pm-q2-07", name: "관련 법안 국회 발의", category: "NON_REVENUE", role: "pm",
    thresholdEnabled: false, thresholdValue: null, thresholdUnit: null,
    formula: { type: "FLAT", unitAmount: 1500000 }, quarterApplicable: "Q2", shared: false, sharedGroup: null },
  { code: "pm-q2-08", name: "사회적협동조합 발기인+정관 채택", category: "NON_REVENUE", role: "pm",
    thresholdEnabled: false, thresholdValue: null, thresholdUnit: null,
    formula: { type: "FLAT", unitAmount: 800000 }, quarterApplicable: "Q2", shared: false, sharedGroup: null },

  // ─── SI 영업·사업관리자 (si) — 매출연동 7개 ───
  { code: "si-001", name: "SI 수주 — 중개플랫폼", category: "REVENUE_LINKED", role: "si",
    thresholdEnabled: true, thresholdValue: 30000000, thresholdUnit: "원",
    formula: { type: "PERCENT", rate: 0.04 }, shared: true, sharedGroup: "si-main" },
  { code: "si-002", name: "SI 수주 — 직접 영업", category: "REVENUE_LINKED", role: "si",
    thresholdEnabled: true, thresholdValue: 30000000, thresholdUnit: "원",
    formula: { type: "PERCENT", rate: 0.05 }, shared: true, sharedGroup: "si-main" },
  { code: "si-003", name: "SI 수주 — NPO 협회 영업", category: "REVENUE_LINKED", role: "si",
    thresholdEnabled: true, thresholdValue: 30000000, thresholdUnit: "원",
    formula: { type: "PERCENT", rate: 0.05 }, shared: true, sharedGroup: "si-main" },
  { code: "si-004", name: "자체 AI 솔루션 매출", category: "REVENUE_LINKED", role: "si",
    thresholdEnabled: true, thresholdValue: 5000000, thresholdUnit: "원",
    formula: { type: "PERCENT", rate: 0.05 }, shared: false, sharedGroup: null },
  { code: "si-005", name: "정부과제 수주", category: "REVENUE_LINKED", role: "si",
    thresholdEnabled: false, thresholdValue: null, thresholdUnit: null,
    formula: { type: "PERCENT", rate: 0.01 }, shared: false, sharedGroup: null },
  { code: "si-006", name: "정부용역 수주", category: "REVENUE_LINKED", role: "si",
    thresholdEnabled: false, thresholdValue: null, thresholdUnit: null,
    formula: { type: "PERCENT", rate: 0.01 }, shared: false, sharedGroup: null },
  { code: "si-007", name: "공공입찰 낙찰 가산", category: "REVENUE_LINKED", role: "si",
    thresholdEnabled: false, thresholdValue: null, thresholdUnit: null,
    formula: { type: "PERCENT", rate: 0.01 }, shared: false, sharedGroup: null },

  // ─── SI (si) — 비매출 Q1 6개 ───
  { code: "si-q1-01", name: "첫 SI 프로젝트 계약 체결", category: "NON_REVENUE", role: "si",
    thresholdEnabled: false, thresholdValue: null, thresholdUnit: null,
    formula: { type: "FLAT", unitAmount: 1000000 }, quarterApplicable: "Q1", shared: false, sharedGroup: null },
  { code: "si-q1-02", name: "중개플랫폼 등록+첫 수주", category: "NON_REVENUE", role: "si",
    thresholdEnabled: false, thresholdValue: null, thresholdUnit: null,
    formula: { type: "FLAT", unitAmount: 1000000 }, quarterApplicable: "Q1", shared: false, sharedGroup: null },
  { code: "si-q1-03", name: "누적 수주 5,000만원 달성", category: "NON_REVENUE", role: "si",
    thresholdEnabled: false, thresholdValue: null, thresholdUnit: null,
    formula: { type: "FLAT", unitAmount: 2000000 }, quarterApplicable: "Q1", shared: false, sharedGroup: null },
  { code: "si-q1-04", name: "누적 수주 1억원 달성", category: "NON_REVENUE", role: "si",
    thresholdEnabled: false, thresholdValue: null, thresholdUnit: null,
    formula: { type: "FLAT", unitAmount: 4000000 }, quarterApplicable: "Q1", shared: false, sharedGroup: null },
  { code: "si-q1-05", name: "자체 AI 솔루션 첫 유료 계약 체결", category: "NON_REVENUE", role: "si",
    thresholdEnabled: false, thresholdValue: null, thresholdUnit: null,
    formula: { type: "FLAT", unitAmount: 2500000 }, quarterApplicable: "Q1", shared: false, sharedGroup: null },
  { code: "si-q1-06", name: "NPO 협회 첫 영업 수주", category: "NON_REVENUE", role: "si",
    thresholdEnabled: false, thresholdValue: null, thresholdUnit: null,
    formula: { type: "FLAT", unitAmount: 2000000 }, quarterApplicable: "Q1", shared: false, sharedGroup: null },

  // ─── SI (si) — 비매출 Q2 7개 ───
  { code: "si-q2-01", name: "정부과제 수주 (1건)", category: "NON_REVENUE", role: "si",
    thresholdEnabled: false, thresholdValue: null, thresholdUnit: null,
    formula: { type: "FLAT", unitAmount: 4000000 }, quarterApplicable: "Q2", shared: false, sharedGroup: null },
  { code: "si-q2-02", name: "정부용역 수주 (1건)", category: "NON_REVENUE", role: "si",
    thresholdEnabled: false, thresholdValue: null, thresholdUnit: null,
    formula: { type: "FLAT", unitAmount: 4000000 }, quarterApplicable: "Q2", shared: false, sharedGroup: null },
  { code: "si-q2-03", name: "누적 수주 2억원 달성", category: "NON_REVENUE", role: "si",
    thresholdEnabled: false, thresholdValue: null, thresholdUnit: null,
    formula: { type: "FLAT", unitAmount: 3000000 }, quarterApplicable: "Q2", shared: false, sharedGroup: null },
  { code: "si-q2-04", name: "누적 수주 3억원 달성", category: "NON_REVENUE", role: "si",
    thresholdEnabled: false, thresholdValue: null, thresholdUnit: null,
    formula: { type: "FLAT", unitAmount: 5000000 }, quarterApplicable: "Q2", shared: false, sharedGroup: null },
  { code: "si-q2-05", name: "자체 AI 솔루션 누적 유료 고객 5팀", category: "NON_REVENUE", role: "si",
    thresholdEnabled: false, thresholdValue: null, thresholdUnit: null,
    formula: { type: "FLAT", unitAmount: 3000000 }, quarterApplicable: "Q2", shared: false, sharedGroup: null },
  { code: "si-q2-06", name: "외부 SI 프로젝트 NPS 70+ (서면 추천서)", category: "NON_REVENUE", role: "si",
    thresholdEnabled: false, thresholdValue: null, thresholdUnit: null,
    formula: { type: "FLAT", unitAmount: 1500000 }, quarterApplicable: "Q2", shared: false, sharedGroup: null },
  { code: "si-q2-07", name: "벤처기업 인증 취득", category: "NON_REVENUE", role: "si",
    thresholdEnabled: false, thresholdValue: null, thresholdUnit: null,
    formula: { type: "FLAT", unitAmount: 1000000 }, quarterApplicable: "Q2", shared: false, sharedGroup: null },
] as const;

export default async function handler(req: Request, _ctx: Context) {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  if (!run) {
    return Response.json({
      ok: true,
      mode: "diagnose",
      total: SEEDS.length,
      message: `${SEEDS.length}개 마일스톤 씨드 준비 완료. ?run=1 로 실행하세요.`,
    });
  }

  // ?run=1 — 어드민 인증 후 실행
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  const inserted: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  for (const s of SEEDS) {
    try {
      const formulaJson = JSON.stringify(s.formula);
      const quarterApplicable = (s as any).quarterApplicable ?? null;

      const res = await db.execute(sql`
        INSERT INTO milestone_definitions (
          code, name, category, target_milestone_role,
          threshold_enabled, threshold_value, threshold_unit,
          bonus_formula, quarter_applicable,
          is_shared_threshold, shared_threshold_group,
          is_active, sort_order
        ) VALUES (
          ${s.code}, ${s.name}, ${s.category}, ${s.role},
          ${s.thresholdEnabled}, ${s.thresholdValue ?? null}, ${s.thresholdUnit ?? null},
          ${formulaJson}::jsonb, ${quarterApplicable},
          ${s.shared}, ${s.sharedGroup ?? null},
          true, 0
        )
        ON CONFLICT (code) DO NOTHING
        RETURNING code
      `);
      const returning = (res as any).rows ?? (res as any[]);
      if (returning.length > 0) inserted.push(s.code);
      else skipped.push(s.code);
    } catch (err: any) {
      errors.push(`${s.code}: ${String(err?.message || err).slice(0, 200)}`);
    }
  }

  return Response.json({
    ok: errors.length === 0,
    inserted: inserted.length,
    skipped: skipped.length,
    errors,
    insertedCodes: inserted,
    skippedCodes: skipped,
  });
}
