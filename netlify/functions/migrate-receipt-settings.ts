/**
 * STEP H-2d-1: 영수증 설정 테이블 생성 (1회용 임시 마이그레이션)
 * 호출: GET /api/migrate-receipt-settings?key=siren-h2d-2026
 *
 * ⚠️ 호출 성공 후 이 파일을 반드시 삭제하고 push 하세요!
 *
 * 동작:
 *   - receipt_settings 테이블 생성
 *   - id=1 행을 환경변수 또는 샘플값으로 자동 시딩
 */
import postgres from "postgres";

export const config = { path: "/api/migrate-receipt-settings" };

const SECRET_KEY = "siren-h2d-2026";

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
      /* 1) 테이블 생성 */
      try {
        await sql`
          CREATE TABLE IF NOT EXISTS receipt_settings (
            id SERIAL PRIMARY KEY,
            org_name VARCHAR(100),
            org_registration_no VARCHAR(50),
            org_representative VARCHAR(50),
            org_address VARCHAR(255),
            org_phone VARCHAR(50),
            title VARCHAR(100),
            subtitle VARCHAR(200),
            proof_text VARCHAR(200),
            donation_type_label VARCHAR(50),
            footer_notes TEXT,
            updated_at TIMESTAMP DEFAULT NOW() NOT NULL,
            updated_by INTEGER REFERENCES members(id) ON DELETE SET NULL
          )
        `;
        log.push("✅ Created table: receipt_settings");
      } catch (e: any) {
        if (String(e.message || "").includes("already exists")) {
          log.push("ℹ️ Table already exists: receipt_settings");
        } else {
          throw e;
        }
      }

      /* 2) 기본 데이터 시딩 (id=1 행이 없으면 INSERT) */
      const existing = await sql`SELECT id FROM receipt_settings WHERE id = 1`;
      if (existing.length === 0) {
        const orgName = process.env.ORG_NAME || "(샘플) 교사유가족협의회";
        const orgRegNo = process.env.ORG_REGISTRATION_NO || "000-00-00000";
        const orgRep = process.env.ORG_REPRESENTATIVE || "○○○";
        const orgAddr = process.env.ORG_ADDRESS || "(샘플) 서울특별시 ○○구 ○○로 ○○";
        const orgPhone = process.env.ORG_PHONE || "(샘플) 02-0000-0000";

        const defaultFooter = JSON.stringify([
          "• 본 영수증은 「소득세법」 제34조 및 「법인세법」 제24조에 따른 기부금 영수증입니다.",
          "• 본 영수증은 발급기관에서 전자 발급되었으며, 영수증 번호로 진위를 확인할 수 있습니다.",
          `• 문의: ${orgPhone} / ${orgName}`,
        ]);

        await sql`
          INSERT INTO receipt_settings (
            id, org_name, org_registration_no, org_representative, org_address, org_phone,
            title, subtitle, proof_text, donation_type_label, footer_notes
          ) VALUES (
            1,
            ${orgName},
            ${orgRegNo},
            ${orgRep},
            ${orgAddr},
            ${orgPhone},
            ${"기 부 금  영 수 증"},
            ${"(소득세법 시행규칙 별지 제45호의2 서식)"},
            ${"위와 같이 기부금을 기부하였음을 증명합니다."},
            ${"지정기부금"},
            ${defaultFooter}
          )
        `;
        log.push("✅ Seeded default row (id=1) with environment variables");
      } else {
        log.push("ℹ️ Default row (id=1) already exists — skipped seeding");
      }

      /* 3) 검증 — 테이블 + 행 존재 확인 */
      const cols = await sql`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'receipt_settings'
        ORDER BY ordinal_position
      `;
      log.push(`🔍 Verification: ${cols.length} columns found`);

      const row = await sql`SELECT id, org_name, title, updated_at FROM receipt_settings WHERE id = 1`;
      if (row.length > 0) {
        log.push(`🔍 Default row OK: org_name="${(row[0] as any).org_name}", title="${(row[0] as any).title}"`);
      } else {
        log.push("⚠️ Default row missing!");
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