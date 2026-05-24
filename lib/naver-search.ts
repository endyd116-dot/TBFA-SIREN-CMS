/**
 * 네이버 검색 API 래퍼
 *
 * 지원 범위: news / blog / webkr
 * - AbortSignal.timeout(8000) 적용
 * - <b>·HTML 태그 제거
 * - link 기준 dedup
 * - 최근 1주 필터 (news pubDate / blog postdate)
 * - 키워드·범위별 상위 N개 상한
 * - API 키 미설정 시 명시적 에러 (fail-closed)
 */

const CLIENT_ID     = process.env.NAVER_SEARCH_CLIENT_ID     || "";
const CLIENT_SECRET = process.env.NAVER_SEARCH_CLIENT_SECRET || "";

const NAVER_API_BASE = "https://openapi.naver.com/v1/search";

export type NaverSearchScope = "news" | "blog" | "webkr";

export interface NaverSearchItem {
  title: string;
  link: string;
  description: string;
  /** ISO 문자열 또는 원본 날짜 문자열 */
  date: string;
  scope: NaverSearchScope;
  keyword: string;
}

export interface NaverSearchResult {
  ok: boolean;
  items: NaverSearchItem[];
  error?: string;
}

function stripHtml(str: string): string {
  return str.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').trim();
}

/** news: pubDate(RFC2822) / blog: postdate(YYYYMMDD) → Date */
function parseDate(item: any, scope: NaverSearchScope): Date | null {
  try {
    if (scope === "news" && item.pubDate) return new Date(item.pubDate);
    if (scope === "blog" && item.postdate) {
      const s = String(item.postdate);
      return new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`);
    }
  } catch { /* 파싱 실패 무시 */ }
  return null;
}

function isWithinWeek(d: Date | null): boolean {
  if (!d) return true; // 날짜 파싱 불가이면 포함 (webkr 등)
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return d.getTime() >= weekAgo;
}

async function fetchScope(
  keyword: string,
  scope: NaverSearchScope,
  display = 20,
): Promise<NaverSearchItem[]> {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error("NAVER_SEARCH_CLIENT_ID / NAVER_SEARCH_CLIENT_SECRET 환경변수가 설정되지 않았습니다.");
  }

  const url = `${NAVER_API_BASE}/${scope}.json?query=${encodeURIComponent(keyword)}&display=${display}&sort=date`;

  const res = await fetch(url, {
    headers: {
      "X-Naver-Client-Id":     CLIENT_ID,
      "X-Naver-Client-Secret": CLIENT_SECRET,
    },
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`네이버 검색 API 오류 (${scope} "${keyword}"): ${res.status} ${text.slice(0, 200)}`);
  }

  const data: any = await res.json();
  const raw: any[] = data?.items ?? [];

  return raw
    .filter(item => isWithinWeek(parseDate(item, scope)))
    .map(item => {
      const d = parseDate(item, scope);
      return {
        title:       stripHtml(item.title       || ""),
        link:        item.link                   || item.originallink || "",
        description: stripHtml(item.description || ""),
        date:        d ? d.toISOString() : (item.pubDate || item.postdate || ""),
        scope,
        keyword,
      };
    });
}

/**
 * 키워드 목록 × 범위 목록 조합으로 네이버 검색 수집
 *
 * @param keywords  검색 키워드 배열 (예: ["교사유가족", "교권침해"])
 * @param scopes    검색 범위 배열 (기본: ["news"])
 * @param perCombo  조합당 최대 수집 수 (기본: 20, 상한: 100)
 */
export async function collectNaverSearch(
  keywords: string[],
  scopes: NaverSearchScope[] = ["news"],
  perCombo = 20,
): Promise<NaverSearchResult> {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    return {
      ok: false,
      items: [],
      error: "NAVER_SEARCH_CLIENT_ID / NAVER_SEARCH_CLIENT_SECRET 환경변수가 설정되지 않았습니다.",
    };
  }

  const display = Math.min(Math.max(1, perCombo), 100);
  const seenLinks = new Set<string>();
  const allItems: NaverSearchItem[] = [];

  for (const keyword of keywords) {
    for (const scope of scopes) {
      try {
        const items = await fetchScope(keyword, scope, display);
        for (const item of items) {
          if (!item.link || seenLinks.has(item.link)) continue;
          seenLinks.add(item.link);
          allItems.push(item);
        }
      } catch (err: any) {
        console.warn(`[naver-search] 수집 실패 (${scope}/"${keyword}"):`, err?.message?.slice(0, 200));
      }
    }
  }

  return { ok: true, items: allItems };
}
