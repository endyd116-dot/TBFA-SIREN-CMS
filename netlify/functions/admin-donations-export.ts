/**
 * GET /api/admin-donations-export
 *
 * 수납내역 엑셀 내보내기 (효성 CMS+ 양식 28컬럼)
 *
 * 데이터 통합:
 *   - donations (주 테이블) LEFT JOIN
 *   - members (회원 정보)
 *   - hyosungBillings (효성 수납내역, linkedDonationId 매칭)
 *   - hyosungContracts (효성 계약 정보, memberNo 매칭)
 *
 * 효성으로 결제된 건은 hyosung_billings의 정확한 값을 사용,
 * 토스 카드/계좌이체로 결제된 건은 donations + member 데이터로 매핑.
 *
 * 쿼리 파라미터 (현재 결제 내역 화면 필터와 동일):
 *   - type: regular | onetime | all
 *   - status: pending | completed | failed | cancelled | refunded | all
 *   - from: YYYY-MM-DD (생성일 기준)
 *   - to: YYYY-MM-DD
 *
 * 응답:
 *   { ok: true, data: { items: [...28컬럼 객체...], total } }
 *   클라이언트에서 SheetJS로 .xlsx 변환 후 다운로드.
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import {
  donations, members, hyosungBillings, hyosungContracts,
} from "../../db/schema";
import { eq, and, gte, lte, desc, sql } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, badRequest, methodNotAllowed, serverError,
} from "../../lib/response";
import { logAudit } from "../../lib/audit";

/* ─── 한글 매핑 ─── */
const TYPE_KR: Record<string, string> = {
  regular: "정기후원",
  onetime: "일시후원",
};
const STATUS_KR: Record<string, string> = {
  pending: "대기",
  completed: "완료",
  failed: "실패",
  cancelled: "취소",
  refunded: "환불",
};
const MEMBER_TYPE_KR: Record<string, string> = {
  regular: "일반",
  family: "유가족",
  volunteer: "봉사자",
  admin: "관리자",
};
function payMethodKr(method: string | null | undefined, isHyosung: boolean): string {
  if (isHyosung) return "CMS";
  const m = (method || "").toLowerCase();
  if (m.includes("card") || m === "toss") return "카드";
  if (m.includes("bank")) return "계좌이체";
  if (m.includes("cms") || m.includes("hyosung")) return "CMS";
  return method || "";
}
function toYM(d: Date | string | null | undefined): string {
  if (!d) return "";
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return "";
  return `${dt.getFullYear()}/${String(dt.getMonth() + 1).padStart(2, "0")}`;
}
function toYMD(d: Date | string | null | undefined): string {
  if (!d) return "";
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return "";
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "GET") return methodNotAllowed();

  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;
  const adminMember = auth.ctx.member as any;
  const meId = adminMember.id as number;

  const url = new URL(req.url);
  const type = url.searchParams.get("type") || "";
  const status = url.searchParams.get("status") || "";
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  try {
    const conds: any[] = [];
    if (type === "regular" || type === "onetime") {
      conds.push(eq(donations.type, type as any));
    }
    if (["pending", "completed", "failed", "cancelled", "refunded"].includes(status)) {
      conds.push(eq(donations.status, status as any));
    }
    if (from) {
      const fromDate = new Date(from);
      if (!isNaN(fromDate.getTime())) conds.push(gte(donations.createdAt, fromDate));
    }
    if (to) {
      const toDate = new Date(to);
      if (!isNaN(toDate.getTime())) {
        toDate.setHours(23, 59, 59, 999);
        conds.push(lte(donations.createdAt, toDate));
      }
    }

    const rows: any = await db
      .select({
        d_id: donations.id,
        d_memberId: donations.memberId,
        d_donorName: donations.donorName,
        d_donorPhone: donations.donorPhone,
        d_amount: donations.amount,
        d_type: donations.type,
        d_payMethod: donations.payMethod,
        d_status: donations.status,
        d_memo: donations.memo,
        d_failureReason: donations.failureReason,
        d_createdAt: donations.createdAt,
        d_updatedAt: donations.updatedAt,
        d_hyosungContractNo: donations.hyosungContractNo,
        m_id: members.id,
        m_name: members.name,
        m_phone: members.phone,
        m_type: members.type,
        h_billingMonth: hyosungBillings.billingMonth,
        h_firstBillingMonth: hyosungBillings.firstBillingMonth,
        h_promiseDay: hyosungBillings.promiseDay,
        h_paymentDate: hyosungBillings.paymentDate,
        h_paymentMethod: hyosungBillings.paymentMethod,
        h_paymentTool: hyosungBillings.paymentTool,
        h_billingType: hyosungBillings.billingType,
        h_unreceivedHandling: hyosungBillings.unreceivedHandling,
        h_billingAmount: hyosungBillings.billingAmount,
        h_supplyAmount: hyosungBillings.supplyAmount,
        h_vatAmount: hyosungBillings.vatAmount,
        h_receivedAmount: hyosungBillings.receivedAmount,
        h_unpaidAmount: hyosungBillings.unpaidAmount,
        h_cancelAmount: hyosungBillings.cancelAmount,
        h_refundAmount: hyosungBillings.refundAmount,
        h_billingCompletionDate: hyosungBillings.billingCompletionDate,
        h_memo: hyosungBillings.memo,
        h_paymentResult: hyosungBillings.paymentResult,
        h_receiptStatus: hyosungBillings.receiptStatus,
        h_paymentStatus: hyosungBillings.paymentStatus,
        h_contractNo: hyosungBillings.contractNo,
        c_managerName: hyosungContracts.managerName,
        c_promiseDay: hyosungContracts.promiseDay,
      })
      .from(donations)
      .leftJoin(members, eq(donations.memberId, members.id))
      .leftJoin(hyosungBillings, eq(hyosungBillings.linkedDonationId, donations.id))
      .leftJoin(hyosungContracts, eq(hyosungContracts.memberNo, hyosungBillings.memberNo))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(donations.createdAt))
      .limit(5000);  // 안전 상한

    const items = rows.map((r: any, idx: number) => {
      const isHyosung = !!r.h_billingMonth;
      const status = String(r.d_status || "").toLowerCase();
      const amount = Number(r.d_amount || 0);
      return {
        "NO.": idx + 1,
        "회원번호": r.m_id ? String(r.m_id).padStart(8, "0") : "",
        "계약번호": r.d_hyosungContractNo || r.h_contractNo || "001",
        "회원명": r.m_name || r.d_donorName || "",
        "최초청구월": r.h_firstBillingMonth || toYM(r.d_createdAt),
        "청구월": r.h_billingMonth || toYM(r.d_createdAt),
        "납부자 휴대전화": r.m_phone || r.d_donorPhone || "",
        "상품": TYPE_KR[r.d_type] || r.d_type || "",
        "수납상태": r.h_receiptStatus || (status === "completed" ? "수납완료" : "수납대기"),
        "결제상태": STATUS_KR[status] || status || "",
        "결제방식": r.d_type === "regular" ? "자동결제" : "수동결제",
        "결제수단": payMethodKr(r.d_payMethod, isHyosung),
        "약정일": String(r.h_promiseDay || r.c_promiseDay || "").padStart(2, "0").slice(-2) || "",
        "결제일(납부기간)": r.h_paymentDate ? toYMD(r.h_paymentDate) : toYMD(r.d_createdAt),
        "청구타입": r.h_billingType || (r.d_type === "regular" ? "정기청구" : "일시청구"),
        "미수처리상태": r.h_unreceivedHandling || "-",
        "청구금액": Number(r.h_billingAmount ?? amount),
        "공급가액": Number(r.h_supplyAmount ?? amount),
        "부가세": Number(r.h_vatAmount ?? 0),
        "수납금액": Number(
          r.h_receivedAmount != null ? r.h_receivedAmount :
          (status === "completed" ? amount : 0)
        ),
        "미납금액": Number(
          r.h_unpaidAmount != null ? r.h_unpaidAmount :
          (["pending", "failed"].includes(status) ? amount : 0)
        ),
        "취소금액": Number(
          r.h_cancelAmount != null ? r.h_cancelAmount :
          (status === "cancelled" ? amount : 0)
        ),
        "환불금액": Number(
          r.h_refundAmount != null ? r.h_refundAmount :
          (status === "refunded" ? amount : 0)
        ),
        "청구완납일자": r.h_billingCompletionDate
          ? toYMD(r.h_billingCompletionDate)
          : (status === "completed" ? toYMD(r.d_updatedAt) : ""),
        "비고": r.h_memo || r.d_memo || "",
        "결제결과": r.h_paymentResult || r.d_failureReason || "",
        "회원구분": MEMBER_TYPE_KR[r.m_type] || (r.m_type ? r.m_type : "미지정"),
        "담당관리자": r.c_managerName || "교사유가족협의회",
      };
    });

    await logAudit({
      userId: meId, userType: "admin", userName: adminMember.name,
      action: "donations.export",
      target: `count:${items.length}`,
      detail: { type, status, from, to, count: items.length },
      req,
    });

    return ok({ items, total: items.length });
  } catch (err: any) {
    console.error("[admin-donations-export]", err);
    return serverError("수납내역 내보내기 실패", err);
  }
};

export const config = { path: "/api/admin-donations-export" };
