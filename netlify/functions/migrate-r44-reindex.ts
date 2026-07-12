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
import { jsonKST } from "../../lib/kst";
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

    /* ── 진단 ──
       v2(2026-05-29): NOT EXISTS의 `'doc-' || d.id || '#%'`가 PG 자동 캐스팅 실패로 항상 false 평가되던 BUG fix.
       admin-rag-status로 martyr_* 0건 확정됐으니 NOT EXISTS 제거하고 단순화.
       ai_rag_documents의 martyr_* 행수도 함께 진단해 안전성 확보 — martyr_* > 0이면 NOT EXISTS 패턴 재도입 필요. */
    step = "diag_count_total";
    const totalDone: any = await db.execute(sql.raw(`
      SELECT COUNT(*)::int AS n FROM martyrdom_case_documents
       WHERE extract_status = 'done' AND indexed_to_rag = true
    `));
    const doneCount = (totalDone?.rows ?? totalDone ?? [])[0]?.n || 0;

    step = "diag_count_martyr_rag";
    const martyrCount: any = await db.execute(sql.raw(`
      SELECT COUNT(*)::int AS n FROM ai_rag_documents WHERE source_type LIKE 'martyr%'
    `));
    const martyrRagCount = (martyrCount?.rows ?? martyrCount ?? [])[0]?.n || 0;

    /* 안전 가드: martyr_* RAG가 일부라도 있으면 무차별 되돌리기 위험 → 정밀 NOT EXISTS 모드 */
    if (martyrRagCount > 0) {
      step = "diag_orphan_precise";
      const orphan: any = await db.execute(sql.raw(`
        SELECT d.id, d.case_id AS "caseId", d.file_name AS "fileName"
          FROM martyrdom_case_documents d
         WHERE d.extract_status = 'done'
           AND d.indexed_to_rag = true
           AND NOT EXISTS (
             SELECT 1 FROM ai_rag_documents r
              WHERE r.source_ref LIKE concat('doc-', d.id::text, '#%')
                AND r.source_type LIKE 'martyr%'
           )
         ORDER BY d.id DESC
         LIMIT 1000
      `));
      const orphanRows = (orphan?.rows ?? orphan ?? []);
      const orphanCount = orphanRows.length;

      if (!run) {
        return new Response(jsonKST({
          ok: true, mode: "diagnose", precision: "partial",
          doneIndexedCount: doneCount, martyrRagCount, orphanCount,
          sampleOrphans: orphanRows.slice(0, 10),
          hint: `martyr_* RAG ${martyrRagCount}건 존재 → 정밀 모드. ?run=1로 orphan만 되돌림.`,
        }, null, 2), { headers: JSON_HEADER });
      }

      step = "auth_partial";
      const auth = await requireAdmin(req);
      if (!auth.ok) return (auth as any).res;

      if (orphanCount === 0) {
        return new Response(jsonKST({
          ok: true, mode: "executed", precision: "partial", affected: 0,
          hint: "되돌릴 자료 없음 (정밀 모드·이미 모두 정상 색인)",
        }, null, 2), { headers: JSON_HEADER });
      }

      step = "rollback_precise";
      const r1: any = await db.execute(sql.raw(`
        UPDATE martyrdom_case_documents
           SET indexed_to_rag = false, extract_status = 'queued', updated_at = NOW()
         WHERE extract_status = 'done' AND indexed_to_rag = true
           AND NOT EXISTS (
             SELECT 1 FROM ai_rag_documents r
              WHERE r.source_ref LIKE concat('doc-', martyrdom_case_documents.id::text, '#%')
                AND r.source_type LIKE 'martyr%'
           )
      `));
      const affected = r1?.rowCount ?? orphanCount;
      return new Response(jsonKST({
        ok: true, mode: "executed", precision: "partial", affected,
        hint: "정밀 모드로 orphan 되돌림 완료. 어드민이 사건별 [⟳ 전체 재시도] 클릭하면 일괄 재색인.",
      }, null, 2), { headers: JSON_HEADER });
    }

    /* martyr_* RAG 0건 = 전체 자료가 orphan 확정·NOT EXISTS 없이 단순 되돌림 */
    if (!run) {
      return new Response(jsonKST({
        ok: true, mode: "diagnose", precision: "bulk",
        doneIndexedCount: doneCount, martyrRagCount: 0,
        orphanCount: doneCount,
        hint: `martyr_* RAG 0건 확정 → 전량 모드. ?run=1로 ${doneCount}건 모두 되돌림.`,
      }, null, 2), { headers: JSON_HEADER });
    }

    step = "auth_bulk";
    const auth = await requireAdmin(req);
    if (!auth.ok) return (auth as any).res;

    if (doneCount === 0) {
      return new Response(jsonKST({
        ok: true, mode: "executed", precision: "bulk", affected: 0,
        hint: "되돌릴 자료 없음 (extract_status='done' + indexed_to_rag=true 자료 0건)",
      }, null, 2), { headers: JSON_HEADER });
    }

    step = "rollback_bulk";
    const result: any = await db.execute(sql.raw(`
      UPDATE martyrdom_case_documents
         SET indexed_to_rag = false, extract_status = 'queued', updated_at = NOW()
       WHERE extract_status = 'done' AND indexed_to_rag = true
    `));
    const affected = result?.rowCount ?? doneCount;

    return new Response(jsonKST({
      ok: true, mode: "executed",
      affected,
      hint: "이제 어드민이 각 사건의 ② 자료 탭 → [⟳ 전체 재시도] 클릭하면 일괄 재색인됩니다. 또는 일정 시간 후 자동 cron 재시도. 성공 후 이 파일 삭제 + commit.",
    }, null, 2), { headers: JSON_HEADER });
  } catch (err: any) {
    return new Response(jsonKST({
      ok: false, error: "마이그 실패", step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: JSON_HEADER });
  }
}
