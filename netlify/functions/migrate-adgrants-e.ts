// netlify/functions/migrate-adgrants-e.ts
// ★ 1회용 — 광고그랜트 대응 E단계: 실제 사건 사례 시드 (2026-09-03). 호출 성공 후 즉시 삭제.
//
// GET          : 진단 (인증 불필요)
// GET ?run=1   : 어드민 인증 후 실행 (멱등)
//
// 하는 일:
//  ① 실제 사건 사례 3건 추가 — 전부 언론에 널리 보도돼 사실관계가 확정된 사건만.
//     날짜·경위·처분 결과는 보도된 사실 그대로, 확정되지 않은 것은 적지 않았다.
//     - 의정부 호원초등학교 교사 2인 사건 (2021 · 이영승 순직 인정 2023.10 / 김은지 순직 불인정·재조사 요구)
//     - 대전 초등교사 사건 (2023.9 · 4년 악성 민원·아동학대 무혐의 · 순직 인정)
//     - 제주 중학교 현승준 교사 사건 (2025.5 · 협의회가 불송치 이의신청 등 직접 대응 중)
//  ② 서이초 사건 포함 노출 순서 정렬 (최신 사건이 위로)
//  ③ 자료실 메뉴 위치 이동 — D단계에서 최상위 끝에 붙었던 것을 '공지사항'과 같은 묶음으로

import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-adgrants-e" };

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

/* ------------------------------------------------------------------ */
/* 사건 사례 — 널리 보도된 사실만                                          */
/* ------------------------------------------------------------------ */

