/**
 * lib/memorial-spotlight.ts — 추모관 "이달에 기억할 선생님"
 *
 * 생일·기일처럼 특별한 날을 맞은 선생님을 그달에 소개한다.
 * 예전 사진과 가족이 전하는 한마디를 함께 싣는다.
 *
 * 이달 판단은 **날짜의 '월'만** 본다. 해마다 다시 등록할 필요 없이 매년 그달에 자동으로 뜬다.
 * 월 판정은 한국 시각 기준이다(서버는 UTC라 그냥 두면 월말·월초에 하루 어긋난다 — 시각 정책).
 *
 * 저장 공간을 직접 SQL로 다룬다. 준비되기 전에도 화면이 멈추지 않고 빈 목록으로 넘어간다.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import { monthKST } from "./kst";

export type SpotlightOccasion = "birth" | "death" | "other";
export const VALID_OCCASIONS: SpotlightOccasion[] = ["birth", "death", "other"];

export interface SpotlightItem {
  id: number;
  teacherId: number | null;
  displayName: string;
  occasion: SpotlightOccasion;
  occasionDate: string | null;
  photoBlobId: number | null;
  photoUrl: string | null;
  familyMessage: string | null;
  familyName: string | null;
  isActive: boolean;
  sortOrder: number;
}

export const SPOTLIGHT_DEFAULT_TITLE = "이달에 기억할 선생님";
export const SPOTLIGHT_DEFAULT_DESC = "특별한 날을 맞은 선생님을 가족의 한마디와 함께 기억합니다.";

function rowsOf(result: any): any[] {
  if (!result) return [];
  return Array.isArray(result) ? result : (result.rows ?? []);
}

let _ready: boolean | null = null;

export async function spotlightReady(): Promise<boolean> {
  if (_ready !== null) return _ready;
  try {
    const t = rowsOf(await db.execute(sql`
      SELECT table_name FROM information_schema.tables
       WHERE table_schema='public' AND table_name='memorial_spotlights'
    `));
    _ready = t.length > 0;
  } catch { _ready = false; }
  return _ready;
}

function shape(r: any): SpotlightItem {
  const blobId = r.photo_blob_id == null ? null : Number(r.photo_blob_id);
  return {
    id: Number(r.id),
    teacherId: r.teacher_id == null ? null : Number(r.teacher_id),
    displayName: String(r.display_name || ""),
    occasion: (r.occasion || "other") as SpotlightOccasion,
    /* 날짜는 YYYY-MM-DD 문자열로만 쓴다 (시각 변환이 끼어들면 하루 밀린다) */
    occasionDate: r.occasion_date ? String(r.occasion_date).slice(0, 10) : null,
    photoBlobId: blobId,
    photoUrl: blobId ? `/api/blob-image?id=${blobId}` : null,
    familyMessage: r.family_message ?? null,
    familyName: r.family_name ?? null,
    isActive: r.is_active !== false,
    sortOrder: Number(r.sort_order || 0),
  };
}

/** 이번 달에 보여줄 항목 (공개 화면용) */
export async function getThisMonthSpotlights(): Promise<SpotlightItem[]> {
  if (!(await spotlightReady())) return [];
  try {
    const month = monthKST();   /* 한국 시각 기준 이번 달 */
    const rows = rowsOf(await db.execute(sql`
      SELECT * FROM memorial_spotlights
       WHERE is_active = true
         AND occasion_date IS NOT NULL
         AND EXTRACT(MONTH FROM occasion_date) = ${month}
       ORDER BY sort_order ASC, EXTRACT(DAY FROM occasion_date) ASC, id ASC
    `));
    return rows.map(shape);
  } catch (e) {
    console.warn("[memorial-spotlight.getThisMonth]", e);
    return [];
  }
}

/** 전체 목록 (관리 화면용 — 꺼둔 것까지) */
export async function listSpotlights(): Promise<SpotlightItem[]> {
  if (!(await spotlightReady())) return [];
  try {
    const rows = rowsOf(await db.execute(sql`
      SELECT * FROM memorial_spotlights
       ORDER BY EXTRACT(MONTH FROM occasion_date) ASC NULLS LAST, sort_order ASC, id ASC
    `));
    return rows.map(shape);
  } catch (e) {
    console.warn("[memorial-spotlight.list]", e);
    return [];
  }
}

export interface SpotlightPayload {
  teacherId?: number | null;
  displayName?: string;
  occasion?: string;
  occasionDate?: string | null;
  photoBlobId?: number | null;
  familyMessage?: string | null;
  familyName?: string | null;
  isActive?: boolean;
  sortOrder?: number;
}

