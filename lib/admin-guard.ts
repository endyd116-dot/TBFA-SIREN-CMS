// lib/admin-guard.ts
import { eq } from "drizzle-orm";
import { db, members } from "../db";
import { authenticateAdmin, AdminPayload } from "./auth";
import { unauthorized, forbidden } from "./response";
import { canAccess } from "./role-permission-check";

export interface AdminContext {
  admin: AdminPayload;
  member: typeof members.$inferSelect;
}

/* ★ 2026-06-03 R46 2단계: 경로 → 권한키 중앙 매핑.
   등록된 API 경로는 requireAdmin 통과 후 canAccess(role, key)로 추가 게이트.
   (super_admin은 canAccess가 항상 true. 미등록 키는 admin 허용·operator 불가.)
   기존엔 콘텐츠 엔드포인트가 requireAdmin만 통과시켜 operator도 직접 호출 가능했음.
   ※ 급여·근태설정은 각 파일에서 super_admin 하드코딩으로 별도 enforce(여기 미포함). */
const PATH_FEATURE: Record<string, string> = {
  "/api/admin-org-news-list": "org_news",
  "/api/admin-org-news-get": "org_news",
  "/api/admin-org-news-settings": "org_news",
  "/api/admin-org-news-refresh": "org_news",
  "/api/admin-memorial-teachers": "cms_memorial",
  "/api/admin-memorial-settings": "cms_memorial",
  "/api/admin-memorial-moderation": "cms_memorial",
  "/api/admin-family-stories": "cms_family_stories",
  "/api/admin-family-story-ai": "cms_family_stories",
  "/api/admin/receipt-settings": "receipt_config",
  "/api/admin-kakao-templates": "kakao_template",
  "/api/admin-templates-list": "send_template",
  "/api/admin-template-create": "send_template",
  "/api/admin-template-update": "send_template",
  "/api/admin-template-delete": "send_template",
  "/api/admin-template-detail": "send_template",
  "/api/admin-template-preview": "send_template",
  "/api/admin-recipient-groups-list": "send_template",
  "/api/admin-recipient-group-create": "send_template",
  "/api/admin-recipient-group-update": "send_template",
  "/api/admin-recipient-group-delete": "send_template",
  "/api/admin-recipient-group-detail": "send_template",
  "/api/admin-recipient-group-members": "send_template",
  "/api/admin-recipient-group-preview": "send_template",
  "/api/admin-auto-triggers-list": "send_auto",
  "/api/admin-auto-trigger-create": "send_auto",
  "/api/admin-auto-trigger-update": "send_auto",
  "/api/admin-auto-trigger-delete": "send_auto",
  "/api/admin-auto-trigger-detail": "send_auto",
  "/api/admin-auto-trigger-toggle": "send_auto",
  "/api/admin-auto-trigger-runs": "send_auto",
  "/api/admin-system-notification-list": "send_auto",
  "/api/admin-system-notification-update": "send_auto",
  /* ★ 2026-06-09: SSO 위성앱 진입 권한. operator_allowed=false면 토큰 발급 전 차단(진입 불가).
     기본 admin 허용·operator 차단. super_admin은 canAccess 항상 통과. 정책 화면 'SSO 위성앱' 탭에서 앱별 조정. */
  "/api/sso-on": "sso_on",
  "/api/sso-si": "sso_si",
  "/api/sso-marketing": "sso_marketing",
  /* ★ 2026-07-01: 지출 결재 기안은 직원(operator)도 가능(finance_approval_submit·operator 허용 시드).
     결재 처리(decide)·라인/위임 설정은 PATH_FEATURE 미등록 → 기본 admin/이사장만. */
  "/api/admin-approval-request-create": "finance_approval_submit",
  "/api/admin-approval-requests": "finance_approval_submit",
};

export async function requireAdmin(req: Request): Promise<
  | { ok: true; ctx: AdminContext }
  | { ok: false; res: Response }
> {
  const auth = authenticateAdmin(req);
  if (!auth) return { ok: false, res: unauthorized("관리자 로그인이 필요합니다") };

  const [member] = await db
    .select()
    .from(members)
    .where(eq(members.id, auth.uid))
    .limit(1);

  if (!member) return { ok: false, res: unauthorized("관리자 계정을 찾을 수 없습니다") };
  if (member.type !== "admin") return { ok: false, res: forbidden("관리자 권한이 없습니다") };
  if (member.status !== "active") return { ok: false, res: forbidden("이용할 수 없는 계정입니다") };

  /* ★ R46 2단계: 경로 기반 기능 권한 게이트 (PATH_FEATURE 등록 경로만). super_admin은 통과. */
  try {
    const pathname = new URL(req.url).pathname;
    const featureKey = PATH_FEATURE[pathname];
    if (featureKey && !(await canAccess(member.role ?? "", featureKey))) {
      return { ok: false, res: forbidden("이 기능에 대한 접근 권한이 없습니다") };
    }
  } catch { /* URL 파싱 실패 등은 게이트 없이 통과(기존 동작 보존) */ }

  return { ok: true, ctx: { admin: auth, member } };
}
export type AdminGuardResult =
  | { ok: true; ctx: AdminContext }
  | { ok: false; res: Response };

export function guardFailed(g: AdminGuardResult): g is { ok: false; res: Response } {
  return !g.ok;
}
