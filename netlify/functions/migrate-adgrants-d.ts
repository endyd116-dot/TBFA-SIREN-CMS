// netlify/functions/migrate-adgrants-d.ts
// ★ 1회용 — 구글 광고그랜트 재심사 대응 D단계 (2026-09-03). 호출 성공 후 즉시 삭제.
//
// GET          : 진단 (현재 상태만 보여줌 — 인증 불필요)
// GET ?run=1   : 어드민 인증 후 실제 실행 (멱등 — 다시 불러도 중복 생성 없음)
//
// 하는 일:
//  ① 개발 시드로 남아 있던 가공(데모) 사건 사례 4건 비공개 — 실재 확인 불가한
//     "부산·대구·인천·광주 교사 사건"이 실사이트에 사실처럼 게시돼 있었다 (신뢰성 훼손).
//  ② 서이초 사건(실제 사건)에 본문·발생일 채움 — 널리 보도된 사실만 절제된 톤으로.
//  ③ 자유게시판 테스트 글("자유롭게"/박새로이) 숨김 — 검색엔진 제출 목록에까지 올라 있었다.
//  ④ 공지 5건 시드 (전부 사이트 기능·제도 안내 — 사실 기반).
//  ⑤ 활동보고서 1건 시드 (이미 게시된 실제 활동만 요약 — report.html이 비어 있던 문제).
//  ⑥ 자료실 공개 자료 3건 시드 (글 자료 — 자료실 메뉴·사이트맵 복원과 한 세트).
//  ⑦ 조직도 페이지(/p/organization) 검색 설명문 지정 — "지도를 불러오는 중…"이
//     검색 결과 설명으로 나가던 문제의 데이터 측 보완.
//  ⑧ 상단 메뉴에 자료실 복원 (nav_menu_items — 없으면 자유게시판 옆에 추가).

import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-adgrants-d" };

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

/* ------------------------------------------------------------------ */
/* 시드 본문 (전부 사실 기반 — 지어낸 수치·행사 없음)                       */
/* ------------------------------------------------------------------ */

const SEOICHO_CONTENT = `
<p>2023년 7월 18일, 서울 서초구의 한 초등학교에서 저연차 담임 교사가 교내에서 세상을 떠났습니다. 이 사건은 학부모 민원 등 교권 침해 문제를 우리 사회가 정면으로 마주하게 된 계기가 되었습니다.</p>
<p>사건 이후 전국의 교사들이 추모에 나섰고, 교육활동 보호와 공교육 정상화를 요구하는 목소리가 이어졌습니다. 2024년 2월, 인사혁신처는 해당 교사의 순직을 인정했습니다.</p>
<h2>이 사건이 협의회에 갖는 의미</h2>
<p>교사유가족협의회는 이 사건을 비롯해 교단에서 가족을 잃은 유가족들이 서로를 지지하고, 진상규명과 제도 개선을 함께 요구하기 위해 모인 단체입니다. 남겨진 가족이 혼자 감당하지 않도록 심리·법률·생활 영역의 동행을 이어가고 있습니다.</p>
<p>비슷한 아픔을 겪고 계신 유가족께서는 언제든 협의회에 연락해 주세요. 모든 상담은 비밀이 보장됩니다.</p>
`.trim();

