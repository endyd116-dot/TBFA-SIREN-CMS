// lib/notify-adapters/inapp.ts
// Phase 8 — 인앱 알림 어댑터 (lib/notify.ts createNotification 래핑)
// 발송 실패 시 dispatcher가 즉시 dead 처리 (재시도 없음 — DB INSERT 실패는 드묾)

import { createNotification } from "../notify";
import type { NotifyAdapter, AdapterSendOpts, AdapterResult } from "./types";

export const inappAdapter: NotifyAdapter = {
  channel: "inapp",

  async send(opts: AdapterSendOpts): Promise<AdapterResult> {
    const t0 = Date.now();
    try {
      const notifId = await createNotification({
        recipientId: opts.targetId,
        recipientType: opts.targetType === "admin" ? "admin" : "user",
        category: opts.params.category || "system",
        severity:  opts.params.severity || "info",
        title:     String(opts.params.title   || opts.event).slice(0, 200),
        message:   opts.params.message  ? String(opts.params.message).slice(0, 500) : undefined,
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
