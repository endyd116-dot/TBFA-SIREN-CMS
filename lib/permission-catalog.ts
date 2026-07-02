/**
 * lib/permission-catalog.ts — 중앙 권한 카탈로그 (2026-07-02)
 *
 * 싸이렌 + 통합 CMS의 주요 기능 권한키를 한곳에 정의한다.
 * - 통합 CMS > 운영 관리 > 권한정책관리 화면이 이 카탈로그 기준으로 전 기능을 노출·토글
 * - 시드는 migrate-permission-catalog(1회용)가 role_permissions에 upsert
 *   (기존 행의 admin/operator 토글은 보존, 라벨·카테고리만 정규화)
 * - 판정 로직은 lib/role-permission-check.ts canAccess (super_admin 항상 허용,
 *   미등록 키는 admin 허용·operator 불가)
 *
 * 새 기능을 추가할 때: ① 여기 항목 추가 ② 서버 게이트(PATH_FEATURE 또는 inline canAccess)
 * ③ 메뉴 게이트(cms-tbfa.js MENU_PERM) — 3곳이 같은 key를 쓰면 화면·서버가 자동 동기화된다.
 */

export interface PermissionDef {
  key: string;
  label: string;
  category: string;
  adminDefault: boolean;     // 신규 시드 시 국장(admin) 기본값
  operatorDefault: boolean;  // 신규 시드 시 직원(operator) 기본값
}

/** 카테고리 표기 순서·라벨 (권한정책 화면 탭) */
export const PERMISSION_CATEGORIES: { key: string; label: string }[] = [
  { key: "siren",   label: "🔴 SIREN 서비스" },
  { key: "content", label: "📚 콘텐츠 편집" },
  { key: "finance", label: "📊 재정" },
  { key: "send",    label: "📨 알림·발송" },
  { key: "ai",      label: "🤖 AI" },
  { key: "ops",     label: "🛎 운영 관리" },
  { key: "cms",     label: "📦 통합 CMS·기타" },
  { key: "sso",     label: "🔗 SSO 위성앱" },
];

