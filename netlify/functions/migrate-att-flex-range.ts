/**
 * migrate-att-flex-range — 근무 정책에 '유연 허용범위(±X분)' 컬럼 추가 (2026-05-26)
 *  - 유연출퇴근제: flexEnabled ON 시 출근을 표준시각 ±flex_range_mins 내 자율(지각 아님)
 *  - 1회용·멱등(ADD COLUMN IF NOT EXISTS). 호출 성공 후 파일 삭제 + 커밋.
 *  - GET ?run=1 : 어드민(super_admin) 인증 후 실행 / GET : 진단(인증 불필요)
 */
import { db } from "../../db/index";
import { sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-att-flex-range" };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request) {
  const run = new URL(req.url).searchParams.get("run") === "1";

  // 진단 모드 (인증 불필요)
  if (!run) {
    let exists = false;
    try {
      const r: any = await db.execute(sql`
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'att_policies' AND column_name = 'flex_range_mins' LIMIT 1`);
      exists = ((r?.rows ?? r ?? []) as any[]).length > 0;
    } catch {}
    return json({ ok: true, mode: "diagnose", flexRangeMinsExists: exists, hint: "GET ?run=1 로 적용(어드민 인증 필요)" });
  }

  // 실행 (super_admin 전용)
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  if ((auth.ctx.member as any).role !== "super_admin") {
    return json({ ok: false, error: "슈퍼어드민 전용" }, 403);
  }

  try {
    await db.execute(sql`ALTER TABLE att_policies ADD COLUMN IF NOT EXISTS flex_range_mins integer NOT NULL DEFAULT 120`);
    return json({ ok: true, applied: true, column: "att_policies.flex_range_mins", default: 120, note: "유연 허용범위 ±2시간 기본 — 운영자가 근무 정책에서 조절" });
  } catch (err: any) {
    return json({ ok: false, error: "마이그레이션 실패", detail: String(err?.message ?? err).slice(0, 500) }, 500);
  }
}
