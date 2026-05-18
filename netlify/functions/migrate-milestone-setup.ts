import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-milestone-setup" };

export default async function handler(req: Request, _ctx: Context) {
  const url = new URL(req.url);
  if (url.searchParams.get("run") !== "1") {
    return Response.json({ ok: true, mode: "dry-run", message: "?run=1 을 추가하면 실행됩니다" });
  }
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  const steps: string[] = [];

  try {
    // ─── Step 1: members 테이블에 milestone_role 컬럼 추가 ───
    await db.execute(sql`
      ALTER TABLE members ADD COLUMN IF NOT EXISTS milestone_role VARCHAR(10)
    `);
    steps.push("members.milestone_role 컬럼 추가");

    // ─── Step 2: quarters 테이블 ───
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS quarters (
        id SERIAL PRIMARY KEY,
        year INTEGER NOT NULL,
        quarter INTEGER NOT NULL CHECK (quarter BETWEEN 1 AND 4),
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        settlement_date DATE NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'UPCOMING',
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL,
        CONSTRAINT quarters_year_q_uq UNIQUE (year, quarter)
      )
    `);
    steps.push("quarters 테이블 생성");

    // ─── Step 3: milestone_definitions 테이블 ───
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS milestone_definitions (
        id SERIAL PRIMARY KEY,
        code VARCHAR(20) NOT NULL UNIQUE,
        name VARCHAR(200) NOT NULL,
        category VARCHAR(20) NOT NULL,
        target_milestone_role VARCHAR(10) NOT NULL,
        business_unit VARCHAR(30),
        revenue_source VARCHAR(100),
        threshold_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        threshold_value NUMERIC(15,2),
        threshold_unit VARCHAR(30),
        bonus_formula JSONB NOT NULL,
        quarter_applicable VARCHAR(5),
        is_shared_threshold BOOLEAN NOT NULL DEFAULT FALSE,
        shared_threshold_group VARCHAR(20),
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        effective_from DATE,
        effective_to DATE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);
    steps.push("milestone_definitions 테이블 생성");

    // ─── Step 4: revenue_entries 테이블 ───
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS revenue_entries (
        id SERIAL PRIMARY KEY,
        milestone_definition_id INTEGER NOT NULL REFERENCES milestone_definitions(id),
        quarter_id INTEGER NOT NULL REFERENCES quarters(id),
        entered_by INTEGER NOT NULL REFERENCES members(id),
        responsible_admin_id INTEGER REFERENCES members(id),
        revenue_date DATE NOT NULL,
        amount NUMERIC(15,2) NOT NULL,
        amount_unit VARCHAR(20) NOT NULL DEFAULT '원',
        note TEXT,
        is_campaign_routed BOOLEAN DEFAULT FALSE,
        evidence_files JSONB DEFAULT '[]',
        status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        reviewed_by INTEGER REFERENCES members(id),
        reviewed_at TIMESTAMP,
        reject_reason TEXT,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);
    steps.push("revenue_entries 테이블 생성");

    // ─── Step 5: non_revenue_achievements 테이블 ───
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS non_revenue_achievements (
        id SERIAL PRIMARY KEY,
        milestone_definition_id INTEGER NOT NULL REFERENCES milestone_definitions(id),
        quarter_id INTEGER NOT NULL REFERENCES quarters(id),
        submitted_by INTEGER NOT NULL REFERENCES members(id),
        achieved_date DATE NOT NULL,
        description TEXT,
        evidence_files JSONB DEFAULT '[]',
        bonus_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
        event_range_amount NUMERIC(15,2),
        is_selected_for_quarter BOOLEAN NOT NULL DEFAULT FALSE,
        selection_order INTEGER,
        status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        reviewed_by INTEGER REFERENCES members(id),
        reviewed_at TIMESTAMP,
        reject_reason TEXT,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);
    steps.push("non_revenue_achievements 테이블 생성");

    // ─── Step 6: quarterly_settlements 테이블 ───
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS quarterly_settlements (
        id SERIAL PRIMARY KEY,
        quarter_id INTEGER NOT NULL REFERENCES quarters(id),
        member_id INTEGER NOT NULL REFERENCES members(id),
        revenue_linked_total NUMERIC(15,2) NOT NULL DEFAULT 0,
        non_revenue_total NUMERIC(15,2) NOT NULL DEFAULT 0,
        total_bonus NUMERIC(15,2) NOT NULL DEFAULT 0,
        calculation_snapshot JSONB,
        self_evaluation TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
        submitted_at TIMESTAMP,
        reviewed_by INTEGER REFERENCES members(id),
        reviewed_at TIMESTAMP,
        review_note TEXT,
        approved_at TIMESTAMP,
        paid_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL,
        CONSTRAINT qs_quarter_member_uq UNIQUE (quarter_id, member_id)
      )
    `);
    steps.push("quarterly_settlements 테이블 생성");

    // ─── Step 7: rolePermissions 시드 ───
    const permSeeds = [
      { key: "milestone:view",                  label: "성과 관리 조회",    admin: true,  op: true  },
      { key: "milestone:revenue:input",          label: "매출 실적 입력",    admin: true,  op: true  },
      { key: "milestone:revenue:verify",         label: "매출 실적 검증",    admin: true,  op: false },
      { key: "milestone:nonrevenue:manage",      label: "비매출 성과 관리",   admin: true,  op: false },
      { key: "milestone:settlement:submit",      label: "분기 결산 제출",    admin: true,  op: false },
      { key: "milestone:manage",                 label: "마일스톤 정의 관리", admin: false, op: false },
      { key: "milestone:settlement:approve",     label: "분기 결산 승인",    admin: false, op: false },
      { key: "milestone:quarter:manage",         label: "분기 관리",        admin: false, op: false },
    ];
    for (const p of permSeeds) {
      await db.execute(sql`
        INSERT INTO role_permissions (feature_key, feature_label, category, admin_allowed, operator_allowed, updated_at)
        VALUES (${p.key}, ${p.label}, 'milestone', ${p.admin}, ${p.op}, NOW())
        ON CONFLICT (feature_key) DO NOTHING
      `);
    }
    steps.push(`rolePermissions 시드 ${permSeeds.length}개`);

    // ─── Step 8: 마일스톤 마스터 53개 시드 ───
    const seeds = getMilestoneSeeds();
    let inserted = 0;
    for (const s of seeds) {
      await db.execute(sql`
        INSERT INTO milestone_definitions
          (code, name, category, target_milestone_role, business_unit, revenue_source,
           threshold_enabled, threshold_value, threshold_unit, bonus_formula,
           quarter_applicable, is_shared_threshold, shared_threshold_group, sort_order)
        VALUES (
          ${s.code}, ${s.name}, ${s.category}, ${s.role}, ${s.bu}, ${s.src ?? null},
          ${s.thr}, ${s.thrVal ?? null}, ${s.thrUnit ?? null}, ${JSON.stringify(s.formula)},
          ${s.q ?? null}, ${s.shared ?? false}, ${s.sharedGroup ?? null}, ${s.order}
        )
        ON CONFLICT (code) DO NOTHING
      `);
      inserted++;
    }
    steps.push(`마일스톤 시드 ${inserted}개 삽입`);

    // ─── Step 9: 1분기 2025 기본 분기 생성 ───
    await db.execute(sql`
      INSERT INTO quarters (year, quarter, start_date, end_date, settlement_date, status)
      VALUES (2025, 1, '2025-01-01', '2025-03-31', '2025-04-07', 'ACTIVE')
      ON CONFLICT ON CONSTRAINT quarters_year_q_uq DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO quarters (year, quarter, start_date, end_date, settlement_date, status)
      VALUES (2025, 2, '2025-04-01', '2025-06-30', '2025-07-07', 'UPCOMING')
      ON CONFLICT ON CONSTRAINT quarters_year_q_uq DO NOTHING
    `);
    steps.push("기본 분기 (2025 Q1/Q2) 생성");

    return Response.json({ ok: true, steps, count: { milestones: 53, permissions: permSeeds.length } });
  } catch (err: any) {
    return Response.json({
      ok: false, error: "마이그레이션 실패", steps,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }, { status: 500 });
  }
}

