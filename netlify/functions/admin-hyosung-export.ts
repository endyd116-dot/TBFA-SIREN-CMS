/**
 * GET /api/admin/hyosung-export
 *
 * 효성 CMS+ 대량회원등록 샘플 양식 기반 CSV 추출
 * - 사용자가 제공한 공식 샘플과 동일한 78컬럼 구조
 * - 우리 DB에 있는 정보만 자동 채움
 * - 계좌/주민번호 등은 빈값 (관리자가 효성 업로드 전 수기 입력)
 *
 * CSV 구조:
 *   [1행] 카테고리 행 (기본정보 / 상품정보 / 청구서 등 / 빈 셀 구분)
 *   [2행] 실제 헤더 (회원번호 / 회원명 / ...)
 *   [3행+] 데이터
 *
 * 쿼리 파라미터:
 * - status: pending | completed | cancelled | all (기본 pending)
 * - ids: 콤마 구분 (선택 건만)
 *
 * 보안:
 * - 관리자/운영자만
 * - audit_logs 기록 (개인정보 추출)
 */
import { eq, and, inArray } from "drizzle-orm";
import { db, donations, members } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import {
  badRequest, serverError, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logAdminAction } from "../../lib/audit";

/* ───────── CSV 헬퍼 ───────── */
function csvEscape(value: any): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function csvRow(cells: any[]): string {
  return cells.map(csvEscape).join(",");
}

/* ───────── 효성 CSV 헤더 (78컬럼) ─────────
   샘플 파일 구조 기준:
   [1행] 카테고리 (기본정보 / 상품정보 / 청구서 등 / 빈 셀로 구분)
   [2행] 실제 헤더
*/
const HYOSUNG_CATEGORY_ROW = [
  "기본정보",
  "", "", "", "", "", "", "", "", "", "", "", "", "",    // 기본정보 (14)
  "상품정보",                                              // 상품 (1)
  "", "",                                                  // 구분 (2 빈)
  "청구서 및 청구처리",                                    // 청구서 (12)
  "", "", "", "", "", "", "", "", "", "", "",
  "자동이체 공통사항",                                     // 자동이체 공통 (6)
  "", "", "", "", "",
  "자동이체CMS",                                           // CMS (4)
  "", "", "",
  "자동이체 실시간CMS",                                    // 실시간CMS (4)
  "", "", "",
  "자동이체 카드",                                         // 카드 (4)
  "", "", "",
  "자동이체 휴대전화",                                     // 휴대폰 (4)
  "", "", "",
  "전자계약관련",                                          // 전자계약 (3)
  "", "",
  "기타사항",                                              // 기타 (3)
  "", "",
  "대표연락처",                                            // 대표연락처 (1)
  "세금계산서",                                            // 세금계산서 (2)
  "",
  "세금계산서",                                            // 세금계산서 (12)
  "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "",
];