const NOTICES: Array<{ category: string; title: string; content: string }> = [
  {
    category: "general",
    title: "교사유가족협의회 통합 홈페이지 이용 안내",
    content: `
<p>(사)교사유가족협의회 통합 홈페이지에서는 다음 서비스를 이용하실 수 있습니다.</p>
<ul>
<li><b>후원</b> — 정기·일시 후원 신청과 기부금 영수증 발급 (마이페이지)</li>
<li><b>유가족 지원</b> — 심리상담·법률자문·장학사업 신청</li>
<li><b>SIREN 신고센터</b> — 사건 제보·괴롭힘 신고·법률 상담 (익명 가능)</li>
<li><b>추모관</b> — 먼저 떠난 선생님들을 기억하는 공간</li>
<li><b>소식</b> — 공지사항·언론보도·활동 내용·자주 묻는 질문</li>
</ul>
<p>이용 중 불편한 점은 하단 연락처로 알려주시면 빠르게 개선하겠습니다.</p>
`.trim(),
  },
  {
    category: "event",
    title: "기부금 영수증 발급 및 연말정산 등재 안내",
    content: `
<p>교사유가족협의회는 기부금 영수증 발급이 가능한 비영리 사단법인입니다.</p>
<ul>
<li>후원 회원은 <b>마이페이지</b>에서 기부금 영수증(PDF)을 직접 발급할 수 있습니다.</li>
<li>기부 내역은 국세청 연말정산 간소화 서비스에 등재됩니다.</li>
<li>계좌이체 후원의 경우 입금자명 확인 후 반영되며, 1~3일이 소요될 수 있습니다.</li>
</ul>
<p>영수증 관련 문의는 홈페이지 하단 연락처로 부탁드립니다.</p>
`.trim(),
  },
  {
    category: "event",
    title: "유가족 지원 프로그램 신청 안내 (심리상담·법률자문·장학)",
    content: `
<p>협의회는 교단에서 가족을 잃은 유가족을 위해 다음 지원을 운영합니다.</p>
<ul>
<li><b>심리 상담 지원</b> — 전문 상담 연계. 홈페이지 [지원 신청하기]에서 신청</li>
<li><b>법률 자문</b> — 순직 인정·소송 등 법률 절차 자문 연계</li>
<li><b>장학 사업</b> — 유자녀 장학 지원</li>
</ul>
<p>신청 내용과 첨부 서류는 암호화되어 안전하게 보관되며, 모든 상담은 비밀이 보장됩니다. 순직 인정 여부와 관계없이 상담 신청이 가능합니다.</p>
`.trim(),
  },
  {
    category: "general",
    title: "SIREN 신고센터 이용 안내 — 익명 제보 가능",
    content: `
<p>SIREN 신고센터는 교육 현장의 사건 제보, 직장 내 괴롭힘 신고, 법률 상담 요청을 받는 창구입니다.</p>
<ul>
<li>회원가입 없이 <b>익명으로 제보</b>할 수 있습니다.</li>
<li>접수된 내용은 담당자만 열람하며, 제보자 보호를 최우선으로 합니다.</li>
<li>목록에 없는 사건도 제보하실 수 있습니다.</li>
</ul>
<p>긴급한 위기 상황이라면 자살예방 상담전화 109(24시간)로 먼저 연락해 주세요.</p>
`.trim(),
  },
  {
    category: "event",
    title: "정기후원 안내 — 매월 자동결제로 함께하기",
    content: `
<p>정기후원은 유가족 지원 활동을 지속 가능하게 만드는 가장 큰 힘입니다.</p>
<ul>
<li><b>신용카드 자동결제</b> — 카드 정보 1회 등록 후 매월 자동 결제</li>
<li><b>계좌 자동이체(CMS)</b> — 계좌 등록·본인인증 후 매월 지정일 출금</li>
<li><b>일시 후원</b> — 원하실 때 한 번만 후원</li>
</ul>
<p>후원 금액과 결제 수단은 마이페이지에서 언제든 변경·해지할 수 있으며, 후원금 사용 내역은 활동보고서를 통해 공개합니다.</p>
`.trim(),
  },
];

const REPORT_SLUG = "report-2026-jan-aug";
const REPORT_CONTENT = `
<p>교사유가족협의회의 2026년 1월부터 8월까지의 주요 활동을 보고드립니다. 본 보고서는 홈페이지에 게시된 활동 내용을 기준으로 작성되었습니다.</p>
<h2>주요 활동</h2>
<ul>
<li><b>사단법인 창립총회 개최 (6월)</b> — 임의단체로 활동해 온 협의회가 사단법인 체제로 전환하기 위한 창립총회를 개최했습니다. 이후 사단법인 설립허가증을 발급받아 법인으로서의 활동 기반을 갖추었습니다.</li>
<li><b>유가족 심리 안정 케어팜 치유 프로그램 (8월)</b> — 유가족의 심리적 회복을 돕는 치유 프로그램을 진행했습니다.</li>
<li><b>제주동부경찰서 불송치 결정 이의신청서 제출 동행 (8월)</b> — 유가족과 함께 불송치 결정에 대한 이의신청서를 제출하고 언론에 알렸습니다.</li>
<li><b>제주 교육청과의 정책 협약</b> — 교육 현장의 제도 개선을 위한 협약을 체결했습니다.</li>
</ul>
<h2>상시 운영</h2>
<ul>
<li>유가족 심리상담·법률자문·장학 지원 접수 및 연계</li>
<li>SIREN 신고센터(사건 제보·괴롭힘 신고·법률 상담) 운영</li>
<li>추모관 운영 — 먼저 떠난 선생님들을 기억하는 온라인 공간</li>
</ul>
<p>후원금은 유가족 지원 사업과 협의회 운영에 사용되며, 정식 결산 보고는 회계연도 종료 후 공개됩니다. 함께해 주시는 모든 분들께 감사드립니다.</p>
`.trim();

