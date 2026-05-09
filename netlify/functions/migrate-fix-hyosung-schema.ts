/**
 * 1회용 마이그레이션: 효성 2테이블(hyosung_contracts·hyosung_billings) 컬럼 정합성 복구
 *
 * 배경:
 *   v14(2026-05-08) 마이그가 만든 컬럼명과 현재 schema.ts(2026-05-10) 컬럼명이
 *   9개 가까이 어긋나 있음. CSV 통과 처리 시 "column ... does not exist" 오류로
 *   100% 실패. 이 마이그가 RENAME/ADD/ALTER로 정합성 맞춤.
 *
 * 호출:
 *   GET  /api/migrate-fix-hyosung-schema           — 진단 모드(인증 불필요, 현재 컬럼 조회)
 *   GET  /api/migrate-fix-hyosung-schema?run=1     — 어드민 인증 후 실제 적용
 *
 * 호출 후 본 파일 즉시 삭제 + 커밋 (1회용 보안 원칙).
 *
 * 멱등 보장:
 *   - RENAME COLUMN: 대상 컬럼이 없으면(이미 rename됨) skip
 *   - ADD COLUMN  : IF NOT EXISTS
 *   - ALTER TYPE  : 항상 안전 (string → varchar)
 *   - DROP NOT NULL: 항상 안전
 *   - DROP CONSTRAINT: IF EXISTS
 */
import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-fix-hyosung-schema" };

/* 효성 계약 컬럼 RENAME 매핑 (DB 현재 → schema.ts 기대) */
const CONTRACT_RENAMES: Array<[string, string]> = [
  ["bank_info",         "payment_info"],
  ["register_status",   "registration_status"],
  ["agreement",         "agreement_status"],
  ["product_list",      "product_name"],
  ["member_category",   "member_type"],
  ["generation_type",   "billing_auto"],
  ["sending_method",    "send_method"],
];

/* 효성 수납 컬럼 RENAME 매핑 */
const BILLING_RENAMES: Array<[string, string]> = [
  ["paid_amount",            "received_amount"],
  ["paid_completion_date",   "billing_completion_date"],
  ["note",                   "memo"],
  ["sending_method",         "send_method"], // 일부 행에 있을 수 있음 (있으면 옮기고, 없으면 skip)
];

