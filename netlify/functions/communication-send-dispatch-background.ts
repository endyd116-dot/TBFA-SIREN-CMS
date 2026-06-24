/**
 * communication-send-dispatch-background — 발송 큐 드레이너 (INTERNAL·Background)
 *
 * ⚠️ 백그라운드 함수(-background)는 config.path 금지. 플랫폼이 즉시 202 반환 후 최대 15분 실행.
 *
 * 호출처:
 *   - admin-send-job-create: 운영자가 "지금 발송" 시 즉시 fire (지연 0)
 *   - cron-communication-send-dispatcher(30분 안전망): 처리할 작업이 있으면 fire
 *
 * 동작: runDispatcher로 할 일이 없을 때까지 drain(즉시-fire가 대량발송도 끝까지 완주).
 *   원자적 claim(pending→preparing, 수신자 pending→sending)으로 동시 실행해도 중복/누락 0.
 *
 * fail-closed(INTERNAL_TRIGGER_SECRET) — 외부에서 임의 호출 차단.
 */
import type { Context } from "@netlify/functions";
import { runDispatcher } from "../../lib/communication-dispatcher-core";

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "POST만 허용" }), { status: 405 });
  }

  let body: any = {};
  try { body = await req.json(); } catch (_) {}

  const secret = String(body?.secret || "");
  const expected = process.env.INTERNAL_TRIGGER_SECRET || "";
  if (!expected || secret !== expected) {
    return new Response(JSON.stringify({ ok: false, error: "권한 없음" }), { status: 403 });
  }

  console.info("[send-dispatch-bg] start");
  try {
    /* 15분 백그라운드 한도 안에서 안전하게 — 12분 예산으로 drain */
    const stats = await runDispatcher({ maxMs: 12 * 60 * 1000 });
    console.info("[send-dispatch-bg] done", stats);
    return new Response(JSON.stringify({ ok: true, stats }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[send-dispatch-bg] 실패", err);
    return new Response(
      JSON.stringify({ ok: false, error: String(err?.message || err).slice(0, 300) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
};
