import type { Context } from "@netlify/functions";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-milestone-v4" };

/* 성과관리 v4 전환 — 마일스톤 정의 전면 교체 (1회용·호출 성공 후 삭제)
   출처: 직원_연봉_성과급_체계_2026_v4 (5:5 밸런스 + R&R 재분배)
   - 역할 3개(정책국장·사무국장·SI 영업관리자) find-or-create
   - milestone_definitions.non_revenue_category 컬럼 추가(비매출 5 카테고리)
   - 기존 정의 전면 비활성 → v4 71개 upsert(code 기준 멱등)
   GET            : 진단(인증 불필요)
   GET ?run=1     : requireAdmin(super_admin) 후 실행 */

/* 역할: 시스템 역할 코드(내부)·이름(v4) */
const ROLES = [
  { code: "POLICY", name: "정책국장" },
  { code: "OFFICE", name: "사무국장" },
  { code: "SI",     name: "SI 영업관리자" },
];

const F_EVENT = { type: "EVENT_RANGE" };
const FLAT = (unitAmount: number) => ({ type: "FLAT", unitAmount });
const PCT  = (rate: number) => ({ type: "PERCENT", rate });
const BR   = (brackets: Array<{ min: number; max: number | null; amount: number }>) => ({ type: "BRACKET", brackets });

interface Def {
  code: string; name: string; cat: "REVENUE_LINKED" | "NON_REVENUE";
  role: "POLICY" | "OFFICE" | "SI"; bu: string;
  thrEnabled?: boolean; thrVal?: number | null; thrUnit?: string | null;
  formula: any; shared?: string | null; nrCat?: number | null;
}

