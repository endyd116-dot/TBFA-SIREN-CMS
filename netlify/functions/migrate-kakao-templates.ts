/**
 * migrate-kakao-templates — 카카오 알림톡 템플릿 관리 테이블 + 기존 승인 6종 시드 (1회용)
 *
 * GET ?run=1  : requireAdmin 인증 후 실행
 * GET         : 진단 (인증 불필요 — 테이블/시드 현황)
 *
 * 생성: kakao_alimtalk_templates (운영자가 CMS에서 등록→검수→승인 관리·솔라피 API 연동)
 * 시드: 2026-05-23 솔라피 등록·카카오 승인 완료된 6종(이벤트 매핑·solapi templateId)
 *   → env(SOLAPI_TPL_*) 없이 DB에서 바로 발송 가능.
 * ★ 호출 성공 후 즉시 파일 삭제 + 커밋 (1회용 보안 원칙)
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-kakao-templates" };

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

const PF_ID = "KA01PF260523120325582xPyYFhJqfpX";

/* 2026-05-23 솔라피 등록·카카오 승인 6종 (docs/history/milestones 솔라피 마이그 기준) */
const SEED = [
  {
    eventKey: "billing.failed", name: "정기 결제 실패",
    tplId: "KA01TP2605231214003525WUwOGmim0W",
    vars: ["회원이름", "금액", "실패사유", "연속실패횟수", "재시도일자"],
    emphasizeTitle: "정기 결제 실패",
    content: "[교사유가족협의회] #{회원이름}님, 이번 달 후원 결제 안내드려요\n\n이번 달 보내주시기로 한 정기 후원 #{금액}원이 안타깝게도 결제되지 못했어요.\n\n▪ 사유: #{실패사유}\n▪ 연속 실패: #{연속실패횟수}회\n▪ 다음 시도일: #{재시도일자}\n\n카드 한도와 잔액, 카드 정보를 한 번만 살펴봐 주시면 좋겠습니다.\n언제나 함께해 주셔서 진심으로 감사드립니다.",
  },
  {
    eventKey: "card.expiring", name: "등록 카드 만료 안내",
    tplId: "KA01TP260523121256837nKbXfT9yJmh",
    vars: ["회원이름", "카드만료일", "잔여일수"],
    emphasizeTitle: "등록 카드 만료 안내",
    content: "[교사유가족협의회] #{회원이름}님, 등록 카드 만료일을 안내드려요\n\n정기 후원에 등록하신 카드의 만료일이 가까워졌어요.\n\n- 카드 만료일: #{카드만료일}\n- 잔여 일수: #{잔여일수}일\n\n만료일 이후에는 정기 출금이 잠시 멈출 수 있어 미리 안내드려요.\n언제나 함께해 주셔서 진심으로 감사드립니다.",
  },
  {
    eventKey: "billing.success", name: "정기 후원금 출금 완료 안내",
    tplId: "KA01TP260523121400847w7Zc33l4Rh2",
    vars: ["회원이름", "출금금액", "출금일시", "누적후원금액"],
    emphasizeTitle: "정기 후원금 출금 완료 안내",
    content: "[교사유가족협의회] #{회원이름}님, 후원 출금이 무사히 완료되었어요\n\n이번 달 정기 후원 #{출금금액}원이 무사히 출금되었습니다.\n\n- 출금 일시: #{출금일시}\n- 누적 후원: #{누적후원금액}원\n\n기부금 영수증은 마이페이지에서 확인하실 수 있어요.\n언제나 함께해 주셔서 진심으로 감사드립니다.",
  },
  {
    eventKey: "billing.upcoming", name: "정기 후원금 자동 출금 예정 안내",
    tplId: "KA01TP260523121401287K1HFcLOPAtS",
    vars: ["회원이름", "출금금액", "출금예정일", "결제수단"],
    emphasizeTitle: "정기 후원금 자동 출금 예정 안내",
    content: "[교사유가족협의회] #{회원이름}님, 이번 달 후원 출금을 안내드려요\n\n이번 달 정기 후원 #{출금금액}원이 다음과 같이 자동 출금될 예정이에요.\n\n- 출금 예정일: #{출금예정일}\n- 결제 수단: #{결제수단}\n\n언제나 함께해 주셔서 진심으로 감사드려요.",
  },
  {
    eventKey: "donation.receipt_annual", name: "연간 기부금 영수증 발급 안내",
    tplId: "KA01TP260523121401738OKTpRObBtvl",
    vars: ["회원이름", "연도", "연간후원금액", "발급가능기간", "영수증종류"],
    emphasizeTitle: "연간 기부금 영수증 발급 안내",
    content: "[교사유가족협의회] #{회원이름}님, 기부금 영수증 발급을 안내드려요\n\n#{연도}년도 한 해 동안 보내주신 마음을 정리해 안내드려요.\n\n- 연간 후원 총액: #{연간후원금액}원\n- 발급 가능 기간: #{발급가능기간}\n- 영수증 종류: #{영수증종류}\n\n기부금 영수증은 마이페이지에서 발급받으실 수 있어요.\n언제나 함께해 주셔서 진심으로 감사드립니다.",
  },
  {
    eventKey: "donor.info_changed", name: "후원 정보 변경 처리 완료",
    tplId: "KA01TP260523121402219EEVDf8bclV2",
    vars: ["회원이름", "변경항목", "변경후내용", "처리일시"],
    emphasizeTitle: "후원 정보 변경 처리 완료",
    content: "[교사유가족협의회] #{회원이름}님, 후원 정보 변경이 완료되었어요\n\n요청하신 후원 정보 변경이 처리 완료되었습니다.\n- 변경 항목: #{변경항목}\n- 변경 후 내용: #{변경후내용}\n- 처리 일시: #{처리일시}\n\n변경된 내용은 마이페이지에서 확인하실 수 있어요.\n#{회원이름}님과 함께 걷는 이 길에 깊이 감사드립니다.",
  },
];

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "GET") return json({ ok: false, error: "GET만 허용" }, 405);
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  if (!run) {
    try {
      const r: any = await db.execute(sql.raw(
        `SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='kakao_alimtalk_templates') AS tbl,
                (SELECT COUNT(*)::int FROM kakao_alimtalk_templates) AS seeded`
      )).catch(() => null);
      const row = r ? (r?.rows ?? r ?? [])[0] : null;
      return json({ ok: true, diag: true, table: row?.tbl ?? false, seeded: row?.seeded ?? 0 });
    } catch (e: any) {
      return json({ ok: false, diag: true, error: String(e?.message).slice(0, 300) }, 500);
    }
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const steps: string[] = [];
  try {
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS kakao_alimtalk_templates (
        id                       SERIAL PRIMARY KEY,
        event_key                VARCHAR(40),
        name                     VARCHAR(120) NOT NULL,
        content                  TEXT NOT NULL,
        variables                JSONB DEFAULT '[]'::jsonb,
        category_code            VARCHAR(20) DEFAULT '004001',
        emphasize_title          VARCHAR(50),
        emphasize_subtitle       VARCHAR(50) DEFAULT '교사유가족협의회',
        buttons                  JSONB DEFAULT '[]'::jsonb,
        pf_id                    VARCHAR(60),
        solapi_template_id       VARCHAR(80),
        status                   VARCHAR(16) NOT NULL DEFAULT 'draft',
        solapi_status            VARCHAR(20),
        reject_reason            TEXT,
        is_active                BOOLEAN NOT NULL DEFAULT TRUE,
        inspection_requested_at  TIMESTAMP,
        approved_at              TIMESTAMP,
        created_by               INTEGER REFERENCES members(id),
        created_at               TIMESTAMP DEFAULT NOW(),
        updated_at               TIMESTAMP DEFAULT NOW()
      )
    `));
    steps.push("kakao_alimtalk_templates 테이블 생성(또는 존재)");

    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS kakao_tpl_event_idx ON kakao_alimtalk_templates (event_key)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS kakao_tpl_status_idx ON kakao_alimtalk_templates (status)`));
    steps.push("인덱스 생성(event_key·status)");

    const btn = JSON.stringify([{ buttonType: "WL", buttonName: "교사유가족협의회 홈이동", linkMo: "https://tbfa.co.kr/", linkPc: "https://tbfa.co.kr/" }]);
    let inserted = 0;
    for (const t of SEED) {
      const r: any = await db.execute(sql`
        INSERT INTO kakao_alimtalk_templates
          (event_key, name, content, variables, category_code, emphasize_title, emphasize_subtitle,
           buttons, pf_id, solapi_template_id, status, solapi_status, approved_at, created_at, updated_at)
        SELECT ${t.eventKey}, ${t.name}, ${t.content}, ${JSON.stringify(t.vars)}::jsonb, '004001',
               ${t.emphasizeTitle}, '교사유가족협의회', ${btn}::jsonb, ${PF_ID}, ${t.tplId},
               'approved', 'APPROVED', NOW(), NOW(), NOW()
        WHERE NOT EXISTS (
          SELECT 1 FROM kakao_alimtalk_templates WHERE solapi_template_id = ${t.tplId}
        )
        RETURNING id
      `);
      if ((r?.rows ?? r ?? []).length > 0) inserted++;
    }
    steps.push(`승인 6종 시드: ${inserted}건 신규(기존은 건너뜀)`);

    const cnt: any = await db.execute(sql.raw(`SELECT COUNT(*)::int AS n FROM kakao_alimtalk_templates`));
    return json({ ok: true, steps, total: (cnt?.rows ?? cnt ?? [])[0]?.n ?? null });
  } catch (e: any) {
    return json({
      ok: false, error: "마이그레이션 실패", steps,
      detail: String(e?.message || e).slice(0, 500), stack: String(e?.stack || "").slice(0, 1000),
    }, 500);
  }
};
