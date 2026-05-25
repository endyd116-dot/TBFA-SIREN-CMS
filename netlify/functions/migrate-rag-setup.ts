/**
 * GET /api/migrate-rag-setup
 * pgvector 확장 + ai_rag_documents 테이블 생성 (멱등)
 * GET ?run=1 : requireAdmin 인증 후 실행
 * GET (기본) : 진단 모드 (인증 불필요)
 */
import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-rag-setup" };

const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false,
    error: "마이그레이션 실패",
    step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status, headers: JSON_HEADER });
}

export default async function handler(req: Request, ctx: Context) {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  /* 진단 모드 — DB 연결·벡터 확장 상태만 확인 */
  if (!run) {
    let vectorExt = false;
    let tableExists = false;
    try {
      const r: any = await db.execute(sql`SELECT installed_version FROM pg_available_extensions WHERE name = 'vector'`);
      vectorExt = (r?.rows ?? r ?? []).length > 0;
    } catch { /* */ }
    try {
      const r: any = await db.execute(sql`SELECT 1 FROM information_schema.tables WHERE table_name = 'ai_rag_documents' LIMIT 1`);
      tableExists = (r?.rows ?? r ?? []).length > 0;
    } catch { /* */ }
    return new Response(JSON.stringify({
      ok: true, mode: "diagnosis",
      vectorExtAvailable: vectorExt,
      tableExists,
      message: "?run=1 + 어드민 세션으로 실행하세요",
    }), { headers: JSON_HEADER });
  }

  /* 실행 모드 — 어드민 인증 필수 */
  let step = "auth";
  try {
    const auth = await requireAdmin(req);
    if (!auth.ok) return (auth as any).res;

    /* 1. pgvector 확장 활성화 */
    step = "vector_ext";
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);

    /* 2. 테이블 생성 */
    step = "create_table";
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ai_rag_documents (
        id          bigserial PRIMARY KEY,
        source_type varchar(16) NOT NULL,
        source_ref  text NOT NULL,
        title       text,
        content     text NOT NULL,
        embedding   vector(768),
        token_count integer DEFAULT 0,
        created_at  timestamp DEFAULT now(),
        updated_at  timestamp DEFAULT now()
      )
    `);

    /* 3. source_ref 유니크 인덱스 (UPSERT 키) */
    step = "unique_index";
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS ai_rag_documents_src_uq
        ON ai_rag_documents(source_ref)
    `);

    /* 4. HNSW 벡터 인덱스 (코사인 거리) */
    step = "hnsw_index";
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS ai_rag_documents_hnsw
        ON ai_rag_documents USING hnsw (embedding vector_cosine_ops)
    `);

    return new Response(JSON.stringify({
      ok: true,
      message: "pgvector 확장 + ai_rag_documents 테이블·인덱스 생성 완료 (멱등)",
    }), { headers: JSON_HEADER });

  } catch (err: any) {
    return jsonError(step, err);
  }
}
