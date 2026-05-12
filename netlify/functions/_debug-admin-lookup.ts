/**
 * 1회용 진단 — DB에서 admin 후보 계정 lookup.
 * 호출: GET /api/_debug-admin-lookup?id=admin
 * 호출 후 즉시 파일 삭제.
 */
import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";

export const config = { path: "/api/_debug-admin-lookup" };

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  const raw = (url.searchParams.get("id") || "").trim().toLowerCase();
  if (!raw) {
    return new Response(JSON.stringify({ ok: false, error: "id 쿼리 필요 (예: ?id=admin)" }),
      { status: 400, headers: { "Content-Type": "application/json; charset=utf-8" } });
  }

  const ADMIN_EMAIL_DOMAIN = process.env.ADMIN_EMAIL_DOMAIN || "siren-org.kr";
  const candidate = raw.includes("@") ? raw : `${raw}@${ADMIN_EMAIL_DOMAIN}`;

  /* 입력 그대로 lookup */
  const r1: any = await db.execute(sql`
    SELECT id, email, name, type, status FROM members WHERE email = ${raw} LIMIT 1
  `);
  const row1 = (r1?.rows ?? r1 ?? [])[0] || null;

  /* 자동 매핑 lookup */
  const r2: any = await db.execute(sql`
    SELECT id, email, name, type, status FROM members WHERE email = ${candidate} LIMIT 1
  `);
  const row2 = (r2?.rows ?? r2 ?? [])[0] || null;

  /* admin type인 모든 계정 (이메일만 노출, 비밀번호 안 보임) */
  const r3: any = await db.execute(sql`
    SELECT id, email, name, type, status FROM members WHERE type = 'admin' ORDER BY id LIMIT 10
  `);
  const allAdmins = r3?.rows ?? r3 ?? [];

  return new Response(JSON.stringify({
    ok: true,
    inputId: raw,
    candidateEmail: candidate,
    lookupExact: row1 ? { id: row1.id, email: row1.email, type: row1.type, status: row1.status } : null,
    lookupMapped: row2 ? { id: row2.id, email: row2.email, type: row2.type, status: row2.status } : null,
    allAdminAccounts: allAdmins.map((u: any) => ({ id: u.id, email: u.email, name: u.name, status: u.status })),
    note: "이 진단 함수는 1회용. 결과 확인 후 즉시 삭제 예정.",
  }, null, 2), { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } });
};