const INCIDENTS: Array<{
  slug: string;
  title: string;
  summary: string;
  contentHtml: string;
  occurredAt: Date | null;
  location: string;
  sortOrder: number;
}> = [
  {
    slug: "case-2025-jeju-middle",
    title: "2025년 제주 중학교 현승준 교사 사건",
    summary:
      "제주 지역 중학교에서 20여 년 근무한 현승준 교사가 2025년 5월 교내에서 숨진 채 발견된 사건. 유서에는 악성 민원으로 인한 고충이 담긴 것으로 알려졌으며, 교사유가족협의회가 유가족과 함께 진상규명에 직접 대응하고 있습니다.",
    contentHtml: `
<p>2025년 5월, 제주 지역의 한 중학교에서 20여 년간 근무해 온 현승준 교사가 교내에서 숨진 채 발견되었습니다. 유서에는 학생 가족의 악성 민원으로 인한 고충이 담긴 것으로 알려졌습니다.</p>
<p>유가족은 학교 관리자들이 교사 보호 의무를 다하지 않았다며 고소했으나, 경찰은 2026년 관련자들에 대해 불송치 결정을 내렸습니다. 결정문은 직무유기죄 등의 적용 대상이 '공무원'에 한정되는데 사립학교 관리자는 교육공무원 신분이 아니라는 점을 이유로 들었습니다.</p>
<h2>협의회의 대응</h2>
<p>교사유가족협의회는 유가족과 함께 2026년 8월 제주동부경찰서를 찾아 불송치 결정에 대한 이의신청서를 제출했습니다. 이 사건은 사립학교 교원 보호 체계의 공백을 드러낸 사례로, 협의회는 "고인의 죽음이 헛되지 않도록 끝까지 진실을 밝히겠다"는 유가족의 뜻을 함께 하고 있습니다.</p>
<p>협의회는 진상규명 절차 동행, 법률 자문 연계 등으로 유가족 곁을 지키고 있습니다. 관련 소식은 언론보도 게시판에서 확인하실 수 있습니다.</p>
`.trim(),
    occurredAt: null,
    location: "제주특별자치도",
    sortOrder: 10,
  },
  {
    slug: "case-2023-daejeon-elementary",
    title: "2023년 대전 초등학교 교사 사건",
    summary:
      "대전의 24년 차 초등교사가 수년간 학부모 악성 민원에 시달리다 2023년 9월 세상을 떠난 사건. 아동학대 고소로 10여 개월 수사 끝에 무혐의 처분을 받았던 사실이 알려졌고, 이후 순직이 인정되었습니다.",
    contentHtml: `
<p>2023년 9월, 대전의 한 초등학교에서 근무하던 24년 차 교사가 세상을 떠났습니다. 고인은 이전 학교 재직 시절부터 수년간 일부 학부모의 반복된 민원에 시달렸고, 아동학대 혐의로 고소당해 10여 개월간 수사를 받은 끝에 무혐의 처분을 받았던 사실이 알려졌습니다.</p>
<p>서이초 사건 직후였던 이 사건은 악성 민원과 무분별한 아동학대 신고가 교사에게 가하는 고통을 다시 한번 사회에 알렸습니다. 유족의 신청에 따라 인사혁신처는 이후 순직을 인정했습니다.</p>
<p>한편 경찰은 관련 수사 대상자들에 대해 불송치 결정을 내렸고, 교원단체들은 재수사를 촉구했습니다.</p>
<h2>이 사건이 남긴 것</h2>
<p>정당한 교육활동이 아동학대 신고의 대상이 되는 구조, 그리고 반복 민원으로부터 교사를 보호하지 못하는 학교 시스템의 한계가 드러난 사건입니다. 협의회는 같은 아픔이 반복되지 않도록 제도 개선을 요구하는 활동을 이어가고 있습니다.</p>
`.trim(),
    occurredAt: new Date("2023-09-07T00:00:00+09:00"),
    location: "대전광역시",
    sortOrder: 30,
  },
  {
    slug: "case-2021-uijeongbu-howon",
    title: "2021년 의정부 호원초등학교 교사 2인 사건",
    summary:
      "2021년 경기 의정부의 같은 초등학교에서 김은지·이영승 두 교사가 6개월 사이에 세상을 떠난 사건. 학교는 당시 단순 사망으로 보고했으나 2023년 재조명되어 이영승 교사는 순직이 인정되었고, 김은지 교사의 순직 인정 요구는 계속되고 있습니다.",
    contentHtml: `
<p>2021년, 경기도 의정부의 호원초등학교에서 김은지 교사와 이영승 교사가 6개월 사이에 잇따라 세상을 떠났습니다. 학교 측은 당시 두 죽음을 교육청에 단순 사망(추락사 등)으로 보고했고, 사건은 2년 가까이 알려지지 않았습니다.</p>
<p>2023년 서이초 사건을 계기로 언론 보도를 통해 재조명되면서, 이영승 교사가 학부모들의 악성 민원에 장기간 시달렸다는 사실이 드러났습니다. 2023년 10월 인사혁신처는 이영승 교사의 순직을 인정했습니다.</p>
<p>김은지 교사에 대해서는 순직이 인정되지 않았고, 교원단체들은 부실했던 초기 조사를 지적하며 재조사와 순직 인정을 계속 요구하고 있습니다. 한편 경찰은 2024년 괴롭힘 의혹이 제기된 학부모들에 대해 무혐의 처분을 내렸습니다.</p>
<h2>이 사건이 남긴 것</h2>
<p>교사의 죽음이 '단순 사망'으로 처리되어 묻힐 뻔했던 이 사건은, 진상규명이 유가족만의 힘으로는 얼마나 어려운지를 보여줍니다. 협의회가 유가족의 곁에서 기록하고 함께 싸우는 이유입니다.</p>
`.trim(),
    occurredAt: null,
    location: "경기도 의정부시",
    sortOrder: 40,
  },
];

/* 서이초(기존)를 최신순 정렬에 맞춰 두 번째 자리로 */
const SEOICHO_SORT = 20;

