// netlify/functions/admin-member-donations.ts
/**
 * GET /api/admin/member-donations?memberId=N&page=1&pageSize=30
 *
 * Phase 1 §6.2 (DESIGN_PHASE1.md, 2026-05-10 보강 7fb1b77)
 * — 회원별 후원 이력 + totalCount + totalAmount.
 * — cms-tbfa.html 회원 상세 모달 '후원 내역' 탭에서 호출.
 *
 * 응답 형태:
 *   `ok()` 헬퍼로 감싸 `{ ok, message, data: { ...payload } }` 형태.
 *   payload 안에 §6.2 키 (member, data, totalCount, totalAmount, page, pageSize) 포함.
 *
 * 단계별 try/catch + step·detail·stack (CLAUDE.md §6.2).
 * 보조 SELECT(통계 SUM/COUNT) 실패해도 0 폴백 — 메인 SELECT 보존.
 */

import { eq, desc, and, sql, count } from "drizzle-orm";
import { db, members, donations } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import { ok, badRequest, notFound, corsPreflight, methodNotAllowed } from "../../lib/response";

/* =========================================================
   Phase 1 §6.2 — 공개 API 계약 (DESIGN_PHASE1.md §6.2 SOT)
   ========================================================= */

export type DonationKind = "regular" | "onetime";
export type DonationChannel = "toss" | "hyosung" | "ibk" | "manual";

export interface AdminMemberDonationsQuery {
  memberId: number;            // required
  page?: number;
  pageSize?: number;           // default 30, max 200
}

export interface AdminMemberDonation {
  id: number;
  kind: DonationKind;
  channel: DonationChannel;
  amount: number;              // 원 단위
  paidAt: string;              // ISO8601
  status: string;              // 'completed' | 'pending' | 'failed' | 'cancelled' | 'refunded' | ...
  memo: string | null;
}

export interface AdminMemberDonationsResponse {
  ok: true;
  member: { id: number; name: string };
  data: AdminMemberDonation[];
  totalCount: number;          // 모든 후원 건수 누적 (페이지 무관)
  totalAmount: number;         // 'completed' 상태 후원 금액 누적 (영수증 통계 기준)
  page: number;
  pageSize: number;
}

/* =========================================================
   내부 헬퍼
   ========================================================= */

