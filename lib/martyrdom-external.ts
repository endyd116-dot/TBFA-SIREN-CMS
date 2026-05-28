/**
 * lib/martyrdom-external.ts — R43 딥릴리프 외부 자료 헬퍼
 *
 * exports:
 *   runExternalResearch(queries[], engines[]) — Gemini Search Grounding + 네이버 검색
 *   dedupeRows(rows, byUrl)                   — URL 기준 중복 제거
 *   parseGeminiCitations(text, citations)     — Gemini citation 응답 → external row 변환
 *   promoteToCase(externalId, reviewerUid)    — 외부 자료 → martyrdom_cases 승급 + RAG 색인
 *
 * 의존:
 *   - lib/ai-gemini.ts callGeminiWithSearch (googleSearchRetrieval tool)
 *   - lib/ai-embedding.ts embedText
 *   - 네이버 검색은 fetch 직접 호출 (날짜 필터·1주 제한 없는 변형)
 *
 * RAG 격리:
 *   - 외부 자료는 source_type='martyr_external'로만 색인 (검토 전 신청서 검색에서 제외)
 *   - 승급 시 'martyr_external' 청크 삭제 → 'martyr_case' 청크로 재색인
 */
import { db } from "../db";
import { sql } from "drizzle-orm";
import { callGeminiWithSearch, GeminiCitation } from "./ai-gemini";
import { embedText } from "./ai-embedding";

const MARTYRDOM_EXTERNAL_FEATURE = "martyrdom_ai_external";

/* =========================================================
   타입
   ========================================================= */
export type SearchEngine = "gemini" | "naver";

export interface ExternalRow {
  title: string;
  sourceUrl: string;
  sourceDomain: string;
  searchEngine: SearchEngine;
  searchQuery: string;
  snippet: string;
  contentFull?: string;
  publishedAt?: Date | null;
  meta?: Record<string, any>;
}

export interface RunResearchResult {
  ok: boolean;
  inserted: number;
  duplicated: number;
  rows: ExternalRow[];
  errors: string[];
}

/* =========================================================
   유틸 — 도메인 추출 / dedupe
   ========================================================= */
export function extractDomain(url: string): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    /* http(s):// 없이 들어온 경우 — 최소 정제 */
    const m = url.match(/^([^\/]+)/);
    return m ? m[1].replace(/^www\./, "") : "";
  }
}

