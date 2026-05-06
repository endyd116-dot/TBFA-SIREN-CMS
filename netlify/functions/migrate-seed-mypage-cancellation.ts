// netlify/functions/migrate-seed-mypage-cancellation.ts
// ★ 1회용 시드 — 마이페이지 정기후원 해지 안내 (5키)
// 호출: /.netlify/functions/migrate-seed-mypage-cancellation?key=siren-2026-mypage-cancel
// 호출 후 즉시 파일 삭제 + git push (보안)

import { db } from "../../db";
import { sql } from "drizzle-orm";

const SEED_KEY = "siren-2026-mypage-cancel";

const SEEDS = [
  {
    key: "mypage.cancellationGuide.modalTitle",
    value:
      "🎗 정기 후원 해지 안내",
    description: "정기후원 해지 안내 모달의 상단 제목",
    sortOrder: 1,
  },
  {
    key: "mypage.cancellationGuide.greeting",
    value:
      "그동안 따뜻한 마음으로 함께해 주셔서 진심으로 감사드립니다.\n\n" +
      "회원님의 정기 후원은 교사 유가족분들께 실질적인 도움이 되어왔으며, " +
      "교권 회복을 위한 여러 사업의 든든한 기반이 되어주셨습니다.",
    description: "모달 첫 영역 — 감사 인사",
    sortOrder: 2,
  },
  {
    key: "mypage.cancellationGuide.procedure",
    value:
      "▶ 해지 절차 (간단 3단계)\n\n" +
      "1) 마이페이지 → 내 후원 내역 → 정기 후원 카드의 \"🛑 정기 후원 해지\" 버튼 클릭\n" +
      "2) 해지 사유 입력 (선택 — 협회 개선에 활용됩니다)\n" +
      "3) 확인 버튼 클릭으로 완료",
    description: "모달 두 번째 영역 — 해지 절차",
    sortOrder: 3,
  },
  {
    key: "mypage.cancellationGuide.warnings",
    value:
      "▶ 해지 시 안내사항\n\n" +
      "• 해지 즉시 다음 결제일부터 자동 청구가 중단됩니다\n" +
      "• 이미 처리된 결제분은 영향을 받지 않습니다\n" +
      "• 기부금 영수증은 해지 이후에도 마이페이지에서 발급 가능합니다\n" +
      "• 다시 정기 후원을 시작하시려면 새로 카드 등록이 필요합니다\n" +
      "• 효성 CMS+ 정기 후원의 경우, 효성 측에서 별도 해지 처리가 필요할 수 있습니다",
    description: "모달 세 번째 영역 — 주의사항",
    sortOrder: 4,
  },
  {
    key: "mypage.cancellationGuide.contactInfo",
    value:
      "▶ 도움이 필요하신가요?\n\n" +
      "해지 절차 중 어려움이 있으시거나 일시 중단·금액 변경 등 다른 옵션을 원하시면 언제든 문의해 주세요.\n\n" +
      "• 1:1 상담: 마이페이지 → 💬 1:1 상담\n" +
      "• 이메일: 협회 대표 이메일로 문의",
    description: "모달 네 번째 영역 — 문의처 안내",
    sortOrder: 5,
  },
];

export default async (req: Request) => {
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  const dryRun = url.searchParams.get("dryRun") === "1";
  if (key !== SEED_KEY) {
    return new Response(JSON.stringify({ ok: false, error: "invalid key" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    /* 1. 실제 컬럼 감지 (Phase B Step 6-A v3 성공 패턴) */
    const colRes: any = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'site_settings'
    `);
    const cols = Array.isArray(colRes) ? colRes : (colRes?.rows || []);
    const colNames: string[] = cols.map((c: any) => c.column_name);
    const has = (n: string) => colNames.includes(n);

    if (dryRun) {
      return new Response(
        JSON.stringify({ ok: true, dryRun: true, columns: colNames, seedCount: SEEDS.length }, null, 2),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    /* 2. 기존 시드 존재 여부 확인 (멱등성) */
    const existing: any = await db.execute(sql`
      SELECT key FROM site_settings WHERE key LIKE 'mypage.cancellationGuide.%'
    `);
    const existingRows = Array.isArray(existing) ? existing : (existing?.rows || []);
    const existingKeys = new Set(existingRows.map((r: any) => r.key));

    const inserted: string[] = [];
    const skipped: string[] = [];

    for (const item of SEEDS) {
      if (existingKeys.has(item.key)) {
        skipped.push(item.key);
        continue;
      }

      /* 3. 동적 INSERT 빌드 — 존재하는 컬럼만 사용 */
      const insertCols: string[] = [];
      const insertVals: any[] = [];

      if (has("scope")) { insertCols.push("scope"); insertVals.push("mypage"); }
      if (has("key")) { insertCols.push("key"); insertVals.push(item.key); }
      if (has("value_type")) { insertCols.push("value_type"); insertVals.push("text"); }
      if (has("value_text")) { insertCols.push("value_text"); insertVals.push(item.value); }
      if (has("description")) { insertCols.push("description"); insertVals.push(item.description); }
      if (has("sort_order")) { insertCols.push("sort_order"); insertVals.push(item.sortOrder); }
      if (has("is_active")) { insertCols.push("is_active"); insertVals.push(true); }
      if (has("has_draft")) { insertCols.push("has_draft"); insertVals.push(false); }

      const colsSql = sql.raw(insertCols.join(", "));
      const valsSql = sql.join(insertVals.map((v) => sql`${v}`), sql`, `);
      await db.execute(sql`INSERT INTO site_settings (${colsSql}) VALUES (${valsSql})`);
      inserted.push(item.key);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        message: "시드 완료",
        inserted,
        skipped,
        total: SEEDS.length,
        columnsUsed: colNames.filter((c) =>
          ["scope", "key", "value_type", "value_text", "description", "sort_order", "is_active", "has_draft"].includes(c)
        ),
      }, null, 2),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("[migrate-seed-mypage-cancellation]", e);
    return new Response(
      JSON.stringify({ ok: false, error: e.message, stack: e.stack }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
};

export const config = { path: "/migrate-seed-mypage-cancellation" };