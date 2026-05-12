// lib/ai-agent-tools.ts
// AI 에이전트가 호출할 수 있는 SIREN 도구 정의 + 실행 핸들러
// Phase A: 콘텐츠·관리 + 읽기 도구 대폭 확장 (총 20개)

import { sql } from "drizzle-orm";
import { db } from "../db";

/* =========================================================
   Gemini Function Declaration — OpenAPI 3.0 schema (대문자 type)
   ========================================================= */

export const TOOL_DECLARATIONS = [
  /* ───── 콘텐츠·관리 (5개) ───── */
  {
    name: "content_pages_list",
    description: "협의회 콘텐츠 페이지(메인·about·소개 등)의 현재 본문을 조회합니다.",
    parameters: { type: "OBJECT", properties: {
      keyFilter: { type: "STRING", description: "페이지 키 부분 일치 검색" },
      limit:     { type: "INTEGER", description: "최대 반환 개수 (기본 30)" },
    }},
  },
  {
    name: "content_pages_update",
    description: "콘텐츠 페이지 본문 수정. 변경 전 값 자동 백업. 사용자 명시 승인 후에만 호출하세요.",
    parameters: { type: "OBJECT", properties: {
      pageKey:         { type: "STRING",  description: "페이지 키" },
      newContent:      { type: "STRING",  description: "새 본문" },
      requireApproval: { type: "BOOLEAN", description: "true면 dry-run, false면 적용. 기본 true." },
    }, required: ["pageKey", "newContent"] },
  },
  {
    name: "notice_create",
    description: "공지사항 새로 등록. 사용자 승인 후 호출하세요.",
    parameters: { type: "OBJECT", properties: {
      title:           { type: "STRING",  description: "공지 제목" },
      body:            { type: "STRING",  description: "공지 본문" },
      category:        { type: "STRING",  description: "분류: notice|event|press" },
      requireApproval: { type: "BOOLEAN", description: "기본 true (dry-run)" },
    }, required: ["title", "body"] },
  },
  {
    name: "campaign_create",
    description: "새 후원 캠페인 등록. 사용자 승인 후 호출하세요.",
    parameters: { type: "OBJECT", properties: {
      name:            { type: "STRING",  description: "캠페인명" },
      description:     { type: "STRING",  description: "캠페인 설명" },
      goalAmount:      { type: "INTEGER", description: "목표 금액 (원)" },
      endDate:         { type: "STRING",  description: "종료일 YYYY-MM-DD" },
      requireApproval: { type: "BOOLEAN", description: "기본 true" },
    }, required: ["name", "description", "goalAmount"] },
  },
  {
    name: "nav_menus_list",
    description: "네비게이션 메뉴 트리 조회.",
    parameters: { type: "OBJECT", properties: {
      location: { type: "STRING", description: "header|footer (기본 header)" },
    }},
  },

  /* ───── 회원 (4개) ───── */
  {
    name: "members_search",
    description: "회원을 이름/이메일/전화번호로 부분 일치 검색합니다. 발송·상담 대상 찾을 때 사용.",
    parameters: { type: "OBJECT", properties: {
      query: { type: "STRING",  description: "검색어 (이름·이메일·전화)" },
      type:  { type: "STRING",  description: "회원 유형 필터: regular|family|volunteer|admin" },
      limit: { type: "INTEGER", description: "최대 30 (기본 20)" },
    }, required: ["query"] },
  },
  {
    name: "members_detail",
    description: "특정 회원의 상세 정보 조회 (id로).",
    parameters: { type: "OBJECT", properties: {
      memberId: { type: "INTEGER", description: "회원 ID" },
    }, required: ["memberId"] },
  },
  {
    name: "members_stats",
    description: "회원 유형별·상태별 카운트 통계. 대시보드 요약용.",
    parameters: { type: "OBJECT", properties: {} },
  },
  {
    name: "members_recent",
    description: "최근 가입 회원 목록 (가입일 역순).",
    parameters: { type: "OBJECT", properties: {
      limit: { type: "INTEGER", description: "최대 50 (기본 10)" },
    }},
  },

  /* ───── 후원 (3개) ───── */
  {
    name: "donations_recent",
    description: "최근 후원 내역 (최신순).",
    parameters: { type: "OBJECT", properties: {
      limit:  { type: "INTEGER", description: "최대 50 (기본 20)" },
      status: { type: "STRING",  description: "completed|pending|failed (기본 모두)" },
    }},
  },
  {
    name: "donations_stats",
    description: "후원 통계 — 이번 달·올해 누적 금액·건수, 정기·일시 비율.",
    parameters: { type: "OBJECT", properties: {
      months: { type: "INTEGER", description: "최근 N개월 (기본 1)" },
    }},
  },
  {
    name: "donations_by_member",
    description: "특정 회원의 후원 이력 전체 조회.",
    parameters: { type: "OBJECT", properties: {
      memberId: { type: "INTEGER", description: "회원 ID" },
      limit:    { type: "INTEGER", description: "최대 50 (기본 20)" },
    }, required: ["memberId"] },
  },

  /* ───── SIREN 신고·악성민원·법률 (4개) ───── */
  {
    name: "incidents_list",
    description: "사이렌 사건 제보 목록. 카테고리·상태로 필터링.",
    parameters: { type: "OBJECT", properties: {
      status:   { type: "STRING",  description: "pending|reviewing|resolved|rejected" },
      category: { type: "STRING",  description: "카테고리 필터" },
      limit:    { type: "INTEGER", description: "최대 50 (기본 20)" },
    }},
  },
  {
    name: "incidents_detail",
    description: "특정 사건 제보 상세 조회.",
    parameters: { type: "OBJECT", properties: {
      incidentId: { type: "INTEGER", description: "사건 ID" },
    }, required: ["incidentId"] },
  },
  {
    name: "harassment_reports_list",
    description: "악성 민원 신고 목록. 심각도(ai_severity)·상태로 필터.",
    parameters: { type: "OBJECT", properties: {
      status:   { type: "STRING",  description: "pending|reviewing|resolved" },
      severity: { type: "STRING",  description: "low|medium|high|critical" },
      limit:    { type: "INTEGER", description: "최대 50 (기본 20)" },
    }},
  },
  {
    name: "legal_consultations_list",
    description: "법률 상담 요청 목록.",
    parameters: { type: "OBJECT", properties: {
      status: { type: "STRING",  description: "pending|matched|completed" },
      limit:  { type: "INTEGER", description: "최대 50 (기본 20)" },
    }},
  },

  /* ───── 게시판·캠페인 (4개) ───── */
  {
    name: "board_posts_list",
    description: "자유게시판 글 목록. 카테고리·인기순 필터.",
    parameters: { type: "OBJECT", properties: {
      category: { type: "STRING",  description: "카테고리" },
      sortBy:   { type: "STRING",  description: "recent|views|likes (기본 recent)" },
      limit:    { type: "INTEGER", description: "최대 50 (기본 20)" },
    }},
  },
  {
    name: "campaigns_list",
    description: "캠페인 목록 — 상태별 필터.",
    parameters: { type: "OBJECT", properties: {
      status: { type: "STRING",  description: "draft|active|ended|cancelled" },
      limit:  { type: "INTEGER", description: "최대 30 (기본 20)" },
    }},
  },
  {
    name: "campaigns_detail",
    description: "특정 캠페인 상세 (목표·모금 진행률).",
    parameters: { type: "OBJECT", properties: {
      campaignId: { type: "INTEGER", description: "캠페인 ID" },
    }, required: ["campaignId"] },
  },

  /* ───── 워크스페이스·알림 (3개) ───── */
  {
    name: "tasks_list",
    description: "워크스페이스 태스크 목록 — 본인 또는 특정 회원 담당.",
    parameters: { type: "OBJECT", properties: {
      status:   { type: "STRING",  description: "todo|in_progress|done|archived" },
      memberId: { type: "INTEGER", description: "담당자 ID (선택)" },
      limit:    { type: "INTEGER", description: "최대 50 (기본 20)" },
    }},
  },
  {
    name: "notifications_recent",
    description: "특정 회원의 최근 알림 조회.",
    parameters: { type: "OBJECT", properties: {
      memberId: { type: "INTEGER", description: "회원 ID" },
      limit:    { type: "INTEGER", description: "최대 30 (기본 10)" },
    }, required: ["memberId"] },
  },
  {
    name: "kpi_summary",
    description: "전체 KPI 요약 — 회원·후원·신고·게시판 핵심 숫자 한 번에.",
    parameters: { type: "OBJECT", properties: {} },
  },
];