function getMilestoneSeeds() {
  type Seed = {
    code: string; name: string; category: string; role: string; bu: string;
    src?: string; thr: boolean; thrVal?: number; thrUnit?: string;
    formula: Record<string, unknown>; q?: string;
    shared?: boolean; sharedGroup?: string; order: number;
  };

  const FLAT = (u: number) => ({ type: "FLAT", unitAmount: u });
  const PCT  = (r: number) => ({ type: "PERCENT", rate: r });
  const BRK  = (b: Array<{min:number;max?:number;amount:number}>) =>
    ({ type: "BRACKET", brackets: b.map(x => ({ min: x.min, max: x.max ?? null, amount: x.amount })) });
  const EVT  = (mn: number, mx: number) => ({ type: "EVENT_RANGE", minAmount: mn, maxAmount: mx });

  const seeds: Seed[] = [
    // ─── SM 사무국장 매출연동 ───
    { code:"sm-001", name:"신규 정기후원자 유치 (캠페인 외 직접 모집)", category:"REVENUE_LINKED", role:"SM", bu:"ASSOCIATION",
      src:"regular_donation", thr:true, thrVal:20, thrUnit:"명", formula:FLAT(60000), order:1 },
    { code:"sm-002", name:"장기후원 전환 (캠페인 경유 + 3개월 유지)", category:"REVENUE_LINKED", role:"SM", bu:"ASSOCIATION",
      src:"regular_donation", thr:true, thrVal:5, thrUnit:"명", formula:FLAT(50000), order:2 },
    { code:"sm-003", name:"월 평균 정기후원 누적액", category:"REVENUE_LINKED", role:"SM", bu:"ASSOCIATION",
      src:"regular_donation", thr:true, thrVal:3000000, thrUnit:"원/월",
      formula:BRK([{min:4000000,max:5999999,amount:500000},{min:6000000,max:7999999,amount:1000000},{min:8000000,amount:2000000}]), order:3 },
    { code:"sm-004", name:"분기 일시후원금 총액", category:"REVENUE_LINKED", role:"SM", bu:"ASSOCIATION",
      src:"one_time_donation", thr:true, thrVal:5000000, thrUnit:"원",
      formula:BRK([{min:10000000,max:19999999,amount:1500000},{min:20000000,amount:4000000}]), order:4 },
    { code:"sm-005", name:"캠페인 모금액", category:"REVENUE_LINKED", role:"SM", bu:"ASSOCIATION",
      src:"campaign", thr:true, thrVal:10000000, thrUnit:"원",
      formula:BRK([{min:30000000,max:49999999,amount:1500000},{min:50000000,amount:3000000}]), order:5 },
    { code:"sm-006", name:"기업·기관 후원 협약 체결", category:"REVENUE_LINKED", role:"SM", bu:"ASSOCIATION",
      src:"corporate_donation", thr:false, formula:EVT(500000,1000000), order:6 },

    // ─── SM 비매출 Q1 ───
    { code:"sm-q1-01", name:"사단법인 인가 완료", category:"NON_REVENUE", role:"SM", bu:"ASSOCIATION",
      thr:false, formula:FLAT(1000000), q:"Q1", order:10 },
    { code:"sm-q1-02", name:"신규 유족 회원 30명 등록", category:"NON_REVENUE", role:"SM", bu:"ASSOCIATION",
      thr:false, formula:FLAT(1000000), q:"Q1", order:11 },
    { code:"sm-q1-03", name:"신규 유족 회원 50명 등록", category:"NON_REVENUE", role:"SM", bu:"ASSOCIATION",
      thr:false, formula:FLAT(2000000), q:"Q1", order:12 },
    { code:"sm-q1-04", name:"기업·기관 후원 첫 협약 체결", category:"NON_REVENUE", role:"SM", bu:"ASSOCIATION",
      thr:false, formula:FLAT(2000000), q:"Q1", order:13 },

    // ─── SM 비매출 Q2 ───
    { code:"sm-q2-01", name:"지정기부금단체 지정", category:"NON_REVENUE", role:"SM", bu:"ASSOCIATION",
      thr:false, formula:FLAT(3000000), q:"Q2", order:20 },
    { code:"sm-q2-02", name:"신규 유족 회원 누적 80명 달성", category:"NON_REVENUE", role:"SM", bu:"ASSOCIATION",
      thr:false, formula:FLAT(2000000), q:"Q2", order:21 },
    { code:"sm-q2-03", name:"신규 유족 회원 누적 120명 달성", category:"NON_REVENUE", role:"SM", bu:"ASSOCIATION",
      thr:false, formula:FLAT(3000000), q:"Q2", order:22 },
    { code:"sm-q2-04", name:"기업·기관 후원 협약 누적 3건↑", category:"NON_REVENUE", role:"SM", bu:"ASSOCIATION",
      thr:false, formula:FLAT(3000000), q:"Q2", order:23 },

    // ─── PM 정책국장 매출연동 — 함께워크 ON ───
    { code:"pm-001", name:"함께워크 ON 분기 매출", category:"REVENUE_LINKED", role:"PM", bu:"HAMKEWORK",
      src:"hamkework_revenue", thr:true, thrVal:15000000, thrUnit:"원", formula:PCT(0.015), order:30 },
    { code:"pm-002", name:"신규 상주 입주사", category:"REVENUE_LINKED", role:"PM", bu:"HAMKEWORK",
      src:"hamkework_resident", thr:true, thrVal:7, thrUnit:"팀", formula:FLAT(40000), order:31 },
    { code:"pm-003", name:"신규 비상주 입주사", category:"REVENUE_LINKED", role:"PM", bu:"HAMKEWORK",
      src:"hamkework_nonresident", thr:true, thrVal:15, thrUnit:"팀", formula:FLAT(20000), order:32 },
    { code:"pm-004", name:"유료 세미나·강연 매출", category:"REVENUE_LINKED", role:"PM", bu:"HAMKEWORK",
      src:"hamkework_seminar", thr:true, thrVal:5000000, thrUnit:"원", formula:PCT(0.04), order:33 },

    // ─── PM 정책국장 매출연동 — 정책 영역 ───
    { code:"pm-005", name:"유족 순직 지원 컨설팅료", category:"REVENUE_LINKED", role:"PM", bu:"POLICY",
      src:"policy_consulting", thr:false, formula:EVT(200000,1100000), order:40 },
    { code:"pm-006", name:"교육청·교육부 외주용역 수주", category:"REVENUE_LINKED", role:"PM", bu:"POLICY",
      src:"policy_outsource", thr:false, formula:PCT(0.012), order:41 },
    { code:"pm-007", name:"정책연구지 발간 외주용역", category:"REVENUE_LINKED", role:"PM", bu:"POLICY",
      src:"policy_research", thr:false, formula:PCT(0.015), order:42 },
    { code:"pm-008", name:"순직심의 지원 외주용역", category:"REVENUE_LINKED", role:"PM", bu:"POLICY",
      src:"policy_martyr_review", thr:false, formula:PCT(0.015), order:43 },
    { code:"pm-009", name:"진상조사 외주용역", category:"REVENUE_LINKED", role:"PM", bu:"POLICY",
      src:"policy_investigation", thr:false, formula:PCT(0.015), order:44 },
    { code:"pm-010", name:"1000원의 행복 캠페인 운영비", category:"REVENUE_LINKED", role:"PM", bu:"POLICY",
      src:"policy_campaign_1000", thr:false, formula:PCT(0.025), order:45 },

    // ─── PM 비매출 Q1 ───
    { code:"pm-q1-01", name:"함께워크 ON 입주율 50% 달성", category:"NON_REVENUE", role:"PM", bu:"HAMKEWORK",
      thr:false, formula:FLAT(800000), q:"Q1", order:50 },
    { code:"pm-q1-02", name:"함께워크 ON 입주율 70% 달성", category:"NON_REVENUE", role:"PM", bu:"HAMKEWORK",
      thr:false, formula:FLAT(1500000), q:"Q1", order:51 },
    { code:"pm-q1-03", name:"비상주 입주사 누적 10팀 달성", category:"NON_REVENUE", role:"PM", bu:"HAMKEWORK",
      thr:false, formula:FLAT(800000), q:"Q1", order:52 },
    { code:"pm-q1-04", name:"교육청·교육부 첫 MOU 체결", category:"NON_REVENUE", role:"PM", bu:"POLICY",
      thr:false, formula:FLAT(1500000), q:"Q1", order:53 },
    { code:"pm-q1-05", name:"순직 인정 사건 승소 (1건)", category:"NON_REVENUE", role:"PM", bu:"POLICY",
      thr:false, formula:FLAT(1100000), q:"Q1", order:54 },
    { code:"pm-q1-06", name:"1000원의 행복 협약 체결", category:"NON_REVENUE", role:"PM", bu:"POLICY",
      thr:false, formula:FLAT(2300000), q:"Q1", order:55 },
    { code:"pm-q1-07", name:"주요 일간지 1면·메인 방송 보도", category:"NON_REVENUE", role:"PM", bu:"POLICY",
      thr:false, formula:FLAT(800000), q:"Q1", order:56 },

    // ─── PM 비매출 Q2 ───
    { code:"pm-q2-01", name:"함께워크 ON 입주율 80% 달성", category:"NON_REVENUE", role:"PM", bu:"HAMKEWORK",
      thr:false, formula:FLAT(1500000), q:"Q2", order:60 },
    { code:"pm-q2-02", name:"비상주 입주사 누적 30팀 달성", category:"NON_REVENUE", role:"PM", bu:"HAMKEWORK",
      thr:false, formula:FLAT(1100000), q:"Q2", order:61 },
    { code:"pm-q2-03", name:"교육부 외주용역 첫 수주", category:"NON_REVENUE", role:"PM", bu:"POLICY",
      thr:false, formula:FLAT(3000000), q:"Q2", order:62 },
    { code:"pm-q2-04", name:"정책연구지 발간 첫 수주", category:"NON_REVENUE", role:"PM", bu:"POLICY",
      thr:false, formula:FLAT(2300000), q:"Q2", order:63 },
    { code:"pm-q2-05", name:"순직심의 지원 사업 첫 수주", category:"NON_REVENUE", role:"PM", bu:"POLICY",
      thr:false, formula:FLAT(2300000), q:"Q2", order:64 },
    { code:"pm-q2-06", name:"순직 인정 사건 승소 (1건당)", category:"NON_REVENUE", role:"PM", bu:"POLICY",
      thr:false, formula:FLAT(1500000), q:"Q2", order:65 },
    { code:"pm-q2-07", name:"관련 법안 국회 발의", category:"NON_REVENUE", role:"PM", bu:"POLICY",
      thr:false, formula:FLAT(1500000), q:"Q2", order:66 },
    { code:"pm-q2-08", name:"사회적협동조합 발기인 + 정관 채택", category:"NON_REVENUE", role:"PM", bu:"POLICY",
      thr:false, formula:FLAT(800000), q:"Q2", order:67 },

    // ─── SI 영업·사업관리자 매출연동 ───
    { code:"si-001", name:"SI 수주 — 중개플랫폼 (쿠팡·위시켓·프리모아 등)", category:"REVENUE_LINKED", role:"SI", bu:"PLEO",
      src:"si_platform", thr:true, thrVal:30000000, thrUnit:"원",
      formula:PCT(0.04), shared:true, sharedGroup:"SI_SALES", order:70 },
    { code:"si-002", name:"SI 수주 — 직접 영업 (SI/AX)", category:"REVENUE_LINKED", role:"SI", bu:"PLEO",
      src:"si_direct", thr:true, thrVal:30000000, thrUnit:"원",
      formula:PCT(0.05), shared:true, sharedGroup:"SI_SALES", order:71 },
    { code:"si-003", name:"SI 수주 — NPO 협회 영업", category:"REVENUE_LINKED", role:"SI", bu:"PLEO",
      src:"si_npo", thr:true, thrVal:30000000, thrUnit:"원",
      formula:PCT(0.05), shared:true, sharedGroup:"SI_SALES", order:72 },
    { code:"si-004", name:"자체 AI 솔루션 매출", category:"REVENUE_LINKED", role:"SI", bu:"PLEO",
      src:"si_ai_solution", thr:true, thrVal:5000000, thrUnit:"원", formula:PCT(0.05), order:73 },
    { code:"si-005", name:"정부과제 수주", category:"REVENUE_LINKED", role:"SI", bu:"PLEO",
      src:"si_gov_project", thr:false, formula:PCT(0.01), order:74 },
    { code:"si-006", name:"정부용역 수주", category:"REVENUE_LINKED", role:"SI", bu:"PLEO",
      src:"si_gov_service", thr:false, formula:PCT(0.01), order:75 },
    { code:"si-007", name:"공공입찰 낙찰 가산", category:"REVENUE_LINKED", role:"SI", bu:"PLEO",
      src:"si_public_bid", thr:false, formula:PCT(0.01), order:76 },

    // ─── SI 비매출 Q1 ───
    { code:"si-q1-01", name:"첫 SI 프로젝트 계약 체결", category:"NON_REVENUE", role:"SI", bu:"PLEO",
      thr:false, formula:FLAT(1000000), q:"Q1", order:80 },
    { code:"si-q1-02", name:"중개플랫폼 등록 + 첫 수주", category:"NON_REVENUE", role:"SI", bu:"PLEO",
      thr:false, formula:FLAT(1000000), q:"Q1", order:81 },
    { code:"si-q1-03", name:"누적 수주 5000만원 달성", category:"NON_REVENUE", role:"SI", bu:"PLEO",
      thr:false, formula:FLAT(2000000), q:"Q1", order:82 },
    { code:"si-q1-04", name:"누적 수주 1억원 달성", category:"NON_REVENUE", role:"SI", bu:"PLEO",
      thr:false, formula:FLAT(4000000), q:"Q1", order:83 },
    { code:"si-q1-05", name:"자체 AI 솔루션 첫 유료 계약 체결", category:"NON_REVENUE", role:"SI", bu:"PLEO",
      thr:false, formula:FLAT(2500000), q:"Q1", order:84 },
    { code:"si-q1-06", name:"NPO 협회 첫 영업 수주", category:"NON_REVENUE", role:"SI", bu:"PLEO",
      thr:false, formula:FLAT(2000000), q:"Q1", order:85 },

    // ─── SI 비매출 Q2 ───
    { code:"si-q2-01", name:"정부과제 수주 (1건)", category:"NON_REVENUE", role:"SI", bu:"PLEO",
      thr:false, formula:FLAT(4000000), q:"Q2", order:90 },
    { code:"si-q2-02", name:"정부용역 수주 (1건)", category:"NON_REVENUE", role:"SI", bu:"PLEO",
      thr:false, formula:FLAT(4000000), q:"Q2", order:91 },
    { code:"si-q2-03", name:"누적 수주 2억원 달성", category:"NON_REVENUE", role:"SI", bu:"PLEO",
      thr:false, formula:FLAT(3000000), q:"Q2", order:92 },
    { code:"si-q2-04", name:"누적 수주 3억원 달성", category:"NON_REVENUE", role:"SI", bu:"PLEO",
      thr:false, formula:FLAT(5000000), q:"Q2", order:93 },
    { code:"si-q2-05", name:"자체 AI 솔루션 누적 유료 고객 5팀 달성", category:"NON_REVENUE", role:"SI", bu:"PLEO",
      thr:false, formula:FLAT(3000000), q:"Q2", order:94 },
    { code:"si-q2-06", name:"외부 SI 프로젝트 NPS 70+ (서면 추천서)", category:"NON_REVENUE", role:"SI", bu:"PLEO",
      thr:false, formula:FLAT(1500000), q:"Q2", order:95 },
    { code:"si-q2-07", name:"벤처기업 인증 취득", category:"NON_REVENUE", role:"SI", bu:"PLEO",
      thr:false, formula:FLAT(1000000), q:"Q2", order:96 },
  ];

  return seeds;
}
