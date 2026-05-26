/**
 * migrate-martyrdom-p4 — P4 발간 DB 마이그레이션 (1회용)
 *
 * GET ?run=1  : requireAdmin 인증 후 실행
 * GET         : 진단 (인증 불필요 — 현황만 반환)
 *
 * 생성: martyrdom_publications + 인덱스 + ai_tool_permissions 시드 3개
 * ★ 호출 성공 후 즉시 파일 삭제 + 커밋 (1회용 보안 원칙)
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-martyrdom-p4" };

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "GET") return json({ ok: false, error: "GET만 허용" }, 405);

  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  /* 진단 모드 */
  if (!run) {
    try {
      const r: any = await db.execute(sql.raw(
        `SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='martyrdom_publications') AS pub_exists`
      ));
      const row = (r?.rows ?? r ?? [])[0];
      return json({ ok: true, diag: true, pub_exists: row?.pub_exists ?? false });
    } catch (e: any) {
      return json({ ok: false, diag: true, error: String(e?.message).slice(0, 300) }, 500);
    }
  }

  /* 실행 모드 — requireAdmin */
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const steps: string[] = [];
  try {
    /* 1. martyrdom_publications 테이블 */
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS martyrdom_publications (
        id            SERIAL PRIMARY KEY,
        pub_type      VARCHAR(20)  NOT NULL,
        title         VARCHAR(200) NOT NULL,
        content_html  TEXT,
        content_json  JSONB,
        blend_ratio   JSONB,
        source_case_ids JSONB,
        anonymized    BOOLEAN NOT NULL DEFAULT TRUE,
        reid_risk     VARCHAR(10) DEFAULT 'low',
        rag_sources   JSONB,
        status        VARCHAR(12)  NOT NULL DEFAULT 'draft',
        created_by    INTEGER REFERENCES members(id),
        reviewed_by   INTEGER REFERENCES members(id),
        published_by  INTEGER REFERENCES members(id),
        created_at    TIMESTAMP DEFAULT NOW(),
        published_at  TIMESTAMP
      )
    `));
    steps.push("martyrdom_publications 테이블 생성(또는 이미 존재)");

    /* 2. 인덱스 */
    await db.execute(sql.raw(`
      CREATE INDEX IF NOT EXISTS martyrdom_pub_type_idx
        ON martyrdom_publications (pub_type)
    `));
    await db.execute(sql.raw(`
      CREATE INDEX IF NOT EXISTS martyrdom_pub_status_idx
        ON martyrdom_publications (status)
    `));
    steps.push("인덱스 생성(pub_type·status)");

    /* 3. ai_tool_permissions 시드 — 순직 읽기 도구 3개 */
    const tools = [
      {
        name: "martyrdom_case_list",
        desc: "진행 중 순직 사건 목록 조회 (상태·준비도·기한)",
      },
      {
        name: "martyrdom_case_status",
        desc: "순직 사건 종합 상태 조회 (준비도·인정요건·부족 증거·기한)",
      },
      {
        name: "martyrdom_deadlines_upcoming",
        desc: "임박 기한 순직 사건 목록 조회 (D-day)",
      },
    ];

    for (const t of tools) {
      await db.execute(sql.raw(`
        INSERT INTO ai_tool_permissions (tool_name, enabled, required_role, description, is_mutation, category, updated_at)
        VALUES ('${t.name}', true, 'operator', '${t.desc}', false, 'martyrdom', NOW())
        ON CONFLICT (tool_name) DO NOTHING
      `));
    }
    steps.push("ai_tool_permissions 시드 3개 (martyrdom_case_list·martyrdom_case_status·martyrdom_deadlines_upcoming)");

    return json({ ok: true, steps });
  } catch (e: any) {
    return json({
      ok: false,
      error: "마이그레이션 실패",
      steps,
      detail: String(e?.message || e).slice(0, 500),
      stack: String(e?.stack || "").slice(0, 1000),
    }, 500);
  }
};
