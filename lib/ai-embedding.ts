/**
 * RAG 검색 인프라 — 임베딩·검색·청킹 헬퍼
 * - embedText: Gemini text-embedding-004 (768차원)
 * - searchRag: 코사인 유사도 top-K 검색
 * - chunkManual: HTML·마크다운 헤더 단위 청킹
 */
import { db } from "../db";
import { sql } from "drizzle-orm";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const EMBED_MODEL = "text-embedding-004";
const EMBED_DIM = 768;
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
  const body = {
    model: `models/${EMBED_MODEL}`,
    content: { parts: [{ text }] },
  };

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
export async function searchRag(query: string, topK = 5): Promise<RagHit[]> {
  try {
    const embedding = await embedText(query);
    const vectorLiteral = `[${embedding.join(",")}]`;

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
    return rows.map((row: any) => ({
      id: Number(row.id),
      sourceType: String(row.sourceType || ""),
      sourceRef: String(row.sourceRef || ""),
      title: row.title ? String(row.title) : null,
      content: String(row.content || ""),
      score: Number(row.score) || 0,
    }));
  } catch (err) {
    console.warn("[ai-embedding] searchRag 실패 — 빈 배열 반환", (err as any)?.message);
    return [];
  }
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
