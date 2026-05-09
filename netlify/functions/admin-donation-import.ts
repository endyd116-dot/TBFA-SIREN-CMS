/**
 * POST /api/admin-donation-import
 *
 * ★ Phase 3 D1·D2 보강 (2026-05-10):
 *   hyosung_contracts → hyosungContracts UPSERT + members 매칭/신규 생성 (M1·M2 라이브러리 사용)
 *   hyosung_billings  → hyosungBillings UPSERT + donations 생성
 *   ibk               → pending_donations 적재 (기존 #15 방식 유지)
 *
 * 폼 필드:
 *   file       : CSV 파일 (필수)
 *   source     : 'hyosung_billings' | 'hyosung_contracts' | 'ibk' | 'auto' (기본 'auto')
 *   autoMatch  : 'true' | 'false' (기본 'true', ibk에만 적용)
 */
import type { Context } from "@netlify/functions";
import { eq, inArray, and } from "drizzle-orm";
import crypto from "crypto";
import {
  db, pendingDonations, members, donations,
  hyosungContracts, hyosungBillings, signupSources,
} from "../../db";
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
import {
  mapContractRowToInsert, mapBillingRowToInsert,
} from "../../lib/hyosung-mapper";
import {
  buildContractMergeUpdate, buildNewMemberFromContract,
  evaluateDonorTypeFromContract, patchDonorChannels, SIREN_PRESERVED_COLUMNS,
} from "../../lib/hyosung-merge";

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_ROWS_PER_IMPORT = 5000;

type Source = "hyosung_billings" | "hyosung_contracts" | "ibk";

/* =========================================================
   공통: CSV 텍스트 디코딩
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
   D1: 효성 계약정보 → hyosungContracts UPSERT + members 매칭/신규 생성
   ========================================================= */
