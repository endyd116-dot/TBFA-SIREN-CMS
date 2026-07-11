// netlify/functions/admin-template-update.ts
// Phase 10 R1 — 발송 템플릿 수정

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import { findUndefinedVariables } from "../../lib/template-render";

export const config = { path: "/api/admin-template-update" };

const JSON_HEADER = { "Content-Type": "application/json" };

const VALID_CHANNELS = ["email", "sms", "kakao", "inapp"];
const VALID_CATEGORIES = ["newsletter", "announcement", "auto_trigger", "campaign", "system"];

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  const url = new URL(req.url);
  const id = parseInt(url.searchParams.get("id") || "0", 10);
  if (!id) {
    return new Response(JSON.stringify({ ok: false, error: "id 파라미터가 필요합니다." }), {
      status: 400,
      headers: JSON_HEADER,
    });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "요청 본문을 파싱할 수 없습니다." }), {
      status: 400,
      headers: JSON_HEADER,
    });
  }

  /* 검증 */
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

  /* 존재 확인 */
  try {
    const existRes: any = await db.execute(
      sql`SELECT id FROM communication_templates WHERE id = ${id} LIMIT 1`
    );
    const exist = (existRes?.rows ?? existRes ?? [])[0];
    if (!exist) {
      return new Response(JSON.stringify({ ok: false, error: "템플릿을 찾을 수 없습니다." }), {
        status: 404,
        headers: JSON_HEADER,
      });
    }
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false, error: "템플릿 조회 실패", step: "select_exist",
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }),
      { status: 500, headers: JSON_HEADER },
    );
  }

  /* DB 수정 */
  try {
    const { name, channel, category, subject, bodyTemplate, variables } = body;
    const adminId = auth.ctx.admin.uid;

    /* 2026-05-16: 카카오 알림톡 전용 필드 처리 */
    const isKakao = channel === "kakao";
    const alimtalkTemplateCode = isKakao && body.alimtalkTemplateCode
      ? String(body.alimtalkTemplateCode).trim().slice(0, 50)
      : null;
    const alimtalkReviewStatus = isKakao && body.alimtalkReviewStatus
      ? String(body.alimtalkReviewStatus).trim()
      : null;
    const alimtalkButtonJson = isKakao && body.alimtalkButtonJson
      ? (typeof body.alimtalkButtonJson === "string"
          ? body.alimtalkButtonJson
          : JSON.stringify(body.alimtalkButtonJson))
      : null;

    const colCheck: any = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM information_schema.columns
       WHERE table_name = 'communication_templates'
         AND column_name IN ('alimtalk_template_code','alimtalk_review_status','alimtalk_button_json')
    `);
    const hasAlimtalkCols = (((colCheck?.rows ?? colCheck)[0] ?? {}).n ?? 0) === 3;

    /* 2026-05-17: images jsonb 컬럼 + 페이로드 처리 */
    const imgCheck: any = await db.execute(sql`
      SELECT 1 AS ok FROM information_schema.columns
       WHERE table_name = 'communication_templates' AND column_name = 'images' LIMIT 1
    `);
    const hasImagesCol = ((imgCheck?.rows ?? imgCheck ?? [])[0] || {}).ok === 1;
    const imagesArr = Array.isArray(body.images) ? body.images.slice(0, 20) : [];
    const imagesJson = JSON.stringify(imagesArr);

    /* 2026-05-17: use_siren_layout 처리 */
    const sirenChk: any = await db.execute(sql`
      SELECT 1 AS ok FROM information_schema.columns
       WHERE table_name = 'communication_templates' AND column_name = 'use_siren_layout' LIMIT 1
    `);
    const hasSirenCol = ((sirenChk?.rows ?? sirenChk ?? [])[0] || {}).ok === 1;
    const useSirenLayout = !!body.useSirenLayout && (channel === "email");

    if (hasAlimtalkCols && hasImagesCol && hasSirenCol) {
      await db.execute(
        sql`UPDATE communication_templates
            SET name                    = ${name.trim()},
                channel                 = ${channel},
                category                = ${category},
                subject                 = ${subject ? subject.trim() : null},
                body_template           = ${bodyTemplate},
                variables               = ${JSON.stringify(variables)}::jsonb,
                updated_by              = ${adminId},
                updated_at              = NOW(),
                alimtalk_template_code  = ${alimtalkTemplateCode},
                alimtalk_review_status  = ${alimtalkReviewStatus},
                alimtalk_button_json    = ${alimtalkButtonJson ? sql`${alimtalkButtonJson}::jsonb` : sql`NULL`},
                images                  = ${imagesJson}::jsonb,
                use_siren_layout        = ${useSirenLayout}
            WHERE id = ${id}`
      );
    } else if (hasAlimtalkCols && hasImagesCol) {
      await db.execute(
        sql`UPDATE communication_templates
            SET name                    = ${name.trim()},
                channel                 = ${channel},
                category                = ${category},
                subject                 = ${subject ? subject.trim() : null},
                body_template           = ${bodyTemplate},
                variables               = ${JSON.stringify(variables)}::jsonb,
                updated_by              = ${adminId},
                updated_at              = NOW(),
                alimtalk_template_code  = ${alimtalkTemplateCode},
                alimtalk_review_status  = ${alimtalkReviewStatus},
                alimtalk_button_json    = ${alimtalkButtonJson ? sql`${alimtalkButtonJson}::jsonb` : sql`NULL`},
                images                  = ${imagesJson}::jsonb
            WHERE id = ${id}`
      );
    } else if (hasAlimtalkCols) {
      await db.execute(
        sql`UPDATE communication_templates
            SET name                    = ${name.trim()},
                channel                 = ${channel},
                category                = ${category},
                subject                 = ${subject ? subject.trim() : null},
                body_template           = ${bodyTemplate},
                variables               = ${JSON.stringify(variables)}::jsonb,
                updated_by              = ${adminId},
                updated_at              = NOW(),
                alimtalk_template_code  = ${alimtalkTemplateCode},
                alimtalk_review_status  = ${alimtalkReviewStatus},
                alimtalk_button_json    = ${alimtalkButtonJson ? sql`${alimtalkButtonJson}::jsonb` : sql`NULL`}
            WHERE id = ${id}`
      );
    } else {
      await db.execute(
        sql`UPDATE communication_templates
            SET name          = ${name.trim()},
                channel       = ${channel},
                category      = ${category},
                subject       = ${subject ? subject.trim() : null},
                body_template = ${bodyTemplate},
                variables     = ${JSON.stringify(variables)}::jsonb,
                updated_by    = ${adminId},
                updated_at    = NOW()
            WHERE id = ${id}`
      );
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: JSON_HEADER,
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false, error: "템플릿 수정 실패", step: "update",
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }),
      { status: 500, headers: JSON_HEADER },
    );
  }
}
