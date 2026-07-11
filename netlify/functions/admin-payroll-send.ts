/**
 * POST /api/admin-payroll-send
 *   body: { year: number, month: number, slipIds?: number[] }
 *
 * APPROVED 상태 명세서만 발송 가능.
 * Resend rate limit 대응: 10명 단위 batch + 각 batch 사이 500ms delay.
 * PDF 첨부 (base64) — 본인 명세서 1건씩 첨부.
 * 발송 후 status=SENT·sent_at·email_sent_to 갱신 + payroll_send_history 적재.
 *
 * 2026-07-11 — 발송 시점에 교부 문서를 저장소에 고정(해시 포함)하고, 직원에게 수령확인(전자서명)을 요청한다.
 */
import { db } from "../../db/index";
import { payrollSlips, members } from "../../db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { sendEmail } from "../../lib/email";
import { payrollSlipFilename } from "../../lib/payroll-pdf";
import { issuePayrollDocument, fetchPayrollDocument } from "../../lib/payroll-document";
import { sendWorkspaceNotification } from "../../lib/workspace-logger";
import { notifyPayrollIssued } from "../../lib/notify-payroll";

export const config = { path: "/api/admin-payroll-send" };

const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 500;

function jsonOk(data: unknown) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "급여 명세서 발송 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}
function jsonBadRequest(msg: string) {
  return new Response(JSON.stringify({ ok: false, error: msg }), {
    status: 400, headers: { "Content-Type": "application/json" },
  });
}

function buildEmailHtml(opts: { name: string; year: number; month: number; grossPay: number | string; orgName: string }) {
  const grossFmt = Math.round(Number(opts.grossPay || 0)).toLocaleString("ko-KR");
  return `
    <div style="font-family:'Pretendard','Noto Sans KR',Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a2035">
      <div style="background:#3730a3;color:#fff;padding:24px;border-radius:10px 10px 0 0">
        <div style="font-size:13px;opacity:0.85">${opts.orgName}</div>
        <div style="font-size:22px;font-weight:700;margin-top:6px">${opts.year}년 ${String(opts.month).padStart(2, "0")}월 급여명세서</div>
      </div>
      <div style="background:#fff;padding:24px;border:1px solid #e5e7eb;border-top:none">
        <p style="font-size:14px;line-height:1.7;margin:0 0 16px">
          <strong>${opts.name}</strong> 님,<br>
          ${opts.year}년 ${opts.month}월 급여명세서를 전달드립니다.
        </p>
        <div style="background:#f3f4ff;border-left:4px solid #6366f1;padding:14px 16px;border-radius:6px;margin:16px 0">
          <div style="font-size:12px;color:#6b7280;font-weight:600">세전 총액 (Gross)</div>
          <div style="font-size:22px;font-weight:700;color:#3730a3;margin-top:4px">${grossFmt} 원</div>
        </div>
        <p style="font-size:13px;color:#4b5563;line-height:1.7;margin:16px 0">
          상세 내역은 첨부된 PDF 명세서를 확인해 주세요.<br>
          ※ 위 금액은 세전 총액(Gross)이며, 첨부 PDF 명세서에 4대보험·소득세 공제 내역과 실수령액(Net)이 모두 포함되어 있습니다.
        </p>
        <p style="font-size:12px;color:#6b7280;margin:20px 0 0;padding-top:16px;border-top:1px solid #e5e7eb">
          본 메일은 발신 전용입니다. 문의 사항은 협의회 사무국으로 연락 부탁드립니다.
        </p>
      </div>
    </div>
  `;
}

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

