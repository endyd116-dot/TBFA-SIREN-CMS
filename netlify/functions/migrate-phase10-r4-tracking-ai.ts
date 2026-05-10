// netlify/functions/migrate-phase10-r4-tracking-ai.ts
// Phase 10 R4 — 추적·자동 트리거·분석 마이그레이션
//
// 생성 테이블 3종:
//   communication_send_tracking      — 오픈/클릭 이벤트 로그
//   communication_auto_triggers      — 자동 발송 트리거 규칙
//   communication_auto_trigger_runs  — 트리거 실행 이력
//
// 기존 테이블 컬럼 추가 5종:
//   communication_send_recipients.tracking_token  (VARCHAR 32, UNIQUE)
//   communication_send_recipients.opened_at       (TIMESTAMP)
//   communication_send_recipients.clicked_at      (TIMESTAMP)
//   communication_send_recipients.click_count     (INTEGER DEFAULT 0)
//   communication_send_recipients.open_count      (INTEGER DEFAULT 0)
//
// 시드: auto_triggers 5건
//
// 멱등 보장: IF NOT EXISTS / 중복 시드 INSERT ON CONFLICT DO NOTHING
// 어드민 로그인 후 GET ?run=1 호출
// 호출 성공 후 이 파일 삭제 + 커밋

