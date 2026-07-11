// db/schema.ts — ★ M-19-11 V2: expertProfiles/expertTypeEnum/expertStatusEnum 제거
// (M-19-1 grade 시스템 유지, members.pendingExpertReview 컬럼 보존)
import {
  pgTable, serial, bigserial, varchar, integer, text, timestamp,
  boolean, index, uniqueIndex, pgEnum, jsonb, bigint, numeric, date, time
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/* =========================================================
   ENUM 타입
   ========================================================= */
export const memberTypeEnum = pgEnum("member_type", [
  "regular",
  "family",
  "volunteer",
  "admin"
]);

export const memberStatusEnum = pgEnum("member_status", [
  "pending",
  "active",
  "suspended",
  "withdrawn"
]);

export const donationTypeEnum = pgEnum("donation_type", [
  "regular",
  "onetime"
]);

export const donationStatusEnum = pgEnum("donation_status", [
  "pending",
  "completed",
  "failed",
  "cancelled",
  "refunded",
  "pending_hyosung",
  "pending_bank"
]);

export const supportCategoryEnum = pgEnum("support_category", [
  "counseling",
  "legal",
  "scholarship",
  "other"
]);

export const supportStatusEnum = pgEnum("support_status", [
  "submitted",
  "reviewing",
  "supplement",
  "matched",
  "in_progress",
  "completed",
  "rejected"
]);

export const noticeCategoryEnum = pgEnum("notice_category", [
  "general",
  "member",
  "event",
  "media"
]);

export const incidentCategoryEnum = pgEnum("incident_category", [
  "school",
  "public",
  "other"
]);

export const incidentReportStatusEnum = pgEnum("incident_report_status", [
  "submitted",
  "ai_analyzed",
  "reviewing",
  "responded",
  "closed",
  "rejected"
]);

export const harassmentCategoryEnum = pgEnum("harassment_category", [
  "parent",
  "student",
  "admin",
  "colleague",
  "other"
]);

export const harassmentReportStatusEnum = pgEnum("harassment_report_status", [
  "submitted",
  "ai_analyzed",
  "reviewing",
  "responded",
  "closed",
  "rejected"
]);

export const legalCategoryEnum = pgEnum("legal_category", [
  "school_dispute",
  "civil",
  "criminal",
  "family",
  "labor",
  "contract",
  "other"
]);

export const legalConsultationStatusEnum = pgEnum("legal_consultation_status", [
  "submitted",
  "ai_analyzed",
  "matching",
  "matched",
  "in_progress",
  "responded",
  "closed",
  "rejected"
]);

export const boardCategoryEnum = pgEnum("board_category", [
  "general",
  "share",
  "question",
  "info",
  "etc"
]);

export const activityCategoryEnum = pgEnum("activity_category", [
  "report",
  "photo",
  "news"
]);

export const mediaCategoryEnum = pgEnum("media_category", [
  "press",
  "photo",
  "event"
]);

export const campaignTypeEnum = pgEnum("campaign_type", [
  "fundraising",
  "memorial",
  "awareness"
]);

/* ★ M-19-8: 자료실 접근 권한 */
export const resourceAccessLevelEnum = pgEnum("resource_access_level", [
  "public",
  "members_only",
  "private",
]);

/* ★ M-19-7: 기념일 종류 */
export const anniversaryTypeEnum = pgEnum("anniversary_type", [
  "signup_1month",
  "signup_1year",
  "first_donation_1year",
  "donation_milestone",
  "regular_donation_6months",
  "regular_donation_1year",
]);

/* ★ M-19-11 V2: expertTypeEnum + expertStatusEnum 제거됨
   - DB에는 ENUM이 남아있을 수 있으나 schema.ts에서는 사용하지 않음
   - 추후 cleanup migration에서 DROP TYPE 실행 가능 */

/* =========================================================
   1. members — 회원 (★ M-19-1 grade 시스템 유지)
   ========================================================= */
export const members = pgTable("members", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 100 }).unique().notNull(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  name: varchar("name", { length: 50 }).notNull(),
  phone: varchar("phone", { length: 20 }),
  type: memberTypeEnum("type").default("regular").notNull(),
  status: memberStatusEnum("status").default("active").notNull(),

  /* ───────── ★ F-1 운영자 ───────── */
  role: varchar("role", { length: 20 }),
  notifyOnSupport: boolean("notify_on_support").default(false),
  /* ★ 2026-05-16 SECURITY: default true는 일반 회원 가입 기능 도입 전 옛 정책.
     일반 가입자도 자동으로 운영자 권한을 받아 관리자 모드 UI가 노출되던 결함.
     default false로 변경 + 옛 회원 일괄 정리 마이그레이션(migrate-fix-operator-active)
     로 운영 데이터 정정. */
  operatorActive: boolean("operator_active").default(false),
  /* ★ 연차 산정 정책(모드B 근속 계산용) — migrate-att-leave-policy 적용 2026-05-23.
     NULL이면 가입일(createdAt)을 입사일 대용으로 사용. */
  hireDate: date("hire_date"),

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

  /* ───────── ★ K-2: 탈퇴 추적 ───────── */
  withdrawnAt: timestamp("withdrawn_at"),
  withdrawnReason: varchar("withdrawn_reason", { length: 500 }),

  /* ───────── ★ 5순위 #1: 블랙 처리 통합 (status='suspended'와 함께 사용) ───────── */
  blacklistedAt: timestamp("blacklisted_at"),
  blacklistedBy: integer("blacklisted_by"),                                     // 처리한 운영자 members.id
  blacklistReason: text("blacklist_reason"),

  /* ───────── ★ M-12: 회원 4분류 + 가입경로 ───────── */
  memberCategory: varchar("member_category", { length: 20 }),
  memberSubtype: varchar("member_subtype", { length: 50 }),
  signupSourceId: integer("signup_source_id"),

  /* ───────── ★ M-15: 운영자 담당 카테고리 ───────── */
  assignedCategories: jsonb("assigned_categories").default(sql`'[]'::jsonb`),

  /* ───────── ★ M-19-11: 전문가 가입 검토 대기 플래그 (legacy 컬럼, V2에서 미사용) ───────── */
  pendingExpertReview: boolean("pending_expert_review").default(false),

  /* ───────── ★ M-19-11 V2: 전문가 증빙 시스템 ───────── */
  certificateBlobId: integer("certificate_blob_id"),
  certificateVerifiedAt: timestamp("certificate_verified_at"),
  certificateRejectedReason: text("certificate_rejected_reason"),
  certificateUploadedAt: timestamp("certificate_uploaded_at"),
  secondaryVerified: boolean("secondary_verified").default(false),
  secondaryVerifiedAt: timestamp("secondary_verified_at"),
  secondaryVerifiedBy: integer("secondary_verified_by"),

  /* ───────── ★ M-19-1: 회원 등급 시스템 ───────── */
  gradeId: integer("grade_id"),
  gradeAssignedAt: timestamp("grade_assigned_at"),
  gradeLocked: boolean("grade_locked").default(false),
  totalDonationAmount: integer("total_donation_amount").default(0),
  regularMonthsCount: integer("regular_months_count").default(0),

  /* ───────── ★ M-19-1: 후원자 이탈 예측 ───────── */
  churnRiskScore: integer("churn_risk_score").default(0),
  churnRiskLevel: varchar("churn_risk_level", { length: 20 }),
  churnLastEvaluatedAt: timestamp("churn_last_evaluated_at"),
  churnSignals: jsonb("churn_signals").default(sql`'[]'::jsonb`),
  lastReengageEmailAt: timestamp("last_reengage_email_at"),

  /* ───────── ★ 효성 CMS+ 연동 (Phase 1: 세션 2 DB 동기화) ───────── */
  hyosungMemberNo: integer("hyosung_member_no"),
  hyosungContractStatus: varchar("hyosung_contract_status", { length: 20 }),
  hyosungPaymentMethod: varchar("hyosung_payment_method", { length: 30 }),
  hyosungPaymentTool: varchar("hyosung_payment_tool", { length: 20 }),
  hyosungBankInfo: varchar("hyosung_bank_info", { length: 100 }),
  hyosungPromiseDay: integer("hyosung_promise_day"),
  hyosungSyncedAt: timestamp("hyosung_synced_at"),

  /* ───────── ★ 토스 빌링 자동 청구 스케줄 (Phase 2) ───────── */
  nextBillingDate: timestamp("next_billing_date", { mode: "date" }),
  billingDay: integer("billing_day"),
  billingRetryCount: integer("billing_retry_count").default(0).notNull(),
  billingLastFailedAt: timestamp("billing_last_failed_at"),

  /* ───────── ★ 6순위 #6: 교원 회원 자격 (현직/은퇴/예비/일반) ───────── */
  eligibilityType: varchar("eligibility_type", { length: 30 }),

  /* ───────── ★ Phase 9-B: 알림 수신 채널 게이팅 (2026-05-10) ─────────
   * phoneVerifiedAt: SMS·알림톡 발송 가능 여부 (null = 미인증)
   * kakaoMarketingConsentAt: 광고성 알림톡 동의 시각 (정보통신망법)
   * 마이그레이션: migrate-phase9-notify-prefs (호출 후 삭제)
   */
  phoneVerifiedAt:         timestamp("phone_verified_at"),
  kakaoMarketingConsentAt: timestamp("kakao_marketing_consent_at"),

  /* ───────── ★ Phase 2 (마일스톤 #16 단계 C): 후원 회원 분류 ─────────
   * 마이그레이션: 5451547 (호출 후 삭제)
   * donor_type: 'regular' | 'prospect' | 'none' | NULL(미평가)
   * donor_channels: jsonb 배열 — ['toss'] | ['hyosung'] | ['toss','hyosung'] | []
   * prospect_subtype: 'onetime' | 'cancelled' | NULL
   * donor_evaluated_at: 마지막 평가 시각 (cron-donor-status-sync 또는 후크)
   */
  donorType: varchar("donor_type", { length: 20 }),
  donorChannels: jsonb("donor_channels").default(sql`'[]'::jsonb`),
  prospectSubtype: varchar("prospect_subtype", { length: 20 }),
  donorEvaluatedAt: timestamp("donor_evaluated_at"),
  /* 예비 후원자가 어떤 캠페인·이벤트로 들어왔는지 구분 (migrate-prospect-event-name) */
  prospectEventName: varchar("prospect_event_name", { length: 150 }),
  prospectEntryPath: varchar("prospect_entry_path", { length: 50 }),

  /* ───────── ★ Phase 17 — 보안·감사 고도화 ───────── */
  loginFailStreak: integer("login_fail_streak").default(0),

  /* ───────── ★ Phase 21 R2+R3 — 운영자 부재 토글 ─────────
   * outOfOffice: 현재 부재 여부 (마이그·쿼리 시점 계산으로도 가능)
   * outOfOfficeStart/End: 부재 예약 기간 (포함 ~ 포함)
   * outOfOfficeNote: "휴가/교육/병가" 등 사유 자유 메모
   */
  outOfOffice: boolean("out_of_office").default(false).notNull(),
  outOfOfficeStart: date("out_of_office_start"),
  outOfOfficeEnd: date("out_of_office_end"),
  outOfOfficeNote: text("out_of_office_note"),

  /* ───────── ★ Phase 21 R4 — WBS 기본 보기 모드 ─────────
   * 'board' | 'list' | 'calendar' (기본값 'board')
   * 운영자가 WBS 진입 시 자동 선택되는 보기 모드
   */
  defaultWbsView: varchar("default_wbs_view", { length: 20 }).default("board"),

  /* ───────── ★ Phase 24: 마일스톤 담당 역할 ─────────
   * SM(사무국장) | PM(정책국장) | SI(SI관리자) | NULL(미배정)
   * 마이그레이션: migrate-milestone-setup (완료)
   */
  milestoneRole: varchar("milestone_role", { length: 10 }),

  /* ───────── ★ R32-P0 C4: 기본연봉 (성과 결산 CSV용) ─────────
   * 마이그레이션: migrate-members-base-salary (완료 2026-05-19)
   * DEFAULT 0 NOT NULL — 실 운영 입력은 어드민 UI에서
   */
  baseSalary: numeric("base_salary", { precision: 15, scale: 2 }).default("0").notNull(),

  // 메타
  memo: text("memo"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  emailIdx: index("members_email_idx").on(t.email),
  typeIdx: index("members_type_idx").on(t.type),
  statusIdx: index("members_status_idx").on(t.status),
  roleIdx: index("members_role_idx").on(t.role),
  categoryIdx: index("members_category_idx").on(t.memberCategory),
  subtypeIdx: index("members_subtype_idx").on(t.memberSubtype),
  signupSourceIdx: index("members_signup_source_idx").on(t.signupSourceId),
  hyosungNoIdx: index("members_hyosung_no_idx").on(t.hyosungMemberNo),
  nextBillingIdx: index("idx_members_next_billing").on(t.nextBillingDate),
  /* Phase 2 */
  donorTypeIdx: index("members_donor_type_idx").on(t.donorType),
  prospectSubtypeIdx: index("members_prospect_subtype_idx").on(t.prospectSubtype),
}));

/* =========================================================
   ★ M-19-1: member_grades — 회원 등급 마스터
   ========================================================= */
export const memberGrades = pgTable("member_grades", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 30 }).notNull().unique(),
  nameKo: varchar("name_ko", { length: 50 }).notNull(),
  nameEn: varchar("name_en", { length: 50 }),
  icon: varchar("icon", { length: 10 }),
  colorHex: varchar("color_hex", { length: 10 }),
  description: text("description"),
  minTotalAmount: integer("min_total_amount").default(0),
  minRegularMonths: integer("min_regular_months").default(0),
  sortOrder: integer("sort_order").default(0),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  codeIdx: index("member_grades_code_idx").on(t.code),
  sortIdx: index("member_grades_sort_idx").on(t.sortOrder),
}));

/* =========================================================
   2. donations — 기부 내역 (★ M-19-2 campaignId 포함)
   ========================================================= */
export const donations = pgTable("donations", {
  id: serial("id").primaryKey(),
  memberId: integer("member_id").references(() => members.id, { onDelete: "set null" }),
  donorName: varchar("donor_name", { length: 50 }).notNull(),
  donorPhone: varchar("donor_phone", { length: 20 }),
  donorEmail: varchar("donor_email", { length: 100 }),
  amount: integer("amount").notNull(),
  type: donationTypeEnum("type").notNull(),
  payMethod: varchar("pay_method", { length: 20 }).notNull(),
  status: donationStatusEnum("status").default("pending").notNull(),
  transactionId: varchar("transaction_id", { length: 100 }),
  pgProvider: varchar("pg_provider", { length: 30 }),
  receiptRequested: boolean("receipt_requested").default(false),
  receiptIssued: boolean("receipt_issued").default(false),
  receiptIssuedAt: timestamp("receipt_issued_at"),
  receiptNumber: varchar("receipt_number", { length: 30 }).unique(),
  campaignTag: varchar("campaign_tag", { length: 50 }),

  /* ★ M-19-2: 정규화된 캠페인 참조 */
  campaignId: integer("campaign_id"),

  isAnonymous: boolean("is_anonymous").default(false),

  /* PG (KICC) — R40: 토스→KICC 전면 교체로 PG 비종속 네이밍 */
  pgTid: varchar("pg_tid", { length: 200 }),
  pgOrderNo: varchar("pg_order_no", { length: 64 }),
  billingKeyId: integer("billing_key_id"),
  failureReason: varchar("failure_reason", { length: 500 }),

  /* 효성 */
  hyosungMemberNo: integer("hyosung_member_no"),
  hyosungContractNo: varchar("hyosung_contract_no", { length: 20 }),
  hyosungBillNo: varchar("hyosung_bill_no", { length: 30 }),

  /* ★ 효성 CMS+ 상세 연결 (Phase 1: 세션 2 DB 동기화) */
  hyosungBillingId: integer("hyosung_billing_id"),
  hyosungBillingMonth: varchar("hyosung_billing_month", { length: 10 }),
  hyosungReceiptStatus: varchar("hyosung_receipt_status", { length: 20 }),
  hyosungPaidDate: timestamp("hyosung_paid_date", { mode: "date" }),

  /* ★ 토스 자동 빌링 이력 연결 (Phase 2) */
  billingLogId: integer("billing_log_id"),

  /* M-4 계좌이체 */
  bankDepositorName: varchar("bank_depositor_name", { length: 50 }),
  depositExpectedAt: timestamp("deposit_expected_at"),

  /* M-14 영수증 캐시 */
  receiptBlobId: integer("receipt_blob_id"),

  memo: text("memo"),
  /* === 라운드3 CMS: 재정 기준일 통일 === */
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  memberIdx: index("donations_member_idx").on(t.memberId),
  statusIdx: index("donations_status_idx").on(t.status),
  createdIdx: index("donations_created_idx").on(t.createdAt),
  paidAtIdx: index("donations_paid_at_idx").on(t.paidAt),
  receiptNoIdx: index("donations_receipt_no_idx").on(t.receiptNumber),
  pgTidIdx: index("donations_pg_tid_idx").on(t.pgTid),
  pgOrderNoIdx: index("donations_pg_order_no_idx").on(t.pgOrderNo),
  billingKeyIdx: index("donations_billing_key_idx").on(t.billingKeyId),
  hyosungMemberNoIdx: index("donations_hyosung_member_no_idx").on(t.hyosungMemberNo),
  hyosungBillNoIdx: index("donations_hyosung_bill_no_idx").on(t.hyosungBillNo),
  hyosungBillingIdIdx: index("donations_hyosung_billing_id_idx").on(t.hyosungBillingId),
  hyosungBillingMonthIdx: index("donations_hyosung_billing_month_idx").on(t.hyosungBillingMonth),
  campaignIdIdx: index("donations_campaign_id_idx").on(t.campaignId),
}));

/* =========================================================
   3. support_requests
   ========================================================= */
export const supportRequests = pgTable("support_requests", {
  id: serial("id").primaryKey(),
  requestNo: varchar("request_no", { length: 30 }).unique().notNull(),
  memberId: integer("member_id").references(() => members.id, { onDelete: "cascade" }).notNull(),
  category: supportCategoryEnum("category").notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  content: text("content").notNull(),
  attachments: text("attachments"),
  status: supportStatusEnum("status").default("submitted").notNull(),
  assignedMemberId: integer("assigned_member_id").references(() => members.id, { onDelete: "set null" }),
  assignedExpertName: varchar("assigned_expert_name", { length: 50 }),
  assignedAt: timestamp("assigned_at"),
  adminNote: text("admin_note"),
  supplementNote: text("supplement_note"),
  reportContent: text("report_content"),
  completedAt: timestamp("completed_at"),
  answeredBy: integer("answered_by").references(() => members.id, { onDelete: "set null" }),
  answeredAt: timestamp("answered_at"),
  priority: varchar("priority", { length: 10 }),
  priorityReason: text("priority_reason"),

  /* ───────── ★ Phase 21 R2+R3 — 워크스페이스 연동 (assignedMemberId와 별개) ─────────
   * assignedAdminId: 운영자 풀에서 R&R 기반 자동 할당된 1차 담당자
   * 사용자/전문가 매칭은 기존 assignedMemberId가 그대로 담당
   */
  assignedAdminId: integer("assigned_admin_id").references(() => members.id, { onDelete: "set null" }),
  workspaceTaskId: integer("workspace_task_id"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  memberIdx: index("support_member_idx").on(t.memberId),
  statusIdx: index("support_status_idx").on(t.status),
  categoryIdx: index("support_category_idx").on(t.category),
  requestNoIdx: index("support_request_no_idx").on(t.requestNo),
  priorityIdx: index("support_priority_idx").on(t.priority),
  assignedAdminIdx: index("support_assigned_admin_idx").on(t.assignedAdminId),
}));

/* =========================================================
   4. notices
   ========================================================= */
export const notices = pgTable("notices", {
  id: serial("id").primaryKey(),
  category: noticeCategoryEnum("category").default("general").notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  content: text("content").notNull(),
  authorId: integer("author_id").references(() => members.id, { onDelete: "set null" }),
  authorName: varchar("author_name", { length: 50 }).default("관리자"),
  isPinned: boolean("is_pinned").default(false),
  isPublished: boolean("is_published").default(true),
  views: integer("views").default(0),
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
   5. faqs
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
   6~10. 채팅 시스템 (G-1)
   ========================================================= */
export const chatRooms = pgTable("chat_rooms", {
  id: serial("id").primaryKey(),
  memberId: integer("member_id").references(() => members.id, { onDelete: "cascade" }).notNull(),
  category: varchar("category", { length: 30 }).default("support_other").notNull(),
  title: varchar("title", { length: 200 }),
  status: varchar("status", { length: 20 }).default("active").notNull(),
  lastMessageAt: timestamp("last_message_at").defaultNow(),
  lastMessagePreview: varchar("last_message_preview", { length: 200 }),
  unreadForAdmin: integer("unread_for_admin").default(0),
  unreadForUser: integer("unread_for_user").default(0),
  adminMemo: text("admin_memo"),
  closedAt: timestamp("closed_at"),
  closedBy: integer("closed_by").references(() => members.id, { onDelete: "set null" }),
  archivedAt: timestamp("archived_at"),
  /* ★ 6순위 #8 (2026-05-10): 1:1 매칭 채팅 식별 */
  roomType: varchar("room_type", { length: 20 }).default("general").notNull(),
  expertId: integer("expert_id").references(() => members.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  memberIdx: index("chat_rooms_member_idx").on(t.memberId),
  statusIdx: index("chat_rooms_status_idx").on(t.status),
  lastMsgIdx: index("chat_rooms_last_msg_idx").on(t.lastMessageAt),
  roomTypeIdx: index("chat_rooms_room_type_idx").on(t.roomType),
  expertIdx: index("chat_rooms_expert_idx").on(t.expertId),
}));

export const chatMessages = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  roomId: integer("room_id").references(() => chatRooms.id, { onDelete: "cascade" }).notNull(),
  senderId: integer("sender_id").references(() => members.id, { onDelete: "set null" }).notNull(),
  senderRole: varchar("sender_role", { length: 20 }).default("user").notNull(),
  messageType: varchar("message_type", { length: 20 }).default("text").notNull(),
  content: text("content"),
  attachmentId: integer("attachment_id"),
  isRead: boolean("is_read").default(false),
  readAt: timestamp("read_at"),
  isSystem: boolean("is_system").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  editedAt:  timestamp("edited_at"),
  isDeleted: boolean("is_deleted").notNull().default(false),
  deletedAt: timestamp("deleted_at"),
}, (t) => ({
  roomIdx: index("chat_messages_room_idx").on(t.roomId, t.createdAt),
  senderIdx: index("chat_messages_sender_idx").on(t.senderId),
}));

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
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  roomIdx: index("chat_attachments_room_idx").on(t.roomId),
  expiresIdx: index("chat_attachments_expires_idx").on(t.expiresAt),
}));

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
   ★ STEP H-2d + M-14: 영수증 설정
   ========================================================= */
export const receiptSettings = pgTable("receipt_settings", {
  id: serial("id").primaryKey(),
  orgName: varchar("org_name", { length: 100 }),
  orgRegistrationNo: varchar("org_registration_no", { length: 50 }),
  orgRepresentative: varchar("org_representative", { length: 50 }),
  orgAddress: varchar("org_address", { length: 255 }),
  orgPhone: varchar("org_phone", { length: 50 }),
  title: varchar("title", { length: 100 }),
  subtitle: varchar("subtitle", { length: 200 }),
  proofText: varchar("proof_text", { length: 200 }),
  donationTypeLabel: varchar("donation_type_label", { length: 50 }),
  footerNotes: text("footer_notes"),
  /* ★ M-14: 직인 */
  stampBlobId: integer("stamp_blob_id"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  updatedBy: integer("updated_by").references(() => members.id, { onDelete: "set null" }),
});

/* =========================================================
   11. audit_logs
   ========================================================= */
export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => members.id, { onDelete: "set null" }),
  userType: varchar("user_type", { length: 20 }),
  userName: varchar("user_name", { length: 50 }),
  action: varchar("action", { length: 100 }).notNull(),
  target: varchar("target", { length: 100 }),
  detail: text("detail"),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: varchar("user_agent", { length: 500 }),
  success: boolean("success").default(true),
  errorMessage: text("error_message"),
  /* ───────── ★ Phase 17 — 보안·감사 고도화 ───────── */
  sessionId: varchar("session_id", { length: 128 }),
  riskLevel: varchar("risk_level", { length: 20 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  userIdx: index("audit_user_idx").on(t.userId),
  actionIdx: index("audit_action_idx").on(t.action),
  createdIdx: index("audit_created_idx").on(t.createdAt),
  riskIdx: index("audit_risk_idx").on(t.riskLevel),
}));

/* =========================================================
   ★ K-1: 비밀번호 재설정 토큰
   ========================================================= */
export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: serial("id").primaryKey(),
  memberId: integer("member_id").references(() => members.id, { onDelete: "cascade" }).notNull(),
  tokenHash: varchar("token_hash", { length: 255 }).notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: varchar("user_agent", { length: 500 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  memberIdx: index("prt_member_idx").on(t.memberId),
  tokenIdx: index("prt_token_idx").on(t.tokenHash),
  expiresIdx: index("prt_expires_idx").on(t.expiresAt),
}));

/* =========================================================
   ★ K-2: 이메일 인증 토큰
   ========================================================= */
export const emailVerificationTokens = pgTable("email_verification_tokens", {
  id: serial("id").primaryKey(),
  memberId: integer("member_id").references(() => members.id, { onDelete: "cascade" }).notNull(),
  tokenHash: varchar("token_hash", { length: 255 }).notNull().unique(),
  email: varchar("email", { length: 100 }).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: varchar("user_agent", { length: 500 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  memberIdx: index("evt_member_idx").on(t.memberId),
  tokenIdx: index("evt_token_idx").on(t.tokenHash),
  expiresIdx: index("evt_expires_idx").on(t.expiresAt),
}));

/* =========================================================
   ★ Phase L: 토스 빌링키
   ========================================================= */
export const billingKeys = pgTable("billing_keys", {
  id: serial("id").primaryKey(),
  memberId: integer("member_id").references(() => members.id, { onDelete: "cascade" }).notNull(),
  billingKey: varchar("billing_key", { length: 200 }).notNull().unique(),
  customerKey: varchar("customer_key", { length: 64 }).notNull().unique(),
  pgProvider: varchar("pg_provider", { length: 30 }).default("kicc"),
  cardCompany: varchar("card_company", { length: 30 }),
  cardNumberMasked: varchar("card_number_masked", { length: 30 }),
  cardType: varchar("card_type", { length: 20 }),
  amount: integer("amount").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  nextChargeAt: timestamp("next_charge_at"),
  lastChargedAt: timestamp("last_charged_at"),
  consecutiveFailCount: integer("consecutive_fail_count").default(0),
  lastFailureReason: varchar("last_failure_reason", { length: 500 }),
  deactivatedAt: timestamp("deactivated_at"),
  deactivatedReason: varchar("deactivated_reason", { length: 200 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  memberIdx: index("billing_keys_member_idx").on(t.memberId),
  activeIdx: index("billing_keys_active_idx").on(t.isActive),
  nextChargeIdx: index("billing_keys_next_charge_idx").on(t.nextChargeAt),
  customerKeyIdx: index("billing_keys_customer_key_idx").on(t.customerKey),
}));

/* =========================================================
   ★ L-9: 효성 Import 로그
   ========================================================= */
export const hyosungImportLogs = pgTable("hyosung_import_logs", {
  id: serial("id").primaryKey(),
  uploadedBy: integer("uploaded_by").references(() => members.id, { onDelete: "set null" }),
  uploadedByName: varchar("uploaded_by_name", { length: 50 }),
  fileName: varchar("file_name", { length: 255 }),
  fileSize: integer("file_size"),
  totalRows: integer("total_rows").default(0),
  matchedCount: integer("matched_count").default(0),
  createdCount: integer("created_count").default(0),
  updatedCount: integer("updated_count").default(0),
  skippedCount: integer("skipped_count").default(0),
  failedCount: integer("failed_count").default(0),
  detail: text("detail"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  uploadedByIdx: index("hyosung_import_logs_uploaded_by_idx").on(t.uploadedBy),
  createdIdx: index("hyosung_import_logs_created_idx").on(t.createdAt),
}));

/* =========================================================
   ★ M-3: notifications
   ========================================================= */
export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  recipientId: integer("recipient_id").references(() => members.id, { onDelete: "cascade" }).notNull(),
  recipientType: varchar("recipient_type", { length: 20 }).default("user").notNull(),
  category: varchar("category", { length: 30 }).notNull(),
  severity: varchar("severity", { length: 20 }).default("info").notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  message: varchar("message", { length: 500 }),
  link: varchar("link", { length: 500 }),
  refTable: varchar("ref_table", { length: 50 }),
  refId: integer("ref_id"),
  isRead: boolean("is_read").default(false),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"),
}, (t) => ({
  recipientIdx: index("notifications_recipient_idx").on(t.recipientId, t.isRead, t.createdAt),
  categoryIdx: index("notifications_category_idx").on(t.category),
  severityIdx: index("notifications_severity_idx").on(t.severity),
  expiresIdx: index("notifications_expires_idx").on(t.expiresAt),
}));

/* =========================================================
   ★ M-12: signup_sources
   ========================================================= */
export const signupSources = pgTable("signup_sources", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  label: varchar("label", { length: 100 }).notNull(),
  description: varchar("description", { length: 300 }),
  isActive: boolean("is_active").default(true).notNull(),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  codeIdx: index("signup_sources_code_idx").on(t.code),
  activeIdx: index("signup_sources_active_idx").on(t.isActive),
}));

/* =========================================================
   ★ M-4 + M-14: donation_policies
   ========================================================= */
