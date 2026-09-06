// lib/campaign-page.ts
// ★ 2026-09-06 캠페인 상세 화면을 **서버가 최종 모양으로** 그린다 (깜빡임 근본 FIX).
//
// 문제: 서버는 제목·요약·본문만 밝은 기본 모양으로 내보내고, 브라우저가 캠페인 API를 다시 물어본 뒤
//      화면 전체를 다시 그렸다(등불 캠페인은 어둠·금색 테마로 통째 교체). 그 왕복 시간(0.3~1초) 동안
//      "다른 화면"이 먼저 보여 신뢰를 깎았다 (Swain 2026-09-06 신고).
//
// 해결: 여기서 브라우저(public/campaign.html)와 **같은 마크업**을 서버가 완성해 내보내고,
//      브라우저는 서버 표시(data-ssr)가 있으면 다시 그리지 않고 버튼·FAQ 펼치기만 붙인다.
//
// ⚠️ 마크업(클래스·id 구조)은 public/campaign.html 의 renderDefault()·renderLantern()과 1:1 이어야 한다.
//    한쪽을 바꾸면 반드시 다른 쪽도 같이 바꾼다 (브라우저 쪽은 서버 렌더가 실패했을 때의 폴백).
//
// 저장소 조회는 하지 않는다 — 값은 lib/shell-detail.ts 가 읽어서 넘긴다(순수 조립·로컬 검증 가능).

import { esc } from "./shell-html";
import { RECEIPT_NOTICE } from "./campaign-extras";

const TYPE_LABEL: Record<string, string> = { fundraising: "모금", memorial: "추모", awareness: "인식 개선" };

/** 브라우저 캠페인 API(/api/campaigns?slug=)와 같은 모양의 캠페인 값 */
export interface CampaignView {
  id: number;
  slug: string;
  type: string;
  title: string;
  summary: string | null;
  /** 이미 살균된 본문 HTML */
  contentHtml: string;
  thumbnailBlobId: number | null;
  status: string;
  goalAmount: number;
  raisedAmount: number;
  donorCount: number;
  progressPercent: number | null;
  remainingDays: number | null;
  startDate?: any;
  endDate?: any;
  extras: any | null;
}

export interface CampaignFaq { question: string; answer: string }

/** lib/campaign-stats.ts computeCampaignPublicStats 의 결과(실패 시 null) */
export interface CampaignStatsView {
  members: number;
  monthly: number;
  recent: Array<{ name: string; school?: string; note?: string; at: string }>;
  bySchool: Array<{ school: string; count: number }>;
  raisedKrw?: number;
}

function won(n: any): string {
  return "₩" + Number(n || 0).toLocaleString("en-US");
}
function num(n: any): string {
  return Number(n || 0).toLocaleString("en-US");
}

/* ------------------------------------------------------------------ */
/* 기본(밝은) 캠페인 화면 — campaign.html renderDefault() 와 같은 마크업     */
/* ------------------------------------------------------------------ */
export function renderCampaignDefault(c: CampaignView): string {
  const thumb = c.thumbnailBlobId
    ? `background-image:url('/api/blob-image?id=${Number(c.thumbnailBlobId)}')`
    : "background:linear-gradient(135deg,#7a1f2b,#a64252)";
  const goal = c.goalAmount || 0;
  const raised = c.raisedAmount || 0;
  const pct = c.progressPercent;

  const progressHtml = goal > 0
    ? `<div class="cmp-progress-large"><div class="cmp-progress-large-fill" style="width:${pct}%"></div></div>
         <div style="font-size:14px;color:var(--text-2);text-align:right;margin-bottom:14px">${pct}% 달성</div>
         <div class="cmp-stats-row">
           <div class="cmp-stats-item"><div class="cmp-stats-label">현재 모금액</div><div class="cmp-stats-value brand">${won(raised)}</div></div>
           <div class="cmp-stats-item"><div class="cmp-stats-label">목표 금액</div><div class="cmp-stats-value">${won(goal)}</div></div>
           <div class="cmp-stats-item"><div class="cmp-stats-label">후원자</div><div class="cmp-stats-value">${num(c.donorCount)}명</div></div>
           ${c.remainingDays !== null ? `<div class="cmp-stats-item"><div class="cmp-stats-label">남은 기간</div><div class="cmp-stats-value">D-${c.remainingDays}</div></div>` : ""}
         </div>`
    : `<div class="cmp-stats-row">
           <div class="cmp-stats-item"><div class="cmp-stats-label">참여 후원자</div><div class="cmp-stats-value brand">${num(c.donorCount)}명</div></div>
           ${c.remainingDays !== null ? `<div class="cmp-stats-item"><div class="cmp-stats-label">남은 기간</div><div class="cmp-stats-value">D-${c.remainingDays}</div></div>` : ""}
         </div>`;

  const isClosed = c.status === "closed";

  return `
      <div class="cmp-detail-hero" style="${thumb}">
        <span class="cmp-detail-type-badge">${esc(TYPE_LABEL[c.type] || c.type)}</span>
      </div>

      <h1 class="cmp-detail-title">${esc(c.title)}</h1>

      ${c.summary ? `<div class="cmp-detail-summary">${esc(c.summary)}</div>` : ""}

      <div class="cmp-stats-card">
        ${progressHtml}
      </div>

      <div class="cmp-detail-content">${c.contentHtml || ""}</div>

      ${isClosed
        ? '<div style="text-align:center;padding:30px;background:#f5f4f2;border-radius:8px;color:var(--text-3)">이 캠페인은 종료되었습니다. 함께해주신 모든 분들께 감사드립니다. </div>'
        : `<button class="cmp-cta" data-cmp-donate="${Number(c.id)}" data-cmp-slug="${esc(c.slug)}" data-cmp-title="${esc(c.title)}">
            이 캠페인에 후원하기
          </button>
          <p class="cmp-receipt-note">${esc(RECEIPT_NOTICE)}</p>`
      }
    `;
}

