// public/js/admin-activity-report.js
// ★ Phase M-19-3: AI 활동보고서 생성 어드민 모듈
(function () {
  'use strict';

  let _lastResult = null;

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  function toast(msg, ms = 2400) {
    const t = document.getElementById('toast');
    if (!t) return alert(msg);
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(window._tt);
    window._tt = setTimeout(() => t.classList.remove('show'), ms);
  }

  async function api(path, opts = {}) {
    const o = {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      credentials: 'include',
    };
    if (opts.body) o.body = JSON.stringify(opts.body);
    const res = await fetch(path, o);
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok && data.ok !== false, status: res.status, data };
  }

  /* ====== 모달 초기화 ====== */
  function fillYearOptions() {
    const sel = document.getElementById('arYear');
    if (!sel) return;
    const now = new Date().getFullYear();
    let html = '';
    for (let y = now; y >= now - 5; y--) {
      html += `<option value="${y}"${y === now ? ' selected' : ''}>${y}년</option>`;
    }
    sel.innerHTML = html;
  }

  function setupPeriodCards() {
    const cards = document.querySelectorAll('.ar-period-card');
    cards.forEach((card) => {
      card.addEventListener('click', () => {
        cards.forEach((c) => c.classList.remove('on'));
        card.classList.add('on');
        const radio = card.querySelector('input[type="radio"]');
        if (radio) radio.checked = true;

        const type = card.dataset.periodType;
        const quarterlyBox = document.getElementById('arQuarterlyBox');
        const customBox = document.getElementById('arCustomBox');
        const quarterField = document.getElementById('arQuarterField');
        const halfField = document.getElementById('arHalfField');

        if (type === 'custom') {
          if (quarterlyBox) quarterlyBox.style.display = 'none';
          if (customBox) customBox.style.display = '';
        } else {
          if (quarterlyBox) quarterlyBox.style.display = '';
          if (customBox) customBox.style.display = 'none';

          if (type === 'quarterly') {
            if (quarterField) quarterField.style.display = '';
            if (halfField) halfField.style.display = 'none';
          } else if (type === 'half') {
            if (quarterField) quarterField.style.display = 'none';
            if (halfField) halfField.style.display = '';
          } else if (type === 'annual') {
            if (quarterField) quarterField.style.display = 'none';
            if (halfField) halfField.style.display = 'none';
          }
        }
      });
    });
  }

  function showStep(n) {
    document.getElementById('arStep1').style.display = n === 1 ? '' : 'none';
    document.getElementById('arStep2').style.display = n === 2 ? '' : 'none';
    document.getElementById('arStep3').style.display = n === 3 ? '' : 'none';
  }

  function openModal() {
    const modal = document.getElementById('activityReportModal');
    if (!modal) return;

    fillYearOptions();
    showStep(1);
    modal.classList.add('show');
  }

  function getPeriodInput() {
    const type = document.querySelector('input[name="arPeriodType"]:checked')?.value || 'quarterly';
    const period = { type };

    if (type === 'quarterly') {
      period.year = Number(document.getElementById('arYear').value);
      period.quarter = Number(document.getElementById('arQuarter').value);
    } else if (type === 'half') {
      period.year = Number(document.getElementById('arYear').value);
      period.half = Number(document.getElementById('arHalf').value);
    } else if (type === 'annual') {
      period.year = Number(document.getElementById('arYear').value);
    } else if (type === 'custom') {
      const start = document.getElementById('arStartDate').value;
      const end = document.getElementById('arEndDate').value;
      const label = document.getElementById('arCustomLabel').value.trim();

      if (!start || !end) throw new Error('자유 범위는 시작일과 종료일이 필요합니다');
      if (new Date(start) >= new Date(end)) throw new Error('시작일은 종료일보다 이전이어야 합니다');

      period.startDate = start;
      period.endDate = end;
      if (label) period.label = label;
    }

    return period;
  }

  /* ====== 진행 단계 표시 ====== */
  function updateProgress(step, title, msg) {
    const titleEl = document.getElementById('arProgressTitle');
    const msgEl = document.getElementById('arProgressMsg');
    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.innerHTML = msg;

    const steps = [
      document.getElementById('arProgressStep1'),
      document.getElementById('arProgressStep2'),
      document.getElementById('arProgressStep3'),
    ];
    const labels = [
      '1. 데이터 수집 중...',
      '2. AI 심층 분석 (Gemini)',
      '3. PDF 생성 + 저장',
    ];

    steps.forEach((el, i) => {
      if (!el) return;
      if (i < step) {
        el.style.color = '#1a8b46';
        el.innerHTML = `✅ ${labels[i]}`;
      } else if (i === step) {
        el.style.color = 'var(--brand)';
        el.innerHTML = `⏳ ${labels[i]}`;
      } else {
        el.style.color = 'var(--text-3)';
        el.innerHTML = `⏸ ${labels[i]}`;
      }
    });
  }

  /* ====== AI 보고서 생성 ====== */
  async function generateReport() {
    let period;
    try {
      period = getPeriodInput();
    } catch (e) {
      return toast(e.message);
    }

    const saveAsPost = document.getElementById('arSaveAsPost').checked;
    const generatePdf = document.getElementById('arGeneratePdf').checked;
    const postTitle = document.getElementById('arPostTitle').value.trim();

    showStep(2);
    updateProgress(0, '데이터 수집 중...', '후원/회원/지원/사이렌/캠페인 데이터를<br />기간별로 집계하고 있습니다');

    /* 진행 단계 시뮬레이션 (서버는 한 번에 처리하므로 시각적 피드백) */
    setTimeout(() => updateProgress(1, 'AI 분석 중...', 'Gemini AI가 심층 분석하여 보고서를<br />작성하고 있습니다 (10~15초)'), 1500);
    if (generatePdf) {
      setTimeout(() => updateProgress(2, 'PDF 생성 중...', '한글 폰트가 적용된 PDF를<br />생성하고 있습니다'), 14000);
    }

    try {
      const res = await api('/api/admin/activity-report-ai', {
        method: 'POST',
        body: {
          period,
          saveAsPost,
          generatePdf,
          postTitle: postTitle || undefined,
        },
      });

      if (!res.ok) {
        showStep(1);
        return toast(res.data?.error || '보고서 생성 실패');
      }

      _lastResult = res.data.data;
      showResult(_lastResult);
    } catch (e) {
      console.error(e);
      showStep(1);
      toast('네트워크 오류 발생');
    }
  }

  /* ====== 결과 표시 ====== */
  function showResult(result) {
    showStep(3);

    /* 통계 카드 */
    const statsEl = document.getElementById('arResultStats');
    const stats = result.stats || {};
    const d = stats.donations || {};
    const m = stats.members || {};
    const s = stats.support || {};

    statsEl.innerHTML = `
      <div class="ar-stat-card">
        <div class="label">총 모금액</div>
        <div class="value">₩${(d.totalAmount || 0).toLocaleString()}</div>
      </div>
      <div class="ar-stat-card">
        <div class="label">후원자 수</div>
        <div class="value">${(d.donorCount || 0).toLocaleString()}명</div>
      </div>
      <div class="ar-stat-card">
        <div class="label">신규 회원</div>
        <div class="value">${(m.newCount || 0).toLocaleString()}명</div>
      </div>
      <div class="ar-stat-card">
        <div class="label">지원 완료</div>
        <div class="value">${(s.completed || 0).toLocaleString()}건</div>
      </div>
    `;

    /* 보고서 미리보기 */
    const previewEl = document.getElementById('arResultPreview');
    previewEl.innerHTML = result.generated?.fullHtml || '<p>생성된 보고서가 없습니다</p>';

    /* 액션 버튼 */
    const pdfBtn = document.getElementById('arDownloadPdfBtn');
    const editBtn = document.getElementById('arEditPostBtn');

    if (result.pdf?.downloadUrl) {
      pdfBtn.style.display = '';
      pdfBtn.onclick = () => window.open(result.pdf.downloadUrl, '_blank');
    } else {
      pdfBtn.style.display = 'none';
    }

    if (result.saved?.postId) {
      editBtn.style.display = '';
      editBtn.onclick = () => {
        document.getElementById('activityReportModal')?.classList.remove('show');
        if (window.SIREN_ADMIN_CONTENT && window.SIREN_ADMIN_CONTENT.openActivityPost) {
          window.SIREN_ADMIN_CONTENT.openActivityPost(result.saved.postId);
        } else {
          /* fallback: content 페이지로 이동 */
          window.location.hash = '#content';
          toast(`게시글 ID ${result.saved.postId} 저장됨. 콘텐츠 관리에서 확인하세요`);
        }
      };
    } else {
      editBtn.style.display = 'none';
    }

    toast('AI 보고서가 생성되었습니다 ✨', 3000);

    /* 진행 시간 표시 */
    if (result.timing) {
      console.log('[AI Report] 소요 시간:',
        `데이터 ${result.timing.dataCollectMs}ms / AI ${result.timing.aiGenerateMs}ms / 총 ${result.timing.totalMs}ms`);
    }
  }

  /* ====== 이벤트 등록 ====== */
  function setup() {
    /* 모달 열기 */
    document.addEventListener('click', (e) => {
      if (e.target.closest('#arOpenBtn')) {
        e.preventDefault();
        openModal();
        return;
      }

      /* 생성 버튼 */
      if (e.target.closest('#arGenerateBtn')) {
        e.preventDefault();
        generateReport();
        return;
      }

      /* 다시 생성 버튼 */
      if (e.target.closest('#arRegenerateBtn')) {
        e.preventDefault();
        showStep(1);
        return;
      }
    });

    setupPeriodCards();
  }

  /* 외부 노출 */
  window.SIREN_ACTIVITY_REPORT = { openModal };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }
})();