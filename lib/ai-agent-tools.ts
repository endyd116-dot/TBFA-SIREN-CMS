// lib/ai-agent-tools.ts
// AI 에이전트가 호출할 수 있는 SIREN 도구 정의 + 실행 핸들러
// Phase A: 콘텐츠·관리 + 읽기 도구 대폭 확장 (총 20개)

import { sql } from "drizzle-orm";
import { db } from "../db";
import { sendEmail, renderEmailLayout } from "./email";
import { resolvePeriod } from "./period-filter";
import { downloadFromR2 } from "./r2-server";

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
      category: { type: "STRING", description: "general|member|event|media (기본 general)" }, requireApproval: { type: "BOOLEAN" },
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
  { name: "email_send", description: "이메일 발송 (회원 ID 목록 또는 직접 이메일 주소, 파일함 파일 첨부 가능). memberIds와 toEmails 중 하나 이상 필수. wrapWithLayout=true 시 SIREN 공식 브랜드 템플릿(흑백+금색 테두리, 깔끔)으로 자동 래핑 — '가장 깔끔한 템플릿', '격식 있게' 요청 시 반드시 true.",
    parameters: { type: "OBJECT", properties: {
      memberIds: { type: "ARRAY", items: { type: "INTEGER" }, description: "회원 ID 목록 (최대 50명). toEmails와 함께 쓸 수 있음." },
      toEmails: { type: "ARRAY", items: { type: "STRING" }, description: "직접 지정 이메일 주소 목록 (최대 10개). 회원이 아닌 외부 주소 포함 가능." },
      subject: { type: "STRING" }, body: { type: "STRING", description: "본문. wrapWithLayout=true 시 HTML 태그 사용 가능(p, strong, br 등). 평문도 자동 변환." },
      wrapWithLayout: { type: "BOOLEAN", description: "SIREN 이메일 레이아웃으로 래핑. 격식 있는 발송 시 true 권장." },
      layout: { type: "STRING", description: "템플릿 종류 (wrapWithLayout=true 시 적용). classic: 검정+금색 전통 SIREN 스타일 | minimal: 순백 미니멀 좌측 블루 액센트 — B2B 공문·영업 최적 | gradient: 인디고→퍼플 그라디언트 헤더 — 캠페인·이벤트 초대 | editorial: 크림 배경 세리프 타이틀 — 뉴스레터·장문 소식. 미지정 시 classic." },
      ctaText: { type: "STRING", description: "wrapWithLayout=true 시 하단 버튼 텍스트. 예: '홈페이지 방문하기'" },
      ctaUrl: { type: "STRING", description: "CTA 버튼 링크 URL" },
      requireApproval: { type: "BOOLEAN" },
      attachmentFileIds: { type: "ARRAY", items: { type: "INTEGER" }, description: "파일함(workspace_files)에서 첨부할 파일 ID 목록 (최대 5개). files_list 도구로 ID를 먼저 확인." },
    }, required: ["subject", "body"] }},
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
  { name: "files_list", description: "워크스페이스 파일·폴더 목록 (호출자 본인 소유 또는 공유받은 것). email_send의 attachmentFileIds에 쓸 파일 ID를 이 도구로 먼저 확인.",
    parameters: { type: "OBJECT", properties: {
      folderId: { type: "INTEGER", description: "폴더 ID (생략 시 루트)" },
      search: { type: "STRING", description: "파일 이름 키워드 검색 (부분 일치). 예: 'NPO 제안서'" },
      limit: { type: "INTEGER" },
    }}},

  /* === Phase 2 — 콘텐츠·게시판·캠페인·공지·FAQ (10개) === */
  { name: "notices_list", description: "공지 목록 (최신순)",
    parameters: { type: "OBJECT", properties: {
      category: { type: "STRING", description: "general|member|event|media" },
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

  /* === Phase 3 — FAQ CUD·자료실·알림 템플릿·수신자 그룹·사건 의견 (10개) === */
  { name: "faq_create", description: "FAQ 생성 (dry-run 우선)",
    parameters: { type: "OBJECT", properties: {
      question: { type: "STRING" }, answer: { type: "STRING" },
      category: { type: "STRING" }, sortOrder: { type: "INTEGER" },
      isActive: { type: "BOOLEAN" }, requireApproval: { type: "BOOLEAN" },
    }, required: ["question", "answer"] }},
  { name: "faq_update", description: "FAQ 수정 (질문·답변·카테고리·정렬·활성여부, dry-run 우선)",
    parameters: { type: "OBJECT", properties: {
      faqId: { type: "INTEGER" },
      question: { type: "STRING" }, answer: { type: "STRING" },
      category: { type: "STRING" }, sortOrder: { type: "INTEGER" }, isActive: { type: "BOOLEAN" },
      requireApproval: { type: "BOOLEAN" },
    }, required: ["faqId"] }},
  { name: "faq_delete", description: "FAQ 영구 삭제 (dry-run 우선)",
    parameters: { type: "OBJECT", properties: {
      faqId: { type: "INTEGER" }, requireApproval: { type: "BOOLEAN" },
    }, required: ["faqId"] }},

  { name: "resources_list", description: "자료실 자료 목록 (카테고리·게시 필터)",
    parameters: { type: "OBJECT", properties: {
      categoryId: { type: "INTEGER" }, isPublished: { type: "BOOLEAN" },
      accessLevel: { type: "STRING", description: "public|member|family" },
      limit: { type: "INTEGER" },
    }}},
  { name: "resource_categories_list", description: "자료실 카테고리 목록",
    parameters: { type: "OBJECT", properties: { isActive: { type: "BOOLEAN" } }}},

  { name: "templates_list", description: "알림 발송 템플릿 목록 (채널·카테고리·활성여부 필터)",
    parameters: { type: "OBJECT", properties: {
      channel: { type: "STRING", description: "email|sms|kakao" },
      category: { type: "STRING" }, isActive: { type: "BOOLEAN" }, limit: { type: "INTEGER" },
    }}},
  { name: "template_create", description: "알림 템플릿 생성 (dry-run 우선)",
    parameters: { type: "OBJECT", properties: {
      name: { type: "STRING" }, channel: { type: "STRING", description: "email|sms|kakao" },
      category: { type: "STRING" }, subject: { type: "STRING" }, bodyTemplate: { type: "STRING" },
      requireApproval: { type: "BOOLEAN" },
    }, required: ["name", "channel", "category", "bodyTemplate"] }},
  { name: "template_update", description: "알림 템플릿 수정 (이름·제목·본문·활성여부, dry-run 우선)",
    parameters: { type: "OBJECT", properties: {
      templateId: { type: "INTEGER" },
      name: { type: "STRING" }, subject: { type: "STRING" }, bodyTemplate: { type: "STRING" },
      isActive: { type: "BOOLEAN" }, requireApproval: { type: "BOOLEAN" },
    }, required: ["templateId"] }},

  { name: "recipient_groups_list", description: "수신자 그룹 목록 (활성여부 필터)",
    parameters: { type: "OBJECT", properties: { isActive: { type: "BOOLEAN" }, limit: { type: "INTEGER" }}}},

  { name: "incident_comment_add", description: "사건 제보에 운영자 의견·답변 추가 (dry-run 우선). isPrivate=true는 내부 메모.",
    parameters: { type: "OBJECT", properties: {
      incidentId: { type: "INTEGER" }, content: { type: "STRING" },
      isPrivate: { type: "BOOLEAN", description: "true=내부 메모(신고자 안 보임), false=공개 답변" },
      requireApproval: { type: "BOOLEAN" },
    }, required: ["incidentId", "content"] }},

  /* === Phase 4 — 잠재후원자·자료 CUD·예산·정책·채팅 (10개) === */
  { name: "potential_donors_list", description: "잠재 후원자 목록 (행사·기간 필터, 연결 여부)",
    parameters: { type: "OBJECT", properties: {
      eventName: { type: "STRING" }, linkedOnly: { type: "BOOLEAN", description: "true=정회원과 연결된 것만" },
      unlinkedOnly: { type: "BOOLEAN" }, limit: { type: "INTEGER" },
    }}},
  { name: "potential_donor_link", description: "잠재 후원자를 정회원과 연결 (dry-run 우선)",
    parameters: { type: "OBJECT", properties: {
      potentialDonorId: { type: "INTEGER" }, memberId: { type: "INTEGER" },
      requireApproval: { type: "BOOLEAN" },
    }, required: ["potentialDonorId", "memberId"] }},

  { name: "resource_create", description: "자료실 자료 신규 등록 (dry-run 우선)",
    parameters: { type: "OBJECT", properties: {
      title: { type: "STRING" }, categoryId: { type: "INTEGER" },
      description: { type: "STRING" }, contentHtml: { type: "STRING" },
      accessLevel: { type: "STRING", description: "public|member|family" },
      isPublished: { type: "BOOLEAN" }, requireApproval: { type: "BOOLEAN" },
    }, required: ["title"] }},
  { name: "resource_update", description: "자료 수정 (제목·설명·본문·공개레벨·게시여부, dry-run 우선)",
    parameters: { type: "OBJECT", properties: {
      resourceId: { type: "INTEGER" },
      title: { type: "STRING" }, description: { type: "STRING" }, contentHtml: { type: "STRING" },
      accessLevel: { type: "STRING" }, isPublished: { type: "BOOLEAN" }, isPinned: { type: "BOOLEAN" },
      requireApproval: { type: "BOOLEAN" },
    }, required: ["resourceId"] }},
  { name: "resource_delete", description: "자료 영구 삭제 (dry-run 우선)",
    parameters: { type: "OBJECT", properties: {
      resourceId: { type: "INTEGER" }, requireApproval: { type: "BOOLEAN" },
    }, required: ["resourceId"] }},

  { name: "budgets_list", description: "예산 목록 (회계연도별)",
    parameters: { type: "OBJECT", properties: {
      fiscalYear: { type: "INTEGER", description: "예: 2026 (생략 시 올해)" },
    }}},
  { name: "budget_summary", description: "회계연도 예산 vs 지출 비교 (카테고리별 집계)",
    parameters: { type: "OBJECT", properties: {
      fiscalYear: { type: "INTEGER", description: "예: 2026 (생략 시 올해)" },
    }}},

  { name: "donation_policy_get", description: "후원 정책 단건 조회 (금액·계좌·효성 모달 등)",
    parameters: { type: "OBJECT", properties: {} }},

  { name: "chat_rooms_list", description: "채팅방 목록 (카테고리·상태 필터, 미답변 우선)",
    parameters: { type: "OBJECT", properties: {
      status: { type: "STRING", description: "active|closed|archived" },
      category: { type: "STRING" },
      unreadOnly: { type: "BOOLEAN", description: "true=관리자 미확인 메시지 있는 방만" },
      limit: { type: "INTEGER" },
    }}},

  /* === Phase 22-A 매출 (6개) === */
  { name: "revenue_categories_list", description: "후원 외 수입 카테고리 목록 조회",
    parameters: { type: "OBJECT", properties: {} }},

  { name: "revenue_create", description: "후원 외 수입 항목 등록 (draft 상태로 생성, 승인 별도. 회계연도는 recognizedAt 연도로 서버 자동 계산)",
    parameters: { type: "OBJECT", properties: {
      recognizedAt: { type: "STRING",  description: "수입 인식일 YYYY-MM-DD (회계연도 자동 계산용)" },
      categoryId:   { type: "INTEGER", description: "revenue_categories.id (categoryCode와 둘 중 하나 필요)" },
      categoryCode: { type: "STRING",  description: "카테고리 코드 (categoryId 대신 사용 가능)", enum: ["lecture", "govgrant", "corp_sponsor", "twork_on", "twork_si", "etc"] },
      amount:       { type: "INTEGER", description: "금액 (원)" },
      payerName:    { type: "STRING",  description: "지급인·기관명 (선택)" },
      description:  { type: "STRING",  description: "상세 내용 (선택)" },
      receiptUrl:   { type: "STRING",  description: "영수증 URL (선택)" },
    }, required: ["recognizedAt", "amount"] }},

  { name: "revenue_list", description: "후원 외 수입 목록 조회. period로 기간 지정 (기본: 이번 달)",
    parameters: { type: "OBJECT", properties: {
      period:     { type: "STRING",  description: "기간 단위", enum: ["day", "week", "month", "half_year", "year", "custom"], },
      startDate:  { type: "STRING",  description: "custom일 때 시작일 YYYY-MM-DD" },
      endDate:    { type: "STRING",  description: "custom일 때 종료일 YYYY-MM-DD" },
      fiscalYear: { type: "INTEGER", description: "연도(숫자)만 넘기면 해당 연도 1/1~12/31 (하위호환)" },
      status:     { type: "STRING",  description: "수입 상태", enum: ["draft", "approved", "rejected", "all"] },
      categoryId: { type: "INTEGER", description: "카테고리 ID 필터 (선택)" },
      categoryCode: { type: "STRING", description: "카테고리 코드 필터 (선택)", enum: ["lecture", "govgrant", "corp_sponsor", "twork_on", "twork_si", "etc"] },
      payerName:  { type: "STRING",  description: "납입자·기관명 부분 일치 (선택)" },
      page:       { type: "INTEGER" },
      limit:      { type: "INTEGER" },
    }}},

  { name: "revenue_update", description: "수입 항목 수정 (draft 상태·등록자 또는 super_admin만 가능)",
    parameters: { type: "OBJECT", properties: {
      id:           { type: "INTEGER", description: "수입 항목 ID" },
      fiscalYear:   { type: "INTEGER" },
      recognizedAt: { type: "STRING" },
      categoryId:   { type: "INTEGER" },
      amount:       { type: "INTEGER" },
      payerName:    { type: "STRING" },
      description:  { type: "STRING" },
      receiptUrl:   { type: "STRING" },
    }, required: ["id"] }},

  { name: "revenue_approve", description: "수입 항목 승인 또는 반려 (super_admin 전용)",
    parameters: { type: "OBJECT", properties: {
      id:              { type: "INTEGER", description: "수입 항목 ID" },
      action:          { type: "STRING",  description: "approve(승인) 또는 reject(반려)", enum: ["approve", "reject"] },
      rejectionReason: { type: "STRING",  description: "반려 사유 (action=reject 필수)" },
    }, required: ["id", "action"] }},

  { name: "revenue_refund", description: "승인된 수입 항목의 환불 금액 기록 (super_admin 전용, status='approved'만 가능)",
    parameters: { type: "OBJECT", properties: {
      id:           { type: "INTEGER", description: "수입 항목 ID" },
      refundAmount: { type: "INTEGER", description: "환불 금액 (원). 원래 금액 이하" },
    }, required: ["id", "refundAmount"] }},

  { name: "pl_summary", description: "운영성과표(손익계산서) 요약 — 사업수익(후원금+후원 외)·사업비용·운영성과(순이익). NPO 표준 회계 보고서. period로 기간 지정 (기본: 이번 달)",
    parameters: { type: "OBJECT", properties: {
      period:    { type: "STRING",  description: "기간 단위", enum: ["day", "week", "month", "half_year", "year", "custom"] },
      startDate: { type: "STRING",  description: "custom일 때 시작일 YYYY-MM-DD" },
      endDate:   { type: "STRING",  description: "custom일 때 종료일 YYYY-MM-DD" },
      fiscalYear: { type: "INTEGER", description: "연도(숫자)만 넘기면 해당 연도 1/1~12/31 (하위호환). monthly[] 자동 포함" },
    }}},

  /* === Phase 22-C 지출 (5개) === */
  { name: "expense_categories_list", description: "지출 카테고리 목록. NPO 표준 4분류(인건비/사업비/관리운영비/모금비) + 사용자 정의",
    parameters: { type: "OBJECT", properties: {} }},

  { name: "expenses_list", description: "지출 항목 목록 조회. period로 기간 지정 (기본: 이번 달). status: draft|approved|rejected",
    parameters: { type: "OBJECT", properties: {
      period:     { type: "STRING",  description: "기간 단위", enum: ["day", "week", "month", "half_year", "year", "custom"] },
      startDate:  { type: "STRING",  description: "custom일 때 시작일 YYYY-MM-DD" },
      endDate:    { type: "STRING",  description: "custom일 때 종료일 YYYY-MM-DD" },
      fiscalYear: { type: "INTEGER", description: "연도(숫자)만 넘기면 해당 연도 1/1~12/31 (하위호환)" },
      status:     { type: "STRING",  description: "지출 상태", enum: ["draft", "approved", "rejected", "all"] },
      categoryId: { type: "INTEGER", description: "expense_categories.id (선택)" },
      categoryCode: { type: "STRING", description: "카테고리 코드 필터 (선택)", enum: ["personnel", "program", "admin_ops", "fundraising"] },
      page:       { type: "INTEGER" },
      limit:      { type: "INTEGER" },
    }}},

  { name: "expense_create", description: "지출 항목 등록 (draft 상태로 저장, 승인 별도)",
    parameters: { type: "OBJECT", properties: {
      fiscalYear:  { type: "INTEGER", description: "회계연도 (예: 2026)" },
      occurredAt:  { type: "STRING",  description: "지출 발생일 YYYY-MM-DD" },
      categoryId:  { type: "INTEGER", description: "expense_categories.id (categoryCode와 둘 중 하나 필요)" },
      categoryCode: { type: "STRING", description: "카테고리 코드 (categoryId 대신 사용 가능). 시스템 4분류:personnel(인건비)/program(사업비)/admin_ops(관리운영비)/fundraising(모금비)" },
      amount:      { type: "INTEGER", description: "금액 (원)" },
      payeeName:   { type: "STRING",  description: "지급처 (선택)" },
      description: { type: "STRING",  description: "상세 내용 (선택)" },
      receiptUrl:  { type: "STRING",  description: "영수증 URL (선택)" },
    }, required: ["fiscalYear", "occurredAt", "amount"] }},

  { name: "expense_approve", description: "지출 항목 승인 또는 반려 (super_admin 전용)",
    parameters: { type: "OBJECT", properties: {
      id:              { type: "INTEGER", description: "지출 항목 ID" },
      action:          { type: "STRING",  description: "approve(승인) 또는 reject(반려)", enum: ["approve", "reject"] },
      rejectionReason: { type: "STRING",  description: "반려 사유 (action=reject 필수)" },
    }, required: ["id", "action"] }},

  { name: "expense_refund", description: "승인된 지출 항목 환불 기록 (super_admin 전용, status='approved'만 가능, 누적 환불액이 원금 초과 불가)",
    parameters: { type: "OBJECT", properties: {
      id:           { type: "INTEGER", description: "지출 항목 ID" },
      refundAmount: { type: "INTEGER", description: "환불 금액 (원). 기존 환불액에 가산되며, 누적합이 원금 이하여야 함" },
    }, required: ["id", "refundAmount"] }},

  /* === Phase 22-B-R2 예산 편성 (3개) === */
  { name: "budget_plan_list", description: "연도별 예산안 목록·상태 조회 (draft|submitted|approved|rejected)",
    parameters: { type: "OBJECT", properties: {
      fiscalYear: { type: "INTEGER", description: "특정 연도만 (생략 시 전체)" },
      status:     { type: "STRING",  description: "draft|submitted|approved|rejected|all (생략 시 전체)" },
    }}},

  { name: "budget_plan_create", description: "차년도 예산안 생성 — 전년 실적을 각 카테고리 기본값으로 자동 채움 (dry-run 우선)",
    parameters: { type: "OBJECT", properties: {
      fiscalYear:      { type: "INTEGER", description: "편성 대상 연도 (예: 2027)" },
      title:           { type: "STRING",  description: "예산안 제목 (생략 시 자동: '2027년도 예산안')" },
      requireApproval: { type: "BOOLEAN", description: "true=dry-run 확인 후 생성 (기본 true)" },
    }, required: ["fiscalYear"] }},

  { name: "budget_plan_approve", description: "예산안 승인 또는 반려 (super_admin 전용, dry-run 우선)",
    parameters: { type: "OBJECT", properties: {
      planId:          { type: "INTEGER", description: "예산안 ID" },
      action:          { type: "STRING",  description: "approve(승인) 또는 reject(반려)", enum: ["approve", "reject"] },
      rejectionReason: { type: "STRING",  description: "반려 사유 (action=reject 필수)" },
      requireApproval: { type: "BOOLEAN", description: "true=dry-run 확인 (기본 true)" },
    }, required: ["planId", "action"] }},

  /* === Phase 22-D-R1 전표 시스템 (4개) === */
  { name: "account_codes_list", description: "계정과목 마스터 목록 (NPO 표준 코드 — 인건비·사업비·관리운영비·모금비)",
    parameters: { type: "OBJECT", properties: {
      category: { type: "STRING", description: "personnel|program|admin_ops|fundraising|income (생략 시 전체)" },
      activeOnly: { type: "BOOLEAN", description: "true=활성 항목만 (기본 true)" },
    }}},

  { name: "voucher_list", description: "전표 목록 조회 (기간·계정·예산·상태 필터)",
    parameters: { type: "OBJECT", properties: {
      period:      { type: "STRING",  description: "기간 단위", enum: ["day", "week", "month", "half_year", "year", "custom"] },
      startDate:   { type: "STRING",  description: "custom일 때 시작일 YYYY-MM-DD" },
      endDate:     { type: "STRING",  description: "custom일 때 종료일 YYYY-MM-DD" },
      fiscalYear:  { type: "INTEGER", description: "연도만 (하위호환)" },
      accountCode: { type: "STRING",  description: "계정과목 코드 필터 (예: '5031')" },
      budgetLineId: { type: "INTEGER", description: "예산 항목 ID 필터" },
      status:      { type: "STRING",  description: "draft|submitted|approved|rejected|all" },
      isTemplate:  { type: "BOOLEAN", description: "true=반복 템플릿만" },
      page:        { type: "INTEGER" },
      limit:       { type: "INTEGER" },
    }}},

  { name: "voucher_create", description: "전표 작성 (draft 상태로 생성, 승인 별도. dry-run 우선)",
    parameters: { type: "OBJECT", properties: {
      voucherDate:  { type: "STRING",  description: "전표 일자 YYYY-MM-DD" },
      accountCode:  { type: "STRING",  description: "계정과목 코드 (예: '5031')" },
      subAccount:   { type: "STRING",  description: "세목 (자유 입력, 선택)" },
      description:  { type: "STRING",  description: "적요" },
      payeeName:    { type: "STRING",  description: "거래처 (선택)" },
      amount:       { type: "INTEGER", description: "금액 (원)" },
      evidenceType: { type: "STRING",  description: "증빙 종류", enum: ["tax_invoice", "receipt", "card_slip", "transfer_confirm", "none"] },
      budgetLineId: { type: "INTEGER", description: "예산 항목 ID (선택)" },
      isTemplate:   { type: "BOOLEAN", description: "true=반복 템플릿으로 저장" },
      templateName: { type: "STRING",  description: "템플릿 이름 (isTemplate=true 시)" },
      requireApproval: { type: "BOOLEAN", description: "true=dry-run 확인 (기본 true)" },
    }, required: ["voucherDate", "accountCode", "description", "amount"] }},

  { name: "voucher_approve", description: "전표 승인 또는 반려 (super_admin 전용, dry-run 우선)",
    parameters: { type: "OBJECT", properties: {
      voucherId:       { type: "INTEGER", description: "전표 ID" },
      action:          { type: "STRING",  description: "approve(승인) 또는 reject(반려)", enum: ["approve", "reject"] },
      rejectionReason: { type: "STRING",  description: "반려 사유 (action=reject 필수)" },
      requireApproval: { type: "BOOLEAN", description: "true=dry-run 확인 (기본 true)" },
    }, required: ["voucherId", "action"] }},

  /* === Phase 22-D-R2 통장 대사 (1개) === */
  { name: "bank_reconcile_summary", description: "통장 입출금 대사 현황 요약 — 입금(개별후원 매칭/묶음정산/매출/미확인), 출금(전표생성/확인대기). 기간 지정 가능",
    parameters: { type: "OBJECT", properties: {
      startDate: { type: "STRING",  description: "기간 시작 YYYY-MM-DD (생략 시 전체)" },
      endDate:   { type: "STRING",  description: "기간 종료 YYYY-MM-DD (생략 시 전체)" },
      importId:  { type: "INTEGER", description: "특정 통장 업로드 건만 (선택)" },
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

/**
 * BUG-006 안전망: adminId 기반 role 조회 (members.role).
 * ai_tool_permissions 권한 가드는 호출자에서 작동하지만, 시드 누락 시 우회 가능
 * → 핸들러 자체에서 한 번 더 검증. allowedRoles에 현재 role 포함 시 통과.
 */
type RoleGuardResult = { ok: true; error?: undefined } | { ok: false; error: string };

/**
 * Gemini 함수 호출 인자 정규화 — ARRAY of INTEGER 스키마를 어겨도 수용.
 * 단일 정수(5), 문자열("5"), 문자열화 배열("[1,2]"), 쉼표 문자열("1,2"), 정상 배열 모두 [1,2]로.
 */
function toIdArray(raw: any): number[] {
  if (raw === undefined || raw === null || raw === "") return [];
  let candidate: any = raw;
  if (typeof candidate === "string") {
    const s = candidate.trim();
    if (s.startsWith("[") && s.endsWith("]")) {
      try { candidate = JSON.parse(s); } catch { candidate = s.slice(1, -1).split(","); }
    } else if (s.includes(",")) {
      candidate = s.split(",");
    } else {
      candidate = [s];
    }
  } else if (typeof candidate === "number") {
    candidate = [candidate];
  }
  if (!Array.isArray(candidate)) return [];
  return candidate
    .map((n: any) => Number(typeof n === "string" ? n.trim() : n))
    .filter((n: number) => Number.isFinite(n) && n > 0);
}

async function ensureRole(adminId: number | null, allowedRoles: string[]): Promise<RoleGuardResult> {
  if (!adminId) return { ok: false, error: "관리자 인증이 필요합니다" };
  try {
    const r: any = await db.execute(sql`SELECT role FROM members WHERE id = ${adminId} LIMIT 1`);
    const row = (r?.rows ?? r ?? [])[0];
    const role = row?.role ? String(row.role) : null;
    // role hierarchy: super_admin > admin (super_admin은 admin 도구 자동 허용)
    if (role === "super_admin") return { ok: true };
    if (role && allowedRoles.includes(role)) return { ok: true };
    return { ok: false, error: `${allowedRoles.join("/")} 권한이 필요합니다 (현재: ${role || "없음"})` };
  } catch (e: any) {
    return { ok: false, error: `권한 확인 실패: ${e?.message?.slice(0, 200)}` };
  }
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
      /* Phase 3: FAQ CUD·자료실·템플릿·그룹·사건 의견 (10개) */
      case "faq_create":               return await tool_faqCreate(args, adminId);
      case "faq_update":               return await tool_faqUpdate(args, adminId);
      case "faq_delete":               return await tool_faqDelete(args, adminId);
      case "resources_list":           return await tool_resourcesList(args);
      case "resource_categories_list": return await tool_resourceCategoriesList(args);
      case "templates_list":           return await tool_templatesList(args);
      case "template_create":          return await tool_templateCreate(args, adminId);
      case "template_update":          return await tool_templateUpdate(args, adminId);
      case "recipient_groups_list":    return await tool_recipientGroupsList(args);
      case "incident_comment_add":     return await tool_incidentCommentAdd(args, adminId);
      /* Phase 4: 잠재후원자·자료CUD·예산·정책·채팅 (10개) */
      case "potential_donors_list":    return await tool_potentialDonorsList(args);
      case "potential_donor_link":     return await tool_potentialDonorLink(args, adminId);
      case "resource_create":          return await tool_resourceCreate(args, adminId);
      case "resource_update":          return await tool_resourceUpdate(args, adminId);
      case "resource_delete":          return await tool_resourceDelete(args, adminId);
      case "budgets_list":             return await tool_budgetsList(args);
      case "budget_summary":           return await tool_budgetSummary(args);
      case "donation_policy_get":      return await tool_donationPolicyGet();
      case "chat_rooms_list":          return await tool_chatRoomsList(args);
      /* Phase 22-A 매출 */
      case "revenue_categories_list": return await tool_revenueCategoriesList();
      case "revenue_create":          return await tool_revenueCreate(args, adminId);
      case "revenue_list":            return await tool_revenueList(args);
      case "revenue_update":          return await tool_revenueUpdate(args, adminId);
      case "revenue_approve":         return await tool_revenueApprove(args, adminId);
      case "revenue_refund":          return await tool_revenueRefund(args, adminId);
      case "pl_summary":              return await tool_plSummary(args);
      /* Phase 22-C 지출 */
      case "expense_categories_list": return await tool_expenseCategoriesList();
      case "expenses_list":           return await tool_expensesList(args);
      case "expense_create":          return await tool_expenseCreate(args, adminId);
      case "expense_approve":         return await tool_expenseApprove(args, adminId);
      case "expense_refund":          return await tool_expenseRefund(args, adminId);
      /* Phase 22-B-R2 예산 편성 */
      case "budget_plan_list":        return await tool_budgetPlanList(args);
      case "budget_plan_create":      return await tool_budgetPlanCreate(args, adminId);
      case "budget_plan_approve":     return await tool_budgetPlanApprove(args, adminId);
      /* Phase 22-D-R1 전표 시스템 */
      case "account_codes_list":      return await tool_accountCodesList(args);
      case "voucher_list":            return await tool_voucherList(args);
      case "voucher_create":          return await tool_voucherCreate(args, adminId);
      case "voucher_approve":         return await tool_voucherApprove(args, adminId);
      /* Phase 22-D-R2 통장 대사 */
      case "bank_reconcile_summary":  return await tool_bankReconcileSummary(args);
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
  /* notice_category enum (db/schema.ts): general / member / event / media (4개만).
     2026-05-14 BUG-05a fix: 'notice'·'press'는 enum에 없음. 잘못 시드 → invalid enum 에러. */
  const category = ["general","member","event","media"].includes(String(args?.category)) ? String(args.category) : "general";
  const requireApproval = args?.requireApproval !== false;
  if (!title) return { ok: false, error: "title 필수" };
  if (!body)  return { ok: false, error: "body 필수" };
  if (requireApproval) return { ok: true, preview: { title, category, bodyPreview: body.slice(0, 500),
    message: "승인 후 requireApproval=false로 다시 호출하세요." } };
  try {
    /* 2026-05-14 BUG-Phase2-02 fix: board_posts → notices 테이블 정정.
       이전 코드는 board_posts.content 컬럼 사용 → 실제 board_posts.content_html.
       공지는 notices 테이블이 맞음 (title, content, category, author_id, author_name). */
    const r: any = await db.execute(sql`
      INSERT INTO notices (category, title, content, author_id, author_name, is_published, published_at)
      VALUES (${category}, ${title}, ${body}, ${adminId}, '관리자', TRUE, NOW())
      RETURNING id
    `);
    const id = Number((r?.rows ?? r ?? [])[0]?.id) || 0;
    return { ok: true, output: { id, title, category, message: `공지 #${id} 등록 완료` },
      rollbackData: { table: "notices", id } };
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
      COUNT(*) FILTER (WHERE type='onetime' AND status='completed')::int AS onetime_count
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
    /* 2026-05-14 fix: 'pending'은 어느 status enum에도 없음. 각 도메인 실제 enum 사용.
       - incidents.status: varchar (active|closed|archived 등) → 'active'를 미처리로
       - harassment_reports: 'submitted'·'ai_analyzed'·'reviewing'을 미응답
       - legal_consultations: 'submitted'·'ai_analyzed'·'matching'·'in_progress'를 진행중
       - campaigns: 'active' 그대로 */
    const r: any = await db.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM members WHERE status = 'active') AS active_members,
        (SELECT COUNT(*)::int FROM members WHERE created_at >= NOW() - INTERVAL '30 days') AS new_members_30d,
        (SELECT COALESCE(SUM(amount), 0)::bigint FROM donations
           WHERE status = 'completed' AND created_at >= DATE_TRUNC('month', NOW())) AS donation_sum_this_month,
        (SELECT COUNT(*)::int FROM donations
           WHERE status = 'completed' AND created_at >= DATE_TRUNC('month', NOW())) AS donation_count_this_month,
        (SELECT COUNT(*)::int FROM incidents WHERE status = 'active') AS incidents_active,
        (SELECT COUNT(*)::int FROM harassment_reports
           WHERE status IN ('submitted', 'ai_analyzed', 'reviewing')) AS harassment_pending,
        (SELECT COUNT(*)::int FROM legal_consultations
           WHERE status IN ('submitted', 'ai_analyzed', 'matching', 'in_progress')) AS legal_pending,
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
        (${adminId}, ${title}, ${description || null}, 'todo', ${priority}, ${dueDate.toISOString()}::timestamptz,
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
  const memberIds: number[] = toIdArray(args?.memberIds);
  const toEmailsRaw: string[] = Array.isArray(args?.toEmails) ? args.toEmails.map(String) : [];
  if (memberIds.length === 0 && toEmailsRaw.length === 0) return { ok: false, error: "memberIds 또는 toEmails 중 하나 이상 필수" };
  if (memberIds.length > 50) return { ok: false, error: "memberIds 최대 50명까지" };
  if (toEmailsRaw.length > 10) return { ok: false, error: "toEmails 최대 10개까지" };
  const subject = String(args?.subject || "").trim();
  const body = String(args?.body || "").trim();
  if (!subject) return { ok: false, error: "subject 필수" };
  if (!body) return { ok: false, error: "body 필수" };

  /* 수신자 목록 구성 */
  let recipients: { name: string; email: string }[] = [];

  /* memberIds → DB 조회 */
  if (memberIds.length > 0) {
    try {
      const idsLiteral = `ARRAY[${memberIds.join(",")}]::int[]`;
      const r: any = await db.execute(sql`
        SELECT id, name, email FROM members
         WHERE id = ANY(${sql.raw(idsLiteral)}) AND email IS NOT NULL AND email <> ''
         LIMIT 50
      `);
      for (const row of (r?.rows ?? r ?? [])) {
        recipients.push({ name: String(row.name || ""), email: String(row.email) });
      }
    } catch (e: any) {
      return { ok: false, error: `수신자 조회 실패: ${e?.message?.slice(0, 200)}` };
    }
  }

  /* toEmails → 직접 추가 */
  for (const addr of toEmailsRaw) {
    if (addr.includes("@")) recipients.push({ name: addr, email: addr });
  }

  if (recipients.length === 0) return { ok: false, error: "유효한 수신자 없음" };

  /* 파일함 첨부 — workspace_files r2Key 다운로드 */
  const attachmentFileIds: number[] = toIdArray(args?.attachmentFileIds).slice(0, 5);
  let attachments: Array<{ filename: string; content: string }> = [];
  let attachmentSummary = "";
  if (attachmentFileIds.length > 0) {
    try {
      const idsLiteral = `ARRAY[${attachmentFileIds.join(",")}]::int[]`;
      const fr: any = await db.execute(sql`
        SELECT id, name, r2_key, mime_type, size_bytes
          FROM workspace_files
         WHERE id = ANY(${sql.raw(idsLiteral)})
           AND deleted_at IS NULL AND upload_status <> 'deleted'
         LIMIT 5
      `);
      const fileRows: any[] = fr?.rows ?? fr ?? [];
      const skipped: string[] = [];
      for (const f of fileRows) {
        const sizeBytes = Number(f.size_bytes || 0);
        if (sizeBytes > 25 * 1024 * 1024) { skipped.push(`${f.name} (25MB 초과)`); continue; }
        const buf = await downloadFromR2(String(f.r2_key));
        if (!buf || buf.length === 0) { skipped.push(`${f.name} (다운로드 실패)`); continue; }
        attachments.push({ filename: String(f.name), content: Buffer.from(buf).toString("base64") });
      }
      attachmentSummary = attachments.length > 0
        ? `첨부 ${attachments.length}개: ${attachments.map(a => a.filename).join(", ")}`
        : "";
      if (skipped.length > 0) attachmentSummary += ` / 스킵 ${skipped.join(", ")}`;
    } catch (e: any) {
      return { ok: false, error: `첨부 파일 준비 실패: ${e?.message?.slice(0, 200)}` };
    }
  }

  const preview = {
    recipientCount: recipients.length,
    recipients: recipients.slice(0, 5).map(r => `${r.name} <${r.email}>`),
    subject, bodyPreview: body.slice(0, 200),
    ...(attachmentSummary ? { attachments: attachmentSummary } : {}),
  };

  if (args?.requireApproval !== false) {
    return { ok: true, preview, output: { dry_run: true, message: `승인 대기. ${recipients.length}명에게 발송 예정${attachmentSummary ? " / " + attachmentSummary : ""}. requireApproval=false로 재호출하면 실제 발송.` } };
  }

  /* 본문 HTML 조립 */
  const isHtml = /<[a-z][\s\S]*>/i.test(body);
  const bodyHtml = isHtml ? body : `<div style="white-space:pre-wrap">${body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>")}</div>`;
  const wrapWithLayout = args?.wrapWithLayout === true;
  const layout = ["classic","minimal","gradient","editorial"].includes(args?.layout) ? args.layout : "classic";
  const finalHtml = wrapWithLayout
    ? renderEmailLayout(layout, {
        title: subject,
        bodyHtml,
        ...(args?.ctaText && args?.ctaUrl ? { ctaText: String(args.ctaText), ctaUrl: String(args.ctaUrl) } : {}),
      })
    : bodyHtml;

  /* 실제 발송 */
  const results = { sent: 0, failed: 0, errors: [] as string[], attachments: attachmentSummary };
  for (const rcpt of recipients) {
    try {
      await sendEmail({
        to: rcpt.email,
        subject,
        html: finalHtml,
        ...(attachments.length > 0 ? { attachments } : {}),
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
  /* 2026-05-14 BUG-Phase2-02 fix: notices.body → notices.content (실제 컬럼명) */
  const patch: Record<string, any> = {};
  if (typeof args?.title === "string" && args.title.trim()) patch.title = args.title.trim().slice(0, 200);
  if (typeof args?.body === "string") patch.content = args.body;
  if (typeof args?.content === "string") patch.content = args.content;
  if (Object.keys(patch).length === 0) return { ok: false, error: "변경할 필드 없음" };

  let before: any = null;
  try {
    const r: any = await db.execute(sql`SELECT id, title, content FROM notices WHERE id = ${id} LIMIT 1`);
    before = (r?.rows ?? r ?? [])[0];
  } catch {}
  if (!before) return { ok: false, error: "공지 없음" };

  const preview = { noticeId: id, before: { title: before.title, contentPreview: String(before.content || "").slice(0, 200) }, changes: { title: patch.title, contentPreview: typeof patch.content === "string" ? patch.content.slice(0, 200) : undefined } };
  if (args?.requireApproval !== false) {
    return { ok: true, preview, output: { dry_run: true, message: "승인 대기." } };
  }

  try {
    const setFragments: any[] = [];
    for (const [k, v] of Object.entries(patch)) setFragments.push(sql`${sql.identifier(k)} = ${v}`);
    setFragments.push(sql`updated_at = NOW()` as any);
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
  const ids: number[] = toIdArray(args?.memberIds);
  if (ids.length === 0) return { ok: false, error: "memberIds 필수 (정수 배열, 예: [5])" };
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
  /* neon postgres-js는 Date 객체 직접 바인딩 시 string 변환 실패 — ISO string + ::timestamptz cast */
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  try {
    const r: any = await db.execute(sql`
      SELECT id, title, start_at, end_at, all_day, color, location, event_type, description
        FROM workspace_events
       WHERE member_id = ${adminId}
         AND start_at <= ${toIso}::timestamptz AND end_at >= ${fromIso}::timestamptz
       ORDER BY start_at ASC
       LIMIT ${limit}
    `);
    const rows = r?.rows ?? r ?? [];
    return { ok: true, output: { count: rows.length, from: fromIso.slice(0, 10), to: toIso.slice(0, 10), events: rows } };
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
        (${adminId}, ${title}, ${startAt.toISOString()}::timestamptz, ${endAt.toISOString()}::timestamptz, ${allDay}, ${color},
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
  const search = typeof args?.search === "string" ? args.search.trim() : "";
  const limit = Math.min(Number(args?.limit) || 30, 100);
  try {
    /* 파일 — 키워드 검색 시 폴더 무시하고 전체 검색 */
    let fileR: any;
    if (search) {
      fileR = await db.execute(sql`
        SELECT id, name, ext, mime_type, size_bytes, folder_id, is_shared, download_count, created_at
          FROM workspace_files
         WHERE deleted_at IS NULL
           AND (owner_id = ${adminId} OR is_shared = true)
           AND name ILIKE ${"%" + search + "%"}
         ORDER BY created_at DESC
         LIMIT ${limit}
      `);
    } else {
      fileR = await db.execute(sql`
        SELECT id, name, ext, mime_type, size_bytes, folder_id, is_shared, download_count, created_at
          FROM workspace_files
         WHERE deleted_at IS NULL
           AND (owner_id = ${adminId} OR is_shared = true)
           AND folder_id ${folderId == null ? sql`IS NULL` : sql`= ${folderId}`}
         ORDER BY created_at DESC
         LIMIT ${limit}
      `);
    }
    const files = fileR?.rows ?? fileR ?? [];

    /* 폴더 목록 — 검색 시 생략 */
    let folders: any[] = [];
    if (!search) {
      const folderR: any = await db.execute(sql`
        SELECT id, name, parent_id, depth, is_shared, created_at
          FROM workspace_folders
         WHERE deleted_at IS NULL
           AND (owner_id = ${adminId} OR is_shared = true)
           AND parent_id ${folderId == null ? sql`IS NULL` : sql`= ${folderId}`}
         ORDER BY name
         LIMIT ${limit}
      `);
      folders = folderR?.rows ?? folderR ?? [];
    }

    return { ok: true, output: { folderId, search: search || null, folderCount: folders.length, fileCount: files.length, folders, files } };
  } catch (e: any) {
    return { ok: false, error: `파일 목록 조회 실패: ${e?.message?.slice(0, 200)}` };
  }
}

/* =========================================================
   Phase 2 — 콘텐츠·게시판·캠페인·공지·FAQ (10개)
   표준 §3.3 — 직접 DB + dry-run + rollbackData
   ========================================================= */

/* notice_category enum (db/schema.ts:58): general / member / event / media.
   2026-05-14 BUG-05b fix: 옛 값 'press'·'notice'는 enum에 없음 — LLM이 도구 description의 옛 enum을 학습해 member/media 거부 응답 생성. */
const ALLOWED_NOTICE_CATEGORIES = new Set(["general", "member", "event", "media"]);
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

/* =========================================================
   Phase 3 — FAQ CUD·자료실·템플릿·수신자그룹·사건 의견 (10개)
   표준 §3.3 — 직접 DB + dry-run + rollbackData
   ========================================================= */

const ALLOWED_TEMPLATE_CHANNELS = new Set(["email", "sms", "kakao", "push"]);
const ALLOWED_RESOURCE_ACCESS  = new Set(["public", "member", "family"]);

/* ─── FAQ CUD ────────────────────────────────────────── */
async function tool_faqCreate(args: any, adminId: number | null): Promise<ToolResult> {
  if (!adminId) return { ok: false, error: "관리자 인증 필요" };
  const question = String(args?.question || "").trim().slice(0, 300);
  if (!question) return { ok: false, error: "question 필수" };
  const answer = String(args?.answer || "").trim();
  if (!answer) return { ok: false, error: "answer 필수" };
  const category = String(args?.category || "general").slice(0, 30);
  const sortOrder = Number.isFinite(Number(args?.sortOrder)) ? Number(args.sortOrder) : 0;
  const isActive = args?.isActive !== false;

  const preview = { question, answerPreview: answer.slice(0, 200), category, sortOrder, isActive };
  if (args?.requireApproval !== false) {
    return { ok: true, preview, output: { dry_run: true, message: "승인 대기." } };
  }
  try {
    const r: any = await db.execute(sql`
      INSERT INTO faqs (category, question, answer, sort_order, is_active)
      VALUES (${category}, ${question}, ${answer}, ${sortOrder}, ${isActive})
      RETURNING id
    `);
    const id = Number((r?.rows ?? r ?? [])[0]?.id) || 0;
    return { ok: true, output: { faq_id: id, question, category }, rollbackData: { table: "faqs", id } };
  } catch (e: any) {
    return { ok: false, error: `FAQ 생성 실패: ${e?.message?.slice(0, 200)}` };
  }
}

async function tool_faqUpdate(args: any, adminId: number | null): Promise<ToolResult> {
  if (!adminId) return { ok: false, error: "관리자 인증 필요" };
  const id = Number(args?.faqId || 0);
  if (!id) return { ok: false, error: "faqId 필수" };

  const patch: Record<string, any> = {};
  if (typeof args?.question === "string" && args.question.trim()) patch.question = args.question.trim().slice(0, 300);
  if (typeof args?.answer === "string" && args.answer.trim()) patch.answer = args.answer.trim();
  if (typeof args?.category === "string") patch.category = args.category.slice(0, 30);
  if (Number.isFinite(Number(args?.sortOrder))) patch.sort_order = Number(args.sortOrder);
  if (typeof args?.isActive === "boolean") patch.is_active = args.isActive;
  if (Object.keys(patch).length === 0) return { ok: false, error: "변경할 필드 없음" };

  let before: any = null;
  try {
    const r: any = await db.execute(sql`SELECT id, category, question, answer, sort_order, is_active FROM faqs WHERE id = ${id} LIMIT 1`);
    before = (r?.rows ?? r ?? [])[0];
  } catch {}
  if (!before) return { ok: false, error: "FAQ 없음" };

  const preview = { faqId: id, before, changes: patch };
  if (args?.requireApproval !== false) {
    return { ok: true, preview, output: { dry_run: true, message: "승인 대기." } };
  }
  try {
    const setFragments: any[] = [];
    for (const [k, v] of Object.entries(patch)) setFragments.push(sql`${sql.identifier(k)} = ${v}`);
    setFragments.push(sql`updated_at = NOW()` as any);
    await db.execute(sql`UPDATE faqs SET ${sql.join(setFragments, sql`, `)} WHERE id = ${id}`);
    return { ok: true, output: { updated: true, faqId: id, changes: patch },
      rollbackData: { table: "faqs", id, before } };
  } catch (e: any) {
    return { ok: false, error: `FAQ 수정 실패: ${e?.message?.slice(0, 200)}` };
  }
}

async function tool_faqDelete(args: any, adminId: number | null): Promise<ToolResult> {
  if (!adminId) return { ok: false, error: "관리자 인증 필요" };
  const id = Number(args?.faqId || 0);
  if (!id) return { ok: false, error: "faqId 필수" };

  let before: any = null;
  try {
    const r: any = await db.execute(sql`SELECT id, category, question, answer, sort_order, is_active FROM faqs WHERE id = ${id} LIMIT 1`);
    before = (r?.rows ?? r ?? [])[0];
  } catch {}
  if (!before) return { ok: false, error: "FAQ 없음" };

  const preview = { faqId: id, question: before.question, answerPreview: String(before.answer || "").slice(0, 150) };
  if (args?.requireApproval !== false) {
    return { ok: true, preview, output: { dry_run: true, message: "승인 대기. 영구 삭제됩니다." } };
  }
  try {
    await db.execute(sql`DELETE FROM faqs WHERE id = ${id}`);
    return { ok: true, output: { deleted: true, faqId: id },
      rollbackData: { table: "faqs", id, before } };
  } catch (e: any) {
    return { ok: false, error: `FAQ 삭제 실패: ${e?.message?.slice(0, 200)}` };
  }
}

/* ─── 자료실 ─────────────────────────────────────────── */
async function tool_resourcesList(args: any): Promise<ToolResult> {
  const limit = Math.min(Number(args?.limit) || 30, 200);
  const conds: any[] = [];
  if (Number.isFinite(Number(args?.categoryId))) conds.push(sql`category_id = ${Number(args.categoryId)}`);
  if (typeof args?.isPublished === "boolean") conds.push(sql`is_published = ${args.isPublished}`);
  if (typeof args?.accessLevel === "string" && ALLOWED_RESOURCE_ACCESS.has(args.accessLevel)) {
    conds.push(sql`access_level = ${args.accessLevel}`);
  }
  const where = conds.length > 0 ? sql`WHERE ${sql.join(conds, sql` AND `)}` : sql``;
  try {
    const r: any = await db.execute(sql`
      SELECT id, category_id, title, slug, access_level, is_published, is_pinned, views, download_count, created_at
        FROM resources ${where}
       ORDER BY is_pinned DESC, sort_order ASC, created_at DESC
       LIMIT ${limit}
    `);
    const rows = r?.rows ?? r ?? [];
    return { ok: true, output: { count: rows.length, resources: rows } };
  } catch (e: any) {
    return { ok: false, error: `자료 조회 실패: ${e?.message?.slice(0, 200)}` };
  }
}

async function tool_resourceCategoriesList(args: any): Promise<ToolResult> {
  const where = typeof args?.isActive === "boolean" ? sql`WHERE is_active = ${args.isActive}` : sql``;
  try {
    const r: any = await db.execute(sql`
      SELECT id, code, name_ko, description, icon, sort_order, is_active
        FROM resource_categories ${where}
       ORDER BY sort_order ASC, id ASC
    `);
    const rows = r?.rows ?? r ?? [];
    return { ok: true, output: { count: rows.length, categories: rows } };
  } catch (e: any) {
    return { ok: false, error: `카테고리 조회 실패: ${e?.message?.slice(0, 200)}` };
  }
}

/* ─── 알림 템플릿 ───────────────────────────────────── */
async function tool_templatesList(args: any): Promise<ToolResult> {
  const limit = Math.min(Number(args?.limit) || 30, 200);
  const conds: any[] = [];
  if (typeof args?.channel === "string" && ALLOWED_TEMPLATE_CHANNELS.has(args.channel)) {
    conds.push(sql`channel = ${args.channel}`);
  }
  if (typeof args?.category === "string" && args.category.trim()) {
    conds.push(sql`category = ${args.category.trim()}`);
  }
  if (typeof args?.isActive === "boolean") conds.push(sql`is_active = ${args.isActive}`);
  const where = conds.length > 0 ? sql`WHERE ${sql.join(conds, sql` AND `)}` : sql``;
  try {
    const r: any = await db.execute(sql`
      SELECT id, name, channel, category, subject, is_active, updated_at
        FROM communication_templates ${where}
       ORDER BY channel, category, name
       LIMIT ${limit}
    `);
    const rows = r?.rows ?? r ?? [];
    return { ok: true, output: { count: rows.length, templates: rows } };
  } catch (e: any) {
    return { ok: false, error: `템플릿 조회 실패: ${e?.message?.slice(0, 200)}` };
  }
}

async function tool_templateCreate(args: any, adminId: number | null): Promise<ToolResult> {
  if (!adminId) return { ok: false, error: "관리자 인증 필요" };
  const name = String(args?.name || "").trim().slice(0, 100);
  if (!name) return { ok: false, error: "name 필수" };
  if (!ALLOWED_TEMPLATE_CHANNELS.has(args?.channel)) {
    return { ok: false, error: `channel은 ${Array.from(ALLOWED_TEMPLATE_CHANNELS).join("|")}` };
  }
  const channel = args.channel;
  const category = String(args?.category || "").trim();
  if (!category) return { ok: false, error: "category 필수" };
  const bodyTemplate = String(args?.bodyTemplate || "");
  if (!bodyTemplate) return { ok: false, error: "bodyTemplate 필수" };
  const subject = args?.subject ? String(args.subject) : null;

  const preview = { name, channel, category, subject, bodyPreview: bodyTemplate.slice(0, 200) };
  if (args?.requireApproval !== false) {
    return { ok: true, preview, output: { dry_run: true, message: "승인 대기." } };
  }
  try {
    const r: any = await db.execute(sql`
      INSERT INTO communication_templates (name, channel, category, subject, body_template, is_active, created_by)
      VALUES (${name}, ${channel}, ${category}, ${subject}, ${bodyTemplate}, TRUE, ${adminId})
      RETURNING id
    `);
    const id = Number((r?.rows ?? r ?? [])[0]?.id) || 0;
    return { ok: true, output: { template_id: id, name, channel, category },
      rollbackData: { table: "communication_templates", id } };
  } catch (e: any) {
    return { ok: false, error: `템플릿 생성 실패: ${e?.message?.slice(0, 200)}` };
  }
}

async function tool_templateUpdate(args: any, adminId: number | null): Promise<ToolResult> {
  if (!adminId) return { ok: false, error: "관리자 인증 필요" };
  const id = Number(args?.templateId || 0);
  if (!id) return { ok: false, error: "templateId 필수" };

  const patch: Record<string, any> = {};
  if (typeof args?.name === "string" && args.name.trim()) patch.name = args.name.trim().slice(0, 100);
  if (typeof args?.subject === "string") patch.subject = args.subject || null;
  if (typeof args?.bodyTemplate === "string" && args.bodyTemplate.trim()) patch.body_template = args.bodyTemplate;
  if (typeof args?.isActive === "boolean") patch.is_active = args.isActive;
  if (Object.keys(patch).length === 0) return { ok: false, error: "변경할 필드 없음" };

  let before: any = null;
  try {
    const r: any = await db.execute(sql`
      SELECT id, name, channel, category, subject, body_template, is_active
        FROM communication_templates WHERE id = ${id} LIMIT 1
    `);
    before = (r?.rows ?? r ?? [])[0];
  } catch {}
  if (!before) return { ok: false, error: "템플릿 없음" };

  const preview = { templateId: id, name: before.name, channel: before.channel, changes: patch };
  if (args?.requireApproval !== false) {
    return { ok: true, preview, output: { dry_run: true, message: "승인 대기." } };
  }
  try {
    const setFragments: any[] = [];
    for (const [k, v] of Object.entries(patch)) setFragments.push(sql`${sql.identifier(k)} = ${v}`);
    setFragments.push(sql`updated_by = ${adminId}` as any);
    setFragments.push(sql`updated_at = NOW()` as any);
    await db.execute(sql`UPDATE communication_templates SET ${sql.join(setFragments, sql`, `)} WHERE id = ${id}`);
    return { ok: true, output: { updated: true, templateId: id, changes: patch },
      rollbackData: { table: "communication_templates", id, before } };
  } catch (e: any) {
    return { ok: false, error: `템플릿 수정 실패: ${e?.message?.slice(0, 200)}` };
  }
}

/* ─── 수신자 그룹 ───────────────────────────────────── */
async function tool_recipientGroupsList(args: any): Promise<ToolResult> {
  const limit = Math.min(Number(args?.limit) || 30, 100);
  const where = typeof args?.isActive === "boolean" ? sql`WHERE is_active = ${args.isActive}` : sql``;
  try {
    const r: any = await db.execute(sql`
      SELECT id, name, description, criteria, is_active, created_at, updated_at
        FROM recipient_groups ${where}
       ORDER BY name ASC
       LIMIT ${limit}
    `);
    const rows = r?.rows ?? r ?? [];
    return { ok: true, output: { count: rows.length, groups: rows.map((g: any) => ({
      id: g.id, name: g.name, description: g.description,
      criteriaType: g.criteria?.type || "filter",
      isActive: g.is_active,
    })) } };
  } catch (e: any) {
    return { ok: false, error: `수신자 그룹 조회 실패: ${e?.message?.slice(0, 200)}` };
  }
}

/* ─── 사건 의견 추가 ────────────────────────────────── */
async function tool_incidentCommentAdd(args: any, adminId: number | null): Promise<ToolResult> {
  if (!adminId) return { ok: false, error: "관리자 인증 필요" };
  const incidentId = Number(args?.incidentId || 0);
  if (!incidentId) return { ok: false, error: "incidentId 필수" };
  const content = String(args?.content || "").trim();
  if (!content) return { ok: false, error: "content 필수" };
  if (content.length > 1000) return { ok: false, error: "content 최대 1000자" };
  const isPrivate = args?.isPrivate === true;

  /* 사건 존재 + 관리자 이름 조회 */
  let incident: any = null;
  try {
    const r: any = await db.execute(sql`SELECT id, title FROM incidents WHERE id = ${incidentId} LIMIT 1`);
    incident = (r?.rows ?? r ?? [])[0];
  } catch {}
  if (!incident) return { ok: false, error: "사건 없음" };
  let authorName = "관리자";
  try {
    const r: any = await db.execute(sql`SELECT name FROM members WHERE id = ${adminId} LIMIT 1`);
    authorName = (r?.rows ?? r ?? [])[0]?.name || "관리자";
  } catch {}

  const preview = { incidentId, incidentTitle: incident.title,
    contentPreview: content.slice(0, 200), isPrivate, authorName,
    visibility: isPrivate ? "내부 메모 (신고자에게 안 보임)" : "공개 답변 (신고자에게 보임)" };
  if (args?.requireApproval !== false) {
    return { ok: true, preview, output: { dry_run: true, message: "승인 대기." } };
  }
  try {
    const r: any = await db.execute(sql`
      INSERT INTO incident_comments (incident_id, member_id, author_name, content, is_anonymous, is_private)
      VALUES (${incidentId}, ${adminId}, ${authorName}, ${content}, FALSE, ${isPrivate})
      RETURNING id
    `);
    const id = Number((r?.rows ?? r ?? [])[0]?.id) || 0;
    return { ok: true, output: { comment_id: id, incidentId, isPrivate },
      rollbackData: { table: "incident_comments", id } };
  } catch (e: any) {
    return { ok: false, error: `사건 의견 추가 실패: ${e?.message?.slice(0, 200)}` };
  }
}

/* =========================================================
   Phase 4 — 잠재후원자·자료CUD·예산·정책·채팅 (10개)
   표준 §3.3 — 직접 DB + dry-run + rollbackData
   ========================================================= */

const ALLOWED_CHAT_STATUSES = new Set(["active", "closed", "archived"]);

/* ─── 잠재 후원자 ───────────────────────────────────── */
async function tool_potentialDonorsList(args: any): Promise<ToolResult> {
  const limit = Math.min(Number(args?.limit) || 30, 200);
  const conds: any[] = [];
  if (typeof args?.eventName === "string" && args.eventName.trim()) {
    conds.push(sql`event_name ILIKE ${`%${args.eventName.trim()}%`}`);
  }
  if (args?.linkedOnly === true) conds.push(sql`linked_member_id IS NOT NULL`);
  else if (args?.unlinkedOnly === true) conds.push(sql`linked_member_id IS NULL`);
  const where = conds.length > 0 ? sql`WHERE ${sql.join(conds, sql` AND `)}` : sql``;
  try {
    const r: any = await db.execute(sql`
      SELECT id, name, phone, event_name, participated_at, entry_path, linked_member_id, linked_at, created_at
        FROM potential_donors ${where}
       ORDER BY created_at DESC
       LIMIT ${limit}
    `);
    const rows = r?.rows ?? r ?? [];
    return { ok: true, output: { count: rows.length, potentialDonors: rows } };
  } catch (e: any) {
    return { ok: false, error: `잠재 후원자 조회 실패: ${e?.message?.slice(0, 200)}` };
  }
}

async function tool_potentialDonorLink(args: any, adminId: number | null): Promise<ToolResult> {
  if (!adminId) return { ok: false, error: "관리자 인증 필요" };
  const id = Number(args?.potentialDonorId || 0);
  const memberId = Number(args?.memberId || 0);
  if (!id) return { ok: false, error: "potentialDonorId 필수" };
  if (!memberId) return { ok: false, error: "memberId 필수" };

  /* 잠재 후원자 + 회원 존재 확인 */
  let before: any = null;
  try {
    const r: any = await db.execute(sql`
      SELECT id, name, phone, event_name, linked_member_id
        FROM potential_donors WHERE id = ${id} LIMIT 1
    `);
    before = (r?.rows ?? r ?? [])[0];
  } catch {}
  if (!before) return { ok: false, error: "잠재 후원자 없음" };
  if (before.linked_member_id) return { ok: false, error: `이미 회원 ${before.linked_member_id}에 연결됨` };

  let member: any = null;
  try {
    const r: any = await db.execute(sql`SELECT id, name, email FROM members WHERE id = ${memberId} LIMIT 1`);
    member = (r?.rows ?? r ?? [])[0];
  } catch {}
  if (!member) return { ok: false, error: "회원 없음" };

  const preview = { potentialDonorId: id, potentialName: before.name, potentialEvent: before.event_name,
    memberId, memberName: member.name, memberEmail: member.email };
  if (args?.requireApproval !== false) {
    return { ok: true, preview, output: { dry_run: true, message: "승인 대기. 연결되면 잠재 후원자 → 정회원 연결됨." } };
  }
  try {
    await db.execute(sql`
      UPDATE potential_donors
         SET linked_member_id = ${memberId}, linked_at = NOW(), linked_by = ${adminId}, updated_at = NOW()
       WHERE id = ${id}
    `);
    return { ok: true, output: { linked: true, potentialDonorId: id, memberId },
      rollbackData: { table: "potential_donors", id, before } };
  } catch (e: any) {
    return { ok: false, error: `연결 실패: ${e?.message?.slice(0, 200)}` };
  }
}

/* ─── 자료 CUD ──────────────────────────────────────── */
async function tool_resourceCreate(args: any, adminId: number | null): Promise<ToolResult> {
  if (!adminId) return { ok: false, error: "관리자 인증 필요" };
  const title = String(args?.title || "").trim().slice(0, 200);
  if (!title) return { ok: false, error: "title 필수" };
  const categoryId = Number.isFinite(Number(args?.categoryId)) ? Number(args.categoryId) : null;
  const description = args?.description ? String(args.description) : null;
  const contentHtml = args?.contentHtml ? String(args.contentHtml) : null;
  const accessLevel = ALLOWED_RESOURCE_ACCESS.has(args?.accessLevel) ? args.accessLevel : "public";
  const isPublished = args?.isPublished !== false;

  const preview = { title, categoryId, accessLevel, isPublished,
    descriptionPreview: description?.slice(0, 150) || null };
  if (args?.requireApproval !== false) {
    return { ok: true, preview, output: { dry_run: true, message: "승인 대기." } };
  }
  try {
    const r: any = await db.execute(sql`
      INSERT INTO resources (category_id, title, description, content_html, access_level, is_published, created_by, updated_by)
      VALUES (${categoryId}, ${title}, ${description}, ${contentHtml}, ${accessLevel}, ${isPublished}, ${adminId}, ${adminId})
      RETURNING id
    `);
    const id = Number((r?.rows ?? r ?? [])[0]?.id) || 0;
    return { ok: true, output: { resource_id: id, title, accessLevel },
      rollbackData: { table: "resources", id } };
  } catch (e: any) {
    return { ok: false, error: `자료 생성 실패: ${e?.message?.slice(0, 200)}` };
  }
}

async function tool_resourceUpdate(args: any, adminId: number | null): Promise<ToolResult> {
  if (!adminId) return { ok: false, error: "관리자 인증 필요" };
  const id = Number(args?.resourceId || 0);
  if (!id) return { ok: false, error: "resourceId 필수" };

  const patch: Record<string, any> = {};
  if (typeof args?.title === "string" && args.title.trim()) patch.title = args.title.trim().slice(0, 200);
  if (typeof args?.description === "string") patch.description = args.description;
  if (typeof args?.contentHtml === "string") patch.content_html = args.contentHtml;
  if (typeof args?.accessLevel === "string" && ALLOWED_RESOURCE_ACCESS.has(args.accessLevel)) patch.access_level = args.accessLevel;
  if (typeof args?.isPublished === "boolean") patch.is_published = args.isPublished;
  if (typeof args?.isPinned === "boolean") patch.is_pinned = args.isPinned;
  if (Object.keys(patch).length === 0) return { ok: false, error: "변경할 필드 없음" };

  let before: any = null;
  try {
    const r: any = await db.execute(sql`
      SELECT id, title, access_level, is_published, is_pinned FROM resources WHERE id = ${id} LIMIT 1
    `);
    before = (r?.rows ?? r ?? [])[0];
  } catch {}
  if (!before) return { ok: false, error: "자료 없음" };

  const preview = { resourceId: id, title: before.title, changes: patch };
  if (args?.requireApproval !== false) {
    return { ok: true, preview, output: { dry_run: true, message: "승인 대기." } };
  }
  try {
    const setFragments: any[] = [];
    for (const [k, v] of Object.entries(patch)) setFragments.push(sql`${sql.identifier(k)} = ${v}`);
    setFragments.push(sql`updated_by = ${adminId}` as any);
    setFragments.push(sql`updated_at = NOW()` as any);
    await db.execute(sql`UPDATE resources SET ${sql.join(setFragments, sql`, `)} WHERE id = ${id}`);
    return { ok: true, output: { updated: true, resourceId: id, changes: patch },
      rollbackData: { table: "resources", id, before } };
  } catch (e: any) {
    return { ok: false, error: `자료 수정 실패: ${e?.message?.slice(0, 200)}` };
  }
}

async function tool_resourceDelete(args: any, adminId: number | null): Promise<ToolResult> {
  if (!adminId) return { ok: false, error: "관리자 인증 필요" };
  const id = Number(args?.resourceId || 0);
  if (!id) return { ok: false, error: "resourceId 필수" };

  let before: any = null;
  try {
    const r: any = await db.execute(sql`
      SELECT id, category_id, title, access_level, is_published, download_count, views
        FROM resources WHERE id = ${id} LIMIT 1
    `);
    before = (r?.rows ?? r ?? [])[0];
  } catch {}
  if (!before) return { ok: false, error: "자료 없음" };

  const preview = { resourceId: id, title: before.title,
    downloadCount: before.download_count, views: before.views };
  if (args?.requireApproval !== false) {
    return { ok: true, preview, output: { dry_run: true, message: "승인 대기. 영구 삭제됩니다." } };
  }
  try {
    await db.execute(sql`DELETE FROM resources WHERE id = ${id}`);
    return { ok: true, output: { deleted: true, resourceId: id },
      rollbackData: { table: "resources", id, before } };
  } catch (e: any) {
    return { ok: false, error: `자료 삭제 실패: ${e?.message?.slice(0, 200)}` };
  }
}

/* ─── 예산·지출 ─────────────────────────────────────── */
async function tool_budgetsList(args: any): Promise<ToolResult> {
  const year = Number(args?.fiscalYear) || new Date().getFullYear();
  try {
    /* 2026-05-14 fix: budget_categories 실제 컬럼 = id/name/code/description/is_active (name_ko·sort_order 없음) */
    const r: any = await db.execute(sql`
      SELECT b.id, b.fiscal_year, b.category_id, b.planned_amount, b.note, b.created_at,
             c.name AS category_name, c.code AS category_code
        FROM budgets b
        LEFT JOIN budget_categories c ON c.id = b.category_id
       WHERE b.fiscal_year = ${year}
       ORDER BY c.id ASC NULLS LAST, b.id ASC
    `);
    const rows = r?.rows ?? r ?? [];
    return { ok: true, output: { fiscalYear: year, count: rows.length, budgets: rows } };
  } catch (e: any) {
    return { ok: false, error: `예산 조회 실패: ${e?.message?.slice(0, 200)}` };
  }
}

async function tool_budgetSummary(args: any): Promise<ToolResult> {
  // budget_categories(예산) vs expenses(지출, 22-C) 비교
  // budget_categories.code === expense_categories.code (22-B-R1 마이그 후 동기화)
  const year = Number(args?.fiscalYear) || new Date().getFullYear();
  try {
    const r: any = await db.execute(sql`
      SELECT
        bc.id AS category_id,
        bc.name AS category_name,
        bc.code AS category_code,
        COALESCE(b.planned_amount::numeric, 0)::numeric AS planned,
        COALESCE(SUM(CASE WHEN e.status = 'approved' THEN (e.amount - e.refund_amount)::numeric ELSE 0 END), 0)::numeric AS executed,
        COALESCE(SUM(CASE WHEN e.status = 'draft' THEN e.amount::numeric ELSE 0 END), 0)::numeric AS draft_pending
        FROM budget_categories bc
        LEFT JOIN budgets b ON b.category_id = bc.id AND b.fiscal_year = ${year}
        LEFT JOIN expense_categories ec ON ec.code = bc.code AND ec.is_active = TRUE
        LEFT JOIN expenses e ON e.category_id = ec.id AND e.fiscal_year = ${year}
       WHERE bc.is_active = TRUE
       GROUP BY bc.id, bc.name, bc.code, b.planned_amount
       ORDER BY bc.id ASC
    `);
    const rows: any[] = r?.rows ?? r ?? [];
    const summary = rows.map((r: any) => {
      const planned = Number(r.planned) || 0;
      const executed = Number(r.executed) || 0;
      const draftPending = Number(r.draft_pending) || 0;
      const remaining = planned - executed;
      const usagePct = planned > 0 ? Math.round((executed / planned) * 100) : 0;
      return {
        categoryId: r.category_id, categoryName: r.category_name, code: r.category_code,
        planned, executed, draftPending, remaining, usagePct,
      };
    });
    const totals = summary.reduce((acc, r) => ({
      planned: acc.planned + r.planned,
      executed: acc.executed + r.executed,
      draftPending: acc.draftPending + r.draftPending,
      remaining: acc.remaining + r.remaining,
    }), { planned: 0, executed: 0, draftPending: 0, remaining: 0 });
    return { ok: true, output: { fiscalYear: year, totals, categories: summary } };
  } catch (e: any) {
    return { ok: false, error: `예산 요약 실패: ${e?.message?.slice(0, 200)}` };
  }
}

/* ─── 후원 정책 ─────────────────────────────────────── */
async function tool_donationPolicyGet(): Promise<ToolResult> {
  try {
    const r: any = await db.execute(sql`
      SELECT id, regular_amounts, onetime_amounts, min_amount, max_amount,
             bank_name, bank_account_no, bank_account_holder, bank_guide_text,
             hyosung_url, hyosung_guide_text, hyosung_countdown_message, hyosung_countdown_seconds,
             modal_title, modal_subtitle, updated_at
        FROM donation_policies
       ORDER BY id ASC LIMIT 1
    `);
    const row = (r?.rows ?? r ?? [])[0];
    if (!row) return { ok: false, error: "후원 정책 설정 없음" };
    return { ok: true, output: { policy: row } };
  } catch (e: any) {
    return { ok: false, error: `후원 정책 조회 실패: ${e?.message?.slice(0, 200)}` };
  }
}

/* ─── 채팅방 목록 ───────────────────────────────────── */
async function tool_chatRoomsList(args: any): Promise<ToolResult> {
  const limit = Math.min(Number(args?.limit) || 20, 100);
  const conds: any[] = [];
  if (typeof args?.status === "string" && ALLOWED_CHAT_STATUSES.has(args.status)) {
    conds.push(sql`r.status = ${args.status}`);
  } else {
    conds.push(sql`r.status != 'archived'`);
  }
  if (typeof args?.category === "string" && args.category.trim()) {
    conds.push(sql`r.category = ${args.category.trim()}`);
  }
  if (args?.unreadOnly === true) conds.push(sql`r.unread_for_admin > 0`);
  const where = sql`WHERE ${sql.join(conds, sql` AND `)}`;
  try {
    const r: any = await db.execute(sql`
      SELECT r.id, r.member_id, m.name AS member_name, r.category, r.title, r.status,
             r.last_message_at, r.last_message_preview, r.unread_for_admin, r.room_type
        FROM chat_rooms r
        LEFT JOIN members m ON m.id = r.member_id
        ${where}
       ORDER BY r.unread_for_admin DESC, r.last_message_at DESC NULLS LAST
       LIMIT ${limit}
    `);
    const rows = r?.rows ?? r ?? [];
    return { ok: true, output: { count: rows.length, chatRooms: rows } };
  } catch (e: any) {
    return { ok: false, error: `채팅방 조회 실패: ${e?.message?.slice(0, 200)}` };
  }
}

/* === Phase 22-A 매출 (6개) === */

async function tool_revenueCategoriesList(): Promise<ToolResult> {
  try {
    const r: any = await db.execute(sql`
      SELECT id, code, name, description, sort_order, is_active
        FROM revenue_categories
       ORDER BY sort_order ASC, id ASC
    `);
    const rows = r?.rows ?? r ?? [];
    return { ok: true, output: { count: rows.length, categories: rows } };
  } catch (e: any) {
    return { ok: false, error: `카테고리 조회 실패: ${e?.message?.slice(0, 200)}` };
  }
}

async function tool_revenueCreate(args: any, adminId: number | null): Promise<ToolResult> {
  const { recognizedAt, categoryId: rawCatId, categoryCode, amount, payerName, description, receiptUrl } = args || {};
  if (!recognizedAt || !amount) {
    return { ok: false, error: "recognizedAt, amount 필수" };
  }
  if (!rawCatId && !categoryCode) {
    return { ok: false, error: "categoryId 또는 categoryCode 둘 중 하나 필수" };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(recognizedAt))) {
    return { ok: false, error: "recognizedAt 형식 오류 (YYYY-MM-DD 필요)" };
  }

  // BUG-011 fix: categoryCode → categoryId 매핑 (AI 자연어 친화)
  let categoryId = rawCatId ? Number(rawCatId) : null;
  if (!categoryId && categoryCode) {
    const ALLOWED = new Set(["lecture", "govgrant", "corp_sponsor", "twork_on", "twork_si", "etc"]);
    const code = String(categoryCode).trim();
    if (!ALLOWED.has(code)) {
      return { ok: false, error: `categoryCode는 ${[...ALLOWED].join("|")} 중 하나` };
    }
    try {
      const catR: any = await db.execute(sql`SELECT id FROM revenue_categories WHERE code = ${code} LIMIT 1`);
      const catRow = (catR?.rows ?? catR ?? [])[0];
      if (!catRow) return { ok: false, error: `카테고리 코드 '${code}'가 DB에 없음` };
      categoryId = Number(catRow.id);
    } catch (e: any) {
      return { ok: false, error: `카테고리 코드 조회 실패: ${e?.message?.slice(0, 200)}` };
    }
  }

  // BUG-004 fix: fiscalYear는 recognizedAt 연도로 자동 계산
  const fiscalYear = Number(String(recognizedAt).slice(0, 4));

  const dryRun = args?.requireApproval !== false;
  const preview = {
    fiscalYear,
    recognizedAt: String(recognizedAt),
    categoryId,
    categoryCode: categoryCode || null,
    amount: Number(amount),
    payerName: payerName || null,
    description: description || null,
    status: "draft",
  };
  if (dryRun) {
    return { ok: true, preview, output: { dryRun: true, message: "확인 후 진행하시겠습니까?" } };
  }
  try {
    const r: any = await db.execute(sql`
      INSERT INTO other_revenues (fiscal_year, recognized_at, category_id, amount, payer_name, description, receipt_url, status, refund_amount, recorded_by, recorded_at)
      VALUES (${fiscalYear}, ${String(recognizedAt)}::date, ${categoryId}, ${Number(amount)},
              ${payerName || null}, ${description || null}, ${receiptUrl || null}, 'draft', 0, ${adminId}, NOW())
      RETURNING id, fiscal_year, recognized_at, category_id, amount, status
    `);
    const row = (r?.rows ?? r ?? [])[0];
    return { ok: true, output: { revenue: row, message: "수입 항목이 등록되었습니다 (draft 상태 — 승인 필요)." } };
  } catch (e: any) {
    return { ok: false, error: `수입 등록 실패: ${e?.message?.slice(0, 200)}` };
  }
}

async function tool_revenueList(args: any): Promise<ToolResult> {
  const { startDate, endDate, period } = resolvePeriod({
    period: args?.period, startDate: args?.startDate, endDate: args?.endDate,
    fiscalYear: args?.fiscalYear != null ? String(args.fiscalYear) : null,
  });
  const status = args?.status || "all";
  const categoryId = args?.categoryId;
  const payerName = (args?.payerName || "").trim();
  const limit = Math.min(Number(args?.limit) || 50, 100);
  const page = Math.max(1, Number(args?.page) || 1);
  const offset = (page - 1) * limit;

  const statusCond   = status !== "all" ? sql`AND r.status = ${status}`                    : sql``;
  const categoryCond = categoryId       ? sql`AND r.category_id = ${Number(categoryId)}`    : sql``;
  const payerCond    = payerName        ? sql`AND r.payer_name ILIKE ${`%${payerName}%`}`   : sql``;

  try {
    const r: any = await db.execute(sql`
      SELECT r.id, r.fiscal_year, r.recognized_at, r.category_id, c.name AS category_name,
             r.amount, r.refund_amount, r.payer_name, r.status, r.description
        FROM other_revenues r
        LEFT JOIN revenue_categories c ON c.id = r.category_id
       WHERE r.recognized_at::date BETWEEN ${startDate}::date AND ${endDate}::date
         ${statusCond} ${categoryCond} ${payerCond}
       ORDER BY r.recognized_at DESC, r.id DESC
       LIMIT ${limit} OFFSET ${offset}
    `);
    const rows = r?.rows ?? r ?? [];
    const sumR: any = await db.execute(sql`
      SELECT COALESCE(SUM(amount), 0) AS gross, COALESCE(SUM(refund_amount), 0) AS refund
        FROM other_revenues
       WHERE recognized_at::date BETWEEN ${startDate}::date AND ${endDate}::date
         ${statusCond} ${categoryCond} ${payerCond}
    `);
    const sumRow = (sumR?.rows ?? sumR ?? [])[0] || {};
    const gross = Number(sumRow.gross || 0);
    const refund = Number(sumRow.refund || 0);
    return { ok: true, output: { count: rows.length, items: rows, period, startDate, endDate, summary: { gross, refund, net: gross - refund } } };
  } catch (e: any) {
    return { ok: false, error: `수입 목록 조회 실패: ${e?.message?.slice(0, 200)}` };
  }
}

async function tool_revenueUpdate(args: any, adminId: number | null): Promise<ToolResult> {
  const { id, ...rest } = args || {};
  if (!id) return { ok: false, error: "id 필수" };
  const dryRun = args?.requireApproval !== false;
  if (dryRun) {
    return { ok: true, preview: { id, ...rest }, output: { dryRun: true, message: "이대로 수정할까요?" } };
  }
  try {
    const setParts: any[] = [];
    if (rest.fiscalYear   !== undefined) setParts.push(sql`fiscal_year = ${Number(rest.fiscalYear)}`);
    if (rest.recognizedAt !== undefined) setParts.push(sql`recognized_at = ${String(rest.recognizedAt)}::date`);
    if (rest.categoryId   !== undefined) setParts.push(sql`category_id = ${Number(rest.categoryId)}`);
    if (rest.amount       !== undefined) setParts.push(sql`amount = ${Number(rest.amount)}`);
    if (rest.payerName    !== undefined) setParts.push(sql`payer_name = ${rest.payerName || null}`);
    if (rest.description  !== undefined) setParts.push(sql`description = ${rest.description || null}`);
    if (rest.receiptUrl   !== undefined) setParts.push(sql`receipt_url = ${rest.receiptUrl || null}`);
    if (setParts.length === 0) return { ok: false, error: "수정할 필드가 없습니다" };
    setParts.push(sql`updated_at = NOW()`);
    await db.execute(sql`UPDATE other_revenues SET ${sql.join(setParts, sql`, `)} WHERE id = ${Number(id)} AND status = 'draft'`);
    return { ok: true, output: { message: `수입 항목 ${id}번이 수정되었습니다.` } };
  } catch (e: any) {
    return { ok: false, error: `수입 수정 실패: ${e?.message?.slice(0, 200)}` };
  }
}

async function tool_revenueApprove(args: any, adminId: number | null): Promise<ToolResult> {
  // BUG-006 안전망: super_admin 가드 (ai_tool_permissions 시드 누락 대비)
  const roleGuard = await ensureRole(adminId, ["super_admin"]);
  if (!roleGuard.ok) return { ok: false, error: roleGuard.error };

  const { id, action, rejectionReason } = args || {};
  if (!id || !action) return { ok: false, error: "id, action 필수" };
  if (!["approve", "reject"].includes(action)) return { ok: false, error: "action은 approve 또는 reject" };
  if (action === "reject" && !rejectionReason) return { ok: false, error: "반려 시 rejectionReason 필수" };
  const dryRun = args?.requireApproval !== false;
  if (dryRun) {
    return { ok: true, preview: { id, action, rejectionReason }, output: { dryRun: true, message: `${action === "approve" ? "승인" : "반려"}하시겠습니까?` } };
  }
  const newStatus = action === "approve" ? "approved" : "rejected";
  try {
    await db.execute(sql`
      UPDATE other_revenues
         SET status = ${newStatus},
             approved_by = ${adminId},
             approved_at = NOW(),
             rejection_reason = ${rejectionReason || null},
             updated_at = NOW()
       WHERE id = ${Number(id)} AND status = 'draft'
    `);
    return { ok: true, output: { message: `수입 항목 ${id}번이 ${action === "approve" ? "승인" : "반려"}되었습니다.` } };
  } catch (e: any) {
    return { ok: false, error: `승인/반려 처리 실패: ${e?.message?.slice(0, 200)}` };
  }
}

async function tool_revenueRefund(args: any, adminId: number | null): Promise<ToolResult> {
  // BUG-006 안전망: super_admin 가드 (API admin-revenue-refund.ts와 동일 권한)
  const roleGuard = await ensureRole(adminId, ["super_admin"]);
  if (!roleGuard.ok) return { ok: false, error: roleGuard.error };

  const { id, refundAmount } = args || {};
  if (!id || refundAmount === undefined) return { ok: false, error: "id, refundAmount 필수" };
  if (Number(refundAmount) < 0) return { ok: false, error: "환불금액은 0 이상이어야 합니다" };

  // 기존 레코드 조회 — 환불 가능 여부 확인 (status='approved' 필요)
  let row: any;
  try {
    const result: any = await db.execute(sql`
      SELECT id, amount, refund_amount, status, payer_name
        FROM other_revenues
       WHERE id = ${Number(id)}
       LIMIT 1
    `);
    row = (result?.rows ?? result ?? [])[0];
  } catch (e: any) {
    return { ok: false, error: `수입 조회 실패: ${e?.message?.slice(0, 200)}` };
  }
  if (!row) return { ok: false, error: "존재하지 않는 수입 항목" };
  if (row.status !== "approved") return { ok: false, error: `status='approved'인 항목만 환불 가능 (현재: ${row.status})` };

  // BUG-001 fix: 누적 환불 — 기존 + 신규 = 누적합
  const currentRefund = Number(row.refund_amount) || 0;
  const incremental   = Number(refundAmount);
  const newTotalRefund = currentRefund + incremental;
  const amount = Number(row.amount);

  if (newTotalRefund > amount) {
    return {
      ok: false,
      error: `누적 환불액(${newTotalRefund.toLocaleString("ko-KR")}원 = 기존 ${currentRefund.toLocaleString("ko-KR")}원 + 신규 ${incremental.toLocaleString("ko-KR")}원)이 원금(${amount.toLocaleString("ko-KR")}원)을 초과합니다`,
    };
  }

  const dryRun = args?.requireApproval !== false;
  if (dryRun) {
    return {
      ok: true,
      preview: {
        id, refundAmount: incremental,
        currentAmount: amount,
        currentRefund,
        newTotalRefund,
        payer: row.payer_name,
      },
      output: {
        dryRun: true,
        message: `수입 ${id}번(${row.payer_name})에 환불 ${incremental.toLocaleString("ko-KR")}원 누적 기록 (기존 ${currentRefund.toLocaleString("ko-KR")}원 → 합계 ${newTotalRefund.toLocaleString("ko-KR")}원) 하시겠습니까?`,
      },
      rollbackData: { id: Number(id), refund_amount: currentRefund },
    };
  }

  try {
    await db.execute(sql`
      UPDATE other_revenues
         SET refund_amount = ${newTotalRefund},
             updated_at = NOW()
       WHERE id = ${Number(id)} AND status = 'approved'
    `);
    return {
      ok: true,
      output: {
        message: `수입 ${id}번에 환불 ${incremental.toLocaleString("ko-KR")}원 누적 기록 완료 (합계 ${newTotalRefund.toLocaleString("ko-KR")}원).`,
        newTotalRefund,
      },
    };
  } catch (e: any) {
    return { ok: false, error: `환불 처리 실패: ${e?.message?.slice(0, 200)}` };
  }
}

async function tool_plSummary(args: any): Promise<ToolResult> {
  const { startDate, endDate, period, fiscalYear } = resolvePeriod({
    period: args?.period, startDate: args?.startDate, endDate: args?.endDate,
    fiscalYear: args?.fiscalYear != null ? String(args.fiscalYear) : null,
  });
  try {
    // 후원 — completed gross
    const donR: any = await db.execute(sql`
      SELECT COALESCE(SUM(amount), 0) AS gross
        FROM donations
       WHERE status = 'completed'
         AND COALESCE(hyosung_paid_date, created_at)::date BETWEEN ${startDate}::date AND ${endDate}::date
    `);
    const donGross = Number((donR?.rows ?? donR ?? [])[0]?.gross || 0);

    // BUG-002 fix: 후원 환불 (status='refunded') 별도 집계
    const donRefR: any = await db.execute(sql`
      SELECT COALESCE(SUM(amount), 0) AS refund
        FROM donations
       WHERE status = 'refunded'
         AND COALESCE(hyosung_paid_date, created_at)::date BETWEEN ${startDate}::date AND ${endDate}::date
    `);
    const donRefund = Number((donRefR?.rows ?? donRefR ?? [])[0]?.refund || 0);
    const donNet = donGross - donRefund;

    const othR: any = await db.execute(sql`
      SELECT c.code, c.name,
             COALESCE(SUM(r.amount), 0) AS gross,
             COALESCE(SUM(r.refund_amount), 0) AS refund
        FROM other_revenues r
        LEFT JOIN revenue_categories c ON c.id = r.category_id
       WHERE r.status = 'approved'
         AND r.recognized_at::date BETWEEN ${startDate}::date AND ${endDate}::date
       GROUP BY c.code, c.name
    `);
    const othRows = othR?.rows ?? othR ?? [];
    let othGross = 0; let othRefund = 0;
    const byCategory = othRows.map((row: any) => {
      const g = Number(row.gross); const rf = Number(row.refund);
      othGross += g; othRefund += rf;
      return { code: row.code, name: row.name, gross: g, refund: rf, net: g - rf };
    });

    // Phase 22-C 지출 집계 (status='approved', occurred_at 기준)
    const expConds = [
      sql`e.status = 'approved'`,
      sql`e.occurred_at::date BETWEEN ${startDate}::date AND ${endDate}::date`,
      ...(fiscalYear !== null ? [sql`e.fiscal_year = ${fiscalYear}`] : []),
    ];
    const expR: any = await db.execute(sql`
      SELECT c.code, c.name,
             COALESCE(SUM(e.amount), 0) AS gross,
             COALESCE(SUM(e.refund_amount), 0) AS refund
        FROM expenses e
        LEFT JOIN expense_categories c ON c.id = e.category_id
       WHERE ${sql.join(expConds, sql` AND `)}
       GROUP BY c.code, c.name
    `);
    const expRows = expR?.rows ?? expR ?? [];
    let expGross = 0; let expRefund = 0;
    const expByCategory = expRows.map((row: any) => {
      const g = Number(row.gross); const rf = Number(row.refund);
      expGross += g; expRefund += rf;
      return { code: row.code, name: row.name, gross: g, refund: rf, total: g - rf };
    });

    const totalNet = donNet + (othGross - othRefund);
    const expenditureTotal = expGross - expRefund;
    const netIncome = totalNet - expenditureTotal;
    return {
      ok: true,
      output: {
        period, startDate, endDate,
        ...(fiscalYear !== null ? { fiscalYear } : {}),
        revenue: {
          donations: { gross: donGross, refund: donRefund, net: donNet },
          other: { gross: othGross, refund: othRefund, net: othGross - othRefund, byCategory },
          totalNet,
        },
        expenditure: { total: expenditureTotal, gross: expGross, refund: expRefund, byCategory: expByCategory },
        netIncome,
        summary: `${startDate}~${endDate} 총수입 ${totalNet.toLocaleString("ko-KR")}원 - 총지출 ${expenditureTotal.toLocaleString("ko-KR")}원 = 순이익 ${netIncome.toLocaleString("ko-KR")}원`,
      },
    };
  } catch (e: any) {
    return { ok: false, error: `손익 요약 조회 실패: ${e?.message?.slice(0, 200)}` };
  }
}

/* === Phase 22-C 지출 (5개) === */

async function tool_expenseCategoriesList(): Promise<ToolResult> {
  try {
    const r: any = await db.execute(sql`
      SELECT id, code, name, description, is_system, sort_order, is_active
        FROM expense_categories
       ORDER BY sort_order ASC, id ASC
    `);
    const rows = r?.rows ?? r ?? [];
    return { ok: true, output: { count: rows.length, categories: rows } };
  } catch (e: any) {
    return { ok: false, error: `지출 카테고리 조회 실패: ${e?.message?.slice(0, 200)}` };
  }
}

async function tool_expensesList(args: any): Promise<ToolResult> {
  const { startDate, endDate, period, fiscalYear } = resolvePeriod({
    period: args?.period, startDate: args?.startDate, endDate: args?.endDate,
    fiscalYear: args?.fiscalYear != null ? String(args.fiscalYear) : null,
  });
  const status = args?.status || "all";
  const categoryId = args?.categoryId ? Number(args.categoryId) : null;
  const limit = Math.min(Number(args?.limit) || 30, 100);
  const page = Math.max(1, Number(args?.page) || 1);
  const offset = (page - 1) * limit;

  // §18.13 enum 동기화: status 검증
  const ALLOWED_STATUS = ["draft", "approved", "rejected", "all"];
  if (!ALLOWED_STATUS.includes(status)) {
    return { ok: false, error: `status는 ${ALLOWED_STATUS.join("|")} 중 하나` };
  }

  const baseConds = [
    sql`e.occurred_at::date BETWEEN ${startDate}::date AND ${endDate}::date`,
    ...(fiscalYear !== null ? [sql`e.fiscal_year = ${fiscalYear}`] : []),
    ...(status !== "all" ? [sql`e.status = ${status}`] : []),
    ...(categoryId ? [sql`e.category_id = ${categoryId}`] : []),
  ];
  const where = sql.join(baseConds, sql` AND `);

  try {
    const r: any = await db.execute(sql`
      SELECT e.id, e.fiscal_year, e.occurred_at, e.category_id, c.code AS category_code, c.name AS category_name,
             e.amount, e.refund_amount, (e.amount - e.refund_amount) AS net_amount,
             e.payee_name, e.description, e.receipt_url, e.status,
             e.recorded_by, e.approved_by, e.approved_at, e.rejection_reason
        FROM expenses e
        LEFT JOIN expense_categories c ON c.id = e.category_id
       WHERE ${where}
       ORDER BY e.occurred_at DESC, e.id DESC
       LIMIT ${limit} OFFSET ${offset}
    `);
    const rows = r?.rows ?? r ?? [];

    const sumR: any = await db.execute(sql`
      SELECT COALESCE(SUM(e.amount), 0) AS gross,
             COALESCE(SUM(e.refund_amount), 0) AS refund
        FROM expenses e
       WHERE ${where}
    `);
    const sumRow = (sumR?.rows ?? sumR ?? [])[0] || {};
    const gross = Number(sumRow.gross || 0);
    const refund = Number(sumRow.refund || 0);

    return {
      ok: true,
      output: {
        count: rows.length,
        items: rows,
        period, startDate, endDate,
        summary: { gross, refund, net: gross - refund },
      },
    };
  } catch (e: any) {
    return { ok: false, error: `지출 목록 조회 실패: ${e?.message?.slice(0, 200)}` };
  }
}

async function tool_expenseCreate(args: any, adminId: number | null): Promise<ToolResult> {
  const { fiscalYear, occurredAt, categoryId: rawCatId, categoryCode, amount, payeeName, description, receiptUrl } = args || {};
  if (!fiscalYear || !occurredAt || amount === undefined) {
    return { ok: false, error: "fiscalYear, occurredAt, amount 필수" };
  }
  if (!rawCatId && !categoryCode) {
    return { ok: false, error: "categoryId 또는 categoryCode 둘 중 하나 필수" };
  }
  if (Number(amount) <= 0) {
    return { ok: false, error: "금액은 0보다 커야 합니다" };
  }

  // BUG-011 fix: categoryCode → categoryId 매핑 (AI 자연어 친화)
  // §15.5 schema 사전 검증: id 또는 code로 카테고리 행 조회 + is_active 확인
  let catRow: any;
  try {
    if (rawCatId) {
      const r: any = await db.execute(sql`
        SELECT id, name, is_active FROM expense_categories WHERE id = ${Number(rawCatId)} LIMIT 1
      `);
      catRow = (r?.rows ?? r ?? [])[0];
    } else {
      const ALLOWED = new Set(["personnel", "program", "admin_ops", "fundraising"]);
      const code = String(categoryCode).trim();
      // 시스템 4분류 외에도 사용자 정의 카테고리가 있을 수 있으므로 ALLOWED 검증은 경고만 (DB 조회에 의존)
      const r: any = await db.execute(sql`
        SELECT id, name, is_active FROM expense_categories WHERE code = ${code} LIMIT 1
      `);
      catRow = (r?.rows ?? r ?? [])[0];
      if (!catRow && ALLOWED.has(code)) {
        return { ok: false, error: `시스템 카테고리 코드 '${code}'가 DB에 없음 (마이그레이션 미실행 의심)` };
      }
    }
  } catch (e: any) {
    return { ok: false, error: `카테고리 조회 실패: ${e?.message?.slice(0, 200)}` };
  }
  if (!catRow) return { ok: false, error: "존재하지 않는 카테고리" };
  if (!catRow.is_active) return { ok: false, error: "비활성화된 카테고리입니다" };
  const categoryId = Number(catRow.id);

  const dryRun = args?.requireApproval !== false;
  const preview = {
    fiscalYear: Number(fiscalYear),
    occurredAt: String(occurredAt),
    categoryId: Number(categoryId),
    categoryName: catRow.name,
    amount: Number(amount),
    payeeName: payeeName || null,
    description: description || null,
    status: "draft",
  };
  if (dryRun) {
    return {
      ok: true,
      preview,
      output: { dryRun: true, message: `지출 ${Number(amount).toLocaleString("ko-KR")}원 (${catRow.name}) 등록할까요?` },
    };
  }

  try {
    const r: any = await db.execute(sql`
      INSERT INTO expenses (fiscal_year, occurred_at, category_id, amount, payee_name, description, receipt_url, status, refund_amount, recorded_by, recorded_at)
      VALUES (${Number(fiscalYear)}, ${String(occurredAt)}::date, ${Number(categoryId)}, ${Number(amount)},
              ${payeeName || null}, ${description || null}, ${receiptUrl || null}, 'draft', 0, ${adminId}, NOW())
      RETURNING id, fiscal_year, occurred_at, category_id, amount, status
    `);
    const row = (r?.rows ?? r ?? [])[0];
    return { ok: true, output: { expense: row, message: "지출 항목이 등록되었습니다 (draft 상태 — 승인 필요)." } };
  } catch (e: any) {
    return { ok: false, error: `지출 등록 실패: ${e?.message?.slice(0, 200)}` };
  }
}

async function tool_expenseApprove(args: any, adminId: number | null): Promise<ToolResult> {
  // BUG-006 안전망: super_admin 가드
  const roleGuard = await ensureRole(adminId, ["super_admin"]);
  if (!roleGuard.ok) return { ok: false, error: roleGuard.error };

  const { id, action, rejectionReason } = args || {};
  if (!id || !action) return { ok: false, error: "id, action 필수" };
  if (!["approve", "reject"].includes(action)) return { ok: false, error: "action은 approve 또는 reject" };
  if (action === "reject" && !rejectionReason) return { ok: false, error: "반려 시 rejectionReason 필수" };

  // 대상 존재·status 검증
  let row: any;
  try {
    const result: any = await db.execute(sql`
      SELECT id, amount, status, payee_name FROM expenses WHERE id = ${Number(id)} LIMIT 1
    `);
    row = (result?.rows ?? result ?? [])[0];
  } catch (e: any) {
    return { ok: false, error: `지출 조회 실패: ${e?.message?.slice(0, 200)}` };
  }
  if (!row) return { ok: false, error: "존재하지 않는 지출 항목" };
  if (row.status !== "draft") return { ok: false, error: `draft 상태만 승인·반려 가능 (현재: ${row.status})` };

  const dryRun = args?.requireApproval !== false;
  if (dryRun) {
    return {
      ok: true,
      preview: { id, action, rejectionReason, currentStatus: row.status, amount: Number(row.amount), payee: row.payee_name },
      output: {
        dryRun: true,
        message: `지출 ${id}번 (${row.payee_name || "지급처 없음"}, ${Number(row.amount).toLocaleString("ko-KR")}원)을 ${action === "approve" ? "승인" : "반려"}할까요?`,
      },
      rollbackData: { id: Number(id), status: row.status },
    };
  }

  const newStatus = action === "approve" ? "approved" : "rejected";
  try {
    await db.execute(sql`
      UPDATE expenses
         SET status = ${newStatus},
             approved_by = ${adminId},
             approved_at = NOW(),
             rejection_reason = ${rejectionReason || null},
             updated_at = NOW()
       WHERE id = ${Number(id)} AND status = 'draft'
    `);
    return { ok: true, output: { message: `지출 ${id}번이 ${action === "approve" ? "승인" : "반려"}되었습니다.` } };
  } catch (e: any) {
    return { ok: false, error: `승인/반려 처리 실패: ${e?.message?.slice(0, 200)}` };
  }
}

async function tool_expenseRefund(args: any, adminId: number | null): Promise<ToolResult> {
  // BUG-006 안전망: super_admin 가드 (API admin-expense-refund.ts와 동일 권한)
  const roleGuard = await ensureRole(adminId, ["super_admin"]);
  if (!roleGuard.ok) return { ok: false, error: roleGuard.error };

  const { id, refundAmount } = args || {};
  if (!id || refundAmount === undefined) return { ok: false, error: "id, refundAmount 필수" };
  if (Number(refundAmount) < 0) return { ok: false, error: "환불금액은 0 이상이어야 합니다" };

  let row: any;
  try {
    const result: any = await db.execute(sql`
      SELECT id, amount, refund_amount, status, payee_name
        FROM expenses
       WHERE id = ${Number(id)}
       LIMIT 1
    `);
    row = (result?.rows ?? result ?? [])[0];
  } catch (e: any) {
    return { ok: false, error: `지출 조회 실패: ${e?.message?.slice(0, 200)}` };
  }
  if (!row) return { ok: false, error: "존재하지 않는 지출 항목" };
  if (row.status !== "approved") return { ok: false, error: `status='approved'인 항목만 환불 가능 (현재: ${row.status})` };

  // BUG-015 fix: 누적 환불 — 기존 + 신규 = 누적합
  const currentRefund = Number(row.refund_amount) || 0;
  const incremental   = Number(refundAmount);
  const newTotalRefund = currentRefund + incremental;
  const amount = Number(row.amount);

  if (newTotalRefund > amount) {
    return {
      ok: false,
      error: `누적 환불액(${newTotalRefund.toLocaleString("ko-KR")}원 = 기존 ${currentRefund.toLocaleString("ko-KR")}원 + 신규 ${incremental.toLocaleString("ko-KR")}원)이 원금(${amount.toLocaleString("ko-KR")}원)을 초과합니다`,
    };
  }

  const dryRun = args?.requireApproval !== false;
  if (dryRun) {
    return {
      ok: true,
      preview: {
        id, refundAmount: incremental,
        currentAmount: amount,
        currentRefund,
        newTotalRefund,
        payee: row.payee_name,
      },
      output: {
        dryRun: true,
        message: `지출 ${id}번(${row.payee_name || "지급처 없음"})에 환불 ${incremental.toLocaleString("ko-KR")}원 누적 기록 (기존 ${currentRefund.toLocaleString("ko-KR")}원 → 합계 ${newTotalRefund.toLocaleString("ko-KR")}원) 하시겠습니까?`,
      },
      rollbackData: { id: Number(id), refund_amount: currentRefund },
    };
  }

  try {
    await db.execute(sql`
      UPDATE expenses
         SET refund_amount = ${newTotalRefund},
             updated_at = NOW()
       WHERE id = ${Number(id)} AND status = 'approved'
    `);
    return {
      ok: true,
      output: {
        message: `지출 ${id}번에 환불 ${incremental.toLocaleString("ko-KR")}원 누적 기록 완료 (합계 ${newTotalRefund.toLocaleString("ko-KR")}원).`,
        newTotalRefund,
      },
    };
  } catch (e: any) {
    return { ok: false, error: `환불 처리 실패: ${e?.message?.slice(0, 200)}` };
  }
}

/* ─────────────────────────────────────────
   Phase 22-B-R2 예산 편성 도구
   ───────────────────────────────────────── */

async function tool_budgetPlanList(args: any): Promise<ToolResult> {
  const { fiscalYear, status } = args || {};
  let cond = sql`WHERE 1=1`;
  if (fiscalYear) cond = sql`${cond} AND bp.fiscal_year = ${Number(fiscalYear)}`;
  if (status && status !== "all") cond = sql`${cond} AND bp.status = ${status}`;

  try {
    const r: any = await db.execute(sql`
      SELECT id, fiscal_year, title, status, total_planned, submitted_at, approved_at, created_at
      FROM budget_plans bp
      ${cond}
      ORDER BY fiscal_year DESC LIMIT 20
    `);
    const rows = r?.rows ?? r ?? [];
    return {
      ok: true,
      output: {
        count: rows.length,
        plans: rows.map((p: any) => ({
          id: Number(p.id),
          fiscalYear: Number(p.fiscal_year),
          title: p.title,
          status: p.status,
          totalPlanned: Number(p.total_planned),
          submittedAt: p.submitted_at,
          approvedAt: p.approved_at,
        })),
      },
    };
  } catch (e: any) {
    return { ok: false, error: `예산안 목록 조회 실패: ${e?.message?.slice(0, 200)}` };
  }
}

async function tool_budgetPlanCreate(args: any, adminId: number | null): Promise<ToolResult> {
  const { fiscalYear, title, requireApproval } = args || {};
  if (!fiscalYear) return { ok: false, error: "fiscalYear 필수" };
  const dryRun = requireApproval !== false;

  // 중복 체크
  try {
    const dup: any = await db.execute(sql`SELECT id FROM budget_plans WHERE fiscal_year = ${Number(fiscalYear)} LIMIT 1`);
    if ((dup?.rows ?? dup ?? []).length > 0) {
      return { ok: false, error: `${fiscalYear}년도 예산안이 이미 존재합니다` };
    }
  } catch (e: any) {
    return { ok: false, error: `중복 확인 실패: ${e?.message?.slice(0, 200)}` };
  }

  // 전년 실적 미리 집계
  let prevTotal = 0;
  let catCount = 0;
  try {
    const prevYear = Number(fiscalYear) - 1;
    const cats: any = await db.execute(sql`SELECT COUNT(*) AS n FROM expense_categories WHERE is_active = TRUE`);
    catCount = Number((cats?.rows ?? cats ?? [])[0]?.n ?? 0);
    const prev: any = await db.execute(sql`
      SELECT COALESCE(SUM(amount - refund_amount), 0)::bigint AS total
      FROM expenses WHERE fiscal_year = ${prevYear} AND status = 'approved'
    `);
    prevTotal = Number((prev?.rows ?? prev ?? [])[0]?.total ?? 0);
  } catch { /* 집계 실패 무시 */ }

  const planTitle = title || `${fiscalYear}년도 예산안`;

  if (dryRun) {
    return {
      ok: true,
      preview: { fiscalYear, title: planTitle, prevYearTotal: prevTotal, categoryCount: catCount },
      output: {
        dryRun: true,
        message: `${fiscalYear}년도 예산안을 생성할까요? (카테고리 ${catCount}개, 전년 실적 합계 ${prevTotal.toLocaleString("ko-KR")}원을 기본값으로 채움)`,
      },
    };
  }

  if (!adminId) return { ok: false, error: "관리자 인증 필요" };
  try {
    const res: any = await db.execute(sql`
      INSERT INTO budget_plans (fiscal_year, title, status, total_planned, created_by, created_at, updated_at)
      VALUES (${Number(fiscalYear)}, ${planTitle}, 'draft', 0, ${adminId}, NOW(), NOW())
      RETURNING id
    `);
    const newId = Number((res?.rows ?? res ?? [])[0]?.id);

    const prevYear = Number(fiscalYear) - 1;
    const actuals: any = await db.execute(sql`
      SELECT category_id, COALESCE(SUM(amount - refund_amount), 0)::bigint AS actual
      FROM expenses WHERE fiscal_year = ${prevYear} AND status = 'approved' GROUP BY category_id
    `);
    const actualMap = new Map((actuals?.rows ?? actuals ?? []).map((r: any) => [Number(r.category_id), Number(r.actual)]));

    const catRows: any = await db.execute(sql`SELECT id FROM expense_categories WHERE is_active = TRUE ORDER BY sort_order, id`);
    let total = 0;
    for (const c of (catRows?.rows ?? catRows ?? [])) {
      const catId = Number(c.id);
      const prev = (actualMap as Map<number, number>).get(catId) ?? 0;
      total += prev;
      await db.execute(sql`
        INSERT INTO budget_lines (plan_id, category_id, planned_amount, prev_year_actual)
        VALUES (${newId}, ${catId}, ${prev}, ${prev}) ON CONFLICT DO NOTHING
      `);
    }
    await db.execute(sql`UPDATE budget_plans SET total_planned = ${total}, updated_at = NOW() WHERE id = ${newId}`);

    return { ok: true, output: { message: `${fiscalYear}년도 예산안이 생성되었습니다. (ID: ${newId})`, planId: newId, totalPlanned: total } };
  } catch (e: any) {
    return { ok: false, error: `예산안 생성 실패: ${e?.message?.slice(0, 200)}` };
  }
}

async function tool_budgetPlanApprove(args: any, adminId: number | null): Promise<ToolResult> {
  const roleGuard = await ensureRole(adminId, ["super_admin"]);
  if (!roleGuard.ok) return { ok: false, error: roleGuard.error };

  const { planId, action, rejectionReason, requireApproval } = args || {};
  if (!planId || !action) return { ok: false, error: "planId, action 필수" };
  if (action === "reject" && !rejectionReason?.trim()) return { ok: false, error: "반려 사유 필수" };
  const dryRun = requireApproval !== false;

  let plan: any;
  try {
    const r: any = await db.execute(sql`SELECT id, status, fiscal_year FROM budget_plans WHERE id = ${Number(planId)} LIMIT 1`);
    plan = (r?.rows ?? r ?? [])[0];
    if (!plan) return { ok: false, error: "예산안을 찾을 수 없습니다" };
    if (plan.status !== "submitted") return { ok: false, error: `submitted 상태에서만 가능 (현재: ${plan.status})` };
  } catch (e: any) {
    return { ok: false, error: `예산안 조회 실패: ${e?.message?.slice(0, 200)}` };
  }

  const label = action === "approve" ? "승인" : "반려";
  if (dryRun) {
    return {
      ok: true,
      preview: { planId: Number(planId), action, fiscalYear: plan.fiscal_year, rejectionReason },
      output: { dryRun: true, message: `${plan.fiscal_year}년도 예산안을 ${label}하시겠습니까?${rejectionReason ? ` 사유: ${rejectionReason}` : ""}` },
    };
  }

  try {
    if (action === "approve") {
      await db.execute(sql`
        UPDATE budget_plans SET status = 'approved', approved_by = ${adminId}, approved_at = NOW(), updated_at = NOW()
        WHERE id = ${Number(planId)}
      `);
    } else {
      await db.execute(sql`
        UPDATE budget_plans SET status = 'rejected', approved_by = ${adminId}, approved_at = NOW(),
        rejection_reason = ${rejectionReason}, updated_at = NOW() WHERE id = ${Number(planId)}
      `);
    }
    return { ok: true, output: { message: `${plan.fiscal_year}년도 예산안이 ${label}되었습니다.` } };
  } catch (e: any) {
    return { ok: false, error: `${label} 처리 실패: ${e?.message?.slice(0, 200)}` };
  }
}

/* ─────────────────────────────────────────
   Phase 22-D-R1 전표 시스템 도구
   ───────────────────────────────────────── */

async function tool_accountCodesList(args: any): Promise<ToolResult> {
  const { category, activeOnly } = args || {};
  const onlyActive = activeOnly !== false;
  let cond = onlyActive ? sql`WHERE is_active = TRUE` : sql`WHERE 1=1`;
  if (category) cond = sql`${cond} AND category = ${category}`;

  try {
    const r: any = await db.execute(sql`
      SELECT id, code, name, parent_code, category, is_active, sort_order
      FROM account_codes ${cond} ORDER BY sort_order, code
    `);
    const rows = r?.rows ?? r ?? [];
    return {
      ok: true,
      output: {
        count: rows.length,
        accountCodes: rows.map((c: any) => ({
          id: Number(c.id), code: c.code, name: c.name,
          parentCode: c.parent_code, category: c.category, isActive: c.is_active,
        })),
      },
    };
  } catch (e: any) {
    return { ok: false, error: `계정과목 조회 실패: ${e?.message?.slice(0, 200)}` };
  }
}

async function tool_voucherList(args: any): Promise<ToolResult> {
  const { period, startDate, endDate, fiscalYear, accountCode, budgetLineId, status, isTemplate, page, limit: lim } = args || {};

  let dateStart: string | null = null;
  let dateEnd: string | null = null;
  if (fiscalYear) {
    dateStart = `${fiscalYear}-01-01`;
    dateEnd   = `${fiscalYear}-12-31`;
  } else if (startDate && endDate) {
    dateStart = startDate;
    dateEnd   = endDate;
  } else {
    const now = new Date();
    dateStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    dateEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  }

  const pageNum  = Math.max(1, Number(page) || 1);
  const pageSize = Math.min(Number(lim) || 30, 100);
  const offset   = (pageNum - 1) * pageSize;

  try {
    const r: any = await db.execute(sql`
      SELECT v.id, v.voucher_number, v.voucher_date, v.account_code, v.account_name,
             v.description, v.payee_name, v.amount, v.status, v.evidence_type,
             v.budget_line_id, v.is_template, v.template_name, v.created_by, v.created_at
      FROM vouchers v
      WHERE v.voucher_date BETWEEN ${dateStart} AND ${dateEnd}
        ${accountCode ? sql`AND v.account_code = ${accountCode}` : sql``}
        ${budgetLineId ? sql`AND v.budget_line_id = ${Number(budgetLineId)}` : sql``}
        ${(status && status !== "all") ? sql`AND v.status = ${status}` : sql``}
        ${(isTemplate !== undefined) ? sql`AND v.is_template = ${Boolean(isTemplate)}` : sql``}
      ORDER BY v.voucher_date DESC, v.id DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `);
    const rows = r?.rows ?? r ?? [];
    return {
      ok: true,
      output: {
        count: rows.length,
        page: pageNum,
        vouchers: rows.map((v: any) => ({
          id: Number(v.id), voucherNumber: v.voucher_number, date: v.voucher_date,
          accountCode: v.account_code, accountName: v.account_name,
          description: v.description, payeeName: v.payee_name,
          amount: Number(v.amount), status: v.status,
        })),
      },
    };
  } catch (e: any) {
    return { ok: false, error: `전표 목록 조회 실패: ${e?.message?.slice(0, 200)}` };
  }
}

async function tool_voucherCreate(args: any, adminId: number | null): Promise<ToolResult> {
  const { voucherDate, accountCode, subAccount, description, payeeName, amount,
          evidenceType, budgetLineId, isTemplate, templateName, requireApproval } = args || {};

  if (!voucherDate || !accountCode || !description || amount === undefined) {
    return { ok: false, error: "voucherDate, accountCode, description, amount 필수" };
  }
  const dryRun = requireApproval !== false;

  // 계정과목 존재 확인
  let accountName = accountCode;
  try {
    const ac: any = await db.execute(sql`SELECT name FROM account_codes WHERE code = ${accountCode} AND is_active = TRUE LIMIT 1`);
    const row = (ac?.rows ?? ac ?? [])[0];
    if (!row) return { ok: false, error: `존재하지 않는 계정과목 코드: ${accountCode}` };
    accountName = row.name;
  } catch (e: any) {
    return { ok: false, error: `계정과목 확인 실패: ${e?.message?.slice(0, 200)}` };
  }

  if (dryRun) {
    return {
      ok: true,
      preview: { voucherDate, accountCode, accountName, description, payeeName, amount, evidenceType: evidenceType || "none" },
      output: {
        dryRun: true,
        message: `전표를 작성할까요? [${voucherDate}] ${accountName}(${accountCode}) ${payeeName ? `/ ${payeeName}` : ""} ${Number(amount).toLocaleString("ko-KR")}원 — ${description}`,
      },
    };
  }

  if (!adminId) return { ok: false, error: "관리자 인증 필요" };

  try {
    // 어드민 email (created_by 용) 조회
    const memberR: any = await db.execute(sql`SELECT email FROM members WHERE id = ${adminId} LIMIT 1`);
    const memberUid = (memberR?.rows ?? memberR ?? [])[0]?.email;
    if (!memberUid) return { ok: false, error: "관리자 이메일 조회 실패" };

    // voucher_number: YYYYMM-NNN (트랜잭션 내 MAX+1)
    const yyyymm = voucherDate.slice(0, 7).replace("-", "");
    const maxR: any = await db.execute(sql`
      SELECT COALESCE(MAX(CAST(SPLIT_PART(voucher_number, '-', 2) AS INTEGER)), 0) AS maxn
      FROM vouchers WHERE voucher_number LIKE ${`${yyyymm}-%`}
    `);
    const nextN = Number((maxR?.rows ?? maxR ?? [])[0]?.maxn ?? 0) + 1;
    const voucherNumber = `${yyyymm}-${String(nextN).padStart(3, "0")}`;
    const fiscalYear = parseInt(voucherDate.slice(0, 4));

    const res: any = await db.execute(sql`
      INSERT INTO vouchers (
        voucher_number, voucher_date, fiscal_year, account_code, account_name,
        sub_account, description, payee_name, amount, evidence_type,
        budget_line_id, is_template, template_name, status, created_by, created_at, updated_at
      ) VALUES (
        ${voucherNumber}, ${voucherDate}, ${fiscalYear}, ${accountCode}, ${accountName},
        ${subAccount || null}, ${description}, ${payeeName || null}, ${Number(amount)}, ${evidenceType || "none"},
        ${budgetLineId ? Number(budgetLineId) : null}, ${Boolean(isTemplate)}, ${templateName || null},
        'draft', ${String(memberUid)}, NOW(), NOW()
      ) RETURNING id, voucher_number
    `);
    const created = (res?.rows ?? res ?? [])[0];
    return { ok: true, output: { message: `전표가 작성되었습니다. 번호: ${created.voucher_number}`, voucherId: Number(created.id), voucherNumber: created.voucher_number } };
  } catch (e: any) {
    return { ok: false, error: `전표 작성 실패: ${e?.message?.slice(0, 200)}` };
  }
}

async function tool_voucherApprove(args: any, adminId: number | null): Promise<ToolResult> {
  const roleGuard = await ensureRole(adminId, ["super_admin"]);
  if (!roleGuard.ok) return { ok: false, error: roleGuard.error };

  const { voucherId, action, rejectionReason, requireApproval } = args || {};
  if (!voucherId || !action) return { ok: false, error: "voucherId, action 필수" };
  if (action === "reject" && !rejectionReason?.trim()) return { ok: false, error: "반려 사유 필수" };
  const dryRun = requireApproval !== false;

  let voucher: any;
  try {
    const r: any = await db.execute(sql`
      SELECT id, voucher_number, status, description, amount FROM vouchers WHERE id = ${Number(voucherId)} LIMIT 1
    `);
    voucher = (r?.rows ?? r ?? [])[0];
    if (!voucher) return { ok: false, error: "전표를 찾을 수 없습니다" };
    if (voucher.status !== "submitted") return { ok: false, error: `submitted 상태에서만 가능 (현재: ${voucher.status})` };
  } catch (e: any) {
    return { ok: false, error: `전표 조회 실패: ${e?.message?.slice(0, 200)}` };
  }

  const label = action === "approve" ? "승인" : "반려";
  if (dryRun) {
    return {
      ok: true,
      preview: { voucherId: Number(voucherId), action, voucherNumber: voucher.voucher_number },
      output: { dryRun: true, message: `전표 ${voucher.voucher_number}(${Number(voucher.amount).toLocaleString("ko-KR")}원)을 ${label}하시겠습니까?` },
    };
  }

  try {
    // 어드민 email (approved_by 용) 조회
    const memberR: any = await db.execute(sql`SELECT email FROM members WHERE id = ${adminId} LIMIT 1`);
    const memberUid = (memberR?.rows ?? memberR ?? [])[0]?.email;

    if (action === "approve") {
      await db.execute(sql`
        UPDATE vouchers SET status = 'approved', approved_by = ${String(memberUid)},
        approved_at = NOW(), updated_at = NOW() WHERE id = ${Number(voucherId)}
      `);
    } else {
      await db.execute(sql`
        UPDATE vouchers SET status = 'rejected', approved_by = ${String(memberUid)},
        approved_at = NOW(), rejection_reason = ${rejectionReason}, updated_at = NOW()
        WHERE id = ${Number(voucherId)}
      `);
    }
    return { ok: true, output: { message: `전표 ${voucher.voucher_number}이 ${label}되었습니다.` } };
  } catch (e: any) {
    return { ok: false, error: `${label} 처리 실패: ${e?.message?.slice(0, 200)}` };
  }
}

/* === Phase 22-D-R2 통장 대사 === */
async function tool_bankReconcileSummary(args: any): Promise<ToolResult> {
  const { startDate, endDate, importId } = args || {};
  try {
    const r: any = await db.execute(sql`
      SELECT txn_type, match_type, status,
             COUNT(*) AS cnt, COALESCE(SUM(ABS(amount)), 0) AS total
      FROM bank_transactions
      WHERE 1=1
        ${startDate ? sql`AND txn_date >= ${startDate}` : sql``}
        ${endDate   ? sql`AND txn_date <= ${endDate}` : sql``}
        ${importId  ? sql`AND import_id = ${Number(importId)}` : sql``}
      GROUP BY txn_type, match_type, status`);
    const rows = (r?.rows ?? r ?? []) as any[];

    const income  = { total: 0, totalAmount: 0, matched: 0, batch: 0, revenue: 0, pending: 0, ignored: 0 };
    const expense = { total: 0, totalAmount: 0, voucherCreated: 0, pending: 0, ignored: 0 };

    for (const x of rows) {
      const cnt = Number(x.cnt);
      const amt = Number(x.total);
      const isCredit = x.txn_type === "credit";
      const bucket = isCredit ? income : expense;
      bucket.total += cnt;
      bucket.totalAmount += amt;
      if (x.status === "ignored") {
        bucket.ignored += cnt;
      } else if (x.status === "confirmed" || x.status === "voucher_created") {
        if (isCredit) {
          if (x.match_type === "donation_batch") income.batch += cnt;
          else if (x.match_type === "revenue")   income.revenue += cnt;
          else                                   income.matched += cnt;
        } else {
          expense.voucherCreated += cnt;
        }
      } else {
        bucket.pending += cnt;
      }
    }

    return {
      ok: true,
      output: {
        period: { startDate: startDate || "전체", endDate: endDate || "전체" },
        입금: {
          건수: income.total,
          총액: income.totalAmount,
          개별후원매칭: income.matched,
          묶음정산: income.batch,
          매출확정: income.revenue,
          확인대기: income.pending,
          무시: income.ignored,
        },
        출금: {
          건수: expense.total,
          총액: expense.totalAmount,
          전표생성: expense.voucherCreated,
          확인대기: expense.pending,
          무시: expense.ignored,
        },
        요약: `입금 ${income.total}건 중 ${income.matched + income.batch + income.revenue}건 확정·${income.pending}건 확인대기, 출금 ${expense.total}건 중 ${expense.voucherCreated}건 전표생성·${expense.pending}건 확인대기`,
      },
    };
  } catch (e: any) {
    return { ok: false, error: `통장 대사 현황 조회 실패: ${e?.message?.slice(0, 200)}` };
  }
}
