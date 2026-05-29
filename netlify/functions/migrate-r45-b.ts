/**
 * 1회용 마이그레이션 — R45-B 스키마 (OP-045 + OP-075)
 *
 * 호출: 어드민 로그인 상태에서 주소창에
 *   https://tbfa.co.kr/api/migrate-r45-b?run=1   (실행 — requireAdmin)
 *   https://tbfa.co.kr/api/migrate-r45-b          (진단 — 인증 불필요)
 *
 * 적용 내용 (멱등):
 *   - OP-045: member_status enum에 'rejected' 추가
 *       → 가입 심사 '반려'를 'suspended'(제재/블랙과 동일)가 아닌 전용 상태로 구분.
 *   - OP-075: 콘텐츠 5개 테이블에 deleted_at 컬럼 추가 (soft-delete 기반)
 *       → notices·faqs·media_posts·activity_posts·content_pages 실수 삭제 복구 가능.
 *
 * ★ 본 마이그 적용 확인 후에야 schema.ts 정의 + 코드(반려 상태 'rejected' 적용,
 *   DELETE→soft-delete + 목록 필터) 활성화 가능(§6.7 — DB 적용 전 schema 컬럼 추가 금지).
 *   적용 성공 후 메인에 알림 → 코드 활성화 → 본 파일 삭제.
 */
import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-r45-b" };

const CONTENT_TABLES = ["notices", "faqs", "media_posts", "activity_posts", "content_pages"];

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  /* ───── 진단 모드 (인증 불필요) ───── */
  if (!run) {
    try {
      const enumRows: any = await db.execute(sql`
        SELECT e.enumlabel AS label
        FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
        WHERE t.typname = 'member_status' ORDER BY e.enumsortorder
      `);
      const labels = (enumRows.rows ?? enumRows ?? []).map((r: any) => r.label);
      const colRows: any = await db.execute(sql`
        SELECT table_name FROM information_schema.columns
        WHERE column_name = 'deleted_at' AND table_name = ANY(${CONTENT_TABLES})
      `);
      const tablesWithCol = (colRows.rows ?? colRows ?? []).map((r: any) => r.table_name);
      return json({
        ok: true,
        mode: "diagnostic",
        memberStatusValues: labels,
        rejectedPresent: labels.includes("rejected"),
        contentTablesWithDeletedAt: tablesWithCol,
        pending: {
          addRejected: !labels.includes("rejected"),
          addDeletedAt: CONTENT_TABLES.filter((t) => !tablesWithCol.includes(t)),
        },
      });
    } catch (err: any) {
      return json({ ok: false, mode: "diagnostic", error: err?.message || String(err) }, 500);
    }
  }

  /* ───── 실행 모드 (어드민 인증) ───── */
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  const applied: string[] = [];
  try {
    /* OP-045: member_status enum에 'rejected' 추가 (트랜잭션 밖 단일 문 — ADD VALUE 제약 회피) */
    await db.execute(sql`ALTER TYPE "member_status" ADD VALUE IF NOT EXISTS 'rejected'`);
    applied.push("member_status += 'rejected'");

    /* OP-075: 콘텐츠 테이블 soft-delete 컬럼 (IF NOT EXISTS — 멱등) */
    for (const t of CONTENT_TABLES) {
      await db.execute(sql.raw(`ALTER TABLE "${t}" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp`));
      applied.push(`${t}.deleted_at`);
    }

    return json({ ok: true, mode: "applied", applied });
  } catch (err: any) {
    return json({ ok: false, mode: "applied", applied, error: err?.message || String(err) }, 500);
  }
};
