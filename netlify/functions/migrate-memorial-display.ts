/**
 * GET /api/migrate-memorial-display        — 진단 (인증 불필요·readonly)
 * GET /api/migrate-memorial-display?run=1  — 실행 (어드민 인증)
 *
 * 추모관 표시 설정 3가지를 편집 가능하게 만든다.
 *   · bio_label            '약력' 자리에 쓸 문구 (협의회에서 이 단어를 쓰지 않으려 함)
 *   · timeline_label       '기억의 발자취' 자리에 쓸 문구
 *   · show_teacher_offering  선생님 개별 페이지의 헌화 영역 표시 여부
 *       추모관 첫 화면에서 이미 헌화를 할 수 있어 선생님마다 또 두면 중복이고,
 *       각 선생님 이야기에 집중하기 어렵다는 판단.
 *
 * 멱등: ADD COLUMN IF NOT EXISTS. 몇 번 호출해도 안전하다.
 * 호출 성공 후 이 파일 삭제 + commit.
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-memorial-display" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

function rowsOf(result: any): any[] {
  if (!result) return [];
  return Array.isArray(result) ? result : (result.rows ?? []);
}

async function diagnose() {
  const cols = rowsOf(await db.execute(sql.raw(`
    SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'memorial_settings'
       AND column_name IN ('bio_label', 'timeline_label', 'show_teacher_offering')
  `))).map((r: any) => r.column_name);

  let current: any = null;
  if (cols.length === 3) {
    current = rowsOf(await db.execute(sql.raw(`
      SELECT bio_label, timeline_label, show_teacher_offering
        FROM memorial_settings ORDER BY id DESC LIMIT 1
    `)))[0] || null;
  }

  return { columns: cols, ready: cols.length === 3, current };
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
        will_add: ["bio_label (기본 '약력')", "timeline_label (기본 '기억의 발자취')", "show_teacher_offering (기본 표시함)"],
        hint: before.ready ? "이미 적용됨. 재실행해도 안전." : "?run=1 로 실행하세요 (관리자 로그인 상태).",
      }, null, 2), { headers: JSON_HEADER });
    }

    step = "auth";
    const auth = await requireAdmin(req);
    if (guardFailed(auth)) return auth.res;

    step = "alter";
    await db.execute(sql.raw(
      `ALTER TABLE memorial_settings ADD COLUMN IF NOT EXISTS bio_label VARCHAR(50)`,
    ));
    await db.execute(sql.raw(
      `ALTER TABLE memorial_settings ADD COLUMN IF NOT EXISTS timeline_label VARCHAR(50)`,
    ));
    await db.execute(sql.raw(
      `ALTER TABLE memorial_settings ADD COLUMN IF NOT EXISTS show_teacher_offering BOOLEAN NOT NULL DEFAULT true`,
    ));

    step = "verify";
    const after = await diagnose();

    return new Response(jsonKST({
      ok: true, mode: "executed", before, after,
      next: [
        "1) 추모관 관리 → 추모관 운영에서 '약력'·'기억의 발자취' 문구를 원하는 말로 바꾸기",
        "2) 같은 화면에서 '선생님 페이지에 헌화 표시'를 꺼서 개별 헌화 숨기기",
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
