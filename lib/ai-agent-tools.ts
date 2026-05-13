// lib/ai-agent-tools.ts
// AI 에이전트가 호출할 수 있는 SIREN 도구 정의 + 실행 핸들러
// Phase A: 콘텐츠·관리 + 읽기 도구 대폭 확장 (총 20개)

import { sql } from "drizzle-orm";
import { db } from "../db";
import { sendEmail } from "./email";

/* =========================================================
   Gemini Function Declaration — OpenAPI 3.0 schema (대문자 type)
   ========================================================= */

export const TOOL_DECLARATIONS = [
  /* 콘텐츠·관리 */
  { name: "content_pages_list", description: "콘텐츠 페이지 본문 조회",
    parameters: { type: "OBJECT", properties: {
      keyFilter: { type: "STRING" }, limit: { type: "INTEGER" },
    }}},
  { name: "content_pages_update", description: "콘텐츠 페이지 본문 수정 (dry-run 우선)",
    parameters: { type: "OBJECT", properties: {
      pageKey: { type: "STRING" }, newContent: { type: "STRING" }, requireApproval: { type: "BOOLEAN" },
    }, required: ["pageKey", "newContent"] }},
  { name: "notice_create", description: "공지사항 등록 (dry-run 우선)",
    parameters: { type: "OBJECT", properties: {
      title: { type: "STRING" }, body: { type: "STRING" },
      category: { type: "STRING", description: "notice|event|press" }, requireApproval: { type: "BOOLEAN" },
    }, required: ["title", "body"] }},
  { name: "campaign_create", description: "캠페인 등록 (dry-run 우선)",
    parameters: { type: "OBJECT", properties: {
      name: { type: "STRING" }, description: { type: "STRING" },
      goalAmount: { type: "INTEGER", description: "원 단위" },
      endDate: { type: "STRING", description: "YYYY-MM-DD" }, requireApproval: { type: "BOOLEAN" },
    }, required: ["name", "description", "goalAmount"] }},
  { name: "nav_menus_list", description: "네비 메뉴 트리 조회",
    parameters: { type: "OBJECT", properties: { location: { type: "STRING", description: "header|footer" }}}},

  /* 회원 */
  { name: "members_search", description: "회원 이름·이메일·전화 검색",
    parameters: { type: "OBJECT", properties: {
      query: { type: "STRING" },
      type: { type: "STRING", description: "regular|family|volunteer|admin" },
      limit: { type: "INTEGER" },
    }, required: ["query"] }},
  { name: "members_detail", description: "회원 상세 (ID로 단건)",
    parameters: { type: "OBJECT", properties: { memberId: { type: "INTEGER" }}, required: ["memberId"] }},
  { name: "members_stats", description: "회원 유형·상태별 통계",
    parameters: { type: "OBJECT", properties: {} }},
  { name: "members_recent", description: "최근 가입 회원 목록",
    parameters: { type: "OBJECT", properties: { limit: { type: "INTEGER" }}}},

  /* 후원 */
  { name: "donations_recent", description: "최근 후원 내역",
    parameters: { type: "OBJECT", properties: {
      limit: { type: "INTEGER" }, status: { type: "STRING", description: "completed|pending|failed|refunded" },
    }}},
  { name: "donations_stats", description: "후원 통계 (월·정기·일시)",
    parameters: { type: "OBJECT", properties: { months: { type: "INTEGER" }}}},
  { name: "donations_by_member", description: "특정 회원의 후원 이력",
    parameters: { type: "OBJECT", properties: {
      memberId: { type: "INTEGER" }, limit: { type: "INTEGER" },
    }, required: ["memberId"] }},

  /* SIREN 신고·악성민원·법률 */
  { name: "incidents_list", description: "사건 제보 목록",
    parameters: { type: "OBJECT", properties: {
      status: { type: "STRING" }, category: { type: "STRING" }, limit: { type: "INTEGER" },
    }}},
  { name: "incidents_detail", description: "사건 상세",
    parameters: { type: "OBJECT", properties: { incidentId: { type: "INTEGER" }}, required: ["incidentId"] }},
  { name: "harassment_reports_list", description: "악성민원 신고 목록",
    parameters: { type: "OBJECT", properties: {
      status: { type: "STRING" },
      severity: { type: "STRING", description: "low|medium|high|critical" },
      limit: { type: "INTEGER" },
    }}},
  { name: "legal_consultations_list", description: "법률 상담 목록",
    parameters: { type: "OBJECT", properties: {
      status: { type: "STRING" }, limit: { type: "INTEGER" },
    }}},

  /* 게시판·캠페인 */
  { name: "board_posts_list", description: "게시판 글 목록",
    parameters: { type: "OBJECT", properties: {
      category: { type: "STRING" },
      sortBy: { type: "STRING", description: "recent|views|likes" },
      limit: { type: "INTEGER" },
    }}},
  { name: "campaigns_list", description: "캠페인 목록",
    parameters: { type: "OBJECT", properties: {
      status: { type: "STRING", description: "draft|active|ended|cancelled" }, limit: { type: "INTEGER" },
    }}},
  { name: "campaigns_detail", description: "캠페인 상세 + 진행률",
    parameters: { type: "OBJECT", properties: { campaignId: { type: "INTEGER" }}, required: ["campaignId"] }},

  /* 보안·감사 (Phase 추가 — 읽기) */
  { name: "audit_logs_recent", description: "감사 로그 최근 조회 (누가·언제·뭐 했나)",
    parameters: { type: "OBJECT", properties: {
      action: { type: "STRING", description: "action 부분 일치 (예: login, member_block)" },
      userId: { type: "INTEGER" },
      riskLevel: { type: "STRING", description: "low|medium|high|critical" },
      limit: { type: "INTEGER" },
    }}},
  { name: "members_recent_logins", description: "최근 로그인한 회원 (last_login_at 역순)",
    parameters: { type: "OBJECT", properties: {
      hours: { type: "INTEGER", description: "최근 N시간 (기본 24)" },
      limit: { type: "INTEGER" },
    }}},

  /* 발송·트리거 (Phase 추가 — 읽기) */
  { name: "dispatch_logs_recent", description: "알림 발송 이력 (이메일·SMS·카카오·푸시)",
    parameters: { type: "OBJECT", properties: {
      channel: { type: "STRING", description: "email|sms|kakao|push" },
      status: { type: "STRING", description: "sent|failed|delivered" },
      limit: { type: "INTEGER" },
    }}},
  { name: "auto_triggers_recent", description: "자동 트리거 실행 이력",
    parameters: { type: "OBJECT", properties: {
      status: { type: "STRING", description: "ok|skipped|error" },
      limit: { type: "INTEGER" },
    }}},

  /* 후원자 분석 (Phase 추가 — 읽기) */
  { name: "donors_top", description: "고액 후원자 상위 N명 (누적 후원금)",
    parameters: { type: "OBJECT", properties: {
      months: { type: "INTEGER", description: "최근 N개월 (기본 12)" },
      limit: { type: "INTEGER" },
    }}},
  { name: "donors_at_risk", description: "이탈 위험 후원자 (churn_risk_level)",
    parameters: { type: "OBJECT", properties: {
      level: { type: "STRING", description: "high|critical (기본 high+critical)" },
      limit: { type: "INTEGER" },
    }}},

  /* 워크스페이스·알림·KPI */
  { name: "tasks_list", description: "워크 작업 목록",
    parameters: { type: "OBJECT", properties: {
      status: { type: "STRING", description: "todo|doing|blocked|done|archived" },
      memberId: { type: "INTEGER" }, limit: { type: "INTEGER" },
    }}},
  { name: "notifications_recent", description: "특정 회원의 최근 알림",
    parameters: { type: "OBJECT", properties: {
      memberId: { type: "INTEGER" }, limit: { type: "INTEGER" },
    }, required: ["memberId"] }},
  { name: "kpi_summary", description: "전체 KPI 요약 (회원·후원·신고·게시판)",
    parameters: { type: "OBJECT", properties: {} }},

  /* X-2: 신고·캠페인·게시판·작업 변경 (dry-run 우선) */
  { name: "incidents_status_update", description: "사건 상태 변경",
    parameters: { type: "OBJECT", properties: {
      incidentId: { type: "INTEGER" },
      status: { type: "STRING", description: "reviewing|responded|closed|rejected" },
      adminNote: { type: "STRING" }, requireApproval: { type: "BOOLEAN" },
    }, required: ["incidentId", "status"] }},
  { name: "harassment_status_update", description: "악성민원 상태 변경",
    parameters: { type: "OBJECT", properties: {
      reportId: { type: "INTEGER" },
      status: { type: "STRING", description: "reviewing|responded|closed|rejected" },
      adminNote: { type: "STRING" }, requireApproval: { type: "BOOLEAN" },
    }, required: ["reportId", "status"] }},
  { name: "legal_status_update", description: "법률 상담 상태 변경",
    parameters: { type: "OBJECT", properties: {
      consultationId: { type: "INTEGER" },
      status: { type: "STRING", description: "matching|matched|in_progress|responded|closed|rejected" },
      adminNote: { type: "STRING" }, requireApproval: { type: "BOOLEAN" },
    }, required: ["consultationId", "status"] }},
  { name: "campaigns_update", description: "캠페인 정보 수정 (제목·목표·종료·게시)",
    parameters: { type: "OBJECT", properties: {
      campaignId: { type: "INTEGER" },
      title: { type: "STRING" }, summary: { type: "STRING" },
      goalAmount: { type: "INTEGER" },
      endDate: { type: "STRING", description: "YYYY-MM-DD" },
      isPublished: { type: "BOOLEAN" }, requireApproval: { type: "BOOLEAN" },
    }, required: ["campaignId"] }},
  { name: "notice_update", description: "공지 제목·본문 수정",
    parameters: { type: "OBJECT", properties: {
      noticeId: { type: "INTEGER" }, title: { type: "STRING" }, body: { type: "STRING" },
      requireApproval: { type: "BOOLEAN" },
    }, required: ["noticeId"] }},
  { name: "board_post_delete", description: "게시판 글 삭제 (soft)",
    parameters: { type: "OBJECT", properties: {
      postId: { type: "INTEGER" }, reason: { type: "STRING" }, requireApproval: { type: "BOOLEAN" },
    }, required: ["postId"] }},
  { name: "task_update", description: "워크 작업 수정 (상태·진행률·우선순위·담당자·마감)",
    parameters: { type: "OBJECT", properties: {
      taskId: { type: "INTEGER" },
      status: { type: "STRING", description: "todo|doing|blocked|done|archived" },
      progress: { type: "INTEGER", description: "0~100" },
      priority: { type: "STRING", description: "low|normal|high|urgent" },
      assignedTo: { type: "INTEGER" },
      dueDate: { type: "STRING", description: "YYYY-MM-DD" },
      requireApproval: { type: "BOOLEAN" },
    }, required: ["taskId"] }},

  /* X-1: 회원·후원 변경 (dry-run 우선) */
  { name: "members_update", description: "회원 정보 수정 (이름·전화·이메일·유형·동의·카테고리)",
    parameters: { type: "OBJECT", properties: {
      memberId: { type: "INTEGER" },
      name: { type: "STRING" }, phone: { type: "STRING" },
      email: { type: "STRING", description: "UNIQUE" },
      type: { type: "STRING", description: "regular|family|volunteer|admin" },
      agreeEmail: { type: "BOOLEAN" }, agreeSms: { type: "BOOLEAN" }, agreeMail: { type: "BOOLEAN" },
      memberCategory: { type: "STRING" }, requireApproval: { type: "BOOLEAN" },
    }, required: ["memberId"] }},
  { name: "members_block", description: "회원 차단 (status=suspended + blacklist)",
    parameters: { type: "OBJECT", properties: {
      memberId: { type: "INTEGER" }, reason: { type: "STRING" }, requireApproval: { type: "BOOLEAN" },
    }, required: ["memberId", "reason"] }},
  { name: "members_unblock", description: "회원 차단 해제",
    parameters: { type: "OBJECT", properties: {
      memberId: { type: "INTEGER" }, requireApproval: { type: "BOOLEAN" },
    }, required: ["memberId"] }},
  { name: "donations_status_update", description: "후원 상태 변경 (환불·실패 등)",
    parameters: { type: "OBJECT", properties: {
      donationId: { type: "INTEGER" },
      status: { type: "STRING", description: "pending|completed|refunded|failed" },
      reason: { type: "STRING" }, requireApproval: { type: "BOOLEAN" },
    }, required: ["donationId", "status"] }},

  /* F-7: 워크 카드·이메일·알림 발송 (dry-run 우선) */
  { name: "task_create", description: "워크 작업 카드 생성. owner는 호출자(=대화 상대) 자동. assignedTo 생략 시 호출자 본인이 담당.",
    parameters: { type: "OBJECT", properties: {
      title: { type: "STRING" }, description: { type: "STRING" },
      priority: { type: "STRING", description: "low|medium|high|urgent" },
      assignedTo: { type: "INTEGER", description: "타인에게 배정 시만 (생략 시 호출자 본인)" },
      dueDate: { type: "STRING", description: "YYYY-MM-DD (생략 시 7일 후)" },
      requireApproval: { type: "BOOLEAN" },
    }, required: ["title"] }},
  { name: "email_send", description: "회원에게 이메일 발송 (1~50명, Resend)",
    parameters: { type: "OBJECT", properties: {
      memberIds: { type: "ARRAY", items: { type: "INTEGER" }},
      subject: { type: "STRING" }, body: { type: "STRING" }, requireApproval: { type: "BOOLEAN" },
    }, required: ["memberIds", "subject", "body"] }},
  { name: "notification_send", description: "회원에게 사이트 알림 발송 (1~100명)",
    parameters: { type: "OBJECT", properties: {
      memberIds: { type: "ARRAY", items: { type: "INTEGER" }},
      title: { type: "STRING" }, body: { type: "STRING" }, linkUrl: { type: "STRING" },
      requireApproval: { type: "BOOLEAN" },
    }, required: ["memberIds", "title"] }},

  /* === Phase 1 워크스페이스 확장 (12개) === */
  /* 메모 */
  { name: "memos_list", description: "내 메모 목록 (호출자 본인)",
    parameters: { type: "OBJECT", properties: {
      limit: { type: "INTEGER" }, pinnedFirst: { type: "BOOLEAN" },
    }}},
  { name: "memo_create", description: "메모 생성 (dry-run 우선). 호출자 본인 소유.",
    parameters: { type: "OBJECT", properties: {
      title: { type: "STRING" }, content: { type: "STRING" },
      color: { type: "STRING", description: "yellow|pink|blue|green|gray" },
      isPinned: { type: "BOOLEAN" },
      eventDate: { type: "STRING", description: "YYYY-MM-DD (캘린더 표시 시)" },
      showInCalendar: { type: "BOOLEAN" },
      requireApproval: { type: "BOOLEAN" },
    }, required: ["content"] }},
  { name: "memo_update", description: "메모 수정 (dry-run 우선)",
    parameters: { type: "OBJECT", properties: {
      memoId: { type: "INTEGER" },
      title: { type: "STRING" }, content: { type: "STRING" }, color: { type: "STRING" },
      isPinned: { type: "BOOLEAN" }, requireApproval: { type: "BOOLEAN" },
    }, required: ["memoId"] }},
  { name: "memo_delete", description: "메모 삭제 (영구, dry-run 우선)",
    parameters: { type: "OBJECT", properties: {
      memoId: { type: "INTEGER" }, requireApproval: { type: "BOOLEAN" },
    }, required: ["memoId"] }},

  /* 캘린더 일정 */
  { name: "events_list", description: "캘린더 일정 목록 (날짜 범위)",
    parameters: { type: "OBJECT", properties: {
      fromDate: { type: "STRING", description: "YYYY-MM-DD (기본: 오늘)" },
      toDate: { type: "STRING", description: "YYYY-MM-DD (기본: 30일 후)" },
      limit: { type: "INTEGER" },
    }}},
  { name: "event_create", description: "일정 생성 (dry-run 우선). 호출자 본인 소유.",
    parameters: { type: "OBJECT", properties: {
      title: { type: "STRING" },
      startAt: { type: "STRING", description: "YYYY-MM-DDTHH:mm 또는 YYYY-MM-DD (allDay)" },
      endAt: { type: "STRING", description: "YYYY-MM-DDTHH:mm (생략 시 startAt+1h)" },
      allDay: { type: "BOOLEAN" }, location: { type: "STRING" },
      color: { type: "STRING", description: "blue|red|green|yellow|purple" },
      description: { type: "STRING" },
      eventType: { type: "STRING", description: "general|meeting|board_meeting|counseling|deadline" },
      requireApproval: { type: "BOOLEAN" },
    }, required: ["title", "startAt"] }},
  { name: "event_update", description: "일정 수정 (dry-run 우선)",
    parameters: { type: "OBJECT", properties: {
      eventId: { type: "INTEGER" },
      title: { type: "STRING" }, startAt: { type: "STRING" }, endAt: { type: "STRING" },
      allDay: { type: "BOOLEAN" }, location: { type: "STRING" },
      color: { type: "STRING" }, description: { type: "STRING" },
      eventType: { type: "STRING" }, requireApproval: { type: "BOOLEAN" },
    }, required: ["eventId"] }},
  { name: "event_delete", description: "일정 삭제 (영구, dry-run 우선)",
    parameters: { type: "OBJECT", properties: {
      eventId: { type: "INTEGER" }, requireApproval: { type: "BOOLEAN" },
    }, required: ["eventId"] }},

  /* 작업 댓글 + 작업 삭제 */
  { name: "task_comments_list", description: "작업 카드의 댓글 목록",
    parameters: { type: "OBJECT", properties: {
      taskId: { type: "INTEGER" }, limit: { type: "INTEGER" },
    }, required: ["taskId"] }},
  { name: "task_comment_add", description: "작업 카드에 댓글 추가 (dry-run 우선). 본문에 @이름 포함 시 멘션 알림.",
    parameters: { type: "OBJECT", properties: {
      taskId: { type: "INTEGER" }, content: { type: "STRING" },
      mentions: { type: "ARRAY", items: { type: "INTEGER" }, description: "멘션할 회원 ID 배열 (옵션)" },
      requireApproval: { type: "BOOLEAN" },
    }, required: ["taskId", "content"] }},
  { name: "task_delete", description: "작업 카드 삭제 (영구, 댓글·보고서·첨부 cascade. dry-run 우선)",
    parameters: { type: "OBJECT", properties: {
      taskId: { type: "INTEGER" }, requireApproval: { type: "BOOLEAN" },
    }, required: ["taskId"] }},

  /* 파일함 (읽기 전용 — 업로드는 멀티파트라 AI 도구 X) */
  { name: "files_list", description: "워크스페이스 파일·폴더 목록 (호출자 본인 소유 또는 공유받은 것)",
    parameters: { type: "OBJECT", properties: {
      folderId: { type: "INTEGER", description: "폴더 ID (생략 시 루트)" },
      limit: { type: "INTEGER" },
    }}},

  /* === Phase 2 — 콘텐츠·게시판·캠페인·공지·FAQ (10개) === */
  { name: "notices_list", description: "공지 목록 (최신순)",
    parameters: { type: "OBJECT", properties: {
      category: { type: "STRING", description: "general|event|press" },
      isPublished: { type: "BOOLEAN" },
      limit: { type: "INTEGER" },
    }}},
  { name: "notice_delete", description: "공지 영구 삭제 (dry-run 우선)",
    parameters: { type: "OBJECT", properties: {
      noticeId: { type: "INTEGER" }, requireApproval: { type: "BOOLEAN" },
    }, required: ["noticeId"] }},
  { name: "page_create", description: "콘텐츠 페이지 신규 생성 (pageKey 유일, dry-run 우선)",
    parameters: { type: "OBJECT", properties: {
      pageKey: { type: "STRING", description: "예: about, faq, policy_privacy" },
      title: { type: "STRING" }, contentHtml: { type: "STRING" },
      requireApproval: { type: "BOOLEAN" },
    }, required: ["pageKey", "contentHtml"] }},
  { name: "page_delete", description: "콘텐츠 페이지 영구 삭제 (dry-run 우선)",
    parameters: { type: "OBJECT", properties: {
      pageKey: { type: "STRING" }, requireApproval: { type: "BOOLEAN" },
    }, required: ["pageKey"] }},
  { name: "board_post_create", description: "게시글 작성 (관리자 명의, dry-run 우선)",
    parameters: { type: "OBJECT", properties: {
      title: { type: "STRING" }, content: { type: "STRING" },
      category: { type: "STRING", description: "general|notice|qna|free" },
      isPinned: { type: "BOOLEAN" }, requireApproval: { type: "BOOLEAN" },
    }, required: ["title", "content"] }},
  { name: "board_post_update", description: "게시글 수정 (제목·본문·카테고리·고정·숨김, dry-run 우선)",
    parameters: { type: "OBJECT", properties: {
      postId: { type: "INTEGER" },
      title: { type: "STRING" }, content: { type: "STRING" },
      category: { type: "STRING" }, isPinned: { type: "BOOLEAN" }, isHidden: { type: "BOOLEAN" },
      requireApproval: { type: "BOOLEAN" },
    }, required: ["postId"] }},
  { name: "board_comments_list", description: "게시글 댓글 목록 (시간순)",
    parameters: { type: "OBJECT", properties: {
      postId: { type: "INTEGER" }, includeHidden: { type: "BOOLEAN" }, limit: { type: "INTEGER" },
    }, required: ["postId"] }},
  { name: "board_comment_hide", description: "게시판 댓글 숨김(soft, 영구삭제 아님). dry-run 우선.",
    parameters: { type: "OBJECT", properties: {
      commentId: { type: "INTEGER" }, unhide: { type: "BOOLEAN", description: "true면 숨김 해제" },
      requireApproval: { type: "BOOLEAN" },
    }, required: ["commentId"] }},
  { name: "campaign_archive", description: "캠페인 아카이브(status=archived + 게시 해제, dry-run 우선)",
    parameters: { type: "OBJECT", properties: {
      campaignId: { type: "INTEGER" }, requireApproval: { type: "BOOLEAN" },
    }, required: ["campaignId"] }},
  { name: "faqs_list", description: "FAQ 목록 (카테고리·활성여부 필터)",
    parameters: { type: "OBJECT", properties: {
      category: { type: "STRING" }, isActive: { type: "BOOLEAN" }, limit: { type: "INTEGER" },
    }}},
];