export const donationPolicies = pgTable("donation_policies", {
  id: serial("id").primaryKey(),
  regularAmounts: text("regular_amounts"),
  onetimeAmounts: text("onetime_amounts"),
  /* ★ M-15: 최소/최대 금액 */
  minAmount: integer("min_amount").default(1000),
  maxAmount: integer("max_amount").default(100000000),
  bankName: varchar("bank_name", { length: 50 }),
  bankAccountNo: varchar("bank_account_no", { length: 50 }),
  bankAccountHolder: varchar("bank_account_holder", { length: 50 }),
  bankGuideText: text("bank_guide_text"),
  hyosungUrl: varchar("hyosung_url", { length: 500 }),
  hyosungGuideText: text("hyosung_guide_text"),
  /* ★ 2026-05: 효성 카운트다운 모달 설정 */
  hyosungCountdownMessage: text("hyosung_countdown_message"),
  hyosungCountdownSeconds: integer("hyosung_countdown_seconds").default(5),
  modalTitle: varchar("modal_title", { length: 200 }),
  modalSubtitle: varchar("modal_subtitle", { length: 500 }),
  stampBlobId: integer("stamp_blob_id"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  updatedBy: integer("updated_by").references(() => members.id, { onDelete: "set null" }),
});

/* =========================================================
   ★ M-5: incidents + incident_reports
   ========================================================= */
export const incidents = pgTable("incidents", {
  id: serial("id").primaryKey(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  title: varchar("title", { length: 200 }).notNull(),
  summary: varchar("summary", { length: 500 }),
  contentHtml: text("content_html"),
  thumbnailBlobId: integer("thumbnail_blob_id"),
  occurredAt: timestamp("occurred_at"),
  location: varchar("location", { length: 200 }),
  category: incidentCategoryEnum("category").default("school").notNull(),
  status: varchar("status", { length: 20 }).default("active").notNull(),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  slugIdx: index("incidents_slug_idx").on(t.slug),
  statusIdx: index("incidents_status_idx").on(t.status),
  sortIdx: index("incidents_sort_idx").on(t.sortOrder),
}));

export const incidentReports = pgTable("incident_reports", {
  id: serial("id").primaryKey(),
  reportNo: varchar("report_no", { length: 30 }).notNull().unique(),
  incidentId: integer("incident_id").references(() => incidents.id, { onDelete: "set null" }),
  memberId: integer("member_id").references(() => members.id, { onDelete: "set null" }).notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  contentHtml: text("content_html").notNull(),
  attachmentIds: text("attachment_ids"),
  isAnonymous: boolean("is_anonymous").default(false),
  reporterName: varchar("reporter_name", { length: 50 }),
  reporterPhone: varchar("reporter_phone", { length: 20 }),
  reporterEmail: varchar("reporter_email", { length: 100 }),
  aiSeverity: varchar("ai_severity", { length: 20 }),
  aiSummary: text("ai_summary"),
  aiSuggestion: text("ai_suggestion"),
  aiAnalyzedAt: timestamp("ai_analyzed_at"),
  sirenReportRequested: boolean("siren_report_requested"),
  sirenReportRequestedAt: timestamp("siren_report_requested_at"),
  status: incidentReportStatusEnum("status").default("submitted").notNull(),
  adminResponse: text("admin_response"),
  respondedBy: integer("responded_by").references(() => members.id, { onDelete: "set null" }),
  respondedAt: timestamp("responded_at"),

  /* ───────── ★ Phase 21 R2+R3 — 워크스페이스 연동 + 카테고리 ─────────
   * assignedTo: R&R 기반 자동 할당된 운영자
   * workspaceTaskId: 자동 생성된 카드 (양방향 동기화)
   * category: "school_violence" | "neighborhood_conflict" | "traffic_accident" | "other"
   */
  assignedTo: integer("assigned_to").references(() => members.id, { onDelete: "set null" }),
  workspaceTaskId: integer("workspace_task_id"),
  category: varchar("category", { length: 30 }),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  reportNoIdx: index("incident_reports_report_no_idx").on(t.reportNo),
  incidentIdx: index("incident_reports_incident_idx").on(t.incidentId),
  memberIdx: index("incident_reports_member_idx").on(t.memberId),
  statusIdx: index("incident_reports_status_idx").on(t.status),
  severityIdx: index("incident_reports_severity_idx").on(t.aiSeverity),
  assignedToIdx: index("incident_reports_assigned_idx").on(t.assignedTo),
}));

/* =========================================================
   ★ M-6: harassment_reports
   ========================================================= */
export const harassmentReports = pgTable("harassment_reports", {
  id: serial("id").primaryKey(),
  reportNo: varchar("report_no", { length: 30 }).notNull().unique(),
  memberId: integer("member_id").references(() => members.id, { onDelete: "set null" }).notNull(),
  category: harassmentCategoryEnum("category").default("parent").notNull(),
  occurredAt: timestamp("occurred_at"),
  frequency: varchar("frequency", { length: 30 }),
  title: varchar("title", { length: 200 }).notNull(),
  contentHtml: text("content_html").notNull(),
  attachmentIds: text("attachment_ids"),
  isAnonymous: boolean("is_anonymous").default(false),
  reporterName: varchar("reporter_name", { length: 50 }),
  reporterPhone: varchar("reporter_phone", { length: 20 }),
  reporterEmail: varchar("reporter_email", { length: 100 }),
  aiCategory: varchar("ai_category", { length: 30 }),
  aiSeverity: varchar("ai_severity", { length: 20 }),
  aiSummary: text("ai_summary"),
  aiImmediateAction: text("ai_immediate_action"),
  aiLegalReviewNeeded: boolean("ai_legal_review_needed"),
  aiLegalReason: text("ai_legal_reason"),
  aiPsychSupportNeeded: boolean("ai_psych_support_needed"),
  aiSuggestion: text("ai_suggestion"),
  aiAnalyzedAt: timestamp("ai_analyzed_at"),
  sirenReportRequested: boolean("siren_report_requested"),
  sirenReportRequestedAt: timestamp("siren_report_requested_at"),
  status: harassmentReportStatusEnum("status").default("submitted").notNull(),
  adminResponse: text("admin_response"),
  respondedBy: integer("responded_by").references(() => members.id, { onDelete: "set null" }),
  respondedAt: timestamp("responded_at"),

  /* ───────── ★ Phase 21 R2+R3 — 워크스페이스 연동 ───────── */
  assignedTo: integer("assigned_to").references(() => members.id, { onDelete: "set null" }),
  workspaceTaskId: integer("workspace_task_id"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  reportNoIdx: index("harassment_reports_report_no_idx").on(t.reportNo),
  memberIdx: index("harassment_reports_member_idx").on(t.memberId),
  statusIdx: index("harassment_reports_status_idx").on(t.status),
  severityIdx: index("harassment_reports_severity_idx").on(t.aiSeverity),
  categoryIdx: index("harassment_reports_category_idx").on(t.category),
  assignedToIdx: index("harassment_reports_assigned_idx").on(t.assignedTo),
}));

/* =========================================================
   ★ M-7: legal_consultations
   ========================================================= */
export const legalConsultations = pgTable("legal_consultations", {
  id: serial("id").primaryKey(),
  consultationNo: varchar("consultation_no", { length: 30 }).notNull().unique(),
  memberId: integer("member_id").references(() => members.id, { onDelete: "set null" }).notNull(),
  category: legalCategoryEnum("category").default("school_dispute").notNull(),
  urgency: varchar("urgency", { length: 20 }),
  occurredAt: timestamp("occurred_at"),
  partyInfo: varchar("party_info", { length: 200 }),
  title: varchar("title", { length: 200 }).notNull(),
  contentHtml: text("content_html").notNull(),
  attachmentIds: text("attachment_ids"),
  isAnonymous: boolean("is_anonymous").default(false),
  reporterName: varchar("reporter_name", { length: 50 }),
  reporterPhone: varchar("reporter_phone", { length: 20 }),
  reporterEmail: varchar("reporter_email", { length: 100 }),
  aiCategory: varchar("ai_category", { length: 30 }),
  aiUrgency: varchar("ai_urgency", { length: 20 }),
  aiSummary: text("ai_summary"),
  aiRelatedLaws: text("ai_related_laws"),
  aiLegalOpinion: text("ai_legal_opinion"),
  aiLawyerSpecialty: varchar("ai_lawyer_specialty", { length: 100 }),
  aiImmediateAction: text("ai_immediate_action"),
  aiSuggestion: text("ai_suggestion"),
  aiAnalyzedAt: timestamp("ai_analyzed_at"),
  sirenReportRequested: boolean("siren_report_requested"),
  sirenReportRequestedAt: timestamp("siren_report_requested_at"),
  assignedLawyerId: integer("assigned_lawyer_id").references(() => members.id, { onDelete: "set null" }),
  assignedLawyerName: varchar("assigned_lawyer_name", { length: 50 }),
  assignedAt: timestamp("assigned_at"),
  status: legalConsultationStatusEnum("status").default("submitted").notNull(),
  adminResponse: text("admin_response"),
  respondedBy: integer("responded_by").references(() => members.id, { onDelete: "set null" }),
  respondedAt: timestamp("responded_at"),

  /* ───────── ★ Phase 21 R2+R3 — 워크스페이스 연동 (assignedLawyerId와 별개) ─────────
   * assignedTo: 운영자 풀에서 R&R 기반 자동 할당된 1차 담당자 (변호사 X)
   * 변호사 매칭은 기존 assignedLawyerId가 그대로 담당
   */
  assignedTo: integer("assigned_to").references(() => members.id, { onDelete: "set null" }),
  workspaceTaskId: integer("workspace_task_id"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  consultationNoIdx: index("legal_consultations_no_idx").on(t.consultationNo),
  memberIdx: index("legal_consultations_member_idx").on(t.memberId),
  statusIdx: index("legal_consultations_status_idx").on(t.status),
  urgencyIdx: index("legal_consultations_urgency_idx").on(t.aiUrgency),
  categoryIdx: index("legal_consultations_category_idx").on(t.category),
  assignedToIdx: index("legal_consultations_assigned_idx").on(t.assignedTo),
}));

/* =========================================================
   ★ M-8: board_posts + board_comments
   ========================================================= */
export const boardPosts = pgTable("board_posts", {
  id: serial("id").primaryKey(),
  postNo: varchar("post_no", { length: 30 }).notNull().unique(),
  memberId: integer("member_id").references(() => members.id, { onDelete: "set null" }),
  authorName: varchar("author_name", { length: 50 }).notNull(),
  category: boardCategoryEnum("category").default("general").notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  contentHtml: text("content_html").notNull(),
  attachmentIds: text("attachment_ids"),
  views: integer("views").default(0).notNull(),
  likeCount: integer("like_count").default(0).notNull(),
  commentCount: integer("comment_count").default(0).notNull(),
  isPinned: boolean("is_pinned").default(false).notNull(),
  isHidden: boolean("is_hidden").default(false).notNull(),
  isAnonymous: boolean("is_anonymous").default(false).notNull(),
  adminMemo: text("admin_memo"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  postNoIdx: index("board_posts_post_no_idx").on(t.postNo),
  memberIdx: index("board_posts_member_idx").on(t.memberId),
  categoryIdx: index("board_posts_category_idx").on(t.category),
  pinnedIdx: index("board_posts_pinned_idx").on(t.isPinned),
  hiddenIdx: index("board_posts_hidden_idx").on(t.isHidden),
  createdIdx: index("board_posts_created_idx").on(t.createdAt),
}));

export const boardComments = pgTable("board_comments", {
  id: serial("id").primaryKey(),
  postId: integer("post_id").references(() => boardPosts.id, { onDelete: "cascade" }).notNull(),
  memberId: integer("member_id").references(() => members.id, { onDelete: "set null" }),
  authorName: varchar("author_name", { length: 50 }).notNull(),
  content: varchar("content", { length: 1000 }).notNull(),
  parentId: integer("parent_id"),
  isHidden: boolean("is_hidden").default(false).notNull(),
  isAnonymous: boolean("is_anonymous").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  postIdx: index("board_comments_post_idx").on(t.postId, t.createdAt),
  memberIdx: index("board_comments_member_idx").on(t.memberId),
  parentIdx: index("board_comments_parent_idx").on(t.parentId),
}));

/* =========================================================
   ★ M-11: content_pages
   ========================================================= */
export const contentPages = pgTable("content_pages", {
  id: serial("id").primaryKey(),
  pageKey: varchar("page_key", { length: 100 }).notNull().unique(),
  title: varchar("title", { length: 200 }),
  contentHtml: text("content_html"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  updatedBy: integer("updated_by").references(() => members.id, { onDelete: "set null" }),
}, (t) => ({
  keyIdx: index("content_pages_key_idx").on(t.pageKey),
}));

/* =========================================================
   ★ M-11: activity_posts
   ========================================================= */
export const activityPosts = pgTable("activity_posts", {
  id: serial("id").primaryKey(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  year: integer("year").notNull(),
  month: integer("month"),
  category: activityCategoryEnum("category").default("news").notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  summary: varchar("summary", { length: 500 }),
  contentHtml: text("content_html"),
  thumbnailBlobId: integer("thumbnail_blob_id"),
  attachmentIds: text("attachment_ids"),
  isPublished: boolean("is_published").default(true).notNull(),
  isPinned: boolean("is_pinned").default(false).notNull(),
  sortOrder: integer("sort_order").default(0),
  views: integer("views").default(0).notNull(),
  publishedAt: timestamp("published_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  updatedBy: integer("updated_by").references(() => members.id, { onDelete: "set null" }),
}, (t) => ({
  slugIdx: index("activity_posts_slug_idx").on(t.slug),
  yearIdx: index("activity_posts_year_idx").on(t.year, t.month),
  categoryIdx: index("activity_posts_category_idx").on(t.category),
  publishedIdx: index("activity_posts_published_idx").on(t.isPublished),
  pinnedIdx: index("activity_posts_pinned_idx").on(t.isPinned),
}));

/* =========================================================
   ★ M-11: media_posts
   ========================================================= */
export const mediaPosts = pgTable("media_posts", {
  id: serial("id").primaryKey(),
  category: mediaCategoryEnum("category").default("press").notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  summary: varchar("summary", { length: 500 }),
  contentHtml: text("content_html"),
  thumbnailBlobId: integer("thumbnail_blob_id"),
  externalUrl: varchar("external_url", { length: 500 }),
  source: varchar("source", { length: 100 }),
  isPublished: boolean("is_published").default(true).notNull(),
  views: integer("views").default(0).notNull(),
  publishedAt: timestamp("published_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  updatedBy: integer("updated_by").references(() => members.id, { onDelete: "set null" }),
}, (t) => ({
  categoryIdx: index("media_posts_category_idx").on(t.category),
  publishedIdx: index("media_posts_published_idx").on(t.isPublished),
  publishedAtIdx: index("media_posts_published_at_idx").on(t.publishedAt),
}));

/* =========================================================
   ★ M-19-2: campaigns
   ========================================================= */
export const campaigns = pgTable("campaigns", {
  id: serial("id").primaryKey(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  type: campaignTypeEnum("type").default("fundraising").notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  summary: varchar("summary", { length: 500 }),
  contentHtml: text("content_html"),
  thumbnailBlobId: integer("thumbnail_blob_id"),
  status: varchar("status", { length: 20 }).default("draft").notNull(),
  goalAmount: integer("goal_amount"),
  raisedAmount: integer("raised_amount").default(0).notNull(),
  donorCount: integer("donor_count").default(0).notNull(),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  isPublished: boolean("is_published").default(false).notNull(),
  isPinned: boolean("is_pinned").default(false).notNull(),
  sortOrder: integer("sort_order").default(0),
  views: integer("views").default(0).notNull(),
  lastSlumpAlertAt: timestamp("last_slump_alert_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  createdBy: integer("created_by").references(() => members.id, { onDelete: "set null" }),
}, (t) => ({
  slugIdx: index("campaigns_slug_idx").on(t.slug),
  statusIdx: index("campaigns_status_idx").on(t.status),
  typeIdx: index("campaigns_type_idx").on(t.type),
  publishedIdx: index("campaigns_published_idx").on(t.isPublished),
  pinnedIdx: index("campaigns_pinned_idx").on(t.isPinned),
  datesIdx: index("campaigns_dates_idx").on(t.startDate, t.endDate),
}));

/* =========================================================
   ★ Phase M-19-8: 자료실 (resource_categories + resources)
   ========================================================= */
export const resourceCategories = pgTable("resource_categories", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  nameKo: varchar("name_ko", { length: 100 }).notNull(),
  description: varchar("description", { length: 300 }),
  icon: varchar("icon", { length: 10 }),
  sortOrder: integer("sort_order").default(0),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  codeIdx: index("resource_categories_code_idx").on(t.code),
  activeIdx: index("resource_categories_active_idx").on(t.isActive, t.sortOrder),
}));

export const resources = pgTable("resources", {
  id: serial("id").primaryKey(),
  categoryId: integer("category_id").references(() => resourceCategories.id, { onDelete: "set null" }),
  title: varchar("title", { length: 200 }).notNull(),
  slug: varchar("slug", { length: 100 }).unique(),
  description: text("description"),
  contentHtml: text("content_html"),
  fileBlobId: integer("file_blob_id"),
  thumbnailBlobId: integer("thumbnail_blob_id"),
  accessLevel: resourceAccessLevelEnum("access_level").default("public").notNull(),
  tags: jsonb("tags").default(sql`'[]'::jsonb`),
  downloadCount: integer("download_count").default(0).notNull(),
  views: integer("views").default(0).notNull(),
  isPublished: boolean("is_published").default(true).notNull(),
  isPinned: boolean("is_pinned").default(false).notNull(),
  sortOrder: integer("sort_order").default(0),
  publishedAt: timestamp("published_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  createdBy: integer("created_by").references(() => members.id, { onDelete: "set null" }),
  updatedBy: integer("updated_by").references(() => members.id, { onDelete: "set null" }),
}, (t) => ({
  categoryIdx: index("resources_category_idx").on(t.categoryId),
  slugIdx: index("resources_slug_idx").on(t.slug),
  accessIdx: index("resources_access_idx").on(t.accessLevel),
  publishedIdx: index("resources_published_idx").on(t.isPublished),
  pinnedIdx: index("resources_pinned_idx").on(t.isPinned),
  createdIdx: index("resources_created_idx").on(t.createdAt),
}));

/* =========================================================
   ★ Phase M-19-7: anniversary_emails_log
   ========================================================= */
export const anniversaryEmailsLog = pgTable("anniversary_emails_log", {
  id: serial("id").primaryKey(),
  memberId: integer("member_id").references(() => members.id, { onDelete: "cascade" }).notNull(),
  anniversaryType: anniversaryTypeEnum("anniversary_type").notNull(),
  anniversaryDate: timestamp("anniversary_date", { mode: "date" }).notNull(),
  milestoneAmount: integer("milestone_amount"),
  emailSentAt: timestamp("email_sent_at").defaultNow().notNull(),
  emailStatus: varchar("email_status", { length: 20 }).default("sent").notNull(),
  recipientEmail: varchar("recipient_email", { length: 100 }),
  errorMessage: text("error_message"),
  metadata: jsonb("metadata").default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  memberIdx: index("ael_member_idx").on(t.memberId),
  typeIdx: index("ael_type_idx").on(t.anniversaryType),
  sentIdx: index("ael_sent_idx").on(t.emailSentAt),
}));

/* ★ M-19-11 V2: expert_profiles 테이블 정의 제거됨
   - DB에는 테이블이 DROP된 상태
   - 변호사/심리상담사는 members 테이블의 type='volunteer' AND member_subtype='lawyer'/'counselor' 로 관리 */

/* =========================================================
   ★ M-1 + M-2.5: blob_uploads
   ========================================================= */
export const blobUploads = pgTable("blob_uploads", {
  id: serial("id").primaryKey(),
  blobKey: varchar("blob_key", { length: 255 }).notNull().unique(),
  originalName: varchar("original_name", { length: 500 }).notNull(),
  mimeType: varchar("mime_type", { length: 100 }).notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  uploadedBy: integer("uploaded_by").references(() => members.id, { onDelete: "set null" }),
  uploadedByAdmin: integer("uploaded_by_admin"),
  context: varchar("context", { length: 50 }),
  referenceTable: varchar("reference_table", { length: 50 }),
  referenceId: integer("reference_id"),
  isPublic: boolean("is_public").default(true),
  storageProvider: varchar("storage_provider", { length: 20 }).default("netlify").notNull(),
  uploadStatus: varchar("upload_status", { length: 20 }).default("completed").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"),
}, (t) => ({
  keyIdx: index("blob_uploads_key_idx").on(t.blobKey),
  refIdx: index("blob_uploads_ref_idx").on(t.referenceTable, t.referenceId),
  expiresIdx: index("blob_uploads_expires_idx").on(t.expiresAt),
}));

/* =========================================================
   ★ 2026-05: 메인 화면 관리 시스템 (Phase A — 통계만 사용)
   ========================================================= */
export const siteSettings = pgTable("site_settings", {
  id: serial("id").primaryKey(),
  scope: varchar("scope", { length: 50 }).notNull(),
  key: varchar("key", { length: 150 }).notNull(),
  valueType: varchar("value_type", { length: 20 }).default("text").notNull(),
  valueText: text("value_text"),
  valueBlobId: integer("value_blob_id"),
  valueJson: jsonb("value_json"),
  /* Draft 시스템 */
  draftValueText: text("draft_value_text"),
  draftValueBlobId: integer("draft_value_blob_id"),
  draftValueJson: jsonb("draft_value_json"),
  hasDraft: boolean("has_draft").default(false).notNull(),
  /* 메타 */
  description: varchar("description", { length: 300 }),
  sortOrder: integer("sort_order").default(0),
  isActive: boolean("is_active").default(true).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  updatedBy: integer("updated_by"),
}, (t) => ({
  scopeIdx: index("site_settings_scope_idx").on(t.scope),
  activeIdx: index("site_settings_active_idx").on(t.isActive),
  draftIdx: index("site_settings_draft_idx").on(t.hasDraft),
}));

/* =========================================================
   ★ Phase A + B: nav_menu_items (메뉴 1뎁스/2뎁스 + Draft 시스템)
   ========================================================= */
export const navMenuItems = pgTable("nav_menu_items", {
  id: serial("id").primaryKey(),
  parentId: integer("parent_id"),                                              // 자기참조 — 2뎁스
  menuLocation: varchar("menu_location", { length: 20 }).notNull(),            // 'header' | 'footer' | 'siren' 등
  label: varchar("label", { length: 100 }).notNull(),
  href: varchar("href", { length: 500 }),
  icon: varchar("icon", { length: 20 }),
  sortOrder: integer("sort_order").default(0),
  isActive: boolean("is_active").default(true).notNull(),
  opensModal: varchar("opens_modal", { length: 50 }),                          // 'donateModal' 등 모달 키
  pageKey: varchar("page_key", { length: 50 }),                                // 내부 페이지 키
  target: varchar("target", { length: 20 }).default("_self"),
  cssClass: varchar("css_class", { length: 100 }),
  /* Draft 시스템 */
  draftLabel: varchar("draft_label", { length: 100 }),
  draftHref: varchar("draft_href", { length: 500 }),
  draftSortOrder: integer("draft_sort_order"),
  hasDraft: boolean("has_draft").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  locationIdx: index("nav_menu_items_location_idx").on(t.menuLocation, t.sortOrder),
  parentIdx: index("nav_menu_items_parent_idx").on(t.parentId),
  activeIdx: index("nav_menu_items_active_idx").on(t.isActive),
  draftIdx: index("nav_menu_items_draft_idx").on(t.hasDraft),
}));

/* =========================================================
   ★ Phase A + B: related_sites (관련 사이트)
   ========================================================= */
export const relatedSites = pgTable("related_sites", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),
  url: varchar("url", { length: 500 }).notNull(),
  description: varchar("description", { length: 300 }),
  sortOrder: integer("sort_order").default(0),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  activeIdx: index("related_sites_active_idx").on(t.isActive, t.sortOrder),
}));

/* =========================================================
   ★ Phase A + B: site_publish_log (배포 이력)
   ========================================================= */
export const sitePublishLog = pgTable("site_publish_log", {
  id: serial("id").primaryKey(),
  publishedBy: integer("published_by"),
  publishedByName: varchar("published_by_name", { length: 100 }),
  affectedSettings: integer("affected_settings").default(0),
  affectedMenus: integer("affected_menus").default(0),
  scopes: text("scopes"),
  note: varchar("note", { length: 500 }),
  publishedAt: timestamp("published_at").defaultNow().notNull(),
}, (t) => ({
  publishedAtIdx: index("site_publish_log_published_at_idx").on(t.publishedAt),
}));

/* =========================================================
   타입 export
   ========================================================= */
export type Member = typeof members.$inferSelect;
export type NewMember = typeof members.$inferInsert;
export type MemberGrade = typeof memberGrades.$inferSelect;
export type NewMemberGrade = typeof memberGrades.$inferInsert;
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

export type ChatRoom = typeof chatRooms.$inferSelect;
export type NewChatRoom = typeof chatRooms.$inferInsert;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type NewChatMessage = typeof chatMessages.$inferInsert;
export type ChatAttachment = typeof chatAttachments.$inferSelect;
export type NewChatAttachment = typeof chatAttachments.$inferInsert;
export type ChatBlacklist = typeof chatBlacklist.$inferSelect;
export type NewChatBlacklist = typeof chatBlacklist.$inferInsert;

export type ReceiptSettings = typeof receiptSettings.$inferSelect;
export type NewReceiptSettings = typeof receiptSettings.$inferInsert;

export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type NewPasswordResetToken = typeof passwordResetTokens.$inferInsert;

export type EmailVerificationToken = typeof emailVerificationTokens.$inferSelect;
export type NewEmailVerificationToken = typeof emailVerificationTokens.$inferInsert;

export type BillingKey = typeof billingKeys.$inferSelect;
export type NewBillingKey = typeof billingKeys.$inferInsert;

export type HyosungImportLog = typeof hyosungImportLogs.$inferSelect;
export type NewHyosungImportLog = typeof hyosungImportLogs.$inferInsert;

export type BlobUpload = typeof blobUploads.$inferSelect;
export type NewBlobUpload = typeof blobUploads.$inferInsert;

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;

export type DonationPolicy = typeof donationPolicies.$inferSelect;
export type NewDonationPolicy = typeof donationPolicies.$inferInsert;

export type Incident = typeof incidents.$inferSelect;
export type NewIncident = typeof incidents.$inferInsert;
export type IncidentReport = typeof incidentReports.$inferSelect;
export type NewIncidentReport = typeof incidentReports.$inferInsert;

export type HarassmentReport = typeof harassmentReports.$inferSelect;
export type NewHarassmentReport = typeof harassmentReports.$inferInsert;

export type LegalConsultation = typeof legalConsultations.$inferSelect;
export type NewLegalConsultation = typeof legalConsultations.$inferInsert;

export type BoardPost = typeof boardPosts.$inferSelect;
export type NewBoardPost = typeof boardPosts.$inferInsert;
export type BoardComment = typeof boardComments.$inferSelect;
export type NewBoardComment = typeof boardComments.$inferInsert;

export type ContentPage = typeof contentPages.$inferSelect;
export type NewContentPage = typeof contentPages.$inferInsert;
export type ActivityPost = typeof activityPosts.$inferSelect;
export type NewActivityPost = typeof activityPosts.$inferInsert;
export type MediaPost = typeof mediaPosts.$inferSelect;
export type NewMediaPost = typeof mediaPosts.$inferInsert;

export type SignupSource = typeof signupSources.$inferSelect;
export type NewSignupSource = typeof signupSources.$inferInsert;

/* ★ M-19-2: 캠페인 타입 */
export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;

/* ★ M-19-8: 자료실 타입 */
export type ResourceCategory = typeof resourceCategories.$inferSelect;
export type NewResourceCategory = typeof resourceCategories.$inferInsert;
export type Resource = typeof resources.$inferSelect;
export type NewResource = typeof resources.$inferInsert;

/* ★ M-19-7: 기념일 로그 타입 */
export type AnniversaryEmailLog = typeof anniversaryEmailsLog.$inferSelect;
export type NewAnniversaryEmailLog = typeof anniversaryEmailsLog.$inferInsert;

/* ★ M-19-11 V2: ExpertProfile 타입 제거됨 (members 테이블로 통합) */


/* ★ Phase B: 메뉴 / 관련 사이트 / 배포 이력 */
export type NavMenuItem = typeof navMenuItems.$inferSelect;
export type NewNavMenuItem = typeof navMenuItems.$inferInsert;
export type RelatedSite = typeof relatedSites.$inferSelect;
export type NewRelatedSite = typeof relatedSites.$inferInsert;
export type SitePublishLog = typeof sitePublishLog.$inferSelect;
export type NewSitePublishLog = typeof sitePublishLog.$inferInsert;
/* =========================================================
   ★ 2026-05 B-2: 사건 댓글 시스템
   ========================================================= */
