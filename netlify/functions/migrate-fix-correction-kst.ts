/**
 * GET /api/migrate-fix-correction-kst        — 진단 (인증 불필요·readonly)
 * GET /api/migrate-fix-correction-kst?run=1  — 실행 (어드민 인증)
 *
 * 옛 버그로 오프셋 없이 저장돼 +9h 틀어진 '대기 중(PENDING)' 근태 정정요청 시각을 −9시간 보정.
 *   (예: 08:00 KST를 08:00 UTC로 잘못 저장 → −9h로 올바른 순간(전날 23:00 UTC)로 교정)
 * 멱등: review_note에 '[tzfix]' 마커 → 이미 보정된 행은 재보정 안 함(중복 실행 안전).
 * 진단 모드는 att 정책(표준출근·유연범위)도 함께 보여줌(8시 하한 확인용).
 * 호출 성공 후 파일 삭제 + commit (§6.8).
 */
import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-fix-correction-kst" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

export default async function handler(req: Request, _ctx: Context) {
  let step = "start";
  try {
    const url = new URL(req.url);
    const run = url.searchParams.get("run") === "1";

    // 대상: PENDING · 아직 미보정([tzfix] 마커 없음)
    step = "diag_list";
    const listRes: any = await db.execute(sql.raw(`
      SELECT id, member_uid, target_date, correction_type,
             to_char(requested_check_in  AT TIME ZONE 'Asia/Seoul', 'HH24:MI') AS ci_now_kst,
             to_char(requested_check_out AT TIME ZONE 'Asia/Seoul', 'HH24:MI') AS co_now_kst,
             to_char((requested_check_in  - interval '9 hours') AT TIME ZONE 'Asia/Seoul', 'HH24:MI') AS ci_fixed_kst,
             to_char((requested_check_out - interval '9 hours') AT TIME ZONE 'Asia/Seoul', 'HH24:MI') AS co_fixed_kst
        FROM att_corrections
       WHERE status = 'PENDING'
         AND (review_note IS NULL OR review_note NOT LIKE '%[tzfix]%')
       ORDER BY id
    `));
    const targets = listRes?.rows ?? listRes ?? [];

    // 참고: att 정책(8시 하한 확인용)
    step = "diag_policy";
    let policy: any = null;
    try {
      const pRes: any = await db.execute(sql.raw(`
        SELECT check_in_time, check_out_time, flex_enabled, daily_hours,
               COALESCE((SELECT flex_range_mins FROM att_policies WHERE is_default = true LIMIT 1), NULL) AS flex_range_mins
          FROM att_policies WHERE is_default = true LIMIT 1
      `));
      policy = (pRes?.rows ?? pRes ?? [])[0] ?? null;
    } catch (e) { policy = { note: "정책 조회 실패(무시): " + String((e as any)?.message || e).slice(0, 120) }; }

    if (!run) {
      return new Response(JSON.stringify({
        ok: true, mode: "diagnose",
        target_count: targets.length,
        targets,
        policy,
        hint: "targets가 보정 대상. ci_now_kst(현재 틀어진 표시)→ci_fixed_kst(보정 후)를 확인하고 ?run=1 로 실행.",
      }, null, 2), { headers: JSON_HEADER });
    }

    step = "auth";
    const auth = await requireAdmin(req);
    if (!auth.ok) return (auth as any).res;

    step = "update";
    const upd: any = await db.execute(sql.raw(`
      UPDATE att_corrections
         SET requested_check_in  = requested_check_in  - interval '9 hours',
             requested_check_out = requested_check_out - interval '9 hours',
             review_note = COALESCE(review_note, '') || '[tzfix]'
       WHERE status = 'PENDING'
         AND (review_note IS NULL OR review_note NOT LIKE '%[tzfix]%')
    `));
    const affected = (upd as any)?.rowCount ?? (upd as any)?.count ?? targets.length;

    return new Response(JSON.stringify({
      ok: true, mode: "executed",
      fixed_count: affected,
      hint: "대기 중 정정요청 시각 −9h 보정 완료. 근태 현황에서 시각 확인 후 승인하세요. 성공 확인 후 파일 삭제 + commit.",
    }, null, 2), { headers: JSON_HEADER });
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false, error: "마이그 실패", step,
      detail: String(err?.message || err).slice(0, 500),
    }), { status: 500, headers: JSON_HEADER });
  }
}
