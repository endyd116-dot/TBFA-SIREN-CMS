/**
 * POST /api/seed?key=SECRET
 * 초기 데이터 시드 (공지 + FAQ + 관리자 계정)
 * - 데이터가 이미 있으면 스킵
 * - 보안: 쿼리스트링 key가 ADMIN_DEFAULT_PW와 일치해야 실행
 */
import { count, eq } from "drizzle-orm";
import { db, members, notices, faqs } from "../../db";
import { hashPassword } from "../../lib/auth";
import {
  ok, forbidden, serverError, corsPreflight, methodNotAllowed,
} from "../../lib/response";

/* =========================================================
   시드 데이터: 공지사항 6건
   ========================================================= */
const SEED_NOTICES = [
  {
    category: "general" as const,
    title: "2026년 정기총회 개최 및 활동 보고서 공개 안내",
    isPinned: true,
    excerpt: "2026년 정기총회를 5월 15일 오후 2시에 개최합니다.",
    content:
      "교사유가족협의회 2026년 정기총회를 5월 15일 오후 2시에 본 협의회 사무실에서 개최합니다.\n\n주요 안건:\n- 2025년 활동 보고\n- 2026년 사업 계획\n- 임원 선출\n\n많은 회원분들의 참석을 부탁드립니다.",
  },
  {
    category: "member" as const,
    title: "신규 정기 후원 회원을 위한 감사 캠페인 진행",
    isPinned: false,
    excerpt: "신규 정기 후원자 분들께 감사 메시지와 작은 기념품을 보내드립니다.",
    content: "신규 정기 후원 회원 분들께 진심으로 감사드립니다. 작은 정성을 담은 기념품을 발송해 드립니다.",
  },
  {
    category: "event" as const,
    title: "유가족 심리상담 지원 프로그램 2기 모집",
    isPinned: true,
    excerpt: "5월 10일까지 모집합니다.",
    content:
      "심리상담 지원 프로그램 2기를 모집합니다.\n\n- 모집 기간: 5월 1일 ~ 5월 10일\n- 신청 방법: 마이페이지 > 1:1 상담\n- 대상: 유가족 회원\n- 비용: 전액 무료",
  },
  {
    category: "event" as const,
    title: "법률 자문 봉사단 1차 모집 결과 공지",
    isPinned: false,
    excerpt: "총 12분의 변호사님께서 봉사단으로 위촉되셨습니다.",
    content: "법률 자문 봉사단 1차 모집에 지원해 주신 모든 분들께 감사드립니다. 최종 12분이 위촉되었습니다.",
  },
  {
    category: "member" as const,
    title: "기부금 영수증 일괄 발급 기간 안내",
    isPinned: false,
    excerpt: "5월 1일부터 5월 15일까지 기부금 영수증 일괄 발급을 진행합니다.",
    content: "마이페이지 > 증명서 발급 메뉴에서 즉시 발급 가능합니다. 국세청 연말정산 간소화 서비스에도 자동 등재됩니다.",
  },
  {
    category: "media" as const,
    title: "[OO일보] 교사유가족협의회 1주년, 그 의미를 묻다",
    isPinned: false,
    excerpt: "OO일보와의 인터뷰가 게재되었습니다.",
    content: "OO일보 4월 28일자 사회면에 협의회 1주년 인터뷰가 실렸습니다. 자세한 내용은 본 협의회 갤러리에서 확인하실 수 있습니다.",
  },
];

/* =========================================================
   시드 데이터: FAQ 6건
   ========================================================= */
