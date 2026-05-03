import {
  pgTable, serial, varchar, integer, text, timestamp,
  boolean, index, pgEnum
} from "drizzle-orm/pg-core";

/* =========================================================
   ENUM 타입
   ========================================================= */
export const memberTypeEnum = pgEnum("member_type", [
  "regular",   // 일반 후원 회원
  "family",    // 유가족 회원
  "volunteer", // 봉사자
  "admin"      // 관리자
]);

export const memberStatusEnum = pgEnum("member_status", [
  "pending",   // 승인 대기 (유가족 증빙 검토 중)
  "active",    // 정상
  "suspended", // 정지
  "withdrawn"  // 탈퇴
]);

export const donationTypeEnum = pgEnum("donation_type", [
  "regular",   // 정기 후원
  "onetime"    // 일시 후원
]);

export const donationStatusEnum = pgEnum("donation_status", [
  "pending",          // 결제 대기
  "completed",        // 승인 완료
  "failed",           // 실패
  "cancelled",        // 취소
  "refunded",         // 환불
  "pending_hyosung",  // ★ M-4: 효성 CMS+ 신청 의향 (외부 사이트 이동 전 기록)
  "pending_bank"      // ★ M-4: 직접 계좌이체 대기 (관리자 입금 확인 전)
]);

export const supportCategoryEnum = pgEnum("support_category", [
  "counseling",  // 심리상담
  "legal",       // 법률자문
  "scholarship", // 장학사업
  "other"        // 기타
]);

export const supportStatusEnum = pgEnum("support_status", [
  "submitted",   // 접수
  "reviewing",   // 서류 검토
  "supplement",  // 보완 요청
  "matched",     // 매칭 완료
  "in_progress", // 진행 중
  "completed",   // 완료
  "rejected"     // 반려
]);

export const noticeCategoryEnum = pgEnum("notice_category", [
  "general", // 일반공지
  "member",  // 회원공지
  "event",   // 사업/행사
  "media"    // 언론보도
]);

/* =========================================================
   1. members — 회원
   ========================================================= */
export const members = pgTable("members", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 100 }).unique().notNull(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  name: varchar("name", { length: 50 }).notNull(),
  phone: varchar("phone", { length: 20 }),
  type: memberTypeEnum("type").default("regular").notNull(),
  status: memberStatusEnum("status").default("active").notNull(),

  /* ───────── ★ STEP F-1 운영자 시스템 ───────── */
  role: varchar("role", { length: 20 }),                          // 'super_admin' | 'operator' | null
  notifyOnSupport: boolean("notify_on_support").default(false),   // 지원 신청 알림 수신 여부
  operatorActive: boolean("operator_active").default(true),       // 운영자 활성 상태

  // 보안 / 인증
  emailVerified: boolean("email_verified").default(false),
  loginFailCount: integer("login_fail_count").default(0),
  lockedUntil: timestamp("locked_until"),
  lastLoginAt: timestamp("last_login_at"),
  lastLoginIp: varchar("last_login_ip", { length: 45 }),

  // 알림 동의
  agreeEmail: boolean("agree_email").default(true),
  agreeSms: boolean("agree_sms").default(true),
  agreeMail: boolean("agree_mail").default(false),

  /* ───────── ★ K-2: 회원 탈퇴 추적 (NEW) ───────── */
  withdrawnAt: timestamp("withdrawn_at"),                         // 탈퇴 시점
  withdrawnReason: varchar("withdrawn_reason", { length: 500 }),  // 탈퇴 사유 (선택)

  // 메타
  memo: text("memo"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  emailIdx: index("members_email_idx").on(t.email),
  typeIdx: index("members_type_idx").on(t.type),
  statusIdx: index("members_status_idx").on(t.status),
  roleIdx: index("members_role_idx").on(t.role),
}));

/* =========================================================
   2. donations — 기부 내역
   ========================================================= */