/* =========================================================
   도구 실행 핸들러 — 모든 함수가 dry-run 우선
   ========================================================= */

export interface ToolResult {
  ok: boolean;
  output?: any;
  preview?: any;
  rollbackData?: any;
  error?: string;
}

export async function executeTool(
  name: string,
  args: any,
  adminId: number | null,
): Promise<ToolResult> {
  try {
    switch (name) {
      /* 콘텐츠·관리 */
      case "content_pages_list":   return await tool_contentPagesList(args);
      case "content_pages_update": return await tool_contentPagesUpdate(args, adminId);
      case "notice_create":        return await tool_noticeCreate(args, adminId);
      case "campaign_create":      return await tool_campaignCreate(args, adminId);
      case "nav_menus_list":       return await tool_navMenusList(args);
      /* 회원 */
      case "members_search":       return await tool_membersSearch(args);
      case "members_detail":       return await tool_membersDetail(args);
      case "members_stats":        return await tool_membersStats();
      case "members_recent":       return await tool_membersRecent(args);
      /* 후원 */
      case "donations_recent":     return await tool_donationsRecent(args);
      case "donations_stats":      return await tool_donationsStats(args);
      case "donations_by_member":  return await tool_donationsByMember(args);
      /* 신고 */
      case "incidents_list":       return await tool_incidentsList(args);
      case "incidents_detail":     return await tool_incidentsDetail(args);
      case "harassment_reports_list": return await tool_harassmentList(args);
      case "legal_consultations_list": return await tool_legalList(args);
      /* 게시판·캠페인 */
      case "board_posts_list":     return await tool_boardPostsList(args);
      case "campaigns_list":       return await tool_campaignsList(args);
      case "campaigns_detail":     return await tool_campaignsDetail(args);
      /* 워크스페이스·알림·KPI */
      case "tasks_list":           return await tool_tasksList(args);
      case "notifications_recent": return await tool_notificationsRecent(args);
      case "kpi_summary":          return await tool_kpiSummary();
      default:
        return { ok: false, error: `알 수 없는 도구: ${name}` };
    }
  } catch (err: any) {
    return { ok: false, error: String(err?.message || err).slice(0, 500) };
  }
}

