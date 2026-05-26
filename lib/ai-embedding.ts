/**
 * RAG 검색 인프라 — 임베딩·검색·청킹 헬퍼
 * - embedText: Gemini text-embedding-004 (768차원)
 * - searchRag: 코사인 유사도 top-K 검색
 * - chunkManual: HTML·마크다운 헤더 단위 청킹
 */
import { db } from "../db";
import { sql } from "drizzle-orm";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
/* 모델명·차원은 환경변수로 교체 가능 — 키마다 지원 임베딩 모델이 달라 404 날 수 있음.
   사용 가능 모델은 /api/admin-rag-status?diag=models 로 조회.
   text-embedding-004(768)·embedding-001(768)·gemini-embedding-001(3072·outputDimensionality로 축소 가능) */
const EMBED_MODEL = process.env.GEMINI_EMBED_MODEL || "text-embedding-004";
/* ai_rag_documents.embedding 컬럼이 vector(768)이므로 기대 차원 기본 768.
   3072 모델을 쓰려면 GEMINI_EMBED_OUTPUT_DIM=768로 축소 출력(컬럼 유지). */
const EMBED_OUTPUT_DIM = process.env.GEMINI_EMBED_OUTPUT_DIM
  ? Number(process.env.GEMINI_EMBED_OUTPUT_DIM)
  : null;
const EMBED_DIM = EMBED_OUTPUT_DIM || Number(process.env.GEMINI_EMBED_DIM) || 768;
const MAX_CHUNK_CHARS = 1500;

export interface RagHit {
  id: number;
  sourceType: string;
  sourceRef: string;
  title: string | null;
  content: string;
  score: number;
}

export interface Chunk {
  title: string;
  content: string;
  sourceRef: string;
}

/* =========================================================
   임베딩 호출
   ========================================================= */
export async function embedText(text: string): Promise<number[]> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent?key=${GEMINI_API_KEY}`;
  const body: any = {
    model: `models/${EMBED_MODEL}`,
    content: { parts: [{ text }] },
  };
  /* 3072차원 모델(gemini-embedding-001 등)을 768로 축소 출력해 컬럼 호환 유지 */
  if (EMBED_OUTPUT_DIM) body.outputDimensionality = EMBED_OUTPUT_DIM;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Gemini embedding 호출 실패 (${res.status}): ${errText.slice(0, 300)}`);
  }

  const json: any = await res.json();
  /* Gemini embedding 응답 경로: embedding.values */
  const values: number[] = json?.embedding?.values;
  if (!Array.isArray(values) || values.length !== EMBED_DIM) {
    throw new Error(`임베딩 차원 불일치 — 기대 ${EMBED_DIM}, 실제 ${values?.length ?? "없음"}`);
  }
  return values;
}

/* =========================================================
   RAG 검색 — 코사인 유사도 top-K
   ========================================================= */
/**
 * @param query       검색 쿼리
 * @param topK        반환 최대 건수
 * @param sourceTypes 필터할 source_type 목록 (생략 시 전체·하위호환)
 *                    순직 분석: ['martyr_active','martyr_case','martyr_law']
 * @param caseId      martyr_active 검색 시 특정 사건만 격리 (사건별 민감정보 분리)
 */