export const incidentComments = pgTable("incident_comments", {
  id: serial("id").primaryKey(),
  incidentId: integer("incident_id").references(() => incidents.id, { onDelete: "cascade" }).notNull(),
  memberId: integer("member_id").references(() => members.id, { onDelete: "set null" }),
  parentId: integer("parent_id"),
  authorName: varchar("author_name", { length: 50 }).notNull(),
  content: varchar("content", { length: 1000 }).notNull(),
  isAnonymous: boolean("is_anonymous").default(false),
  isPrivate: boolean("is_private").default(false),
  likeCount: integer("like_count").default(0),
  dislikeCount: integer("dislike_count").default(0),
  isHidden: boolean("is_hidden").default(false),
  hiddenBy: integer("hidden_by"),
  hiddenAt: timestamp("hidden_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const commentVotes = pgTable("comment_votes", {
  id: serial("id").primaryKey(),
  commentId: integer("comment_id").references(() => incidentComments.id, { onDelete: "cascade" }).notNull(),
  memberId: integer("member_id").references(() => members.id, { onDelete: "cascade" }).notNull(),
  voteType: varchar("vote_type", { length: 10 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const commentReports = pgTable("comment_reports", {
  id: serial("id").primaryKey(),
  commentId: integer("comment_id").references(() => incidentComments.id, { onDelete: "cascade" }),
  incidentId: integer("incident_id").references(() => incidents.id, { onDelete: "cascade" }),
  memberId: integer("member_id").references(() => members.id, { onDelete: "cascade" }).notNull(),
  reportType: varchar("report_type", { length: 20 }).default("comment").notNull(),
  reason: varchar("reason", { length: 500 }).notNull(),
  status: varchar("status", { length: 20 }).default("pending"),
  reviewedBy: integer("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type IncidentComment = typeof incidentComments.$inferSelect;
export type CommentVote = typeof commentVotes.$inferSelect;
export type CommentReport = typeof commentReports.$inferSelect;

/* =========================================================
   ★ Phase 1: 효성 CMS+ 계약 정보 테이블
   세션 2에서 DB 생성됨 (members.id 참조)
   ========================================================= */
export const hyosungContracts = pgTable("hyosung_contracts", {
  id: serial("id").primaryKey(),
  memberNo: integer("member_no").notNull().unique(),
  memberName: varchar("member_name", { length: 50 }),
  phone: varchar("phone", { length: 20 }),
  memberStatus: varchar("member_status", { length: 20 }),
  contractStatus: varchar("contract_status", { length: 20 }),
  promiseDay: integer("promise_day"),
  paymentMethod: varchar("payment_method", { length: 30 }),
  paymentTool: varchar("payment_tool", { length: 20 }),
  paymentInfo: varchar("payment_info", { length: 100 }),
  accountHolder: varchar("account_holder", { length: 50 }),
  registrationStatus: varchar("registration_status", { length: 30 }),
  agreementStatus: varchar("agreement_status", { length: 20 }),
  electronicContract: varchar("electronic_contract", { length: 20 }),
  productName: varchar("product_name", { length: 50 }),
  productAmount: integer("product_amount"),
  billingStart: timestamp("billing_start", { mode: "date" }),
  billingEnd: timestamp("billing_end", { mode: "date" }),
  managerName: varchar("manager_name", { length: 50 }),
  memberType: varchar("member_type", { length: 30 }),
  billingAuto: varchar("billing_auto", { length: 20 }),
  sendMethod: varchar("send_method", { length: 20 }),
  linkedMemberId: integer("linked_member_id").references(() => members.id, { onDelete: "set null" }),
  rawData: jsonb("raw_data").default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  memberNoIdx: index("hyosung_contracts_member_no_idx").on(t.memberNo),
  linkedMemberIdx: index("hyosung_contracts_linked_member_idx").on(t.linkedMemberId),
  phoneIdx: index("hyosung_contracts_phone_idx").on(t.phone),
}));

/* =========================================================
   ★ Phase 1: 효성 CMS+ 청구/수납 내역
   세션 2에서 DB 생성됨 (donations.id 참조)
   ========================================================= */
export const hyosungBillings = pgTable("hyosung_billings", {
  id: serial("id").primaryKey(),
  memberNo: integer("member_no").notNull(),
  contractNo: varchar("contract_no", { length: 30 }),
  memberName: varchar("member_name", { length: 50 }),
  billingMonth: varchar("billing_month", { length: 10 }).notNull(),
  firstBillingMonth: varchar("first_billing_month", { length: 10 }),
  phone: varchar("phone", { length: 20 }),
  productName: varchar("product_name", { length: 50 }),
  billingAmount: integer("billing_amount"),
  supplyAmount: integer("supply_amount"),
  vatAmount: integer("vat_amount"),
  receivedAmount: integer("received_amount").default(0),
  unpaidAmount: integer("unpaid_amount").default(0),
  cancelAmount: integer("cancel_amount").default(0),
  refundAmount: integer("refund_amount").default(0),
  receiptStatus: varchar("receipt_status", { length: 20 }),
  paymentStatus: varchar("payment_status", { length: 20 }),
  paymentMethod: varchar("payment_method", { length: 30 }),
  paymentTool: varchar("payment_tool", { length: 20 }),
  promiseDay: integer("promise_day"),
  paymentDate: timestamp("payment_date", { mode: "date" }),
  billingType: varchar("billing_type", { length: 20 }),
  unreceivedHandling: varchar("unreceived_handling", { length: 20 }),
  billingCompletionDate: timestamp("billing_completion_date"),
  memo: text("memo"),
  paymentResult: varchar("payment_result", { length: 50 }),
  linkedDonationId: integer("linked_donation_id").references(() => donations.id, { onDelete: "set null" }),
  rawData: jsonb("raw_data").default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  memberNoIdx: index("hyosung_billings_member_no_idx").on(t.memberNo),
  monthIdx: index("hyosung_billings_month_idx").on(t.billingMonth),
  receiptStatusIdx: index("hyosung_billings_receipt_status_idx").on(t.receiptStatus),
}));

/* ★ Phase 1: 효성 CMS+ 타입 export */
export type HyosungContract = typeof hyosungContracts.$inferSelect;
export type NewHyosungContract = typeof hyosungContracts.$inferInsert;
export type HyosungBilling = typeof hyosungBillings.$inferSelect;
export type NewHyosungBilling = typeof hyosungBillings.$inferInsert;

/* =========================================================
   ★ Phase 2: 토스 빌링 자동 청구 로그
   ========================================================= */
export const billingLogs = pgTable("billing_logs", {
  id: serial("id").primaryKey(),
  memberId: integer("member_id").references(() => members.id, { onDelete: "set null" }),
  billingKey: varchar("billing_key", { length: 200 }),
  attemptType: varchar("attempt_type", { length: 20 }).notNull(),
  attemptNumber: integer("attempt_number").default(1).notNull(),
  amount: integer("amount").notNull(),
  status: varchar("status", { length: 20 }).notNull(),
  pgOrderNo: varchar("pg_order_no", { length: 100 }),
  pgTid: varchar("pg_tid", { length: 200 }),
  pgResponseCode: varchar("pg_response_code", { length: 50 }),
  pgResponseMessage: varchar("pg_response_message", { length: 500 }),
  pgProvider: varchar("pg_provider", { length: 30 }).default("kicc"),
  errorDetail: jsonb("error_detail"),
  donationId: integer("donation_id").references(() => donations.id, { onDelete: "set null" }),
  requestedAt: timestamp("requested_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  nextRetryAt: timestamp("next_retry_at"),
  notifiedChannels: varchar("notified_channels", { length: 50 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  memberIdx: index("idx_billing_logs_member").on(t.memberId),
  statusIdx: index("idx_billing_logs_status").on(t.status),
  nextRetryIdx: index("idx_billing_logs_next_retry").on(t.nextRetryAt),
  requestedIdx: index("idx_billing_logs_requested").on(t.requestedAt),
}));

export type BillingLog = typeof billingLogs.$inferSelect;
export type NewBillingLog = typeof billingLogs.$inferInsert;

/* =========================================================
   ★ Phase 2: 카드 만료 알림 발송 이력
   ========================================================= */
export const cardExpiryAlerts = pgTable("card_expiry_alerts", {
  id: serial("id").primaryKey(),
  memberId: integer("member_id").references(() => members.id, { onDelete: "cascade" }).notNull(),
  billingKey: varchar("billing_key", { length: 200 }).notNull(),
  cardExpiryMonth: varchar("card_expiry_month", { length: 10 }),
  alertType: varchar("alert_type", { length: 20 }).notNull(),
  channelsSent: varchar("channels_sent", { length: 50 }),
  sentAt: timestamp("sent_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  memberIdx: index("idx_card_expiry_member").on(t.memberId),
}));

export type CardExpiryAlert = typeof cardExpiryAlerts.$inferSelect;
export type NewCardExpiryAlert = typeof cardExpiryAlerts.$inferInsert;

/* =========================================================
   ★ Phase 3: 공통 워크스페이스
   ========================================================= */

// 1. WBS 작업
export const workspaceTasks = pgTable("workspace_tasks", {
  id: serial("id").primaryKey(),
  memberId: integer("member_id").references(() => members.id, { onDelete: "cascade" }).notNull(), // 소유자(실행자)
  title: varchar("title", { length: 300 }).notNull(),
  description: text("description"),
  status: varchar("status", { length: 20 }).default("todo").notNull(),       // todo | doing(=in_progress) | blocked(=on_hold) | done | archived
  priority: varchar("priority", { length: 20 }).default("normal").notNull(), // low | normal | high | urgent
  dueDate: timestamp("due_date"),                                            // 선택(개인 기록·보관용 카드는 마감일 없이 가능·2026-07-09)
  assignedBy: integer("assigned_by").references(() => members.id, { onDelete: "set null" }),
  assignedTo: integer("assigned_to").references(() => members.id, { onDelete: "set null" }), // ⭐ 지시 대상
  assignedAt: timestamp("assigned_at"),
  parentTaskId: integer("parent_task_id"),
  tags: jsonb("tags").default(sql`'[]'::jsonb`),
  sortOrder: integer("sort_order").default(0),
  progress: integer("progress").default(0).notNull(),                        // ⭐ 0~100
  completedAt: timestamp("completed_at"),
  completedBy: integer("completed_by").references(() => members.id, { onDelete: "set null" }),
  // ★ Phase 3 Step 7-A — 칸반 5컬럼 + 보류/보관 + 타임 트래킹 + 북마크 + AI
  estimatedHours: numeric("estimated_hours", { precision: 5, scale: 1 }),
  actualHours: numeric("actual_hours", { precision: 5, scale: 1 }),
  holdReason: text("hold_reason"),
  holdStartedAt: timestamp("hold_started_at"),
  archivedAt: timestamp("archived_at"),
  bookmarkedBy: jsonb("bookmarked_by").default(sql`'[]'::jsonb`),            // [memberId, ...]
  aiSummary: text("ai_summary"),
  aiRiskScore: integer("ai_risk_score"),                                     // 0~100, 지연 확률
  aiRiskUpdatedAt: timestamp("ai_risk_updated_at"),
  // ⭐ 외부 리소스 연결 (AI 에이전트 맥락 추적)
  sourceType: varchar("source_type", { length: 30 }),                        // 'incident' | 'donation' | 'support' | 'campaign' | 'member' | 'manual' | 'recurring' | 'ai_agent'
  sourceId: integer("source_id"),
  sourceRefUrl: varchar("source_ref_url", { length: 500 }),
  // ⭐ 체크리스트 + 첨부
  checklistItems: jsonb("checklist_items").default(sql`'[]'::jsonb`),        // [{id, text, done, doneAt}]
  attachments: jsonb("attachments").default(sql`'[]'::jsonb`),                // R2 파일 ID 배열
  // ⭐ 리마인더 (Agent-8)
  reminderConfig: jsonb("reminder_config").default(sql`'{}'::jsonb`),        // { before: ['3d','1d','2h'], channels: ['email','bell'] }
  remindersSentAt: jsonb("reminders_sent_at").default(sql`'[]'::jsonb`),     // ['3d','1d']
  // ⭐ 반복 task
  recurringParentId: integer("recurring_parent_id"),
  // ⭐ AI 생성 식별
  createdByAgent: varchar("created_by_agent", { length: 20 }),               // 'user' | 'agent-1' | 'agent-8' ...
  // ★ Phase 25 — WBS↔마일스톤 연동
  milestoneDefId: integer("milestone_def_id"),                               // FK milestone_definitions(id) ON DELETE SET NULL
  milestoneMatchStatus: varchar("milestone_match_status", { length: 20 }),  // 'auto' | 'user' | 'skipped' | null
  milestoneMatchConfidence: integer("milestone_match_confidence"),           // AI 신뢰도 0~100
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  memberIdx: index("workspace_tasks_member_idx").on(t.memberId),
  assignedToIdx: index("workspace_tasks_assigned_to_idx").on(t.assignedTo),
  statusIdx: index("workspace_tasks_status_idx").on(t.status),
  dueIdx: index("workspace_tasks_due_idx").on(t.dueDate),
  assignedByIdx: index("workspace_tasks_assigned_by_idx").on(t.assignedBy),
  parentIdx: index("workspace_tasks_parent_idx").on(t.parentTaskId),
  sourceIdx: index("workspace_tasks_source_idx").on(t.sourceType, t.sourceId),
  recurringIdx: index("workspace_tasks_recurring_idx").on(t.recurringParentId),
  milestoneDefIdx: index("workspace_tasks_milestone_def_idx").on(t.milestoneDefId),
}));

// 2. 개인 메모
export const workspaceMemos = pgTable("workspace_memos", {
  id: serial("id").primaryKey(),
  memberId: integer("member_id").references(() => members.id, { onDelete: "cascade" }).notNull(),
  title: varchar("title", { length: 200 }),
  contentHtml: text("content_html"),
  color: varchar("color", { length: 20 }).default("yellow").notNull(),
  isPinned: boolean("is_pinned").default(false).notNull(),
  sortOrder: integer("sort_order").default(0),
  // ⭐ 메모 연결 (task/event와 연결 시)
  relatedTaskId: integer("related_task_id"),
  relatedEventId: integer("related_event_id"),
  attachments: jsonb("attachments").default(sql`'[]'::jsonb`),

  /* ───────── ★ Phase 21 R4 — 캘린더 미러링 ─────────
   * eventDate/eventTime: 메모를 캘린더에 표시할 때의 날짜·시각
   * showInCalendar: 캘린더 표시 여부 (false면 메모 탭에만 보임)
   */
  eventDate: date("event_date"),
  eventTime: time("event_time"),
  showInCalendar: boolean("show_in_calendar").default(false).notNull(),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  memberIdx: index("workspace_memos_member_idx").on(t.memberId, t.sortOrder),
  pinnedIdx: index("workspace_memos_pinned_idx").on(t.isPinned),
  calendarIdx: index("ws_memos_calendar_idx").on(t.showInCalendar, t.eventDate),
}));

// 3. 일정/이벤트
export const workspaceEvents = pgTable("workspace_events", {
  id: serial("id").primaryKey(),
  memberId: integer("member_id").references(() => members.id, { onDelete: "cascade" }).notNull(),
  title: varchar("title", { length: 300 }).notNull(),
  location: varchar("location", { length: 300 }),
  startAt: timestamp("start_at").notNull(),
  endAt: timestamp("end_at").notNull(),
  allDay: boolean("all_day").default(false).notNull(),
  color: varchar("color", { length: 20 }).default("blue").notNull(),
  description: text("description"),
  attendees: jsonb("attendees").default(sql`'[]'::jsonb`),                   // [{memberId, status, respondedAt}]
  externalRef: varchar("external_ref", { length: 200 }),
  // ⭐ 이벤트 분류
  eventType: varchar("event_type", { length: 30 }).default("general").notNull(),
    // 'general' | 'meeting' | 'board_meeting' | 'counseling' | 'deadline' | 'recurring'
  // ⭐ 외부 리소스 연결
  sourceType: varchar("source_type", { length: 30 }),
  sourceId: integer("source_id"),
  // ⭐ 반복 규칙 (RRULE)
  recurringRule: varchar("recurring_rule", { length: 200 }),                 // "FREQ=MONTHLY;BYMONTHDAY=15"
  recurringParentId: integer("recurring_parent_id"),
  // ⭐ 리마인더
  reminderConfig: jsonb("reminder_config").default(sql`'{}'::jsonb`),
  remindersSentAt: jsonb("reminders_sent_at").default(sql`'[]'::jsonb`),
  // ⭐ AI 생성 식별
  createdByAgent: varchar("created_by_agent", { length: 20 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  memberIdx: index("workspace_events_member_idx").on(t.memberId),
  startIdx: index("workspace_events_start_idx").on(t.startAt),
  rangeIdx: index("workspace_events_range_idx").on(t.startAt, t.endAt),
  typeIdx: index("workspace_events_type_idx").on(t.eventType),
  sourceIdx: index("workspace_events_source_idx").on(t.sourceType, t.sourceId),
}));

// 4. 마감일 변경 요청
export const taskDueChangeRequests = pgTable("task_due_change_requests", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").references(() => workspaceTasks.id, { onDelete: "cascade" }).notNull(),
  requestedBy: integer("requested_by").references(() => members.id, { onDelete: "cascade" }).notNull(),
  currentDue: timestamp("current_due"),  // [감사#97] 마감일 없는 작업의 변경요청 허용 위해 nullable (migrate-due-change-nullable 적용 완료)
  newDue: timestamp("new_due").notNull(),
  reason: text("reason").notNull(),
  status: varchar("status", { length: 20 }).default("pending").notNull(),  // pending | approved | rejected
  reviewedBy: integer("reviewed_by").references(() => members.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at"),
  reviewNote: text("review_note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  taskIdx: index("task_due_change_task_idx").on(t.taskId),
  requesterIdx: index("task_due_change_requester_idx").on(t.requestedBy),
  statusIdx: index("task_due_change_status_idx").on(t.status),
}));

// 5. 일일 브리핑 캐시 (Agent-8)
export const dailyBriefings = pgTable("daily_briefings", {
  id: serial("id").primaryKey(),
  memberId: integer("member_id").references(() => members.id, { onDelete: "cascade" }).notNull(),
  briefingDate: timestamp("briefing_date", { mode: "date" }).notNull(),
  urgentCount: integer("urgent_count").default(0).notNull(),
  todayDueCount: integer("today_due_count").default(0).notNull(),
  tomorrowDueCount: integer("tomorrow_due_count").default(0).notNull(),
  newAssignments: integer("new_assignments").default(0).notNull(),
  // ⭐ 풍부한 인사이트 (Agent-8)
  overdueCount: integer("overdue_count").default(0).notNull(),
  inProgressCount: integer("in_progress_count").default(0).notNull(),
  completedYesterdayCount: integer("completed_yesterday_count").default(0).notNull(),
  todayEventsCount: integer("today_events_count").default(0).notNull(),
  riskAlerts: jsonb("risk_alerts").default(sql`'[]'::jsonb`),               // [{type, taskId, message, severity}]
  aiSuggestions: jsonb("ai_suggestions").default(sql`'[]'::jsonb`),         // Agent-8이 제안하는 오늘의 우선순위
  readAt: timestamp("read_at"),
  summaryMd: text("summary_md"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  uqMemberDate: uniqueIndex("uq_daily_briefings_member_date").on(t.memberId, t.briefingDate),
}));

export type WorkspaceTask = typeof workspaceTasks.$inferSelect;
export type NewWorkspaceTask = typeof workspaceTasks.$inferInsert;
export type WorkspaceMemo = typeof workspaceMemos.$inferSelect;
export type NewWorkspaceMemo = typeof workspaceMemos.$inferInsert;
export type WorkspaceEvent = typeof workspaceEvents.$inferSelect;
export type NewWorkspaceEvent = typeof workspaceEvents.$inferInsert;
export type TaskDueChangeRequest = typeof taskDueChangeRequests.$inferSelect;
export type NewTaskDueChangeRequest = typeof taskDueChangeRequests.$inferInsert;
export type DailyBriefing = typeof dailyBriefings.$inferSelect;
export type NewDailyBriefing = typeof dailyBriefings.$inferInsert;

// ═══════════════════════════════════════════════════════
// Phase 3 Step 1.5 — 워크스페이스 고도화 (옵션 A)
// ═══════════════════════════════════════════════════════

// 6. 리마인더 발송 기록 (Agent-8 작동 근거)
export const workspaceNotifications = pgTable("workspace_notifications", {
  id: serial("id").primaryKey(),
  memberId: integer("member_id").references(() => members.id, { onDelete: "cascade" }).notNull(),
  sourceType: varchar("source_type", { length: 20 }).notNull(),  // 'task' | 'event' | 'due_change' | 'briefing'
  sourceId: integer("source_id").notNull(),
  notifType: varchar("notif_type", { length: 30 }).notNull(),
    // 'reminder_3d' | 'reminder_1d' | 'reminder_2h' | 'overdue' | 'assigned' | 'approved' | 'rejected'
  channel: varchar("channel", { length: 20 }).notNull(),         // 'bell' | 'email' | 'sms' | 'kakao'
  title: varchar("title", { length: 300 }).notNull(),
  body: text("body"),
  actionUrl: varchar("action_url", { length: 500 }),
  sentAt: timestamp("sent_at").defaultNow().notNull(),
  readAt: timestamp("read_at"),
  deliveryStatus: varchar("delivery_status", { length: 20 }).default("sent").notNull(),
    // 'sent' | 'delivered' | 'failed'
  errorMessage: text("error_message"),

  /* ───────── ★ Phase 21 R2+R3 — 알림 분류 ─────────
   * category: 'assign' | 'due' | 'mention' | 'transfer' | 'watcher' | 'system'
   * (notifType과 별개 의미 — notifType은 알림 발송 종류, category는 UI 분류용)
   */
  category: varchar("category", { length: 20 }),
}, (t) => ({
  memberIdx: index("ws_notifs_member_idx").on(t.memberId, t.readAt),
  sourceIdx: index("ws_notifs_source_idx").on(t.sourceType, t.sourceId),
  typeIdx: index("ws_notifs_type_idx").on(t.notifType),
  categoryIdx: index("ws_notifs_category_idx").on(t.category),
}));

export type WorkspaceNotification = typeof workspaceNotifications.$inferSelect;
export type NewWorkspaceNotification = typeof workspaceNotifications.$inferInsert;

// 7. 팀 활동 피드 (Activity Log — Agent-9 감사 근거)
export const workspaceActivityLog = pgTable("workspace_activity_log", {
  id: serial("id").primaryKey(),
  actorId: integer("actor_id").references(() => members.id, { onDelete: "set null" }),
  actorName: varchar("actor_name", { length: 100 }),              // 삭제돼도 유지
  actionType: varchar("action_type", { length: 40 }).notNull(),
    // 'task.create' | 'task.complete' | 'task.assign' | 'event.create' | 'due.request' | 'due.approve' ...
  targetType: varchar("target_type", { length: 20 }),             // 'task' | 'event' | 'memo'
  targetId: integer("target_id"),
  targetTitle: varchar("target_title", { length: 300 }),
  metadata: jsonb("metadata").default(sql`'{}'::jsonb`),
  visibility: varchar("visibility", { length: 20 }).default("team").notNull(),
    // 'private' | 'team' | 'public'
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  actorIdx: index("ws_activity_actor_idx").on(t.actorId, t.createdAt),
  targetIdx: index("ws_activity_target_idx").on(t.targetType, t.targetId),
  typeIdx: index("ws_activity_type_idx").on(t.actionType),
  dateIdx: index("ws_activity_date_idx").on(t.createdAt),
}));

export type WorkspaceActivityLog = typeof workspaceActivityLog.$inferSelect;
export type NewWorkspaceActivityLog = typeof workspaceActivityLog.$inferInsert;

// ============================================================
// Phase 3-extra: 파일함 (workspace files)
// ============================================================

export const workspaceFolders = pgTable("workspace_folders", {
  id: serial("id").primaryKey(),
  parentId: integer("parent_id"),
  name: varchar("name", { length: 200 }).notNull(),
  ownerId: integer("owner_id").notNull(),
  path: varchar("path", { length: 500 }),
  depth: integer("depth").default(0).notNull(),
  isShared: boolean("is_shared").default(false).notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
}, (table) => ({
  parentNameUnique: uniqueIndex("ws_folders_parent_name_unique")
    .on(table.parentId, table.name)
    .where(sql`deleted_at IS NULL`),
  ownerIdx: index("ws_folders_owner_idx").on(table.ownerId),
  pathIdx: index("ws_folders_path_idx").on(table.path),
  deletedIdx: index("ws_folders_deleted_idx").on(table.deletedAt),
}));

export const workspaceFiles = pgTable("workspace_files", {
  id: serial("id").primaryKey(),
  folderId: integer("folder_id"),
  ownerId: integer("owner_id").notNull(),
  name: varchar("name", { length: 300 }).notNull(),
  r2Key: varchar("r2_key", { length: 500 }).notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }),
  mimeType: varchar("mime_type", { length: 100 }),
  ext: varchar("ext", { length: 20 }),
  sha256: varchar("sha256", { length: 64 }),
  uploadStatus: varchar("upload_status", { length: 20 }).default("pending").notNull(),
  downloadCount: integer("download_count").default(0).notNull(),
  description: text("description"),
  tags: jsonb("tags").default([]).notNull(),
  isShared: boolean("is_shared").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
}, (table) => ({
  folderIdx: index("ws_files_folder_idx").on(table.folderId),
  ownerIdx: index("ws_files_owner_idx").on(table.ownerId),
  sha256Idx: index("ws_files_sha256_idx").on(table.sha256),
  deletedIdx: index("ws_files_deleted_idx").on(table.deletedAt),
  nameIdx: index("ws_files_name_idx").on(table.name),
}));

export const workspaceFileShares = pgTable("workspace_file_shares", {
  id: serial("id").primaryKey(),
  targetType: varchar("target_type", { length: 10 }).notNull(),
  targetId: integer("target_id").notNull(),
  sharedBy: integer("shared_by").notNull(),
  sharedWith: integer("shared_with"),
  permission: varchar("permission", { length: 10 }).default("view").notNull(),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  targetIdx: index("ws_fshare_target_idx").on(table.targetType, table.targetId),
  withIdx: index("ws_fshare_with_idx").on(table.sharedWith),
  uniqueShare: uniqueIndex("ws_fshare_unique")
    .on(table.targetType, table.targetId, table.sharedWith),
}));

// ═══════════════════════════════════════════════════════
// Phase 3 Step 7-B — 카드 고도화 (댓글/보고서/첨부)
// ═══════════════════════════════════════════════════════

// 1. 댓글 스레드 (@멘션)
export const workspaceTaskComments = pgTable("workspace_task_comments", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").references(() => workspaceTasks.id, { onDelete: "cascade" }).notNull(),
  memberId: integer("member_id").references(() => members.id, { onDelete: "cascade" }).notNull(),
  content: text("content").notNull(),
  mentions: jsonb("mentions").default(sql`'[]'::jsonb`).notNull(),   // [memberId, ...]
  parentCommentId: integer("parent_comment_id"),                      // 대댓글, self-ref (FK 생략)
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
}, (t) => ({
  taskIdx: index("task_comments_task_idx").on(t.taskId),
  memberIdx: index("task_comments_member_idx").on(t.memberId),
  parentIdx: index("task_comments_parent_idx").on(t.parentCommentId),
}));

// 2. 보고서 (중간/완료)
export const workspaceTaskReports = pgTable("workspace_task_reports", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").references(() => workspaceTasks.id, { onDelete: "cascade" }).notNull(),
  memberId: integer("member_id").references(() => members.id, { onDelete: "cascade" }).notNull(),
  type: varchar("type", { length: 20 }).notNull(),                   // progress | completion
  title: varchar("title", { length: 300 }),
  content: text("content").notNull(),
  attachedFileIds: jsonb("attached_file_ids").default(sql`'[]'::jsonb`).notNull(),  // [fileId, ...]
  reviewStatus: varchar("review_status", { length: 20 }).default("pending").notNull(), // pending | approved | rejected
  reviewedBy: integer("reviewed_by").references(() => members.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at"),
  reviewReason: text("review_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  taskIdx: index("task_reports_task_idx").on(t.taskId),
  typeIdx: index("task_reports_type_idx").on(t.type),
  reviewIdx: index("task_reports_review_idx").on(t.reviewStatus),
}));

// 3. 카드 ↔ 파일함 연결 (UNIQUE: taskId+fileId)
export const workspaceTaskAttachments = pgTable("workspace_task_attachments", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").references(() => workspaceTasks.id, { onDelete: "cascade" }).notNull(),
  fileId: integer("file_id").references(() => workspaceFiles.id, { onDelete: "cascade" }).notNull(),
  attachedBy: integer("attached_by").references(() => members.id, { onDelete: "cascade" }).notNull(),
  attachedAt: timestamp("attached_at").defaultNow().notNull(),
}, (t) => ({
  taskIdx: index("task_attach_task_idx").on(t.taskId),
  fileIdx: index("task_attach_file_idx").on(t.fileId),
  uniqueAttach: uniqueIndex("task_attach_unique").on(t.taskId, t.fileId),
}));

export type WorkspaceTaskComment = typeof workspaceTaskComments.$inferSelect;
export type NewWorkspaceTaskComment = typeof workspaceTaskComments.$inferInsert;
export type WorkspaceTaskReport = typeof workspaceTaskReports.$inferSelect;
export type NewWorkspaceTaskReport = typeof workspaceTaskReports.$inferInsert;
export type WorkspaceTaskAttachment = typeof workspaceTaskAttachments.$inferSelect;
export type NewWorkspaceTaskAttachment = typeof workspaceTaskAttachments.$inferInsert;

// ═══════════════════════════════════════════════════════
// Phase 3 Step 7-C — 업무 템플릿 (반복 업무 양식)
// ═══════════════════════════════════════════════════════
export const workspaceTaskTemplates = pgTable("workspace_task_templates", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),
  description: text("description"),                                      // 마크다운, 작업 description 기본값
  priority: varchar("priority", { length: 20 }).default("normal").notNull(),
  estimatedHours: numeric("estimated_hours", { precision: 5, scale: 1 }),
  defaultSubtasks: jsonb("default_subtasks").default(sql`'[]'::jsonb`).notNull(),  // [{text, done:false}, ...]
  defaultTags: jsonb("default_tags").default(sql`'[]'::jsonb`).notNull(),          // [tag1, tag2, ...]
  createdBy: integer("created_by").references(() => members.id, { onDelete: "set null" }),
  usageCount: integer("usage_count").default(0).notNull(),
  isShared: boolean("is_shared").default(true).notNull(),                // false면 본인만
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  nameIdx: index("task_templates_name_idx").on(t.name),
  createdByIdx: index("task_templates_created_by_idx").on(t.createdBy),
}));

export type WorkspaceTaskTemplate = typeof workspaceTaskTemplates.$inferSelect;
export type NewWorkspaceTaskTemplate = typeof workspaceTaskTemplates.$inferInsert;

/* =========================================================
   ★ 6순위 #6 — 교원 회원 자격 변경 신청 (작업 A)
   ========================================================= */
export const eligibilityChangeRequests = pgTable("eligibility_change_requests", {
  id: serial("id").primaryKey(),
  memberId: integer("member_id")
    .references(() => members.id, { onDelete: "cascade" })
    .notNull(),
  currentType: varchar("current_type", { length: 30 }),
  requestedType: varchar("requested_type", { length: 30 }).notNull(),
  reason: text("reason"),
  evidenceBlobId: integer("evidence_blob_id")
    .references(() => blobUploads.id, { onDelete: "set null" }),
  status: varchar("status", { length: 20 }).default("pending").notNull(),
  adminNote: text("admin_note"),
  reviewedBy: integer("reviewed_by")
    .references(() => members.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  memberIdx: index("eligibility_req_member_idx").on(t.memberId),
  statusIdx: index("eligibility_req_status_idx").on(t.status),
  createdIdx: index("eligibility_req_created_idx").on(t.createdAt),
}));

export type EligibilityChangeRequest = typeof eligibilityChangeRequests.$inferSelect;
export type NewEligibilityChangeRequest = typeof eligibilityChangeRequests.$inferInsert;

/* =========================================================
   === 작업 C: CSV 자동 매핑 (#15) ===
   효성 + 기업은행 CSV → pending_donations 적재 → 자동 매칭 → 확정
   마이그레이션: migrate-add-pending-donations
   ========================================================= */

export const pendingDonations = pgTable("pending_donations", {
  id: serial("id").primaryKey(),

  /* 출처 */
  source: varchar("source", { length: 20 }).notNull(),          // 'hyosung' | 'ibk'
  sourceFileName: varchar("source_file_name", { length: 200 }),
  sourceRowIndex: integer("source_row_index"),
  rawData: jsonb("raw_data").default(sql`'{}'::jsonb`),

  /* 파싱 결과 */
  parsedName: varchar("parsed_name", { length: 100 }),
  parsedAmount: integer("parsed_amount"),
  parsedDate: timestamp("parsed_date", { mode: "date" }),
  parsedMemo: text("parsed_memo"),
  parsedAccountTail4: varchar("parsed_account_tail4", { length: 4 }),  // 기업은행 입금 계좌 끝4자리

  /* 매칭 */
  matchedMemberId: integer("matched_member_id").references(() => members.id, { onDelete: "set null" }),
  matchScore: numeric("match_score", { precision: 4, scale: 2 }),
  matchReason: varchar("match_reason", { length: 200 }),

  /* 상태 */
  status: varchar("status", { length: 20 }).default("pending").notNull(),
    // 'pending' | 'matched' | 'confirmed' | 'ignored'
  confirmedDonationId: integer("confirmed_donation_id").references(() => donations.id, { onDelete: "set null" }),

  importedBy: integer("imported_by").references(() => members.id, { onDelete: "set null" }),
  confirmedBy: integer("confirmed_by").references(() => members.id, { onDelete: "set null" }),
  confirmedAt: timestamp("confirmed_at"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  sourceIdx: index("pending_donations_source_idx").on(t.source),
  statusIdx: index("pending_donations_status_idx").on(t.status),
  matchedIdx: index("pending_donations_matched_idx").on(t.matchedMemberId),
  dateIdx: index("pending_donations_date_idx").on(t.parsedDate),
  createdIdx: index("pending_donations_created_idx").on(t.createdAt),
}));

export type PendingDonation = typeof pendingDonations.$inferSelect;
export type NewPendingDonation = typeof pendingDonations.$inferInsert;