async function handleHyosungContracts(
  req: Request,
  csvText: string,
  file: File,
  admin: any,
  adminMember: any,
) {
  const r = parseContractsCsv(csvText);
  if (r.rows.length === 0) {
    return badRequest("파싱 가능한 계약정보 행이 없습니다", { parseErrors: r.errors.slice(0, 20) });
  }

  /* 기존 회원 매칭 (hyosungMemberNo IN [...]) */
  const memberNos = r.rows.map(row => row.memberNo).filter(Boolean) as number[];
  let existingMembersRows: { id: number; hyosungMemberNo: number | null; donorType: string | null; donorChannels: any }[] = [];
  try {
    if (memberNos.length > 0) {
      existingMembersRows = await db.select({
        id: members.id,
        hyosungMemberNo: members.hyosungMemberNo,
        donorType: members.donorType,
        donorChannels: members.donorChannels,
      }).from(members).where(inArray(members.hyosungMemberNo, memberNos));
    }
  } catch (e) { console.warn("[D1] members 조회 실패, 신규 생성 전용 모드", e); }
  const memberMap = new Map(existingMembersRows.map(m => [m.hyosungMemberNo!, m]));

  /* 가입경로 'hyosung_csv' id 조회 */
  let hyosungSourceId: number | null = null;
  try {
    const src = await db.select({ id: signupSources.id })
      .from(signupSources).where(eq(signupSources.code, "hyosung_csv")).limit(1);
    hyosungSourceId = src[0]?.id ?? null;
  } catch { /* fallback null */ }

  let matched = 0, created = 0, updatedContracts = 0, donorTypeChanged = 0;
  const errors: { rowIndex: number; reason: string }[] = [];

  for (const [idx, row] of r.rows.entries()) {
    try {
      /* 1. hyosungContracts UPSERT (memberNo unique) */
      const contractPayload = mapContractRowToInsert(row);
      const upsertResult = await db.insert(hyosungContracts)
        .values({ ...contractPayload, updatedAt: new Date() } as any)
        .onConflictDoUpdate({
          target: hyosungContracts.memberNo,
          set: { ...contractPayload, updatedAt: new Date() } as any,
        })
        .returning({ id: hyosungContracts.id });
      updatedContracts++;
      const contractId = upsertResult[0]?.id ?? null;

      /* 2. members 매칭 or 신규 생성 */
      const existingMember = memberMap.get(row.memberNo);
      let memberId: number | null = null;
      const typeEval = evaluateDonorTypeFromContract(row.contractStatus);

      if (existingMember) {
        const mergeUpdate = buildContractMergeUpdate(row);
        const newChannels = patchDonorChannels(
          Array.isArray(existingMember.donorChannels) ? existingMember.donorChannels as string[] : [],
          typeEval.channelAction,
        );
        const prevType = existingMember.donorType;
        await db.update(members)
          .set({ ...mergeUpdate, donorChannels: newChannels, donorEvaluatedAt: new Date() } as any)
          .where(eq(members.id, existingMember.id));
        memberId = existingMember.id;
        matched++;
        if (prevType !== typeEval.donorType) donorTypeChanged++;
      } else {
        /* 신규 회원 — email·passwordHash 임시 생성 (로그인 불가 계정) */
        const newMemberPayload = buildNewMemberFromContract(row, hyosungSourceId);
        const tempEmail = `hyosung_${row.memberNo}_${Date.now()}@noemail.siren.local`;
        const tempPwHash = crypto.randomBytes(32).toString("hex");
        const insResult = await db.insert(members)
          .values({
            ...newMemberPayload,
            email: tempEmail,
            passwordHash: tempPwHash,
            emailVerified: false,
          } as any)
          .returning({ id: members.id });
        memberId = insResult[0]?.id ?? null;
        created++;
        donorTypeChanged++;
      }

      /* 3. hyosungContracts.linkedMemberId 연결 */
      if (contractId && memberId) {
        await db.update(hyosungContracts)
          .set({ linkedMemberId: memberId } as any)
          .where(eq(hyosungContracts.id, contractId));
      }
    } catch (rowErr: any) {
      errors.push({ rowIndex: idx + 2, reason: String(rowErr?.message || rowErr).slice(0, 200) });
    }
  }

  try {
    await logAdminAction(req as any, admin.uid, admin.name, "hyosung_contracts_import", {
      target: file.name,
      detail: { totalRows: r.rows.length, matched, created, updatedContracts, errors: errors.length },
    });
  } catch { /* audit 실패 무시 */ }

  return ok({
    source: "hyosung_contracts",
    totalRows: r.rows.length,
    matched,
    created,
    updatedContracts,
    preservedColumns: Array.from(SIREN_PRESERVED_COLUMNS),
    donorTypeChanged,
    parseErrors: r.errors.slice(0, 20),
    errors: errors.slice(0, 20),
  }, `${matched}명 매칭, ${created}명 신규 생성, ${updatedContracts}건 계약 갱신`);
}

/* =========================================================
   D2: 효성 수납내역 → hyosungBillings UPSERT + donations 생성
   ========================================================= */
