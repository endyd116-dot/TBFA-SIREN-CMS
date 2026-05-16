// netlify/functions/migrate-add-template-siren-layout.ts
// 1회용 마이그레이션 — communication_templates에 use_siren_layout boolean 추가
//
// 호출:
//   진단: https://tbfa.co.kr/api/migrate-add-template-siren-layout
//   실행: https://tbfa.co.kr/api/migrate-add-template-siren-layout?run=1

import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-add-template-siren-layout" };

async function colExists(): Promise<boolean> {
  const res: any = await db.execute(sql`
    SELECT 1 AS ok FROM information_schema.columns
     WHERE table_name = 'communication_templates'
       AND column_name = 'use_siren_layout'
     LIMIT 1
  `);
  return ((res?.rows ?? res ?? [])[0] || {}).ok === 1;
}

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";
  try {
    const exists = await colExists();
    if (!run) {
      return new Response(
        JSON.stringify({ ok: true, mode: "diagnose", columnExists: exists,
          hint: exists ? "이미 존재(no-op)" : "?run=1로 ALTER TABLE 적용 필요" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    const auth = await requireAdmin(req);
    if (!auth.ok) return (auth as { ok: false; res: Response }).res;
    if (exists) {
      return new Response(
        JSON.stringify({ ok: true, mode: "run", changed: false, message: "이미 존재(no-op)." }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    await db.execute(sql`
      ALTER TABLE communication_templates
        ADD COLUMN use_siren_layout boolean NOT NULL DEFAULT false
    `);
    return new Response(
      JSON.stringify({ ok: true, mode: "run", changed: true, message: "use_siren_layout 컬럼 추가 완료." }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ ok: false, error: "마이그레이션 실패",
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
