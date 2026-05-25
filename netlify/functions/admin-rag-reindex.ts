/**
 * POST /api/admin-rag-reindex
 * Q&A jsonl + 메뉴얼 청킹 → embedText → ai_rag_documents UPSERT
 * super_admin 전용. 반복 실행 가능(멱등 UPSERT).
 */
import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { embedText, chunkManual } from "../../lib/ai-embedding";
import { recordFeatureUsage } from "../../lib/ai-feature";
import * as fs from "fs";
import * as path from "path";

export const config = { path: "/api/admin-rag-reindex" };

const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };
const RAG_FEATURE_KEY = "ai_rag_search";

function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false,
    error: "재색인 실패",
    step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status, headers: JSON_HEADER });
}

/* ─── JSONL 파싱 ─── */
interface QnaEntry { question: string; answer: string }

function parseJsonl(text: string): QnaEntry[] {
  const results: QnaEntry[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed);
      if (obj.question && obj.answer) {
        results.push({ question: String(obj.question), answer: String(obj.answer) });
      }
    } catch { /* malformed line — skip */ }
  }
  return results;
}

/* ─── UPSERT 1건 ─── */
async function upsertDoc(
  sourceType: string,
  sourceRef: string,
  title: string,
  content: string,
  embedding: number[],
  tokenCount: number,
) {
  const vectorLiteral = `[${embedding.join(",")}]`;
  await db.execute(sql`
    INSERT INTO ai_rag_documents
      (source_type, source_ref, title, content, embedding, token_count, updated_at)
    VALUES
      (${sourceType}, ${sourceRef}, ${title}, ${content}, ${vectorLiteral}::vector, ${tokenCount}, now())
    ON CONFLICT (source_ref) DO UPDATE SET
      title       = EXCLUDED.title,
      content     = EXCLUDED.content,
      embedding   = EXCLUDED.embedding,
      token_count = EXCLUDED.token_count,
      updated_at  = now()
  `);
}

/* ─── 파일 읽기 헬퍼 (Netlify Functions 환경 — process.cwd() 기준) ─── */
function readFileSafe(relPath: string): string {
  try {
    const abs = path.resolve(process.cwd(), relPath);
    return fs.readFileSync(abs, "utf-8");
  } catch {
    return "";
  }
}

export default async function handler(req: Request, ctx: Context) {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "POST만 허용" }), { status: 405, headers: JSON_HEADER });
  }

  let step = "auth";
  try {
    const auth = await requireAdmin(req);
    if (!auth.ok) return (auth as any).res;

    const startMs = Date.now();
    let qnaCount = 0;
    let manualCount = 0;
    let totalInputTokens = 0;

    /* ── §1. Q&A jsonl 로드 ── */
    step = "load_qna";
    const JSONL_FILES = [
      "docs/manual/ai-training-cms-1.jsonl",
      "docs/manual/ai-training-cms-2.jsonl",
      "docs/manual/ai-training-ai-assistant.jsonl",
      "docs/manual/ai-training-siren-admin.jsonl",
      "docs/manual/ai-training-siren-user.jsonl",
      "docs/manual/ai-training-memorial.jsonl",
    ];

    const allQna: QnaEntry[] = [];
    for (const filePath of JSONL_FILES) {
      const text = readFileSafe(filePath);
      if (text) allQna.push(...parseJsonl(text));
    }

    /* ── §2. 메뉴얼 HTML + knowledge.md 청킹 ── */
    step = "load_manual";
    const manualChunks: Array<{ title: string; content: string; sourceRef: string }> = [];

    const manualFiles: Array<{ path: string; type: "html" | "md" }> = [
      { path: "public/manual.html",        type: "html" },
      { path: "public/manual-admin.html",  type: "html" },
      { path: "docs/manual/ai-assistant-knowledge.md", type: "md" },
    ];
    for (const f of manualFiles) {
      const text = readFileSafe(f.path);
      if (text) manualChunks.push(...chunkManual(text, f.type));
    }

    /* ── §3. 임베딩 + UPSERT ── */
    step = "embed";

    /* Q&A 처리 */
    for (let i = 0; i < allQna.length; i++) {
      const { question, answer } = allQna[i];
      const content = `Q: ${question}\nA: ${answer}`;
      const sourceRef = `qna#${i + 1}`;
      try {
        const emb = await embedText(content);
        await upsertDoc("qna", sourceRef, question, content, emb, Math.ceil(content.length / 4));
        totalInputTokens += Math.ceil(content.length / 4);
        qnaCount++;
      } catch (e) {
        console.warn(`[rag-reindex] Q&A #${i + 1} 임베딩 실패:`, (e as any)?.message);
      }
    }

    step = "upsert";

    /* 메뉴얼 처리 */
    for (const chunk of manualChunks) {
      try {
        const emb = await embedText(chunk.content);
        await upsertDoc("manual", chunk.sourceRef, chunk.title, chunk.content, emb, Math.ceil(chunk.content.length / 4));
        totalInputTokens += Math.ceil(chunk.content.length / 4);
        manualCount++;
      } catch (e) {
        console.warn(`[rag-reindex] 메뉴얼 청크 ${chunk.sourceRef} 임베딩 실패:`, (e as any)?.message);
      }
    }

    step = "summary";
    const elapsedMs = Date.now() - startMs;
    const indexed = qnaCount + manualCount;

    /* 비용 기록 (fire-and-forget) */
    try {
      await recordFeatureUsage({
        featureKey: RAG_FEATURE_KEY,
        model: "text-embedding-004",
        inputTokens: totalInputTokens,
        outputTokens: 0,
        adminId: (auth as any).ctx?.admin?.id ?? null,
        durationMs: elapsedMs,
        success: true,
      });
    } catch { /* 비용 기록 실패는 무시 */ }

    return new Response(JSON.stringify({
      ok: true,
      data: { indexed, qna: qnaCount, manual: manualCount, elapsedMs },
    }), { headers: JSON_HEADER });

  } catch (err: any) {
    return jsonError(step, err);
  }
}
