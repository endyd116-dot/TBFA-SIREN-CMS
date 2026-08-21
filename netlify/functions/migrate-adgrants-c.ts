// netlify/functions/migrate-adgrants-c.ts
// ★ 2026-08-21 (구글 광고그랜트 심사 대응 C단계) — 1회용
//
// 후원 전용 페이지(/p/donate)를 만든다.
//
// 왜 필요한가
//   구글 광고그랜트 웹사이트 정책 원문: "Donation links must work and go to a
//   secure page dedicated to donations." — 후원 링크는 '후원 전용 페이지'로 가야 한다.
//   지금 후원은 홈에서 뜨는 창(모달)뿐이라 후원만을 위한 고유 주소가 없다.
//   광고를 태울 착지 지점도 없다.
//
// 어떻게
//   운영자가 어드민(페이지 관리)에서 계속 고칠 수 있도록 CMS 페이지로 만든다.
//   본문의 {{donate}} 자리는 화면에서 '지금 쓰는 후원 창'을 여는 버튼이 된다 —
//   결제 흐름은 하나도 새로 만들지 않는다(기존 창과 완전히 같은 순서).
//
// 호출: https://tbfa.co.kr/api/migrate-adgrants-c?run=1  (어드민 로그인 상태)
//       GET 만 하면 진단 (인증 불필요)
// 호출 성공 후 이 파일은 삭제한다.

import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sitePages, resources, faqs, incidents } from "../../db/schema";
import { eq } from "drizzle-orm";

export const config = { path: "/api/migrate-adgrants-c" };

const SLUG = "donate";

/* 초안 — 운영자가 어드민에서 그대로 고칠 수 있다.
   확인되지 않은 숫자(통계·모금액)는 일부러 넣지 않았다. 사실만 적는다. */
const CONTENT_HTML = `
<h3>선생님이 안전해야 아이들이 안전합니다</h3>
<p>
  교사유가족협의회는 학교에서 세상을 떠난 선생님들의 유가족이 모여 만든 비영리 단체입니다.
  남겨진 가족이 홀로 감당해야 했던 진상규명과 순직 인정, 그리고 회복의 과정을
  더는 혼자 겪지 않도록 곁에서 함께 걷습니다.
</p>
<p>
  저희의 활동은 회원과 시민 여러분의 후원으로 이어집니다.
  후원해 주신 마음은 아래의 일에 쓰입니다.
</p>

<h3>후원금이 하는 일</h3>
<ul>
  <li><strong>심리 상담 지원</strong> — 전문 상담사가 함께하는 유가족 1:1 정서 회복 프로그램</li>
  <li><strong>법률 자문</strong> — 진상규명·순직 인정 절차에 필요한 변호사 자문과 서면 지원</li>
  <li><strong>장학 사업</strong> — 유가족 자녀를 위한 학기별 장학금과 학습 멘토링</li>
  <li><strong>추모 사업</strong> — 정기 추모식과 온라인 추모관 운영</li>
  <li><strong>제도 개선</strong> — 교사 순직 인정과 유가족 지원 체계를 바로 세우기 위한 활동</li>
</ul>

<h3>후원 방법</h3>
<p>
  아래 버튼을 누르시면 후원 창이 열립니다.
  <strong>매달 이어지는 정기 후원</strong>과 <strong>한 번만 하는 일시 후원</strong> 가운데 고르실 수 있습니다.
</p>
<ul>
  <li>신용카드 · 간편결제</li>
  <li>계좌 자동이체 (매달 지정한 날에 자동 출금)</li>
  <li>직접 계좌이체 (입금자명을 정확히 적어 주세요)</li>
</ul>

{{donate}}

<blockquote>
  정기 후원은 언제든 <strong>마이페이지 &gt; 내 후원 내역</strong>에서 직접 해지하실 수 있으며, 위약금이 없습니다.
</blockquote>

<h3>기부금 영수증</h3>
<p>
  교사유가족협의회에 보내주신 후원금은 연말정산 기부금 공제 대상입니다.
  매년 1월 국세청 연말정산 간소화 서비스에 자동으로 올라가며,
  <strong>마이페이지 &gt; 증명서 발급</strong>에서 언제든 직접 내려받으실 수 있습니다.
</p>

<h3>투명하게 씁니다</h3>
<p>
  후원금이 어디에 쓰였는지는 <a href="/activities.html">활동 보고</a>에서 확인하실 수 있습니다.
  현장에서 무엇을 했는지 사진과 함께 기록해 두고 있습니다.
</p>

<h3>문의</h3>
<p>
  후원과 관련해 궁금한 점은 언제든 연락 주세요.<br>
  전화 010-2807-5242 · 이메일 info@tbfa.co.kr<br>
  사단법인 교사유가족협의회 (고유번호 118-82-71215)
</p>
`.trim();

const PAGE = {
  slug: SLUG,
  title: "후원하기",
  eyebrow: "SUPPORT US",
  subtitle: "여러분의 후원이 남겨진 가족의 내일이 됩니다",
  contentHtml: CONTENT_HTML,
  status: "published",
  layout: "default",
  seoTitle: "후원하기 | 교사유가족협의회",
  seoDescription:
    "교사유가족협의회 후원 안내 — 정기·일시 후원, 심리상담·법률자문·장학·추모 사업에 쓰입니다. 기부금 영수증 발급 안내.",
  sortOrder: 50,
};

