// netlify/functions/migrate-seed-mypage-cancel.ts
// 1회용 시드 — 마이페이지 정기후원 해지 안내 5키 (site_settings)
//
// 사용:
//   GET /api/migrate-seed-mypage-cancel        : 진단 (인증 불필요)
//   GET /api/migrate-seed-mypage-cancel?run=1  : 어드민 인증 후 실제 시드 실행
//
// 멱등 보장: 이미 존재하는 key는 SKIP, 누락 key만 INSERT.
// 호출 후 즉시 파일 삭제 + 커밋.

import { db } from "../../db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";

const SEEDS = [
  {
    key: "mypage.cancellationGuide.modalTitle",
    value: "🎗 정기 후원 해지 안내",
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

function jsonError(step: string, err: any, status = 500) {
  return new Response(
    JSON.stringify({
      ok: false,
      error: "시드 실패",
      step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

export default async (req: Request) => {
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ ok: false, error: "GET only" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  /* 진단 모드 (인증 불필요) — 현재 시드 상태 조회 */
  if (!run) {
    try {
      const existing: any = await db.execute(sql`
        SELECT key, scope, value_type, sort_order
        FROM site_settings
        WHERE key LIKE 'mypage.cancellationGuide.%'
        ORDER BY sort_order, key
      `);
      const rows = Array.isArray(existing) ? existing : (existing?.rows || []);
      return new Response(
        JSON.stringify({
          ok: true,
          mode: "diagnostic",
          existingCount: rows.length,
          totalNeeded: SEEDS.length,
          existing: rows,
          required: SEEDS.map((s) => ({ key: s.key, sortOrder: s.sortOrder })),
          hint: "?run=1 추가 + 어드민 로그인된 상태로 호출하면 실제 시드 실행",
        }, null, 2),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    } catch (e: any) {
      return jsonError("diagnostic", e);
    }
  }

  /* 실행 모드 — 어드민 인증 필수 */
  const guard: any = await requireAdmin(req);
  if (!guard.ok) return guard.res;

  try {
    /* 1. 컬럼 감지 (기존 시드와 동일 패턴 — 안전장치) */
    let colNames: string[] = [];
    try {
      const colRes: any = await db.execute(sql`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'site_settings'
      `);
      const cols = Array.isArray(colRes) ? colRes : (colRes?.rows || []);
      colNames = cols.map((c: any) => c.column_name);
    } catch (e) {
      return jsonError("detect_columns", e);
    }
    const has = (n: string) => colNames.includes(n);

    if (!has("scope") || !has("key") || !has("value_text")) {
      return jsonError("schema_check", new Error("필수 컬럼 누락 (scope/key/value_text)"));
    }

    /* 2. 기존 키 조회 (멱등) */
    let existingKeys: Set<string>;
    try {
      const existing: any = await db.execute(sql`
        SELECT key FROM site_settings WHERE key LIKE 'mypage.cancellationGuide.%'
      `);
      const existingRows = Array.isArray(existing) ? existing : (existing?.rows || []);
      existingKeys = new Set(existingRows.map((r: any) => r.key));
    } catch (e) {
      return jsonError("select_existing", e);
    }

    /* 3. 누락 키만 INSERT */
    const inserted: string[] = [];
    const skipped: string[] = [];

    for (const item of SEEDS) {
      if (existingKeys.has(item.key)) {
        skipped.push(item.key);
        continue;
      }

      try {
        const insertCols: string[] = [];
        const insertVals: any[] = [];
        if (has("scope"))       { insertCols.push("scope");       insertVals.push("mypage"); }
        if (has("key"))         { insertCols.push("key");         insertVals.push(item.key); }
        if (has("value_type"))  { insertCols.push("value_type");  insertVals.push("text"); }
        if (has("value_text"))  { insertCols.push("value_text");  insertVals.push(item.value); }
        if (has("description")) { insertCols.push("description"); insertVals.push(item.description); }
        if (has("sort_order"))  { insertCols.push("sort_order");  insertVals.push(item.sortOrder); }
        if (has("is_active"))   { insertCols.push("is_active");   insertVals.push(true); }
        if (has("has_draft"))   { insertCols.push("has_draft");   insertVals.push(false); }

        const colsSql = sql.raw(insertCols.join(", "));
        const valsSql = sql.join(insertVals.map((v) => sql`${v}`), sql`, `);
        await db.execute(sql`INSERT INTO site_settings (${colsSql}) VALUES (${valsSql})`);
        inserted.push(item.key);
      } catch (e) {
        return jsonError(`insert:${item.key}`, e);
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        mode: "executed",
        inserted,
        skipped,
        totalNeeded: SEEDS.length,
        message:
          inserted.length > 0
            ? `${inserted.length}개 시드 완료 (${skipped.length}개 이미 존재)`
            : `이미 모든 키 존재 (${skipped.length}개) — 추가 작업 없음`,
        nextStep:
          "어드민 → 메인 화면 편집 → 마이페이지 → '정기 후원 해지 안내' 클릭 → 폼 노출 확인 → AI에게 알려 주세요",
      }, null, 2),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    return jsonError("run", e);
  }
};

export const config = { path: "/api/migrate-seed-mypage-cancel" };