const RESOURCES: Array<{ slug: string; title: string; description: string; content: string }> = [
  {
    slug: "about-tbfa",
    title: "교사유가족협의회 소개 자료",
    description: "협의회의 설립 배경·목적·주요 사업을 정리한 소개 자료입니다.",
    content: `
<h2>단체 개요</h2>
<p>(사)교사유가족협의회는 교단에서 가족을 잃은 유가족들이 모여 만든 비영리 사단법인입니다. 2024년 11월 공식 출범했으며, 2026년 사단법인 설립허가를 받았습니다.</p>
<h2>설립 목적</h2>
<p>남겨진 유가족이 혼자 감당하지 않도록 서로를 지지하고, 사건의 진상규명과 교육 현장의 제도 개선을 요구하며, 먼저 떠난 선생님들을 기억하는 것입니다.</p>
<h2>주요 사업</h2>
<ul>
<li>유가족 지원 — 심리상담·법률자문·장학사업</li>
<li>SIREN 신고센터 — 사건 제보·괴롭힘 신고·법률 상담(익명 가능)</li>
<li>추모 사업 — 온라인 추모관 운영</li>
<li>진상규명·제도개선 활동 — 이의신청 동행, 교육청 정책 협약 등</li>
</ul>
<h2>연락처</h2>
<p>주소: 서울특별시 강서구 공항대로 426 · 홈페이지: tbfa.co.kr</p>
`.trim(),
  },
  {
    slug: "donation-guide",
    title: "후원 안내 — 정기·일시 후원과 기부금 영수증",
    description: "후원 방법(정기·일시·계좌이체)과 기부금 영수증 발급 절차 안내입니다.",
    content: `
<h2>후원 방법</h2>
<ul>
<li><b>정기 후원</b> — 신용카드 자동결제 또는 계좌 자동이체(CMS). 매월 자동으로 후원됩니다.</li>
<li><b>일시 후원</b> — 신용카드·간편결제로 원하실 때 한 번 후원합니다.</li>
<li><b>직접 계좌이체</b> — 안내된 계좌로 직접 이체(입금자명 확인 후 1~3일 내 반영).</li>
</ul>
<h2>기부금 영수증</h2>
<p>후원 회원은 마이페이지에서 기부금 영수증(PDF)을 직접 발급할 수 있으며, 기부 내역은 국세청 연말정산 간소화 서비스에 등재됩니다.</p>
<h2>후원금 사용</h2>
<p>후원금은 유가족 심리·법률·장학 지원과 협의회 운영에 사용되며, 사용 내역은 활동보고서로 공개합니다.</p>
`.trim(),
  },
  {
    slug: "family-support-guide",
    title: "유가족 지원 프로그램 안내",
    description: "심리상담·법률자문·장학사업 등 유가족 지원 프로그램의 내용과 신청 방법입니다.",
    content: `
<h2>지원 대상</h2>
<p>교단에서 가족을 잃은 유가족 누구나 신청할 수 있습니다. 순직 인정 여부와 관계없이 상담이 가능합니다.</p>
<h2>지원 내용</h2>
<ul>
<li><b>심리 상담</b> — 전문 상담 연계를 통한 심리 회복 지원</li>
<li><b>법률 자문</b> — 순직 인정 절차·소송 등 법률 대응 자문</li>
<li><b>장학 사업</b> — 유자녀 장학 지원</li>
</ul>
<h2>신청 방법</h2>
<p>홈페이지의 [지원 신청하기]에서 지원 유형을 선택해 신청합니다. 신청 내용과 첨부 서류는 암호화되어 안전하게 보관되며, 모든 상담은 비밀이 보장됩니다. 영업일 기준 3일 이내에 결과를 안내드립니다.</p>
`.trim(),
  },
];

const ORG_SEO_DESCRIPTION =
  "(사)교사유가족협의회의 조직 구성과 오시는 길 안내 — 서울특별시 강서구 공항대로 426.";

/* 가공(데모) 사건 slug — 실재 확인 불가, 비공개 처리 대상 */
const DEMO_INCIDENT_SLUGS = [
  "case-2024-busan-middle",
  "case-2024-daegu-high",
  "case-2025-incheon-special",
  "case-2025-gwangju-elementary",
];

/* ------------------------------------------------------------------ */

