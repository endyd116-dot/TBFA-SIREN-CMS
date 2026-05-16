/**
 * 1회용 마이그레이션 — 발송 작업에 이메일 첨부파일 컬럼 추가 (D2)
 *
 * communication_send_jobs.attachment_blob_ids (jsonb 배열)
 * 발송 디스패처가 이메일 채널일 때만 R2에서 첨부 파일 fetch → Resend attachments로 전달.
 * 카카오·SMS·MMS·인앱 채널에서는 무시.
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
      will_add: "attachment_blob_ids (jsonb, default '[]') — blob_uploads.id 참조 배열",
      note: "이메일 채널 전용. 카카오/SMS/MMS는 기존 image 처리(자동 압축). GET ?run=1 로 실행",
    }, null, 2), { status: 200, headers: JSON_HEADER });
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  try {
    await db.execute(sql`
      ALTER TABLE communication_send_jobs
        ADD COLUMN IF NOT EXISTS attachment_blob_ids JSONB NOT NULL DEFAULT '[]'::jsonb
    `);
    return new Response(JSON.stringify({
      ok: true,
      applied: [{ step: "alter_send_jobs", result: "ok" }],
      next_steps: [
        "1) 호출 결과 메인 채팅 전달",
        "2) 메인이 schema.ts에 attachmentBlobIds 정의 활성화 + 디스패처·UI 업데이트",
        "3) 마이그 파일 다음 push에 삭제",
      ],
    }, null, 2), { status: 200, headers: JSON_HEADER });
  } catch (e: any) {
    return new Response(JSON.stringify({
      ok: false, error: "ALTER 실패", detail: String(e?.message || e).slice(0, 300),
    }), { status: 500, headers: JSON_HEADER });
  }
};
