/**
 * migrate-martyrdom-p2 — 순직 인정 지원 P2 스키마 마이그레이션 (1회용·§6.8 표준)
 *
 * GET  /api/migrate-martyrdom-p2          : 진단 모드 (인증 불필요·테이블/컬럼/요건 시드 현황)
 * GET  /api/migrate-martyrdom-p2?run=1    : 실행 (requireAdmin)
 *
 * 멱등 (IF NOT EXISTS / ON CONFLICT DO NOTHING):
 *   1. 신규 3테이블: martyrdom_deadlines·martyrdom_criteria·martyrdom_actions + 인덱스
 *   2. 컬럼 추가: martyrdom_case_documents.evidence_strength / martyrdom_cases.consent_note·consent_obtained_at
 *   3. martyrdom_criteria 기본 요건 8종 시드 (code UNIQUE·ON CONFLICT DO NOTHING)
 *
 * 호출 성공 후 즉시 파일 삭제 + 커밋 (1회용 보안 원칙·§9.2)
 * 환경변수: MARTYRDOM_STORAGE_ALERT_GB (기본 20) — cron 저장용량 알림 임계 (마이그와 무관·안내만)
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-martyrdom-p2" };

/* 기본 요건 8종 (§P2.1 시드 표) */
const CRITERIA_SEED: Array<{ code: string; category: string; title: string; weight: number; sortOrder: number; description: string; evidenceHint: string; lawRef: string }> = [
  { code: "duty_performance",     category: "공무수행성", title: "공무(교육활동·부수업무) 수행 중 발생",          weight: 3, sortOrder: 1, description: "사망(질병·사고)이 공무 수행 또는 그에 부수하는 행위 중에 발생했음을 입증", evidenceHint: "work_record·application·investigation", lawRef: "공무원 재해보상법 §4·인사혁신처 공무상 재해 인정 기준" },
  { code: "causation_medical",    category: "인과관계",   title: "공무와 사망(질병·사고) 사이 상당인과관계(의학)", weight: 3, sortOrder: 2, description: "공무 수행과 사망 원인 사이에 의학적으로 상당한 인과관계가 인정될 것", evidenceHint: "medical·investigation", lawRef: "공무원 재해보상법 §5" },
  { code: "overwork",             category: "직무부담",   title: "과로·장시간근무 입증",                          weight: 2, sortOrder: 3, description: "만성적 과중 업무(주 60시간 초과 등) 또는 단기간 업무 급증을 입증", evidenceHint: "work_record", lawRef: "인사혁신처 공무상 재해 인정 기준 — 과로 인정 요건" },
  { code: "duty_stress",          category: "직무부담",   title: "악성민원·괴롭힘 등 직무 스트레스 입증",          weight: 2, sortOrder: 4, description: "악성 민원·학부모 항의·아동학대 무고 등 직무상 극심한 스트레스를 입증", evidenceHint: "duty_stress·statement", lawRef: "교사 특이적 스트레스 인정 사유" },
  { code: "mental_causation",     category: "인과관계",   title: "정신질환·심리적 요인과 공무 관련성(심리부검 등)", weight: 2, sortOrder: 5, description: "정신질환·자살의 경우 업무 기인성을 심리부검 등 전문가 의견으로 확인", evidenceHint: "medical·death_scene", lawRef: "자살의 업무 기인성 판단 기준·심리부검" },
  { code: "no_private_cause",     category: "과실/기여",  title: "개인적 사유·기존질환 기여도 반박",              weight: 2, sortOrder: 6, description: "업무 외 사유(개인적 사정·기왕증)가 주된 원인이 아님을 반박", evidenceHint: "medical·statement", lawRef: "업무 외 사유 배제 판단" },
  { code: "objective_record",     category: "객관입증",   title: "수사·감사·공문서 등 객관 자료 확보",            weight: 1, sortOrder: 7, description: "경찰·검찰·노동청·교육청 등 객관적 제3자 자료로 사실을 뒷받침", evidenceHint: "investigation·application", lawRef: "객관적 증거 우선 원칙" },
  { code: "procedure_eligibility",category: "절차",       title: "청구 자격·기한(소멸시효) 충족",                  weight: 1, sortOrder: 8, description: "청구권자 자격·청구 기한(소멸시효 3년)을 충족할 것", evidenceHint: "application", lawRef: "공무원 재해보상법 — 청구·소멸시효" },
];

