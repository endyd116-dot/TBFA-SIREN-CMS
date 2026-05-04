// db/schema.ts — ★ M-19-4 전본 (M-19-1 grade 시스템 유지, tier 관련 제거)
import {
  pgTable, serial, varchar, integer, text, timestamp,
  boolean, index, pgEnum, jsonb
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
// db/schema.ts — campaignTypeEnum 다음에 추가

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

// db/schema.ts — anniversaryTypeEnum 다음에 추가

/* ★ M-19-11: 전문가 유형 */
export const expertTypeEnum = pgEnum("expert_type", ["lawyer", "counselor"]);

/* ★ M-19-11: 전문가 승인 상태 */
export const expertStatusEnum = pgEnum("expert_status", [
  "pending",
  "approved",
  "rejected",
  "suspended",
  "resigned",
]);

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
  operatorActive: boolean("operator_active").default(true),

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

  /* ───────── ★ M-12: 회원 4분류 + 가입경로 ───────── */
  memberCategory: varchar("member_category", { length: 20 }),
  memberSubtype: varchar("member_subtype", { length: 50 }),
  signupSourceId: integer("signup_source_id"),

// db/schema.ts — members 테이블, assignedCategories 다음 + gradeId 직전에 추가

  /* ───────── ★ M-15: 운영자 담당 카테고리 ───────── */
  assignedCategories: jsonb("assigned_categories").default(sql`'[]'::jsonb`),

  /* ───────── ★ M-19-11: 전문가 가입 검토 대기 플래그 ───────── */
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
}));
// db/schema.ts (Part 2) — 이어서

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

  /* 토스 */
  tossPaymentKey: varchar("toss_payment_key", { length: 200 }),
  tossOrderId: varchar("toss_order_id", { length: 64 }),
  billingKeyId: integer("billing_key_id"),
  failureReason: varchar("failure_reason", { length: 500 }),

  /* 효성 */
  hyosungMemberNo: integer("hyosung_member_no"),
  hyosungContractNo: varchar("hyosung_contract_no", { length: 20 }),
  hyosungBillNo: varchar("hyosung_bill_no", { length: 30 }),

  /* M-4 계좌이체 */
  bankDepositorName: varchar("bank_depositor_name", { length: 50 }),
  depositExpectedAt: timestamp("deposit_expected_at"),

  /* M-14 영수증 캐시 */
  receiptBlobId: integer("receipt_blob_id"),

  memo: text("memo"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  memberIdx: index("donations_member_idx").on(t.memberId),
  statusIdx: index("donations_status_idx").on(t.status),
  createdIdx: index("donations_created_idx").on(t.createdAt),
  receiptNoIdx: index("donations_receipt_no_idx").on(t.receiptNumber),
  tossPaymentKeyIdx: index("donations_toss_payment_key_idx").on(t.tossPaymentKey),
  tossOrderIdIdx: index("donations_toss_order_id_idx").on(t.tossOrderId),
  billingKeyIdx: index("donations_billing_key_idx").on(t.billingKeyId),
  hyosungMemberNoIdx: index("donations_hyosung_member_no_idx").on(t.hyosungMemberNo),
  hyosungBillNoIdx: index("donations_hyosung_bill_no_idx").on(t.hyosungBillNo),
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  memberIdx: index("chat_rooms_member_idx").on(t.memberId),
  statusIdx: index("chat_rooms_status_idx").on(t.status),
  lastMsgIdx: index("chat_rooms_last_msg_idx").on(t.lastMessageAt),
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

// db/schema.ts (Part 3) — 이어서

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
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  userIdx: index("audit_user_idx").on(t.userId),
  actionIdx: index("audit_action_idx").on(t.action),
  createdIdx: index("audit_created_idx").on(t.createdAt),
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  consultationNoIdx: index("legal_consultations_no_idx").on(t.consultationNo),
  memberIdx: index("legal_consultations_member_idx").on(t.memberId),
  statusIdx: index("legal_consultations_status_idx").on(t.status),
  urgencyIdx: index("legal_consultations_urgency_idx").on(t.aiUrgency),
  categoryIdx: index("legal_consultations_category_idx").on(t.category),
}));
// db/schema.ts (Part 4) — 마지막

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

// db/schema.ts — campaigns 테이블 다음, blob_uploads 테이블 직전에 추가

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

// db/schema.ts — anniversaryEmailsLog 다음에 추가

/* =========================================================
   ★ Phase M-19-11: expert_profiles — 전문가 프로필
   - 변호사 + 심리상담사 통합 프로필
   - 회원가입 시 전문가 선택 → 증빙 업로드 → 관리자 승인
   ========================================================= */
export const expertProfiles = pgTable("expert_profiles", {
  id: serial("id").primaryKey(),
  memberId: integer("member_id").references(() => members.id, { onDelete: "cascade" }).notNull().unique(),
  expertType: expertTypeEnum("expert_type").notNull(),
  expertStatus: expertStatusEnum("expert_status").default("pending").notNull(),

  /* 프로필 정보 */
  specialty: varchar("specialty", { length: 200 }),
  affiliation: varchar("affiliation", { length: 200 }),
  licenseNumber: varchar("license_number", { length: 100 }),
  yearsOfExperience: integer("years_of_experience").default(0),
  bio: text("bio"),

  /* 상담 관련 */
  preferredArea: varchar("preferred_area", { length: 200 }),
  availableDays: jsonb("available_days").default(sql`'[]'::jsonb`),
  availableHours: varchar("available_hours", { length: 100 }),
  isMatchable: boolean("is_matchable").default(false).notNull(),
  maxConcurrentCases: integer("max_concurrent_cases").default(5),

  /* 증빙 파일 */
  certificateBlobId: integer("certificate_blob_id"),
  additionalDocs: jsonb("additional_docs").default(sql`'[]'::jsonb`),

  /* 관리자 메모 & 승인 이력 */
  adminMemo: text("admin_memo"),
  reviewedBy: integer("reviewed_by").references(() => members.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at"),
  rejectedReason: text("rejected_reason"),
  approvedAt: timestamp("approved_at"),

  /* 매칭 통계 */
  totalCasesHandled: integer("total_cases_handled").default(0),
  totalCasesCompleted: integer("total_cases_completed").default(0),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  memberIdx: index("ep_member_idx").on(t.memberId),
  typeIdx: index("ep_type_idx").on(t.expertType),
  statusIdx: index("ep_status_idx").on(t.expertStatus),
  matchableIdx: index("ep_matchable_idx").on(t.isMatchable),
}));
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

// db/schema.ts — Campaign 타입 다음, 파일 끝에 추가

/* ★ M-19-8: 자료실 타입 */
export type ResourceCategory = typeof resourceCategories.$inferSelect;
export type NewResourceCategory = typeof resourceCategories.$inferInsert;
export type Resource = typeof resources.$inferSelect;
export type NewResource = typeof resources.$inferInsert;

/* ★ M-19-7: 기념일 로그 타입 */
export type AnniversaryEmailLog = typeof anniversaryEmailsLog.$inferSelect;
export type NewAnniversaryEmailLog = typeof anniversaryEmailsLog.$inferInsert;

// db/schema.ts — 파일 끝에 추가

/* ★ M-19-11: 전문가 프로필 타입 */
export type ExpertProfile = typeof expertProfiles.$inferSelect;
export type NewExpertProfile = typeof expertProfiles.$inferInsert;