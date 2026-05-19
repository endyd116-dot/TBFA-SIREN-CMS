/**
 * R34-P1-B-4: role_permissions 테이블에 milestone:* 권한 8개 시드 (1회용)
 *
 * GET /api/migrate-milestone-permissions-seed           진단 (인증 불필요)
 * GET /api/migrate-milestone-permissions-seed?run=1     어드민 인증 후 실행
 *
 * Phase 24 §1.3 시드 명세 적용. role_permissions.feature_key UNIQUE → ON CONFLICT DO NOTHING.
 * 호출 성공 후 즉시 파일 삭제 + 커밋.
 */
import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-milestone-permissions-seed" };

const SEEDS: Array<{
  key: string;
  label: string;
  adminAllowed: boolean;
  operatorAllowed: boolean;
}> = [
  { key: "milestone:view",                 label: "성과 관리 조회",            adminAllowed: true,  operatorAllowed: true  },
  { key: "milestone:revenue:input",        label: "매출 실적 입력",            adminAllowed: true,  operatorAllowed: true  },
  { key: "milestone:revenue:verify",       label: "매출 실적 검증",            adminAllowed: true,  operatorAllowed: false },
  { key: "milestone:nonrevenue:manage",    label: "비매출 성과 관리",          adminAllowed: true,  operatorAllowed: false },
  { key: "milestone:settlement:submit",    label: "분기 결산 제출",            adminAllowed: true,  operatorAllowed: false },
  { key: "milestone:manage",               label: "마일스톤 정의 관리",        adminAllowed: false, operatorAllowed: false },
  { key: "milestone:settlement:approve",   label: "분기 결산 승인",            adminAllowed: false, operatorAllowed: false },
  { key: "milestone:quarter:manage",       label: "분기 관리",                 adminAllowed: false, operatorAllowed: false },
];

function jsonError(step: string, err: any) {
  return new Response(
    JSON.stringify({
      ok: false,
      error: "milestone 권한 시드 실패",
      step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }),
    { status: 500, headers: { "Content-Type": "application/json" } }
  );
}

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  /* 진단 모드 */
  if (!run) {
    try {
      const { db } = await import("../../db");
      const { sql } = await import("drizzle-orm");
      const existing = await db.execute(sql`
        SELECT feature_key, feature_label, category, admin_allowed, operator_allowed
        FROM role_permissions
        WHERE feature_key LIKE 'milestone:%'
        ORDER BY feature_key
      `);
      const existingRows = Array.isArray(existing) ? existing : ((existing as any)?.rows ?? []);
      const existingKeys = new Set(existingRows.map((r: any) => r.feature_key));
      const missing = SEEDS.filter(s => !existingKeys.has(s.key));
      return new Response(
        JSON.stringify({
          ok: true,
          mode: "diagnose",
          totalSeeds: SEEDS.length,
          existing: existingRows.length,
          missing: missing.length,
          missingKeys: missing.map(s => s.key),
          existingRows,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } catch (err) {
      return jsonError("diagnose", err);
    }
  }

  /* 실행 모드 — 어드민 인증 필수 */
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  try {
    const { db } = await import("../../db");
    const { sql } = await import("drizzle-orm");

    let inserted = 0;
    let skipped = 0;
    for (const s of SEEDS) {
      const result = await db.execute(sql`
        INSERT INTO role_permissions (feature_key, feature_label, category, admin_allowed, operator_allowed)
        VALUES (${s.key}, ${s.label}, 'milestone', ${s.adminAllowed}, ${s.operatorAllowed})
        ON CONFLICT (feature_key) DO NOTHING
        RETURNING id
      `);
      const rows = (result as any).rows || (result as any[]);
      if (rows && rows.length > 0) inserted++;
      else skipped++;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        message: `milestone:* 권한 시드 완료 (신규 ${inserted}건 / 기존 ${skipped}건)`,
        inserted,
        skipped,
        totalSeeds: SEEDS.length,
        nextSteps: [
          "본 마이그 파일 삭제 + 커밋",
          "admin-role-policy.html 권한 정책 화면에서 milestone 카테고리 토글 확인",
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return jsonError("insert", err);
  }
};
