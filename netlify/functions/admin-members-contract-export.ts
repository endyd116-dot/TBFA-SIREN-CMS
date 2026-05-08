/**
 * GET /api/admin-members-contract-export
 *
 * 회원 내역 엑셀 내보내기 (효성 CMS+ 계약정보 양식 22컬럼)
 *
 * 기존 admin-members-export.ts(CSV)와 별개. 효성 양식 1:1 매핑.
 *
 * 데이터 소스:
 *   - members (주 테이블)
 *   - LEFT JOIN hyosungContracts (linkedMemberId 매칭) — 효성 등록 회원
 *
 * 효성에 등록된 회원은 효성 데이터 그대로, 미등록 회원은 빈 값 또는
 * 우리 시스템 데이터로 매핑.
 *
 * 필터 (현재 회원 관리 화면 필터와 동일):
 *   - type, status, category, subtype, source, q
 *
 * 응답: { items: [...22컬럼 객체...], total }
 * 클라이언트에서 SheetJS로 .xlsx 변환 후 다운로드.
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { members, hyosungContracts } from "../../db/schema";
import { eq, and, or, like, desc } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, methodNotAllowed, serverError,
} from "../../lib/response";
import { logAudit } from "../../lib/audit";

/* ─── 한글 매핑 ─── */
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
    const conds: any[] = [];
    if (["regular", "family", "volunteer", "admin"].includes(type)) {
      conds.push(eq(members.type, type as any));
    }
    if (["pending", "active", "suspended", "withdrawn"].includes(status)) {
      conds.push(eq(members.status, status as any));
    }
    if (q) {
      conds.push(
        or(
          like(members.name, `%${q}%`),
          like(members.phone, `%${q}%`),
          like(members.email, `%${q}%`)
        )
      );
    }

    const rows: any = await db
      .select({
        m_id: members.id,
        m_name: members.name,
        m_phone: members.phone,
        m_email: members.email,
        m_type: members.type,
        m_status: members.status,
        m_createdAt: members.createdAt,
        h_id: hyosungContracts.id,
        h_memberNo: hyosungContracts.memberNo,
        h_memberName: hyosungContracts.memberName,
        h_phone: hyosungContracts.phone,
        h_memberStatus: hyosungContracts.memberStatus,
        h_contractStatus: hyosungContracts.contractStatus,
        h_promiseDay: hyosungContracts.promiseDay,
        h_paymentMethod: hyosungContracts.paymentMethod,
        h_paymentTool: hyosungContracts.paymentTool,
        h_paymentInfo: hyosungContracts.paymentInfo,
        h_accountHolder: hyosungContracts.accountHolder,
        h_registrationStatus: hyosungContracts.registrationStatus,
        h_agreementStatus: hyosungContracts.agreementStatus,
        h_electronicContract: hyosungContracts.electronicContract,
        h_productName: hyosungContracts.productName,
        h_productAmount: hyosungContracts.productAmount,
        h_billingStart: hyosungContracts.billingStart,
        h_billingEnd: hyosungContracts.billingEnd,
        h_managerName: hyosungContracts.managerName,
        h_memberType: hyosungContracts.memberType,
        h_billingAuto: hyosungContracts.billingAuto,
        h_sendMethod: hyosungContracts.sendMethod,
      })
      .from(members)
      .leftJoin(hyosungContracts, eq(hyosungContracts.linkedMemberId, members.id))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(members.createdAt))
      .limit(5000);

    const items = rows.map((r: any, idx: number) => {
      const isHyosung = !!r.h_memberNo;
      const memberStatusKr = r.h_memberStatus
        || STATUS_KR[r.m_status] || r.m_status || "";
      const contractStatus = r.h_contractStatus || (isHyosung ? "사용" : "");
      const billingEnd = r.h_billingEnd
        ? fmtDate(r.h_billingEnd)
        : (isHyosung ? "9999-12-31" : "");

      return {
        "NO.": idx + 1,
        "회원번호": String(r.m_id || "").padStart(8, "0"),
        "회원명": r.m_name || r.h_memberName || "",
        "납부자 휴대전화": r.m_phone || r.h_phone || "",
        "회원상태": memberStatusKr,
        "계약상태": contractStatus,
        "약정일": r.h_promiseDay != null ? String(r.h_promiseDay).padStart(2, "0") : "",
        "결제방식": r.h_paymentMethod || (isHyosung ? "자동결제" : "미등록"),
        "결제수단": r.h_paymentTool || "",
        "결제정보": r.h_paymentInfo || "",
        "예금주/명의자명": r.h_accountHolder || "",
        "결제등록상태": r.h_registrationStatus || "",
        "동의여부": r.h_agreementStatus || "",
        "전자계약": r.h_electronicContract || "",
        "상품목록": r.h_productName || "",
        "상품금액합": r.h_productAmount != null ? Number(r.h_productAmount) : "",
        "청구시작일": fmtDate(r.h_billingStart),
        "청구종료일": billingEnd,
        "담당관리자": r.h_managerName || "교사유가족협의회",
        "회원구분": r.h_memberType || "미지정",
        "청구자동생성": r.h_billingAuto || (isHyosung ? "자동" : ""),
        "발송방식": r.h_sendMethod || (isHyosung ? "미발송" : ""),
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
    return serverError("회원 내역 내보내기 실패", err);
  }
};

export const config = { path: "/api/admin-members-contract-export" };
