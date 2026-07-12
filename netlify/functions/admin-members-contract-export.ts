/**
 * GET /api/admin-members-contract-export
 * 회원 내역 엑셀 내보내기 — 단계별 진단 강화 버전.
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { members, hyosungContracts } from "../../db/schema";
import { eq, and, or, like, desc, isNotNull } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";

const STATUS_KR: Record<string, string> = {
  active: "사용", suspended: "중지", withdrawn: "탈퇴", pending: "대기",
};

function fmtDate(d: any): string {
  if (!d) return "";
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return "";
  return dt.getFullYear() + "-" +
    String(dt.getMonth() + 1).padStart(2, "0") + "-" +
    String(dt.getDate()).padStart(2, "0");
}

function jsonError(step: string, err: any) {
  const message = err?.message || String(err);
  const stack = err?.stack ? String(err.stack).slice(0, 1000) : null;
  console.error(`[members-contract-export][${step}]`, err);
  return new Response(jsonKST({
    ok: false,
    error: "회원 내역 내보내기 실패",
    step,
    detail: message.slice(0, 500),
    stack,
  }, null, 2), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "GET") {
    return new Response(jsonKST({ ok: false, error: "GET 만 허용" }),
      { status: 405, headers: { "Content-Type": "application/json" } });
  }

  /* ─── Step 1: 어드민 인증 ─── */
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
  const q = (url.searchParams.get("q") || "").trim();

  /* ─── Step 2: 회원 SELECT ─── */
  let memberRows: any[] = [];
  try {
    const memberConds: any[] = [];
    if (["regular", "family", "volunteer", "admin"].includes(type)) {
      memberConds.push(eq(members.type, type as any));
    }
    if (["pending", "active", "suspended", "withdrawn"].includes(status)) {
      memberConds.push(eq(members.status, status as any));
    }
    if (q) {
      memberConds.push(
        or(
          like(members.name, `%${q}%`),
          like(members.phone, `%${q}%`),
          like(members.email, `%${q}%`)
        )
      );
    }

    memberRows = await db
      .select({
        id: members.id,
        name: members.name,
        email: members.email,
        phone: members.phone,
        type: members.type,
        status: members.status,
        createdAt: members.createdAt,
      })
      .from(members)
      .where(memberConds.length ? and(...memberConds) : undefined)
      .orderBy(desc(members.createdAt))
      .limit(5000);
  } catch (err: any) {
    return jsonError("select_members", err);
  }

  /* ─── Step 3: 효성 계약 SELECT (실패해도 빈 배열로 계속) ─── */
  let contractRows: any[] = [];
  try {
    contractRows = await db
      .select({
        id: hyosungContracts.id,
        linkedMemberId: hyosungContracts.linkedMemberId,
        memberStatus: hyosungContracts.memberStatus,
        contractStatus: hyosungContracts.contractStatus,
        promiseDay: hyosungContracts.promiseDay,
        paymentMethod: hyosungContracts.paymentMethod,
        paymentTool: hyosungContracts.paymentTool,
        paymentInfo: hyosungContracts.paymentInfo,
        accountHolder: hyosungContracts.accountHolder,
        registrationStatus: hyosungContracts.registrationStatus,
        agreementStatus: hyosungContracts.agreementStatus,
        electronicContract: hyosungContracts.electronicContract,
        productName: hyosungContracts.productName,
        productAmount: hyosungContracts.productAmount,
        billingStart: hyosungContracts.billingStart,
        billingEnd: hyosungContracts.billingEnd,
        managerName: hyosungContracts.managerName,
        memberType: hyosungContracts.memberType,
        billingAuto: hyosungContracts.billingAuto,
        sendMethod: hyosungContracts.sendMethod,
      })
      .from(hyosungContracts)
      .where(isNotNull(hyosungContracts.linkedMemberId))
      .limit(10000);
  } catch (err: any) {
    console.warn("[members-contract-export][select_contracts] 실패, 빈 배열로 계속:", err?.message);
    contractRows = [];
  }

  /* ─── Step 4: JS map 매칭 + 22컬럼 ─── */
  try {
    const contractByMemberId: Record<number, any> = {};
    for (const c of contractRows) {
      if (c.linkedMemberId) contractByMemberId[c.linkedMemberId] = c;
    }

    const items = memberRows.map((m: any, idx: number) => {
      const c = contractByMemberId[m.id] || null;
      const hasContract = !!c;
      return {
        "NO.": idx + 1,
        "회원번호": String(m.id || "").padStart(8, "0"),
        "회원명": m.name || "",
        "납부자 휴대전화": m.phone || "",
        "회원상태": (hasContract && c.memberStatus) || STATUS_KR[m.status] || m.status || "",
        "계약상태": (hasContract && c.contractStatus) || "",
        "약정일": hasContract && c.promiseDay != null ? String(c.promiseDay).padStart(2, "0") : "",
        "결제방식": (hasContract && c.paymentMethod) || (hasContract ? "자동결제" : "미등록"),
        "결제수단": (hasContract && c.paymentTool) || "",
        "결제정보": (hasContract && c.paymentInfo) || "",
        "예금주/명의자명": (hasContract && c.accountHolder) || "",
        "결제등록상태": (hasContract && c.registrationStatus) || "",
        "동의여부": (hasContract && c.agreementStatus) || "",
        "전자계약": (hasContract && c.electronicContract) || "",
        "상품목록": (hasContract && c.productName) || "",
        "상품금액합": hasContract && c.productAmount != null ? Number(c.productAmount) : "",
        "청구시작일": fmtDate(hasContract ? c.billingStart : null),
        "청구종료일": hasContract && c.billingEnd ? fmtDate(c.billingEnd) : (hasContract ? "9999-12-31" : ""),
        "담당관리자": (hasContract && c.managerName) || "교사유가족협의회",
        "회원구분": (hasContract && c.memberType) || "미지정",
        "청구자동생성": (hasContract && c.billingAuto) || (hasContract ? "자동" : ""),
        "발송방식": (hasContract && c.sendMethod) || (hasContract ? "미발송" : ""),
      };
    });

    return new Response(jsonKST({
      ok: true,
      data: { items, total: items.length },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    return jsonError("map", err);
  }
};

export const config = { path: "/api/admin-members-contract-export" };
