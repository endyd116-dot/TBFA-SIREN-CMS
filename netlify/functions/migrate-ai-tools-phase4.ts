/**
 * 1회용 마이그 — Phase 4 잠재후원자·자료CUD·예산·정책·채팅 10종 권한 시드
 *
 * GET            : 진단 (인증 불필요)
 * GET ?run=1     : 어드민 인증 후 실행 (멱등 — ON CONFLICT DO NOTHING)
 *
 * 호출 성공 후 → 파일 삭제 + 커밋
 */

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-ai-tools-phase4" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

const TOOLS: Array<[string, boolean, string, string | null, string]> = [
  /* [name, isMutation, category, requiredRole, description] */
  /* 잠재 후원자 */
  ["potential_donors_list",    false, "donations",    null, "잠재 후원자 목록"],
  ["potential_donor_link",     true,  "donations",    null, "잠재 후원자를 정회원과 연결"],
  /* 자료 CUD */
  ["resource_create",          true,  "content",      null, "자료실 자료 신규 등록"],
  ["resource_update",          true,  "content",      null, "자료 수정"],
  ["resource_delete",          true,  "content",      null, "자료 영구 삭제"],
  /* 예산·지출·정책 */
  ["budgets_list",             false, "finance",      null, "예산 목록 (회계연도별)"],
  ["expenditures_list",        false, "finance",      null, "지출 목록 (카테고리·기간 필터)"],
  ["budget_summary",           false, "finance",      null, "회계연도 예산 vs 지출 비교"],
  ["donation_policy_get",      false, "finance",      null, "후원 정책 단건 조회"],
  /* 채팅 */
  ["chat_rooms_list",          false, "support",      null, "채팅방 목록 (미답변 우선)"],
];

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  if (req.method === "GET" && !url.searchParams.get("run")) {
    return new Response(JSON.stringify({ ok: true, mode: "diagnostic",
      adds: TOOLS.map(t => `seed_${t[0]}`),
      callExample: "GET /api/migrate-ai-tools-phase4?run=1 (어드민 로그인 필요)",
    }), { status: 200, headers: JSON_HEADER });
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  const results: { step: string; result: string }[] = [];
  for (const [name, isMutation, category, requiredRole, description] of TOOLS) {
    try {
      await db.execute(sql`
        INSERT INTO ai_tool_permissions
          (tool_name, enabled, required_role, description, is_mutation, category)
        VALUES
          (${name}, TRUE, ${requiredRole}, ${description}, ${isMutation}, ${category})
        ON CONFLICT (tool_name) DO NOTHING
      `);
      results.push({ step: `seed_${name}`, result: "ok" });
    } catch (e: any) {
      results.push({ step: `seed_${name}`, result: String(e?.message).slice(0, 200) });
    }
  }

  return new Response(JSON.stringify({ ok: true, results }, null, 2),
    { status: 200, headers: JSON_HEADER });
};
