/**
 * migrate-leave-period-len — 휴가 시간대 컬럼 길이 확장 (1회용)
 *
 * 배경: att_leave_requests.half_day_period가 실제 DB에서는 varchar(2)로 만들어져 있었다.
 *       'AM'/'PM'만 쓰던 때는 문제가 없었지만, 반반차 시간대('LATE_IN'/'EARLY_OUT')를
 *       넣으면 "value too long for type character varying(2)"로 신청이 실패한다.
 *       db/schema.ts는 이미 length:10으로 선언돼 있어 정의와 실제가 어긋난 상태 —
 *       DB를 정의에 맞춘다.
 *
 * GET            : 진단 (인증 불필요) — 현재 컬럼 길이 확인
 * GET ?run=1     : 어드민 인증 후 ALTER 실행 (멱등 — 이미 10 이상이면 스킵)
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-leave-period-len" };

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data, null, 1), {
    status, headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function currentLength(): Promise<number | null> {
  const res: any = await db.execute(sql`
    SELECT character_maximum_length AS len
    FROM information_schema.columns
    WHERE table_name = 'att_leave_requests' AND column_name = 'half_day_period'
  `);
  /* db.execute는 드라이버에 따라 배열/{rows} 두 형태 — 둘 다 받는다 */
  const rows = (res?.rows ?? res ?? []) as any[];
  const len = rows[0]?.len;
  return len == null ? null : Number(len);
}

export default async (req: Request) => {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  try {
    const before = await currentLength();

    if (!run) {
      return json({
        ok: true,
        mode: "diagnose",
        column: "att_leave_requests.half_day_period",
        currentLength: before,
        needsMigration: before != null && before < 10,
        hint: "실행하려면 어드민 로그인 상태에서 ?run=1 을 붙여 호출하세요",
      });
    }

    const auth = await requireAdmin(req);
    if (!auth.ok) return auth.res;

    if (before == null) {
      return json({ ok: false, error: "컬럼을 찾을 수 없습니다 (half_day_period)" }, 404);
    }
    if (before >= 10) {
      return json({ ok: true, skipped: true, currentLength: before, message: "이미 확장되어 있습니다" });
    }

    await db.execute(sql`
      ALTER TABLE att_leave_requests
      ALTER COLUMN half_day_period TYPE varchar(10)
    `);

    const after = await currentLength();
    return json({
      ok: true,
      migrated: true,
      before,
      after,
      message: "휴가 시간대 컬럼이 10자로 확장되었습니다 — 반반차(LATE_IN·EARLY_OUT) 신청 가능",
    });
  } catch (err: any) {
    return json({
      ok: false,
      error: "마이그레이션 실패",
      detail: String(err?.message || err).slice(0, 500),
    }, 500);
  }
};