const HYOSUNG_HEADER_ROW = [
  /* 기본정보 (14) */
  "회원번호",
  "회원명",
  "회원구분(법인:Y, 개인:N)",
  "일반전화",
  "휴대전화",
  "회원업종",
  "이메일",
  "회원업종2",
  "외부관리번호(아이디)",
  "생년월일",
  "SMS수신여부",
  "우편번호",
  "주소",
  "상세주소",

  /* 상품정보 (1) */
  "상품",

  /* 청구서 (2 빈) */
  "청구서 발송수단",
  "청구서 자동생성",

  /* 청구서 및 청구처리 (12) */
  "청구서 자동발송",
  "결제수단",
  "청구일 자동처리",
  "결제일(자동이체-결제일, 처리자결정-지정일로부터, 결제일 처리 99 입력)",
  "청구서 발송수단 연락처 회원기본정보와 동일(Y/N)",
  "수신자 휴대전화",
  "수신자 이메일",
  "청구시작일자",
  "청구종료일자",
  "결제주기",
  "처리자 결정일",
  "자동이체 청구서 발송(Y/N)",

  /* 자동이체 공통사항 (6) */
  "대표결제수단",
  "전자계약 요청사항(휴대전화 / 이메일)",
  "전자계약 요청 휴대전화",
  "전자계약 요청 휴대전화 회원기본정보와 동일(Y/N)",
  "전자계약 요청 이메일",
  "전자계약 요청 이메일 회원기본정보와 동일(Y/N)",

  /* 자동이체CMS (5) */
  "은행",
  "예금주명",
  "계좌번호",
  "생년월일/사업자번호",
  "결제자구분코드",

  /* 자동이체 실시간CMS (5) */
  "은행2",
  "예금주명2",
  "계좌번호2",
  "생년월일2/사업자번호2",
  "결제자구분코드2",

  /* 자동이체 카드 (5) */
  "카드번호",
  "예금주3",
  "생년월일3/사업자번호3",
  "유효기간(년)",
  "유효기간(월)",

  /* 자동이체 휴대전화 (6) */
  "통신사",
  "전화번호(휴대전화번호)",
  "이동통신사",
  "주민번호 앞 7자리(생년월일+성별)",
  "결제자구분코드4",
  "계좌사용여부(Y/N)",

  /* 이후 9 */
  "카드사용여부(Y/N)",
  "전자계약사용여부(Y/N)",
  "자동이체 입금 금액체크 여부",
  "자동이체 청구서 발송",
  "자동이체 구분",
  "대표결제수단2",
  "결제연동정보(휴대전화 또는 카드번호)",
  "결제연동정보(발급번호)",
  "회원구분2",

  /* 세금계산서 (20) */
  "우편번호(사업자번호,주민등록번호)",
  "상호",
  "대표자명",
  "업태",
  "종목",
  "사업자전화번호",
  "주소",
  "발급구분",
  "발급단위",
  "계산서 작성일자",
  "발급방식",
  "담당자이메일",
  "품명코드",
  "품명이 상품명과 동일(Y/N)",
  "비고",

  /* 기타 (3) */
  "품의번호",
  "변경사유",
  "내부신청번호",  /* ★ 매칭용 (샘플에는 없지만 import 시 필수) */
];

/* ───────── 회원구분 한글화 ───────── */
const MEMBER_TYPE_LABEL: Record<string, string> = {
  regular: "정기후원자",
  family: "유가족",
  volunteer: "봉사자",
  admin: "관리자",
};

/* ───────── 날짜 포맷 ───────── */
function fmtDateCompact(iso: any): string {
  /* YYYYMMDD */
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.getFullYear() +
    String(d.getMonth() + 1).padStart(2, "0") +
    String(d.getDate()).padStart(2, "0");
}

function fmtDateDash(iso: any): string {
  /* YYYY-MM-DD */
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0");
}