/* 매칭 룰 가중치 (어드민이 조정 가능, 기본값 시드) */
export const donationMatchingRules = pgTable("donation_matching_rules", {
  id: serial("id").primaryKey(),
  ruleKey: varchar("rule_key", { length: 30 }).notNull().unique(),
    // 'name_exact' | 'name_partial' | 'amount_exact' | 'date_window' | 'account_tail4'
  weight: numeric("weight", { precision: 4, scale: 2 }).default(sql`1.00`).notNull(),
  threshold: numeric("threshold", { precision: 4, scale: 2 }),
  isActive: boolean("is_active").default(true).notNull(),
  description: varchar("description", { length: 200 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type DonationMatchingRule = typeof donationMatchingRules.$inferSelect;
export type NewDonationMatchingRule = typeof donationMatchingRules.$inferInsert;

/* =========================================================
   ★ 6순위 #8: 변호사·심리상담사 1:1 매칭 채팅 (2026-05-10)
   - DESIGN_EXPERT_MATCHING.md 참조
   - 메인 채팅 소유. A·B 채팅에서 본 섹션 정의 변경 금지
   ========================================================= */
export const expertMatches = pgTable("expert_matches", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => members.id, { onDelete: "cascade" }).notNull(),
  expertId: integer("expert_id").references(() => members.id, { onDelete: "set null" }),
  matchType: varchar("match_type", { length: 20 }),       // 'lawyer' | 'counselor'
  sourceDomain: varchar("source_domain", { length: 30 }), // 'incident'|'harassment'|'legal'|'support'
  sourceId: integer("source_id"),
  chatRoomId: integer("chat_room_id").references(() => chatRooms.id, { onDelete: "set null" }),
  status: varchar("status", { length: 20 }).default("pending").notNull(),
    // 'pending' | 'matched' | 'active' | 'closed' | 'rejected'
  reason: text("reason"),
  adminNote: text("admin_note"),
  assignedBy: integer("assigned_by").references(() => members.id, { onDelete: "set null" }),
  assignedAt: timestamp("assigned_at"),
  closedAt: timestamp("closed_at"),
  closedReason: varchar("closed_reason", { length: 50 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  userIdx: index("expert_matches_user_idx").on(t.userId),
  expertIdx: index("expert_matches_expert_idx").on(t.expertId),
  statusIdx: index("expert_matches_status_idx").on(t.status),
}));

export type ExpertMatch = typeof expertMatches.$inferSelect;
export type NewExpertMatch = typeof expertMatches.$inferInsert;

/* =========================================================
   ★ Phase 4: 대표 보고 시스템 + Agent-9 (2026-05-10)
   - DESIGN_PHASE4_REPORT.md 참조
   - 메인 채팅 소유. A·B 채팅에서 본 섹션 정의 변경 금지
   ========================================================= */
export const reportSnapshots = pgTable("report_snapshots", {
  id: serial("id").primaryKey(),
  reportType: varchar("report_type", { length: 20 }).default("weekly").notNull(),
    // 'weekly' | 'custom'
  periodStart: timestamp("period_start").notNull(),
  periodEnd:   timestamp("period_end").notNull(),
  stats:       jsonb("stats").default(sql`'{}'::jsonb`).notNull(),
    // ReportStats 구조 — DESIGN_PHASE4_REPORT.md §4
  aiSummary:   text("ai_summary"),
  aiAlerts:    jsonb("ai_alerts").default(sql`'[]'::jsonb`),
    // [{type: string, message: string, severity: 'low'|'medium'|'high'}]
  generatedBy: integer("generated_by").references(() => members.id, { onDelete: "set null" }),
    // null = cron 자동 생성
  sentEmailAt: timestamp("sent_email_at"),
  sentTo:      jsonb("sent_to").default(sql`'[]'::jsonb`),
    // [{ email: string, name: string }]
  createdAt:   timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  typePeriodIdx: index("report_snapshots_type_period_idx").on(t.reportType, t.periodStart),
  createdIdx:    index("report_snapshots_created_idx").on(t.createdAt),
}));

export type ReportSnapshot = typeof reportSnapshots.$inferSelect;
export type NewReportSnapshot = typeof reportSnapshots.$inferInsert;

/* =========================================================
   === Phase 5~7: 재정 관리 (예산·지출) — 옛 테이블 ===
   Phase 22-B-R3(2026-05-15)에서 코드 정의 제거.
   budget_categories·budgets·expenditures 는 22-B-R1·R2에서
   expense_categories·budget_plans·budget_lines·expenses 로 단일화 완료.
   ⚠️ DB 테이블·데이터는 롤백 대비 보존 — 코드 정의만 삭제.
   ========================================================= */

/* =========================================================
   === Phase 8: 알림 채널 통합 디스패처 ===
   migrate-notification-dispatch-logs 호출 후 활성화됨
   메인 채팅·A 채팅 소유. B·C 채팅에서 본 섹션 정의 변경 금지.
   ========================================================= */

export const notificationDispatchLogs = pgTable("notification_dispatch_logs", {
  id:                serial("id").primaryKey(),
  notificationId:    integer("notification_id"),           // FK → notifications.id (인앱 채널 생성 시)
  eventType:         text("event_type").notNull(),         // NotifyEvent enum 값 (예: "billing.success")
  targetType:        text("target_type").notNull(),        // "member" | "admin"
  targetId:          integer("target_id").notNull(),       // members.id
  channel:           text("channel").notNull(),            // "inapp" | "email" | "sms" | "kakao"
  status:            text("status").notNull().default("pending"), // "pending" | "sent" | "failed" | "dead"
  attempt:           integer("attempt").notNull().default(0),    // 재시도 횟수 (0~3)
  providerMessageId: text("provider_message_id"),          // Resend message ID 등
  paramsSnapshot:    jsonb("params_snapshot"),             // 템플릿 파라미터 스냅샷 (디버깅용)
  error:             text("error"),                        // 실패 사유 (500자)
  latencyMs:         integer("latency_ms"),                // 발송 소요시간 ms
  createdAt:         timestamp("created_at").defaultNow().notNull(),
  nextRetryAt:       timestamp("next_retry_at"),           // 재시도 예정 시각 (cron 폴링)
  sentAt:            timestamp("sent_at"),                 // 최종 성공 시각
}, (t) => ({
  targetIdx:      index("dispatch_logs_target_idx").on(t.targetType, t.targetId, t.createdAt),
  // 부분 인덱스(WHERE status='pending')는 SQL에서만 지원 — migrate 함수에서 생성
  pendingRetryIdx: index("dispatch_logs_pending_retry_idx").on(t.status, t.nextRetryAt),
  eventTypeIdx:    index("dispatch_logs_event_type_idx").on(t.eventType, t.createdAt),
  channelStatusIdx: index("dispatch_logs_channel_status_idx").on(t.channel, t.status, t.createdAt),
}));

export type NotificationDispatchLog = typeof notificationDispatchLogs.$inferSelect;
export type NewNotificationDispatchLog = typeof notificationDispatchLogs.$inferInsert;

/* =========================================================
   === Phase 9-B: 사용자 알림 수신 설정 ===
   migrate-phase9-notify-prefs 호출 후 활성화됨
   C 채팅 소유. 타 채팅에서 본 섹션 변경 금지.
   ========================================================= */

export const notificationPreferences = pgTable("notification_preferences", {
  id:         bigserial("id", { mode: "number" }).primaryKey(),
  memberId:   integer("member_id").references(() => members.id, { onDelete: "cascade" }).notNull(),
  eventType:  text("event_type").notNull(),
  channels:   jsonb("channels").default(sql`'[]'::jsonb`).notNull(),
  createdAt:  timestamp("created_at").defaultNow().notNull(),
  updatedAt:  timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  memberIdx:  index("notification_prefs_member_idx").on(t.memberId),
  uniquePref: uniqueIndex("notification_prefs_unique").on(t.memberId, t.eventType),
}));

export type NotificationPreference = typeof notificationPreferences.$inferSelect;
export type NewNotificationPreference = typeof notificationPreferences.$inferInsert;

export const notificationAdminSettings = pgTable("notification_admin_settings", {
  eventType:       text("event_type").primaryKey(),
  defaultChannels: jsonb("default_channels").default(sql`'[]'::jsonb`).notNull(),
  forcedChannels:  jsonb("forced_channels").default(sql`'[]'::jsonb`).notNull(),
  /* ★ 2026-05-16: 자동 발송 통합 CMS (B안) — 채널별 템플릿 매핑 + on/off + UI 라벨.
     migrate-notification-cms.ts로 컬럼 추가됨. templateId NULL이면 어댑터가
     기존 코드(하드코딩) 함수로 폴백. */
  emailTemplateId: bigint("email_template_id", { mode: "number" }),
  smsTemplateId:   bigint("sms_template_id", { mode: "number" }),
  kakaoTemplateId: bigint("kakao_template_id", { mode: "number" }),
  inappTemplateId: bigint("inapp_template_id", { mode: "number" }),
  isActive:        boolean("is_active").default(true).notNull(),
  displayLabel:    text("display_label"),
  description:     text("description"),
  updatedAt:       timestamp("updated_at").defaultNow().notNull(),
  updatedBy:       integer("updated_by").references(() => members.id, { onDelete: "set null" }),
});

export type NotificationAdminSetting = typeof notificationAdminSettings.$inferSelect;
export type NewNotificationAdminSetting = typeof notificationAdminSettings.$inferInsert;

/* === 2026-05-27: 카카오 알림톡 템플릿 관리 (운영자 CMS 자동 CRUD·솔라피 API 연동) ===
   migrate-kakao-templates.ts로 생성. 운영자가 등록→검수요청→승인 관리.
   event_key = NotifyEvent 값(billing.failed 등)으로 시스템 자동 발송에 연결.
   런타임 쿼리는 raw SQL(어댑터·cron·admin API) — 본 정의는 타입·문서용. */
export const kakaoAlimtalkTemplates = pgTable("kakao_alimtalk_templates", {
  id:                    serial("id").primaryKey(),
  eventKey:              varchar("event_key", { length: 40 }),
  name:                  varchar("name", { length: 120 }).notNull(),
  content:               text("content").notNull(),
  variables:             jsonb("variables").default(sql`'[]'::jsonb`),
  categoryCode:          varchar("category_code", { length: 20 }).default("004001"),
  emphasizeTitle:        varchar("emphasize_title", { length: 50 }),
  emphasizeSubtitle:     varchar("emphasize_subtitle", { length: 50 }).default("교사유가족협의회"),
  buttons:               jsonb("buttons").default(sql`'[]'::jsonb`),
  pfId:                  varchar("pf_id", { length: 60 }),
  solapiTemplateId:      varchar("solapi_template_id", { length: 80 }),
  status:                varchar("status", { length: 16 }).notNull().default("draft"),
  solapiStatus:          varchar("solapi_status", { length: 20 }),
  rejectReason:          text("reject_reason"),
  isActive:              boolean("is_active").notNull().default(true),
  inspectionRequestedAt: timestamp("inspection_requested_at"),
  approvedAt:            timestamp("approved_at"),
  createdBy:             integer("created_by").references(() => members.id),
  createdAt:             timestamp("created_at").defaultNow(),
  updatedAt:             timestamp("updated_at").defaultNow(),
});
export type KakaoAlimtalkTemplate = typeof kakaoAlimtalkTemplates.$inferSelect;

/* === 2026-05-16: 효성 후원자 사이트 가입 흐름 A안 — 전화 인증 코드 저장 ===
   migrate-phone-verifications.ts로 테이블 생성됨. */
export const phoneVerifications = pgTable("phone_verifications", {
  id:               bigserial("id", { mode: "number" }).primaryKey(),
  phone:            varchar("phone", { length: 20 }).notNull(),
  code:             varchar("code", { length: 10 }).notNull(),
  verifyToken:      varchar("verify_token", { length: 64 }),
  matchedMemberId:  integer("matched_member_id").references(() => members.id, { onDelete: "set null" }),
  verified:         boolean("verified").default(false).notNull(),
  attempts:         integer("attempts").default(0).notNull(),
  expiresAt:        timestamp("expires_at").notNull(),
  tokenExpiresAt:   timestamp("token_expires_at"),
  ip:               varchar("ip", { length: 45 }),
  createdAt:        timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  phoneIdx:   index("phone_verifs_phone_idx").on(t.phone, t.createdAt),
  expiresIdx: index("phone_verifs_expires_idx").on(t.expiresAt),
}));

export type PhoneVerification    = typeof phoneVerifications.$inferSelect;
export type NewPhoneVerification = typeof phoneVerifications.$inferInsert;

/* === Phase 10 R1 — 템플릿 빌더 === */

export const communicationTemplates = pgTable("communication_templates", {
  id:           bigserial("id", { mode: "number" }).primaryKey(),
  name:         varchar("name", { length: 100 }).notNull(),
  channel:      text("channel").notNull(),
  category:     text("category").notNull(),
  subject:      text("subject"),
  bodyTemplate: text("body_template").notNull(),
  variables:    jsonb("variables").default(sql`'[]'::jsonb`).notNull(),
  isActive:     boolean("is_active").default(true).notNull(),
  createdBy:    integer("created_by").references(() => members.id, { onDelete: "set null" }),
  updatedBy:    integer("updated_by").references(() => members.id, { onDelete: "set null" }),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
  updatedAt:    timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  channelIdx:  index("comm_templates_channel_idx").on(t.channel),
  categoryIdx: index("comm_templates_category_idx").on(t.category),
  activeIdx:   index("comm_templates_active_idx").on(t.isActive),
}));

export type CommunicationTemplate    = typeof communicationTemplates.$inferSelect;
export type NewCommunicationTemplate = typeof communicationTemplates.$inferInsert;

/* =========================================================
   === Phase 10 R2 — 수신자 그룹 (recipient_groups) ===
   criteria 구조:
     { "type": "filter", "logic": "and"|"or",
       "filters": [{field, op, value 또는 values}, ...] }
     { "type": "manual", "memberIds": [1,2,3,...] }
   ========================================================= */
export const recipientGroups = pgTable("recipient_groups", {
  id:          bigserial("id", { mode: "number" }).primaryKey(),
  name:        varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  criteria:    jsonb("criteria").notNull(),
  isActive:    boolean("is_active").default(true).notNull(),
  createdBy:   integer("created_by").references(() => members.id, { onDelete: "set null" }),
  updatedBy:   integer("updated_by").references(() => members.id, { onDelete: "set null" }),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
  updatedAt:   timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  activeIdx: index("recipient_groups_active_idx").on(t.isActive),
  nameIdx:   index("recipient_groups_name_idx").on(t.name),
}));

export type RecipientGroup    = typeof recipientGroups.$inferSelect;
export type NewRecipientGroup = typeof recipientGroups.$inferInsert;

/* =========================================================
   === Phase 10 R3 — 발송 큐 (communication_send_jobs / communication_send_recipients) ===
   ========================================================= */

export const communicationSendJobs = pgTable("communication_send_jobs", {
  id:                bigserial("id", { mode: "number" }).primaryKey(),
  name:              varchar("name", { length: 200 }).notNull(),
  templateId:        integer("template_id").notNull()
                       .references(() => communicationTemplates.id, { onDelete: "restrict" }),
  recipientGroupId:  integer("recipient_group_id").notNull()
                       .references(() => recipientGroups.id, { onDelete: "restrict" }),
  channel:           text("channel").notNull(),
  scheduleType:      text("schedule_type").notNull(),
  scheduledAt:       timestamp("scheduled_at"),
  status:            text("status").notNull().default("pending"),
  totalRecipients:   integer("total_recipients").notNull().default(0),
  successCount:      integer("success_count").notNull().default(0),
  failureCount:      integer("failure_count").notNull().default(0),
  lastError:         text("last_error"),
  startedAt:         timestamp("started_at"),
  completedAt:       timestamp("completed_at"),
  createdBy:            integer("created_by").references(() => members.id, { onDelete: "set null" }),
  createdAt:            timestamp("created_at").defaultNow().notNull(),
  updatedAt:            timestamp("updated_at").defaultNow().notNull(),
  // Phase 10 R4 — AI 트리거가 생성한 작업 표시 (FK는 마이그로 DB에 적용됨)
  triggeredByAutoId:    integer("triggered_by_auto_id"),
  // 새 발송 만들기 시 사용자가 임시 수정한 제목·본문 (템플릿 원본 유지) — migrate-send-job-overrides
  subjectOverride:      text("subject_override"),
  bodyOverride:         text("body_override"),
  // 미리보기에서 사용자가 체크 해제한 회원 ID 배열 — cron 발송 시 그룹 resolve 결과에서 제외
  excludedMemberIds:    jsonb("excluded_member_ids").default(sql`'[]'::jsonb`),
  /* ★ 2026-05-16: 이메일 첨부파일 (blob_uploads.id 배열). 이메일 채널 전용.
     SMS/카카오/MMS는 무시. migrate-send-jobs-attachments.ts로 컬럼 추가됨. */
  attachmentBlobIds:    jsonb("attachment_blob_ids").default(sql`'[]'::jsonb`).notNull(),
  /* ★ 2026-05-16: "메일 웹 감싸기" 옵션. true면 디스패처가 이메일 본문을
     lib/email.ts baseLayout()으로 wrap. 템플릿의 use_siren_layout과 별개로
     발송 단위 토글. */
  wrapEmailWithLayout:  boolean("wrap_email_with_layout").default(false).notNull(),
}, (t) => ({
  statusIdx:    index("send_jobs_status_idx").on(t.status),
  scheduledIdx: index("send_jobs_scheduled_idx").on(t.scheduledAt),
  templateIdx:  index("send_jobs_template_idx").on(t.templateId),
  groupIdx:     index("send_jobs_group_idx").on(t.recipientGroupId),
}));

export type CommunicationSendJob    = typeof communicationSendJobs.$inferSelect;
export type NewCommunicationSendJob = typeof communicationSendJobs.$inferInsert;

export const communicationSendRecipients = pgTable("communication_send_recipients", {
  id:              bigserial("id", { mode: "number" }).primaryKey(),
  jobId:           integer("job_id").notNull()
                     .references(() => communicationSendJobs.id, { onDelete: "cascade" }),
  memberId:        integer("member_id").notNull()
                     .references(() => members.id, { onDelete: "set null" }),
  channel:         text("channel").notNull(),
  status:          text("status").notNull().default("pending"),
  sentAt:          timestamp("sent_at"),
  error:           text("error"),
  retryCount:      integer("retry_count").notNull().default(0),
  renderedSubject: text("rendered_subject"),
  renderedBody:    text("rendered_body").notNull(),
  createdAt:       timestamp("created_at").defaultNow().notNull(),
  updatedAt:       timestamp("updated_at").defaultNow().notNull(),
  // Phase 10 R4 — 이메일 오픈/클릭 추적 (track-open·track-click·dispatcher에서 사용)
  trackingToken:   varchar("tracking_token", { length: 64 }),
  openedAt:        timestamp("opened_at"),
  clickedAt:       timestamp("clicked_at"),
  openCount:       integer("open_count").notNull().default(0),
  clickCount:      integer("click_count").notNull().default(0),
}, (t) => ({
  jobIdx:           index("send_recipients_job_idx").on(t.jobId),
  jobStatusIdx:     index("send_recipients_job_status_idx").on(t.jobId, t.status),
  memberIdx:        index("send_recipients_member_idx").on(t.memberId),
  trackingTokenIdx: index("send_recipients_tracking_token_idx").on(t.trackingToken),
}));

export type CommunicationSendRecipient    = typeof communicationSendRecipients.$inferSelect;
export type NewCommunicationSendRecipient = typeof communicationSendRecipients.$inferInsert;

/* === Phase 10 R3 정의 끝 === */

/* === Phase 10 R4 === */

// 추적 이벤트 로그 (오픈/클릭)
export const communicationSendTracking = pgTable("communication_send_tracking", {
  id:          bigserial("id", { mode: "number" }).primaryKey(),
  recipientId: bigint("recipient_id", { mode: "number" }).notNull()
                 .references(() => communicationSendRecipients.id, { onDelete: "cascade" }),
  jobId:       bigint("job_id", { mode: "number" }).notNull()
                 .references(() => communicationSendJobs.id, { onDelete: "cascade" }),
  eventType:   text("event_type").notNull(),    // 'open' | 'click'
  clickedUrl:  text("clicked_url"),
  ip:          varchar("ip", { length: 45 }),
  userAgent:   text("user_agent"),
  trackedAt:   timestamp("tracked_at").defaultNow().notNull(),
}, (t) => ({
  recipientIdx: index("send_tracking_recipient_idx").on(t.recipientId),
  jobIdx:       index("send_tracking_job_idx").on(t.jobId),
  eventIdx:     index("send_tracking_event_idx").on(t.eventType),
  timeIdx:      index("send_tracking_time_idx").on(t.trackedAt),
}));

export type CommunicationSendTracking    = typeof communicationSendTracking.$inferSelect;
export type NewCommunicationSendTracking = typeof communicationSendTracking.$inferInsert;

// 자동 발송 트리거 규칙
export const communicationAutoTriggers = pgTable("communication_auto_triggers", {
  id:                bigserial("id", { mode: "number" }).primaryKey(),
  name:              varchar("name", { length: 200 }).notNull(),
  description:       text("description"),
  triggerType:       text("trigger_type").notNull(),   // 'new_member'|'donation_complete'|'support_approved'|'birthday'|'anniversary'
  templateId:        integer("template_id").notNull()
                       .references(() => communicationTemplates.id, { onDelete: "restrict" }),
  recipientGroupId:  integer("recipient_group_id"),
  channel:           text("channel").notNull(),
  delayHours:        integer("delay_hours").notNull().default(0),
  isActive:          boolean("is_active").notNull().default(true),
  cooldownDays:      integer("cooldown_days").notNull().default(30),
  conditions:        jsonb("conditions"),
  createdBy:         integer("created_by").references(() => members.id, { onDelete: "set null" }),
  updatedBy:         integer("updated_by").references(() => members.id, { onDelete: "set null" }),
  deletedAt:         timestamp("deleted_at"),
  createdAt:         timestamp("created_at").defaultNow().notNull(),
  updatedAt:         timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  typeIdx:    index("auto_triggers_type_idx").on(t.triggerType),
  activeIdx:  index("auto_triggers_active_idx").on(t.isActive),
  deletedIdx: index("auto_triggers_deleted_idx").on(t.deletedAt),
}));

export type CommunicationAutoTrigger    = typeof communicationAutoTriggers.$inferSelect;
export type NewCommunicationAutoTrigger = typeof communicationAutoTriggers.$inferInsert;

// 트리거 실행 이력
export const communicationAutoTriggerRuns = pgTable("communication_auto_trigger_runs", {
  id:          bigserial("id", { mode: "number" }).primaryKey(),
  triggerId:   bigint("trigger_id", { mode: "number" }).notNull()
                 .references(() => communicationAutoTriggers.id, { onDelete: "cascade" }),
  jobId:       bigint("job_id", { mode: "number" }),
  triggeredAt: timestamp("triggered_at").defaultNow().notNull(),
  memberCount: integer("member_count").notNull().default(0),
  status:      text("status").notNull().default("ok"),   // 'ok'|'skipped'|'error'
  error:       text("error"),
  meta:        jsonb("meta"),
}, (t) => ({
  triggerIdx: index("auto_trigger_runs_trigger_idx").on(t.triggerId),
  timeIdx:    index("auto_trigger_runs_time_idx").on(t.triggeredAt),
}));

export type CommunicationAutoTriggerRun    = typeof communicationAutoTriggerRuns.$inferSelect;
export type NewCommunicationAutoTriggerRun = typeof communicationAutoTriggerRuns.$inferInsert;

/* === Phase 10 R4 정의 끝 === */

/* =========================================================
   === Phase 11 — 멘션·구독 ===
   ========================================================= */

// 게시글 구독 (게시글·게시판 두 레벨)
export const postSubscriptions = pgTable("post_subscriptions", {
  id:         serial("id").primaryKey(),
  memberId:   integer("member_id").notNull()
                .references(() => members.id, { onDelete: "cascade" }),
  postId:     integer("post_id")
                .references(() => boardPosts.id, { onDelete: "cascade" }),
  boardCategory: varchar("board_category", { length: 30 }),  // boardCategoryEnum 값 (게시판 전체 구독)
  // postId XOR boardCategory — 둘 중 하나만 세팅
  createdAt:  timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  memberPostIdx:  uniqueIndex("post_sub_member_post_idx").on(t.memberId, t.postId),
  memberBoardIdx: index("post_sub_member_board_idx").on(t.memberId, t.boardCategory),
  postIdx:        index("post_sub_post_idx").on(t.postId),
}));

export type PostSubscription    = typeof postSubscriptions.$inferSelect;
export type NewPostSubscription = typeof postSubscriptions.$inferInsert;

// @멘션 기록 (게시글·댓글·채팅 공통)
export const mentions = pgTable("mentions", {
  id:           serial("id").primaryKey(),
  mentionedId:  integer("mentioned_id").notNull()
                  .references(() => members.id, { onDelete: "cascade" }),
  mentionerId:  integer("mentioner_id")
                  .references(() => members.id, { onDelete: "set null" }),
  sourceType:   varchar("source_type", { length: 20 }).notNull(),  // 'post'|'comment'|'chat'
  sourceId:     integer("source_id").notNull(),
  isRead:       boolean("is_read").notNull().default(false),
  readAt:       timestamp("read_at"),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  mentionedIdx: index("mentions_mentioned_idx").on(t.mentionedId),
  sourceIdx:    index("mentions_source_idx").on(t.sourceType, t.sourceId),
  unreadIdx:    index("mentions_unread_idx").on(t.mentionedId, t.isRead),
}));

export type Mention    = typeof mentions.$inferSelect;
export type NewMention = typeof mentions.$inferInsert;

/* === Phase 11 정의 끝 === */

/* =========================================================
   === Phase 12 — 신고 진행 상황 공개 + 익명 신고 강화 ===
   ========================================================= */

// 신고 단계 변경 이력 (3종 신고 공통)
export const reportStatusLogs = pgTable("report_status_logs", {
  id:           serial("id").primaryKey(),
  reportType:   varchar("report_type", { length: 20 }).notNull(),  // 'incident'|'harassment'|'legal'
  reportId:     integer("report_id").notNull(),
  fromStatus:   varchar("from_status", { length: 30 }),
  toStatus:     varchar("to_status", { length: 30 }).notNull(),
  changedBy:    integer("changed_by")
                  .references(() => members.id, { onDelete: "set null" }),
  note:         text("note"),
  notifiedAt:   timestamp("notified_at"),   // 사용자 알림 발송 시각
  createdAt:    timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  reportIdx: index("rsl_report_idx").on(t.reportType, t.reportId),
  timeIdx:   index("rsl_time_idx").on(t.createdAt),
}));

export type ReportStatusLog    = typeof reportStatusLogs.$inferSelect;
export type NewReportStatusLog = typeof reportStatusLogs.$inferInsert;

// 익명 신원 식별 감사 로그 (어드민이 익명 신고자 신원을 열람한 이력)
export const anonymousRevealLogs = pgTable("anonymous_reveal_logs", {
  id:          serial("id").primaryKey(),
  reportType:  varchar("report_type", { length: 20 }).notNull(),  // 'incident'|'harassment'|'legal'
  reportId:    integer("report_id").notNull(),
  revealLevel: integer("reveal_level").notNull(),   // 1=기본 정보, 2=모든 정보
  revealedBy:  integer("revealed_by").notNull()
                 .references(() => members.id, { onDelete: "restrict" }),
  reason:      text("reason"),
  ipAddress:   varchar("ip_address", { length: 45 }),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  reportIdx:   index("arl_report_idx").on(t.reportType, t.reportId),
  adminIdx:    index("arl_admin_idx").on(t.revealedBy),
}));

export type AnonymousRevealLog    = typeof anonymousRevealLogs.$inferSelect;
export type NewAnonymousRevealLog = typeof anonymousRevealLogs.$inferInsert;

/* === Phase 12 정의 끝 === */

/* === Phase 14 — 외부 기관 인계 === */

export const externalAgencies = pgTable("external_agencies", {
  id:           serial("id").primaryKey(),
  name:         varchar("name", { length: 100 }).notNull(),
  agencyType:   varchar("agency_type", { length: 30 }).notNull(),
  contactName:  varchar("contact_name", { length: 50 }),
  contactPhone: varchar("contact_phone", { length: 20 }),
  contactEmail: varchar("contact_email", { length: 100 }),
  jurisdiction: varchar("jurisdiction", { length: 100 }),
  templateBody: text("template_body"),
  isActive:     boolean("is_active").default(true).notNull(),
  createdBy:    integer("created_by").references(() => members.id, { onDelete: "set null" }),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
  updatedAt:    timestamp("updated_at").defaultNow().notNull(),
});

export const referralLogs = pgTable("referral_logs", {
  id:              serial("id").primaryKey(),
  agencyId:        integer("agency_id").references(() => externalAgencies.id, { onDelete: "set null" }),
  agencyName:      varchar("agency_name", { length: 100 }).notNull(),
  sourceType:      varchar("source_type", { length: 20 }).notNull(),
  sourceId:        integer("source_id").notNull(),
  sourceNo:        varchar("source_no", { length: 30 }).notNull(),
  referredBy:      integer("referred_by").references(() => members.id, { onDelete: "set null" }),
  referredAt:      timestamp("referred_at").defaultNow().notNull(),
  pdfStorageKey:   varchar("pdf_storage_key", { length: 300 }),
  status:          varchar("status", { length: 20 }).default("sent").notNull(),
  statusMemo:      text("status_memo"),
  statusUpdatedBy: integer("status_updated_by").references(() => members.id, { onDelete: "set null" }),
  statusUpdatedAt: timestamp("status_updated_at"),
  createdAt:       timestamp("created_at").defaultNow().notNull(),
  updatedAt:       timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  agencyIdx:    index("rl_agency_idx").on(t.agencyId),
  sourceIdx:    index("rl_source_idx").on(t.sourceType, t.sourceId),
  statusIdx:    index("rl_status_idx").on(t.status),
}));

export type ExternalAgency    = typeof externalAgencies.$inferSelect;
export type NewExternalAgency = typeof externalAgencies.$inferInsert;
export type ReferralLog       = typeof referralLogs.$inferSelect;
export type NewReferralLog    = typeof referralLogs.$inferInsert;

/* === Phase 14 정의 끝 === */

/* === Phase 15 — 전문가 매칭 고도화 === */

export const expertProfiles = pgTable("expert_profiles", {
  id:              serial("id").primaryKey(),
  memberId:        integer("member_id").references(() => members.id, { onDelete: "cascade" }).notNull().unique(),
  specialties:     text("specialties"),
  languages:       text("languages"),
  availableDays:   varchar("available_days", { length: 50 }),
  availableHours:  varchar("available_hours", { length: 50 }),
  regionCoverage:  varchar("region_coverage", { length: 100 }),
  bio:             text("bio"),
  avgRating:       numeric("avg_rating", { precision: 3, scale: 2 }).default("0"),
  ratingCount:     integer("rating_count").default(0).notNull(),
  isAcceptingCase: boolean("is_accepting_case").default(true).notNull(),
  createdAt:       timestamp("created_at").defaultNow().notNull(),
  updatedAt:       timestamp("updated_at").defaultNow().notNull(),
});

