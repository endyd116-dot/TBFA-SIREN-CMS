// netlify/functions/migrate-add-siren-divider.ts
// ★ 1회용 마이그레이션 — Phase B Step 5-A
// 사이렌 드롭다운에 구분선 1행 추가 + 신청 내역 sort_order 5→6
// 호출 후 즉시 파일 삭제할 것

import type { Context } from "@netlify/functions";
import { db } from "../../db/index.js";
import { sql } from "drizzle-orm";

const MIGRATE_KEY = "siren-add-divider-v10";

export default async (req: Request, _context: Context) => {
  try {
    const url = new URL(req.url);
    const key = url.searchParams.get("key");
    if (key !== MIGRATE_KEY) {
      return new Response(
        JSON.stringify({ ok: false, error: "forbidden" }),
        { status: 403, headers: { "content-type": "application/json" } }
      );
    }

    const beforeResult: any = await db.execute(sql`
      SELECT id, label, sort_order, css_class
      FROM nav_menu_items
      WHERE parent_id = 3
      ORDER BY sort_order
    `);
    const beforeRows = Array.isArray(beforeResult) ? beforeResult : (beforeResult?.rows || []);

    /* 안전장치 1 — 사이렌 부모 행 존재 확인 */
    const sirenParentResult: any = await db.execute(sql`
      SELECT id FROM nav_menu_items WHERE id = 3 AND label = '사이렌'
    `);
    const sirenParentRows = Array.isArray(sirenParentResult)
      ? sirenParentResult
      : (sirenParentResult?.rows || []);
    if (sirenParentRows.length === 0) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "사이렌 부모 행(id=3)이 없거나 label이 변경되었습니다. 중단합니다.",
          before: beforeRows,
        }, null, 2),
        { status: 400, headers: { "content-type": "application/json" } }
      );
    }

    /* 안전장치 2 — 이미 구분선이 있으면 중단 (재실행 방지) */
    const existingDivider: any = await db.execute(sql`
      SELECT id FROM nav_menu_items
      WHERE parent_id = 3 AND css_class = 'dropdown-divider'
    `);
    const dividerRows = Array.isArray(existingDivider)
      ? existingDivider
      : (existingDivider?.rows || []);
    if (dividerRows.length > 0) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "이미 구분선 행이 존재합니다. 재실행 중단.",
          before: beforeRows,
          existingDividerIds: dividerRows.map((r: any) => r.id),
        }, null, 2),
        { status: 409, headers: { "content-type": "application/json" } }
      );
    }

    /* 1단계 — 신청 내역(id=17) sort_order 5 → 6 */
    await db.execute(sql`
      UPDATE nav_menu_items
      SET sort_order = 6, updated_at = NOW()
      WHERE id = 17 AND parent_id = 3
    `);

    /* 2단계 — 구분선 행 신규 INSERT */
    await db.execute(sql`
      INSERT INTO nav_menu_items
        (parent_id, menu_location, label, href, sort_order,
         is_active, css_class, target, has_draft,
         created_at, updated_at)
      VALUES
        (3, 'header', '---', NULL, 5,
         true, 'dropdown-divider', '_self', false,
         NOW(), NOW())
    `);

    /* 사후 검증 */
    const afterResult: any = await db.execute(sql`
      SELECT id, label, sort_order, css_class, parent_id
      FROM nav_menu_items
      WHERE parent_id = 3
      ORDER BY sort_order
    `);
    const afterRows = Array.isArray(afterResult) ? afterResult : (afterResult?.rows || []);

    return new Response(
      JSON.stringify({
        ok: true,
        message: "구분선 추가 완료",
        before: beforeRows,
        after: afterRows,
      }, null, 2),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ ok: false, error: error.message, stack: error.stack }, null, 2),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
};