/* ------------------------------------------------------------------ */
/* 「등불의 기적」 화면 — campaign.html renderLantern() 과 같은 마크업       */
/*   서버는 실값·FAQ까지 채워서 내보낸다(브라우저는 다시 그리지 않는다)       */
/* ------------------------------------------------------------------ */
export function renderRecentLanterns(recent: CampaignStatsView["recent"]): string {
  return (recent || []).map((r) => `
          <div class="lt-recent-item"><span class="orb"></span>
            <div><b>${esc(r.name || "익명")}</b>${r.school ? `<small>${esc(r.school)}</small>` : ""}
              ${r.note ? `<p>${esc(r.note)}</p>` : ""}</div>
          </div>`).join("");
}

export function renderSchools(bySchool: CampaignStatsView["bySchool"]): string {
  return (bySchool || []).slice(0, 12).map((s) => `<span>${esc(s.school)}<b>${num(s.count)}명</b></span>`).join("");
}

export function renderFaqItems(faqs: CampaignFaq[]): string {
  return (faqs || []).map((f) => `
        <div class="lt-faq-item">
          <button type="button" class="lt-faq-q">${esc(f.question)}</button>
          <div class="lt-faq-a">${esc(f.answer).replace(/\n/g, "<br />")}</div>
        </div>`).join("");
}

