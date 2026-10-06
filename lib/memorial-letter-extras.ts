/**
 * lib/memorial-letter-extras.ts — 기억의 편지에 더해진 칸
 *
 * ★ 2026-10-07 정책국장 요청 — "편지 30통이 모이면 책이 됩니다"
 *   publish_consent : 이 편지를 책으로 엮는 데 동의했는지
 *   meta            : 고른 질문·초대 경로·앞으로 붙을 음성/손편지 사진 같은 확장 정보(jsonb)
 *   ip_hash         : 로그인하지 않은 분의 도배 방지 (되돌릴 수 없게 섞은 값 — 한마디와 같은 방식)
 *
 * 저장 칸을 직접 SQL로 다룬다 — 마이그레이션(migrate-memorial-v3) 전에 배포돼도
 * 편지 보내기·읽기는 그대로 되고, 이 칸들만 조용히 건너뛴다(CLAUDE.md §9.1.1).
 */
import { sql } from "drizzle-orm";
import { db } from "../db";

export const LETTER_EXTRA_COLUMNS = ["publish_consent", "meta", "ip_hash"];

function rowsOf(r: any): any[] {
  if (!r) return [];
  return Array.isArray(r) ? r : (r.rows ?? []);
}

let _ready: boolean | null = null;

/** 더해진 칸이 모두 준비됐는지 — 한 번 확인하면 함수가 사는 동안 기억한다 */
export async function letterExtrasReady(): Promise<boolean> {
  if (_ready !== null) return _ready;
  try {
    const rows = rowsOf(await db.execute(sql`
      SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'memorial_letters'
         AND column_name IN ('publish_consent', 'meta', 'ip_hash')
    `));
    _ready = rows.length === LETTER_EXTRA_COLUMNS.length;
  } catch {
    _ready = false;
  }
  return _ready;
}

export interface LetterExtras {
  publishConsent: boolean;
  meta: Record<string, unknown> | null;
  ipHash: string | null;
}

/** 편지를 저장한 직후 더해진 칸을 채운다. 준비 전이면 false (편지 자체는 이미 저장됨) */
export async function saveLetterExtras(id: number, extras: LetterExtras): Promise<boolean> {
  if (!(await letterExtrasReady())) return false;
  try {
    await db.execute(sql`
      UPDATE memorial_letters SET
        publish_consent = ${!!extras.publishConsent},
        meta            = ${JSON.stringify(extras.meta ?? {})}::jsonb,
        ip_hash         = ${extras.ipHash}
      WHERE id = ${id}
    `);
    return true;
  } catch (e) {
    console.warn("[memorial-letter-extras.save]", e);
    return false;
  }
}

/** 로그인하지 않은 같은 기기가 최근 N초 안에 편지를 보냈는지 (도배 방지) */
export async function anonLetterRecently(ipHash: string, seconds: number): Promise<boolean> {
  if (!ipHash || !(await letterExtrasReady())) return false;
  try {
    const rows = rowsOf(await db.execute(sql`
      SELECT 1 FROM memorial_letters
       WHERE member_id IS NULL AND ip_hash = ${ipHash}
         AND created_at > NOW() - (${seconds} * INTERVAL '1 second')
       LIMIT 1
    `));
    return rows.length > 0;
  } catch (e) {
    /* 확인 자체가 실패하면 막지 않는다 — 정상 참여를 놓치지 않기 위해 */
    console.warn("[memorial-letter-extras.recent]", e);
    return false;
  }
}

/** 편지 id 목록의 출판 동의 여부 (어드민 표시용). 준비 전이면 빈 객체 */
export async function consentMapFor(ids: number[]): Promise<Record<number, boolean>> {
  const out: Record<number, boolean> = {};
  const list = Array.from(new Set(ids.filter((n) => Number.isFinite(n) && n > 0)));
  if (!list.length || !(await letterExtrasReady())) return out;
  try {
    const rows = rowsOf(await db.execute(sql`
      SELECT id, publish_consent FROM memorial_letters
       WHERE id IN (${sql.join(list.map((id) => sql`${id}`), sql`, `)})
    `));
    for (const r of rows) out[Number(r.id)] = r.publish_consent === true;
  } catch (e) {
    console.warn("[memorial-letter-extras.consent]", e);
  }
  return out;
}
