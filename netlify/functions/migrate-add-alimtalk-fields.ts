// netlify/functions/migrate-add-alimtalk-fields.ts
// 1회용 마이그레이션 — communication_templates에 카카오 알림톡 전용 필드 3종 추가
//
// 추가 컬럼:
//   alimtalk_template_code  varchar(50)  — 알리고 콘솔의 tpl_code (UH_XXXX)
//   alimtalk_review_status  text         — 'approved' | 'pending' | 'rejected' | null
//   alimtalk_button_json    jsonb        — 알리고 button_1 JSON (웹링크·전화 등)
//
// 호출:
//   진단: https://tbfa.co.kr/api/migrate-add-alimtalk-fields
//   실행: https://tbfa.co.kr/api/migrate-add-alimtalk-fields?run=1 (어드민 로그인 후 주소창)

import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-add-alimtalk-fields" };

async function colExists(colName: string): Promise<boolean> {
  const res: any = await db.execute(sql`
    SELECT 1 AS ok FROM information_schema.columns
     WHERE table_name = 'communication_templates'
       AND column_name = ${colName}
     LIMIT 1
  `);
  return ((res?.rows ?? res ?? [])[0] || {}).ok === 1;
}

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  try {
    const has1 = await colExists("alimtalk_template_code");
    const has2 = await colExists("alimtalk_review_status");
    const has3 = await colExists("alimtalk_button_json");

    if (!run) {
      return new Response(
        JSON.stringify({
          ok: true,
          mode: "diagnose",
          columns: {
            alimtalk_template_code: has1,
            alimtalk_review_status: has2,
            alimtalk_button_json: has3,
          },
          hint: (has1 && has2 && has3)
            ? "모든 컬럼이 이미 존재합니다(no-op)."
            : "?run=1 호출 시 누락된 컬럼만 ALTER TABLE 적용.",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    const auth = await requireAdmin(req);
    if (!auth.ok) return (auth as { ok: false; res: Response }).res;

    const applied: string[] = [];
    if (!has1) {
      await db.execute(sql`
        ALTER TABLE communication_templates
          ADD COLUMN alimtalk_template_code varchar(50)
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS comm_templates_alimtalk_code_idx
          ON communication_templates(alimtalk_template_code)
      `);
      applied.push("alimtalk_template_code");
    }
    if (!has2) {
      await db.execute(sql`
        ALTER TABLE communication_templates
          ADD COLUMN alimtalk_review_status text
      `);
      applied.push("alimtalk_review_status");
    }
    if (!has3) {
      await db.execute(sql`
        ALTER TABLE communication_templates
          ADD COLUMN alimtalk_button_json jsonb
      `);
      applied.push("alimtalk_button_json");
    }

    return new Response(
      JSON.stringify({
        ok: true,
        mode: "run",
        changed: applied.length > 0,
        applied,
        message: applied.length
          ? `${applied.join(", ")} 컬럼 추가 완료.`
          : "모든 컬럼이 이미 존재합니다(no-op).",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "마이그레이션 실패",
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
