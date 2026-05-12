// lib/ai-agent-tools.ts
// AI 에이전트가 호출할 수 있는 SIREN 도구 정의 + 실행 핸들러
// 콘텐츠·관리 영역 1주차 MVP — 5개 도구

import { sql } from "drizzle-orm";
import { db } from "../db";

/* =========================================================
   Gemini Function Declaration 형식 — JSONSchema 부분집합
   ========================================================= */

export const TOOL_DECLARATIONS = [
  {
    name: "content_pages_list",
    description: "협의회 콘텐츠 페이지(메인·about·소개 등)의 현재 본문을 조회합니다. 페이지 키 일부 또는 전체 목록.",
    parameters: {
      type: "object",
      properties: {
        keyFilter: {
          type: "string",
          description: "페이지 키 부분 일치 검색 (예: 'home_hero'). 비우면 전체 목록 반환.",
        },
        limit: { type: "integer", description: "최대 반환 개수 (기본 30)" },
      },
    },
  },
  {
    name: "content_pages_update",
    description: "특정 콘텐츠 페이지의 본문을 수정합니다. 변경 전 값을 자동 백업합니다. 사용자 명시 승인 후에만 호출하세요.",
    parameters: {
      type: "object",
      properties: {
        pageKey: { type: "string", description: "페이지 키 (예: 'home_hero_title')" },
        newContent: { type: "string", description: "새 본문 (HTML 또는 텍스트)" },
        requireApproval: {
          type: "boolean",
          description: "true면 dry-run으로 미리보기만 반환. false면 실제 적용. 기본 true.",
        },
      },
      required: ["pageKey", "newContent"],
    },
  },
  {
    name: "notice_create",
    description: "공지사항을 새로 등록합니다. 사용자 승인 후 호출하세요.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "공지 제목 (최대 200자)" },
        body: { type: "string", description: "공지 본문 (HTML 또는 마크다운)" },
        category: {
          type: "string",
          description: "분류: notice|event|press 중 하나. 기본 notice.",
        },
        requireApproval: { type: "boolean", description: "true면 dry-run, false면 즉시 등록. 기본 true." },
      },
      required: ["title", "body"],
    },
  },
  {
    name: "campaign_create",
    description: "새 후원 캠페인을 등록합니다. 사용자 승인 후 호출하세요.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "캠페인명 (최대 100자)" },
        description: { type: "string", description: "캠페인 설명" },
        goalAmount: { type: "integer", description: "목표 금액 (원)" },
        endDate: { type: "string", description: "종료일 YYYY-MM-DD (선택)" },
        requireApproval: { type: "boolean", description: "true면 dry-run. 기본 true." },
      },
      required: ["name", "description", "goalAmount"],
    },
  },
  {
    name: "nav_menus_list",
    description: "네비게이션 메뉴 트리(헤더/푸터)를 조회합니다. 메뉴 수정 전 현재 상태 확인용.",
    parameters: {
      type: "object",
      properties: {
        location: {
          type: "string",
          description: "위치: header|footer. 기본 header.",
        },
      },
    },
  },
];

/* =========================================================
   도구 실행 핸들러 — 모든 함수가 dry-run 우선
   ========================================================= */

export interface ToolResult {
  ok: boolean;
  output?: any;
  preview?: any;        /* dry-run 시 미리보기 데이터 */
  rollbackData?: any;   /* 변경 전 값 백업 */
  error?: string;
}

export async function executeTool(
  name: string,
  args: any,
  adminId: number | null,
): Promise<ToolResult> {
  try {
    switch (name) {
      case "content_pages_list":   return await tool_contentPagesList(args);
      case "content_pages_update": return await tool_contentPagesUpdate(args, adminId);
      case "notice_create":        return await tool_noticeCreate(args, adminId);
      case "campaign_create":      return await tool_campaignCreate(args, adminId);
      case "nav_menus_list":       return await tool_navMenusList(args);
      default:
        return { ok: false, error: `알 수 없는 도구: ${name}` };
    }
  } catch (err: any) {
    return { ok: false, error: String(err?.message || err).slice(0, 500) };
  }
}

/* ─── 1. content_pages_list ─── */
async function tool_contentPagesList(args: any): Promise<ToolResult> {
  const keyFilter = String(args?.keyFilter || "").trim();
  const limit = Math.min(Number(args?.limit) || 30, 100);

  const where = keyFilter ? sql`WHERE page_key ILIKE ${`%${keyFilter}%`}` : sql``;
  const r: any = await db.execute(sql`
    SELECT page_key, content, updated_at
      FROM content_pages
      ${where}
     ORDER BY updated_at DESC
     LIMIT ${limit}
  `);
  const rows = r?.rows ?? r ?? [];
  return {
    ok: true,
    output: {
      count: rows.length,
      pages: rows.map((p: any) => ({
        pageKey: p.page_key,
        contentPreview: String(p.content || "").slice(0, 300),
        updatedAt: p.updated_at,
      })),
    },
  };
}

