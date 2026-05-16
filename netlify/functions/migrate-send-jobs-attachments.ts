/**
 * 1회용 마이그레이션 — 발송 작업에 이메일 전용 컬럼 2개 추가
 *
 * 1) attachment_blob_ids (jsonb 배열) — 이메일 첨부 (blob_uploads.id 배열)
 *    카카오/SMS/MMS는 기존 image 흐름. 이메일에만 적용.
 *
 * 2) wrap_email_with_layout (boolean) — "메일 웹 감싸기" 옵션
 *    체크 시 디스패처가 이메일 본문을 lib/email.ts baseLayout()으로 wrap.
 *    템플릿 단위(communication_templates.use_siren_layout)와 별개로 발송 단위
 *    토글. SMS/카카오/인앱은 본문 그대로.
 *
 * GET            : 진단
 * GET ?run=1     : 어드민 인증 후 실행 (멱등 — IF NOT EXISTS)
 */

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-send-jobs-attachments" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  if (req.method === "GET" && !url.searchParams.get("run")) {
    return new Response(JSON.stringify({
      ok: true, mode: "diagnostic",
      will_alter: "communication_send_jobs",
      will_add: [
        "attachment_blob_ids (jsonb, default '[]') — 이메일 첨부 (blob_uploads.id 배열)",
        "wrap_email_with_layout (boolean, default false) — 메일 웹 감싸기 옵션",
      ],
      note: "두 컬럼 모두 이메일 채널 전용. SMS/카카오/MMS는 기존 흐름 그대로. GET ?run=1 로 실행",
    }, null, 2), { status: 200, headers: JSON_HEADER });
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  const results: { step: string; result: string }[] = [];
  async function run(step: string, fn: () => Promise<void>) {
    try { await fn(); results.push({ step, result: "ok" }); }
    catch (e: any) { results.push({ step, result: `error: ${String(e?.message || e).slice(0, 300)}` }); }
  }

  await run("alter_attachment", async () => {
    await db.execute(sql`
      ALTER TABLE communication_send_jobs
        ADD COLUMN IF NOT EXISTS attachment_blob_ids JSONB NOT NULL DEFAULT '[]'::jsonb
    `);
  });
  await run("alter_wrap_email", async () => {
    await db.execute(sql`
      ALTER TABLE communication_send_jobs
        ADD COLUMN IF NOT EXISTS wrap_email_with_layout BOOLEAN NOT NULL DEFAULT FALSE
    `);
  });

  const ok = results.every(r => r.result === "ok");
  return new Response(JSON.stringify({
    ok, applied: results,
    next_steps: ok ? [
      "1) 호출 결과 메인 채팅 전달",
      "2) 메인이 schema.ts에 attachmentBlobIds·wrapEmailWithLayout 정의 활성화 + 디스패처·UI 업데이트",
      "3) 마이그 파일 다음 push에 삭제",
    ] : ["오류 항목 보고"],
  }, null, 2), { status: ok ? 200 : 500, headers: JSON_HEADER });
};
