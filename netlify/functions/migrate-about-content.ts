/**
 * GET /api/migrate-about-content        — 진단 (인증 불필요·readonly)
 * GET /api/migrate-about-content?run=1  — 실행 (어드민 인증)
 *
 * 협의회 소개(about.html) 페이지의 인사말·비전 3카드·연혁 초안을 content_pages에 시드한다.
 * 박두용 대표 언론 인터뷰(2026-07 취재) 기반 초안 — Swain 확인 후 발행.
 * 멱등: pageKey ON CONFLICT DO UPDATE. 호출 성공 후 즉시 파일 삭제 + commit (§6.8).
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { contentPages } from "../../db/schema";
import { eq, inArray } from "drizzle-orm";

export const config = { path: "/api/migrate-about-content" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

const SEED: { pageKey: string; title: string; contentHtml: string }[] = [
  {
    pageKey: "about_greeting_text",
    title: "협의회 소개 - 인사말",
    contentHtml: `
<p>안녕하십니까, 교사유가족협의회 대표 박두용입니다.</p>
<p>저는 2023년 7월, 서울 서이초등학교에서 세상을 떠난 故 박인혜 선생님의 사촌오빠입니다. 동생의 죽음 앞에서 저희 가족은 "개인적인 일"이라는 설명만을 들어야 했습니다. 무엇이 동생을 그렇게 만들었는지 알기 위해 스스로 나설 수밖에 없었고, 그 과정에서 비슷한 아픔을 겪은 다른 선생님들의 유가족들이 하나둘 저에게 연락해오기 시작했습니다.</p>
<p>지금 저희 협의회에는 스스로 세상을 등진 선생님 열세 분의 유가족이 함께하고 있습니다. 저희가 마주한 유서에는 공통적으로 이런 말이 적혀 있었습니다. "죄송합니다, 잘못했습니다." 학교 현장에서 아이들과 학부모, 동료들 사이에서 온몸으로 책임을 짊어지던 선생님들이, 정작 자신을 지킬 권한은 하나도 갖지 못한 채 스러져갔습니다.</p>
<p>교사유가족협의회는 이 비극이 "그 가정의 개인사"로 묻히지 않도록, 진상을 규명하고 재발을 막기 위해 유가족들과 뜻을 함께한 선생님들이 2023년 8월 직접 만든 단체입니다. 순직 인정 절차의 높은 문턱을 넘는 일, 포렌식과 변호사 비용으로 파산 직전까지 몰리는 유가족을 돕는 일, 본래 국가와 교육청이 해야 할 일들을 지금은 저희가 대신 하고 있습니다.</p>
<p>저희는 화려한 구호보다, 한 분 한 분의 존엄한 기억을 지키고 투명하게 진실을 밝히는 길을 택하겠습니다. 그리고 이 비극이 어떤 교실, 어떤 선생님에게도 다시 반복되지 않는 날까지, 유가족들과 함께 걸어가겠습니다.</p>
<p>여러분의 관심과 연대가 저희에게는 가장 큰 힘이 됩니다.</p>
`.trim(),
  },
  {
    pageKey: "about_greeting_sign",
    title: "협의회 소개 - 인사말 서명",
    contentHtml: `<p style="text-align:right;font-weight:600">교사유가족협의회 대표 박두용 올림</p>`,
  },
  {
    pageKey: "about_vision_card_1",
    title: "협의회 소개 - 비전카드1(진상규명)",
    contentHtml: `
<h3>진상규명과 재발방지</h3>
<p>저희는 교사의 죽음이 "개인의 일"로 묻히지 않도록 진상을 규명하고, 같은 비극이 되풀이되지 않도록 근본 원인을 밝힙니다. 인천 특수교사 사망사건 진상조사위원 활동, 제주 교사 사망사건 유족 대리 등 현장에서 직접 뛰며 목소리를 냅니다.</p>
`.trim(),
  },
  {
    pageKey: "about_vision_card_2",
    title: "협의회 소개 - 비전카드2(유가족지원)",
    contentHtml: `
<h3>유가족 곁에서, 법률·행정·의료 지원</h3>
<p>순직 인정 절차, 포렌식·소송 비용, 심리적 트라우마까지 — 유가족 혼자서는 감당하기 버거운 짐을 함께 짊어집니다. 국가와 교육청이 마땅히 해야 할 지원을, 저희가 먼저 나서서 유가족 곁에 채웁니다.</p>
`.trim(),
  },
  {
    pageKey: "about_vision_card_3",
    title: "협의회 소개 - 비전카드3(교권회복)",
    contentHtml: `
<h3>교권 회복과 교육공동체의 연대</h3>
<p>악성 민원과 근거 없는 고소 앞에 무방비했던 선생님들을 위해 제도 개선을 촉구합니다. 유가족 자녀와 예비 교사들을 위한 학습 공간을 운영하며, 상처 입은 교육공동체가 다시 서로를 신뢰할 수 있도록 연대합니다.</p>
`.trim(),
  },
  {
    pageKey: "about_history",
    title: "협의회 소개 - 연혁",
    contentHtml: `
<div class="history-item"><strong>2023.07</strong><p>서울 서이초등학교 교사 순직 사건 발생</p></div>
<div class="history-item"><strong>2023.08</strong><p>유가족과 뜻을 함께한 교사들이 모여 교사유가족협의회 결성</p></div>
<div class="history-item"><strong>2024.07</strong><p>서이초 순직 교사 1주기 공동추모식 참석(서울시교육청·6개 교원단체 공동주최), 서이초~국회 추모 걷기 및 악성 민원 강력 처벌·교사 유가족 지원법 제정 촉구 기자회견</p></div>
<div class="history-item"><strong>2025</strong><p>인천 특수교사 사망사건 진상조사위원 활동</p></div>
<div class="history-item"><strong>2026.05</strong><p>제주 현직 교사 사망사건 유가족 대리인 지명, 진상조사 촉구 기자회견</p></div>
<div class="history-item"><strong>현재</strong><p>순직 교사 13가구 유가족과 함께, 법률·행정·의료 지원 및 예비교사 학습공간 운영 중</p></div>
`.trim(),
  },
];

export default async function handler(req: Request, _ctx: Context) {
  let step = "start";
  try {
    const url = new URL(req.url);
    const run = url.searchParams.get("run") === "1";
    const keys = SEED.map((s) => s.pageKey);

    step = "diag";
    const existingRows = await db.select({ pageKey: contentPages.pageKey, contentHtml: contentPages.contentHtml })
      .from(contentPages).where(inArray(contentPages.pageKey, keys));
    const filled = existingRows.filter((r) => r.contentHtml && r.contentHtml.trim() !== "").map((r) => r.pageKey);

    if (!run) {
      return new Response(jsonKST({
        ok: true, mode: "diagnose",
        keys,
        already_filled: filled,
        hint: "?run=1 로 실행하면 협의회 소개 페이지(인사말·비전3카드·연혁) 초안이 채워집니다. 이미 값이 있는 키도 덮어씁니다(최신 초안으로 갱신).",
      }, null, 2), { headers: JSON_HEADER });
    }

    step = "auth";
    const auth = await requireAdmin(req);
    if (!auth.ok) return (auth as any).res;
    const adminMemberId = auth.ctx.member.id;

    step = "upsert";
    for (const item of SEED) {
      await db.insert(contentPages)
        .values({
          pageKey: item.pageKey, title: item.title, contentHtml: item.contentHtml,
          updatedBy: adminMemberId,
        } as any)
        .onConflictDoUpdate({
          target: contentPages.pageKey,
          set: {
            title: item.title, contentHtml: item.contentHtml,
            updatedAt: new Date(), updatedBy: adminMemberId,
          } as any,
        });
    }

    return new Response(jsonKST({
      ok: true, mode: "executed",
      seeded: keys,
      hint: "협의회 소개 페이지에 초안이 반영되었습니다. 사이트 빌더에서 다시 다듬을 수 있습니다. 성공 확인 후 이 파일 삭제 + commit.",
    }, null, 2), { headers: JSON_HEADER });
  } catch (err: any) {
    return new Response(jsonKST({
      ok: false, error: "마이그 실패", step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: JSON_HEADER });
  }
}
