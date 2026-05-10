// netlify/functions/admin-hyosung-import-contracts.ts
// ★ Phase 1: 효성 CMS+ 계약정보 CSV Import API
// POST: CSV 업로드 → parse → UPSERT hyosungContracts + 회원 매핑·신규 생성
// GET:  hyosungContracts 목록 조회
// ★ D1 (Phase 3): hyosung_member_no 우선 매칭 + 미매칭 시 신규 회원 자동 생성
//                  toContractStatusCode 영문 코드 즉시 반영 (cron 의존 제거)

import { Context } from "@netlify/functions";
import { db } from "../../db";
import {
  hyosungContracts,
  hyosungImportLogs,
  members,
} from "../../db/schema";
import { eq, sql, desc } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";
import { ok, badRequest, unauthorized, methodNotAllowed, serverError } from "../../lib/response";
import { parseContractsCsv } from "../../lib/hyosung-parser";
import { upsertMemberFromContract } from "../../lib/hyosung-members-parser";
import { logAudit } from "../../lib/audit";

export default async (req: Request, ctx: Context) => {
  const guard = await requireAdmin(req);
  if (!guard.ok) return (guard as { ok: false; res: Response }).res;
  const admin = guard.ctx.admin;
  const adminMember = guard.ctx.member;

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

      return ok({
        list: enriched,
        pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      });
    } catch (err: any) {
      console.error("[hyosung-contracts GET]", err);
      return serverError("계약 목록 조회 실패", err);
    }
  }

  /* ===== POST: CSV Import ===== */
  if (req.method === "POST") {
    try {
      const body: any = await req.json().catch(() => ({}));
      const csvText: string = body.csvText || "";
      const dryRun: boolean = !!body.dryRun;

      if (!csvText || csvText.length < 10) {
        return badRequest("CSV가 비어있습니다");
      }

      /* 1. 파싱 */
      const parsed = parseContractsCsv(csvText);
      if (parsed.rows.length === 0) {
        return badRequest("CSV 파싱 실패", {
          errors: parsed.errors,
          totalCount: parsed.totalCount,
        });
      }

      const report = {
        imported: 0,        // hyosungContracts 신규 INSERT
        updated: 0,         // hyosungContracts 기존 UPDATE
        linked: 0,          // 기존 회원 매칭 성공 (hyosung_no 또는 phone)
        autoCreated: 0,     // 미매칭 → 신규 회원 자동 생성
        unlinked: 0,        // conflict 또는 오류로 연결 불가
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
        return ok({ ...report, rowsPreview: parsed.rows.slice(0, 5) });
      }

      /* 2. 실제 Import (트랜잭션 없이 row별 처리 - Netlify Functions 환경) */
      for (const row of parsed.rows) {
        /* 2-1. 회원 매핑·생성 (D1: hyosung_no 우선 → phone → 신규 생성) */
        const upsert = await upsertMemberFromContract(row);
        const linkedMemberId: number | null = upsert.memberId ?? null;

        if (upsert.outcome === "matched_hyosung_no" || upsert.outcome === "matched_phone") {
          report.linked++;
        } else if (upsert.outcome === "created") {
          report.autoCreated++;
        } else if (upsert.outcome === "conflict") {
          report.conflicts.push({
            memberNo: row.memberNo,
            phone: row.phone ?? "",
            matches: upsert.conflictCount ?? 2,
          });
          report.unlinked++;
        } else {
          /* outcome === "error" */
          console.warn(`[hyosung-contracts] 회원 매핑 오류 memberNo=${row.memberNo}:`, upsert.error);
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
            } as any)
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
          } as any);
          report.imported++;
        }
      }

      /* 3. Import 로그 기록 */
      await db.insert(hyosungImportLogs).values({
        uploadedBy: admin.uid,
        uploadedByName: adminMember.name,
        fileName: body.fileName || "contracts.csv",
        fileSize: csvText.length,
        totalRows: parsed.totalCount,
        matchedCount: report.linked + report.autoCreated,
        createdCount: report.imported,
        updatedCount: report.updated,
        skippedCount: report.unlinked,
        failedCount: parsed.errors.length,
        detail: JSON.stringify({
          type: "contracts",
          autoCreated: report.autoCreated,
          conflicts: report.conflicts,
          parseErrors: parsed.errors,
        }).slice(0, 5000),
      });

      /* 4. 감사 로그 */
      await logAudit({
        userId: admin.uid,
        userName: adminMember.name,
        userType: "admin",
        action: "hyosung_contracts_import",
        target: "hyosung_contracts",
        detail: `imported:${report.imported} updated:${report.updated} linked:${report.linked}`,
        ipAddress: req.headers.get("x-forwarded-for") || "unknown",
        userAgent: req.headers.get("user-agent") || "",
        success: true,
      });

      return ok(report);
    } catch (err: any) {
      console.error("[hyosung-contracts POST]", err);
      return serverError("Import 실패", err);
    }
  }

  return methodNotAllowed();
};

export const config = {
  path: "/api/admin/hyosung-import-contracts",
};
