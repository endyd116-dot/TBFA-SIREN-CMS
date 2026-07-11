/**
 * /api/migrate-payroll-esign?run=1   — 1회용 마이그레이션 (호출 후 삭제)
 *
 * 급여명세 전자서명·증빙보관 고도화 기반 DB 구조.
 *
 *  1) payroll_slips 확장
 *     - 문서 고정: 발송 시점 PDF를 R2에 확정 저장하고 무결성 해시를 남긴다.
 *       (지금은 다운로드할 때마다 그 순간의 DB 값으로 PDF를 새로 만들기 때문에,
 *        나중에 요율·급여기준이 바뀌면 과거 명세서가 다르게 나온다 → 서명 증빙으로 못 씀)
 *     - 수령확인: 열람 시각 · 서명 상태 · 서명 시각 · 서명본 PDF
 *     - 독촉: 미서명자 리마인드 발송 이력
 *  2) payroll_acknowledgments — 열람·서명·이의 증적 (append-only, 지우지 않음)
 *  3) payroll_objections      — 이의제기 티켓 (접수 → 검토 → 해결/반려)
 *
 * GET (기본) : 진단 — 현재 적용 여부만 확인 (인증 불필요)
 * GET ?run=1 : 어드민 인증 후 실제 실행 (멱등 — 여러 번 호출해도 안전)
 */
import { db } from "../../db/index";
import { sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-payroll-esign" };

const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), { status, headers: JSON_HEADER });
}

/** 현재 DB에 적용돼 있는지 확인 (진단·검증 공용) */
async function inspect() {
  const cols: any = await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'payroll_slips'
      AND column_name IN (
        'document_version','document_r2_key','document_sha256','issued_at','first_viewed_at',
        'ack_status','ack_at','signed_document_r2_key','reminder_sent_at','reminder_count'
      )
  `);
  const colRows = ((cols as any).rows ?? cols ?? []) as any[];

  const tbls: any = await db.execute(sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_name IN ('payroll_acknowledgments','payroll_objections')
  `);
  const tblRows = ((tbls as any).rows ?? tbls ?? []) as any[];

  return {
    slipColumns: colRows.map((r: any) => r.column_name).sort(),
    slipColumnCount: colRows.length,   // 목표 10
    tables: tblRows.map((r: any) => r.table_name).sort(),
    tableCount: tblRows.length,        // 목표 2
    done: colRows.length === 10 && tblRows.length === 2,
  };
}

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  /* ── 진단 모드 (인증 불필요) ── */
  if (!run) {
    try {
      const state = await inspect();
      return json({
        ok: true,
        mode: "diagnose",
        message: state.done
          ? "이미 적용되어 있습니다 (재실행해도 안전)"
          : "미적용 — 어드민 로그인 후 ?run=1 로 호출하세요",
        state,
      });
    } catch (err: any) {
      return json({ ok: false, step: "diagnose", detail: String(err?.message ?? err).slice(0, 500) }, 500);
    }
  }

  /* ── 실행 모드 (어드민 인증) ── */
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const before = await inspect().catch(() => null);

  try {
    /* 1) payroll_slips 확장 — 문서 고정 · 수령확인 · 독촉 */
    await db.execute(sql`
      ALTER TABLE payroll_slips
        ADD COLUMN IF NOT EXISTS document_version        integer      NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS document_r2_key         text,
        ADD COLUMN IF NOT EXISTS document_sha256         varchar(64),
        ADD COLUMN IF NOT EXISTS issued_at               timestamp,
        ADD COLUMN IF NOT EXISTS first_viewed_at         timestamp,
        ADD COLUMN IF NOT EXISTS ack_status              varchar(20)  NOT NULL DEFAULT 'PENDING',
        ADD COLUMN IF NOT EXISTS ack_at                  timestamp,
        ADD COLUMN IF NOT EXISTS signed_document_r2_key  text,
        ADD COLUMN IF NOT EXISTS reminder_sent_at        timestamp,
        ADD COLUMN IF NOT EXISTS reminder_count          integer      NOT NULL DEFAULT 0
    `);
  } catch (err: any) {
    return json({ ok: false, step: "alter_payroll_slips", detail: String(err?.message ?? err).slice(0, 500) }, 500);
  }

  try {
    /* 2) 서명 증적 — 한 번 쌓이면 지우거나 고치지 않는다 (감사 추적) */
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS payroll_acknowledgments (
        id                     serial PRIMARY KEY,
        slip_id                integer     NOT NULL REFERENCES payroll_slips(id) ON DELETE CASCADE,
        member_uid             varchar(36) NOT NULL,
        document_version       integer     NOT NULL DEFAULT 1,
        action                 varchar(20) NOT NULL,          -- VIEWED | ACKNOWLEDGED | OBJECTED
        signature_type         varchar(10),                   -- DRAW(손글씨) | TYPE(성명입력)
        signature_r2_key       text,
        signed_name            varchar(80),
        consent_items          jsonb       NOT NULL DEFAULT '[]'::jsonb,
        objection_reason       text,
        document_r2_key        text,
        document_sha256        varchar(64),
        signed_document_r2_key text,
        ip                     varchar(45),
        user_agent             text,
        created_at             timestamp   NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_payroll_ack_slip   ON payroll_acknowledgments(slip_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_payroll_ack_member ON payroll_acknowledgments(member_uid)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_payroll_ack_action ON payroll_acknowledgments(action)`);
  } catch (err: any) {
    return json({ ok: false, step: "create_acknowledgments", detail: String(err?.message ?? err).slice(0, 500) }, 500);
  }

  try {
    /* 3) 이의제기 티켓 — 접수 → 검토중 → 해결/반려 */
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS payroll_objections (
        id              serial PRIMARY KEY,
        slip_id         integer     NOT NULL REFERENCES payroll_slips(id) ON DELETE CASCADE,
        member_uid      varchar(36) NOT NULL,
        reason          text        NOT NULL,
        status          varchar(20) NOT NULL DEFAULT 'OPEN',   -- OPEN | IN_REVIEW | RESOLVED | REJECTED
        resolution_note text,
        resolved_by     varchar(36),
        resolved_at     timestamp,
        created_at      timestamp   NOT NULL DEFAULT now(),
        updated_at      timestamp   NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_payroll_obj_slip   ON payroll_objections(slip_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_payroll_obj_status ON payroll_objections(status)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_payroll_obj_member ON payroll_objections(member_uid)`);
  } catch (err: any) {
    return json({ ok: false, step: "create_objections", detail: String(err?.message ?? err).slice(0, 500) }, 500);
  }

  try {
    /* 4) 기존 발송분 백필 — 이미 보낸 명세서의 '교부일'을 발송일로 채운다 */
    await db.execute(sql`
      UPDATE payroll_slips
         SET issued_at = sent_at
       WHERE issued_at IS NULL AND sent_at IS NOT NULL
    `);
  } catch (err: any) {
    return json({ ok: false, step: "backfill_issued_at", detail: String(err?.message ?? err).slice(0, 500) }, 500);
  }

  const after = await inspect().catch(() => null);

  return json({
    ok: true,
    mode: "run",
    message: "급여명세 전자서명·증빙보관 DB 구조 적용 완료",
    before,
    after,
  });
}
