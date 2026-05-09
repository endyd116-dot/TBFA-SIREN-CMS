/**
 * GET /api/admin/donation-dashboard
 *
 * D7 백엔드 — Phase 3 (DESIGN_PHASE3.md §6.4): 종합 검증 대시보드
 *
 * 응답: AdminDonationDashboard
 *   kpi:             정기/잠재/비후원 분포 + 채널별 통계
 *   alerts:          미매칭 효성·중복·최근 해지 등 어드민 주의 항목
 *   recentCsvImports: 최근 효성 업로드 이력 (hyosung_import_logs)
 */

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

/* =========================================================
   API 계약 (DESIGN_PHASE3.md §6.4)
   ========================================================= */

export interface AdminDonationDashboard {
  ok: true;
  generatedAt: string;
  kpi: {
    membersTotal: number;
    regularTotal: number;
    regularByChannel: { toss: number; hyosung: number; both: number };
    prospectTotal: number;
    prospectBySubtype: { onetime: number; cancelled: number };
    nonDonor: number;
  };
  alerts: {
    type:
      | "unmatchedHyosungContract"
      | "unmatchedHyosungBilling"
      | "donorTypeConflict"
      | "recentCancellation";
    count: number;
    samples: { memberId?: number; memberNo?: number; description: string }[];
  }[];
  recentCsvImports: {
    source: string;
    uploadedAt: string;
    totalRows: number;
    matched: number;
    created: number;
  }[];
}

/* =========================================================
   에러 응답 (CLAUDE.md §6.2)
   ========================================================= */

