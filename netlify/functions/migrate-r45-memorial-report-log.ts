/**
 * GET /api/migrate-r45-memorial-report-log        — 진단 (인증 불필요)
 * GET /api/migrate-r45-memorial-report-log?run=1  — 어드민 인증 후 실행
 *
 * ★ US-030: 추모 글 신고 1인 1회 멱등 처리용 memorial_report_logs 테이블 생성.
 *   - memorial-messages 의 report 액션이 INSERT ... ON CONFLICT(member_id,ref_table,ref_id) DO NOTHING
 *     으로 중복 신고를 막아 신고수 조작을 차단한다(테이블 없으면 degrade — 기존 동작).
 *   - 멱등(IF NOT EXISTS). 호출 성공 확인 후 이 파일은 삭제(1회용 보안 원칙·CLAUDE §6.8).
 */
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-r45-memorial-report-log" };

const JSON_HEADER = { "Content-Type": "application/json" };

export default async (req: Request) => {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  /* 진단 모드 (인증 불필요) — 테이블 존재 여부만 확인 */
  if (!run) {
    try {
      const r: any = await db.execute(sql`SELECT to_regclass('public.memorial_report_logs') AS t`);
      const exists = !!((r?.rows ?? r ?? [])[0]?.t);
      return new Response(JSON.stringify({
        ok: true, mode: "diagnostic", tableExists: exists,
        hint: "어드민 로그인 상태에서 ?run=1 로 실제 실행",
      }), { status: 200, headers: JSON_HEADER });
    } catch (e: any) {
      return new Response(JSON.stringify({ ok: false, error: String(e?.message || e).slice(0, 300) }), { status: 500, headers: JSON_HEADER });
    }
  }

  /* 실행 모드 — 어드민 인증 필요 */
  const auth: any = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS memorial_report_logs (
        id          serial PRIMARY KEY,
        member_id   integer NOT NULL,
        ref_table   varchar(40) NOT NULL,
        ref_id      integer NOT NULL,
        created_at  timestamp NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS memorial_report_logs_uniq
        ON memorial_report_logs (member_id, ref_table, ref_id)
    `);
    return new Response(JSON.stringify({ ok: true, message: "memorial_report_logs 생성 완료 (멱등) — US-030 신고 중복 방지 활성화" }), { status: 200, headers: JSON_HEADER });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e).slice(0, 300) }), { status: 500, headers: JSON_HEADER });
  }
};
