// netlify/functions/migrate-solapi-template-sync.ts
// 1회용 — 발송 템플릿(communication_templates)의 카카오 알림톡 코드를
//   알리고(UH_XXXX) → 솔라피 templateId(KA01TP...)로 재연결 + 상태 검수중 동기화.
//
// 배경: 발송 업체를 알리고 → 솔라피로 전환. 발송 템플릿 화면이 들고 있던
//   alimtalk_template_code(UH_XXXX)·alimtalk_review_status가 알리고 기준이라
//   솔라피 등록 6종(2026-05-23 등록·검수중)에 맞춰 재연결한다.
//
// ※ body_template(본문)은 손대지 않음 — 솔라피는 알림톡 본문을 등록 템플릿으로
//   고정하고, DB 본문은 SMS 대체발송/미리보기용({{변수}} 문법). 변수문법·대체발송
//   정합은 카카오 승인 후 카카오 일괄 작업에서 처리.
//
// 호출: 어드민 로그인 후 https://tbfa.co.kr/api/migrate-solapi-template-sync?run=1
//   GET (run 없음) = 진단(현재 카카오 행 코드·상태). 인증 불필요.
//   GET ?run=1     = requireAdmin 후 실제 UPDATE. 멱등.
// 호출 성공 후 파일 삭제.

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-solapi-template-sync" };

const JSON_HEADER = { "Content-Type": "application/json" };

/* 알리고 UH 코드 → 솔라피 templateId (2026-05-23 솔라피 등록분) */
const MAP: Record<string, { solapi: string; label: string }> = {
  UH_9636: { solapi: "KA01TP260523121401738OKTpRObBtvl", label: "연간 기부금 영수증 발급 안내" },
  UH_9635: { solapi: "KA01TP260523121402219EEVDf8bclV2", label: "후원 정보 변경 처리 완료" },
  UH_9634: { solapi: "KA01TP260523121256837nKbXfT9yJmh", label: "등록 카드 만료 안내" },
  UH_9633: { solapi: "KA01TP260523121400847w7Zc33l4Rh2", label: "정기 후원금 출금 완료 안내" },
  UH_9632: { solapi: "KA01TP260523121401287K1HFcLOPAtS", label: "정기 후원금 자동 출금 예정 안내" },
  UH_7533: { solapi: "KA01TP2605231214003525WUwOGmim0W", label: "정기 결제 실패" },
};

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "솔라피 템플릿 동기화 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: JSON_HEADER });
}

export default async function handler(req: Request, _ctx: Context) {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  /* 컬럼 존재 확인 (migrate-add-alimtalk-fields 선행 필요) */
  let hasCols = false;
  try {
    const c: any = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM information_schema.columns
       WHERE table_name = 'communication_templates'
         AND column_name IN ('alimtalk_template_code','alimtalk_review_status')`);
    hasCols = (((c?.rows ?? c)[0] ?? {}).n ?? 0) === 2;
  } catch (err) { return jsonError("check_cols", err); }
  if (!hasCols) {
    return new Response(JSON.stringify({ ok: false, error: "alimtalk 컬럼 없음 — migrate-add-alimtalk-fields 먼저 실행" }), { status: 400, headers: JSON_HEADER });
  }

  /* 진단: 현재 카카오 행 코드·상태 */
  let current: any[] = [];
  try {
    const r: any = await db.execute(sql`
      SELECT id, name, alimtalk_template_code AS code, alimtalk_review_status AS status
        FROM communication_templates
       WHERE channel = 'kakao' AND alimtalk_template_code IS NOT NULL
       ORDER BY id`);
    current = (r?.rows ?? r ?? []);
  } catch (err) { return jsonError("select_current", err); }

  if (!run) {
    return new Response(JSON.stringify({
      ok: true, mode: "diagnostic", hint: "?run=1 로 실제 동기화 (어드민 로그인 필요)",
      mapping: MAP, currentKakaoRows: current,
    }, null, 2), { status: 200, headers: JSON_HEADER });
  }

  /* 실행: 어드민 인증 */
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  const updated: any[] = [];
  try {
    for (const [uh, { solapi }] of Object.entries(MAP)) {
      const r: any = await db.execute(sql`
        UPDATE communication_templates
           SET alimtalk_template_code = ${solapi},
               alimtalk_review_status = '검수중',
               updated_at = NOW()
         WHERE channel = 'kakao' AND alimtalk_template_code = ${uh}
        RETURNING id, name`);
      const rows = (r?.rows ?? r ?? []);
      for (const row of rows) updated.push({ from: uh, to: solapi, id: row.id, name: row.name });
    }
  } catch (err) { return jsonError("update", err); }

  return new Response(JSON.stringify({
    ok: true, mode: "run", updatedCount: updated.length, updated,
    note: "알리고 UH 코드 → 솔라피 templateId 재연결 완료(상태 검수중). 본문은 미변경(승인 후 정리).",
  }, null, 2), { status: 200, headers: JSON_HEADER });
}
