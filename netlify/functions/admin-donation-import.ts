/**
 * POST /api/admin-donation-import
 *
 * ★ Phase 3 D1·D2 (2026-05-10 재작성):
 *   효성·기업은행 모두 pending_donations(임시 보관함)에 적재.
 *   사용자가 행별/일괄 "통과(확정)" 처리해야 효성 저장소(hyosungContracts·hyosungBillings)
 *   및 회원·후원 내역에 정식 반영됨.
 *
 *   - source = 'hyosung_contracts' : 효성 계약정보 행 (회원번호 기준 자동 매칭)
 *   - source = 'hyosung_billings'  : 효성 수납내역 행 (회원번호 기준 자동 매칭)
 *   - source = 'ibk'               : 기업은행 거래내역 (이름·금액·계좌끝4 기반 자동 매칭)
 *
 * 폼 필드:
 *   file       : CSV 파일 (필수)
 *   source     : 'hyosung_billings' | 'hyosung_contracts' | 'ibk' | 'auto' (기본 'auto')
 *   autoMatch  : 'true' | 'false' (기본 'true')
 */
import type { Context } from "@netlify/functions";
import { eq, inArray } from "drizzle-orm";
import { db, pendingDonations, members } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, badRequest, serverError, methodNotAllowed, corsPreflight,
} from "../../lib/response";
import { logAdminAction } from "../../lib/audit";
import {
  parseBillingsCsv, parseContractsCsv, detectCsvType,
  type HyosungBillingRow, type HyosungContractRow,
} from "../../lib/hyosung-parser";
import { parseIbkTransfersCsv, type IbkTransferRow } from "../../lib/ibk-parser";
import {
  loadMatchingRules, matchPendingDonation, summarizeReasons,
} from "../../lib/donation-matcher";

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_ROWS_PER_IMPORT = 5000;

type Source = "hyosung_billings" | "hyosung_contracts" | "ibk";

/* =========================================================
   공통: CSV 텍스트 디코딩 (UTF-8 우선, EUC-KR 폴백)
   ========================================================= */
async function decodeCsv(file: File): Promise<string | null> {
  const rawBuffer = await file.arrayBuffer();
  let csvText = "";
  try {
    csvText = new TextDecoder("utf-8", { fatal: true }).decode(rawBuffer);
  } catch {
    try {
      csvText = new TextDecoder("euc-kr").decode(rawBuffer);
    } catch {
      csvText = new TextDecoder("utf-8").decode(rawBuffer);
    }
  }
  if (csvText.charCodeAt(0) === 0xFEFF) csvText = csvText.slice(1);
  if (!csvText || csvText.trim().length < 10) return null;
  return csvText;
}

/* =========================================================
   D1: 효성 계약정보 → pendingDonations 적재 (회원번호 자동 매칭)
   확정(통과)은 admin-donation-confirm.ts가 처리.
   ========================================================= */
async function importHyosungContractsToPending(
  csvText: string,
  file: File,
  adminMemberId: number,
) {
  const r = parseContractsCsv(csvText);
  if (r.rows.length === 0) {
    return badRequest("파싱 가능한 계약정보 행이 없습니다", { parseErrors: r.errors.slice(0, 20) });
  }
  if (r.rows.length > MAX_ROWS_PER_IMPORT) {
    return badRequest(`한 번에 처리 가능한 행 수는 ${MAX_ROWS_PER_IMPORT}건입니다`);
  }

  /* 기존 회원 매칭 (hyosungMemberNo IN [...]) */
  const memberNos = r.rows.map(row => row.memberNo).filter(Boolean) as number[];
  const memberMap = new Map<number, number>();
  if (memberNos.length > 0) {
    try {
      const existing = await db.select({
        id: members.id, hyosungMemberNo: members.hyosungMemberNo,
      }).from(members).where(inArray(members.hyosungMemberNo, memberNos));
      existing.forEach(m => { if (m.hyosungMemberNo != null) memberMap.set(m.hyosungMemberNo, m.id); });
    } catch (e) { console.warn("[D1 import] members 조회 실패", e); }
  }

  let imported = 0, autoMatched = 0;
  const insertErrors: { rowIndex: number; error: string }[] = [];

  /* pendingDonations 적재 — 행별 INSERT (실패해도 다음 행 계속) */
  for (const [idx, row] of r.rows.entries()) {
    try {
      const linkedMemberId = memberMap.get(row.memberNo) ?? null;
      const memo = [
        row.contractStatus ? `계약상태: ${row.contractStatus}` : null,
        row.paymentTool ? `결제수단: ${row.paymentTool}` : null,
        row.paymentMethod ? `결제방식: ${row.paymentMethod}` : null,
        row.registrationStatus ? `등록상태: ${row.registrationStatus}` : null,
        row.productName ? `상품: ${row.productName}` : null,
      ].filter(Boolean).join(" / ");

      const parsedDate = row.billingStart ? new Date(row.billingStart) : null;

      await db.insert(pendingDonations).values({
        source: "hyosung_contracts",
        sourceFileName: file.name.slice(0, 200),
        sourceRowIndex: idx + 2,
        rawData: { ...row.rawData, _hyosungContractRow: row } as any,
        parsedName: row.memberName,
        parsedAmount: row.productAmount ?? 0,
        parsedDate,
        parsedMemo: memo.slice(0, 4000),
        parsedAccountTail4: null,
        matchedMemberId: linkedMemberId,
        matchScore: linkedMemberId ? "1.00" as any : null,
        matchReason: linkedMemberId
          ? `효성 회원번호 일치 (#${row.memberNo})`
          : `신규 — 통과 시 회원 등록 (효성회원번호 #${row.memberNo})`,
        status: linkedMemberId ? "matched" : "pending",
        importedBy: adminMemberId,
      } as any);

      imported++;
      if (linkedMemberId) autoMatched++;
    } catch (rowErr: any) {
      insertErrors.push({ rowIndex: idx + 2, error: String(rowErr?.message || rowErr).slice(0, 300) });
    }
  }

  return { imported, autoMatched, parseErrors: r.errors, insertErrors, totalParsedRows: r.rows.length };
}