/* =========================================================
   도구 실행 핸들러 — 모든 함수가 dry-run 우선
   ========================================================= */

export interface ToolResult {
  ok: boolean;
  output?: any;
  preview?: any;
  rollbackData?: any;
  error?: string;
}

export async function executeTool(
  name: string,
  args: any,
  adminId: number | null,
): Promise<ToolResult> {
  try {
    switch (name) {
      /* 콘텐츠·관리 */
      case "content_pages_list":   return await tool_contentPagesList(args);
      case "content_pages_update": return await tool_contentPagesUpdate(args, adminId);
      case "notice_create":        return await tool_noticeCreate(args, adminId);
      case "campaign_create":      return await tool_campaignCreate(args, adminId);
      case "nav_menus_list":       return await tool_navMenusList(args);
      /* 회원 */
      case "members_search":       return await tool_membersSearch(args);
      case "members_detail":       return await tool_membersDetail(args);
      case "members_stats":        return await tool_membersStats();
      case "members_recent":       return await tool_membersRecent(args);
      /* 후원 */
      case "donations_recent":     return await tool_donationsRecent(args);
      case "donations_stats":      return await tool_donationsStats(args);
      case "donations_by_member":  return await tool_donationsByMember(args);
      /* 신고 */
      case "incidents_list":       return await tool_incidentsList(args);
      case "incidents_detail":     return await tool_incidentsDetail(args);
      case "harassment_reports_list": return await tool_harassmentList(args);
      case "legal_consultations_list": return await tool_legalList(args);
      /* 게시판·캠페인 */
      case "board_posts_list":     return await tool_boardPostsList(args);
      case "campaigns_list":       return await tool_campaignsList(args);
      case "campaigns_detail":     return await tool_campaignsDetail(args);
      /* 워크스페이스·알림·KPI */
      case "tasks_list":           return await tool_tasksList(args);
      case "notifications_recent": return await tool_notificationsRecent(args);
      case "kpi_summary":          return await tool_kpiSummary();
      /* 추가 읽기 도구 (보안·발송·후원자 분석) */
      case "audit_logs_recent":     return await tool_auditLogsRecent(args);
      case "members_recent_logins": return await tool_membersRecentLogins(args);
      case "dispatch_logs_recent":  return await tool_dispatchLogsRecent(args);
      case "auto_triggers_recent":  return await tool_autoTriggersRecent(args);
      case "donors_top":            return await tool_donorsTop(args);
      case "donors_at_risk":        return await tool_donorsAtRisk(args);
      /* X-1: 회원·후원 변경 도구 */
      case "members_update":          return await tool_membersUpdate(args, adminId);
      case "members_block":           return await tool_membersBlock(args, adminId);
      case "members_unblock":         return await tool_membersUnblock(args, adminId);
      case "donations_status_update": return await tool_donationsStatusUpdate(args, adminId);
      /* X-2: 신고·캠페인·게시판·작업 변경 도구 */
      case "incidents_status_update":   return await tool_incidentsStatusUpdate(args, adminId);
      case "harassment_status_update":  return await tool_harassmentStatusUpdate(args, adminId);
      case "legal_status_update":       return await tool_legalStatusUpdate(args, adminId);
      case "campaigns_update":          return await tool_campaignsUpdate(args, adminId);
      case "notice_update":             return await tool_noticeUpdate(args, adminId);
      case "board_post_delete":         return await tool_boardPostDelete(args, adminId);
      case "task_update":               return await tool_taskUpdate(args, adminId);
      /* F-7: 변경 도구 3종 */
      case "task_create":          return await tool_taskCreate(args, adminId);
      case "email_send":           return await tool_emailSend(args, adminId);
      case "notification_send":    return await tool_notificationSend(args, adminId);
      /* Phase 1: 워크스페이스 확장 (메모·캘린더·댓글·작업삭제·파일목록) */
      case "memos_list":           return await tool_memosList(args, adminId);
      case "memo_create":          return await tool_memoCreate(args, adminId);
      case "memo_update":          return await tool_memoUpdate(args, adminId);
      case "memo_delete":          return await tool_memoDelete(args, adminId);
      case "events_list":          return await tool_eventsList(args, adminId);
      case "event_create":         return await tool_eventCreate(args, adminId);
      case "event_update":         return await tool_eventUpdate(args, adminId);
      case "event_delete":         return await tool_eventDelete(args, adminId);
      case "task_comments_list":   return await tool_taskCommentsList(args);
      case "task_comment_add":     return await tool_taskCommentAdd(args, adminId);
      case "task_delete":          return await tool_taskDelete(args, adminId);
      case "files_list":           return await tool_filesList(args, adminId);
      /* Phase 2: 콘텐츠·게시판·캠페인·공지·FAQ (10개) */
      case "notices_list":         return await tool_noticesList(args);
      case "notice_delete":        return await tool_noticeDelete(args, adminId);
      case "page_create":          return await tool_pageCreate(args, adminId);
      case "page_delete":          return await tool_pageDelete(args, adminId);
      case "board_post_create":    return await tool_boardPostCreate(args, adminId);
      case "board_post_update":    return await tool_boardPostUpdate(args, adminId);
      case "board_comments_list":  return await tool_boardCommentsList(args);
      case "board_comment_hide":   return await tool_boardCommentHide(args, adminId);
      case "campaign_archive":     return await tool_campaignArchive(args, adminId);
      case "faqs_list":            return await tool_faqsList(args);
      default:
        return { ok: false, error: `알 수 없는 도구: ${name}` };
    }
  } catch (err: any) {
    return { ok: false, error: String(err?.message || err).slice(0, 500) };
  }
}

/* ─────────────────────────────────────────
   콘텐츠·관리
   ───────────────────────────────────────── */

async function tool_contentPagesList(args: any): Promise<ToolResult> {
  const keyFilter = String(args?.keyFilter || "").trim();
  const limit = Math.min(Number(args?.limit) || 30, 100);
  const where = keyFilter ? sql`WHERE page_key ILIKE ${`%${keyFilter}%`}` : sql``;
  const r: any = await db.execute(sql`
    SELECT page_key, content, updated_at FROM content_pages ${where}
     ORDER BY updated_at DESC LIMIT ${limit}
  `);
  const rows = r?.rows ?? r ?? [];
  return { ok: true, output: { count: rows.length, pages: rows.map((p: any) => ({
    pageKey: p.page_key,
    contentPreview: String(p.content || "").slice(0, 300),
    updatedAt: p.updated_at,
  })) } };
}

