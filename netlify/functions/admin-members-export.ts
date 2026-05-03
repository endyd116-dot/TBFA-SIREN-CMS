// netlify/functions/admin-members-export.ts
// ★ Phase M-12: 회원 목록 CSV 추출 (Excel 호환)
// GET /api/admin/members-export?type=&category=&status=&q=&source=

import { eq, and, or, like, sql } from "drizzle-orm";
import { db } from "../../db";
import { members, signupSources } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import { logAdminAction } from "../../lib/audit";
import { buildCSV, csvResponse } from "../../lib/csv-export";
import {
  serverError, corsPreflight, methodNotAllowed,
} from "../../lib/response";

export const config = { path: "/api/admin/members-export" };

const VALID_TYPES = ["regular", "family", "volunteer", "admin"];
const VALID_STATUSES = ["pending", "active", "suspended", "withdrawn"];
const VALID_CATEGORIES = ["sponsor", "regular", "family", "etc"];

const CATEGORY_KR: Record<string, string> = {
  sponsor: "후원회원", regular: "일반회원", family: "유족회원", etc: "기타회원",
};
const SUBTYPE_KR: Record<string, string> = {
  regular_donation: "정기후원",
  hyosung_donation: "효성정기후원",
  onetime_donation: "일시후원",
  volunteer: "봉사자",
  lawyer: "법률전문가",
  counselor: "심리전문가",
};
const TYPE_KR: Record<string, string> = {
  regular: "정기/후원", family: "유가족", volunteer: "봉사자", admin: "관리자",
};
const STATUS_KR: Record<string, string> = {
  pending: "승인대기", active: "정상", suspended: "정지", withdrawn: "탈퇴",
};

function fmtDate(d: any): string {
  if (!d) return "";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "";
  return dt.getFullYear() + "-" +
    String(dt.getMonth() + 1).padStart(2, "0") + "-" +
    String(dt.getDate()).padStart(2, "0");
}
function fmtDateTime(d: any): string {
  if (!d) return "";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "";
  return fmtDate(d) + " " +
    String(dt.getHours()).padStart(2, "0") + ":" +
    String(dt.getMinutes()).padStart(2, "0");
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  const guard: any = await requireAdmin(req);
  if (!guard.ok) return guard.res;
  const { admin } = guard.ctx;

  try {
    const url = new URL(req.url);
    const type = url.searchParams.get("type") || "";
    const status = url.searchParams.get("status") || "";
    const category = url.searchParams.get("category") || "";
    const sourceId = url.searchParams.get("source") || "";
    const q = (url.searchParams.get("q") || "").trim();

    const conds: any[] = [];
    if (VALID_TYPES.includes(type)) conds.push(eq(members.type, type as any));
    if (VALID_STATUSES.includes(status)) conds.push(eq(members.status, status as any));
    if (VALID_CATEGORIES.includes(category)) conds.push(eq(members.memberCategory, category));
    if (sourceId && /^\d+$/.test(sourceId)) {
      conds.push(eq(members.signupSourceId, Number(sourceId)));
    }
    if (q && q.length >= 2) {
      const p = `%${q}%`;
      conds.push(or(like(members.name, p), like(members.email, p), like(members.phone, p)));
    }
    const where: any = conds.length === 0 ? undefined :
      conds.length === 1 ? conds[0] : and(...conds);

    /* 회원 + 가입경로 join (최대 5000건) */
    const list = await db.select({
      id: members.id,
      email: members.email,
      name: members.name,
      phone: members.phone,
      type: members.type,
      status: members.status,
      memberCategory: members.memberCategory,
      memberSubtype: members.memberSubtype,
      emailVerified: members.emailVerified,
      memo: members.memo,
      lastLoginAt: members.lastLoginAt,
      createdAt: members.createdAt,
      withdrawnAt: members.withdrawnAt,
      sourceLabel: signupSources.label,
      sourceCode: signupSources.code,
    })
      .from(members)
      .leftJoin(signupSources, eq(members.signupSourceId, signupSources.id))
      .where(where as any)
      .limit(5000);

    /* 후원 합계 별도 쿼리 */
    const memberIds = list.map((m: any) => m.id);
    const donationMap: Record<number, { total: number; count: number }> = {};
    if (memberIds.length > 0) {
      const stats: any[] = await db.execute(sql`
        SELECT
          member_id AS "memberId",
          COALESCE(SUM(amount), 0)::int AS "totalAmount",
          COUNT(*)::int AS "donationCount"
        FROM donations
        WHERE member_id = ANY(${memberIds})
          AND status = 'completed'
        GROUP BY member_id
      `);
      for (const row of stats) {
        donationMap[row.memberId] = { total: row.totalAmount || 0, count: row.donationCount || 0 };
      }
    }

    /* CSV 변환 */
    const rows = list.map((m: any) => {
      const stats = donationMap[m.id] || { total: 0, count: 0 };
      return {
        id: `M-${String(m.id).padStart(5, "0")}`,
        email: m.email || "",
        name: m.name || "",
        phone: m.phone || "",
        category: CATEGORY_KR[m.memberCategory] || "(미분류)",
        subtype: SUBTYPE_KR[m.memberSubtype] || "",
        type: TYPE_KR[m.type] || m.type,
        status: STATUS_KR[m.status] || m.status,
        emailVerified: m.emailVerified ? "Y" : "N",
        sourceLabel: m.sourceLabel || "(미분류)",
        sourceCode: m.sourceCode || "",
        donationCount: stats.count,
        donationTotal: stats.total,
        memo: (m.memo || "").replace(/\r?\n/g, " "),
        createdAt: fmtDateTime(m.createdAt),
        lastLoginAt: fmtDateTime(m.lastLoginAt),
        withdrawnAt: fmtDate(m.withdrawnAt),
      };
    });

    const columns = [
      { key: "id", label: "회원ID" },
      { key: "name", label: "이름" },
      { key: "email", label: "이메일" },
      { key: "phone", label: "연락처" },
      { key: "category", label: "회원분류" },
      { key: "subtype", label: "세부분류" },
      { key: "type", label: "기존유형" },
      { key: "status", label: "상태" },
      { key: "emailVerified", label: "이메일인증" },
      { key: "sourceLabel", label: "가입경로" },
      { key: "sourceCode", label: "가입경로코드" },
      { key: "donationCount", label: "후원건수" },
      { key: "donationTotal", label: "후원누적(원)" },
      { key: "memo", label: "관리자메모" },
      { key: "createdAt", label: "가입일시" },
      { key: "lastLoginAt", label: "최종로그인" },
      { key: "withdrawnAt", label: "탈퇴일" },
    ];

    const csv = buildCSV(rows, columns);
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const filename = `siren-members-${dateStr}.csv`;

    /* 감사 로그 */
    try {
      await logAdminAction(req, admin.uid, admin.name, "members_csv_export", {
        target: filename,
        detail: { totalRows: rows.length, filters: { type, status, category, sourceId, q } },
      });
    } catch (_) {}

    return csvResponse(csv, filename);
  } catch (e: any) {
    console.error("[admin-members-export]", e);
    return serverError("CSV 추출 실패", e);
  }
};