/**
 * migrate-kicc-recover — KICC 일시 후원 미반영(승인 미수신) 복구 도구 (1회용)
 *
 * 배경(2026-06-26 인시던트): KICC에서 매입완료된 일시 후원이 우리 시스템에 미반영.
 *   원인 = 승인 응답 타임아웃/네트워크 단절로 donate-kicc-approve가 후원을 pending/failed로 남김
 *   + 웹훅 백업은 failed→completed 승격 거부(상태 우선순위)·금액필드 불일치로 보류.
 *
 * 동작:
 *   GET (진단·인증):       pgProvider='kicc' AND status IN ('pending','failed')인 최근 후원을
 *                          나열하고, 각 건을 KICC 거래조회(retrieveTransaction)로 실제 승인/금액 확인.
 *                          ★ 아무것도 변경하지 않음(읽기 전용). 어떤 건이 복구 대상인지 먼저 눈으로 확인.
 *   GET ?run=1 (복구·인증): KICC가 "결제됨 + 금액 일치"로 확인한 건만 completed로 확정 +
 *                          영수증 번호 발급 + 감사 메일 발송 + (지정 후원이면) 캠페인 통계 재계산.
 *                          멱등(이미 completed면 skip). KICC 미확인 건은 건드리지 않음.
 *
 * 안전: 재승인(approveTrade) 절대 호출 안 함(이중청구 위험) — 읽기 전용 거래조회로만 확인.
 *
 * 호출 후 즉시 삭제(1회용 보안 원칙).
 */
import { and, eq, inArray, gte } from "drizzle-orm";
import { db, donations } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import { retrieveTransaction } from "../../lib/kicc";
import { sendEmail, tplDonationThanks } from "../../lib/email";
import { recalcCampaignStatsSafe } from "../../lib/campaign-stats";
import { logAudit } from "../../lib/audit";

export const config = { path: "/api/migrate-kicc-recover" };

const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

/** shopTransactionId(승인) 재구성 — lib/kicc makeTxId(shopOrderNo,"AP")와 동일 규칙(≤60Byte) */
function approvalTxId(pgOrderNo: string): string {
  const s = `${pgOrderNo}-AP`;
  return s.length > 60 ? s.slice(s.length - 60) : s;
}

/** Date → KST yyyyMMdd (KICC transactionDate) */
function ymdKST(d: Date): string {
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  return `${k.getUTCFullYear()}${String(k.getUTCMonth() + 1).padStart(2, "0")}${String(k.getUTCDate()).padStart(2, "0")}`;
}

function generateReceiptNumber(donationId: number): string {
  return `TBFA-${new Date().getFullYear()}-${String(donationId).padStart(6, "0")}`;
}

/** KICC 조회 statusCode가 '취소/환불'을 의미하는지 — 그런 건 복구 대상에서 제외 */
function looksCancelled(statusCode?: string): boolean {
  const s = String(statusCode || "");
  // EP9: 정상 승인은 TS02 등. 취소/환불은 별도 코드(TS10대 등) — 보수적으로 '승인 아님'이면 제외 신호로만 사용.
  return /cancel|환불|취소/i.test(s);
}

