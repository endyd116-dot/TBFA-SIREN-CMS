/**
 * Phase 22-A C 검증용 시드 데이터
 * GET /api/migrate-phase22a-c-seed              → 진단 (인증 불필요)
 * GET /api/migrate-phase22a-c-seed?run=1        → 7건 INSERT (어드민 인증)
 * GET /api/migrate-phase22a-c-seed?cleanup=1    → 시드 데이터 DELETE
 *
 * 마커: description 끝에 '[verify]' 포함 → 정확한 cleanup 가능
 * 호출 후 즉시 삭제할 것 (1회용)
 *
 * 시드 구성 (7건):
 *  1. 강연·교육 — approved (기본 케이스)
 *  2. 정부 지원금 — approved (큰 금액)
 *  3. 함께워크_On — draft (승인 테스트용)
 *  4. 기업 협찬 — approved + 환불 (net 계산)
 *  5. 기타 — rejected (반려 워크플로우)
 *  6. 강연 2025 — approved (연도 필터 테스트)
 *  7. 함께워크_SI — approved (카테고리 다양성)
 */
import type { Context } from "@netlify/functions";
import { neon } from "@neondatabase/serverless";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-phase22a-c-seed" };

export default async function handler(req: Request, ctx: Context) {
  const url       = new URL(req.url);
  const doRun     = url.searchParams.get("run") === "1";
  const doCleanup = url.searchParams.get("cleanup") === "1";
  const sql       = neon(process.env.NETLIFY_DATABASE_URL!);

  // ── 진단 모드 ──────────────────────────────────────────────
  if (!doRun && !doCleanup) {
    const [c] = await sql`
      SELECT COUNT(*) AS n FROM other_revenues
      WHERE description LIKE '%[verify]'`;
    const [t] = await sql`SELECT COUNT(*) AS n FROM other_revenues`;
    return new Response(JSON.stringify({
      ok: true, mode: "diagnostic",
      verifySeedCount: Number(c.n),
      totalRows:       Number(t.n),
      hint: "?run=1 으로 시드 INSERT, ?cleanup=1 로 시드 DELETE",
    }), { headers: { "Content-Type": "application/json" } });
  }

  // ── 인증 ──────────────────────────────────────────────────
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  const adminId = auth.ctx.adminId;

  // ── Cleanup 모드 ──────────────────────────────────────────
  if (doCleanup) {
    const deleted = await sql`
      DELETE FROM other_revenues
      WHERE description LIKE '%[verify]'
      RETURNING id`;
    return new Response(JSON.stringify({
      ok: true, mode: "cleanup",
      deletedCount: deleted.length,
      message: "C 검증 시드 삭제 완료",
    }), { headers: { "Content-Type": "application/json" } });
  }

  // ── Run 모드 ──────────────────────────────────────────────
  // 멱등성: 이미 시드 존재하면 거절 (정확한 7건 유지)
  const [exist] = await sql`
    SELECT COUNT(*) AS n FROM other_revenues
    WHERE description LIKE '%[verify]'`;
  if (Number(exist.n) > 0) {
    return new Response(JSON.stringify({
      ok: false, mode: "skipped",
      reason: `이미 시드 데이터 ${exist.n}건 존재. 재실행 전 ?cleanup=1 호출 필요`,
    }), { status: 409, headers: { "Content-Type": "application/json" } });
  }

  const seeds = [
    { fy:2026, at:"2026-04-15", cat:1, amt:1500000, refund:0,      payer:"○○교육청", desc:"4월 교사 심리지원 강연 [verify]",       status:"approved", rej:null },
    { fy:2026, at:"2026-03-20", cat:2, amt:5000000, refund:0,      payer:"서울시청",   desc:"NPO 운영 지원금 1분기 [verify]",        status:"approved", rej:null },
    { fy:2026, at:"2026-05-01", cat:4, amt:800000,  refund:0,      payer:"김민준",     desc:"5월 자리 대여 [verify]",                 status:"draft",    rej:null },
    { fy:2026, at:"2026-02-10", cat:3, amt:2000000, refund:500000, payer:"○○기업",   desc:"2월 기업협찬 (일부 환불) [verify]",       status:"approved", rej:null },
    { fy:2026, at:"2026-04-25", cat:6, amt:100000,  refund:0,      payer:"익명",       desc:"근거자료 부족 [verify]",                 status:"rejected", rej:"증빙 자료 미제출" },
    { fy:2025, at:"2025-11-15", cat:1, amt:1200000, refund:0,      payer:"○○교육청", desc:"2025 가을 강연 [verify]",                status:"approved", rej:null },
    { fy:2026, at:"2026-04-30", cat:5, amt:3500000, refund:0,      payer:"○○회사",   desc:"AI 시스템 구축 1차 [verify]",            status:"approved", rej:null },
  ];

  const insertedIds: number[] = [];
  try {
    for (const s of seeds) {
      const approvedAt = s.status === "approved" ? new Date() : null;
      const approvedBy = s.status === "approved" ? adminId : null;
      const result = await sql`
        INSERT INTO other_revenues
          (fiscal_year, recognized_at, category_id, amount, refund_amount,
           payer_name, description, status, recorded_by, approved_by,
           approved_at, rejection_reason)
        VALUES
          (${s.fy}, ${s.at}, ${s.cat}, ${s.amt}, ${s.refund},
           ${s.payer}, ${s.desc}, ${s.status}, ${adminId}, ${approvedBy},
           ${approvedAt}, ${s.rej})
        RETURNING id`;
      insertedIds.push(result[0].id);
    }
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false, error: "INSERT 실패",
      insertedSoFar: insertedIds.length,
      detail: String(err?.message || err).slice(0, 500),
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  return new Response(JSON.stringify({
    ok: true, mode: "executed", adminUid: adminId,
    insertedCount: insertedIds.length, ids: insertedIds,
    message: `Phase 22-A C 검증 시드 ${insertedIds.length}건 INSERT 완료.`,
  }), { headers: { "Content-Type": "application/json" } });
}
