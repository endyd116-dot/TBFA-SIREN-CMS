import type { Config } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { createNotification } from "../../lib/notify";
import { sendEmail } from "../../lib/email";
import { resetProxyInstance, ociConfigured } from "../../lib/oci-client";

/* 5분마다 주요 API에 자동 요청 → 콜드 스타트 방지 */
const SITE_URL = process.env.SITE_URL || "https://tbfa-siren-cms.netlify.app";

const WARMUP_ENDPOINTS = [
  "/api/public-home-stats",
  "/api/public-nav-menus",
  "/api/notifications-list",
  "/api/admin-dashboard-summary",
  "/api/admin-members-list?limit=1",
  "/api/admin-send-jobs-list?limit=1",
];

/* Oracle 알리고 프록시 health ping — 콜드 스타트/잠듦 방지.
   ALIGO_SMS_PROXY_URL(예: https://host:8080/aligo/sms)의 끝 라우트를 /health로 치환해 GET.
   프록시가 잠들면 회원가입 SMS 인증·카카오 알림톡이 10초 timeout으로 실패하므로
   5분마다 깨워둔다. (server.js의 GET /health 엔드포인트) */
function getProxyHealthUrl(): string | null {
  const smsProxy = process.env.ALIGO_SMS_PROXY_URL || "";
  if (!smsProxy) return null;
  try {
    const u = new URL(smsProxy);
    u.pathname = "/health";
    u.search = "";
    return u.toString();
  } catch {
    return null;
  }
}

/* 안정화 1: 프록시 다운 감지 시 슈퍼어드민 인앱 알림 + 관리자 이메일.
   - 30분 쿨다운: 최근 30분 내 동일 알림(ref_table='proxy_health')이 있으면 스킵 (도배 방지)
   - 발송 실패해도 warmup 본 흐름 차단 안 함 (fire-and-forget catch) */
async function alertProxyDown(): Promise<void> {
  /* 중복 방지 — 최근 30분 내 proxy_health 알림 존재 시 스킵 */
  try {
    const recent: any = await db.execute(sql`
      SELECT 1 FROM notifications
      WHERE ref_table = 'proxy_health'
        AND created_at >= NOW() - INTERVAL '6 hours'
      LIMIT 1
    `);
    const rows = recent?.rows ?? recent ?? [];
    if (rows.length > 0) return;
  } catch (e) {
    console.warn("[warmup] 프록시 알림 중복 확인 실패 (계속 진행):", e);
  }

  const title = "ℹ️ 문자·알림톡 프록시 응답 없음 (직접 발송으로 자동 폴백 중)";
  const message =
    "SMS·카카오 알림톡 중계 프록시가 응답하지 않습니다. " +
    "단, 프록시 실패 시 알리고로 직접 발송(폴백)하도록 개선돼 발송 자체는 계속됩니다(알리고 IP 제한 해제 시). " +
    "프록시를 완전히 끄려면 환경변수 ALIGO_SMS_PROXY_URL·ALIGO_PROXY_URL 을 제거하세요(그러면 본 알림도 멈춤). 자동 재부팅도 함께 시도 중입니다.";

  /* 슈퍼어드민 인앱 알림 */
  try {
    const admins: any = await db.execute(sql`
      SELECT id FROM members WHERE role = 'super_admin' AND status = 'active'
    `);
    const adminRows = admins?.rows ?? admins ?? [];
    for (const a of adminRows) {
      await createNotification({
        recipientId: Number(a.id),
        recipientType: "admin",
        category: "system",
        severity: "warning",
        title,
        message,
        link: "/cms-tbfa.html",
        refTable: "proxy_health",
      }).catch(() => {});
    }
  } catch (e) {
    console.warn("[warmup] 슈퍼어드민 인앱 알림 실패:", e);
  }

  /* 관리자 이메일 */
  const notifyEmail = process.env.ADMIN_NOTIFY_EMAIL;
  if (notifyEmail) {
    await sendEmail({
      to: notifyEmail,
      subject: "ℹ️ [SIREN] 문자·알림톡 프록시 응답 없음 (직접 발송 폴백 중)",
      html:
        `<p>${title}</p>` +
        `<p>${message}</p>` +
        `<p>영구 해결: ① 알리고 관리자에서 <b>API IP 제한 해제</b> → ② Netlify에서 <b>ALIGO_SMS_PROXY_URL·ALIGO_PROXY_URL 환경변수 제거</b> → 알리고 직접 발송으로 전환되어 프록시 VM이 불필요해집니다. (급할 때만: Oracle 콘솔 → aligo-proxy → Reboot)</p>` +
        `<p style="color:#888;font-size:12px">SIREN 자동 모니터링 (cron-warmup) · ${new Date().toISOString()}</p>`,
    }).catch((e) => console.warn("[warmup] 프록시 다운 이메일 실패:", e));
  }

  console.warn("[warmup] ⚠️ 프록시 다운 알림 발송 완료");
}

/* 안정화 3 (2026-05-21): 프록시 다운 시 OCI 인스턴스 자동 재부팅.
   - OCI 환경변수 6개 미설정이면 skip (resetProxyInstance가 skipped 반환)
   - 무한 재부팅 방지: 최근 60분 내 재부팅 시도(ref_table='proxy_reboot') 있으면 skip
   - 재부팅 시도 결과를 슈퍼어드민 인앱 알림 + proxy_reboot 마커로 기록 */
