/**
 * GET /api/migrate-jeju-potential-donors          — 진단 (인증 불필요 · 건수만 · 개인정보 없음)
 * GET /api/migrate-jeju-potential-donors?run=1    — 실행 (어드민 세션 또는 x-internal-secret 헤더)
 * GET /api/migrate-jeju-potential-donors?undo=1   — 되돌리기 (같은 인증) — 이 마이그가 넣은 행만 삭제(회원 연결된 행은 보존)
 *
 * 제주 캠페인 사이트(tbfa-jeju.com · 저장소 TBFA-JEJU)의 후원폼 제출 명단을
 * 잠재 후원자 관리(potential_donors)로 복사한다. 이벤트명은 '제주후원자'.
 *
 * 원본: 제주 사이트의 데이터 API(/.netlify/functions/data) → settings.donateSubmissions[]
 *   · 제출마다 form{field_1..6}과 그 시점의 항목 라벨 fieldsSnapshot[{name,label}]이 함께 저장돼 있어
 *     (폼 항목이 시기별로 달라졌음) 제출 건별 라벨로 해석한다.
 *   · 라벨 분류: 소속 학교 / 소속 단체 / 고인과의 관계 / 성함 / 접속 경로 / 연락처
 * 정리 규칙:
 *   · 이름이 비었거나 자모·숫자만인 시험 제출은 제외
 *   · 같은 전화번호(숫자만 비교)는 한 사람으로 합침 — 가장 많이 쓴 이름을 대표로, 제출 횟수·다른 이름은 메모에 보존
 *   · 전화번호 형식이 아닌 값은 비워 두고 원문을 메모에 보존
 *   · 멱등: 같은 이벤트명에 같은 전화(전화 없으면 같은 이름)가 이미 있으면 건너뜀 → 재실행 안전
 * 개인정보가 공개 저장소에 남지 않도록 명단을 파일에 담지 않고 실행 시점에 원본 API에서 받아온다.
 * 호출 성공 후 즉시 파일 삭제 + commit (CLAUDE.md §6.8).
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-jeju-potential-donors" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

/* ==== MAP-START ==== (순수 변환 로직 — 로컬에서 원본 JSON으로 그대로 검증) */
export const JEJU_SOURCE_URL = "https://tbfa-jeju.com/.netlify/functions/data";
export const JEJU_EVENT_NAME = "제주후원자";
export const JEJU_MEMO_MARK = "[제주 후원폼]";

type Sub = { form?: Record<string, unknown>; fieldsSnapshot?: { name?: string; label?: string }[]; timestamp?: string };
type Field = "school" | "org" | "relation" | "name" | "source" | "phone";
type Row = Record<Field, string> & { ts: string };
export type Mapped = {
  name: string;
  phone: string | null;
  participatedAt: string | null;
  entryPath: string | null;
  memo: string;
  keyPhone: string | null;   // 숫자만 (멱등 비교용)
  keyName: string;           // 공백 제거 이름 (전화 없을 때 멱등 비교용)
  submissions: number;
};

const KEY_FALLBACK: Record<string, Field> = { school: "school", org: "org", relation: "relation", name: "name", phone: "phone", source: "source" };
const normLabel = (l: unknown) => String(l ?? "").replace(/^\s*\d+\s*[.)]\s*/, "").trim();
function classify(label: unknown): Field | "other" {
  const s = normLabel(label);
  if (/학교/.test(s)) return "school";
  if (/단체|소속/.test(s)) return "org";
  if (/성함|이름/.test(s)) return "name";
  if (/경로/.test(s)) return "source";
  if (/연락처|전화|핸드폰|휴대/.test(s)) return "phone";
  if (/관계/.test(s)) return "relation";
  return "other";
}

export function extractSubmissions(payload: any): Sub[] {
  const a = payload?.settings?.donateSubmissions;
  if (Array.isArray(a)) return a;
  const b = payload?.donateSubmissions;
  return Array.isArray(b) ? b : [];
}

export function toRows(subs: Sub[]): Row[] {
  return subs.map((s) => {
    const labelOf: Record<string, Field | "other"> = {};
    for (const f of s.fieldsSnapshot || []) if (f?.name) labelOf[f.name] = classify(f.label);
    const r: Row = { ts: String(s.timestamp || ""), school: "", org: "", relation: "", name: "", source: "", phone: "" };
    for (const [k, v] of Object.entries(s.form || {})) {
      const c = labelOf[k] || KEY_FALLBACK[k] || classify(k);
      if (c !== "other") r[c] = String(v ?? "").trim();
    }
    return r;
  });
}

const digitsOf = (p: string) => String(p || "").replace(/\D/g, "");
const noSpace = (s: string) => String(s || "").replace(/\s+/g, "");

export function isRealName(n: string): boolean {
  const t = noSpace(n);
  if (!t || /^\d+$/.test(t)) return false;
  return /[가-힣]{2,}/.test(t) || /[A-Za-z]{2,}/.test(t);
}

