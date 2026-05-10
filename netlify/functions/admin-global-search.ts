/**
 * GET /api/admin-global-search?q={검색어}
 * 통합 검색: menus[], members[], donors[], reports[]
 * super_admin: 전체 / admin: 메뉴 중 익명 감사 로그 제외
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { members, donations, incidentReports, harassmentReports, legalConsultations } from "../../db/schema";
import { sql, or } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/admin-global-search" };

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false,
    error: "전역 검색 실패",
    step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

const ALL_MENUS = [
  { key: "dashboard",              label: "통합 분석 대시보드",         group: "대시보드" },
  { key: "members",                label: "회원 관리",                 group: "회원·운영자" },
  { key: "operators",              label: "운영자 관리",                group: "회원·운영자" },
  { key: "matching",               label: "1:1 매칭 / 전문가 프로필",   group: "회원·운영자" },
  { key: "donations",              label: "후원금 관리",                group: "후원·재정" },
  { key: "finance",                label: "수입·예산·재무 보고서",       group: "후원·재정" },
  { key: "campaigns",              label: "캠페인 관리",                group: "후원·재정" },
  { key: "siren-reports",          label: "신고 처리",                  group: "사이렌 신고" },
  { key: "siren-stats",            label: "신고 통계",                  group: "사이렌 신고" },
  { key: "system-anonymous-audit", label: "익명 감사 로그",             group: "사이렌 신고", superAdminOnly: true },
  { key: "support-family",         label: "유가족 지원 관리",            group: "유가족 지원·문의" },
  { key: "support-chat",           label: "문의(채팅) 관리",            group: "유가족 지원·문의" },
  { key: "send-jobs",              label: "발송 작업",                  group: "알림·발송" },
  { key: "send-templates",         label: "발송 템플릿",                group: "알림·발송" },
  { key: "send-groups",            label: "수신자 그룹",                group: "알림·발송" },
  { key: "send-analytics",         label: "발송 분석·알림 로그",         group: "알림·발송" },
  { key: "content",                label: "콘텐츠 관리",                group: "콘텐츠" },
  { key: "weekly-report",          label: "주간 보고서",                group: "콘텐츠" },
  { key: "site-builder",           label: "메인 화면 편집",             group: "콘텐츠" },
  { key: "ai-recommend",           label: "AI 추천 센터",               group: "AI 에이전트" },
  { key: "ai-activity",            label: "AI 활동보고서",              group: "AI 에이전트" },
  { key: "ai-triggers",            label: "AI 자동 발송 트리거",         group: "AI 에이전트" },
  { key: "system-settings",        label: "시스템 설정",                group: "시스템·보안" },
  { key: "system-audit",           label: "감사 로그",                  group: "시스템·보안" },
  { key: "workspace",              label: "워크스페이스",               group: "워크스페이스" },
];

export default async function handler(req: Request, _ctx: Context) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ ok: false, error: "GET만 허용" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const auth: any = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  const isSuperAdmin = auth.ctx.member.role === "super_admin";

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();

  // q 없으면 메뉴 최대 10개만 반환 (DB 조회 스킵)
  if (!q) {
    const filteredMenus = ALL_MENUS
      .filter((m) => isSuperAdmin || !(m as any).superAdminOnly)
      .slice(0, 10);
    return new Response(JSON.stringify({
      ok: true,
      menus: filteredMenus,
      members: [],
      donors: [],
      reports: [],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  // ── 메뉴 검색 (정적 필터) ─────────────────────────────────
  const lowerQ = q.toLowerCase();
  const matchedMenus = ALL_MENUS.filter((m) => {
    if (!isSuperAdmin && (m as any).superAdminOnly) return false;
    return m.label.toLowerCase().includes(lowerQ) || m.group.toLowerCase().includes(lowerQ) || m.key.toLowerCase().includes(lowerQ);
  });

  // ── 회원 검색 ─────────────────────────────────────────────
  let memberResults: any[] = [];
  try {
    const rows = await db
      .select({
        id:     members.id,
        name:   members.name,
        email:  members.email,
        type:   members.type,
        status: members.status,
      })
      .from(members)
      .where(or(
        sql`${members.name}  ILIKE ${`%${q}%`}`,
        sql`${members.email} ILIKE ${`%${q}%`}`,
      ))
      .limit(5);
    memberResults = rows;
  } catch (err) {
    console.warn("[admin-global-search] members 조회 실패:", (err as any)?.message);
  }

  // ── 후원자 검색 ───────────────────────────────────────────
  let donorResults: any[] = [];
  try {
    const rows = await db
      .select({
        id:          donations.id,
        donorName:   donations.donorName,
        amount:      donations.amount,
        donatedAt:   donations.createdAt,
      })
      .from(donations)
      .where(sql`${donations.donorName} ILIKE ${`%${q}%`}`)
      .limit(5);
    donorResults = rows;
  } catch (err) {
    console.warn("[admin-global-search] donors 조회 실패:", (err as any)?.message);
  }

  // ── 신고 검색 (사건·괴롭힘·법률 각 2건) ──────────────────
  let reportResults: any[] = [];

  try {
    const incRows = await db
      .select({
        id:        incidentReports.id,
        title:     incidentReports.title,
        createdAt: incidentReports.createdAt,
      })
      .from(incidentReports)
      .where(sql`${incidentReports.title} ILIKE ${`%${q}%`}`)
      .limit(2);
    for (const r of incRows) reportResults.push({ ...r, type: "incident" });
  } catch (err) {
    console.warn("[admin-global-search] incidentReports 조회 실패:", (err as any)?.message);
  }

  try {
    const harRows = await db
      .select({
        id:        harassmentReports.id,
        title:     harassmentReports.title,
        createdAt: harassmentReports.createdAt,
      })
      .from(harassmentReports)
      .where(sql`${harassmentReports.title} ILIKE ${`%${q}%`}`)
      .limit(2);
    for (const r of harRows) reportResults.push({ ...r, type: "harassment" });
  } catch (err) {
    console.warn("[admin-global-search] harassmentReports 조회 실패:", (err as any)?.message);
  }

  try {
    const legalRows = await db
      .select({
        id:        legalConsultations.id,
        title:     legalConsultations.title,
        createdAt: legalConsultations.createdAt,
      })
      .from(legalConsultations)
      .where(sql`${legalConsultations.title} ILIKE ${`%${q}%`}`)
      .limit(2);
    for (const r of legalRows) reportResults.push({ ...r, type: "legal" });
  } catch (err) {
    console.warn("[admin-global-search] legalConsultations 조회 실패:", (err as any)?.message);
  }

  return new Response(JSON.stringify({
    ok: true,
    menus:   matchedMenus,
    members: memberResults,
    donors:  donorResults,
    reports: reportResults,
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}