async function tool_contentPagesUpdate(args: any, adminId: number | null): Promise<ToolResult> {
  const pageKey = String(args?.pageKey || "").trim();
  const newContent = String(args?.newContent || "");
  const requireApproval = args?.requireApproval !== false;
  if (!pageKey) return { ok: false, error: "pageKey 필수" };
  if (!newContent) return { ok: false, error: "newContent 필수" };
  const cur: any = await db.execute(sql`SELECT page_key, content FROM content_pages WHERE page_key = ${pageKey} LIMIT 1`);
  const curRow = (cur?.rows ?? cur ?? [])[0];
  if (!curRow) return { ok: false, error: `페이지 키 '${pageKey}' 없음` };
  if (requireApproval) return { ok: true, preview: {
    pageKey, before: String(curRow.content || "").slice(0, 500),
    after: newContent.slice(0, 500),
    message: "승인 후 requireApproval=false로 다시 호출하세요.",
  }};
  await db.execute(sql`
    UPDATE content_pages SET content = ${newContent}, updated_at = NOW(), updated_by = ${adminId}
     WHERE page_key = ${pageKey}
  `);
  return { ok: true, output: { pageKey, applied: true, message: "적용 완료" },
    rollbackData: { pageKey, prevContent: curRow.content } };
}

async function tool_noticeCreate(args: any, adminId: number | null): Promise<ToolResult> {
  const title = String(args?.title || "").trim().slice(0, 200);
  const body  = String(args?.body  || "").trim();
  const category = ["notice","event","press"].includes(String(args?.category)) ? String(args.category) : "notice";
  const requireApproval = args?.requireApproval !== false;
  if (!title) return { ok: false, error: "title 필수" };
  if (!body)  return { ok: false, error: "body 필수" };
  if (requireApproval) return { ok: true, preview: { title, category, bodyPreview: body.slice(0, 500),
    message: "승인 후 requireApproval=false로 다시 호출하세요." } };
  try {
    const r: any = await db.execute(sql`
      INSERT INTO board_posts (member_id, title, content, category, created_at, updated_at)
      VALUES (${adminId}, ${title}, ${body}, ${category}, NOW(), NOW())
      RETURNING id
    `);
    const id = Number((r?.rows ?? r ?? [])[0]?.id) || 0;
    return { ok: true, output: { id, title, category, message: `공지 #${id} 등록 완료` } };
  } catch (err: any) { return { ok: false, error: `공지 등록 실패: ${err?.message?.slice(0, 200)}` }; }
}

async function tool_campaignCreate(args: any, adminId: number | null): Promise<ToolResult> {
  const name = String(args?.name || "").trim().slice(0, 100);
  const description = String(args?.description || "").trim();
  const goalAmount = Number(args?.goalAmount) || 0;
  const endDate = args?.endDate ? String(args.endDate) : null;
  const requireApproval = args?.requireApproval !== false;
  if (!name) return { ok: false, error: "name 필수" };
  if (goalAmount <= 0) return { ok: false, error: "goalAmount 양수 필수" };
  if (requireApproval) return { ok: true, preview: { name, goalAmount, endDate,
    descriptionPreview: description.slice(0, 300),
    message: "승인 후 requireApproval=false로 다시 호출하세요." } };
  try {
    const r: any = await db.execute(sql`
      INSERT INTO campaigns (title, description, goal_amount, status, created_at, updated_at)
      VALUES (${name}, ${description}, ${goalAmount}, 'active', NOW(), NOW())
      RETURNING id
    `);
    const id = Number((r?.rows ?? r ?? [])[0]?.id) || 0;
    return { ok: true, output: { id, name, goalAmount, message: `캠페인 #${id} 등록 완료` } };
  } catch (err: any) { return { ok: false, error: `캠페인 등록 실패: ${err?.message?.slice(0, 200)}` }; }
}

async function tool_navMenusList(args: any): Promise<ToolResult> {
  const location = ["header","footer"].includes(String(args?.location)) ? String(args.location) : "header";
  try {
    const r: any = await db.execute(sql`
      SELECT id, title, url, parent_id, sort_order, is_active FROM nav_menus
       WHERE menu_location = ${location} AND is_active = true
       ORDER BY parent_id NULLS FIRST, sort_order ASC LIMIT 100
    `);
    const rows = r?.rows ?? r ?? [];
    return { ok: true, output: { location, count: rows.length, menus: rows } };
  } catch (err: any) { return { ok: false, error: `메뉴 조회 실패: ${err?.message?.slice(0, 200)}` }; }
}

/* ─────────────────────────────────────────
   회원
   ───────────────────────────────────────── */

async function tool_membersSearch(args: any): Promise<ToolResult> {
  const q = String(args?.query || "").trim();
  if (!q) return { ok: false, error: "query 필수" };
  const limit = Math.min(Number(args?.limit) || 10, 30);   /* X-3: 기본 20 → 10 */
  const typeFilter = ["regular","family","volunteer","admin"].includes(String(args?.type))
    ? sql`AND type = ${args.type}` : sql``;
  /* X-3: created_at 제거 — AI가 거의 안 씀 */
  const r: any = await db.execute(sql`
    SELECT id, name, email, phone, type, status FROM members
     WHERE (name ILIKE ${`%${q}%`} OR email ILIKE ${`%${q}%`} OR phone ILIKE ${`%${q}%`})
       ${typeFilter}
     ORDER BY id DESC LIMIT ${limit}
  `);
  const rows = r?.rows ?? r ?? [];
  return { ok: true, output: { count: rows.length, members: rows } };
}

async function tool_membersDetail(args: any): Promise<ToolResult> {
  const id = Number(args?.memberId);
  if (!id) return { ok: false, error: "memberId 필수" };
  const r: any = await db.execute(sql`
    SELECT id, name, email, phone, type, status, role, created_at, last_login_at,
           donor_type, prospect_subtype, prospect_event_name
      FROM members WHERE id = ${id} LIMIT 1
  `);
  const row = (r?.rows ?? r ?? [])[0];
  if (!row) return { ok: false, error: `회원 #${id} 없음` };
  return { ok: true, output: { member: row } };
}

async function tool_membersStats(): Promise<ToolResult> {
  const r: any = await db.execute(sql`
    SELECT
      type,
      status,
      COUNT(*)::int AS count
    FROM members
    GROUP BY type, status
    ORDER BY type, status
  `);
  const rows = r?.rows ?? r ?? [];
  const totalRes: any = await db.execute(sql`SELECT COUNT(*)::int AS total FROM members`);
  const total = Number((totalRes?.rows ?? totalRes)[0]?.total) || 0;
  return { ok: true, output: { total, breakdown: rows } };
}

async function tool_membersRecent(args: any): Promise<ToolResult> {
  const limit = Math.min(Number(args?.limit) || 10, 30);   /* X-3: 최대 50 → 30 */
  /* "최근" 도구라 created_at 유지 */
  const r: any = await db.execute(sql`
    SELECT id, name, email, type, status, created_at FROM members
     ORDER BY created_at DESC LIMIT ${limit}
  `);
  const rows = r?.rows ?? r ?? [];
  return { ok: true, output: { count: rows.length, members: rows } };
}

/* ─────────────────────────────────────────
   후원
   ───────────────────────────────────────── */

async function tool_donationsRecent(args: any): Promise<ToolResult> {
  const limit = Math.min(Number(args?.limit) || 10, 30);   /* X-3: 기본 20 → 10, 최대 50 → 30 */
  const status = args?.status ? String(args.status) : null;
  const where = status ? sql`WHERE status = ${status}` : sql``;
  /* X-3: pay_method 제거 — 자주 안 쓰임 */
  const r: any = await db.execute(sql`
    SELECT id, member_id, donor_name, amount, type, status, created_at FROM donations
      ${where}
     ORDER BY created_at DESC LIMIT ${limit}
  `);
  const rows = r?.rows ?? r ?? [];
  return { ok: true, output: { count: rows.length, donations: rows } };
}

async function tool_donationsStats(args: any): Promise<ToolResult> {
  const months = Math.min(Number(args?.months) || 1, 12);
  const r: any = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE status='completed')::int AS completed_count,
      COALESCE(SUM(amount) FILTER (WHERE status='completed'), 0)::bigint AS completed_sum,
      COUNT(*) FILTER (WHERE type='regular' AND status='completed')::int AS regular_count,
      COUNT(*) FILTER (WHERE type='one_time' AND status='completed')::int AS onetime_count
    FROM donations
    WHERE created_at >= NOW() - (${months}::int * INTERVAL '1 month')
  `);
  const stats = (r?.rows ?? r ?? [])[0] || {};
  return { ok: true, output: { months, ...stats } };
}

async function tool_donationsByMember(args: any): Promise<ToolResult> {
  const memberId = Number(args?.memberId);
  if (!memberId) return { ok: false, error: "memberId 필수" };
  const limit = Math.min(Number(args?.limit) || 20, 50);
  const r: any = await db.execute(sql`
    SELECT id, amount, type, status, pay_method, created_at FROM donations
     WHERE member_id = ${memberId}
     ORDER BY created_at DESC LIMIT ${limit}
  `);
  const rows = r?.rows ?? r ?? [];
  const sumRes: any = await db.execute(sql`
    SELECT COALESCE(SUM(amount), 0)::bigint AS total
      FROM donations WHERE member_id = ${memberId} AND status = 'completed'
  `);
  const total = Number((sumRes?.rows ?? sumRes)[0]?.total) || 0;
  return { ok: true, output: { memberId, totalAmountCompleted: total, count: rows.length, donations: rows } };
}

/* ─────────────────────────────────────────
   SIREN 신고
   ───────────────────────────────────────── */

async function tool_incidentsList(args: any): Promise<ToolResult> {
  const limit = Math.min(Number(args?.limit) || 10, 30);   /* X-3: 20→10, 50→30 */
  const conds: any[] = [];
  if (args?.status) conds.push(sql`status = ${String(args.status)}`);
  if (args?.category) conds.push(sql`category = ${String(args.category)}`);
  const where = conds.length > 0
    ? sql`WHERE ${conds.reduce((a, b, i) => i === 0 ? b : sql`${a} AND ${b}`)}`
    : sql``;
  const r: any = await db.execute(sql`
    SELECT id, slug, title, category, status, occurred_at, created_at
      FROM incidents ${where}
     ORDER BY created_at DESC LIMIT ${limit}
  `);
  const rows = r?.rows ?? r ?? [];
  return { ok: true, output: { count: rows.length, incidents: rows } };
}

async function tool_incidentsDetail(args: any): Promise<ToolResult> {
  const id = Number(args?.incidentId);
  if (!id) return { ok: false, error: "incidentId 필수" };
  /* X-3: SELECT * → 핵심 필드만 (content_html 등 큰 필드 제외) */
  const r: any = await db.execute(sql`
    SELECT id, slug, title, category, status, occurred_at, location,
           description, member_id, ai_severity, ai_summary, created_at
      FROM incidents WHERE id = ${id} LIMIT 1
  `);
  const row = (r?.rows ?? r ?? [])[0];
  if (!row) return { ok: false, error: `사건 #${id} 없음` };
  return { ok: true, output: { incident: row } };
}

async function tool_harassmentList(args: any): Promise<ToolResult> {
  const limit = Math.min(Number(args?.limit) || 10, 30);
  const conds: any[] = [];
  if (args?.status) conds.push(sql`status = ${String(args.status)}`);
  if (args?.severity) conds.push(sql`ai_severity = ${String(args.severity)}`);
  const where = conds.length > 0
    ? sql`WHERE ${conds.reduce((a, b, i) => i === 0 ? b : sql`${a} AND ${b}`)}`
    : sql``;
  const r: any = await db.execute(sql`
    SELECT id, report_no, member_id, category, title, status, ai_severity, created_at
      FROM harassment_reports ${where}
     ORDER BY created_at DESC LIMIT ${limit}
  `);
  const rows = r?.rows ?? r ?? [];
  return { ok: true, output: { count: rows.length, reports: rows } };
}

async function tool_legalList(args: any): Promise<ToolResult> {
  const limit = Math.min(Number(args?.limit) || 10, 30);
  const where = args?.status ? sql`WHERE status = ${String(args.status)}` : sql``;
  const r: any = await db.execute(sql`
    SELECT id, consultation_no, member_id, category, title, status, created_at
      FROM legal_consultations ${where}
     ORDER BY created_at DESC LIMIT ${limit}
  `);
  const rows = r?.rows ?? r ?? [];
  return { ok: true, output: { count: rows.length, consultations: rows } };
}

/* ─────────────────────────────────────────
   게시판·캠페인
   ───────────────────────────────────────── */

async function tool_boardPostsList(args: any): Promise<ToolResult> {
  const limit = Math.min(Number(args?.limit) || 10, 30);   /* X-3: 20→10, 50→30 */
  const sortBy = String(args?.sortBy || "recent");
  const orderBy = sortBy === "views" ? sql`views DESC, id DESC`
                : sortBy === "likes" ? sql`like_count DESC, id DESC`
                : sql`id DESC`;
  const where = args?.category ? sql`WHERE category = ${String(args.category)}` : sql``;
  /* X-3: post_no 제거 (id로 식별 충분), is_pinned는 정렬 시만 의미있어 제거 */
  const r: any = await db.execute(sql`
    SELECT id, member_id, title, category, views, like_count, created_at
      FROM board_posts ${where}
     ORDER BY ${orderBy} LIMIT ${limit}
  `);
  const rows = r?.rows ?? r ?? [];
  return { ok: true, output: { count: rows.length, posts: rows } };
}

async function tool_campaignsList(args: any): Promise<ToolResult> {
  const limit = Math.min(Number(args?.limit) || 10, 30);   /* X-3: 20→10 */
  const where = args?.status ? sql`WHERE status = ${String(args.status)}` : sql``;
  const r: any = await db.execute(sql`
    SELECT id, slug, type, title, status, goal_amount, raised_amount, created_at
      FROM campaigns ${where}
     ORDER BY id DESC LIMIT ${limit}
  `);
  const rows = r?.rows ?? r ?? [];
  return { ok: true, output: { count: rows.length, campaigns: rows } };
}

