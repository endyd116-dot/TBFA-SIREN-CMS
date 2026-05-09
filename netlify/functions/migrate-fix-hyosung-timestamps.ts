/**
 * 1회용 마이그레이션: 효성 2테이블 timestamp 컬럼 정합성 복구 (2차)
 *
 * 배경:
 *   1차 마이그(migrate-fix-hyosung-schema)에서 9개+ 컬럼 정렬 완료했으나,
 *   created_at 컬럼명이 누락. v14가 imported_at로 만든 컬럼을 schema.ts는
 *   created_at로 기대 중. 통과 처리 시 "column created_at of relation
 *   hyosung_contracts does not exist"로 실패.
 *
 *   imported_at → created_at RENAME (양 테이블).
 *
 * 호출:
 *   GET  /api/migrate-fix-hyosung-timestamps           — 진단(인증 불필요)
 *   GET  /api/migrate-fix-hyosung-timestamps?run=1     — 어드민 인증 후 실행
 */
import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-fix-hyosung-timestamps" };

async function diagnose() {
  const cRaw: any = await db.execute(sql`
    SELECT column_name FROM information_schema.columns WHERE table_name = 'hyosung_contracts'
  `);
  const bRaw: any = await db.execute(sql`
    SELECT column_name FROM information_schema.columns WHERE table_name = 'hyosung_billings'
  `);
  const cRows = Array.isArray(cRaw) ? cRaw : (cRaw as any).rows || [];
  const bRows = Array.isArray(bRaw) ? bRaw : (bRaw as any).rows || [];
  const cNames: string[] = cRows.map((r: any) => r.column_name as string);
  const bNames: string[] = bRows.map((r: any) => r.column_name as string);
  return {
    hyosung_contracts: { columns: cNames, hasCreatedAt: cNames.includes("created_at"), hasImportedAt: cNames.includes("imported_at") },
    hyosung_billings: { columns: bNames, hasCreatedAt: bNames.includes("created_at"), hasImportedAt: bNames.includes("imported_at") },
  };
}

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  if (!run) {
    try {
      const d = await diagnose();
      return new Response(JSON.stringify({ ok: true, mode: "diagnose", ...d }, null, 2), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    } catch (e: any) {
      return new Response(JSON.stringify({ ok: false, error: e.message, stack: e.stack }), {
        status: 500, headers: { "Content-Type": "application/json" },
      });
    }
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  try {
    const log: string[] = [];

    /* hyosung_contracts: imported_at → created_at */
    const c = await diagnose();
    if (c.hyosung_contracts.hasImportedAt && !c.hyosung_contracts.hasCreatedAt) {
      await db.execute(sql`ALTER TABLE hyosung_contracts RENAME COLUMN imported_at TO created_at`);
      log.push("OK: hyosung_contracts.imported_at → created_at");
    } else if (c.hyosung_contracts.hasCreatedAt) {
      log.push("SKIP: hyosung_contracts.created_at 이미 존재");
    } else {
      /* 둘 다 없음 — 새로 생성 */
      await db.execute(sql`ALTER TABLE hyosung_contracts ADD COLUMN created_at TIMESTAMP DEFAULT NOW() NOT NULL`);
      log.push("OK: hyosung_contracts.created_at 신규 생성");
    }

    /* hyosung_billings: imported_at → created_at */
    if (c.hyosung_billings.hasImportedAt && !c.hyosung_billings.hasCreatedAt) {
      await db.execute(sql`ALTER TABLE hyosung_billings RENAME COLUMN imported_at TO created_at`);
      log.push("OK: hyosung_billings.imported_at → created_at");
    } else if (c.hyosung_billings.hasCreatedAt) {
      log.push("SKIP: hyosung_billings.created_at 이미 존재");
    } else {
      await db.execute(sql`ALTER TABLE hyosung_billings ADD COLUMN created_at TIMESTAMP DEFAULT NOW() NOT NULL`);
      log.push("OK: hyosung_billings.created_at 신규 생성");
    }

    /* updated_at NOT NULL 보장 (schema.ts notNull) */
    await db.execute(sql`UPDATE hyosung_contracts SET updated_at = COALESCE(updated_at, NOW()) WHERE updated_at IS NULL`);
    await db.execute(sql`ALTER TABLE hyosung_contracts ALTER COLUMN updated_at SET DEFAULT NOW()`);
    await db.execute(sql`ALTER TABLE hyosung_contracts ALTER COLUMN updated_at SET NOT NULL`);
    log.push("OK: hyosung_contracts.updated_at NOT NULL + DEFAULT NOW()");

    /* created_at NOT NULL 보장 + DEFAULT */
    await db.execute(sql`UPDATE hyosung_contracts SET created_at = COALESCE(created_at, NOW()) WHERE created_at IS NULL`);
    await db.execute(sql`ALTER TABLE hyosung_contracts ALTER COLUMN created_at SET DEFAULT NOW()`);
    await db.execute(sql`ALTER TABLE hyosung_contracts ALTER COLUMN created_at SET NOT NULL`);
    log.push("OK: hyosung_contracts.created_at NOT NULL + DEFAULT NOW()");

    await db.execute(sql`UPDATE hyosung_billings SET created_at = COALESCE(created_at, NOW()) WHERE created_at IS NULL`);
    await db.execute(sql`ALTER TABLE hyosung_billings ALTER COLUMN created_at SET DEFAULT NOW()`);
    await db.execute(sql`ALTER TABLE hyosung_billings ALTER COLUMN created_at SET NOT NULL`);
    log.push("OK: hyosung_billings.created_at NOT NULL + DEFAULT NOW()");

    const finalDiag = await diagnose();

    return new Response(JSON.stringify({
      ok: true, mode: "applied", log, finalState: finalDiag,
      next: "이 파일은 1회용입니다 — 호출 성공 확인 후 즉시 삭제하고 커밋하세요.",
    }, null, 2), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[migrate-fix-hyosung-timestamps]", e);
    return new Response(JSON.stringify({ ok: false, error: e.message, stack: e.stack }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
};
