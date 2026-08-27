// netlify/functions/migrate-memorial-anon.ts
// ★ 2026-08-28 추모관 v2 — 로그인 없이도 한마디를 남길 수 있게 (1회용)
//
// 왜: 추모관에 온 분의 마음은 몇 초짜리다. 그 순간에 가입 절차를 요구하면
//     회원이 되는 게 아니라 그냥 떠난다. 마음을 남긴 다음에 가입을 권하는 편이
//     회원도 늘고 참여도 는다. (2026-08-28 Swain 결정)
//     또한 밤 화면은 '헌화 + 한마디'가 한 동작인데 헌화만 익명이 되고
//     한마디는 로그인을 요구해 반쪽으로 동작하고 있었다.
//
// 이 도구가 만드는 것 — 도배 방지에 쓸 자리 하나:
//   memorial_messages.ip_hash — 같은 기기가 짧은 시간에 여러 번 남기는 것을 막는다.
//   (개인을 알아보는 값이 아니라 되돌릴 수 없게 섞은 값이다. 헌화가 쓰는 방식과 같다.)
//
// 호출: https://tbfa.co.kr/api/migrate-memorial-anon?run=1  (어드민 로그인 상태)
//       ?run=1 없이 열면 진단만 한다 (인증 불필요)
// 호출 성공 후 이 파일은 삭제한다.

import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-memorial-anon" };

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
  try {
    const r = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'memorial_messages' AND column_name = 'ip_hash'
    `);
    return rowsOf(r).length > 0 ? "있음" : "없음";
  } catch (e: any) {
    return "확인 실패 — " + String(e?.message || e).slice(0, 120);
  }
}

export default async (req: Request) => {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  const before = await diagnose();

  if (!run) {
    return json({
      ok: true,
      mode: "진단",
      도배방지_자리: before,
      실행방법: "이 주소 뒤에 ?run=1 을 붙여 어드민 로그인 상태로 다시 여세요",
    });
  }

  const auth: any = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  try {
    await db.execute(sql`
      ALTER TABLE memorial_messages
      ADD COLUMN IF NOT EXISTS ip_hash varchar(64)
    `);
    /* 최근 N초 안에 같은 기기가 남긴 게 있는지 빠르게 찾기 위한 색인 */
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS memorial_messages_iphash_idx
      ON memorial_messages (ip_hash, created_at DESC)
    `);
  } catch (e: any) {
    return json({
      ok: false,
      step: "alter_messages_iphash",
      error: "도배 방지 자리 추가 실패",
      detail: String(e?.message || e).slice(0, 500),
    }, 500);
  }

  return json({
    ok: true,
    mode: "실행",
    한일: "도배 방지 자리(ip_hash) 추가 완료",
    확인: await diagnose(),
    다음: "메인 채팅에 이 응답을 붙여넣어 주세요 — 익명 참여를 열겠습니다",
  });
};