export const donations = pgTable("donations", {
  id: serial("id").primaryKey(),

  // 회원이 아닌 비회원 후원도 가능 → memberId nullable
  memberId: integer("member_id").references(() => members.id, { onDelete: "set null" }),

  // 비회원 또는 회원의 정보 스냅샷
  donorName: varchar("donor_name", { length: 50 }).notNull(),
  donorPhone: varchar("donor_phone", { length: 20 }),
  donorEmail: varchar("donor_email", { length: 100 }),

  amount: integer("amount").notNull(),
  type: donationTypeEnum("type").notNull(),
  payMethod: varchar("pay_method", { length: 20 }).notNull(), // cms/card/bank
  status: donationStatusEnum("status").default("pending").notNull(),

  // 결제 / PG사 정보
  transactionId: varchar("transaction_id", { length: 100 }),
  pgProvider: varchar("pg_provider", { length: 30 }),

  // 영수증
  receiptRequested: boolean("receipt_requested").default(false),
  receiptIssued: boolean("receipt_issued").default(false),
  receiptIssuedAt: timestamp("receipt_issued_at"),
  receiptNumber: varchar("receipt_number", { length: 30 }).unique(), // ★ STEP H-2a 신규 (예: TBFA-2026-000042)

  // 캠페인 연결 (선택)
  campaignTag: varchar("campaign_tag", { length: 50 }),

  // 익명 여부
  isAnonymous: boolean("is_anonymous").default(false),

  /* ───────── ★ Phase L: 토스페이먼츠 결제 추적 ─────────
     - tossPaymentKey: 토스가 발급한 결제 키 (paymentKey)
     - tossOrderId: 우리가 생성한 주문번호 (TOSS-YYYY-MMxxxx)
     - billingKeyId: 정기결제 시 사용한 billing_keys.id 참조
     - failureReason: 결제 실패 시 사유 (토스 응답 message)
     ────────────────────────────────────────────────────────── */
  tossPaymentKey: varchar("toss_payment_key", { length: 200 }),
  tossOrderId: varchar("toss_order_id", { length: 64 }),
  billingKeyId: integer("billing_key_id"),
  failureReason: varchar("failure_reason", { length: 500 }),

  /* ───────── ★ Phase L-9: 효성 CMS+ 연동 매칭 키 (NEW) ─────────
     역할 분담 모델: 효성 = 결제/청구 마스터, 사이렌 = 회원/UI 마스터
     공유 키: 효성 회원번호로 billing_update.csv와 우리 DB 매칭

     - hyosungMemberNo: 효성 CMS+ 자동 부여 회원번호 (예: 60)
       * 관리자가 효성 등록 후 L-8 완료처리 모달에서 수동 입력
       * billing_update.csv의 '회원번호' 컬럼과 매칭 (문자열 '00000060' → 60)
     - hyosungContractNo: 효성 계약번호 (대부분 '001')
       * 한 회원이 여러 계약을 가질 경우 대비 (현재는 1:1)
     - hyosungBillNo: 효성 청구번호 (예: '0000000213274690')
       * 월별 청구에 1:1 매칭되는 고유키
       * billing_update.csv 업로드 시 중복 처리 방지용
     ────────────────────────────────────────────────────────── */
  hyosungMemberNo: integer("hyosung_member_no"),
  hyosungContractNo: varchar("hyosung_contract_no", { length: 20 }),
  hyosungBillNo: varchar("hyosung_bill_no", { length: 30 }),

  /* ─────── ★ M-4: 직접 계좌이체 관련 (NEW) ─────── */
  bankDepositorName: varchar("bank_depositor_name", { length: 50 }),  // 입금자명
  depositExpectedAt: timestamp("deposit_expected_at"),                // 입금 예정일 (선택)

  memo: text("memo"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  memberIdx: index("donations_member_idx").on(t.memberId),
  statusIdx: index("donations_status_idx").on(t.status),
  createdIdx: index("donations_created_idx").on(t.createdAt),
  receiptNoIdx: index("donations_receipt_no_idx").on(t.receiptNumber), // ★ STEP H-2a 신규
  /* ★ Phase L: 토스 결제 검색용 인덱스 */
  tossPaymentKeyIdx: index("donations_toss_payment_key_idx").on(t.tossPaymentKey),
  tossOrderIdIdx: index("donations_toss_order_id_idx").on(t.tossOrderId),
  billingKeyIdx: index("donations_billing_key_idx").on(t.billingKeyId),
  /* ★ Phase L-9: 효성 매칭 인덱스 (billing_update CSV 고속 처리) */
  hyosungMemberNoIdx: index("donations_hyosung_member_no_idx").on(t.hyosungMemberNo),
  hyosungBillNoIdx: index("donations_hyosung_bill_no_idx").on(t.hyosungBillNo),
}));

/* =========================================================
   3. support_requests — 유가족 지원 신청
   ========================================================= */
export const supportRequests = pgTable("support_requests", {
  id: serial("id").primaryKey(),
  requestNo: varchar("request_no", { length: 30 }).unique().notNull(), // S-2026-0413

  memberId: integer("member_id").references(() => members.id, { onDelete: "cascade" }).notNull(),

  category: supportCategoryEnum("category").notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  content: text("content").notNull(),

  // 첨부 파일 (Netlify Blobs key)
  attachments: text("attachments"), // JSON 배열 형태로 저장

  status: supportStatusEnum("status").default("submitted").notNull(),

  // 매칭된 전문가 / 봉사자
  assignedMemberId: integer("assigned_member_id").references(() => members.id, { onDelete: "set null" }),
  assignedExpertName: varchar("assigned_expert_name", { length: 50 }),
  assignedAt: timestamp("assigned_at"),

  // 관리자 메모
  adminNote: text("admin_note"),
  supplementNote: text("supplement_note"),

  // 완료 보고서
  reportContent: text("report_content"),
  completedAt: timestamp("completed_at"),

  /* ───────── ★ STEP E-1 신규 컬럼 (4개) ───────── */
  answeredBy: integer("answered_by").references(() => members.id, { onDelete: "set null" }),
  answeredAt: timestamp("answered_at"),
  priority: varchar("priority", { length: 10 }),       // 'urgent' | 'normal' | 'low'
  priorityReason: text("priority_reason"),             // AI 판단 근거 요약

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  memberIdx: index("support_member_idx").on(t.memberId),
  statusIdx: index("support_status_idx").on(t.status),
  categoryIdx: index("support_category_idx").on(t.category),
  requestNoIdx: index("support_request_no_idx").on(t.requestNo),
  priorityIdx: index("support_priority_idx").on(t.priority),
}));

