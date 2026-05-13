/**
 * migrate-phase22a-ai-perms-rename.ts — BUG-003 fix 1회용 마이그
 *
 * 배경:
 *  - 삭제된 migrate-phase22a-revenue.ts가 시드한 ai_tool_permissions 도구명 6건이
 *    'other_revenue_*' / 'other_revenues_list' 패턴이었으나
 *  - 실제 lib/ai-agent-tools.ts에 등록된 도구명은 'revenue_*' 패턴 (7개)
 *  - 결과: revenue_approve 등 super_admin 권한 entry 부재 → admin이 AI 비서로 매출 승인 가능
 *
 * 호출:
 *  GET /api/migrate-phase22a-ai-perms-rename              → 진단 (인증 불필요)
 *  GET /api/migrate-phase22a-ai-perms-rename?run=1        → 어드민 인증 후 실행
 *
 * 동작:
 *  Step 1: other_revenue_create  → revenue_create
 *          other_revenue_approve → revenue_approve  (required_role='super_admin' 보존)
 *          other_revenue_refund  → revenue_refund
 *          other_revenues_list   → revenue_list      (별도 UPDATE — 's' 포함)
 *  Step 2: revenue_update / revenue_refund 시드 없으면 INSERT (도메인 누락 보완)
 *
 * 멱등 보장 (ON CONFLICT DO NOTHING). 호출 성공 후 즉시 파일 삭제.
 */

import type { Context } from "@netlify/functions";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-phase22a-ai-perms-rename" };

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false,
    error: "마이그레이션 실패",
    step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request, ctx: Context) {
  const url = new URL(req.url);
  const doRun = url.searchParams.get("run") === "1";

  // ── 진단 모드 ──────────────────────────────────────────
  if (!doRun) {
    try {
      const r: any = await db.execute(sql`
        SELECT tool_name, required_role, enabled, category
          FROM ai_tool_permissions
         WHERE tool_name LIKE 'other_revenue%' OR tool_name LIKE 'revenue_%' OR tool_name = 'pl_summary'
         ORDER BY tool_name
      `);
      const rows = r?.rows ?? r ?? [];
      const oldRows = rows.filter((x: any) => String(x.tool_name).startsWith("other_revenue"));
      const newRows = rows.filter((x: any) => !String(x.tool_name).startsWith("other_revenue"));
      return new Response(JSON.stringify({
        ok: true,
        mode: "diagnostic",
        hint: "?run=1 으로 도구명 정렬 + 누락 도구 시드 INSERT",
        oldNameCount: oldRows.length,
        oldNames: oldRows.map((x: any) => x.tool_name),
        newNameCount: newRows.length,
        newNames: newRows.map((x: any) => ({ tool_name: x.tool_name, required_role: x.required_role })),
        expectedAfterRun: [
          "revenue_categories_list", "revenue_list", "revenue_create",
          "revenue_update", "revenue_approve", "revenue_refund", "pl_summary",
        ],
      }), { headers: { "Content-Type": "application/json" } });
    } catch (e: any) { return jsonError("diagnose", e); }
  }

  // ── 인증 ───────────────────────────────────────────────
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  const adminUid = auth.ctx.admin?.uid ?? null;

  let renamedCreate = 0, renamedApprove = 0, renamedRefund = 0, renamedList = 0;
  let inserted: string[] = [];

  try {
    // ── Step 1: 4건 이름 정렬 ─────────────────────────────
    // 단, 새 이름이 이미 존재하면 충돌 회피를 위해 새 이름의 기존 row를 우선 삭제(없을 가능성 높음)
    const renameMap: Array<{ oldName: string; newName: string }> = [
      { oldName: "other_revenue_create",  newName: "revenue_create"  },
      { oldName: "other_revenue_approve", newName: "revenue_approve" },
      { oldName: "other_revenue_refund",  newName: "revenue_refund"  },
      { oldName: "other_revenues_list",   newName: "revenue_list"    },
    ];

    for (const { oldName, newName } of renameMap) {
      try {
        // 새 이름 row가 이미 있으면 옛 이름 row만 삭제 (옛 이름 attribute 우선이 아닌 새 이름 보존)
        const exists: any = await db.execute(sql`
          SELECT 1 FROM ai_tool_permissions WHERE tool_name = ${newName} LIMIT 1
        `);
        const newExists = (exists?.rows ?? exists ?? []).length > 0;

        if (newExists) {
          await db.execute(sql`DELETE FROM ai_tool_permissions WHERE tool_name = ${oldName}`);
        } else {
          const r: any = await db.execute(sql`
            UPDATE ai_tool_permissions
               SET tool_name = ${newName}, updated_at = NOW()
             WHERE tool_name = ${oldName}
            RETURNING tool_name
          `);
          const affected = (r?.rows ?? r ?? []).length;
          if (oldName.endsWith("create"))  renamedCreate  = affected;
          if (oldName.endsWith("approve")) renamedApprove = affected;
          if (oldName.endsWith("refund"))  renamedRefund  = affected;
          if (oldName === "other_revenues_list") renamedList = affected;
        }
      } catch (e) { return jsonError(`rename_${oldName}`, e); }
    }

    // ── Step 2: 누락 도구 시드 INSERT (revenue_update / revenue_refund 안전망) ──
    try {
      const r: any = await db.execute(sql`
        INSERT INTO ai_tool_permissions (tool_name, enabled, required_role, description, is_mutation, category)
        VALUES
          ('revenue_update', true, NULL,          '매출 수정 (draft 상태, 등록자 또는 super_admin)', true,  'finance'),
          ('revenue_refund', true, 'super_admin', '매출 환불 누적 등록 (approved 상태만)',          true,  'finance')
        ON CONFLICT (tool_name) DO NOTHING
        RETURNING tool_name
      `);
      const rows = r?.rows ?? r ?? [];
      inserted = rows.map((x: any) => String(x.tool_name));
    } catch (e) { return jsonError("seed_missing_tools", e); }

    // ── 결과 집계 ─────────────────────────────────────────
    const after: any = await db.execute(sql`
      SELECT tool_name, required_role, enabled, category
        FROM ai_tool_permissions
       WHERE tool_name IN ('revenue_categories_list','revenue_list','revenue_create','revenue_update','revenue_approve','revenue_refund','pl_summary')
       ORDER BY tool_name
    `);
    const finalRows = (after?.rows ?? after ?? []).map((x: any) => ({
      tool_name: x.tool_name,
      required_role: x.required_role,
    }));

    return new Response(JSON.stringify({
      ok: true,
      mode: "executed",
      adminUid,
      renamed: {
        revenue_create:  renamedCreate,
        revenue_approve: renamedApprove,
        revenue_refund:  renamedRefund,
        revenue_list:    renamedList,
      },
      inserted,
      finalPermissions: finalRows,
      nextStep: "메인 채팅에 ok:true 보고 → 메인이 마이그 파일 삭제 + 머지",
    }), { headers: { "Content-Type": "application/json" } });
  } catch (e: any) { return jsonError("unknown", e); }
}
