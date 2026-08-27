// netlify/functions/migrate-memorial-v2.ts
// ★ 2026-08-28 추모관 전면 개편(v2) — 1회용
//
// 추모관을 '밤 · 아침' 두 마음으로 새로 짓는다.
//   밤  = 먼저 떠나신 선생님들을 기억하는 자리
//   아침 = 남겨진 유가족을 지지하고 응원하는 자리
//
// 이 도구가 만드는 것 세 가지 (모두 있으면 건너뛴다 — 여러 번 눌러도 안전):
//   1. 방명록에 '어느 마음인지' 구분을 넣는다 (기존 글은 전부 '추모'로 남는다)
//   2. 유가족 근황 소식을 담을 자리를 만든다 (운영자가 어드민에서 등록)
//   3. 밤·아침 화면 문구를 운영자가 고칠 수 있도록 설정 자리를 넓힌다
//
// 호출: https://tbfa.co.kr/api/migrate-memorial-v2?run=1  (어드민 로그인 상태)
//       ?run=1 없이 열면 진단만 한다 (인증 불필요)
// 호출 성공 후 이 파일은 삭제한다.

import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-memorial-v2" };

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

/** db.execute 결과에서 행을 안전하게 꺼낸다 (드라이버마다 모양이 다르다) */
function rowsOf(res: any): any[] {
  return (res?.rows ?? res ?? []) as any[];
}

/** 지금 상태를 살펴본다 — 무엇이 이미 있고 무엇이 없는지 */
async function diagnose() {
  const out: Record<string, any> = {};

  try {
    const r = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'memorial_messages' AND column_name = 'kind'
    `);
    out["방명록_구분컬럼"] = rowsOf(r).length > 0 ? "있음" : "없음";
  } catch (e: any) {
    out["방명록_구분컬럼"] = "확인 실패 — " + String(e?.message || e).slice(0, 120);
  }

  try {
    const r = await db.execute(sql`
      SELECT to_regclass('public.memorial_family_notes') AS t
    `);
    out["유가족_근황_자리"] = rowsOf(r)[0]?.t ? "있음" : "없음";
  } catch (e: any) {
    out["유가족_근황_자리"] = "확인 실패 — " + String(e?.message || e).slice(0, 120);
  }

  try {
    const r = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'memorial_settings' AND column_name = 'hall_copy'
    `);
    out["밤아침_문구설정"] = rowsOf(r).length > 0 ? "있음" : "없음";
  } catch (e: any) {
    out["밤아침_문구설정"] = "확인 실패 — " + String(e?.message || e).slice(0, 120);
  }

  return out;
}

export default async (req: Request) => {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  /* ---------- 진단 (인증 불필요) ---------- */
  const before = await diagnose();

  if (!run) {
    return json({
      ok: true,
      mode: "진단",
      현재상태: before,
      실행방법: "이 주소 뒤에 ?run=1 을 붙여 어드민 로그인 상태로 다시 여세요",
    });
  }

  /* ---------- 실행 (어드민 인증) ---------- */
  const auth: any = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  const done: Record<string, string> = {};

  /* 1) 방명록에 '어느 마음인지' 구분 넣기
        tribute = 선생님을 향한 추모 / support = 유가족을 향한 응원
        기존 글은 전부 tribute 가 된다(기본값). */
  try {
    await db.execute(sql`
      ALTER TABLE memorial_messages
      ADD COLUMN IF NOT EXISTS kind varchar(16) NOT NULL DEFAULT 'tribute'
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS memorial_messages_kind_idx
      ON memorial_messages (kind, is_hidden, created_at DESC)
    `);
    done["1_방명록_구분"] = "완료 (기존 글은 모두 '추모'로 유지)";
  } catch (e: any) {
    return json({ ok: false, step: "alter_messages_kind", 이미한것: done,
      detail: String(e?.message || e).slice(0, 500) }, 500);
  }

  /* 2) 유가족 근황 소식 자리 만들기 — '우린 요즘 이렇게 지냅니다'
        운영자가 어드민에서 등록한다. 유가족 신원 보호를 위해 실명 대신
        표기용 이름(author_label)만 쓴다. */
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS memorial_family_notes (
        id            serial PRIMARY KEY,
        title         varchar(150) NOT NULL,
        content       text NOT NULL,
        photo_blob_id integer,
        author_label  varchar(60),
        mood          varchar(16) NOT NULL DEFAULT 'calm',
        is_public     boolean NOT NULL DEFAULT true,
        sort_order    integer NOT NULL DEFAULT 0,
        published_at  timestamp DEFAULT now(),
        created_by    integer,
        created_at    timestamp NOT NULL DEFAULT now(),
        updated_at    timestamp NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS memorial_family_notes_pub_idx
      ON memorial_family_notes (is_public, sort_order, published_at DESC)
    `);
    done["2_유가족_근황_자리"] = "완료";
  } catch (e: any) {
    return json({ ok: false, step: "create_family_notes", 이미한것: done,
      detail: String(e?.message || e).slice(0, 500) }, 500);
  }

  /* 3) 밤·아침 화면 문구를 운영자가 고칠 수 있게 자리 넓히기 */
  try {
    await db.execute(sql`
      ALTER TABLE memorial_settings
      ADD COLUMN IF NOT EXISTS hall_copy jsonb
    `);
    done["3_밤아침_문구설정"] = "완료";
  } catch (e: any) {
    return json({ ok: false, step: "alter_settings_hallcopy", 이미한것: done,
      detail: String(e?.message || e).slice(0, 500) }, 500);
  }

  const after = await diagnose();

  return json({
    ok: true,
    mode: "실행",
    한일: done,
    확인: after,
    다음: "메인 채팅에 이 응답을 그대로 붙여넣어 주세요 — 새 추모관 화면을 올립니다",
  });
};
