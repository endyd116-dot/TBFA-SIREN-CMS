// lib/notify-donation-cancel.ts — 회비 해지·후원 취소 운영자 알림 (2026-10-31 Swain: «해지도 운영자가 알아야»)
//
// 지금까지 회원이 마이페이지에서 정기 회비를 해지하거나(billing-cancel · donations-cancel) 자동결제 연속 실패로
// 자동 해지되면(cron-kicc-billing) 후원자에게만 안내가 가고 운영자는 아무 알림도 받지 못했다. 이 헬퍼가 세 곳에서 불린다.
//
// 채널(전부 fire-and-forget · 어느 하나가 실패해도 해지 처리에는 영향 0):
//   ① 어드민 알림함 — 활성 운영자 전원(notifyAllOperators)
//   ② 운영자 카카오 알림톡 — 템플릿 관리에서 event_key operator.donation_canceled 템플릿이 승인·활성일 때만(그 전엔 조용히 통과)
//   ③ 메일 — ADMIN_NOTIFY_EMAIL(알림톡 승인 전에도 즉시 받을 수 있는 경로)
import { notifyAllOperators } from "./notify";
import { sendOperatorAlimtalk, OPERATOR_KAKAO_EVENT_KEYS } from "./notify-operator-kakao";
import { sendEmail } from "./email";

export interface DonationCancelNotice {
  /** regular = 회원 본인 정기 회비 해지 · onetime = 후원 취소 · auto = 연속 실패 자동 해지 */
  kind: "regular" | "onetime" | "auto";
  memberId?: number | null;
  memberName?: string | null;
  amount?: number | null;
  reason?: string | null;
  refTable?: string;
  refId?: number | null;
  /** 결제 경로 표시(카드 자동결제·효성 등) */
  channel?: string | null;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Record<string, string>)[c]);

export async function notifyOperatorsDonationCanceled(n: DonationCancelNotice): Promise<void> {
  const name = String(n.memberName || "회원").trim() || "회원";
  const amt = n.amount && Number(n.amount) > 0 ? `${Number(n.amount).toLocaleString()}원` : "";
  const kindKo = n.kind === "regular" ? "정기 회비 해지" : n.kind === "onetime" ? "후원 취소" : "정기 회비 자동 해지";
  const reason = String(n.reason || "").trim().slice(0, 200);
  const channel = String(n.channel || "").trim();
  const message =
    n.kind === "auto"
      ? `${name}님의 ${amt ? `월 ${amt} ` : ""}정기 회비가 결제 연속 실패로 자동 해지됐어요.${reason ? ` (${reason})` : ""}`
      : n.kind === "regular"
        ? `${name}님이 ${amt ? `월 ${amt} ` : ""}정기 회비를 해지했어요.${channel ? ` [${channel}]` : ""}${reason ? ` 사유: ${reason}` : ""}`
        : `${name}님이 ${amt ? `${amt} ` : ""}후원을 취소했어요.${reason ? ` 사유: ${reason}` : ""}`;
  const link = "/admin.html#donations";

  /* ① 어드민 알림함 */
  try {
    await notifyAllOperators(
      {
        category: "donation",
        severity: "warning",
        title: kindKo,
        message,
        link,
        refTable: n.refTable || "donations",
        refId: n.refId ?? null,
      } as any,
      { category: "all" },
    );
  } catch (e: any) {
    console.warn("[notify-donation-cancel] 알림함 실패:", e?.message || e);
  }

  /* ② 운영자 알림톡(승인 템플릿 있을 때만) */
  sendOperatorAlimtalk(OPERATOR_KAKAO_EVENT_KEYS.DONATION_CANCELED, {
    이름: name,
    금액: amt || "-",
    구분: kindKo,
    사유: reason || "-",
  }).catch(() => {});

  /* ③ 운영자 메일 */
  const to = (process.env.ADMIN_NOTIFY_EMAIL || "").trim();
  if (to) {
    const site = (process.env.SITE_URL || "https://tbfa.co.kr").replace(/\/+$/, "");
    sendEmail({
      to,
      subject: `[SIREN] ${kindKo} — ${name}${amt ? ` ${amt}` : ""}`,
      html: `<p>${esc(message)}</p><p style="color:#666;font-size:13px">회원 번호 ${n.memberId ?? "-"} · ${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</p><p><a href="${site}${link}">후원 관리에서 확인</a></p>`,
    }).catch((e: any) => console.warn("[notify-donation-cancel] 메일 실패:", e?.message || e));
  }
}
