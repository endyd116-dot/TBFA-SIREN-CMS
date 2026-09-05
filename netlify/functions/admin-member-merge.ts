// netlify/functions/admin-member-merge.ts
// 중복 회원 병합 도구 (2026-09-06) — 효성 계약 통과가 만든 임시 계정(…@noemail.siren.local)을 원래 회원으로 합친다.
//
// GET /api/admin-member-merge?from=<임시계정 id>&into=<남길 회원 id>            : 미리보기(참조 건수)
// GET /api/admin-member-merge?from=&into=&run=1                                 : 실행 (어드민 세션 · 통합 회원 관리 권한)
//   - from 회원의 효성 정보(회원번호·계약상태·결제수단 등)를 into 회원에 채운다(into 에 없을 때만)
//   - 효성 계약/수납·미확정·후원·빌링키·포인트·알림·감사로그 참조를 into 로 옮긴다
//   - from 삭제는 이메일이 자리표시(@noemail.siren.local)일 때만 (실계정은 ?force=1 필요)

import { eq, sql } from "drizzle-orm";
import { db, members } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import { canAccess } from "../../lib/role-permission-check";
import { logAdminAction } from "../../lib/audit";

export const config = { path: "/api/admin-member-merge" };

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body, null, 2), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}
function rowsOf(res: any): any[] { return (res?.rows ?? res ?? []) as any[]; }

/* 옮길 참조: [표, 컬럼] — FK 여부와 무관하게 회원 id를 가리키는 컬럼 */
const REFS: Array<[string, string]> = [
  ["hyosung_contracts", "linked_member_id"],
  /* hyosung_billings 는 회원 참조 컬럼이 없다(member_no·linked_donation_id 뿐) — 2026-09-06 실행 결과 -1 로 드러나 제외 */
  ["pending_donations", "matched_member_id"],
  ["donations", "member_id"],
  ["billing_keys", "member_id"],
  ["billing_logs", "member_id"],
  ["member_point_logs", "member_id"],
  ["notifications", "recipient_id"],
  ["audit_logs", "user_id"],
  ["password_reset_tokens", "member_id"],
  ["email_verification_tokens", "member_id"],
];

async function countRefs(id: number): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const [t, c] of REFS) {
    try {
      const r: any = await db.execute(sql.raw(`SELECT COUNT(*)::int AS n FROM ${t} WHERE ${c} = ${id}`));
      const n = Number(rowsOf(r)[0]?.n || 0);
      if (n) out[`${t}.${c}`] = n;
    } catch { /* 표 없음 */ }
  }
  return out;
}

export default async (req: Request) => {
  if (req.method !== "GET") return json({ ok: false, error: "GET만 허용" }, 405);
  const guard: any = await requireAdmin(req);
  if (!guard.ok) return guard.res;
  const { admin, member: adminMember } = guard.ctx;
  if (!(await canAccess(String(adminMember?.role || ""), "siren_member"))) return json({ ok: false, error: "회원 관리 권한이 없습니다" }, 403);

  const url = new URL(req.url);
  const from = Number(url.searchParams.get("from") || 0);
  const into = Number(url.searchParams.get("into") || 0);
  const run = url.searchParams.get("run") === "1";
  const force = url.searchParams.get("force") === "1";
  if (!Number.isInteger(from) || !Number.isInteger(into) || from < 1 || into < 1 || from === into) return json({ ok: false, error: "from·into 회원 id를 지정해 주세요(서로 달라야 함)" }, 400);

  const [a] = await db.select().from(members).where(eq(members.id, from)).limit(1);
  const [b] = await db.select().from(members).where(eq(members.id, into)).limit(1);
  if (!a || !b) return json({ ok: false, error: "회원을 찾을 수 없습니다" }, 404);

  const isPlaceholder = /@noemail\.siren\.local$/i.test(String(a.email || ""));
  const preview = {
    from: { id: a.id, name: a.name, phone: a.phone, email: a.email, hyosungMemberNo: (a as any).hyosungMemberNo, placeholder: isPlaceholder, refs: await countRefs(a.id) },
    into: { id: b.id, name: b.name, phone: b.phone, email: b.email, hyosungMemberNo: (b as any).hyosungMemberNo, refs: await countRefs(b.id) },
  };
  if (!run) return json({ ok: true, mode: "preview", preview, note: "?run=1 을 붙이면 병합합니다. from 삭제는 자리표시 이메일일 때만(실계정은 &force=1)." });
  if (!isPlaceholder && !force) return json({ ok: false, error: "from 회원이 실계정(자리표시 이메일 아님)입니다. 정말 합치려면 &force=1", preview }, 409);

  try {
    /* 1) 효성·후원 분류 정보 — into 에 없을 때만 채운다 */
    await db.execute(sql`
      UPDATE members t SET
        hyosung_member_no        = COALESCE(t.hyosung_member_no, f.hyosung_member_no),
        hyosung_contract_status  = COALESCE(t.hyosung_contract_status, f.hyosung_contract_status),
        hyosung_payment_method   = COALESCE(t.hyosung_payment_method, f.hyosung_payment_method),
        hyosung_payment_tool     = COALESCE(t.hyosung_payment_tool, f.hyosung_payment_tool),
        hyosung_bank_info        = COALESCE(t.hyosung_bank_info, f.hyosung_bank_info),
        hyosung_promise_day      = COALESCE(t.hyosung_promise_day, f.hyosung_promise_day),
        hyosung_synced_at        = COALESCE(t.hyosung_synced_at, f.hyosung_synced_at),
        donor_type               = CASE WHEN t.donor_type IS NULL OR t.donor_type = 'none' THEN f.donor_type ELSE t.donor_type END,
        donor_channels           = CASE WHEN t.donor_channels IS NULL OR t.donor_channels = '[]'::jsonb THEN f.donor_channels ELSE t.donor_channels END,
        member_category          = COALESCE(t.member_category, f.member_category, 'sponsor'),
        updated_at               = NOW()
      FROM members f WHERE t.id = ${into} AND f.id = ${from}
    `);
    /* from 의 효성번호는 비워서 UNIQUE/중복 걸림 방지 */
    await db.execute(sql`UPDATE members SET hyosung_member_no = NULL WHERE id = ${from}`);

    /* 2) 참조 이전 */
    const moved: Record<string, number> = {};
    for (const [t, c] of REFS) {
      try {
        const r: any = await db.execute(sql.raw(`UPDATE ${t} SET ${c} = ${into} WHERE ${c} = ${from} RETURNING 1 AS x`));
        const n = rowsOf(r).length;
        if (n) moved[`${t}.${c}`] = n;
      } catch (e) { moved[`${t}.${c}`] = -1; }
    }

    /* 3) from 삭제 */
    const del: any = await db.execute(sql`DELETE FROM members WHERE id = ${from} RETURNING id`);
    const deleted = rowsOf(del).length;

    await logAdminAction(req, admin.uid, admin.name, "member_merge", {
      target: `M-${from}→M-${into}`,
      detail: { from: preview.from, into: { id: into, name: b.name }, moved, deleted, force },
    });
    return json({ ok: true, mode: "run", from, into, moved, deleted, note: "효성 계약/수납·후원·알림 참조를 옮기고 임시 계정을 지웠습니다." });
  } catch (e: any) {
    console.error("[admin-member-merge]", e);
    return json({ ok: false, error: "병합 실패", detail: String(e?.message || e).slice(0, 300) }, 500);
  }
};