function jsonError(step: string, err: any) {
  return new Response(
    JSON.stringify({
      ok: false,
      error: "대시보드 조회 실패",
      step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }),
    { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

/* =========================================================
   메인 핸들러
   ========================================================= */

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ ok: false, error: "Method Not Allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  /* 1. 인증 */
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  const generatedAt = new Date().toISOString();

  /* ─────────────────────────────────────────────────────────
     2. KPI — 회원 분류 분포
     ───────────────────────────────────────────────────────── */
  let kpi: AdminDonationDashboard["kpi"];
  try {
    const kpiRes: any = await db.execute(sql`
      SELECT
        COUNT(*)::int AS members_total,
        COUNT(*) FILTER (WHERE donor_type = 'regular')::int AS regular_total,
        COUNT(*) FILTER (
          WHERE donor_type = 'regular'
            AND donor_channels @> '["toss"]'::jsonb
            AND NOT (donor_channels @> '["hyosung"]'::jsonb)
        )::int AS toss_only,
        COUNT(*) FILTER (
          WHERE donor_type = 'regular'
            AND donor_channels @> '["hyosung"]'::jsonb
            AND NOT (donor_channels @> '["toss"]'::jsonb)
        )::int AS hyosung_only,
        COUNT(*) FILTER (
          WHERE donor_type = 'regular'
            AND donor_channels @> '["toss"]'::jsonb
            AND donor_channels @> '["hyosung"]'::jsonb
        )::int AS both_channels,
        COUNT(*) FILTER (WHERE donor_type = 'prospect')::int AS prospect_total,
        COUNT(*) FILTER (WHERE donor_type = 'prospect' AND prospect_subtype = 'onetime')::int AS prospect_onetime,
        COUNT(*) FILTER (WHERE donor_type = 'prospect' AND prospect_subtype = 'cancelled')::int AS prospect_cancelled,
        COUNT(*) FILTER (WHERE donor_type = 'none' OR donor_type IS NULL)::int AS non_donor
      FROM members
      WHERE status != 'withdrawn'
    `);
    const kpiRow = (Array.isArray(kpiRes) ? kpiRes[0] : (kpiRes as any).rows?.[0]) || {};

    kpi = {
      membersTotal: Number(kpiRow.members_total) || 0,
      regularTotal: Number(kpiRow.regular_total) || 0,
      regularByChannel: {
        toss: Number(kpiRow.toss_only) || 0,
        hyosung: Number(kpiRow.hyosung_only) || 0,
        both: Number(kpiRow.both_channels) || 0,
      },
      prospectTotal: Number(kpiRow.prospect_total) || 0,
      prospectBySubtype: {
        onetime: Number(kpiRow.prospect_onetime) || 0,
        cancelled: Number(kpiRow.prospect_cancelled) || 0,
      },
      nonDonor: Number(kpiRow.non_donor) || 0,
    };
  } catch (err) {
    return jsonError("select_kpi", err);
  }

  /* ─────────────────────────────────────────────────────────
     3. Alerts
     ───────────────────────────────────────────────────────── */
  const alerts: AdminDonationDashboard["alerts"] = [];

  /* Alert 1: 효성 계약 미매칭 (hyosung_contracts.linked_member_id IS NULL) */
  try {
    const unmatchedRes: any = await db.execute(sql`
      SELECT COUNT(*)::int AS cnt, ARRAY_AGG(member_no ORDER BY member_no LIMIT 5) AS sample_nos
      FROM hyosung_contracts
      WHERE linked_member_id IS NULL
    `);
    const unmatchedRow = (Array.isArray(unmatchedRes) ? unmatchedRes[0] : (unmatchedRes as any).rows?.[0]) || {};
    const cnt = Number(unmatchedRow.cnt) || 0;
    if (cnt > 0) {
      const sampleNos: number[] = (() => {
        try {
          const raw = unmatchedRow.sample_nos;
          if (Array.isArray(raw)) return raw.slice(0, 5).map(Number);
          return [];
        } catch {
          return [];
        }
      })();
      /* 샘플 상세 */
      const sampleDetails: any[] = [];
      if (sampleNos.length > 0) {
        const sampRes: any = await db.execute(sql`
          SELECT member_no, member_name, contract_status FROM hyosung_contracts
          WHERE member_no = ANY(${sql.raw(`ARRAY[${sampleNos.join(",") || "0"}]::int[]`)})
          LIMIT 5
        `).catch(() => ({ rows: [] }));
        const sampRows = Array.isArray(sampRes) ? sampRes : (sampRes as any).rows || [];
        for (const r of sampRows) {
          sampleDetails.push({
            memberNo: Number(r.member_no),
            description: `효성 회원번호 ${r.member_no} (${r.member_name || "이름없음"}) — 계약상태: ${r.contract_status || "-"}`,
          });
        }
      }
      alerts.push({ type: "unmatchedHyosungContract", count: cnt, samples: sampleDetails });
    }
  } catch (err) {
    console.warn("[donation-dashboard] Alert 1(미매칭 계약) 조회 실패 — 건너뜀", err);
  }

  /* Alert 2: 수납내역 미매칭 (hyosung_billings에 linked_member_id가 없는 건) */
  try {
    const unmatchedBillRes: any = await db.execute(sql`
      SELECT COUNT(*)::int AS cnt
      FROM hyosung_billings hb
      WHERE NOT EXISTS (
        SELECT 1 FROM hyosung_contracts hc
        WHERE hc.member_no = hb.member_no AND hc.linked_member_id IS NOT NULL
      )
    `);
    const ubRow = (Array.isArray(unmatchedBillRes) ? unmatchedBillRes[0] : (unmatchedBillRes as any).rows?.[0]) || {};
    const cnt = Number(ubRow.cnt) || 0;
    if (cnt > 0) {
      alerts.push({
        type: "unmatchedHyosungBilling",
        count: cnt,
        samples: [{ description: `효성 수납내역 ${cnt}건이 회원과 연결되지 않았습니다. 계약정보를 먼저 업로드하세요.` }],
      });
    }
  } catch (err) {
    console.warn("[donation-dashboard] Alert 2(미매칭 수납) 조회 실패 — 건너뜀", err);
  }

  /* Alert 3: 최근 30일 내 효성 계약 중지(해지) 이동 */
  try {
    const cancelRes: any = await db.execute(sql`
      SELECT m.id, m.name, hc.member_no, hc.contract_status
      FROM members m
      INNER JOIN hyosung_contracts hc ON hc.member_no = m.hyosung_member_no
      WHERE m.hyosung_contract_status IN ('cancelled', 'expired', 'suspended', 'terminated')
        AND m.hyosung_synced_at >= NOW() - INTERVAL '30 days'
        AND m.donor_type = 'prospect'
      ORDER BY m.hyosung_synced_at DESC
      LIMIT 10
    `);
    const cancelRows: any[] = Array.isArray(cancelRes) ? cancelRes : (cancelRes as any).rows || [];
    if (cancelRows.length > 0) {
      alerts.push({
        type: "recentCancellation",
        count: cancelRows.length,
        samples: cancelRows.slice(0, 5).map((r) => ({
          memberId: Number(r.id),
          memberNo: Number(r.member_no),
          description: `${r.name || "이름없음"} — 효성 계약 ${r.contract_status || "중지"}로 잠재 후원자 이동`,
        })),
      });
    }
  } catch (err) {
    console.warn("[donation-dashboard] Alert 3(최근 해지) 조회 실패 — 건너뜀", err);
  }

  /* Alert 4: donor_type 충돌 — 효성 active이지만 SIREN donor_type이 'none'인 회원 */
  try {
    const conflictRes: any = await db.execute(sql`
      SELECT m.id, m.name, m.hyosung_contract_status, m.donor_type
      FROM members m
      WHERE m.hyosung_contract_status = 'active'
        AND (m.donor_type = 'none' OR m.donor_type IS NULL)
      LIMIT 10
    `);
    const conflictRows: any[] = Array.isArray(conflictRes) ? conflictRes : (conflictRes as any).rows || [];
    if (conflictRows.length > 0) {
      alerts.push({
        type: "donorTypeConflict",
        count: conflictRows.length,
        samples: conflictRows.slice(0, 5).map((r) => ({
          memberId: Number(r.id),
          description: `${r.name || "이름없음"} — 효성 계약 active이나 donor_type = '${r.donor_type || "null"}'`,
        })),
      });
    }
  } catch (err) {
    console.warn("[donation-dashboard] Alert 4(donor_type 충돌) 조회 실패 — 건너뜀", err);
  }

  /* ─────────────────────────────────────────────────────────
     4. 최근 CSV 업로드 이력 (hyosung_import_logs)
     ───────────────────────────────────────────────────────── */
  let recentCsvImports: AdminDonationDashboard["recentCsvImports"] = [];
  try {
    const logRes: any = await db.execute(sql`
      SELECT file_name, created_at, total_rows, matched_count, created_count, detail
      FROM hyosung_import_logs
      ORDER BY created_at DESC
      LIMIT 10
    `);
    const logRows: any[] = Array.isArray(logRes) ? logRes : (logRes as any).rows || [];
    recentCsvImports = logRows.map((r) => {
      let source = "hyosung";
      try {
        const detail = typeof r.detail === "string" ? JSON.parse(r.detail) : r.detail;
        if (detail?.type === "contracts") source = "hyosung_contracts";
        else if (detail?.type === "billings") source = "hyosung_billings";
      } catch { /* 파싱 실패 무시 */ }
      return {
        source,
        uploadedAt: r.created_at ? new Date(r.created_at).toISOString() : new Date(0).toISOString(),
        totalRows: Number(r.total_rows) || 0,
        matched: Number(r.matched_count) || 0,
        created: Number(r.created_count) || 0,
      };
    });
  } catch (err) {
    console.warn("[donation-dashboard] 업로드 이력 조회 실패 — 빈 배열 fallback", err);
  }

  /* 5. 응답 */
  const dashboard: AdminDonationDashboard = {
    ok: true,
    generatedAt,
    kpi,
    alerts,
    recentCsvImports,
  };

  return new Response(
    JSON.stringify({ ok: true, data: dashboard }),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
};

export const config = { path: "/api/admin/donation-dashboard" };
