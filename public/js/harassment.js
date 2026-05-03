/* =========================================================
   SIREN — harassment.js (★ Phase M-6)
   - 악성민원 신고 페이지
   - 단일 페이지 STEP 1/2/3 전환
   ========================================================= */
(function () {
  'use strict';

  /* ============ 헬퍼 ============ */
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function severityInfo(s) {
    const map = {
      critical: { icon: '🚨', label: 'CRITICAL — 즉시 대응 필요', cls: 'critical' },
      high:     { icon: '⚠️', label: 'HIGH — 긴급 검토 필요',     cls: 'high' },
      medium:   { icon: '⚖️', label: 'MEDIUM — 정상 대응',         cls: 'medium' },
      low:      { icon: '💡', label: 'LOW — 일반 의견',            cls: 'low' },
    };
    return map[s] || map.medium;
  }

  /* ============ 상태 ============ */
  let _editor = null;
  let _attachments = null;
  let _lastReportId = null;

  /* ============ 단계 전환 ============ */
  function showStep(n) {
    document.querySelectorAll('.harass-step').forEach((s) => s.style.display = 'none');
    const target = document.querySelector(`.harass-step[data-harass-step="${n}"]`);
    if (target) target.style.display = '';

    /* 단계 인디케이터 */
    document.querySelectorAll('.harass-step-indicator').forEach((el) => {
      const num = Number(el.dataset.stepInd);
      el.classList.remove('active', 'done');
      if (num < n) el.classList.add('done');
      else if (num === n) el.classList.add('active');
    });

    /* 화면 상단으로 부드럽게 스크롤 */
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ============ 편집기 + 첨부 초기화 ============ */
  async function initEditorAndAttachments() {
    /* 편집기 */
    if (!_editor) {
      try {
        _editor = await window.SirenEditor.create({
          el: document.getElementById('harassEditor'),
          height: '320px',
          placeholder: '겪으신 상황을 자세히 적어주세요. 누가, 언제, 어디서, 어떤 일이 있었는지 구체적일수록 정확한 분석이 가능합니다. 이메일·문자 내용 인용도 도움됩니다.',
          uploadContext: 'harassment-report',
        });
      } catch (e) {
        console.error('[harassment] editor init failed', e);
        window.SIREN.toast('편집기 로드 실패');
      }
    }

    /* 첨부 */
    if (!_attachments && window.SirenAttachment) {
      _attachments = window.SirenAttachment.create({
        el: document.getElementById('harassAttachments'),
        context: 'harassment-report',
        maxFiles: 10,
      });
    }
  }

  /* ============ 폼 제출 ============ */
  async function handleSubmit(e) {
    e.preventDefault();
    const form = e.target;

    const auth = window.SIREN_AUTH;
    if (!auth || !auth.isLoggedIn()) {
      window.SIREN.toast('신고하려면 로그인이 필요합니다');
      setTimeout(() => {
        const loginBtn = document.querySelector('[data-target="loginModal"]');
        if (loginBtn) loginBtn.click();
      }, 600);
      return;
    }

    const fd = new FormData(form);
    const category = String(fd.get('category') || 'parent');
    const frequency = String(fd.get('frequency') || '') || null;
    const occurredAt = String(fd.get('occurredAt') || '') || null;
    const title = String(fd.get('title') || '').trim();
    const isAnonymous = !!fd.get('isAnonymous');

    if (!title) {
      window.SIREN.toast('제목을 입력해 주세요');
      return;
    }

    let contentHtml = '';
    try { contentHtml = _editor ? _editor.getHTML() : ''; } catch (_) {}
    contentHtml = String(contentHtml || '').trim();

    const plain = contentHtml.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
    if (plain.length < 10) {
      window.SIREN.toast('상세 내용을 10자 이상 입력해 주세요');
      return;
    }

    if (_attachments && _attachments.hasUploading && _attachments.hasUploading()) {
      window.SIREN.toast('첨부 파일이 아직 업로드 중입니다');
      return;
    }

    const attachmentIds = (_attachments && _attachments.getIds) ? _attachments.getIds() : [];

    const submitBtn = document.getElementById('harassSubmitBtn');
    const oldText = submitBtn ? submitBtn.textContent : '';
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = '🤖 AI 분석 중... (최대 10초 소요)';
    }

    try {
      const res = await fetch('/api/harassment-report-create', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category,
          frequency,
          occurredAt,
          title,
          contentHtml,
          isAnonymous,
          attachmentIds,
        }),
      });
      const json = await res.json();

      if (!res.ok || !json.ok) {
        if (res.status === 401) {
          window.SIREN.toast('로그인이 만료되었습니다. 다시 로그인해 주세요');
        } else {
          window.SIREN.toast(json.error || '신고 처리 실패');
        }
        return;
      }

      const data = json.data || {};
      _lastReportId = data.reportId;

      renderAiResult(data);
      showStep(2);
    } catch (e) {
      console.error('[harassment] submit', e);
      window.SIREN.toast('네트워크 오류. 잠시 후 다시 시도해 주세요');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = oldText;
      }
    }
  }

  /* ============ AI 결과 렌더 ============ */
  function renderAiResult(data) {
    const ai = data.ai || {};

    /* 접수번호 */
    document.getElementById('harassReportNo').textContent = data.reportNo || '-';

    /* 심각도 배너 */
    const sev = ai.severity || 'medium';
    const sevInfo = severityInfo(sev);
    const banner = document.getElementById('harassSeverityBanner');
    banner.className = 'harass-severity-banner ' + sevInfo.cls;
    document.getElementById('harassSeverityIcon').textContent = sevInfo.icon;
    document.getElementById('harassSeverityLabel').textContent = sevInfo.label;

    /* 본문 */
    document.getElementById('harassAiSummary').textContent =
      ai.summary || '(AI 분석을 일시적으로 사용할 수 없습니다)';
    document.getElementById('harassAiImmediate').textContent =
      ai.immediateAction || '(즉각적 대처 정보가 없습니다)';
    document.getElementById('harassAiSuggestion').textContent =
      ai.suggestion || '(권장사항 정보가 없습니다)';

    /* 법적 검토 카드 */
    const legalCard = document.getElementById('harassLegalCard');
    const legalStatus = document.getElementById('harassLegalStatus');
    const legalReason = document.getElementById('harassLegalReason');
    if (ai.legalReviewNeeded) {
      legalCard.classList.add('needed');
      legalStatus.textContent = '⚖️ 검토 필요';
    } else {
      legalCard.classList.remove('needed');
      legalStatus.textContent = '현재 단계 불필요';
    }
    legalReason.textContent = ai.legalReason || '-';

    /* 심리지원 카드 */
    const psychCard = document.getElementById('harassPsychCard');
    const psychStatus = document.getElementById('harassPsychStatus');
    const psychReason = document.getElementById('harassPsychCard').querySelector('.reason');
    if (ai.psychSupportNeeded) {
      psychCard.classList.add('needed');
      psychStatus.textContent = '💗 권장';
      psychReason.textContent = '심리적 어려움이 감지되어 전문 상담을 권장드립니다. 사이렌 정식 신고 시 심리상담사 매칭이 가능합니다.';
    } else {
      psychCard.classList.remove('needed');
      psychStatus.textContent = '선택사항';
      psychReason.textContent = '필요하시면 사이렌 1:1 상담을 통해 안내받으실 수 있습니다.';
    }
  }

  /* ============ 사이렌 정식 신고 결정 ============ */
  async function confirmReport(requested) {
    if (!_lastReportId) return;

    const btnSiren = document.getElementById('harassBtnSiren');
    const btnAiOnly = document.getElementById('harassBtnAiOnly');
    [btnSiren, btnAiOnly].forEach((b) => { if (b) b.disabled = true; });

    try {
      const res = await fetch('/api/harassment-report-confirm', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportId: _lastReportId,
          sirenReportRequested: requested,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        window.SIREN.toast(json.error || '처리 실패');
        return;
      }

      /* 완료 화면 */
      const finalIcon = document.getElementById('harassFinalIcon');
      const finalTitle = document.getElementById('harassFinalTitle');
      const finalMsg = document.getElementById('harassFinalMsg');

      if (requested) {
        finalIcon.textContent = '✅';
        finalTitle.textContent = '사이렌에 정식 신고되었습니다';
        finalMsg.innerHTML =
          '소중한 신고 감사합니다.<br />' +
          '운영진 검토 후 답변을 드리며,<br />' +
          '마이페이지 &gt; 신청 내역에서 진행 상태를 확인하실 수 있습니다.';
      } else {
        finalIcon.textContent = '📋';
        finalTitle.textContent = 'AI 답변으로 종료 처리되었습니다';
        finalMsg.innerHTML =
          '신고 내역이 기록되었습니다.<br />' +
          '추후 사이렌 정식 신고가 필요하시면<br />' +
          '마이페이지 &gt; 1:1 상담을 이용해 주세요.';
      }
      showStep(3);
    } catch (e) {
      console.error('[harassment] confirm', e);
      window.SIREN.toast('네트워크 오류');
    } finally {
      [btnSiren, btnAiOnly].forEach((b) => { if (b) b.disabled = false; });
    }
  }

  /* ============ 초기화 ============ */
  function init() {
    if (document.body.dataset.page !== 'harassment') return;

    /* 비로그인 시 안내 (페이지 진입 시점) */
    setTimeout(() => {
      const auth = window.SIREN_AUTH;
      if (!auth || !auth.isLoggedIn()) {
        window.SIREN.toast('신고하려면 로그인이 필요합니다');
      }
    }, 1500);

    /* 편집기/첨부 초기화 (지연 로드) */
    initEditorAndAttachments();

    /* 폼 제출 */
    const form = document.getElementById('harassmentForm');
    if (form) form.addEventListener('submit', handleSubmit);

    /* 결정 버튼 */
    const btnSiren = document.getElementById('harassBtnSiren');
    const btnAiOnly = document.getElementById('harassBtnAiOnly');
    if (btnSiren) btnSiren.addEventListener('click', () => confirmReport(true));
    if (btnAiOnly) btnAiOnly.addEventListener('click', () => confirmReport(false));
  }

  const prevInit = window.SIREN_PAGE_INIT;
  window.SIREN_PAGE_INIT = function () {
    if (typeof prevInit === 'function') prevInit();
    init();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();