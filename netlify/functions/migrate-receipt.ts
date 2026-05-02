/**
 * STEP H-2a: 영수증 번호 컬럼 추가 (1회용 임시 마이그레이션)
 * 호출: GET /api/migrate-receipt?key=siren-h2a-2026
 *
 * ⚠️ 호출 성공 후 이 파일을 반드시 삭제하고 push 하세요!
 */
import postgres from "postgres";

export const config = { path: "/api/migrate-receipt" };

const SECRET_KEY = "siren-h2a-2026";

export default async (req: Request) => {
  try {
    const url = new URL(req.url);
    const key = url.searchParams.get("key");
    if (key !== SECRET_KEY) {
      return new Response(JSON.stringify({ ok: false, error: "Forbidden" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      });
    }

    const dbUrl = process.env.NETLIFY_DATABASE_URL;
    if (!dbUrl) {
      return new Response(JSON.stringify({ ok: false, error: "DB URL not configured" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }

    const sql = postgres(dbUrl, { ssl: "require", max: 1 });

    const log: string[] = [];

    try {
      /* 1) 컬럼 추가 (이미 존재하면 무시) */
      try {
        await sql`ALTER TABLE donations ADD COLUMN receipt_number VARCHAR(30)`;
        log.push("✅ Added column: donations.receipt_number");
      } catch (e: any) {
        if (String(e.message || "").includes("already exists")) {
          log.push("ℹ️ Column already exists: donations.receipt_number");
        } else {
          throw e;
        }
      }

      /* 2) UNIQUE 제약 추가 */
      try {
        await sql`ALTER TABLE donations ADD CONSTRAINT donations_receipt_number_unique UNIQUE (receipt_number)`;
        log.push("✅ Added UNIQUE constraint: donations_receipt_number_unique");
      } catch (e: any) {
        if (String(e.message || "").includes("already exists")) {
          log.push("ℹ️ UNIQUE constraint already exists");
        } else {
          log.push("⚠️ UNIQUE constraint skipped: " + e.message);
        }
      }

      /* 3) 인덱스 추가 */
      try {
        await sql`CREATE INDEX donations_receipt_no_idx ON donations(receipt_number)`;
        log.push("✅ Added index: donations_receipt_no_idx");
      } catch (e: any) {
        if (String(e.message || "").includes("already exists")) {
          log.push("ℹ️ Index already exists: donations_receipt_no_idx");
        } else {
          log.push("⚠️ Index creation skipped: " + e.message);
        }
      }

      /* 4) 검증 — 컬럼 존재 확인 */
      const cols = await sql`
        SELECT column_name, data_type, character_maximum_length
        FROM information_schema.columns
        WHERE table_name = 'donations' AND column_name = 'receipt_number'
      `;
      log.push(
        `🔍 Verification: ${cols.length > 0 ? "OK — column exists" : "FAIL — column missing"}`
      );
      if (cols.length > 0) {
        log.push(`   → type: ${(cols[0] as any).data_type}, length: ${(cols[0] as any).character_maximum_length}`);
      }

      await sql.end();

      return new Response(
        JSON.stringify(
          {
            ok: true,
            message: "마이그레이션 완료. 이제 이 파일을 삭제하세요!",
            log,
          },
          null,
          2
        ),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    } catch (e: any) {
      await sql.end().catch(() => {});
      return new Response(
        JSON.stringify({ ok: false, error: e.message, log }, null, 2),
        { status: 500, headers: { "content-type": "application/json" } }
      );
    }
  } catch (e: any) {
    return new Response(
      JSON.stringify({ ok: false, error: e?.message || "internal error" }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
};