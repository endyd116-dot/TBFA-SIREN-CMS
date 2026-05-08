/**
 * POST /api/admin-donation-import
 *
 * ★ 6순위 #15: 효성 + 기업은행 CSV → pending_donations 적재
 *
 * 본 엔드포인트는 "확정 전 적재" 단계만 담당.
 * 자동 매칭 점수 계산까지는 진행하되, donations 테이블 INSERT는 confirm API에서.
 *
 * 폼 필드:
 *   file       : CSV 파일 (필수)
 *   source     : 'hyosung_billings' | 'hyosung_contracts' | 'ibk' | 'auto' (기본 'auto')
 *   autoMatch  : 'true' | 'false' (기본 'true')
 *
 * 응답:
 *   { totalRows, parsedRows, importedRows, autoMatchedRows, errors[] }
 */
import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db, pendingDonations } from "../../db";
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

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_ROWS_PER_IMPORT = 5000;       // 안전 상한

type Source = "hyosung_billings" | "hyosung_contracts" | "ibk";

interface NormalizedRow {
  source: "hyosung" | "ibk";
  parsedName: string | null;
  parsedAmount: number | null;
  parsedDate: Date | null;
  parsedMemo: string | null;
  parsedAccountTail4: string | null;
  rawData: Record<string, any>;
  sourceRowIndex: number;
}

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  /* 1. 인증 */
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;
  const { admin, member: adminMember } = auth.ctx;

  try {
    /* 2. multipart 파싱 */
    const formData = await req.formData().catch(() => null);
    if (!formData) return badRequest("multipart/form-data 파싱 실패");

    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return badRequest("CSV 파일이 첨부되지 않았습니다");
    }
    if (file.size > MAX_FILE_SIZE) {
      return badRequest(`파일 크기는 ${MAX_FILE_SIZE / 1024 / 1024}MB 이하여야 합니다`);
    }

    const sourceParam = String(formData.get("source") || "auto").trim();
    const autoMatch = String(formData.get("autoMatch") || "true").trim() === "true";

    /* 3. 인코딩 자동 감지 (UTF-8 → EUC-KR fallback) */
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
    /* UTF-8 BOM 제거 */
    if (csvText.charCodeAt(0) === 0xFEFF) csvText = csvText.slice(1);

    if (!csvText || csvText.trim().length < 10) {
      return badRequest("CSV 파일이 비어있거나 읽을 수 없습니다");
    }

    /* 4. source 결정 */
    let source: Source;
    if (sourceParam === "hyosung_billings" || sourceParam === "hyosung_contracts" || sourceParam === "ibk") {
      source = sourceParam;
    } else {
      /* auto */
      const hyType = detectCsvType(csvText);
      if (hyType === "billings") source = "hyosung_billings";
      else if (hyType === "contracts") source = "hyosung_contracts";
      else {
        /* IBK 키워드 휴리스틱 */
        const head = csvText.slice(0, 2000);
        if (/입금|출금|거래일|적요|받는분|보낸분|찾으신금액|맡기신금액/.test(head)) {
          source = "ibk";
        } else {
          return badRequest(
            "CSV 양식 자동 감지 실패. source 파라미터로 명시하세요 (hyosung_billings | hyosung_contracts | ibk)"
          );
        }
      }
    }

    /* 5. 파싱 → 정규화 */
    const normalized: NormalizedRow[] = [];
    const parseErrors: Array<{ rowIndex: number; error: string }> = [];

    if (source === "hyosung_billings") {
      const r = parseBillingsCsv(csvText);
      r.rows.forEach((row: HyosungBillingRow, idx) => {
        /* 수납내역에서 received_amount > 0인 건만 후원 후보 */
        if (!row.receivedAmount || row.receivedAmount <= 0) return;
        normalized.push({
          source: "hyosung",
          parsedName: row.memberName,
          parsedAmount: row.receivedAmount,
          parsedDate: row.paymentDate ? new Date(row.paymentDate) : null,
          parsedMemo: row.memo || `[효성 수납 ${row.billingMonth}] ${row.productName || ""}`.trim(),
          parsedAccountTail4: null,
          rawData: { ...row.rawData, _hyosungMemberNo: row.memberNo, _contractNo: row.contractNo, _billingMonth: row.billingMonth },
          sourceRowIndex: idx + 2,
        });
      });
      r.errors.forEach(e => parseErrors.push({ rowIndex: e.rowIndex, error: e.error }));
    } else if (source === "hyosung_contracts") {
      const r = parseContractsCsv(csvText);
      r.rows.forEach((row: HyosungContractRow, idx) => {
        normalized.push({
          source: "hyosung",
          parsedName: row.memberName,
          parsedAmount: row.productAmount,
          parsedDate: row.billingStart ? new Date(row.billingStart) : null,
          parsedMemo: `[효성 계약] ${row.productName || ""} / ${row.contractStatus || ""}`.trim(),
          parsedAccountTail4: null,
          rawData: { ...row.rawData, _hyosungMemberNo: row.memberNo },
          sourceRowIndex: idx + 2,
        });
      });
      r.errors.forEach(e => parseErrors.push({ rowIndex: e.rowIndex, error: e.error }));
    } else {
      /* ibk */
      const r = parseIbkTransfersCsv(csvText);
      r.rows.forEach((row: IbkTransferRow, idx) => {
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
      r.errors.forEach(e => parseErrors.push({ rowIndex: e.rowIndex, error: e.error }));
    }

    if (normalized.length === 0) {
      return badRequest("파싱 가능한 입금 행이 없습니다", { parseErrors: parseErrors.slice(0, 20) });
    }
    if (normalized.length > MAX_ROWS_PER_IMPORT) {
      return badRequest(`한 번에 처리 가능한 행 수는 ${MAX_ROWS_PER_IMPORT}건입니다 (요청: ${normalized.length}건)`);
    }

    /* 6. 자동 매칭 (옵션) */
    let autoMatchedCount = 0;
    const rules = autoMatch ? await loadMatchingRules() : null;

    /* 7. 일괄 INSERT (배치) */
    const BATCH_SIZE = 100;
    let importedCount = 0;
    const insertErrors: Array<{ rowIndex: number; error: string }> = [];

    for (let i = 0; i < normalized.length; i += BATCH_SIZE) {
      const batch = normalized.slice(i, i + BATCH_SIZE);

      /* 매칭 (배치 내 병렬) */
      const matched = await Promise.all(batch.map(async (n) => {
        if (!autoMatch || !rules) return { match: null };
        try {
          const m = await matchPendingDonation({
            parsedName: n.parsedName,
            parsedAmount: n.parsedAmount,
            parsedDate: n.parsedDate,
            parsedAccountTail4: n.parsedAccountTail4,
          }, rules);
          return { match: m };
        } catch {
          return { match: null };
        }
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
      } catch (batchErr: any) {
        /* 배치 실패 시 개별 INSERT 시도 */
        for (const v of values) {
          try {
            await db.insert(pendingDonations).values(v);
            importedCount++;
          } catch (rowErr: any) {
            insertErrors.push({
              rowIndex: v.sourceRowIndex,
              error: rowErr?.message || String(rowErr),
            });
          }
        }
      }
    }

    /* 8. 감사 로그 */
    try {
      await logAdminAction(req, admin.uid, admin.name, "donation_csv_import", {
        target: file.name,
        detail: {
          source,
          totalParsedRows: normalized.length,
          importedRows: importedCount,
          autoMatchedRows: autoMatchedCount,
          parseErrors: parseErrors.length,
          insertErrors: insertErrors.length,
          autoMatch,
        },
      });
    } catch { /* audit 실패는 본 흐름에 영향 없음 */ }

    /* 9. 응답 */
    const summary = `${importedCount}건 적재 완료 (자동 매칭 ${autoMatchedCount}건, 파싱 오류 ${parseErrors.length}건, 적재 오류 ${insertErrors.length}건)`;

    return ok({
      fileName: file.name,
      source,
      autoMatch,
      totalParsedRows: normalized.length,
      importedRows: importedCount,
      autoMatchedRows: autoMatchedCount,
      parseErrors: parseErrors.slice(0, 20),
      insertErrors: insertErrors.slice(0, 20),
    }, summary);
  } catch (err: any) {
    console.error("[admin-donation-import]", err);
    return serverError("CSV 적재 중 오류", err);
  }
};

export const config = { path: "/api/admin-donation-import" };
