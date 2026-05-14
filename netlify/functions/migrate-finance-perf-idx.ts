/**
 * migrate-finance-perf-idx.ts — 1회용 마이그레이션 (버그픽스 #13-2)
 *
 * 재정 손익 요약(admin-finance-pl-summary)이 donations 를
 *   COALESCE(hyosung_paid_date, created_at)::date BETWEEN ... AND status = 'completed'/'refunded'
 * 로 집계하는데, 이 표현식에 맞는 인덱스가 없어 donations 풀스캔 → 재정 화면 로딩 지연.
 *
 * 해결: status + COALESCE(hyosung_paid_date, created_at)::date 복합 표현식 인덱스 2개 추가.
 *
 * 호출:
 *   GET  /api/migrate-finance-perf-idx          → 진단 (인증 불필요)
 *   GET  /api/migrate-finance-perf-idx?run=1    → requireAdmin 후 실제 실행 (멱등)
 *
 * 호출 성공 후 이 파일 삭제 + 커밋.
 */
import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-finance-perf-idx" };

const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

export default async function handler(req: Request, _ctx: Context) {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  /* 진단 모드 — 현재 인덱스 존재 여부만 확인 (인증 불필요) */
  if (!run) {
    try {
      const rs: any = await db.execute(sql`
        SELECT indexname FROM pg_indexes
        WHERE tablename = 'donations'
          AND indexname IN (
            'donations_pl_completed_idx',
            'donations_pl_refunded_idx'
          )
      `);
      const rows: any[] = Array.isArray(rs) ? rs : (rs as any).rows || [];
      const existing = rows.map((r) => r.indexname);
      return new Response(
        JSON.stringify({
          ok: true,
          mode: "diagnose",
          targetIndexes: ["donations_pl_completed_idx", "donations_pl_refunded_idx"],
          alreadyExists: existing,
          willCreate: ["donations_pl_completed_idx", "donations_pl_refunded_idx"].filter(
            (n) => !existing.includes(n),
          ),
          hint: "?run=1 로 어드민 세션에서 실행하세요.",
        }),
        { status: 200, headers: JSON_HEADER },
      );
    } catch (err: any) {
      return new Response(
        JSON.stringify({ ok: false, step: "diagnose", detail: String(err?.message || err) }),
        { status: 500, headers: JSON_HEADER },
      );
    }
  }

  /* 실행 모드 — 어드민 인증 필수 */
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  const results: { index: string; status: string }[] = [];

  /* completed 후원 집계용 표현식 인덱스 */
  try {
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS donations_pl_completed_idx
      ON donations ((COALESCE(hyosung_paid_date, created_at)::date))
      WHERE status = 'completed'
    `);
    results.push({ index: "donations_pl_completed_idx", status: "ok" });
  } catch (err: any) {
    results.push({ index: "donations_pl_completed_idx", status: "fail: " + String(err?.message || err) });
  }

  /* refunded 후원 집계용 표현식 인덱스 */
  try {
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS donations_pl_refunded_idx
      ON donations ((COALESCE(hyosung_paid_date, created_at)::date))
      WHERE status = 'refunded'
    `);
    results.push({ index: "donations_pl_refunded_idx", status: "ok" });
  } catch (err: any) {
    results.push({ index: "donations_pl_refunded_idx", status: "fail: " + String(err?.message || err) });
  }

  const allOk = results.every((r) => r.status === "ok");
  return new Response(
    JSON.stringify({ ok: allOk, mode: "run", results }),
    { status: allOk ? 200 : 500, headers: JSON_HEADER },
  );
}
