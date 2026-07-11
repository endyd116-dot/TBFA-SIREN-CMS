/* =========================================================
   SIREN — harassment.js (M-6 + 2026-05 + B-9 토스트 + 3-3 AI/일반 분리)
   ========================================================= */
(function () {
  'use strict';

  /* ============ 헬퍼 ============ */
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function calcAiToastDuration(plainLen, attachCount) {
    let ms = 8000;
    if (plainLen > 200) ms += 5000;
    if (plainLen > 500) ms += 5000;
    if (plainLen > 1000) ms += 10000;
    ms += (attachCount || 0) * 10000;
    return Math.min(ms, 90000);
  }

  function showAiToast(msg, duration) {
    const ms = duration || 5000;
    const t = document.getElementById('toast');
    if (t) {
      if (t._aiTimer) clearTimeout(t._aiTimer);
      if (t._tt) clearTimeout(t._tt);
      setTimeout(() => {
        t.textContent = msg;
        t.style.whiteSpace = 'pre-line';
        t.style.maxWidth = '90vw';
        t.style.lineHeight = '1.6';
        t.style.padding = '16px 26px';
        t.classList.add('show');
        t._aiTimer = setTimeout(() => {
          t.classList.remove('show');
          t.style.whiteSpace = '';
          t.style.maxWidth = '';
          t.style.lineHeight = '';
          t.style.padding = '';
        }, ms);
      }, 50);
      return;
    }
    const tmp = document.createElement('div');
    tmp.style.cssText = 'position:fixed;bottom:30px;left:50%;transform:translateX(-50%);background:#0f0f0f;color:#fff;padding:14px 26px;border-radius:12px;font-size:13.5px;z-index:9999;box-shadow:0 10px 30px rgba(0,0,0,0.3);font-weight:500;line-height:1.6;text-align:center;white-space:pre-line;max-width:90vw;';
    tmp.textContent = msg;
    document.body.appendChild(tmp);
    setTimeout(() => tmp.remove(), ms);
  }

  function severityInfo(s) {
    const map = {
      critical: { icon: '', label: 'CRITICAL — 즉시 대응 필요', cls: 'critical' },
      high:     { icon: '', label: 'HIGH — 긴급 검토 필요',     cls: 'high' },
      medium:   { icon: '', label: 'MEDIUM — 정상 대응',         cls: 'medium' },
      low:      { icon: '', label: 'LOW — 일반 의견',            cls: 'low' },
    };
    return map[s] || map.medium;
  }

  /* ============ 상태 ============ */
  let _editor = null;
  let _attachments = null;
  let _lastReportId = null;
  let _donorStatusCache = null;  /* 3-3: 후원자 상태 캐시 */

  /* 3-3: 후원자 상태 조회 */
  async function loadDonorStatus() {
    if (_donorStatusCache !== null) return _donorStatusCache;
    try {
      const res = await fetch('/api/me/donor-status', { credentials: 'include' });
      if (!res.ok) {
        _donorStatusCache = { isDonor: false, donationCount: 0 };
        return _donorStatusCache;
      }
      const json = await res.json();
      _donorStatusCache = json.data || { isDonor: false, donationCount: 0 };
      return _donorStatusCache;
    } catch (e) {
      console.warn('[harassment] donor-status 조회 실패', e);
      _donorStatusCache = { isDonor: false, donationCount: 0 };
      return _donorStatusCache;
    }
  }

  /* 3-3: 후원자 안내 모달 표시 */
  function showDonorRequiredModal() {
    const modal = document.getElementById('donorRequiredModal');
    if (modal) {
      modal.classList.add('show');
    } else {
      alert('AI 분석은 후원 회원 전용 서비스입니다. 일반 신고는 가능합니다.');
    }
  }

  /* ============ 단계 전환 ============ */
  function showStep(n) {
    document.querySelectorAll('.harass-step').forEach((s) => s.style.display = 'none');
    const target = document.querySelector(`.harass-step[data-harass-step="${n}"]`);
    if (target) target.style.display = '';

    document.querySelectorAll('.harass-step-indicator').forEach((el) => {
      const num = Number(el.dataset.stepInd);
      el.classList.remove('active', 'done');
      if (num < n) el.classList.add('done');
      else if (num === n) el.classList.add('active');
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ============ 편집기 + 첨부 ============ */
  async function initEditorAndAttachments() {
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
        if (window.SIREN && window.SIREN.toast) {
          window.SIREN.toast('편집기 로드 실패 — 새로고침해 주세요');
        }
      }
    }

    if (!_attachments && window.SirenAttachment) {
      _attachments = window.SirenAttachment.create({
        el: document.getElementById('harassAttachments'),
        context: 'harassment-report',
        maxFiles: 10,
      });
    }
  }

  /* ============ 폼 제출 (3-3: skipAi 매개변수 추가) ============ */
  async function handleSubmit(e, skipAi) {
    if (e && e.preventDefault) e.preventDefault();
    skipAi = !!skipAi;

    const form = document.getElementById('harassmentForm');
    if (!form) return;

    const auth = window.SIREN_AUTH;
    if (!auth || !auth.isLoggedIn()) {
      window.SIREN.toast('신고하려면 로그인이 필요합니다');
      setTimeout(() => {
        const loginBtn = document.querySelector('[data-target="loginModal"]');
        if (loginBtn) loginBtn.click();
      }, 600);
      return;
    }

    /* 3-3: AI 분석 시도 시 후원자 검증 */
    if (!skipAi) {
      const donorStatus = await loadDonorStatus();
      if (!donorStatus.isDonor) {
        showDonorRequiredModal();
        return;
      }
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
    const skipBtn = document.getElementById('harassSkipAiBtn');
    const oldText = submitBtn ? submitBtn.textContent : '';
    const oldSkipText = skipBtn ? skipBtn.textContent : '';
    if (submitBtn) submitBtn.disabled = true;
    if (skipBtn) skipBtn.disabled = true;

    if (skipAi) {
      if (skipBtn) skipBtn.textContent = '처리 중...';
    } else {
      if (submitBtn) submitBtn.textContent = 'AI 분석 중... (최대 10초 소요)';
      const toastMs = calcAiToastDuration(plain.length, attachmentIds.length);
      showAiToast(
        'AI 분석에 시간이 걸릴 수 있습니다.\n응답이 오래 없으면 다시 한번 눌러주세요',
        toastMs
      );
    }

    try {
      const res = await fetch('/api/harassment-report-create', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category, frequency, occurredAt,
          title, contentHtml, isAnonymous, attachmentIds,
          skipAi,
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

      /* 3-3: skipAi=true면 STEP 2 건너뛰고 STEP 3 직행 */
      if (skipAi) {
        const finalIcon = document.getElementById('harassFinalIcon');
        const finalTitle = document.getElementById('harassFinalTitle');
        const finalMsg = document.getElementById('harassFinalMsg');
        if (finalIcon) finalIcon.textContent = '';
        if (finalTitle) finalTitle.textContent = '신고가 접수되었습니다';
        if (finalMsg) finalMsg.innerHTML =
          '소중한 신고 감사합니다.<br />' +
          '운영진이 직접 검토 후 답변드리며,<br />' +
          '마이페이지 &gt; 신청 내역에서 진행 상태를 확인하실 수 있습니다.';
        showStep(3);
      } else {
        renderAiResult(data);
        showStep(2);
      }
    } catch (e) {
      console.error('[harassment] submit', e);
      window.SIREN.toast('네트워크 오류. 잠시 후 다시 시도해 주세요');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = oldText;
      }
      if (skipBtn) {
        skipBtn.disabled = false;
        skipBtn.textContent = oldSkipText;
      }
    }
  }

  /* ============ AI 결과 렌더 ============ */
  function renderAiResult(data) {
    const reportNoEl = document.getElementById('harassReportNo');
    if (reportNoEl) reportNoEl.textContent = data.reportNo || '-';

    if (data.isDonor && data.ai) {
      const ai = data.ai;
      const notice = document.getElementById('harassPremiumNotice');
      if (notice) notice.style.display = 'none';

      const sev = ai.severity || 'medium';
      const sevInfo = severityInfo(sev);
      const sevBox = document.getElementById('harassSeverityBanner');
      if (sevBox) {
        sevBox.style.display = '';
        sevBox.className = 'harass-severity-banner ' + sevInfo.cls;
      }
      const sevIcon = document.getElementById('harassSeverityIcon');
      const sevLabel = document.getElementById('harassSeverityLabel');
      if (sevIcon) sevIcon.textContent = sevInfo.icon;
      if (sevLabel) sevLabel.textContent = sevInfo.label;

      const fields = [
        ['harassAiSummary', ai.summary || '(AI 분석을 일시적으로 사용할 수 없습니다)'],
        ['harassAiImmediate', ai.immediateAction || '(즉시 조치사항 정보 없음)'],
        ['harassAiSuggestion', ai.suggestion || '(권장사항 정보 없음)'],
      ];
      fields.forEach(([id, val]) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
      });

      const legalStatusEl = document.getElementById('harassLegalStatus');
      const legalReasonEl = document.getElementById('harassLegalReason');
      if (legalStatusEl) legalStatusEl.textContent = ai.legalReviewNeeded ? '필요' : '불필요';
      if (legalReasonEl) legalReasonEl.textContent = ai.legalReason || (ai.legalReviewNeeded ? '법률 검토 권장' : '법적 조치는 현재 단계에서 권장되지 않습니다');

      const psychStatusEl = document.getElementById('harassPsychStatus');
      const psychReasonEl = document.getElementById('harassPsychReason');
      if (psychStatusEl) psychStatusEl.textContent = ai.psychSupportNeeded ? '권장' : '필요 없음';
      if (psychReasonEl) psychReasonEl.textContent = ai.psychSupportNeeded ? '전문 상담사 매칭을 권장합니다' : '심리적 어려움이 적은 것으로 분석됩니다';
    } else if (data.premiumNotice) {
      const sevBox = document.getElementById('harassSeverityBanner');
      if (sevBox) sevBox.style.display = 'none';

      ['harassAiSummary', 'harassAiImmediate', 'harassAiSuggestion',
       'harassLegalStatus', 'harassLegalReason',
       'harassPsychStatus', 'harassPsychReason'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.textContent = '';
      });

      renderHarassPremiumNotice(data.premiumNotice);
    }
  }

  function renderHarassPremiumNotice(notice) {
    const step2 = document.querySelector('.harass-step[data-harass-step="2"]');
    if (!step2) return;

    let box = document.getElementById('harassPremiumNotice');
    if (!box) {
      box = document.createElement('div');
      box.id = 'harassPremiumNotice';
      box.style.cssText = 'background:linear-gradient(135deg,#fef9f5,#fff);border:2px solid #7a1f2b;border-radius:10px;padding:28px;margin:18px 0;text-align:center';

      const reportNoBox = document.getElementById('harassReportNo');
      const insertTarget = reportNoBox ? reportNoBox.closest('.harass-ai-header') : null;
      if (insertTarget && insertTarget.parentElement) {
        insertTarget.parentElement.insertBefore(box, insertTarget.nextSibling);
      } else {
        step2.appendChild(box);
      }
    }
    box.style.display = '';

    const safeMessage = String(notice.message || '').replace(/\n/g, '<br />');
    box.innerHTML =
      '<div style="font-family:\'Noto Serif KR\',serif;font-size:19px;font-weight:700;color:#7a1f2b;margin-bottom:14px">' +
        escapeHtml(notice.title || '사이렌 후원 회원 전용 서비스') +
      '</div>' +
      '<div style="font-size:13.5px;color:#525252;line-height:1.8;margin-bottom:20px">' +
        safeMessage +
      '</div>' +
      '<a href="' + escapeHtml(notice.ctaUrl || '/support.html') + '" ' +
         'style="display:inline-block;padding:14px 32px;background:#7a1f2b;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px">' +
        escapeHtml(notice.ctaText || '후원하러 가기') + ' →' +
      '</a>';
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

      const finalIcon = document.getElementById('harassFinalIcon');
      const finalTitle = document.getElementById('harassFinalTitle');
      const finalMsg = document.getElementById('harassFinalMsg');

      if (requested) {
        if (finalIcon) finalIcon.textContent = '';
        if (finalTitle) finalTitle.textContent = '사이렌에 정식 신고되었습니다';
        if (finalMsg) finalMsg.innerHTML =
          '소중한 신고 감사합니다.<br />' +
          '운영진 검토 후 답변을 드리며,<br />' +
          '마이페이지 &gt; 신청 내역에서 진행 상태를 확인하실 수 있습니다.';
      } else {
        if (finalIcon) finalIcon.textContent = '';
        if (finalTitle) finalTitle.textContent = 'AI 답변으로 종료 처리되었습니다';
        if (finalMsg) finalMsg.innerHTML =
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
  let _initialized = false;
  function init() {
    if (_initialized) return;
    if (document.body.dataset.page !== 'harassment') return;
    _initialized = true;

    setTimeout(() => {
      const auth = window.SIREN_AUTH;
      if (!auth || !auth.isLoggedIn()) {
        if (window.SIREN && window.SIREN.toast) {
          window.SIREN.toast('신고하려면 로그인이 필요합니다');
        }
      } else {
        /* 로그인 상태면 후원자 상태 사전 조회 (캐시) */
        loadDonorStatus();
      }
    }, 1500);

    initEditorAndAttachments();

    /* AI 분석 후 제출 (form submit) */
    const form = document.getElementById('harassmentForm');
    if (form) form.addEventListener('submit', (e) => handleSubmit(e, false));

    /* 3-3: 일반 신고 버튼 */
    const skipBtn = document.getElementById('harassSkipAiBtn');
    if (skipBtn) {
      skipBtn.addEventListener('click', (e) => {
        e.preventDefault();
        handleSubmit(null, true);
      });
    }

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