/* =========================================================
   D2: 효성 수납내역 → pendingDonations 적재 (회원번호 자동 매칭)
   ========================================================= */
async function importHyosungBillingsToPending(
  csvText: string,
  file: File,
  adminMemberId: number,
) {
  const r = parseBillingsCsv(csvText);
  if (r.rows.length === 0) {
    return badRequest("파싱 가능한 수납내역 행이 없습니다", { parseErrors: r.errors.slice(0, 20) });
  }
  if (r.rows.length > MAX_ROWS_PER_IMPORT) {
    return badRequest(`한 번에 처리 가능한 행 수는 ${MAX_ROWS_PER_IMPORT}건입니다`);
  }

  /* 기존 회원 매칭 (hyosungMemberNo IN [...]) */
  const memberNos = r.rows.map(row => row.memberNo).filter(Boolean) as number[];
  const memberMap = new Map<number, number>();
  if (memberNos.length > 0) {
    try {
      const existing = await db.select({
        id: members.id, hyosungMemberNo: members.hyosungMemberNo,
      }).from(members).where(inArray(members.hyosungMemberNo, memberNos));
      existing.forEach(m => { if (m.hyosungMemberNo != null) memberMap.set(m.hyosungMemberNo, m.id); });
    } catch (e) { console.warn("[D2 import] members 조회 실패", e); }
  }

  let imported = 0, autoMatched = 0;
  const insertErrors: { rowIndex: number; error: string }[] = [];

  for (const [idx, row] of r.rows.entries()) {
    try {
      const linkedMemberId = memberMap.get(row.memberNo) ?? null;
      const memo = [
        row.billingMonth ? `청구월: ${row.billingMonth}` : null,
        row.receiptStatus ? `수납상태: ${row.receiptStatus}` : null,
        row.billingAmount ? `청구금액: ${row.billingAmount.toLocaleString()}원` : null,
        row.receivedAmount ? `수납금액: ${row.receivedAmount.toLocaleString()}원` : null,
        row.paymentDate ? `결제일: ${row.paymentDate}` : null,
        row.productName ? `상품: ${row.productName}` : null,
      ].filter(Boolean).join(" / ");

      const parsedDate = row.paymentDate
        ? new Date(row.paymentDate)
        : (row.billingMonth ? new Date(row.billingMonth.replace("/", "-") + "-01") : null);

      await db.insert(pendingDonations).values({
        source: "hyosung_billings",
        sourceFileName: file.name.slice(0, 200),
        sourceRowIndex: idx + 2,
        rawData: { ...row.rawData, _hyosungBillingRow: row } as any,
        parsedName: row.memberName,
        parsedAmount: row.receivedAmount || row.billingAmount || 0,
        parsedDate,
        parsedMemo: memo.slice(0, 4000),
        parsedAccountTail4: null,
        matchedMemberId: linkedMemberId,
        matchScore: linkedMemberId ? "1.00" as any : null,
        matchReason: linkedMemberId
          ? `효성 회원번호 일치 (#${row.memberNo})`
          : `신규 — 계약관리 업로드 후 매칭 권장 (효성회원번호 #${row.memberNo})`,
        status: linkedMemberId ? "matched" : "pending",
        importedBy: adminMemberId,
      } as any);

      imported++;
      if (linkedMemberId) autoMatched++;
    } catch (rowErr: any) {
      insertErrors.push({ rowIndex: idx + 2, error: String(rowErr?.message || rowErr).slice(0, 300) });
    }
  }

  return { imported, autoMatched, parseErrors: r.errors, insertErrors, totalParsedRows: r.rows.length };
}

