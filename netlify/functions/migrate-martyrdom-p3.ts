/**
 * migrate-martyrdom-p3 — P3 서면 생성·전문가 검토 테이블 (§P3.1·1회용)
 *
 * 신규 테이블 2개:
 *   martyrdom_draft_sections — 유족급여신청서 초안 섹션 (목차 확인 후 섹션별 생성·편집)
 *   martyrdom_reviews        — 전문가 검토 배정·결정 (협회 내부)
 *
 * outputType 'draft'는 값 추가일 뿐(varchar) — DDL 변경 없음.
 *
 * 호출 표준 (§6.8):
 *   GET           : 진단 모드 (인증 불필요·현재 존재 여부만)
 *   GET ?run=1    : requireAdmin 후 실제 실행 (멱등·IF NOT EXISTS)
 *
 * 호출 성공 후 즉시 파일 삭제 + schema 정의 활성화(메인).
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-martyrdom-p3" };

function json(status: number, data: object) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/* 테이블 존재 여부 진단 */
async function diagnose() {
  const r: any = await db.execute(sql.raw(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('martyrdom_draft_sections', 'martyrdom_reviews')
    ORDER BY table_name
  `));
  const existing = (r?.rows ?? r ?? []).map((x: any) => String(x.table_name));
  return {
    martyrdom_draft_sections: existing.includes("martyrdom_draft_sections"),
    martyrdom_reviews: existing.includes("martyrdom_reviews"),
  };
}

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  /* ── 진단 모드 (인증 불필요) ── */
  if (!run) {
    try {
      const exists = await diagnose();
      return json(200, {
        ok: true,
        mode: "diagnose",
        message: "P3 서면 마이그레이션 진단 — 실제 실행은 ?run=1 (어드민 로그인 필요)",
        exists,
      });
    } catch (err: any) {
      return json(500, { ok: false, step: "diagnose", detail: String(err?.message || err).slice(0, 500) });
    }
  }

  /* ── 실행 모드 (requireAdmin) ── */
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  try {
    /* (1) martyrdom_draft_sections — 유족급여신청서 초안 섹션 */
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS martyrdom_draft_sections (
        id            SERIAL PRIMARY KEY,
        case_id       INTEGER NOT NULL REFERENCES martyrdom_cases(id) ON DELETE CASCADE,
        output_id     INTEGER REFERENCES martyrdom_ai_outputs(id) ON DELETE CASCADE,
        section_key   VARCHAR(40) NOT NULL,
        title         VARCHAR(200) NOT NULL,
        section_order INTEGER NOT NULL DEFAULT 0,
        intent        TEXT,
        content       TEXT,
        rag_sources   JSONB,
        status        VARCHAR(20) NOT NULL DEFAULT 'pending',
        word_count    INTEGER DEFAULT 0,
        created_at    TIMESTAMP DEFAULT NOW(),
        updated_at    TIMESTAMP DEFAULT NOW()
      )
    `));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS martyrdom_draft_sections_case_idx   ON martyrdom_draft_sections(case_id)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS martyrdom_draft_sections_output_idx ON martyrdom_draft_sections(output_id)`));

    /* (2) martyrdom_reviews — 전문가 검토 배정·결정 */
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS martyrdom_reviews (
        id          SERIAL PRIMARY KEY,
        case_id     INTEGER NOT NULL REFERENCES martyrdom_cases(id) ON DELETE CASCADE,
        output_id   INTEGER NOT NULL REFERENCES martyrdom_ai_outputs(id) ON DELETE CASCADE,
        assigned_to INTEGER NOT NULL REFERENCES members(id),
        assigned_by INTEGER REFERENCES members(id),
        status      VARCHAR(20) NOT NULL DEFAULT 'pending',
        note        TEXT,
        created_at  TIMESTAMP DEFAULT NOW(),
        decided_at  TIMESTAMP
      )
    `));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS martyrdom_reviews_case_idx     ON martyrdom_reviews(case_id)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS martyrdom_reviews_output_idx   ON martyrdom_reviews(output_id)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS martyrdom_reviews_assigned_idx ON martyrdom_reviews(assigned_to)`));

    const exists = await diagnose();
    return json(200, {
      ok: true,
      mode: "run",
      message: "P3 서면 테이블 2개 생성 완료 (멱등). outputType 'draft'는 값 추가일 뿐 DDL 불필요.",
      exists,
    });
  } catch (err: any) {
    return json(500, {
      ok: false,
      step: "create",
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    });
  }
};