/* =========================================================
   4. notices — 공지사항
   ========================================================= */
export const notices = pgTable("notices", {
  id: serial("id").primaryKey(),
  category: noticeCategoryEnum("category").default("general").notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  content: text("content").notNull(),

  // 작성자
  authorId: integer("author_id").references(() => members.id, { onDelete: "set null" }),
  authorName: varchar("author_name", { length: 50 }).default("관리자"),

  // 표시 옵션
  isPinned: boolean("is_pinned").default(false),
  isPublished: boolean("is_published").default(true),

  // 통계
  views: integer("views").default(0),

  // SEO / 메타
  thumbnailUrl: varchar("thumbnail_url", { length: 500 }),
  excerpt: varchar("excerpt", { length: 300 }),

  publishedAt: timestamp("published_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  categoryIdx: index("notices_category_idx").on(t.category),
  pinnedIdx: index("notices_pinned_idx").on(t.isPinned),
  publishedIdx: index("notices_published_idx").on(t.isPublished),
  createdIdx: index("notices_created_idx").on(t.createdAt),
}));

/* =========================================================
   5. faqs — 자주 묻는 질문
   ========================================================= */
export const faqs = pgTable("faqs", {
  id: serial("id").primaryKey(),
  category: varchar("category", { length: 30 }).default("general"),
  question: varchar("question", { length: 300 }).notNull(),
  answer: text("answer").notNull(),
  sortOrder: integer("sort_order").default(0),
  isActive: boolean("is_active").default(true),
  views: integer("views").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  categoryIdx: index("faqs_category_idx").on(t.category),
  sortIdx: index("faqs_sort_idx").on(t.sortOrder),
}));

/* =========================================================
   ★ G-1: 채팅 시스템 (4 테이블)
   ========================================================= */

/* 7. chat_rooms — 채팅방 */
export const chatRooms = pgTable("chat_rooms", {
  id: serial("id").primaryKey(),
  memberId: integer("member_id").references(() => members.id, { onDelete: "cascade" }).notNull(),

  category: varchar("category", { length: 30 }).default("support_other").notNull(),
  // support_donation / support_homepage / support_signup / support_other
  title: varchar("title", { length: 200 }),
  status: varchar("status", { length: 20 }).default("active").notNull(),
  // active / closed / archived

  lastMessageAt: timestamp("last_message_at").defaultNow(),
  lastMessagePreview: varchar("last_message_preview", { length: 200 }),

  unreadForAdmin: integer("unread_for_admin").default(0),
  unreadForUser: integer("unread_for_user").default(0),

  adminMemo: text("admin_memo"),

  closedAt: timestamp("closed_at"),
  closedBy: integer("closed_by").references(() => members.id, { onDelete: "set null" }),
  archivedAt: timestamp("archived_at"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  memberIdx: index("chat_rooms_member_idx").on(t.memberId),
  statusIdx: index("chat_rooms_status_idx").on(t.status),
  lastMsgIdx: index("chat_rooms_last_msg_idx").on(t.lastMessageAt),
}));

/* 8. chat_messages — 메시지 */
export const chatMessages = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  roomId: integer("room_id").references(() => chatRooms.id, { onDelete: "cascade" }).notNull(),

  senderId: integer("sender_id").references(() => members.id, { onDelete: "set null" }).notNull(),
  senderRole: varchar("sender_role", { length: 20 }).default("user").notNull(),
  // user / admin / system

  messageType: varchar("message_type", { length: 20 }).default("text").notNull(),
  // text / image / system_notice

  content: text("content"),
  attachmentId: integer("attachment_id"),

  isRead: boolean("is_read").default(false),
  readAt: timestamp("read_at"),

  isSystem: boolean("is_system").default(false),

  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  roomIdx: index("chat_messages_room_idx").on(t.roomId, t.createdAt),
  senderIdx: index("chat_messages_sender_idx").on(t.senderId),
}));

/* 9. chat_attachments — 첨부파일 */
export const chatAttachments = pgTable("chat_attachments", {
  id: serial("id").primaryKey(),
  roomId: integer("room_id").references(() => chatRooms.id, { onDelete: "cascade" }).notNull(),
  uploaderId: integer("uploader_id").references(() => members.id, { onDelete: "set null" }),

  blobKey: varchar("blob_key", { length: 255 }).notNull(),
  originalName: varchar("original_name", { length: 255 }),
  mimeType: varchar("mime_type", { length: 100 }),
  fileSize: integer("file_size"),

  thumbnailKey: varchar("thumbnail_key", { length: 255 }),
  width: integer("width"),
  height: integer("height"),

  expiresAt: timestamp("expires_at"), // 1년 후 자동 정리

  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  roomIdx: index("chat_attachments_room_idx").on(t.roomId),
  expiresIdx: index("chat_attachments_expires_idx").on(t.expiresAt),
}));

