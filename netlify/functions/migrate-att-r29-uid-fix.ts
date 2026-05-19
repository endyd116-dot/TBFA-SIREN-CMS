/**
 * migrate-att-r29-uid-fix
 *
 * att_remote_work_reports.member_uid 컬럼을 integer → varchar(36) 으로 통일.
 * (다른 att_* 9개 테이블은 이미 varchar(36) — 재택보고서만 outlier 였음)
 *
 * 값 보존: 기존 integer 값을 그대로 문자열로 캐스팅 (CAST AS VARCHAR).
 *
 * 운영자가 어드민 로그인 후 주소창에:
 *   GET ?      — 진단 모드 (인증 불필요, 현재 컬럼 타입 표시)
 *   GET ?run=1 — 실제 실행 (어드민 인증 필요, 멱등 보장)
 *
 * 멱등성: 이미 varchar 이면 skip.
 */
import { db } from "../../db/index";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-att-r29-uid-fix" };

function jsonOk(data: unknown) {
  return new Response(JSON.stringify({ ok: true, ...((data as any) || {}) }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "마이그레이션 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}

async function getColumnType(): Promise<string | null> {
  const res: any = await db.execute(sql`
    SELECT data_type, udt_name
    FROM information_schema.columns
    WHERE table_name = 'att_remote_work_reports'
      AND column_name = 'member_uid'
  `);
  const row = (Array.isArray(res) ? res[0] : (res?.rows ?? [])[0]);
  if (!row) return null;
  return String(row.data_type);
}

export default async function handler(req: Request) {
  if (req.method !== "GET") return new Response("Method Not Allowed", { status: 405 });

  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  // 진단 모드 — 인증 불필요
  if (!run) {
    try {
      const currentType = await getColumnType();
      return jsonOk({
        mode: "diagnose",
        table: "att_remote_work_reports",
        column: "member_uid",
        currentType: currentType ?? "(column not found)",
        nextStep: currentType === "character varying"
          ? "이미 varchar — 실행 불필요"
          : "GET ?run=1 로 실행하세요 (어드민 로그인 필요)",
      });
    } catch (err) {
      return jsonError("diagnose", err);
    }
  }

  // 실행 모드 — 어드민 인증 필요
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  try {
    const currentType = await getColumnType();
    if (currentType === "character varying") {
      return jsonOk({
        mode: "run",
        result: "skipped",
        reason: "already varchar — 이미 적용된 상태",
        currentType,
      });
    }

    // FK 제약 먼저 DROP (있으면) — 없으면 무시
    try {
      await db.execute(sql`
        ALTER TABLE att_remote_work_reports
        DROP CONSTRAINT IF EXISTS att_remote_work_reports_member_uid_fkey
      `);
    } catch (_) { /* 제약 없으면 무시 */ }

    // ALTER COLUMN: integer → varchar(36), 값은 USING CAST 로 보존
    await db.execute(sql`
      ALTER TABLE att_remote_work_reports
      ALTER COLUMN member_uid TYPE VARCHAR(36)
      USING member_uid::varchar
    `);

    const newType = await getColumnType();
    return jsonOk({
      mode: "run",
      result: "applied",
      previousType: currentType,
      newType,
      message: "att_remote_work_reports.member_uid → varchar(36) 변환 완료. 다음 단계: schema.ts 정의 갱신 + 코드 push.",
    });
  } catch (err) {
    return jsonError("alter_column", err);
  }
}
