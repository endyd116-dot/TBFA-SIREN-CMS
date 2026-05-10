/**
 * GET /api/migrate-phase4-report
 *
 * Phase 4 대표 보고 시스템 — report_snapshots 테이블 신설 (1회용 마이그)
 *
 * GET ?run=1  : requireAdmin 인증 후 실제 실행
 * GET         : 진단 모드 (인증 불필요 — 현재 테이블 존재 여부만 확인)
 *
 * 호출 성공 후 즉시 이 파일 삭제 + 커밋 (CLAUDE.md §6.8 1회용 원칙)
 */

import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  /* 진단 모드 */
  if (!run) {
    const check = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'report_snapshots'
      ) AS exists
    `);
    const exists = (check as any)[0]?.exists ?? (check as any).rows?.[0]?.exists ?? false;
    return new Response(
      JSON.stringify({
        mode: "diagnose",
        report_snapshots_exists: exists,
        hint: exists
          ? "이미 마이그 완료됨 — ?run=1 불필요"
          : "?run=1 로 재호출하면 어드민 인증 후 생성",
      }),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  /* 실행 모드 — 어드민 인증 */
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  const results: Record<string, string> = {};

  /* 1. report_snapshots 테이블 */
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS report_snapshots (
        id              serial PRIMARY KEY,
        report_type     varchar(20)  NOT NULL DEFAULT 'weekly',
        period_start    timestamp    NOT NULL,
        period_end      timestamp    NOT NULL,
        stats           jsonb        NOT NULL DEFAULT '{}',
        ai_summary      text,
        ai_alerts       jsonb                 DEFAULT '[]',
        generated_by    int REFERENCES members(id) ON DELETE SET NULL,
        sent_email_at   timestamp,
        sent_to         jsonb                 DEFAULT '[]',
        created_at      timestamp    NOT NULL DEFAULT now()
      )
    `);
    results["create_report_snapshots"] = "ok";
  } catch (err: any) {
    results["create_report_snapshots"] = `error: ${String(err?.message || err).slice(0, 300)}`;
  }

  /* 2. 인덱스 */
  try {
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS report_snapshots_type_period_idx
        ON report_snapshots(report_type, period_start DESC)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS report_snapshots_created_idx
        ON report_snapshots(created_at DESC)
    `);
    results["create_indexes"] = "ok";
  } catch (err: any) {
    results["create_indexes"] = `error: ${String(err?.message || err).slice(0, 300)}`;
  }

  const allOk = Object.values(results).every(v => v === "ok");
  return new Response(
    JSON.stringify({
      ok: allOk,
      message: allOk
        ? "Phase 4 마이그 완료 — report_snapshots 테이블 생성"
        : "일부 단계 실패 — results 확인",
      results,
    }),
    {
      status: allOk ? 200 : 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    },
  );
};

export const config = { path: "/api/migrate-phase4-report" };