/* 10. chat_blacklist — 블랙리스트 */
export const chatBlacklist = pgTable("chat_blacklist", {
  id: serial("id").primaryKey(),
  memberId: integer("member_id").references(() => members.id, { onDelete: "cascade" }).notNull().unique(),

  reason: text("reason").notNull(),
  blockedBy: integer("blocked_by").references(() => members.id, { onDelete: "set null" }).notNull(),
  blockedAt: timestamp("blocked_at").defaultNow().notNull(),

  unblockedAt: timestamp("unblocked_at"),
  unblockedBy: integer("unblocked_by").references(() => members.id, { onDelete: "set null" }),

  isActive: boolean("is_active").default(true),
}, (t) => ({
  memberIdx: index("chat_blacklist_member_idx").on(t.memberId),
  activeIdx: index("chat_blacklist_active_idx").on(t.isActive),
}));

/* =========================================================
   ★ STEP H-2d: 영수증 설정 (단일 진실 원천)
   - 행은 항상 1개만 유지 (id=1 고정)
   - admin.html (사이렌 백오피스) + cms-tbfa.html (교유협 CMS) 양쪽에서 공유
   ========================================================= */
export const receiptSettings = pgTable("receipt_settings", {
  id: serial("id").primaryKey(),

  // 협회 정보 (PDF에 표시되는 5가지)
  orgName: varchar("org_name", { length: 100 }),
  orgRegistrationNo: varchar("org_registration_no", { length: 50 }),
  orgRepresentative: varchar("org_representative", { length: 50 }),
  orgAddress: varchar("org_address", { length: 255 }),
  orgPhone: varchar("org_phone", { length: 50 }),

  // 영수증 양식 텍스트 (커스터마이징 가능)
  title: varchar("title", { length: 100 }),                  // "기 부 금  영 수 증"
  subtitle: varchar("subtitle", { length: 200 }),            // "(소득세법 시행규칙 ...)"
  proofText: varchar("proof_text", { length: 200 }),         // "위와 같이 기부금을 기부하였음을 증명합니다."
  donationTypeLabel: varchar("donation_type_label", { length: 50 }), // "지정기부금"
  footerNotes: text("footer_notes"),                         // JSON 배열 ["• ...", "• ...", "• ..."]

  // 메타
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  updatedBy: integer("updated_by").references(() => members.id, { onDelete: "set null" }),
});


/* =========================================================
   6. audit_logs — 감사 로그 (보안 추적)
   ========================================================= */
export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => members.id, { onDelete: "set null" }),
  userType: varchar("user_type", { length: 20 }), // admin/user/system
  userName: varchar("user_name", { length: 50 }),

  action: varchar("action", { length: 100 }).notNull(),    // login/donate/update_member 등
  target: varchar("target", { length: 100 }),              // 대상 (회원ID, 신청번호 등)
  detail: text("detail"),                                  // 상세 내용 (JSON 가능)

  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: varchar("user_agent", { length: 500 }),

  success: boolean("success").default(true),
  errorMessage: text("error_message"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  userIdx: index("audit_user_idx").on(t.userId),
  actionIdx: index("audit_action_idx").on(t.action),
  createdIdx: index("audit_created_idx").on(t.createdAt),
}));

/* =========================================================
   ★ K-1: 비밀번호 재설정 토큰
   - rawToken은 메일에만 노출, DB에는 SHA-256 해시만 저장
   - 30분 유효 / 1회 사용 / 회원당 1시간에 3개 제한
   ========================================================= */
export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: serial("id").primaryKey(),
  memberId: integer("member_id")
    .references(() => members.id, { onDelete: "cascade" })
    .notNull(),

  // SHA-256(rawToken) — 64자 hex
  tokenHash: varchar("token_hash", { length: 255 }).notNull().unique(),

  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),

  // 보안 추적
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: varchar("user_agent", { length: 500 }),

  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  memberIdx: index("prt_member_idx").on(t.memberId),
  tokenIdx: index("prt_token_idx").on(t.tokenHash),
  expiresIdx: index("prt_expires_idx").on(t.expiresAt),
}));

/* =========================================================
   ★ K-2: 이메일 인증 토큰 (NEW)
   - 가입 직후 자동 발송, 또는 사용자 요청 시 재발송
   - 24시간 유효 / 1회 사용
   - 회원당 1시간에 5개 제한 (Rate Limit)
   - 인증 완료 시 members.emailVerified = true
   ========================================================= */
export const emailVerificationTokens = pgTable("email_verification_tokens", {
  id: serial("id").primaryKey(),
  memberId: integer("member_id")
    .references(() => members.id, { onDelete: "cascade" })
    .notNull(),

  // SHA-256(rawToken) — 64자 hex
  tokenHash: varchar("token_hash", { length: 255 }).notNull().unique(),

  // 인증 대상 이메일 (회원 이메일과 동일하지만 변경 시 추적용)
  email: varchar("email", { length: 100 }).notNull(),

  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),

  // 보안 추적
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: varchar("user_agent", { length: 500 }),

  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  memberIdx: index("evt_member_idx").on(t.memberId),
  tokenIdx: index("evt_token_idx").on(t.tokenHash),
  expiresIdx: index("evt_expires_idx").on(t.expiresAt),
}));

