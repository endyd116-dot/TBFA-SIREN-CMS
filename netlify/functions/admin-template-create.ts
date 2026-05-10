// netlify/functions/admin-template-create.ts
// Phase 10 R1 — 발송 템플릿 신규 생성

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import { findUndefinedVariables } from "../../lib/template-render";

export const config = { path: "/api/admin-template-create" };

const JSON_HEADER = { "Content-Type": "application/json" };

const VALID_CHANNELS = ["email", "sms", "kakao", "inapp"];
const VALID_CATEGORIES = ["newsletter", "announcement", "auto_trigger", "campaign", "system"];

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

  /* 검증 (step=validate) */
  try {
    const { name, channel, category, subject, bodyTemplate, variables } = body;

    if (!name || typeof name !== "string" || name.trim().length === 0 || name.length > 100) {
      return new Response(
        JSON.stringify({ ok: false, error: "템플릿 이름을 입력해 주세요. (1~100자)", step: "validate" }),
        { status: 400, headers: JSON_HEADER },
      );
    }
    if (!VALID_CHANNELS.includes(channel)) {
      return new Response(
        JSON.stringify({ ok: false, error: "채널 값이 올바르지 않습니다.", step: "validate" }),
        { status: 400, headers: JSON_HEADER },
      );
    }
    if (!VALID_CATEGORIES.includes(category)) {
      return new Response(
        JSON.stringify({ ok: false, error: "카테고리 값이 올바르지 않습니다.", step: "validate" }),
        { status: 400, headers: JSON_HEADER },
      );
    }
    if ((channel === "email" || channel === "inapp") && (!subject || !subject.trim())) {
      return new Response(
        JSON.stringify({ ok: false, error: "이메일·인앱 채널은 제목이 필요합니다.", step: "validate" }),
        { status: 400, headers: JSON_HEADER },
      );
    }
    if (!bodyTemplate || typeof bodyTemplate !== "string" || bodyTemplate.trim().length === 0) {
      return new Response(
        JSON.stringify({ ok: false, error: "본문을 입력해 주세요.", step: "validate" }),
        { status: 400, headers: JSON_HEADER },
      );
    }
    if (bodyTemplate.length > 10000) {
      return new Response(
        JSON.stringify({ ok: false, error: "본문은 10,000자 이하여야 합니다.", step: "validate" }),
        { status: 400, headers: JSON_HEADER },
      );
    }
    if (!Array.isArray(variables)) {
      return new Response(
        JSON.stringify({ ok: false, error: "variables는 배열이어야 합니다.", step: "validate" }),
        { status: 400, headers: JSON_HEADER },
      );
    }
    for (const v of variables) {
      if (typeof v.key !== "string" || typeof v.label !== "string" || typeof v.sample !== "string") {
        return new Response(
          JSON.stringify({ ok: false, error: "variables 각 항목은 key·label·sample 문자열이 필요합니다.", step: "validate" }),
          { status: 400, headers: JSON_HEADER },
        );
      }
    }

    /* 변수 참조 검증 — 미정의 {{key}} 거부 */
    const templateText = (subject || "") + "\n" + bodyTemplate;
    const undefined_ = findUndefinedVariables(templateText, variables);
    if (undefined_.length > 0) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: `본문에 정의되지 않은 변수가 있습니다: ${undefined_.map((k) => `{{${k}}}`).join(", ")}`,
          step: "validate",
        }),
        { status: 400, headers: JSON_HEADER },
      );
    }
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false, error: "입력값 검증 실패", step: "validate",
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }),
      { status: 500, headers: JSON_HEADER },
    );
  }

  /* DB 저장 */
  try {
    const { name, channel, category, subject, bodyTemplate, variables } = body;
    const adminId = auth.ctx.admin.uid;

    const res: any = await db.execute(
      sql`INSERT INTO communication_templates
            (name, channel, category, subject, body_template, variables, created_by, updated_by)
          VALUES
            (${name.trim()}, ${channel}, ${category},
             ${subject ? subject.trim() : null},
             ${bodyTemplate}, ${JSON.stringify(variables)}::jsonb,
             ${adminId}, ${adminId})
          RETURNING id`
    );

    const rows = res?.rows ?? res ?? [];
    const id = rows[0]?.id;

    return new Response(JSON.stringify({ ok: true, id }), {
      status: 201,
      headers: JSON_HEADER,
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false, error: "템플릿 저장 실패", step: "insert",
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }),
      { status: 500, headers: JSON_HEADER },
    );
  }
}
