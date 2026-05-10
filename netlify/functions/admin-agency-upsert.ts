/**
 * POST /api/admin-agency-upsert
 * 외부 기관 등록(id 없음) 또는 수정(id 있음)
 */
import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-agency-upsert" };

function jsonError(step: string, err: any) {
  return new Response(
    JSON.stringify({ ok: false, error: "기관 저장 실패", step, detail: String(err?.message || err).slice(0, 500), stack: String(err?.stack || "").slice(0, 1000) }),
    { status: 500, headers: { "Content-Type": "application/json" } }
  );
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "POST") return new Response(JSON.stringify({ ok: false, error: "POST only" }), { status: 405, headers: { "Content-Type": "application/json" } });
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;
  let body: any;
  try { body = await req.json(); } catch (err) { return jsonError("parse_body", err); }
  const { id, name, agencyType, contactName, contactPhone, contactEmail, jurisdiction, templateBody, isActive } = body;
  if (!name || typeof name !== "string" || !name.trim()) return new Response(JSON.stringify({ ok: false, error: "기관명은 필수입니다" }), { status: 400, headers: { "Content-Type": "application/json" } });
  if (!agencyType || typeof agencyType !== "string") return new Response(JSON.stringify({ ok: false, error: "기관 유형은 필수입니다" }), { status: 400, headers: { "Content-Type": "application/json" } });
  const adminId = auth.ctx.admin.uid;
  try {
    let resultId: number;
    if (id) {
      await db.execute(sql`UPDATE external_agencies SET name=${name.trim()}, agency_type=${agencyType}, contact_name=${contactName ?? null}, contact_phone=${contactPhone ?? null}, contact_email=${contactEmail ?? null}, jurisdiction=${jurisdiction ?? null}, template_body=${templateBody ?? null}, is_active=${isActive !== false}, updated_at=NOW() WHERE id=${Number(id)}`);
      resultId = Number(id);
    } else {
      const result = await db.execute(sql`INSERT INTO external_agencies (name, agency_type, contact_name, contact_phone, contact_email, jurisdiction, template_body, is_active, created_by, created_at, updated_at) VALUES (${name.trim()}, ${agencyType}, ${contactName ?? null}, ${contactPhone ?? null}, ${contactEmail ?? null}, ${jurisdiction ?? null}, ${templateBody ?? null}, TRUE, ${adminId}, NOW(), NOW()) RETURNING id`);
      const rows = Array.isArray(result) ? result : ((result as any)?.rows ?? []);
      resultId = rows[0]?.id;
    }
    return new Response(JSON.stringify({ ok: true, id: resultId }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err: any) { return jsonError(id ? "update_agency" : "insert_agency", err); }
};