function diag(data: object) {
  return new Response(JSON.stringify({ ok: true, mode: "diagnostic", ...data }, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "마이그레이션 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  /* ─────────── 진단 모드 (인증 불필요) ─────────── */
  if (!run) {
    try {
      const tablesRes: any = await db.execute(sql.raw(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('martyrdom_deadlines','martyrdom_criteria','martyrdom_actions')
      `));
      const existing = (tablesRes?.rows ?? tablesRes ?? []).map((r: any) => String(r.table_name));

      const colsRes: any = await db.execute(sql.raw(`
        SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public'
          AND ((table_name='martyrdom_case_documents' AND column_name='evidence_strength')
            OR (table_name='martyrdom_cases' AND column_name IN ('consent_note','consent_obtained_at')))
      `));
      const cols = (colsRes?.rows ?? colsRes ?? []).map((r: any) => `${r.table_name}.${r.column_name}`);

      let criteriaCount = 0;
      try {
        const cRes: any = await db.execute(sql.raw(`SELECT COUNT(*)::int AS cnt FROM martyrdom_criteria`));
        criteriaCount = Number((cRes?.rows ?? cRes ?? [])[0]?.cnt ?? 0);
      } catch { /* 테이블 없음 */ }

      return diag({
        newTables: { expected: ["martyrdom_deadlines", "martyrdom_criteria", "martyrdom_actions"], existing },
        newColumns: { expected: ["martyrdom_case_documents.evidence_strength", "martyrdom_cases.consent_note", "martyrdom_cases.consent_obtained_at"], existing: cols },
        criteriaSeeded: criteriaCount,
        storageAlertGb: Number(process.env.MARTYRDOM_STORAGE_ALERT_GB || 20),
        hint: "?run=1 로 실행 (어드민 로그인 필요)",
      });
    } catch (err: any) {
      return jsonError("diagnostic", err);
    }
  }

  /* ─────────── 실행 모드 (requireAdmin) ─────────── */
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const done: string[] = [];
  try {
    /* ── 1. 신규 3테이블 + 인덱스 (멱등) ── */
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS martyrdom_deadlines (
        id           serial PRIMARY KEY,
        case_id      integer NOT NULL REFERENCES martyrdom_cases(id) ON DELETE CASCADE,
        label        varchar(200) NOT NULL,
        kind         varchar(30) DEFAULT 'custom',
        due_date     date NOT NULL,
        stage        varchar(40),
        status       varchar(20) NOT NULL DEFAULT 'pending',
        alerted_at   timestamp,
        note         text,
        created_by   integer REFERENCES members(id) ON DELETE SET NULL,
        created_at   timestamp NOT NULL DEFAULT NOW(),
        updated_at   timestamp NOT NULL DEFAULT NOW()
      )
    `));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS martyrdom_deadlines_case_idx ON martyrdom_deadlines (case_id)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS martyrdom_deadlines_due_idx ON martyrdom_deadlines (due_date)`));
    done.push("table:martyrdom_deadlines");

    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS martyrdom_criteria (
        id            serial PRIMARY KEY,
        code          varchar(50) NOT NULL UNIQUE,
        category      varchar(60) NOT NULL,
        title         varchar(200) NOT NULL,
        description   text,
        evidence_hint text,
        law_ref       varchar(300),
        weight        integer DEFAULT 1,
        sort_order    integer DEFAULT 0,
        active        boolean NOT NULL DEFAULT true,
        created_at    timestamp NOT NULL DEFAULT NOW(),
        updated_at    timestamp NOT NULL DEFAULT NOW()
      )
    `));
    done.push("table:martyrdom_criteria");

    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS martyrdom_actions (
        id                serial PRIMARY KEY,
        case_id           integer NOT NULL REFERENCES martyrdom_cases(id) ON DELETE CASCADE,
        item              varchar(300) NOT NULL,
        detail            text,
        status            varchar(20) NOT NULL DEFAULT 'todo',
        source            varchar(30) DEFAULT 'manual',
        due_date          date,
        workspace_task_id integer,
        sort_order        integer DEFAULT 0,
        created_by        integer REFERENCES members(id) ON DELETE SET NULL,
        created_at        timestamp NOT NULL DEFAULT NOW(),
        updated_at        timestamp NOT NULL DEFAULT NOW()
      )
    `));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS martyrdom_actions_case_idx ON martyrdom_actions (case_id)`));
    done.push("table:martyrdom_actions");

    /* ── 2. 기존 테이블 컬럼 추가 (멱등) ── */
    await db.execute(sql.raw(`ALTER TABLE martyrdom_case_documents ADD COLUMN IF NOT EXISTS evidence_strength varchar(10)`));
    await db.execute(sql.raw(`ALTER TABLE martyrdom_cases ADD COLUMN IF NOT EXISTS consent_note text`));
    await db.execute(sql.raw(`ALTER TABLE martyrdom_cases ADD COLUMN IF NOT EXISTS consent_obtained_at timestamp`));
    done.push("columns:evidence_strength,consent_note,consent_obtained_at");

    /* ── 3. 기본 요건 8종 시드 (멱등·code UNIQUE) ── */
    let seeded = 0;
    for (const c of CRITERIA_SEED) {
      const r: any = await db.execute(sql.raw(`
        INSERT INTO martyrdom_criteria (code, category, title, description, evidence_hint, law_ref, weight, sort_order, active, updated_at)
        VALUES (
          '${c.code}', '${c.category.replace(/'/g, "''")}', '${c.title.replace(/'/g, "''")}',
          '${c.description.replace(/'/g, "''")}', '${c.evidenceHint.replace(/'/g, "''")}',
          '${c.lawRef.replace(/'/g, "''")}', ${c.weight}, ${c.sortOrder}, true, NOW()
        )
        ON CONFLICT (code) DO NOTHING
        RETURNING id
      `));
      if ((r?.rows ?? r ?? []).length > 0) seeded++;
    }
    done.push(`criteria_seed:${seeded}/${CRITERIA_SEED.length}`);

    return new Response(JSON.stringify({
      ok: true, mode: "executed", done,
      storageAlertGb: Number(process.env.MARTYRDOM_STORAGE_ALERT_GB || 20),
      next: "schema.ts P2 정의 활성화 + 이 파일 삭제 (§9.2)",
    }, null, 2), { headers: { "Content-Type": "application/json" } });

  } catch (err: any) {
    return jsonError("execute", err);
  }
};
