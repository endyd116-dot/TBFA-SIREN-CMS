/* =========================================================
   migrate-seed-perms-r46.ts — 1회용 마이그레이션
   권한 매트릭스 누락 기능 9종 시드 (R46 권한 전수 정합 · 2026-06-03 Swain 승인 권장값).
   super_admin은 항상 허용(체크 안 함). admin/operator만 행에 저장.

   호출(★ tbfa.co.kr):
   - GET            : 진단 (인증 불필요) — 이미 있는/없는 키 표시
   - GET ?run=1     : 어드민 인증 후 시드 (멱등 — ON CONFLICT DO NOTHING)
   호출 성공 후 파일 삭제 + 커밋.
   ========================================================= */
import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

/* [featureKey, featureLabel, category, adminAllowed, operatorAllowed] — 추천 기본값 */
const SEED: Array<[string, string, string, boolean, boolean]> = [
  ["payroll_manage",      "급여관리",                          "operation", false, false],
  ["att_config",          "근태 설정(정책·공휴일·휴가종류·거점)", "att",       false, false],
  ["send_template",       "발송 템플릿·수신자 그룹",            "notify",    true,  false],
  ["send_auto",           "AI 자동발송·시스템 자동발송",         "notify",    true,  false],
  ["kakao_template",      "카카오 알림톡 템플릿",               "notify",    true,  false],
  ["org_news",            "여론·뉴스 분석",                    "content",   true,  false],
  ["receipt_config",      "영수증 설정",                       "finance",   true,  false],
  ["cms_memorial",        "온라인 추모관 관리",                 "content",   true,  false],
  ["cms_family_stories",  "유가족 이야기 관리",                 "content",   true,  false],
];

export default async (req: Request, _ctx: Context) => {
  const run = new URL(req.url).searchParams.get("run") === "1";
  try {
    /* 진단 — 현재 존재하는 키 */
    const exist: any = await db.execute(sql`SELECT feature_key FROM role_permissions`);
    const have = new Set((exist?.rows ?? exist ?? []).map((r: any) => String(r.feature_key)));
    const toAdd = SEED.filter(s => !have.has(s[0])).map(s => s[0]);

    if (!run) {
      return new Response(JSON.stringify({
        ok: true, mode: "diagnostic",
        alreadyExists: SEED.map(s => s[0]).filter(k => have.has(k)),
        willAdd: toAdd,
      }), { headers: JSON_HEADER });
    }

    const auth = await requireAdmin(req);
    if (!auth.ok) return (auth as any).res;

    let added = 0;
    for (const [key, label, category, admin, operator] of SEED) {
      const r: any = await db.execute(sql`
        INSERT INTO role_permissions (feature_key, feature_label, category, admin_allowed, operator_allowed, updated_at)
        VALUES (${key}, ${label}, ${category}, ${admin}, ${operator}, NOW())
        ON CONFLICT (feature_key) DO NOTHING
      `);
      added += Number(r?.rowCount ?? 0);
    }
    return new Response(JSON.stringify({
      ok: true, mode: "executed", added,
      message: `권한 키 ${added}개 시드 완료. 권한정책관리 메뉴에서 admin/operator 조정 가능.`,
    }), { headers: JSON_HEADER });
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false, error: "시드 실패", detail: String(err?.message || err).slice(0, 500),
    }), { status: 500, headers: JSON_HEADER });
  }
};

export const config = { path: "/api/migrate-seed-perms-r46" };
