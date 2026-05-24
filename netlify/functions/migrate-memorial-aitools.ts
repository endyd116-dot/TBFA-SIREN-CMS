import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-memorial-aitools" };

/* 1회용: 추모관 AI 읽기 도구 3종을 ai_tool_permissions 권한 매트릭스에 등록.
 * (memorial_summary·memorial_teachers_list·family_stories_list — 읽기 전용·공개) */

function json(obj: any, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { "Content-Type": "application/json" },
  });
}

export default async function handler(req: Request, _ctx: Context) {
  const url = new URL(req.url);
  if (!url.searchParams.has("run")) {
    return json({ ok: true, mode: "diagnostic", message: "?run=1 로 실행 (어드민 인증 필요)" });
  }
  const guard: any = await requireAdmin(req);
  if (!guard.ok) return (guard as { ok: false; res: Response }).res;

  try {
    const tools = [
      { name: "memorial_summary",       desc: "온라인 추모관 통합 통계(선생님·헌화·메시지·편지)" },
      { name: "memorial_teachers_list", desc: "추모관 공개 선생님 목록" },
      { name: "family_stories_list",    desc: "유가족 이야기 영상 발행 목록" },
    ];
    let inserted = 0;
    for (const t of tools) {
      const r: any = await db.execute(sql`
        INSERT INTO ai_tool_permissions (tool_name, enabled, required_role, description, is_mutation, category, updated_at)
        VALUES (${t.name}, true, NULL, ${t.desc}, false, 'memorial', NOW())
        ON CONFLICT (tool_name) DO NOTHING`);
      if ((r as any)?.rowCount > 0) inserted++;
    }
    return json({ ok: true, mode: "run", inserted });
  } catch (err: any) {
    return json({
      ok: false, error: "AI 도구 권한 시드 실패", step: "seed",
      detail: String(err?.message || err).slice(0, 500),
    }, 500);
  }
}
