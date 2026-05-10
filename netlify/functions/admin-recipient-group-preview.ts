// netlify/functions/admin-recipient-group-preview.ts
// Phase 10 R2 — criteria 미리보기 (DB 저장 X, 인원 수 + 샘플 5명 + 요약)

import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import {
  RecipientCriteria,
  resolveRecipients,
  summarizeCriteria,
  validateCriteria,
} from "../../lib/recipient-resolve";

export const config = { path: "/api/admin-recipient-group-preview" };

const JSON_HEADER = { "Content-Type": "application/json" };

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ ok: false, error: "요청 본문을 파싱할 수 없습니다.", step: "parse" }),
      { status: 400, headers: JSON_HEADER },
    );
  }

  const criteria = body?.criteria;
  const v = validateCriteria(criteria);
  if (!v.ok) {
    return new Response(
      JSON.stringify({ ok: false, error: (v as any).error, step: "validate" }),
      { status: 400, headers: JSON_HEADER },
    );
  }

  try {
    const result = await resolveRecipients(criteria as RecipientCriteria, { limit: 5 });
    const warnings: string[] = [];
    if (result.count === 0) {
      warnings.push("조건에 맞는 회원이 0명입니다.");
    }

    return new Response(
      JSON.stringify({
        ok: true,
        preview: {
          memberCount: result.count,
          sampleMembers: (result.members || []).map((m) => ({
            id: m.id,
            name: m.name,
            email: m.email,
          })),
          criteriaSummary: summarizeCriteria(criteria as RecipientCriteria),
        },
        warnings,
      }),
      { status: 200, headers: JSON_HEADER },
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false, error: "미리보기 실패", step: "resolve",
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }),
      { status: 500, headers: JSON_HEADER },
    );
  }
}
