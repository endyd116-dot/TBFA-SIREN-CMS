// netlify/functions/admin-hyosung-import-billings.ts
// ★ Phase 1: 효성 CMS+ 청구/수납 내역 CSV Import API
// POST: CSV → parse → UPSERT hyosungBillings + 완납 row 자동 donations 생성
// GET:  hyosungBillings 월별 목록 조회
// ★ D2 (Phase 3): 완납 donations 생성 후 donor_type 즉시 재평가 (safeReevaluate)

import { Context } from "@netlify/functions";
import { db } from "../../db";
import {
  hyosungBillings,
  hyosungContracts,
  donations,
  hyosungImportLogs,
} from "../../db/schema";
import { eq, sql, and, desc } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok,
  badRequest,
  unauthorized,
  methodNotAllowed,
  serverError,
} from "../../lib/response";
import { parseBillingsCsv } from "../../lib/hyosung-parser";
import { safeReevaluate } from "../../lib/donor-status";
import { logAudit } from "../../lib/audit";

export default async (req: Request, ctx: Context) => {
  const guard = await requireAdmin(req);
  if (!guard.ok) return (guard as { ok: false; res: Response }).res;
  const admin = guard.ctx.admin;
  const adminMember = guard.ctx.member;

  const url = new URL(req.url);

  /* ===== GET: 월별 청구 목록 ===== */
  if (req.method === "GET") {
    try {
      const page = Number(url.searchParams.get("page") || "1");
      const pageSize = Math.min(Number(url.searchParams.get("pageSize") || "50"), 200);
      const month = url.searchParams.get("month") || ""; // "2026/05"
      const status = url.searchParams.get("status") || ""; // 완납/미납/수납대기
      const search = url.searchParams.get("search") || "";

      const offset = (page - 1) * pageSize;

      const whereConditions: any[] = [];
      if (month) whereConditions.push(eq(hyosungBillings.billingMonth, month));
      if (status) whereConditions.push(eq(hyosungBillings.receiptStatus, status));
      if (search) {
        whereConditions.push(
          sql`(${hyosungBillings.memberName} ILIKE ${`%${search}%`} OR ${hyosungBillings.phone} LIKE ${`%${search}%`})`
        );
      }

      const whereClause = whereConditions.length > 0
        ? sql`${sql.join(whereConditions, sql` AND `)}`
        : undefined;

      const query: any = db
        .select({
          id: hyosungBillings.id,
          memberNo: hyosungBillings.memberNo,
          memberName: hyosungBillings.memberName,
          phone: hyosungBillings.phone,
          billingMonth: hyosungBillings.billingMonth,
          productName: hyosungBillings.productName,
          billingAmount: hyosungBillings.billingAmount,
          receivedAmount: hyosungBillings.receivedAmount,
          unpaidAmount: hyosungBillings.unpaidAmount,
          receiptStatus: hyosungBillings.receiptStatus,
          paymentStatus: hyosungBillings.paymentStatus,
          paymentMethod: hyosungBillings.paymentMethod,
          paymentTool: hyosungBillings.paymentTool,
          promiseDay: hyosungBillings.promiseDay,
          paymentDate: hyosungBillings.paymentDate,
          linkedDonationId: hyosungBillings.linkedDonationId,
          createdAt: hyosungBillings.createdAt,
        })
        .from(hyosungBillings);

      if (whereClause) query.where(whereClause);

      const list = await query
        .orderBy(desc(hyosungBillings.billingMonth), desc(hyosungBillings.createdAt))
        .limit(pageSize)
        .offset(offset);

      const countRes: any = await db.execute(
        whereClause
          ? sql`SELECT COUNT(*)::int AS c FROM hyosung_billings WHERE ${whereClause}`
          : sql`SELECT COUNT(*)::int AS c FROM hyosung_billings`
      );
      const total = countRes.rows?.[0]?.c ?? countRes[0]?.c ?? 0;

      /* 월별 통계 (같은 필터로) */
      const statsRes: any = await db.execute(
        whereClause
          ? sql`SELECT receipt_status, COUNT(*)::int AS c, COALESCE(SUM(billing_amount), 0)::int AS amount FROM hyosung_billings WHERE ${whereClause} GROUP BY receipt_status`
          : sql`SELECT receipt_status, COUNT(*)::int AS c, COALESCE(SUM(billing_amount), 0)::int AS amount FROM hyosung_billings GROUP BY receipt_status`
      );
      const stats = (statsRes.rows || statsRes || []).reduce((acc: any, r: any) => {
        acc[r.receipt_status || "unknown"] = { count: r.c, amount: r.amount };
        return acc;
      }, {});

      return ok({
        list,
        pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
        stats,
      });
    } catch (err: any) {
      console.error("[hyosung-billings GET]", err);
      return serverError("청구 목록 조회 실패", err);
    }
  }

  /* ===== POST: CSV Import ===== */
  if (req.method === "POST") {
    try {
      const body: any = await req.json().catch(() => ({}));
      const csvText: string = body.csvText || "";
      const dryRun: boolean = !!body.dryRun;
      const autoConfirmDonations: boolean = body.autoConfirmDonations !== false; // 기본 true

      if (!csvText || csvText.length < 10) {
        return badRequest("CSV가 비어있습니다");
      }

      /* 1. 파싱 */
      const parsed = parseBillingsCsv(csvText);
      if (parsed.rows.length === 0) {
        return badRequest("CSV 파싱 실패", {
          errors: parsed.errors,
          totalCount: parsed.totalCount,
        });
      }

      const report = {
        imported: 0,           // 신규 INSERT
        updated: 0,            // 기존 UPDATE
        autoConfirmed: 0,      // donations에 자동 추가
        skippedNoLink: 0,      // contracts에 linked_member 없어서 스킵
        skippedDuplicate: 0,   // 이미 donations에 있음
        skippedNotPaid: 0,     // 완납 아님
        parseErrors: parsed.errors,
        dryRun,
      };

      if (dryRun) {
        /* 미리보기: 상태별 카운트만 */
        const statusCount: Record<string, number> = {};
        parsed.rows.forEach(r => {
          const s = r.receiptStatus || "unknown";
          statusCount[s] = (statusCount[s] || 0) + 1;
        });
        return ok({
          ...report,
          statusCount,
          totalRows: parsed.rows.length,
          rowsPreview: parsed.rows.slice(0, 5),
        });
      }

      /* 2. contracts 매핑 (memberNo → linkedMemberId) 한 번만 조회 */
      const contractsRes = await db
        .select({
          memberNo: hyosungContracts.memberNo,
          linkedMemberId: hyosungContracts.linkedMemberId,
        })
        .from(hyosungContracts);
      const memberMap: Record<number, number | null> = {};
      contractsRes.forEach(c => {
        memberMap[c.memberNo] = c.linkedMemberId;
      });

      /* 3. row 별 처리 */
      for (const row of parsed.rows) {
        /* 3-1. hyosung_billings UPSERT (member_no + billing_month + product_name) */
        const existing = await db
          .select({ id: hyosungBillings.id, linkedDonationId: hyosungBillings.linkedDonationId })
          .from(hyosungBillings)
          .where(
            and(
              eq(hyosungBillings.memberNo, row.memberNo),
              eq(hyosungBillings.billingMonth, row.billingMonth),
              row.productName
                ? eq(hyosungBillings.productName, row.productName)
                : sql`${hyosungBillings.productName} IS NULL`
            )
          );

        let billingRowId: number;

        const billingFields = {
          memberName: row.memberName,
          phone: row.phone,
          contractNo: row.contractNo,
          firstBillingMonth: row.firstBillingMonth,
          productName: row.productName,
          billingAmount: row.billingAmount,
          supplyAmount: row.supplyAmount,
          vatAmount: row.vatAmount,
          receivedAmount: row.receivedAmount,
          unpaidAmount: row.unpaidAmount,
          cancelAmount: row.cancelAmount,
          refundAmount: row.refundAmount,
          receiptStatus: row.receiptStatus,
          paymentStatus: row.paymentStatus,
          paymentMethod: row.paymentMethod,
          paymentTool: row.paymentTool,
          promiseDay: row.promiseDay,
          paymentDate: row.paymentDate ? new Date(row.paymentDate) : null,
          billingType: row.billingType,
          unreceivedHandling: row.unreceivedHandling,
          memo: row.memo,
          paymentResult: row.paymentResult,
          rawData: row.rawData,
          updatedAt: new Date(),
        };

        if (existing.length > 0) {
          await db.update(hyosungBillings)
            .set(billingFields as any)
            .where(eq(hyosungBillings.id, existing[0].id));
          billingRowId = existing[0].id;
          report.updated++;
        } else {
          const inserted = await db.insert(hyosungBillings).values({
            memberNo: row.memberNo,
            billingMonth: row.billingMonth,
            ...billingFields,
          } as any).returning({ id: hyosungBillings.id });
          billingRowId = inserted[0].id;
          report.imported++;
        }

        /* 3-2. 완납 자동 donations 처리 */
        if (!autoConfirmDonations) continue;
        if (row.receiptStatus !== "완납") {
          report.skippedNotPaid++;
          continue;
        }

        const linkedMemberId = memberMap[row.memberNo];
        if (!linkedMemberId) {
          report.skippedNoLink++;
          continue;
        }

        /* 이미 donations에 같은 member + 같은 billing_month 가 있는지 체크 */
        const existingDonation = await db
          .select({ id: donations.id })
          .from(donations)
          .where(
            and(
              eq(donations.memberId, linkedMemberId),
              eq(donations.hyosungMemberNo, row.memberNo),
              eq(donations.hyosungBillingMonth, row.billingMonth)
            )
          );

        if (existingDonation.length > 0) {
          /* 이미 있으면 linkedDonationId만 보장 */
          if (!existing[0]?.linkedDonationId) {
              await db.update(hyosungBillings)
              .set({ linkedDonationId: existingDonation[0].id } as any)
              .where(eq(hyosungBillings.id, billingRowId));
          }
          report.skippedDuplicate++;
          continue;
        }

        /* donations INSERT */
        const donationAmount = row.receivedAmount > 0 ? row.receivedAmount : (row.billingAmount || 0);
        if (donationAmount <= 0) {
          report.skippedNotPaid++;
          continue;
        }

        const insertedDonation = await db.insert(donations).values({
          memberId: linkedMemberId,
          donorName: row.memberName || "Unknown",
          donorPhone: row.phone,
          amount: donationAmount,
          type: row.productName === "일시후원" ? "onetime" : "regular",
          payMethod: row.paymentTool === "카드" ? "toss_card" : "hyosung",
          status: "completed",
          pgProvider: "hyosung",
          hyosungMemberNo: row.memberNo,
          hyosungBillingMonth: row.billingMonth,
          hyosungReceiptStatus: row.receiptStatus,
          hyosungPaidDate: row.paymentDate ? new Date(row.paymentDate) : null,
          campaignTag: row.productName,
        } as any).returning({ id: donations.id });

        const donationId = insertedDonation[0].id;

        /* hyosungBillings.linkedDonationId 갱신 */
        await db.update(hyosungBillings)
          .set({ linkedDonationId: donationId } as any)
          .where(eq(hyosungBillings.id, billingRowId));

        /* donations에 hyosungBillingId 역참조 */
        await db.update(donations)
          .set({ hyosungBillingId: billingRowId } as any)
          .where(eq(donations.id, donationId));

        report.autoConfirmed++;
        /* ★ D2: 새 donation 생성 → donor_type 잠재 후원자 즉시 반영 */
        await safeReevaluate(linkedMemberId, "hyosung-billings-import");
      }

      /* 4. Import 로그 */
      await db.insert(hyosungImportLogs).values({
        uploadedBy: admin.uid,
        uploadedByName: adminMember.name,
        fileName: body.fileName || "billings.csv",
        fileSize: csvText.length,
        totalRows: parsed.totalCount,
        matchedCount: report.autoConfirmed,
        createdCount: report.imported,
        updatedCount: report.updated,
        skippedCount: report.skippedDuplicate + report.skippedNotPaid + report.skippedNoLink,
        failedCount: parsed.errors.length,
        detail: JSON.stringify({
          type: "billings",
          autoConfirmed: report.autoConfirmed,
          parseErrors: parsed.errors,
        }).slice(0, 5000),
      });

      /* 5. 감사 로그 */
      await logAudit({
        userId: admin.uid,
        userName: adminMember.name,
        userType: "admin",
        action: "hyosung_billings_import",
        target: "hyosung_billings",
        detail: `imported:${report.imported} updated:${report.updated} autoConfirmed:${report.autoConfirmed}`,
        ipAddress: req.headers.get("x-forwarded-for") || "unknown",
        userAgent: req.headers.get("user-agent") || "",
        success: true,
      });

      return ok(report);
    } catch (err: any) {
      console.error("[hyosung-billings POST]", err);
      return serverError("Import 실패", err);
    }
  }

  return methodNotAllowed();
};

export const config = {
  path: "/api/admin/hyosung-import-billings",
};
