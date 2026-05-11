/**
 * lib/natural-search.ts
 *
 * 자연어 검색어를 Gemini로 SQL 필터 JSON으로 변환하는 헬퍼.
 * admin-workspace-task-search.ts에서 사용.
 */
import { callGeminiJSON } from "./ai-gemini";

export interface NaturalSearchFilter {
  assigneeName?: string;
  assigneeUid?: number;
  status?: string[];
  priority?: string[];
  dueWithin?: "today" | "thisweek" | "thismonth" | "overdue";
  textQuery?: string;
}

const PROMPT_TEMPLATE = `사용자 검색어를 SQL 필터 JSON으로 변환하세요.

사용 가능한 필드:
- assigneeName: 담당자 이름 (문자열)
- assigneeUid: 담당자 ID (숫자)
- status: 상태 배열 ["todo","doing","done","blocked"] 중 하나 이상
- priority: 우선순위 배열 ["urgent","high","normal","low"] 중 하나 이상
- dueWithin: "today" | "thisweek" | "thismonth" | "overdue"
- textQuery: 제목/설명 키워드 검색

예시 입력: "이번 주 마감 + 박OO 담당"
예시 출력: { "assigneeName": "박OO", "dueWithin": "thisweek" }

예시 입력: "긴급 + 진행 중"
예시 출력: { "priority": ["urgent"], "status": ["doing"] }

예시 입력: "회의 준비"
예시 출력: { "textQuery": "회의 준비" }

관련 없는 필드는 포함하지 마세요. JSON만 반환하세요.

사용자 검색어: `;

export async function parseNaturalSearchQuery(
  query: string
): Promise<NaturalSearchFilter> {
  const prompt = PROMPT_TEMPLATE + `"${query}"`;

  const result = await callGeminiJSON<NaturalSearchFilter>(prompt, {
    temperature: 0.1,
    maxOutputTokens: 300,
    mode: "flash",
  });

  if (!result.ok || !result.data) {
    return {};
  }

  const raw = result.data as any;
  const filter: NaturalSearchFilter = {};

  if (typeof raw.assigneeName === "string") filter.assigneeName = raw.assigneeName;
  if (typeof raw.assigneeUid === "number") filter.assigneeUid = raw.assigneeUid;
  if (Array.isArray(raw.status) && raw.status.length > 0) filter.status = raw.status;
  if (Array.isArray(raw.priority) && raw.priority.length > 0) filter.priority = raw.priority;
  if (["today", "thisweek", "thismonth", "overdue"].includes(raw.dueWithin)) {
    filter.dueWithin = raw.dueWithin;
  }
  if (typeof raw.textQuery === "string" && raw.textQuery.trim()) {
    filter.textQuery = raw.textQuery.trim();
  }

  return filter;
}
