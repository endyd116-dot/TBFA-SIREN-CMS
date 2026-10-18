/**
 * GET /api/migrate-customer-journey        — 진단 (인증 불필요·readonly)
 * GET /api/migrate-customer-journey?run=1  — 실행 (어드민 인증)
 *
 * 고객 여정 패널(2026-10-18) 저장 표 2개 생성
 *   1) customer_notes      — 관리자 메모(회원 또는 잠재 후원자에 매달림·작성자·시각·고정)
 *   2) donor_stage_events  — 후원자 단계(잠재/예비·일시/예비·해지/정기) 변화 이력 + 수동 지정 우선권
 *        source manual|auto|system · auto_baseline(수동 지정 당시 자동 판정·바뀌면 수동 해제) · is_override/released_at
 * 멱등: CREATE TABLE/INDEX IF NOT EXISTS. 호출 성공 후 즉시 파일 삭제 + commit (CLAUDE.md §6.8).
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-customer-journey" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };
const rowsOf = (r: any): any[] => (r?.rows ?? r ?? []) as any[];

async function tableExists(name: string): Promise<boolean> {
  return rowsOf(await db.execute(sql`SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ${name}`)).length > 0;
}

export default async function handler(req: Request, _ctx: Context) {
  let step = "start";
  try {
    const url = new URL(req.url);
    const run = url.searchParams.get("run") === "1";

    step = "diag";
    const notesExists = await tableExists("customer_notes");
    const eventsExists = await tableExists("donor_stage_events");

    if (!run) {
      return new Response(jsonKST({
        ok: true, mode: "diagnose", customer_notes: notesExists, donor_stage_events: eventsExists,
        hint: notesExists && eventsExists ? "이미 생성됨. 재실행해도 안전(IF NOT EXISTS)." : "?run=1 로 실행하면 없는 표만 생성됩니다.",
      }, null, 2), { headers: JSON_HEADER });
    }

    step = "auth";
    const auth = await requireAdmin(req);
    if (!auth.ok) return (auth as { ok: false; res: Response }).res;

    step = "customer_notes";
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS customer_notes (
        id SERIAL PRIMARY KEY,
        member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
        potential_donor_id INTEGER REFERENCES potential_donors(id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        pinned BOOLEAN NOT NULL DEFAULT FALSE,
        created_by INTEGER REFERENCES members(id) ON DELETE SET NULL,
        created_by_name VARCHAR(50),
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS customer_notes_member_idx ON customer_notes (member_id)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS customer_notes_potential_idx ON customer_notes (potential_donor_id)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS customer_notes_created_idx ON customer_notes (created_at)`));

    step = "donor_stage_events";
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS donor_stage_events (
        id SERIAL PRIMARY KEY,
        member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
        potential_donor_id INTEGER REFERENCES potential_donors(id) ON DELETE SET NULL,
        from_stage VARCHAR(30),
        to_stage VARCHAR(30) NOT NULL,
        source VARCHAR(20) NOT NULL DEFAULT 'auto',
        reason TEXT,
        auto_baseline VARCHAR(30),
        is_override BOOLEAN NOT NULL DEFAULT FALSE,
        released_at TIMESTAMP,
        release_reason VARCHAR(100),
        changed_by INTEGER REFERENCES members(id) ON DELETE SET NULL,
        changed_by_name VARCHAR(50),
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS donor_stage_events_member_idx ON donor_stage_events (member_id, id DESC)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS donor_stage_events_override_idx ON donor_stage_events (member_id) WHERE is_override = TRUE AND released_at IS NULL`));

    step = "verify";
    const cols = rowsOf(await db.execute(sql`
      SELECT table_name, COUNT(*)::int AS n FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name IN ('customer_notes', 'donor_stage_events') GROUP BY table_name ORDER BY table_name`));

    return new Response(jsonKST({
      ok: true, mode: "executed", created: { customer_notes: !notesExists, donor_stage_events: !eventsExists },
      columns: cols.map((c) => `${c.table_name}: ${c.n}개 컬럼`),
      hint: "고객 여정 패널의 메모 저장·단계 이동(이력)이 켜집니다. 성공 확인 후 이 파일 삭제 + commit.",
    }, null, 2), { headers: JSON_HEADER });
  } catch (err: any) {
    return new Response(jsonKST({
      ok: false, error: "마이그 실패", step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: JSON_HEADER });
  }
}