export function formatPhone(raw: string): string | null {
  let d = digitsOf(raw);
  if (d.length === 12 && d.startsWith("82")) d = "0" + d.slice(2);          // +82 10-… 형태
  if (d.length === 11 && /^01[016789]/.test(d)) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10 && d.startsWith("02")) return `02-${d.slice(2, 6)}-${d.slice(6)}`;
  if (d.length === 10 && d.startsWith("0")) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 9 && d.startsWith("02")) return `02-${d.slice(2, 5)}-${d.slice(5)}`;
  return null;
}

const kstDate = (iso: string) => {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 10) : "";
};

export function mergeRows(rows: Row[]): { mapped: Mapped[]; validSubmissions: number; skippedJunk: number; mergedDuplicates: number } {
  const valid = rows.filter((r) => isRealName(r.name));
  const groups = new Map<string, Row[]>();
  for (const r of valid) {
    const ph = formatPhone(r.phone);
    const key = ph ? "P:" + digitsOf(ph) : "N:" + noSpace(r.name) + "|" + noSpace(r.school);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  const mapped: Mapped[] = [];
  for (const group of groups.values()) {
    const byTsDesc = [...group].sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
    /* 대표 이름 = 가장 많이 쓴 이름(공백 무시) · 동률이면 최근 제출 */
    const count = new Map<string, number>();
    for (const r of byTsDesc) count.set(noSpace(r.name), (count.get(noSpace(r.name)) || 0) + 1);
    let repKey = noSpace(byTsDesc[0].name);
    for (const [k, n] of count) if (n > (count.get(repKey) || 0)) repKey = k;
    const repRows = byTsDesc.filter((r) => noSpace(r.name) === repKey);
    const pick = (f: Field) => (repRows.find((r) => r[f]) || byTsDesc.find((r) => r[f]))?.[f] || "";
    const name = repRows[0].name;
    const phone = formatPhone(pick("phone"));
    const otherNames = [...count.keys()].filter((k) => k !== repKey)
      .map((k) => { const r = byTsDesc.find((x) => noSpace(x.name) === k)!; return r.school ? `${r.name}(${r.school})` : r.name; });

    const parts: string[] = [JEJU_MEMO_MARK];
    if (pick("school")) parts.push(`소속 학교: ${pick("school")}`);
    if (pick("org")) parts.push(`소속 단체: ${pick("org")}`);
    if (pick("relation")) parts.push(`고인과의 관계: ${pick("relation")}`);
    const first = kstDate(byTsDesc[byTsDesc.length - 1].ts);
    const last = kstDate(byTsDesc[0].ts);
    parts.push(group.length > 1 ? `제출 ${group.length}회 (${first} ~ ${last})` : `제출 ${first}`);
    if (otherNames.length) parts.push(`다른 이름 제출: ${otherNames.join(", ")}`);
    const rawPhone = pick("phone");
    if (!phone && rawPhone) parts.push(`연락처 원문: ${rawPhone}`);

    const firstTs = byTsDesc[byTsDesc.length - 1].ts;
    mapped.push({
      name,
      phone,
      participatedAt: Number.isFinite(new Date(firstTs).getTime()) ? new Date(firstTs).toISOString() : null,
      entryPath: pick("source") || null,
      memo: parts.join(" · "),
      keyPhone: phone ? digitsOf(phone) : null,
      keyName: noSpace(name),
      submissions: group.length,
    });
  }
  mapped.sort((a, b) => ((a.participatedAt || "") < (b.participatedAt || "") ? -1 : 1));
  return { mapped, validSubmissions: valid.length, skippedJunk: rows.length - valid.length, mergedDuplicates: valid.length - mapped.length };
}
/* ==== MAP-END ==== */

async function fetchSource(): Promise<{ status: number; subs: Sub[]; bytes: number }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(JEJU_SOURCE_URL, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    const text = await res.text();
    if (!res.ok) throw new Error(`원본 API 응답 ${res.status}`);
    return { status: res.status, subs: extractSubmissions(JSON.parse(text)), bytes: text.length };
  } finally { clearTimeout(timer); }
}

const rowsOf = (res: any): any[] => (res?.rows ?? res ?? []) as any[];

async function columnLengths(): Promise<Record<string, number | null>> {
  const rs = await db.execute(sql`
    SELECT column_name, character_maximum_length
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'potential_donors'`);
  const out: Record<string, number | null> = {};
  for (const r of rowsOf(rs)) out[String(r.column_name)] = r.character_maximum_length == null ? null : Number(r.character_maximum_length);
  return out;
}

async function existingJeju(): Promise<{ total: number; phones: Set<string>; names: Set<string> }> {
  const rs = await db.execute(sql`SELECT name, phone FROM potential_donors WHERE event_name = ${JEJU_EVENT_NAME}`);
  const rows = rowsOf(rs);
  const phones = new Set<string>(); const names = new Set<string>();
  for (const r of rows) { const d = digitsOf(String(r.phone || "")); if (d) phones.add(d); else names.add(noSpace(String(r.name || ""))); }
  return { total: rows.length, phones, names };
}

