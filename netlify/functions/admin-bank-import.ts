/**
 * POST /api/admin-bank-import
 * 통장 거래 배열 JSON 수신 → 정규화 재검증 + dedup_hash 서버 생성 + 중복 차단
 *   → bank_imports + bank_transactions 적재
 *
 * 클라이언트(A)가 SheetJS로 파싱한 정규화된 거래 배열을 application/json으로 전송.
 * 서버 xlsx 패키지 없음 — 정규화·해시·중복차단·적재만 담당.
 *
 * Body: {
 *   filename: string,
 *   bankName?: string,
 *   periodFrom?: 'YYYY-MM-DD', periodTo?: 'YYYY-MM-DD',
 *   rows: RawBankRow[]   // §1.1 12컬럼 매핑
 * }
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";
import { normalizeBankRows } from "../../lib/bank-reconcile";

export const config = { path: "/api/admin-bank-import" };

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "통장 업로드 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "POST 메서드만 허용" }),
      { status: 405, headers: { "Content-Type": "application/json" } });
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  const importedBy = String(auth.ctx.member?.email || auth.ctx.admin?.uid || "admin");

  let body: any;
  try { body = await req.json(); } catch { body = {}; }

  const { filename, bankName, periodFrom, periodTo, rows } = body;
  if (!filename || !Array.isArray(rows) || rows.length === 0) {
    return new Response(JSON.stringify({ ok: false, error: "filename, rows(비어있지 않은 배열) 필수" }),
      { status: 400, headers: { "Content-Type": "application/json" } });
  }

  // ── 정규화 + 합계행 제외 + dedup_hash 서버 생성 ──────────────
  let normalized, skippedSummary, skippedInvalid;
  try {
    const result = normalizeBankRows(rows);
    normalized = result.normalized;
    skippedSummary = result.skippedSummary;
    skippedInvalid = result.skippedInvalid;
  } catch (err: any) {
    return jsonError("normalize", err);
  }

  if (normalized.length === 0) {
    return new Response(JSON.stringify({
      ok: false, error: "적재할 유효 거래 0건",
      skippedSummary, skippedInvalid,
    }), { status: 422, headers: { "Content-Type": "application/json" } });
  }

  // ── 중복 차단 — 기존 dedup_hash 조회 ────────────────────────
  // ★ 버그픽스3 #13: drizzle sql 템플릿에서 ${jsArray} 를 = ANY 에 직접 넣으면
  //   postgres-js 가 record 로 바인딩 → "op ANY/ALL requires array" 또는
  //   "cannot cast type record to text[]" 500.
  //   startJob 의 검증된 패턴(sql.raw 로 명시 배열 리터럴)을 적용.
  //   dedupHash 는 SHA-256 hex(영숫자만)이라 hex 외 문자를 거른 뒤 따옴표로 감싸 안전.
  let existingHashes = new Set<string>();
  try {
    const hashes = normalized
      .map(n => n.dedupHash)
      .filter((h): h is string => typeof h === "string" && /^[0-9a-f]+$/i.test(h));
    if (hashes.length > 0) {
      const arrLiteral = `ARRAY[${hashes.map(h => `'${h}'`).join(",")}]::text[]`;
      const r: any = await db.execute(sql`
        SELECT dedup_hash FROM bank_transactions
        WHERE dedup_hash = ANY(${sql.raw(arrLiteral)})`);
      existingHashes = new Set((r?.rows ?? r ?? []).map((x: any) => x.dedup_hash));
    }
  } catch (err: any) {
    return jsonError("dedup_check", err);
  }

  const fresh = normalized.filter(n => !existingHashes.has(n.dedupHash));
  // 같은 파일 내 중복도 제거 (해시 기준)
  const seenInBatch = new Set<string>();
  const toInsert = fresh.filter(n => {
    if (seenInBatch.has(n.dedupHash)) return false;
    seenInBatch.add(n.dedupHash);
    return true;
  });
  const duplicateCount = normalized.length - toInsert.length;

  if (toInsert.length === 0) {
    return new Response(JSON.stringify({
      ok: true,
      data: {
        importId: null,
        totalRows: normalized.length,
        insertedRows: 0,
        duplicateCount,
        skippedSummary, skippedInvalid,
        message: "모든 거래가 이미 적재됨 (중복) — 신규 적재 0건",
      },
    }), { headers: { "Content-Type": "application/json" } });
  }

  // ── bank_imports 생성 ──────────────────────────────────────
  let importId: number;
  try {
    // 기간 자동 추출 (body 미지정 시 거래 범위로)
    const dates = toInsert.map(n => n.txnDate).sort();
    const pFrom = periodFrom || dates[0];
    const pTo   = periodTo || dates[dates.length - 1];
    const r: any = await db.execute(sql`
      INSERT INTO bank_imports
        (filename, bank_name, period_from, period_to, total_rows,
         auto_matched, pending_review, ignored_rows, imported_by, status, imported_at)
      VALUES
        (${filename}, ${bankName || "IBK기업은행"}, ${pFrom}, ${pTo}, ${toInsert.length},
         0, ${toInsert.length}, 0, ${importedBy}, 'review', NOW())
      RETURNING id`);
    importId = Number((r?.rows ?? r ?? [])[0].id);
  } catch (err: any) {
    return jsonError("insert_import", err);
  }

  // ── bank_transactions 적재 ─────────────────────────────────
  let insertedRows = 0;
  try {
    for (const n of toInsert) {
      await db.execute(sql`
        INSERT INTO bank_transactions
          (import_id, txn_date, amount, description, counterpart, balance_after, txn_type,
           counterpart_account, counterpart_bank, counterpart_name, txn_method, memo, cms_code,
           match_type, dedup_hash, status, created_at)
        VALUES
          (${importId}, ${n.txnDate}, ${n.amount}, ${n.description},
           ${n.counterpartName || null}, ${n.balanceAfter}, ${n.txnType},
           ${n.counterpartAccount}, ${n.counterpartBank}, ${n.counterpartName},
           ${n.txnMethod}, ${n.memo}, ${n.cmsCode},
           'pending', ${n.dedupHash}, 'pending', NOW())`);
      insertedRows++;
    }
  } catch (err: any) {
    return jsonError(`insert_txn_at_${insertedRows}`, err);
  }

  return new Response(JSON.stringify({
    ok: true,
    data: {
      importId,
      totalRows: normalized.length,
      insertedRows,
      duplicateCount,
      skippedSummary, skippedInvalid,
      message: `통장 거래 ${insertedRows}건 적재 완료 (중복 ${duplicateCount}건 차단). 대사 실행 대기.`,
    },
  }), { status: 201, headers: { "Content-Type": "application/json" } });
}