export function renderCampaignLantern(c: CampaignView, faqs: CampaignFaq[], stats: CampaignStatsView | null): string {
  const x = c.extras || {};
  const thumb = c.thumbnailBlobId ? `/api/blob-image?id=${Number(c.thumbnailBlobId)}` : "";
  const goal = c.goalAmount || 0;
  /* 모인 회비는 실값 API 와 같은 출처(완료 후원 합계)를 우선한다 — 랜딩 게이지와 같은 숫자 */
  const raised = stats && typeof stats.raisedKrw === "number" ? stats.raisedKrw : (c.raisedAmount || 0);
  const pct = goal > 0 ? Math.min(100, Math.round((raised / goal) * 1000) / 10) : null;
  const isClosed = c.status === "closed";
  const notice = x.receiptNotice || RECEIPT_NOTICE;
  const members = stats && typeof stats.members === "number" ? stats.members : (c.donorCount || 0);
  const monthly = stats && typeof stats.monthly === "number" ? num(stats.monthly) : "–";
  const recent = (stats && Array.isArray(stats.recent)) ? stats.recent : [];
  const bySchool = (stats && Array.isArray(stats.bySchool)) ? stats.bySchool : [];
  const faqList = Array.isArray(faqs) ? faqs : [];

  const ctaBtn = (sub: string) => isClosed
    ? '<div style="padding:26px;border:1px solid var(--lt-hr);color:var(--lt-dim);text-align:center">이 캠페인은 종료되었습니다. 함께해 주신 모든 분들께 감사드립니다.</div>'
    : `<button class="lt-cta" data-cmp-donate="${Number(c.id)}" data-cmp-slug="${esc(c.slug)}" data-cmp-title="${esc(c.title)}">
           후원회원으로 함께하기
           <small>${esc(sub)}</small>
         </button>`;

  const ladderCol = (label: string, hint: string, steps: any[]) =>
    `<div class="lt-ladder-col">
         <h4>${esc(label)}<small>${esc(hint)}</small></h4>
         ${(steps || []).map((s) => `<div class="lt-ladder-row"><b>${num(s.amount)}원</b><span>${esc(s.impact)}</span></div>`).join("")}
       </div>`;

  return `
      <section class="lt-hero" ${thumb ? `style="background-image:url('${thumb}')"` : ""}>
        <div class="lt-hero-in">
          <div class="lt-eyebrow">${esc(x.eyebrow || "교사유가족협의회 후원회원 캠페인")}</div>
          <h1 class="lt-title"><span class="orn">✦</span>${esc(c.title)}</h1>
          <p class="lt-headline">${esc(x.headline || c.summary || "")}</p>
          ${x.subtitle ? `<p class="lt-subtitle">${esc(x.subtitle)}</p>` : ""}
        </div>
      </section>

      <div class="lt-in">
        <section class="lt-stats">
          <div class="lt-stats-grid">
            <div class="lt-stat"><b id="ltMembers">${num(members)}</b><span>개의 등불이 켜졌습니다</span><small>후원회원 수 · 정기+일시</small></div>
            <div class="lt-stat"><b id="ltMonthly">${monthly}</b><span>정기 후원회원</span><small>매달 함께 지키는 사람</small></div>
          </div>
          ${goal > 0 ? `
          <div class="lt-progress"><i id="ltProgressBar" style="width:${pct}%"></i></div>
          <div class="lt-progress-lab"><span>모인 회비 <b id="ltRaised">${won(raised)}</b></span><span><span id="ltPct">${pct}</span>% · 목표 ${won(goal)}</span></div>` : ""}
          <div class="lt-cta-wrap">
            ${ctaBtn("월 1만 원부터 · 한 번의 후원도 환영합니다")}
            <p class="lt-cta-sub">가입 즉시 등불 증서가 발급되고, 정기 후원은 마이페이지에서 언제든 한 번에 해지하실 수 있습니다.</p>
          </div>
        </section>

        <article class="lt-content">${c.contentHtml || ""}</article>

        ${x.ladder ? `
        <section class="lt-ladder">
          <h3>후원이 하는 일</h3>
          <div class="lt-ladder-grid">
            ${ladderCol("정기 후원 (월)", x.ladder.monthlyHint || "", x.ladder.regular || [])}
            ${ladderCol("일시 후원", "한 번만", x.ladder.onetime || [])}
          </div>
          <p class="lt-ladder-note">${esc(x.ladder.minNote || "최소 1,000원부터 가능합니다")} · 큰 마음은 직접 입력으로 후원하실 수 있습니다.</p>
        </section>` : ""}

        <section class="lt-recent" id="ltRecent"${(recent.length || bySchool.length) ? "" : " hidden"}>
          <h3>최근 켜진 등불</h3>
          <div class="lt-recent-list" id="ltRecentList">${renderRecentLanterns(recent)}</div>
          <div class="lt-schools" id="ltSchools"${bySchool.length ? "" : " hidden"}>${renderSchools(bySchool)}</div>
        </section>

        <section class="lt-notice">
          <h3>후원회원 모집 안내</h3>
          <p><b>${esc(notice)}</b></p>
          ${x.feeNotice ? `<p>${esc(x.feeNotice)}</p>` : ""}
          ${x.org ? `<div class="lt-org">${esc(x.org.name)} · 사업자등록번호 ${esc(x.org.businessNo)} · 대표 ${esc(x.org.representative)}</div>` : ""}
        </section>

        <section class="lt-faq" id="ltFaq"${faqList.length ? "" : " hidden"}>
          <h3>자주 묻는 질문</h3>
          <div id="ltFaqList">${renderFaqItems(faqList)}</div>
        </section>

        <div class="lt-bottom">
          <p>“선생님, 이제 여기는 걱정 마세요.<br />이곳은 저희가 지킬게요.”</p>
          ${ctaBtn("이 한마디를 함께 완성해 주세요")}
        </div>
      </div>
    `;
}
