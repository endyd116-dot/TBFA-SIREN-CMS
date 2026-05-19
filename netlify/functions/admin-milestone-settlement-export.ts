import type { Context } from "@netlify/functions";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { loadAllRoles } from "../../lib/milestone-roles";

export const config = { path: "/api/admin/milestone-settlement-export" };

export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "GET") {
    return Response.json({ ok: false, error: "GET만 지원합니다" }, { status: 405 });
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  /* ★ R29-MS-GAP1-A: 결산 CSV 다운로드는 super_admin 전용 (급여 정보 포함) */
  if ((auth.ctx.member as any)?.role !== "super_admin") {
    return Response.json({ ok: false, error: "슈퍼어드민 전용 (급여 CSV 다운로드)" }, { status: 403 });
  }

  const url = new URL(req.url);
  const quarterId = url.searchParams.get("quarterId");
  if (!quarterId || isNaN(Number(quarterId))) {
    return Response.json({ ok: false, error: "quarterId 필수" }, { status: 400 });
  }

  try {
    const qRow = await db.execute(sql`SELECT year, quarter FROM quarters WHERE id = ${Number(quarterId)}`);
    const q = ((qRow as any).rows?.[0] || qRow[0]) as any;
    if (!q) return Response.json({ ok: false, error: "분기 없음" }, { status: 404 });

    const rows = await db.execute(sql`
      SELECT qs.revenue_linked_total, qs.non_revenue_total, qs.total_bonus,
             qs.status, qs.paid_at,
             m.name as member_name, m.milestone_role,
             m.base_salary
      FROM quarterly_settlements qs
      LEFT JOIN members m ON m.id = qs.member_id
      WHERE qs.quarter_id = ${Number(quarterId)}
      ORDER BY m.milestone_role, m.name
    `);
    const settlements = (rows as any).rows || (rows as any[]);

    /* R39 Stage 2: 역할 라벨 DB 동적 매핑 (milestone_roles 비활성도 포함 — 과거 결산도 라벨 보장).
       대소문자 둘 다 매핑 (실 컬럼은 대문자 SM/PM/SI). */
    const roleLabel: Record<string, string> = {};
    try {
      const allRoles = await loadAllRoles();
      for (const r of allRoles) {
        roleLabel[r.code] = r.name;
        roleLabel[r.code.toLowerCase()] = r.name;
      }
    } catch (e) {
      console.warn("[settlement-export] 역할 라벨 로드 실패·코드 그대로 노출:", e);
    }

    // UTF-8 BOM + CSV 생성
    const BOM = "﻿";
    const header = "직원명,직책,매출연동인센티브,비매출보너스,총변동급,기본연봉,상태,지급일\n";

    const statusLabel: Record<string, string> = {
      DRAFT: "초안", SUBMITTED: "제출완료", REVIEWED: "검토완료",
      APPROVED: "승인", REJECTED: "반려", PAID: "지급완료",
    };

    const dataLines = settlements.map((s: any) => {
      const cols = [
        s.member_name || "",
        roleLabel[s.milestone_role] || s.milestone_role || "",
        String(Math.round(Number(s.revenue_linked_total || 0))),
        String(Math.round(Number(s.non_revenue_total || 0))),
        String(Math.round(Number(s.total_bonus || 0))),
        String(Math.round(Number(s.base_salary || 0))),
        statusLabel[s.status] || s.status || "",
        s.paid_at ? new Date(s.paid_at).toISOString().slice(0, 10) : "",
      ];
      return cols.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",");
    });

    const csv = BOM + header + dataLines.join("\n");
    const filename = `settlement-${q.year}-Q${q.quarter}.csv`;

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err: any) {
    return Response.json({ ok: false, error: "CSV 생성 오류", detail: String(err?.message || err).slice(0, 300) }, { status: 500 });
  }
}