/* ─────────────────────────────────────────
   콘텐츠·관리
   ───────────────────────────────────────── */

async function tool_contentPagesList(args: any): Promise<ToolResult> {
  const keyFilter = String(args?.keyFilter || "").trim();
  const limit = Math.min(Number(args?.limit) || 30, 100);
  const where = keyFilter ? sql`WHERE page_key ILIKE ${`%${keyFilter}%`}` : sql``;
  const r: any = await db.execute(sql`
    SELECT page_key, content, updated_at FROM content_pages ${where}
     ORDER BY updated_at DESC LIMIT ${limit}
  `);
  const rows = r?.rows ?? r ?? [];
  return { ok: true, output: { count: rows.length, pages: rows.map((p: any) => ({
    pageKey: p.page_key,
    contentPreview: String(p.content || "").slice(0, 300),
    updatedAt: p.updated_at,
  })) } };
}

async function tool_contentPagesUpdate(args: any, adminId: number | null): Promise<ToolResult> {
  const pageKey = String(args?.pageKey || "").trim();
  const newContent = String(args?.newContent || "");
  const requireApproval = args?.requireApproval !== false;
  if (!pageKey) return { ok: false, error: "pageKey 필수" };
  if (!newContent) return { ok: false, error: "newContent 필수" };
  const cur: any = await db.execute(sql`SELECT page_key, content FROM content_pages WHERE page_key = ${pageKey} LIMIT 1`);
  const curRow = (cur?.rows ?? cur ?? [])[0];
  if (!curRow) return { ok: false, error: `페이지 키 '${pageKey}' 없음` };
  if (requireApproval) return { ok: true, preview: {
    pageKey, before: String(curRow.content || "").slice(0, 500),
    after: newContent.slice(0, 500),
    message: "승인 후 requireApproval=false로 다시 호출하세요.",
  }};
  await db.execute(sql`
    UPDATE content_pages SET content = ${newContent}, updated_at = NOW(), updated_by = ${adminId}
     WHERE page_key = ${pageKey}
  `);
  return { ok: true, output: { pageKey, applied: true, message: "적용 완료" },
    rollbackData: { pageKey, prevContent: curRow.content } };
}