function clean(p: SpotlightPayload) {
  const occasion = VALID_OCCASIONS.includes(p.occasion as SpotlightOccasion)
    ? (p.occasion as SpotlightOccasion) : "other";
  /* 날짜는 YYYY-MM-DD 형태만 받는다 */
  const date = p.occasionDate && /^\d{4}-\d{2}-\d{2}$/.test(String(p.occasionDate))
    ? String(p.occasionDate) : null;
  return {
    teacherId: p.teacherId ? Number(p.teacherId) : null,
    displayName: String(p.displayName || "").trim().slice(0, 60),
    occasion,
    date,
    photoBlobId: p.photoBlobId ? Number(p.photoBlobId) : null,
    familyMessage: p.familyMessage != null ? String(p.familyMessage).slice(0, 2000) : null,
    familyName: p.familyName != null ? String(p.familyName).trim().slice(0, 60) : null,
    isActive: p.isActive !== false,
    sortOrder: Number.isFinite(Number(p.sortOrder)) ? Number(p.sortOrder) : 0,
  };
}

export async function createSpotlight(p: SpotlightPayload): Promise<{ ok: boolean; id?: number; error?: string }> {
  if (!(await spotlightReady())) return { ok: false, error: "저장소 준비(마이그레이션)가 아직 완료되지 않았습니다" };
  const c = clean(p);
  if (!c.displayName) return { ok: false, error: "선생님 성함을 입력해주세요" };
  if (!c.date) return { ok: false, error: "기억할 날짜를 입력해주세요" };

  try {
    const row = rowsOf(await db.execute(sql`
      INSERT INTO memorial_spotlights
        (teacher_id, display_name, occasion, occasion_date, photo_blob_id, family_message, family_name, is_active, sort_order)
      VALUES
        (${c.teacherId}, ${c.displayName}, ${c.occasion}, ${c.date}, ${c.photoBlobId},
         ${c.familyMessage}, ${c.familyName}, ${c.isActive}, ${c.sortOrder})
      RETURNING id
    `))[0];
    return { ok: true, id: Number(row?.id) };
  } catch (e: any) {
    console.error("[memorial-spotlight.create]", e);
    return { ok: false, error: "등록하지 못했습니다" };
  }
}

export async function updateSpotlight(id: number, p: SpotlightPayload): Promise<{ ok: boolean; error?: string }> {
  if (!(await spotlightReady())) return { ok: false, error: "저장소 준비가 아직 완료되지 않았습니다" };
  const c = clean(p);
  if (!c.displayName) return { ok: false, error: "선생님 성함을 입력해주세요" };
  if (!c.date) return { ok: false, error: "기억할 날짜를 입력해주세요" };

  try {
    await db.execute(sql`
      UPDATE memorial_spotlights SET
        teacher_id = ${c.teacherId},
        display_name = ${c.displayName},
        occasion = ${c.occasion},
        occasion_date = ${c.date},
        photo_blob_id = ${c.photoBlobId},
        family_message = ${c.familyMessage},
        family_name = ${c.familyName},
        is_active = ${c.isActive},
        sort_order = ${c.sortOrder},
        updated_at = NOW()
      WHERE id = ${id}
    `);
    return { ok: true };
  } catch (e: any) {
    console.error("[memorial-spotlight.update]", e);
    return { ok: false, error: "저장하지 못했습니다" };
  }
}

export async function deleteSpotlight(id: number): Promise<{ ok: boolean; error?: string }> {
  if (!(await spotlightReady())) return { ok: false, error: "저장소 준비가 아직 완료되지 않았습니다" };
  try {
    await db.execute(sql`DELETE FROM memorial_spotlights WHERE id = ${id}`);
    return { ok: true };
  } catch (e: any) {
    console.error("[memorial-spotlight.delete]", e);
    return { ok: false, error: "삭제하지 못했습니다" };
  }
}

/** 코너 제목·설명 (운영자가 바꿀 수 있다) */
export async function getSpotlightText(): Promise<{ title: string; desc: string }> {
  try {
    const r = rowsOf(await db.execute(sql`
      SELECT spotlight_title, spotlight_desc FROM memorial_settings ORDER BY id DESC LIMIT 1
    `))[0];
    return {
      title: String(r?.spotlight_title || "").trim() || SPOTLIGHT_DEFAULT_TITLE,
      desc: String(r?.spotlight_desc || "").trim() || SPOTLIGHT_DEFAULT_DESC,
    };
  } catch {
    return { title: SPOTLIGHT_DEFAULT_TITLE, desc: SPOTLIGHT_DEFAULT_DESC };
  }
}

export async function saveSpotlightText(title?: string, desc?: string): Promise<void> {
  try {
    const t = title !== undefined ? String(title).trim().slice(0, 80) || null : null;
    const d = desc !== undefined ? String(desc).trim().slice(0, 200) || null : null;
    if (t === null && d === null) return;
    const exists = rowsOf(await db.execute(sql`SELECT id FROM memorial_settings ORDER BY id DESC LIMIT 1`));
    if (exists.length === 0) {
      await db.execute(sql`INSERT INTO memorial_settings (bgm_tracks) VALUES ('[]'::jsonb)`);
    }
    await db.execute(sql`
      UPDATE memorial_settings SET
        spotlight_title = COALESCE(${t}, spotlight_title),
        spotlight_desc  = COALESCE(${d}, spotlight_desc),
        updated_at = NOW()
      WHERE id = (SELECT id FROM memorial_settings ORDER BY id DESC LIMIT 1)
    `);
  } catch (e) {
    console.warn("[memorial-spotlight.saveText]", e);
  }
}
