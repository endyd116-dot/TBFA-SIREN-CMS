/**
 * lib/memorial-moods.ts — 유가족 근황 «분위기 표시» 문구·색상 목록 (2026-11-12 대표 결정)
 *
 * 관리자가 표시 문구와 글자색 목록을 직접 추가·수정·삭제하고, 근황 글을 쓸 때 이 목록에서 고른다.
 *
 * 저장: site_settings · scope 'memorial' · key 'familyNoteMoods' · value_json = [{ key, text, color }]
 *       (추모관 설정 표 memorial_settings 는 정해진 칸만 있는 한 줄 표라 키-값으로 쓸 수 없다 → 설정 표를 쓴다.
 *        표 구조를 바꾸지 않으므로 마이그레이션이 필요 없다. 행이 없으면 처음 저장할 때 만든다)
 * 기본값: 저장된 목록이 없으면 예전 네 가지(calm·hope·thanks·daily)를 쓴다 — 키가 같아 기존 글이 그대로 보인다.
 *         문구는 그동안 공개 화면에 보이던 그대로, 색은 그동안의 글자색(#3b584e)이다.
 * 근황 글(memorial_family_notes.mood, 길이 16)에는 목록 항목의 key 가 들어간다. 빈 값('')은 «표시 없음».
 * 목록에서 지운 표시를 쓰던 글은 글은 그대로 두고, 공개 화면에서 표시 없이 보인다.
 * 색은 #RRGGBB 형식만 받는다(그 밖의 값은 버린다) — 공개 화면이 글자색과 옅은 바탕색으로 쓴다.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";

export interface MemorialMood {
  key: string;
  text: string;
  color: string | null;
}

export const MOOD_SCOPE = "memorial";
export const MOOD_SETTING_KEY = "familyNoteMoods";
export const MOOD_MAX_ITEMS = 30;
export const MOOD_TEXT_MAX = 40;
/** 근황 글의 mood 칸 길이(varchar 16)와 같다 */
export const MOOD_KEY_MAX = 16;
/** 그동안 공개 화면이 쓰던 글자색(--m2-leaf) */
export const MOOD_DEFAULT_COLOR = "#3b584e";

export const DEFAULT_MOODS: ReadonlyArray<MemorialMood> = [
  { key: "calm", text: "🌿 담담한 하루", color: MOOD_DEFAULT_COLOR },
  { key: "hope", text: "🌤️ 희망", color: MOOD_DEFAULT_COLOR },
  { key: "thanks", text: "💌 감사", color: MOOD_DEFAULT_COLOR },
  { key: "daily", text: "☕ 일상", color: MOOD_DEFAULT_COLOR },
];

const KEY_RE = /^[a-z0-9_-]{1,16}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function rowsOf(result: any): any[] {
  if (!result) return [];
  return Array.isArray(result) ? result : (result.rows ?? []);
}

export function defaultMoods(): MemorialMood[] {
  return DEFAULT_MOODS.map((m) => ({ ...m }));
}

/** #RRGGBB 만 받는다(소문자로 맞춘다). 그 밖의 값은 null */
export function normalizeMoodColor(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return COLOR_RE.test(s) ? s.toLowerCase() : null;
}

/** 표시 key 형식 — 영소문자·숫자·_·- 16자 이내 */
export function isMoodKey(v: unknown): boolean {
  return KEY_RE.test(String(v ?? ""));
}

/** 표시 문구 정리 — 줄바꿈·제어문자 없이 한 줄, 글자 단위로 40자까지(이모지가 반으로 잘리지 않게) */
export function cleanMoodText(v: unknown): string {
  const s = String(v ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(s).slice(0, MOOD_TEXT_MAX).join("").trim();
}

/** 저장값을 믿지 않고 한 번 걸러서 쓴다 — 형식이 틀린 항목·겹치는 key 는 버린다 */
export function sanitizeMoods(v: unknown): MemorialMood[] {
  if (!Array.isArray(v)) return [];
  const out: MemorialMood[] = [];
  const seen = new Set<string>();
  for (const raw of v) {
    if (!raw || typeof raw !== "object") continue;
    const key = String((raw as any).key ?? "").trim();
    const text = cleanMoodText((raw as any).text);
    if (!isMoodKey(key) || !text || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, text, color: normalizeMoodColor((raw as any).color) });
    if (out.length >= MOOD_MAX_ITEMS) break;
  }
  return out;
}

