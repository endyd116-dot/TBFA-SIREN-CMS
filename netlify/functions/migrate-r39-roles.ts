/**
 * R39 Stage 1 — 역할 카탈로그 (milestone_roles) 신설 + 시드
 *
 * GET            : 진단 (인증 불필요·테이블 존재·시드 건수 확인)
 * GET ?run=1     : 어드민 인증 후 실행 (CREATE TABLE IF NOT EXISTS + 시드 INSERT 멱등)
 *
 * 시드: SM(사무국장·1)·PM(정책국장·2)·SI(SI관리자·3) — 기존 하드코딩된 3종 호환
 */
import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-r39-roles" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

const SEED_ROLES: Array<[string, string, string, number]> = [
  /* [code, name, description, sort_order] */
  ["SM", "사무국장", "기존 SM 역할 — 사무국 총괄",   1],
  ["PM", "정책국장", "기존 PM 역할 — 정책 총괄",     2],
  ["SI", "SI관리자", "기존 SI 역할 — SI(시스템 통합) 관리", 3],
];

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);

  /* ── 진단 모드 (인증 불필요) ── */
  if (req.method === "GET" && !url.searchParams.get("run")) {
    let tableExists = false;
    let rowCount = 0;
    try {
      const r1 = await db.execute(sql`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'milestone_roles'
        ) AS exists
      `);
      tableExists = Boolean(((r1 as any).rows?.[0] ?? (r1 as any)[0])?.exists);
    } catch { /* ignore */ }
    if (tableExists) {
      try {
        const r2 = await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM milestone_roles`);
        rowCount = Number(((r2 as any).rows?.[0] ?? (r2 as any)[0])?.cnt ?? 0);
      } catch { /* ignore */ }
    }
    return new Response(JSON.stringify({
      ok: true,
      mode: "diagnostic",
      table: "milestone_roles",
      tableExists,
      rowCount,
      seedCount: SEED_ROLES.length,
      seedCodes: SEED_ROLES.map(s => s[0]),
      runUrl: "/api/migrate-r39-roles?run=1",
    }, null, 2), { status: 200, headers: JSON_HEADER });
  }

  /* ── 실행 모드 (어드민 인증 필수) ── */
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  const steps: Array<{ step: string; result: string }> = [];

  /* Step 1: CREATE TABLE IF NOT EXISTS */
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS milestone_roles (
        id          serial PRIMARY KEY,
        code        varchar(10) NOT NULL UNIQUE,
        name        varchar(50) NOT NULL,
        description text,
        sort_order  integer NOT NULL DEFAULT 0,
        is_active   boolean NOT NULL DEFAULT true,
        created_at  timestamp NOT NULL DEFAULT now(),
        updated_at  timestamp NOT NULL DEFAULT now()
      )
    `);
    steps.push({ step: "create_table", result: "ok" });
  } catch (e: any) {
    steps.push({ step: "create_table", result: String(e?.message).slice(0, 300) });
    return new Response(JSON.stringify({ ok: false, steps }, null, 2),
      { status: 500, headers: JSON_HEADER });
  }

  /* Step 2: 인덱스 — is_active (code UNIQUE는 컬럼 제약으로 자동 생성됨) */
  try {
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS milestone_roles_is_active_idx
        ON milestone_roles (is_active)
    `);
    steps.push({ step: "create_index_is_active", result: "ok" });
  } catch (e: any) {
    steps.push({ step: "create_index_is_active", result: String(e?.message).slice(0, 300) });
  }

  /* Step 3: 시드 INSERT (멱등 — code UNIQUE 충돌 시 무시) */
  for (const [code, name, description, sortOrder] of SEED_ROLES) {
    try {
      await db.execute(sql`
        INSERT INTO milestone_roles (code, name, description, sort_order, is_active)
        VALUES (${code}, ${name}, ${description}, ${sortOrder}, true)
        ON CONFLICT (code) DO NOTHING
      `);
      steps.push({ step: `seed_${code}`, result: "ok" });
    } catch (e: any) {
      steps.push({ step: `seed_${code}`, result: String(e?.message).slice(0, 300) });
    }
  }

  /* Step 4: 검증 — 최종 상태 보고 */
  let finalRows: any[] = [];
  try {
    const r = await db.execute(sql`
      SELECT id, code, name, sort_order, is_active
      FROM milestone_roles
      ORDER BY sort_order, id
    `);
    finalRows = ((r as any).rows ?? r) as any[];
  } catch (e: any) {
    steps.push({ step: "verify", result: String(e?.message).slice(0, 300) });
  }

  return new Response(JSON.stringify({
    ok: true,
    steps,
    finalRows,
    finalCount: finalRows.length,
  }, null, 2), { status: 200, headers: JSON_HEADER });
};
