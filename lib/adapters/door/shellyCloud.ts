// lib/adapters/door/shellyCloud.ts — Shelly Cloud Control API 도어 어댑터 (ON S8 불변결정 이식).
// 장치가 클라우드로 아웃바운드 접속 → 포트포워딩 0·도어 외부노출 0·동적IP 무관(Netlify 클라우드에서 직접 호출 가능).
// env:
//   DOOR_ADAPTER_KIND=shelly_cloud
//   DOOR_ADAPTER_URL   = 클라우드 서버 주소 (예: https://shelly-XX-eu.shelly.cloud)
//   DOOR_ADAPTER_TOKEN = Shelly 클라우드 auth_key (인증키)
//   DOOR_DEVICE_ID     = Shelly 장치 ID
//   DOOR_DEVICE_CHANNEL= 릴레이 채널(선택, 기본 0)
//   DOOR_PULSE_SEC     = 모멘터리 펄스 초(선택). 미설정 시 단일 turn=on(장치 auto-off에 위임 — 설계 권장).
// 값 미설정 시 ok=false(감사 기록은 남음). 개방=모멘터리 펄스(장치 auto-off ~1~2s).
// ⚠ ON과 동일 물리 문 → ON과 동일한 DOOR_* 값을 SIREN Netlify에도 입력(같은 장치를 각자 개방).
import type { DoorAdapter, DoorResult, DoorStatusResult } from "./index";

function baseUrl(): string { return (process.env.DOOR_ADAPTER_URL || "").replace(/\/$/, ""); }
function deviceId(): string { return process.env.DOOR_DEVICE_ID || ""; }
// gateId가 숫자면 채널로 해석, 아니면 env DOOR_DEVICE_CHANNEL, 둘 다 없으면 0.
function channelFor(gateId: string): string {
  if (/^\d+$/.test(gateId)) return gateId;
  return process.env.DOOR_DEVICE_CHANNEL || "0";
}

// Shelly Cloud Control API는 application/x-www-form-urlencoded POST + auth_key 폼 파라미터.
async function post(path: string, params: Record<string, string>): Promise<DoorResult> {
  const base = baseUrl();
  const token = process.env.DOOR_ADAPTER_TOKEN || "";
  const id = deviceId();
  if (!base) return { ok: false, detail: "DOOR_ADAPTER_URL 미설정(shelly_cloud)" };
  if (!token) return { ok: false, detail: "DOOR_ADAPTER_TOKEN(auth_key) 미설정(shelly_cloud)" };
  if (!id) return { ok: false, detail: "DOOR_DEVICE_ID 미설정(shelly_cloud)" };

  const body = new URLSearchParams({ id, auth_key: token, ...params });
  try {
    const resp = await fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const text = await resp.text().catch(() => "");
    let raw: any = text; try { raw = JSON.parse(text); } catch { /* plain text */ }
    // Shelly Cloud 응답: { isok: boolean, errors?, data? }
    const cloudOk = resp.ok && (raw && typeof raw === "object" ? raw.isok !== false : true);
    return {
      ok: cloudOk,
      detail: cloudOk ? undefined : `shelly_cloud ${resp.status}: ${String(text).slice(0, 160)}`,
      raw,
    };
  } catch (e: any) {
    return { ok: false, detail: String(e?.message || e).slice(0, 200) };
  }
}

export const shellyCloudAdapter: DoorAdapter = {
  kind: "shelly_cloud",
  async open(gateId) {
    const params: Record<string, string> = { channel: channelFor(gateId || "main"), turn: "on" };
    const pulse = process.env.DOOR_PULSE_SEC;
    if (pulse && /^\d+$/.test(pulse)) params.timer = pulse; // 선택: 서버측 auto-off. 미설정 시 장치 auto-off에 위임.
    return post("/device/relay/control", params);
  },
  async status(gateId): Promise<DoorStatusResult> {
    const r = await post("/device/status", {});
    // 상태 응답 shape는 세대별 상이 → best-effort 파싱(Gen1 relays[ch].ison / Gen2+ "switch:ch".output).
    let open: boolean | undefined;
    try {
      const ch = channelFor(gateId || "main");
      const ds = r.raw?.data?.device_status ?? r.raw?.data ?? r.raw;
      const relays = ds?.relays;
      if (Array.isArray(relays) && relays[Number(ch)]) open = !!relays[Number(ch)].ison;
      else if (ds?.[`switch:${ch}`]) open = !!ds[`switch:${ch}`].output;
    } catch { /* 비차단 */ }
    return { ...r, open };
  },
};
