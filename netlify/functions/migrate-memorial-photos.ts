// netlify/functions/migrate-memorial-photos.ts
// ★ 2026-08-28 추모관 v2 — 선생님 개별 화면 재설계 (1회용)
//
// 만드는 것 두 가지
//   1. memorial_teacher_photos — 선생님의 생전 순간을 담은 사진(폴라로이드)
//      사진 한 장 + 짧은 설명 + 더 긴 이야기. 운영자만 등록한다(2026-08-28 Swain 결정 A안).
//      고인·유가족의 사진이라 아무나 올릴 수 없어야 한다.
//   2. memorial_teachers.page_copy — 이 선생님 화면의 문구를 개별로 손볼 자리
//      비워두면 공통 문구를 쓴다.
//
// 호출: https://tbfa.co.kr/api/migrate-memorial-photos?run=1  (어드민 로그인 상태)
//       ?run=1 없이 열면 진단만 한다 (인증 불필요)
// 호출 성공 후 이 파일은 삭제한다.

import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-memorial-photos" };

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
function rowsOf(res: any): any[] {
  return (res?.rows ?? res ?? []) as any[];
}

async function diagnose() {
  const out: Record<string, string> = {};
  try {
    const r = await db.execute(sql`SELECT to_regclass('public.memorial_teacher_photos') AS t`);
    out["사진_자리"] = rowsOf(r)[0]?.t ? "있음" : "없음";
  } catch (e: any) {
    out["사진_자리"] = "확인 실패 — " + String(e?.message || e).slice(0, 120);
  }
  try {
    const r = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'memorial_teachers' AND column_name = 'page_copy'
    `);
    out["개별문구_자리"] = rowsOf(r).length > 0 ? "있음" : "없음";
  } catch (e: any) {
    out["개별문구_자리"] = "확인 실패 — " + String(e?.message || e).slice(0, 120);
  }
  return out;
}

export default async (req: Request) => {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";
  const before = await diagnose();

  if (!run) {
    return json({
      ok: true,
      mode: "진단",
      현재상태: before,
      실행방법: "이 주소 뒤에 ?run=1 을 붙여 어드민 로그인 상태로 다시 여세요",
    });
  }

  const auth: any = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  const done: Record<string, string> = {};

  /* 1) 선생님 사진 (폴라로이드) */
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS memorial_teacher_photos (
        id          serial PRIMARY KEY,
        teacher_id  integer NOT NULL,
        blob_id     integer,
        caption     varchar(120) NOT NULL,
        detail      text,
        taken_label varchar(60),
        sort_order  integer NOT NULL DEFAULT 0,
        is_public   boolean NOT NULL DEFAULT true,
        created_by  integer,
        created_at  timestamp NOT NULL DEFAULT now(),
        updated_at  timestamp NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS memorial_teacher_photos_idx
      ON memorial_teacher_photos (teacher_id, is_public, sort_order)
    `);
    done["1_사진_자리"] = "완료";
  } catch (e: any) {
    return json({ ok: false, step: "create_photos", 이미한것: done,
      detail: String(e?.message || e).slice(0, 500) }, 500);
  }

  /* 2) 선생님별 화면 문구 */
  try {
    await db.execute(sql`
      ALTER TABLE memorial_teachers
      ADD COLUMN IF NOT EXISTS page_copy jsonb
    `);
    done["2_개별문구_자리"] = "완료";
  } catch (e: any) {
    return json({ ok: false, step: "alter_teachers_pagecopy", 이미한것: done,
      detail: String(e?.message || e).slice(0, 500) }, 500);
  }

  return json({
    ok: true,
    mode: "실행",
    한일: done,
    확인: await diagnose(),
    다음: "메인 채팅에 이 응답을 붙여넣어 주세요 — 선생님 화면을 새로 올립니다",
  });
};