export default async (req: Request) => {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  const { db } = await import("../../db");
  const schema = await import("../../db/schema");
  const { and, eq, inArray } = await import("drizzle-orm");

  /* ---------- 진단 (인증 불필요) ---------- */
  if (!run) {
    try {
      const demo = await db
        .select({ slug: schema.incidents.slug, status: schema.incidents.status })
        .from(schema.incidents)
        .where(inArray(schema.incidents.slug, DEMO_INCIDENT_SLUGS));
      const noticeCnt = await db.select({ id: schema.notices.id }).from(schema.notices);
      const resourceCnt = await db.select({ id: schema.resources.id }).from(schema.resources);
      return json({
        ok: true,
        mode: "진단",
        데모사건: demo,
        공지수: noticeCnt.length,
        자료수: resourceCnt.length,
        실행: "?run=1 (어드민 로그인 필요)",
      });
    } catch (e: any) {
      return json({ ok: false, step: "diag", detail: String(e?.message || e).slice(0, 500) }, 500);
    }
  }

  /* ---------- 실행 (어드민 인증) ---------- */
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  const done: Record<string, any> = {};

  /* ① 데모 사건 4건 비공개 */
  try {
    const r = await db
      .update(schema.incidents)
      .set({ status: "hidden", updatedAt: new Date() } as any)
      .where(
        and(
          inArray(schema.incidents.slug, DEMO_INCIDENT_SLUGS),
          eq(schema.incidents.status, "active")
        )
      )
      .returning({ slug: schema.incidents.slug });
    done["1_데모사건_비공개"] = r.map((x) => x.slug);
  } catch (e: any) {
    return json({ ok: false, step: "hide_demo_incidents", detail: String(e?.message || e).slice(0, 500), stack: String(e?.stack || "").slice(0, 1000) }, 500);
  }

  /* ② 서이초 사건 본문 채움 (본문이 비어 있을 때만 — 운영자가 이미 채웠으면 존중) */
  try {
    const [row] = await db
      .select({ id: schema.incidents.id, contentHtml: schema.incidents.contentHtml })
      .from(schema.incidents)
      .where(eq(schema.incidents.slug, "case-2023-seoul-elementary"))
      .limit(1);
    if (row && !row.contentHtml) {
      await db
        .update(schema.incidents)
        .set({
          title: "2023년 서울 서이초등학교 교사 사건",
          summary:
            "2023년 7월 서울 서초구 초등학교에서 담임 교사가 세상을 떠난 사건. 교권 침해 문제가 사회적으로 공론화되는 계기가 되었고, 2024년 2월 순직이 인정되었습니다.",
          contentHtml: SEOICHO_CONTENT,
          occurredAt: new Date("2023-07-18T00:00:00+09:00"),
          updatedAt: new Date(),
        } as any)
        .where(eq(schema.incidents.id, row.id));
      done["2_서이초_본문"] = "채움";
    } else {
      done["2_서이초_본문"] = row ? "이미 본문 있음 — 건너뜀" : "행 없음";
    }
  } catch (e: any) {
    return json({ ok: false, step: "seoicho", detail: String(e?.message || e).slice(0, 500) }, 500);
  }

  /* ③ 자유게시판 테스트 글 숨김 */
  try {
    const r = await db
      .update(schema.boardPosts)
      .set({ isHidden: true, updatedAt: new Date() } as any)
      .where(
        and(
          eq(schema.boardPosts.title, "자유롭게"),
          eq(schema.boardPosts.authorName, "박새로이"),
          eq(schema.boardPosts.isHidden, false)
        )
      )
      .returning({ id: schema.boardPosts.id });
    done["3_테스트게시글_숨김"] = r.map((x) => x.id);
  } catch (e: any) {
    return json({ ok: false, step: "hide_test_post", detail: String(e?.message || e).slice(0, 500) }, 500);
  }

  /* ④ 공지 5건 (제목 중복 시 건너뜀 — 멱등) */
  try {
    const added: string[] = [];
    for (const n of NOTICES) {
      const [exist] = await db
        .select({ id: schema.notices.id })
        .from(schema.notices)
        .where(eq(schema.notices.title, n.title))
        .limit(1);
      if (exist) continue;
      await db.insert(schema.notices).values({
        category: n.category,
        title: n.title,
        content: n.content,
        authorName: "관리자",
        isPublished: true,
      } as any);
      added.push(n.title);
    }
    done["4_공지_추가"] = added;
  } catch (e: any) {
    return json({ ok: false, step: "notices", detail: String(e?.message || e).slice(0, 500) }, 500);
  }

  /* ⑤ 활동보고서 1건 */
  try {
    const [exist] = await db
      .select({ id: schema.activityPosts.id })
      .from(schema.activityPosts)
      .where(eq(schema.activityPosts.slug, REPORT_SLUG))
      .limit(1);
    if (!exist) {
      await db.insert(schema.activityPosts).values({
        slug: REPORT_SLUG,
        year: 2026,
        month: 8,
        category: "report",
        title: "2026년 주요 활동 보고 (1월~8월)",
        summary:
          "사단법인 창립총회, 케어팜 치유 프로그램, 불송치 이의신청 동행 등 2026년 1~8월 주요 활동을 정리한 보고서입니다.",
        contentHtml: REPORT_CONTENT,
        isPublished: true,
      } as any);
      done["5_활동보고서"] = REPORT_SLUG;
    } else {
      done["5_활동보고서"] = "이미 있음 — 건너뜀";
    }
  } catch (e: any) {
    return json({ ok: false, step: "report", detail: String(e?.message || e).slice(0, 500) }, 500);
  }

  /* ⑥ 자료실 3건 */
  try {
    const added: string[] = [];
    for (const r of RESOURCES) {
      const [exist] = await db
        .select({ id: schema.resources.id })
        .from(schema.resources)
        .where(eq(schema.resources.slug, r.slug))
        .limit(1);
      if (exist) continue;
      await db.insert(schema.resources).values({
        slug: r.slug,
        title: r.title,
        description: r.description,
        contentHtml: r.content,
        accessLevel: "public",
        isPublished: true,
      } as any);
      added.push(r.slug);
    }
    done["6_자료실_추가"] = added;
  } catch (e: any) {
    return json({ ok: false, step: "resources", detail: String(e?.message || e).slice(0, 500) }, 500);
  }

  /* ⑦ 조직도 페이지 검색 설명문 (비어 있을 때만) */
  try {
    const [page] = await db
      .select({ id: schema.sitePages.id, seoDescription: schema.sitePages.seoDescription })
      .from(schema.sitePages)
      .where(eq(schema.sitePages.slug, "organization"))
      .limit(1);
    if (page && !page.seoDescription) {
      await db
        .update(schema.sitePages)
        .set({ seoDescription: ORG_SEO_DESCRIPTION, updatedAt: new Date() } as any)
        .where(eq(schema.sitePages.id, page.id));
      done["7_조직도_검색설명"] = "지정";
    } else {
      done["7_조직도_검색설명"] = page ? "이미 있음 — 건너뜀" : "행 없음";
    }
  } catch (e: any) {
    return json({ ok: false, step: "org_seo", detail: String(e?.message || e).slice(0, 500) }, 500);
  }

  /* ⑧ 상단 메뉴 자료실 복원 — 있으면 활성화, 없으면 자유게시판과 같은 묶음에 추가 */
  try {
    const [exist] = await db
      .select({ id: schema.navMenuItems.id, isActive: schema.navMenuItems.isActive })
      .from(schema.navMenuItems)
      .where(
        and(eq(schema.navMenuItems.menuLocation, "header"), eq(schema.navMenuItems.label, "자료실"))
      )
      .limit(1);
    if (exist) {
      if (!exist.isActive) {
        await db
          .update(schema.navMenuItems)
          .set({ isActive: true, href: "/resources.html", updatedAt: new Date() } as any)
          .where(eq(schema.navMenuItems.id, exist.id));
        done["8_자료실_메뉴"] = "다시 켬";
      } else {
        done["8_자료실_메뉴"] = "이미 켜져 있음";
      }
    } else {
      const [board] = await db
        .select({
          parentId: schema.navMenuItems.parentId,
          sortOrder: schema.navMenuItems.sortOrder,
        })
        .from(schema.navMenuItems)
        .where(
          and(
            eq(schema.navMenuItems.menuLocation, "header"),
            eq(schema.navMenuItems.label, "자유게시판")
          )
        )
        .limit(1);
      await db.insert(schema.navMenuItems).values({
        parentId: board?.parentId ?? null,
        menuLocation: "header",
        label: "자료실",
        href: "/resources.html",
        sortOrder: board?.sortOrder != null ? Number(board.sortOrder) - 1 : 90,
        isActive: true,
      } as any);
      done["8_자료실_메뉴"] = board ? "자유게시판 옆에 추가" : "메뉴 끝에 추가";
    }
  } catch (e: any) {
    return json({ ok: false, step: "nav_menu", detail: String(e?.message || e).slice(0, 500) }, 500);
  }

  return json({ ok: true, mode: "실행 완료", 결과: done, 다음: "이 파일을 삭제하고 커밋하세요 (1회용)" });
};
