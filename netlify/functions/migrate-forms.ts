/**
 * 1회용 마이그레이션 — 응답폼·신청폼 빌더 모듈 D1
 *
 * 새 테이블 3종:
 *   forms             — 폼 마스터 (제목·slug·공개 정책·발행 상태)
 *   form_fields       — 폼 필드 정의 (type·label·옵션·검증·정렬)
 *   form_submissions  — 응답 데이터 (jsonb data·응답자 정보·status)
 *
 * GET           : 진단
 * GET ?run=1    : 어드민 인증 후 실행 (멱등 — IF NOT EXISTS)
 */

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-forms" };

const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);

  if (req.method === "GET" && !url.searchParams.get("run")) {
    return new Response(JSON.stringify({
      ok: true, mode: "diagnostic",
      will_create_tables: ["forms", "form_fields", "form_submissions"],
      forms_columns: ["id", "title", "slug (unique)", "description", "instructions",
        "access_level (public|members_only|limited)", "requires_auth",
        "is_active", "is_published", "max_responses", "allow_duplicates",
        "closed_message", "notify_on_submit", "admin_notify_email",
        "created_by FK members", "created_at", "updated_at", "published_at"],
      form_fields_columns: ["id", "form_id FK forms CASCADE", "field_key (slug)",
        "type (text|email|tel|number|textarea|select|checkbox|radio|date|file)",
        "label", "placeholder", "help_text", "options jsonb", "required",
        "pattern", "min_length", "max_length", "accept_file_types", "max_file_size",
        "sort_order", "is_visible", "show_conditions jsonb"],
      form_submissions_columns: ["id", "form_id FK forms CASCADE",
        "member_id FK members SET NULL", "member_email", "member_phone",
        "data jsonb (응답 본문 {fieldKey: value, ...})",
        "user_agent", "ip_address",
        "status (submitted|flagged|archived)", "notes", "created_at", "updated_at"],
      note: "GET ?run=1 로 어드민 인증 후 실제 적용",
    }, null, 2), { status: 200, headers: JSON_HEADER });
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  const results: { step: string; result: string }[] = [];
  async function run(step: string, fn: () => Promise<void>) {
    try { await fn(); results.push({ step, result: "ok" }); }
    catch (e: any) { results.push({ step, result: `error: ${String(e?.message || e).slice(0, 300)}` }); }
  }

  /* 1) forms */
  await run("create_forms", async () => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS forms (
        id                  BIGSERIAL PRIMARY KEY,
        title               VARCHAR(200) NOT NULL,
        slug                VARCHAR(100) NOT NULL UNIQUE,
        description         TEXT,
        instructions        TEXT,
        access_level        VARCHAR(20)  NOT NULL DEFAULT 'public',
        requires_auth       BOOLEAN      NOT NULL DEFAULT FALSE,
        is_active           BOOLEAN      NOT NULL DEFAULT TRUE,
        is_published        BOOLEAN      NOT NULL DEFAULT FALSE,
        max_responses       INTEGER,
        allow_duplicates    BOOLEAN      NOT NULL DEFAULT TRUE,
        closed_message      TEXT,
        notify_on_submit    BOOLEAN      NOT NULL DEFAULT TRUE,
        admin_notify_email  VARCHAR(200),
        created_by          INTEGER REFERENCES members(id) ON DELETE SET NULL,
        created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMP NOT NULL DEFAULT NOW(),
        published_at        TIMESTAMP
      )
    `);
  });
  await run("idx_forms_slug",      async () => { await db.execute(sql`CREATE INDEX IF NOT EXISTS forms_slug_idx ON forms (slug)`); });
  await run("idx_forms_active",    async () => { await db.execute(sql`CREATE INDEX IF NOT EXISTS forms_active_idx ON forms (is_active, is_published)`); });

  /* 2) form_fields */
  await run("create_form_fields", async () => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS form_fields (
        id                BIGSERIAL PRIMARY KEY,
        form_id           BIGINT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
        field_key         VARCHAR(50) NOT NULL,
        type              VARCHAR(20) NOT NULL,
        label             VARCHAR(200) NOT NULL,
        placeholder       VARCHAR(200),
        help_text         TEXT,
        options           JSONB NOT NULL DEFAULT '[]'::jsonb,
        required          BOOLEAN NOT NULL DEFAULT FALSE,
        pattern           VARCHAR(200),
        min_length        INTEGER,
        max_length        INTEGER,
        accept_file_types VARCHAR(200),
        max_file_size     INTEGER,
        sort_order        INTEGER NOT NULL DEFAULT 0,
        is_visible        BOOLEAN NOT NULL DEFAULT TRUE,
        show_conditions   JSONB,
        created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE (form_id, field_key)
      )
    `);
  });
  await run("idx_form_fields_form", async () => { await db.execute(sql`CREATE INDEX IF NOT EXISTS form_fields_form_idx ON form_fields (form_id, sort_order)`); });

  /* 3) form_submissions */
  await run("create_form_submissions", async () => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS form_submissions (
        id            BIGSERIAL PRIMARY KEY,
        form_id       BIGINT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
        member_id     INTEGER REFERENCES members(id) ON DELETE SET NULL,
        member_email  VARCHAR(200),
        member_phone  VARCHAR(20),
        data          JSONB NOT NULL,
        user_agent    TEXT,
        ip_address    VARCHAR(45),
        status        VARCHAR(20) NOT NULL DEFAULT 'submitted',
        notes         TEXT,
        created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
  });
  await run("idx_submissions_form",   async () => { await db.execute(sql`CREATE INDEX IF NOT EXISTS form_submissions_form_idx ON form_submissions (form_id, created_at DESC)`); });
  await run("idx_submissions_member", async () => { await db.execute(sql`CREATE INDEX IF NOT EXISTS form_submissions_member_idx ON form_submissions (member_id) WHERE member_id IS NOT NULL`); });
  await run("idx_submissions_status", async () => { await db.execute(sql`CREATE INDEX IF NOT EXISTS form_submissions_status_idx ON form_submissions (form_id, status)`); });

  const ok = results.every(r => r.result === "ok");
  return new Response(JSON.stringify({
    ok, applied: results,
    next_steps: ok ? [
      "1) 호출 결과를 메인 채팅에 알려주세요",
      "2) 메인이 schema.ts에 forms·formFields·formSubmissions 정의 활성화",
      "3) D2 공개 API + 공개 페이지 작성 진행",
      "4) 마이그 파일은 다음 push에 삭제됨",
    ] : ["오류 항목 보고"],
  }, null, 2), { status: ok ? 200 : 500, headers: JSON_HEADER });
};
