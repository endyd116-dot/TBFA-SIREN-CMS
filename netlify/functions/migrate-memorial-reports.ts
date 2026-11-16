/**
 * GET /api/migrate-memorial-reports        — 진단 (인증 불필요·읽기만)
 * GET /api/migrate-memorial-reports?run=1  — 실행 (어드민 인증)
 *
 * ★ 2026-11-16 추모관 «함께 알려 주세요» 제보·신청 저장소 준비 (Swain 지시)
 *   memorial_reports 신설 — 선생님 사망 소식 제보 · 도움이 필요한 유가족 제보 · 유가족의 추모관 모시기 신청.
 *   공개 화면에는 나오지 않고 추모관 관리 «제보·신청» 탭에서만 본다. 처리 끝난 뒤 3년 보관(processed_at 기준).
 *
 * 실행 전에도 화면·어드민은 멀쩡하다(모든 코드가 표 유무를 확인하고 «준비 중»으로 넘어간다).
 * 실행 뒤부터 추모관 화면에 «함께 알려 주세요» 안내가 나타나고 접수가 된다(30초 안에 자동 감지·재배포 불필요).
 *
 * 멱등: IF NOT EXISTS. 호출 성공 후 즉시 파일 삭제 + commit (CLAUDE.md §6.8).
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-memorial-reports" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

function rowsOf(r: any): any[] {
  if (!r) return [];
  return Array.isArray(r) ? r : (r.rows ?? []);
}

async function diagnose() {
  const t = rowsOf(await db.execute(sql.raw(`
    SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'memorial_reports'
  `)));
  let rows = 0;
  if (t.length) {
    try { rows = Number(rowsOf(await db.execute(sql.raw(`SELECT COUNT(*)::int AS n FROM memorial_reports`)))[0]?.n || 0); } catch { /* noop */ }
  }
  const idx = t.length ? rowsOf(await db.execute(sql.raw(`
    SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'memorial_reports'
  `))).map((r: any) => r.indexname) : [];
  return { table: t.length > 0, rows, indexes: idx };
}

export default async function handler(req: Request, _ctx: Context) {
  let step = "start";
  try {
    const url = new URL(req.url);
    const run = url.searchParams.get("run") === "1";

    step = "diag";
    const before = await diagnose();

    if (!run) {
      return new Response(jsonKST({
        ok: true, mode: "diagnose",
        ready: before.table,
        current: before,
        hint: before.table
          ? "이미 준비됨. 재실행해도 안전(IF NOT EXISTS)."
          : "?run=1 로 실행하면 추모관 제보·신청 저장소(memorial_reports)가 준비됩니다.",
      }, null, 2), { headers: JSON_HEADER });
    }

    step = "auth";
    const auth = await requireAdmin(req);
    if (!auth.ok) return (auth as any).res;

    step = "table";
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS memorial_reports (
        id                 serial PRIMARY KEY,
        report_no          varchar(30)  NOT NULL UNIQUE,
        kind               varchar(20)  NOT NULL,
        status             varchar(20)  NOT NULL DEFAULT 'new',
        teacher_name       varchar(60),
        school_region      varchar(150),
        death_date_text    varchar(40),
        content            text,
        family_name        varchar(60),
        family_relation    varchar(40),
        family_phone       varchar(30),
        reporter_name      varchar(60)  NOT NULL,
        reporter_relation  varchar(40),
        reporter_phone     varchar(30)  NOT NULL,
        reporter_email     varchar(120),
        member_id          integer,
        consent_at         timestamp    NOT NULL,
        consent_version    varchar(60),
        ip_hash            varchar(64),
        admin_memo         text,
        linked_teacher_id  integer,
        linked_case_id     integer,
        handled_by         integer,
        processed_at       timestamp,
        created_at         timestamp    NOT NULL DEFAULT now(),
        updated_at         timestamp    NOT NULL DEFAULT now()
      )
    `));

    step = "indexes";
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS memorial_reports_status_idx ON memorial_reports (status, created_at)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS memorial_reports_anon_idx ON memorial_reports (ip_hash, created_at) WHERE member_id IS NULL`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS memorial_reports_processed_idx ON memorial_reports (processed_at) WHERE processed_at IS NOT NULL`));

    step = "verify";
    const after = await diagnose();

    return new Response(jsonKST({
      ok: true, mode: "run",
      before, after,
      next: "성공했으면 이 파일(netlify/functions/migrate-memorial-reports.ts)을 지우고 커밋합니다. 추모관 화면에 «함께 알려 주세요»가 30초 안에 나타납니다.",
    }, null, 2), { headers: JSON_HEADER });
  } catch (err: any) {
    return new Response(jsonKST({
      ok: false, error: "추모관 제보·신청 저장소 준비 실패", step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }, null, 2), { status: 500, headers: JSON_HEADER });
  }
}