export const matchingFeedbacks = pgTable("matching_feedbacks", {
  id:        serial("id").primaryKey(),
  matchId:   integer("match_id").notNull().unique(),
  memberId:  integer("member_id").references(() => members.id, { onDelete: "set null" }),
  rating:    integer("rating").notNull(),
  comment:   text("comment"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ExpertProfile    = typeof expertProfiles.$inferSelect;
export type NewExpertProfile = typeof expertProfiles.$inferInsert;
export type MatchingFeedback    = typeof matchingFeedbacks.$inferSelect;
export type NewMatchingFeedback = typeof matchingFeedbacks.$inferInsert;

/* === Phase 15 정의 끝 === */

/* =========================================================
   === 잠재 후원자 관리 (potential_donors) ===
   싸이렌 정식 회원·후원자가 아니지만 이벤트·활동에 참여한 사람
   마이그레이션: migrate-potential-donors
   ========================================================= */
export const potentialDonors = pgTable("potential_donors", {
  id:             serial("id").primaryKey(),
  name:           varchar("name", { length: 50 }).notNull(),
  phone:          varchar("phone", { length: 20 }),
  email:          varchar("email", { length: 100 }),   // ★ 2026-06-26 schema 누락 보정(DB엔 존재·CRUD가 사용) — 잠재 너처링 발송용
  address:        varchar("address", { length: 200 }),
  birthdate:      varchar("birthdate", { length: 10 }),
  eventName:      varchar("event_name", { length: 100 }),
  participatedAt: timestamp("participated_at"),
  entryPath:      varchar("entry_path", { length: 100 }),
  memo:           text("memo"),
  linkedMemberId: integer("linked_member_id")
                    .references(() => members.id, { onDelete: "set null" }),
  linkedAt:       timestamp("linked_at"),
  linkedBy:       integer("linked_by")
                    .references(() => members.id, { onDelete: "set null" }),
  createdBy:      integer("created_by")
                    .references(() => members.id, { onDelete: "set null" }),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
  updatedAt:      timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  nameIdx:         index("potential_donors_name_idx").on(t.name),
  phoneIdx:        index("potential_donors_phone_idx").on(t.phone),
  linkedMemberIdx: index("potential_donors_linked_member_idx").on(t.linkedMemberId),
  eventIdx:        index("potential_donors_event_idx").on(t.eventName),
  createdIdx:      index("potential_donors_created_idx").on(t.createdAt),
}));

export type PotentialDonor    = typeof potentialDonors.$inferSelect;
export type NewPotentialDonor = typeof potentialDonors.$inferInsert;

/* =========================================================
   === Phase 21 R2+R3 === (2026-05-12)
   할당·이관·알림 + 서비스↔카드 동기화 + R&R 통합
   ---------------------------------------------------------
   현실 적응: 본 프로젝트는 별도 admin_users 테이블이 없고
   members 테이블이 운영자 역할을 겸함 (members.role / members.operatorActive).
   설계서의 adminUsers 참조는 모두 members 참조로 변환했음.

   기존 컬럼 활용 (추가 X):
   - workspaceTasks.assignedBy / assignedTo  → 이미 존재
   - workspaceTasks.sourceType / sourceId    → "incident"|"harassment"|... 저장 가능
   - workspaceNotifications.actionUrl        → linkUrl 대체

   ⚠️ 아래 신규 테이블·컬럼 정의는 마이그(migrate-phase21-r2r3) 호출 후 활성화.
   ========================================================= */

/* ----- 1) 카드 이관 이력 (토스) ----- */
export const workspaceTaskTransfers = pgTable("workspace_task_transfers", {
  id:            bigserial("id", { mode: "number" }).primaryKey(),
  taskId:        integer("task_id").notNull().references(() => workspaceTasks.id, { onDelete: "cascade" }),
  fromUid:       integer("from_uid").references(() => members.id, { onDelete: "set null" }),
  toUid:         integer("to_uid").references(() => members.id, { onDelete: "set null" }),
  reason:        text("reason"),
  transferredBy: integer("transferred_by").references(() => members.id, { onDelete: "set null" }),
  transferredAt: timestamp("transferred_at").defaultNow().notNull(),
}, (t) => ({
  taskIdx: index("ws_task_transfers_task_idx").on(t.taskId),
  fromIdx: index("ws_task_transfers_from_idx").on(t.fromUid),
  toIdx:   index("ws_task_transfers_to_idx").on(t.toUid),
}));
export type WorkspaceTaskTransfer    = typeof workspaceTaskTransfers.$inferSelect;
export type NewWorkspaceTaskTransfer = typeof workspaceTaskTransfers.$inferInsert;

/* ----- 2) 카드 워처 (관찰자) ----- */
export const workspaceTaskWatchers = pgTable("workspace_task_watchers", {
  id:        bigserial("id", { mode: "number" }).primaryKey(),
  taskId:    integer("task_id").notNull().references(() => workspaceTasks.id, { onDelete: "cascade" }),
  watcherUid: integer("watcher_uid").notNull().references(() => members.id, { onDelete: "cascade" }),
  addedAt:   timestamp("added_at").defaultNow().notNull(),
}, (t) => ({
  uniq:       uniqueIndex("ws_task_watchers_uniq").on(t.taskId, t.watcherUid),
  taskIdx:    index("ws_task_watchers_task_idx").on(t.taskId),
  watcherIdx: index("ws_task_watchers_watcher_idx").on(t.watcherUid),
}));
export type WorkspaceTaskWatcher    = typeof workspaceTaskWatchers.$inferSelect;
export type NewWorkspaceTaskWatcher = typeof workspaceTaskWatchers.$inferInsert;

/* ----- 3) R&R 매핑 (서비스 유형 × 1차+백업) -----
   serviceKind: "incident" | "harassment" | "legal" | "support" | "_global"
   serviceCategory: enum 값, null(대분류), 또는 "_fallback"(Fallback 슬롯) */
export const serviceRnr = pgTable("service_rnr", {
  id:               bigserial("id", { mode: "number" }).primaryKey(),
  serviceKind:      varchar("service_kind", { length: 20 }).notNull(),
  serviceCategory:  varchar("service_category", { length: 50 }),
  primaryUid:       integer("primary_uid").references(() => members.id, { onDelete: "set null" }),
  backupUid:        integer("backup_uid").references(() => members.id, { onDelete: "set null" }),
  isFallback:       boolean("is_fallback").default(false).notNull(),
  updatedBy:        integer("updated_by").references(() => members.id, { onDelete: "set null" }),
  updatedAt:        timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  uniq:        uniqueIndex("service_rnr_uniq").on(t.serviceKind, t.serviceCategory),
  kindIdx:     index("service_rnr_kind_idx").on(t.serviceKind),
  fallbackIdx: index("service_rnr_fallback_idx").on(t.isFallback),
}));
export type ServiceRnr    = typeof serviceRnr.$inferSelect;
export type NewServiceRnr = typeof serviceRnr.$inferInsert;

/* ----- 4) 기존 테이블 신규 컬럼 (마이그로 추가, schema 활성화 후 별도 PR로 컬럼 반영) -----
   members:
     - outOfOffice       BOOLEAN NOT NULL DEFAULT FALSE
     - outOfOfficeStart  DATE
     - outOfOfficeEnd    DATE
     - outOfOfficeNote   TEXT
   workspaceNotifications:
     - category          VARCHAR(20)   // "assign" | "due" | "mention" | "transfer" | "watcher" | "system"
   incidentReports:
     - assignedTo        INTEGER REFERENCES members(id) ON DELETE SET NULL
     - workspaceTaskId   INTEGER REFERENCES workspace_tasks(id) ON DELETE SET NULL
     - category          VARCHAR(30)   // "school_violence" | "neighborhood_conflict" | "traffic_accident" | "other"
   harassmentReports:
     - assignedTo        INTEGER REFERENCES members(id) ON DELETE SET NULL
     - workspaceTaskId   INTEGER REFERENCES workspace_tasks(id) ON DELETE SET NULL
   legalConsultations:
     - assignedTo        INTEGER REFERENCES members(id) ON DELETE SET NULL   (assignedLawyerId와 별개)
     - workspaceTaskId   INTEGER REFERENCES workspace_tasks(id) ON DELETE SET NULL
   supportRequests:
     - assignedAdminId   INTEGER REFERENCES members(id) ON DELETE SET NULL   (assignedMemberId와 별개)
     - workspaceTaskId   INTEGER REFERENCES workspace_tasks(id) ON DELETE SET NULL
*/

/* =========================================================
   === Phase 21 R4 === (2026-05-12)
   캘린더·메모 미러링·기본보기·자연어 검색·템플릿 시드
   ---------------------------------------------------------
   ⚠️ 아래 컬럼 정의는 migrate-phase21-r4 호출 후 주석 해제.
   마이그 전 활성화 시 drizzle SELECT 실패 → 운영 즉시 깨짐.
   ========================================================= */

/* ----- 5) workspaceMemos 캘린더 미러링 컬럼 (마이그 후 활성화) -----
   workspaceMemos 테이블에 직접 추가:
     - eventDate        DATE       (NULL — showInCalendar=true일 때만 의미)
     - eventTime        TIME       (NULL — NULL이면 "종일" 표시)
     - showInCalendar   BOOLEAN NOT NULL DEFAULT FALSE

   schema 활성화 후 workspaceMemos 정의 안에 아래 3줄 추가:
     eventDate:       date("event_date"),
     eventTime:       time("event_time"),
     showInCalendar:  boolean("show_in_calendar").default(false).notNull(),
*/

/* ----- 6) members.defaultWbsView (마이그 후 활성화) -----
   members 테이블에 직접 추가:
     - defaultWbsView   VARCHAR(20) DEFAULT 'board'

   schema 활성화 후 members 정의 안에 아래 1줄 추가:
     defaultWbsView:  varchar("default_wbs_view", { length: 20 }).default("board"),
*/

/* =========================================================
   === Phase 1~4 AI 비용 안전장치 === (2026-05-13)
   migrate-ai-cost-tracking 호출 후 활성화
   ---------------------------------------------------------
   ai_agent_logs에 추가될 컬럼 (마이그 후 schema에 정의 추가):
     inputTokens:  integer("input_tokens"),
     outputTokens: integer("output_tokens"),
     costUsd:      numeric("cost_usd", { precision: 10, scale: 6 }),
     model:        varchar("model", { length: 60 }),

   ⚠️ ai_agent_logs 정의가 schema.ts에 없음(생짜 SQL로 운영 중).
       drizzle SELECT를 쓰지 않으므로 컬럼 정의 추가는 선택사항.
       현재는 raw SQL(db.execute)로만 쓰이므로 안전.
   ========================================================= */

/* ----- 1) ai_cost_summary — 일·월 비용 집계
              feature_key가 NULL이면 전체 합계 (기존 호환), NOT NULL이면 기능별 합계 ----- */
export const aiCostSummary = pgTable("ai_cost_summary", {
  id:                  bigserial("id", { mode: "number" }).primaryKey(),
  periodType:          varchar("period_type", { length: 10 }).notNull(),   // 'daily' | 'monthly'
  periodKey:           varchar("period_key", { length: 20 }).notNull(),     // '2026-05-13' | '2026-05'
  featureKey:          varchar("feature_key", { length: 60 }),              // NULL = 전체 합계
  totalInputTokens:    bigint("total_input_tokens", { mode: "number" }).default(0).notNull(),
  totalOutputTokens:   bigint("total_output_tokens", { mode: "number" }).default(0).notNull(),
  totalCostUsd:        numeric("total_cost_usd", { precision: 12, scale: 6 }).default("0").notNull(),
  callCount:           integer("call_count").default(0).notNull(),
  updatedAt:           timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/* ----- 1-b) ai_usage_logs — 모든 AI 호출 통합 로그 ----- */
export const aiUsageLogs = pgTable("ai_usage_logs", {
  id:              bigserial("id", { mode: "number" }).primaryKey(),
  featureKey:      varchar("feature_key", { length: 60 }).notNull(),
  model:           varchar("model", { length: 60 }),
  adminId:         integer("admin_id"),
  conversationId:  bigint("conversation_id", { mode: "number" }),
  inputTokens:     integer("input_tokens").default(0).notNull(),
  outputTokens:    integer("output_tokens").default(0).notNull(),
  cachedTokens:    integer("cached_tokens").default(0).notNull(),
  costUsd:         numeric("cost_usd", { precision: 10, scale: 6 }).default("0").notNull(),
  durationMs:      integer("duration_ms"),
  success:         boolean("success").default(true).notNull(),
  error:           text("error"),
  createdAt:       timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/* ----- 1-c) ai_feature_settings — 기능 메타·토글·기능별 월 한도 ----- */
export const aiFeatureSettings = pgTable("ai_feature_settings", {
  featureKey:        varchar("feature_key", { length: 60 }).primaryKey(),
  featureName:       varchar("feature_name", { length: 120 }).notNull(),
  category:          varchar("category", { length: 30 }).notNull(),
  description:       text("description"),
  enabled:           boolean("enabled").default(true).notNull(),
  monthlyBudgetUsd:  numeric("monthly_budget_usd", { precision: 10, scale: 2 }),
  sortOrder:         integer("sort_order").default(100).notNull(),
  createdAt:         timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:         timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/* ----- 2) ai_rate_limit_log — 분/시간/일 카운터 DB 백업 ----- */
export const aiRateLimitLog = pgTable("ai_rate_limit_log", {
  id:           bigserial("id", { mode: "number" }).primaryKey(),
  adminId:      integer("admin_id"),
  windowStart:  timestamp("window_start", { withTimezone: true }).notNull(),
  windowType:   varchar("window_type", { length: 10 }).notNull(),  // 'minute' | 'hour' | 'day'
  callCount:    integer("call_count").default(0).notNull(),
});

/* ----- 3) ai_prompt_cache — Gemini Context Caching id 보존 (Phase 4) ----- */
export const aiPromptCache = pgTable("ai_prompt_cache", {
  id:         bigserial("id", { mode: "number" }).primaryKey(),
  cacheKey:   varchar("cache_key", { length: 120 }).notNull(),
  cacheName:  text("cache_name").notNull(),
  model:      varchar("model", { length: 60 }).notNull(),
  expiresAt:  timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt:  timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/* =========================================================
   === Phase B AI 비서 설정 === (2026-05-13)
   migrate-ai-agent-settings 호출 후 활성화
   ai_agent_settings:    key/value (system_prompt, assistant_name 등)
   ai_tool_permissions:  도구별 enabled + required_role
   ========================================================= */

export const aiAgentSettings = pgTable("ai_agent_settings", {
  key:        varchar("key", { length: 60 }).primaryKey(),     // 'system_prompt' | 'assistant_name' | 'max_steps' 등
  value:      text("value").notNull(),
  updatedAt:  timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  updatedBy:  integer("updated_by"),                            // members.id 참조 (FK 없이 가벼움)
});

export const aiToolPermissions = pgTable("ai_tool_permissions", {
  toolName:      varchar("tool_name", { length: 100 }).primaryKey(),
  enabled:       boolean("enabled").default(true).notNull(),
  requiredRole:  varchar("required_role", { length: 20 }),       // NULL=모든 어드민, 'super_admin'=슈퍼만
  description:   text("description"),
  isMutation:    boolean("is_mutation").default(false).notNull(),
  category:      varchar("category", { length: 30 }),            // 'content'|'members'|'donations'|'siren'|'board'|'workspace'|'kpi'|'nav'|'finance'
  updatedAt:     timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/* =========================================================
   === Phase 22-A 매출 통합 관리 === (2026-05-14, 메인 0단계)
   설계서: docs/milestones/2026-05-14-phase22a-revenue-management.md
   - revenue_categories: 후원 외 매출 카테고리 정의 (6종 시드)
   - other_revenues:     후원 외 매출 기록 (draft → approved/rejected, 환불 누적)
   ========================================================= */

export const revenueCategories = pgTable("revenue_categories", {
  id:           serial("id").primaryKey(),
  code:         varchar("code", { length: 32 }).unique().notNull(),  // 'lecture'|'govgrant'|'corp_sponsor'|'twork_on'|'twork_si'|'etc'
  name:         varchar("name", { length: 100 }).notNull(),          // 한글명
  description:  text("description"),
  parentId:     integer("parent_id"),                                // 상위 분류 id (NULL=대분류) — 2단계 계층 (#9/#11)
  isSystem:     boolean("is_system").default(false).notNull(),        // true=기본 시드(이름변경·비활성 불가)
  sortOrder:    integer("sort_order").default(0).notNull(),
  isActive:     boolean("is_active").default(true).notNull(),
  createdAt:    timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  codeIdx:    index("revenue_categories_code_idx").on(t.code),
  activeIdx:  index("revenue_categories_active_idx").on(t.isActive),
  parentIdx:  index("revenue_categories_parent_idx").on(t.parentId),
}));

export const otherRevenues = pgTable("other_revenues", {
  id:               serial("id").primaryKey(),
  fiscalYear:       integer("fiscal_year").notNull(),                                    // 2026 등 (recognizedAt 연도, 서버에서 자동)
  recognizedAt:     date("recognized_at").notNull(),                                     // 매출 인식일 (입금일)
  categoryId:       integer("category_id").notNull().references(() => revenueCategories.id),
  amount:           bigint("amount", { mode: "number" }).notNull(),                      // 원 단위
  payerName:        varchar("payer_name", { length: 200 }),                              // 납입자/거래처
  description:      text("description"),
  receiptUrl:       varchar("receipt_url", { length: 500 }),                             // R2 증빙파일
  status:           varchar("status", { length: 20 }).default("draft").notNull(),        // 'draft'|'approved'|'rejected'
  refundAmount:     bigint("refund_amount", { mode: "number" }).default(0).notNull(),    // 환불 누적 (net 계산용)
  recordedBy:       integer("recorded_by"),                                              // members.id (작성자)
  recordedAt:       timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
  approvedBy:       integer("approved_by"),                                              // members.id (승인자)
  approvedAt:       timestamp("approved_at", { withTimezone: true }),
  rejectionReason:  text("rejection_reason"),
  createdAt:        timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  fiscalYearIdx:    index("other_revenues_fy_idx").on(t.fiscalYear),
  categoryIdx:      index("other_revenues_category_idx").on(t.categoryId),
  statusIdx:        index("other_revenues_status_idx").on(t.status),
  recognizedAtIdx:  index("other_revenues_recognized_idx").on(t.recognizedAt),
}));

/* =========================================================
   === Phase 22-C 지출 관리 === (2026-05-14, 메인 0단계)
   설계서: docs/milestones/2026-05-14-phase22c-expense-management.md
   - expense_categories: NPO 표준 4분류 시드 + 관리자 자유 추가
   - expenses:           지출 기록 (draft → approved/rejected, 환불 누적)
   ========================================================= */

export const expenseCategories = pgTable("expense_categories", {
  id:           serial("id").primaryKey(),
  code:         varchar("code", { length: 32 }).unique().notNull(),  // 'personnel'|'program'|'admin_ops'|'fundraising' + 사용자 정의
  name:         varchar("name", { length: 100 }).notNull(),
  description:  text("description"),
  isSystem:     boolean("is_system").default(false).notNull(),       // true = NPO 기본값, code·name 수정 불가
  sortOrder:    integer("sort_order").default(0).notNull(),
  isActive:     boolean("is_active").default(true).notNull(),
  createdAt:    timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  codeIdx:    index("expense_categories_code_idx").on(t.code),
  activeIdx:  index("expense_categories_active_idx").on(t.isActive),
}));

export const expenses = pgTable("expenses", {
  id:               serial("id").primaryKey(),
  fiscalYear:       integer("fiscal_year").notNull(),
  occurredAt:       date("occurred_at").notNull(),                                       // 지출 발생일
  categoryId:       integer("category_id").references(() => expenseCategories.id),        // nullable(migrate-expenses-category-nullable) — 결재 승인 지출은 목 기준
  budgetAccountId:  integer("budget_account_id"),                                         // 관-항-목 목(leaf) — 집행 롤업 (2026-07-01)
  amount:           bigint("amount", { mode: "number" }).notNull(),                      // 원 단위
  payeeName:        varchar("payee_name", { length: 200 }),                              // 지급처
  description:      text("description"),
  receiptUrl:       varchar("receipt_url", { length: 500 }),                             // R2 증빙파일 URL
  status:           varchar("status", { length: 20 }).default("draft").notNull(),        // 'draft'|'approved'|'rejected'
  refundAmount:     bigint("refund_amount", { mode: "number" }).default(0).notNull(),    // 환불·취소 누적
  recordedBy:       integer("recorded_by"),                                              // members.id (작성자)
  recordedAt:       timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
  approvedBy:       integer("approved_by"),                                              // members.id (승인자)
  approvedAt:       timestamp("approved_at", { withTimezone: true }),
  rejectionReason:  text("rejection_reason"),
  createdAt:        timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  fiscalYearIdx:  index("expenses_fy_idx").on(t.fiscalYear),
  categoryIdx:    index("expenses_category_idx").on(t.categoryId),
  statusIdx:      index("expenses_status_idx").on(t.status),
  occurredAtIdx:  index("expenses_occurred_idx").on(t.occurredAt),
}));

/* =========================================================
   === Phase 22-B-R2 예산 편성 === (2026-05-15)
   설계서: docs/milestones/2026-05-15-phase22b-r2-budget-planning.md
   - budget_plans: 예산안 (결재 단위, 연도당 1개)
   - budget_lines: 예산안의 카테고리별 편성 행
   ========================================================= */

export const budgetPlans = pgTable("budget_plans", {
  id:              serial("id").primaryKey(),
  fiscalYear:      integer("fiscal_year").notNull().unique(),
  title:           text("title").notNull(),
  status:          varchar("status", { length: 20 }).notNull().default("draft"),
                   // 'draft'|'submitted'|'approved'|'rejected'
  totalPlanned:    bigint("total_planned", { mode: "number" }).notNull().default(0),
  createdBy:       integer("created_by"),
  submittedBy:     integer("submitted_by"),
  submittedAt:     timestamp("submitted_at", { withTimezone: true }),
  approvedBy:      integer("approved_by"),
  approvedAt:      timestamp("approved_at", { withTimezone: true }),
  rejectionReason: text("rejection_reason"),
  createdAt:       timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  fiscalYearIdx: index("budget_plans_fy_idx").on(t.fiscalYear),
  statusIdx:     index("budget_plans_status_idx").on(t.status),
}));

export type BudgetPlan    = typeof budgetPlans.$inferSelect;
export type NewBudgetPlan = typeof budgetPlans.$inferInsert;

export const budgetLines = pgTable("budget_lines", {
  id:             serial("id").primaryKey(),
  planId:         integer("plan_id").notNull().references(() => budgetPlans.id, { onDelete: "cascade" }),
  /* 목 기반 편성 전환(migrate-budget-lines-mok 적용 후 nullable·2026-07-01): 레거시 라인만 categoryId 보유 */
  categoryId:     integer("category_id").references(() => expenseCategories.id),
  /* 관-항-목 3계층: 편성은 목(leaf)에서 (migrate-budget-hierarchy 적용 후 활성·2026-07-01) */
  budgetAccountId: integer("budget_account_id"),
  plannedAmount:  bigint("planned_amount", { mode: "number" }).notNull().default(0),
  prevYearActual: bigint("prev_year_actual", { mode: "number" }).notNull().default(0),
  note:           text("note"),
}, (t) => ({
  planCatUnique: uniqueIndex("budget_lines_plan_cat_unique").on(t.planId, t.categoryId),
  planIdx:       index("budget_lines_plan_idx").on(t.planId),
  categoryIdx:   index("budget_lines_category_idx").on(t.categoryId),
  budgetAccountIdx: index("budget_lines_ba_idx").on(t.budgetAccountId),
}));

export type BudgetLine    = typeof budgetLines.$inferSelect;
export type NewBudgetLine = typeof budgetLines.$inferInsert;

/* =========================================================
   === Phase 22-D-R1 전표 시스템 === (2026-05-15)
   설계서: docs/milestones/2026-05-15-phase22d-r1-voucher-bank-import.md
   - account_codes:    계정과목 마스터 (NPO 표준 코드)
   - vouchers:         전표 (draft→submitted→approved/rejected)
   - bank_imports:     통장 업로드 기록 (R2에서 기능 활성화)
   - bank_transactions: 통장 거래 내역 (R2에서 기능 활성화)
   ========================================================= */

export const accountCodes = pgTable("account_codes", {
  id:         serial("id").primaryKey(),
  code:       varchar("code", { length: 20 }).notNull().unique(),
  name:       varchar("name", { length: 100 }).notNull(),
  parentCode: varchar("parent_code", { length: 20 }),
  category:   varchar("category", { length: 30 }).notNull(),
              // 'personnel'|'program'|'admin_ops'|'fundraising'|'income'
  isActive:   boolean("is_active").default(true).notNull(),
  sortOrder:  integer("sort_order").default(0).notNull(),
}, (t) => ({
  codeIdx:     index("account_codes_code_idx").on(t.code),
  categoryIdx: index("account_codes_category_idx").on(t.category),
  activeIdx:   index("account_codes_active_idx").on(t.isActive),
}));

export type AccountCode    = typeof accountCodes.$inferSelect;
export type NewAccountCode = typeof accountCodes.$inferInsert;

export const vouchers = pgTable("vouchers", {
  id:             serial("id").primaryKey(),
  voucherNumber:  varchar("voucher_number", { length: 20 }).notNull().unique(),
                  // 자동 생성: 'YYYYMM-NNN'
  voucherDate:    date("voucher_date").notNull(),
  fiscalYear:     integer("fiscal_year").notNull(),
  accountCode:    varchar("account_code", { length: 20 }).notNull(),
  accountName:    varchar("account_name", { length: 100 }).notNull(),
  subAccount:     varchar("sub_account", { length: 100 }),
  description:    text("description").notNull(),
  payeeName:      varchar("payee_name", { length: 200 }),
  amount:         bigint("amount", { mode: "number" }).notNull(),
  evidenceType:   varchar("evidence_type", { length: 30 }).notNull().default("none"),
                  // 'tax_invoice'|'receipt'|'card_slip'|'transfer_confirm'|'none'
  evidenceNumber: varchar("evidence_number", { length: 100 }),
  evidenceUrl:    varchar("evidence_url", { length: 500 }),
  budgetLineId:   integer("budget_line_id"),
                  // → budget_lines.id (FK 제약은 22-B-R2+22-D-R1 머지 후 별도 추가)
  expenseId:      integer("expense_id").references(() => expenses.id),
  bankTxnId:      integer("bank_txn_id"),
                  // → bank_transactions.id (R2에서 FK 활성화)
  isTemplate:     boolean("is_template").default(false).notNull(),
  templateName:   varchar("template_name", { length: 200 }),
  status:         varchar("status", { length: 20 }).notNull().default("draft"),
                  // 'draft'|'submitted'|'approved'|'rejected'
  rejectionReason: text("rejection_reason"),
  createdBy:      varchar("created_by", { length: 100 }).notNull(),
                  // members.uid
  submittedAt:    timestamp("submitted_at", { withTimezone: true }),
  approvedBy:     varchar("approved_by", { length: 100 }),
  approvedAt:     timestamp("approved_at", { withTimezone: true }),
  createdAt:      timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),

  /* === Phase 22-D-R3 반복 전표 자동 cron === (2026-05-15)
     마이그: migrate-phase22d-r3-recurring (적용 완료 후 활성) */
  recurringDay:    integer("recurring_day"),                                 // 매월 자동 생성일 (1~31, 0=말일)
  recurringActive: boolean("recurring_active").default(false).notNull(),      // 자동 생성 ON/OFF
}, (t) => ({
  voucherNumberIdx: index("vouchers_number_idx").on(t.voucherNumber),
  dateIdx:          index("vouchers_date_idx").on(t.voucherDate),
  fiscalYearIdx:    index("vouchers_fy_idx").on(t.fiscalYear),
  statusIdx:        index("vouchers_status_idx").on(t.status),
  createdByIdx:     index("vouchers_created_by_idx").on(t.createdBy),
  accountCodeIdx:   index("vouchers_account_code_idx").on(t.accountCode),
}));

export type Voucher    = typeof vouchers.$inferSelect;
export type NewVoucher = typeof vouchers.$inferInsert;

export const bankImports = pgTable("bank_imports", {
  id:            serial("id").primaryKey(),
  filename:      varchar("filename", { length: 300 }).notNull(),
  bankName:      varchar("bank_name", { length: 50 }),
  periodFrom:    date("period_from"),
  periodTo:      date("period_to"),
  totalRows:     integer("total_rows").default(0).notNull(),
  autoMatched:   integer("auto_matched").default(0).notNull(),
  pendingReview: integer("pending_review").default(0).notNull(),
  ignoredRows:   integer("ignored_rows").default(0).notNull(),
  importedBy:    varchar("imported_by", { length: 100 }).notNull(),
  importedAt:    timestamp("imported_at", { withTimezone: true }).defaultNow().notNull(),
  status:        varchar("status", { length: 20 }).default("processing").notNull(),
                 // 'processing'|'review'|'completed'
}, (t) => ({
  importedByIdx: index("bank_imports_by_idx").on(t.importedBy),
  statusIdx:     index("bank_imports_status_idx").on(t.status),
}));

export type BankImport    = typeof bankImports.$inferSelect;
export type NewBankImport = typeof bankImports.$inferInsert;

export const bankTransactions = pgTable("bank_transactions", {
  id:              serial("id").primaryKey(),
  importId:        integer("import_id").notNull().references(() => bankImports.id),
  txnDate:         date("txn_date").notNull(),
  amount:          bigint("amount", { mode: "number" }).notNull(),
  description:     text("description").notNull(),
  counterpart:     varchar("counterpart", { length: 200 }),
  balanceAfter:    bigint("balance_after", { mode: "number" }),
  txnType:         varchar("txn_type", { length: 10 }).notNull(),
                   // 'debit'|'credit'
  aiAccountCode:   varchar("ai_account_code", { length: 20 }),
  aiBudgetId:      integer("ai_budget_id"),
  aiConfidence:    numeric("ai_confidence", { precision: 4, scale: 3 }),
  aiReasoning:     text("ai_reasoning"),
  status:          varchar("status", { length: 20 }).default("pending").notNull(),
                   // 'pending'|'confirmed'|'voucher_created'|'ignored'
  adminAccountCode: varchar("admin_account_code", { length: 20 }),
  adminBudgetId:   integer("admin_budget_id"),
  voucherId:       integer("voucher_id").references(() => vouchers.id),
  confirmedBy:     varchar("confirmed_by", { length: 100 }),
  confirmedAt:     timestamp("confirmed_at", { withTimezone: true }),
  createdAt:       timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),

  /* === Phase 22-D-R2 통장거래내역 자동화 === (2026-05-15)
     마이그: migrate-phase22d-r2-bank-reconcile (적용 완료 후 활성) */
  counterpartAccount: varchar("counterpart_account", { length: 50 }),  // 상대계좌번호
  counterpartBank:    varchar("counterpart_bank", { length: 50 }),     // 상대은행
  counterpartName:    varchar("counterpart_name", { length: 200 }),    // 상대계좌예금주명 — 거래처 매칭 핵심
  txnMethod:          varchar("txn_method", { length: 50 }),           // 거래구분
  memo:               text("memo"),
  cmsCode:            varchar("cms_code", { length: 50 }),
  counterpartyId:     integer("counterparty_id"),                      // → counterparties.id
  donationId:         integer("donation_id"),                          // 입금 매칭: → donations.id
  otherRevenueId:     integer("other_revenue_id"),                     // 입금 매칭: → other_revenues.id
  matchType:          varchar("match_type", { length: 30 }),
                      // 'donation'|'donation_batch'|'voucher'|'revenue'|'ignored'|'pending'
  dedupHash:          varchar("dedup_hash", { length: 64 }),           // 중복 방지 해시
}, (t) => ({
  importIdx:    index("bank_txns_import_idx").on(t.importId),
  dateIdx:      index("bank_txns_date_idx").on(t.txnDate),
  statusIdx:    index("bank_txns_status_idx").on(t.status),
  dedupIdx:     index("bank_txns_dedup_idx").on(t.dedupHash),
  matchTypeIdx: index("bank_txns_match_type_idx").on(t.matchType),
}));

export type BankTransaction    = typeof bankTransactions.$inferSelect;
export type NewBankTransaction = typeof bankTransactions.$inferInsert;

/* =========================================================
   === Phase 22-D-R2 거래처 마스터 === (2026-05-15)
   설계서: docs/milestones/2026-05-15-phase22d-r2-bank-reconciliation.md §2.2
   - counterparties: 거래처 자동 학습 — 한 번 분류하면 다음부터 자동 매핑
   ========================================================= */

export const counterparties = pgTable("counterparties", {
  id:                  serial("id").primaryKey(),
  name:                varchar("name", { length: 200 }).notNull(),      // 거래처명·예금주명
  accountNo:           varchar("account_no", { length: 50 }),           // 상대계좌번호
  bankName:            varchar("bank_name", { length: 50 }),            // 상대은행
  defaultMatchType:    varchar("default_match_type", { length: 30 }),   // 'voucher'|'revenue'|'donation'
  defaultAccountCode:  varchar("default_account_code", { length: 20 }), // → account_codes.code
  defaultBudgetLineId: integer("default_budget_line_id"),               // → budget_lines.id (선택)
  txnCount:            integer("txn_count").default(0).notNull(),       // 학습 횟수 (등장 빈도)
  note:                text("note"),
  learnedBy:           integer("learned_by"),                           // members.id (최초 분류한 관리자)
  createdAt:           timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:           timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  nameIdx:        index("counterparties_name_idx").on(t.name),
  accountIdx:     index("counterparties_account_idx").on(t.accountNo),
  acctNameUnique: uniqueIndex("counterparties_account_name_unique").on(t.accountNo, t.name),
}));

export type Counterparty    = typeof counterparties.$inferSelect;
export type NewCounterparty = typeof counterparties.$inferInsert;

/* =========================================================
   === 2026-05-16: 응답폼·신청폼 빌더 (믹스온 비교 약점 ★★★ 1순위) ===
   migrate-forms.ts로 테이블 생성됨. 운영자가 코드 없이 행사 신청·설문·
   이벤트 폼을 직접 만들고 응답 수집. 응답자는 회원/비회원 모두 가능.
   ========================================================= */

export const forms = pgTable("forms", {
  id:                bigserial("id", { mode: "number" }).primaryKey(),
  title:             varchar("title", { length: 200 }).notNull(),
  slug:              varchar("slug", { length: 100 }).notNull().unique(),
  description:       text("description"),
  instructions:      text("instructions"),
  /* 접근 정책 */
  accessLevel:       varchar("access_level", { length: 20 }).default("public").notNull(),
  requiresAuth:      boolean("requires_auth").default(false).notNull(),
  /* 상태·공개 */
  isActive:          boolean("is_active").default(true).notNull(),
  isPublished:       boolean("is_published").default(false).notNull(),
  /* 응답 정책 */
  maxResponses:      integer("max_responses"),
  allowDuplicates:   boolean("allow_duplicates").default(true).notNull(),
  closedMessage:     text("closed_message"),
  /* 알림 */
  notifyOnSubmit:    boolean("notify_on_submit").default(true).notNull(),
  adminNotifyEmail:  varchar("admin_notify_email", { length: 200 }),
  /* 메타 */
  createdBy:         integer("created_by").references(() => members.id, { onDelete: "set null" }),
  createdAt:         timestamp("created_at").defaultNow().notNull(),
  updatedAt:         timestamp("updated_at").defaultNow().notNull(),
  publishedAt:       timestamp("published_at"),
}, (t) => ({
  slugIdx:      index("forms_slug_idx").on(t.slug),
  activeIdx:    index("forms_active_idx").on(t.isActive, t.isPublished),
}));

export type Form    = typeof forms.$inferSelect;
export type NewForm = typeof forms.$inferInsert;

export const formFields = pgTable("form_fields", {
  id:               bigserial("id", { mode: "number" }).primaryKey(),
  formId:           bigint("form_id", { mode: "number" }).notNull().references(() => forms.id, { onDelete: "cascade" }),
  fieldKey:         varchar("field_key", { length: 50 }).notNull(),
  type:             varchar("type", { length: 20 }).notNull(),
  label:            varchar("label", { length: 200 }).notNull(),
  placeholder:      varchar("placeholder", { length: 200 }),
  helpText:         text("help_text"),
  options:          jsonb("options").default(sql`'[]'::jsonb`).notNull(),
  required:         boolean("required").default(false).notNull(),
  pattern:          varchar("pattern", { length: 200 }),
  minLength:        integer("min_length"),
  maxLength:        integer("max_length"),
  acceptFileTypes:  varchar("accept_file_types", { length: 200 }),
  maxFileSize:      integer("max_file_size"),
  sortOrder:        integer("sort_order").default(0).notNull(),
  isVisible:        boolean("is_visible").default(true).notNull(),
  showConditions:   jsonb("show_conditions"),
  createdAt:        timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  formIdx: index("form_fields_form_idx").on(t.formId, t.sortOrder),
}));

export type FormField    = typeof formFields.$inferSelect;
export type NewFormField = typeof formFields.$inferInsert;

export const formSubmissions = pgTable("form_submissions", {
  id:            bigserial("id", { mode: "number" }).primaryKey(),
  formId:        bigint("form_id", { mode: "number" }).notNull().references(() => forms.id, { onDelete: "cascade" }),
  memberId:      integer("member_id").references(() => members.id, { onDelete: "set null" }),
  memberEmail:   varchar("member_email", { length: 200 }),
  memberPhone:   varchar("member_phone", { length: 20 }),
  data:          jsonb("data").notNull(),
  userAgent:     text("user_agent"),
  ipAddress:     varchar("ip_address", { length: 45 }),
  status:        varchar("status", { length: 20 }).default("submitted").notNull(),
  notes:         text("notes"),
  createdAt:     timestamp("created_at").defaultNow().notNull(),
  updatedAt:     timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  formIdx:    index("form_submissions_form_idx").on(t.formId, t.createdAt),
  statusIdx:  index("form_submissions_status_idx").on(t.formId, t.status),
}));

export type FormSubmission    = typeof formSubmissions.$inferSelect;
export type NewFormSubmission = typeof formSubmissions.$inferInsert;

/* === 라운드2 워크스페이스 === */

export const workspaceTaskMentions = pgTable("workspace_task_mentions", {
  id:                serial("id").primaryKey(),
  workspaceId:       integer("workspace_id").notNull(),
  taskId:            integer("task_id").notNull(),
  mentionedMemberId: integer("mentioned_member_id").notNull(),
  mentionerMemberId: integer("mentioner_member_id"),
  context:           text("context"),
  isRead:            boolean("is_read").default(false).notNull(),
  readAt:            timestamp("read_at"),
  createdAt:         timestamp("created_at").defaultNow().notNull(),
});

export const workspaceEventRsvps = pgTable("workspace_event_rsvps", {
  id:          serial("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull(),
  eventId:     integer("event_id").notNull(),
  memberId:    integer("member_id").notNull(),
  status:      varchar("status", { length: 10 }).notNull(),
  note:        varchar("note", { length: 200 }),
  respondedAt: timestamp("responded_at").defaultNow().notNull(),
}, (t) => ({
  uniq: uniqueIndex("workspace_event_rsvps_uniq").on(t.eventId, t.memberId),
}));

export const googleCalendarTokens = pgTable("google_calendar_tokens", {
  id:           serial("id").primaryKey(),
  memberId:     integer("member_id").notNull().unique(),
  accessToken:  text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  expiresAt:    timestamp("expires_at").notNull(),
  calendarId:   varchar("calendar_id", { length: 200 }).default("primary"),
  syncEnabled:  boolean("sync_enabled").default(true).notNull(),
  lastSyncAt:   timestamp("last_sync_at"),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
  updatedAt:    timestamp("updated_at").defaultNow().notNull(),
});

export type WorkspaceTaskMention    = typeof workspaceTaskMentions.$inferSelect;
export type NewWorkspaceTaskMention = typeof workspaceTaskMentions.$inferInsert;
export type WorkspaceEventRsvp      = typeof workspaceEventRsvps.$inferSelect;
export type NewWorkspaceEventRsvp   = typeof workspaceEventRsvps.$inferInsert;
export type GoogleCalendarToken     = typeof googleCalendarTokens.$inferSelect;
export type NewGoogleCalendarToken  = typeof googleCalendarTokens.$inferInsert;

/* === 라운드6 게이미피케이션 === */

export const pointRules = pgTable("point_rules", {
  id:          serial("id").primaryKey(),
  eventType:   varchar("event_type", { length: 40 }).notNull().unique(),
  pointAmount: integer("point_amount").notNull().default(0),
  isActive:    boolean("is_active").notNull().default(true),
  description: varchar("description", { length: 200 }),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
});

export const memberPointLogs = pgTable("member_point_logs", {
  id:          serial("id").primaryKey(),
  memberId:    integer("member_id").notNull(),
  delta:       integer("delta").notNull(),
  reason:      varchar("reason", { length: 200 }),
  eventType:   varchar("event_type", { length: 40 }),
  referenceId: integer("reference_id"),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  memberIdx: index("member_point_logs_member_idx").on(t.memberId),
}));

export const badgeDefinitions = pgTable("badge_definitions", {
  code:           varchar("code", { length: 50 }).primaryKey(),
  nameKo:         varchar("name_ko", { length: 50 }).notNull(),
  icon:           varchar("icon", { length: 100 }),
  conditionType:  varchar("condition_type", { length: 30 }).notNull(),
  conditionValue: integer("condition_value").notNull(),
  description:    varchar("description", { length: 200 }),
  isActive:       boolean("is_active").notNull().default(true),
  sortOrder:      integer("sort_order").default(0),
});

export const memberBadges = pgTable("member_badges", {
  id:        serial("id").primaryKey(),
  memberId:  integer("member_id").notNull(),
  badgeCode: varchar("badge_code", { length: 50 }).notNull(),
  awardedAt: timestamp("awarded_at").defaultNow().notNull(),
}, (t) => ({
  uniq: uniqueIndex("member_badges_uniq").on(t.memberId, t.badgeCode),
}));

export const rewards = pgTable("rewards", {
  id:          serial("id").primaryKey(),
  nameKo:      varchar("name_ko", { length: 100 }).notNull(),
  description: text("description"),
  pointCost:   integer("point_cost").notNull(),
  stock:       integer("stock"),
  isActive:    boolean("is_active").notNull().default(true),
  imageUrl:    varchar("image_url", { length: 500 }),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
});

export const rewardRedemptions = pgTable("reward_redemptions", {
  id:          serial("id").primaryKey(),
  memberId:    integer("member_id").notNull(),
  rewardId:    integer("reward_id").notNull(),
  pointCost:   integer("point_cost").notNull(),
  status:      varchar("status", { length: 20 }).notNull().default("pending"),
  note:        varchar("note", { length: 300 }),
  redeemedAt:  timestamp("redeemed_at").defaultNow().notNull(),
  processedAt: timestamp("processed_at"),
}, (t) => ({
  memberIdx: index("reward_redemptions_member_idx").on(t.memberId),
}));

/* === 라운드6 큐레이션·팝업 === */

export const sitePopups = pgTable("site_popups", {
  id:               serial("id").primaryKey(),
  title:            varchar("title", { length: 100 }).notNull(),
  content:          text("content"),
  imageUrl:         varchar("image_url", { length: 500 }),
  linkUrl:          varchar("link_url", { length: 500 }),
  targetPages:      jsonb("target_pages").default(["*"]),
  displayFrequency: varchar("display_frequency", { length: 20 }).notNull().default("once_day"),
  startAt:          timestamp("start_at"),
  endAt:            timestamp("end_at"),
  isActive:         boolean("is_active").notNull().default(true),
  layoutConfig:     jsonb("layout_config"),
  createdAt:        timestamp("created_at").defaultNow().notNull(),
});

export const siteCurations = pgTable("site_curations", {
  id:        serial("id").primaryKey(),
  slot:      varchar("slot", { length: 40 }).notNull(),
  title:     varchar("title", { length: 100 }),
  items:     jsonb("items").default([]),
  isActive:  boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/* === 라운드6 RBAC 권한 정책 === */

export const rolePermissions = pgTable("role_permissions", {
  id:              serial("id").primaryKey(),
  featureKey:      varchar("feature_key", { length: 60 }).notNull().unique(),
  featureLabel:    varchar("feature_label", { length: 100 }).notNull(),
  category:        varchar("category", { length: 20 }).notNull().default("siren"),
  adminAllowed:    boolean("admin_allowed").notNull().default(true),
  operatorAllowed: boolean("operator_allowed").notNull().default(false),
  updatedAt:       timestamp("updated_at").defaultNow().notNull(),
});

/* === Phase 24: 마일스톤·성과급 관리 === */

export const quarters = pgTable("quarters", {
  id:             serial("id").primaryKey(),
  year:           integer("year").notNull(),
  quarter:        integer("quarter").notNull(),
  startDate:      date("start_date").notNull(),
  endDate:        date("end_date").notNull(),
  settlementDate: date("settlement_date").notNull(),
  status:         varchar("status", { length: 20 }).notNull().default("UPCOMING"),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
  updatedAt:      timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  yearQuarterUq: uniqueIndex("quarters_year_q_uq").on(t.year, t.quarter),
}));

export const milestoneDefinitions = pgTable("milestone_definitions", {
  id:                   serial("id").primaryKey(),
  code:                 varchar("code", { length: 20 }).notNull().unique(),
  name:                 varchar("name", { length: 200 }).notNull(),
  category:             varchar("category", { length: 20 }).notNull(),
  targetMilestoneRole:  varchar("target_milestone_role", { length: 10 }).notNull(),
  businessUnit:         varchar("business_unit", { length: 30 }),
  revenueSource:        varchar("revenue_source", { length: 100 }),
  thresholdEnabled:     boolean("threshold_enabled").notNull().default(false),
  thresholdValue:       numeric("threshold_value", { precision: 15, scale: 2 }),
  thresholdUnit:        varchar("threshold_unit", { length: 30 }),
  bonusFormula:         jsonb("bonus_formula").notNull(),
  quarterApplicable:    varchar("quarter_applicable", { length: 5 }),
  isSharedThreshold:    boolean("is_shared_threshold").notNull().default(false),
  sharedThresholdGroup: varchar("shared_threshold_group", { length: 20 }),
  isActive:             boolean("is_active").notNull().default(true),
  effectiveFrom:        date("effective_from"),
  effectiveTo:          date("effective_to"),
  sortOrder:            integer("sort_order").notNull().default(0),
  /* ★ Q3-045: 라이브 DB에 이미 존재(migrate-milestone-v4) — schema 정의만 동기화(회귀 예방·append-only) */
  nonRevenueCategory:   varchar("non_revenue_category", { length: 50 }),
  createdAt:            timestamp("created_at").defaultNow().notNull(),
  updatedAt:            timestamp("updated_at").defaultNow().notNull(),
});

export const revenueEntries = pgTable("revenue_entries", {
  id:                    serial("id").primaryKey(),
  milestoneDefinitionId: integer("milestone_definition_id").notNull().references(() => milestoneDefinitions.id),
  quarterId:             integer("quarter_id").notNull().references(() => quarters.id),
  enteredBy:             integer("entered_by").notNull().references(() => members.id),
  responsibleAdminId:    integer("responsible_admin_id").references(() => members.id),
  revenueDate:           date("revenue_date").notNull(),
  amount:                numeric("amount", { precision: 15, scale: 2 }).notNull(),
  amountUnit:            varchar("amount_unit", { length: 20 }).notNull().default("원"),
  note:                  text("note"),
  isCampaignRouted:      boolean("is_campaign_routed").default(false),
  evidenceFiles:         jsonb("evidence_files").default([]),
  status:                varchar("status", { length: 20 }).notNull().default("PENDING"),
  reviewedBy:            integer("reviewed_by").references(() => members.id),
  reviewedAt:            timestamp("reviewed_at"),
  rejectReason:          text("reject_reason"),
  createdAt:             timestamp("created_at").defaultNow().notNull(),
  updatedAt:             timestamp("updated_at").defaultNow().notNull(),
});

export const nonRevenueAchievements = pgTable("non_revenue_achievements", {
  id:                    serial("id").primaryKey(),
  milestoneDefinitionId: integer("milestone_definition_id").notNull().references(() => milestoneDefinitions.id),
  quarterId:             integer("quarter_id").notNull().references(() => quarters.id),
  submittedBy:           integer("submitted_by").notNull().references(() => members.id),
  achievedDate:          date("achieved_date").notNull(),
  description:           text("description"),
  evidenceFiles:         jsonb("evidence_files").default([]),
  bonusAmount:           numeric("bonus_amount", { precision: 15, scale: 2 }).notNull().default("0"),
  eventRangeAmount:      numeric("event_range_amount", { precision: 15, scale: 2 }),
  isSelectedForQuarter:  boolean("is_selected_for_quarter").notNull().default(false),
  selectionOrder:        integer("selection_order"),
  status:                varchar("status", { length: 20 }).notNull().default("PENDING"),
  reviewedBy:            integer("reviewed_by").references(() => members.id),
  reviewedAt:            timestamp("reviewed_at"),
  rejectReason:          text("reject_reason"),
  createdAt:             timestamp("created_at").defaultNow().notNull(),
  updatedAt:             timestamp("updated_at").defaultNow().notNull(),
});

export const quarterlySettlements = pgTable("quarterly_settlements", {
  id:                  serial("id").primaryKey(),
  quarterId:           integer("quarter_id").notNull().references(() => quarters.id),
  memberId:            integer("member_id").notNull().references(() => members.id),
  revenueLinkedTotal:  numeric("revenue_linked_total", { precision: 15, scale: 2 }).notNull().default("0"),
  nonRevenueTotal:     numeric("non_revenue_total", { precision: 15, scale: 2 }).notNull().default("0"),
  totalBonus:          numeric("total_bonus", { precision: 15, scale: 2 }).notNull().default("0"),
  calculationSnapshot: jsonb("calculation_snapshot"),
  selfEvaluation:      text("self_evaluation"),
  status:              varchar("status", { length: 20 }).notNull().default("DRAFT"),
  submittedAt:         timestamp("submitted_at"),
  reviewedBy:          integer("reviewed_by").references(() => members.id),
  reviewedAt:          timestamp("reviewed_at"),
  reviewNote:          text("review_note"),
  approvedAt:          timestamp("approved_at"),
  paidAt:              timestamp("paid_at"),
  /* ★ R29-MS-GAP1: HOLD 사유 (마이그레이션 migrate-ms-r29-hold-reason 적용 완료) */
  holdReason:          text("hold_reason"),
  createdAt:           timestamp("created_at").defaultNow().notNull(),
  updatedAt:           timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  quarterMemberUq: uniqueIndex("qs_quarter_member_uq").on(t.quarterId, t.memberId),
}));

/* =========================================================
   === Phase 26 — 근태관리 시스템 (2026-05-19) ===
   설계서: docs/milestones/2026-05-19-phase26-attendance.md
   마이그레이션: migrate-phase26-attendance (실행 후 활성화됨)
   역할: super_admin=슈퍼어드민, admin/operator=직원
   ========================================================= */

/* 1. 거점 (사무실·외근지) */
export const attWorkplaces = pgTable("att_workplaces", {
  id:        serial("id").primaryKey(),
  name:      varchar("name", { length: 100 }).notNull(),
  type:      varchar("type", { length: 20 }).notNull(),       // 'OFFICE' | 'FIELD'
  address:   text("address"),
  lat:       numeric("lat", { precision: 10, scale: 7 }),
  lng:       numeric("lng", { precision: 10, scale: 7 }),
  radius:    integer("radius").default(50).notNull(),         // 허용 반경 (미터)
  isActive:  boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  typeIdx: index("att_workplaces_type_idx").on(t.type),
  activeIdx: index("att_workplaces_active_idx").on(t.isActive),
}));