async function tool_noticeCreate(args: any, adminId: number | null): Promise<ToolResult> {
  const title = String(args?.title || "").trim().slice(0, 200);
  const body  = String(args?.body  || "").trim();
  const category = ["notice","event","press"].includes(String(args?.category)) ? String(args.category) : "notice";
  const requireApproval = args?.requireApproval !== false;
  if (!title) return { ok: false, error: "title 필수" };
  if (!body)  return { ok: false, error: "body 필수" };
  if (requireApproval) return { ok: true, preview: { title, category, bodyPreview: body.slice(0, 500),
    message: "승인 후 requireApproval=false로 다시 호출하세요." } };
  try {
    const r: any = await db.execute(sql`
      INSERT INTO board_posts (member_id, title, content, category, created_at, updated_at)
      VALUES (${adminId}, ${title}, ${body}, ${category}, NOW(), NOW())
      RETURNING id
    `);
    const id = Number((r?.rows ?? r ?? [])[0]?.id) || 0;
    return { ok: true, output: { id, title, category, message: `공지 #${id} 등록 완료` } };
  } catch (err: any) { return { ok: false, error: `공지 등록 실패: ${err?.message?.slice(0, 200)}` }; }
}

async function tool_campaignCreate(args: any, adminId: number | null): Promise<ToolResult> {
  const name = String(args?.name || "").trim().slice(0, 100);
  const description = String(args?.description || "").trim();
  const goalAmount = Number(args?.goalAmount) || 0;
  const endDate = args?.endDate ? String(args.endDate) : null;
  const requireApproval = args?.requireApproval !== false;
  if (!name) return { ok: false, error: "name 필수" };
  if (goalAmount <= 0) return { ok: false, error: "goalAmount 양수 필수" };
  if (requireApproval) return { ok: true, preview: { name, goalAmount, endDate,
    descriptionPreview: description.slice(0, 300),
    message: "승인 후 requireApproval=false로 다시 호출하세요." } };
  try {
    const r: any = await db.execute(sql`
      INSERT INTO campaigns (title, description, goal_amount, status, created_at, updated_at)
      VALUES (${name}, ${description}, ${goalAmount}, 'active', NOW(), NOW())
      RETURNING id
    `);
    const id = Number((r?.rows ?? r ?? [])[0]?.id) || 0;
    return { ok: true, output: { id, name, goalAmount, message: `캠페인 #${id} 등록 완료` } };
  } catch (err: any) { return { ok: false, error: `캠페인 등록 실패: ${err?.message?.slice(0, 200)}` }; }
}

async function tool_navMenusList(args: any): Promise<ToolResult> {
  const location = ["header","footer"].includes(String(args?.location)) ? String(args.location) : "header";
  try {
    const r: any = await db.execute(sql`
      SELECT id, title, url, parent_id, sort_order, is_active FROM nav_menus
       WHERE menu_location = ${location} AND is_active = true
       ORDER BY parent_id NULLS FIRST, sort_order ASC LIMIT 100
    `);
    const rows = r?.rows ?? r ?? [];
    return { ok: true, output: { location, count: rows.length, menus: rows } };
  } catch (err: any) { return { ok: false, error: `메뉴 조회 실패: ${err?.message?.slice(0, 200)}` }; }
}

/* ─────────────────────────────────────────
   회원
   ───────────────────────────────────────── */

