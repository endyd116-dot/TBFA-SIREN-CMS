/**
 * migrate-quarter-2026-q2.ts (1회용)
 *
 * 목적: OP-1 — 2026 Q2 분기 등록 (현재 ACTIVE 분기 0개 해소)
 *
 * 현황:
 *   - quarters: 2025 Q1·Q2 SETTLED / 2026 Q3·Q4 UPCOMING / **2026 Q2 부재**
 *   - 오늘(2026-05-19)은 2026 Q2 기간이지만 row가 없어 ACTIVE 분기 0
 *   - 성과 입력·결산 진행 대상 분기가 부재
 *
 * 동작:
 *   - 2026 Q2 INSERT (status='ACTIVE', start_date=2026-04-01, end_date=2026-06-30, settlement_date=2026-07-15)
 *   - 이미 존재하면 status만 ACTIVE로 갱신 (uniqueIdx 충돌 회피)
 *   - 안전: ON CONFLICT (year, quarter) DO UPDATE
 *
 * 호출: 어드민 로그인 후 https://tbfa.co.kr/api/migrate-quarter-2026-q2?run=1
 * 호출 후 즉시 본 파일 삭제 + 커밋.
 */
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-quarter-2026-q2" };

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  if (!run) {
    // 진단 모드 — 인증 불필요
    try {
      const rows = await db.execute(sql`
        SELECT id, year, quarter, status, start_date, end_date, settlement_date
        FROM quarters
        ORDER BY year, quarter
      `);
      return Response.json({
        ok: true,
        mode: "diagnostic",
        existingQuarters: (rows as any).rows ?? rows,
        target: { year: 2026, quarter: 2, status: "ACTIVE",
                  startDate: "2026-04-01", endDate: "2026-06-30", settlementDate: "2026-07-15" },
        hint: "GET ?run=1 (어드민 로그인) 으로 실제 실행",
      });
    } catch (err: any) {
      return Response.json({ ok: false, error: "진단 실패", detail: String(err?.message || err) }, { status: 500 });
    }
  }

  // 실행 모드 — 어드민 인증 필수
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  try {
    const result = await db.execute(sql`
      INSERT INTO quarters (year, quarter, status, start_date, end_date, settlement_date)
      VALUES (2026, 2, 'ACTIVE', '2026-04-01', '2026-06-30', '2026-07-15')
      ON CONFLICT (year, quarter) DO UPDATE
        SET status = 'ACTIVE', updated_at = NOW()
      RETURNING id, year, quarter, status, start_date, end_date
    `);
    const inserted = (result as any).rows ?? result;

    return Response.json({
      ok: true,
      step: "complete",
      row: inserted,
      summary: "2026 Q2 ACTIVE 분기 등록·갱신 완료",
      next: "본 파일 즉시 삭제 + 커밋·푸시. admin-milestone-settings 분기관리 탭에서 확인 가능",
    });
  } catch (err: any) {
    return Response.json({
      ok: false,
      error: "마이그 실행 실패",
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }, { status: 500 });
  }
}
