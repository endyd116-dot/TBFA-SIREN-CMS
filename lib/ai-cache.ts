/**
 * AI 도구 결과 메모리 캐시 — Phase 2
 *
 * 목적: AI 비서가 같은 질문을 짧은 시간에 반복하면(예: 사용자가 다시 묻거나,
 *       Gemini가 동일 도구를 연속 호출), DB 조회를 줄여 비용·지연 감소.
 *
 * 정책:
 *   - 읽기 전용 도구만 캐싱 (CACHEABLE_TOOLS 화이트리스트)
 *   - 키: `${toolName}:${JSON.stringify(args)}`
 *   - TTL: 5분 (기본). 짧게 잡아 데이터 신선도 우선.
 *   - 최대 200건 LRU (오래 안 쓴 항목 자동 축출)
 *   - 변경 도구(create/update) 호출 시 관련 캐시 invalidateRelated로 청소
 *
 * 캐시는 함수 인스턴스 메모리 — Netlify의 콜드 스타트마다 초기화됨.
 * 따라서 강한 정합성을 보장하지 않음. 짧은 시간 내 중복 호출만 막는 안전망.
 */

const TTL_MS = 5 * 60 * 1000;         // 5분
const MAX_ENTRIES = 200;

/* 읽기 전용 도구 화이트리스트 — 캐시 가능 */
export const CACHEABLE_TOOLS = new Set<string>([
  /* 회원·후원 */
  "members_search", "members_stats", "members_recent", "members_detail",
  "donations_recent", "donations_stats", "donations_by_member",
  /* SIREN 신고 */
  "incidents_list", "incidents_detail",
  "harassment_reports_list",
  "legal_consultations_list",
  /* 게시판·캠페인 */
  "board_posts_list",
  "campaigns_list", "campaigns_detail",
  /* 워크스페이스·KPI */
  "tasks_list",
  "notifications_recent",
  "kpi_summary",
  /* 콘텐츠·네비 */
  "content_pages_list",
  "nav_menus_list",
  /* 재정 */
  "revenue_categories_list", "revenue_list",
  "expense_categories_list", "expenses_list",
  "pl_summary",
]);

/* 변경 도구 → 무효화할 캐시 키 prefix 매핑.
 * 예: notice_create 호출되면 board_posts_list 캐시 모두 청소 */
const INVALIDATION_MAP: Record<string, string[]> = {
  notice_create:         ["board_posts_list"],
  campaign_create:       ["campaigns_list", "campaigns_detail"],
  content_pages_update:  ["content_pages_list"],
  /* Phase 22-A 매출 — 실제 도구 이름은 revenue_* (도구 키 = INVALIDATION_MAP 키 = 캐시 대상 도구 이름) */
  revenue_create:  ["revenue_list", "pl_summary"],
  revenue_update:  ["revenue_list", "pl_summary"],
  revenue_approve: ["revenue_list", "pl_summary"],
  revenue_refund:  ["revenue_list", "pl_summary"],
  /* Phase 22-C 지출 */
  expense_create:  ["expenses_list", "pl_summary"],
  expense_approve: ["expenses_list", "pl_summary"],
  expense_refund:  ["expenses_list", "pl_summary"],
};

interface Entry {
  value: any;
  expiresAt: number;
  lastAccess: number;
}

const cache = new Map<string, Entry>();

export function buildCacheKey(toolName: string, args: any): string {
  return `${toolName}:${stableStringify(args || {})}`;
}

/** 객체 키 순서를 정렬해서 동일 인자 다른 직렬화 회피 */
function stableStringify(obj: any): string {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(stableStringify).join(",") + "]";
  const keys = Object.keys(obj).sort();
  return "{" + keys.map(k => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}

/** 캐시 hit 시 값 반환, miss/만료/비캐시 도구면 null */
export function tryCacheGet(toolName: string, args: any): any | null {
  if (!CACHEABLE_TOOLS.has(toolName)) return null;
  const key = buildCacheKey(toolName, args);
  const e = cache.get(key);
  if (!e) return null;
  const now = Date.now();
  if (e.expiresAt < now) {
    cache.delete(key);
    return null;
  }
  e.lastAccess = now;
  return e.value;
}

/** 도구 응답을 캐시 저장 (캐시 가능 도구만). LRU로 정원 관리 */
export function cacheSet(toolName: string, args: any, value: any): void {
  if (!CACHEABLE_TOOLS.has(toolName)) return;
  if (value === undefined || value === null) return;
  const key = buildCacheKey(toolName, args);
  const now = Date.now();
  if (cache.size >= MAX_ENTRIES && !cache.has(key)) {
    /* LRU 축출 — lastAccess 가장 오래된 1건 */
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [k, v] of cache.entries()) {
      if (v.lastAccess < oldestTime) { oldestTime = v.lastAccess; oldestKey = k; }
    }
    if (oldestKey) cache.delete(oldestKey);
  }
  cache.set(key, { value, expiresAt: now + TTL_MS, lastAccess: now });
}

/** 변경 도구 호출 시 관련 캐시 청소 */
export function invalidateRelated(toolName: string): number {
  const prefixes = INVALIDATION_MAP[toolName];
  if (!prefixes || prefixes.length === 0) return 0;
  let removed = 0;
  for (const key of Array.from(cache.keys())) {
    for (const prefix of prefixes) {
      if (key.startsWith(prefix + ":")) { cache.delete(key); removed++; break; }
    }
  }
  return removed;
}

export function getCacheStats() {
  let valid = 0;
  const now = Date.now();
  for (const e of cache.values()) {
    if (e.expiresAt >= now) valid++;
  }
  return { size: cache.size, valid, max: MAX_ENTRIES, ttlMs: TTL_MS };
}

export function clearCache(): number {
  const n = cache.size;
  cache.clear();
  return n;
}