import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-phase10-r4-tracking-ai" };

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const run = url.searchParams.get("run");

  /* 진단 모드 — 인증 없이 현재 상태 확인 */
  if (run !== "1") {
    try {
      const tables: any = await db.execute(sql`
        SELECT table_name
          FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name IN (
             'communication_send_tracking',
             'communication_auto_triggers',
             'communication_auto_trigger_runs'
           )
         ORDER BY table_name
      `);
      const tableList = (tables?.rows ?? tables ?? []).map((r: any) => r.table_name);

      const cols: any = await db.execute(sql`
        SELECT column_name
          FROM information_schema.columns
         WHERE table_name = 'communication_send_recipients'
           AND column_name IN ('tracking_token','opened_at','clicked_at','click_count','open_count')
         ORDER BY column_name
      `);
      const colList = (cols?.rows ?? cols ?? []).map((r: any) => r.column_name);

      return new Response(
        JSON.stringify({
          ok: true,
          mode: "diagnostic",
          tables_created: tableList,
          columns_added: colList,
          tables_missing: [
            "communication_send_tracking",
            "communication_auto_triggers",
            "communication_auto_trigger_runs",
          ].filter((t) => !tableList.includes(t)),
          columns_missing: [
            "tracking_token","opened_at","clicked_at","click_count","open_count",
          ].filter((c) => !colList.includes(c)),
          run_hint: "?run=1 을 붙이고 어드민 로그인 상태로 다시 호출하면 실행됩니다",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    } catch (err: any) {
      return new Response(
        JSON.stringify({ ok: false, error: "진단 실패", detail: String(err?.message || err) }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  }

  /* 실행 모드 — 어드민 인증 필수 */
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  const results: string[] = [];

  try {
    /* ── 1. communication_send_recipients 컬럼 추가 ── */
    await db.execute(sql`
      ALTER TABLE communication_send_recipients
        ADD COLUMN IF NOT EXISTS tracking_token VARCHAR(48) UNIQUE,
        ADD COLUMN IF NOT EXISTS opened_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS clicked_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS open_count INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS click_count INTEGER NOT NULL DEFAULT 0
    `);
    results.push("send_recipients 컬럼 5개 추가 완료");

    /* ── 2. 추적 인덱스 ── */
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS send_recipients_token_idx
        ON communication_send_recipients(tracking_token)
    `);
    results.push("tracking_token 인덱스 생성 완료");

    /* ── 3. communication_send_tracking 테이블 ── */
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS communication_send_tracking (
        id           BIGSERIAL PRIMARY KEY,
        recipient_id BIGINT NOT NULL REFERENCES communication_send_recipients(id) ON DELETE CASCADE,
        job_id       BIGINT NOT NULL REFERENCES communication_send_jobs(id) ON DELETE CASCADE,
        event_type   TEXT NOT NULL,         -- 'open' | 'click'
        clicked_url  TEXT,                  -- click 이벤트일 때 원본 URL
        ip           VARCHAR(45),
        user_agent   TEXT,
        tracked_at   TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS send_tracking_recipient_idx ON communication_send_tracking(recipient_id)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS send_tracking_job_idx ON communication_send_tracking(job_id)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS send_tracking_event_idx ON communication_send_tracking(event_type)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS send_tracking_time_idx ON communication_send_tracking(tracked_at)
    `);
    results.push("communication_send_tracking 테이블 + 인덱스 생성 완료");

    /* ── 4. communication_auto_triggers 테이블 ── */
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS communication_auto_triggers (
        id              BIGSERIAL PRIMARY KEY,
        name            VARCHAR(200) NOT NULL,
        description     TEXT,
        trigger_type    TEXT NOT NULL,       -- 'new_member' | 'donation_complete' | 'support_approved' | 'birthday' | 'anniversary'
        template_id     INTEGER NOT NULL REFERENCES communication_templates(id) ON DELETE RESTRICT,
        recipient_group_id INTEGER,          -- NULL이면 트리거 조건으로 자동 추출
        channel         TEXT NOT NULL,
        delay_hours     INTEGER NOT NULL DEFAULT 0,  -- 트리거 발생 후 N시간 뒤 발송
        is_active       BOOLEAN NOT NULL DEFAULT true,
        cooldown_days   INTEGER NOT NULL DEFAULT 30,  -- 동일 회원 재발송 최소 간격 (일)
        conditions      JSONB,               -- 추가 조건 (등급·금액 범위 등)
        created_by      INTEGER REFERENCES members(id) ON DELETE SET NULL,
        updated_by      INTEGER REFERENCES members(id) ON DELETE SET NULL,
        deleted_at      TIMESTAMP,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS auto_triggers_type_idx ON communication_auto_triggers(trigger_type)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS auto_triggers_active_idx ON communication_auto_triggers(is_active)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS auto_triggers_deleted_idx ON communication_auto_triggers(deleted_at)
    `);
    results.push("communication_auto_triggers 테이블 + 인덱스 생성 완료");

    /* ── 5. communication_auto_trigger_runs 테이블 ── */
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS communication_auto_trigger_runs (
        id             BIGSERIAL PRIMARY KEY,
        trigger_id     BIGINT NOT NULL REFERENCES communication_auto_triggers(id) ON DELETE CASCADE,
        job_id         BIGINT,              -- 생성된 send_job (NULL이면 대상 0명)
        triggered_at   TIMESTAMP NOT NULL DEFAULT NOW(),
        member_count   INTEGER NOT NULL DEFAULT 0,
        status         TEXT NOT NULL DEFAULT 'ok',   -- 'ok' | 'skipped' | 'error'
        error          TEXT,
        meta           JSONB                -- 디버깅용 (조건 캡처 등)
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS auto_trigger_runs_trigger_idx ON communication_auto_trigger_runs(trigger_id)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS auto_trigger_runs_time_idx ON communication_auto_trigger_runs(triggered_at)
    `);
    results.push("communication_auto_trigger_runs 테이블 + 인덱스 생성 완료");

    /* ── 6. 시드 — auto_triggers 5건 (ON CONFLICT DO NOTHING) ── */
    // 시드가 없으면 템플릿·그룹이 없어서 FK 위반 가능 → name UNIQUE 없으므로 중복 방지는 실행 횟수 1회 원칙으로
    // 이미 테이블에 행이 있으면 스킵
    const existsRes: any = await db.execute(sql`SELECT COUNT(*)::int AS n FROM communication_auto_triggers`);
    const existsCount = ((existsRes?.rows ?? existsRes)[0] ?? {}).n ?? 0;

    if (existsCount === 0) {
      // 템플릿·그룹이 없을 수 있으므로 FK 없는 예시 시드 — template_id=1, group=NULL
      // 실제 운영에서는 운영자가 직접 생성하므로 시드는 참고용
      try {
        const tplExists: any = await db.execute(sql`SELECT id FROM communication_templates LIMIT 1`);
        const tplRow = (tplExists?.rows ?? tplExists ?? [])[0];
        if (tplRow) {
          const tplId = tplRow.id;
          await db.execute(sql`
            INSERT INTO communication_auto_triggers
              (name, description, trigger_type, template_id, channel, delay_hours, cooldown_days)
            VALUES
              ('신규 가입 환영 메시지', '회원 가입 완료 후 즉시 발송', 'new_member', ${tplId}, 'email', 0, 365),
              ('후원 완료 감사 메시지', '후원 결제 완료 직후 발송', 'donation_complete', ${tplId}, 'email', 0, 30),
              ('지원 승인 안내', '유가족 지원 신청 승인 시 발송', 'support_approved', ${tplId}, 'email', 0, 90),
              ('생일 축하 메시지', '회원 생일 당일 오전 발송', 'birthday', ${tplId}, 'email', 0, 365),
              ('후원 1주년 감사', '후원 시작 기념일 발송', 'anniversary', ${tplId}, 'email', 0, 365)
          `);
          results.push("시드 5건 INSERT 완료");
        } else {
          results.push("시드 스킵 — 활성 템플릿 없음 (운영자가 직접 생성 필요)");
        }
      } catch (seedErr: any) {
        results.push(`시드 스킵 — ${String(seedErr?.message || seedErr).slice(0, 200)}`);
      }
    } else {
      results.push(`시드 스킵 — 이미 ${existsCount}건 존재`);
    }

    return new Response(
      JSON.stringify({ ok: true, results }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "마이그레이션 실패",
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
        results,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