export default async (req: Request) => {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  const { db } = await import("../../db");
  const schema = await import("../../db/schema");
  const { and, eq, inArray } = await import("drizzle-orm");

  if (!run) {
    try {
      const rows = await db
        .select({ slug: schema.incidents.slug, status: schema.incidents.status, sortOrder: schema.incidents.sortOrder })
        .from(schema.incidents)
        .where(eq(schema.incidents.status, "active"));
      const [menu] = await db
        .select({ id: schema.navMenuItems.id, parentId: schema.navMenuItems.parentId, sortOrder: schema.navMenuItems.sortOrder })
        .from(schema.navMenuItems)
        .where(and(eq(schema.navMenuItems.menuLocation, "header"), eq(schema.navMenuItems.label, "자료실")))
        .limit(1);
      return json({ ok: true, mode: "진단", 공개사건: rows, 자료실메뉴: menu || null, 실행: "?run=1 (어드민 로그인 필요)" });
    } catch (e: any) {
      return json({ ok: false, step: "diag", detail: String(e?.message || e).slice(0, 500) }, 500);
    }
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  const done: Record<string, any> = {};

  /* ① 실제 사건 3건 (slug 존재 시 건너뜀 — 멱등) */
  try {
    const added: string[] = [];
    for (const it of INCIDENTS) {
      const [exist] = await db
        .select({ id: schema.incidents.id })
        .from(schema.incidents)
        .where(eq(schema.incidents.slug, it.slug))
        .limit(1);
      if (exist) continue;
      await db.insert(schema.incidents).values({
        slug: it.slug,
        title: it.title,
        summary: it.summary,
        contentHtml: it.contentHtml,
        occurredAt: it.occurredAt,
        location: it.location,
        category: "school",
        status: "active",
        sortOrder: it.sortOrder,
      } as any);
      added.push(it.slug);
    }
    done["1_사건_추가"] = added;
  } catch (e: any) {
    return json({ ok: false, step: "incidents", detail: String(e?.message || e).slice(0, 500), stack: String(e?.stack || "").slice(0, 1000) }, 500);
  }

  /* ② 서이초 노출 순서 정렬 */
  try {
    await db
      .update(schema.incidents)
      .set({ sortOrder: SEOICHO_SORT, updatedAt: new Date() } as any)
      .where(eq(schema.incidents.slug, "case-2023-seoul-elementary"));
    done["2_서이초_정렬"] = SEOICHO_SORT;
  } catch (e: any) {
    return json({ ok: false, step: "seoicho_sort", detail: String(e?.message || e).slice(0, 500) }, 500);
  }

  /* ③ 자료실 메뉴를 '공지사항'과 같은 묶음으로 이동 (D단계에서 최상위 끝에 붙었음) */
  try {
    const [res] = await db
      .select({ id: schema.navMenuItems.id, parentId: schema.navMenuItems.parentId })
      .from(schema.navMenuItems)
      .where(and(eq(schema.navMenuItems.menuLocation, "header"), eq(schema.navMenuItems.label, "자료실")))
      .limit(1);
    const [notice] = await db
      .select({ id: schema.navMenuItems.id, parentId: schema.navMenuItems.parentId, sortOrder: schema.navMenuItems.sortOrder })
      .from(schema.navMenuItems)
      .where(and(eq(schema.navMenuItems.menuLocation, "header"), eq(schema.navMenuItems.label, "공지사항")))
      .limit(1);
    if (res && notice && notice.parentId != null && res.parentId !== notice.parentId) {
      await db
        .update(schema.navMenuItems)
        .set({ parentId: notice.parentId, sortOrder: Number(notice.sortOrder || 0) + 25, updatedAt: new Date() } as any)
        .where(eq(schema.navMenuItems.id, res.id));
      done["3_자료실_메뉴이동"] = `공지사항 묶음(parent ${notice.parentId})으로`;
    } else {
      done["3_자료실_메뉴이동"] = res ? "이미 제자리거나 기준 메뉴 없음 — 건너뜀" : "자료실 메뉴 없음";
    }
  } catch (e: any) {
    return json({ ok: false, step: "nav_menu", detail: String(e?.message || e).slice(0, 500) }, 500);
  }

  return json({ ok: true, mode: "실행 완료", 결과: done, 다음: "이 파일을 삭제하고 커밋하세요 (1회용)" });
};
