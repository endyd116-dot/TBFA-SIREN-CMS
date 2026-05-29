/**
 * 1회용 마이그 — R45 RBAC featureKey 시드
 * GET ?run=1  : requireAdmin 후 실행 (멱등·ON CONFLICT DO NOTHING)
 * GET (기본)  : 진단 (현재 시드된 키 목록·인증 불필요)
 *
 * 정책(Swain 2026-05-29): 권한정책 편집(admin-role-permissions)만 super 전용(하드코딩),
 * 그 외 모든 featureKey는 admin=super 기본(adminAllowed=true). operator는 추천대로
 * (근태 결재·게시판 중재·AI 진입만 허용). 추후 어드민 '권한정책 설계' 화면에서 토글.
 *
 * 호출 성공·확인 후 이 파일 삭제 + 커밋.
 */
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-r45-rbac-seed" };

/* featureKey, 라벨, 카테고리, adminAllowed, operatorAllowed */
const SEED: Array<[string, string, string, boolean, boolean]> = [
  // 기존 canAccess 키(기본값 명시 시드)
  ["ai_config_prompt",         "AI 비서 설정·프롬프트 변경",        "ai",        true, false],
  ["donation_confirm",         "후원 입금 통과 처리",              "donation",  true, false],
  ["finance_refund",           "재정 환불(지출·수입)",             "finance",   true, false],
  ["seo_edit",                 "SEO 메타 편집·발행",               "siren",     true, false],
  ["settlement_view",          "성과 결산 조회",                   "milestone", true, false],
  // 딥릴리프(기존 canAccess·토글 가능화)
  ["martyrdom_publication",    "딥릴리프 연구 발간",               "siren",     true, false],
  ["martyrdom_pub_export",     "딥릴리프 발간 내보내기",           "siren",     true, false],
  ["martyrdom_external_review","딥릴리프 외부자료 검토",           "siren",     true, false],
  // R45 신규(super 전용 게이트를 admin+로 풀면서 토글화·operator 추천대로)
  ["att_manage",               "근태 결재(휴가·정정·현황 조회)",   "att",       true, true ], // operator 허용(항목1)
  ["comment_moderation",       "댓글·게시판 신고 중재(숨김·삭제)", "board",     true, true ], // operator 허용(항목6)
  ["ai_agent_chat",            "AI 비서 채팅 진입(읽기 도구)",     "ai",        true, true ], // operator 허용(AI 진입)
  ["finance_view",             "재무 열람(재무제표·은행·효성)",    "finance",   true, false],
  ["finance_bookkeeping",      "재정 입력(전표·계정과목·은행)",    "finance",   true, false],
  ["member_directory_export",  "회원 검색·연락처·엑셀 내보내기",   "member",    true, false],
  ["chat_expert_view",         "민감 1:1 상담(법률·심리) 열람",    "chat",      true, false],
  ["chat_blacklist",           "채팅 블랙리스트 관리",             "chat",      true, false],
  ["send_job",                 "대량 발송 작업(생성·취소·재시작)", "notify",    true, false],
  ["anonymous_reveal",         "익명 신고자 신원 식별(reveal)",    "siren",     true, false],
  ["ai_config",                "AI 설정·비용·도구 토글",           "ai",        true, false],
  ["audit_view",               "감사 로그 열람",                   "siren",     true, false],
];

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "RBAC 시드 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async (req: Request) => {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  /* 진단 모드 — 현재 시드 상태 */
  if (!run) {
    try {
      const rows = await db.execute(sql`SELECT feature_key, admin_allowed, operator_allowed FROM role_permissions ORDER BY id`);
      const existing = (rows as any).rows ?? rows ?? [];
      return new Response(JSON.stringify({
        ok: true, mode: "diagnose", seedCount: SEED.length,
        existingCount: Array.isArray(existing) ? existing.length : 0,
        existing,
        hint: "실행하려면 ?run=1 (어드민 로그인 필요)",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    } catch (err) { return jsonError("diagnose", err); }
  }

  /* 실행 모드 — requireAdmin */
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  try {
    let inserted = 0;
    for (const [key, label, category, adminAllowed, operatorAllowed] of SEED) {
      const r = await db.execute(sql`
        INSERT INTO role_permissions (feature_key, feature_label, category, admin_allowed, operator_allowed)
        VALUES (${key}, ${label}, ${category}, ${adminAllowed}, ${operatorAllowed})
        ON CONFLICT (feature_key) DO NOTHING
      `);
      const rc = (r as any).rowCount;
      if (typeof rc === "number" && rc > 0) inserted += rc;
    }
    const after = await db.execute(sql`SELECT COUNT(*)::int AS n FROM role_permissions`);
    const total = ((after as any).rows?.[0]?.n) ?? ((after as any)[0]?.n) ?? null;
    return new Response(JSON.stringify({
      ok: true, mode: "run", seedAttempted: SEED.length,
      inserted, // 드라이버별 rowCount 미채움 가능 — total로 확인
      totalRows: total,
      note: "ON CONFLICT DO NOTHING — 기존 토글값은 보존(재실행 안전). inserted:0이어도 실패 아님(이미 시드된 경우).",
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err) { return jsonError("insert", err); }
};
