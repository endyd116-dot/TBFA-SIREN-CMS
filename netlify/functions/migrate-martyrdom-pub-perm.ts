/**
 * migrate-martyrdom-pub-perm — 딥릴리프 발간 권한 항목 시드 (1회용)
 *
 * GET ?run=1  : requireAdmin 인증 후 실행
 * GET         : 진단 (인증 불필요 — 현황만 반환)
 *
 * role_permissions에 발간 쓰기 권한 항목 1개 시드(통합 CMS 탭).
 *   feature_key='martyrdom_publication' / admin 허용 · operator 불가(기본) / super_admin 항상 허용
 *   → 권한 정책 관리 화면에 노출 + admin-martyrdom-publication 쓰기 게이트(canAccess)와 연동.
 * ★ 호출 성공 후 즉시 파일 삭제 + 커밋 (1회용 보안 원칙)
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-martyrdom-pub-perm" };

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "GET") return json({ ok: false, error: "GET만 허용" }, 405);

  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  /* 진단 모드 */
  if (!run) {
    try {
      const r: any = await db.execute(sql.raw(
        `SELECT feature_key AS "featureKey", feature_label AS "featureLabel", category,
                admin_allowed AS "adminAllowed", operator_allowed AS "operatorAllowed"
           FROM role_permissions WHERE feature_key = 'martyrdom_publication' LIMIT 1`
      ));
      const row = (r?.rows ?? r ?? [])[0];
      return json({ ok: true, diag: true, seeded: !!row, row: row ?? null });
    } catch (e: any) {
      return json({ ok: false, diag: true, error: String(e?.message).slice(0, 300) }, 500);
    }
  }

  /* 실행 모드 — requireAdmin */
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const steps: string[] = [];
  try {
    await db.execute(sql.raw(`
      INSERT INTO role_permissions (feature_key, feature_label, category, admin_allowed, operator_allowed, updated_at)
      VALUES ('martyrdom_publication', '딥릴리프 연구 발간 (생성·발간·삭제)', 'cms', true, false, NOW())
      ON CONFLICT (feature_key) DO NOTHING
    `));
    steps.push("role_permissions 시드: martyrdom_publication (cms·admin 허용·operator 불가)");

    const r: any = await db.execute(sql.raw(
      `SELECT feature_key AS "featureKey", admin_allowed AS "adminAllowed", operator_allowed AS "operatorAllowed"
         FROM role_permissions WHERE feature_key = 'martyrdom_publication' LIMIT 1`
    ));
    const row = (r?.rows ?? r ?? [])[0];

    return json({ ok: true, steps, row: row ?? null });
  } catch (e: any) {
    return json({
      ok: false,
      error: "마이그레이션 실패",
      steps,
      detail: String(e?.message || e).slice(0, 500),
      stack: String(e?.stack || "").slice(0, 1000),
    }, 500);
  }
};