async function authorize(req: Request): Promise<{ ok: true; uid: number | null; via: string } | { ok: false; res: Response }> {
  const expected = process.env.INTERNAL_TRIGGER_SECRET || "";
  const given = req.headers.get("x-internal-secret") || "";
  if (expected && given && given === expected) return { ok: true, uid: null, via: "internal-secret" };
  const auth = await requireAdmin(req);
  if (!auth.ok) return { ok: false, res: (auth as any).res };
  return { ok: true, uid: Number((auth as any).ctx?.admin?.uid) || null, via: "admin-session" };
}

export default async function handler(req: Request, _ctx: Context) {
  let step = "start";
  const t0 = Date.now();
  try {
    const url = new URL(req.url);
    const run = url.searchParams.get("run") === "1";
    const undo = url.searchParams.get("undo") === "1";

    /* ── 되돌리기 ── */
    if (undo) {
      step = "auth";
      const auth = await authorize(req);
      if (!auth.ok) return (auth as { ok: false; res: Response }).res;
      step = "undo";
      const rs = await db.execute(sql`
        DELETE FROM potential_donors
         WHERE event_name = ${JEJU_EVENT_NAME}
           AND memo LIKE ${JEJU_MEMO_MARK + "%"}
           AND linked_member_id IS NULL
        RETURNING id`);
      const deleted = rowsOf(rs).length;
      return new Response(jsonKST({ ok: true, mode: "undone", deleted, via: auth.via, elapsedMs: Date.now() - t0 }, null, 2), { headers: JSON_HEADER });
    }

    /* ── 원본 수집 + 변환 (진단·실행 공통) ── */
    step = "fetch_source";
    const src = await fetchSource();
    step = "map";
    const { mapped, validSubmissions, skippedJunk, mergedDuplicates } = mergeRows(toRows(src.subs));
    step = "db_state";
    const [cols, existing] = await Promise.all([columnLengths(), existingJeju()]);
    const isPresent = (m: Mapped) => (m.keyPhone ? existing.phones.has(m.keyPhone) : existing.names.has(m.keyName));
    const toInsert = mapped.filter((m) => !isPresent(m));
    const summary = {
      source: { url: JEJU_SOURCE_URL, httpStatus: src.status, bytes: src.bytes, submissions: src.subs.length },
      mapping: {
        validSubmissions, skippedJunk, uniquePeople: mapped.length, mergedDuplicates,
        withPhone: mapped.filter((m) => m.phone).length, withoutPhone: mapped.filter((m) => !m.phone).length,
      },
      db: { columnLengths: cols, existingJejuRows: existing.total, alreadyPresent: mapped.length - toInsert.length, toInsert: toInsert.length },
    };

    if (!run) {
      return new Response(jsonKST({
        ok: true, mode: "diagnose", ...summary, elapsedMs: Date.now() - t0,
        hint: toInsert.length
          ? `?run=1 로 실행하면 이벤트명 '${JEJU_EVENT_NAME}'로 ${toInsert.length}명이 잠재 후원자에 추가됩니다(재실행 안전).`
          : "추가할 대상이 없습니다(이미 전부 들어 있음).",
      }, null, 2), { headers: JSON_HEADER });
    }

    /* ── 실행 ── */
    step = "auth";
    const auth = await authorize(req);
    if (!auth.ok) return (auth as { ok: false; res: Response }).res;

    step = "insert";
    const cut = (v: string | null, col: string, fallback: number) => {
      if (v == null) return null;
      const max = cols[col] ?? fallback;
      return max && v.length > max ? v.slice(0, max) : v;
    };
    let inserted = 0;
    const BATCH = 50;
    for (let i = 0; i < toInsert.length; i += BATCH) {
      const chunk = toInsert.slice(i, i + BATCH);
      const values = chunk.map((m) => sql`(
        ${cut(m.name, "name", 50)}, ${cut(m.phone, "phone", 20)}, ${cut(JEJU_EVENT_NAME, "event_name", 100)},
        ${m.participatedAt}::timestamptz, ${cut(m.entryPath, "entry_path", 100)}, ${m.memo},
        ${auth.uid}, NOW(), NOW()
      )`);
      const rs = await db.execute(sql`
        INSERT INTO potential_donors (name, phone, event_name, participated_at, entry_path, memo, created_by, created_at, updated_at)
        VALUES ${sql.join(values, sql`, `)}
        RETURNING id`);
      inserted += rowsOf(rs).length;
    }

    step = "verify";
    const after = await existingJeju();
    return new Response(jsonKST({
      ok: true, mode: "executed", via: auth.via, inserted, skippedExisting: mapped.length - toInsert.length,
      jejuRowsNow: after.total, ...summary, elapsedMs: Date.now() - t0,
      hint: "통합 CMS → 후원관리 → 잠재 후원자 관리에서 이벤트명 '제주후원자'로 검색. 성공 확인 후 이 파일 삭제 + commit.",
    }, null, 2), { headers: JSON_HEADER });
  } catch (err: any) {
    return new Response(jsonKST({
      ok: false, error: "제주 후원자 이관 실패", step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: JSON_HEADER });
  }
}