async function handleHyosungBillings(
  req: Request,
  csvText: string,
  file: File,
  admin: any,
  adminMember: any,
) {
  const r = parseBillingsCsv(csvText);
  if (r.rows.length === 0) {
    return badRequest("파싱 가능한 수납내역 행이 없습니다", { parseErrors: r.errors.slice(0, 20) });
  }

  const memberNos = r.rows.map(row => row.memberNo).filter(Boolean) as number[];
  let existingMembersRows: { id: number; hyosungMemberNo: number | null }[] = [];
  try {
    if (memberNos.length > 0) {
      existingMembersRows = await db.select({
        id: members.id, hyosungMemberNo: members.hyosungMemberNo,
      }).from(members).where(inArray(members.hyosungMemberNo, memberNos));
    }
  } catch (e) { console.warn("[D2] members 조회 실패", e); }
  const memberMap = new Map(existingMembersRows.map(m => [m.hyosungMemberNo!, m]));

  let matched = 0, unmatched = 0, donationsCreated = 0, billingsUpserted = 0;
  const errors: { rowIndex: number; reason: string }[] = [];

  for (const [idx, row] of r.rows.entries()) {
    try {
      const linkedMember = row.memberNo ? memberMap.get(row.memberNo) : null;
      const linkedMemberId = linkedMember?.id ?? null;
      if (linkedMember) matched++; else unmatched++;

      /* hyosungBillings — memberNo+billingMonth unique constraint 없으므로 SELECT → UPDATE/INSERT */
      const billingPayload = mapBillingRowToInsert(row, linkedMemberId);
      let billingId: number | null = null;

      const existingBilling = await db.select({ id: hyosungBillings.id })
        .from(hyosungBillings)
        .where(and(
          eq(hyosungBillings.memberNo, row.memberNo),
          eq(hyosungBillings.billingMonth, row.billingMonth || ""),
        ))
        .limit(1);

      if (existingBilling.length > 0) {
        await db.update(hyosungBillings)
          .set({ ...billingPayload, updatedAt: new Date() } as any)
          .where(eq(hyosungBillings.id, existingBilling[0].id));
        billingId = existingBilling[0].id;
      } else {
        const ins = await db.insert(hyosungBillings)
          .values(billingPayload as any)
          .returning({ id: hyosungBillings.id });
        billingId = ins[0]?.id ?? null;
      }
      billingsUpserted++;

      /* receivedAmount > 0 → donations 생성 (중복 방지) */
      if (row.receivedAmount && row.receivedAmount > 0 && row.billingMonth) {
        const existingDonation = await db.select({ id: donations.id })
          .from(donations)
          .where(and(
            eq(donations.hyosungMemberNo, row.memberNo),
            eq(donations.hyosungBillingMonth, row.billingMonth),
          ))
          .limit(1);

        if (existingDonation.length === 0) {
          await db.insert(donations).values({
            memberId: linkedMemberId,
            donorName: (row.memberName || `효성회원_${row.memberNo}`).slice(0, 50),
            donorPhone: row.phone,
            amount: row.receivedAmount,
            type: "regular",
            payMethod: (row.paymentMethod || row.paymentTool || "bank_transfer").slice(0, 20),
            status: "completed",
            pgProvider: "hyosung",
            hyosungMemberNo: row.memberNo,
            hyosungContractNo: row.contractNo,
            hyosungBillingMonth: row.billingMonth,
            hyosungReceiptStatus: row.receiptStatus,
            hyosungPaidDate: row.paymentDate ? new Date(row.paymentDate) : null,
            hyosungBillingId: billingId,
          } as any);
          donationsCreated++;
        }
      }
    } catch (rowErr: any) {
      errors.push({ rowIndex: idx + 2, reason: String(rowErr?.message || rowErr).slice(0, 200) });
    }
  }

  try {
    await logAdminAction(req as any, admin.uid, admin.name, "hyosung_billings_import", {
      target: file.name,
      detail: { totalRows: r.rows.length, matched, unmatched, donationsCreated, billingsUpserted, errors: errors.length },
    });
  } catch { /* audit 실패 무시 */ }

  return ok({
    source: "hyosung_billings",
    totalRows: r.rows.length,
    matched,
    unmatched,
    donationsCreated,
    billingsUpserted,
    parseErrors: r.errors.slice(0, 20),
    errors: errors.slice(0, 20),
  }, `${billingsUpserted}건 수납내역 저장, ${donationsCreated}건 후원 생성`);
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
        else return badRequest("CSV 양식 자동 감지 실패. source 파라미터로 명시하세요 (hyosung_billings | hyosung_contracts | ibk)");
      }
    }

    /* ★ Phase 3 D1·D2: 효성 분기 — M1·M2 라이브러리로 직접 처리 */
    if (source === "hyosung_contracts") {
      return await handleHyosungContracts(req, csvText, file, admin, adminMember);
    }
    if (source === "hyosung_billings") {
      return await handleHyosungBillings(req, csvText, file, admin, adminMember);
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
    }, `${importedCount}건 적재 완료 (자동 매칭 ${autoMatchedCount}건)`);

  } catch (err: any) {
    console.error("[admin-donation-import]", err);
    return serverError("CSV 적재 중 오류", err);
  }
};

export const config = { path: "/api/admin-donation-import" };
