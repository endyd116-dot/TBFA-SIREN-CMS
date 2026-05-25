/**
 * admin-rag-reindex-background — RAG 전체 재색인 (Netlify Background Function)
 *
 * Netlify Background Function (-background suffix)
 *   · 응답 즉시 202 반환, 백그라운드에서 최대 15분 실행
 *   · Q&A 328개 + 메뉴얼 청크 순차 임베딩은 일반 함수 10초 한도로 불가 → background 필수
 *
 * POST body: { secret }
 *   secret: 내부 호출 검증용 (process.env.INTERNAL_TRIGGER_SECRET) — fail-closed
 *           트리거(admin-rag-reindex)가 같은 env로 secret 전달
 *
 * 진행 현황은 별도 상태 테이블 없이 admin-rag-status GET이
 * ai_rag_documents 문서 수를 직접 집계 → UPSERT 진행에 따라 자연 폴링.
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { embedText, chunkManual } from "../../lib/ai-embedding";
import { recordFeatureUsage } from "../../lib/ai-feature";
import * as fs from "fs";
import * as path from "path";

const RAG_FEATURE_KEY = "ai_rag_search";

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

/* ─── 파일 읽기 (included_files로 번들된 파일 — process.cwd() 기준) ─── */
function readFileSafe(relPath: string): string {
  try {
    const abs = path.resolve(process.cwd(), relPath);
    return fs.readFileSync(abs, "utf-8");
  } catch {
    return "";
  }
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false }), { status: 405 });
  }

  let body: any = {};
  try { body = await req.json(); } catch (_) {}

  /* fail-closed 인증 — 시크릿 없거나 불일치 시 차단 */
  const secret = String(body?.secret || "");
  const expected = process.env.INTERNAL_TRIGGER_SECRET || "";
  if (!expected || secret !== expected) {
    return new Response(JSON.stringify({ ok: false, error: "권한 없음" }), { status: 403 });
  }

  const adminId = Number(body?.adminId) || null;

  const startMs = Date.now();
  let qnaCount = 0;
  let manualCount = 0;
  let totalInputTokens = 0;

  try {
    /* ── §1. Q&A jsonl 로드 ── */
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
    const manualChunks: Array<{ title: string; content: string; sourceRef: string }> = [];
    const manualFiles: Array<{ path: string; type: "html" | "md" }> = [
      { path: "public/manual.html",       type: "html" },
      { path: "public/manual-admin.html", type: "html" },
      { path: "docs/manual/ai-assistant-knowledge.md", type: "md" },
    ];
    for (const f of manualFiles) {
      const text = readFileSafe(f.path);
      if (text) manualChunks.push(...chunkManual(text, f.type));
    }

    console.info(`[rag-reindex-bg] start — Q&A ${allQna.length} · 메뉴얼 청크 ${manualChunks.length}`);

    /* ── §3. 임베딩 + UPSERT ── */
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
        console.warn(`[rag-reindex-bg] Q&A #${i + 1} 임베딩 실패:`, (e as any)?.message);
      }
    }

    for (const chunk of manualChunks) {
      try {
        const emb = await embedText(chunk.content);
        await upsertDoc("manual", chunk.sourceRef, chunk.title, chunk.content, emb, Math.ceil(chunk.content.length / 4));
        totalInputTokens += Math.ceil(chunk.content.length / 4);
        manualCount++;
      } catch (e) {
        console.warn(`[rag-reindex-bg] 메뉴얼 청크 ${chunk.sourceRef} 임베딩 실패:`, (e as any)?.message);
      }
    }

    const elapsedMs = Date.now() - startMs;
    const indexed = qnaCount + manualCount;
    console.info(`[rag-reindex-bg] done — indexed ${indexed} (Q&A ${qnaCount} · 메뉴얼 ${manualCount}) in ${elapsedMs}ms`);

    /* 비용 기록 (fire-and-forget) */
    try {
      await recordFeatureUsage({
        featureKey: RAG_FEATURE_KEY,
        model: "text-embedding-004",
        inputTokens: totalInputTokens,
        outputTokens: 0,
        adminId,
        durationMs: elapsedMs,
        success: true,
      });
    } catch { /* 비용 기록 실패는 무시 */ }

    return new Response(JSON.stringify({
      ok: true,
      data: { indexed, qna: qnaCount, manual: manualCount, elapsedMs },
    }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (err: any) {
    console.error("[rag-reindex-bg] 치명적 실패:", err?.message);
    return new Response(JSON.stringify({ ok: false, error: String(err?.message || err) }), { status: 500 });
  }
};
