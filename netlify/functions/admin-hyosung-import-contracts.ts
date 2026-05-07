// netlify/functions/admin-hyosung-import-contracts.ts
// ★ Phase 1: 효성 CMS+ 계약정보 CSV Import API
// POST: CSV 업로드 → parse → UPSERT hyosungContracts + phone 매칭
// GET:  hyosungContracts 목록 조회

import { Context } from "@netlify/functions";
import { db } from "../../db";
import {
  hyosungContracts,
  members,
  hyosungImportLogs,
} from "../../db/schema";
import { eq, sql, and, desc } from "drizzle-orm";
import { authenticateAdmin } from "../../lib/auth";
import { success, fail } from "../../lib/response";
import { parseContractsCsv } from "../../lib/hyosung-parser";
import { logAudit } from "../../lib/audit";

export default async (req: Request, ctx: Context) => {
  const auth = authenticateAdmin(req);
  if (!auth.ok) return fail("UNAUTHORIZED", 401);

  const url = new URL(req.url);

  /* ===== GET: 계약 목록 조회 ===== */
  if (req.method === "GET") {
    try {
      const page = Number(url.searchParams.get("page") || "1");
      const pageSize = Math.min(Number(url.searchParams.get("pageSize") || "50"), 200);
      const search = url.searchParams.get("search") || "";
      const status = url.searchParams.get("status") || "";

      const offset = (page - 1) * pageSize;

      const whereConditions: any[] = [];
      if (search) {
        whereConditions.push(
          sql`(${hyosungContracts.memberName} ILIKE ${`%${search}%`} OR ${hyosungContracts.phone} LIKE ${`%${search}%`})`
        );
      }
      if (status) {
        whereConditions.push(eq(hyosungContracts.contractStatus, status));
      }

      const whereClause = whereConditions.length > 0
        ? sql`${sql.join(whereConditions, sql` AND `)}`
        : undefined;

      const query: any = db
        .select({
          id: hyosungContracts.id,
          memberNo: hyosungContracts.memberNo,
          memberName: hyosungContracts.memberName,
          phone: hyosungContracts.phone,
          memberStatus: hyosungContracts.memberStatus,
          contractStatus: hyosungContracts.contractStatus,
          productName: hyosungContracts.productName,
          productAmount: hyosungContracts.productAmount,
          promiseDay: hyosungContracts.promiseDay,
          paymentMethod: hyosungContracts.paymentMethod,
          paymentTool: hyosungContracts.paymentTool,
          paymentInfo: hyosungContracts.paymentInfo,
          billingStart: hyosungContracts.billingStart,
          billingEnd: hyosungContracts.billingEnd,
          linkedMemberId: hyosungContracts.linkedMemberId,
          createdAt: hyosungContracts.createdAt,
          updatedAt: hyosungContracts.updatedAt,
        })
        .from(hyosungContracts);

      if (whereClause) query.where(whereClause);

      const list = await query
        .orderBy(desc(hyosungContracts.updatedAt))
        .limit(pageSize)
        .offset(offset);

      const countRes: any = await db.execute(
        whereClause
          ? sql`SELECT COUNT(*)::int AS c FROM hyosung_contracts WHERE ${whereClause}`
          : sql`SELECT COUNT(*)::int AS c FROM hyosung_contracts`
      );
      const total = countRes.rows?.[0]?.c ?? countRes[0]?.c ?? 0;

      /* linked_member_id 존재하는 row의 members 이름 JOIN */
      const linkedIds = list.map((r: any) => r.linkedMemberId).filter(Boolean);
      let memberNameMap: Record<number, string> = {};
      if (linkedIds.length > 0) {
        const memberRows = await db
          .select({ id: members.id, name: members.name })
          .from(members)
          .where(sql`${members.id} = ANY(${linkedIds})`);
        memberNameMap = Object.fromEntries(memberRows.map(m => [m.id, m.name]));
      }

      const enriched = list.map((r: any) => ({
        ...r,
        linkedMemberName: r.linkedMemberId ? memberNameMap[r.linkedMemberId] || null : null,
      }));

      return success({
        list: enriched,
        pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      });
    } catch (err: any) {
      console.error("[hyosung-contracts GET]", err);
      return fail("LIST_FAILED", 500, { detail: String(err?.message || err) });
    }
  }

  /* ===== POST: CSV Import ===== */
  if (req.method === "POST") {
    try {
      const body: any = await req.json().catch(() => ({}));
      const csvText: string = body.csvText || "";
      const dryRun: boolean = !!body.dryRun;

      if (!csvText || csvText.length < 10) {
        return fail("CSV_EMPTY", 400);
      }

      /* 1. 파싱 */
      const parsed = parseContractsCsv(csvText);
      if (parsed.rows.length === 0) {
        return fail("PARSE_FAILED", 400, {
          errors: parsed.errors,
          totalCount: parsed.totalCount,
        });
      }

      const report = {
        imported: 0,       // 신규 INSERT
        updated: 0,        // 기존 UPDATE
        linked: 0,         // members와 연결됨
        unlinked: 0,       // 매칭 없음
        conflicts: [] as Array<{ memberNo: number; phone: string; matches: number }>,
        parseErrors: parsed.errors,
        dryRun,
      };

      if (dryRun) {
        /* 미리보기 모드: 매칭만 확인 */
        for (const row of parsed.rows) {
          if (row.phone) {
            const matched = await db
              .select({ id: members.id, name: members.name })
              .from(members)
              .where(eq(members.phone, row.phone));
            if (matched.length === 1) report.linked++;
            else if (matched.length > 1) {
              report.conflicts.push({ memberNo: row.memberNo, phone: row.phone, matches: matched.length });
            } else {
              report.unlinked++;
            }
          } else {
            report.unlinked++;
          }
        }
        return success({ ...report, rowsPreview: parsed.rows.slice(0, 5) });
      }

      /* 2. 실제 Import (트랜잭션 없이 row별 처리 - Netlify Functions 환경) */
      for (const row of parsed.rows) {
        /* 2-1. phone 매칭 */
        let linkedMemberId: number | null = null;

        if (row.phone) {
          const matched = await db
            .select({ id: members.id })
            .from(members)
            .where(eq(members.phone, row.phone));

          if (matched.length === 1) {
            linkedMemberId = matched[0].id;
            report.linked++;

            /* members 테이블 hyosung_* 7컬럼 갱신 */
            await db.update(members)
              .set({
                hyosungMemberNo: row.memberNo,
                hyosungContractStatus: row.contractStatus,
                hyosungPaymentMethod: row.paymentMethod,
                hyosungPaymentTool: row.paymentTool,
                hyosungBankInfo: row.paymentInfo,
                hyosungPromiseDay: row.promiseDay,
                hyosungSyncedAt: new Date(),
              })
              .where(eq(members.id, linkedMemberId));
          } else if (matched.length > 1) {
            report.conflicts.push({ memberNo: row.memberNo, phone: row.phone, matches: matched.length });
            report.unlinked++;
          } else {
            report.unlinked++;
          }
        } else {
          report.unlinked++;
        }

        /* 2-2. hyosung_contracts UPSERT */
        const existing = await db
          .select({ id: hyosungContracts.id })
          .from(hyosungContracts)
          .where(eq(hyosungContracts.memberNo, row.memberNo));

        if (existing.length > 0) {
          /* UPDATE */
          await db.update(hyosungContracts)
            .set({
              memberName: row.memberName,
              phone: row.phone,
              memberStatus: row.memberStatus,
              contractStatus: row.contractStatus,
              promiseDay: row.promiseDay,
              paymentMethod: row.paymentMethod,
              paymentTool: row.paymentTool,
              paymentInfo: row.paymentInfo,
              accountHolder: row.accountHolder,
              registrationStatus: row.registrationStatus,
              agreementStatus: row.agreementStatus,
              electronicContract: row.electronicContract,
              productName: row.productName,
              productAmount: row.productAmount,
              billingStart: row.billingStart ? new Date(row.billingStart) : null,
              billingEnd: row.billingEnd ? new Date(row.billingEnd) : null,
              managerName: row.managerName,
              memberType: row.memberType,
              billingAuto: row.billingAuto,
              sendMethod: row.sendMethod,
              linkedMemberId,
              rawData: row.rawData,
              updatedAt: new Date(),
            })
            .where(eq(hyosungContracts.memberNo, row.memberNo));
          report.updated++;
        } else {
          /* INSERT */
          await db.insert(hyosungContracts).values({
            memberNo: row.memberNo,
            memberName: row.memberName,
            phone: row.phone,
            memberStatus: row.memberStatus,
            contractStatus: row.contractStatus,
            promiseDay: row.promiseDay,
            paymentMethod: row.paymentMethod,
            paymentTool: row.paymentTool,
            paymentInfo: row.paymentInfo,
            accountHolder: row.accountHolder,
            registrationStatus: row.registrationStatus,
            agreementStatus: row.agreementStatus,
            electronicContract: row.electronicContract,
            productName: row.productName,
            productAmount: row.productAmount,
            billingStart: row.billingStart ? new Date(row.billingStart) : null,
            billingEnd: row.billingEnd ? new Date(row.billingEnd) : null,
            managerName: row.managerName,
            memberType: row.memberType,
            billingAuto: row.billingAuto,
            sendMethod: row.sendMethod,
            linkedMemberId,
            rawData: row.rawData,
          });
          report.imported++;
        }
      }

      /* 3. Import 로그 기록 */
      await db.insert(hyosungImportLogs).values({
        uploadedBy: auth.admin.id,
        uploadedByName: auth.admin.name,
        fileName: body.fileName || "contracts.csv",
        fileSize: csvText.length,
        totalRows: parsed.totalCount,
        matchedCount: report.linked,
        createdCount: report.imported,
        updatedCount: report.updated,
        skippedCount: 0,
        failedCount: parsed.errors.length,
        detail: JSON.stringify({
          type: "contracts",
          conflicts: report.conflicts,
          parseErrors: parsed.errors,
        }).slice(0, 5000),
      });

      /* 4. 감사 로그 */
      await logAudit({
        userId: auth.admin.id,
        userName: auth.admin.name,
        userType: "admin",
        action: "hyosung_contracts_import",
        target: "hyosung_contracts",
        detail: `imported:${report.imported} updated:${report.updated} linked:${report.linked}`,
        ipAddress: req.headers.get("x-forwarded-for") || "unknown",
        userAgent: req.headers.get("user-agent") || "",
        success: true,
      });

      return success(report);
    } catch (err: any) {
      console.error("[hyosung-contracts POST]", err);
      return fail("IMPORT_FAILED", 500, { detail: String(err?.message || err) });
    }
  }

  return fail("METHOD_NOT_ALLOWED", 405);
};

export const config = {
  path: "/api/admin/hyosung-import-contracts",
};