export async function searchRag(
  query: string,
  topK = 5,
  sourceTypes?: string[],
  caseId?: number,
): Promise<RagHit[]> {
  try {
    const embedding = await embedText(query);
    const vectorLiteral = `[${embedding.join(",")}]`;

    /* sourceTypes 필터 없으면 기존과 동일(전체) */
    if (!sourceTypes || sourceTypes.length === 0) {
      const r: any = await db.execute(sql`
        SELECT
          id,
          source_type AS "sourceType",
          source_ref  AS "sourceRef",
          title,
          content,
          1 - (embedding <=> ${vectorLiteral}::vector) AS score
        FROM ai_rag_documents
        WHERE embedding IS NOT NULL
        ORDER BY embedding <=> ${vectorLiteral}::vector
        LIMIT ${topK}
      `);
      const rows: any[] = r?.rows ?? r ?? [];
      return rows.map((row: any) => mapRagRow(row));
    }

    /* sourceTypes 있을 때 — 문자열 안전 처리 후 raw SQL */
    const safeMime = (t: string) => t.replace(/[^a-z_]/g, "");
    const typeList = sourceTypes.map(t => `'${safeMime(t)}'`).join(",");
    const hasMartyrActive = sourceTypes.includes("martyr_active");
    const safeVec = vectorLiteral; // 이미 숫자 배열이므로 injection 없음
    const safeTopK = Math.min(50, Math.max(1, Number(topK)));
    const safeCaseId = caseId != null ? Number(caseId) : null;

    /* martyr_active는 case_id 강제 격리 */
    let caseFilter = "";
    if (hasMartyrActive && safeCaseId !== null) {
      caseFilter = `AND (
        (source_type = 'martyr_active' AND case_id = ${safeCaseId})
        OR source_type != 'martyr_active'
      )`;
    }

    const r: any = await db.execute(sql.raw(`
      SELECT
        id,
        source_type AS "sourceType",
        source_ref  AS "sourceRef",
        title,
        content,
        1 - (embedding <=> '${safeVec}'::vector) AS score
      FROM ai_rag_documents
      WHERE embedding IS NOT NULL
        AND source_type IN (${typeList})
        ${caseFilter}
      ORDER BY embedding <=> '${safeVec}'::vector
      LIMIT ${safeTopK}
    `));

    const rows: any[] = r?.rows ?? r ?? [];
    return rows.map((row: any) => mapRagRow(row));
  } catch (err) {
    console.warn("[ai-embedding] searchRag 실패 — 빈 배열 반환", (err as any)?.message);
    return [];
  }
}

function mapRagRow(row: any): RagHit {
  return {
    id: Number(row.id),
    sourceType: String(row.sourceType || row.source_type || ""),
    sourceRef: String(row.sourceRef || row.source_ref || ""),
    title: (row.title) ? String(row.title) : null,
    content: String(row.content || ""),
    score: Number(row.score) || 0,
  };
}

/* =========================================================
   메뉴얼 청킹 — ## / ### 헤더 단위 분할
   ========================================================= */
export function chunkManual(input: string, type: "html" | "md"): Chunk[] {
  const text = type === "html" ? htmlToMarkdown(input) : input;
  return splitByHeaders(text);
}

function htmlToMarkdown(html: string): string {
  return html
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, "\n## $1\n")
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, "\n### $1\n")
    .replace(/<h4[^>]*>(.*?)<\/h4>/gi, "\n#### $1\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<p[^>]*>(.*?)<\/p>/gis, "$1\n")
    .replace(/<li[^>]*>(.*?)<\/li>/gis, "- $1\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function splitByHeaders(md: string): Chunk[] {
  const lines = md.split("\n");
  const chunks: Chunk[] = [];
  let currentTitle = "";
  let currentLines: string[] = [];
  let sectionIdx = 0;

  function flush() {
    const content = currentLines.join("\n").trim();
    if (content.length < 30) return; /* 너무 짧은 청크 스킵 */
    /* MAX_CHUNK_CHARS 초과 시 추가 분할 */
    if (content.length <= MAX_CHUNK_CHARS) {
      chunks.push({
        title: currentTitle,
        content,
        sourceRef: `manual#${slugify(currentTitle)}_${sectionIdx++}`,
      });
    } else {
      /* 긴 청크 — 문단 단위로 재분할 */
      const paragraphs = content.split(/\n\n+/);
      let buf = "";
      let partIdx = 0;
      for (const para of paragraphs) {
        if (buf.length + para.length > MAX_CHUNK_CHARS && buf.length > 0) {
          chunks.push({
            title: `${currentTitle} (${partIdx + 1})`,
            content: buf.trim(),
            sourceRef: `manual#${slugify(currentTitle)}_${sectionIdx}_p${partIdx++}`,
          });
          buf = "";
        }
        buf += (buf ? "\n\n" : "") + para;
      }
      if (buf.trim().length >= 30) {
        chunks.push({
          title: `${currentTitle} (${partIdx + 1})`,
          content: buf.trim(),
          sourceRef: `manual#${slugify(currentTitle)}_${sectionIdx}_p${partIdx}`,
        });
      }
      sectionIdx++;
    }
  }

  for (const line of lines) {
    if (/^#{2,4}\s/.test(line)) {
      flush();
      currentTitle = line.replace(/^#{2,4}\s+/, "").trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }
  flush();
  return chunks;
}

function slugify(s: string): string {
  return (s || "section").replace(/[^\w가-힣]/g, "_").slice(0, 40);
}