/* =========================================================
   ★ Phase L: 토스페이먼츠 빌링키 (정기 결제용)
   - 회원이 카드 1회 등록 시 토스가 빌링키 발급
   - 매월 cron이 빌링키로 자동 결제 호출
   - 회원이 해지 시 isActive=false + deactivatedAt 기록
   - billingKey는 토스 측에서 발급한 영구 키 (재사용)
   - customerKey는 우리가 생성한 고유 식별자 (회원당 1개)
   ========================================================= */
export const billingKeys = pgTable("billing_keys", {
  id: serial("id").primaryKey(),
  memberId: integer("member_id")
    .references(() => members.id, { onDelete: "cascade" })
    .notNull(),

  // 토스 빌링키 정보
  billingKey: varchar("billing_key", { length: 200 }).notNull().unique(),  // 토스 발급
  customerKey: varchar("customer_key", { length: 64 }).notNull().unique(), // 우리 생성

  // 카드 정보 (마스킹 — PCI-DSS 준수)
  cardCompany: varchar("card_company", { length: 30 }),                    // "현대카드" 등
  cardNumberMasked: varchar("card_number_masked", { length: 30 }),         // "****-****-****-1234"
  cardType: varchar("card_type", { length: 20 }),                          // "신용" / "체크"

  // 정기 결제 설정
  amount: integer("amount").notNull(),                                     // 월 결제 금액
  isActive: boolean("is_active").default(true).notNull(),                  // 활성/해지 여부
  nextChargeAt: timestamp("next_charge_at"),                               // 다음 결제 예정일 (cron 기준)
  lastChargedAt: timestamp("last_charged_at"),                             // 마지막 결제 시점

  // 실패 추적 (연속 3회 실패 시 자동 비활성화)
  consecutiveFailCount: integer("consecutive_fail_count").default(0),
  lastFailureReason: varchar("last_failure_reason", { length: 500 }),

  // 해지 정보
  deactivatedAt: timestamp("deactivated_at"),
  deactivatedReason: varchar("deactivated_reason", { length: 200 }),       // 'user_canceled' / 'card_expired' / 'too_many_fails'

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  memberIdx: index("billing_keys_member_idx").on(t.memberId),
  activeIdx: index("billing_keys_active_idx").on(t.isActive),
  nextChargeIdx: index("billing_keys_next_charge_idx").on(t.nextChargeAt),
  customerKeyIdx: index("billing_keys_customer_key_idx").on(t.customerKey),
}));

/* =========================================================
   ★ Phase L-9: 효성 CMS+ Import 이력 (NEW)
   - billing_update.csv 업로드 기록
   - 한 번 업로드된 청구번호는 중복 처리 방지 (멱등성)
   - 감사 추적 (누가/언제/몇 건 처리)
   ========================================================= */
export const hyosungImportLogs = pgTable("hyosung_import_logs", {
  id: serial("id").primaryKey(),

  // 업로드한 관리자
  uploadedBy: integer("uploaded_by").references(() => members.id, { onDelete: "set null" }),
  uploadedByName: varchar("uploaded_by_name", { length: 50 }),

  // 파일 정보
  fileName: varchar("file_name", { length: 255 }),
  fileSize: integer("file_size"),

  // 처리 결과
  totalRows: integer("total_rows").default(0),
  matchedCount: integer("matched_count").default(0),      // 효성 회원번호 매칭 성공
  createdCount: integer("created_count").default(0),      // 새 donations 생성
  updatedCount: integer("updated_count").default(0),      // 기존 donations 업데이트
  skippedCount: integer("skipped_count").default(0),      // 중복 청구번호 등 스킵
  failedCount: integer("failed_count").default(0),        // 매칭 실패

  // 상세 (JSON: 매칭 실패 행 목록, 에러 등)
  detail: text("detail"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  uploadedByIdx: index("hyosung_import_logs_uploaded_by_idx").on(t.uploadedBy),
  createdIdx: index("hyosung_import_logs_created_idx").on(t.createdAt),
}));

/* =========================================================
   ★ Phase M-3: notifications — 통합 알림 (NEW)
   - recipientType으로 사용자/관리자/운영자 구분
   - severity='critical'은 알림 외에 토스트/모달 처리
   - 90일 후 expires_at으로 자동 정리
   ========================================================= */
export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),

  // 수신자 (member.id)
  recipientId: integer("recipient_id").references(() => members.id, { onDelete: "cascade" }).notNull(),
  recipientType: varchar("recipient_type", { length: 20 }).default("user").notNull(),
  // 'user' | 'admin' | 'operator'

  // 분류
  category: varchar("category", { length: 30 }).notNull(),
  // 'support' | 'donation' | 'chat' | 'audit' | 'system' | 'billing' | 'member'
  severity: varchar("severity", { length: 20 }).default("info").notNull(),
  // 'info' | 'warning' | 'critical'

  // 본문
  title: varchar("title", { length: 200 }).notNull(),
  message: varchar("message", { length: 500 }),
  link: varchar("link", { length: 500 }),  // 클릭 시 이동할 경로

  // 참조 (선택)
  refTable: varchar("ref_table", { length: 50 }),
  refId: integer("ref_id"),

  // 읽음 처리
  isRead: boolean("is_read").default(false),
  readAt: timestamp("read_at"),

  // 생성/만료
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"),
}, (t) => ({
  recipientIdx: index("notifications_recipient_idx").on(t.recipientId, t.isRead, t.createdAt),
  categoryIdx: index("notifications_category_idx").on(t.category),
  severityIdx: index("notifications_severity_idx").on(t.severity),
  expiresIdx: index("notifications_expires_idx").on(t.expiresAt),
}));

