// lib/release-autopublish.ts
// [업데이트 소식] 자동 발행 (2026-10-19 Swain: «패치가 끝나면 자동으로 업데이트 글 올려놔»)
//
// 동작: 배포본에 담긴 코드 시드 초안(PENDING_DRAFTS) 가운데 DB에 없는 것을 «발행» 상태로 바로 넣고,
//       예전에 초안으로만 가져와 두고 발행하지 않은 시드 소식도 발행한다. 운영자가 손으로 쓴 초안(draft_key 없음)은 건드리지 않는다.
// 시점: 업데이트 소식 목록을 읽는 순간(통합 CMS 첫 화면의 «새 소식» 위젯이 매번 부름) — 배포 뒤 누군가 CMS를 열면 그 자리에서 발행.
//       함수 인스턴스마다 APP_VERSION 기준 1회만 실제 동기화(같은 배포본에서 반복 호출해도 DB 조회 1회).
// 발행일: 초안 키 앞머리 날짜(2026-08-04-xxx → 그날 09:00 KST)로 맞춰 목록이 실제 배포 순서대로 선다. 날짜 없는 키는 지금.
// 실패해도 throw 하지 않는다(목록 조회에 영향 0).
import { eq, inArray, and, isNotNull } from "drizzle-orm";
import { db } from "../db";
import { releaseNotes } from "../db/schema";
import { APP_VERSION, PENDING_DRAFTS } from "./release-drafts";

let syncedVersion: string | null = null;

function sanitizeItems(raw: any): { text: string; link?: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((it: any) => ({ text: String(it?.text || "").slice(0, 1000), link: it?.link ? String(it.link).slice(0, 300) : undefined }))
    .filter((it) => it.text);
}

function publishedAtFromKey(key: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(key || ""));
  if (!m) return new Date();
  const at = new Date(`${m[1]}-${m[2]}-${m[3]}T09:00:00+09:00`);
  return Number.isFinite(at.getTime()) && at.getTime() < Date.now() ? at : new Date();
}

export interface AutoPublishResult { inserted: number; published: number; skipped: boolean }

export async function autoPublishReleaseDrafts(force = false): Promise<AutoPublishResult> {
  if (!force && syncedVersion === APP_VERSION) return { inserted: 0, published: 0, skipped: true };
  let inserted = 0;
  let published = 0;
  try {
    const keys = PENDING_DRAFTS.map((d) => d.key);
    let existing: string[] = [];
    if (keys.length) {
      const rows: any = await db.select({ draftKey: releaseNotes.draftKey }).from(releaseNotes).where(inArray(releaseNotes.draftKey, keys));
      existing = rows.map((r: any) => String(r.draftKey));
    }
    for (const d of PENDING_DRAFTS.filter((x) => !existing.includes(x.key))) {
      try {
        await db.insert(releaseNotes).values({
          draftKey: d.key,
          title: d.title.slice(0, 200),
          items: sanitizeItems(d.items),
          status: "published",
          publishedAt: publishedAtFromKey(d.key),
          createdBy: null,
        } as any);
        inserted++;
      } catch (e: any) { console.warn("[release-autopublish] 삽입 실패:", d.key, e?.message || e); }
    }

    /* 예전에 초안으로 가져와 두고 발행 안 한 시드 소식 → 발행(키 날짜로) */
    const held: any = await db
      .select({ id: releaseNotes.id, draftKey: releaseNotes.draftKey })
      .from(releaseNotes)
      .where(and(eq(releaseNotes.status, "draft"), isNotNull(releaseNotes.draftKey)));
    for (const h of held) {
      try {
        await db.update(releaseNotes)
          .set({ status: "published", publishedAt: publishedAtFromKey(String(h.draftKey)), updatedAt: new Date() } as any)
          .where(eq(releaseNotes.id, h.id));
        published++;
      } catch (e: any) { console.warn("[release-autopublish] 발행 실패:", h.id, e?.message || e); }
    }
    syncedVersion = APP_VERSION;
    if (inserted || published) console.log(`[release-autopublish] ${APP_VERSION}: 새 소식 ${inserted}건 발행 · 묵은 초안 ${published}건 발행`);
  } catch (e: any) {
    console.warn("[release-autopublish] 동기화 실패(무시):", e?.message || e);
  }
  return { inserted, published, skipped: false };
}
