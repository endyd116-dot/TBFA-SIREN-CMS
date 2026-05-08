/**
 * Phase 3 Step 7-A 1회용 마이그레이션
 *
 * workspace_tasks 테이블에 컬럼 9개 추가 (칸반 5컬럼 + 보류·보관 + 타임트래킹 + 북마크 + AI)
 *
 * 호출:
 *   curl -X POST "https://tbfa-siren-cms.netlify.app/api/migrate-step7-a?key=YOUR_KEY"
 *
 * 키:
 *   환경변수 ADMIN_MIGRATION_KEY > ADMIN_JWT_SECRET > JWT_SECRET 순 폴백.
 *
 * ⚠️ 호출 성공 후 즉시 이 파일을 삭제하고 커밋·푸시해야 합니다 (1회용 보안 원칙).
 *
 * 멱등성:
 *   ALTER TABLE ADD COLUMN IF NOT EXISTS 사용 — 중복 호출해도 안전.
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";

const QUERIES: string[] = [
  `ALTER TABLE workspace_tasks ADD COLUMN IF NOT EXISTS estimated_hours numeric(5,1)`,
  `ALTER TABLE workspace_tasks ADD COLUMN IF NOT EXISTS actual_hours numeric(5,1)`,
  `ALTER TABLE workspace_tasks ADD COLUMN IF NOT EXISTS hold_reason text`,
  `ALTER TABLE workspace_tasks ADD COLUMN IF NOT EXISTS hold_started_at timestamp`,
  `ALTER TABLE workspace_tasks ADD COLUMN IF NOT EXISTS archived_at timestamp`,
  `ALTER TABLE workspace_tasks ADD COLUMN IF NOT EXISTS bookmarked_by jsonb DEFAULT '[]'::jsonb`,
  `ALTER TABLE workspace_tasks ADD COLUMN IF NOT EXISTS ai_summary text`,
  `ALTER TABLE workspace_tasks ADD COLUMN IF NOT EXISTS ai_risk_score integer`,
  `ALTER TABLE workspace_tasks ADD COLUMN IF NOT EXISTS ai_risk_updated_at timestamp`,
];

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ ok: false, error: "POST 만 허용" }),
      { status: 405, headers: { "Content-Type": "application/json" } }
    );
  }

  const expectedKey =
    process.env.ADMIN_MIGRATION_KEY ||
    process.env.ADMIN_JWT_SECRET ||
    process.env.JWT_SECRET ||
    "";

  if (!expectedKey) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "서버에 키 환경변수가 없습니다 (ADMIN_MIGRATION_KEY 또는 ADMIN_JWT_SECRET 또는 JWT_SECRET)",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const givenKey = url.searchParams.get("key") || "";
  if (givenKey !== expectedKey) {
    return new Response(
      JSON.stringify({ ok: false, error: "권한 없음 (key 불일치)" }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }

  const start = Date.now();
  const results: Array<{ sql: string; ok: boolean; error?: string }> = [];

  try {
    for (const q of QUERIES) {
      try {
        await db.execute(sql.raw(q));
        results.push({ sql: q, ok: true });
      } catch (err: any) {
        results.push({ sql: q, ok: false, error: err?.message || String(err) });
      }
    }

    const successCount = results.filter(r => r.ok).length;
    const allOk = successCount === QUERIES.length;

    return new Response(
      JSON.stringify({
        ok: allOk,
        total: QUERIES.length,
        success: successCount,
        failed: QUERIES.length - successCount,
        durationMs: Date.now() - start,
        results,
        nextAction: allOk
          ? "✅ 모두 성공. 즉시 이 파일(netlify/functions/migrate-step7-a.ts)을 삭제하고 커밋·푸시하세요."
          : "⚠️ 일부 실패. results 확인 후 재시도 가능 (멱등성 보장됨).",
      }),
      { status: allOk ? 200 : 207, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ ok: false, error: err?.message || "unknown", results }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};

export const config = { path: "/api/migrate-step7-a" };
