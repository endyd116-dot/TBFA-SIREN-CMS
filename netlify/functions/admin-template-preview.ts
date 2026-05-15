// netlify/functions/admin-template-preview.ts
// Phase 10 R1 — 발송 템플릿 변수 치환 미리보기 (DB 저장 없음)

import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { renderTemplate } from "../../lib/template-render";

export const config = { path: "/api/admin-template-preview" };

const JSON_HEADER = { "Content-Type": "application/json" };

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "요청 본문을 파싱할 수 없습니다." }), {
      status: 400,
      headers: JSON_HEADER,
    });
  }

  try {
    const { channel, subject, bodyTemplate, variables = [], overrides = {} } = body;

    if (!bodyTemplate || typeof bodyTemplate !== "string") {
      return new Response(
        JSON.stringify({ ok: false, error: "bodyTemplate이 필요합니다.", step: "validate" }),
        { status: 400, headers: JSON_HEADER },
      );
    }
    if (!Array.isArray(variables)) {
      return new Response(
        JSON.stringify({ ok: false, error: "variables는 배열이어야 합니다.", step: "validate" }),
        { status: 400, headers: JSON_HEADER },
      );
    }

    /* sample → data 기본값 구성, overrides로 덮어쓰기 */
    const data: Record<string, string> = {};
    for (const v of variables) {
      if (v.key && v.sample !== undefined) data[v.key] = String(v.sample);
    }
    Object.assign(data, overrides);

    /* 미리보기 — 실제 회원 데이터에 없는 변수는 sample 예시값으로 표시 */
    const subjectResult =
      subject
        ? renderTemplate(String(subject), variables, data, { useSampleFallback: true })
        : { rendered: "", warnings: [] };

    /* 본문 치환 */
    const bodyResult = renderTemplate(bodyTemplate, variables, data, { useSampleFallback: true });

    const warnings = [...subjectResult.warnings, ...bodyResult.warnings];

    return new Response(
      JSON.stringify({
        ok: true,
        preview: {
          subject: channel === "email" || channel === "inapp" ? subjectResult.rendered : null,
          body:    bodyResult.rendered,
        },
        warnings,
      }),
      { status: 200, headers: JSON_HEADER },
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false, error: "미리보기 실패", step: "render",
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }),
      { status: 500, headers: JSON_HEADER },
    );
  }
}