/* =========================================================
   ★ Phase M-4: donation_policies — 후원 정책 (단일 행, id=1)
   - 모달의 금액 버튼/계좌번호/효성 URL 등 관리자가 어드민에서 관리
   - M-15 (후원정책 관리) 에서 PATCH UI 구현
   - M-4에서는 GET만 제공하고 기본값 시드
   ========================================================= */
export const donationPolicies = pgTable("donation_policies", {
  id: serial("id").primaryKey(),

  // 금액 옵션 (JSON 배열: [10000, 30000, ...])
  regularAmounts: text("regular_amounts"),    // JSON
  onetimeAmounts: text("onetime_amounts"),    // JSON

  // 직접 계좌이체 정보
  bankName: varchar("bank_name", { length: 50 }),
  bankAccountNo: varchar("bank_account_no", { length: 50 }),
  bankAccountHolder: varchar("bank_account_holder", { length: 50 }),
  bankGuideText: text("bank_guide_text"),

  // 효성 CMS+ 정보
  hyosungUrl: varchar("hyosung_url", { length: 500 }),
  hyosungGuideText: text("hyosung_guide_text"),

  // 모달 커스터마이징
  modalTitle: varchar("modal_title", { length: 200 }),
  modalSubtitle: varchar("modal_subtitle", { length: 500 }),

  // 메타
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  updatedBy: integer("updated_by").references(() => members.id, { onDelete: "set null" }),
});

/* =========================================================
   ★ Phase M-5: 사건 카테고리 / 제보 상태 ENUM
   ========================================================= */
export const incidentCategoryEnum = pgEnum("incident_category", [
  "school",  // 학교 내 사건
  "public",  // 공공/사회적 사건
  "other"    // 기타
]);

export const incidentReportStatusEnum = pgEnum("incident_report_status", [
  "submitted",   // 접수 (AI 분석 전)
  "ai_analyzed", // AI 분석 완료, 사용자 확인 대기
  "reviewing",   // 관리자 검토 중 (정식 접수 후)
  "responded",   // 답변 완료
  "closed",      // 종결
  "rejected"     // 반려/스팸
]);

/* =========================================================
   ★ Phase M-5: incidents — 사건 마스터
   - 관리자가 M-11 콘텐츠 관리에서 추가/수정 (현 단계는 시드 2건)
   - 슬러그 기반 URL: /incident.html?slug=seoyicho-2023
   ========================================================= */
export const incidents = pgTable("incidents", {
  id: serial("id").primaryKey(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  title: varchar("title", { length: 200 }).notNull(),
  summary: varchar("summary", { length: 500 }),
  contentHtml: text("content_html"),                    // Toast UI Editor 결과
  thumbnailBlobId: integer("thumbnail_blob_id"),        // blob_uploads.id 참조
  occurredAt: timestamp("occurred_at"),
  location: varchar("location", { length: 200 }),
  category: incidentCategoryEnum("category").default("school").notNull(),
  status: varchar("status", { length: 20 }).default("active").notNull(), // active/archived
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  slugIdx: index("incidents_slug_idx").on(t.slug),
  statusIdx: index("incidents_status_idx").on(t.status),
  sortIdx: index("incidents_sort_idx").on(t.sortOrder),
}));

/* =========================================================
   ★ Phase M-5: incident_reports — 사용자 제보
   - 로그인 필수 (A안)
   - AI 분석 후 사용자가 사이렌 정식 접수 여부 결정 (B안)
   ========================================================= */
export const incidentReports = pgTable("incident_reports", {
  id: serial("id").primaryKey(),
  reportNo: varchar("report_no", { length: 30 }).notNull().unique(), // R-2026-0001

  incidentId: integer("incident_id").references(() => incidents.id, { onDelete: "set null" }),
  memberId: integer("member_id").references(() => members.id, { onDelete: "set null" }).notNull(),

  // 본문
  title: varchar("title", { length: 200 }).notNull(),
  contentHtml: text("content_html").notNull(),
  attachmentIds: text("attachment_ids"), // JSON 배열 [12, 34, ...]

  // 익명 / 신원
  isAnonymous: boolean("is_anonymous").default(false),
  reporterName: varchar("reporter_name", { length: 50 }),
  reporterPhone: varchar("reporter_phone", { length: 20 }),
  reporterEmail: varchar("reporter_email", { length: 100 }),

  // ★ AI 분석 결과 (자동 채움)
  aiSeverity: varchar("ai_severity", { length: 20 }),    // 'low' | 'medium' | 'high' | 'critical'
  aiSummary: text("ai_summary"),
  aiSuggestion: text("ai_suggestion"),
  aiAnalyzedAt: timestamp("ai_analyzed_at"),

  // ★ B안: 사이렌 정식 접수 여부 (AI 결과 본 후 사용자 결정)
  sirenReportRequested: boolean("siren_report_requested"), // null=미결정, true=접수, false=AI만
  sirenReportRequestedAt: timestamp("siren_report_requested_at"),

  // 상태/관리자
  status: incidentReportStatusEnum("status").default("submitted").notNull(),
  adminResponse: text("admin_response"),
  respondedBy: integer("responded_by").references(() => members.id, { onDelete: "set null" }),
  respondedAt: timestamp("responded_at"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  reportNoIdx: index("incident_reports_report_no_idx").on(t.reportNo),
  incidentIdx: index("incident_reports_incident_idx").on(t.incidentId),
  memberIdx: index("incident_reports_member_idx").on(t.memberId),
  statusIdx: index("incident_reports_status_idx").on(t.status),
  severityIdx: index("incident_reports_severity_idx").on(t.aiSeverity),
}));

