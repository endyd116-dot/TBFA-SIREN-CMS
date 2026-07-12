/**
 * POST /api/form-submit
 *
 * 응답폼 빌더 — 응답 제출 (공개 — 비회원도 가능).
 *
 * 요청 body:
 *   { slug: "event-signup",
 *     data: { fieldKey1: value1, fieldKey2: value2, ... },
 *     memberEmail?: string,  // 비회원 응답 시 연락처 (선택)
 *     memberPhone?: string }
 *
 * 응답:
 *   { ok: true, submissionId, message }
 *   { ok: false, error, fieldErrors? }
 *
 * 처리:
 *   - 폼 활성·발행·정원·중복 검증
 *   - access_level=members_only면 로그인 사용자 토큰 검증 (lib/auth)
 *   - 필드별 required·pattern·minLength·maxLength 검증
 *   - INSERT form_submissions
 *   - notify_on_submit=true면 admin_notify_email 또는 createdBy에 알림
 */

import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { authenticateUser } from "../../lib/auth";
import { dispatch } from "../../lib/notify-dispatcher";
import { NotifyEvent } from "../../lib/notify-events";

export const config = { path: "/api/form-submit" };

const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "POST") {
    return new Response(jsonKST({ ok: false, error: "POST만 허용" }),
      { status: 405, headers: JSON_HEADER });
  }

  let body: any = {};
  try { body = await req.json(); } catch {
    return new Response(jsonKST({ ok: false, error: "JSON 파싱 실패" }),
      { status: 400, headers: JSON_HEADER });
  }

  const slug = String(body?.slug || "").trim();
  const data = body?.data;
  if (!slug || !data || typeof data !== "object") {
    return new Response(jsonKST({ ok: false, error: "slug·data 필수" }),
      { status: 400, headers: JSON_HEADER });
  }

  try {
    /* 1) 폼 조회 + 정원 카운트 */
    const fr: any = await db.execute(sql`
      SELECT f.id, f.title, f.access_level, f.requires_auth, f.is_active, f.is_published,
             f.max_responses, f.allow_duplicates, f.notify_on_submit, f.admin_notify_email,
             f.created_by,
             COALESCE((SELECT COUNT(*)::int FROM form_submissions s WHERE s.form_id = f.id), 0) AS response_count
        FROM forms f
       WHERE f.slug = ${slug}
       LIMIT 1
    `);
    const form = (fr?.rows ?? fr ?? [])[0];
    if (!form) return new Response(jsonKST({ ok: false, error: "존재하지 않는 폼" }),
      { status: 404, headers: JSON_HEADER });

    if (!form.is_active || !form.is_published) {
      return new Response(jsonKST({ ok: false, error: "현재 응답을 받지 않는 폼입니다" }),
        { status: 410, headers: JSON_HEADER });
    }

    if (form.max_responses != null && Number(form.response_count) >= Number(form.max_responses)) {
      return new Response(jsonKST({ ok: false, error: "응답 정원이 마감되었습니다" }),
        { status: 410, headers: JSON_HEADER });
    }

    /* 2) 로그인 검증 (access_level=members_only 또는 requires_auth=true) */
    let memberId: number | null = null;
    const user = authenticateUser(req);
    if (form.access_level === "members_only" || form.requires_auth) {
      if (!user) {
        return new Response(jsonKST({ ok: false, error: "회원 로그인이 필요한 폼입니다", requiresLogin: true }),
          { status: 401, headers: JSON_HEADER });
      }
      memberId = user.uid;
    } else if (user) {
      /* public 폼이라도 로그인했으면 memberId 자동 연결 (응답자 추적) */
      memberId = user.uid;
    }

    /* 3) 중복 응답 차단 (allow_duplicates=false 일 때 회원 기준) */
    if (!form.allow_duplicates && memberId) {
      const dup: any = await db.execute(sql`
        SELECT id FROM form_submissions
         WHERE form_id = ${Number(form.id)} AND member_id = ${memberId}
         LIMIT 1
      `);
      if ((dup?.rows ?? dup ?? []).length > 0) {
        return new Response(jsonKST({ ok: false, error: "이미 응답하신 폼입니다" }),
          { status: 409, headers: JSON_HEADER });
      }
    }

    /* 4) 필드 정의 로드 + required·pattern 검증 */
    const dr: any = await db.execute(sql`
      SELECT field_key, type, label, required, pattern, min_length, max_length
        FROM form_fields WHERE form_id = ${Number(form.id)} AND is_visible = TRUE
    `);
    const fields = (dr?.rows ?? dr ?? []);
    const fieldErrors: Record<string, string> = {};

    for (const f of fields) {
      /* US-025: 파일 첨부는 미지원이라 필수/패턴 검증에서 제외 — 막다른 길(required 파일로 제출 영구 차단) 방지 */
      if (f.type === "file") continue;
      const v = data[f.field_key];
      const isEmpty = v === undefined || v === null || String(v).trim() === "" || (Array.isArray(v) && v.length === 0);

      if (f.required && isEmpty) {
        fieldErrors[f.field_key] = `${f.label}: 필수 입력`;
        continue;
      }
      if (isEmpty) continue;

      const strVal = String(v);
      if (f.pattern && !new RegExp(f.pattern).test(strVal)) {
        fieldErrors[f.field_key] = `${f.label}: 형식이 올바르지 않습니다`;
      }
      if (f.min_length != null && strVal.length < Number(f.min_length)) {
        fieldErrors[f.field_key] = `${f.label}: 최소 ${f.min_length}자`;
      }
      if (f.max_length != null && strVal.length > Number(f.max_length)) {
        fieldErrors[f.field_key] = `${f.label}: 최대 ${f.max_length}자`;
      }
    }

    if (Object.keys(fieldErrors).length > 0) {
      return new Response(jsonKST({ ok: false, error: "입력값 검증 실패", fieldErrors }),
        { status: 400, headers: JSON_HEADER });
    }

    /* 5) INSERT */
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
    const ua = req.headers.get("user-agent") || null;
    const memberEmail = body.memberEmail ? String(body.memberEmail).slice(0, 200) : null;
    const memberPhone = body.memberPhone ? String(body.memberPhone).slice(0, 20) : null;

    const ir: any = await db.execute(sql`
      INSERT INTO form_submissions (form_id, member_id, member_email, member_phone, data, user_agent, ip_address, status, created_at, updated_at)
      VALUES (${Number(form.id)}, ${memberId}, ${memberEmail}, ${memberPhone}, ${JSON.stringify(data)}::jsonb, ${ua}, ${ip}, 'submitted', NOW(), NOW())
      RETURNING id
    `);
    const submissionId = Number((ir?.rows ?? ir ?? [])[0]?.id);

    /* 6) 어드민 알림 (notify_on_submit=true) */
    if (form.notify_on_submit && form.created_by) {
      try {
        dispatch({
          event: NotifyEvent.WORKSPACE_ACTIVITY,
          target: { type: "admin", id: Number(form.created_by) },
          params: {
            title: `새 응답 — ${form.title}`,
            message: `응답 #${submissionId} 도착 (총 ${Number(form.response_count) + 1}건)`,
            link: `/admin-form-submissions.html?formId=${form.id}`,
            category: "form",
            severity: "info",
            refTable: "form_submissions",
            refId: submissionId,
          },
        });
      } catch {}
    }

    return new Response(jsonKST({
      ok: true, submissionId, message: "응답이 제출되었습니다. 감사합니다.",
    }), { status: 200, headers: JSON_HEADER });
  } catch (e: any) {
    return new Response(jsonKST({
      ok: false, error: "응답 저장 실패", step: "insert",
      detail: String(e?.message || e).slice(0, 500),
      stack: String(e?.stack || "").slice(0, 1000),
    }), { status: 500, headers: JSON_HEADER });
  }
};