/* 2. 근무 정책 */
export const attPolicies = pgTable("att_policies", {
  id:                    serial("id").primaryKey(),
  name:                  varchar("name", { length: 100 }).notNull(),
  checkInTime:           time("check_in_time").default(sql`'09:00'`).notNull(),
  checkOutTime:          time("check_out_time").default(sql`'18:00'`).notNull(),
  lateGraceMins:         integer("late_grace_mins").default(10).notNull(),
  earlyLeaveGraceMins:   integer("early_leave_grace_mins").default(10).notNull(),
  dailyHours:            numeric("daily_hours", { precision: 4, scale: 2 }).default("8").notNull(),
  breakMins:             integer("break_mins").default(60).notNull(),
  breakThresholdHours:   numeric("break_threshold_hours", { precision: 4, scale: 2 }).default("4").notNull(),
  weeklyMaxHours:        integer("weekly_max_hours").default(52).notNull(),
  coreStartTime:         time("core_start_time").default(sql`'10:00'`),
  coreEndTime:           time("core_end_time").default(sql`'16:00'`),
  flexEnabled:           boolean("flex_enabled").default(false).notNull(),
  remoteMaxPerMonth:     integer("remote_max_per_month").default(10).notNull(),
  /* === 연차 산정 정책 (migrate-att-leave-policy 적용 완료 2026-05-23) === */
  leaveAccrualMode:      varchar("leave_accrual_mode", { length: 1 }).default("A").notNull(),        // 'A'(만근 누적·5인 이하) | 'B'(근속 기반·5인 이상)
  annualBaseDays:        numeric("annual_base_days", { precision: 5, scale: 2 }).default("12").notNull(),    // 모드B: 1주년 기준 일수
  annualIncrementDays:   numeric("annual_increment_days", { precision: 5, scale: 2 }).default("1").notNull(),  // 모드B: 증가 일수
  annualIncrementYears:  integer("annual_increment_years").default(2).notNull(),                     // 모드B: 증가 주기(년)
  annualCapDays:         numeric("annual_cap_days", { precision: 5, scale: 2 }).default("25").notNull(),     // 모드B: 상한
  perfectBonusPerMonth:  numeric("perfect_bonus_per_month", { precision: 5, scale: 2 }).default("1").notNull(),  // 모드A: 월 만근 보너스
  isDefault:             boolean("is_default").default(false).notNull(),
  createdAt:             timestamp("created_at").defaultNow().notNull(),
  updatedAt:             timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  defaultIdx: index("att_policies_default_idx").on(t.isDefault),
}));

/* 3. 휴가 종류 */
export const attLeaveTypes = pgTable("att_leave_types", {
  id:               serial("id").primaryKey(),
  name:             varchar("name", { length: 100 }).notNull(),
  isPaid:           boolean("is_paid").default(true).notNull(),
  unit:             varchar("unit", { length: 10 }).default("day").notNull(),  // 'day' | 'hour'
  requiresApproval: boolean("requires_approval").default(true).notNull(),
  defaultDays:      numeric("default_days", { precision: 5, scale: 2 }).default("0").notNull(),
  isActive:         boolean("is_active").default(true).notNull(),
  displayOrder:     integer("display_order").default(0).notNull(),
  /* === R29-ATT-GAP1: migrate-att-r29-leave-type-cols 적용 완료 (2026-05-19) === */
  code:             varchar("code", { length: 50 }),                                  // 'ANNUAL' | 'SICK' | 'PERSONAL' 등 (partial unique idx)
  maxDays:          numeric("max_days", { precision: 5, scale: 2 }),                  // 연간 최대 사용 한도 (null = 제한 없음)
  allowHalfDay:     boolean("allow_half_day").default(false).notNull(),               // 반차 허용 (PHASE D에서 활용)
  description:      text("description"),                                              // 사용 안내문
  createdAt:        timestamp("created_at").defaultNow().notNull(),
  updatedAt:        timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  activeIdx: index("att_leave_types_active_idx").on(t.isActive),
}));

/* 4. 직원별 휴가 잔여 */
export const attLeaveBalances = pgTable("att_leave_balances", {
  id:          serial("id").primaryKey(),
  memberUid:   varchar("member_uid", { length: 36 }).notNull(),
  leaveTypeId: integer("leave_type_id").notNull().references(() => attLeaveTypes.id, { onDelete: "cascade" }),
  year:        integer("year").notNull(),
  totalDays:   numeric("total_days", { precision: 5, scale: 2 }).default("0").notNull(),
  usedDays:    numeric("used_days", { precision: 5, scale: 2 }).default("0").notNull(),
}, (t) => ({
  memberYearUnq: uniqueIndex("att_leave_balances_member_year_uq").on(t.memberUid, t.leaveTypeId, t.year),
  memberIdx:     index("att_leave_balances_member_idx").on(t.memberUid),
}));

/* 5. 휴가 신청 */
export const attLeaveRequests = pgTable("att_leave_requests", {
  id:          serial("id").primaryKey(),
  memberUid:   varchar("member_uid", { length: 36 }).notNull(),
  leaveTypeId: integer("leave_type_id").notNull().references(() => attLeaveTypes.id),
  startDate:   date("start_date").notNull(),
  endDate:     date("end_date").notNull(),
  days:        numeric("days", { precision: 5, scale: 2 }).notNull(),
  isHalfDay:   boolean("is_half_day").default(false).notNull(),
  halfDayPeriod: varchar("half_day_period", { length: 10 }),            // AM | PM | null
  reason:      text("reason"),
  status:      varchar("status", { length: 20 }).default("PENDING").notNull(),  // PENDING|APPROVED|REJECTED
  reviewedBy:  varchar("reviewed_by", { length: 36 }),
  reviewNote:  text("review_note"),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
  updatedAt:   timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  memberIdx: index("att_leave_requests_member_idx").on(t.memberUid),
  statusIdx: index("att_leave_requests_status_idx").on(t.status),
  dateIdx:   index("att_leave_requests_date_idx").on(t.startDate),
}));

/* 6. 직원별 근무형태 스케줄 (반복 규칙) */
export const attSchedules = pgTable("att_schedules", {
  id:            serial("id").primaryKey(),
  memberUid:     varchar("member_uid", { length: 36 }).notNull(),
  workMode:      varchar("work_mode", { length: 30 }).notNull(),   // OFFICE|REMOTE|FIELD|BUSINESS_TRIP|HYBRID
  recurringRule: jsonb("recurring_rule"),                           // {mon:'REMOTE',tue:'OFFICE',...} HYBRID 전용
  startDate:     date("start_date").notNull(),
  endDate:       date("end_date"),                                  // NULL = 무기한
  workplaceId:   integer("workplace_id").references(() => attWorkplaces.id, { onDelete: "set null" }),
  note:          text("note"),
  createdBy:     varchar("created_by", { length: 36 }),
  createdAt:     timestamp("created_at").defaultNow().notNull(),
  updatedAt:     timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  memberIdx:  index("att_schedules_member_idx").on(t.memberUid),
  startIdx:   index("att_schedules_start_idx").on(t.startDate),
}));

/* 7. 단발성 근무형태 재정의 (반복 규칙보다 우선) */
export const attScheduleOverrides = pgTable("att_schedule_overrides", {
  id:          serial("id").primaryKey(),
  memberUid:   varchar("member_uid", { length: 36 }).notNull(),
  date:        date("date").notNull(),
  workMode:    varchar("work_mode", { length: 30 }).notNull(),
  workplaceId: integer("workplace_id").references(() => attWorkplaces.id, { onDelete: "set null" }),
  reason:      text("reason"),
  createdBy:   varchar("created_by", { length: 36 }),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  memberDateUnq: uniqueIndex("att_overrides_member_date_uq").on(t.memberUid, t.date),
  memberIdx:     index("att_overrides_member_idx").on(t.memberUid),
}));

/* 8. 출퇴근 기록 (일별 1건) */
export const attRecords = pgTable("att_records", {
  id:                  serial("id").primaryKey(),
  memberUid:           varchar("member_uid", { length: 36 }).notNull(),
  date:                date("date").notNull(),
  workMode:            varchar("work_mode", { length: 30 }),
  status:              varchar("status", { length: 30 }).default("NORMAL").notNull(),
                       // NORMAL|LATE|EARLY_LEAVE|ABSENT|LEAVE|HOLIDAY|PARTIAL_LEAVE
  checkInTime:         timestamp("check_in_time"),
  checkInLat:          numeric("check_in_lat", { precision: 10, scale: 7 }),
  checkInLng:          numeric("check_in_lng", { precision: 10, scale: 7 }),
  checkInIp:           varchar("check_in_ip", { length: 50 }),
  checkOutTime:        timestamp("check_out_time"),
  checkOutLat:         numeric("check_out_lat", { precision: 10, scale: 7 }),
  checkOutLng:         numeric("check_out_lng", { precision: 10, scale: 7 }),
  workplaceId:         integer("workplace_id").references(() => attWorkplaces.id, { onDelete: "set null" }),
  workingMins:         integer("working_mins"),
  overtimeMins:        integer("overtime_mins").default(0).notNull(),
  isManuallyAdjusted:  boolean("is_manually_adjusted").default(false).notNull(),
  note:                text("note"),
  /* R39 Stage 7: 디바이스 타입 (MOBILE·TABLET·DESKTOP) — 클라이언트가 전송, 운영 분석용 */
  deviceType:          varchar("device_type", { length: 20 }),
  /* 재출근 다중 세션 (migrate-att-sessions 적용 2026-05-24) — [{in,out,inLat,inLng,outLat,outLng}].
     요약 컬럼(checkInTime=첫 출근·checkOutTime=마지막 퇴근·workingMins=합계)은 그대로 유지. */
  sessions:            jsonb("sessions").default(sql`'[]'::jsonb`).notNull(),
  createdAt:           timestamp("created_at").defaultNow().notNull(),
  updatedAt:           timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  memberDateUnq: uniqueIndex("att_records_member_date_uq").on(t.memberUid, t.date),
  memberIdx:     index("att_records_member_idx").on(t.memberUid),
  dateIdx:       index("att_records_date_idx").on(t.date),
  statusIdx:     index("att_records_status_idx").on(t.status),
}));

/* 9. 출퇴근 수정 요청 */
export const attCorrections = pgTable("att_corrections", {
  id:                  serial("id").primaryKey(),
  memberUid:           varchar("member_uid", { length: 36 }).notNull(),
  targetDate:          date("target_date").notNull(),
  correctionType:      varchar("correction_type", { length: 20 }).notNull(), // CHECK_IN|CHECK_OUT|BOTH
  requestedCheckIn:    timestamp("requested_check_in"),
  requestedCheckOut:   timestamp("requested_check_out"),
  reason:              text("reason"),
  evidenceUrl:         text("evidence_url"),
  status:              varchar("status", { length: 20 }).default("PENDING").notNull(),
  reviewedBy:          varchar("reviewed_by", { length: 36 }),
  reviewNote:          text("review_note"),
  createdAt:           timestamp("created_at").defaultNow().notNull(),
  updatedAt:           timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  memberIdx: index("att_corrections_member_idx").on(t.memberUid),
  statusIdx: index("att_corrections_status_idx").on(t.status),
  dateIdx:   index("att_corrections_date_idx").on(t.targetDate),
}));

/* 10. 공휴일·회사 휴무일 */
export const attHolidays = pgTable("att_holidays", {
  id:        serial("id").primaryKey(),
  date:      date("date").notNull().unique(),
  name:      varchar("name", { length: 100 }).notNull(),
  type:      varchar("type", { length: 20 }).default("PUBLIC").notNull(),  // PUBLIC | COMPANY
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  dateIdx: index("att_holidays_date_idx").on(t.date),
  typeIdx: index("att_holidays_type_idx").on(t.type),
}));

