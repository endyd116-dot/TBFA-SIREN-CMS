/**
 * lib/memorial-timeline.ts — '우리가 함께 놓은 온기의 징검다리' 공용 조각
 *
 * ★ 2026-10-07 정책국장 요청 — 협의회가 유가족 곁에서 해온 일·하고 있는 일·앞으로 할 일을
 *   시간순으로 적는 표(memorial_timeline). 공개 API와 어드민 API가 같은 모양으로 읽고 쓴다.
 *
 * 표를 직접 SQL로 다룬다 — 마이그레이션(migrate-memorial-v3) 전에 배포돼도
 * 화면은 빈 목록, 어드민은 안내만 띄우고 멈추지 않는다(CLAUDE.md §9.1.1).
 */
import { sql } from "drizzle-orm";
import { db } from "../db";

export function rowsOf(r: any): any[] {
  if (!r) return [];
  return Array.isArray(r) ? r : (r.rows ?? []);
}

let _ready = false;
let _lastMiss = 0;
const RECHECK_MS = 30 * 1000;

/** 표가 준비됐는지.
 *  ★ "있음"만 기억한다. "없음"을 함수가 사는 동안 기억하면, 운영자가 마이그를 호출한 뒤에도
 *  살아 있는 함수 인스턴스가 계속 "없음"이라 답해 기능이 늦게 켜진다(2026-10-07 실측 — 배포나
 *  인스턴스 교체 때까지 징검다리가 ready:false). 없음일 때는 30초마다 다시 본다. */
export async function timelineTableReady(): Promise<boolean> {
  if (_ready) return true;
  if (Date.now() - _lastMiss < RECHECK_MS) return false;
  try {
    const t = rowsOf(await db.execute(sql`
      SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'memorial_timeline'
    `));
    _ready = t.length > 0;
  } catch {
    _ready = false;
  }
  if (!_ready) _lastMiss = Date.now();
  return _ready;
}

/* 날짜는 SQL에서 글자로 만들어 보낸다 — 시간대 변환이 끼어들 틈을 없앤다(KST 정책) */
export const TIMELINE_SELECT_COLS = sql`
  id, title, summary, detail, category, date_label, image_blob_id, link_url, sort_order, is_public,
  to_char(event_date, 'YYYY-MM-DD') AS event_date_text,
  to_char(event_date, 'YYYY.MM.DD') AS event_date_dots
`;

export function shapeTimeline(r: any) {
  return {
    id: r.id,
    eventDate: r.event_date_text || null,                 /* 'YYYY-MM-DD' */
    dateLabel: r.date_label || r.event_date_dots || null, /* 운영자 표기가 없으면 'YYYY.MM.DD' */
    category: r.category || null,
    title: r.title,
    summary: r.summary || null,
    detail: r.detail || null,
    photoUrl: r.image_blob_id ? `/api/blob-image?id=${r.image_blob_id}` : null,
    imageBlobId: r.image_blob_id || null,
    linkUrl: r.link_url || null,
    sortOrder: r.sort_order,
    isPublic: r.is_public,
  };
}