async function maybeAutoReboot(): Promise<void> {
  if (!(await ociConfigured())) return;   // 설정 미등록(env·Blobs) — 기존 알림(alertProxyDown)만 동작

  /* 쿨다운 — 최근 60분 내 자동 재부팅 시도가 있으면 스킵 (부팅 시간 고려) */
  try {
    const recent: any = await db.execute(sql`
      SELECT 1 FROM notifications
      WHERE ref_table = 'proxy_reboot'
        AND created_at >= NOW() - INTERVAL '60 minutes'
      LIMIT 1
    `);
    const rows = recent?.rows ?? recent ?? [];
    if (rows.length > 0) {
      console.warn("[warmup] 자동 재부팅 쿨다운(60분) — skip");
      return;
    }
  } catch (e) {
    console.warn("[warmup] 자동 재부팅 쿨다운 확인 실패 (계속 진행):", e);
  }

  const result = await resetProxyInstance("RESET");
  if (result.skipped) return;

  const title = result.ok
    ? "🔄 문자·알림톡 발송 서버(프록시) 자동 재부팅 시도"
    : "❗ 프록시 자동 재부팅 실패 — 수동 재부팅 필요";
  const message = result.ok
    ? "프록시 응답 없음을 감지해 Oracle 인스턴스를 자동 재부팅했습니다. 1~2분 후 발송이 정상화됩니다. (안 되면 콘솔에서 수동 재부팅)"
    : `프록시 자동 재부팅에 실패했습니다(${result.detail}). Oracle 콘솔에서 aligo-proxy를 수동 재부팅해 주세요.`;

  /* 슈퍼어드민 인앱 알림 + 쿨다운 마커(ref_table='proxy_reboot') */
  try {
    const admins: any = await db.execute(sql`
      SELECT id FROM members WHERE role = 'super_admin' AND status = 'active'
    `);
    const adminRows = admins?.rows ?? admins ?? [];
    for (const a of adminRows) {
      await createNotification({
        recipientId: Number(a.id),
        recipientType: "admin",
        category: "system",
        severity: result.ok ? "info" : "warning",
        title,
        message,
        link: "/cms-tbfa.html",
        refTable: "proxy_reboot",
      }).catch(() => {});
    }
  } catch (e) {
    console.warn("[warmup] 자동 재부팅 알림 실패:", e);
  }

  const notifyEmail = process.env.ADMIN_NOTIFY_EMAIL;
  if (notifyEmail) {
    await sendEmail({
      to: notifyEmail,
      subject: `[SIREN] 프록시 자동 재부팅 ${result.ok ? "시도" : "실패"}`,
      html:
        `<p>${title}</p><p>${message}</p>` +
        `<p style="color:#888;font-size:12px">SIREN 자동 복구 (cron-warmup → OCI) · ${new Date().toISOString()}</p>`,
    }).catch((e) => console.warn("[warmup] 자동 재부팅 이메일 실패:", e));
  }

  console.warn(`[warmup] 🔄 프록시 자동 재부팅 ${result.ok ? "성공" : "실패"}: ${result.detail}`);
}

export default async () => {
  const results: { path: string; status: number; ms: number }[] = [];

  await Promise.allSettled(
    WARMUP_ENDPOINTS.map(async (path) => {
      const t = Date.now();
      try {
        const res = await fetch(`${SITE_URL}${path}`, {
          method: "GET",
          headers: { "x-warmup": "1" },
          signal: AbortSignal.timeout(8000),
        });
        results.push({ path, status: res.status, ms: Date.now() - t });
      } catch {
        results.push({ path, status: 0, ms: Date.now() - t });
      }
    })
  );

  /* Oracle 알리고 프록시 warm 유지 + 다운 감지 */
  const proxyHealthUrl = getProxyHealthUrl();
  let proxyDown = false;
  if (proxyHealthUrl) {
    const t = Date.now();
    try {
      const res = await fetch(proxyHealthUrl, {
        method: "GET",
        signal: AbortSignal.timeout(9000),
      });
      results.push({ path: "aligo-proxy/health", status: res.status, ms: Date.now() - t });
      if (!res.ok) proxyDown = true;
    } catch {
      /* 프록시가 9초 안에 응답 못 하면 잠들었거나 다운 */
      results.push({ path: "aligo-proxy/health", status: 0, ms: Date.now() - t });
      proxyDown = true;
    }
  }

  /* 안정화 1: 다운 감지 시 슈퍼어드민 알림 (30분 쿨다운·발송 실패해도 무시) */
  if (proxyDown) {
    await alertProxyDown().catch((e) => console.error("[warmup] 프록시 다운 알림 처리 실패:", e));
    /* 안정화 3: OCI 인스턴스 자동 재부팅 (키 설정 시·60분 쿨다운) */
    await maybeAutoReboot().catch((e) => console.error("[warmup] 자동 재부팅 처리 실패:", e));
  }

  console.log("[warmup]", JSON.stringify(results));
};

export const config: Config = {
  schedule: "*/5 * * * *",
};
