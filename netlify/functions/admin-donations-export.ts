/**
 * GET /api/admin-donations-export
 * 수납내역 엑셀 내보내기 — 단계별 진단 강화 버전.
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import {
  donations, members, hyosungBillings, hyosungContracts,
} from "../../db/schema";
import { eq, and, gte, lte, desc, inArray, isNotNull, sql } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";

const TYPE_KR: Record<string, string> = { regular: "정기후원", onetime: "일시후원" };
const STATUS_KR: Record<string, string> = {
  pending: "대기", completed: "완료", failed: "실패", cancelled: "취소", refunded: "환불",
};
const MEMBER_TYPE_KR: Record<string, string> = {
  regular: "일반", family: "유가족", volunteer: "봉사자", admin: "관리자",
};

function payMethodKr(method: string | null | undefined, isHyosung: boolean): string {
  if (isHyosung) return "CMS";
  const m = (method || "").toLowerCase();
  if (m.includes("card") || m === "toss") return "카드";
  if (m.includes("bank")) return "계좌이체";
  if (m.includes("cms") || m.includes("hyosung")) return "CMS";
  return method || "";
}
function toYM(d: any): string {
  if (!d) return "";
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return "";
  return `${dt.getFullYear()}/${String(dt.getMonth() + 1).padStart(2, "0")}`;
}
function toYMD(d: any): string {
  if (!d) return "";
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return "";
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function jsonError(step: string, err: any) {
  const message = err?.message || String(err);
  const stack = err?.stack ? String(err.stack).slice(0, 1000) : null;
  console.error(`[donations-export][${step}]`, err);
  return new Response(JSON.stringify({
    ok: false,
    error: "수납내역 내보내기 실패",
    step,
    detail: message.slice(0, 500),
    stack,
  }, null, 2), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ ok: false, error: "GET 만 허용" }),
      { status: 405, headers: { "Content-Type": "application/json" } });
  }

  /* Step 1: 인증 */
  let auth;
  try {
    auth = await requireAdmin(req);
    if (!auth.ok) return (auth as { ok: false; res: Response }).res;
  } catch (err: any) {
    return jsonError("auth", err);
  }

  const url = new URL(req.url);
  const type = url.searchParams.get("type") || "";
  const status = url.searchParams.get("status") || "";
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  /* Step 2: donations SELECT */
  let donationRows: any[] = [];
  try {
    const conds: any[] = [];
    if (type === "regular" || type === "onetime") {
      conds.push(eq(donations.type, type as any));
    }
    if (["pending", "completed", "failed", "cancelled", "refunded"].includes(status)) {
      conds.push(eq(donations.status, status as any));
    }
    /* ★ Q12: 기간 필터·정렬 기준은 실제 결제일 — 효성 CMS는 hyosungPaidDate, 그 외 채널은 createdAt */
    const paidAt = sql`COALESCE(${donations.hyosungPaidDate}, ${donations.createdAt})`;
    if (from) {
      const fromDate = new Date(from);
      if (!isNaN(fromDate.getTime())) conds.push(sql`${paidAt} >= ${fromDate.toISOString()}`);
    }
    if (to) {
      const toDate = new Date(to);
      if (!isNaN(toDate.getTime())) {
        toDate.setHours(23, 59, 59, 999);
        conds.push(sql`${paidAt} <= ${toDate.toISOString()}`);
      }
    }

    donationRows = await db
      .select({
        id: donations.id,
        memberId: donations.memberId,
        donorName: donations.donorName,
        donorPhone: donations.donorPhone,
        amount: donations.amount,
        type: donations.type,
        payMethod: donations.payMethod,
        status: donations.status,
        memo: donations.memo,
        failureReason: donations.failureReason,
        createdAt: donations.createdAt,
        updatedAt: donations.updatedAt,
        hyosungContractNo: donations.hyosungContractNo,
      })
      .from(donations)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(sql`COALESCE(${donations.hyosungPaidDate}, ${donations.createdAt}) DESC`)
      .limit(5000);
  } catch (err: any) {
    return jsonError("select_donations", err);
  }

  if (!donationRows.length) {
    return new Response(JSON.stringify({ ok: true, data: { items: [], total: 0 } }),
      { status: 200, headers: { "Content-Type": "application/json" } });
  }

  /* Step 3: 보조 SELECT (실패해도 빈 배열로 계속) */
  const memberIds = Array.from(new Set(donationRows.map((d) => d.memberId).filter(Boolean)));
  const donationIds = donationRows.map((d) => d.id);

  let memberRows: any[] = [];
  try {
    if (memberIds.length) {
      memberRows = await db
        .select({
          id: members.id,
          name: members.name,
          phone: members.phone,
          type: members.type,
        })
        .from(members)
        .where(inArray(members.id, memberIds as any));
    }
  } catch (err: any) {
    console.warn("[donations-export][select_members] 실패, 빈:", err?.message);
    memberRows = [];
  }

  let billingRows: any[] = [];
  try {
    if (donationIds.length) {
      billingRows = await db
        .select()
        .from(hyosungBillings)
        .where(inArray(hyosungBillings.linkedDonationId, donationIds as any));
    }
  } catch (err: any) {
    console.warn("[donations-export][select_billings] 실패, 빈:", err?.message);
    billingRows = [];
  }

  let contractRows: any[] = [];
  try {
    contractRows = await db
      .select({
        memberNo: hyosungContracts.memberNo,
        managerName: hyosungContracts.managerName,
        promiseDay: hyosungContracts.promiseDay,
      })
      .from(hyosungContracts)
      .where(isNotNull(hyosungContracts.memberNo))
      .limit(10000);
  } catch (err: any) {
    console.warn("[donations-export][select_contracts] 실패, 빈:", err?.message);
    contractRows = [];
  }

  /* Step 4: 매핑 */
  try {
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
        "수납금액": Number(b && b.receivedAmount != null ? b.receivedAmount :
          (dStatus === "completed" ? amount : 0)),
        "미납금액": Number(b && b.unpaidAmount != null ? b.unpaidAmount :
          (["pending", "failed"].includes(dStatus) ? amount : 0)),
        "취소금액": Number(b && b.cancelAmount != null ? b.cancelAmount :
          (dStatus === "cancelled" ? amount : 0)),
        "환불금액": Number(b && b.refundAmount != null ? b.refundAmount :
          (dStatus === "refunded" ? amount : 0)),
        "청구완납일자": b && b.billingCompletionDate
          ? toYMD(b.billingCompletionDate)
          : (dStatus === "completed" ? toYMD(d.updatedAt) : ""),
        "비고": (b && b.memo) || d.memo || "",
        "결제결과": (b && b.paymentResult) || d.failureReason || "",
        "회원구분": (m && MEMBER_TYPE_KR[m.type]) || (m && m.type) || "미지정",
        "담당관리자": (c && c.managerName) || "교사유가족협의회",
      };
    });

    return new Response(JSON.stringify({
      ok: true,
      data: { items, total: items.length },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    return jsonError("map", err);
  }
};

export const config = { path: "/api/admin-donations-export" };
