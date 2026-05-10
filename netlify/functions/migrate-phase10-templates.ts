// netlify/functions/migrate-phase10-templates.ts
// Phase 10 R1 — communication_templates 테이블 생성 + 시드 3건 (1회용)
//
// 실행: 어드민 로그인 후 주소창에
//   https://tbfa-siren-cms.netlify.app/api/migrate-phase10-templates?run=1
// 진단: ?run=1 없이 접속 (인증 불필요) — 테이블 존재 여부 확인
// 멱등: IF NOT EXISTS + ON CONFLICT DO NOTHING 로 재실행 부작용 없음
// 완료 후: 파일 삭제 + schema.ts 정의 주석 해제 + 커밋·푸시

import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-phase10-templates" };

export default async function handler(req: Request, _ctx: Context) {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  /* ── 진단 모드 ── */
  if (!run) {
    try {
      const res: any = await db.execute(sql`
        SELECT
          EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_name = 'communication_templates'
          ) AS table_exists,
          (SELECT COUNT(*)::int FROM information_schema.tables
           WHERE table_name = 'communication_templates') AS table_count
      `);
      const row = (res?.rows ?? res)[0] ?? {};
      return new Response(
        JSON.stringify({ ok: true, mode: "diagnostic", state: row }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    } catch (err: any) {
      return new Response(
        JSON.stringify({ ok: false, error: String(err?.message || err) }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  }

  /* ── 실행 모드 — 어드민 인증 ── */
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  try {
    /* 1. 테이블 생성 */
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS communication_templates (
        id              BIGSERIAL PRIMARY KEY,
        name            VARCHAR(100) NOT NULL,
        channel         TEXT NOT NULL,
        category        TEXT NOT NULL,
        subject         TEXT,
        body_template   TEXT NOT NULL,
        variables       JSONB NOT NULL DEFAULT '[]'::jsonb,
        is_active       BOOLEAN NOT NULL DEFAULT true,
        created_by      INTEGER REFERENCES members(id) ON DELETE SET NULL,
        updated_by      INTEGER REFERENCES members(id) ON DELETE SET NULL,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    /* 2. 인덱스 */
    await db.execute(sql`CREATE INDEX IF NOT EXISTS comm_templates_channel_idx  ON communication_templates(channel)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS comm_templates_category_idx ON communication_templates(category)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS comm_templates_active_idx   ON communication_templates(is_active)`);

    /* 3. 시드 3건 */
    await db.execute(sql`
      INSERT INTO communication_templates (name, channel, category, subject, body_template, variables, created_by)
      VALUES
        (
          '월간 뉴스레터 기본', 'email', 'newsletter',
          '[교사유가족협의회] {{member_name}}님께 보내는 {{month}}월 소식',
          E'{{member_name}}님, 안녕하세요.\n교사유가족협의회입니다.\n\n{{month}}월 한 달간 협회는 다음과 같이 활동했습니다.\n\n{{summary}}\n\n앞으로도 따뜻한 관심 부탁드립니다.',
          '[{"key":"member_name","label":"회원이름","sample":"홍길동"},{"key":"month","label":"월","sample":"5"},{"key":"summary","label":"이달의 요약","sample":"신규 후원자 12명, 유족 지원 8건"}]'::jsonb,
          NULL
        ),
        (
          '일회성 공지 기본', 'email', 'announcement',
          '[교사유가족협의회] {{title}}',
          E'{{member_name}}님, 안녕하세요.\n\n{{body}}\n\n자세한 내용은 협회 홈페이지를 참고해 주세요.',
          '[{"key":"member_name","label":"회원이름","sample":"홍길동"},{"key":"title","label":"제목","sample":"정기 총회 안내"},{"key":"body","label":"본문","sample":"6월 15일 정기 총회를 개최합니다."}]'::jsonb,
          NULL
        ),
        (
          'AI 트리거 — 이탈 위험 재참여', 'inapp', 'auto_trigger',
          '{{member_name}}님, 오랜만이에요',
          E'{{member_name}}님, 그동안 많이 바쁘셨죠?\n협회는 변함없이 {{member_name}}님을 기다리고 있어요.\n잠시 시간이 나실 때 협회 소식을 한번 살펴봐 주시면 감사하겠습니다.',
          '[{"key":"member_name","label":"회원이름","sample":"홍길동"}]'::jsonb,
          NULL
        )
      ON CONFLICT DO NOTHING
    `);

    /* 4. 결과 확인 */
    const countRes: any = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM communication_templates
    `);
    const total = ((countRes?.rows ?? countRes)[0] ?? {}).n ?? 0;

    return new Response(
      JSON.stringify({ ok: true, message: "communication_templates 생성 및 시드 완료", total }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "마이그레이션 실패",
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
