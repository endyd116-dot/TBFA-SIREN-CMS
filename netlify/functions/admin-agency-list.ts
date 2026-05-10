/**
 * GET /api/admin-agency-list
 * 외부 기관 목록 조회
 *
 * Query:
 *   type?     — agency_type 필터
 *   active?   — 1: 활성만, 0: 비활성만 (기본: 전체)
 */
import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/admin-agency-list" };

function jsonError(step: string, err: any) {
  return new Response(
    JSON.stringify({
      ok: false,
      error: "기관 목록 조회 실패",
      step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }),
    { status: 500, headers: { "Content-Type": "application/json" } }
  );
}

export default async (req: Request, _ctx: Context) => {
  /* 어드민 인증 */
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  const url = new URL(req.url);
  const typeFilter = url.searchParams.get("type") || null;
  const activeParam = url.searchParams.get("active");

  let rows: any[] = [];
  try {
    const { db } = await import("../../db");
    const { sql } = await import("drizzle-orm");

    let query = `
      SELECT
        id,
        name,
        agency_type      AS "agencyType",
        contact_name     AS "contactName",
        contact_phone    AS "contactPhone",
        contact_email    AS "contactEmail",
        jurisdiction,
        CASE WHEN template_body IS NOT NULL AND template_body != '' THEN TRUE ELSE FALSE END AS "hasTemplate",
        is_active        AS "isActive",
        created_at       AS "createdAt",
        updated_at       AS "updatedAt"
      FROM external_agencies
      WHERE 1=1
    `;
    const params: any[] = [];
    let idx = 1;

    if (typeFilter) {
      query += ` AND agency_type = $${idx++}`;
      params.push(typeFilter);
    }
    if (activeParam === "1") {
      query += ` AND is_active = TRUE`;
    } else if (activeParam === "0") {
      query += ` AND is_active = FALSE`;
    }
    query += ` ORDER BY name ASC`;

    const result = await (db as any).execute(
      params.length > 0
        ? sql.raw(query + " -- params: " + JSON.stringify(params))
        : query
    );

    // drizzle neon-http execute 반환 형식 처리
    rows = Array.isArray(result) ? result : (result?.rows ?? []);
  } catch (err: any) {
    return jsonError("select_agencies", err);
  }

  return new Response(
    JSON.stringify({ ok: true, agencies: rows }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
};
