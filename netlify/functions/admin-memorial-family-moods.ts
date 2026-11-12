// netlify/functions/admin-memorial-family-moods.ts
// ★ 2026-11-12 대표 결정 — 유가족 근황 «분위기 표시» 문구·색상 목록 관리 (운영자)
//
// 관리자가 표시 문구와 글자색 목록을 직접 추가·수정·삭제한다. 근황 글을 쓸 때 이 목록에서 고른다.
// 저장 위치·기본값·규칙은 lib/memorial-moods.ts 한 곳에 있다.
//
//   GET                         목록 { moods:[{key,text,color}], usage:{key:글 수}, saved }
//   POST ?action=create         추가 { text, color }          → key 는 서버가 만든다(16자 이내)
//   POST ?action=update&key=K   수정 { text?, color? }         (준 것만 바뀐다)
//   POST ?action=delete&key=K   삭제 → 그 표시를 쓰던 글은 그대로 두고, 공개 화면에서 표시 없이 보인다
//
// 색은 #RRGGBB 형식만 받는다(그 밖의 값은 무시 — 추가할 때는 기본 글자색으로 보이고, 수정할 때는 바꾸지 않는다).
// 권한: 유가족 근황 관리 API(/api/admin-memorial-family-notes)와 같은 방식 — 관리자 로그인(requireAdmin)만 본다.

import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { jsonKST } from "../../lib/kst";
import {
  readMoodSetting, saveMoods, moodUsage, newMoodKey,
  cleanMoodText, normalizeMoodColor, isMoodKey,
  MOOD_MAX_ITEMS, MOOD_TEXT_MAX,
  type MemorialMood,
} from "../../lib/memorial-moods";

export const config = { path: "/api/admin-memorial-family-moods" };

const HEADERS = { "Content-Type": "application/json" };

function jsonError(step: string, err: any) {
  return new Response(jsonKST({
    ok: false,
    error: "분위기 표시 목록 처리 실패",
    step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: HEADERS });
}

function bad(msg: string, status = 400) {
  return new Response(jsonKST({ ok: false, error: msg }), { status, headers: HEADERS });
}

/** 글 수는 보조 정보 — 세지 못해도 목록은 돌려준다 */
async function usageSafe(): Promise<Record<string, number>> {
  try { return await moodUsage(); }
  catch (err: any) {
    console.warn("[admin-memorial-family-moods] 글 수 집계 실패 — 빈 값으로 계속:", err?.message || err);
    return {};
  }
}

export default async function handler(req: Request, _ctx: Context) {
  let step = "auth";
  try {
    const guard = await requireAdmin(req);
    if (!guard.ok) return (guard as { ok: false; res: Response }).res;
    const adminId = Number((guard as any).ctx?.admin?.uid) || null;

    const url = new URL(req.url);
    const method = req.method.toUpperCase();

    /* ───────── 목록 ───────── */
    if (method === "GET") {
      step = "select_moods";
      const { moods, saved } = await readMoodSetting();
      step = "count_usage";
      const usage = await usageSafe();
      return new Response(jsonKST({ ok: true, data: { moods, usage, saved } }), { status: 200, headers: HEADERS });
    }

    if (method !== "POST") return bad("지원하지 않는 메서드입니다", 405);

    step = "parse";
    const action = String(url.searchParams.get("action") || "").trim();
    const key = String(url.searchParams.get("key") || "").trim();
    let body: any = {};
    try { body = await req.json(); } catch { body = {}; }
    if (!body || typeof body !== "object") body = {};

    step = "select_moods";
    const { moods } = await readMoodSetting();
    let next: MemorialMood[] = moods.map((m) => ({ ...m }));
    let changedKey = key;

    if (action === "create") {
      step = "validate_create";
      const text = cleanMoodText(body.text);
      if (!text) return bad("표시 문구를 입력해 주세요");
      if (next.length >= MOOD_MAX_ITEMS) return bad(`표시는 ${MOOD_MAX_ITEMS}개까지 만들 수 있습니다`);
      changedKey = newMoodKey(next.map((m) => m.key));
      next.push({ key: changedKey, text, color: normalizeMoodColor(body.color) });
    } else if (action === "update") {
      step = "validate_update";
      if (!isMoodKey(key)) return bad("고칠 표시를 찾을 수 없습니다");
      const item = next.find((m) => m.key === key);
      if (!item) return bad("고칠 표시가 목록에 없습니다. 화면을 새로 고친 뒤 다시 시도해 주세요", 404);
      if (body.text !== undefined) {
        const text = cleanMoodText(body.text);
        if (!text) return bad("표시 문구를 입력해 주세요");
        item.text = text;
      }
      if (body.color !== undefined) {
        const color = normalizeMoodColor(body.color);
        if (color) item.color = color;          /* 형식이 틀린 색은 무시(그대로 둔다) */
      }
    } else if (action === "delete") {
      step = "validate_delete";
      if (!isMoodKey(key)) return bad("지울 표시를 찾을 수 없습니다");
      if (!next.some((m) => m.key === key)) return bad("지울 표시가 목록에 없습니다. 화면을 새로 고친 뒤 다시 시도해 주세요", 404);
      next = next.filter((m) => m.key !== key);
    } else {
      return bad("알 수 없는 동작입니다 (create · update · delete)");
    }

    step = "save_moods";
    const saved = await saveMoods(next, adminId);
    step = "count_usage";
    const usage = await usageSafe();

    return new Response(jsonKST({
      ok: true,
      data: { moods: saved, usage, saved: true, key: changedKey, textMax: MOOD_TEXT_MAX },
    }), { status: 200, headers: HEADERS });
  } catch (err: any) {
    return jsonError(step, err);
  }
}