/* 자주 묻는 질문 보충 초안 — 사이트에 이미 적혀 있는 사실만 옮겨 적었다.
   (추측·확인 안 된 숫자는 넣지 않았다. 운영자가 어드민에서 고칠 수 있다.) */
const FAQ_DRAFTS: Array<{ category: string; question: string; answer: string; sortOrder: number }> = [
  {
    category: "support",
    question: "유가족 지원은 순직 인정을 받아야만 받을 수 있나요?",
    answer:
      "아닙니다. 교사유가족협의회의 유가족 지원 사업은 순직 인정 여부와 관계없이 사건이 일어난 그날부터 곁을 지킵니다. 심리·생활·행정 지원을 함께 제공하며, 모든 상담은 비밀이 보장됩니다.",
    sortOrder: 20,
  },
  {
    category: "support",
    question: "심리 상담은 어떻게 신청하나요?",
    answer:
      "유가족 지원 화면에서 '신청하기'를 누르시면 신청 창이 열립니다. 접수 후 사무국이 확인하여 전문 상담사를 배정해 드리며, 진행 상황은 마이페이지의 신청 내역에서 확인하실 수 있습니다.",
    sortOrder: 21,
  },
  {
    category: "support",
    question: "제보나 신고를 익명으로 할 수 있나요?",
    answer:
      "가능합니다. 사건 제보와 악성 민원 신고는 익명으로 접수하실 수 있으며, 제보자의 안전과 신원 보호를 위해 협의회가 최선을 다합니다. 접수된 내용은 1차 검토를 거쳐 운영진이 확인한 뒤 답변드립니다.",
    sortOrder: 30,
  },
  {
    category: "support",
    question: "제 사건이 목록에 없는데 제보하고 싶습니다.",
    answer:
      "사건 목록에 없는 사안은 1:1 상담으로 접수해 주세요. 사건 제보 화면 아래의 '1:1 상담 신청'을 이용하시면 됩니다.",
    sortOrder: 31,
  },
  {
    category: "donation",
    question: "후원 금액이나 결제 수단을 바꿀 수 있나요?",
    answer:
      "마이페이지의 내 후원 내역에서 언제든 확인·변경하실 수 있습니다. 정기 후원 해지도 같은 화면에서 바로 가능하며 위약금이 없습니다.",
    sortOrder: 22,
  },
  {
    category: "donation",
    question: "계좌이체로도 후원할 수 있나요?",
    answer:
      "네. 후원 창에서 카드·간편결제 외에 계좌 자동이체와 직접 계좌이체를 고르실 수 있습니다. 직접 이체하실 때는 확인이 늦어지지 않도록 입금자명을 정확히 적어 주세요.",
    sortOrder: 23,
  },
  {
    category: "general",
    question: "추모관에 글을 남기려면 회원가입을 해야 하나요?",
    answer:
      "아닙니다. 온라인 추모관에서는 로그인 없이도 촛불이나 국화를 올리고 추모의 마음을 남기실 수 있습니다.",
    sortOrder: 12,
  },
  {
    category: "general",
    question: "교사유가족협의회는 어떤 단체인가요?",
    answer:
      "학교에서 세상을 떠난 선생님들의 유가족이 모여 만든 사단법인 비영리 단체입니다. 진상규명과 순직 인정을 돕고, 남겨진 가족의 심리·법률·학업을 지원하며, 같은 일이 되풀이되지 않도록 제도 개선을 위해 활동합니다.",
    sortOrder: 10,
  },
];

/** 자주 묻는 질문 보충 — 같은 질문이 이미 있으면 넣지 않는다 */
async function seedFaqs(): Promise<string> {
  try {
    const existing = await db.select({ question: faqs.question }).from(faqs);
    const have = new Set(existing.map((r) => String(r.question || "").trim()));
    const toAdd = FAQ_DRAFTS.filter((f) => !have.has(f.question));
    if (toAdd.length === 0) return "이미 다 있어서 넣지 않았습니다";

    await db.insert(faqs).values(toAdd.map((f) => ({ ...f, isActive: true })) as any);
    return `${toAdd.length}건 추가`;
  } catch (err: any) {
    return "자주 묻는 질문 추가 실패 — " + String(err?.message || err).slice(0, 200);
  }
}

/** 자료실에 남아 있던 시험용 자료를 공개 목록에서 내린다.
 *  ★ 왜: 자료실의 유일한 공개 자료가 제목 "534314" / 설명 "123124123" 이었다.
 *  심사자가 열어보면 관리되지 않는 사이트로 읽힌다.
 *  지우지 않고 '비공개'로만 돌린다 — 되돌릴 수 있어야 안전하다.
 *  실수 방지를 위해 '제목이 숫자뿐인 자료'만 대상으로 한다. */
