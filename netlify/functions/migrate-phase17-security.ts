/**
 * Phase 17 보안·감사 강화 — DB 마이그레이션
 * GET ?run=1 : 어드민 인증 후 실행
 * GET (기본) : 진단 모드 (인증 불필요)
 * 호출 후 즉시 삭제할 것 (1회용)
 */
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-phase17-security" };

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  // 진단 모드 (인증 불필요)
  if (!run) {
    return new Response(JSON.stringify({
      ok: true,
      mode: "diagnosis",
      message: "Phase 17 마이그레이션 진단 모드. ?run=1 을 추가하면 어드민 인증 후 실행합니다.",
      changes: [
        "audit_logs: session_id VARCHAR(64) 컬럼 추가 (nullable)",
        "audit_logs: risk_level VARCHAR(20) 컬럼 추가 (nullable)",
        "members: login_fail_streak INTEGER NOT NULL DEFAULT 0 컬럼 추가",
      ],
    }), { headers: { "Content-Type": "application/json" } });
  }

  // 실행 모드 — 어드민 인증 필요
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const results: string[] = [];
  const errors: string[] = [];

  // 1) audit_logs.session_id
  try {
    await db.execute(sql`
      ALTER TABLE audit_logs
      ADD COLUMN IF NOT EXISTS session_id VARCHAR(64)
    `);
    results.push("audit_logs.session_id 추가 완료");
  } catch (err: any) {
    errors.push(`audit_logs.session_id 실패: ${err?.message}`);
  }

  // 2) audit_logs.risk_level
  try {
    await db.execute(sql`
      ALTER TABLE audit_logs
      ADD COLUMN IF NOT EXISTS risk_level VARCHAR(20)
    `);
    results.push("audit_logs.risk_level 추가 완료");
  } catch (err: any) {
    errors.push(`audit_logs.risk_level 실패: ${err?.message}`);
  }

  // 3) members.login_fail_streak
  try {
    await db.execute(sql`
      ALTER TABLE members
      ADD COLUMN IF NOT EXISTS login_fail_streak INTEGER NOT NULL DEFAULT 0
    `);
    results.push("members.login_fail_streak 추가 완료");
  } catch (err: any) {
    errors.push(`members.login_fail_streak 실패: ${err?.message}`);
  }

  const success = errors.length === 0;
  return new Response(JSON.stringify({
    ok: success,
    results,
    errors,
    message: success
      ? "Phase 17 마이그레이션 완료. 이 파일을 즉시 삭제하고 커밋하세요."
      : "일부 마이그레이션 실패. errors 배열 확인",
  }), { status: success ? 200 : 500, headers: { "Content-Type": "application/json" } });
}
