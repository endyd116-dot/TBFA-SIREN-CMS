/**
 * 구글 광고 클릭 표식 — «홈페이지 화면이 못 보는 완료도 광고 성과로» (2026-11-19 Swain 직접 승인)
 *
 * 시작: 회비를 시작하는 요청(카드 일시·카드 정기 등록·계좌이체 신청·효성 신청·등불 결제 시작)에서
 *       브라우저 쿠키에 남은 «광고 클릭 번호»(gclid·wbraid·gbraid)를 읽어 그 회비 기록의
 *       보조 칸(donations.source_meta.adClick)에 붙여 둔다. 새 저장 칸 없음(마이그레이션 0).
 *         - _gcl_aw : 구글 태그가 남기는 쿠키(GCL.<초>.<gclid>) — .tbfa.co.kr 공유라 등불 판 태그가 심은 것도 읽힌다
 *         - _gcl_gb : 구글 태그가 남기는 쿠키(GCL.<초>.<gbraid>)
 *         - siren_adclick : 싸이렌 측정 스크립트가 착지 주소의 클릭 번호를 담아 두는 쿠키(/js/ad-conversions.js)
 *       등불 판에서 서버끼리 만드는 결제 의도는 AM이 본문에 gclid|wbraid|gbraid(+clickAt)를 실어 보낸다.
 * 완료: 정기 작업(cron-ads-offline)이 «클릭 표식이 이어지는 완료 건»을 AM으로 알린다(AM이 구글에 올림).
 *
 * 다루는 값은 클릭 번호와 그 시각뿐 — 이름·연락처 같은 개인 정보는 다루지 않는다.
 * 실패해도 회비 흐름에는 영향 0(모든 함수가 예외를 던지지 않는다).
 */
import { sql } from "drizzle-orm";
import { db } from "../db";

export type AdClickKind = "gclid" | "wbraid" | "gbraid";
export interface AdClick { kind: AdClickKind; id: string; at: string /* ISO(UTC) — 광고를 누른 시각 */ }

/** 구글이 클릭을 전환으로 받아 주는 기간 */
export const AD_CLICK_MAX_AGE_DAYS = 90;
const MAX_AGE_MS = AD_CLICK_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
const ID_RE = /^[A-Za-z0-9._~\-]{8,300}$/;

function validId(v: unknown): string | null {
  const s = String(v == null ? "" : v).trim();
  return ID_RE.test(s) ? s : null;
}
function fresh(ms: number, now = Date.now()): boolean {
  return Number.isFinite(ms) && ms > 0 && ms <= now + 5 * 60 * 1000 && now - ms <= MAX_AGE_MS;
}
function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    if (!k || out[k] !== undefined) continue;
    out[k] = part.slice(i + 1).trim();
  }
  return out;
}
/** GCL.<초>.<번호> */
function parseGcl(v: string | undefined, kind: AdClickKind): AdClick | null {
  if (!v) return null;
  const m = /^GCL\.(\d{9,11})\.(.+)$/.exec(decodeSafe(v));
  if (!m) return null;
  const id = validId(m[2]);
  const ms = Number(m[1]) * 1000;
  if (!id || !fresh(ms)) return null;
  return { kind, id, at: new Date(ms).toISOString() };
}
function decodeSafe(v: string): string {
  try { return decodeURIComponent(v); } catch { return v; }
}
/** siren_adclick = encodeURIComponent(JSON {k:"gclid"|"wbraid"|"gbraid", v, t(ms)}) */
function parseSiren(v: string | undefined): AdClick | null {
  if (!v) return null;
  try {
    const o = JSON.parse(decodeSafe(v));
    const kind = (["gclid", "wbraid", "gbraid"] as AdClickKind[]).includes(o?.k) ? (o.k as AdClickKind) : null;
    const id = validId(o?.v);
    const ms = Number(o?.t);
    if (!kind || !id || !fresh(ms)) return null;
    return { kind, id, at: new Date(ms).toISOString() };
  } catch { return null; }
}

/** 요청 쿠키에서 가장 최근의 광고 클릭 표식 하나 (없으면 null) */
export function readAdClick(req: Request): AdClick | null {
  try {
    const c = parseCookies(req.headers.get("cookie") || "");
    const found = [parseSiren(c["siren_adclick"]), parseGcl(c["_gcl_aw"], "gclid"), parseGcl(c["_gcl_gb"], "gbraid")]
      .filter(Boolean) as AdClick[];
    if (!found.length) return null;
    found.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    return found[0];
  } catch { return null; }
}

/** 서버끼리 받은 본문(등불 판 결제 의도)에서 클릭 표식 — { gclid|wbraid|gbraid, clickAt? } */
export function adClickFromInput(body: any): AdClick | null {
  try {
    if (!body || typeof body !== "object") return null;
    const kind = (["gclid", "gbraid", "wbraid"] as AdClickKind[]).find((k) => validId(body[k]));
    if (!kind) return null;
    const ms = body.clickAt ? Date.parse(String(body.clickAt)) : Date.now();
    if (!fresh(ms)) return null;
    return { kind, id: validId(body[kind]) as string, at: new Date(ms).toISOString() };
  } catch { return null; }
}

/** 회비 기록 보조 칸에 클릭 표식을 붙인다(이미 있으면 더 최근 것으로) — 실패해도 조용히 넘어간다 */
export async function saveAdClick(donationId: number, click: AdClick | null): Promise<boolean> {
  if (!click || !Number.isInteger(donationId) || donationId < 1) return false;
  try {
    await db.execute(sql`
      UPDATE donations
         SET source_meta = COALESCE(source_meta, '{}'::jsonb) || jsonb_build_object('adClick', ${JSON.stringify(click)}::jsonb)
       WHERE id = ${donationId}
         AND (source_meta IS NULL OR (source_meta->'adClick') IS NULL
              OR COALESCE((source_meta->'adClick'->>'at')::timestamptz, 'epoch'::timestamptz) < ${click.at}::timestamptz)
    `);
    return true;
  } catch (e) {
    console.warn("[ads-click] 클릭 표식 저장 실패(무시):", (e as any)?.message);
    return false;
  }
}

/** 요청 쿠키를 읽어 그 회비 기록에 붙인다 — 회비 시작 함수에서 한 줄로 부른다 */
export async function captureAdClick(req: Request, donationId: number | null | undefined): Promise<void> {
  try {
    const click = readAdClick(req);
    if (click && donationId) await saveAdClick(Number(donationId), click);
  } catch { /* 무시 */ }
}
