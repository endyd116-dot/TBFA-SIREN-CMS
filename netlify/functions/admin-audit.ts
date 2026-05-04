// netlify/functions/admin-audit.ts
/**
 * GET /api/admin/audit            — 감사 로그 목록 조회 (super_admin 전용)
 * GET /api/admin/audit?id=N       — 단건 상세 조회 (★ M-16 신규)
 *
 * 쿼리 파라미터 (목록):
 * - page (1~), limit (10~100, 기본 50)
 * - action / userType / userId / success
 * - q (action / target / userName / detail 통합 검색)
 * - dateFrom / dateTo (ISO 날짜)
 *
 * 권한:
 * - 모든 admin이 GET 가능 (operator 포함) → ★ M-16에서 super_admin only로 강화
 *
 * 응답:
 * - 목록: { list, pagination, stats, filters }
 * - 단건: { log: {...전체 필드} }
 */
import { eq, desc, and, or, like, count, gte, lte, sql } from "drizzle-orm";
import { db, auditLogs, members } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, badRequest, notFound, forbidden, serverError,
  corsPreflight, methodNotAllowed,
} from "../../lib/response";

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  /* 1. 관리자 인증 */
  const guard: any = await requireAdmin(req);
  if (!guard.ok) return guard.res;
  /* ★ M-16: member.role 사용 (DB 최신값 + AdminPayload 타입 안정성) */
  const { member } = guard.ctx;

  /* ★ M-16: super_admin only 가드 */
  if (member.role !== "super_admin") {
    return forbidden("감사 로그는 슈퍼 관리자만 조회할 수 있습니다");
  }

  try {
    const url = new URL(req.url);

    /* ===== ★ M-16: 단건 상세 조회 (?id=N) ===== */
    const idStr = url.searchParams.get("id");
    if (idStr) {
      const id = Number(idStr);
      if (!Number.isFinite(id) || id < 1) return badRequest("id가 유효하지 않습니다");

      const [row] = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.id, id))
        .limit(1);

      if (!row) return notFound("로그를 찾을 수 없습니다");

      /* detail JSON 파싱 시도 (실패 시 원본 유지) */
      let detailParsed: any = null;
      if ((row as any).detail) {
        try {
          detailParsed = JSON.parse(String((row as any).detail));
        } catch (_) {
          detailParsed = null; // 원본은 row.detail에 그대로 보존
        }
      }

      return ok({
        log: {
          ...row,
          detailParsed, // 파싱 성공 시에만 객체, 아니면 null
        },
      });
    }

    /* ===== 목록 조회 ===== */

    /* 2. 파라미터 파싱 */
    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const limit = Math.min(100, Math.max(10, Number(url.searchParams.get("limit") || 50)));
    const action = url.searchParams.get("action") || "";
    const userType = url.searchParams.get("userType") || "";
    const userIdStr = url.searchParams.get("userId") || "";
    const successStr = url.searchParams.get("success") || "";
    const q = (url.searchParams.get("q") || "").trim();
    const dateFromStr = url.searchParams.get("dateFrom") || "";
    const dateToStr = url.searchParams.get("dateTo") || "";

    /* 3. WHERE 조건 조립 */
    const conditions: any[] = [];

    if (action) {
      conditions.push(eq(auditLogs.action, action));
    }

    if (userType && ["admin", "user", "system", "anonymous"].includes(userType)) {
      conditions.push(eq(auditLogs.userType, userType));
    }

    if (userIdStr) {
      const uid = Number(userIdStr);
      if (Number.isFinite(uid)) {
        conditions.push(eq(auditLogs.userId, uid));
      }
    }

    if (successStr === "true") {
      conditions.push(eq(auditLogs.success, true));
    } else if (successStr === "false") {
      conditions.push(eq(auditLogs.success, false));
    }

    if (q && q.length >= 2) {
      const likePattern = `%${q}%`;
      conditions.push(
        or(
          like(auditLogs.action, likePattern),
          like(auditLogs.target, likePattern),
          like(auditLogs.userName, likePattern),
          like(auditLogs.detail, likePattern),
        ),
      );
    }

    if (dateFromStr) {
      const dateFrom = new Date(dateFromStr);
      if (!isNaN(dateFrom.getTime())) {
        conditions.push(gte(auditLogs.createdAt, dateFrom));
      } else {
        return badRequest("dateFrom 형식이 올바르지 않습니다 (예: 2026-04-01)");
      }
    }

    if (dateToStr) {
      const dateTo = new Date(dateToStr);
      if (!isNaN(dateTo.getTime())) {
        /* dateTo는 그날 23:59:59까지 포함 */
        dateTo.setHours(23, 59, 59, 999);
        conditions.push(lte(auditLogs.createdAt, dateTo));
      } else {
        return badRequest("dateTo 형식이 올바르지 않습니다 (예: 2026-04-30)");
      }
    }

    const whereClause: any =
      conditions.length === 0
        ? undefined
        : conditions.length === 1
          ? conditions[0]
          : and(...conditions);

    /* 4. 총 개수 */
    const totalRows: any = await db
      .select({ total: count() })
      .from(auditLogs)
      .where(whereClause as any);
    const total = Number(totalRows[0]?.total ?? 0);

    /* 5. 목록 조회 (최신순) */
    const list = await db
      .select({
        id: auditLogs.id,
        userId: auditLogs.userId,
        userType: auditLogs.userType,
        userName: auditLogs.userName,
        action: auditLogs.action,
        target: auditLogs.target,
        detail: auditLogs.detail,
        ipAddress: auditLogs.ipAddress,
        userAgent: auditLogs.userAgent,
        success: auditLogs.success,
        errorMessage: auditLogs.errorMessage,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .where(whereClause as any)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);

    /* 6. 최근 7일 액션별 통계 (대시보드용) */
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const actionStats = await db
      .select({
        action: auditLogs.action,
        c: sql<number>`COUNT(*)`,
        successCount: sql<number>`COUNT(*) FILTER (WHERE ${auditLogs.success} = true)`,
        failCount: sql<number>`COUNT(*) FILTER (WHERE ${auditLogs.success} = false)`,
      })
      .from(auditLogs)
      .where(gte(auditLogs.createdAt, sevenDaysAgo))
      .groupBy(auditLogs.action)
      .orderBy(sql`COUNT(*) DESC`)
      .limit(20);

    /* 7. 전체 통계 (성공/실패) */
    const overallStats: any = await db
      .select({
        total: count(),
        successCount: sql<number>`COUNT(*) FILTER (WHERE ${auditLogs.success} = true)`,
        failCount: sql<number>`COUNT(*) FILTER (WHERE ${auditLogs.success} = false)`,
      })
      .from(auditLogs)
      .where(gte(auditLogs.createdAt, sevenDaysAgo));

    /* 8. 응답 */
    return ok({
      list,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      stats: {
        last7Days: {
          total: Number(overallStats[0]?.total ?? 0),
          success: Number(overallStats[0]?.successCount ?? 0),
          fail: Number(overallStats[0]?.failCount ?? 0),
        },
        topActions: actionStats.map((a: any) => ({
          action: a.action,
          count: Number(a.c),
          success: Number(a.successCount),
          fail: Number(a.failCount),
        })),
      },
      filters: {
        action,
        userType,
        userId: userIdStr,
        success: successStr,
        q,
        dateFrom: dateFromStr,
        dateTo: dateToStr,
      },
    });
  } catch (err) {
    console.error("[admin-audit]", err);
    return serverError("감사 로그 조회 중 오류", err);
  }
};

export const config = { path: "/api/admin/audit" };