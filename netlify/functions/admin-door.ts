// netlify/functions/admin-door.ts — 관리자 문 제어판.
//   GET  /api/admin-door        — 어댑터/모드 + 도어 상태 + 최근 개방 이력
//   POST /api/admin-door {action:"open"} — 원격 개방
// (ON admin-door 이식. 출입문 어댑터는 lib/adapters/door.)
import { db } from "../../db/index";
import { doorCommand, members } from "../../db/schema";
import { desc, inArray } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";
import { openDoor, doorStatus, adapterKind, isSimMode, defaultGateId } from "../../lib/adapters/door";

export const config = { path: "/api/admin-door" };
const JSON_HEADER = { "Content-Type": "application/json" };

function jsonOk(data: unknown, status = 200) {
  return new Response(JSON.stringify({ ok: true, data }), { status, headers: JSON_HEADER });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "문 제어 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 1000),
  }), { status, headers: JSON_HEADER });
}

export default async function handler(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  // ─── 원격 개방 ───
  if (req.method === "POST") {
    let body: any = {};
    try { body = await req.json(); } catch {}
    const action = String(body.action || "open");
    if (action !== "open") return jsonError("bad_action", new Error("지원하지 않는 동작"), 400);
    try {
      const operatorUid = auth.ctx?.member?.id != null ? String(auth.ctx.member.id) : null;
      const r = await openDoor({ triggerType: "admin", triggerId: null, memberUid: operatorUid });
      return jsonOk({ ok: r.ok, adapter: r.adapter, sim: r.adapter === "sim", gateId: r.gateId, detail: r.detail ?? null, retried: r.retried ?? false });
    } catch (err) { return jsonError("open_door", err); }
  }

  if (req.method !== "GET") return new Response("Method Not Allowed", { status: 405 });

  // ─── 상태 + 이력 ───
  const gate = defaultGateId();

  // 어댑터 상태(장치 조회 — 실패해도 계속)
  let status: any = null;
  try { status = await doorStatus(gate); } catch (err) { console.warn("[admin-door] 상태 조회 실패:", err); }

  // 최근 개방 이력(메인 데이터 — 실패 시 빈 배열)
  let history: any[] = [];
  try {
    history = await db.select({
      id: doorCommand.id, triggerType: doorCommand.triggerType, memberUid: doorCommand.memberUid,
      adapter: doorCommand.adapter, gateId: doorCommand.gateId, ok: doorCommand.ok, at: doorCommand.at,
    }).from(doorCommand).orderBy(desc(doorCommand.at)).limit(50);
  } catch (err) { console.warn("[admin-door] 이력 조회 실패(테이블 미생성?):", err); }

  // 유발 회원명 매핑(보조 — 실패해도 계속)
  let nameMap: Record<string, string> = {};
  try {
    const uids = Array.from(new Set(history.map(h => h.memberUid).filter(Boolean).map(Number)));
    if (uids.length) {
      const rows = await db.select({ id: members.id, name: members.name }).from(members).where(inArray(members.id, uids));
      nameMap = Object.fromEntries(rows.map(r => [String(r.id), r.name]));
    }
  } catch (err) { console.warn("[admin-door] 회원명 매핑 실패:", err); }

  const historyOut = history.map(h => ({ ...h, memberName: h.memberUid ? (nameMap[String(h.memberUid)] ?? null) : null }));

  return jsonOk({
    adapter: adapterKind(),
    sim: isSimMode(),
    gateId: gate,
    status,
    history: historyOut,
  });
}
