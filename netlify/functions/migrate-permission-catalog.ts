/**
 * GET /api/migrate-permission-catalog        — 진단 (현재 권한 행 + 김광일 계정 상태)
 * GET /api/migrate-permission-catalog?run=1  — 실행 (super_admin): 카탈로그 upsert
 *
 * 권한설계 동기화: lib/permission-catalog.ts의 전 기능 권한키를 role_permissions에 시드.
 * - 기존 행: admin/operator 토글 보존, 라벨·카테고리만 카탈로그 기준으로 정규화
 * - 신규 행: 카탈로그 기본값(adminDefault/operatorDefault)으로 삽입
 * → 권한정책관리 화면(동적 탭)에서 싸이렌+CMS 전 기능이 한 번에 보이고 토글 가능.
 *
 * 진단 모드는 김광일 국장 콘텐츠 편집 거절 원인 확인용으로 계정 상태(role·활성·담당카테고리)도 리포트.
 * 멱등. 실행 성공 후 이 파일 삭제 (§6.8 1회용).
 */
import type { Context } from "@netlify/functions";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { PERMISSION_CATALOG } from "../../lib/permission-catalog";
import { invalidatePermissionCache } from "../../lib/role-permission-check";

export const config = { path: "/api/migrate-permission-catalog" };
const JH = { "Content-Type": "application/json; charset=utf-8" };

async function rows(q: any): Promise<any[]> { const r: any = await q; return r?.rows ?? r ?? []; }

export default async function handler(req: Request, _ctx: Context) {
  let step = "start";
  try {
    const url = new URL(req.url);
    const run = url.searchParams.get("run") === "1";

    step = "diag_current";
    const current = await rows(db.execute(sql`
      SELECT feature_key, feature_label, category, admin_allowed, operator_allowed
        FROM role_permissions ORDER BY category, feature_key`));

    step = "diag_kim";
    const kim = await rows(db.execute(sql`
      SELECT id, name, email, role, operator_active, status, assigned_categories
        FROM members WHERE type = 'admin' AND name LIKE ${"%김광일%"} LIMIT 5`));

    const existingKeys = new Set(current.map((r: any) => r.feature_key));
    const toInsert = PERMISSION_CATALOG.filter(p => !existingKeys.has(p.key)).map(p => p.key);
    const toUpdate = PERMISSION_CATALOG.filter(p => existingKeys.has(p.key)).map(p => p.key);

    if (!run) {
      return new Response(JSON.stringify({
        ok: true, mode: "diagnose",
        kimGwangIl: kim.length ? kim : "김광일 이름의 관리자 계정을 찾지 못함",
        currentRows: current.length,
        currentByCategory: current.reduce((acc: any, r: any) => { acc[r.category] = (acc[r.category] || 0) + 1; return acc; }, {}),
        willInsert: toInsert,
        willNormalize: toUpdate,
        note: "실행 시 기존 행의 허용/불가 토글은 그대로 두고 라벨·카테고리만 정리합니다.",
        hint: "?run=1 로 실행 (super_admin 인증).",
      }, null, 2), { headers: JH });
    }

    step = "auth";
    const auth = await requireAdmin(req);
    if (guardFailed(auth)) return auth.res;
    if (auth.ctx.member.role !== "super_admin") {
      return new Response(JSON.stringify({ ok: false, error: "super_admin 권한이 필요합니다" }), { status: 403, headers: JH });
    }

    step = "upsert";
    let inserted = 0, normalized = 0;
    for (const p of PERMISSION_CATALOG) {
      const isNew = !existingKeys.has(p.key);
      await db.execute(sql`
        INSERT INTO role_permissions (feature_key, feature_label, category, admin_allowed, operator_allowed, updated_at)
        VALUES (${p.key}, ${p.label}, ${p.category}, ${p.adminDefault}, ${p.operatorDefault}, NOW())
        ON CONFLICT (feature_key) DO UPDATE
           SET feature_label = EXCLUDED.feature_label,
               category      = EXCLUDED.category,
               updated_at    = NOW()`);
      if (isNew) inserted++; else normalized++;
    }
    invalidatePermissionCache();

    step = "done";
    return new Response(JSON.stringify({
      ok: true, mode: "executed",
      inserted, normalized, totalCatalog: PERMISSION_CATALOG.length,
      kimGwangIl: kim.length ? kim : "김광일 이름의 관리자 계정을 찾지 못함",
      hint: "완료. 권한정책관리 화면 새로고침 → 전 기능 카테고리 탭 확인. 다른 함수 인스턴스 캐시는 최대 5분 내 반영. 확인 후 이 파일 삭제.",
    }, null, 2), { headers: JH });
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false, error: "권한 카탈로그 시드 실패", step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: JH });
  }
}
