// netlify/functions/migrate-lantern-campaign.ts
// ★ 1회용 — 「등불의 기적」 후원 캠페인 신설·연동 (2026-09-06 · AutoMarketing 요청). 호출 성공 후 즉시 삭제.
//
// GET                    : 진단 (인증 불필요)
// GET ?run=1             : 어드민 세션 또는 ?secret=INTERNAL_TRIGGER_SECRET 로 실행 (멱등)
//
// 하는 일:
//  ① 컬럼 추가 — members.school_name·bylaws_agreed_at / donations.source_meta·donor_note·public_consent
//  ② 가입경로 'lantern_campaign' 등록
//  ③ 캠페인 「등불의 기적」(slug 등불의-기적) 생성 + 랜딩 OG 이미지를 대표 사진으로 저장(R2)
//  ④ FAQ 6문(category 'lantern')
//  ⑤ S3 — 사실과 다른 「기부금 영수증 즉시 발급·국세청 자동 등재」 문구를 DB 콘텐츠(페이지·공지·FAQ·자료·메뉴)에서 정정
//
// 원칙: 이미 있는 것은 건드리지 않는다(운영자 수정본 보호). 다시 불러도 겹쳐 쓰지 않는다.

import { eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { campaigns, faqs, signupSources } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import { uploadToR2 } from "../../lib/r2-server";
import { LANTERN, RECEIPT_NOTICE } from "../../lib/campaign-extras";

export const config = { path: "/api/migrate-lantern-campaign" };

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
function rowsOf(res: any): any[] {
  return (res?.rows ?? res ?? []) as any[];
}

/* ================================================================== */
/* 캠페인 본문 — 랜딩 「숭고한 등불」과 같은 세계. 지어낸 수치는 쓰지 않는다. */
/* ================================================================== */
const CAMPAIGN_TITLE = "등불의 기적";
const CAMPAIGN_HTML = `
<p class="lt-lead">2023년 여름을 기억하십니까. 교문 앞에 쌓이던 하얀 국화, 하굣길에 매달린 검은 리본, 폭염 속 끝이 보이지 않던 검은 옷의 행렬. 그 여름 수십만 명이 거리로 나온 이유는 하나였습니다. 한 사람의 죽음을 ‘남의 일’로 두지 않겠다는 마음.</p>
<p>그 행렬은 해산했지만, 그 질문은 아직 끝나지 않았습니다. <strong>“왜 선생님이 죽어야 했는가.”</strong> 그 여름의 질문을 3년째 붙들고 있는 가족들이 있습니다.</p>

<h2>같은 나라에서 일하다 순직해도, 교육만 26%입니다</h2>
<p>인사혁신처가 국회에 제출한 자료(2020년~2024년 6월)에 따르면 순직 인정률은 소방 82%, 경찰 62%, 일반공무원 52%인데 교육공무원은 26%에 그칩니다. 교실에서 마지막까지 책임을 놓지 않았던 선생님들의 죽음이, 입증의 무게를 유가족 혼자 지는 구조 속에 남겨져 있습니다.</p>

<h2>우리는 왜 이 일을 하는가</h2>
<p>교사유가족협의회는 서이초 선생님의 가족을 비롯해, 교단에서 가족을 잃은 유가족들이 모여 만든 사단법인입니다. 사망 직후 어디에 전화해야 하는지, 순직을 어떻게 준비해야 하는지, 언론에는 어떻게 알려야 하는지 아무도 알려주지 않던 그 길을 먼저 겪은 가족이 다음 가족의 길잡이가 되기로 했습니다.</p>
<p>지난 3년, 한 가족이 내어준 순직보상금이 다음 가족의 사건을 밝히는 등불이 되었습니다. 그러나 그 돈은 남겨진 가족의 내일을 지켜야 할 돈이었습니다. <strong>이제 그 등불을, 우리가 함께 들 차례입니다.</strong></p>

<h2>회비는 이렇게 쓰입니다</h2>
<ul class="lt-list">
  <li><b>진상조사</b> — 사망의 진실을 제도가 밝히도록</li>
  <li><b>순직심의 지원</b> — 입증의 무게를 유족 혼자 지지 않도록</li>
  <li><b>순직자 예우</b> — 기억하는 방식이 미래를 만들도록</li>
  <li><b>유가족 지원</b> — 치료·생계·사회 복귀까지</li>
  <li><b>재발 방지</b> — 같은 패턴이 반복되지 않도록</li>
</ul>
<p>후원회원의 회비가 무엇에 쓰였는지는 분기마다 «등불 보고»로 홈페이지에 게시하고 후원회원께 메일로 보내드립니다.</p>

<h2>후원회원이 되면</h2>
<p>월 1만 원부터, 또는 한 번의 후원으로 함께하실 수 있습니다. 가입 즉시 <b>등불 증서</b>가 발급되고, 협의회 소식과 분기 등불 보고, 연 1회 활동 보고를 받으십니다. 정기 후원은 마이페이지에서 언제든 한 번에 해지하실 수 있습니다.</p>
<p>선생님께서 함께해 주신다면, 병상에서도 서류를 놓지 못하는 어느 아버지가 혼자 밤을 견디지 않아도 되고, 전국 곳곳의 유가족들이 마음 놓고 울 수 있는 하루가 생깁니다. “선생님, 이제 여기는 걱정 마세요. 이곳은 저희가 지킬게요.” — 이 한마디를 그분들 모두에게, 함께 완성해 주세요.</p>
`.trim();

/* ================================================================== */
/* FAQ 6문 (S7)                                                        */
/* ================================================================== */
const FAQS: Array<{ question: string; answer: string }> = [
  {
    question: "세액공제(기부금영수증)가 되나요?",
    answer: `${RECEIPT_NOTICE} 후원 내역은 마이페이지에서 언제든 확인하실 수 있습니다.`,
  },
  {
    question: "회비는 어디에 쓰이나요?",
    answer: "진상조사, 순직심의 지원, 순직자 예우, 유가족 지원(치료·생계·사회 복귀), 재발 방지 — 다섯 가지 일에 쓰입니다. 어느 가족(익명)에게 무엇에 썼는지는 분기마다 «등불 보고»로 홈페이지에 게시하고 후원회원께 메일로 알려드립니다.",
  },
  {
    question: "해지는 언제든 되나요?",
    answer: "네. 정기 후원은 마이페이지 > 후원 내역에서 한 번에 해지하실 수 있습니다. 다음 결제일 전에 해지하시면 그달부터 청구되지 않습니다. 계좌 자동이체(효성 CMS+)로 후원 중이시면 마이페이지의 안내에 따라 해지 신청을 남겨 주세요.",
  },
  {
    question: "후원회원이 되면 무엇이 오나요?",
    answer: "가입 즉시 등불 증서(디지털 카드)가 발급되고, 협의회 소식과 분기 «등불 보고», 연 1회 활동 보고를 받으십니다. 후원회원의 이름은 원하시는 경우에만 마스킹해서 캠페인 페이지에 보여드립니다.",
  },
  {
    question: "일시 후원도 되나요?",
    answer: "네. 후원 창에서 «일시» 탭을 고르시면 카드·간편결제 또는 계좌이체로 한 번만 후원하실 수 있습니다. 후원회원 가입 절차(회칙 동의)는 정기 후원과 같습니다.",
  },
  {
    question: "학교 단위로도 되나요?",
    answer: "가입 때 학교명/소속을 적어 주시면 같은 학교의 후원회원이 「○○초 12명」처럼 학교 단위 등불로 함께 표시됩니다. 교직원 일괄 후원처럼 학교 차원의 참여는 협의회로 문의해 주시면 도와드리겠습니다.",
  },
];

/* ================================================================== */
/* S3 — DB 콘텐츠 문구 정정 (정확히 일치하는 문장만 바꾼다)              */
/* ================================================================== */
const NOTICE_P = `<p>${RECEIPT_NOTICE}</p>`;
const REPLACEMENTS: Array<[string, string]> = [
  ["기부금 영수증 발급이 가능하며 국세청 연말정산 간소화 서비스에 자동 등재됩니다.", RECEIPT_NOTICE],
  ["<tr><th>기부금 영수증</th><td>발급 가능 · 국세청 연말정산 간소화 서비스 자동 등재</td></tr>", "<tr><th>기부금 영수증</th><td>아직 발급되지 않습니다 (공익법인 지정 전 · 지정되는 날 바로 알려드립니다)</td></tr>"],
  ["<p>협의회는 기부금 영수증 발급이 가능한 비영리 사단법인입니다.</p>", NOTICE_P],
  ["<p>교사유가족협의회는 기부금 영수증 발급이 가능한 비영리 사단법인입니다.</p>", NOTICE_P],
  ["<li>후원 회원은 <strong>마이페이지 &gt; 증명서 발급</strong>에서 기부금 영수증(PDF)을 직접 발급할 수 있습니다</li>", ""],
  ["<li>기부 내역은 매년 1월 국세청 연말정산 간소화 서비스에 자동 등재됩니다</li>", ""],
  ["<li>기부금 영수증을 마이페이지에서 직접 발급하실 수 있습니다</li>", ""],
  ["<li>후원 회원은 <b>마이페이지</b>에서 기부금 영수증(PDF)을 직접 발급할 수 있습니다.</li>", ""],
  ["<li>기부 내역은 국세청 연말정산 간소화 서비스에 등재됩니다.</li>", ""],
  ["<p>후원 회원은 마이페이지에서 기부금 영수증(PDF)을 직접 발급할 수 있으며, 기부 내역은 국세청 연말정산 간소화 서비스에 등재됩니다.</p>", NOTICE_P],
  ["기부금 영수증 발급과 투명한 회계 공개가 가능해졌고", "투명한 회계 공개가 가능해졌고"],
  ["<li><b>후원</b> — 정기·일시 후원 신청과 기부금 영수증 발급 (마이페이지)</li>", "<li><b>후원</b> — 정기·일시 후원 신청과 후원 내역 확인 (마이페이지)</li>"],
  ["후원 방법(정기·일시·계좌이체)과 기부금 영수증 발급 절차 안내입니다.", "후원 방법(정기·일시·계좌이체)과 후원금 사용처·해지 절차 안내입니다."],
  ["정기·일시 후원 방법, 후원금 사용처, 기부금 영수증 발급과 해지 절차를 안내합니다.", "정기·일시 후원 방법, 후원금 사용처와 해지 절차를 안내합니다."],
  ["후원금 사용 기준, 활동보고서 공개, 기부금 영수증 발급 안내.", "후원금 사용 기준, 활동보고서 공개, 세액공제 관련 안내."],
  ["후원 안내 — 정기·일시 후원과 기부금 영수증", "후원 안내 — 정기·일시 후원과 사용처"],
  ["기부금 영수증 발급 및 연말정산 등재 안내", "기부금 영수증(세액공제) 안내 — 공익법인 지정 전"],
  /* 진단(2026-09-06 라이브)에서 드러난 나머지 — 약관 페이지(DB)·후원 안내 `>` 변형·연간 일괄 발급 공지·FAQ */
  ["<li>후원 회원은 <strong>마이페이지 > 증명서 발급</strong>에서 기부금 영수증(PDF)을 직접 발급할 수 있습니다</li>", ""],
  ["<li>회원의 경우 마이페이지에서 기부금 영수증을 PDF로 즉시 발급받을 수 있으며, 「소득세법」에 따라 연말정산 소득공제 자료로 활용 가능합니다.</li>", `<li>${RECEIPT_NOTICE} 회원은 마이페이지에서 후원 내역을 확인할 수 있습니다.</li>`],
  ["회원의 경우 마이페이지에서 기부금 영수증을 PDF로 즉시 발급받을 수 있으며, 「소득세법」에 따라 연말정산 소득공제 자료로 활용 가능합니다.", `${RECEIPT_NOTICE} 회원은 마이페이지에서 후원 내역을 확인할 수 있습니다.`],
  ["마이페이지 > 증명서 발급 메뉴에서 즉시 발급 가능합니다. 국세청 연말정산 간소화 서비스에도 자동 등재됩니다.", RECEIPT_NOTICE],
  ["매년 1월 국세청 연말정산 간소화 서비스에 자동 등재되며, 마이페이지 > 증명서 발급에서 PDF 형태로 즉시 출력 가능합니다.", `${RECEIPT_NOTICE} 후원 내역은 마이페이지에서 확인하실 수 있습니다.`],
  ["기부금 영수증은 언제 어떻게 발급되나요?", "기부금 영수증(세액공제)은 발급되나요?"],
];

/** 위 목록으로 못 잡은 문장 — 「국세청 연말정산 간소화 서비스」가 든 문장(태그 안 텍스트 노드 범위)을 통째로 안내문으로 바꾼다 */
async function regexFallback(table: string, column: string): Promise<number> {
  try {
    const res: any = await db.execute(sql.raw(
      `UPDATE ${table} SET ${column} = regexp_replace(${column}, ` +
      `'[^.<>]*국세청 연말정산 간소화 서비스[^.<>]*\\.?', ${sqlStr(RECEIPT_NOTICE)}, 'g')` +
      ` WHERE ${column} LIKE '%국세청 연말정산 간소화 서비스%' RETURNING id`,
    ));
    return rowsOf(res).length;
  } catch {
    return 0;
  }
}

/** 표·컬럼별 문구 치환 — 바뀐 행 수 반환 */
async function replaceIn(table: string, column: string, idCol = "id"): Promise<number> {
  let changed = 0;
  for (const [from, to] of REPLACEMENTS) {
    try {
      const res: any = await db.execute(sql.raw(
        `UPDATE ${table} SET ${column} = REPLACE(${column}, ${sqlStr(from)}, ${sqlStr(to)})` +
        ` WHERE ${column} LIKE ${sqlStr("%" + from + "%")} RETURNING ${idCol}`,
      ));
      changed += rowsOf(res).length;
    } catch (e) {
      /* 컬럼·표가 없으면 건너뛴다 */
    }
  }
  return changed;
}
function sqlStr(s: string): string {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

const SEARCH_TARGETS: Array<[string, string, string]> = [
  ["site_pages", "content_html", "slug"],
  ["site_pages", "draft_content_html", "slug"],
  ["site_pages", "seo_description", "slug"],
  ["site_pages", "subtitle", "slug"],
  ["notices", "content", "title"],
  ["notices", "title", "title"],
  ["notices", "excerpt", "title"],
  ["faqs", "answer", "question"],
  ["resources", "content_html", "title"],
  ["resources", "description", "title"],
];

/** 아직 남은 문구 — 진단용 */
async function findRemaining(): Promise<any[]> {
  const out: any[] = [];
  for (const [table, column, label] of SEARCH_TARGETS) {
    try {
      const res: any = await db.execute(sql.raw(
        `SELECT id, ${label} AS label, substring(${column} from position('국세청' in ${column}) - 60 for 160) AS snippet` +
        ` FROM ${table} WHERE ${column} LIKE '%국세청%' OR ${column} LIKE '%즉시 발급%' OR ${column} LIKE '%발급이 가능%' LIMIT 20`,
      ));
      for (const r of rowsOf(res)) out.push({ table, column, id: r.id, label: r.label, snippet: r.snippet });
    } catch { /* 표 없음 */ }
  }
  return out;
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const res: any = await db.execute(sql`
    SELECT 1 FROM information_schema.columns WHERE table_name = ${table} AND column_name = ${column} LIMIT 1
  `);
  return rowsOf(res).length > 0;
}

/* ================================================================== */
export default async (req: Request) => {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  /* 진단 */
  const diag: any = { slug: LANTERN.slug };
  try {
    diag.columns = {
      "members.school_name": await columnExists("members", "school_name"),
      "members.bylaws_agreed_at": await columnExists("members", "bylaws_agreed_at"),
      "donations.source_meta": await columnExists("donations", "source_meta"),
      "donations.donor_note": await columnExists("donations", "donor_note"),
      "donations.public_consent": await columnExists("donations", "public_consent"),
    };
    const [c] = await db.select({ id: campaigns.id, slug: campaigns.slug, title: campaigns.title, thumb: campaigns.thumbnailBlobId, isPublished: campaigns.isPublished, status: campaigns.status })
      .from(campaigns).where(eq(campaigns.slug, LANTERN.slug)).limit(1);
    diag.campaign = c || null;
    const fq: any = await db.execute(sql`SELECT COUNT(*)::int AS n FROM faqs WHERE category = ${LANTERN.faqCategory}`);
    diag.faqCount = Number(rowsOf(fq)[0]?.n || 0);
    const ss: any = await db.execute(sql`SELECT id FROM signup_sources WHERE code = 'lantern_campaign' LIMIT 1`);
    diag.signupSource = rowsOf(ss)[0]?.id || null;
    diag.remainingReceiptTexts = await findRemaining();
  } catch (e: any) {
    diag.error = String(e?.message || e);
  }

  if (!run) return json({ ok: true, mode: "diag", diag });

  /* 인증 — 어드민 세션 또는 ?secret=(INTERNAL_TRIGGER_SECRET 또는 1회용 LANTERN_MIGRATE_TOKEN·호출 후 env 삭제) */
  const secret = url.searchParams.get("secret") || "";
  const expected = process.env.INTERNAL_TRIGGER_SECRET || "";
  const onceToken = process.env.LANTERN_MIGRATE_TOKEN || "";
  let authed = (expected !== "" && secret === expected) || (onceToken !== "" && secret === onceToken);
  if (!authed) {
    const guard: any = await requireAdmin(req);
    if (!guard.ok) return guard.res;
    authed = true;
  }

  const result: any = { steps: [] };
  try {
    /* ① 컬럼 */
    await db.execute(sql`ALTER TABLE members ADD COLUMN IF NOT EXISTS school_name VARCHAR(150)`);
    await db.execute(sql`ALTER TABLE members ADD COLUMN IF NOT EXISTS bylaws_agreed_at TIMESTAMP`);
    await db.execute(sql`ALTER TABLE donations ADD COLUMN IF NOT EXISTS source_meta JSONB`);
    await db.execute(sql`ALTER TABLE donations ADD COLUMN IF NOT EXISTS donor_note VARCHAR(60)`);
    await db.execute(sql`ALTER TABLE donations ADD COLUMN IF NOT EXISTS public_consent BOOLEAN DEFAULT FALSE`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS donations_campaign_public_idx ON donations (campaign_id, public_consent)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS members_school_name_idx ON members (school_name)`);
    result.steps.push("① 컬럼 5개 추가(IF NOT EXISTS)");

    /* ② 가입경로 */
    const [src] = await db.select({ id: signupSources.id }).from(signupSources).where(eq(signupSources.code, "lantern_campaign")).limit(1);
    if (!src) {
      await db.insert(signupSources).values({
        code: "lantern_campaign",
        label: "등불의 기적 캠페인(랜딩)",
        description: "AutoMarketing 랜딩 「숭고한 등불」 → 캠페인 페이지 후원회원 가입",
        isActive: true,
        sortOrder: 50,
      } as any);
      result.steps.push("② 가입경로 lantern_campaign 등록");
    } else {
      result.steps.push("② 가입경로 이미 있음");
    }

    /* ③ 캠페인 */
    const [existing] = await db.select({ id: campaigns.id, thumb: campaigns.thumbnailBlobId }).from(campaigns).where(eq(campaigns.slug, LANTERN.slug)).limit(1);
    let campaignId = existing?.id || null;
    let thumbId: number | null = existing?.thumb || null;

    if (!thumbId) {
      try {
        const r = await fetch(LANTERN.ogImageUrl, { signal: AbortSignal.timeout(12000) });
        if (r.ok) {
          const buf = Buffer.from(await r.arrayBuffer());
          const mime = (r.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
          if (buf.length > 1000 && /^image\//.test(mime)) {
            const up = await uploadToR2({ buffer: buf, originalName: "lantern-og.jpg", mimeType: mime, context: "campaign", isPublic: true });
            if (up.ok && up.blobId) thumbId = up.blobId;
            result.thumbnail = up.ok ? { blobId: up.blobId, bytes: buf.length } : { error: up.error };
          } else {
            result.thumbnail = { skipped: `이미지 아님(${mime}, ${buf.length}B)` };
          }
        } else {
          result.thumbnail = { skipped: `HTTP ${r.status}` };
        }
      } catch (e: any) {
        result.thumbnail = { error: String(e?.message || e) };
      }
    }

    if (!campaignId) {
      const [created] = await db.insert(campaigns).values({
        slug: LANTERN.slug,
        type: "fundraising",
        title: CAMPAIGN_TITLE,
        summary: LANTERN.headline,
        contentHtml: CAMPAIGN_HTML,
        thumbnailBlobId: thumbId,
        status: "active",
        goalAmount: 30_000_000,
        raisedAmount: 0,
        donorCount: 0,
        startDate: new Date(),
        endDate: null,
        isPublished: true,
        isPinned: true,
        sortOrder: 0,
      } as any).returning({ id: campaigns.id });
      campaignId = created.id;
      result.steps.push(`③ 캠페인 생성 id=${campaignId} slug=${LANTERN.slug}`);
    } else {
      if (thumbId && !existing.thumb) {
        await db.update(campaigns).set({ thumbnailBlobId: thumbId, updatedAt: new Date() } as any).where(eq(campaigns.id, campaignId));
        result.steps.push(`③ 캠페인 이미 있음 id=${campaignId} — 대표 사진만 채움`);
      } else {
        result.steps.push(`③ 캠페인 이미 있음 id=${campaignId} (내용 유지)`);
      }
    }
    if (thumbId) {
      try {
        await db.execute(sql`UPDATE blob_uploads SET reference_table = 'campaigns', reference_id = ${campaignId} WHERE id = ${thumbId}`);
      } catch { /* noop */ }
    }
    result.campaignId = campaignId;

    /* ④ FAQ */
    let faqAdded = 0;
    for (let i = 0; i < FAQS.length; i++) {
      const f = FAQS[i];
      const dup: any = await db.execute(sql`SELECT id FROM faqs WHERE category = ${LANTERN.faqCategory} AND question = ${f.question} LIMIT 1`);
      if (rowsOf(dup).length) continue;
      await db.insert(faqs).values({
        category: LANTERN.faqCategory,
        question: f.question,
        answer: f.answer,
        sortOrder: (i + 1) * 10,
        isActive: true,
      } as any);
      faqAdded++;
    }
    result.steps.push(`④ FAQ ${faqAdded}건 추가 (category=${LANTERN.faqCategory})`);

    /* ⑤ 문구 정정 */
    const fixes: Record<string, number> = {};
    for (const [table, column, label] of SEARCH_TARGETS) {
      const n = await replaceIn(table, column, label === "slug" || label === "title" || label === "question" ? "id" : "id");
      if (n) fixes[`${table}.${column}`] = n;
    }
    try {
      const nav: any = await db.execute(sql`UPDATE nav_menu_items SET label = '후원 내역' WHERE label = '기부금 영수증' RETURNING id`);
      const n = rowsOf(nav).length;
      if (n) fixes["nav_menu_items.label"] = n;
    } catch { /* noop */ }
    /* 연간 「기부금 영수증 일괄 발급 기간 안내」 공지는 전제 자체가 틀렸으므로 내린다(삭제 아님 — 운영자가 CMS에서 되살릴 수 있다) */
    try {
      const un: any = await db.execute(sql`UPDATE notices SET is_published = FALSE, updated_at = NOW() WHERE title LIKE '기부금 영수증 일괄 발급%' AND is_published = TRUE RETURNING id`);
      const n = rowsOf(un).length;
      if (n) fixes["notices.unpublished"] = n;
    } catch { /* noop */ }
    /* 마지막 안전망 — 문장 단위 정규식 치환 */
    for (const [table, column] of SEARCH_TARGETS) {
      const n = await regexFallback(table, column);
      if (n) fixes[`${table}.${column}(regex)`] = n;
    }
    result.receiptTextFixes = fixes;
    result.remainingReceiptTexts = await findRemaining();
    result.steps.push("⑤ 기부금영수증 문구 정정");

    return json({ ok: true, mode: "run", result });
  } catch (e: any) {
    console.error("[migrate-lantern-campaign]", e);
    return json({ ok: false, error: String(e?.message || e), stack: String(e?.stack || "").slice(0, 800), result }, 500);
  }
};
