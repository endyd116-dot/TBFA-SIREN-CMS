/**
 * /api/admin-workspace-task-search
 *
 * Phase 21 R4 — WBS 자연어 검색
 *
 * POST { query: "이번 주 마감 + 박OO 담당" }
 *   → Gemini가 JSON 필터로 변환 → SQL 쿼리 → workspaceTasks 결과 반환
 *
 * 응답:
 *   { ok, data: { items, interpretedFilter, aiCallDurationMs } }
 *
 * AI 실패 시:
 *   { ok: false, error: "AI 검색에 실패했어요. 키워드 검색을 사용해주세요.", step: "call_ai" }
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { workspaceTasks, members } from "../../db/schema";
import { eq, and, or, desc, sql, lte, gte, ilike, inArray } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";
import { parseNaturalSearchQuery } from "../../lib/natural-search";

export const config = { path: "/api/admin-workspace-task-search" };

function jsonError(step: string, error: string, err?: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error, step,
    detail: err ? String(err?.message || err).slice(0, 500) : undefined,
    stack: err?.stack ? String(err.stack).slice(0, 1000) : undefined,
  }), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

function jsonOk(data: any) {
  return new Response(JSON.stringify({ ok: true, data }),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

export default async (req: Request, _ctx: Context) => {
  /* ── auth ── */
  let step = "auth";
  try {
    const guard = await requireAdmin(req);
    if (!guard.ok) return (guard as { ok: false; res: Response }).res;
    const adminMember = guard.ctx.member;
    const meId = adminMember.id;
    const isSuperAdmin = (adminMember as any).role === "super_admin";

    if (req.method !== "POST") {
      return jsonError("method", "POST 메서드만 허용됩니다", undefined, 405);
    }

    /* ── validate ── */
    step = "validate";
    let body: any;
    try { body = await req.json(); } catch {
      return jsonError(step, "JSON 본문 파싱 실패", undefined, 400);
    }
    const query = typeof body?.query === "string" ? body.query.trim() : "";
    if (!query || query.length < 1 || query.length > 200) {
      return jsonError(step, "query는 1~200자 문자열이 필요합니다", undefined, 400);
    }

    /* ── call_ai ── */
    step = "call_ai";
    const aiStart = Date.now();

    // timeout 10초 wrapper
    let filter: Awaited<ReturnType<typeof parseNaturalSearchQuery>>;
    try {
      const filterPromise = parseNaturalSearchQuery(query);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("AI 호출 timeout")), 10000)
      );
      filter = await Promise.race([filterPromise, timeoutPromise]);
    } catch (err: any) {
      return jsonError("call_ai", "AI 검색에 실패했어요. 키워드 검색을 사용해주세요.", err);
    }

    const aiCallDurationMs = Date.now() - aiStart;

    /* ── parse_json (filter가 비어있는 경우 textQuery 폴백) ── */
    step = "parse_json";
    if (Object.keys(filter).length === 0) {
      filter = { textQuery: query };
    }

    /* ── query_db ── */
    step = "query_db";
    const conds: any[] = [];

    // 범위: 본인 소유/담당/지시 작업만 (super_admin은 전체). ★ Q3-041: 아래 담당자 이름·UID 필터는 이 범위와
    //   AND(교집합)로 결합 — 일반 관리자는 "본인 범위 내의 그 담당자" 작업만 노출(타인 작업 누출 없음·의도된 스코핑).
    if (!isSuperAdmin) {
      conds.push(or(
        eq(workspaceTasks.memberId, meId),
        eq(workspaceTasks.assignedTo, meId),
        eq(workspaceTasks.assignedBy, meId)
      ));
    }

    // 담당자 이름 → 먼저 UID 조회
    if (filter.assigneeName) {
      try {
        const matched: any = await db
          .select({ id: members.id })
          .from(members)
          .where(ilike(members.name, `%${filter.assigneeName}%`))
          .limit(10);
        const uids = matched.map((m: any) => m.id).filter(Boolean);
        if (uids.length > 0) {
          conds.push(inArray(workspaceTasks.assignedTo, uids));
        } else {
          // 이름과 일치하는 담당자 없음 → 결과 없음 보장
          conds.push(sql`FALSE`);
        }
      } catch (err: any) {
        return jsonError("query_db", "담당자 조회 실패", err);
      }
    }

    if (filter.assigneeUid) {
      conds.push(eq(workspaceTasks.assignedTo, filter.assigneeUid));
    }

    if (filter.status && filter.status.length > 0) {
      conds.push(inArray(workspaceTasks.status, filter.status));
    }

    if (filter.priority && filter.priority.length > 0) {
      conds.push(inArray(workspaceTasks.priority, filter.priority));
    }

    if (filter.dueWithin) {
      const now = new Date();
      const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      const weekEnd = new Date(todayEnd.getTime() + (7 - (todayEnd.getDay() || 7)) * 86400000);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

      switch (filter.dueWithin) {
        case "today":
          conds.push(lte(workspaceTasks.dueDate, todayEnd));
          conds.push(gte(workspaceTasks.dueDate, new Date(now.getFullYear(), now.getMonth(), now.getDate())));
          break;
        case "thisweek":
          conds.push(lte(workspaceTasks.dueDate, weekEnd));
          conds.push(gte(workspaceTasks.dueDate, new Date()));
          break;
        case "thismonth":
          conds.push(lte(workspaceTasks.dueDate, monthEnd));
          conds.push(gte(workspaceTasks.dueDate, new Date()));
          break;
        case "overdue":
          conds.push(lte(workspaceTasks.dueDate, new Date()));
          conds.push(sql`${workspaceTasks.status} != 'done'`);
          break;
      }
    }

    if (filter.textQuery) {
      conds.push(sql`(${workspaceTasks.title} ILIKE ${"%" + filter.textQuery + "%"}
                   OR ${workspaceTasks.description} ILIKE ${"%" + filter.textQuery + "%"})`);
    }

    /* ── map ── */
    step = "map";
    const rows: any = await db
      .select({
        id: workspaceTasks.id,
        title: workspaceTasks.title,
        status: workspaceTasks.status,
        priority: workspaceTasks.priority,
        dueDate: workspaceTasks.dueDate,
        assignedTo: workspaceTasks.assignedTo,
        assignedBy: workspaceTasks.assignedBy,
        memberId: workspaceTasks.memberId,
        progress: workspaceTasks.progress,
        tags: workspaceTasks.tags,
        aiRiskScore: workspaceTasks.aiRiskScore,
        createdAt: workspaceTasks.createdAt,
        // P1-9: 검색 결과 카드를 열어 저장할 때 설명·체크리스트가 빈 값으로 덮어써지지 않도록 전체 필드 포함
        description: workspaceTasks.description,
        checklistItems: workspaceTasks.checklistItems,
        estimatedHours: workspaceTasks.estimatedHours,
        actualHours: workspaceTasks.actualHours,
        bookmarkedBy: workspaceTasks.bookmarkedBy,
      })
      .from(workspaceTasks)
      .where(conds.length > 0 ? and(...conds) : undefined)
      .orderBy(desc(workspaceTasks.dueDate))
      .limit(50);

    // 담당자 이름 보강
    const assigneeIds = [...new Set(rows.map((r: any) => r.assignedTo).filter(Boolean))] as number[];
    let nameMap: Record<number, string> = {};
    if (assigneeIds.length > 0) {
      try {
        const mList: any = await db
          .select({ id: members.id, name: members.name })
          .from(members)
          .where(sql`${members.id} = ANY(${assigneeIds})`);
        for (const m of mList) nameMap[m.id] = m.name;
      } catch { /* 보조 쿼리 실패 시 무시 */ }
    }

    const items = rows.map((r: any) => ({
      ...r,
      assignedToName: r.assignedTo ? (nameMap[r.assignedTo] || null) : null,
    }));

    return jsonOk({
      items,
      interpretedFilter: filter,
      aiCallDurationMs,
    });

  } catch (err: any) {
    console.error("[admin-workspace-task-search] error:", err);
    return jsonError(step, "자연어 검색 처리 중 오류", err);
  }
};
