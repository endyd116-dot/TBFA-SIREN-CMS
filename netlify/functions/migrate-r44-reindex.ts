/**
 * GET /api/migrate-r44-reindex     — 진단 (인증 불필요·readonly)
 * GET /api/migrate-r44-reindex?run=1 — 실행 (super_admin 인증)
 *
 * R44 BUG-A 사후 처리.
 * 232건 자료가 indexed_to_rag=true로 잘못 마킹돼 있고 ai_rag_documents에 청크 0건.
 * 모두 indexed_to_rag=false + extract_status='queued'로 되돌려 [전체 재시도] 한 번으로 일괄 재색인 가능하게 함.
 *
 * 안전:
 *   - extract_status='done' AND indexed_to_rag=true 인 자료 중
 *     ai_rag_documents에 source_ref LIKE 'doc-{id}%' 행 0건인 자료만 대상
 *   - 이미 정상 색인된 자료(행 1+건)는 건드리지 않음
 *
 * 호출 후 즉시 파일 삭제 (§6.8 1회용).
 */
import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-r44-reindex" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

export default async function handler(req: Request, _ctx: Context) {
  let step = "start";
  try {
    const url = new URL(req.url);
    const run = url.searchParams.get("run") === "1";

    /* ── 진단 ── */
    step = "diag_count_total";
    const totalDone: any = await db.execute(sql.raw(`
      SELECT COUNT(*)::int AS n FROM martyrdom_case_documents
       WHERE extract_status = 'done' AND indexed_to_rag = true
    `));
    const doneCount = (totalDone?.rows ?? totalDone ?? [])[0]?.n || 0;

    step = "diag_count_orphan";
    /* indexed_to_rag=true 인데 ai_rag_documents에 청크 0건인 자료 = 고아 마킹 */
    const orphan: any = await db.execute(sql.raw(`
      SELECT d.id, d.case_id AS "caseId", d.file_name AS "fileName"
        FROM martyrdom_case_documents d
       WHERE d.extract_status = 'done'
         AND d.indexed_to_rag = true
         AND NOT EXISTS (
           SELECT 1 FROM ai_rag_documents r
            WHERE r.source_ref LIKE 'doc-' || d.id || '#%'
              AND r.source_type LIKE 'martyr%'
         )
       ORDER BY d.id DESC
       LIMIT 500
    `));
    const orphanRows = (orphan?.rows ?? orphan ?? []);
    const orphanCount = orphanRows.length;

    if (!run) {
      return new Response(JSON.stringify({
        ok: true, mode: "diagnose",
        doneIndexedCount: doneCount,
        orphanCount,
        sampleOrphans: orphanRows.slice(0, 10),
        hint: doneCount === 0
          ? "처리할 자료 없음"
          : `?run=1 호출 시 ${orphanCount}건을 'queued'+indexed_to_rag=false로 되돌립니다. 어드민이 호출하세요.`,
      }, null, 2), { headers: JSON_HEADER });
    }

    /* ── 실행 ── */
    step = "auth";
    const auth = await requireAdmin(req);
    if (!auth.ok) return (auth as any).res;

    if (orphanCount === 0) {
      return new Response(JSON.stringify({
        ok: true, mode: "executed",
        affected: 0,
        hint: "되돌릴 자료 없음 (이미 모두 정상 색인 또는 다른 상태)",
      }, null, 2), { headers: JSON_HEADER });
    }

    step = "rollback_marking";
    /* 고아 마킹된 자료만 정확히 되돌림 (이미 정상 색인된 자료는 보존) */
    const result: any = await db.execute(sql.raw(`
      UPDATE martyrdom_case_documents
         SET indexed_to_rag = false,
             extract_status = 'queued',
             updated_at = NOW()
       WHERE extract_status = 'done'
         AND indexed_to_rag = true
         AND NOT EXISTS (
           SELECT 1 FROM ai_rag_documents r
            WHERE r.source_ref LIKE 'doc-' || martyrdom_case_documents.id || '#%'
              AND r.source_type LIKE 'martyr%'
         )
    `));
    const affected = result?.rowCount ?? orphanCount;

    return new Response(JSON.stringify({
      ok: true, mode: "executed",
      affected,
      hint: "이제 어드민이 각 사건의 ② 자료 탭 → [⟳ 전체 재시도] 클릭하면 일괄 재색인됩니다. 또는 일정 시간 후 자동 cron 재시도. 성공 후 이 파일 삭제 + commit.",
    }, null, 2), { headers: JSON_HEADER });
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false, error: "마이그 실패", step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: JSON_HEADER });
  }
}
