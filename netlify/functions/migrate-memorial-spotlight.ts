/**
 * GET /api/migrate-memorial-spotlight        — 진단 (인증 불필요·readonly)
 * GET /api/migrate-memorial-spotlight?run=1  — 실행 (어드민 인증)
 *
 * 추모관 "이달에 기억할 선생님" 코너를 위한 저장 공간.
 *   · memorial_spotlights  — 생일·기일처럼 특별한 날을 맞은 선생님 소개 항목
 *   · memorial_settings에 코너 제목·설명 2칸 추가 (문구도 운영자가 바꿀 수 있게)
 *
 * 이달 노출은 날짜의 '월'만 본다 — 해마다 다시 등록할 필요 없이 매년 그달에 자동으로 뜬다.
 *
 * 멱등: CREATE TABLE / ADD COLUMN IF NOT EXISTS. 호출 성공 후 이 파일 삭제 + commit.
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-memorial-spotlight" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

function rowsOf(result: any): any[] {
  if (!result) return [];
  return Array.isArray(result) ? result : (result.rows ?? []);
}

async function diagnose() {
  const tbl = rowsOf(await db.execute(sql.raw(`
    SELECT table_name FROM information_schema.tables
     WHERE table_schema='public' AND table_name='memorial_spotlights'
  `))).length > 0;

  const cols = rowsOf(await db.execute(sql.raw(`
    SELECT column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name='memorial_settings'
       AND column_name IN ('spotlight_title','spotlight_desc')
  `))).map((r: any) => r.column_name);

  const count = tbl
    ? Number(rowsOf(await db.execute(sql.raw(`SELECT COUNT(*)::int AS c FROM memorial_spotlights`)))[0]?.c || 0)
    : null;

  return { table_exists: tbl, settings_columns: cols, ready: tbl && cols.length === 2, item_count: count };
}

export default async function handler(req: Request, _ctx: Context) {
  let step = "start";
  try {
    const url = new URL(req.url);
    const run = url.searchParams.get("run") === "1";

    step = "diag";
    const before = await diagnose();

    if (!run) {
      return new Response(jsonKST({
        ok: true, mode: "diagnose", before,
        hint: before.ready ? "이미 적용됨. 재실행해도 안전." : "?run=1 로 실행하세요 (관리자 로그인 상태).",
      }, null, 2), { headers: JSON_HEADER });
    }

    step = "auth";
    const auth = await requireAdmin(req);
    if (guardFailed(auth)) return auth.res;

    step = "create_table";
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS memorial_spotlights (
        id             SERIAL PRIMARY KEY,
        teacher_id     INTEGER,
        display_name   VARCHAR(60) NOT NULL,
        occasion       VARCHAR(20) NOT NULL DEFAULT 'other',
        occasion_date  DATE,
        photo_blob_id  INTEGER,
        family_message TEXT,
        family_name    VARCHAR(60),
        is_active      BOOLEAN NOT NULL DEFAULT true,
        sort_order     INTEGER NOT NULL DEFAULT 0,
        created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `));
    await db.execute(sql.raw(
      `CREATE INDEX IF NOT EXISTS memorial_spotlights_active_idx ON memorial_spotlights (is_active, sort_order)`,
    ));
    /* 이달 노출은 '월'로 고르므로 월 기준 인덱스 */
    await db.execute(sql.raw(
      `CREATE INDEX IF NOT EXISTS memorial_spotlights_month_idx ON memorial_spotlights (EXTRACT(MONTH FROM occasion_date))`,
    ));

    step = "alter_settings";
    await db.execute(sql.raw(
      `ALTER TABLE memorial_settings ADD COLUMN IF NOT EXISTS spotlight_title VARCHAR(80)`,
    ));
    await db.execute(sql.raw(
      `ALTER TABLE memorial_settings ADD COLUMN IF NOT EXISTS spotlight_desc VARCHAR(200)`,
    ));

    step = "verify";
    const after = await diagnose();

    return new Response(jsonKST({
      ok: true, mode: "executed", before, after,
      next: [
        "1) 추모관 관리 → '이달의 기억' 탭에서 선생님·기념일·사진·가족 한마디 등록",
        "2) 등록한 날짜의 '월'이 이번 달이면 추모관 화면에 자동으로 뜬다(해마다 재등록 불필요)",
        "3) 성공 확인 후 메인에게 알림 → 이 파일 삭제",
      ],
    }, null, 2), { headers: JSON_HEADER });
  } catch (err: any) {
    return new Response(jsonKST({
      ok: false, error: "마이그 실패", step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: JSON_HEADER });
  }
}
