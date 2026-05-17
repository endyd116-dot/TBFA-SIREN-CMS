/**
 * /api/admin-ai-config — Phase B AI 비서 설정 통합 API
 *
 * GET                              : { systemPrompt, tools[22] }
 * POST { systemPrompt }            : 시스템 프롬프트 변경
 * POST { toolName, enabled?, requiredRole? }
 *                                  : 도구 토글 / 권한 변경
 */

import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { requireRole, roleForbidden } from "../../lib/admin-role";
import {
  getSystemPrompt, setSystemPrompt,
  listToolPermissions, updateToolPermission,
} from "../../lib/ai-agent-config";

export const config = { path: "/api/admin-ai-config" };

const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

export default async (req: Request, _ctx: Context) => {
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;
  const adminId = auth.ctx.admin.uid;
  const adminMember = auth.ctx.member;

  if (req.method === "GET") return handleGet();
  if (req.method === "POST") return handlePost(req, adminId, adminMember);

  return new Response(JSON.stringify({ ok: false, error: "GET 또는 POST" }),
    { status: 405, headers: JSON_HEADER });
};

async function handleGet(): Promise<Response> {
  try {
    const [systemPrompt, tools] = await Promise.all([
      getSystemPrompt(), listToolPermissions(),
    ]);
    return new Response(JSON.stringify({
      ok: true, systemPrompt, tools,
    }), { status: 200, headers: JSON_HEADER });
  } catch (err: any) {
    return jsonError("get_config", err);
  }
}

async function handlePost(req: Request, adminId: number, adminMember: { role?: string | null }): Promise<Response> {
  let body: any = {};
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ ok: false, error: "JSON 파싱 실패" }),
      { status: 400, headers: JSON_HEADER });
  }

  /* 1) 시스템 프롬프트 변경 */
  if (typeof body.systemPrompt === "string") {
    const newPrompt = body.systemPrompt.trim();
    if (newPrompt.length < 30) {
      return new Response(JSON.stringify({ ok: false, error: "시스템 프롬프트가 너무 짧습니다 (30자 이상)" }),
        { status: 400, headers: JSON_HEADER });
    }
    if (newPrompt.length > 8000) {
      return new Response(JSON.stringify({ ok: false, error: "시스템 프롬프트가 너무 깁니다 (8,000자 이하)" }),
        { status: 400, headers: JSON_HEADER });
    }
    try {
      await setSystemPrompt(newPrompt, adminId);
      return new Response(JSON.stringify({ ok: true, target: "system_prompt" }),
        { status: 200, headers: JSON_HEADER });
    } catch (err: any) {
      return jsonError("set_prompt", err);
    }
  }

  /* 2) 도구 토글/권한 변경 */
  if (typeof body.toolName === "string") {
    const toolName = String(body.toolName).trim();
    if (!toolName) {
      return new Response(JSON.stringify({ ok: false, error: "toolName 필수" }),
        { status: 400, headers: JSON_HEADER });
    }
    const patch: any = {};
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
    if (body.requiredRole !== undefined) {
      const r = body.requiredRole;
      if (r === null || r === "" || r === "admin" || r === "super_admin") {
        patch.requiredRole = r === "" ? null : r;
      } else {
        return new Response(JSON.stringify({ ok: false, error: "requiredRole은 null|'admin'|'super_admin'" }),
          { status: 400, headers: JSON_HEADER });
      }
    }
    if (Object.keys(patch).length === 0) {
      return new Response(JSON.stringify({ ok: false, error: "변경 항목 없음" }),
        { status: 400, headers: JSON_HEADER });
    }

    /* 슈퍼관리자만 권한 자체를 변경할 수 있게 */
    if (patch.requiredRole !== undefined && !requireRole(adminMember, "super_admin")) {
      return roleForbidden("super_admin");
    }

    try {
      await updateToolPermission(toolName, patch);
      return new Response(JSON.stringify({ ok: true, target: toolName }),
        { status: 200, headers: JSON_HEADER });
    } catch (err: any) {
      return jsonError("update_tool", err);
    }
  }

  return new Response(JSON.stringify({ ok: false, error: "systemPrompt 또는 toolName 필요" }),
    { status: 400, headers: JSON_HEADER });
}

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "AI 비서 설정 변경 실패", step,
    detail: String(err?.message || err).slice(0, 500),
  }), { status: 500, headers: JSON_HEADER });
}