async function tool_campaignsDetail(args: any): Promise<ToolResult> {
  const id = Number(args?.campaignId);
  if (!id) return { ok: false, error: "campaignId 필수" };
  /* X-3: SELECT * → 핵심 필드만 (content_html 등 큰 본문 제외, 요약만) */
  const r: any = await db.execute(sql`
    SELECT id, slug, type, title, summary, status, goal_amount, raised_amount,
           donor_count, start_date, end_date, is_published, views, created_at
      FROM campaigns WHERE id = ${id} LIMIT 1
  `);
  const row = (r?.rows ?? r ?? [])[0];
  if (!row) return { ok: false, error: `캠페인 #${id} 없음` };
  const progress = row.goal_amount > 0
    ? Math.round((Number(row.raised_amount || 0) / Number(row.goal_amount)) * 100) : 0;
  return { ok: true, output: { campaign: row, progressPercent: progress } };
}

/* ─────────────────────────────────────────
   워크스페이스·알림·KPI
   ───────────────────────────────────────── */

async function tool_tasksList(args: any): Promise<ToolResult> {
  const limit = Math.min(Number(args?.limit) || 10, 30);   /* X-3: 20→10, 50→30 */
  const conds: any[] = [];
  if (args?.status) conds.push(sql`status = ${String(args.status)}`);
  if (args?.memberId) conds.push(sql`member_id = ${Number(args.memberId)}`);
  const where = conds.length > 0
    ? sql`WHERE ${conds.reduce((a, b, i) => i === 0 ? b : sql`${a} AND ${b}`)}`
    : sql``;
  /* X-3: created_at 제거 (id로 정렬 충분) */
  const r: any = await db.execute(sql`
    SELECT id, member_id, title, status, priority, due_date, progress
      FROM workspace_tasks ${where}
     ORDER BY due_date ASC NULLS LAST, id DESC LIMIT ${limit}
  `);
  const rows = r?.rows ?? r ?? [];
  return { ok: true, output: { count: rows.length, tasks: rows } };
}

async function tool_notificationsRecent(args: any): Promise<ToolResult> {
  const memberId = Number(args?.memberId);
  if (!memberId) return { ok: false, error: "memberId 필수" };
  const limit = Math.min(Number(args?.limit) || 10, 30);
  const r: any = await db.execute(sql`
    SELECT id, category, severity, title, message, is_read, created_at FROM notifications
     WHERE recipient_id = ${memberId}
     ORDER BY created_at DESC LIMIT ${limit}
  `);
  const rows = r?.rows ?? r ?? [];
  return { ok: true, output: { count: rows.length, notifications: rows } };
}

