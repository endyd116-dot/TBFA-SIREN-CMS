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
  "pending",   // 결제 대기
  "completed", // 승인 완료
  "failed",    // 실패
  "cancelled", // 취소
  "refunded"   // 환불
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

  // 캠페인 연결 (선택)
  campaignTag: varchar("campaign_tag", { length: 50 }),

  // 익명 여부
  isAnonymous: boolean("is_anonymous").default(false),

  memo: text("memo"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  memberIdx: index("donations_member_idx").on(t.memberId),
  statusIdx: index("donations_status_idx").on(t.status),
  createdIdx: index("donations_created_idx").on(t.createdAt),
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