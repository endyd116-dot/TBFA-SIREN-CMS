/**
 * nurture-test-cleanup — 1회용: 너처링 테스트로 만든 회원(prospect_entry_path='nurture_test')과 흔적 삭제.
 * GET                 → 진단(대상·읽기만)
 * GET ?secret=..&run=1 → 삭제 실행 (자식부터 안전 순서). 호출 후 삭제.
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/nurture-test-cleanup" };
const H = { "Content-Type": "application/json; charset=utf-8" };
function out(o: object, s = 200) { return new Response(JSON.stringify(o, null, 2), { status: s, headers: H }); }
function rows(r: any): any[] { return (r?.rows ?? r ?? []) as any[]; }
function n(r: any): number { return Number((r as any)?.rowCount ?? (r as any)?.count ?? 0) || 0; }

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  /* 테스트 회원: 마커 nurture_test (이메일 endyd116@gmail.com 안전 확인) */
  const tgt = rows(await db.execute(sql`
    SELECT id, name, email, donor_type AS "donorType" FROM members
     WHERE prospect_entry_path = 'nurture_test'`));

  if (!run) return out({ ok: true, mode: "diagnostic", targets: tgt, hint: "?secret=..&run=1" });
  if (!process.env.INTERNAL_TRIGGER_SECRET || url.searchParams.get("secret") !== process.env.INTERNAL_TRIGGER_SECRET) return out({ ok: false, error: "시크릿 불일치" }, 403);
  if (!tgt.length) return out({ ok: true, deleted: 0, note: "대상 없음" });

  const ids = tgt.map((m) => Number(m.id)).filter(Number.isFinite);
  const idArr = sql.raw(`ARRAY[${ids.join(",") || "0"}]::int[]`);
  const del: any = {};
  try {
    /* 자식부터: 너처링 발송기록 → 참여 → 발송 수신자 → 인앱 알림 → 회원 */
    del.nurtureSends = n(await db.execute(sql`DELETE FROM nurture_sends WHERE enrollment_id IN (SELECT id FROM nurture_enrollments WHERE member_id = ANY(${idArr}))`));
    del.enrollments = n(await db.execute(sql`DELETE FROM nurture_enrollments WHERE member_id = ANY(${idArr})`));
    del.sendRecipients = n(await db.execute(sql`DELETE FROM communication_send_recipients WHERE member_id = ANY(${idArr})`));
    try { del.notifications = n(await db.execute(sql`DELETE FROM notifications WHERE recipient_id = ANY(${idArr}) AND recipient_type = 'user'`)); } catch (e) { del.notifications = "skip:" + String((e as any)?.message || e).slice(0, 60); }
    try { del.pointLogs = n(await db.execute(sql`DELETE FROM member_point_logs WHERE member_id = ANY(${idArr})`)); } catch { del.pointLogs = 0; }
    del.members = n(await db.execute(sql`DELETE FROM members WHERE id = ANY(${idArr})`));
    return out({ ok: true, deletedMemberIds: ids, deleted: del });
  } catch (e: any) {
    return out({ ok: false, error: String(e?.message || e).slice(0, 400), partial: del }, 500);
  }
};
