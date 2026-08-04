/**
 * lib/memorial-display.ts — 추모관 표시 문구·노출 설정
 *
 * 선생님 개별 페이지에서 쓰는 세 가지를 운영자가 바꿀 수 있게 한다.
 *   · 약력 자리 제목        (협의회에서 '약력'이라는 말을 쓰지 않으려 함)
 *   · 기억의 발자취 자리 제목
 *   · 개별 헌화 영역 표시 여부
 *     (추모관 첫 화면에서 이미 헌화할 수 있어 선생님마다 또 두면 중복이고,
 *      각 선생님 이야기에 집중하기 어렵다는 판단)
 *
 * 저장 칸을 **직접 SQL로** 다룬다. 스키마 정의에 넣으면 저장소에 칸이 만들어지기 전에
 * 추모 설정 조회가 통째로 실패해 추모관이 멈춘다(전체 칸 조회 방식이라 — CLAUDE.md §9.1.1).
 * 칸이 아직 없으면 조용히 기본값으로 넘어가므로, 준비 전에 배포돼도 화면은 멀쩡하다.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";

export interface MemorialDisplay {
  bioLabel: string;
  timelineLabel: string;
  showTeacherOffering: boolean;
}

export const MEMORIAL_DISPLAY_DEFAULT: MemorialDisplay = {
  bioLabel: "약력",
  timelineLabel: "기억의 발자취",
  showTeacherOffering: true,
};

function rowsOf(result: any): any[] {
  if (!result) return [];
  return Array.isArray(result) ? result : (result.rows ?? []);
}

let _ready: boolean | null = null;

/** 저장 칸이 준비됐는지 — 한 번 확인하면 함수가 사는 동안 기억한다 */
export async function displayColumnsReady(): Promise<boolean> {
  if (_ready !== null) return _ready;
  try {
    const rows = rowsOf(await db.execute(sql`
      SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'memorial_settings'
         AND column_name IN ('bio_label', 'timeline_label', 'show_teacher_offering')
    `));
    _ready = rows.length === 3;
  } catch {
    _ready = false;
  }
  return _ready;
}

/** 현재 설정 (칸이 없거나 값이 비었으면 기본값) */
export async function getMemorialDisplay(): Promise<MemorialDisplay> {
  if (!(await displayColumnsReady())) return { ...MEMORIAL_DISPLAY_DEFAULT };
  try {
    const row = rowsOf(await db.execute(sql`
      SELECT bio_label, timeline_label, show_teacher_offering
        FROM memorial_settings ORDER BY id DESC LIMIT 1
    `))[0];
    if (!row) return { ...MEMORIAL_DISPLAY_DEFAULT };
    return {
      bioLabel: String(row.bio_label || "").trim() || MEMORIAL_DISPLAY_DEFAULT.bioLabel,
      timelineLabel: String(row.timeline_label || "").trim() || MEMORIAL_DISPLAY_DEFAULT.timelineLabel,
      showTeacherOffering: row.show_teacher_offering !== false,
    };
  } catch (e) {
    console.warn("[memorial-display.get]", e);
    return { ...MEMORIAL_DISPLAY_DEFAULT };
  }
}

/** 설정 저장. 준비 전이면 안내를 돌려준다. */
export async function saveMemorialDisplay(
  patch: Partial<{ bioLabel: string; timelineLabel: string; showTeacherOffering: boolean }>,
): Promise<{ ok: boolean; error?: string }> {
  if (!(await displayColumnsReady())) {
    return { ok: false, error: "저장소 준비(마이그레이션)가 아직 완료되지 않았습니다" };
  }

  const bio = patch.bioLabel !== undefined
    ? (String(patch.bioLabel).trim().slice(0, 50) || MEMORIAL_DISPLAY_DEFAULT.bioLabel) : null;
  const tl = patch.timelineLabel !== undefined
    ? (String(patch.timelineLabel).trim().slice(0, 50) || MEMORIAL_DISPLAY_DEFAULT.timelineLabel) : null;
  const show = patch.showTeacherOffering !== undefined ? !!patch.showTeacherOffering : null;

  if (bio === null && tl === null && show === null) return { ok: true };

  try {
    /* 설정 행이 아직 없으면 만들어 둔다 (다른 설정과 같은 한 줄을 쓴다) */
    const exists = rowsOf(await db.execute(sql`SELECT id FROM memorial_settings ORDER BY id DESC LIMIT 1`));
    if (exists.length === 0) {
      await db.execute(sql`INSERT INTO memorial_settings (bgm_tracks) VALUES ('[]'::jsonb)`);
    }

    await db.execute(sql`
      UPDATE memorial_settings SET
        bio_label = COALESCE(${bio}, bio_label),
        timeline_label = COALESCE(${tl}, timeline_label),
        show_teacher_offering = COALESCE(${show}, show_teacher_offering),
        updated_at = NOW()
      WHERE id = (SELECT id FROM memorial_settings ORDER BY id DESC LIMIT 1)
    `);
    return { ok: true };
  } catch (e: any) {
    console.error("[memorial-display.save]", e);
    return { ok: false, error: "설정을 저장하지 못했습니다" };
  }
}
