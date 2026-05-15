// netlify/functions/migrate-fix-operator-active.ts
//
// 1회용 보안 마이그레이션 (2026-05-16)
//
// 배경: members.operator_active 컬럼 default가 true로 박혀 있어, 일반 회원 가입
//       기능이 추가된 후에도 신규 가입자가 자동으로 운영자 권한을 받음.
//       헤더에 '관리자 모드' 버튼이 노출되고 관리자 화면 진입 가능(데이터는 권한
//       체크로 차단되나 UI 노출 자체가 보안 위험).
//
// 조치: type='admin' 또는 role 컬럼에 값이 있는 회원(슈퍼 어드민·운영자)만
//       operator_active=true 유지. 그 외 일반 회원은 operator_active=false로
//       일괄 정정.
//
// 호출:
//   GET  /api/migrate-fix-operator-active        → 진단(인증 불필요)
//   GET  /api/migrate-fix-operator-active?run=1  → 실행(어드민 세션 필요)
//
// 호출 후 본 파일은 삭제하고 push.

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-fix-operator-active" };

const JSON_HEADER = { "Content-Type": "application/json" };

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: JSON_HEADER,
  });
}

export default async function handler(req: Request, _ctx: Context) {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  /* 진단 SQL — 현재 상태 카운트 */
  let diagnose: any;
  try {
    const r: any = await db.execute(sql`
      SELECT
        COUNT(*)::int AS total_members,
        COUNT(*) FILTER (WHERE type = 'admin')::int AS admin_count,
        COUNT(*) FILTER (WHERE role IS NOT NULL AND role <> '')::int AS role_assigned_count,
        COUNT(*) FILTER (WHERE operator_active = true)::int AS operator_active_true_count,
        COUNT(*) FILTER (
          WHERE type <> 'admin'
            AND (role IS NULL OR role = '')
            AND operator_active = true
        )::int AS to_fix_count
      FROM members
    `);
    diagnose = (r?.rows ?? r ?? [])[0] ?? {};
  } catch (err: any) {
    return json({
      ok: false,
      step: "diagnose",
      error: String(err?.message || err).slice(0, 500),
    }, 500);
  }

  if (!run) {
    return json({
      ok: true,
      mode: "diagnose",
      message:
        "진단 모드 — 정정 대상 회원 수를 확인. 실행하려면 ?run=1 + 어드민 세션 필요.",
      diagnose,
    });
  }

  /* 실행 — 어드민 세션 필요 */
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  try {
    const r: any = await db.execute(sql`
      UPDATE members
         SET operator_active = false
       WHERE type <> 'admin'
         AND (role IS NULL OR role = '')
         AND operator_active = true
    `);
    /* drizzle-orm/postgres-js 드라이버는 영향 행 수를 count 필드에 담음 */
    const affected =
      (r as any)?.count ??
      (r as any)?.rowCount ??
      0;

    /* 정정 후 재확인 */
    const r2: any = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE operator_active = true)::int AS still_operator_count,
        COUNT(*) FILTER (
          WHERE type <> 'admin'
            AND (role IS NULL OR role = '')
            AND operator_active = true
        )::int AS leftover_count
      FROM members
    `);
    const after = (r2?.rows ?? r2 ?? [])[0] ?? {};

    return json({
      ok: true,
      mode: "executed",
      message: `일반 회원 ${affected}명의 operator_active를 false로 정정 완료.`,
      affected,
      before: diagnose,
      after,
    });
  } catch (err: any) {
    return json({
      ok: false,
      step: "update",
      error: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }, 500);
  }
}
