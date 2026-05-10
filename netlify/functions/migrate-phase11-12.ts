// migrate-phase11-12.ts — Phase 11(멘션·구독) + Phase 12(신고 단계이력·익명감사) 신규 테이블 생성
// GET ?run=1 : 어드민 인증 후 실행
// GET (기본) : 진단 모드 (인증 불필요)
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-phase11-12" };

export default async (req: Request) => {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  if (!run) {
    return new Response(JSON.stringify({
      ok: true,
      mode: "diagnostic",
      tables: ["post_subscriptions", "mentions", "report_status_logs", "anonymous_reveal_logs"],
      message: "?run=1 을 붙여서 어드민으로 호출하면 테이블을 생성합니다.",
    }), { headers: { "Content-Type": "application/json" } });
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  const steps: string[] = [];
  try {
    // === Phase 11: 게시글 구독 ===
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS post_subscriptions (
        id            serial PRIMARY KEY,
        member_id     integer NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        post_id       integer REFERENCES board_posts(id) ON DELETE CASCADE,
        board_category varchar(30),
        created_at    timestamp NOT NULL DEFAULT now()
      );
    `);
    steps.push("post_subscriptions 생성 완료");

    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS post_sub_member_post_idx
        ON post_subscriptions(member_id, post_id)
        WHERE post_id IS NOT NULL;
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS post_sub_member_board_idx
        ON post_subscriptions(member_id, board_category);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS post_sub_post_idx
        ON post_subscriptions(post_id);
    `);
    steps.push("post_subscriptions 인덱스 완료");

    // === Phase 11: 멘션 ===
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS mentions (
        id            serial PRIMARY KEY,
        mentioned_id  integer NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        mentioner_id  integer REFERENCES members(id) ON DELETE SET NULL,
        source_type   varchar(20) NOT NULL,
        source_id     integer NOT NULL,
        is_read       boolean NOT NULL DEFAULT false,
        read_at       timestamp,
        created_at    timestamp NOT NULL DEFAULT now()
      );
    `);
    steps.push("mentions 생성 완료");

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS mentions_mentioned_idx ON mentions(mentioned_id);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS mentions_source_idx ON mentions(source_type, source_id);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS mentions_unread_idx ON mentions(mentioned_id, is_read);
    `);
    steps.push("mentions 인덱스 완료");

    // === Phase 12: 신고 단계 변경 이력 ===
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS report_status_logs (
        id           serial PRIMARY KEY,
        report_type  varchar(20) NOT NULL,
        report_id    integer NOT NULL,
        from_status  varchar(30),
        to_status    varchar(30) NOT NULL,
        changed_by   integer REFERENCES members(id) ON DELETE SET NULL,
        note         text,
        notified_at  timestamp,
        created_at   timestamp NOT NULL DEFAULT now()
      );
    `);
    steps.push("report_status_logs 생성 완료");

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS rsl_report_idx ON report_status_logs(report_type, report_id);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS rsl_time_idx ON report_status_logs(created_at);
    `);
    steps.push("report_status_logs 인덱스 완료");

    // === Phase 12: 익명 식별 감사 로그 ===
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS anonymous_reveal_logs (
        id            serial PRIMARY KEY,
        report_type   varchar(20) NOT NULL,
        report_id     integer NOT NULL,
        reveal_level  integer NOT NULL,
        revealed_by   integer NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
        reason        text,
        ip_address    varchar(45),
        created_at    timestamp NOT NULL DEFAULT now()
      );
    `);
    steps.push("anonymous_reveal_logs 생성 완료");

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS arl_report_idx ON anonymous_reveal_logs(report_type, report_id);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS arl_admin_idx ON anonymous_reveal_logs(revealed_by);
    `);
    steps.push("anonymous_reveal_logs 인덱스 완료");

    return new Response(JSON.stringify({ ok: true, steps }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false,
      error: "마이그레이션 실패",
      steps,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};