/* =========================================================
   ★ Phase M-6: 악성민원 카테고리 / 신고 상태 ENUM
   ========================================================= */
export const harassmentCategoryEnum = pgEnum("harassment_category", [
  "parent",     // 학부모 민원
  "student",    // 학생 폭력/문제행동
  "admin",      // 관리자/상급자 부당 지시
  "colleague",  // 동료 갈등
  "other"       // 기타
]);

export const harassmentReportStatusEnum = pgEnum("harassment_report_status", [
  "submitted",   // 접수
  "ai_analyzed", // AI 분석 완료
  "reviewing",   // 관리자 검토 중 (정식 신고 후)
  "responded",   // 답변 완료
  "closed",     // 종결 (AI 답변만)
  "rejected"    // 반려
]);

/* =========================================================
   ★ Phase M-6: harassment_reports — 악성민원 신고
   - 사건 마스터 없이 사용자가 본인 경험을 신고
   - AI 분석: 분류/심각도/즉각대처/법적검토/심리지원
   ========================================================= */
export const harassmentReports = pgTable("harassment_reports", {
  id: serial("id").primaryKey(),
  reportNo: varchar("report_no", { length: 30 }).notNull().unique(), // H-2026-0001
  memberId: integer("member_id").references(() => members.id, { onDelete: "set null" }).notNull(),

  // 사용자 입력 카테고리
  category: harassmentCategoryEnum("category").default("parent").notNull(),

  // 발생 시기/빈도 (선택)
  occurredAt: timestamp("occurred_at"),
  frequency: varchar("frequency", { length: 30 }), // 'once' | 'recurring' | 'ongoing'

  // 본문
  title: varchar("title", { length: 200 }).notNull(),
  contentHtml: text("content_html").notNull(),
  attachmentIds: text("attachment_ids"), // JSON 배열

  // 익명/신원
  isAnonymous: boolean("is_anonymous").default(false),
  reporterName: varchar("reporter_name", { length: 50 }),
  reporterPhone: varchar("reporter_phone", { length: 20 }),
  reporterEmail: varchar("reporter_email", { length: 100 }),

  // ★ AI 분석 결과
  aiCategory: varchar("ai_category", { length: 30 }),       // AI가 재분류한 카테고리
  aiSeverity: varchar("ai_severity", { length: 20 }),       // low/medium/high/critical
  aiSummary: text("ai_summary"),
  aiImmediateAction: text("ai_immediate_action"),           // 즉각적 대처
  aiLegalReviewNeeded: boolean("ai_legal_review_needed"),
  aiLegalReason: text("ai_legal_reason"),
  aiPsychSupportNeeded: boolean("ai_psych_support_needed"),
  aiSuggestion: text("ai_suggestion"),                      // 종합 권장사항
  aiAnalyzedAt: timestamp("ai_analyzed_at"),

  // 사이렌 정식 신고 여부
  sirenReportRequested: boolean("siren_report_requested"),
  sirenReportRequestedAt: timestamp("siren_report_requested_at"),

  // 상태/관리자
  status: harassmentReportStatusEnum("status").default("submitted").notNull(),
  adminResponse: text("admin_response"),
  respondedBy: integer("responded_by").references(() => members.id, { onDelete: "set null" }),
  respondedAt: timestamp("responded_at"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  reportNoIdx: index("harassment_reports_report_no_idx").on(t.reportNo),
  memberIdx: index("harassment_reports_member_idx").on(t.memberId),
  statusIdx: index("harassment_reports_status_idx").on(t.status),
  severityIdx: index("harassment_reports_severity_idx").on(t.aiSeverity),
  categoryIdx: index("harassment_reports_category_idx").on(t.category),
}));

/* =========================================================
   ★ Phase M-1: blob_uploads — 공용 파일/이미지 업로드 마스터
   - Toast UI Editor 본문 이미지 + 일반 첨부파일 통합 관리
   - context로 사용처 구분 ('editor' | 'attachment' | 'profile' 등)
   - reference_table/reference_id로 사후 매칭 (게시글 저장 후 연결)
   - expires_at: 7일 내 미참조 파일 자동 정리 (M-3 cron 연동 예정)
   ========================================================= */