async function tool_membersSearch(args: any): Promise<ToolResult> {
  const q = String(args?.query || "").trim();
  if (!q) return { ok: false, error: "query 필수" };
  const limit = Math.min(Number(args?.limit) || 20, 30);
  const typeFilter = ["regular","family","volunteer","admin"].includes(String(args?.type))
    ? sql`AND type = ${args.type}` : sql``;
  const r: any = await db.execute(sql`
    SELECT id, name, email, phone, type, status, created_at FROM members
     WHERE (name ILIKE ${`%${q}%`} OR email ILIKE ${`%${q}%`} OR phone ILIKE ${`%${q}%`})
       ${typeFilter}
     ORDER BY id DESC LIMIT ${limit}
  `);
  const rows = r?.rows ?? r ?? [];
  return { ok: true, output: { count: rows.length, members: rows } };
}

async function tool_membersDetail(args: any): Promise<ToolResult> {
  const id = Number(args?.memberId);
  if (!id) return { ok: false, error: "memberId 필수" };
  const r: any = await db.execute(sql`
    SELECT id, name, email, phone, type, status, role, created_at, last_login_at,
           donor_type, prospect_subtype, prospect_event_name
      FROM members WHERE id = ${id} LIMIT 1
  `);
  const row = (r?.rows ?? r ?? [])[0];
  if (!row) return { ok: false, error: `회원 #${id} 없음` };
  return { ok: true, output: { member: row } };
}

async function tool_membersStats(): Promise<ToolResult> {
  const r: any = await db.execute(sql`
    SELECT
      type,
      status,
      COUNT(*)::int AS count
    FROM members
    GROUP BY type, status
    ORDER BY type, status
  `);
  const rows = r?.rows ?? r ?? [];
  const totalRes: any = await db.execute(sql`SELECT COUNT(*)::int AS total FROM members`);
  const total = Number((totalRes?.rows ?? totalRes)[0]?.total) || 0;
  return { ok: true, output: { total, breakdown: rows } };
}

async function tool_membersRecent(args: any): Promise<ToolResult> {
  const limit = Math.min(Number(args?.limit) || 10, 50);
  const r: any = await db.execute(sql`
    SELECT id, name, email, type, status, created_at FROM members
     ORDER BY created_at DESC LIMIT ${limit}
  `);
  const rows = r?.rows ?? r ?? [];
  return { ok: true, output: { count: rows.length, members: rows } };
}

/* ─────────────────────────────────────────
   후원
   ───────────────────────────────────────── */

async function tool_donationsRecent(args: any): Promise<ToolResult> {
  const limit = Math.min(Number(args?.limit) || 20, 50);
  const status = args?.status ? String(args.status) : null;
  const where = status ? sql`WHERE status = ${status}` : sql``;
  const r: any = await db.execute(sql`
    SELECT id, member_id, donor_name, amount, type, status, pay_method, created_at FROM donations
      ${where}
     ORDER BY created_at DESC LIMIT ${limit}
  `);
  const rows = r?.rows ?? r ?? [];
  return { ok: true, output: { count: rows.length, donations: rows } };
}

