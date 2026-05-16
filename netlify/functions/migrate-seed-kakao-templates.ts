// netlify/functions/migrate-seed-kakao-templates.ts
// 1회용 시드 — 알리고 카카오 비즈 콘솔에 등록된 7개 알림톡 템플릿을 DB에 INSERT.
//
// 본문은 알리고 콘솔의 본문과 정확히 일치(글자 한 자라도 다르면 발송 거부).
// 변수 표기는 알리고 표준 #{변수명} 그대로 보관 — 발송 dispatcher 통합 시점에
// 카카오 채널만 #{변수} 치환 처리 분기 예정.
//
// 호출:
//   진단: https://tbfa.co.kr/api/migrate-seed-kakao-templates
//   실행: https://tbfa.co.kr/api/migrate-seed-kakao-templates?run=1 (어드민 로그인)
//
// 멱등: alimtalk_template_code로 SELECT 후 이미 있으면 UPDATE, 없으면 INSERT.

import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-seed-kakao-templates" };

interface KakaoTemplateSeed {
  code: string;
  name: string;
  category: string;
  reviewStatus: "approved" | "pending" | "rejected";
  body: string;
  variables: { key: string; label: string; sample: string }[];
  buttonJson: any | null;
}

const BTN_HOME = {
  button: [{
    name: "교사유가족협의회 홈이동",
    linkType: "WL",
    linkTypeName: "웹링크",
    linkM: "https://tbfa.co.kr/",
    linkP: "https://tbfa.co.kr/",
  }],
};

const BTN_CHANNEL_ADD = {
  button: [{
    name: "채널추가",
    linkType: "AC",
    linkTypeName: "채널추가",
  }],
};

