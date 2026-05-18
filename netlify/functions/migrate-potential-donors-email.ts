/**
 * GET /api/migrate-potential-donors-email
 * potential_donors 테이블에 email 컬럼 추가
 * GET         : 진단 (인증 불필요)
 * GET ?run=1  : 어드민 인증 후 실행
 */
import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-potential-donors-email" };

export default async function handler(req: Request, _ctx: Context) {
  const url = new URL(req.url);

  if (url.searchParams.get("run") !== "1") {
    return Response.json({
      ok: true,
      mode: "diagnosis",
      message: "?run=1 을 붙여서 어드민 로그인 후 호출하면 email 컬럼을 추가합니다.",
    });
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  const steps: string[] = [];
  try {
    await db.execute(sql`
      ALTER TABLE potential_donors
      ADD COLUMN IF NOT EXISTS email VARCHAR(200)
    `);
    steps.push("email VARCHAR(200) 컬럼 추가 완료");

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS potential_donors_email_idx ON potential_donors(email)
    `);
    steps.push("email 인덱스 생성 완료");

    return Response.json({ ok: true, steps });
  } catch (err: any) {
    return Response.json({
      ok: false,
      error: "마이그레이션 실패",
      detail: String(err?.message || err).slice(0, 500),
    }, { status: 500 });
  }
}