async function tool_donationsStats(args: any): Promise<ToolResult> {
  const months = Math.min(Number(args?.months) || 1, 12);
  const r: any = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE status='completed')::int AS completed_count,
      COALESCE(SUM(amount) FILTER (WHERE status='completed'), 0)::bigint AS completed_sum,
      COUNT(*) FILTER (WHERE type='regular' AND status='completed')::int AS regular_count,
      COUNT(*) FILTER (WHERE type='one_time' AND status='completed')::int AS onetime_count
    FROM donations
    WHERE created_at >= NOW() - (${months}::int * INTERVAL '1 month')
  `);
  const stats = (r?.rows ?? r ?? [])[0] || {};
  return { ok: true, output: { months, ...stats } };
}

async function tool_donationsByMember(args: any): Promise<ToolResult> {
  const memberId = Number(args?.memberId);
  if (!memberId) return { ok: false, error: "memberId 필수" };
  const limit = Math.min(Number(args?.limit) || 20, 50);
  const r: any = await db.execute(sql`
    SELECT id, amount, type, status, pay_method, created_at FROM donations
     WHERE member_id = ${memberId}
     ORDER BY created_at DESC LIMIT ${limit}
  `);
  const rows = r?.rows ?? r ?? [];
  const sumRes: any = await db.execute(sql`
    SELECT COALESCE(SUM(amount), 0)::bigint AS total
      FROM donations WHERE member_id = ${memberId} AND status = 'completed'
  `);
  const total = Number((sumRes?.rows ?? sumRes)[0]?.total) || 0;
  return { ok: true, output: { memberId, totalAmountCompleted: total, count: rows.length, donations: rows } };
}

/* ─────────────────────────────────────────
   SIREN 신고
   ───────────────────────────────────────── */

async function tool_incidentsList(args: any): Promise<ToolResult> {
  const limit = Math.min(Number(args?.limit) || 20, 50);
  const conds: any[] = [];
  if (args?.status) conds.push(sql`status = ${String(args.status)}`);
  if (args?.category) conds.push(sql`category = ${String(args.category)}`);
  const where = conds.length > 0
    ? sql`WHERE ${conds.reduce((a, b, i) => i === 0 ? b : sql`${a} AND ${b}`)}`
    : sql``;
  const r: any = await db.execute(sql`
    SELECT id, slug, title, category, status, occurred_at, location, created_at
      FROM incidents ${where}
     ORDER BY created_at DESC LIMIT ${limit}
  `);
  const rows = r?.rows ?? r ?? [];
  return { ok: true, output: { count: rows.length, incidents: rows } };
}

async function tool_incidentsDetail(args: any): Promise<ToolResult> {
  const id = Number(args?.incidentId);
  if (!id) return { ok: false, error: "incidentId 필수" };
  const r: any = await db.execute(sql`
    SELECT * FROM incidents WHERE id = ${id} LIMIT 1
  `);
  const row = (r?.rows ?? r ?? [])[0];
  if (!row) return { ok: false, error: `사건 #${id} 없음` };
  return { ok: true, output: { incident: row } };
}

async function tool_harassmentList(args: any): Promise<ToolResult> {
  const limit = Math.min(Number(args?.limit) || 20, 50);
  const conds: any[] = [];
  if (args?.status) conds.push(sql`status = ${String(args.status)}`);
  if (args?.severity) conds.push(sql`ai_severity = ${String(args.severity)}`);
  const where = conds.length > 0
    ? sql`WHERE ${conds.reduce((a, b, i) => i === 0 ? b : sql`${a} AND ${b}`)}`
    : sql``;
  const r: any = await db.execute(sql`
    SELECT id, report_no, member_id, category, title, status, ai_severity, created_at
      FROM harassment_reports ${where}
     ORDER BY created_at DESC LIMIT ${limit}
  `);
  const rows = r?.rows ?? r ?? [];
  return { ok: true, output: { count: rows.length, reports: rows } };
}

async function tool_legalList(args: any): Promise<ToolResult> {
  const limit = Math.min(Number(args?.limit) || 20, 50);
  const where = args?.status ? sql`WHERE status = ${String(args.status)}` : sql``;
  const r: any = await db.execute(sql`
    SELECT id, consultation_no, member_id, category, title, status, created_at
      FROM legal_consultations ${where}
     ORDER BY created_at DESC LIMIT ${limit}
  `);
  const rows = r?.rows ?? r ?? [];
  return { ok: true, output: { count: rows.length, consultations: rows } };
}

/* ─────────────────────────────────────────
   게시판·캠페인
   ───────────────────────────────────────── */

async function tool_boardPostsList(args: any): Promise<ToolResult> {
  const limit = Math.min(Number(args?.limit) || 20, 50);
  const sortBy = String(args?.sortBy || "recent");
  const orderBy = sortBy === "views" ? sql`views DESC, id DESC`
                : sortBy === "likes" ? sql`like_count DESC, id DESC`
                : sql`id DESC`;
  const where = args?.category ? sql`WHERE category = ${String(args.category)}` : sql``;
  const r: any = await db.execute(sql`
    SELECT id, post_no, member_id, title, category, views, like_count, is_pinned, created_at
      FROM board_posts ${where}
     ORDER BY ${orderBy} LIMIT ${limit}
  `);
  const rows = r?.rows ?? r ?? [];
  return { ok: true, output: { count: rows.length, posts: rows } };
}

