// netlify/functions/admin-billing-keys.ts
// ★ Phase 2 Step 5-A: 빌링키 관리 API
// GET ?list=1  : 목록 + 회원 join + 통계
// GET ?id=N    : 단일 조회
// PATCH        : 만료월 / isActive / 기타 수정
// DELETE ?id=N : 강제 해지 (자동 감사 로그)

import { Context } from "@netlify/functions";
import { db } from "../../db";
import { billingKeys, members, billingLogs } from "../../db/schema";
import { eq, sql, and, desc } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";
import { ok, badRequest, methodNotAllowed, serverError, notFound } from "../../lib/response";
import { logAudit } from "../../lib/audit";

export default async (req: Request, _ctx: Context) => {
  const guard = await requireAdmin(req);
  if (!guard.ok) return guard.res;
  const admin = guard.ctx.admin;
  const adminMember = guard.ctx.member;

  const url = new URL(req.url);
  const ipAddress = req.headers.get("x-forwarded-for") || "unknown";
  const userAgent = req.headers.get("user-agent") || "";

  try {
    /* ===== GET: 조회 ===== */
    if (req.method === "GET") {
      const id = url.searchParams.get("id");
      const listFlag = url.searchParams.get("list");
      const statsFlag = url.searchParams.get("stats");

      // 통계 조회
      if (statsFlag === "1") {
        const total: any = await db.execute(sql`
          SELECT
            COUNT(*) AS total_count,
            COUNT(*) FILTER (WHERE is_active = true) AS active_count,
            COUNT(*) FILTER (WHERE is_active = false) AS deactivated_count,
            COUNT(*) FILTER (WHERE consecutive_fail_count >= 2) AS risky_count,
            COALESCE(SUM(amount) FILTER (WHERE is_active = true), 0) AS monthly_total
          FROM billing_keys
        `);
        const row = (Array.isArray(total) ? total[0] : (total as any).rows?.[0]) || {};
        return ok({
          totalCount: Number(row.total_count || 0),
          activeCount: Number(row.active_count || 0),
          deactivatedCount: Number(row.deactivated_count || 0),
          riskyCount: Number(row.risky_count || 0),
          monthlyTotal: Number(row.monthly_total || 0),
        });
      }

      // 단일 조회
      if (id) {
        const rowId = Number(id);
        if (!rowId) return badRequest("id 가 유효하지 않습니다");
        const [row]: any = await db
          .select({
            id: billingKeys.id,
            memberId: billingKeys.memberId,
            billingKey: billingKeys.billingKey,
            customerKey: billingKeys.customerKey,
            cardCompany: billingKeys.cardCompany,
            cardNumberMasked: billingKeys.cardNumberMasked,
            cardType: billingKeys.cardType,
            cardExpiryMonth: billingKeys.cardExpiryMonth,
            amount: billingKeys.amount,
            isActive: billingKeys.isActive,
            nextChargeAt: billingKeys.nextChargeAt,
            lastChargedAt: billingKeys.lastChargedAt,
            consecutiveFailCount: billingKeys.consecutiveFailCount,
            lastFailureReason: billingKeys.lastFailureReason,
            deactivatedAt: billingKeys.deactivatedAt,
            deactivatedReason: billingKeys.deactivatedReason,
            createdAt: billingKeys.createdAt,
            updatedAt: billingKeys.updatedAt,
            memberName: members.name,
            memberEmail: members.email,
            memberPhone: members.phone,
            nextBillingDate: members.nextBillingDate,
            billingDay: members.billingDay,
            billingRetryCount: members.billingRetryCount,
          })
          .from(billingKeys)
          .leftJoin(members, eq(members.id, billingKeys.memberId))
          .where(eq(billingKeys.id, rowId))
          .limit(1);
        if (!row) return notFound("빌링키를 찾을 수 없습니다");
        return ok({ item: row });
      }

      // 목록 조회
      if (listFlag === "1") {
        const page = Number(url.searchParams.get("page") || "1");
        const pageSize = Math.min(Number(url.searchParams.get("pageSize") || "50"), 200);
        const search = url.searchParams.get("search") || "";
        const status = url.searchParams.get("status") || ""; // 'active' | 'inactive' | ''
        const offset = (page - 1) * pageSize;

        const whereConds: any[] = [];
        if (status === "active") whereConds.push(eq(billingKeys.isActive, true));
        if (status === "inactive") whereConds.push(eq(billingKeys.isActive, false));
        if (search) {
          whereConds.push(
            sql`(${members.name} ILIKE ${`%${search}%`}
                 OR ${members.email} ILIKE ${`%${search}%`}
                 OR ${members.phone} LIKE ${`%${search}%`})`
          );
        }
        const whereClause = whereConds.length > 0
          ? sql`${sql.join(whereConds, sql` AND `)}`
          : undefined;

        const query: any = db
          .select({
            id: billingKeys.id,
            memberId: billingKeys.memberId,
            memberName: members.name,
            memberEmail: members.email,
            memberPhone: members.phone,
            cardCompany: billingKeys.cardCompany,
            cardNumberMasked: billingKeys.cardNumberMasked,
            cardType: billingKeys.cardType,
            cardExpiryMonth: billingKeys.cardExpiryMonth,
            amount: billingKeys.amount,
            isActive: billingKeys.isActive,
            nextChargeAt: billingKeys.nextChargeAt,
            lastChargedAt: billingKeys.lastChargedAt,
            consecutiveFailCount: billingKeys.consecutiveFailCount,
            nextBillingDate: members.nextBillingDate,
            billingDay: members.billingDay,
            createdAt: billingKeys.createdAt,
          })
          .from(billingKeys)
          .leftJoin(members, eq(members.id, billingKeys.memberId));

        const list: any = whereClause
          ? await query.where(whereClause).orderBy(desc(billingKeys.createdAt)).limit(pageSize).offset(offset)
          : await query.orderBy(desc(billingKeys.createdAt)).limit(pageSize).offset(offset);

        // 총 개수
        const countQ: any = whereClause
          ? db.select({ count: sql<number>`COUNT(*)::int` }).from(billingKeys).leftJoin(members, eq(members.id, billingKeys.memberId)).where(whereClause)
          : db.select({ count: sql<number>`COUNT(*)::int` }).from(billingKeys);
        const countRes: any = await countQ;
        const total = Number(countRes?.[0]?.count || 0);

        return ok({ list, page, pageSize, total });
      }

      return badRequest("list=1 / id / stats=1 중 하나의 파라미터가 필요합니다");
    }

    /* ===== PATCH: 수정 ===== */
    if (req.method === "PATCH") {
      const body: any = await req.json().catch(() => ({}));
      const id = Number(body.id);
      if (!id) return badRequest("id 필요");

      const [current] = await db.select().from(billingKeys).where(eq(billingKeys.id, id)).limit(1);
      if (!current) return notFound("빌링키 없음");

      const updates: any = {};
      if (typeof body.cardExpiryMonth === "string" || body.cardExpiryMonth === null) {
        updates.cardExpiryMonth = body.cardExpiryMonth;
      }
      if (typeof body.isActive === "boolean") {
        updates.isActive = body.isActive;
        if (body.isActive === false) {
          updates.deactivatedAt = new Date();
          updates.deactivatedReason = body.deactivatedReason || "관리자 수동 해지";
        } else {
          updates.deactivatedAt = null;
          updates.deactivatedReason = null;
          updates.consecutiveFailCount = 0;
          updates.lastFailureReason = null;
        }
      }
      if (typeof body.amount === "number" && body.amount > 0) {
        updates.amount = body.amount;
      }

      if (Object.keys(updates).length === 0) return badRequest("수정할 항목 없음");
      updates.updatedAt = new Date();

      await db.update(billingKeys).set(updates).where(eq(billingKeys.id, id));

      await logAudit({
        userId: admin.uid,
        userName: adminMember.name,
        userType: "admin",
        action: "billing_key_update",
        target: `billing_key:${id}`,
        detail: `fields:${Object.keys(updates).join(",")}`,
        ipAddress,
        userAgent,
      });

      return ok({ updated: true, id });
    }

    /* ===== DELETE: 강제 해지 (isActive = false + 사유 기록) ===== */
    if (req.method === "DELETE") {
      const id = Number(url.searchParams.get("id"));
      if (!id) return badRequest("id 필요");
      const reason = url.searchParams.get("reason") || "관리자 강제 해지";

      const [current] = await db.select().from(billingKeys).where(eq(billingKeys.id, id)).limit(1);
      if (!current) return notFound("빌링키 없음");

      await db.update(billingKeys)
        .set({
          isActive: false,
          deactivatedAt: new Date(),
          deactivatedReason: reason,
          updatedAt: new Date(),
        })
        .where(eq(billingKeys.id, id));

      // members.next_billing_date 비우기
      if (current.memberId) {
        await db.execute(sql`
          UPDATE members
          SET next_billing_date = NULL,
              updated_at = NOW()
          WHERE id = ${current.memberId}
        `);
      }

      await logAudit({
        userId: admin.uid,
        userName: adminMember.name,
        userType: "admin",
        action: "billing_key_force_deactivate",
        target: `billing_key:${id}`,
        detail: `reason:${reason}`,
        ipAddress,
        userAgent,
      });

      return ok({ deactivated: true, id });
    }

    return methodNotAllowed();
  } catch (error: any) {
    console.error("[admin-billing-keys] 오류:", error);
    return serverError(error?.message || "서버 오류");
  }
};