/* ───────── 상품 문자열 (품목,수량,단가,금액) ───────── */
function buildProductField(amount: number): string {
  /* 효성 형식: "상품명,수량,단가,금액" */
  const productName = "정기후원";
  return `${productName},1,${amount},${amount}`;
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  /* 관리자 인증 */
  const guard: any = await requireAdmin(req);
  if (!guard.ok) return guard.res;
  const { admin } = guard.ctx;

  try {
    const url = new URL(req.url);
    const status = (url.searchParams.get("status") || "pending").trim();
    const idsParam = (url.searchParams.get("ids") || "").trim();

    /* WHERE 조건 */
    const conditions: any[] = [
      eq(donations.pgProvider, "hyosung_cms"),
      eq(donations.type, "regular"),
    ];

    if (idsParam) {
      const ids = idsParam
        .split(",")
        .map(s => Number(s.trim()))
        .filter(n => Number.isFinite(n) && n > 0);

      if (ids.length === 0) return badRequest("유효한 ids가 없습니다");
      if (ids.length > 1000) return badRequest("한 번에 최대 1,000건까지 추출 가능합니다");

      conditions.push(inArray(donations.id, ids));
    } else if (status !== "all") {
      if (!["pending", "completed", "cancelled", "failed"].includes(status)) {
        return badRequest("유효하지 않은 status");
      }
      conditions.push(eq(donations.status, status as any));
    }

    const whereClause = conditions.length === 1 ? conditions[0] : and(...conditions);

    /* 목록 조회 (최대 5000건) */
    const list = await db
      .select()
      .from(donations)
      .where(whereClause)
      .limit(5000);

    if (list.length === 0) {
      return badRequest("추출할 데이터가 없습니다. 조건을 확인해 주세요.");
    }

    /* 회원 type 일괄 조회 */
    const memberIds = Array.from(
      new Set(list.map(d => d.memberId).filter(id => id !== null)),
    ) as number[];

    const memberTypeMap = new Map<number, string>();
    if (memberIds.length > 0) {
      const membersRows = await db
        .select({ id: members.id, type: members.type })
        .from(members)
        .where(inArray(members.id, memberIds));

      membersRows.forEach((m: any) => {
        memberTypeMap.set(m.id, MEMBER_TYPE_LABEL[m.type] || m.type);
      });
    }

    /* CSV 생성 */
    const rows: string[] = [];

    /* BOM + [1행] 카테고리 행 */
    rows.push("\uFEFF" + csvRow(HYOSUNG_CATEGORY_ROW));

    /* [2행] 실제 헤더 */
    rows.push(csvRow(HYOSUNG_HEADER_ROW));

    /* [3행+] 데이터 */
    for (const d of list) {
      const memberType = d.memberId
        ? (memberTypeMap.get(d.memberId) || "-")
        : "비회원";

      const donationNo = "D-" + String(d.id).padStart(7, "0");
      const memoShort = (d.memo || "")
        .replace(/\r\n|\n/g, " / ")
        .slice(0, 200);

      const productField = buildProductField(d.amount || 0);

      /* 효성 CSV 78컬럼 매핑 */
      const cells = [
        /* 기본정보 (14) */
        donationNo,                               // 회원번호
        d.donorName || "",                        // 회원명
        "N",                                      // 회원구분(법인:Y, 개인:N) — 기본 N
        "",                                       // 일반전화 (빈값)
        d.donorPhone || "",                       // 휴대전화
        "일반",                                    // 회원업종 (기본값)
        d.donorEmail || "",                       // 이메일
        "",                                       // 회원업종2 (빈값)
        donationNo,                               // 외부관리번호(아이디) — 매칭용
        "",                                       // 생년월일 (빈값, 관리자 수기)
        "Y",                                      // SMS수신여부 (기본 Y)
        "",                                       // 우편번호 (빈값)
        "",                                       // 주소 (빈값)
        "",                                       // 상세주소 (빈값)

        /* 상품정보 (1) */
        productField,                             // 상품 "정기후원,1,30000,30000"

        /* 청구서 발송수단, 자동생성 (2) */
        "휴대폰",                                  // 청구서 발송수단
        "자동",                                    // 청구서 자동생성

        /* 청구서 및 청구처리 (12) */
        "자동",                                    // 청구서 자동발송
        "자동이체",                                // 결제수단
        "자동",                                    // 청구일 자동처리
        "5",                                      // 결제일 (매월 5일 기본값)
        "Y",                                      // 발송수단 연락처 회원기본정보와 동일
        d.donorPhone || "",                       // 수신자 휴대전화 (기본)
        d.donorEmail || "",                       // 수신자 이메일 (기본)
        fmtDateCompact(d.createdAt),              // 청구시작일자 YYYYMMDD
        "99991231",                               // 청구종료일자 (무기한)
        "매월",                                    // 결제주기
        "",                                       // 처리자 결정일 (빈값)
        "N",                                      // 자동이체 청구서 발송 (기본 N)

        /* 자동이체 공통사항 (6) */
        "CMS",                                    // 대표결제수단 (CMS 기본)
        "휴대전화",                                // 전자계약 요청사항
        d.donorPhone || "",                       // 전자계약 요청 휴대전화
        "Y",                                      // 휴대전화 회원기본정보와 동일
        d.donorEmail || "",                       // 전자계약 요청 이메일
        "Y",                                      // 이메일 회원기본정보와 동일

        /* 자동이체CMS (5) — ★ 관리자 수기 입력 */
        "",                                       // 은행
        d.donorName || "",                        // 예금주명 (기본 후원자명)
        "",                                       // 계좌번호
        "",                                       // 생년월일/사업자번호
        "개인",                                    // 결제자구분코드

        /* 자동이체 실시간CMS (5) - 빈값 (CMS만 사용) */
        "", "", "", "", "",

        /* 자동이체 카드 (5) - 빈값 */
        "", "", "", "", "",

        /* 자동이체 휴대전화 (6) - 빈값 */
        "", "", "", "", "", "",

        /* 이후 9 */
        "Y",                                      // 계좌사용여부 (CMS 사용 시 Y)
        "N",                                      // 카드사용여부
        "N",                                      // 전자계약사용여부
        "Y",                                      // 자동이체 입금 금액체크
        "자동",                                    // 자동이체 청구서 발송
        "",                                       // 자동이체 구분
        "",                                       // 대표결제수단2
        d.donorPhone || "",                       // 결제연동정보(휴대전화)
        "",                                       // 결제연동정보(발급번호)
        memberType,                               // 회원구분2

        /* 세금계산서 (20) - 빈값 (후원자 개인) */
        "",                                       // 사업자번호/주민번호
        "",                                       // 상호
        "",                                       // 대표자명
        "",                                       // 업태
        "",                                       // 종목
        "",                                       // 사업자전화번호
        "",                                       // 주소
        "",                                       // 발급구분
        "",                                       // 발급단위
        "",                                       // 계산서 작성일자
        "",                                       // 발급방식
        "",                                       // 담당자이메일
        "",                                       // 품명코드
        "",                                       // 품명이 상품명과 동일
        memoShort,                                // 비고 (메모 활용)

        /* 기타 (3) */
        donationNo,                               // 품의번호
        "",                                       // 변경사유
        donationNo,                               // 내부신청번호 (Import 시 매칭용)
      ];

      rows.push(csvRow(cells));
    }

    const csvContent = rows.join("\r\n") + "\r\n";

    /* 파일명 */
    const now = new Date();
    const ymd = now.getFullYear() +
      String(now.getMonth() + 1).padStart(2, "0") +
      String(now.getDate()).padStart(2, "0");
    const hhmm = String(now.getHours()).padStart(2, "0") +
      String(now.getMinutes()).padStart(2, "0");

    const koFilename = `효성CMS_대량등록_${status}_${ymd}_${hhmm}.csv`;
    const enFilename = `hyosung_bulk_${status}_${ymd}_${hhmm}.csv`;

    const encodedKoName = encodeURIComponent(koFilename);

    /* 감사 로그 */
    await logAdminAction(req, admin.uid, admin.name, "hyosung_csv_export", {
      target: `${status}_${list.length}건`,
      detail: {
        status,
        count: list.length,
        idsFirst100: list.slice(0, 100).map(d => d.id),
      },
    });

    /* 응답 */
    return new Response(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${enFilename}"; filename*=UTF-8''${encodedKoName}`,
        "Cache-Control": "private, no-cache",
        "X-Export-Count": String(list.length),
      },
    });
  } catch (err) {
    console.error("[admin-hyosung-export]", err);
    return serverError("CSV 추출 중 오류가 발생했습니다", err);
  }
};

export const config = { path: "/api/admin/hyosung-export" };