/**
 * GET /api/admin-members-source-kpi
 *
 * 통합 일반 회원 — 가입경로별 인원수 KPI.
 * Phase 2(#16) 단계 D 검증 후속: 통합 회원 화면 상단 카드용.
 *
 * 응답:
 *   ok: true,
 *   data: {
 *     total:    number,   // 전체 (탈퇴/차단 포함, 운영 풀 전체)
 *     siren:    number,   // 🌐 싸이렌 가입(웹)
 *     hyosung:  number,   // 🏦 효성 CMS+
 *     manual:   number,   // ✍️ 수기
 *     event:    number,   // 🎫 이벤트
 *     etc:      number,   // 🔘 기타(매핑 코드)
 *     other:    number,   // 매핑 안 된 코드 + signup_source_id NULL
 *   }
 */

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

function jsonError(step: string, err: any, status = 500) {
  return new Response(
    JSON.stringify({
      ok: false,
      error: "통합 회원 가입경로 KPI 조회 실패",
      step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }),
    { status, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

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

  /* 인증 */
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  /* 가입경로 코드별 회원 수 — signup_sources 와 LEFT JOIN, 매핑 누락은 'other' */
  try {
    const rs: any = await db.execute(sql`
      SELECT
        COUNT(*)::int                                                                       AS total,
        COUNT(*) FILTER (WHERE ss.code = 'siren')::int                                      AS siren,
        COUNT(*) FILTER (WHERE ss.code = 'hyosung')::int                                    AS hyosung,
        COUNT(*) FILTER (WHERE ss.code IN ('manual','admin_manual'))::int                   AS manual,
        COUNT(*) FILTER (WHERE ss.code = 'event')::int                                      AS event,
        COUNT(*) FILTER (WHERE ss.code = 'etc')::int                                        AS etc,
        COUNT(*) FILTER (WHERE
          ss.code IS NULL
          OR ss.code NOT IN ('siren','hyosung','manual','admin_manual','event','etc')
        )::int                                                                               AS other
      FROM members m
      LEFT JOIN signup_sources ss ON ss.id = m.signup_source_id
    `);
    const row = (Array.isArray(rs) ? rs[0] : (rs as any).rows?.[0]) || {};

    const data = {
      total:   Number(row.total)   || 0,
      siren:   Number(row.siren)   || 0,
      hyosung: Number(row.hyosung) || 0,
      manual:  Number(row.manual)  || 0,
      event:   Number(row.event)   || 0,
      etc:     Number(row.etc)     || 0,
      other:   Number(row.other)   || 0,
    };

    return new Response(
      JSON.stringify({ ok: true, message: null, data }),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  } catch (err) {
    return jsonError("count_by_source", err);
  }
};

export const config = { path: "/api/admin-members-source-kpi" };