async function tool_campaignsList(args: any): Promise<ToolResult> {
  const limit = Math.min(Number(args?.limit) || 20, 30);
  const where = args?.status ? sql`WHERE status = ${String(args.status)}` : sql``;
  const r: any = await db.execute(sql`
    SELECT id, slug, type, title, status, goal_amount, raised_amount, created_at
      FROM campaigns ${where}
     ORDER BY id DESC LIMIT ${limit}
  `);
  const rows = r?.rows ?? r ?? [];
  return { ok: true, output: { count: rows.length, campaigns: rows } };
}

async function tool_campaignsDetail(args: any): Promise<ToolResult> {
  const id = Number(args?.campaignId);
  if (!id) return { ok: false, error: "campaignId 필수" };
  const r: any = await db.execute(sql`SELECT * FROM campaigns WHERE id = ${id} LIMIT 1`);
  const row = (r?.rows ?? r ?? [])[0];
  if (!row) return { ok: false, error: `캠페인 #${id} 없음` };
  const progress = row.goal_amount > 0
    ? Math.round((Number(row.raised_amount || 0) / Number(row.goal_amount)) * 100) : 0;
  return { ok: true, output: { campaign: row, progressPercent: progress } };
}

/* ─────────────────────────────────────────
   워크스페이스·알림·KPI
   ───────────────────────────────────────── */

async function tool_tasksList(args: any): Promise<ToolResult> {
  const limit = Math.min(Number(args?.limit) || 20, 50);
  const conds: any[] = [];
  if (args?.status) conds.push(sql`status = ${String(args.status)}`);
  if (args?.memberId) conds.push(sql`member_id = ${Number(args.memberId)}`);
  const where = conds.length > 0
    ? sql`WHERE ${conds.reduce((a, b, i) => i === 0 ? b : sql`${a} AND ${b}`)}`
    : sql``;
  const r: any = await db.execute(sql`
    SELECT id, member_id, title, status, priority, due_date, progress, created_at
      FROM workspace_tasks ${where}
     ORDER BY due_date ASC NULLS LAST, id DESC LIMIT ${limit}
  `);
  const rows = r?.rows ?? r ?? [];
  return { ok: true, output: { count: rows.length, tasks: rows } };
}

async function tool_notificationsRecent(args: any): Promise<ToolResult> {
  const memberId = Number(args?.memberId);
  if (!memberId) return { ok: false, error: "memberId 필수" };
  const limit = Math.min(Number(args?.limit) || 10, 30);
  const r: any = await db.execute(sql`
    SELECT id, category, severity, title, message, is_read, created_at FROM notifications
     WHERE recipient_id = ${memberId}
     ORDER BY created_at DESC LIMIT ${limit}
  `);
  const rows = r?.rows ?? r ?? [];
  return { ok: true, output: { count: rows.length, notifications: rows } };
}

async function tool_kpiSummary(): Promise<ToolResult> {
  try {
    const r: any = await db.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM members WHERE status = 'active') AS active_members,
        (SELECT COUNT(*)::int FROM members WHERE created_at >= NOW() - INTERVAL '30 days') AS new_members_30d,
        (SELECT COALESCE(SUM(amount), 0)::bigint FROM donations
           WHERE status = 'completed' AND created_at >= DATE_TRUNC('month', NOW())) AS donation_sum_this_month,
        (SELECT COUNT(*)::int FROM donations
           WHERE status = 'completed' AND created_at >= DATE_TRUNC('month', NOW())) AS donation_count_this_month,
        (SELECT COUNT(*)::int FROM incidents WHERE status = 'pending') AS incidents_pending,
        (SELECT COUNT(*)::int FROM harassment_reports WHERE status = 'pending') AS harassment_pending,
        (SELECT COUNT(*)::int FROM legal_consultations WHERE status = 'pending') AS legal_pending,
        (SELECT COUNT(*)::int FROM campaigns WHERE status = 'active') AS active_campaigns
    `);
    const row = (r?.rows ?? r ?? [])[0] || {};
    return { ok: true, output: { kpi: row } };
  } catch (err: any) { return { ok: false, error: `KPI 조회 실패: ${err?.message?.slice(0, 200)}` }; }
}
