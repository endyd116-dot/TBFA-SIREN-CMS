/**
 * GET /api/migrate-approval-system        — 진단 (인증 불필요·readonly)
 * GET /api/migrate-approval-system?run=1  — 실행 (super_admin 인증)
 *
 * 배치 2 — 지출 결재라인·전결(위임)·지출결의서.
 *
 * 만드는 것 (멱등):
 *   1) approval_lines          금액 구간별 결재 규칙 (steps=직책 순서 JSON)
 *   2) approval_requests       지출 결재 기안 (예산 목·금액·증빙·상태·결의번호·PDF)
 *   3) approval_request_steps  단계별 결재 이력 (직책·승인/반려·결재자)
 *   4) approval_delegations    위임(전결·대결) — 이사장 전용 설정
 *   5) 표준 결재라인 3구간 시드 (30만 미만=국장 / 30만~300만=국장→이사장 / 300만 이상=국장→이사장+이사회)
 *
 * 권한 3계층: operator(직원·알바·서포터즈)=기안 / admin(국장)=1차 / super_admin(이사장)=최종
 * 결재자=직책(role) 기반. 지출결의서=정식번호(제YYYY-NNNN호)+PDF R2 박제.
 *
 * 실행 성공 후: schema.ts 정의 활성화 + 결재 API·CMS + 이 파일 삭제.
 */
import type { Context } from "@netlify/functions";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-approval-system" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

async function rows(q: string): Promise<any[]> {
  const r: any = await db.execute(sql.raw(q));
  return r?.rows ?? r ?? [];
}

/* 표준 결재라인 3구간 (금액 원 단위) */
const LINES = [
  { name: "30만원 미만",     min: 0,       max: 299999,  steps: ["admin"],                board: false, sort: 0 },
  { name: "30만~300만원",    min: 300000,  max: 2999999, steps: ["admin", "super_admin"], board: false, sort: 1 },
  { name: "300만원 이상",    min: 3000000, max: null,    steps: ["admin", "super_admin"], board: true,  sort: 2 },
];

