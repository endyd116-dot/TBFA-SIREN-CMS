// netlify/functions/migrate-add-send-job-images.ts
// 1회용 마이그레이션 — communication_send_jobs에 images_override jsonb 추가.
// 발송 작업 만들기에서 템플릿 이미지를 그대로 쓰지 않고 임시로 수정·교체할
// 때 사용. NULL이면 템플릿의 images 그대로 사용.
//
// 호출:
//   진단: https://tbfa.co.kr/api/migrate-add-send-job-images
//   실행: https://tbfa.co.kr/api/migrate-add-send-job-images?run=1

import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-add-send-job-images" };

async function colExists(): Promise<boolean> {
  const res: any = await db.execute(sql`
    SELECT 1 AS ok FROM information_schema.columns
     WHERE table_name = 'communication_send_jobs'
       AND column_name = 'images_override'
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
        JSON.stringify({
          ok: true, mode: "diagnose", columnExists: exists,
          hint: exists ? "이미 존재(no-op)" : "?run=1로 ALTER TABLE 적용 필요",
        }),
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
      ALTER TABLE communication_send_jobs
        ADD COLUMN images_override jsonb
    `);
    return new Response(
      JSON.stringify({ ok: true, mode: "run", changed: true, message: "images_override 컬럼 추가 완료." }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false, error: "마이그레이션 실패",
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
