/**
 * migrate-att-r29-halfday-cleanup.ts (1회용)
 *
 * 목적: R29-GAP L 우선순위 — 반차 모델 이중화 정리
 *
 * 현재 상태:
 *   - att_leave_types 테이블에 "반차 (오전)"·"반차 (오후)" 행 존재 (옛 모델)
 *   - att_leaves.is_half_day + half_day_period 컬럼으로 분기 처리 (현재 모델)
 *   - 옛 반차 leaveType 행은 실사용 0, 운영 시 잡음
 *
 * 동작:
 *   1. 이름에 "반차" 포함된 leaveType 행을 is_active=false로 hide
 *      → 데이터 보존 + UI에서 제외 (백엔드가 isActive=true 기준 필터링)
 *   2. 일반 휴가종류(연차·일반·개인 등)에 allow_half_day=true 설정
 *      → 향후 검증 강화 시 활용 가능 (현재는 정보성)
 *
 * 운영 영향: 0
 *   - att_leaves(휴가 신청 기록)는 leave_type_id FK로 옛 행 참조해도 ON DELETE CASCADE/SET이 없어 안전
 *   - is_half_day flag 기반 분기는 leaveType.name 매칭 안 함
 *
 * 호출: 어드민 로그인 후 https://tbfa.co.kr/api/migrate-att-r29-halfday-cleanup?run=1
 * 호출 후 즉시 본 파일 삭제 + 커밋.
 */
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-att-r29-halfday-cleanup" };

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  if (!run) {
    // 진단 모드 — 인증 불필요
    try {
      const halfRows = await db.execute(sql`
        SELECT id, name, is_active
        FROM att_leave_types
        WHERE name ILIKE '%반차%'
        ORDER BY id
      `);
      const targetRows = await db.execute(sql`
        SELECT id, name, allow_half_day
        FROM att_leave_types
        WHERE name NOT ILIKE '%반차%' AND is_active = true
        ORDER BY id
      `);
      return Response.json({
        ok: true,
        mode: "diagnostic",
        halfDayRowsToHide: (halfRows as any).rows ?? halfRows,
        targetRowsForAllowHalfDay: (targetRows as any).rows ?? targetRows,
        hint: "GET ?run=1 (어드민 로그인) 으로 실제 실행",
      });
    } catch (err: any) {
      return Response.json({ ok: false, error: "진단 실패", detail: String(err?.message || err) }, { status: 500 });
    }
  }

  // 실행 모드 — 어드민 인증 필수
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  try {
    // 1. 옛 반차 leaveType 행 hide
    const hideResult = await db.execute(sql`
      UPDATE att_leave_types
      SET is_active = false, updated_at = NOW()
      WHERE name ILIKE '%반차%' AND is_active = true
      RETURNING id, name
    `);
    const hidden = (hideResult as any).rows ?? hideResult;

    // 2. 일반 휴가종류에 allow_half_day=true 부여 (정보성·향후 검증 강화용)
    //    - "반차" 포함 행은 위에서 hide됨·제외
    //    - 모든 active 휴가종류에 적용 (NULL/false 무관)
    const allowResult = await db.execute(sql`
      UPDATE att_leave_types
      SET allow_half_day = true, updated_at = NOW()
      WHERE name NOT ILIKE '%반차%' AND is_active = true AND allow_half_day = false
      RETURNING id, name
    `);
    const allowed = (allowResult as any).rows ?? allowResult;

    return Response.json({
      ok: true,
      step: "complete",
      hiddenHalfDayRows: hidden,
      enabledAllowHalfDay: allowed,
      summary: `${(hidden as any[])?.length ?? 0}개 옛 반차 행 hide, ${(allowed as any[])?.length ?? 0}개 일반 휴가종류에 allowHalfDay=true 부여`,
      next: "본 파일 즉시 삭제 + 커밋·푸시",
    });
  } catch (err: any) {
    return Response.json({
      ok: false,
      error: "마이그 실행 실패",
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }, { status: 500 });
  }
}