/* ─── 2. content_pages_update (dry-run 우선) ─── */
async function tool_contentPagesUpdate(args: any, adminId: number | null): Promise<ToolResult> {
  const pageKey = String(args?.pageKey || "").trim();
  const newContent = String(args?.newContent || "");
  const requireApproval = args?.requireApproval !== false;

  if (!pageKey) return { ok: false, error: "pageKey 필수" };
  if (!newContent) return { ok: false, error: "newContent 필수" };

  /* 현재 값 조회 (백업) */
  const cur: any = await db.execute(sql`
    SELECT page_key, content FROM content_pages WHERE page_key = ${pageKey} LIMIT 1
  `);
  const curRow = (cur?.rows ?? cur ?? [])[0];
  if (!curRow) return { ok: false, error: `페이지 키 '${pageKey}' 없음` };

  if (requireApproval) {
    return {
      ok: true,
      preview: {
        pageKey,
        before: String(curRow.content || "").slice(0, 500),
        after: newContent.slice(0, 500),
        message: "이대로 적용하시려면 사용자 승인 후 requireApproval=false로 다시 호출하세요.",
      },
    };
  }

  /* 실제 적용 */
  await db.execute(sql`
    UPDATE content_pages
       SET content = ${newContent}, updated_at = NOW(), updated_by = ${adminId}
     WHERE page_key = ${pageKey}
  `);
  return {
    ok: true,
    output: { pageKey, applied: true, message: "적용 완료" },
    rollbackData: { pageKey, prevContent: curRow.content },
  };
}

/* ─── 3. notice_create (dry-run 우선) ─── */
async function tool_noticeCreate(args: any, adminId: number | null): Promise<ToolResult> {
  const title = String(args?.title || "").trim().slice(0, 200);
  const body = String(args?.body || "").trim();
  const category = ["notice", "event", "press"].includes(String(args?.category))
    ? String(args.category) : "notice";
  const requireApproval = args?.requireApproval !== false;

  if (!title) return { ok: false, error: "title 필수" };
  if (!body) return { ok: false, error: "body 필수" };

  if (requireApproval) {
    return {
      ok: true,
      preview: { title, category, bodyPreview: body.slice(0, 500),
        message: "사용자 승인 후 requireApproval=false로 다시 호출하세요." },
    };
  }

  /* 공지 등록 — 실제 테이블명 확인 후 INSERT */
  try {
    const r: any = await db.execute(sql`
      INSERT INTO board_posts (board_type, title, content, category, author_id, created_at, updated_at)
      VALUES ('notice', ${title}, ${body}, ${category}, ${adminId}, NOW(), NOW())
      RETURNING id
    `);
    const newId = Number((r?.rows ?? r ?? [])[0]?.id) || 0;
    return { ok: true, output: { id: newId, title, category, message: `공지 #${newId} 등록 완료` } };
  } catch (err: any) {
    /* 테이블명 다르면 대체 시도 */
    return { ok: false, error: `공지 등록 실패: ${err?.message?.slice(0, 200)}` };
  }
}

/* ─── 4. campaign_create (dry-run 우선) ─── */
async function tool_campaignCreate(args: any, adminId: number | null): Promise<ToolResult> {
  const name = String(args?.name || "").trim().slice(0, 100);
  const description = String(args?.description || "").trim();
  const goalAmount = Number(args?.goalAmount) || 0;
  const endDate = args?.endDate ? String(args.endDate) : null;
  const requireApproval = args?.requireApproval !== false;

  if (!name) return { ok: false, error: "name 필수" };
  if (!description) return { ok: false, error: "description 필수" };
  if (goalAmount <= 0) return { ok: false, error: "goalAmount는 양수여야 합니다" };

  if (requireApproval) {
    return {
      ok: true,
      preview: { name, goalAmount, endDate, descriptionPreview: description.slice(0, 300),
        message: "사용자 승인 후 requireApproval=false로 다시 호출하세요." },
    };
  }

  try {
    const r: any = await db.execute(sql`
      INSERT INTO campaigns (name, description, goal_amount, end_date, status, created_by, created_at, updated_at)
      VALUES (${name}, ${description}, ${goalAmount}, ${endDate}::date, 'active', ${adminId}, NOW(), NOW())
      RETURNING id
    `);
    const newId = Number((r?.rows ?? r ?? [])[0]?.id) || 0;
    return { ok: true, output: { id: newId, name, goalAmount, message: `캠페인 #${newId} 등록 완료` } };
  } catch (err: any) {
    return { ok: false, error: `캠페인 등록 실패: ${err?.message?.slice(0, 200)}` };
  }
}

/* ─── 5. nav_menus_list (읽기 전용) ─── */
async function tool_navMenusList(args: any): Promise<ToolResult> {
  const location = ["header", "footer"].includes(String(args?.location))
    ? String(args.location) : "header";

  try {
    const r: any = await db.execute(sql`
      SELECT id, title, url, parent_id, sort_order, is_active
        FROM nav_menus
       WHERE location = ${location} AND is_active = true
       ORDER BY parent_id NULLS FIRST, sort_order ASC
       LIMIT 100
    `);
    const rows = r?.rows ?? r ?? [];
    return { ok: true, output: { location, count: rows.length, menus: rows } };
  } catch (err: any) {
    return { ok: false, error: `메뉴 조회 실패: ${err?.message?.slice(0, 200)}` };
  }
}
