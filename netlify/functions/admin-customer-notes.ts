/**
 * /api/admin/customer-notes — 고객(회원·잠재 후원자) 관리자 메모 (2026-10-18)
 *
 * GET    ?member=N | ?potential=N          → { ok, data: { ready, list[] } }
 * POST   { memberId?|potentialId?, body, pinned? } → { ok, data: { id } }
 * PATCH  { id, body?, pinned? }            → { ok }
 * DELETE { id }                            → { ok }   (작성자 본인 또는 super_admin)
 *
 * 저장 표: customer_notes (마이그 migrate-customer-notes). 표가 아직 없으면 GET은 ready:false, 쓰기는 409.
 * 회원에 매달린 메모(member_id)와 그 회원에 연결된 잠재 행의 메모(potential_donor_id)를 함께 보여 준다.
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import { logAdminAction } from "../../lib/audit";

export const config = { path: "/api/admin/customer-notes" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };
const rowsOf = (r: any): any[] => (r?.rows ?? r ?? []) as any[];

function res(status: number, body: object) {
  return new Response(jsonKST(body), { status, headers: JSON_HEADER });
}
function jsonError(step: string, err: any) {
  return res(500, {
    ok: false, error: "고객 메모 처리 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  });
}
const isMissingTable = (err: any) => /relation "customer_notes" does not exist/i.test(String(err?.message || err));

/** 회원 id ↔ 연결된 잠재 id 목록을 함께 구한다(메모는 양쪽에 붙을 수 있음) */
async function resolveScope(memberId: number, potentialId: number): Promise<{ memberId: number; potentialIds: number[] }> {
  let mid = memberId;
  const pids = new Set<number>();
  if (potentialId) {
    pids.add(potentialId);
    if (!mid) {
      const p = rowsOf(await db.execute(sql`SELECT linked_member_id FROM potential_donors WHERE id = ${potentialId} LIMIT 1`))[0];
      mid = Number(p?.linked_member_id) || 0;
    }
  }
  if (mid) {
    const linked = rowsOf(await db.execute(sql`SELECT id FROM potential_donors WHERE linked_member_id = ${mid}`));
    for (const r of linked) pids.add(Number(r.id));
  }
  return { memberId: mid, potentialIds: [...pids].filter(Boolean) };
}

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" } });

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;
  const admin = (auth as any).ctx?.admin;
  const adminUid = Number(admin?.uid) || null;
  const adminName = String(admin?.name || (auth as any).ctx?.member?.name || "관리자").slice(0, 50);
  const adminRole = String((auth as any).ctx?.member?.role || admin?.role || "");

  const url = new URL(req.url);

  /* ── GET: 목록 ── */
  if (req.method === "GET") {
    const memberId = Number(url.searchParams.get("member")) || 0;
    const potentialId = Number(url.searchParams.get("potential")) || 0;
    if (!memberId && !potentialId) return res(400, { ok: false, error: "member 또는 potential 필요" });
    try {
      const scope = await resolveScope(memberId, potentialId);
      const pidArr = scope.potentialIds.length ? scope.potentialIds : [0];
      const rs = await db.execute(sql`
        SELECT id, member_id, potential_donor_id, body, pinned, created_by, created_by_name, created_at, updated_at
          FROM customer_notes
         WHERE (${scope.memberId}::int > 0 AND member_id = ${scope.memberId})
            OR potential_donor_id = ANY(${sql.raw(`ARRAY[${pidArr.join(",")}]::int[]`)})
         ORDER BY pinned DESC, created_at DESC
         LIMIT 200`);
      const list = rowsOf(rs).map((n) => ({
        id: Number(n.id), memberId: n.member_id ? Number(n.member_id) : null,
        potentialId: n.potential_donor_id ? Number(n.potential_donor_id) : null,
        body: String(n.body || ""), pinned: !!n.pinned,
        createdBy: n.created_by ? Number(n.created_by) : null, createdByName: n.created_by_name || null,
        createdAt: n.created_at ? new Date(n.created_at).toISOString() : null,
        updatedAt: n.updated_at ? new Date(n.updated_at).toISOString() : null,
        canDelete: adminRole === "super_admin" || (adminUid != null && Number(n.created_by) === adminUid),
      }));
      return res(200, { ok: true, data: { ready: true, list } });
    } catch (err) {
      if (isMissingTable(err)) return res(200, { ok: true, data: { ready: false, list: [], hint: "메모 저장소(customer_notes)가 아직 없습니다 — migrate-customer-journey?run=1 실행 필요" } });
      return jsonError("select", err);
    }
  }

  let body: any = {};
  try { body = await req.json(); } catch { return res(400, { ok: false, error: "JSON 파싱 실패" }); }

  /* ── POST: 추가 ── */
  if (req.method === "POST") {
    const memberId = Number(body.memberId) || 0;
    const potentialId = Number(body.potentialId) || 0;
    const text = String(body.body || "").trim();
    if (!memberId && !potentialId) return res(400, { ok: false, error: "memberId 또는 potentialId 필요" });
    if (!text) return res(400, { ok: false, error: "메모 내용을 입력하세요" });
    if (text.length > 4000) return res(400, { ok: false, error: "메모는 4,000자 이내" });
    try {
      /* 회원이 있으면 회원에, 없으면 잠재에 붙인다(연결되면 둘 다 보임) */
      let mid = memberId;
      if (!mid && potentialId) {
        const p = rowsOf(await db.execute(sql`SELECT linked_member_id FROM potential_donors WHERE id = ${potentialId} LIMIT 1`))[0];
        mid = Number(p?.linked_member_id) || 0;
      }
      const ins = rowsOf(await db.execute(sql`
        INSERT INTO customer_notes (member_id, potential_donor_id, body, pinned, created_by, created_by_name, created_at, updated_at)
        VALUES (${mid || null}, ${mid ? null : potentialId}, ${text}, ${body.pinned === true}, ${adminUid}, ${adminName}, NOW(), NOW())
        RETURNING id`));
      const id = Number(ins[0]?.id) || 0;
      await logAdminAction(req as any, admin?.uid, admin?.name, "customer_note_create", {
        target: mid ? `M-${mid}` : `PD-${potentialId}`, detail: { noteId: id, length: text.length },
      }).catch(() => {});
      return res(200, { ok: true, message: "메모 저장", data: { id } });
    } catch (err) {
      if (isMissingTable(err)) return res(409, { ok: false, error: "메모 저장소가 아직 준비되지 않았습니다(마이그 필요)" });
      return jsonError("insert", err);
    }
  }

  /* ── PATCH: 수정·고정 ── */
  if (req.method === "PATCH") {
    const id = Number(body.id) || 0;
    if (!id) return res(400, { ok: false, error: "id 필요" });
    try {
      const cur = rowsOf(await db.execute(sql`SELECT id, created_by FROM customer_notes WHERE id = ${id} LIMIT 1`))[0];
      if (!cur) return res(404, { ok: false, error: "메모 없음" });
      const own = adminUid != null && Number(cur.created_by) === adminUid;
      if (body.body !== undefined && !own && adminRole !== "super_admin") return res(403, { ok: false, error: "본인 메모만 수정할 수 있습니다" });
      const text = body.body !== undefined ? String(body.body || "").trim() : null;
      if (text !== null && !text) return res(400, { ok: false, error: "메모 내용을 입력하세요" });
      await db.execute(sql`
        UPDATE customer_notes
           SET body = COALESCE(${text}, body),
               pinned = COALESCE(${typeof body.pinned === "boolean" ? body.pinned : null}::boolean, pinned),
               updated_at = NOW()
         WHERE id = ${id}`);
      return res(200, { ok: true, message: "수정 완료" });
    } catch (err) {
      if (isMissingTable(err)) return res(409, { ok: false, error: "메모 저장소가 아직 준비되지 않았습니다(마이그 필요)" });
      return jsonError("update", err);
    }
  }

  /* ── DELETE ── */
  if (req.method === "DELETE") {
    const id = Number(body.id) || 0;
    if (!id) return res(400, { ok: false, error: "id 필요" });
    try {
      const cur = rowsOf(await db.execute(sql`SELECT id, created_by, member_id, potential_donor_id FROM customer_notes WHERE id = ${id} LIMIT 1`))[0];
      if (!cur) return res(404, { ok: false, error: "메모 없음" });
      const own = adminUid != null && Number(cur.created_by) === adminUid;
      if (!own && adminRole !== "super_admin") return res(403, { ok: false, error: "본인 메모 또는 최고관리자만 삭제할 수 있습니다" });
      await db.execute(sql`DELETE FROM customer_notes WHERE id = ${id}`);
      await logAdminAction(req as any, admin?.uid, admin?.name, "customer_note_delete", {
        target: cur.member_id ? `M-${cur.member_id}` : `PD-${cur.potential_donor_id}`, detail: { noteId: id },
      }).catch(() => {});
      return res(200, { ok: true, message: "삭제 완료" });
    } catch (err) {
      if (isMissingTable(err)) return res(409, { ok: false, error: "메모 저장소가 아직 준비되지 않았습니다(마이그 필요)" });
      return jsonError("delete", err);
    }
  }

  return res(405, { ok: false, error: "Method Not Allowed" });
};