/* =========================================================
   메인 핸들러
   ========================================================= */
export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;
  const { admin, member: adminMember } = (auth as any).ctx;

  try {
    /* multipart 파싱 */
    const formData = await req.formData().catch(() => null);
    if (!formData) return badRequest("multipart/form-data 파싱 실패");

    const file = formData.get("file");
    if (!file || !(file instanceof File)) return badRequest("CSV 파일이 첨부되지 않았습니다");
    if (file.size > MAX_FILE_SIZE) return badRequest(`파일 크기는 ${MAX_FILE_SIZE / 1024 / 1024}MB 이하여야 합니다`);

    const sourceParam = String(formData.get("source") || "auto").trim();
    const autoMatch = String(formData.get("autoMatch") || "true").trim() === "true";

    /* CSV 디코딩 */
    const csvText = await decodeCsv(file);
    if (!csvText) return badRequest("CSV 파일이 비어있거나 읽을 수 없습니다");

    /* source 결정 */
    let source: Source;
    if (sourceParam === "hyosung_billings" || sourceParam === "hyosung_contracts" || sourceParam === "ibk") {
      source = sourceParam;
    } else {
      const hyType = detectCsvType(csvText);
      if (hyType === "billings") source = "hyosung_billings";
      else if (hyType === "contracts") source = "hyosung_contracts";
      else {
        const head = csvText.slice(0, 2000);
        if (/입금|출금|거래일|적요|받는분|보낸분|찾으신금액|맡기신금액/.test(head)) source = "ibk";
        else return badRequest("CSV 양식 자동 감지 실패. 출처 항목을 직접 선택해 주세요 (효성 계약정보 / 효성 수납내역 / 기업은행 거래내역)");
      }
    }

    /* ─────────────────────────────────────────────────────────
       효성 계약정보 / 효성 수납내역 → pendingDonations 적재
       (사용자 통과 처리 시점에 hyosungContracts·hyosungBillings 정식 반영)
       ───────────────────────────────────────────────────────── */
    if (source === "hyosung_contracts") {
      const r = await importHyosungContractsToPending(csvText, file, adminMember.id);
      if (r instanceof Response) return r;

      try {
        await logAdminAction(req as any, admin.uid, admin.name, "donation_csv_import", {
          target: file.name,
          detail: { source, totalParsedRows: r.totalParsedRows, importedRows: r.imported, autoMatchedRows: r.autoMatched, parseErrors: r.parseErrors.length, insertErrors: r.insertErrors.length },
        });
      } catch { /* audit 실패 무시 */ }

      return ok({
        fileName: file.name, source, autoMatch,
        totalParsedRows: r.totalParsedRows, importedRows: r.imported,
        autoMatchedRows: r.autoMatched,
        parseErrors: r.parseErrors.slice(0, 20), insertErrors: r.insertErrors.slice(0, 20),
      }, `${r.imported}건 적재 (자동 매칭 ${r.autoMatched}건). 미확정 목록에서 통과 처리하면 회원·계약에 반영됩니다.`);
    }

    if (source === "hyosung_billings") {
      const r = await importHyosungBillingsToPending(csvText, file, adminMember.id);
      if (r instanceof Response) return r;

      try {
        await logAdminAction(req as any, admin.uid, admin.name, "donation_csv_import", {
          target: file.name,
          detail: { source, totalParsedRows: r.totalParsedRows, importedRows: r.imported, autoMatchedRows: r.autoMatched, parseErrors: r.parseErrors.length, insertErrors: r.insertErrors.length },
        });
      } catch { /* audit 실패 무시 */ }

      return ok({
        fileName: file.name, source, autoMatch,
        totalParsedRows: r.totalParsedRows, importedRows: r.imported,
        autoMatchedRows: r.autoMatched,
        parseErrors: r.parseErrors.slice(0, 20), insertErrors: r.insertErrors.slice(0, 20),
      }, `${r.imported}건 적재 (자동 매칭 ${r.autoMatched}건). 미확정 목록에서 통과 처리하면 후원·수납에 반영됩니다.`);
    }

    /* ─────────────────────────────────────────────────────────
       IBK: 기존 pending_donations 방식 유지 (#15)
       ───────────────────────────────────────────────────────── */
    interface NormalizedRow {
      source: "ibk";
      parsedName: string | null;
      parsedAmount: number | null;
      parsedDate: Date | null;
      parsedMemo: string | null;
      parsedAccountTail4: string | null;
      rawData: Record<string, any>;
      sourceRowIndex: number;
    }

    const normalized: NormalizedRow[] = [];
    const parseErrors: Array<{ rowIndex: number; error: string }> = [];

    const ibkResult = parseIbkTransfersCsv(csvText);
    ibkResult.rows.forEach((row: IbkTransferRow, idx) => {
      normalized.push({
        source: "ibk",
        parsedName: row.depositorName,
        parsedAmount: row.amountIn,
        parsedDate: row.txDate ? new Date(row.txDate) : null,
        parsedMemo: row.memo,
        parsedAccountTail4: row.accountTail4,
        rawData: { ...row.rawData, _txTime: row.txTime, _balance: row.balance, _branch: row.branchInfo },
        sourceRowIndex: idx + 2,
      });
    });
    ibkResult.errors.forEach(e => parseErrors.push({ rowIndex: e.rowIndex, error: e.error }));

    if (normalized.length === 0) return badRequest("파싱 가능한 입금 행이 없습니다", { parseErrors: parseErrors.slice(0, 20) });
    if (normalized.length > MAX_ROWS_PER_IMPORT) return badRequest(`한 번에 처리 가능한 행 수는 ${MAX_ROWS_PER_IMPORT}건입니다`);

    let autoMatchedCount = 0;
    const rules = autoMatch ? await loadMatchingRules() : null;
    const BATCH_SIZE = 100;
    let importedCount = 0;
    const insertErrors: Array<{ rowIndex: number; error: string }> = [];

    for (let i = 0; i < normalized.length; i += BATCH_SIZE) {
      const batch = normalized.slice(i, i + BATCH_SIZE);
      const matched = await Promise.all(batch.map(async (n) => {
        if (!autoMatch || !rules) return { match: null };
        try {
          const m = await matchPendingDonation({ parsedName: n.parsedName, parsedAmount: n.parsedAmount, parsedDate: n.parsedDate, parsedAccountTail4: n.parsedAccountTail4 }, rules);
          return { match: m };
        } catch { return { match: null }; }
      }));
      const values = batch.map((n, k) => {
        const m = matched[k].match;
        if (m) autoMatchedCount++;
        return {
          source: n.source,
          sourceFileName: file.name.slice(0, 200),
          sourceRowIndex: n.sourceRowIndex,
          rawData: n.rawData,
          parsedName: n.parsedName,
          parsedAmount: n.parsedAmount,
          parsedDate: n.parsedDate,
          parsedMemo: n.parsedMemo ? n.parsedMemo.slice(0, 4000) : null,
          parsedAccountTail4: n.parsedAccountTail4,
          matchedMemberId: m?.memberId ?? null,
          matchScore: m ? String(m.score) : null,
          matchReason: m ? summarizeReasons(m.reasons) : null,
          status: m ? "matched" : "pending",
          importedBy: adminMember.id,
        };
      }) as any[];
      try {
        await db.insert(pendingDonations).values(values);
        importedCount += values.length;
      } catch {
        for (const v of values) {
          try { await db.insert(pendingDonations).values(v); importedCount++; }
          catch (rowErr: any) { insertErrors.push({ rowIndex: v.sourceRowIndex, error: rowErr?.message || String(rowErr) }); }
        }
      }
    }

    try {
      await logAdminAction(req, admin.uid, admin.name, "donation_csv_import", {
        target: file.name, detail: { source, totalParsedRows: normalized.length, importedRows: importedCount, autoMatchedRows: autoMatchedCount, parseErrors: parseErrors.length, insertErrors: insertErrors.length, autoMatch },
      });
    } catch { /* audit 실패 무시 */ }

    return ok({
      fileName: file.name, source, autoMatch,
      totalParsedRows: normalized.length, importedRows: importedCount,
      autoMatchedRows: autoMatchedCount,
      parseErrors: parseErrors.slice(0, 20), insertErrors: insertErrors.slice(0, 20),
    }, `${importedCount}건 적재 (자동 매칭 ${autoMatchedCount}건). 미확정 목록에서 통과 처리하면 정식 후원 내역이 됩니다.`);

  } catch (err: any) {
    console.error("[admin-donation-import]", err);
    return serverError("CSV 적재 중 오류", err);
  }
};

export const config = { path: "/api/admin-donation-import" };
