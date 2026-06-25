/**
 * POST /api/kicc-webhook   ← KICC 결제 노티(webhook) 수신
 *
 * - KICC는 결제/취소 결과를 비동기 노티로 전송 (3분 간격 최대 10회 재전송)
 * - ★ 서명 검증 없음 → resCd "0000" ack 응답으로만 재전송 중단
 * - shopOrderNo/pgCno 기준 멱등(중복 INSERT/상태변경 방지)
 * - donations 상태 동기화 (승인 단계와 별개 — 이중 안전장치)
 *
 * 응답: 항상 200 + { resCd:"0000", resMsg:"정상" } (처리 실패해도 ack — 무한 재전송 방지)
 */
import { eq } from "drizzle-orm";
import { db, donations } from "../../db";
import { logAudit } from "../../lib/audit";
import { verifyMsgAuth } from "../../lib/kicc";
import { notifyAllSuperAdmins } from "../../lib/notify";

function ack(extra?: Record<string, any>): Response {
  return new Response(JSON.stringify({ resCd: "0000", resMsg: "정상", ...(extra || {}) }), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function parseBody(req: Request): Promise<Record<string, any>> {
  const ct = req.headers.get("content-type") || "";
  const raw = await req.text().catch(() => "");
  if (!raw) return {};
  if (ct.includes("application/json")) {
    try {
      return JSON.parse(raw);
    } catch {
      /* fallthrough */
    }
  }
  const obj: Record<string, any> = {};
  for (const [k, v] of new URLSearchParams(raw)) obj[k] = v;
  return obj;
}

/* KICC 노티 → 우리 status (보수적 — 명확한 신호만 반영) */
function mapStatus(p: Record<string, any>): "completed" | "cancelled" | "refunded" | "failed" | null {
  const status = String(p.statusCode || p.transStatus || p.status || "");
  const noti = String(p.notiType || p.notiTypeCode || p.messageType || "");
  const cancelHint = /cancel|revise|refund|취소|환불/i.test(noti) || p.cancelYN === "Y" || !!p.reviseTypeCode;

  if (cancelHint) {
    // 부분취소/환불 구분: reviseTypeCode 40대 = 부분, 그 외 전체취소
    const rt = String(p.reviseTypeCode || "");
    return rt.startsWith("4") ? "refunded" : "cancelled";
  }
  // 승인 성공 신호
  if (String(p.resCd) === "0000" || /TS0[2-9]|승인|approval|paid|done/i.test(status + noti)) return "completed";
  if (/fail|거절|실패|deny/i.test(status + noti)) return "failed";
  return null;
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return ack();
  if (req.method !== "POST") return ack();

  try {
    const p = await parseBody(req);
    const pgTid: string = String(p.pgCno || p.pgTid || "");
    const pgOrderNo: string = String(p.shopOrderNo || p.pgOrderNo || "");

    if (!pgTid && !pgOrderNo) {
      console.warn("[kicc-webhook] 식별자 누락:", Object.keys(p));
      return ack(); // 식별 불가해도 ack
    }

    /* donation 조회 — pgTid 우선, pgOrderNo 폴백 */
    let donation: any = null;
    if (pgTid) {
      const [byTid] = await db.select().from(donations).where(eq(donations.pgTid, pgTid)).limit(1);
      donation = byTid;
    }
    if (!donation && pgOrderNo) {
      const [byOrder] = await db.select().from(donations).where(eq(donations.pgOrderNo, pgOrderNo)).limit(1);
      donation = byOrder;
    }
    if (!donation) {
      console.warn(`[kicc-webhook] donation 미발견: pgTid=${pgTid}, pgOrderNo=${pgOrderNo}`);
      return ack();
    }

    const newStatus = mapStatus(p);
    if (!newStatus) return ack();

    /* 멱등 — 이미 같은 상태면 skip */
    if (donation.status === newStatus) return ack({ idempotent: true });

    /* ★ P1-4 하드닝: KICC 노티는 서명 검증이 없어 위조 가능 → 미결제(pending) 후원을
       completed로 승격하는 경우, 노티 금액이 저장(서버 신뢰) 금액과 정확히 일치할 때만 허용.
       금액 누락·불일치면 승격 보류(fail-safe) — 정상 결제는 동기 승인 경로(approve)가 이미 확정함. */
    if (newStatus === "completed" && donation.status !== "completed") {
      const notiAmount = Number(p.amount ?? p.amt ?? NaN);
      if (!Number.isFinite(notiAmount) || notiAmount !== Number(donation.amount)) {
        console.warn(
          `[kicc-webhook] completed 승격 보류 — 금액 불일치/누락 (noti=${p.amount}, db=${donation.amount}) donationId=${donation.id}`,
        );
        return ack({ skipped: "amount_mismatch" });
      }
    }

    /* 상태 우선순위 — 후퇴 방지 (단, completed→cancelled/refunded는 허용) */
    const priority: Record<string, number> = { pending: 1, completed: 2, failed: 3, cancelled: 4, refunded: 5 };
    const cur = priority[donation.status] || 0;
    const next = priority[newStatus] || 0;
    const downgradeAllowed = donation.status === "completed" && (newStatus === "cancelled" || newStatus === "refunded");

    /* ★ 2026-06-26 FIX: 승인 응답 미수신으로 pending/failed에 갇힌 결제를 KICC 노티가 completed로
       구제. failed(3)>completed(2)라 기존엔 우선순위 가드에 막혀 영영 미반영됐음. 위에서 노티 금액==
       저장 금액 검증을 이미 통과한 'completed' 노티만 여기 도달하므로(위조 방지), pending·failed →
       completed 승격은 허용한다. */
    const promoteToCompleted = newStatus === "completed" && (donation.status === "pending" || donation.status === "failed");

    /* ★ R41 Q1-003 FIX: 완료건 취소/환불 다운그레이드는 노티 서명(msgAuthValue) 검증 통과 시에만 자동 반영.
       KICC 노티는 서명이 없을 수 있어, 미검증 취소/환불 노티를 그대로 적용하면 내부 ID(pgCno·shopOrderNo)를
       아는 자가 위조 노티로 완료 후원을 취소·환불 상태로 둔갑시킬 수 있음(회계·영수증 무결성).
       미검증이면 자동 반영 보류 + 감사로그 + 슈퍼어드민 통지로 수동 확인 유도. */
    if (downgradeAllowed && !verifyMsgAuth(p)) {
      await logAudit({
        userId: donation.memberId,
        userType: "system",
        userName: "kicc-webhook",
        action: "webhook_downgrade_unverified",
        target: pgOrderNo || donation.pgOrderNo || `D-${donation.id}`,
        detail: { donationId: donation.id, requestedStatus: newStatus, note: "서명 미검증 — 자동 반영 보류" },
        success: false,
      }).catch(() => {});
      try {
        await notifyAllSuperAdmins({
          category: "donation",
          severity: "warning",
          title: "⚠️ 미검증 결제 취소/환불 노티 — 확인 필요",
          message: `후원 D-${donation.id}에 외부 ${newStatus} 노티가 수신됐으나 서명 검증이 안 돼 자동 반영을 보류했습니다. 실제 취소/환불 여부를 확인해 주세요.`,
          link: "/admin.html",
          refTable: "donations",
          refId: donation.id,
        });
      } catch (e) {
        console.warn("[kicc-webhook] 미검증 다운그레이드 통지 실패", e);
      }
      return ack({ skipped: "downgrade_unverified" });
    }

    if (cur > next && !downgradeAllowed && !promoteToCompleted) return ack({ skipped: "already_advanced" });

    const updatePayload: any = { status: newStatus, updatedAt: new Date() };
    if (newStatus === "completed" && !donation.pgTid && pgTid) {
      updatePayload.pgTid = pgTid;
      updatePayload.transactionId = pgTid;
    } else if (newStatus === "failed") {
      updatePayload.failureReason = String(p.resMsg || p.statusMessage || "KICC 노티: 실패").slice(0, 500);
    } else if (newStatus === "cancelled" || newStatus === "refunded") {
      const memo = `[KICC 노티 ${new Date().toISOString().slice(0, 10)} ${newStatus}] ${p.resMsg || ""}`.slice(0, 200);
      updatePayload.memo = donation.memo ? `${donation.memo}\n${memo}` : memo;
    }

    await db.update(donations).set(updatePayload).where(eq(donations.id, donation.id));

    await logAudit({
      userId: donation.memberId,
      userType: "system",
      userName: "kicc-webhook",
      action: `webhook_payment_${newStatus}`,
      target: pgOrderNo || donation.pgOrderNo || `D-${donation.id}`,
      detail: { donationId: donation.id, previousStatus: donation.status, newStatus, pgTid },
    });

    return ack({ processed: true, donationId: donation.id, newStatus });
  } catch (err: any) {
    console.error("[kicc-webhook] 예외:", err);
    await logAudit({
      userType: "system",
      userName: "kicc-webhook",
      action: "webhook_exception",
      detail: { error: String(err?.message || err).slice(0, 500) },
      success: false,
    }).catch(() => {});
    return ack(); // 예외에도 ack (재전송 방지)
  }
};

export const config = { path: "/api/kicc-webhook" };