const DEFS: Def[] = [
  /* ===== 매출 영역 — 사무국장(OFFICE) 캡 800 ===== */
  /* §3.1 협의회 후원·회원 (자체 max 500) */
  { code: "v4-r-off-01", name: "신규 정기후원자 유치 (캠페인 외)", cat: "REVENUE_LINKED", role: "OFFICE", bu: "ASSOCIATION", thrEnabled: true, thrVal: 20, thrUnit: "명", formula: FLAT(60000) },
  { code: "v4-r-off-02", name: "장기후원 전환 (캠페인 경유 +3개월)", cat: "REVENUE_LINKED", role: "OFFICE", bu: "ASSOCIATION", thrEnabled: true, thrVal: 5, thrUnit: "명", formula: FLAT(50000) },
  { code: "v4-r-off-03", name: "월 평균 정기후원 누적액", cat: "REVENUE_LINKED", role: "OFFICE", bu: "ASSOCIATION", formula: BR([{ min: 4000000, max: 5999999, amount: 500000 }, { min: 6000000, max: 7999999, amount: 1000000 }, { min: 8000000, max: null, amount: 2000000 }]) },
  { code: "v4-r-off-04", name: "분기 일시후원금 총액", cat: "REVENUE_LINKED", role: "OFFICE", bu: "ASSOCIATION", formula: BR([{ min: 10000000, max: 19999999, amount: 1500000 }, { min: 20000000, max: null, amount: 4000000 }]) },
  { code: "v4-r-off-05", name: "캠페인 모금액", cat: "REVENUE_LINKED", role: "OFFICE", bu: "ASSOCIATION", formula: BR([{ min: 30000000, max: 49999999, amount: 1500000 }, { min: 50000000, max: null, amount: 3000000 }]) },
  { code: "v4-r-off-06", name: "기업·기관 후원 협약 체결", cat: "REVENUE_LINKED", role: "OFFICE", bu: "ASSOCIATION", formula: F_EVENT },
  /* §3.2 함께워크 ON 운영 (이관·자체 max 300) */
  { code: "v4-r-off-07", name: "함께워크 ON 분기 매출 (상주·비상주·세미나)", cat: "REVENUE_LINKED", role: "OFFICE", bu: "HAMKEWORK", thrEnabled: true, thrVal: 15000000, thrUnit: "원", formula: PCT(0.015) },
  { code: "v4-r-off-08", name: "신규 상주 입주사", cat: "REVENUE_LINKED", role: "OFFICE", bu: "HAMKEWORK", thrEnabled: true, thrVal: 7, thrUnit: "팀", formula: FLAT(40000) },
  { code: "v4-r-off-09", name: "신규 비상주 입주사", cat: "REVENUE_LINKED", role: "OFFICE", bu: "HAMKEWORK", thrEnabled: true, thrVal: 15, thrUnit: "팀", formula: FLAT(20000) },

  /* ===== 매출 영역 — 정책국장(POLICY) 캡 850 ===== */
  /* §4.1 정책·외주용역 (자체 max 700·이벤트성) */
  { code: "v4-r-pol-01", name: "유족 순직 지원 컨설팅료", cat: "REVENUE_LINKED", role: "POLICY", bu: "POLICY", formula: F_EVENT },
  { code: "v4-r-pol-02", name: "교육청·교육부 외주용역 수주", cat: "REVENUE_LINKED", role: "POLICY", bu: "POLICY", formula: PCT(0.012) },
  { code: "v4-r-pol-03", name: "정책연구지 발간 외주용역", cat: "REVENUE_LINKED", role: "POLICY", bu: "POLICY", formula: PCT(0.015) },
  { code: "v4-r-pol-04", name: "순직심의 지원 외주용역", cat: "REVENUE_LINKED", role: "POLICY", bu: "POLICY", formula: PCT(0.015) },
  { code: "v4-r-pol-05", name: "진상조사 외주용역", cat: "REVENUE_LINKED", role: "POLICY", bu: "POLICY", formula: PCT(0.015) },
  { code: "v4-r-pol-06", name: "1,000원의 행복 캠페인 운영비 환원", cat: "REVENUE_LINKED", role: "POLICY", bu: "POLICY", formula: PCT(0.025) },
  /* §4.2 정책국장 기획 세미나·강연 (자체 max 150) */
  { code: "v4-r-pol-07", name: "유료 세미나·강연 매출 (정책국장 기획)", cat: "REVENUE_LINKED", role: "POLICY", bu: "POLICY", thrEnabled: true, thrVal: 5000000, thrUnit: "원", formula: PCT(0.04) },

  /* ===== 매출 영역 — SI 영업관리자(SI) 캡 1,110 ===== */
  { code: "v4-r-si-01", name: "SI 수주 (중개플랫폼)", cat: "REVENUE_LINKED", role: "SI", bu: "PLEO", thrEnabled: true, thrVal: 30000000, thrUnit: "원", formula: PCT(0.04), shared: "SI_SUJU" },
  { code: "v4-r-si-02", name: "SI 수주 (직접 영업)", cat: "REVENUE_LINKED", role: "SI", bu: "PLEO", thrEnabled: true, thrVal: 30000000, thrUnit: "원", formula: PCT(0.05), shared: "SI_SUJU" },
  { code: "v4-r-si-03", name: "SI 수주 (NPO 영업)", cat: "REVENUE_LINKED", role: "SI", bu: "PLEO", thrEnabled: true, thrVal: 30000000, thrUnit: "원", formula: PCT(0.05), shared: "SI_SUJU" },
  { code: "v4-r-si-04", name: "자체 AI 솔루션 매출", cat: "REVENUE_LINKED", role: "SI", bu: "PLEO", thrEnabled: true, thrVal: 5000000, thrUnit: "원", formula: PCT(0.05) },
  { code: "v4-r-si-05", name: "정부과제 수주", cat: "REVENUE_LINKED", role: "SI", bu: "PLEO", formula: PCT(0.01) },
  { code: "v4-r-si-06", name: "정부용역 수주", cat: "REVENUE_LINKED", role: "SI", bu: "PLEO", formula: PCT(0.01) },
  { code: "v4-r-si-07", name: "공공입찰 낙찰 가산", cat: "REVENUE_LINKED", role: "SI", bu: "PLEO", formula: PCT(0.01) },

  /* ===== 비매출 ① 미션·정책 영향력 ===== */
  { code: "v4-n1-01", name: "순직 인정 사건 승소 (1건당)", cat: "NON_REVENUE", role: "POLICY", bu: "POLICY", nrCat: 1, formula: FLAT(2000000) },
  { code: "v4-n1-02", name: "교육부·교육청 MOU 체결", cat: "NON_REVENUE", role: "POLICY", bu: "POLICY", nrCat: 1, formula: FLAT(3000000) },
  { code: "v4-n1-03", name: "관련 법안 국회 발의", cat: "NON_REVENUE", role: "POLICY", bu: "POLICY", nrCat: 1, formula: FLAT(3000000) },
  { code: "v4-n1-04", name: "1,000원의 행복 협약 체결", cat: "NON_REVENUE", role: "POLICY", bu: "POLICY", nrCat: 1, formula: FLAT(3000000) },
  { code: "v4-n1-05", name: "국정감사·국회 의제 채택", cat: "NON_REVENUE", role: "POLICY", bu: "POLICY", nrCat: 1, formula: FLAT(2500000) },
  { code: "v4-n1-06", name: "위원회·자문위 정식 참여", cat: "NON_REVENUE", role: "POLICY", bu: "POLICY", nrCat: 1, formula: FLAT(1500000) },
  { code: "v4-n1-07", name: "NPO 협회 영업 누적 5건", cat: "NON_REVENUE", role: "SI", bu: "PLEO", nrCat: 1, formula: FLAT(2000000) },
  { code: "v4-n1-08", name: "사회적기업·소셜벤처 SI 수주 누적 3건", cat: "NON_REVENUE", role: "SI", bu: "PLEO", nrCat: 1, formula: FLAT(1500000) },

  /* ===== 비매출 ② 유족·회원 직접 지원 ===== */
  { code: "v4-n2-01", name: "신규 유족 회원 30명 등록", cat: "NON_REVENUE", role: "OFFICE", bu: "ASSOCIATION", nrCat: 2, formula: FLAT(1000000) },
  { code: "v4-n2-02", name: "신규 유족 회원 50명 누적", cat: "NON_REVENUE", role: "OFFICE", bu: "ASSOCIATION", nrCat: 2, formula: FLAT(2000000) },
  { code: "v4-n2-03", name: "신규 유족 회원 80명 누적", cat: "NON_REVENUE", role: "OFFICE", bu: "ASSOCIATION", nrCat: 2, formula: FLAT(2500000) },
  { code: "v4-n2-04", name: "신규 유족 회원 120명 누적", cat: "NON_REVENUE", role: "OFFICE", bu: "ASSOCIATION", nrCat: 2, formula: FLAT(3000000) },
  { code: "v4-n2-05", name: "회원 retention 90%↑ (분기)", cat: "NON_REVENUE", role: "OFFICE", bu: "ASSOCIATION", nrCat: 2, formula: FLAT(1500000) },
  { code: "v4-n2-06", name: "유족 만족도 NPS 70+ (분기)", cat: "NON_REVENUE", role: "POLICY", bu: "ASSOCIATION", nrCat: 2, formula: FLAT(2000000) },
  { code: "v4-n2-07", name: "유족 케이스 우수 사례 1건", cat: "NON_REVENUE", role: "POLICY", bu: "ASSOCIATION", nrCat: 2, formula: FLAT(1000000) },
  { code: "v4-n2-08", name: "함께워크 ON 입주사 IT 자문 5건↑", cat: "NON_REVENUE", role: "SI", bu: "HAMKEWORK", nrCat: 2, formula: FLAT(1000000) },

  /* ===== 비매출 ③ 사회적 가치·인식 변화 ===== */
  { code: "v4-n3-01", name: "주요 일간지 1면·메인 방송 보도", cat: "NON_REVENUE", role: "POLICY", bu: "POLICY", nrCat: 3, formula: FLAT(1500000) },
  { code: "v4-n3-02", name: "SNS·캠페인 도달 10만↑", cat: "NON_REVENUE", role: "POLICY", bu: "POLICY", nrCat: 3, formula: FLAT(1000000) },
  { code: "v4-n3-03", name: "추모행사 200명↑ 성공 개최", cat: "NON_REVENUE", role: "POLICY", bu: "POLICY", nrCat: 3, formula: FLAT(1500000) },
  { code: "v4-n3-04", name: "외부 단체 협력 협약 체결", cat: "NON_REVENUE", role: "POLICY", bu: "POLICY", nrCat: 3, formula: FLAT(1500000) },
  { code: "v4-n3-05", name: "시민 교육·강연 5회↑ (분기)", cat: "NON_REVENUE", role: "POLICY", bu: "POLICY", nrCat: 3, formula: FLAT(1500000) },
  { code: "v4-n3-06", name: "후원자 만족도 NPS 50+", cat: "NON_REVENUE", role: "OFFICE", bu: "ASSOCIATION", nrCat: 3, formula: FLAT(1000000) },
  { code: "v4-n3-07", name: "자체 AI 솔루션 누적 유료 고객 5팀", cat: "NON_REVENUE", role: "SI", bu: "PLEO", nrCat: 3, formula: FLAT(2500000) },
  { code: "v4-n3-08", name: "자체 AI 솔루션 첫 유료 계약 (소셜)", cat: "NON_REVENUE", role: "SI", bu: "PLEO", nrCat: 3, formula: FLAT(2000000) },

  /* ===== 비매출 ④ 조직 역량 강화 ===== */
  { code: "v4-n4-01", name: "사단법인 인가 완료", cat: "NON_REVENUE", role: "OFFICE", bu: "ASSOCIATION", nrCat: 4, formula: FLAT(2000000) },
  { code: "v4-n4-02", name: "지정기부금단체 지정", cat: "NON_REVENUE", role: "OFFICE", bu: "ASSOCIATION", nrCat: 4, formula: FLAT(3000000) },
  { code: "v4-n4-03", name: "기업·기관 후원 첫 협약 체결", cat: "NON_REVENUE", role: "OFFICE", bu: "ASSOCIATION", nrCat: 4, formula: FLAT(2000000) },
  { code: "v4-n4-04", name: "기업·기관 후원 협약 누적 3건↑", cat: "NON_REVENUE", role: "OFFICE", bu: "ASSOCIATION", nrCat: 4, formula: FLAT(3000000) },
  { code: "v4-n4-05", name: "사회적협동조합 발기인 + 정관 채택", cat: "NON_REVENUE", role: "POLICY", bu: "POLICY", nrCat: 4, formula: FLAT(2000000) },
  { code: "v4-n4-06", name: "외부 협력 네트워크 신규 5건↑", cat: "NON_REVENUE", role: "POLICY", bu: "POLICY", nrCat: 4, formula: FLAT(1500000) },
  { code: "v4-n4-07", name: "교육부 외주용역 첫 수주", cat: "NON_REVENUE", role: "POLICY", bu: "POLICY", nrCat: 4, formula: FLAT(3000000) },
  { code: "v4-n4-08", name: "정책연구지 발간 첫 수주", cat: "NON_REVENUE", role: "POLICY", bu: "POLICY", nrCat: 4, formula: FLAT(2000000) },
  { code: "v4-n4-09", name: "순직심의 지원 사업 첫 수주", cat: "NON_REVENUE", role: "POLICY", bu: "POLICY", nrCat: 4, formula: FLAT(2000000) },
  { code: "v4-n4-10", name: "벤처기업 인증 취득", cat: "NON_REVENUE", role: "SI", bu: "PLEO", nrCat: 4, formula: FLAT(1500000) },
  { code: "v4-n4-11", name: "기업부설연구소 설립", cat: "NON_REVENUE", role: "SI", bu: "PLEO", nrCat: 4, formula: FLAT(2000000) },
  { code: "v4-n4-12", name: "정부과제 수주 (1건)", cat: "NON_REVENUE", role: "SI", bu: "PLEO", nrCat: 4, formula: FLAT(3500000) },
  { code: "v4-n4-13", name: "정부용역 수주 (1건)", cat: "NON_REVENUE", role: "SI", bu: "PLEO", nrCat: 4, formula: FLAT(3500000) },

  /* ===== 비매출 ⑤ 운영 효율·시스템 ===== */
  { code: "v4-n5-01", name: "함께워크 ON 입주율 50% 달성", cat: "NON_REVENUE", role: "OFFICE", bu: "HAMKEWORK", nrCat: 5, formula: FLAT(1000000) },
  { code: "v4-n5-02", name: "함께워크 ON 입주율 70% 달성", cat: "NON_REVENUE", role: "OFFICE", bu: "HAMKEWORK", nrCat: 5, formula: FLAT(1500000) },
  { code: "v4-n5-03", name: "함께워크 ON 입주율 80% 달성", cat: "NON_REVENUE", role: "OFFICE", bu: "HAMKEWORK", nrCat: 5, formula: FLAT(2000000) },
  { code: "v4-n5-04", name: "비상주 입주사 누적 10팀", cat: "NON_REVENUE", role: "OFFICE", bu: "HAMKEWORK", nrCat: 5, formula: FLAT(800000) },
  { code: "v4-n5-05", name: "비상주 입주사 누적 30팀", cat: "NON_REVENUE", role: "OFFICE", bu: "HAMKEWORK", nrCat: 5, formula: FLAT(1100000) },
  { code: "v4-n5-06", name: "자동화·매뉴얼 구축", cat: "NON_REVENUE", role: "OFFICE", bu: "ASSOCIATION", nrCat: 5, formula: FLAT(1000000) },
  { code: "v4-n5-07", name: "함께워크 ON 세미나 분기 5회↑ 운영", cat: "NON_REVENUE", role: "POLICY", bu: "HAMKEWORK", nrCat: 5, formula: FLAT(1000000) },
  { code: "v4-n5-08", name: "정책 모니터링 시스템 구축", cat: "NON_REVENUE", role: "POLICY", bu: "POLICY", nrCat: 5, formula: FLAT(1000000) },
  { code: "v4-n5-09", name: "자체 세미나 1회 기획·운영", cat: "NON_REVENUE", role: "SI", bu: "PLEO", nrCat: 5, formula: FLAT(1000000) },
  { code: "v4-n5-10", name: "협력업체 등록 3곳↑", cat: "NON_REVENUE", role: "SI", bu: "PLEO", nrCat: 5, formula: FLAT(1000000) },
  { code: "v4-n5-11", name: "외부 SI NPS 70+ 추천서", cat: "NON_REVENUE", role: "SI", bu: "PLEO", nrCat: 5, formula: FLAT(1500000) },
];

