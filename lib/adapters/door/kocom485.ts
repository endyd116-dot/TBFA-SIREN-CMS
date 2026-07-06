// lib/adapters/door/kocom485.ts — RS-485 게이트웨이(HTTP 브리지, 예: Elfin EW11 + KOCOM 도어) 어댑터.
// env: DOOR_ADAPTER_URL(게이트웨이 HTTP 엔드포인트), DOOR_ADAPTER_TOKEN(선택). body {gateId,action} 전송.
// 상태조회는 게이트웨이별 상이 → 개방 명령만 표준 지원. 설치 후 env 주입 시 실개방.
import type { DoorAdapter, DoorResult, DoorStatusResult } from "./index";

function baseUrl(): string { return (process.env.DOOR_ADAPTER_URL || "").replace(/\/$/, ""); }

export const kocom485Adapter: DoorAdapter = {
  kind: "kocom485",
  async open(gateId): Promise<DoorResult> {
    const base = baseUrl();
    if (!base) return { ok: false, detail: "DOOR_ADAPTER_URL 미설정(RS-485 게이트웨이)" };
    const token = process.env.DOOR_ADAPTER_TOKEN || "";
    try {
      const resp = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ gateId: gateId || "main", action: "open" }),
      });
      const text = await resp.text().catch(() => "");
      let raw: any = text; try { raw = JSON.parse(text); } catch { /* plain text */ }
      return { ok: resp.ok, detail: resp.ok ? undefined : `kocom485 ${resp.status}: ${String(text).slice(0, 120)}`, raw };
    } catch (e: any) {
      return { ok: false, detail: String(e?.message || e).slice(0, 200) };
    }
  },
  async status(): Promise<DoorStatusResult> {
    return { ok: true, detail: "상태조회 미지원(게이트웨이별 상이) — 개방 명령만 지원" };
  },
};
