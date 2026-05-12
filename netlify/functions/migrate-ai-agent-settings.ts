/**
 * 1회용 마이그레이션 — Phase B AI 비서 설정
 *  - ai_agent_settings:    key/value 설정 (system_prompt 등)
 *  - ai_tool_permissions:  22개 도구 토글·권한 시드
 *
 * GET            : 진단
 * GET ?run=1     : 어드민 인증 후 실행 (멱등)
 *
 * Neon SQL Editor에서 직접 실행하려면 migrations/ai-agent-settings.sql 사용
 */

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-ai-agent-settings" };

const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

const DEFAULT_SYSTEM_PROMPT = `당신은 (사)교사유가족협의회 SIREN의 AI 비서입니다. 관리자 명령을 받아 적절한 도구를 호출하세요.

## 핵심 규칙
1. 변경 작업(*_update, *_create)은 dry-run(requireApproval=true) 우선 → 사용자 승인 후 requireApproval=false로 재호출.
2. 의도 모호하면 도구 호출 전 한국어로 다시 묻기.
3. 결과는 한국어 자연어 + 핵심 숫자만 (raw JSON 금지).
4. 한 번에 필요한 도구만 호출 (불필요한 반복 금지).
5. 같은 도구를 반복 호출하지 마세요 — 결과가 같으면 그대로 사용.

답변: 존댓말, 간결, 이모지 절제.`;

/* 22개 도구 시드 — [name, isMutation, category, requiredRole, description] */
const TOOLS_SEED: Array<[string, boolean, string, string | null, string]> = [
  /* 콘텐츠·관리 (5) */
  ["content_pages_list",        false, "content",    null,           "콘텐츠 페이지 본문 조회"],
  ["content_pages_update",      true,  "content",    "super_admin",  "콘텐츠 페이지 본문 수정 (변경 도구)"],
  ["notice_create",             true,  "content",    "super_admin",  "공지사항 새로 등록 (변경 도구)"],
  ["campaign_create",           true,  "content",    "super_admin",  "후원 캠페인 새로 등록 (변경 도구)"],
  ["nav_menus_list",            false, "nav",        null,           "네비게이션 메뉴 조회"],
  /* 회원 (4) */
  ["members_search",            false, "members",    null,           "회원 검색"],
  ["members_detail",            false, "members",    null,           "회원 상세"],
  ["members_stats",             false, "members",    null,           "회원 통계"],
  ["members_recent",            false, "members",    null,           "최근 회원"],
  /* 후원 (3) */
  ["donations_recent",          false, "donations",  null,           "최근 후원"],
  ["donations_stats",           false, "donations",  null,           "후원 통계"],
  ["donations_by_member",       false, "donations",  null,           "회원별 후원 내역"],
  /* 신고 (4) */
  ["incidents_list",            false, "siren",      null,           "사건 제보 목록"],
  ["incidents_detail",          false, "siren",      null,           "사건 제보 상세"],
  ["harassment_reports_list",   false, "siren",      null,           "악성민원 신고 목록"],
  ["legal_consultations_list",  false, "siren",      null,           "법률 상담 목록"],
  /* 게시판·캠페인 (3) */
  ["board_posts_list",          false, "board",      null,           "게시판 글 목록"],
  ["campaigns_list",            false, "content",    null,           "캠페인 목록"],
  ["campaigns_detail",          false, "content",    null,           "캠페인 상세"],
  /* 워크스페이스·KPI (3) */
  ["tasks_list",                false, "workspace",  null,           "작업 목록"],
  ["notifications_recent",      false, "workspace",  null,           "최근 알림"],
  ["kpi_summary",               false, "kpi",        null,           "KPI 요약"],
];

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);

  if (req.method === "GET" && !url.searchParams.get("run")) {
    return new Response(JSON.stringify({
      ok: true, mode: "diagnostic",
      adds: ["ai_agent_settings", "ai_tool_permissions (22개 시드)"],
    }), { status: 200, headers: JSON_HEADER });
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  const results: { step: string; result: string }[] = [];
  async function run(step: string, ddl: string) {
    try {
      await db.execute(sql.raw(ddl));
      results.push({ step, result: "ok" });
    } catch (e: any) {
      results.push({ step, result: String(e?.message).slice(0, 300) });
    }
  }

  /* 1) ai_agent_settings */
  await run("settings_table", `
    CREATE TABLE IF NOT EXISTS ai_agent_settings (
      key VARCHAR(60) PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by INTEGER
    )
  `);

  /* 2) ai_tool_permissions */
  await run("permissions_table", `
    CREATE TABLE IF NOT EXISTS ai_tool_permissions (
      tool_name VARCHAR(100) PRIMARY KEY,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      required_role VARCHAR(20),
      description TEXT,
      is_mutation BOOLEAN NOT NULL DEFAULT FALSE,
      category VARCHAR(30),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  /* 3) 기본 시스템 프롬프트 시드 (ON CONFLICT DO NOTHING — 사용자가 이미 수정했으면 보존) */
  try {
    await db.execute(sql`
      INSERT INTO ai_agent_settings (key, value)
      VALUES ('system_prompt', ${DEFAULT_SYSTEM_PROMPT})
      ON CONFLICT (key) DO NOTHING
    `);
    results.push({ step: "seed_system_prompt", result: "ok" });
  } catch (e: any) {
    results.push({ step: "seed_system_prompt", result: String(e?.message).slice(0, 300) });
  }

  /* 4) 22개 도구 시드 — ON CONFLICT DO NOTHING (운영자 수정 보존) */
  for (const [name, isMutation, category, requiredRole, description] of TOOLS_SEED) {
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