export function dedupeRows(rows: ExternalRow[], _byUrl: "url" = "url"): ExternalRow[] {
  const seen = new Set<string>();
  const out: ExternalRow[] = [];
  for (const r of rows) {
    const key = (r.sourceUrl || "").trim();
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/* =========================================================
   네이버 검색 (날짜 필터 없는 변형 — R43 전용)
     기존 lib/naver-search.ts는 최근 1주 필터가 강제됨(여론 분석용).
     외부 자료(판례·정부 발표)는 오래된 자료도 의미 있어 필터 없는 변형 사용.
   ========================================================= */
const NAVER_CLIENT_ID     = process.env.NAVER_SEARCH_CLIENT_ID     || "";
const NAVER_CLIENT_SECRET = process.env.NAVER_SEARCH_CLIENT_SECRET || "";

function stripHtml(s: string): string {
  return String(s || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .trim();
}

async function searchNaverOnce(query: string, scope: "news" | "webkr" = "news", display = 20): Promise<ExternalRow[]> {
  if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
    throw new Error("NAVER_SEARCH_CLIENT_ID / NAVER_SEARCH_CLIENT_SECRET 환경변수가 설정되지 않았습니다.");
  }
  const url = `https://openapi.naver.com/v1/search/${scope}.json?query=${encodeURIComponent(query)}&display=${display}&sort=sim`;
  const res = await fetch(url, {
    headers: {
      "X-Naver-Client-Id":     NAVER_CLIENT_ID,
      "X-Naver-Client-Secret": NAVER_CLIENT_SECRET,
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error(`네이버 검색 API (${scope} "${query}") ${res.status}`);
  }
  const data: any = await res.json();
  const raw: any[] = data?.items ?? [];
  return raw.map((it: any) => {
    const title = stripHtml(it.title || "");
    const link  = String(it.link || it.originallink || "");
    const desc  = stripHtml(it.description || "");
    let pub: Date | null = null;
    try { if (it.pubDate) pub = new Date(it.pubDate); } catch { /* ignore */ }
    return {
      title:        title || "(제목 없음)",
      sourceUrl:    link,
      sourceDomain: extractDomain(link),
      searchEngine: "naver" as SearchEngine,
      searchQuery:  query,
      snippet:      desc.slice(0, 500),
      publishedAt:  pub,
      meta:         { naverThumbnail: it.thumbnail || undefined, scope },
    };
  }).filter(r => r.sourceUrl);
}

/* =========================================================
   Gemini Search Grounding 호출 + citation 추출
   ========================================================= */
export interface ParsedGeminiSearch {
  rows: ExternalRow[];
  rawText: string;
}

export function parseGeminiCitations(
  query: string,
  text: string,
  citations: GeminiCitation[],
  whitelistDomains: string[] = [],
): ExternalRow[] {
  const allCitations = (citations || []).filter(c => c && c.uri);
  const inWhitelist = (host: string) =>
    !whitelistDomains.length ? true
      : whitelistDomains.some(d => host === d || host.endsWith("." + d));

  /* citation별 1행 — 본문에서 해당 URL과 인접한 문장(스니펫) 추출은 어려워
     Gemini 응답 전체를 contentFull로 보존 + 첫 200자를 모든 citation에 공통 snippet으로. */
  const headSnippet = (text || "").replace(/\s+/g, " ").slice(0, 500);
  const rows: ExternalRow[] = [];
  for (const c of allCitations) {
    const domain = extractDomain(c.uri);
    if (!inWhitelist(domain)) continue;
    rows.push({
      title:        (c.title || "").slice(0, 500) || domain || "(출처 제목 없음)",
      sourceUrl:    c.uri,
      sourceDomain: domain,
      searchEngine: "gemini",
      searchQuery:  query,
      snippet:      headSnippet,
      contentFull:  text || undefined,
      publishedAt:  null,
      meta:         { geminiCitations: allCitations.map(x => x.uri) },
    });
  }
  return rows;
}

async function searchGeminiOnce(query: string, whitelistDomains: string[]): Promise<ExternalRow[]> {
  /* whitelist를 prompt에 힌트로 — 도메인 우선 검색 유도 (Gemini Search Grounding은 site:연산자 직접 지원 X) */
  const hintList = whitelistDomains.slice(0, 12).join(", ");
  const prompt = `다음 한국어 검색어에 대해 인터넷에서 신뢰할 수 있는 한국 정부·법원·주요 언론 출처를 우선 조사하세요. 결과는 핵심 사실·일자·관련 법령·시사점 중심으로 5~12문장 한국어 요약으로 작성하고, 가능한 한 다음 도메인의 자료를 우선 사용하세요: ${hintList}.

검색어: ${query}`;

  const r = await callGeminiWithSearch(prompt, {
    featureKey: MARTYRDOM_EXTERNAL_FEATURE,
    mode: "flash",
    temperature: 0.3,
    maxOutputTokens: 1500,
    internalBulk: true,         // 일괄 수집 — surge 면제 (월cap·토글은 그대로)
    timeoutMs: 40000,
  });
  if (!r.ok || r.disabled) {
    const reason = r.disabled ? (r.disabledReason || "disabled") : (r.error || "Gemini 호출 실패");
    throw new Error(reason);
  }
  return parseGeminiCitations(query, r.text || "", r.citations || [], whitelistDomains);
}

/* =========================================================
   메인 — runExternalResearch
     queries × engines 조합으로 검색·dedupe·DB INSERT
   ========================================================= */
export async function runExternalResearch(
  queries: string[],
  engines: SearchEngine[],
): Promise<RunResearchResult> {
  const result: RunResearchResult = { ok: true, inserted: 0, duplicated: 0, rows: [], errors: [] };

  /* 설정 — 화이트리스트 도메인 */
  let whitelistDomains: string[] = [];
  try {
    const s: any = await db.execute(sql`SELECT whitelist_domains FROM martyrdom_external_settings ORDER BY id ASC LIMIT 1`);
    const row = (s?.rows ?? s ?? [])[0];
    if (Array.isArray(row?.whitelist_domains)) whitelistDomains = row.whitelist_domains as string[];
  } catch { /* 설정 미존재 — 빈 화이트리스트 (전 도메인 허용) */ }

  const collected: ExternalRow[] = [];

  for (const q of queries) {
    for (const eng of engines) {
      try {
        const rows = eng === "gemini"
          ? await searchGeminiOnce(q, whitelistDomains)
          : await searchNaverOnce(q, "news", 20);
        collected.push(...rows);
      } catch (err: any) {
        result.errors.push(`${eng} "${q.slice(0, 50)}": ${String(err?.message || err).slice(0, 200)}`);
      }
    }
  }

  const deduped = dedupeRows(collected);

  /* 기존 DB에 이미 있는 URL은 스킵 (멱등) */
  for (const row of deduped) {
    try {
      const dup: any = await db.execute(sql`
        SELECT id FROM martyrdom_external_research WHERE source_url = ${row.sourceUrl} LIMIT 1
      `);
      const hit = (dup?.rows ?? dup ?? [])[0];
      if (hit) { result.duplicated++; continue; }

      const metaJson = JSON.stringify(row.meta || {});
      const publishedAtIso = row.publishedAt ? row.publishedAt.toISOString() : null;
      await db.execute(sql`
        INSERT INTO martyrdom_external_research
          (title, source_url, source_domain, search_engine, search_query,
           published_at, snippet, content_full, status, meta)
        VALUES
          (${row.title.slice(0, 500)}, ${row.sourceUrl}, ${row.sourceDomain},
           ${row.searchEngine}, ${row.searchQuery},
           ${publishedAtIso}, ${row.snippet || null}, ${row.contentFull || null},
           'pending', ${metaJson}::jsonb)
      `);
      result.inserted++;
      result.rows.push(row);
    } catch (err: any) {
      result.errors.push(`INSERT 실패 (${row.sourceUrl?.slice(0, 80)}): ${String(err?.message || err).slice(0, 150)}`);
    }
  }

  if (result.errors.length && result.inserted === 0) result.ok = false;
  return result;
}

/* =========================================================
   RAG 색인 — 외부 자료 1건을 martyr_external로 색인 (검토 전 격리)
     promote 시 'martyr_external' 청크는 삭제하고 'martyr_case'로 재색인.
   ========================================================= */
const EXT_CHUNK_CHARS = 1500;

function chunkText(text: string, sourceRef: string, title: string): Array<{ title: string; content: string; sourceRef: string }> {
  const paragraphs = String(text || "").split(/\n\n+/);
  const chunks: Array<{ title: string; content: string; sourceRef: string }> = [];
  let buf = "";
  let idx = 0;
  const flush = () => {
    const content = buf.trim();
    if (content.length < 30) { buf = ""; return; }
    chunks.push({ title: title.slice(0, 200), content, sourceRef: `${sourceRef}#${idx++}` });
    buf = "";
  };
  for (const para of paragraphs) {
    if (buf.length + para.length > EXT_CHUNK_CHARS && buf.length > 0) flush();
    buf += (buf ? "\n\n" : "") + para;
  }
  flush();
  return chunks;
}

export async function indexExternalToRag(externalId: number): Promise<{ ok: boolean; indexed: number; error?: string }> {
  try {
    const r: any = await db.execute(sql`
      SELECT title, snippet, content_full AS "contentFull"
        FROM martyrdom_external_research WHERE id = ${externalId} LIMIT 1
    `);
    const row = (r?.rows ?? r ?? [])[0];
    if (!row) return { ok: false, indexed: 0, error: "외부 자료 없음" };
    const body = String(row.contentFull || row.snippet || "");
    if (body.length < 30) return { ok: true, indexed: 0 };

    const refBase = `martyr-external:${externalId}`;
    /* 기존 동일 청크 삭제(멱등 재색인) */
    await db.execute(sql`
      DELETE FROM ai_rag_documents
       WHERE source_type = 'martyr_external'
         AND source_ref LIKE ${refBase + "#%"}
    `);
    let indexed = 0;
    const chunks = chunkText(body, refBase, String(row.title || "외부 자료"));
    for (const ch of chunks) {
      try {
        const embedding = await embedText(ch.content);
        const vecLiteral = `[${embedding.join(",")}]`;
        await db.execute(sql`
          INSERT INTO ai_rag_documents (source_type, source_ref, title, content, embedding, created_at)
          VALUES ('martyr_external', ${ch.sourceRef}, ${ch.title}, ${ch.content.slice(0, 4000)}, ${vecLiteral}::vector, NOW())
          ON CONFLICT (source_ref) DO UPDATE
            SET source_type = EXCLUDED.source_type, content = EXCLUDED.content, embedding = EXCLUDED.embedding, title = EXCLUDED.title
        `);
        indexed++;
      } catch (embedErr: any) {
        console.warn(`[indexExternalToRag] 청크 임베딩 실패 ${ch.sourceRef}: ${embedErr?.message}`);
      }
    }
    return { ok: true, indexed };
  } catch (err: any) {
    return { ok: false, indexed: 0, error: String(err?.message || err).slice(0, 300) };
  }
}

/* =========================================================
   promoteToCase — 외부 자료 1건을 martyrdom_cases 새 행으로 승급 + RAG 키 전환
     1) martyrdom_cases 새 행 INSERT (case_kind='reference' — 설계서 §3 정합·AI 수집 시각 구분은 promoted_case_id로)
     2) martyrdom_external_research status='approved', reviewed_*, promoted_case_id 설정
     3) ai_rag_documents에서 'martyr_external' 청크 삭제 → 'martyr_case' 청크로 재색인
   ========================================================= */
export async function promoteToCase(externalId: number, reviewerUid: number): Promise<{ ok: boolean; promotedCaseId?: number; error?: string }> {
  try {
    /* 외부 자료 조회 */
    const er: any = await db.execute(sql`
      SELECT id, title, source_url AS "sourceUrl", source_domain AS "sourceDomain",
             search_engine AS "searchEngine", search_query AS "searchQuery",
             published_at AS "publishedAt", snippet, content_full AS "contentFull",
             status, meta
        FROM martyrdom_external_research WHERE id = ${externalId} LIMIT 1
    `);
    const ext = (er?.rows ?? er ?? [])[0];
    if (!ext) return { ok: false, error: "외부 자료 없음" };
    if (String(ext.status) === "approved") return { ok: false, error: "이미 승급된 자료입니다" };

    /* case_no 발급 — EXT-YYYY-MMDD-{seq} 패턴 (martyrdom_cases.case_no UNIQUE) */
    const today = new Date();
    const ymd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
    const cntRes: any = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM martyrdom_cases WHERE case_no LIKE ${"EXT-" + ymd + "-%"}
    `);
    const seq = Number((cntRes?.rows ?? cntRes ?? [])[0]?.n || 0) + 1;
    const caseNo = `EXT-${ymd}-${String(seq).padStart(3, "0")}`;

    const title = String(ext.title || "외부 자료 사례").slice(0, 200);
    const occurredSummary = String(ext.contentFull || ext.snippet || "").slice(0, 4000);

    /* martyrdom_cases INSERT — case_kind='reference'(설계서 §3 정합·기존 사건 종류 enum과 호환), outcome=NULL(검토자가 추후 설정) */
    const ins: any = await db.execute(sql`
      INSERT INTO martyrdom_cases
        (case_no, case_kind, title, occurred_summary, status, created_by, created_at, updated_at)
      VALUES
        (${caseNo}, 'reference', ${title}, ${occurredSummary}, 'closed', ${reviewerUid}, NOW(), NOW())
      RETURNING id
    `);
    const promotedCaseId = Number((ins?.rows ?? ins ?? [])[0]?.id);
    if (!promotedCaseId) return { ok: false, error: "사건 INSERT 실패" };

    /* external row 갱신 */
    await db.execute(sql`
      UPDATE martyrdom_external_research
         SET status='approved', reviewed_by_uid=${reviewerUid}, reviewed_at=NOW(),
             promoted_case_id=${promotedCaseId}
       WHERE id = ${externalId}
    `);

    /* RAG 키 전환 — 'martyr_external' 청크 삭제 후 'martyr_case'로 재색인 */
    try {
      const refBase = `martyr-external:${externalId}`;
      await db.execute(sql`
        DELETE FROM ai_rag_documents
         WHERE source_type='martyr_external' AND source_ref LIKE ${refBase + "#%"}
      `);
    } catch (e: any) {
      console.warn(`[promoteToCase] martyr_external 청크 삭제 실패: ${e?.message}`);
    }

    /* martyr_case 색인 — indexApprovedReport 패턴 차용(application 문서 없으면 본문 직접 색인) */
    if (occurredSummary.length > 30) {
      const refBase = `external-promoted:${externalId}:case${promotedCaseId}`;
      const chunks = chunkText(occurredSummary, refBase, `외부 자료 승급 — ${caseNo}`);
      for (const ch of chunks) {
        try {
          const embedding = await embedText(ch.content);
          const vecLiteral = `[${embedding.join(",")}]`;
          await db.execute(sql`
            INSERT INTO ai_rag_documents (source_type, source_ref, case_id, title, content, embedding, created_at)
            VALUES ('martyr_case', ${ch.sourceRef}, ${promotedCaseId}, ${ch.title}, ${ch.content.slice(0, 4000)}, ${vecLiteral}::vector, NOW())
            ON CONFLICT (source_ref) DO UPDATE
              SET source_type = EXCLUDED.source_type, content = EXCLUDED.content, embedding = EXCLUDED.embedding,
                  case_id = EXCLUDED.case_id, title = EXCLUDED.title
          `);
        } catch (embedErr: any) {
          console.warn(`[promoteToCase] 청크 임베딩 실패 ${ch.sourceRef}: ${embedErr?.message}`);
        }
      }
    }

    return { ok: true, promotedCaseId };
  } catch (err: any) {
    return { ok: false, error: String(err?.message || err).slice(0, 300) };
  }
}