/** 단계별 에러 응답 (CLAUDE.md §6.2) */
function jsonError(step: string, err: any, status: number = 500) {
  return new Response(
    JSON.stringify({
      ok: false,
      error: "회원 후원 내역 조회 실패",
      step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }),
    { status, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

/** donations row → DonationChannel 매핑.
 *  payMethod / pgProvider / hyosung* / toss* 컬럼을 종합해 결정.
 *  순서: 토스 > 효성 > IBK(은행) > manual */
function resolveChannel(row: any): DonationChannel {
  const payMethod: string | null = row.payMethod || null;
  const pgProvider: string | null = row.pgProvider || null;
  const hasToss = !!row.tossPaymentKey || !!row.tossOrderId || !!row.billingKeyId;
  const hasHyosung = !!row.hyosungBillNo || !!row.hyosungContractNo || !!row.hyosungBillingId || !!row.hyosungMemberNo;

  if (hasToss || pgProvider === "toss" || payMethod === "card" || payMethod === "toss_card") {
    return "toss";
  }
  if (hasHyosung || payMethod === "cms" || payMethod === "hyosung") {
    return "hyosung";
  }
  if (payMethod === "bank") {
    /* 협회 계좌(IBK) 입금. DESIGN §6.2 enum 'ibk' 사용. */
    return "ibk";
  }
  return "manual";
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  /* ───── step: auth ───── */
  let auth: any;
  try {
    auth = await requireAdmin(req);
  } catch (err) {
    return jsonError("auth", err);
  }
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  try {
    const url = new URL(req.url);

    /* ───── step: parse_query ───── */
    const memberIdRaw = url.searchParams.get("memberId");
    if (!memberIdRaw) return badRequest("memberId가 필요합니다");
    const memberId = Number(memberIdRaw);
    if (!Number.isFinite(memberId) || memberId <= 0) {
      return badRequest("유효하지 않은 memberId");
    }

    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const pageSize = Math.min(
      200,
      Math.max(1, Number(url.searchParams.get("pageSize") || 30)),
    );
    const offset = (page - 1) * pageSize;

    /* ───── step: select_member ───── */
    let memberRow: { id: number; name: string } | null = null;
    try {
      const [m] = await db
        .select({ id: members.id, name: members.name })
        .from(members)
        .where(eq(members.id, memberId))
        .limit(1);
      memberRow = (m as any) ?? null;
    } catch (err) {
      return jsonError("select_member", err);
    }
    if (!memberRow) return notFound("회원을 찾을 수 없습니다");

    /* ───── step: select_donations (페이지 데이터, 메인 SELECT) ───── */
    let rows: any[] = [];
    try {
      rows = await db
        .select({
          id: donations.id,
          type: donations.type,
          status: donations.status,
          amount: donations.amount,
          payMethod: donations.payMethod,
          pgProvider: donations.pgProvider,
          tossPaymentKey: donations.tossPaymentKey,
          tossOrderId: donations.tossOrderId,
          billingKeyId: donations.billingKeyId,
          hyosungBillNo: donations.hyosungBillNo,
          hyosungContractNo: donations.hyosungContractNo,
          hyosungBillingId: donations.hyosungBillingId,
          hyosungMemberNo: donations.hyosungMemberNo,
          hyosungPaidDate: donations.hyosungPaidDate,
          memo: donations.memo,
          createdAt: donations.createdAt,
        })
        .from(donations)
        .where(eq(donations.memberId, memberId))
        .orderBy(desc(donations.createdAt))
        .limit(pageSize)
        .offset(offset);
    } catch (err) {
      return jsonError("select_donations", err);
    }

    /* ───── step: aggregate_stats (보조 SELECT — 실패해도 0 폴백) ───── */
    let totalCount = 0;
    let totalAmount = 0;
    try {
      /* 전체 건수 (페이지 무관, 모든 status) */
      const [c] = await db
        .select({ total: count() })
        .from(donations)
        .where(eq(donations.memberId, memberId));
      totalCount = Number((c as any)?.total ?? 0);
    } catch (err) {
      console.warn("[admin-member-donations] count 집계 실패, 0 폴백", err);
      totalCount = 0;
    }
    try {
      /* 누적 금액 — 완료 건만 (영수증 통계 기준, admin-member-detail.ts와 동일 정책) */
      const [s] = await db
        .select({
          totalAmount: sql<number>`COALESCE(SUM(${donations.amount}), 0)`,
        })
        .from(donations)
        .where(and(eq(donations.memberId, memberId), eq(donations.status, "completed")));
      totalAmount = Number((s as any)?.totalAmount ?? 0);
    } catch (err) {
      console.warn("[admin-member-donations] sum 집계 실패, 0 폴백", err);
      totalAmount = 0;
    }

    /* ───── step: map ───── */
    const data: AdminMemberDonation[] = rows.map((r) => {
      /* paidAt 우선순위: hyosungPaidDate > createdAt (효성은 실제 청구일자 우선) */
      const paid: any = r.hyosungPaidDate ?? r.createdAt;
      return {
        id: Number(r.id),
        kind: (r.type === "regular" ? "regular" : "onetime") as DonationKind,
        channel: resolveChannel(r),
        amount: Number(r.amount ?? 0),
        paidAt:
          paid instanceof Date
            ? paid.toISOString()
            : String(paid ?? ""),
        status: String(r.status ?? ""),
        memo: r.memo ?? null,
      };
    });

    /* ───── step: respond ─────
     *  ok() 헬퍼 사용 — 응답은 { ok, message, data: { ...payload } } 형태.
     *  payload 안의 'data' 키는 §6.2 AdminMemberDonation[]. */
    return ok({
      member: { id: memberRow.id, name: memberRow.name },
      data,
      totalCount,
      totalAmount,
      page,
      pageSize,
    });
  } catch (err) {
    return jsonError("unknown", err);
  }
};

export const config = { path: "/api/admin/member-donations" };
