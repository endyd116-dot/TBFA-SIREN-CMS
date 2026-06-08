/**
 * migrate-sso-perms — role_permissions에 SSO 위성앱 진입 권한 3행 시드 (1회용)
 *
 * 함께워크 ON·SI·마케팅 SSO 진입을 권한정책(role_permissions)으로 토글 관리하기 위한 feature 행 추가.
 * 기본값: admin 허용 / operator 차단 (super_admin은 canAccess에서 항상 허용).
 * category 'sso' → admin-role-policy.html "🔗 SSO 위성앱" 탭에 노출.
 *
 * 호출:
 *   GET  /api/migrate-sso-perms          → 진단(현재 sso 행 조회, 인증 불필요)
 *   GET  /api/migrate-sso-perms?run=1    → 어드민 인증 후 시드 실행(멱등)
 * 성공 후 파일 삭제 + 커밋.
 */
import { db } from "../../db";
import { rolePermissions } from "../../db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-sso-perms" };

const SEED = [
  { featureKey: "sso_on",        featureLabel: "함께워크 ON SSO 진입",     category: "sso", adminAllowed: true, operatorAllowed: false },
  { featureKey: "sso_si",        featureLabel: "함께워크 SI SSO 진입",     category: "sso", adminAllowed: true, operatorAllowed: false },
  { featureKey: "sso_marketing", featureLabel: "함께워크 마케팅 SSO 진입", category: "sso", adminAllowed: true, operatorAllowed: false },
];

function j(body: any, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default async (req: Request) => {
  const run = new URL(req.url).searchParams.get("run") === "1";

  // 진단 모드 (인증 불필요)
  if (!run) {
    try {
      const rows = await db.select().from(rolePermissions).where(eq(rolePermissions.category, "sso"));
      return j({ ok: true, mode: "diagnostic", existing: rows, willSeed: SEED.map((s) => s.featureKey) });
    } catch (err: any) {
      return j({ ok: false, step: "diagnostic_select", detail: String(err?.message || err).slice(0, 500) }, 500);
    }
  }

  // 실행 모드 — 어드민 인증
  const g = await requireAdmin(req);
  if (guardFailed(g)) return g.res;

  try {
    await db.insert(rolePermissions).values(SEED).onConflictDoNothing();
    const rows = await db.select().from(rolePermissions).where(eq(rolePermissions.category, "sso"));
    return j({ ok: true, mode: "run", seeded: SEED.map((s) => s.featureKey), now: rows });
  } catch (err: any) {
    return j({
      ok: false,
      step: "insert",
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 800),
    }, 500);
  }
};
