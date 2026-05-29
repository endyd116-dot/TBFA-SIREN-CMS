// netlify/functions/migrate-siren-rejected-reason.ts
// AD-048: SIREN 3종 신고(사건·괴롭힘·법률)에 rejected_reason 컬럼 추가.
//   - 사용자 신고 추적 타임라인(my-reports.js)이 report.rejectedReason를 표시하려 하나
//     컬럼이 없어 항상 공란이었음.
//   - 멱등(ADD COLUMN IF NOT EXISTS). 호출 후 즉시 파일 삭제(1회용 보안 원칙).
//
// 실행: 어드민 로그인 후 주소창에 https://tbfa.co.kr/api/migrate-siren-rejected-reason?run=1
//   - GET (기본): 진단(인증 불필요)
//   - GET ?run=1 : requireAdmin 후 실제 실행
//
// ※ 적용 후 후속(메인): admin-*-report-detail.ts의 반려 처리에서 rejected_reason 컬럼에도
//   사유 저장(현재는 report_status_logs.note에 저장됨 — AD-014). 또는 my-reports가
//   report_status_logs를 읽도록 전환. (둘 중 택1 — 메인 결정)

import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-siren-rejected-reason" };

export default async (req: Request) => {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  if (!run) {
    return new Response(JSON.stringify({
      ok: true,
      mode: "diag",
      message: "AD-048: incident_reports·harassment_reports·legal_consultations에 rejected_reason(text) 추가. 실행하려면 어드민 로그인 후 ?run=1.",
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  try {
    await db.execute(sql`ALTER TABLE incident_reports     ADD COLUMN IF NOT EXISTS rejected_reason text`);
    await db.execute(sql`ALTER TABLE harassment_reports   ADD COLUMN IF NOT EXISTS rejected_reason text`);
    await db.execute(sql`ALTER TABLE legal_consultations  ADD COLUMN IF NOT EXISTS rejected_reason text`);
    return new Response(JSON.stringify({
      ok: true,
      message: "rejected_reason 컬럼 추가 완료 (incident_reports·harassment_reports·legal_consultations). 호출 성공 후 이 파일을 삭제하세요.",
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false, error: "마이그레이션 실패", step: "alter",
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};