export default async function handler(req: Request, _ctx: Context) {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  if (!run) {
    try {
      const r: any = await db.execute(sql`SELECT COUNT(*)::int AS active FROM milestone_definitions WHERE is_active = TRUE`);
      const active = (r?.rows ?? r ?? [])[0]?.active ?? 0;
      return Response.json({ ok: true, mode: "diagnostic", currentActive: active, willInsert: DEFS.length, roles: ROLES.map(x => x.name), hint: "어드민(슈퍼) 로그인 후 ?run=1" });
    } catch (err: any) {
      return Response.json({ ok: false, error: String(err?.message || err).slice(0, 300) }, { status: 500 });
    }
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  const admin = auth.ctx?.member as any;
  if (admin?.role !== "super_admin") return Response.json({ ok: false, error: "슈퍼어드민 전용" }, { status: 403 });

  const done: Record<string, any> = {};
  try {
    /* 1) 비매출 카테고리 컬럼 추가 (멱등) */
    await db.execute(sql`ALTER TABLE milestone_definitions ADD COLUMN IF NOT EXISTS non_revenue_category SMALLINT`);
    done.column = "non_revenue_category";

    /* 2) 역할 3개 find-or-create (이름 기준 — 기존 동일 이름 재사용, 없으면 코드로 생성) */
    const roleCodeByKey: Record<string, string> = {};
    for (const r of ROLES) {
      const ex: any = await db.execute(sql`SELECT code FROM milestone_roles WHERE name = ${r.name} LIMIT 1`);
      const found = (ex?.rows ?? ex ?? [])[0]?.code;
      if (found) {
        roleCodeByKey[r.code] = found;
        await db.execute(sql`UPDATE milestone_roles SET is_active = TRUE, updated_at = NOW() WHERE code = ${found}`);
      } else {
        await db.execute(sql`
          INSERT INTO milestone_roles (code, name, is_active, sort_order)
          VALUES (${r.code}, ${r.name}, TRUE, 0)
          ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, is_active = TRUE, updated_at = NOW()
        `);
        roleCodeByKey[r.code] = r.code;
      }
    }
    done.roles = roleCodeByKey;

    /* 3) 기존 정의 전면 비활성 (v4가 아래에서 v4 code만 재활성) */
    await db.execute(sql`UPDATE milestone_definitions SET is_active = FALSE, updated_at = NOW() WHERE code NOT LIKE 'v4-%'`);
    done.deactivatedNonV4 = true;

    /* 4) v4 정의 71개 upsert (code 기준 멱등) */
    let n = 0;
    for (let i = 0; i < DEFS.length; i++) {
      const d = DEFS[i];
      const roleCode = roleCodeByKey[d.role] || d.role;
      await db.execute(sql`
        INSERT INTO milestone_definitions
          (code, name, category, target_milestone_role, business_unit,
           threshold_enabled, threshold_value, threshold_unit, bonus_formula,
           quarter_applicable, is_shared_threshold, shared_threshold_group,
           non_revenue_category, sort_order, is_active)
        VALUES
          (${d.code}, ${d.name}, ${d.cat}, ${roleCode}, ${d.bu},
           ${d.thrEnabled ?? false}, ${d.thrVal ?? null}, ${d.thrUnit ?? null}, ${JSON.stringify(d.formula)}::jsonb,
           ${"ALL"}, ${d.shared ? true : false}, ${d.shared ?? null},
           ${d.nrCat ?? null}, ${i + 1}, TRUE)
        ON CONFLICT (code) DO UPDATE SET
          name = EXCLUDED.name, category = EXCLUDED.category,
          target_milestone_role = EXCLUDED.target_milestone_role, business_unit = EXCLUDED.business_unit,
          threshold_enabled = EXCLUDED.threshold_enabled, threshold_value = EXCLUDED.threshold_value,
          threshold_unit = EXCLUDED.threshold_unit, bonus_formula = EXCLUDED.bonus_formula,
          quarter_applicable = EXCLUDED.quarter_applicable, is_shared_threshold = EXCLUDED.is_shared_threshold,
          shared_threshold_group = EXCLUDED.shared_threshold_group, non_revenue_category = EXCLUDED.non_revenue_category,
          sort_order = EXCLUDED.sort_order, is_active = TRUE, updated_at = NOW()
      `);
      n++;
    }
    done.upserted = n;

    return Response.json({ ok: true, mode: "run", done });
  } catch (err: any) {
    return Response.json({ ok: false, error: String(err?.message || err).slice(0, 500), done }, { status: 500 });
  }
}
