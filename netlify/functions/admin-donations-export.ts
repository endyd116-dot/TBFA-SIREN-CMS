/**
 * GET /api/admin-donations-export
 *
 * 수납내역 엑셀 내보내기 (효성 양식 28컬럼)
 *
 * 안정성: JOIN 체인 대신 separate query + JS map 매칭.
 *
 * 필터: type, status, from, to
 * 응답: { items: [...28컬럼...], total }
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import {
  donations, members, hyosungBillings, hyosungContracts,
} from "../../db/schema";
import { eq, and, gte, lte, desc, inArray, isNotNull } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";
import { ok, methodNotAllowed } from "../../lib/response";
import { logAudit } from "../../lib/audit";

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
    /* ─── 1. donations SELECT ─── */
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

    const donationRows: any = await db
      .select()
      .from(donations)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(donations.createdAt))
      .limit(5000);

    if (!donationRows.length) {
      return ok({ items: [], total: 0 });
    }

    /* ─── 2. 관련 데이터 SELECT (필요한 ID만) ─── */
    const memberIds = Array.from(new Set(donationRows.map((d: any) => d.memberId).filter(Boolean)));
    const donationIds = donationRows.map((d: any) => d.id);

    const memberRows: any = memberIds.length
      ? await db
          .select({
            id: members.id,
            name: members.name,
            phone: members.phone,
            type: members.type,
          })
          .from(members)
          .where(inArray(members.id, memberIds as any))
      : [];

    const billingRows: any = donationIds.length
      ? await db
          .select()
          .from(hyosungBillings)
          .where(inArray(hyosungBillings.linkedDonationId, donationIds as any))
      : [];

    const contractRows: any = await db
      .select()
      .from(hyosungContracts)
      .where(isNotNull(hyosungContracts.memberNo))
      .limit(10000);

    /* ─── 3. JS map 매칭 ─── */
    const memberById: Record<number, any> = {};
    for (const m of memberRows) memberById[m.id] = m;

    const billingByDonationId: Record<number, any> = {};
    for (const b of billingRows) {
      if (b.linkedDonationId) billingByDonationId[b.linkedDonationId] = b;
    }

    const contractByMemberNo: Record<number, any> = {};
    for (const c of contractRows) {
      if (c.memberNo) contractByMemberNo[c.memberNo] = c;
    }

    /* ─── 4. 28컬럼 매핑 ─── */
    const items = donationRows.map((d: any, idx: number) => {
      const m = d.memberId ? memberById[d.memberId] : null;
      const b = billingByDonationId[d.id] || null;
      const c = b && b.memberNo ? contractByMemberNo[b.memberNo] : null;
      const isHyosung = !!b;
      const dStatus = String(d.status || "").toLowerCase();
      const amount = Number(d.amount || 0);

      return {
        "NO.": idx + 1,
        "회원번호": d.memberId ? String(d.memberId).padStart(8, "0") : "",
        "계약번호": d.hyosungContractNo || (b && b.contractNo) || "001",
        "회원명": (m && m.name) || d.donorName || "",
        "최초청구월": (b && b.firstBillingMonth) || toYM(d.createdAt),
        "청구월": (b && b.billingMonth) || toYM(d.createdAt),
        "납부자 휴대전화": (m && m.phone) || d.donorPhone || "",
        "상품": TYPE_KR[d.type] || d.type || "",
        "수납상태": (b && b.receiptStatus) || (dStatus === "completed" ? "수납완료" : "수납대기"),
        "결제상태": STATUS_KR[dStatus] || dStatus || "",
        "결제방식": d.type === "regular" ? "자동결제" : "수동결제",
        "결제수단": payMethodKr(d.payMethod, isHyosung),
        "약정일": (b && b.promiseDay != null
          ? String(b.promiseDay).padStart(2, "0")
          : (c && c.promiseDay != null ? String(c.promiseDay).padStart(2, "0") : "")),
        "결제일(납부기간)": b && b.paymentDate ? toYMD(b.paymentDate) : toYMD(d.createdAt),
        "청구타입": (b && b.billingType) || (d.type === "regular" ? "정기청구" : "일시청구"),
        "미수처리상태": (b && b.unreceivedHandling) || "-",
        "청구금액": Number((b && b.billingAmount) ?? amount),
        "공급가액": Number((b && b.supplyAmount) ?? amount),
        "부가세": Number((b && b.vatAmount) ?? 0),
        "수납금액": Number(
          b && b.receivedAmount != null ? b.receivedAmount :
          (dStatus === "completed" ? amount : 0)
        ),
        "미납금액": Number(
          b && b.unpaidAmount != null ? b.unpaidAmount :
          (["pending", "failed"].includes(dStatus) ? amount : 0)
        ),
        "취소금액": Number(
          b && b.cancelAmount != null ? b.cancelAmount :
          (dStatus === "cancelled" ? amount : 0)
        ),
        "환불금액": Number(
          b && b.refundAmount != null ? b.refundAmount :
          (dStatus === "refunded" ? amount : 0)
        ),
        "청구완납일자": b && b.billingCompletionDate
          ? toYMD(b.billingCompletionDate)
          : (dStatus === "completed" ? toYMD(d.updatedAt) : ""),
        "비고": (b && b.memo) || d.memo || "",
        "결제결과": (b && b.paymentResult) || d.failureReason || "",
        "회원구분": (m && MEMBER_TYPE_KR[m.type]) || (m && m.type) || "미지정",
        "담당관리자": (c && c.managerName) || "교사유가족협의회",
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
    return new Response(
      JSON.stringify({
        ok: false,
        error: "수납내역 내보내기 실패",
        detail: String(err?.message || err).slice(0, 500),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};

export const config = { path: "/api/admin-donations-export" };