export default async function handler(req: Request, _ctx: Context) {
  let step = "start";
  try {
    const url = new URL(req.url);
    const run = url.searchParams.get("run") === "1";

    step = "diag";
    const exists = (t: string) => rows(`SELECT to_regclass('public.${t}') IS NOT NULL AS e`).then(r => r[0]?.e === true);
    const has = {
      approval_lines: await exists("approval_lines"),
      approval_requests: await exists("approval_requests"),
      approval_request_steps: await exists("approval_request_steps"),
      approval_delegations: await exists("approval_delegations"),
    };
    const seededLines = has.approval_lines ? ((await rows(`SELECT COUNT(*)::int AS n FROM approval_lines`))[0]?.n || 0) : 0;

    if (!run) {
      return new Response(JSON.stringify({
        ok: true, mode: "diagnose",
        tables: has, seededLines,
        plan: [
          "approval_lines / approval_requests / approval_request_steps / approval_delegations 생성",
          `표준 결재라인 ${LINES.length}구간 시드(30만·300만 경계)`,
        ],
        hint: "?run=1 로 실행 (super_admin 인증).",
      }, null, 2), { headers: JSON_HEADER });
    }

    step = "auth";
    const auth = await requireAdmin(req);
    if (guardFailed(auth)) return auth.res;

    step = "create_lines";
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS approval_lines (
        id             serial PRIMARY KEY,
        name           varchar(80) NOT NULL,
        min_amount     bigint  NOT NULL DEFAULT 0,
        max_amount     bigint,
        steps          jsonb   NOT NULL DEFAULT '[]'::jsonb,
        board_required boolean NOT NULL DEFAULT FALSE,
        is_active      boolean NOT NULL DEFAULT TRUE,
        sort_order     integer NOT NULL DEFAULT 0,
        created_at     timestamptz NOT NULL DEFAULT NOW(),
        updated_at     timestamptz NOT NULL DEFAULT NOW()
      );
    `));

    step = "create_requests";
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS approval_requests (
        id               serial PRIMARY KEY,
        request_no       varchar(30) UNIQUE,
        title            varchar(200) NOT NULL,
        amount           bigint NOT NULL,
        description      text,
        budget_account_id integer REFERENCES budget_accounts(id),
        fiscal_year      integer NOT NULL,
        occurred_at      date,
        payee_name       varchar(200),
        evidence_url     varchar(500),
        drafter_id       integer,
        drafter_name     varchar(100),
        approval_line_id integer,
        board_required   boolean NOT NULL DEFAULT FALSE,
        steps            jsonb   NOT NULL DEFAULT '[]'::jsonb,
        current_step     integer NOT NULL DEFAULT 0,
        status           varchar(20) NOT NULL DEFAULT 'pending',
        expense_id       integer,
        resolution_no    varchar(30),
        resolution_pdf_url varchar(500),
        resolution_issued_at timestamptz,
        created_at       timestamptz NOT NULL DEFAULT NOW(),
        updated_at       timestamptz NOT NULL DEFAULT NOW(),
        decided_at       timestamptz
      );
      CREATE INDEX IF NOT EXISTS approval_requests_status_idx ON approval_requests(status);
      CREATE INDEX IF NOT EXISTS approval_requests_fy_idx     ON approval_requests(fiscal_year);
      CREATE INDEX IF NOT EXISTS approval_requests_drafter_idx ON approval_requests(drafter_id);
    `));

    step = "create_steps";
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS approval_request_steps (
        id             serial PRIMARY KEY,
        request_id     integer NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
        step_index     integer NOT NULL,
        role           varchar(20) NOT NULL,
        decision       varchar(20) NOT NULL DEFAULT 'pending',
        decided_by     integer,
        decided_by_name varchar(100),
        comment        text,
        decided_at     timestamptz,
        UNIQUE (request_id, step_index)
      );
      CREATE INDEX IF NOT EXISTS approval_steps_request_idx ON approval_request_steps(request_id);
    `));

    step = "create_delegations";
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS approval_delegations (
        id             serial PRIMARY KEY,
        delegate_role  varchar(20) NOT NULL,
        to_member_id   integer NOT NULL,
        to_member_name varchar(100),
        start_at       date NOT NULL,
        end_at         date NOT NULL,
        reason         text,
        is_active      boolean NOT NULL DEFAULT TRUE,
        created_by     integer,
        created_at     timestamptz NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS approval_delegations_role_idx ON approval_delegations(delegate_role);
      CREATE INDEX IF NOT EXISTS approval_delegations_active_idx ON approval_delegations(is_active);
    `));

    step = "seed_lines";
    const existing = (await rows(`SELECT COUNT(*)::int AS n FROM approval_lines`))[0]?.n || 0;
    if (existing === 0) {
      for (const l of LINES) {
        const maxv = l.max == null ? "NULL" : String(l.max);
        await db.execute(sql.raw(`
          INSERT INTO approval_lines (name, min_amount, max_amount, steps, board_required, sort_order)
          VALUES ('${l.name}', ${l.min}, ${maxv}, '${JSON.stringify(l.steps)}'::jsonb, ${l.board}, ${l.sort});
        `));
      }
    }

    step = "done";
    const lineCount = (await rows(`SELECT COUNT(*)::int AS n FROM approval_lines`))[0]?.n || 0;
    return new Response(JSON.stringify({
      ok: true, mode: "executed",
      seededLines: lineCount,
      hint: "완료. 메인 채팅에 알려주세요 → schema 활성화 + 결재 API·CMS 개발 계속. 확인 후 이 파일 삭제.",
    }, null, 2), { headers: JSON_HEADER });
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false, error: "결재 시스템 마이그 실패", step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: JSON_HEADER });
  }
}
