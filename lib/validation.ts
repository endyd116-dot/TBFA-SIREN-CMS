/**
 * SIREN — Zod 기반 입력 검증 스키마
 * 모든 API에서 요청 본문을 검증할 때 사용합니다.
 */
import { z } from "zod";

/* =========================================================
   공통 필드
   ========================================================= */
const emailField = z.string().trim().toLowerCase().email("이메일 형식이 올바르지 않습니다");
const phoneField = z
  .string()
  .trim()
  .regex(/^[0-9\-+\s()]{8,20}$/, "연락처 형식이 올바르지 않습니다");
const nameField = z.string().trim().min(2, "이름은 2자 이상").max(50, "이름은 50자 이하");
const passwordField = z
  .string()
  .min(8, "비밀번호는 8자 이상")
  .max(100, "비밀번호는 100자 이하")
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), "영문과 숫자를 모두 포함해야 합니다");

/* =========================================================
   회원가입
   ========================================================= */
export const signupSchema = z.object({
  email: emailField,
  password: passwordField,
  name: nameField,
  phone: phoneField,
  memberType: z.enum(["regular", "family", "volunteer"]).default("regular"),
  agree: z.boolean().refine((v) => v === true, "이용약관에 동의해주세요"),
});

export type SignupInput = z.infer<typeof signupSchema>;

/* =========================================================
   로그인
   ========================================================= */
export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, "비밀번호를 입력해주세요"),
  remember: z.boolean().optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;

/* =========================================================
   관리자 로그인
   ========================================================= */
export const adminLoginSchema = z.object({
  id: z.string().trim().min(1, "ID를 입력해주세요"),
  password: z.string().min(1, "비밀번호를 입력해주세요"),
  otp: z.string().optional(),
});

export type AdminLoginInput = z.infer<typeof adminLoginSchema>;

/* =========================================================
   후원
   ========================================================= */
export const donateSchema = z.object({
  name: nameField,
  phone: phoneField,
  email: emailField.optional().or(z.literal("")),
  amount: z.number().int().min(1000, "최소 1,000원 이상").max(100_000_000, "최대 1억원 이하"),
  type: z.enum(["regular", "onetime"]),
  payMethod: z.enum(["cms", "card", "bank"]),
  isAnonymous: z.boolean().optional().default(false),
  campaignTag: z.string().max(50).optional(),
  agreePersonal: z.boolean().refine((v) => v === true, "개인정보 수집·이용에 동의해주세요"),
});

export type DonateInput = z.infer<typeof donateSchema>;

/* =========================================================
   유가족 지원 신청
   ========================================================= */
export const supportRequestSchema = z.object({
  category: z.enum(["counseling", "legal", "scholarship", "other"]),
  title: z.string().trim().min(2, "제목 2자 이상").max(200, "제목 200자 이하"),
  content: z.string().trim().min(10, "내용 10자 이상").max(5000, "내용 5,000자 이하"),
  attachments: z.array(z.string()).optional().default([]),
});

export type SupportRequestInput = z.infer<typeof supportRequestSchema>;

/* =========================================================
   공지사항 작성/수정 (관리자)
   ========================================================= */
export const noticeSchema = z.object({
  category: z.enum(["general", "member", "event", "media"]).default("general"),
  title: z.string().trim().min(2).max(200),
  content: z.string().trim().min(1).max(50_000),
  isPinned: z.boolean().optional().default(false),
  isPublished: z.boolean().optional().default(true),
  excerpt: z.string().max(300).optional(),
  thumbnailUrl: z.string().url().optional().or(z.literal("")),
});

export type NoticeInput = z.infer<typeof noticeSchema>;

/* =========================================================
   FAQ 작성/수정 (관리자)
   ========================================================= */
export const faqSchema = z.object({
  category: z.string().max(30).default("general"),
  question: z.string().trim().min(2).max(300),
  answer: z.string().trim().min(2).max(5000),
  sortOrder: z.number().int().optional().default(0),
  isActive: z.boolean().optional().default(true),
});

export type FaqInput = z.infer<typeof faqSchema>;

/* =========================================================
   회원 정보 수정 (마이페이지)
   ========================================================= */
export const profileUpdateSchema = z.object({
  name: nameField.optional(),
  phone: phoneField.optional(),
  password: passwordField.optional(),
  agreeEmail: z.boolean().optional(),
  agreeSms: z.boolean().optional(),
  agreeMail: z.boolean().optional(),
});

export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;

/* =========================================================
   관리자: 지원 신청 상태 변경
   ========================================================= */
export const supportStatusUpdateSchema = z.object({
  status: z.enum(["submitted", "reviewing", "supplement", "matched", "in_progress", "completed", "rejected"]),
  assignedMemberId: z.number().int().optional(),
  assignedExpertName: z.string().max(50).optional(),
  adminNote: z.string().max(2000).optional(),
  supplementNote: z.string().max(2000).optional(),
  reportContent: z.string().max(10000).optional(),
});

export type SupportStatusUpdateInput = z.infer<typeof supportStatusUpdateSchema>;

/* =========================================================
   페이징 / 필터 공통
   ========================================================= */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().optional(),
});

export type PaginationInput = z.infer<typeof paginationSchema>;

/* =========================================================
   검증 헬퍼 (Zod 에러를 사용자 친화적으로 변환)
   ========================================================= */
export function formatZodError(err: z.ZodError): { field: string; message: string }[] {
  return err.errors.map((e) => ({
    field: e.path.join("."),
    message: e.message,
  }));
}

export function safeValidate<T>(schema: z.ZodSchema<T>, data: any):
  | { ok: true; data: T }
  | { ok: false; errors: { field: string; message: string }[] } {
  const result = schema.safeParse(data);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, errors: formatZodError(result.error) };
}