export default async function handler(req: Request) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  if ((auth as any).ctx.member.role !== "super_admin") {
    return new Response(JSON.stringify({ ok: false, error: "슈퍼어드민 전용" }), {
      status: 403, headers: { "Content-Type": "application/json" },
    });
  }
  const admin = (auth as any).ctx.member;

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "POST 전용" }), {
      status: 405, headers: { "Content-Type": "application/json" },
    });
  }

  let body: any;
  try { body = await req.json(); } catch { return jsonBadRequest("JSON 본문 필수"); }
  const year = Number(body?.year);
  const month = Number(body?.month);
  if (!year || !month) return jsonBadRequest("year·month 필수");

  const orgName = process.env.ORG_NAME || "(사)교사유가족협의회";

  // 1. 후보 — APPROVED만
  let candidates: any[] = [];
  try {
    const conds = [
      eq(payrollSlips.payYear, year),
      eq(payrollSlips.payMonth, month),
      eq(payrollSlips.status, "APPROVED"),
    ];
    const where = Array.isArray(body?.slipIds) && body.slipIds.length > 0
      ? and(...conds, inArray(payrollSlips.id, body.slipIds.map((n: any) => Number(n)).filter((n: number) => !isNaN(n))))
      : and(...conds);
    candidates = await db.select().from(payrollSlips).where(where);
  } catch (err) { return jsonError("select_candidates", err); }

  if (candidates.length === 0) {
    return jsonOk({ year, month, sent: 0, failed: 0, total: 0, note: "APPROVED 상태 명세서 없음" });
  }

  // 2. 회원 정보 일괄 조회 (separate query + Map)
  const memberIds = Array.from(new Set(candidates.map(c => Number(c.memberUid)).filter(n => !isNaN(n))));
  const memberMap = new Map<number, any>();
  try {
    if (memberIds.length > 0) {
      const ms = await db.select({
        id: members.id, name: members.name, email: members.email,
        role: members.role, milestoneRole: members.milestoneRole,
      }).from(members).where(inArray(members.id, memberIds));
      for (const m of ms) memberMap.set(m.id, m);
    }
  } catch (err) {
    console.warn("[admin-payroll-send] member batch lookup failed:", err);
  }

  // 3. 10명 단위 batch 발송
  let sent = 0, failed = 0;
  const details: Array<{ slipId: number; memberUid: string; status: "SUCCESS" | "FAILED"; error?: string; resendId?: string }> = [];

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);

    await Promise.all(batch.map(async (slip) => {
      const memberId = Number(slip.memberUid);
      const m = memberMap.get(memberId);
      const memberInfo = m || { name: `회원ID:${slip.memberUid}`, email: null };

      // 이메일 누락 시 실패 기록
      if (!memberInfo.email) {
        failed++;
        details.push({ slipId: slip.id, memberUid: slip.memberUid, status: "FAILED", error: "회원 이메일 없음" });
        try {
          await db.execute(sql`
            INSERT INTO payroll_send_history (slip_id, sent_by, sent_to, status, error_message)
            VALUES (${slip.id}, ${String(admin.id)}, '', 'FAILED', '회원 이메일 없음')
          `);
        } catch { /* 적재 실패 무시 */ }
        return;
      }

      try {
        /* 교부 문서 확정 — 이 순간의 PDF를 저장소에 고정하고 지문(해시)을 남긴다.
           이후 직원이 보는 문서·서명 대상·증빙은 전부 이 고정본이다.
           (과거엔 저장 없이 매번 즉석 생성 → 요율·기준이 바뀌면 과거 명세서가 달라져 증빙 불가) */
        const issued = await issuePayrollDocument(slip.id);
        if (!issued.ok) throw new Error(issued.error || "교부 문서 확정 실패");

        const pdfBytes = issued.bytes ?? (await fetchPayrollDocument(slip.id)).bytes;
        if (!pdfBytes) throw new Error("교부 문서를 읽지 못했습니다");
        const filename = payrollSlipFilename({ ...slip, documentVersion: issued.version }, memberInfo.name);
        const base64 = Buffer.from(pdfBytes).toString("base64");

        // 이메일 발송
        const r = await sendEmail({
          to: memberInfo.email,
          subject: `[${orgName}] ${year}년 ${String(month).padStart(2, "0")}월 급여명세서`,
          html: buildEmailHtml({ name: memberInfo.name, year, month, grossPay: slip.grossPay, orgName }),
          attachments: [{ filename, content: base64 }],
        });

        if (r.ok) {
          sent++;
          details.push({ slipId: slip.id, memberUid: slip.memberUid, status: "SUCCESS", resendId: (r as any).id });
          // status=SENT 갱신 + 수령확인 대기 시작
          try {
            await db.execute(sql`
              UPDATE payroll_slips SET
                status = 'SENT',
                sent_at = NOW(),
                issued_at = COALESCE(issued_at, NOW()),
                ack_status = CASE WHEN ack_status = 'ACKNOWLEDGED' THEN ack_status ELSE 'PENDING' END,
                email_sent_to = ${memberInfo.email},
                updated_at = NOW()
              WHERE id = ${slip.id}
            `);
            await db.execute(sql`
              INSERT INTO payroll_send_history (slip_id, sent_by, sent_to, status, resend_id)
              VALUES (${slip.id}, ${String(admin.id)}, ${memberInfo.email}, 'SUCCESS', ${(r as any).id || null})
            `);
          } catch (e) {
            console.warn("[admin-payroll-send] post-send update failed:", e);
          }

          /* 직원에게 알림 — 메일만 보내면 안 보는 경우가 많다.
             ① 워크스페이스 종(인앱) ② 카카오 알림톡(승인 전이면 문자) 둘 다 보낸다. */
          try {
            await sendWorkspaceNotification({
              memberId,
              sourceType: "event" as any,
              sourceId: slip.id,
              notifType: "assigned",
              channel: "bell",
              title: `${year}년 ${String(month).padStart(2, "0")}월 급여명세서가 도착했습니다`,
              body: "명세서를 확인하고 수령 확인(전자서명)을 해주세요.",
              actionUrl: `/workspace-attendance.html#payroll-slip=${slip.id}`,
              category: "system",
            });
          } catch (e) {
            console.warn("[admin-payroll-send] 인앱 알림 실패:", e);
          }
          try {
            await notifyPayrollIssued({
              memberId,
              memberName: memberInfo.name,
              year, month,
              netPay: slip.netPay,
              orgName,
            });
          } catch (e) {
            console.warn("[admin-payroll-send] 알림톡·문자 발송 실패:", e);
          }
        } else {
          failed++;
          const errMsg = String((r as any).error?.message || (r as any).error || "발송 실패").slice(0, 500);
          details.push({ slipId: slip.id, memberUid: slip.memberUid, status: "FAILED", error: errMsg });
          try {
            await db.execute(sql`
              INSERT INTO payroll_send_history (slip_id, sent_by, sent_to, status, error_message)
              VALUES (${slip.id}, ${String(admin.id)}, ${memberInfo.email}, 'FAILED', ${errMsg})
            `);
          } catch { /* 적재 실패 무시 */ }
        }
      } catch (err: any) {
        failed++;
        const errMsg = String(err?.message || err).slice(0, 500);
        details.push({ slipId: slip.id, memberUid: slip.memberUid, status: "FAILED", error: errMsg });
        try {
          await db.execute(sql`
            INSERT INTO payroll_send_history (slip_id, sent_by, sent_to, status, error_message)
            VALUES (${slip.id}, ${String(admin.id)}, ${memberInfo.email || ""}, 'FAILED', ${errMsg})
          `);
        } catch { /* 적재 실패 무시 */ }
      }
    }));

    // 다음 batch 전 delay (마지막 batch 제외)
    if (i + BATCH_SIZE < candidates.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  return jsonOk({
    year, month,
    total: candidates.length,
    sent, failed,
    details: details.slice(0, 50),    // 응답 크기 제한
  });
}
