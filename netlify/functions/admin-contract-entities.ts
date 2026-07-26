/**
 * 관리자 계약 주체(사업자) CRUD (슈퍼어드민 전용)
 *   GET  /api/admin-contract-entities                 — 목록
 *   POST /api/admin-contract-entities { action }      — create | update | delete | setSeal
 *     create/update: name, entityType, representative, bizNo, address, phone, sortOrder, isActive
 *     setSeal: id, sealPng(dataURL image/png|jpeg)  — 도장 이미지 업로드
 *     delete:  id  (계약 참조가 있으면 비활성화, 없으면 완전 삭제)
 *
 * 도장 미리보기: /api/admin-contract-seal?entityId=N
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { uploadToR2 } from "../../lib/r2-server";

export const config = { path: "/api/admin-contract-entities" };
const H = { "Content-Type": "application/json; charset=utf-8" };
const ok = (data: any, message?: string) => new Response(jsonKST({ ok: true, message, data }), { status: 200, headers: H });
const bad = (msg: string, status = 400) => new Response(jsonKST({ ok: false, error: msg }), { status, headers: H });
const rows = (r: any) => (r?.rows ?? r ?? []);

function parseImageDataUrl(dataUrl: string): { bytes: Uint8Array; mime: string } | null {
  const m = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || "").trim());
  if (!m) return null;
  try {
    const buf = Buffer.from(m[2].replace(/\s/g, ""), "base64");
    if (buf.length === 0 || buf.length > 3_000_000) return null;
    return { bytes: new Uint8Array(buf), mime: m[1] };
  } catch { return null; }
}

export default async function handler(req: Request, _ctx: Context) {
  let step = "start";
  try {
    step = "auth";
    const auth = await requireAdmin(req);
    if (!auth.ok) return (auth as any).res;
    const me = (auth as any).ctx.member;
    if (me.role !== "super_admin") return bad("이사장(슈퍼어드민)만 가능합니다", 403);

    if (req.method === "GET") {
      step = "list";
      const list = await db.execute(sql`
        SELECT id, name, entity_type, representative, biz_no, address, phone,
               (seal_r2_key IS NOT NULL) AS has_seal, sort_order, is_active, created_at
          FROM contract_business_entities ORDER BY sort_order ASC, id ASC`);
      return ok({ items: rows(list) });
    }

    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const action = body.action;

      if (action === "create") {
        step = "create";
        const name = String(body.name || "").trim();
        if (!name) return bad("상호를 입력하세요");
        const ins = await db.execute(sql`
          INSERT INTO contract_business_entities (name, entity_type, representative, biz_no, address, phone, sort_order, is_active)
          VALUES (${name}, ${body.entityType || "individual"}, ${body.representative || null}, ${body.bizNo || null},
                  ${body.address || null}, ${body.phone || null}, ${Number(body.sortOrder) || 0}, ${body.isActive !== false})
          RETURNING id`);
        return ok({ id: rows(ins)[0]?.id }, "사업자를 등록했습니다");
      }

      if (action === "update") {
        step = "update";
        const id = Number(body.id);
        if (!id) return bad("id 없음");
        await db.execute(sql`
          UPDATE contract_business_entities SET
            name = COALESCE(${body.name ?? null}, name),
            entity_type = COALESCE(${body.entityType ?? null}, entity_type),
            representative = ${body.representative ?? null},
            biz_no = ${body.bizNo ?? null},
            address = ${body.address ?? null},
            phone = ${body.phone ?? null},
            sort_order = COALESCE(${body.sortOrder ?? null}, sort_order),
            is_active = COALESCE(${body.isActive ?? null}, is_active),
            updated_at = NOW()
          WHERE id = ${id}`);
        return ok({ id }, "사업자 정보를 수정했습니다");
      }

      if (action === "setSeal") {
        step = "setSeal";
        const id = Number(body.id);
        if (!id) return bad("id 없음");
        const img = parseImageDataUrl(body.sealPng);
        if (!img) return bad("도장 이미지를 읽지 못했습니다 (PNG 또는 JPG)");
        const up = await uploadToR2({
          buffer: img.bytes, originalName: `seal-entity-${id}.png`, mimeType: img.mime,
          context: "contract-seal", isPublic: false, expiresInDays: null,
        });
        if (!up.ok || !up.blobKey) return bad("도장 저장 실패");
        await db.execute(sql`UPDATE contract_business_entities SET seal_r2_key = ${up.blobKey}, updated_at = NOW() WHERE id = ${id}`);
        return ok({ id }, "도장을 등록했습니다");
      }

      if (action === "delete") {
        step = "delete";
        const id = Number(body.id);
        if (!id) return bad("id 없음");
        const used = await db.execute(sql`SELECT COUNT(*)::int AS n FROM employment_contracts WHERE entity_id = ${id}`);
        if ((rows(used)[0]?.n ?? 0) > 0) {
          await db.execute(sql`UPDATE contract_business_entities SET is_active = FALSE, updated_at = NOW() WHERE id = ${id}`);
          return ok({ id, deactivated: true }, "이 사업자로 만든 계약이 있어 완전 삭제 대신 비활성화했습니다");
        }
        await db.execute(sql`DELETE FROM contract_templates WHERE entity_id = ${id}`);
        await db.execute(sql`DELETE FROM contract_business_entities WHERE id = ${id}`);
        return ok({ id, deleted: true }, "사업자를 삭제했습니다");
      }

      return bad("알 수 없는 action");
    }

    return bad("허용되지 않은 메서드", 405);
  } catch (err: any) {
    return new Response(jsonKST({ ok: false, error: "사업자 처리 실패", step, detail: String(err?.message || err).slice(0, 500) }), { status: 500, headers: H });
  }
}
