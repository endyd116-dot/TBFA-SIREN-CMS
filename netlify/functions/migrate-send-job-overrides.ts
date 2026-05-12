/**
 * 1회용 마이그레이션 — communication_send_jobs 테이블에 임시 수정 본문/제목 컬럼 추가
 *  - subject_override TEXT NULL
 *  - body_override    TEXT NULL
 *
 * 발송 작업 등록 시 사용자가 미리보기 영역에서 제목·본문을 임시 수정한 경우
 * 그 내용을 저장하기 위함. 템플릿 원본은 변경되지 않음.
 *
 * GET ?run=1 : 어드민 인증 후 실행
 * GET 만     : 진단 모드 (인증 불필요)
 *
 * 호출 후 즉시 파일 삭제 + 커밋.
 */

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-send-job-overrides" };

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  if (req.method === "GET" && !url.searchParams.get("run")) {
    return new Response(JSON.stringify({
      ok: true, mode: "diagnostic",
      description: "GET ?run=1 로 실행 (어드민 로그인 필요)",
      adds: ["communication_send_jobs.subject_override TEXT NULL",
             "communication_send_jobs.body_override TEXT NULL"],
    }), { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } });
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  const results: { step: string; result: string }[] = [];

  async function run(step: string, ddl: string) {
    try {
      await db.execute(sql.raw(ddl));
      results.push({ step, result: "ok" });
    } catch (e: any) {
      results.push({ step, result: String(e?.message).slice(0, 200) });
    }
  }

  await run("subject_override", "ALTER TABLE communication_send_jobs ADD COLUMN IF NOT EXISTS subject_override TEXT");
  await run("body_override",    "ALTER TABLE communication_send_jobs ADD COLUMN IF NOT EXISTS body_override TEXT");

  return new Response(
    JSON.stringify({ ok: true, results }),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } }
  );
};