export default async function handler(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";
  // 조회 범위(기본 최근 30일). 특정 주문만 보려면 ?orderNo=SIREN-... (콤마 다건)
  const days = Math.min(Math.max(Number(url.searchParams.get("days")) || 30, 1), 120);
  const orderNoFilter = (url.searchParams.get("orderNo") || "")
    .split(",").map((s) => s.trim()).filter(Boolean);

  try {
    const since = new Date(Date.now() - days * 86400_000);

    /* 미반영 후보: KICC · pending/failed · 최근 N일 (또는 지정 주문번호) */
    const whereClause = orderNoFilter.length > 0
      ? inArray(donations.pgOrderNo, orderNoFilter)
      : and(
          eq(donations.pgProvider, "kicc"),
          inArray(donations.status, ["pending", "failed"] as any),
          gte(donations.createdAt, since),
        );

    const rows = await db
      .select({
        id: donations.id,
        pgOrderNo: donations.pgOrderNo,
        donorName: donations.donorName,
        donorEmail: donations.donorEmail,
        amount: donations.amount,
        status: donations.status,
        type: donations.type,
        memberId: donations.memberId,
        campaignId: donations.campaignId,
        pgTid: donations.pgTid,
        createdAt: donations.createdAt,
      })
      .from(donations)
      .where(whereClause as any)
      .limit(200);

    const report: any[] = [];

    for (const d of rows) {
      if (!d.pgOrderNo) {
        report.push({ id: d.id, status: d.status, kicc: "조회불가(주문번호 없음)", action: "skip" });
        continue;
      }
      if (d.status === "completed") {
        report.push({ id: d.id, pgOrderNo: d.pgOrderNo, status: "completed", action: "already" });
        continue;
      }

      /* KICC 거래조회 — 읽기 전용. 승인일자는 후원 생성일(KST) 기준. */
      const txDate = d.createdAt ? ymdKST(new Date(d.createdAt as any)) : undefined;
      const rt = await retrieveTransaction({ shopTransactionId: approvalTxId(d.pgOrderNo), transactionDate: txDate });

      const kiccPaid = rt.success && Number(rt.amount) === Number(d.amount) && !!rt.pgTid && !looksCancelled(rt.statusCode);
      const entry: any = {
        id: d.id,
        pgOrderNo: d.pgOrderNo,
        donor: d.donorName,
        amount: d.amount,
        ourStatus: d.status,
        kiccSuccess: rt.success,
        kiccAmount: rt.amount ?? null,
        kiccStatusCode: rt.statusCode ?? null,
        kiccPgTid: rt.pgTid ?? null,
        kiccError: rt.errorMessage ?? null,
        confirmedPaid: kiccPaid,
      };

      if (!kiccPaid) {
        entry.action = run ? "skip(미확인)" : "복구대상아님(KICC 미확인)";
        report.push(entry);
        continue;
      }

      if (!run) {
        entry.action = "복구대상(?run=1 시 completed 확정)";
        report.push(entry);
        continue;
      }

      /* ===== 복구 실행 (?run=1) — KICC 확인된 건만 ===== */
      const now = new Date();
      const receiptNumber = generateReceiptNumber(d.id);
      const [updated] = await db
        .update(donations)
        .set({
          status: "completed",
          pgTid: rt.pgTid,
          transactionId: rt.pgTid,
          receiptIssued: true,
          receiptIssuedAt: now,
          receiptNumber,
          receiptRequested: true,
          paidAt: now,
          memo: `[복구 ${now.toISOString().slice(0, 10)}] KICC 매입완료 확인(승인 미수신 복구)`,
          updatedAt: now,
        } as any)
        .where(and(eq(donations.id, d.id), inArray(donations.status, ["pending", "failed"] as any)) as any)
        .returning({
          id: donations.id, donorName: donations.donorName, donorEmail: donations.donorEmail,
          amount: donations.amount, type: donations.type, payMethod: donations.payMethod, memberId: donations.memberId,
        });

      if (!updated) {
        entry.action = "skip(이미 처리됨/경합)";
        report.push(entry);
        continue;
      }

      /* 감사 메일 (실패해도 복구는 성공) */
      let emailSent = false;
      try {
        if (updated.donorEmail) {
          const tpl = tplDonationThanks({
            donorName: updated.donorName,
            amount: updated.amount,
            donationType: updated.type as string,
            payMethod: updated.payMethod || "card",
            donationId: updated.id,
            donationDate: now,
            isMember: !!updated.memberId,
          });
          const m = await sendEmail({ to: updated.donorEmail, subject: tpl.subject, html: tpl.html });
          emailSent = !!m.ok;
        }
      } catch (e) {
        console.error("[migrate-kicc-recover] 메일 예외:", e);
      }

      await recalcCampaignStatsSafe(d.campaignId as any);

      await logAudit({
        userId: updated.memberId,
        userType: "system",
        userName: "kicc-recover",
        action: "donate_kicc_recover_complete",
        target: d.pgOrderNo,
        detail: { donationId: updated.id, amount: updated.amount, pgTid: rt.pgTid, receiptNumber, emailSent },
      }).catch(() => {});

      entry.action = "복구완료(completed)";
      entry.receiptNumber = receiptNumber;
      entry.emailSent = emailSent;
      report.push(entry);
    }

    const summary = {
      mode: run ? "복구실행" : "진단(읽기전용)",
      scanned: rows.length,
      confirmedPaid: report.filter((r) => r.confirmedPaid).length,
      recovered: report.filter((r) => r.action === "복구완료(completed)").length,
    };

    return new Response(JSON.stringify({ ok: true, summary, report }, null, 2), { status: 200, headers: JSON_HEADER });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ ok: false, error: "복구 처리 실패", detail: String(err?.message || err).slice(0, 500), stack: String(err?.stack || "").slice(0, 800) }),
      { status: 500, headers: JSON_HEADER },
    );
  }
}
