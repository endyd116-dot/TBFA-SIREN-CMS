/**
 * netlify/functions/migrate-r41-featurekeys.ts  (1회용 — 호출 후 삭제)
 *
 * R41 P-1: 재정·민감 작업 권한 토글 featureKey 5종을 role_permissions에 시드.
 * - 기본값 = 현행 유지 (admin·operator 모두 허용) → 운영자도 지금처럼 사용 가능
 * - 이후 super_admin이 권한 정책 메뉴(admin-role-policy)에서 토글로 제한 가능
 * - 멱등: ON CONFLICT (feature_key) DO NOTHING
 *
 * GET            : 진단 (계획 키 + 현재 존재 여부)
 * GET ?run=1     : requireAdmin 후 실제 시드
 *
 * 호출: https://tbfa.co.kr/api/migrate-r41-featurekeys?run=1  (어드민 로그인 상태)
 * 성공 후 이 파일 삭제 + 커밋.
 */
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-r41-featurekeys" };

const KEYS = [
  { key: "donation_confirm",     label: "후원 통과 처리(미확정 후원 확정)",      cat: "donation" },
  { key: "finance_refund",       label: "지출·수입 환불 처리",                   cat: "finance" },
  { key: "settlement_view",      label: "정산 전체 집계 조회(AI 요약·이상탐지)", cat: "milestone" },
  { key: "ai_config_prompt",     label: "AI 비서 시스템 프롬프트 변경",          cat: "ai" },
  { key: "martyrdom_pub_export", label: "딥릴리프 발간물 내보내기",              cat: "martyrdom" },
];

export default async (req: Request) => {
  const run = new URL(req.url).searchParams.get("run") === "1";

  if (!run) {
    let existing: string[] = [];
    try {
      const r: any = await db.execute(sql`SELECT feature_key FROM role_permissions`);
      const rows = Array.isArray(r) ? r : r.rows ?? [];
      const have = new Set(rows.map((x: any) => x.feature_key));
      existing = KEYS.filter((k) => have.has(k.key)).map((k) => k.key);
    } catch (e: any) {
      return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500, headers: { "content-type": "application/json" } });
    }
    return new Response(
      JSON.stringify({ ok: true, mode: "diagnostic", planned: KEYS.map((k) => k.key), alreadyExist: existing }, null, 2),
      { headers: { "content-type": "application/json; charset=utf-8" } },
    );
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  try {
    let inserted = 0;
    for (const k of KEYS) {
      const r: any = await db.execute(sql`
        INSERT INTO role_permissions (feature_key, feature_label, category, admin_allowed, operator_allowed, updated_at)
        VALUES (${k.key}, ${k.label}, ${k.cat}, true, true, NOW())
        ON CONFLICT (feature_key) DO NOTHING
      `);
      inserted += Number(r?.rowCount ?? 0);
    }
    return new Response(
      JSON.stringify({ ok: true, mode: "run", inserted, total: KEYS.length, note: "기본 operator 허용=현행 유지. super_admin이 권한 정책에서 토글로 제한 가능." }, null, 2),
      { headers: { "content-type": "application/json; charset=utf-8" } },
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e), stack: String(e?.stack || "").slice(0, 800) }, null, 2), { status: 500, headers: { "content-type": "application/json" } });
  }
};
