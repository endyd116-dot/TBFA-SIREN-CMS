/**
 * admin-martyrdom-dashboard — G3 다중 사건 현황 집계
 *
 * GET : 상태별 사건 수 · 임박 기한(D-day) · 준비도(최신 readiness) · 저장 용량
 *
 * 응답: { ok, totalCases, statusCounts, kindCounts, upcomingDeadlines, readiness, storage }
 *   storage: { bytes, gb, alertGb, over } — over=true면 임계 초과(운영자 수동 파기 권장)
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";

export const config = { path: "/api/admin-martyrdom-dashboard" };

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "처리 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

function dDay(due: string): number {
  const d = new Date(due + "T00:00:00Z").getTime();
  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").getTime();
  return Math.round((d - today) / 86400000);
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ ok: false, error: "GET만 허용" }), { status: 405 });
  }
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  try {
    /* ── 상태별·종류별 집계 ── */
    let statusCounts: any[] = [];
    let kindCounts = { active: 0, reference: 0 };
    let totalCases = 0;
    try {
      const sr: any = await db.execute(sql.raw(`SELECT status, COUNT(*)::int AS cnt FROM martyrdom_cases GROUP BY status`));
      statusCounts = (sr?.rows ?? sr ?? []).map((r: any) => ({ status: String(r.status || ""), count: Number(r.cnt || 0) }));
      const kr: any = await db.execute(sql.raw(`SELECT case_kind AS "k", COUNT(*)::int AS cnt FROM martyrdom_cases GROUP BY case_kind`));
      for (const r of (kr?.rows ?? kr ?? [])) {
        const k = String(r.k || "active");
        if (k === "reference") kindCounts.reference = Number(r.cnt || 0);
        else kindCounts.active = Number(r.cnt || 0);
      }
      totalCases = kindCounts.active + kindCounts.reference;
    } catch (err: any) { console.warn("[martyrdom-dashboard] 집계 실패", err?.message); }

    /* ── 임박 기한 (pending·due_date 90일 이내 또는 지난 것) ── */
    let upcomingDeadlines: any[] = [];
    try {
      const dr: any = await db.execute(sql.raw(`
        SELECT d.id, d.case_id AS "caseId", d.label, d.kind, d.due_date AS "dueDate", d.status,
               c.title AS "caseTitle", c.case_no AS "caseNo"
        FROM martyrdom_deadlines d
        JOIN martyrdom_cases c ON c.id = d.case_id
        WHERE d.status = 'pending' AND d.due_date <= (CURRENT_DATE + INTERVAL '90 days')
        ORDER BY d.due_date ASC
        LIMIT 30
      `));
      upcomingDeadlines = (dr?.rows ?? dr ?? []).map((d: any) => {
        const due = d.dueDate ? String(d.dueDate).slice(0, 10) : null;
        return {
          id: Number(d.id), caseId: Number(d.caseId),
          caseTitle: String(d.caseTitle || ""), caseNo: String(d.caseNo || ""),
          label: String(d.label || ""), kind: String(d.kind || "custom"),
          dueDate: due, dDay: due ? dDay(due) : null,
        };
      });
    } catch (err: any) { console.warn("[martyrdom-dashboard] 기한 실패", err?.message); }

    /* ── 준비도 (active 사건별 최신 readiness score) ── */
    let readiness: any[] = [];
    try {
      const rr: any = await db.execute(sql.raw(`
        SELECT DISTINCT ON (ao.case_id) ao.case_id AS "caseId", ao.content_json AS "contentJson",
               c.title AS "caseTitle", c.case_no AS "caseNo"
        FROM martyrdom_ai_outputs ao
        JOIN martyrdom_cases c ON c.id = ao.case_id
        WHERE ao.output_type = 'readiness' AND c.case_kind = 'active'
        ORDER BY ao.case_id, ao.version DESC
      `));
      readiness = (rr?.rows ?? rr ?? []).map((r: any) => {
        let score = 0;
        try {
          const cj = typeof r.contentJson === "string" ? JSON.parse(r.contentJson) : r.contentJson;
          score = Number(cj?.score || 0);
        } catch { /* noop */ }
        return { caseId: Number(r.caseId), caseTitle: String(r.caseTitle || ""), caseNo: String(r.caseNo || ""), score };
      });
    } catch (err: any) { console.warn("[martyrdom-dashboard] 준비도 실패", err?.message); }

    /* ── 저장 용량 (size_bytes 합계) ── */
    let storage = { bytes: 0, gb: 0, alertGb: Number(process.env.MARTYRDOM_STORAGE_ALERT_GB || 20), over: false };
    try {
      const sr: any = await db.execute(sql.raw(`SELECT COALESCE(SUM(size_bytes), 0)::bigint AS bytes FROM martyrdom_case_documents`));
      const bytes = Number((sr?.rows ?? sr ?? [])[0]?.bytes || 0);
      const gb = Math.round((bytes / (1024 ** 3)) * 100) / 100;
      storage = { bytes, gb, alertGb: storage.alertGb, over: gb >= storage.alertGb };
    } catch (err: any) { console.warn("[martyrdom-dashboard] 용량 실패", err?.message); }

    return new Response(JSON.stringify({
      ok: true, totalCases, statusCounts, kindCounts, upcomingDeadlines, readiness, storage,
    }), { headers: { "Content-Type": "application/json" } });

  } catch (err: any) {
    return jsonError("dashboard", err);
  }
};