export type AttWorkplace           = typeof attWorkplaces.$inferSelect;
export type NewAttWorkplace        = typeof attWorkplaces.$inferInsert;
export type AttPolicy              = typeof attPolicies.$inferSelect;
export type NewAttPolicy           = typeof attPolicies.$inferInsert;
export type AttLeaveType           = typeof attLeaveTypes.$inferSelect;
export type NewAttLeaveType        = typeof attLeaveTypes.$inferInsert;
export type AttLeaveBalance        = typeof attLeaveBalances.$inferSelect;
export type NewAttLeaveBalance     = typeof attLeaveBalances.$inferInsert;
export type AttLeaveRequest        = typeof attLeaveRequests.$inferSelect;
export type NewAttLeaveRequest     = typeof attLeaveRequests.$inferInsert;
export type AttSchedule            = typeof attSchedules.$inferSelect;
export type NewAttSchedule         = typeof attSchedules.$inferInsert;
export type AttScheduleOverride    = typeof attScheduleOverrides.$inferSelect;
export type NewAttScheduleOverride = typeof attScheduleOverrides.$inferInsert;
export type AttRecord              = typeof attRecords.$inferSelect;
export type NewAttRecord           = typeof attRecords.$inferInsert;
export type AttCorrection          = typeof attCorrections.$inferSelect;
export type NewAttCorrection       = typeof attCorrections.$inferInsert;
export type AttHoliday             = typeof attHolidays.$inferSelect;
export type NewAttHoliday          = typeof attHolidays.$inferInsert;

/* === Phase 26 정의 끝 === */

/* === Phase 27: 재택근무 보고서 === */

export const attRemoteWorkReports = pgTable("att_remote_work_reports", {
  id:             serial("id").primaryKey(),
  /* === R29-ATT-GAP1: migrate-att-r29-uid-fix 적용 완료 (2026-05-19)
     integer → varchar(36) 으로 변환. 다른 att_*.member_uid 9개 테이블과 컬럼 타입 통일.
     값은 members.id 의 문자열(예: "12") — att_records 등과 동일 규약. */
  memberUid:      varchar("member_uid", { length: 36 }).notNull(),
  date:           date("date").notNull(),
  wbsCardIds:     jsonb("wbs_card_ids").default([]),
  content:        text("content"),
  aiDraft:        text("ai_draft"),
  qualityScore:   integer("quality_score"),
  status:         varchar("status", { length: 20 }).default("DRAFT").notNull(),
  submittedAt:    timestamp("submitted_at", { withTimezone: true }),
  supervisorNote: text("supervisor_note"),
  isStarred:      boolean("is_starred").default(false),
  createdAt:      timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  memberDateUq: uniqueIndex("att_remote_work_reports_member_date_uq").on(t.memberUid, t.date),
  memberUidIdx: index("idx_arr_member_uid2").on(t.memberUid),
  dateIdx2:     index("idx_arr_date2").on(t.date),
  statusIdx2:   index("idx_arr_status2").on(t.status),
}));

export type AttRemoteWorkReport    = typeof attRemoteWorkReports.$inferSelect;
export type NewAttRemoteWorkReport = typeof attRemoteWorkReports.$inferInsert;

/* === Phase 27 정의 끝 === */

/* === R29-MS-GAP1 === */
/* 마일스톤 정의 변경 이력 (마이그레이션 migrate-ms-r29-hold-reason 적용 완료)
 * 컬럼: id, definition_id, changed_by(members.id), changed_at, field_name, old_value, new_value
 * 인덱스: (definition_id, changed_at DESC) */
export const milestoneDefinitionHistory = pgTable("milestone_definition_history", {
  id:           serial("id").primaryKey(),
  definitionId: integer("definition_id").notNull(),
  changedBy:    integer("changed_by").notNull(),
  changedAt:    timestamp("changed_at", { withTimezone: true }).defaultNow().notNull(),
  fieldName:    varchar("field_name", { length: 60 }).notNull(),
  oldValue:     text("old_value"),
  newValue:     text("new_value"),
}, (t) => ({
  defChangedIdx: index("ms_def_hist_def_idx").on(t.definitionId, t.changedAt),
}));

/* =========================================================
   === R37 Payroll === (2026-05-20)
   설계서: docs/milestones/2026-05-20-r37-payroll-integration.md
   마이그레이션: migrate-r37-payroll (호출 완료 → 파일 삭제)
   범위: 근태(att_records) + 성과(quarterly_settlements) + 회원(baseSalary) 월별 통합 명세서
   ========================================================= */

/* 1. 월별 급여 명세서 */
export const payrollSlips = pgTable("payroll_slips", {
  id:                   serial("id").primaryKey(),
  memberUid:            varchar("member_uid", { length: 36 }).notNull(),   // members.id 문자열 (att_records 규약)
  payYear:              integer("pay_year").notNull(),
  payMonth:             integer("pay_month").notNull(),                    // CHECK 1~12 (DB 제약)

  // 근태 집계
  workingDays:          integer("working_days").default(0).notNull(),
  workingMins:          integer("working_mins").default(0).notNull(),
  overtimeMins:         integer("overtime_mins").default(0).notNull(),
  lateCount:            integer("late_count").default(0).notNull(),
  absentCount:          integer("absent_count").default(0).notNull(),
  paidLeaveDays:        numeric("paid_leave_days", { precision: 5, scale: 1 }).default("0").notNull(),
  unpaidLeaveDays:      numeric("unpaid_leave_days", { precision: 5, scale: 1 }).default("0").notNull(),
  perfectAttendance:    boolean("perfect_attendance").default(false).notNull(),

  // 급여 구성 (KRW·세전)
  baseSalaryMonth:      numeric("base_salary_month", { precision: 15, scale: 2 }).default("0").notNull(),
  overtimePay:          numeric("overtime_pay", { precision: 15, scale: 2 }).default("0").notNull(),
  deductionUnpaid:      numeric("deduction_unpaid", { precision: 15, scale: 2 }).default("0").notNull(),
  performanceBonus:     numeric("performance_bonus", { precision: 15, scale: 2 }).default("0").notNull(),
  perfectBonus:         numeric("perfect_bonus", { precision: 15, scale: 2 }).default("0").notNull(),
  grossPay:             numeric("gross_pay", { precision: 15, scale: 2 }).default("0").notNull(),

  // 상태·발송 (DRAFT|REVIEWED|APPROVED|SENT|HOLD)
  status:               varchar("status", { length: 20 }).default("DRAFT").notNull(),
  reviewedBy:           varchar("reviewed_by", { length: 36 }),
  reviewedAt:           timestamp("reviewed_at"),
  reviewNote:           text("review_note"),
  approvedBy:           varchar("approved_by", { length: 36 }),
  approvedAt:           timestamp("approved_at"),
  sentAt:               timestamp("sent_at"),
  emailSentTo:          text("email_sent_to"),
  pdfUrl:               text("pdf_url"),

  // 급여 고도화 (2026-05-20): 수동 수정 잠금·조정 라인·공제·실수령·지급 확정
  manuallyEdited:       boolean("manually_edited").default(false).notNull(),
  adjustments:          jsonb("adjustments").$type<any[]>().default([]).notNull(),  // [{label, amount, kind:'ADD'|'DEDUCT', reason}]
  incomeTax:            numeric("income_tax", { precision: 15, scale: 2 }).default("0").notNull(),
  localTax:             numeric("local_tax", { precision: 15, scale: 2 }).default("0").notNull(),
  nationalPension:      numeric("national_pension", { precision: 15, scale: 2 }).default("0").notNull(),
  healthInsurance:      numeric("health_insurance", { precision: 15, scale: 2 }).default("0").notNull(),
  longTermCare:         numeric("long_term_care", { precision: 15, scale: 2 }).default("0").notNull(),
  employmentInsurance:  numeric("employment_insurance", { precision: 15, scale: 2 }).default("0").notNull(),
  otherDeduction:       numeric("other_deduction", { precision: 15, scale: 2 }).default("0").notNull(),
  totalDeduction:       numeric("total_deduction", { precision: 15, scale: 2 }).default("0").notNull(),
  netPay:               numeric("net_pay", { precision: 15, scale: 2 }).default("0").notNull(),
  paidAt:               timestamp("paid_at"),
  paidBy:               varchar("paid_by", { length: 36 }),

  calculationSnapshot:  jsonb("calculation_snapshot"),

  /* === 전자서명·증빙보관 (2026-07-11, migrate-payroll-esign) ===
     문서 고정: 교부(발송) 시점의 PDF를 저장소에 확정 보관하고 지문(해시)을 남긴다.
     (과거엔 다운로드마다 즉석 생성 → 요율·기준이 바뀌면 과거 명세서가 달라져 서명 증빙 불가) */
  documentVersion:      integer("document_version").default(1).notNull(),   // 정정 재발행 시 증가
  documentR2Key:        text("document_r2_key"),                            // 확정 문서(미서명)
  documentSha256:       varchar("document_sha256", { length: 64 }),         // 무결성 지문
  signedDocumentR2Key:  text("signed_document_r2_key"),                     // 서명본
  issuedAt:             timestamp("issued_at"),                             // 교부일 (문서에 찍히는 고정 날짜)
  firstViewedAt:        timestamp("first_viewed_at"),                       // 직원이 처음 열어본 시각
  ackStatus:            varchar("ack_status", { length: 20 }).default("PENDING").notNull(), // PENDING|ACKNOWLEDGED|OBJECTED
  ackAt:                timestamp("ack_at"),
  reminderSentAt:       timestamp("reminder_sent_at"),                       // 미서명 독촉 마지막 발송
  reminderCount:        integer("reminder_count").default(0).notNull(),

  createdAt:            timestamp("created_at").defaultNow().notNull(),
  updatedAt:            timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  memberMonthUq: uniqueIndex("payroll_slips_member_month_uq").on(t.memberUid, t.payYear, t.payMonth),
  memberIdx:     index("idx_payroll_slips_member").on(t.memberUid),
  monthIdx:      index("idx_payroll_slips_month").on(t.payYear, t.payMonth),
  statusIdx:     index("idx_payroll_slips_status").on(t.status),
}));

/* 2. 발송 감사 추적 */
export const payrollSendHistory = pgTable("payroll_send_history", {
  id:           serial("id").primaryKey(),
  slipId:       integer("slip_id").notNull().references(() => payrollSlips.id, { onDelete: "cascade" }),
  sentBy:       varchar("sent_by", { length: 36 }).notNull(),
  sentTo:       text("sent_to").notNull(),
  status:       varchar("status", { length: 20 }).notNull(),   // SUCCESS|FAILED
  errorMessage: text("error_message"),
  resendId:     text("resend_id"),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  slipIdx:   index("idx_payroll_send_history_slip").on(t.slipId),
  statusIdx: index("idx_payroll_send_history_status").on(t.status),
}));

export type PayrollSlip          = typeof payrollSlips.$inferSelect;
export type NewPayrollSlip       = typeof payrollSlips.$inferInsert;
export type PayrollSendHistory   = typeof payrollSendHistory.$inferSelect;
export type NewPayrollSendHistory = typeof payrollSendHistory.$inferInsert;

/* 3. 급여 계산 기준 (단일행 id=1) — 2026-05-20 급여 고도화 */
export const payrollSettings = pgTable("payroll_settings", {
  id:                  serial("id").primaryKey(),
  overtimeMultiplier:  numeric("overtime_multiplier", { precision: 5, scale: 2 }).default("1.5").notNull(),
  annualHours:         integer("annual_hours").default(2080).notNull(),
  monthlyWorkDays:     integer("monthly_work_days").default(22).notNull(),
  pensionRate:         numeric("pension_rate", { precision: 6, scale: 5 }).default("0.045").notNull(),
  healthRate:          numeric("health_rate", { precision: 6, scale: 5 }).default("0.03545").notNull(),
  longtermRate:        numeric("longterm_rate", { precision: 6, scale: 5 }).default("0.1295").notNull(),
  employmentRate:      numeric("employment_rate", { precision: 6, scale: 5 }).default("0.009").notNull(),
  incomeTaxRate:       numeric("income_tax_rate", { precision: 6, scale: 5 }).default("0").notNull(),
  updatedAt:           timestamp("updated_at").defaultNow().notNull(),
  updatedBy:           varchar("updated_by", { length: 36 }),
});

/* 4. 급여 명세서 수정 이력 (감사) — 2026-05-20 급여 고도화 */
export const payrollAudit = pgTable("payroll_audit", {
  id:         serial("id").primaryKey(),
  slipId:     integer("slip_id").notNull().references(() => payrollSlips.id, { onDelete: "cascade" }),
  changedBy:  varchar("changed_by", { length: 36 }).notNull(),
  field:      varchar("field", { length: 60 }).notNull(),
  oldValue:   text("old_value"),
  newValue:   text("new_value"),
  reason:     text("reason"),
  createdAt:  timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  slipIdx: index("idx_payroll_audit_slip").on(t.slipId),
}));

export type PayrollSettings    = typeof payrollSettings.$inferSelect;
export type NewPayrollSettings = typeof payrollSettings.$inferInsert;
export type PayrollAudit       = typeof payrollAudit.$inferSelect;
export type NewPayrollAudit    = typeof payrollAudit.$inferInsert;

/* === R37 Payroll 정의 끝 === */

/* === R36-Att-Optional A-1: 직원 역방향 근무형태 변경 신청 ===
 * 마이그레이션 migrate-att-r36-workmode-change 적용 완료 (2026-05-20, main @ 5328383)
 * 직원이 슈퍼어드민에게 근무형태(OFFICE/REMOTE/FIELD/BUSINESS_TRIP/HYBRID) 변경을 신청
 * APPROVED 시 att_schedule_overrides INSERT 또는 schedule 갱신 (admin 결재 측 처리)
 */
export const attWorkmodeChangeRequests = pgTable("att_workmode_change_requests", {
  id:           serial("id").primaryKey(),
  memberUid:    varchar("member_uid", { length: 36 }).notNull(),
  targetMode:   varchar("target_mode", { length: 30 }).notNull(),    // OFFICE|REMOTE|FIELD|BUSINESS_TRIP|HYBRID
  targetDate:   date("target_date").notNull(),                        // 적용 희망일 (단발)
  reason:       text("reason"),
  status:       varchar("status", { length: 20 }).default("PENDING").notNull(),  // PENDING|APPROVED|REJECTED
  reviewedBy:   varchar("reviewed_by", { length: 36 }),
  reviewNote:   text("review_note"),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
  updatedAt:    timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  memberIdx: index("att_wm_change_member_idx").on(t.memberUid),
  statusIdx: index("att_wm_change_status_idx").on(t.status),
  dateIdx:   index("att_wm_change_date_idx").on(t.targetDate),
}));

export type AttWorkmodeChangeRequest    = typeof attWorkmodeChangeRequests.$inferSelect;
export type NewAttWorkmodeChangeRequest = typeof attWorkmodeChangeRequests.$inferInsert;

/* =========================================================
   === R39 Stage 1: 역할 카탈로그 (milestone_roles) ===
   ========================================================= */

export const milestoneRoles = pgTable("milestone_roles", {
  id:          serial("id").primaryKey(),
  code:        varchar("code", { length: 10 }).notNull().unique(),
  name:        varchar("name", { length: 50 }).notNull(),
  description: text("description"),
  sortOrder:   integer("sort_order").default(0).notNull(),
  isActive:    boolean("is_active").default(true).notNull(),
  /* ★ Q3-045: 라이브 DB에 이미 존재(migrate-milestone-role-caps) — schema 정의만 동기화(회귀 예방·append-only) */
  revenueCap:    numeric("revenue_cap", { precision: 15, scale: 2 }),
  nonRevenueCap: numeric("non_revenue_cap", { precision: 15, scale: 2 }),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
  updatedAt:   timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  isActiveIdx: index("milestone_roles_is_active_idx").on(t.isActive),
}));

export type MilestoneRole    = typeof milestoneRoles.$inferSelect;
export type NewMilestoneRole = typeof milestoneRoles.$inferInsert;

/* =========================================================
   === R39 Stage 7: 휴가 수동 조정 이력 + 어드민 출퇴근 수정 이력 ===
   ========================================================= */

/* 휴가 잔여 수동 조정 이력 (감사 추적) */
export const attLeaveBalanceAdjustments = pgTable("att_leave_balance_adjustments", {
  id:          serial("id").primaryKey(),
  memberUid:   varchar("member_uid", { length: 36 }).notNull(),
  leaveTypeId: integer("leave_type_id").notNull(),
  year:        integer("year").notNull(),
  deltaDays:   numeric("delta_days", { precision: 6, scale: 2 }).notNull(),
  reason:      text("reason").notNull(),
  adjustedBy:  varchar("adjusted_by", { length: 36 }).notNull(),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  memberIdx:     index("att_lba_member_idx").on(t.memberUid),
  typeIdx:       index("att_lba_type_idx").on(t.leaveTypeId),
  memberYearIdx: index("att_lba_member_year_idx").on(t.memberUid, t.year),
}));

export type AttLeaveBalanceAdjustment    = typeof attLeaveBalanceAdjustments.$inferSelect;
export type NewAttLeaveBalanceAdjustment = typeof attLeaveBalanceAdjustments.$inferInsert;

/* 어드민 출퇴근 수정 이력 (감사 추적) */
export const attRecordAdminEdits = pgTable("att_record_admin_edits", {
  id:           serial("id").primaryKey(),
  recordId:     integer("record_id").notNull().references(() => attRecords.id, { onDelete: "cascade" }),
  editedBy:     varchar("edited_by", { length: 36 }).notNull(),
  oldCheckIn:   timestamp("old_check_in"),
  oldCheckOut:  timestamp("old_check_out"),
  oldWorkMode:  varchar("old_work_mode", { length: 30 }),
  newCheckIn:   timestamp("new_check_in"),
  newCheckOut:  timestamp("new_check_out"),
  newWorkMode:  varchar("new_work_mode", { length: 30 }),
  reason:       text("reason").notNull(),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  recordIdx:   index("att_rae_record_idx").on(t.recordId),
  editedByIdx: index("att_rae_edited_by_idx").on(t.editedBy),
}));

export type AttRecordAdminEdit    = typeof attRecordAdminEdits.$inferSelect;
export type NewAttRecordAdminEdit = typeof attRecordAdminEdits.$inferInsert;

/* === 추모관 R1: 유가족 이야기 (2026-05-24) === */
export const familyStories = pgTable("family_stories", {
  id:           serial("id").primaryKey(),
  youtubeId:    varchar("youtube_id", { length: 20 }),
  youtubeUrl:   text("youtube_url"),
  title:        varchar("title", { length: 200 }).notNull(),
  subtitle:     varchar("subtitle", { length: 300 }),
  thumbnailUrl: text("thumbnail_url"),
  summary:      varchar("summary", { length: 500 }),
  detailHtml:   text("detail_html"),
  adminNotes:   text("admin_notes"),
  duration:     varchar("duration", { length: 12 }),
  category:     varchar("category", { length: 30 }).default("voice").notNull(),
  status:       varchar("status", { length: 12 }).default("draft").notNull(),
  sortOrder:    integer("sort_order").default(0).notNull(),
  viewCount:    integer("view_count").default(0).notNull(),
  publishedAt:  timestamp("published_at"),
  createdBy:    integer("created_by"),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
  updatedAt:    timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  statusSortIdx: index("family_stories_status_sort_idx").on(t.status, t.sortOrder),
}));

export type FamilyStory    = typeof familyStories.$inferSelect;
export type NewFamilyStory = typeof familyStories.$inferInsert;

/* === 추모관 R2: 온라인 추모관 본체 (2026-05-24) === */
export const memorialSettings = pgTable("memorial_settings", {
  id:            serial("id").primaryKey(),
  heroYoutubeId: varchar("hero_youtube_id", { length: 20 }),
  heroCopy:      varchar("hero_copy", { length: 300 }),
  bgmTracks:     jsonb("bgm_tracks"),                       // [{title,url}]
  updatedAt:     timestamp("updated_at").defaultNow().notNull(),
});
export type MemorialSettings    = typeof memorialSettings.$inferSelect;
export type NewMemorialSettings = typeof memorialSettings.$inferInsert;

