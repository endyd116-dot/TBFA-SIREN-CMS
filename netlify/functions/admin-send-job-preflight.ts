// netlify/functions/admin-send-job-preflight.ts
// Phase 10 R3 — 등록 전 미리보기 (DB 저장 X)
// - 채널·템플릿명·그룹명·예상 수신자 수·샘플 회원 5명·렌더링 본문 1건·경고 목록

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";
import { communicationTemplates, recipientGroups } from "../../db";
import { resolveRecipients } from "../../lib/recipient-resolve";
import { renderTemplate } from "../../lib/template-render";
import { buildMemberRenderData } from "../../lib/communication-send";

export const config = { path: "/api/admin-send-job-preflight" };

const JSON_HEADER = { "Content-Type": "application/json" };

function jsonError(step: string, err: any, status = 500) {
  return new Response(
    JSON.stringify({
      ok: false,
      error: "미리보기 실패",
      step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }),
    { status, headers: JSON_HEADER },
  );
}

export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ ok: false, error: "POST만 허용", step: "method" }),
      { status: 405, headers: JSON_HEADER },
    );
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  let body: any;
  try {
    body = await req.json();
  } catch (err: any) {
    return jsonError("parse_body", err, 400);
  }

  const templateId = parseInt(body?.templateId, 10);
  const recipientGroupId = parseInt(body?.recipientGroupId, 10);
  if (!Number.isInteger(templateId) || templateId <= 0 ||
      !Number.isInteger(recipientGroupId) || recipientGroupId <= 0) {
    return new Response(
      JSON.stringify({ ok: false, error: "templateId·recipientGroupId가 필요합니다.", step: "validate" }),
      { status: 400, headers: JSON_HEADER },
    );
  }

  /* 템플릿 조회 */
  let template: any = null;
  try {
    const [row] = await db
      .select({
        id: communicationTemplates.id,
        name: communicationTemplates.name,
        channel: communicationTemplates.channel,
        subject: communicationTemplates.subject,
        bodyTemplate: communicationTemplates.bodyTemplate,
        variables: communicationTemplates.variables,
        isActive: communicationTemplates.isActive,
      })
      .from(communicationTemplates)
      .where(eq(communicationTemplates.id, templateId))
      .limit(1);
    template = row;
  } catch (err: any) {
    return jsonError("select_template", err);
  }
  if (!template) {
    return new Response(
      JSON.stringify({ ok: false, error: "템플릿을 찾을 수 없습니다.", step: "template_not_found" }),
      { status: 404, headers: JSON_HEADER },
    );
  }

  /* 그룹 조회 */
  let group: any = null;
  try {
    const [row] = await db
      .select({
        id: recipientGroups.id,
        name: recipientGroups.name,
        criteria: recipientGroups.criteria,
        isActive: recipientGroups.isActive,
      })
      .from(recipientGroups)
      .where(eq(recipientGroups.id, recipientGroupId))
      .limit(1);
    group = row;
  } catch (err: any) {
    return jsonError("select_group", err);
  }
  if (!group) {
    return new Response(
      JSON.stringify({ ok: false, error: "수신자 그룹을 찾을 수 없습니다.", step: "group_not_found" }),
      { status: 404, headers: JSON_HEADER },
    );
  }

  /* 그룹 resolve — 카운트 + 샘플 5명 */
  let estimatedRecipients = 0;
  let sampleMembers: any[] = [];
  try {
    const result = await resolveRecipients(group.criteria as any, { limit: 5, countOnly: false });
    estimatedRecipients = result.count;
    sampleMembers = (result.members || []).map((m) => ({
      id: m.id, name: m.name, email: m.email, type: m.type, status: m.status,
    }));
  } catch (err: any) {
    return jsonError("resolve_group", err);
  }

  /* 변수 치환 샘플 1건 */
  let renderedSample: any = null;
  if (sampleMembers.length > 0) {
    const m = sampleMembers[0];
    const data = buildMemberRenderData({
      id: m.id,
      name: m.name,
      email: m.email,
      phone: null,
    });
    const variables = Array.isArray(template.variables) ? template.variables : [];
    /* 미리보기/사전 점검 — 실제 회원 데이터에 없는 변수는 sample 예시값으로 표시 */
    const subjectRender = template.subject
      ? renderTemplate(template.subject, variables, data, { useSampleFallback: true })
      : { rendered: "", warnings: [] as string[] };
    const bodyRender = renderTemplate(template.bodyTemplate, variables, data, { useSampleFallback: true });
    renderedSample = {
      memberId: m.id,
      memberName: m.name,
      subject: subjectRender.rendered,
      body: bodyRender.rendered,
      warnings: [...subjectRender.warnings, ...bodyRender.warnings].slice(0, 10),
    };
  }

  /* 경고 모음 */
  const warnings: string[] = [];
  if (!template.isActive) warnings.push("템플릿이 비활성 상태입니다.");
  if (!group.isActive) warnings.push("수신자 그룹이 비활성 상태입니다.");
  if (estimatedRecipients === 0) warnings.push("수신자 그룹에 회원이 0명입니다.");
  if (template.channel === "kakao") {
    warnings.push("카카오 알림톡은 사전 심사 통과 템플릿만 발송 가능 — 본 라운드에서는 자동 스킵됩니다.");
  }
  if (renderedSample && Array.isArray(renderedSample.warnings) && renderedSample.warnings.length > 0) {
    warnings.push(`템플릿 변수 ${renderedSample.warnings.length}건이 채워지지 않았습니다.`);
  }

  return new Response(
    JSON.stringify({
      ok: true,
      preflight: {
        channel: template.channel,
        templateName: template.name,
        templateActive: template.isActive,
        groupName: group.name,
        groupActive: group.isActive,
        estimatedRecipients,
        sampleMembers,
        renderedSample,
        warnings,
      },
    }),
    { status: 200, headers: JSON_HEADER },
  );
}