const SEED_FAQS = [
  {
    category: "general",
    question: "교사유가족협의회 가입 절차가 궁금해요.",
    answer:
      "가족관계증명서 등 증빙 서류와 함께 회원가입을 진행하시면, 사무국에서 영업일 기준 3일 이내 검토 후 승인 결과를 알림톡으로 안내드립니다.",
    sortOrder: 1,
  },
  {
    category: "donation",
    question: "기부금 영수증은 언제 어떻게 발급되나요?",
    answer:
      "매년 1월 국세청 연말정산 간소화 서비스에 자동 등재되며, 마이페이지 > 증명서 발급에서 PDF 형태로 즉시 출력 가능합니다.",
    sortOrder: 2,
  },
  {
    category: "support",
    question: "법률 지원은 어떤 분들이 도와주시나요?",
    answer:
      "교육 관련 분쟁 경험이 풍부한 변호사 패널 12분이 협력하고 있으며, 사안의 성격에 맞춰 전문가가 매칭됩니다.",
    sortOrder: 3,
  },
  {
    category: "donation",
    question: "정기 후원을 해지하고 싶어요.",
    answer:
      "마이페이지 > 내 후원 내역에서 즉시 해지 가능하며, 별도 위약금이 없습니다. 그동안 동참해 주셔서 진심으로 감사드립니다.",
    sortOrder: 4,
  },
  {
    category: "general",
    question: "봉사자로 참여하고 싶습니다. 어떻게 신청하나요?",
    answer:
      '회원가입 시 "봉사자 회원"을 선택하시고 보유 기술(심리상담/법률/행정 등)을 등록해 주세요. AI 매칭 시스템이 적합한 활동을 추천해 드립니다.',
    sortOrder: 5,
  },
  {
    category: "donation",
    question: "후원금은 어디에 사용되나요?",
    answer:
      "직접 지원(58%) · 추모 사업(17%) · 장학 사업(15%) · 운영비(10%) 비율로 집행되며, 매월 활동 보고서 페이지에서 상세 내역을 공개합니다.",
    sortOrder: 6,
  },
];

/* =========================================================
   메인 핸들러
   ========================================================= */
export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  try {
    /* 보안 검증: 쿼리스트링 key가 ADMIN_DEFAULT_PW와 일치해야 함 */
    const url = new URL(req.url);
    const key = url.searchParams.get("key");
    const expected = process.env.ADMIN_DEFAULT_PW || "admin1234";
    if (!key || key !== expected) {
      return forbidden("시드 실행 권한이 없습니다 (key 파라미터 확인)");
    }

    const result: { notices: number; faqs: number; admin: boolean } = {
      notices: 0,
      faqs: 0,
      admin: false,
    };

    /* 1. 공지 시드 (이미 있으면 스킵) */
    const noticeCountRows = await db.select({ total: count() }).from(notices);
    if (Number(noticeCountRows[0]?.total ?? 0) === 0) {
      await db.insert(notices).values(
        SEED_NOTICES.map((n) => ({
          ...n,
          isPublished: true,
          authorName: "관리자",
        }))
      );
      result.notices = SEED_NOTICES.length;
    }

    /* 2. FAQ 시드 (이미 있으면 스킵) */
    const faqCountRows = await db.select({ total: count() }).from(faqs);
    if (Number(faqCountRows[0]?.total ?? 0) === 0) {
      await db.insert(faqs).values(
        SEED_FAQS.map((f) => ({
          ...f,
          isActive: true,
        }))
      );
      result.faqs = SEED_FAQS.length;
    }

    /* 3. 관리자 계정 시드 */
    const adminEmail = "admin@siren-org.kr";
    const existingAdmin = await db
      .select({ id: members.id })
      .from(members)
      .where(eq(members.email, adminEmail))
      .limit(1);

    if (existingAdmin.length === 0) {
      const adminPw = process.env.ADMIN_DEFAULT_PW || "admin1234";
      const passwordHash = await hashPassword(adminPw);
            await db.insert(members).values({
        email: adminEmail,
        passwordHash,
        name: "총괄 관리자",
        phone: "02-0000-0000",
        type: "admin",
        status: "active",
        emailVerified: true,
      } as any);
      result.admin = true;
    }

    return ok(result, "시드 완료");
  } catch (err) {
    console.error("[seed]", err);
    return serverError("시드 중 오류가 발생했습니다", err);
  }
};

export const config = { path: "/api/seed" };