// lib/adapters/door/sim.ts — 시뮬레이션 도어 어댑터(HW 설치 전 기본). 실제 개폐 없이 로그·ok=true.
// DOOR_ADAPTER_KIND 미설정 시 이 어댑터가 선택됨 → 전체 출입/도어 플로우가 라이브에서 완결 동작.
// (ON 이식 2026-07-06 — SIREN·ON 동일 물리 문. 장치 접속키 주입 전엔 기록만 남김.)
import type { DoorAdapter } from "./index";

export const simAdapter: DoorAdapter = {
  kind: "sim",
  async open(gateId) {
    console.log(`[door:sim] open gate=${gateId} at=${new Date().toISOString()}`);
    return { ok: true, detail: "시뮬레이션 개방(설치 전)", raw: { sim: true, gateId, action: "open", openedAt: new Date().toISOString() } };
  },
  async status(gateId) {
    return { ok: true, open: false, detail: "시뮬레이션 모드 — 도어 HW 미설치", raw: { sim: true, gateId } };
  },
};
