// lib/adapters/door/index.ts — DoorAdapter 인터페이스 + KIND 선택(미설정=sim) + 호출 감사(doorCommand).
// (ON 이식 2026-07-06 — SIREN·ON 동일 물리 문. SIREN이 같은 장치에 직접 개방 명령.)
// 체크인 성공/재출근(복귀)/모바일키/백오피스 원격에서 openDoor() 호출 → 전 호출 doorCommand 적재(request·response·ok).
// HW 설치 전엔 sim(로그·ok=true)으로 풀 플로우 동작 → 설치 후 env(DOOR_ADAPTER_KIND·URL·TOKEN·DEVICE_ID)만 주입하면 실개방.
import { db } from "../../../db/index";
import { doorCommand } from "../../../db/schema";
import { simAdapter } from "./sim";
import { relayAdapter } from "./relay";
import { kocom485Adapter } from "./kocom485";
import { shellyCloudAdapter } from "./shellyCloud";

export interface DoorResult { ok: boolean; detail?: string; raw?: any }
export interface DoorStatusResult extends DoorResult { open?: boolean }
export interface DoorAdapter {
  kind: string;
  open(gateId: string): Promise<DoorResult>;
  status(gateId: string): Promise<DoorStatusResult>;
}

// DOOR_ADAPTER_KIND env로 어댑터 선택. 미설정/불명 = sim.
export function getDoorAdapter(): DoorAdapter {
  const kind = (process.env.DOOR_ADAPTER_KIND || "sim").toLowerCase();
  if (kind === "shelly_cloud" || kind === "shelly" || kind === "cloud") return shellyCloudAdapter;
  if (kind === "relay") return relayAdapter;
  if (kind === "kocom485" || kind === "kocom" || kind === "rs485") return kocom485Adapter;
  return simAdapter;
}

export function adapterKind(): string { return getDoorAdapter().kind; }
export function isSimMode(): boolean { return getDoorAdapter().kind === "sim"; }

// 게이트 ID: 단일 문 운영이라 기본 "main"(env DOOR_GATE_ID로 재정의 가능).
export function defaultGateId(): string { return process.env.DOOR_GATE_ID || "main"; }

export interface OpenDoorOpts {
  triggerType: string;                  // checkin | reentry | mobilekey | admin
  triggerId?: number | null;            // 관련 근태기록 id 등
  memberUid?: string | null;            // 개방을 유발한 회원 uid(감사)
  gateId?: string | null;
}

// 도어 개방 + doorCommand 감사 적재.
// 1차 실패 시 3초 후 1회 자동 재시도. 최종 실패면 감사(ok=false) 기록(관리자 문 제어판·이력에서 확인).
export async function openDoor(opts: OpenDoorOpts): Promise<DoorResult & { adapter: string; retried?: boolean; gateId: string }> {
  const adapter = getDoorAdapter();
  const gate = opts.gateId || defaultGateId();

  // 1차 시도
  let result: DoorResult;
  try { result = await adapter.open(gate); }
  catch (e: any) { result = { ok: false, detail: String(e?.message || e).slice(0, 200) }; }

  // 1차 실패 시 3초 후 1회 재시도(sim은 항상 ok=true라 미동작)
  let retried = false;
  if (!result.ok) {
    retried = true;
    await new Promise((r) => setTimeout(r, 3000));
    try { result = await adapter.open(gate); }
    catch (e: any) { result = { ok: false, detail: String(e?.message || e).slice(0, 200) }; }
  }

  // 감사 적재(실패는 비차단 — §6.2). 마이그레이션 전이어도 여기서 죽지 않음.
  try {
    await db.insert(doorCommand).values({
      triggerType: opts.triggerType,
      triggerId: opts.triggerId ?? null,
      memberUid: opts.memberUid ?? null,
      adapter: adapter.kind,
      gateId: gate,
      request: { gateId: gate, action: "open", retried } as any,
      response: (result.raw ?? { detail: result.detail ?? null, ok: result.ok, retried }) as any,
      ok: result.ok,
    } as any);
  } catch (e) {
    console.warn("[door] 감사 적재 실패(비차단):", String((e as any)?.message || e).slice(0, 200));
  }

  if (!result.ok) {
    console.warn(`[door] 개방 실패 gate=${gate} trigger=${opts.triggerType} detail=${result.detail}`);
  }

  return { ...result, adapter: adapter.kind, retried, gateId: gate };
}

// 도어 상태 조회(감사 미적재 — 조회성).
export async function doorStatus(gateId?: string | null): Promise<DoorStatusResult & { adapter: string; gateId: string }> {
  const adapter = getDoorAdapter();
  const gate = gateId || defaultGateId();
  try { return { adapter: adapter.kind, gateId: gate, ...(await adapter.status(gate)) }; }
  catch (e: any) { return { adapter: adapter.kind, gateId: gate, ok: false, detail: String(e?.message || e).slice(0, 200) }; }
}