export const PERMISSION_CATALOG: PermissionDef[] = [
  /* ── 🔴 SIREN 서비스 ── */
  { key: "siren_member",       label: "통합 회원 관리",                     category: "siren", adminDefault: true, operatorDefault: false },
  { key: "siren_donation",     label: "후원자 관리(정기·예비·잠재·너처링)", category: "siren", adminDefault: true, operatorDefault: false },
  { key: "donation_confirm",   label: "입금 매칭·확정",                     category: "siren", adminDefault: true, operatorDefault: false },
  { key: "chat_expert_view",   label: "채팅 전문가 열람",                   category: "siren", adminDefault: true, operatorDefault: false },
  { key: "chat_blacklist",     label: "채팅 차단 관리",                     category: "siren", adminDefault: true, operatorDefault: false },
  { key: "anonymous_reveal",   label: "익명 신고자 신원 열람",              category: "siren", adminDefault: true, operatorDefault: false },
  { key: "comment_moderation", label: "댓글 신고 처리",                     category: "siren", adminDefault: true, operatorDefault: false },

  /* ── 📚 콘텐츠 편집 ── */
  { key: "content_edit",       label: "사이트 콘텐츠 편집(설정·메뉴·관련사이트·자료실·브랜드·페이지·큐레이션)", category: "content", adminDefault: true, operatorDefault: false },
  { key: "campaign_manage",    label: "캠페인 관리",              category: "content", adminDefault: true, operatorDefault: false },
  { key: "notice_manage",      label: "공지 관리",                category: "content", adminDefault: true, operatorDefault: true },
  { key: "board_manage",       label: "자유게시판 관리",          category: "content", adminDefault: true, operatorDefault: true },
  { key: "cms_popup",          label: "팝업 관리",                category: "content", adminDefault: true, operatorDefault: false },
  { key: "cms_forms",          label: "응답폼·신청폼 빌더",       category: "content", adminDefault: true, operatorDefault: false },
  { key: "cms_gamification",   label: "게이미피케이션",           category: "content", adminDefault: true, operatorDefault: false },
  { key: "cms_memorial",       label: "온라인 추모관",            category: "content", adminDefault: true, operatorDefault: false },
  { key: "cms_family_stories", label: "유가족 이야기",            category: "content", adminDefault: true, operatorDefault: false },
  { key: "receipt_config",     label: "영수증 설정",              category: "content", adminDefault: true, operatorDefault: false },
  { key: "seo_edit",           label: "SEO 검색·공유 설정",       category: "content", adminDefault: true, operatorDefault: false },

  /* ── 📊 재정 ── */
  { key: "finance_view",            label: "재정 조회(손익·결제내역·보고서)",   category: "finance", adminDefault: true, operatorDefault: false },
  { key: "finance_bookkeeping",     label: "재정 기록(지출·예산·전표·통장)",     category: "finance", adminDefault: true, operatorDefault: false },
  { key: "finance_approval_submit", label: "지출 결재 기안 올리기",              category: "finance", adminDefault: true, operatorDefault: true },
  { key: "finance_refund",          label: "후원 환불 처리",                     category: "finance", adminDefault: true, operatorDefault: false },
  { key: "settlement_view",         label: "정산 조회",                          category: "finance", adminDefault: true, operatorDefault: false },

  /* ── 📨 알림·발송 ── */
  { key: "send_job",       label: "발송 작업·분석·로그",      category: "send", adminDefault: true, operatorDefault: false },
  { key: "send_template",  label: "발송 템플릿·수신자 그룹",  category: "send", adminDefault: true, operatorDefault: false },
  { key: "send_auto",      label: "자동 발송(AI·시스템)",     category: "send", adminDefault: true, operatorDefault: false },
  { key: "kakao_template", label: "카카오 알림톡 템플릿",     category: "send", adminDefault: true, operatorDefault: false },

  /* ── 🤖 AI ── */
  { key: "ai_agent_chat", label: "AI 에이전트 대화·이력",  category: "ai", adminDefault: true, operatorDefault: false },
  { key: "ai_config",     label: "AI 비용·로그·설정",      category: "ai", adminDefault: true, operatorDefault: false },

  /* ── 🛎 운영 관리 ── */
  { key: "org_news",                  label: "여론·뉴스 분석",                          category: "ops", adminDefault: true, operatorDefault: false },
  { key: "martyrdom_external_review", label: "딥릴리프(순직 인정 지원)",                category: "ops", adminDefault: true, operatorDefault: false },
  { key: "payroll_manage",            label: "급여관리 메뉴(급여 실행은 이사장 전용)",  category: "ops", adminDefault: true, operatorDefault: false },
  { key: "cms_role_policy",           label: "권한정책 화면 접근(편집은 이사장 전용)",  category: "ops", adminDefault: true, operatorDefault: false },
  { key: "milestone:manage",          label: "성과관리 설정 메뉴",                      category: "ops", adminDefault: true, operatorDefault: false },
  { key: "att_manage",                label: "근태 현황",                               category: "ops", adminDefault: true, operatorDefault: false },
  { key: "att_config",                label: "근태 설정 메뉴(저장은 이사장 전용)",      category: "ops", adminDefault: true, operatorDefault: false },
  { key: "audit_view",                label: "감사 로그 조회",                          category: "ops", adminDefault: true, operatorDefault: false },
  { key: "member_directory_export",   label: "회원 명부 내보내기",                      category: "ops", adminDefault: true, operatorDefault: false },

  /* ── 🔗 SSO 위성앱 ── */
  { key: "sso_on",        label: "함께워크 ON 진입",  category: "sso", adminDefault: true, operatorDefault: false },
  { key: "sso_si",        label: "SI 허브 진입",      category: "sso", adminDefault: true, operatorDefault: false },
  { key: "sso_marketing", label: "마케팅 허브 진입",  category: "sso", adminDefault: true, operatorDefault: false },
];
