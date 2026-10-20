/**
 * POST /api/admin/potential-donor-event-group  { eventName }   (2026-10-20)
 *
 * 잠재 후원자 «이벤트 참여자»를 발송 수신자 그룹으로 준비한다 — 잠재 표의 「이 이벤트 참여자에게 발송」.
 *   1) 아직 회원 기록이 없는 참여자(전화·이메일 있음)를 연락 가능한 리드 회원으로 만들어 연결(멱등 — 너처링 동기화와 같은 규칙)
 *   2) 수신자 그룹 «[이벤트] {이벤트명}»을 찾거나 만든다(조건: 잠재 이벤트 참여 = 이벤트명)
 *   3) 채널별 발송 가능 인원(문자·카톡·이메일 — 탈퇴·미인증·미동의 제외)을 센다
 * 응답: { ok, data: { groupId, groupName, created, leads:{scanned,linked,created}, counts:{total,sms,kakao,email} } }
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import { logAdminAction } from "../../lib/audit";
import { ensureLeadMembersForEvents } from "../../lib/potential-donor-link";
import { resolveRecipients, type RecipientCriteria } from "../../lib/recipient-resolve";

export const config = { path: "/api/admin/potential-donor-event-group" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };
const rowsOf = (r: any): any[] => (r?.rows ?? r ?? []) as any[];
const res = (status: number, body: object) => new Response(jsonKST(body), { status, headers: JSON_HEADER });

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" } });
  if (req.method !== "POST") return res(405, { ok: false, error: "Method Not Allowed" });
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;
  const admin = (auth as any).ctx?.admin;
  const adminUid = Number(admin?.uid) || null;

  let body: any = {};
  try { body = await req.json(); } catch { return res(400, { ok: false, error: "JSON 파싱 실패" }); }
  const eventName = String(body.eventName || "").trim().slice(0, 100);
  if (!eventName) return res(400, { ok: false, error: "eventName 필요" });

  let step = "leads";
  try {
    const leads = await ensureLeadMembersForEvents([eventName]);

    step = "group";
    const groupName = `[이벤트] ${eventName}`.slice(0, 100);
    const criteria: RecipientCriteria = { type: "filter", logic: "and", filters: [{ field: "potentialEvent", op: "eq", value: eventName }] };
    let groupId = Number(rowsOf(await db.execute(sql`SELECT id FROM recipient_groups WHERE name = ${groupName} ORDER BY id ASC LIMIT 1`))[0]?.id) || 0;
    let created = false;
    if (!groupId) {
      const ins = rowsOf(await db.execute(sql`
        INSERT INTO recipient_groups (name, description, criteria, is_active, created_by, updated_by, created_at, updated_at)
        VALUES (${groupName}, ${`잠재 후원자 이벤트 «${eventName}» 참여자 (잠재 표에서 자동 생성 · 조건: 잠재 이벤트 참여 = ${eventName})`},
                ${JSON.stringify(criteria)}::jsonb, true, ${adminUid}, ${adminUid}, NOW(), NOW())
        RETURNING id`));
      groupId = Number(ins[0]?.id) || 0;
      created = true;
    } else {
      /* 조건을 최신 규칙으로 맞추고 활성화(운영자가 비활성화했다면 되살림) */
      await db.execute(sql`UPDATE recipient_groups SET criteria = ${JSON.stringify(criteria)}::jsonb, is_active = true, updated_by = ${adminUid}, updated_at = NOW() WHERE id = ${groupId}`);
    }

    step = "count";
    const [total, smsN, kakaoN, emailN] = await Promise.all([
      resolveRecipients(criteria, { countOnly: true }),
      resolveRecipients(criteria, { countOnly: true, channel: "sms" }),
      resolveRecipients(criteria, { countOnly: true, channel: "kakao" }),
      resolveRecipients(criteria, { countOnly: true, channel: "email" }),
    ]);

    await logAdminAction(req as any, admin?.uid, admin?.name, "potential_event_group", {
      target: `recipient_group:${groupId}`, detail: { eventName, created, leads, total: total.count },
    }).catch(() => {});

    return res(200, {
      ok: true,
      message: `${created ? "수신자 그룹을 만들었습니다" : "기존 수신자 그룹을 썼습니다"} — ${groupName} (${total.count}명)`,
      data: { groupId, groupName, created, leads, counts: { total: total.count, sms: smsN.count, kakao: kakaoN.count, email: emailN.count } },
    });
  } catch (err: any) {
    return res(500, { ok: false, error: "이벤트 수신자 그룹 준비 실패", step, detail: String(err?.message || err).slice(0, 500), stack: String(err?.stack || "").slice(0, 1000) });
  }
};
