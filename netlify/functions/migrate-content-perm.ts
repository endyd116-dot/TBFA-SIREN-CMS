/**
 * GET /api/migrate-content-perm        — 진단 (인증 불필요·readonly)
 * GET /api/migrate-content-perm?run=1  — 실행 (어드민 인증)
 *
 * 권한정책관리(role_permissions)에 '콘텐츠 편집' 기능키를 시드해 통합 CMS 탭에 노출한다.
 *   feature_key = 'content_edit', category = 'cms', admin_allowed = true
 * → 슈퍼어드민이 권한정책관리 → 통합 CMS 탭에서 어드민 편집 허용을 켜고 끌 수 있게 됨.
 *
 * (미시드 상태에서도 canAccess가 미등록 키를 admin=true로 처리하므로 어드민 편집은 즉시 가능.
 *  이 시드는 '권한정책관리 화면에서 토글'하기 위한 것.)
 *
 * 멱등: ON CONFLICT (feature_key) DO NOTHING. 호출 성공 후 즉시 파일 삭제 + commit (§6.8).
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-content-perm" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

export default async function handler(req: Request, _ctx: Context) {
  let step = "start";
  try {
    const url = new URL(req.url);
    const run = url.searchParams.get("run") === "1";

    step = "diag";
    const existing: any = await db.execute(sql.raw(`
      SELECT feature_key, category, admin_allowed, operator_allowed
        FROM role_permissions WHERE feature_key = 'content_edit'
    `));
    const rows = existing?.rows ?? existing ?? [];
    const already = rows.length > 0;

    if (!run) {
      return new Response(jsonKST({
        ok: true, mode: "diagnose",
        content_edit_exists: already,
        current: rows[0] || null,
        hint: already
          ? "이미 등록됨. 재실행해도 안전(ON CONFLICT DO NOTHING)."
          : "?run=1 로 실행하면 권한정책관리 통합 CMS 탭에 '콘텐츠 편집'이 추가됩니다.",
      }, null, 2), { headers: JSON_HEADER });
    }

    step = "auth";
    const auth = await requireAdmin(req);
    if (!auth.ok) return (auth as any).res;

    step = "insert";
    await db.execute(sql.raw(`
      INSERT INTO role_permissions (feature_key, feature_label, category, admin_allowed, operator_allowed)
      VALUES ('content_edit', '콘텐츠·사이트 편집(브랜드·사이트설정·메뉴·연결사이트)', 'cms', true, false)
      ON CONFLICT (feature_key) DO NOTHING
    `));

    return new Response(jsonKST({
      ok: true, mode: "executed",
      inserted: !already,
      hint: "권한정책관리 → 통합 CMS 탭에 '콘텐츠 편집'이 노출됩니다. 어드민은 기본 허용. 성공 확인 후 이 파일 삭제 + commit.",
    }, null, 2), { headers: JSON_HEADER });
  } catch (err: any) {
    return new Response(jsonKST({
      ok: false, error: "마이그 실패", step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: JSON_HEADER });
  }
}