export const memorialTeachers = pgTable("memorial_teachers", {
  id:           serial("id").primaryKey(),
  name:         varchar("name", { length: 60 }).notNull(),
  photoBlobId:  integer("photo_blob_id"),                  // null = 실루엣
  schoolRegion: varchar("school_region", { length: 120 }),
  birthDate:    date("birth_date"),
  deathDate:    date("death_date"),
  tributeLine:  varchar("tribute_line", { length: 200 }),
  bioHtml:      text("bio_html"),
  timeline:     jsonb("timeline"),                         // [{date,title,desc}]
  isPublic:     boolean("is_public").default(true).notNull(),
  sortOrder:    integer("sort_order").default(0).notNull(),
  createdBy:    integer("created_by"),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
  updatedAt:    timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({ pubSortIdx: index("memorial_teachers_pub_sort_idx").on(t.isPublic, t.sortOrder) }));
export type MemorialTeacher    = typeof memorialTeachers.$inferSelect;
export type NewMemorialTeacher = typeof memorialTeachers.$inferInsert;

export const memorialOfferings = pgTable("memorial_offerings", {
  id:           serial("id").primaryKey(),
  teacherId:    integer("teacher_id"),                     // null = 통합 헌화
  memberId:     integer("member_id"),
  nickname:     varchar("nickname", { length: 40 }),
  offeringType: varchar("offering_type", { length: 10 }).notNull(),  // candle|flower
  ipHash:       varchar("ip_hash", { length: 64 }),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
}, (t) => ({ teacherIdx: index("memorial_offerings_teacher_idx").on(t.teacherId) }));
export type MemorialOffering    = typeof memorialOfferings.$inferSelect;
export type NewMemorialOffering = typeof memorialOfferings.$inferInsert;

export const memorialMessages = pgTable("memorial_messages", {
  id:          serial("id").primaryKey(),
  teacherId:   integer("teacher_id"),                      // null = 통합 방명록
  memberId:    integer("member_id"),
  authorName:  varchar("author_name", { length: 50 }).notNull(),
  content:     varchar("content", { length: 1000 }).notNull(),
  isAnonymous: boolean("is_anonymous").default(false).notNull(),
  likeCount:   integer("like_count").default(0).notNull(),
  reportCount: integer("report_count").default(0).notNull(),
  isHidden:    boolean("is_hidden").default(false).notNull(),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
}, (t) => ({ teacherIdx: index("memorial_messages_teacher_idx").on(t.teacherId, t.isHidden) }));
export type MemorialMessage    = typeof memorialMessages.$inferSelect;
export type NewMemorialMessage = typeof memorialMessages.$inferInsert;

export const memorialLetters = pgTable("memorial_letters", {
  id:          serial("id").primaryKey(),
  teacherId:   integer("teacher_id").notNull(),
  memberId:    integer("member_id"),
  authorName:  varchar("author_name", { length: 50 }).notNull(),
  title:       varchar("title", { length: 150 }),
  content:     text("content").notNull(),
  isAnonymous: boolean("is_anonymous").default(false).notNull(),
  reportCount: integer("report_count").default(0).notNull(),
  isHidden:    boolean("is_hidden").default(false).notNull(),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
});
export type MemorialLetter    = typeof memorialLetters.$inferSelect;
export type NewMemorialLetter = typeof memorialLetters.$inferInsert;

export const memorialMessageLikes = pgTable("memorial_message_likes", {
  id:        serial("id").primaryKey(),
  messageId: integer("message_id").notNull(),
  memberId:  integer("member_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({ uniq: uniqueIndex("memorial_msg_like_uniq").on(t.messageId, t.memberId) }));
export type MemorialMessageLike    = typeof memorialMessageLikes.$inferSelect;
export type NewMemorialMessageLike = typeof memorialMessageLikes.$inferInsert;

/* === RAG 검색 인프라 2026-05-26 === */
// embedding 컬럼은 raw SQL로만 접근 — 여기엔 정의하지 않음
export const aiRagDocuments = pgTable("ai_rag_documents", {
  id:         bigserial("id", { mode: "number" }).primaryKey(),
  sourceType: varchar("source_type", { length: 16 }).notNull(),
  sourceRef:  text("source_ref").notNull(),
  title:      text("title"),
  content:    text("content").notNull(),
  tokenCount: integer("token_count").default(0),
  caseId:     integer("case_id"),   // 순직 사건 격리 검색용 (migrate-martyrdom-setup 적용 2026-05-26·martyr_active/martyr_case row만 채움)
  createdAt:  timestamp("created_at").defaultNow(),
  updatedAt:  timestamp("updated_at").defaultNow(),
});
export type AiRagDocument    = typeof aiRagDocuments.$inferSelect;
export type NewAiRagDocument = typeof aiRagDocuments.$inferInsert;

/* === 순직 인정 지원 시스템 (2026-05-26) === 마이그 적용 완료·활성화 (migrate-martyrdom-setup 호출됨 2026-05-26) */
export const martyrdomCases = pgTable("martyrdom_cases", {
  id: serial("id").primaryKey(),
  caseNo: varchar("case_no", { length: 30 }).unique().notNull(),
  caseKind: varchar("case_kind", { length: 12 }).default("active").notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  deceasedName: varchar("deceased_name", { length: 50 }),
  schoolName: varchar("school_name", { length: 150 }),
  position: varchar("position", { length: 50 }),
  deceasedAt: date("deceased_at"),
  occurredSummary: text("occurred_summary"),
  status: varchar("status", { length: 20 }).default("intake").notNull(),
  outcome: varchar("outcome", { length: 12 }),
  outcomeNote: text("outcome_note"),
  procedureStage: varchar("procedure_stage", { length: 20 }),
  nextDeadlineAt: date("next_deadline_at"),
  nextDeadlineLabel: varchar("next_deadline_label", { length: 100 }),
  consentNote: text("consent_note"),                          // P2 라 유족 동의 기록
  consentObtainedAt: timestamp("consent_obtained_at"),        // P2 라 동의 일시
  extractionJson: jsonb("extraction_json"),
  extractedAt: timestamp("extracted_at"),
  assignedAdminId: integer("assigned_admin_id").references(() => members.id, { onDelete: "set null" }),
  workspaceTaskId: integer("workspace_task_id"),
  createdBy: integer("created_by").references(() => members.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  caseNoIdx: index("martyrdom_cases_case_no_idx").on(t.caseNo),
  kindIdx: index("martyrdom_cases_kind_idx").on(t.caseKind),
  statusIdx: index("martyrdom_cases_status_idx").on(t.status),
  outcomeIdx: index("martyrdom_cases_outcome_idx").on(t.outcome),
}));
export type MartyrdomCase    = typeof martyrdomCases.$inferSelect;
export type NewMartyrdomCase = typeof martyrdomCases.$inferInsert;

export const martyrdomCaseDocuments = pgTable("martyrdom_case_documents", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").references(() => martyrdomCases.id, { onDelete: "cascade" }).notNull(),
  blobId: integer("blob_id"),
  fileName: varchar("file_name", { length: 500 }).notNull(),
  mimeType: varchar("mime_type", { length: 100 }),
  sizeBytes: integer("size_bytes").default(0),
  docType: varchar("doc_type", { length: 30 }),
  docTypeAuto: varchar("doc_type_auto", { length: 30 }),
  docSummary: text("doc_summary"),
  classifyConfidence: integer("classify_confidence").default(0),
  extractStatus: varchar("extract_status", { length: 20 }).default("pending").notNull(),
  extractMethod: varchar("extract_method", { length: 20 }),
  extractedText: text("extracted_text"),
  extractError: text("extract_error"),
  indexedToRag: boolean("indexed_to_rag").default(false),
  blobKey: varchar("blob_key", { length: 1000 }),
  evidenceStrength: varchar("evidence_strength", { length: 10 }),   // P2 증거강도 strong|medium|weak
  createdBy: integer("created_by").references(() => members.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  caseIdx: index("martyrdom_docs_case_idx").on(t.caseId),
  statusIdx: index("martyrdom_docs_status_idx").on(t.extractStatus),
}));
export type MartyrdomCaseDocument    = typeof martyrdomCaseDocuments.$inferSelect;
export type NewMartyrdomCaseDocument = typeof martyrdomCaseDocuments.$inferInsert;

export const martyrdomAiOutputs = pgTable("martyrdom_ai_outputs", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").references(() => martyrdomCases.id, { onDelete: "cascade" }).notNull(),
  outputType: varchar("output_type", { length: 20 }).notNull(),
  version: integer("version").default(1).notNull(),
  contentText: text("content_text"),
  contentJson: jsonb("content_json"),
  ragSources: jsonb("rag_sources"),
  modelUsed: varchar("model_used", { length: 40 }),
  status: varchar("status", { length: 12 }).default("draft").notNull(),
  reviewedBy: integer("reviewed_by").references(() => members.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at"),
  reviewNote: text("review_note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  caseIdx: index("martyrdom_outputs_case_idx").on(t.caseId),
  typeIdx: index("martyrdom_outputs_type_idx").on(t.outputType),
}));
export type MartyrdomAiOutput    = typeof martyrdomAiOutputs.$inferSelect;
export type NewMartyrdomAiOutput = typeof martyrdomAiOutputs.$inferInsert;

export const martyrdomGoldenItems = pgTable("martyrdom_golden_items", {
  id: serial("id").primaryKey(),
  channel: varchar("channel", { length: 12 }).notNull(),
  label: varchar("label", { length: 150 }).notNull(),
  guidance: text("guidance"),
  volatility: integer("volatility").default(3),
  sortOrder: integer("sort_order").default(0),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type MartyrdomGoldenItem    = typeof martyrdomGoldenItems.$inferSelect;
export type NewMartyrdomGoldenItem = typeof martyrdomGoldenItems.$inferInsert;

/* === P2 순직 인정 지원 (2026-05-26) — ✅ 활성화(migrate-martyrdom-p2 적용 후·§9.2) ===
   순직 모듈 코드는 raw SQL(sql.raw) 접근 — 아래 정의는 타입·문서·drizzle-kit 정합용.
   기존 테이블 추가 컬럼은 각 정의에 반영(martyrdomCaseDocuments.evidenceStrength / martyrdomCases.consentNote·consentObtainedAt). */

export const martyrdomDeadlines = pgTable("martyrdom_deadlines", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").references(() => martyrdomCases.id, { onDelete: "cascade" }).notNull(),
  label: varchar("label", { length: 200 }).notNull(),
  kind: varchar("kind", { length: 30 }).default("custom"),          // statute_limit | submission | hearing | custom
  dueDate: date("due_date").notNull(),
  stage: varchar("stage", { length: 40 }),
  status: varchar("status", { length: 20 }).default("pending").notNull(), // pending|done|overdue
  alertedAt: timestamp("alerted_at"),
  note: text("note"),
  createdBy: integer("created_by").references(() => members.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  caseIdx: index("martyrdom_deadlines_case_idx").on(t.caseId),
  dueIdx: index("martyrdom_deadlines_due_idx").on(t.dueDate),
}));
export type MartyrdomDeadline    = typeof martyrdomDeadlines.$inferSelect;
export type NewMartyrdomDeadline = typeof martyrdomDeadlines.$inferInsert;

export const martyrdomCriteria = pgTable("martyrdom_criteria", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  category: varchar("category", { length: 60 }).notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  description: text("description"),
  evidenceHint: text("evidence_hint"),
  lawRef: varchar("law_ref", { length: 300 }),
  weight: integer("weight").default(1),
  sortOrder: integer("sort_order").default(0),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type MartyrdomCriterion    = typeof martyrdomCriteria.$inferSelect;
export type NewMartyrdomCriterion = typeof martyrdomCriteria.$inferInsert;

export const martyrdomActions = pgTable("martyrdom_actions", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").references(() => martyrdomCases.id, { onDelete: "cascade" }).notNull(),
  item: varchar("item", { length: 300 }).notNull(),
  detail: text("detail"),
  status: varchar("status", { length: 20 }).default("todo").notNull(),  // todo|doing|done
  source: varchar("source", { length: 30 }).default("manual"),          // missing_evidence(AI)|manual
  dueDate: date("due_date"),
  workspaceTaskId: integer("workspace_task_id"),
  sortOrder: integer("sort_order").default(0),
  createdBy: integer("created_by").references(() => members.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({ caseIdx: index("martyrdom_actions_case_idx").on(t.caseId) }));
export type MartyrdomAction    = typeof martyrdomActions.$inferSelect;
export type NewMartyrdomAction = typeof martyrdomActions.$inferInsert;
/* === P2 순직 인정 지원 끝 === */

/* === P3 서면 === (마이그 migrate-martyrdom-p3 적용 확인 후 활성화 — 2026-05-27)
   순직 모듈 코드는 raw SQL(sql.raw)로 접근·아래 정의는 타입·문서·drizzle-kit 정합용. */

// (1) 유족급여신청서 초안 섹션 — 목차 확인 후 섹션별 생성·편집
export const martyrdomDraftSections = pgTable("martyrdom_draft_sections", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").notNull().references(() => martyrdomCases.id, { onDelete: "cascade" }),
  outputId: integer("output_id").references(() => martyrdomAiOutputs.id, { onDelete: "cascade" }), // 부모 'draft' ai_outputs 행
  sectionKey: varchar("section_key", { length: 40 }).notNull(),           // intro·deceased·duty·medical·timeline·criteria·counter·conclusion 등
  title: varchar("title", { length: 200 }).notNull(),
  sectionOrder: integer("section_order").notNull().default(0),
  intent: text("intent"),                                                  // 목차 단계의 섹션 의도(생성 지시)
  content: text("content"),                                                // 생성·편집된 본문
  ragSources: jsonb("rag_sources"),                                        // [{title,sourceRef,snippet}]
  status: varchar("status", { length: 20 }).notNull().default("pending"),  // pending|generating|done|edited
  wordCount: integer("word_count").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  caseIdx: index("martyrdom_draft_sections_case_idx").on(t.caseId),
  outputIdx: index("martyrdom_draft_sections_output_idx").on(t.outputId),
}));
export type MartyrdomDraftSection    = typeof martyrdomDraftSections.$inferSelect;
export type NewMartyrdomDraftSection = typeof martyrdomDraftSections.$inferInsert;

// (2) 전문가 검토 배정·결정 (협회 내부)
export const martyrdomReviews = pgTable("martyrdom_reviews", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").notNull().references(() => martyrdomCases.id, { onDelete: "cascade" }),
  outputId: integer("output_id").notNull().references(() => martyrdomAiOutputs.id, { onDelete: "cascade" }), // 검토 대상 'draft'
  assignedTo: integer("assigned_to").notNull().references(() => members.id),         // 검토자(운영자)
  assignedBy: integer("assigned_by").references(() => members.id),
  status: varchar("status", { length: 20 }).notNull().default("pending"),            // pending|approved|changes_requested
  note: text("note"),                                                                // 검토 코멘트
  createdAt: timestamp("created_at").defaultNow(),
  decidedAt: timestamp("decided_at"),
}, (t) => ({
  caseIdx: index("martyrdom_reviews_case_idx").on(t.caseId),
  outputIdx: index("martyrdom_reviews_output_idx").on(t.outputId),
  assignedIdx: index("martyrdom_reviews_assigned_idx").on(t.assignedTo),
}));
export type MartyrdomReview    = typeof martyrdomReviews.$inferSelect;
export type NewMartyrdomReview = typeof martyrdomReviews.$inferInsert;
/* === P3 서면 끝 === */

/* === P4 발간 === (migrate-martyrdom-p4 적용 완료·활성화 — 2026-05-27) */
export const martyrdomPublications = pgTable("martyrdom_publications", {
  id: serial("id").primaryKey(),
  pubType: varchar("pub_type", { length: 20 }).notNull(),       // guide | trend | case_study
  title: varchar("title", { length: 200 }).notNull(),
  contentHtml: text("content_html"),
  contentJson: jsonb("content_json"),
  blendRatio: jsonb("blend_ratio"),                              // {self:70, ai:30}
  sourceCaseIds: jsonb("source_case_ids"),
  anonymized: boolean("anonymized").notNull().default(true),
  reidRisk: varchar("reid_risk", { length: 10 }).default("low"),
  ragSources: jsonb("rag_sources"),
  status: varchar("status", { length: 12 }).notNull().default("draft"),
  createdBy: integer("created_by").references(() => members.id),
  reviewedBy: integer("reviewed_by").references(() => members.id),
  publishedBy: integer("published_by").references(() => members.id),
  createdAt: timestamp("created_at").defaultNow(),
  publishedAt: timestamp("published_at"),
}, (t) => ({
  pubTypeIdx: index("martyrdom_pub_type_idx").on(t.pubType),
  statusIdx: index("martyrdom_pub_status_idx").on(t.status),
}));
export type MartyrdomPublication    = typeof martyrdomPublications.$inferSelect;
export type NewMartyrdomPublication = typeof martyrdomPublications.$inferInsert;
/* === P4 발간 끝 === */

/* === Q4-005 (R41): org-news 테이블 정의 동기화 (append-only) ===
   라이브 DB에는 1회용 마이그로 이미 생성·사용 중(모든 접근이 raw db.execute(sql)).
   drizzle 타입/문서 동기화 목적의 정의 — 컬럼은 실제 INSERT/SELECT(raw SQL)와 일치. */
export const orgNewsSettings = pgTable("org_news_settings", {
  id:          integer("id").primaryKey(),          // 단일 행(id=1) upsert
  keywords:    text("keywords").array(),
  scopes:      text("scopes").array(),
  perCombo:    integer("per_combo"),
  autoEnabled: boolean("auto_enabled"),
  cronHourKst: integer("cron_hour_kst"),
  updatedAt:   timestamp("updated_at"),
  updatedBy:   integer("updated_by"),
});

export const orgNewsReports = pgTable("org_news_reports", {
  id:              serial("id").primaryKey(),
  keywords:        text("keywords").array(),
  scopes:          text("scopes").array(),
  perCombo:        integer("per_combo"),
  collectedCount:  integer("collected_count"),
  items:           jsonb("items"),
  summary:         text("summary"),
  keywordCloud:    jsonb("keyword_cloud"),
  sentiment:       jsonb("sentiment"),
  recommendations: jsonb("recommendations"),
  diffSummary:     text("diff_summary"),
  aiStatus:        varchar("ai_status", { length: 20 }),
  incidents:       jsonb("incidents"),
  triggerType:     varchar("trigger_type", { length: 20 }),
  generatedBy:     integer("generated_by"),
  createdAt:       timestamp("created_at").defaultNow(),
});
/* === Q4-005 org-news 끝 === */

/* === R43 딥릴리프 데이터 축적 하이브리드 (2026-05-29) ===
   외부 자료(AI 검색 수집) — 내부 사건과 분리된 신규 테이블. 검토→승급 시 martyrdom_cases로 복사.
   RAG 격리: source_type='martyr_external' 키로만 색인(신청서 초안 검색에서 제외).
   마이그 migrate-martyrdom-external 호출 후 활성화 — 정의는 미리 추가(타입·drizzle-kit 정합용·접근은 raw SQL). */
export const martyrdomExternalResearch = pgTable("martyrdom_external_research", {
  id:              serial("id").primaryKey(),
  title:           varchar("title", { length: 500 }).notNull(),
  sourceUrl:       text("source_url"),
  sourceDomain:    varchar("source_domain", { length: 200 }),
  searchEngine:    varchar("search_engine", { length: 20 }).notNull(),     // 'gemini' | 'naver'
  searchQuery:     text("search_query"),
  publishedAt:     timestamp("published_at", { withTimezone: true }),
  snippet:         text("snippet"),
  contentFull:     text("content_full"),
  status:          varchar("status", { length: 20 }).notNull().default("pending"),
    // 'pending' | 'reviewing' | 'approved' | 'rejected'
  reviewedByUid:   integer("reviewed_by_uid"),
  reviewedAt:      timestamp("reviewed_at", { withTimezone: true }),
  rejectionReason: text("rejection_reason"),
  promotedCaseId:  integer("promoted_case_id"),
  meta:            jsonb("meta"),    // { geminiCitations?: string[]; naverThumbnail?: string; lang?: string }
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  statusIdx:       index("martyrdom_external_status_idx").on(t.status),
  engineIdx:       index("martyrdom_external_engine_idx").on(t.searchEngine),
  createdIdx:      index("martyrdom_external_created_idx").on(t.createdAt),
}));
export type MartyrdomExternalResearch    = typeof martyrdomExternalResearch.$inferSelect;
export type NewMartyrdomExternalResearch = typeof martyrdomExternalResearch.$inferInsert;

export const martyrdomExternalSettings = pgTable("martyrdom_external_settings", {
  id:               serial("id").primaryKey(),
  whitelistDomains: jsonb("whitelist_domains").notNull().default(sql`'[]'::jsonb`),   // string[]
  defaultQueries:   jsonb("default_queries").notNull().default(sql`'[]'::jsonb`),     // string[]
  lastCronAt:       timestamp("last_cron_at", { withTimezone: true }),
});
export type MartyrdomExternalSettings    = typeof martyrdomExternalSettings.$inferSelect;
export type NewMartyrdomExternalSettings = typeof martyrdomExternalSettings.$inferInsert;
/* === R43 딥릴리프 데이터 축적 하이브리드 끝 === */

/* =========================================================
   === 후원자 너처링 시스템 (2026-06-26) ===
   세그먼트(정기/예비-일시/예비-이탈/잠재)별 D0~D365 여정 + Evergreen.
   발송 자체는 communication_send_jobs/recipients 재사용 — 본 테이블은 오케스트레이션.
   migrate-nurture-schema 로 DB 생성.
   ========================================================= */

// 여정(=탭) — 세그먼트당 1개
export const nurtureJourneys = pgTable("nurture_journeys", {
  id:          serial("id").primaryKey(),
  segment:     varchar("segment", { length: 40 }).notNull().unique(), // regular | prospect_onetime | prospect_cancelled | potential
  name:        varchar("name", { length: 150 }).notNull(),
  isActive:    boolean("is_active").notNull().default(false),         // 기본 OFF — 운영자가 검토 후 켬
  entryBasis:  varchar("entry_basis", { length: 30 }).notNull().default("classified"), // D0 기준
  createdAt:   timestamp("created_at").defaultNow().notNull(),
  updatedAt:   timestamp("updated_at").defaultNow().notNull(),
});
export type NurtureJourney    = typeof nurtureJourneys.$inferSelect;
export type NewNurtureJourney = typeof nurtureJourneys.$inferInsert;

// 단계 — D0~D365 타임라인
export const nurtureSteps = pgTable("nurture_steps", {
  id:          serial("id").primaryKey(),
  journeyId:   integer("journey_id").notNull().references(() => nurtureJourneys.id, { onDelete: "cascade" }),
  dayOffset:   integer("day_offset").notNull(),                       // 0~365
  channel:     varchar("channel", { length: 20 }).notNull(),         // 기본(1차) 채널: sms|kakao|email|inapp
  templateId:  integer("template_id"),                               // 1차 채널 템플릿 (communication_templates.id)
  emailTemplateId: integer("email_template_id"),                     // ★ 보조 메일 템플릿(선택) — 이메일 있는 수신자에 추가 발송
  conditions:  jsonb("conditions").default(sql`'{}'::jsonb`),        // {notConverted, minAmount, cancelReason, ...}
  label:       varchar("label", { length: 120 }),
  sortOrder:   integer("sort_order").notNull().default(0),
  isActive:    boolean("is_active").notNull().default(true),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
  updatedAt:   timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  journeyIdx: index("nurture_steps_journey_idx").on(t.journeyId),
}));
export type NurtureStep    = typeof nurtureSteps.$inferSelect;
export type NewNurtureStep = typeof nurtureSteps.$inferInsert;

// D365 이후 영구 규칙 (Evergreen)
export const nurtureEvergreenRules = pgTable("nurture_evergreen_rules", {
  id:          serial("id").primaryKey(),
  journeyId:   integer("journey_id").notNull().references(() => nurtureJourneys.id, { onDelete: "cascade" }),
  cadence:     varchar("cadence", { length: 20 }).notNull(),         // monthly|quarterly|anniversary|yearend
  channel:     varchar("channel", { length: 20 }).notNull(),         // 1차 채널
  templateId:  integer("template_id"),
  emailTemplateId: integer("email_template_id"),                     // ★ 보조 메일 템플릿(선택)
  conditions:  jsonb("conditions").default(sql`'{}'::jsonb`),
  label:       varchar("label", { length: 120 }),
  isActive:    boolean("is_active").notNull().default(true),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
  updatedAt:   timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  journeyIdx: index("nurture_evergreen_journey_idx").on(t.journeyId),
}));
export type NurtureEvergreenRule    = typeof nurtureEvergreenRules.$inferSelect;
export type NewNurtureEvergreenRule = typeof nurtureEvergreenRules.$inferInsert;

// 회원×여정 진행 상태
export const nurtureEnrollments = pgTable("nurture_enrollments", {
  id:              serial("id").primaryKey(),
  memberId:        integer("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  journeyId:       integer("journey_id").notNull().references(() => nurtureJourneys.id, { onDelete: "cascade" }),
  enrolledAt:      timestamp("enrolled_at").notNull(),               // D0
  status:          varchar("status", { length: 20 }).notNull().default("active"), // active|converted|exited|completed
  convertedAt:     timestamp("converted_at"),
  lastEvergreenAt: timestamp("last_evergreen_at"),
  createdAt:       timestamp("created_at").defaultNow().notNull(),
  updatedAt:       timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  memberJourneyUq: uniqueIndex("nurture_enroll_member_journey_uq").on(t.memberId, t.journeyId),
  statusIdx:       index("nurture_enroll_status_idx").on(t.status),
}));
export type NurtureEnrollment    = typeof nurtureEnrollments.$inferSelect;
export type NewNurtureEnrollment = typeof nurtureEnrollments.$inferInsert;

// 단계별 발송 로그 (멱등·중복방지·KPI)
export const nurtureSends = pgTable("nurture_sends", {
  id:              serial("id").primaryKey(),
  enrollmentId:    integer("enrollment_id").notNull().references(() => nurtureEnrollments.id, { onDelete: "cascade" }),
  stepId:          integer("step_id").references(() => nurtureSteps.id, { onDelete: "set null" }),
  evergreenRuleId: integer("evergreen_rule_id").references(() => nurtureEvergreenRules.id, { onDelete: "set null" }),
  channel:         varchar("channel", { length: 20 }).notNull(),
  jobId:           integer("job_id"),                               // communication_send_jobs.id
  status:          varchar("status", { length: 20 }).notNull().default("queued"),
  sentAt:          timestamp("sent_at").defaultNow().notNull(),
}, (t) => ({
  enrollIdx: index("nurture_sends_enroll_idx").on(t.enrollmentId),
  // 타임라인 단계 멱등 — 같은 enrollment+step 1회만 (evergreen은 stepId NULL이라 별도)
  stepUq:    uniqueIndex("nurture_sends_enroll_step_uq").on(t.enrollmentId, t.stepId),
}));
export type NurtureSend    = typeof nurtureSends.$inferSelect;
export type NewNurtureSend = typeof nurtureSends.$inferInsert;

/* === 후원자 너처링 시스템 끝 === */

/* =========================================================
   === 예산안 고도화: 관-항-목 3계층 예산과목 === (2026-07-01)
   마이그: migrate-budget-hierarchy (적용 완료 후 활성)
   설계: docs/specs/예산안-고도화-설계-v1.md
   - budget_accounts:         관/항/목 트리 (parent_id 자기참조)
   - budget_account_code_map: 목 ↔ 회계 계정과목(account_codes.code) 연결
   ========================================================= */
export const budgetAccounts = pgTable("budget_accounts", {
  id:        serial("id").primaryKey(),
  level:     varchar("level", { length: 4 }).notNull(),          // '관'|'항'|'목'
  parentId:  integer("parent_id"),                                // → budget_accounts.id (관은 NULL)
  code:      varchar("code", { length: 30 }).notNull().unique(),
  name:      varchar("name", { length: 120 }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive:  boolean("is_active").notNull().default(true),
  isSystem:  boolean("is_system").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  parentIdx: index("budget_accounts_parent_idx").on(t.parentId),
  levelIdx:  index("budget_accounts_level_idx").on(t.level),
}));
export type BudgetAccount    = typeof budgetAccounts.$inferSelect;
export type NewBudgetAccount = typeof budgetAccounts.$inferInsert;

export const budgetAccountCodeMap = pgTable("budget_account_code_map", {
  id:              serial("id").primaryKey(),
  budgetAccountId: integer("budget_account_id").notNull().references(() => budgetAccounts.id, { onDelete: "cascade" }),
  accountCode:     varchar("account_code", { length: 20 }).notNull(),   // → account_codes.code
}, (t) => ({
  uq:            uniqueIndex("bacm_ba_code_uq").on(t.budgetAccountId, t.accountCode),
  accountCodeIdx: index("bacm_account_code_idx").on(t.accountCode),
  baIdx:          index("bacm_ba_idx").on(t.budgetAccountId),
}));
export type BudgetAccountCodeMap    = typeof budgetAccountCodeMap.$inferSelect;
export type NewBudgetAccountCodeMap = typeof budgetAccountCodeMap.$inferInsert;
/* === 예산안 고도화 관-항-목 끝 === */

/* =========================================================
   === 지출 결재라인·위임·지출결의서 === (2026-07-01·배치2)
   마이그: migrate-approval-system (적용 완료 후 활성)
   설계: docs/specs/예산안-고도화-설계-v1.md §0
   3계층 직책: operator(기안)/admin(국장·1차)/super_admin(이사장·최종)
   ========================================================= */
export const approvalLines = pgTable("approval_lines", {
  id:            serial("id").primaryKey(),
  name:          varchar("name", { length: 80 }).notNull(),
  minAmount:     bigint("min_amount", { mode: "number" }).notNull().default(0),
  maxAmount:     bigint("max_amount", { mode: "number" }),                 // null = 무제한
  steps:         jsonb("steps").notNull().default([]),                     // 직책 순서 배열 ["admin","super_admin"]
  boardRequired: boolean("board_required").notNull().default(false),
  isActive:      boolean("is_active").notNull().default(true),
  sortOrder:     integer("sort_order").notNull().default(0),
  createdAt:     timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
export type ApprovalLine    = typeof approvalLines.$inferSelect;
export type NewApprovalLine = typeof approvalLines.$inferInsert;

export const approvalRequests = pgTable("approval_requests", {
  id:                serial("id").primaryKey(),
  requestNo:         varchar("request_no", { length: 30 }).unique(),
  title:             varchar("title", { length: 200 }).notNull(),
  amount:            bigint("amount", { mode: "number" }).notNull(),
  description:       text("description"),
  budgetAccountId:   integer("budget_account_id"),                          // 예산 목(目)
  fiscalYear:        integer("fiscal_year").notNull(),
  occurredAt:        date("occurred_at"),
  payeeName:         varchar("payee_name", { length: 200 }),
  evidenceUrl:       varchar("evidence_url", { length: 500 }),
  drafterId:         integer("drafter_id"),
  drafterName:       varchar("drafter_name", { length: 100 }),
  approvalLineId:    integer("approval_line_id"),
  boardRequired:     boolean("board_required").notNull().default(false),
  steps:             jsonb("steps").notNull().default([]),                  // 직책 스냅샷
  currentStep:       integer("current_step").notNull().default(0),
  status:            varchar("status", { length: 20 }).notNull().default("pending"), // pending|approved|rejected|canceled
  expenseId:         integer("expense_id"),
  resolutionNo:      varchar("resolution_no", { length: 30 }),              // 제YYYY-NNNN호
  resolutionPdfUrl:  varchar("resolution_pdf_url", { length: 500 }),
  resolutionIssuedAt: timestamp("resolution_issued_at", { withTimezone: true }),
  createdAt:         timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:         timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  decidedAt:         timestamp("decided_at", { withTimezone: true }),
}, (t) => ({
  statusIdx:  index("approval_requests_status_idx").on(t.status),
  fyIdx:      index("approval_requests_fy_idx").on(t.fiscalYear),
  drafterIdx: index("approval_requests_drafter_idx").on(t.drafterId),
}));
export type ApprovalRequest    = typeof approvalRequests.$inferSelect;
export type NewApprovalRequest = typeof approvalRequests.$inferInsert;

export const approvalRequestSteps = pgTable("approval_request_steps", {
  id:            serial("id").primaryKey(),
  requestId:     integer("request_id").notNull().references(() => approvalRequests.id, { onDelete: "cascade" }),
  stepIndex:     integer("step_index").notNull(),
  role:          varchar("role", { length: 20 }).notNull(),
  decision:      varchar("decision", { length: 20 }).notNull().default("pending"), // pending|approved|rejected|delegated
  decidedBy:     integer("decided_by"),
  decidedByName: varchar("decided_by_name", { length: 100 }),
  comment:       text("comment"),
  decidedAt:     timestamp("decided_at", { withTimezone: true }),
}, (t) => ({
  uq:        uniqueIndex("approval_steps_req_step_uq").on(t.requestId, t.stepIndex),
  requestIdx: index("approval_steps_request_idx").on(t.requestId),
}));
export type ApprovalRequestStep    = typeof approvalRequestSteps.$inferSelect;
export type NewApprovalRequestStep = typeof approvalRequestSteps.$inferInsert;

export const approvalDelegations = pgTable("approval_delegations", {
  id:           serial("id").primaryKey(),
  delegateRole: varchar("delegate_role", { length: 20 }).notNull(),        // 위임되는 직책(예: super_admin)
  toMemberId:   integer("to_member_id").notNull(),
  toMemberName: varchar("to_member_name", { length: 100 }),
  startAt:      date("start_at").notNull(),
  endAt:        date("end_at").notNull(),
  reason:       text("reason"),
  isActive:     boolean("is_active").notNull().default(true),
  createdBy:    integer("created_by"),
  createdAt:    timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  roleIdx:   index("approval_delegations_role_idx").on(t.delegateRole),
  activeIdx: index("approval_delegations_active_idx").on(t.isActive),
}));
export type ApprovalDelegation    = typeof approvalDelegations.$inferSelect;
export type NewApprovalDelegation = typeof approvalDelegations.$inferInsert;
/* === 지출 결재라인·위임·지출결의서 끝 === */

/* =========================================================
   === 사업 로드맵 (목표·단계) — 2026-07-02 ===
   워크스페이스 로드맵: 사업 전체 목표(Objective)와 실행 단계(Phase)를
   캘린더·리스트·타임라인으로 공유. 슈퍼어드민·어드민 편집, 오퍼레이터 열람.
   ========================================================= */
export const roadmapObjectives = pgTable("roadmap_objectives", {
  id:          serial("id").primaryKey(),
  title:       varchar("title", { length: 300 }).notNull(),
  description: text("description"),
  category:    varchar("category", { length: 50 }),          // 후원|유가족지원|SIREN|캠페인|조직운영|기타 (자유 입력)
  status:      varchar("status", { length: 20 }).notNull().default("active"), // planned|active|done|paused|cancelled
  progress:    integer("progress").notNull().default(0),     // 0~100 (단계 없을 때 수동, 단계 있으면 API가 자동 집계)
  ownerId:     integer("owner_id").references(() => members.id, { onDelete: "set null" }), // 담당자
  ownerName:   varchar("owner_name", { length: 100 }),       // 담당자 표시명 스냅샷
  startDate:   date("start_date"),
  targetDate:  date("target_date"),                          // 목표 완료일
  color:       varchar("color", { length: 20 }).notNull().default("indigo"),
  sortOrder:   integer("sort_order").notNull().default(0),
  createdBy:   integer("created_by").references(() => members.id, { onDelete: "set null" }),
  createdAt:   timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  statusIdx:   index("roadmap_objectives_status_idx").on(t.status),
  ownerIdx:    index("roadmap_objectives_owner_idx").on(t.ownerId),
  sortIdx:     index("roadmap_objectives_sort_idx").on(t.sortOrder),
}));
export type RoadmapObjective    = typeof roadmapObjectives.$inferSelect;
export type NewRoadmapObjective = typeof roadmapObjectives.$inferInsert;

export const roadmapPhases = pgTable("roadmap_phases", {
  id:          serial("id").primaryKey(),
  objectiveId: integer("objective_id").notNull().references(() => roadmapObjectives.id, { onDelete: "cascade" }),
  title:       varchar("title", { length: 300 }).notNull(),
  description: text("description"),
  status:      varchar("status", { length: 20 }).notNull().default("planned"), // planned|in_progress|done|blocked
  progress:    integer("progress").notNull().default(0),     // 0~100
  startDate:   date("start_date").notNull(),
  endDate:     date("end_date").notNull(),
  color:       varchar("color", { length: 20 }),             // 미지정 시 목표 색상 상속
  sortOrder:   integer("sort_order").notNull().default(0),
  createdBy:   integer("created_by").references(() => members.id, { onDelete: "set null" }),
  createdAt:   timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  objIdx:      index("roadmap_phases_objective_idx").on(t.objectiveId),
  rangeIdx:    index("roadmap_phases_range_idx").on(t.startDate, t.endDate),
  sortIdx:     index("roadmap_phases_sort_idx").on(t.sortOrder),
}));
export type RoadmapPhase    = typeof roadmapPhases.$inferSelect;
export type NewRoadmapPhase = typeof roadmapPhases.$inferInsert;
/* === 사업 로드맵 끝 === */

/* =========================================================
   === 출입문 자동 개폐 (ON 이식 · 2026-07-06) ===
   근태 출근/복귀·수동버튼·관리자 원격 개방 시 도어 어댑터 호출 감사.
   물리 개방은 lib/adapters/door(sim|relay|shelly_cloud|kocom485). SIREN·ON 동일 물리 문.
   ========================================================= */
export const doorCommand = pgTable("door_command", {
  id:          serial("id").primaryKey(),
  triggerType: varchar("trigger_type", { length: 20 }).notNull(), // checkin | reentry | mobilekey | admin
  triggerId:   integer("trigger_id"),                             // 관련 근태기록 id 등(nullable)
  memberUid:   varchar("member_uid", { length: 64 }),             // 개방 유발 회원 uid(감사, nullable)
  adapter:     varchar("adapter", { length: 20 }).notNull(),      // sim | relay | shelly_cloud | kocom485
  gateId:      varchar("gate_id", { length: 40 }).notNull().default("main"),
  request:     jsonb("request"),
  response:    jsonb("response"),
  ok:          boolean("ok").notNull().default(false),
  at:          timestamp("at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  atIdx:       index("door_command_at_idx").on(t.at),
  triggerIdx:  index("door_command_trigger_idx").on(t.triggerType),
}));
export type DoorCommand    = typeof doorCommand.$inferSelect;
export type NewDoorCommand = typeof doorCommand.$inferInsert;
/* === 출입문 자동 개폐 끝 === */

/* === 업데이트 소식 (release_notes) — 2026-07-12 A안: 운영자용 변경내역·발행 === */
export const releaseNotes = pgTable("release_notes", {
  id: serial("id").primaryKey(),
  draftKey: varchar("draft_key", { length: 60 }),          // 자동 초안 중복 방지 키 (수동 생성은 null)
  title: varchar("title", { length: 200 }).notNull(),
  items: jsonb("items").$type<{ text: string; link?: string }[]>().default([]).notNull(),
  audience: varchar("audience", { length: 20 }).default("operator").notNull(), // operator | public(향후 확장)
  status: varchar("status", { length: 20 }).default("draft").notNull(),        // draft | published
  publishedAt: timestamp("published_at"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  rnStatusIdx: index("release_notes_status_idx").on(t.status),
  rnDraftKeyUq: uniqueIndex("release_notes_draft_key_uq").on(t.draftKey),
}));
export type ReleaseNote    = typeof releaseNotes.$inferSelect;
export type NewReleaseNote = typeof releaseNotes.$inferInsert;
/* === 업데이트 소식 끝 === */

/* =========================================================
 * 급여명세 전자서명·증빙보관 (2026-07-11, migrate-payroll-esign)
 * payroll_slips 확장 컬럼은 위 payrollSlips 정의에 반영됨.
 * ========================================================= */

/** 열람·서명·이의 증적 — 한 번 쌓이면 고치거나 지우지 않는다 (감사 추적).
 *  정정 재발행(차수 증가) 시에도 이전 차수의 서명 기록은 그대로 남는다. */
export const payrollAcknowledgments = pgTable("payroll_acknowledgments", {
  id:                   serial("id").primaryKey(),
  slipId:               integer("slip_id").notNull().references(() => payrollSlips.id, { onDelete: "cascade" }),
  memberUid:            varchar("member_uid", { length: 36 }).notNull(),
  documentVersion:      integer("document_version").default(1).notNull(),
  action:               varchar("action", { length: 20 }).notNull(),          // VIEWED | ACKNOWLEDGED | OBJECTED
  signatureType:        varchar("signature_type", { length: 10 }),            // DRAW(손글씨) | TYPE(성명입력)
  signatureR2Key:       text("signature_r2_key"),
  signedName:           varchar("signed_name", { length: 80 }),
  consentItems:         jsonb("consent_items").$type<any[]>().default([]).notNull(),
  objectionReason:      text("objection_reason"),
  documentR2Key:        text("document_r2_key"),                              // 무엇에 서명했는지
  documentSha256:       varchar("document_sha256", { length: 64 }),
  signedDocumentR2Key:  text("signed_document_r2_key"),
  ip:                   varchar("ip", { length: 45 }),
  userAgent:            text("user_agent"),
  createdAt:            timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  slipIdx:   index("idx_payroll_ack_slip").on(t.slipId),
  memberIdx: index("idx_payroll_ack_member").on(t.memberUid),
  actionIdx: index("idx_payroll_ack_action").on(t.action),
}));

/** 이의제기 티켓 — 접수 → 검토중 → 해결/반려 */
export const payrollObjections = pgTable("payroll_objections", {
  id:              serial("id").primaryKey(),
  slipId:          integer("slip_id").notNull().references(() => payrollSlips.id, { onDelete: "cascade" }),
  memberUid:       varchar("member_uid", { length: 36 }).notNull(),
  reason:          text("reason").notNull(),
  status:          varchar("status", { length: 20 }).default("OPEN").notNull(),  // OPEN|IN_REVIEW|RESOLVED|REJECTED
  resolutionNote:  text("resolution_note"),
  resolvedBy:      varchar("resolved_by", { length: 36 }),
  resolvedAt:      timestamp("resolved_at"),
  createdAt:       timestamp("created_at").defaultNow().notNull(),
  updatedAt:       timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  slipIdx:   index("idx_payroll_obj_slip").on(t.slipId),
  statusIdx: index("idx_payroll_obj_status").on(t.status),
  memberIdx: index("idx_payroll_obj_member").on(t.memberUid),
}));

export type PayrollAcknowledgment    = typeof payrollAcknowledgments.$inferSelect;
export type NewPayrollAcknowledgment = typeof payrollAcknowledgments.$inferInsert;
export type PayrollObjection         = typeof payrollObjections.$inferSelect;
export type NewPayrollObjection      = typeof payrollObjections.$inferInsert;
/* === 급여명세 전자서명·증빙보관 끝 === */