/** 새 표시 key — 'm' + 시각(36진수) + 무작위 3자 = 12자 안팎(16자 이내). 겹치면 다시 만든다 */
export function newMoodKey(existing: string[]): string {
  const used = new Set(existing);
  for (let i = 0; i < 20; i++) {
    const k = ("m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)).slice(0, MOOD_KEY_MAX);
    if (isMoodKey(k) && !used.has(k)) return k;
  }
  return ("m" + Math.random().toString(36).slice(2, 14)).slice(0, MOOD_KEY_MAX);
}

export function moodMap(list: MemorialMood[]): Record<string, MemorialMood> {
  /* 프로토타입 없는 객체 — 'constructor' 같은 이름이 엉뚱한 값으로 잡히지 않게 */
  const map: Record<string, MemorialMood> = Object.create(null);
  for (const m of list || []) map[m.key] = m;
  return map;
}

/**
 * 저장된 목록을 읽는다. saved=false 면 아직 저장한 적이 없어 기본값을 돌려준 것이다.
 * 저장소 조회가 실패하면 예외를 그대로 던진다(호출하는 쪽이 계속할지 정한다).
 */
export async function readMoodSetting(): Promise<{ moods: MemorialMood[]; saved: boolean }> {
  const row = rowsOf(await db.execute(sql`
    SELECT value_json FROM site_settings
     WHERE scope = ${MOOD_SCOPE} AND key = ${MOOD_SETTING_KEY}
     ORDER BY id ASC LIMIT 1
  `))[0];
  let value: any = row ? row.value_json : null;
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { value = null; }
  }
  if (!Array.isArray(value)) return { moods: defaultMoods(), saved: false };
  return { moods: sanitizeMoods(value), saved: true };
}

/** 공개 화면용 — 조회가 실패해도 기본 목록으로 계속한다(보조 조회) */
export async function getMoodsSafe(): Promise<MemorialMood[]> {
  try {
    return (await readMoodSetting()).moods;
  } catch (err: any) {
    console.warn("[memorial-moods] 표시 목록 조회 실패 — 기본 목록으로 계속:", err?.message || err);
    return defaultMoods();
  }
}

/** 목록 저장 — 발행값으로 바로(임시저장 단계 없음). 행이 없으면 만든다. 걸러진 최종 목록을 돌려준다 */
export async function saveMoods(list: MemorialMood[], adminId: number | null): Promise<MemorialMood[]> {
  const clean = sanitizeMoods(list);
  const json = JSON.stringify(clean);
  const found = rowsOf(await db.execute(sql`
    SELECT id FROM site_settings
     WHERE scope = ${MOOD_SCOPE} AND key = ${MOOD_SETTING_KEY}
     ORDER BY id ASC LIMIT 1
  `))[0];
  if (found) {
    await db.execute(sql`
      UPDATE site_settings
         SET value_type = 'json', value_json = ${json}::jsonb,
             draft_value_json = NULL, has_draft = false, is_active = true,
             updated_at = NOW(), updated_by = ${adminId}
       WHERE id = ${found.id}`);
  } else {
    await db.execute(sql`
      INSERT INTO site_settings (scope, key, value_type, value_json, description, sort_order, is_active, updated_at, updated_by)
      VALUES (${MOOD_SCOPE}, ${MOOD_SETTING_KEY}, 'json', ${json}::jsonb,
              ${"추모관 유가족 근황 분위기 표시 목록 — 추모관 운영 › 유가족 근황에서 관리"}, 0, true, NOW(), ${adminId})`);
  }
  return clean;
}

/** 표시별로 그 표시를 쓰는 근황 글 수 (숨긴 글 포함) */
export async function moodUsage(): Promise<Record<string, number>> {
  const rows = rowsOf(await db.execute(sql`
    SELECT mood, COUNT(*)::int AS n FROM memorial_family_notes GROUP BY mood
  `));
  const out: Record<string, number> = {};
  for (const r of rows) out[String(r.mood ?? "")] = Number(r.n) || 0;
  return out;
}