export const blobUploads = pgTable("blob_uploads", {
  id: serial("id").primaryKey(),
  blobKey: varchar("blob_key", { length: 255 }).notNull().unique(),
  originalName: varchar("original_name", { length: 500 }).notNull(),
  mimeType: varchar("mime_type", { length: 100 }).notNull(),
  sizeBytes: integer("size_bytes").notNull(),

  // 업로드 주체 (둘 중 하나)
  uploadedBy: integer("uploaded_by").references(() => members.id, { onDelete: "set null" }),
  uploadedByAdmin: integer("uploaded_by_admin"),

  // 사용처 분류
  context: varchar("context", { length: 50 }),

  // 참조 매칭 (게시글 저장 시 연결)
  referenceTable: varchar("reference_table", { length: 50 }),
  referenceId: integer("reference_id"),

  // 공개 여부 (false면 인증 필요)
    // 공개 여부 (false면 인증 필요)
  isPublic: boolean("is_public").default(true),

  /* ★ M-2.5: 저장소 분기 ('netlify' | 'r2')
     - 기존 데이터(채팅 등)는 'netlify' 유지
     - 신규 업로드는 모두 'r2' (Cloudflare R2 직접 업로드) */
  storageProvider: varchar("storage_provider", { length: 20 }).default("netlify").notNull(),

  /* ★ M-2.5: 업로드 상태 ('pending' | 'completed' | 'failed')
     - presign 후 R2에 업로드 전: pending
     - confirm 호출 시: completed */
  uploadStatus: varchar("upload_status", { length: 20 }).default("completed").notNull(),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"),
}, (t) => ({
  keyIdx: index("blob_uploads_key_idx").on(t.blobKey),
  refIdx: index("blob_uploads_ref_idx").on(t.referenceTable, t.referenceId),
  expiresIdx: index("blob_uploads_expires_idx").on(t.expiresAt),
}));

/* =========================================================
   타입 export (TypeScript 자동완성용)
   ========================================================= */
export type Member = typeof members.$inferSelect;
export type NewMember = typeof members.$inferInsert;
export type Donation = typeof donations.$inferSelect;
export type NewDonation = typeof donations.$inferInsert;
export type SupportRequest = typeof supportRequests.$inferSelect;
export type NewSupportRequest = typeof supportRequests.$inferInsert;
export type Notice = typeof notices.$inferSelect;
export type NewNotice = typeof notices.$inferInsert;
export type Faq = typeof faqs.$inferSelect;
export type NewFaq = typeof faqs.$inferInsert;
export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;

/* G-1: 채팅 시스템 타입 */
export type ChatRoom = typeof chatRooms.$inferSelect;
export type NewChatRoom = typeof chatRooms.$inferInsert;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type NewChatMessage = typeof chatMessages.$inferInsert;
export type ChatAttachment = typeof chatAttachments.$inferSelect;
export type NewChatAttachment = typeof chatAttachments.$inferInsert;
export type ChatBlacklist = typeof chatBlacklist.$inferSelect;
export type NewChatBlacklist = typeof chatBlacklist.$inferInsert;

/* H-2d: 영수증 설정 타입 */
export type ReceiptSettings = typeof receiptSettings.$inferSelect;
export type NewReceiptSettings = typeof receiptSettings.$inferInsert;

/* ★ K-1: 비밀번호 재설정 토큰 타입 */
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type NewPasswordResetToken = typeof passwordResetTokens.$inferInsert;

/* ★ K-2: 이메일 인증 토큰 타입 (NEW) */
export type EmailVerificationToken = typeof emailVerificationTokens.$inferSelect;
export type NewEmailVerificationToken = typeof emailVerificationTokens.$inferInsert;

/* ★ Phase L: 토스 빌링키 타입 */
export type BillingKey = typeof billingKeys.$inferSelect;
export type NewBillingKey = typeof billingKeys.$inferInsert;

/* ★ Phase L-9: 효성 Import 로그 타입 (NEW) */
export type HyosungImportLog = typeof hyosungImportLogs.$inferSelect;
export type NewHyosungImportLog = typeof hyosungImportLogs.$inferInsert;

/* ★ Phase M-1: blob_uploads 타입 (NEW) */
export type BlobUpload = typeof blobUploads.$inferSelect;
export type NewBlobUpload = typeof blobUploads.$inferInsert;

/* ★ M-3: 알림 타입 (NEW) */
export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;

/* ★ M-4: 후원 정책 타입 (NEW) */
export type DonationPolicy = typeof donationPolicies.$inferSelect;
export type NewDonationPolicy = typeof donationPolicies.$inferInsert;

/* ★ M-5: 사건 / 제보 타입 (NEW) */
export type Incident = typeof incidents.$inferSelect;
export type NewIncident = typeof incidents.$inferInsert;
export type IncidentReport = typeof incidentReports.$inferSelect;
export type NewIncidentReport = typeof incidentReports.$inferInsert;

/* ★ M-6: 악성민원 신고 타입 (NEW) */
export type HarassmentReport = typeof harassmentReports.$inferSelect;
export type NewHarassmentReport = typeof harassmentReports.$inferInsert;