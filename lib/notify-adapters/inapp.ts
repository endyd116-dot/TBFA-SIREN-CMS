// lib/notify-adapters/inapp.ts
// Phase 8 — 인앱 알림 어댑터 (lib/notify.ts createNotification 래핑)
// 발송 실패 시 dispatcher가 즉시 dead 처리 (재시도 없음 — DB INSERT 실패는 드묾)

import { createNotification } from "../notify";
import type { NotifyAdapter, AdapterSendOpts, AdapterResult } from "./types";
/* ★ 2026-05-16: 어드민 채널 토글 — isActive=false면 인앱 알림도 차단. */
import { loadEventTemplate } from "../notify-dispatcher";

export const inappAdapter: NotifyAdapter = {
  channel: "inapp",

  async send(opts: AdapterSendOpts): Promise<AdapterResult> {
    const t0 = Date.now();
    try {
      /* 어드민이 인앱 채널 끄면 차단 */
      const dbTpl = await loadEventTemplate({ event: opts.event, channel: "inapp", params: opts.params });
      if (dbTpl && "skip" in dbTpl) {
        return {
          ok: true,
          providerMessageId: `skipped-admin-disabled-${opts.logId}`,
          latencyMs: Date.now() - t0,
        };
      }

      /* DB 템플릿 본문이 있으면 그걸로 인앱 메시지 갱신 */
      const overrideMessage = (dbTpl && !("skip" in dbTpl)) ? dbTpl.body : null;

      const notifId = await createNotification({
        recipientId: opts.targetId,
        recipientType: opts.targetType === "admin" ? "admin" : "user",
        category: opts.params.category || "system",
        severity:  opts.params.severity || "info",
        title:     String(opts.params.title   || opts.event).slice(0, 200),
        message:   overrideMessage ? overrideMessage.slice(0, 500) : (opts.params.message ? String(opts.params.message).slice(0, 500) : undefined),
        link:      opts.params.link     ? String(opts.params.link).slice(0, 500)    : undefined,
        refTable:  opts.params.refTable || undefined,
        refId:     opts.params.refId    || undefined,
      });

      if (notifId == null) {
        return {
          ok: false,
          error: "createNotification returned null",
          latencyMs: Date.now() - t0,
        };
      }

      return {
        ok: true,
        providerMessageId: String(notifId),
        latencyMs: Date.now() - t0,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: String(err?.message || err).slice(0, 500),
        latencyMs: Date.now() - t0,
      };
    }
  },
};
