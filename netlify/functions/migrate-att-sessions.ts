/**
 * migrate-att-sessions: 출퇴근 다중 세션 컬럼 추가 (1회용)
 *
 *  att_records 에 sessions(jsonb, 기본 '[]') 추가.
 *  - 하루 여러 번의 출퇴근(재출근)을 세션 배열로 저장:
 *    [{ in, out, inLat, inLng, outLat, outLng }, ...]
 *  - 기존 요약 컬럼(check_in_time·check_out_time·working_mins)은 그대로 유지
 *    (첫 출근·마지막 퇴근·근무시간 합계) → 통계·급여·실시간 현황 회귀 0.
 *  - 기존 행은 sessions=[] 로 시작하고, 서버 로직이 sessions 비어 있으면
 *    check_in/out 으로 단일 세션을 유추하므로 별도 백필 불필요.
 *
 * 호출(어드민 로그인 상태): https://tbfa.co.kr/api/migrate-att-sessions?run=1
 *  - GET ?run=1 : requireAdmin 후 실행 (멱등 — ADD COLUMN IF NOT EXISTS)
 *  - GET        : 진단 모드 (인증 불필요)
 * 적용 성공 확인 후: schema.ts 정의 활성화 + 본 파일 삭제 + 커밋.
 */
import { db } from "../../db/index";
import { sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-att-sessions" };

function json(status: number, data: unknown) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const CHECK_SQL = sql`
  SELECT column_name, data_type, column_default
  FROM information_schema.columns
  WHERE table_name = 'att_records' AND column_name = 'sessions'
`;
function asRows(res: any): any[] {
  return Array.isArray(res) ? res : (res?.rows ?? []);
}

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  if (!run) {
    try {
      const rows = asRows(await db.execute(CHECK_SQL));
      return json(200, {
        ok: true, mode: "diagnose",
        message: "?run=1 로 실제 실행 (어드민 로그인 필요)",
        existing: rows, exists: rows.length > 0,
      });
    } catch (err: any) {
      return json(500, { ok: false, step: "diagnose", detail: String(err?.message ?? err) });
    }
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  try {
    await db.execute(sql`
      ALTER TABLE att_records
        ADD COLUMN IF NOT EXISTS sessions jsonb NOT NULL DEFAULT '[]'::jsonb
    `);
    const rows = asRows(await db.execute(CHECK_SQL));
    return json(200, {
      ok: true, mode: "run",
      message: "적용 완료 — schema 정의 활성화 + 본 파일 삭제 진행",
      columns: rows,
    });
  } catch (err: any) {
    return json(500, {
      ok: false, step: "alter",
      detail: String(err?.message ?? err).slice(0, 500),
      stack: String(err?.stack ?? "").slice(0, 800),
    });
  }
}
