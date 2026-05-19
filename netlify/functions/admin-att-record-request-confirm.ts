/**
 * /api/admin-att-record-request-confirm — 어드민 → 직원 "잘못 찍었으니 확인하라" 알림
 *
 * R39 Stage 7 A-3.
 *
 * POST body: { recordId, message? }
 *   message가 없으면 기본 안내문 사용.
 *
 * 직원에게 인앱 알림 (createNotification·recipientType='user')
 * 워크스페이스 알림 패널에서 자동 노출.
 */
import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { createNotification } from "../../lib/notify";

export const config = { path: "/api/admin-att-record-request-confirm" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

function jsonOk(data: unknown) {
  return new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: JSON_HEADER });
}
function jsonErr(error: string, status = 400, detail?: string) {
  return new Response(JSON.stringify({ ok: false, error, ...(detail ? { detail } : {}) }),
    { status, headers: JSON_HEADER });
}

export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "POST") return jsonErr("POST만 지원", 405);

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  if ((auth as any).ctx.member.role !== "super_admin") {
    return jsonErr("슈퍼어드민 전용", 403);
  }

  let body: any;
  try { body = await req.json(); } catch { return jsonErr("요청 본문 파싱 실패", 400); }

  const recordId = Number(body.recordId);
  const messageRaw = typeof body.message === "string" ? body.message.trim() : "";
  if (!recordId || !Number.isFinite(recordId)) return jsonErr("recordId 필수", 400);

  /* 출퇴근 기록 조회 — 수신자(member_uid) 식별 */
  let rec: any;
  try {
    const r = await db.execute(sql`
      SELECT id, member_uid, date FROM att_records WHERE id = ${recordId} LIMIT 1
    `);
    rec = (((r as any).rows ?? r) as any[])[0];
    if (!rec) return jsonErr("해당 출퇴근 기록을 찾을 수 없습니다", 404);
  } catch (e: any) {
    return jsonErr("기록 조회 실패", 500, String(e?.message || e).slice(0, 300));
  }

  const memberUid = Number(rec.member_uid);
  if (!Number.isFinite(memberUid)) return jsonErr("수신자 식별 실패 (member_uid 형식 오류)", 500);

  const defaultMessage = "출퇴근 기록을 다시 확인해주세요. 잘못 찍힌 경우 근태관리에서 수정 요청을 등록하세요.";
  const message = messageRaw || defaultMessage;
  const adminName = String((auth as any).ctx.member.name || "관리자");

  try {
    const nid = await createNotification({
      recipientId:   memberUid,
      recipientType: "user",
      category:      "system",
      severity:      "warning",
      title:         `📨 ${adminName} 님의 출퇴근 확인 요청 (${rec.date})`,
      message:       message,
      link:          "/workspace-attendance.html",
      refTable:      "att_records",
      refId:         recordId,
    });
    return jsonOk({ notificationId: nid, memberUid, message });
  } catch (e: any) {
    return jsonErr("알림 발송 실패", 500, String(e?.message || e).slice(0, 300));
  }
}
