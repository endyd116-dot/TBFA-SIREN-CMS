// netlify/functions/migrate-fix-operator-default.ts
//
// 1회용 마이그레이션 (2026-05-16)
//
// 배경: 이전 1cb24f1·migrate-fix-operator-active로 옛 60명 일반 회원의
//       operator_active를 false로 정정 + schema.ts default를 false로 변경했지만,
//       schema.ts 변경은 코드만 반영하고 실제 DB 컬럼의 default constraint는
//       그대로 true 상태. 새로 INSERT되는 회원이 operator_active를 명시하지
//       않으면(다른 가입 경로) 여전히 DB default=true 박힘.
//
//       또한 박새로이(M-00005, 가입경로='siren', 가입일 2026-05-03)가 마이그 이후에도
//       관리자 모드 버튼 보임 → operator_active=true 박혀있을 가능성.
//
// 조치 2가지:
//   1) ALTER TABLE members ALTER COLUMN operator_active SET DEFAULT false
//      → DB 수준 default 변경. 미래 INSERT 안전망.
//   2) UPDATE members SET operator_active = false WHERE ... (이전 마이그와 동일)
//      → 박새로이 + 다른 누락 회원 다시 정정.
//
// 호출 (★ 공식 도메인 tbfa.co.kr 사용):
//   GET  https://tbfa.co.kr/api/migrate-fix-operator-default        → 진단
//   GET  https://tbfa.co.kr/api/migrate-fix-operator-default?run=1  → 실행
//
// 호출 후 본 파일은 삭제 + push.

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-fix-operator-default" };

const JSON_HEADER = { "Content-Type": "application/json" };

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: JSON_HEADER });
}

export default async function handler(req: Request, _ctx: Context) {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  /* 진단 — 현재 DB default + 정정 대상 카운트 */
  let diagnose: any;
  try {
    /* 현재 DB 컬럼 default 조회 (information_schema) */
    const defRes: any = await db.execute(sql`
      SELECT column_default
        FROM information_schema.columns
       WHERE table_name = 'members'
         AND column_name = 'operator_active'
    `);
    const defRow = (defRes?.rows ?? defRes ?? [])[0] ?? {};
    const currentDefault = String(defRow.column_default ?? "(없음)");

    /* 정정 대상 회원 카운트 */
    const cntRes: any = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (
          WHERE type <> 'admin'
            AND (role IS NULL OR role = '')
            AND operator_active = true
        )::int AS to_fix_count,
        COUNT(*) FILTER (WHERE operator_active = true)::int AS operator_true_total
      FROM members
    `);
    const cnt = (cntRes?.rows ?? cntRes ?? [])[0] ?? {};

    diagnose = {
      currentColumnDefault: currentDefault,
      toFixCount: Number(cnt.to_fix_count ?? 0),
      operatorTrueTotal: Number(cnt.operator_true_total ?? 0),
    };
  } catch (err: any) {
    return json({ ok: false, step: "diagnose", error: String(err?.message || err).slice(0, 500) }, 500);
  }

  if (!run) {
    return json({
      ok: true,
      mode: "diagnose",
      message: "진단 모드 — ?run=1 + 어드민 세션으로 실행.",
      diagnose,
    });
  }

  /* 실행 — 어드민 세션 */
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  let alterDone = false;
  let updateAffected = 0;

  /* 1단계 — DB 컬럼 default 변경 */
  try {
    await db.execute(sql`
      ALTER TABLE members
        ALTER COLUMN operator_active SET DEFAULT false
    `);
    alterDone = true;
  } catch (err: any) {
    return json({
      ok: false,
      step: "alter_default",
      error: String(err?.message || err).slice(0, 500),
    }, 500);
  }

  /* 2단계 — 정정 대상 회원 일괄 UPDATE */
  try {
    const r: any = await db.execute(sql`
      UPDATE members
         SET operator_active = false
       WHERE type <> 'admin'
         AND (role IS NULL OR role = '')
         AND operator_active = true
    `);
    updateAffected = (r as any)?.count ?? (r as any)?.rowCount ?? 0;
  } catch (err: any) {
    return json({
      ok: false,
      step: "update_members",
      error: String(err?.message || err).slice(0, 500),
      alterDone,
    }, 500);
  }

  /* 정정 후 재확인 */
  let after: any = {};
  try {
    const defRes: any = await db.execute(sql`
      SELECT column_default
        FROM information_schema.columns
       WHERE table_name = 'members' AND column_name = 'operator_active'
    `);
    const defRow = (defRes?.rows ?? defRes ?? [])[0] ?? {};
    const cntRes: any = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (
          WHERE type <> 'admin'
            AND (role IS NULL OR role = '')
            AND operator_active = true
        )::int AS leftover_count,
        COUNT(*) FILTER (WHERE operator_active = true)::int AS operator_true_total
      FROM members
    `);
    const cnt = (cntRes?.rows ?? cntRes ?? [])[0] ?? {};
    after = {
      currentColumnDefault: String(defRow.column_default ?? "(없음)"),
      leftoverCount: Number(cnt.leftover_count ?? 0),
      operatorTrueTotal: Number(cnt.operator_true_total ?? 0),
    };
  } catch (_) {}

  return json({
    ok: true,
    mode: "executed",
    message: `DB default를 false로 변경 + 일반 회원 ${updateAffected}명 추가 정정 완료.`,
    alterDone,
    updateAffected,
    before: diagnose,
    after,
  });
}