const SEEDS: KakaoTemplateSeed[] = [
  {
    code: "UH_7533",
    name: "정기 결제 실패",
    category: "auto_trigger",
    reviewStatus: "approved",
    body: `[교사유가족협의회] #{회원이름}님,
이번 달 후원 결제 안내드려요

#{회원이름}님, 안녕하세요.
교사유가족협의회입니다.

이번 달 보내주시기로 한 정기 후원 #{금액}원이
안타깝게도 결제되지 못했어요.

▪ 사유: #{실패사유}
▪ 연속 실패: #{연속실패횟수}회
▪ 다음 시도일: #{재시도일자}

카드 한도와 잔액, 카드 정보를
한 번만 살펴봐 주시면 좋겠습니다.

#{회원이름}님의 따뜻한 마음이
유가족 곁에 끊김 없이 닿을 수 있도록
[후원 정보 확인] 버튼으로 잠시 점검해 주세요.

언제나 함께해 주셔서 진심으로 감사드립니다.`,
    variables: [
      { key: "회원이름",     label: "회원 이름",     sample: "박두용" },
      { key: "금액",         label: "정기 후원 금액", sample: "30,000" },
      { key: "실패사유",     label: "결제 실패 사유", sample: "한도초과" },
      { key: "연속실패횟수", label: "연속 실패 횟수", sample: "1" },
      { key: "재시도일자",   label: "재시도 일자",   sample: "2026-05-22" },
    ],
    buttonJson: BTN_CHANNEL_ADD,
  },
  {
    code: "UH_7534",
    name: "카드 만료 임박",
    category: "auto_trigger",
    reviewStatus: "rejected",
    body: `[교사유가족협의회] #{회원이름}님,
등록 카드 만료가 #{잔여일수}일 남았어요

#{회원이름}님, 안녕하세요.
교사유가족협의회입니다.

정기 후원에 등록해 주신 카드의
만료일이 가까워졌습니다.

▪ 카드 만료일: #{카드만료일}
▪ 잔여 일수: #{잔여일수}일

만료 전에 새 카드 정보로 갱신해 주시면
#{회원이름}님께서 보내주시는 마음이
유가족 곁에 끊김 없이 계속 닿을 수 있어요.

[카드 정보 갱신] 버튼으로 잠깐만 시간 내 주세요.

오늘도 함께해 주셔서 진심으로 감사드립니다.`,
    variables: [
      { key: "회원이름",   label: "회원 이름",   sample: "박두용" },
      { key: "잔여일수",   label: "카드 만료 잔여 일수", sample: "30" },
      { key: "카드만료일", label: "카드 만료일", sample: "2026-08" },
    ],
    buttonJson: BTN_CHANNEL_ADD,
  },
  {
    code: "UH_9632",
    name: "정기 후원금 자동 출금 예정 안내",
    category: "auto_trigger",
    reviewStatus: "pending",
    body: `[교사유가족협의회] #{회원이름}님, 이번 달 후원 출금을 안내드려요

#{회원이름}님, 안녕하세요. 교사유가족협의회입니다.

이번 달 정기 후원 #{출금금액}원이 다음과 같이 자동 출금될 예정이에요.

- 출금 예정일: #{출금예정일}
- 결제 수단: #{결제수단}

#{회원이름}님의 따뜻한 마음이 유가족 곁에 한결같이 닿고 있습니다.

언제나 함께해 주셔서 진심으로 감사드려요.`,
    variables: [
      { key: "회원이름",   label: "회원 이름",   sample: "박두용" },
      { key: "출금금액",   label: "출금 금액",   sample: "30,000" },
      { key: "출금예정일", label: "출금 예정일", sample: "2026-06-01" },
      { key: "결제수단",   label: "결제 수단",   sample: "신한카드" },
    ],
    buttonJson: BTN_HOME,
  },
  {
    code: "UH_9633",
    name: "정기 후원금 출금 완료 안내",
    category: "auto_trigger",
    reviewStatus: "pending",
    body: `[교사유가족협의회] #{회원이름}님, 후원 출금이 무사히 완료되었어요

#{회원이름}님, 안녕하세요. 교사유가족협의회입니다.

이번 달 정기 후원 #{출금금액}원이 무사히 출금되었습니다.

- 출금 일시: #{출금일시}
- 누적 후원: #{누적후원금액}원

#{회원이름}님께서 보내주신 따뜻한 마음이 유가족 곁에 또 한 걸음 닿았습니다.

기부금 영수증은 마이페이지에서 확인하실 수 있어요.
언제나 함께해 주셔서 진심으로 감사드립니다.`,
    variables: [
      { key: "회원이름",     label: "회원 이름",   sample: "박두용" },
      { key: "출금금액",     label: "출금 금액",   sample: "30,000" },
      { key: "출금일시",     label: "출금 일시",   sample: "2026-05-15 09:00" },
      { key: "누적후원금액", label: "누적 후원 금액", sample: "360,000" },
    ],
    buttonJson: BTN_HOME,
  },
  {
    code: "UH_9634",
    name: "등록 카드 만료 안내",
    category: "auto_trigger",
    reviewStatus: "pending",
    body: `[교사유가족협의회] #{회원이름}님, 등록 카드 만료일을 안내드려요

#{회원이름}님, 안녕하세요. 교사유가족협의회입니다.

정기 후원에 등록하신 카드의 만료일이 가까워졌어요.

- 카드 만료일: #{카드만료일}
- 잔여 일수: #{잔여일수}일

만료일 이후에는 정기 출금이 잠시 멈출 수 있어 미리 안내드려요. 카드 정보는 마이페이지에서 한 번 살펴봐 주시면 좋겠습니다.

#{회원이름}님의 따뜻한 마음이 유가족 곁에 끊김 없이 닿을 수 있기를 바라며,

언제나 함께해 주셔서 진심으로 감사드립니다.`,
    variables: [
      { key: "회원이름",   label: "회원 이름",   sample: "박두용" },
      { key: "카드만료일", label: "카드 만료일", sample: "2026-08" },
      { key: "잔여일수",   label: "잔여 일수",   sample: "30" },
    ],
    buttonJson: BTN_HOME,
  },
  {
    code: "UH_9635",
    name: "후원 정보 변경 처리 완료",
    category: "auto_trigger",
    reviewStatus: "pending",
    body: `[교사유가족협의회] #{회원이름}님, 후원 정보 변경이 완료되었어요

#{회원이름}님, 안녕하세요. 교사유가족협의회입니다.

요청하신 후원 정보 변경이 처리 완료되었습니다.

- 변경 항목: #{변경항목}
- 변경 후 내용: #{변경후내용}
- 처리 일시: #{처리일시}

변경된 내용은 마이페이지에서 확인하실 수 있어요.

#{회원이름}님과 함께 걷는 이 길에 깊이 감사드립니다.`,
    variables: [
      { key: "회원이름",   label: "회원 이름",     sample: "박두용" },
      { key: "변경항목",   label: "변경 항목",     sample: "결제수단" },
      { key: "변경후내용", label: "변경 후 내용",  sample: "신한카드 4321" },
      { key: "처리일시",   label: "처리 일시",     sample: "2026-05-16 14:30" },
    ],
    buttonJson: BTN_HOME,
  },
  {
    code: "UH_9636",
    name: "연간 기부금 영수증 발급 안내",
    category: "auto_trigger",
    reviewStatus: "pending",
    body: `[교사유가족협의회] #{회원이름}님, 기부금 영수증 발급을 안내드려요

#{회원이름}님, 안녕하세요. 교사유가족협의회입니다.

#{연도}년도 한 해 동안 보내주신 마음을 정리해 안내드려요.

- 연간 후원 총액: #{연간후원금액}원
- 발급 가능 기간: #{발급가능기간}
- 영수증 종류: #{영수증종류}

기부금 영수증은 마이페이지에서 발급받으실 수 있어요.

#{연도}년 한 해 동안 #{회원이름}님께서 보내주신 따뜻한 마음이 유가족 곁에 깊이 닿았습니다.

언제나 함께해 주셔서 진심으로 감사드립니다.`,
    variables: [
      { key: "회원이름",     label: "회원 이름",         sample: "박두용" },
      { key: "연도",         label: "연도",             sample: "2026" },
      { key: "연간후원금액", label: "연간 후원 금액",     sample: "360,000" },
      { key: "발급가능기간", label: "발급 가능 기간",     sample: "2027-01-01 ~ 2027-01-31" },
      { key: "영수증종류",   label: "영수증 종류",       sample: "기부금영수증" },
    ],
    buttonJson: BTN_HOME,
  },
];

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  try {
    /* 진단 — 컬럼·기존 카카오 템플릿 카운트 */
    const colCheck: any = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM information_schema.columns
       WHERE table_name = 'communication_templates'
         AND column_name IN ('alimtalk_template_code','alimtalk_review_status','alimtalk_button_json')
    `);
    const hasAlimtalkCols = (((colCheck?.rows ?? colCheck)[0] ?? {}).n ?? 0) === 3;

    if (!hasAlimtalkCols) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "선행 마이그(/api/migrate-add-alimtalk-fields?run=1) 호출 필요",
          hint: "카카오 알림톡 컬럼이 DB에 없습니다.",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const existRes: any = await db.execute(sql`
      SELECT alimtalk_template_code FROM communication_templates
       WHERE alimtalk_template_code IS NOT NULL
    `);
    const existing = new Set<string>(
      (existRes?.rows ?? existRes ?? []).map((r: any) => r.alimtalk_template_code)
    );

    if (!run) {
      return new Response(
        JSON.stringify({
          ok: true,
          mode: "diagnose",
          totalSeeds: SEEDS.length,
          alreadyRegistered: SEEDS.filter(s => existing.has(s.code)).map(s => s.code),
          toRegister: SEEDS.filter(s => !existing.has(s.code)).map(s => s.code),
          hint: "?run=1 호출 시 누락된 항목만 INSERT, 이미 있는 항목은 UPDATE.",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    /* 실행 — 어드민 인증 */
    const auth = await requireAdmin(req);
    if (!auth.ok) return (auth as { ok: false; res: Response }).res;

    const adminId = auth.ctx.admin.uid;
    const inserted: string[] = [];
    const updated: string[] = [];

    for (const seed of SEEDS) {
      const varsJson = JSON.stringify(seed.variables);
      const btnJson = seed.buttonJson ? JSON.stringify(seed.buttonJson) : null;

      if (existing.has(seed.code)) {
        await db.execute(sql`
          UPDATE communication_templates
             SET name                   = ${seed.name},
                 channel                = 'kakao',
                 category               = ${seed.category},
                 subject                = NULL,
                 body_template          = ${seed.body},
                 variables              = ${varsJson}::jsonb,
                 is_active              = true,
                 updated_by             = ${adminId},
                 updated_at             = NOW(),
                 alimtalk_review_status = ${seed.reviewStatus},
                 alimtalk_button_json   = ${btnJson ? sql`${btnJson}::jsonb` : sql`NULL`}
           WHERE alimtalk_template_code = ${seed.code}
        `);
        updated.push(seed.code);
      } else {
        await db.execute(sql`
          INSERT INTO communication_templates
            (name, channel, category, subject, body_template, variables, is_active,
             created_by, updated_by,
             alimtalk_template_code, alimtalk_review_status, alimtalk_button_json)
          VALUES
            (${seed.name}, 'kakao', ${seed.category}, NULL,
             ${seed.body}, ${varsJson}::jsonb, true,
             ${adminId}, ${adminId},
             ${seed.code}, ${seed.reviewStatus},
             ${btnJson ? sql`${btnJson}::jsonb` : sql`NULL`})
        `);
        inserted.push(seed.code);
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        mode: "run",
        inserted,
        updated,
        message: `${inserted.length}건 신규 + ${updated.length}건 갱신`,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "시드 실패",
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
