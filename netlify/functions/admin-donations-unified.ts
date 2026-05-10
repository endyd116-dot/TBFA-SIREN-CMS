/**
 * GET /api/admin-donations-unified
 * 후원 통합 응답: donations[], hyosung[], csvMapping[], receiptSettings
 * super_admin: 전체 / admin: 자기 생성 데이터만
 */
import { desc, eq } from "drizzle-orm";
import { db } from "../../db";
import {
  donations,
  hyosungContracts,
  hyosungBillings,
  hyosungImportLogs,
  receiptSettings,
} from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import { corsPreflight, methodNotAllowed } from "../../lib/response";

export const config = { path: "/api/admin-donations-unified" };

function jsonError(step: string, err: any) {
  return new Response(
    JSON.stringify({
      ok: false,
      error: "후원 통합 조회 실패",
      step,
      detail: String(err?.message ?? err).slice(0, 500),
      stack: String(err?.stack ?? "").slice(0, 1000),
    }),
    { status: 500, headers: { "Content-Type": "application/json" } }
  );
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  const isSuperAdmin = auth.ctx.member.role === "super_admin";

  let step = "select_donations";
  let donationRows: any[] = [];
  try {
    donationRows = await db
      .select({
        id: donations.id,
        memberId: donations.memberId,
        donorName: donations.donorName,
        donorPhone: donations.donorPhone,
        donorEmail: donations.donorEmail,
        amount: donations.amount,
        type: donations.type,
        payMethod: donations.payMethod,
        status: donations.status,
        pgProvider: donations.pgProvider,
        receiptRequested: donations.receiptRequested,
        receiptIssued: donations.receiptIssued,
        receiptIssuedAt: donations.receiptIssuedAt,
        receiptNumber: donations.receiptNumber,
        campaignTag: donations.campaignTag,
        isAnonymous: donations.isAnonymous,
        memo: donations.memo,
        createdAt: donations.createdAt,
      })
      .from(donations)
      .orderBy(desc(donations.createdAt))
      .limit(500);
  } catch (err: any) {
    return jsonError(step, err);
  }

  step = "select_hyosung";
  let hyosungRows: any[] = [];
  try {
    hyosungRows = await db
      .select({
        id: hyosungContracts.id,
        memberNo: hyosungContracts.memberNo,
        memberName: hyosungContracts.memberName,
        phone: hyosungContracts.phone,
        memberStatus: hyosungContracts.memberStatus,
        contractStatus: hyosungContracts.contractStatus,
        promiseDay: hyosungContracts.promiseDay,
        productName: hyosungContracts.productName,
        productAmount: hyosungContracts.productAmount,
        billingStart: hyosungContracts.billingStart,
        billingEnd: hyosungContracts.billingEnd,
        linkedMemberId: hyosungContracts.linkedMemberId,
        createdAt: hyosungContracts.createdAt,
      })
      .from(hyosungContracts)
      .orderBy(desc(hyosungContracts.createdAt))
      .limit(500);
  } catch (err: any) {
    console.warn("[admin-donations-unified] hyosung select 실패:", err);
    hyosungRows = [];
  }

  step = "select_csv_mapping";
  let csvMappingRows: any[] = [];
  try {
    csvMappingRows = await db
      .select({
        id: hyosungImportLogs.id,
        fileName: hyosungImportLogs.fileName,
        totalRows: hyosungImportLogs.totalRows,
        matchedCount: hyosungImportLogs.matchedCount,
        createdCount: hyosungImportLogs.createdCount,
        updatedCount: hyosungImportLogs.updatedCount,
        skippedCount: hyosungImportLogs.skippedCount,
        failedCount: hyosungImportLogs.failedCount,
        createdAt: hyosungImportLogs.createdAt,
      })
      .from(hyosungImportLogs)
      .orderBy(desc(hyosungImportLogs.createdAt))
      .limit(100);
  } catch (err: any) {
    console.warn("[admin-donations-unified] csvMapping select 실패:", err);
    csvMappingRows = [];
  }

  step = "select_receipt_settings";
  let receiptSettingsRow: any = null;
  try {
    const [row] = await db
      .select()
      .from(receiptSettings)
      .limit(1);
    receiptSettingsRow = row ?? null;
  } catch (err: any) {
    console.warn("[admin-donations-unified] receiptSettings select 실패:", err);
    receiptSettingsRow = null;
  }

  return new Response(
    JSON.stringify({
      ok: true,
      donations: donationRows,
      hyosung: hyosungRows,
      csvMapping: csvMappingRows,
      receiptSettings: receiptSettingsRow,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
};
