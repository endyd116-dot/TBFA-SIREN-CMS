/**
 * GET /api/admin-members-contract-export
 *
 * 회원 내역 엑셀 내보내기 (효성 CMS+ 계약정보 양식 22컬럼)
 *
 * 안정성을 위해 JOIN 대신 separate query + JS map 매칭 방식.
 *
 * 필터: type, status, q
 * 응답: { items: [...22컬럼...], total }
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { members, hyosungContracts } from "../../db/schema";
import { eq, and, or, like, desc, isNotNull } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";
import { ok, methodNotAllowed } from "../../lib/response";
import { logAudit } from "../../lib/audit";

const STATUS_KR: Record<string, string> = {
  active: "사용",
  suspended: "중지",
  withdrawn: "탈퇴",
  pending: "대기",
};
const TYPE_KR: Record<string, string> = {
  regular: "일반",
  family: "유가족",
  volunteer: "봉사자",
  admin: "관리자",
};

function fmtDate(d: any): string {
  if (!d) return "";
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return "";
  return dt.getFullYear() + "-" +
    String(dt.getMonth() + 1).padStart(2, "0") + "-" +
    String(dt.getDate()).padStart(2, "0");
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
  const q = (url.searchParams.get("q") || "").trim();

  try {
    /* ─── 1. 회원 SELECT ─── */
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

    const memberRows: any = await db
      .select({
        id: members.id,
        name: members.name,
        email: members.email,
        phone: members.phone,
        type: members.type,
        status: members.status,
      })
      .from(members)
      .where(memberConds.length ? and(...memberConds) : undefined)
      .orderBy(desc(members.createdAt))
      .limit(5000);

    /* ─── 2. 효성 계약 SELECT (linkedMemberId IS NOT NULL인 것만) ─── */
    const contractRows: any = await db
      .select()
      .from(hyosungContracts)
      .where(isNotNull(hyosungContracts.linkedMemberId))
      .limit(10000);

    /* ─── 3. JS map 매칭 ─── */
    const contractByMemberId: Record<number, any> = {};
    for (const c of contractRows) {
      if (c.linkedMemberId) contractByMemberId[c.linkedMemberId] = c;
    }

    /* ─── 4. 22컬럼 매핑 ─── */
    const items = memberRows.map((m: any, idx: number) => {
      const c = contractByMemberId[m.id] || null;
      const hasContract = !!c;
      const memberStatusKr =
        (hasContract && c.memberStatus) || STATUS_KR[m.status] || m.status || "";
      const contractStatus = (hasContract && c.contractStatus) || "";
      const billingEnd = hasContract && c.billingEnd
        ? fmtDate(c.billingEnd)
        : (hasContract ? "9999-12-31" : "");

      return {
        "NO.": idx + 1,
        "회원번호": String(m.id || "").padStart(8, "0"),
        "회원명": m.name || (hasContract ? c.memberName : "") || "",
        "납부자 휴대전화": m.phone || (hasContract ? c.phone : "") || "",
        "회원상태": memberStatusKr,
        "계약상태": contractStatus,
        "약정일": hasContract && c.promiseDay != null
          ? String(c.promiseDay).padStart(2, "0")
          : "",
        "결제방식": (hasContract && c.paymentMethod) || (hasContract ? "자동결제" : "미등록"),
        "결제수단": (hasContract && c.paymentTool) || "",
        "결제정보": (hasContract && c.paymentInfo) || "",
        "예금주/명의자명": (hasContract && c.accountHolder) || "",
        "결제등록상태": (hasContract && c.registrationStatus) || "",
        "동의여부": (hasContract && c.agreementStatus) || "",
        "전자계약": (hasContract && c.electronicContract) || "",
        "상품목록": (hasContract && c.productName) || "",
        "상품금액합": hasContract && c.productAmount != null
          ? Number(c.productAmount)
          : "",
        "청구시작일": fmtDate(hasContract ? c.billingStart : null),
        "청구종료일": billingEnd,
        "담당관리자": (hasContract && c.managerName) || "교사유가족협의회",
        "회원구분": (hasContract && c.memberType) || "미지정",
        "청구자동생성": (hasContract && c.billingAuto) || (hasContract ? "자동" : ""),
        "발송방식": (hasContract && c.sendMethod) || (hasContract ? "미발송" : ""),
      };
    });

    await logAudit({
      userId: meId, userType: "admin", userName: adminMember.name,
      action: "members.export.contract",
      target: `count:${items.length}`,
      detail: { type, status, q, count: items.length },
      req,
    });

    return ok({ items, total: items.length });
  } catch (err: any) {
    console.error("[admin-members-contract-export]", err);
    return new Response(
      JSON.stringify({
        ok: false,
        error: "회원 내역 내보내기 실패",
        detail: String(err?.message || err).slice(0, 500),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};

export const config = { path: "/api/admin-members-contract-export" };
