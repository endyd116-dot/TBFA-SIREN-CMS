/**
 * 1회용 마이그레이션 — org_news_reports.incidents 컬럼 추가
 *
 * GET /api/migrate-org-news-incidents         — 진단 (인증 불필요)
 * GET /api/migrate-org-news-incidents?run=1   — 실행 (super_admin 인증)
 *
 * 호출 성공 후 즉시 파일 삭제 + 커밋 (1회용 보안 원칙)
 */

import type { Context } from "@netlify/functions";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-org-news-incidents" };

export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "GET") {
    return Response.json({ ok: false, error: "GET 전용" }, { status: 405 });
  }

  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  /* 진단 모드 (인증 불필요) */
  if (!run) {
    let colExists = false;
    try {
      const r: any = await db.execute(sql`
        SELECT column_name
          FROM information_schema.columns
         WHERE table_name = 'org_news_reports'
           AND column_name = 'incidents'
      `);
      colExists = ((r?.rows ?? r ?? []).length > 0);
    } catch (err: any) {
      return Response.json({ ok: false, error: "진단 조회 오류", detail: String(err?.message || err).slice(0, 500) }, { status: 500 });
    }
    return Response.json({
      ok: true,
      mode: "diagnose",
      incidentsColumnExists: colExists,
      action: colExists ? "이미 존재 — 실행 불필요" : "?run=1 로 실행하면 컬럼 추가",
    });
  }

  /* 실행 모드 — super_admin 인증 */
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  const admin = auth.ctx?.member as any;
  if (admin?.role !== "super_admin") {
    return Response.json({ ok: false, error: "슈퍼어드민 전용" }, { status: 403 });
  }

  try {
    await db.execute(sql`
      ALTER TABLE org_news_reports
        ADD COLUMN IF NOT EXISTS incidents JSONB NOT NULL DEFAULT '[]'::jsonb
    `);
  } catch (err: any) {
    return Response.json({
      ok: false,
      error: "컬럼 추가 실패",
      detail: String(err?.message || err).slice(0, 500),
      stack:  String(err?.stack   || "").slice(0, 1000),
    }, { status: 500 });
  }

  return Response.json({
    ok: true,
    mode: "run",
    message: "incidents JSONB 컬럼 추가 완료. 이 파일을 즉시 삭제하세요.",
  });
}
