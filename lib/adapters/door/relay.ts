// lib/adapters/door/relay.ts — 스마트 릴레이(HTTP, 예: Shelly) 도어 어댑터.
// env: DOOR_ADAPTER_URL(릴레이 베이스 URL), DOOR_ADAPTER_TOKEN(선택). gateId = 릴레이 채널(기본 0).
// 설치 후 env만 주입하면 실개방. URL 미설정 시 ok=false(감사 기록은 남음).
import type { DoorAdapter, DoorResult, DoorStatusResult } from "./index";

function baseUrl(): string { return (process.env.DOOR_ADAPTER_URL || "").replace(/\/$/, ""); }

async function call(path: string, method: "GET" | "POST" = "POST"): Promise<DoorResult> {
  const base = baseUrl();
  if (!base) return { ok: false, detail: "DOOR_ADAPTER_URL 미설정(릴레이)" };
  const token = process.env.DOOR_ADAPTER_TOKEN || "";
  try {
    const resp = await fetch(base + path, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} });
    const text = await resp.text().catch(() => "");
    let raw: any = text; try { raw = JSON.parse(text); } catch { /* plain text */ }
    return { ok: resp.ok, detail: resp.ok ? undefined : `relay ${resp.status}: ${String(text).slice(0, 120)}`, raw };
  } catch (e: any) {
    return { ok: false, detail: String(e?.message || e).slice(0, 200) };
  }
}

export const relayAdapter: DoorAdapter = {
  kind: "relay",
  async open(gateId) {
    return call(`/relay/${encodeURIComponent(gateId || "0")}?turn=on`, "POST");
  },
  async status(gateId): Promise<DoorStatusResult> {
    const r = await call(`/relay/${encodeURIComponent(gateId || "0")}`, "GET");
    return { ...r, open: !!(r.raw && (r.raw.ison ?? r.raw.output)) };
  },
};
