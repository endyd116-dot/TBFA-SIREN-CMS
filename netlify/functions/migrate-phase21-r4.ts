/**
 * /api/migrate-phase21-r4
 *
 * Phase 21 R4 — 1회용 마이그레이션
 *   1) workspace_memos에 캘린더 미러링 컬럼 3개 추가
 *   2) members에 defaultWbsView 컬럼 추가
 *   3) ws_memos_calendar_idx 인덱스 생성
 *   4) workspace_task_templates 10종 시드
 *
 * GET ?run=1   : super_admin 인증 후 실행
 * GET          : 진단 모드 (인증 불필요)
 *
 * ⚠️ 1회용 — 호출 성공 후 즉시 파일 삭제 + 커밋
 */
import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-phase21-r4" };

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  if (!run) {
    return new Response(JSON.stringify({
      ok: true,
      mode: "diagnostic",
      message: "진단 모드입니다. ?run=1을 추가하면 실행합니다 (super_admin 필요).",
      steps: [
        "1. workspace_memos — event_date / event_time / show_in_calendar 컬럼 추가",
        "2. members — default_wbs_view 컬럼 추가",
        "3. ws_memos_calendar_idx 인덱스 생성",
        "4. workspace_task_templates 10종 시드 (WHERE NOT EXISTS 멱등)",
      ],
    }), { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } });
  }

  /* ── 인증: super_admin 필요 ── */
  const guard = await requireAdmin(req);
  if (!guard.ok) return (guard as { ok: false; res: Response }).res;
  const role = (guard.ctx.member as any).role;
  if (role !== "super_admin") {
    return new Response(JSON.stringify({ ok: false, error: "super_admin만 실행 가능합니다" }),
      { status: 403, headers: { "Content-Type": "application/json; charset=utf-8" } });
  }

  const results: string[] = [];

  try {
    /* Step 1 — workspace_memos 캘린더 컬럼 */
    await db.execute(sql`
      ALTER TABLE workspace_memos
        ADD COLUMN IF NOT EXISTS event_date DATE,
        ADD COLUMN IF NOT EXISTS event_time TIME,
        ADD COLUMN IF NOT EXISTS show_in_calendar BOOLEAN NOT NULL DEFAULT FALSE
    `);
    results.push("✅ workspace_memos 컬럼 추가 완료 (event_date, event_time, show_in_calendar)");

    /* Step 2 — members.default_wbs_view */
    await db.execute(sql`
      ALTER TABLE members
        ADD COLUMN IF NOT EXISTS default_wbs_view VARCHAR(20) DEFAULT 'board'
    `);
    results.push("✅ members.default_wbs_view 컬럼 추가 완료");

    /* Step 3 — 인덱스 */
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS ws_memos_calendar_idx
        ON workspace_memos(show_in_calendar, event_date)
    `);
    results.push("✅ ws_memos_calendar_idx 인덱스 생성 완료");

    /* Step 4 — 템플릿 10종 시드 (name에 UNIQUE 없음 → WHERE NOT EXISTS) */
    await db.execute(sql`
      INSERT INTO workspace_task_templates (name, default_subtasks, default_tags, estimated_hours)
      SELECT v.name, v.subtasks::jsonb, v.tags::jsonb, v.hours
      FROM (VALUES
        ('회원 가입 검증',         '["증빙 자료 확인", "신원 대조", "승인 또는 반려 사유 기록"]', '["회원","검증"]',     2),
        ('후원자 감사 응대',       '["수납 확인", "감사 메일 작성", "발송"]',                       '["후원자","응대"]',   1),
        ('SIREN 신고 1차 검토',   '["신고 내용 정독", "심각도 분류", "담당 배정"]',                 '["신고","검토"]',     3),
        ('법률 상담 매칭',         '["사건 유형 파악", "전문 변호사 추천", "연결 확정"]',           '["법률","매칭"]',     2),
        ('심리상담 매칭',          '["내담자 상태 파악", "상담사 추천", "예약 확정"]',              '["심리","매칭"]',     2),
        ('행사 기획',              '["일정 확정", "장소 섭외", "예산 작성", "참가자 안내"]',         '["행사","기획"]',     8),
        ('자료집 제작',            '["원고 정리", "디자인 의뢰", "교정", "인쇄"]',                   '["자료집","제작"]',  16),
        ('정기 후원자 카드 만료',  '["만료 카드 대상자 목록", "안내 발송", "재등록 확인"]',         '["후원자","카드"]',   2),
        ('CMS+ 이체 결과 확인',   '["실패 목록 추출", "원인 분류", "재청구 또는 응대"]',           '["CMS+","후원"]',     3),
        ('월간 보고서 작성',        '["KPI 집계", "이슈 정리", "다음 달 계획", "검토"]',             '["보고서"]',          4)
      ) AS v(name, subtasks, tags, hours)
      WHERE NOT EXISTS (
        SELECT 1 FROM workspace_task_templates t WHERE t.name = v.name
      )
    `);
    results.push("✅ workspace_task_templates 10종 시드 완료 (WHERE NOT EXISTS 멱등)");

    /* 시드 결과 count 확인 */
    const countRes: any = await db.execute(sql`SELECT COUNT(*) AS cnt FROM workspace_task_templates`);
    const cnt = Number((Array.isArray(countRes) ? countRes[0] : (countRes as any).rows?.[0])?.cnt ?? 0);
    results.push(`📊 workspace_task_templates 현재 총 ${cnt}건 (기대: 11건+)`);

    return new Response(JSON.stringify({
      ok: true,
      message: "Phase 21 R4 마이그레이션 완료",
      results,
      next: "schema.ts에서 R4 컬럼 주석 해제 후 push — 마이그 파일 삭제 필수",
    }), { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } });

  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false,
      error: "마이그레이션 실패",
      partialResults: results,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } });
  }
};