async function tool_kpiSummary(): Promise<ToolResult> {
  try {
    const r: any = await db.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM members WHERE status = 'active') AS active_members,
        (SELECT COUNT(*)::int FROM members WHERE created_at >= NOW() - INTERVAL '30 days') AS new_members_30d,
        (SELECT COALESCE(SUM(amount), 0)::bigint FROM donations
           WHERE status = 'completed' AND created_at >= DATE_TRUNC('month', NOW())) AS donation_sum_this_month,
        (SELECT COUNT(*)::int FROM donations
           WHERE status = 'completed' AND created_at >= DATE_TRUNC('month', NOW())) AS donation_count_this_month,
        (SELECT COUNT(*)::int FROM incidents WHERE status = 'pending') AS incidents_pending,
        (SELECT COUNT(*)::int FROM harassment_reports WHERE status = 'pending') AS harassment_pending,
        (SELECT COUNT(*)::int FROM legal_consultations WHERE status = 'pending') AS legal_pending,
        (SELECT COUNT(*)::int FROM campaigns WHERE status = 'active') AS active_campaigns
    `);
    const row = (r?.rows ?? r ?? [])[0] || {};
    return { ok: true, output: { kpi: row } };
  } catch (err: any) { return { ok: false, error: `KPI 조회 실패: ${err?.message?.slice(0, 200)}` }; }
}

/* =========================================================
   F-7: 변경 도구 3종 — 모두 dry-run 우선
   ========================================================= */

const PRIORITY_MAP: Record<string, string> = {
  low: "low", medium: "normal", high: "high", urgent: "urgent",
};

async function tool_taskCreate(args: any, adminId: number | null): Promise<ToolResult> {
  const title = String(args?.title || "").trim();
  if (!title) return { ok: false, error: "title 필수" };
  if (!adminId) return { ok: false, error: "관리자 인증 필요" };

  const description = String(args?.description || "").slice(0, 5000);
  const priority = PRIORITY_MAP[String(args?.priority || "medium")] || "normal";
  const assignedTo = args?.assignedTo ? Number(args.assignedTo) : null;
  const dueDateStr = String(args?.dueDate || "").trim();
  const dueDate = dueDateStr ? new Date(dueDateStr) : new Date(Date.now() + 7 * 86400000);
  if (isNaN(dueDate.getTime())) return { ok: false, error: "dueDate 형식 오류 (YYYY-MM-DD)" };

  const preview = { title, description: description.slice(0, 200), priority, assignedTo, dueDate: dueDate.toISOString().slice(0, 10) };

  if (args?.requireApproval !== false) {
    return { ok: true, preview, output: { dry_run: true, message: "승인 대기. requireApproval=false로 재호출하면 실제 생성." } };
  }

  try {
    const r: any = await db.execute(sql`
      INSERT INTO workspace_tasks
        (member_id, title, description, status, priority, due_date, assigned_by, assigned_to, source_type, source_id)
      VALUES
        (${adminId}, ${title}, ${description || null}, 'todo', ${priority}, ${dueDate},
         ${adminId}, ${assignedTo}, 'ai_agent', NULL)
      RETURNING id
    `);
    const id = Number((r?.rows ?? r ?? [])[0]?.id) || 0;
    return { ok: true, output: { task_id: id, ...preview }, rollbackData: { table: "workspace_tasks", id } };
  } catch (e: any) {
    return { ok: false, error: `작업 생성 실패: ${e?.message?.slice(0, 200)}` };
  }
}

async function tool_emailSend(args: any, adminId: number | null): Promise<ToolResult> {
  const ids: number[] = Array.isArray(args?.memberIds) ? args.memberIds.map((n: any) => Number(n)).filter(Boolean) : [];
  if (ids.length === 0) return { ok: false, error: "memberIds 필수" };
  if (ids.length > 50) return { ok: false, error: "한 번에 최대 50명까지" };
  const subject = String(args?.subject || "").trim();
  const body = String(args?.body || "").trim();
  if (!subject) return { ok: false, error: "subject 필수" };
  if (!body) return { ok: false, error: "body 필수" };

  /* 수신자 조회 — 이름·이메일 */
  let recipients: any[] = [];
  try {
    const r: any = await db.execute(sql`
      SELECT id, name, email FROM members
       WHERE id = ANY(${ids}) AND email IS NOT NULL AND email <> ''
       LIMIT 50
    `);
    recipients = r?.rows ?? r ?? [];
  } catch (e: any) {
    return { ok: false, error: `수신자 조회 실패: ${e?.message?.slice(0, 200)}` };
  }
  if (recipients.length === 0) return { ok: false, error: "유효한 수신자 없음 (이메일 등록된 회원만)" };

  const preview = {
    recipientCount: recipients.length,
    recipientNames: recipients.slice(0, 5).map((r: any) => r.name),
    subject, bodyPreview: body.slice(0, 200),
  };

  if (args?.requireApproval !== false) {
    return { ok: true, preview, output: { dry_run: true, message: `승인 대기. ${recipients.length}명에게 발송 예정. requireApproval=false로 재호출하면 실제 발송.` } };
  }

  /* 실제 발송 — 한 명씩 (실패해도 다음 진행) */
  const results = { sent: 0, failed: 0, errors: [] as string[] };
  const isHtml = /<[a-z][\s\S]*>/i.test(body);
  for (const rcpt of recipients) {
    try {
      await sendEmail({
        to: String(rcpt.email),
        subject,
        html: isHtml ? body : `<div style="white-space:pre-wrap">${body.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</div>`,
      });
      results.sent++;
    } catch (e: any) {
      results.failed++;
      results.errors.push(`${rcpt.name}: ${(e?.message || "").slice(0, 80)}`);
    }
  }
  return { ok: true, output: results };
}

/* =========================================================
   X-2: 신고·캠페인·게시판·작업 변경 도구 7종 — dry-run 우선

   공통 패턴: before 조회 → preview → (dry-run) 또는 UPDATE + rollbackData
   ========================================================= */

const ALLOWED_INCIDENT_STATUSES = new Set(["reviewing", "responded", "closed", "rejected"]);
const ALLOWED_HARASSMENT_STATUSES = new Set(["reviewing", "responded", "closed", "rejected"]);
const ALLOWED_LEGAL_STATUSES = new Set(["matching", "matched", "in_progress", "responded", "closed", "rejected"]);
const ALLOWED_TASK_STATUSES = new Set(["todo", "doing", "blocked", "done", "archived"]);
const ALLOWED_TASK_PRIORITIES = new Set(["low", "normal", "high", "urgent"]);

/** 공통 status update — 단순 status·adminNote 변경 패턴용 */
async function genericStatusUpdate(opts: {
  args: any; adminId: number | null;
  tableLabel: string;          // "사건" 등 사용자 메시지용
  table: string;               // "incident_reports" 등 SQL 식별자
  idArg: string;               // "incidentId" 등 args 필드
  allowed: Set<string>;
  hasAdminNote?: boolean;
}): Promise<ToolResult> {
  const { args, adminId, tableLabel, table, idArg, allowed, hasAdminNote } = opts;
  const id = Number(args?.[idArg] || 0);
  const status = String(args?.status || "").trim();
  if (!id) return { ok: false, error: `${idArg} 필수` };
  if (!allowed.has(status)) return { ok: false, error: `status는 ${Array.from(allowed).join("|")}` };
  if (!adminId) return { ok: false, error: "관리자 인증 필요" };
  const adminNote = hasAdminNote ? (String(args?.adminNote || "").trim() || null) : null;

  let before: any = null;
  try {
    const r: any = await db.execute(sql`SELECT id, status FROM ${sql.identifier(table)} WHERE id = ${id} LIMIT 1`);
    before = (r?.rows ?? r ?? [])[0];
  } catch {}
  if (!before) return { ok: false, error: `${tableLabel} 없음` };
  if (before.status === status) return { ok: false, error: `이미 ${status} 상태` };

  const preview = { id, table: tableLabel, before: before.status, after: status, adminNote };
  if (args?.requireApproval !== false) {
    return { ok: true, preview, output: { dry_run: true, message: "승인 대기." } };
  }

  try {
    if (hasAdminNote && adminNote) {
      await db.execute(sql`UPDATE ${sql.identifier(table)} SET status = ${status}, admin_note = ${adminNote} WHERE id = ${id}`);
    } else {
      await db.execute(sql`UPDATE ${sql.identifier(table)} SET status = ${status} WHERE id = ${id}`);
    }
    return { ok: true, output: { updated: true, id, status }, rollbackData: { table, id, before } };
  } catch (e: any) {
    return { ok: false, error: `${tableLabel} 상태 변경 실패: ${e?.message?.slice(0, 200)}` };
  }
}

async function tool_incidentsStatusUpdate(args: any, adminId: number | null) {
  return genericStatusUpdate({ args, adminId, tableLabel: "사건", table: "incident_reports", idArg: "incidentId", allowed: ALLOWED_INCIDENT_STATUSES, hasAdminNote: true });
}
async function tool_harassmentStatusUpdate(args: any, adminId: number | null) {
  return genericStatusUpdate({ args, adminId, tableLabel: "악성민원", table: "harassment_reports", idArg: "reportId", allowed: ALLOWED_HARASSMENT_STATUSES, hasAdminNote: true });
}
async function tool_legalStatusUpdate(args: any, adminId: number | null) {
  return genericStatusUpdate({ args, adminId, tableLabel: "법률상담", table: "legal_consultations", idArg: "consultationId", allowed: ALLOWED_LEGAL_STATUSES, hasAdminNote: true });
}

async function tool_campaignsUpdate(args: any, adminId: number | null): Promise<ToolResult> {
  const id = Number(args?.campaignId || 0);
  if (!id) return { ok: false, error: "campaignId 필수" };
  if (!adminId) return { ok: false, error: "관리자 인증 필요" };

  const patch: Record<string, any> = {};
  if (typeof args?.title === "string" && args.title.trim()) patch.title = args.title.trim().slice(0, 200);
  if (typeof args?.summary === "string") patch.summary = args.summary.slice(0, 500);
  if (Number.isFinite(Number(args?.goalAmount))) patch.goal_amount = Math.max(0, Math.floor(Number(args.goalAmount)));
  if (typeof args?.endDate === "string" && args.endDate.trim()) {
    const d = new Date(args.endDate);
    if (isNaN(d.getTime())) return { ok: false, error: "endDate 형식 오류 (YYYY-MM-DD)" };
    patch.end_date = d;
  }
  if (typeof args?.isPublished === "boolean") patch.is_published = args.isPublished;

  if (Object.keys(patch).length === 0) return { ok: false, error: "변경할 필드 없음" };

  let before: any = null;
  try {
    const r: any = await db.execute(sql`
      SELECT id, title, summary, goal_amount, end_date, is_published FROM campaigns WHERE id = ${id} LIMIT 1
    `);
    before = (r?.rows ?? r ?? [])[0];
  } catch {}
  if (!before) return { ok: false, error: "캠페인 없음" };

  const preview = { campaignId: id, before, changes: patch };
  if (args?.requireApproval !== false) {
    return { ok: true, preview, output: { dry_run: true, message: "승인 대기." } };
  }

  try {
    const setFragments: any[] = [];
    for (const [k, v] of Object.entries(patch)) setFragments.push(sql`${sql.identifier(k)} = ${v}`);
    setFragments.push(sql`updated_at = NOW()` as any);
    await db.execute(sql`UPDATE campaigns SET ${sql.join(setFragments, sql`, `)} WHERE id = ${id}`);
    return { ok: true, output: { updated: true, campaignId: id, changes: patch }, rollbackData: { table: "campaigns", id, before } };
  } catch (e: any) {
    return { ok: false, error: `캠페인 수정 실패: ${e?.message?.slice(0, 200)}` };
  }
}

async function tool_noticeUpdate(args: any, adminId: number | null): Promise<ToolResult> {
  const id = Number(args?.noticeId || 0);
  if (!id) return { ok: false, error: "noticeId 필수" };
  if (!adminId) return { ok: false, error: "관리자 인증 필요" };
  const patch: Record<string, any> = {};
  if (typeof args?.title === "string" && args.title.trim()) patch.title = args.title.trim().slice(0, 200);
  if (typeof args?.body === "string") patch.body = args.body;
  if (Object.keys(patch).length === 0) return { ok: false, error: "변경할 필드 없음" };

  let before: any = null;
  try {
    const r: any = await db.execute(sql`SELECT id, title, body FROM notices WHERE id = ${id} LIMIT 1`);
    before = (r?.rows ?? r ?? [])[0];
  } catch {}
  if (!before) return { ok: false, error: "공지 없음" };

  const preview = { noticeId: id, before: { title: before.title, bodyPreview: String(before.body || "").slice(0, 200) }, changes: { title: patch.title, bodyPreview: typeof patch.body === "string" ? patch.body.slice(0, 200) : undefined } };
  if (args?.requireApproval !== false) {
    return { ok: true, preview, output: { dry_run: true, message: "승인 대기." } };
  }

  try {
    const setFragments: any[] = [];
    for (const [k, v] of Object.entries(patch)) setFragments.push(sql`${sql.identifier(k)} = ${v}`);
    await db.execute(sql`UPDATE notices SET ${sql.join(setFragments, sql`, `)} WHERE id = ${id}`);
    return { ok: true, output: { updated: true, noticeId: id }, rollbackData: { table: "notices", id, before } };
  } catch (e: any) {
    return { ok: false, error: `공지 수정 실패: ${e?.message?.slice(0, 200)}` };
  }
}

async function tool_boardPostDelete(args: any, adminId: number | null): Promise<ToolResult> {
  const id = Number(args?.postId || 0);
  if (!id) return { ok: false, error: "postId 필수" };
  if (!adminId) return { ok: false, error: "관리자 인증 필요" };
  const reason = String(args?.reason || "").trim() || null;

  let before: any = null;
  try {
    const r: any = await db.execute(sql`SELECT id, title, deleted_at FROM board_posts WHERE id = ${id} LIMIT 1`);
    before = (r?.rows ?? r ?? [])[0];
  } catch {}
  if (!before) return { ok: false, error: "게시글 없음" };
  if (before.deleted_at) return { ok: false, error: "이미 삭제된 글" };

  const preview = { postId: id, title: before.title, reason };
  if (args?.requireApproval !== false) {
    return { ok: true, preview, output: { dry_run: true, message: "승인 대기 — soft delete." } };
  }

  try {
    await db.execute(sql`UPDATE board_posts SET deleted_at = NOW() WHERE id = ${id}`);
    return { ok: true, output: { deleted: true, postId: id, reason }, rollbackData: { table: "board_posts", id, action: "soft_delete" } };
  } catch (e: any) {
    return { ok: false, error: `게시글 삭제 실패: ${e?.message?.slice(0, 200)}` };
  }
}

async function tool_taskUpdate(args: any, adminId: number | null): Promise<ToolResult> {
  const id = Number(args?.taskId || 0);
  if (!id) return { ok: false, error: "taskId 필수" };
  if (!adminId) return { ok: false, error: "관리자 인증 필요" };

  const patch: Record<string, any> = {};
  if (typeof args?.status === "string") {
    if (!ALLOWED_TASK_STATUSES.has(args.status)) return { ok: false, error: `status는 ${Array.from(ALLOWED_TASK_STATUSES).join("|")}` };
    patch.status = args.status;
    if (args.status === "done") patch.completed_at = new Date();
  }
  if (Number.isFinite(Number(args?.progress))) {
    const p = Math.max(0, Math.min(100, Math.floor(Number(args.progress))));
    patch.progress = p;
  }
  if (typeof args?.priority === "string") {
    if (!ALLOWED_TASK_PRIORITIES.has(args.priority)) return { ok: false, error: `priority는 ${Array.from(ALLOWED_TASK_PRIORITIES).join("|")}` };
    patch.priority = args.priority;
  }
  if (Number.isFinite(Number(args?.assignedTo))) patch.assigned_to = Number(args.assignedTo);
  if (typeof args?.dueDate === "string" && args.dueDate.trim()) {
    const d = new Date(args.dueDate);
    if (isNaN(d.getTime())) return { ok: false, error: "dueDate 형식 오류" };
    patch.due_date = d;
  }
  if (Object.keys(patch).length === 0) return { ok: false, error: "변경할 필드 없음" };

  let before: any = null;
  try {
    const r: any = await db.execute(sql`SELECT id, title, status, progress, priority, assigned_to, due_date FROM workspace_tasks WHERE id = ${id} LIMIT 1`);
    before = (r?.rows ?? r ?? [])[0];
  } catch {}
  if (!before) return { ok: false, error: "작업 없음" };

  const preview = { taskId: id, title: before.title, before, changes: patch };
  if (args?.requireApproval !== false) {
    return { ok: true, preview, output: { dry_run: true, message: "승인 대기." } };
  }

  try {
    const setFragments: any[] = [];
    for (const [k, v] of Object.entries(patch)) setFragments.push(sql`${sql.identifier(k)} = ${v}`);
    setFragments.push(sql`updated_at = NOW()` as any);
    await db.execute(sql`UPDATE workspace_tasks SET ${sql.join(setFragments, sql`, `)} WHERE id = ${id}`);
    return { ok: true, output: { updated: true, taskId: id, changes: patch }, rollbackData: { table: "workspace_tasks", id, before } };
  } catch (e: any) {
    return { ok: false, error: `작업 수정 실패: ${e?.message?.slice(0, 200)}` };
  }
}

/* =========================================================
   X-1: 회원·후원 변경 도구 4종 — dry-run 우선
   ========================================================= */

const ALLOWED_MEMBER_TYPES = new Set(["regular", "family", "volunteer", "admin"]);

async function tool_membersUpdate(args: any, adminId: number | null): Promise<ToolResult> {
  const memberId = Number(args?.memberId || 0);
  if (!memberId) return { ok: false, error: "memberId 필수" };
  if (!adminId) return { ok: false, error: "관리자 인증 필요" };

  /* 변경 가능 필드만 화이트리스트 */
  const patch: Record<string, any> = {};
  if (typeof args?.name === "string" && args.name.trim()) patch.name = args.name.trim().slice(0, 50);
  if (typeof args?.phone === "string") patch.phone = args.phone.trim().slice(0, 20) || null;
  if (typeof args?.email === "string" && args.email.trim()) patch.email = args.email.trim().toLowerCase().slice(0, 100);
  if (typeof args?.type === "string" && ALLOWED_MEMBER_TYPES.has(args.type)) patch.type = args.type;
  if (typeof args?.agreeEmail === "boolean") patch.agree_email = args.agreeEmail;
  if (typeof args?.agreeSms === "boolean") patch.agree_sms = args.agreeSms;
  if (typeof args?.agreeMail === "boolean") patch.agree_mail = args.agreeMail;
  if (typeof args?.memberCategory === "string") patch.member_category = args.memberCategory.slice(0, 20);

  if (Object.keys(patch).length === 0) return { ok: false, error: "변경할 필드 없음" };

  /* 변경 전 값 조회 (rollbackData용) */
  let beforeRow: any = null;
  try {
    const r: any = await db.execute(sql`
      SELECT id, name, phone, email, type, agree_email, agree_sms, agree_mail, member_category
        FROM members WHERE id = ${memberId} LIMIT 1
    `);
    beforeRow = (r?.rows ?? r ?? [])[0];
  } catch {}
  if (!beforeRow) return { ok: false, error: "회원 없음" };

  const preview = { memberId, before: beforeRow, changes: patch };

  if (args?.requireApproval !== false) {
    return { ok: true, preview, output: { dry_run: true, message: "승인 대기. requireApproval=false로 재호출하면 실제 적용." } };
  }

  /* 동적 SET 절 조립 */
  try {
    const setFragments: any[] = [];
    for (const [k, v] of Object.entries(patch)) {
      setFragments.push(sql`${sql.identifier(k)} = ${v}`);
    }
    setFragments.push(sql`updated_at = NOW()` as any);
    /* updated_at 컬럼이 members에 있는지 모르므로 무해하게 try, 실패 시 그것만 빼고 재시도 */
    try {
      await db.execute(sql`UPDATE members SET ${sql.join(setFragments, sql`, `)} WHERE id = ${memberId}`);
    } catch {
      setFragments.pop();  /* updated_at 빼고 재시도 */
      await db.execute(sql`UPDATE members SET ${sql.join(setFragments, sql`, `)} WHERE id = ${memberId}`);
    }
    return { ok: true, output: { updated: true, memberId, changes: patch }, rollbackData: { table: "members", id: memberId, before: beforeRow } };
  } catch (e: any) {
    return { ok: false, error: `회원 수정 실패: ${e?.message?.slice(0, 200)}` };
  }
}

async function tool_membersBlock(args: any, adminId: number | null): Promise<ToolResult> {
  const memberId = Number(args?.memberId || 0);
  if (!memberId) return { ok: false, error: "memberId 필수" };
  if (!adminId) return { ok: false, error: "관리자 인증 필요" };
  const reason = String(args?.reason || "").trim();
  if (!reason) return { ok: false, error: "reason 필수" };

  let before: any = null;
  try {
    const r: any = await db.execute(sql`
      SELECT id, name, status, blacklisted_at FROM members WHERE id = ${memberId} LIMIT 1
    `);
    before = (r?.rows ?? r ?? [])[0];
  } catch {}
  if (!before) return { ok: false, error: "회원 없음" };
  if (before.status === "suspended" && before.blacklisted_at) {
    return { ok: false, error: "이미 차단된 회원" };
  }

  const preview = { memberId, name: before.name, reason };
  if (args?.requireApproval !== false) {
    return { ok: true, preview, output: { dry_run: true, message: "승인 대기." } };
  }

  try {
    await db.execute(sql`
      UPDATE members
         SET status = 'suspended',
             blacklisted_at = NOW(),
             blacklisted_by = ${adminId},
             blacklist_reason = ${reason}
       WHERE id = ${memberId}
    `);
    return { ok: true, output: { blocked: true, memberId, reason }, rollbackData: { table: "members", id: memberId, before } };
  } catch (e: any) {
    return { ok: false, error: `차단 실패: ${e?.message?.slice(0, 200)}` };
  }
}

async function tool_membersUnblock(args: any, adminId: number | null): Promise<ToolResult> {
  const memberId = Number(args?.memberId || 0);
  if (!memberId) return { ok: false, error: "memberId 필수" };
  if (!adminId) return { ok: false, error: "관리자 인증 필요" };

  let before: any = null;
  try {
    const r: any = await db.execute(sql`
      SELECT id, name, status, blacklisted_at, blacklist_reason FROM members WHERE id = ${memberId} LIMIT 1
    `);
    before = (r?.rows ?? r ?? [])[0];
  } catch {}
  if (!before) return { ok: false, error: "회원 없음" };
  if (!before.blacklisted_at) return { ok: false, error: "차단 상태 아님" };

  const preview = { memberId, name: before.name, currentReason: before.blacklist_reason };
  if (args?.requireApproval !== false) {
    return { ok: true, preview, output: { dry_run: true, message: "승인 대기." } };
  }

  try {
    await db.execute(sql`
      UPDATE members
         SET status = 'active',
             blacklisted_at = NULL,
             blacklisted_by = NULL,
             blacklist_reason = NULL
       WHERE id = ${memberId}
    `);
    return { ok: true, output: { unblocked: true, memberId }, rollbackData: { table: "members", id: memberId, before } };
  } catch (e: any) {
    return { ok: false, error: `차단 해제 실패: ${e?.message?.slice(0, 200)}` };
  }
}

const ALLOWED_DONATION_STATUSES = new Set(["pending", "completed", "refunded", "failed"]);

async function tool_donationsStatusUpdate(args: any, adminId: number | null): Promise<ToolResult> {
  const donationId = Number(args?.donationId || 0);
  const status = String(args?.status || "").trim();
  if (!donationId) return { ok: false, error: "donationId 필수" };
  if (!ALLOWED_DONATION_STATUSES.has(status)) return { ok: false, error: "status는 pending|completed|refunded|failed" };
  if (!adminId) return { ok: false, error: "관리자 인증 필요" };
  const reason = String(args?.reason || "").trim() || null;

  let before: any = null;
  try {
    const r: any = await db.execute(sql`
      SELECT id, donor_name, amount, status, failure_reason FROM donations WHERE id = ${donationId} LIMIT 1
    `);
    before = (r?.rows ?? r ?? [])[0];
  } catch {}
  if (!before) return { ok: false, error: "후원 없음" };
  if (before.status === status) return { ok: false, error: `이미 ${status} 상태` };

  const preview = { donationId, donor: before.donor_name, amount: before.amount, before: before.status, after: status, reason };
  if (args?.requireApproval !== false) {
    return { ok: true, preview, output: { dry_run: true, message: "승인 대기." } };
  }

  try {
    if (reason && (status === "refunded" || status === "failed")) {
      await db.execute(sql`
        UPDATE donations SET status = ${status}, failure_reason = ${reason} WHERE id = ${donationId}
      `);
    } else {
      await db.execute(sql`
        UPDATE donations SET status = ${status} WHERE id = ${donationId}
      `);
    }
    return { ok: true, output: { updated: true, donationId, status, reason }, rollbackData: { table: "donations", id: donationId, before } };
  } catch (e: any) {
    return { ok: false, error: `후원 상태 변경 실패: ${e?.message?.slice(0, 200)}` };
  }
}

async function tool_notificationSend(args: any, adminId: number | null): Promise<ToolResult> {
  const ids: number[] = Array.isArray(args?.memberIds) ? args.memberIds.map((n: any) => Number(n)).filter(Boolean) : [];
  if (ids.length === 0) return { ok: false, error: "memberIds 필수" };
  if (ids.length > 100) return { ok: false, error: "한 번에 최대 100명까지" };
  const title = String(args?.title || "").trim();
  if (!title) return { ok: false, error: "title 필수" };
  const body = String(args?.body || "").trim();
  const linkUrl = String(args?.linkUrl || "").trim() || null;

  const preview = { recipientCount: ids.length, title, bodyPreview: body.slice(0, 200), linkUrl };

  if (args?.requireApproval !== false) {
    return { ok: true, preview, output: { dry_run: true, message: `승인 대기. ${ids.length}명에게 알림 예정.` } };
  }

  /* 일괄 INSERT */
  let inserted = 0;
  try {
    for (const memberId of ids) {
      await db.execute(sql`
        INSERT INTO workspace_notifications
          (member_id, source_type, source_id, notif_type, channel, title, body, action_url, category)
        VALUES
          (${memberId}, 'system', ${adminId || 0}, 'system', 'bell',
           ${title}, ${body || null}, ${linkUrl}, 'system')
      `);
      inserted++;
    }
    return { ok: true, output: { inserted, total: ids.length } };
  } catch (e: any) {
    return { ok: false, error: `알림 발송 실패: ${e?.message?.slice(0, 200)} (성공 ${inserted}/${ids.length})` };
  }
}

/* =========================================================
   추가 읽기 도구 6종 — 보안·발송·후원자 분석
   ========================================================= */

async function tool_auditLogsRecent(args: any): Promise<ToolResult> {
  const limit = Math.min(Number(args?.limit) || 10, 50);
  const conds: any[] = [];
  if (args?.action) conds.push(sql`action ILIKE ${`%${String(args.action)}%`}`);
  if (Number.isFinite(Number(args?.userId))) conds.push(sql`user_id = ${Number(args.userId)}`);
  if (args?.riskLevel) conds.push(sql`risk_level = ${String(args.riskLevel)}`);
  const where = conds.length > 0 ? sql`WHERE ${sql.join(conds, sql` AND `)}` : sql``;
  try {
    const r: any = await db.execute(sql`
      SELECT id, user_id, user_name, action, target, success, risk_level, created_at
        FROM audit_logs ${where}
       ORDER BY created_at DESC LIMIT ${limit}
    `);
    const rows = r?.rows ?? r ?? [];
    return { ok: true, output: { count: rows.length, logs: rows } };
  } catch (e: any) {
    return { ok: false, error: `감사 로그 조회 실패: ${e?.message?.slice(0, 200)}` };
  }
}

async function tool_membersRecentLogins(args: any): Promise<ToolResult> {
  const hours = Math.min(Math.max(Number(args?.hours) || 24, 1), 168);  /* 1h ~ 7d */
  const limit = Math.min(Number(args?.limit) || 10, 50);
  try {
    const r: any = await db.execute(sql`
      SELECT id, name, email, type, last_login_at, last_login_ip
        FROM members
       WHERE last_login_at > NOW() - INTERVAL '${sql.raw(String(hours))} hours'
       ORDER BY last_login_at DESC LIMIT ${limit}
    `);
    const rows = r?.rows ?? r ?? [];
    return { ok: true, output: { count: rows.length, hours, members: rows } };
  } catch (e: any) {
    return { ok: false, error: `로그인 이력 조회 실패: ${e?.message?.slice(0, 200)}` };
  }
}

async function tool_dispatchLogsRecent(args: any): Promise<ToolResult> {
  const limit = Math.min(Number(args?.limit) || 10, 50);
  const conds: any[] = [];
  if (args?.channel) conds.push(sql`channel = ${String(args.channel)}`);
  if (args?.status) conds.push(sql`status = ${String(args.status)}`);
  const where = conds.length > 0 ? sql`WHERE ${sql.join(conds, sql` AND `)}` : sql``;
  try {
    const r: any = await db.execute(sql`
      SELECT id, channel, recipient_email, recipient_phone, subject, status, error_message, sent_at
        FROM notification_dispatch_logs ${where}
       ORDER BY sent_at DESC LIMIT ${limit}
    `);
    const rows = r?.rows ?? r ?? [];
    return { ok: true, output: { count: rows.length, logs: rows } };
  } catch (e: any) {
    return { ok: false, error: `발송 이력 조회 실패: ${e?.message?.slice(0, 200)}` };
  }
}

async function tool_autoTriggersRecent(args: any): Promise<ToolResult> {
  const limit = Math.min(Number(args?.limit) || 10, 50);
  const where = args?.status ? sql`WHERE r.status = ${String(args.status)}` : sql``;
  try {
    const r: any = await db.execute(sql`
      SELECT r.id, r.trigger_id, t.name AS trigger_name, r.job_id,
             r.triggered_at, r.member_count, r.status, r.error
        FROM communication_auto_trigger_runs r
        LEFT JOIN communication_auto_triggers t ON t.id = r.trigger_id
        ${where}
       ORDER BY r.triggered_at DESC LIMIT ${limit}
    `);
    const rows = r?.rows ?? r ?? [];
    return { ok: true, output: { count: rows.length, runs: rows } };
  } catch (e: any) {
    return { ok: false, error: `트리거 이력 조회 실패: ${e?.message?.slice(0, 200)}` };
  }
}

async function tool_donorsTop(args: any): Promise<ToolResult> {
  const months = Math.min(Math.max(Number(args?.months) || 12, 1), 36);
  const limit = Math.min(Number(args?.limit) || 10, 30);
  try {
    const r: any = await db.execute(sql`
      SELECT d.member_id, m.name, m.email,
             COUNT(*)::int AS donation_count,
             COALESCE(SUM(d.amount), 0)::bigint AS total_amount
        FROM donations d
        LEFT JOIN members m ON m.id = d.member_id
       WHERE d.status = 'completed'
         AND d.created_at > NOW() - INTERVAL '${sql.raw(String(months))} months'
         AND d.member_id IS NOT NULL
       GROUP BY d.member_id, m.name, m.email
       ORDER BY total_amount DESC
       LIMIT ${limit}
    `);
    const rows = r?.rows ?? r ?? [];
    return { ok: true, output: { count: rows.length, months, top_donors: rows } };
  } catch (e: any) {
    return { ok: false, error: `고액 후원자 조회 실패: ${e?.message?.slice(0, 200)}` };
  }
}

async function tool_donorsAtRisk(args: any): Promise<ToolResult> {
  const limit = Math.min(Number(args?.limit) || 10, 50);
  const level = String(args?.level || "").trim();
  const where = level && (level === "high" || level === "critical")
    ? sql`WHERE churn_risk_level = ${level}`
    : sql`WHERE churn_risk_level IN ('high', 'critical')`;
  try {
    const r: any = await db.execute(sql`
      SELECT id, name, email, type, churn_risk_score, churn_risk_level,
             donor_type, last_login_at
        FROM members
        ${where}
       ORDER BY churn_risk_score DESC NULLS LAST
       LIMIT ${limit}
    `);
    const rows = r?.rows ?? r ?? [];
    return { ok: true, output: { count: rows.length, at_risk: rows } };
  } catch (e: any) {
    return { ok: false, error: `이탈 위험 후원자 조회 실패: ${e?.message?.slice(0, 200)}` };
  }
}

/* =========================================================
   Phase 1 — 워크스페이스 확장 (메모·캘린더·댓글·작업삭제·파일목록)
   모든 변경 도구는 dry-run 우선 + rollbackData
   ========================================================= */

const ALLOWED_MEMO_COLORS = new Set(["yellow", "pink", "blue", "green", "gray", "purple", "orange"]);
const ALLOWED_EVENT_COLORS = new Set(["blue", "red", "green", "yellow", "purple", "orange", "gray"]);
const ALLOWED_EVENT_TYPES = new Set(["general", "meeting", "board_meeting", "counseling", "deadline", "recurring"]);

/* ─── 메모 ─────────────────────────────────────────── */
async function tool_memosList(args: any, adminId: number | null): Promise<ToolResult> {
  if (!adminId) return { ok: false, error: "관리자 인증 필요" };
  const limit = Math.min(Number(args?.limit) || 30, 100);
  const pinnedFirst = args?.pinnedFirst !== false;
  try {
    const r: any = await db.execute(sql`
      SELECT id, title, content_html, color, is_pinned, event_date, show_in_calendar,
             created_at, updated_at
        FROM workspace_memos
       WHERE member_id = ${adminId}
       ORDER BY ${pinnedFirst ? sql`is_pinned DESC,` : sql``} updated_at DESC
       LIMIT ${limit}
    `);
    const rows = r?.rows ?? r ?? [];
    return { ok: true, output: { count: rows.length, memos: rows.map((m: any) => ({
      id: m.id, title: m.title, contentPreview: String(m.content_html || "").replace(/<[^>]+>/g, "").slice(0, 200),
      color: m.color, isPinned: m.is_pinned,
      eventDate: m.event_date, showInCalendar: m.show_in_calendar,
      updatedAt: m.updated_at,
    })) } };
  } catch (e: any) {
    return { ok: false, error: `메모 조회 실패: ${e?.message?.slice(0, 200)}` };
  }
}

async function tool_memoCreate(args: any, adminId: number | null): Promise<ToolResult> {
  if (!adminId) return { ok: false, error: "관리자 인증 필요" };
  const content = String(args?.content || "").trim();
  if (!content) return { ok: false, error: "content 필수" };
  const title = String(args?.title || "").trim().slice(0, 200) || null;
  const color = ALLOWED_MEMO_COLORS.has(args?.color) ? args.color : "yellow";
  const isPinned = args?.isPinned === true;
  const eventDateStr = String(args?.eventDate || "").trim();
  const eventDate = eventDateStr ? new Date(eventDateStr) : null;
  if (eventDate && isNaN(eventDate.getTime())) return { ok: false, error: "eventDate 형식 오류 (YYYY-MM-DD)" };
  const showInCalendar = args?.showInCalendar === true || !!eventDate;

  const preview = { title, contentPreview: content.slice(0, 200), color, isPinned, eventDate: eventDateStr || null, showInCalendar };
  if (args?.requireApproval !== false) {
    return { ok: true, preview, output: { dry_run: true, message: "승인 대기. requireApproval=false로 재호출 시 생성." } };
  }
  try {
    const r: any = await db.execute(sql`
      INSERT INTO workspace_memos
        (member_id, title, content_html, color, is_pinned, event_date, show_in_calendar)
      VALUES
        (${adminId}, ${title}, ${content}, ${color}, ${isPinned},
         ${eventDate ? eventDate.toISOString().slice(0, 10) : null}, ${showInCalendar})
      RETURNING id
    `);
    const id = Number((r?.rows ?? r ?? [])[0]?.id) || 0;
    return { ok: true, output: { memo_id: id, ...preview }, rollbackData: { table: "workspace_memos", id } };
  } catch (e: any) {
    return { ok: false, error: `메모 생성 실패: ${e?.message?.slice(0, 200)}` };
  }
}

async function tool_memoUpdate(args: any, adminId: number | null): Promise<ToolResult> {
  if (!adminId) return { ok: false, error: "관리자 인증 필요" };
  const id = Number(args?.memoId || 0);
  if (!id) return { ok: false, error: "memoId 필수" };

  const patch: Record<string, any> = {};
  if (typeof args?.title === "string") patch.title = args.title.slice(0, 200) || null;
  if (typeof args?.content === "string") patch.content_html = args.content;
  if (typeof args?.color === "string" && ALLOWED_MEMO_COLORS.has(args.color)) patch.color = args.color;
  if (typeof args?.isPinned === "boolean") patch.is_pinned = args.isPinned;
  if (Object.keys(patch).length === 0) return { ok: false, error: "변경할 필드 없음" };

  let before: any = null;
  try {
    const r: any = await db.execute(sql`
      SELECT id, member_id, title, content_html, color, is_pinned
        FROM workspace_memos WHERE id = ${id} LIMIT 1
    `);
    before = (r?.rows ?? r ?? [])[0];
  } catch {}
  if (!before) return { ok: false, error: "메모 없음" };
  if (Number(before.member_id) !== adminId) return { ok: false, error: "타인의 메모는 수정할 수 없습니다" };

  const preview = { memoId: id, before, changes: patch };
  if (args?.requireApproval !== false) {
    return { ok: true, preview, output: { dry_run: true, message: "승인 대기." } };
  }
  try {
    const setFragments: any[] = [];
    for (const [k, v] of Object.entries(patch)) setFragments.push(sql`${sql.identifier(k)} = ${v}`);
    setFragments.push(sql`updated_at = NOW()` as any);
    await db.execute(sql`UPDATE workspace_memos SET ${sql.join(setFragments, sql`, `)} WHERE id = ${id}`);
    return { ok: true, output: { updated: true, memoId: id, changes: patch }, rollbackData: { table: "workspace_memos", id, before } };
  } catch (e: any) {
    return { ok: false, error: `메모 수정 실패: ${e?.message?.slice(0, 200)}` };
  }
}

async function tool_memoDelete(args: any, adminId: number | null): Promise<ToolResult> {
  if (!adminId) return { ok: false, error: "관리자 인증 필요" };
  const id = Number(args?.memoId || 0);
  if (!id) return { ok: false, error: "memoId 필수" };

  let before: any = null;
  try {
    const r: any = await db.execute(sql`
      SELECT id, member_id, title, content_html, color, is_pinned, event_date, show_in_calendar
        FROM workspace_memos WHERE id = ${id} LIMIT 1
    `);
    before = (r?.rows ?? r ?? [])[0];
  } catch {}
  if (!before) return { ok: false, error: "메모 없음" };
  if (Number(before.member_id) !== adminId) return { ok: false, error: "타인의 메모는 삭제할 수 없습니다" };

  const preview = { memoId: id, title: before.title, contentPreview: String(before.content_html || "").replace(/<[^>]+>/g, "").slice(0, 150) };
  if (args?.requireApproval !== false) {
    return { ok: true, preview, output: { dry_run: true, message: "승인 대기. 영구 삭제됩니다." } };
  }
  try {
    await db.execute(sql`DELETE FROM workspace_memos WHERE id = ${id}`);
    return { ok: true, output: { deleted: true, memoId: id }, rollbackData: { table: "workspace_memos", id, before } };
  } catch (e: any) {
    return { ok: false, error: `메모 삭제 실패: ${e?.message?.slice(0, 200)}` };
  }
}

/* ─── 캘린더 일정 ─────────────────────────────────────────── */
async function tool_eventsList(args: any, adminId: number | null): Promise<ToolResult> {
  if (!adminId) return { ok: false, error: "관리자 인증 필요" };
  const fromStr = String(args?.fromDate || "").trim();
  const toStr = String(args?.toDate || "").trim();
  const from = fromStr ? new Date(fromStr) : new Date(Date.now() - 1 * 86400000);
  const to = toStr ? new Date(toStr) : new Date(Date.now() + 30 * 86400000);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) return { ok: false, error: "날짜 형식 오류 (YYYY-MM-DD)" };
  const limit = Math.min(Number(args?.limit) || 50, 200);
  try {
    const r: any = await db.execute(sql`
      SELECT id, title, start_at, end_at, all_day, color, location, event_type, description
        FROM workspace_events
       WHERE member_id = ${adminId}
         AND start_at <= ${to} AND end_at >= ${from}
       ORDER BY start_at ASC
       LIMIT ${limit}
    `);
    const rows = r?.rows ?? r ?? [];
    return { ok: true, output: { count: rows.length, from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), events: rows } };
  } catch (e: any) {
    return { ok: false, error: `일정 조회 실패: ${e?.message?.slice(0, 200)}` };
  }
}

async function tool_eventCreate(args: any, adminId: number | null): Promise<ToolResult> {
  if (!adminId) return { ok: false, error: "관리자 인증 필요" };
  const title = String(args?.title || "").trim();
  if (!title) return { ok: false, error: "title 필수" };
  const startStr = String(args?.startAt || "").trim();
  if (!startStr) return { ok: false, error: "startAt 필수" };
  const startAt = new Date(startStr);
  if (isNaN(startAt.getTime())) return { ok: false, error: "startAt 형식 오류" };
  const allDay = args?.allDay === true || !/T\d/.test(startStr);
  let endAt: Date;
  if (args?.endAt) {
    endAt = new Date(args.endAt);
    if (isNaN(endAt.getTime())) return { ok: false, error: "endAt 형식 오류" };
  } else {
    endAt = allDay ? new Date(startAt.getTime() + 86400000) : new Date(startAt.getTime() + 60 * 60 * 1000);
  }
  const color = ALLOWED_EVENT_COLORS.has(args?.color) ? args.color : "blue";
  const eventType = ALLOWED_EVENT_TYPES.has(args?.eventType) ? args.eventType : "general";
  const location = String(args?.location || "").slice(0, 300) || null;
  const description = String(args?.description || "").slice(0, 2000) || null;

  const preview = {
    title, startAt: startAt.toISOString(), endAt: endAt.toISOString(),
    allDay, color, eventType, location, descriptionPreview: description?.slice(0, 150) || null,
  };
  if (args?.requireApproval !== false) {
    return { ok: true, preview, output: { dry_run: true, message: "승인 대기." } };
  }
  try {
    const r: any = await db.execute(sql`
      INSERT INTO workspace_events
        (member_id, title, start_at, end_at, all_day, color, location, description, event_type, created_by_agent)
      VALUES
        (${adminId}, ${title}, ${startAt}, ${endAt}, ${allDay}, ${color},
         ${location}, ${description}, ${eventType}, 'ai_agent')
      RETURNING id
    `);
    const id = Number((r?.rows ?? r ?? [])[0]?.id) || 0;
    return { ok: true, output: { event_id: id, ...preview }, rollbackData: { table: "workspace_events", id } };
  } catch (e: any) {
    return { ok: false, error: `일정 생성 실패: ${e?.message?.slice(0, 200)}` };
  }
}

async function tool_eventUpdate(args: any, adminId: number | null): Promise<ToolResult> {
  if (!adminId) return { ok: false, error: "관리자 인증 필요" };
  const id = Number(args?.eventId || 0);
  if (!id) return { ok: false, error: "eventId 필수" };

  const patch: Record<string, any> = {};
  if (typeof args?.title === "string" && args.title.trim()) patch.title = args.title.trim().slice(0, 300);
  if (typeof args?.startAt === "string" && args.startAt.trim()) {
    const d = new Date(args.startAt);
    if (isNaN(d.getTime())) return { ok: false, error: "startAt 형식 오류" };
    patch.start_at = d;
  }
  if (typeof args?.endAt === "string" && args.endAt.trim()) {
    const d = new Date(args.endAt);
    if (isNaN(d.getTime())) return { ok: false, error: "endAt 형식 오류" };
    patch.end_at = d;
  }
  if (typeof args?.allDay === "boolean") patch.all_day = args.allDay;
  if (typeof args?.color === "string" && ALLOWED_EVENT_COLORS.has(args.color)) patch.color = args.color;
  if (typeof args?.location === "string") patch.location = args.location.slice(0, 300) || null;
  if (typeof args?.description === "string") patch.description = args.description.slice(0, 2000) || null;
  if (typeof args?.eventType === "string" && ALLOWED_EVENT_TYPES.has(args.eventType)) patch.event_type = args.eventType;
  if (Object.keys(patch).length === 0) return { ok: false, error: "변경할 필드 없음" };

  let before: any = null;
  try {
    const r: any = await db.execute(sql`
      SELECT id, member_id, title, start_at, end_at, all_day, color, location, description, event_type
        FROM workspace_events WHERE id = ${id} LIMIT 1
    `);
    before = (r?.rows ?? r ?? [])[0];
  } catch {}
  if (!before) return { ok: false, error: "일정 없음" };
  if (Number(before.member_id) !== adminId) return { ok: false, error: "타인의 일정은 수정할 수 없습니다" };

  const preview = { eventId: id, title: before.title, before, changes: patch };
  if (args?.requireApproval !== false) {
    return { ok: true, preview, output: { dry_run: true, message: "승인 대기." } };
  }
  try {
    const setFragments: any[] = [];
    for (const [k, v] of Object.entries(patch)) setFragments.push(sql`${sql.identifier(k)} = ${v}`);
    setFragments.push(sql`updated_at = NOW()` as any);
    await db.execute(sql`UPDATE workspace_events SET ${sql.join(setFragments, sql`, `)} WHERE id = ${id}`);
    return { ok: true, output: { updated: true, eventId: id, changes: patch }, rollbackData: { table: "workspace_events", id, before } };
  } catch (e: any) {
    return { ok: false, error: `일정 수정 실패: ${e?.message?.slice(0, 200)}` };
  }
}

async function tool_eventDelete(args: any, adminId: number | null): Promise<ToolResult> {
  if (!adminId) return { ok: false, error: "관리자 인증 필요" };
  const id = Number(args?.eventId || 0);
  if (!id) return { ok: false, error: "eventId 필수" };

  let before: any = null;
  try {
    const r: any = await db.execute(sql`
      SELECT id, member_id, title, start_at, end_at, all_day, color, location, description, event_type
        FROM workspace_events WHERE id = ${id} LIMIT 1
    `);
    before = (r?.rows ?? r ?? [])[0];
  } catch {}
  if (!before) return { ok: false, error: "일정 없음" };
  if (Number(before.member_id) !== adminId) return { ok: false, error: "타인의 일정은 삭제할 수 없습니다" };

  const preview = { eventId: id, title: before.title, startAt: before.start_at };
  if (args?.requireApproval !== false) {
    return { ok: true, preview, output: { dry_run: true, message: "승인 대기. 영구 삭제됩니다." } };
  }
  try {
    await db.execute(sql`DELETE FROM workspace_events WHERE id = ${id}`);
    return { ok: true, output: { deleted: true, eventId: id }, rollbackData: { table: "workspace_events", id, before } };
  } catch (e: any) {
    return { ok: false, error: `일정 삭제 실패: ${e?.message?.slice(0, 200)}` };
  }
}

/* ─── 작업 댓글 ─────────────────────────────────────────── */
async function tool_taskCommentsList(args: any): Promise<ToolResult> {
  const taskId = Number(args?.taskId || 0);
  if (!taskId) return { ok: false, error: "taskId 필수" };
  const limit = Math.min(Number(args?.limit) || 20, 100);
  try {
    const r: any = await db.execute(sql`
      SELECT c.id, c.member_id, m.name AS member_name, c.content, c.mentions,
             c.parent_comment_id, c.created_at, c.updated_at
        FROM workspace_task_comments c
        LEFT JOIN members m ON m.id = c.member_id
       WHERE c.task_id = ${taskId} AND c.deleted_at IS NULL
       ORDER BY c.created_at ASC
       LIMIT ${limit}
    `);
    const rows = r?.rows ?? r ?? [];
    return { ok: true, output: { count: rows.length, taskId, comments: rows } };
  } catch (e: any) {
    return { ok: false, error: `댓글 조회 실패: ${e?.message?.slice(0, 200)}` };
  }
}

async function tool_taskCommentAdd(args: any, adminId: number | null): Promise<ToolResult> {
  if (!adminId) return { ok: false, error: "관리자 인증 필요" };
  const taskId = Number(args?.taskId || 0);
  if (!taskId) return { ok: false, error: "taskId 필수" };
  const content = String(args?.content || "").trim();
  if (!content) return { ok: false, error: "content 필수" };
  const mentions: number[] = Array.isArray(args?.mentions)
    ? args.mentions.map((n: any) => Number(n)).filter(Boolean) : [];

  /* 작업 존재 확인 */
  let task: any = null;
  try {
    const r: any = await db.execute(sql`SELECT id, title FROM workspace_tasks WHERE id = ${taskId} LIMIT 1`);
    task = (r?.rows ?? r ?? [])[0];
  } catch {}
  if (!task) return { ok: false, error: "작업 없음" };

  const preview = { taskId, taskTitle: task.title, contentPreview: content.slice(0, 200), mentionCount: mentions.length };
  if (args?.requireApproval !== false) {
    return { ok: true, preview, output: { dry_run: true, message: "승인 대기." } };
  }
  try {
    const r: any = await db.execute(sql`
      INSERT INTO workspace_task_comments
        (task_id, member_id, content, mentions)
      VALUES
        (${taskId}, ${adminId}, ${content}, ${JSON.stringify(mentions)}::jsonb)
      RETURNING id
    `);
    const id = Number((r?.rows ?? r ?? [])[0]?.id) || 0;
    return { ok: true, output: { comment_id: id, ...preview }, rollbackData: { table: "workspace_task_comments", id } };
  } catch (e: any) {
    return { ok: false, error: `댓글 추가 실패: ${e?.message?.slice(0, 200)}` };
  }
}

/* ─── 작업 삭제 ─────────────────────────────────────────── */
async function tool_taskDelete(args: any, adminId: number | null): Promise<ToolResult> {
  if (!adminId) return { ok: false, error: "관리자 인증 필요" };
  const id = Number(args?.taskId || 0);
  if (!id) return { ok: false, error: "taskId 필수" };

  let before: any = null;
  try {
    const r: any = await db.execute(sql`
      SELECT id, member_id, assigned_to, title, status, due_date, priority, progress
        FROM workspace_tasks WHERE id = ${id} LIMIT 1
    `);
    before = (r?.rows ?? r ?? [])[0];
  } catch {}
  if (!before) return { ok: false, error: "작업 없음" };
  /* 소유자(member_id) 또는 배정자(assigned_to)만 삭제 가능 */
  if (Number(before.member_id) !== adminId && Number(before.assigned_to) !== adminId) {
    return { ok: false, error: "본인이 소유하거나 배정받은 작업만 삭제 가능합니다" };
  }

  /* 종속 카운트 표시 */
  let commentCount = 0; let reportCount = 0; let attachmentCount = 0;
  try {
    const cr: any = await db.execute(sql`SELECT COUNT(*)::int AS n FROM workspace_task_comments WHERE task_id = ${id}`);
    commentCount = Number((cr?.rows ?? cr ?? [])[0]?.n) || 0;
    const rr: any = await db.execute(sql`SELECT COUNT(*)::int AS n FROM workspace_task_reports WHERE task_id = ${id}`);
    reportCount = Number((rr?.rows ?? rr ?? [])[0]?.n) || 0;
    const ar: any = await db.execute(sql`SELECT COUNT(*)::int AS n FROM workspace_task_attachments WHERE task_id = ${id}`);
    attachmentCount = Number((ar?.rows ?? ar ?? [])[0]?.n) || 0;
  } catch {}

  const preview = { taskId: id, title: before.title, status: before.status, commentCount, reportCount, attachmentCount };
  if (args?.requireApproval !== false) {
    return { ok: true, preview, output: { dry_run: true, message: `승인 대기. 작업 + 댓글 ${commentCount}건 + 보고서 ${reportCount}건 + 첨부연결 ${attachmentCount}건 영구 삭제됩니다.` } };
  }
  try {
    await db.execute(sql`DELETE FROM workspace_tasks WHERE id = ${id}`);
    return { ok: true, output: { deleted: true, taskId: id, cascaded: { comments: commentCount, reports: reportCount, attachments: attachmentCount } }, rollbackData: { table: "workspace_tasks", id, before } };
  } catch (e: any) {
    return { ok: false, error: `작업 삭제 실패: ${e?.message?.slice(0, 200)}` };
  }
}

/* ─── 파일 목록 (읽기 전용) ─────────────────────────────────────────── */
async function tool_filesList(args: any, adminId: number | null): Promise<ToolResult> {
  if (!adminId) return { ok: false, error: "관리자 인증 필요" };
  const folderId = args?.folderId != null ? Number(args.folderId) : null;
  const limit = Math.min(Number(args?.limit) || 30, 100);
  try {
    /* 폴더 */
    const folderR: any = await db.execute(sql`
      SELECT id, name, parent_id, depth, is_shared, created_at
        FROM workspace_folders
       WHERE deleted_at IS NULL
         AND (owner_id = ${adminId} OR is_shared = true)
         AND parent_id ${folderId == null ? sql`IS NULL` : sql`= ${folderId}`}
       ORDER BY name
       LIMIT ${limit}
    `);
    const folders = folderR?.rows ?? folderR ?? [];
    /* 파일 */
    const fileR: any = await db.execute(sql`
      SELECT id, name, ext, mime_type, size_bytes, is_shared, download_count, created_at
        FROM workspace_files
       WHERE deleted_at IS NULL
         AND (owner_id = ${adminId} OR is_shared = true)
         AND folder_id ${folderId == null ? sql`IS NULL` : sql`= ${folderId}`}
       ORDER BY created_at DESC
       LIMIT ${limit}
    `);
    const files = fileR?.rows ?? fileR ?? [];
    return { ok: true, output: { folderId, folderCount: folders.length, fileCount: files.length, folders, files } };
  } catch (e: any) {
    return { ok: false, error: `파일 목록 조회 실패: ${e?.message?.slice(0, 200)}` };
  }
}

/* =========================================================
   Phase 2 — 콘텐츠·게시판·캠페인·공지·FAQ (10개)
   표준 §3.3 — 직접 DB + dry-run + rollbackData
   ========================================================= */

const ALLOWED_NOTICE_CATEGORIES = new Set(["general", "event", "press", "notice"]);
const ALLOWED_BOARD_CATEGORIES  = new Set(["general", "notice", "qna", "free", "share"]);
const ALLOWED_CAMPAIGN_STATUSES = new Set(["draft", "active", "ended", "archived"]);

/* ─── 공지 ──────────────────────────────────────────── */
async function tool_noticesList(args: any): Promise<ToolResult> {
  const limit = Math.min(Number(args?.limit) || 20, 100);
  const conds: any[] = [];
  if (typeof args?.category === "string" && ALLOWED_NOTICE_CATEGORIES.has(args.category)) {
    conds.push(sql`category = ${args.category}`);
  }
  if (typeof args?.isPublished === "boolean") {
    conds.push(sql`is_published = ${args.isPublished}`);
  }
  const where = conds.length > 0 ? sql`WHERE ${sql.join(conds, sql` AND `)}` : sql``;
  try {
    const r: any = await db.execute(sql`
      SELECT id, category, title, is_pinned, is_published, views, created_at, updated_at
        FROM notices ${where}
       ORDER BY is_pinned DESC, created_at DESC
       LIMIT ${limit}
    `);
    const rows = r?.rows ?? r ?? [];
    return { ok: true, output: { count: rows.length, notices: rows } };
  } catch (e: any) {
    return { ok: false, error: `공지 조회 실패: ${e?.message?.slice(0, 200)}` };
  }
}

async function tool_noticeDelete(args: any, adminId: number | null): Promise<ToolResult> {
  if (!adminId) return { ok: false, error: "관리자 인증 필요" };
  const id = Number(args?.noticeId || 0);
  if (!id) return { ok: false, error: "noticeId 필수" };

  let before: any = null;
  try {
    const r: any = await db.execute(sql`
      SELECT id, category, title, is_pinned, is_published, content, author_name
        FROM notices WHERE id = ${id} LIMIT 1
    `);
    before = (r?.rows ?? r ?? [])[0];
  } catch {}
  if (!before) return { ok: false, error: "공지 없음" };

  const preview = { noticeId: id, title: before.title, category: before.category,
    contentPreview: String(before.content || "").slice(0, 150) };
  if (args?.requireApproval !== false) {
    return { ok: true, preview, output: { dry_run: true, message: "승인 대기. 영구 삭제됩니다." } };
  }
  try {
    await db.execute(sql`DELETE FROM notices WHERE id = ${id}`);
    return { ok: true, output: { deleted: true, noticeId: id },
      rollbackData: { table: "notices", id, before } };
  } catch (e: any) {
    return { ok: false, error: `공지 삭제 실패: ${e?.message?.slice(0, 200)}` };
  }
}

/* ─── 콘텐츠 페이지 ─────────────────────────────────── */
async function tool_pageCreate(args: any, adminId: number | null): Promise<ToolResult> {
  if (!adminId) return { ok: false, error: "관리자 인증 필요" };
  const pageKey = String(args?.pageKey || "").trim().slice(0, 100);
  if (!pageKey) return { ok: false, error: "pageKey 필수" };
  if (!/^[a-z0-9_-]+$/.test(pageKey)) return { ok: false, error: "pageKey는 소문자·숫자·_·- 만 허용" };
  const contentHtml = String(args?.contentHtml || "");
  if (!contentHtml) return { ok: false, error: "contentHtml 필수" };
  const title = args?.title ? String(args.title).slice(0, 200) : null;

  /* 중복 확인 */
  try {
    const r: any = await db.execute(sql`SELECT page_key FROM content_pages WHERE page_key = ${pageKey} LIMIT 1`);
    if ((r?.rows ?? r ?? []).length > 0) {
      return { ok: false, error: `pageKey '${pageKey}' 이미 존재. page_delete 후 재생성 또는 content_pages_update 사용` };
    }
  } catch {}

  const preview = { pageKey, title, contentPreview: contentHtml.slice(0, 200) };
  if (args?.requireApproval !== false) {
    return { ok: true, preview, output: { dry_run: true, message: "승인 대기." } };
  }
  try {
    const r: any = await db.execute(sql`
      INSERT INTO content_pages (page_key, title, content_html, updated_by, updated_at)
      VALUES (${pageKey}, ${title}, ${contentHtml}, ${adminId}, NOW())
      RETURNING id
    `);
    const id = Number((r?.rows ?? r ?? [])[0]?.id) || 0;
    return { ok: true, output: { id, pageKey, title }, rollbackData: { table: "content_pages", pageKey } };
  } catch (e: any) {
    return { ok: false, error: `페이지 생성 실패: ${e?.message?.slice(0, 200)}` };
  }
}

async function tool_pageDelete(args: any, adminId: number | null): Promise<ToolResult> {
  if (!adminId) return { ok: false, error: "관리자 인증 필요" };
  const pageKey = String(args?.pageKey || "").trim();
  if (!pageKey) return { ok: false, error: "pageKey 필수" };

  let before: any = null;
  try {
    const r: any = await db.execute(sql`
      SELECT id, page_key, title, content_html FROM content_pages WHERE page_key = ${pageKey} LIMIT 1
    `);
    before = (r?.rows ?? r ?? [])[0];
  } catch {}
  if (!before) return { ok: false, error: `pageKey '${pageKey}' 없음` };

  const preview = { pageKey, title: before.title, contentPreview: String(before.content_html || "").slice(0, 150) };
  if (args?.requireApproval !== false) {
    return { ok: true, preview, output: { dry_run: true, message: "승인 대기. 영구 삭제됩니다." } };
  }
  try {
    await db.execute(sql`DELETE FROM content_pages WHERE page_key = ${pageKey}`);
    return { ok: true, output: { deleted: true, pageKey },
      rollbackData: { table: "content_pages", pageKey, before } };
  } catch (e: any) {
    return { ok: false, error: `페이지 삭제 실패: ${e?.message?.slice(0, 200)}` };
  }
}

/* ─── 게시판 ────────────────────────────────────────── */
async function tool_boardPostCreate(args: any, adminId: number | null): Promise<ToolResult> {
  if (!adminId) return { ok: false, error: "관리자 인증 필요" };
  const title = String(args?.title || "").trim();
  if (!title) return { ok: false, error: "title 필수" };
  const content = String(args?.content || "").trim();
  if (!content) return { ok: false, error: "content 필수" };
  const category = ALLOWED_BOARD_CATEGORIES.has(args?.category) ? args.category : "general";
  const isPinned = args?.isPinned === true;

  /* 관리자 이름 + postNo 발급 */
  let authorName = "관리자";
  try {
    const r: any = await db.execute(sql`SELECT name FROM members WHERE id = ${adminId} LIMIT 1`);
    authorName = (r?.rows ?? r ?? [])[0]?.name || "관리자";
  } catch {}
  const postNo = `P${Date.now().toString(36).toUpperCase()}`;

  const preview = { title, category, isPinned, contentPreview: content.slice(0, 200), authorName };
  if (args?.requireApproval !== false) {
    return { ok: true, preview, output: { dry_run: true, message: "승인 대기." } };
  }
  try {
    const r: any = await db.execute(sql`
      INSERT INTO board_posts (post_no, member_id, author_name, category, title, content_html, is_pinned)
      VALUES (${postNo}, ${adminId}, ${authorName}, ${category}, ${title.slice(0, 200)}, ${content}, ${isPinned})
      RETURNING id, post_no
    `);
    const row = (r?.rows ?? r ?? [])[0] || {};
    return { ok: true, output: { post_id: row.id, post_no: row.post_no, title, category },
      rollbackData: { table: "board_posts", id: row.id } };
  } catch (e: any) {
    return { ok: false, error: `게시글 작성 실패: ${e?.message?.slice(0, 200)}` };
  }
}

async function tool_boardPostUpdate(args: any, adminId: number | null): Promise<ToolResult> {
  if (!adminId) return { ok: false, error: "관리자 인증 필요" };
  const id = Number(args?.postId || 0);
  if (!id) return { ok: false, error: "postId 필수" };

  const patch: Record<string, any> = {};
  if (typeof args?.title === "string" && args.title.trim()) patch.title = args.title.trim().slice(0, 200);
  if (typeof args?.content === "string") patch.content_html = args.content;
  if (typeof args?.category === "string" && ALLOWED_BOARD_CATEGORIES.has(args.category)) patch.category = args.category;
  if (typeof args?.isPinned === "boolean") patch.is_pinned = args.isPinned;
  if (typeof args?.isHidden === "boolean") patch.is_hidden = args.isHidden;
  if (Object.keys(patch).length === 0) return { ok: false, error: "변경할 필드 없음" };

  let before: any = null;
  try {
    const r: any = await db.execute(sql`
      SELECT id, title, category, is_pinned, is_hidden FROM board_posts WHERE id = ${id} LIMIT 1
    `);
    before = (r?.rows ?? r ?? [])[0];
  } catch {}
  if (!before) return { ok: false, error: "게시글 없음" };

  const preview = { postId: id, before, changes: patch };
  if (args?.requireApproval !== false) {
    return { ok: true, preview, output: { dry_run: true, message: "승인 대기." } };
  }
  try {
    const setFragments: any[] = [];
    for (const [k, v] of Object.entries(patch)) setFragments.push(sql`${sql.identifier(k)} = ${v}`);
    setFragments.push(sql`updated_at = NOW()` as any);
    await db.execute(sql`UPDATE board_posts SET ${sql.join(setFragments, sql`, `)} WHERE id = ${id}`);
    return { ok: true, output: { updated: true, postId: id, changes: patch },
      rollbackData: { table: "board_posts", id, before } };
  } catch (e: any) {
    return { ok: false, error: `게시글 수정 실패: ${e?.message?.slice(0, 200)}` };
  }
}

async function tool_boardCommentsList(args: any): Promise<ToolResult> {
  const postId = Number(args?.postId || 0);
  if (!postId) return { ok: false, error: "postId 필수" };
  const includeHidden = args?.includeHidden === true;
  const limit = Math.min(Number(args?.limit) || 30, 200);
  const where = includeHidden ? sql`WHERE post_id = ${postId}` : sql`WHERE post_id = ${postId} AND is_hidden = false`;
  try {
    const r: any = await db.execute(sql`
      SELECT id, post_id, member_id, author_name, content, parent_id, is_hidden, is_anonymous, created_at
        FROM board_comments ${where}
       ORDER BY created_at ASC
       LIMIT ${limit}
    `);
    const rows = r?.rows ?? r ?? [];
    return { ok: true, output: { count: rows.length, postId, comments: rows } };
  } catch (e: any) {
    return { ok: false, error: `댓글 조회 실패: ${e?.message?.slice(0, 200)}` };
  }
}

async function tool_boardCommentHide(args: any, adminId: number | null): Promise<ToolResult> {
  if (!adminId) return { ok: false, error: "관리자 인증 필요" };
  const id = Number(args?.commentId || 0);
  if (!id) return { ok: false, error: "commentId 필수" };
  const targetHidden = args?.unhide === true ? false : true;

  let before: any = null;
  try {
    const r: any = await db.execute(sql`
      SELECT id, post_id, author_name, content, is_hidden FROM board_comments WHERE id = ${id} LIMIT 1
    `);
    before = (r?.rows ?? r ?? [])[0];
  } catch {}
  if (!before) return { ok: false, error: "댓글 없음" };
  if (before.is_hidden === targetHidden) {
    return { ok: false, error: targetHidden ? "이미 숨겨진 댓글" : "이미 보이는 댓글" };
  }

  const preview = { commentId: id, action: targetHidden ? "숨김" : "숨김 해제",
    contentPreview: String(before.content || "").slice(0, 150) };
  if (args?.requireApproval !== false) {
    return { ok: true, preview, output: { dry_run: true, message: "승인 대기." } };
  }
  try {
    await db.execute(sql`UPDATE board_comments SET is_hidden = ${targetHidden} WHERE id = ${id}`);
    return { ok: true, output: { updated: true, commentId: id, isHidden: targetHidden },
      rollbackData: { table: "board_comments", id, before } };
  } catch (e: any) {
    return { ok: false, error: `댓글 숨김 변경 실패: ${e?.message?.slice(0, 200)}` };
  }
}

/* ─── 캠페인 ────────────────────────────────────────── */
async function tool_campaignArchive(args: any, adminId: number | null): Promise<ToolResult> {
  if (!adminId) return { ok: false, error: "관리자 인증 필요" };
  const id = Number(args?.campaignId || 0);
  if (!id) return { ok: false, error: "campaignId 필수" };

  let before: any = null;
  try {
    const r: any = await db.execute(sql`
      SELECT id, slug, title, status, is_published, raised_amount, donor_count
        FROM campaigns WHERE id = ${id} LIMIT 1
    `);
    before = (r?.rows ?? r ?? [])[0];
  } catch {}
  if (!before) return { ok: false, error: "캠페인 없음" };
  if (before.status === "archived") return { ok: false, error: "이미 아카이브된 캠페인" };

  const preview = { campaignId: id, title: before.title, slug: before.slug,
    currentStatus: before.status, raisedAmount: before.raised_amount, donorCount: before.donor_count,
    changes: { status: "archived", is_published: false } };
  if (args?.requireApproval !== false) {
    return { ok: true, preview, output: { dry_run: true,
      message: `승인 대기. 캠페인이 'archived' 상태가 되고 게시 해제됩니다 (기록은 보존).` } };
  }
  try {
    await db.execute(sql`
      UPDATE campaigns SET status = 'archived', is_published = false, updated_at = NOW()
       WHERE id = ${id}
    `);
    return { ok: true, output: { archived: true, campaignId: id, title: before.title },
      rollbackData: { table: "campaigns", id, before } };
  } catch (e: any) {
    return { ok: false, error: `캠페인 아카이브 실패: ${e?.message?.slice(0, 200)}` };
  }
}

/* ─── FAQ ───────────────────────────────────────────── */
async function tool_faqsList(args: any): Promise<ToolResult> {
  const limit = Math.min(Number(args?.limit) || 30, 200);
  const conds: any[] = [];
  if (typeof args?.category === "string" && args.category.trim()) {
    conds.push(sql`category = ${args.category.trim()}`);
  }
  if (typeof args?.isActive === "boolean") {
    conds.push(sql`is_active = ${args.isActive}`);
  }
  const where = conds.length > 0 ? sql`WHERE ${sql.join(conds, sql` AND `)}` : sql``;
  try {
    const r: any = await db.execute(sql`
      SELECT id, category, question, answer, sort_order, is_active, views, updated_at
        FROM faqs ${where}
       ORDER BY sort_order ASC, id ASC
       LIMIT ${limit}
    `);
    const rows = r?.rows ?? r ?? [];
    return { ok: true, output: { count: rows.length, faqs: rows.map((f: any) => ({
      id: f.id, category: f.category, question: f.question,
      answerPreview: String(f.answer || "").slice(0, 200),
      isActive: f.is_active, views: f.views,
    })) } };
  } catch (e: any) {
    return { ok: false, error: `FAQ 조회 실패: ${e?.message?.slice(0, 200)}` };
  }
}