/* 진단: 현재 DB 컬럼 목록 조회 */
async function diagnose() {
  const contractCols: any = await db.execute(sql`
    SELECT column_name, data_type, is_nullable, character_maximum_length
    FROM information_schema.columns
    WHERE table_name = 'hyosung_contracts'
    ORDER BY ordinal_position
  `);
  const billingCols: any = await db.execute(sql`
    SELECT column_name, data_type, is_nullable, character_maximum_length
    FROM information_schema.columns
    WHERE table_name = 'hyosung_billings'
    ORDER BY ordinal_position
  `);
  const contractRows = Array.isArray(contractCols) ? contractCols : (contractCols as any).rows || [];
  const billingRows = Array.isArray(billingCols) ? billingCols : (billingCols as any).rows || [];

  const contractNames = contractRows.map((r: any) => r.column_name as string);
  const billingNames = billingRows.map((r: any) => r.column_name as string);

  return {
    hyosung_contracts: { columns: contractRows, columnNames: contractNames },
    hyosung_billings: { columns: billingRows, columnNames: billingNames },
    plan: {
      contractRenames: CONTRACT_RENAMES.map(([from, to]) => ({
        from, to,
        action: contractNames.includes(from)
          ? (contractNames.includes(to) ? `skip (둘 다 존재 — DROP ${from})` : `RENAME`)
          : (contractNames.includes(to) ? "skip (이미 rename됨)" : `skip (${from} 없음)`),
      })),
      contractAdds: ["electronic_contract"].filter(c => !contractNames.includes(c)),
      billingRenames: BILLING_RENAMES.map(([from, to]) => ({
        from, to,
        action: billingNames.includes(from)
          ? (billingNames.includes(to) ? `skip (둘 다 존재 — DROP ${from})` : `RENAME`)
          : (billingNames.includes(to) ? "skip (이미 rename됨)" : `skip (${from} 없음)`),
      })),
      billingAdds: ["first_billing_month", "supply_amount", "vat_amount", "payment_result", "unreceived_handling"]
        .filter(c => !billingNames.includes(c)),
    },
  };
}

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  /* 진단 모드 (인증 불필요) */
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

  /* 실행 모드: 어드민 인증 필수 */
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  try {
    const log: string[] = [];

    /* ─────────────────────────────────────────────────
       STEP A: hyosung_contracts 컬럼 정합성
       ───────────────────────────────────────────────── */
    /* A-1) 현재 컬럼 조회 */
    const cRaw: any = await db.execute(sql`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'hyosung_contracts'
    `);
    const cRows = Array.isArray(cRaw) ? cRaw : (cRaw as any).rows || [];
    const cNames: Set<string> = new Set(cRows.map((r: any) => r.column_name as string));

    /* A-2) RENAME — 대상 컬럼이 있고, 새 이름은 없을 때만 */
    for (const [from, to] of CONTRACT_RENAMES) {
      if (cNames.has(from) && !cNames.has(to)) {
        await db.execute(sql.raw(`ALTER TABLE hyosung_contracts RENAME COLUMN ${from} TO ${to}`));
        log.push(`OK: hyosung_contracts.${from} → ${to}`);
        cNames.delete(from); cNames.add(to);
      } else if (cNames.has(from) && cNames.has(to)) {
        /* 둘 다 있으면 — 옛 컬럼 데이터를 새 컬럼으로 옮긴 뒤 옛 컬럼 DROP */
        await db.execute(sql.raw(`UPDATE hyosung_contracts SET ${to} = COALESCE(${to}, ${from}) WHERE ${from} IS NOT NULL`));
        await db.execute(sql.raw(`ALTER TABLE hyosung_contracts DROP COLUMN ${from}`));
        log.push(`OK: hyosung_contracts.${from} 데이터 ${to}로 이전 후 DROP`);
        cNames.delete(from);
      } else {
        log.push(`SKIP: hyosung_contracts.${from} → ${to} (${cNames.has(to) ? "이미 rename됨" : "원본 컬럼 없음"})`);
      }
    }

    /* A-3) ADD COLUMN electronic_contract */
    await db.execute(sql`
      ALTER TABLE hyosung_contracts
        ADD COLUMN IF NOT EXISTS electronic_contract VARCHAR(20)
    `);
    log.push("OK: hyosung_contracts.electronic_contract 컬럼 보장");

    /* A-4) member_name NOT NULL 해제 (schema.ts는 nullable) */
    await db.execute(sql`ALTER TABLE hyosung_contracts ALTER COLUMN member_name DROP NOT NULL`);
    log.push("OK: hyosung_contracts.member_name DROP NOT NULL");

    /* ─────────────────────────────────────────────────
       STEP B: hyosung_billings 컬럼 정합성
       ───────────────────────────────────────────────── */
    /* B-1) 현재 컬럼 조회 */
    const bRaw: any = await db.execute(sql`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'hyosung_billings'
    `);
    const bRows = Array.isArray(bRaw) ? bRaw : (bRaw as any).rows || [];
    const bNames: Set<string> = new Set(bRows.map((r: any) => r.column_name as string));

    /* B-2) RENAME */
    for (const [from, to] of BILLING_RENAMES) {
      if (bNames.has(from) && !bNames.has(to)) {
        await db.execute(sql.raw(`ALTER TABLE hyosung_billings RENAME COLUMN ${from} TO ${to}`));
        log.push(`OK: hyosung_billings.${from} → ${to}`);
        bNames.delete(from); bNames.add(to);
      } else if (bNames.has(from) && bNames.has(to)) {
        await db.execute(sql.raw(`UPDATE hyosung_billings SET ${to} = COALESCE(${to}, ${from}) WHERE ${from} IS NOT NULL`));
        await db.execute(sql.raw(`ALTER TABLE hyosung_billings DROP COLUMN ${from}`));
        log.push(`OK: hyosung_billings.${from} 데이터 ${to}로 이전 후 DROP`);
        bNames.delete(from);
      } else {
        log.push(`SKIP: hyosung_billings.${from} → ${to} (${bNames.has(to) ? "이미 rename됨" : "원본 컬럼 없음"})`);
      }
    }

    /* B-3) ADD COLUMN — 누락된 5개 */
    await db.execute(sql`
      ALTER TABLE hyosung_billings
        ADD COLUMN IF NOT EXISTS first_billing_month VARCHAR(10),
        ADD COLUMN IF NOT EXISTS supply_amount       INTEGER,
        ADD COLUMN IF NOT EXISTS vat_amount          INTEGER,
        ADD COLUMN IF NOT EXISTS payment_result      VARCHAR(50),
        ADD COLUMN IF NOT EXISTS unreceived_handling VARCHAR(20)
    `);
    log.push("OK: hyosung_billings ADD 5컬럼 (first_billing_month·supply_amount·vat_amount·payment_result·unreceived_handling)");

    /* B-4) contract_no INTEGER NOT NULL → VARCHAR(30) NULL */
    await db.execute(sql`ALTER TABLE hyosung_billings ALTER COLUMN contract_no DROP NOT NULL`);
    /* INTEGER → VARCHAR(30) 타입 변경 (USING으로 변환) */
    await db.execute(sql`
      ALTER TABLE hyosung_billings ALTER COLUMN contract_no TYPE VARCHAR(30) USING contract_no::text
    `);
    log.push("OK: hyosung_billings.contract_no INTEGER NOT NULL → VARCHAR(30) NULL");

    /* B-5) billing_amount INTEGER NOT NULL → INTEGER NULL */
    await db.execute(sql`ALTER TABLE hyosung_billings ALTER COLUMN billing_amount DROP NOT NULL`);
    log.push("OK: hyosung_billings.billing_amount DROP NOT NULL");

    /* B-6) member_name TEXT NOT NULL → TEXT NULL */
    await db.execute(sql`ALTER TABLE hyosung_billings ALTER COLUMN member_name DROP NOT NULL`);
    log.push("OK: hyosung_billings.member_name DROP NOT NULL");

    /* B-7) 옛 UNIQUE 제약 제거 (member_no, billing_month, product_name) — 우리 코드는 (member_no + billing_month) 기반 SELECT-then-UPDATE */
    await db.execute(sql`
      ALTER TABLE hyosung_billings
        DROP CONSTRAINT IF EXISTS hyosung_billings_member_no_billing_month_product_name_key
    `);
    log.push("OK: hyosung_billings_member_no_billing_month_product_name_key UNIQUE 제거 (있었다면)");

    /* B-8) updated_at 컬럼 보장 (schema.ts에 있음) */
    await db.execute(sql`
      ALTER TABLE hyosung_billings
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    `);
    log.push("OK: hyosung_billings.updated_at 보장");

    /* B-9) 추가 인덱스 보강 */
    await db.execute(sql`CREATE INDEX IF NOT EXISTS hyosung_billings_receipt_status_idx ON hyosung_billings(receipt_status)`);
    log.push("OK: hyosung_billings_receipt_status_idx");

    /* ─────────────────────────────────────────────────
       STEP C: 후속 진단 — 정렬된 최종 컬럼 목록
       ───────────────────────────────────────────────── */
    const finalDiag = await diagnose();

    return new Response(JSON.stringify({
      ok: true, mode: "applied",
      log,
      finalState: finalDiag,
      next: "이 파일은 1회용입니다 — 호출 성공 확인 후 즉시 삭제하고 커밋하세요.",
    }, null, 2), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[migrate-fix-hyosung-schema]", e);
    return new Response(JSON.stringify({
      ok: false, error: e.message, stack: e.stack,
    }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
};