async function hideJunkResources(): Promise<string> {
  try {
    const rows = await db
      .select({ id: resources.id, title: resources.title })
      .from(resources)
      .where(eq(resources.isPublished, true));

    const junk = rows.filter((r) => /^[0-9\s]+$/.test(String(r.title || "").trim()));
    if (junk.length === 0) return "정리할 시험 자료가 없습니다";

    for (const r of junk) {
      await db.update(resources).set({ isPublished: false } as any).where(eq(resources.id, r.id));
    }
    return `${junk.length}건 비공개 처리 (제목: ${junk.map((r) => r.title).join(", ")})`;
  } catch (err: any) {
    return "자료실 정리 실패 — " + String(err?.message || err).slice(0, 200);
  }
}

/** 사건 목록에 남아 있던 '샘플' 표시 항목을 공개에서 내린다.
 *  ★ 왜: 제목 "교권 침해 사례 (샘플)" / 설명 "관리자가 직접 사건을 등록하기 전 임시 표시용 샘플입니다."
 *  구글 정책이 "자리표시자 텍스트 위주의 페이지"를 거부 사유로 명시한다.
 *  지우지 않고 공개만 내린다(status를 hidden으로). 되돌릴 수 있어야 안전하다.
 *  제목이나 설명에 '샘플'·'임시 표시용'이 들어간 것만 대상으로 한다. */
async function hideSampleIncidents(): Promise<string> {
  try {
    const rows = await db
      .select({ id: incidents.id, title: incidents.title, summary: incidents.summary })
      .from(incidents)
      .where(eq(incidents.status, "active"));

    const sample = rows.filter((r) =>
      /샘플|임시 표시용/.test(String(r.title || "") + " " + String(r.summary || ""))
    );
    if (sample.length === 0) return "정리할 샘플 항목이 없습니다";

    for (const r of sample) {
      await db.update(incidents).set({ status: "hidden" } as any).where(eq(incidents.id, r.id));
    }
    return `${sample.length}건 비공개 처리 (제목: ${sample.map((r) => r.title).join(", ")})`;
  } catch (err: any) {
    return "사건 목록 정리 실패 — " + String(err?.message || err).slice(0, 200);
  }
}

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export default async (req: Request) => {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  /* ---------- 진단 (인증 불필요) ---------- */
  let existing: any = null;
  try {
    const [row] = await db
      .select({ id: sitePages.id, slug: sitePages.slug, status: sitePages.status })
      .from(sitePages)
      .where(eq(sitePages.slug, SLUG))
      .limit(1);
    existing = row || null;
  } catch (err: any) {
    return json(
      {
        ok: false,
        step: "select_page",
        error: "페이지 조회 실패",
        detail: String(err?.message || err).slice(0, 500),
      },
      500
    );
  }

  if (!run) {
    return json({
      ok: true,
      mode: "진단",
      슬러그: SLUG,
      이미있음: !!existing,
      현재상태: existing ? existing.status : null,
      실행방법: "이 주소 뒤에 ?run=1 을 붙여 어드민 로그인 상태로 다시 여세요",
    });
  }

  /* ---------- 실행 (어드민 인증) ---------- */
  const auth: any = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  if (existing) {
    /* 이미 만들어진 페이지에 잘못된 조각 표기가 남아 있으면 그것만 고친다.
       (운영자가 어드민에서 고친 내용은 덮어쓰지 않는다 — 표기가 틀린 경우만 손댄다) */
    let 표기정정 = "고칠 것 없음";
    try {
      const [row] = await db
        .select({ id: sitePages.id, contentHtml: sitePages.contentHtml })
        .from(sitePages)
        .where(eq(sitePages.slug, SLUG))
        .limit(1);
      const body = String((row as any)?.contentHtml || "");
      if (body.includes("[[donate]]")) {
        await db
          .update(sitePages)
          .set({ contentHtml: CONTENT_HTML } as any)
          .where(eq(sitePages.slug, SLUG));
        표기정정 = "후원 버튼이 글자로 나오던 것을 고쳤습니다";
      }
    } catch (err: any) {
      표기정정 = "정정 실패 — " + String(err?.message || err).slice(0, 200);
    }

    return json({
      ok: true,
      mode: "실행",
      결과: "후원 페이지는 이미 있습니다",
      표기정정,
      주소: "/p/" + SLUG,
      id: existing.id,
      자료실정리: await hideJunkResources(),
      자주묻는질문: await seedFaqs(),
      사건목록정리: await hideSampleIncidents(),
    });
  }

  try {
    const [created] = await db.insert(sitePages).values(PAGE as any).returning({ id: sitePages.id });
    return json({
      ok: true,
      mode: "실행",
      결과: "후원 전용 페이지를 만들었습니다",
      주소: "/p/" + SLUG,
      id: created?.id ?? null,
      자료실정리: await hideJunkResources(),
      자주묻는질문: await seedFaqs(),
      사건목록정리: await hideSampleIncidents(),
      다음: "어드민 > 페이지 관리에서 내용을 확인·수정하세요",
    });
  } catch (err: any) {
    return json(
      {
        ok: false,
        step: "insert_page",
        error: "페이지 생성 실패",
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      },
      500
    );
  }
};
