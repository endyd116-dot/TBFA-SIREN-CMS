/* =========================================================
   SIREN — legal.js (★ Phase M-7 + 2026-05 M-17 후원자 분기 추가)
   - 법률지원 서비스 페이지
   - 단일 페이지 STEP 1/2/3 전환
   ========================================================= */
(function () {
  'use strict';

  /* ============ 헬퍼 ============ */
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function urgencyInfo(u) {
    const map = {
      urgent: { icon: '🚨', label: 'URGENT — 24~72시간 내 조치 필요', cls: 'urgent' },
      high:   { icon: '⚠️', label: 'HIGH — 1~2주 내 대응 필요',       cls: 'high' },
      normal: { icon: '⚖️', label: 'NORMAL — 일반 절차로 충분',        cls: 'normal' },
      low:    { icon: '💡', label: 'LOW — 단순 자문/참고',             cls: 'low' },
    };
    return map[u] || map.normal;
  }

  /* ============ 상태 ============ */
  let _editor = null;
  let _attachments = null;
  let _lastConsultationId = null;

  /* ============ 단계 전환 ============ */
  function showStep(n) {
    document.querySelectorAll('.legal-step').forEach((s) => s.style.display = 'none');
    const target = document.querySelector(`.legal-step[data-legal-step="${n}"]`);
    if (target) target.style.display = '';

    document.querySelectorAll('.legal-step-indicator').forEach((el) => {
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
          el: document.getElementById('legalEditor'),
          height: '360px',
          placeholder: '사실관계를 시간순으로 구체적으로 작성해 주세요.\n\n예) 2024년 3월 15일 오후, ○○가 ... / 같은 달 20일에는 ...\n\n이메일·문자·녹음 내용도 함께 적어주시면 도움됩니다.',
          uploadContext: 'legal-consultation',
        });
      } catch (e) {
        console.error('[legal] editor init failed', e);
        if (window.SIREN && window.SIREN.toast) {
          window.SIREN.toast('편집기 로드 실패 — 새로고침해 주세요');
        }
      }
    }

    if (!_attachments && window.SirenAttachment) {
      _attachments = window.SirenAttachment.create({
        el: document.getElementById('legalAttachments'),
        context: 'legal-consultation',
        maxFiles: 15,
      });
    }
  }

  /* ============ 폼 제출 ============ */
  async function handleSubmit(e) {
    e.preventDefault();
    const form = e.target;

    const auth = window.SIREN_AUTH;
    if (!auth || !auth.isLoggedIn()) {
      window.SIREN.toast('상담 신청에는 로그인이 필요합니다');
      setTimeout(() => {
        const loginBtn = document.querySelector('[data-target="loginModal"]');
        if (loginBtn) loginBtn.click();
      }, 600);
      return;
    }

    const fd = new FormData(form);
    const category = String(fd.get('category') || 'school_dispute');
    const urgency = String(fd.get('urgency') || '') || null;
    const occurredAt = String(fd.get('occurredAt') || '') || null;
    const partyInfo = String(fd.get('partyInfo') || '').trim() || null;
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
      window.SIREN.toast('사실관계를 10자 이상 입력해 주세요');
      return;
    }

    if (_attachments && _attachments.hasUploading && _attachments.hasUploading()) {
      window.SIREN.toast('첨부 파일이 아직 업로드 중입니다');
      return;
    }

    const attachmentIds = (_attachments && _attachments.getIds) ? _attachments.getIds() : [];

    const submitBtn = document.getElementById('legalSubmitBtn');
    const oldText = submitBtn ? submitBtn.textContent : '';
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = '🤖 AI 법률 분석 중... (최대 15초)';
    }

    try {
      const res = await fetch('/api/legal-consultation-create', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category, urgency, occurredAt, partyInfo,
          title, contentHtml, isAnonymous, attachmentIds,
        }),
      });
      const json = await res.json();

      if (!res.ok || !json.ok) {
        if (res.status === 401) {
          window.SIREN.toast('로그인이 만료되었습니다. 다시 로그인해 주세요');
        } else {
          window.SIREN.toast(json.error || '처리 실패');
        }
        return;
      }

      const data = json.data || {};
      _lastConsultationId = data.consultationId;

      renderAiResult(data);
      showStep(2);
    } catch (e) {
      console.error('[legal] submit', e);
      window.SIREN.toast('네트워크 오류. 잠시 후 다시 시도해 주세요');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = oldText;
      }
    }
  }

  /* ============ AI 결과 렌더 (★ M-17 후원자 분기 추가) ============ */
  function renderAiResult(data) {
    const noEl = document.getElementById('legalConsultationNo');
    if (noEl) noEl.textContent = data.consultationNo || '-';

    if (data.isDonor && data.ai) {
      /* ─── 후원자 — AI 분석 결과 정상 표시 ─── */
      const ai = data.ai;

      const notice = document.getElementById('legalPremiumNotice');
      if (notice) notice.style.display = 'none';

      /* 긴급도 배너 */
      const banner = document.getElementById('legalUrgencyBanner');
      if (banner) {
        banner.style.display = '';
        const urg = ai.urgency || 'normal';
        const urgInfo = urgencyInfo(urg);
        banner.className = 'legal-urgency-banner ' + urgInfo.cls;
        const iconEl = document.getElementById('legalUrgencyIcon');
        const labelEl = document.getElementById('legalUrgencyLabel');
        if (iconEl) iconEl.textContent = urgInfo.icon;
        if (labelEl) labelEl.textContent = urgInfo.label;
      }

      const fields = [
        ['legalAiSummary', ai.summary || '(AI 법률 분석을 일시적으로 사용할 수 없습니다)'],
        ['legalAiLaws', ai.relatedLaws || '(관련 법령 정보가 없습니다)'],
        ['legalAiOpinion', ai.legalOpinion || '(1차 법률 의견을 제공할 수 없습니다)'],
        ['legalLawyerSpecialty', ai.lawyerSpecialty || '교육법 / 일반 민·형사'],
        ['legalAiImmediate', ai.immediateAction || '(즉시 조치 필요사항이 없습니다)'],
        ['legalAiSuggestion', ai.suggestion || '(권장사항 정보가 없습니다)'],
      ];
      fields.forEach(([id, val]) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
      });
    } else if (data.premiumNotice) {
      /* ─── 비후원자 — 후원 회원 전용 안내 ─── */
      const banner = document.getElementById('legalUrgencyBanner');
      if (banner) banner.style.display = 'none';

      ['legalAiSummary', 'legalAiLaws', 'legalAiOpinion', 'legalLawyerSpecialty',
       'legalAiImmediate', 'legalAiSuggestion'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.textContent = '';
      });

      renderLegalPremiumNotice(data.premiumNotice);
    }
  }

  /* ★ M-17: 비후원자 안내 박스 */
  function renderLegalPremiumNotice(notice) {
    const step2 = document.querySelector('.legal-step[data-legal-step="2"]');
    if (!step2) return;

    let box = document.getElementById('legalPremiumNotice');
    if (!box) {
      box = document.createElement('div');
      box.id = 'legalPremiumNotice';
      box.style.cssText = 'background:linear-gradient(135deg,#fef9f5,#fff);border:2px solid #7a1f2b;border-radius:10px;padding:28px;margin:18px 0;text-align:center';

      const noBox = document.getElementById('legalConsultationNo');
      const target = noBox ? noBox.closest('div') : null;
      if (target && target.parentElement) {
        target.parentElement.insertBefore(box, target.nextSibling);
      } else {
        step2.appendChild(box);
      }
    }
    box.style.display = '';

    const safeMessage = String(notice.message || '').replace(/\n/g, '<br />');
    box.innerHTML =
      '<div style="font-family:\'Noto Serif KR\',serif;font-size:19px;font-weight:700;color:#7a1f2b;margin-bottom:14px">' +
        escapeHtml(notice.title || '🎗 사이렌 후원 회원 전용 서비스') +
      '</div>' +
      '<div style="font-size:13.5px;color:#525252;line-height:1.8;margin-bottom:20px">' +
        safeMessage +
      '</div>' +
      '<a href="' + escapeHtml(notice.ctaUrl || '/support.html') + '" ' +
         'style="display:inline-block;padding:14px 32px;background:#7a1f2b;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px">' +
        escapeHtml(notice.ctaText || '후원하러 가기') + ' →' +
      '</a>';
  }

  /* ============ 변호사 매칭 결정 ============ */
  async function confirmConsultation(requested) {
    if (!_lastConsultationId) return;

    const btnSiren = document.getElementById('legalBtnSiren');
    const btnAiOnly = document.getElementById('legalBtnAiOnly');
    [btnSiren, btnAiOnly].forEach((b) => { if (b) b.disabled = true; });

    try {
      const res = await fetch('/api/legal-consultation-confirm', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          consultationId: _lastConsultationId,
          sirenReportRequested: requested,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        window.SIREN.toast(json.error || '처리 실패');
        return;
      }

      const finalIcon = document.getElementById('legalFinalIcon');
      const finalTitle = document.getElementById('legalFinalTitle');
      const finalMsg = document.getElementById('legalFinalMsg');

      if (requested) {
        if (finalIcon) finalIcon.textContent = '👨‍⚖️';
        if (finalTitle) finalTitle.textContent = '변호사 매칭이 신청되었습니다';
        if (finalMsg) finalMsg.innerHTML =
          '소중한 신청 감사합니다.<br />' +
          '사안에 맞는 변호사를 검토하여 배정해 드리며,<br />' +
          '마이페이지 &gt; 신청 내역에서 진행 상태를 확인하실 수 있습니다.<br /><br />' +
          '<span style="color:var(--text-3);font-size:12px">※ 변호사 배정까지 영업일 기준 1~3일이 소요될 수 있습니다.</span>';
      } else {
        if (finalIcon) finalIcon.textContent = '📋';
        if (finalTitle) finalTitle.textContent = 'AI 자문으로 종료 처리되었습니다';
        if (finalMsg) finalMsg.innerHTML =
          '상담 내역이 기록되었습니다.<br />' +
          '추후 변호사 매칭이 필요하시면<br />' +
          '마이페이지 &gt; 1:1 상담을 이용해 주세요.';
      }
      showStep(3);
    } catch (e) {
      console.error('[legal] confirm', e);
      window.SIREN.toast('네트워크 오류');
    } finally {
      [btnSiren, btnAiOnly].forEach((b) => { if (b) b.disabled = false; });
    }
  }

  /* ============ 초기화 ============ */
  function init() {
    if (document.body.dataset.page !== 'legal') return;

    setTimeout(() => {
      const auth = window.SIREN_AUTH;
      if (!auth || !auth.isLoggedIn()) {
        if (window.SIREN && window.SIREN.toast) {
          window.SIREN.toast('상담 신청에는 로그인이 필요합니다');
        }
      }
    }, 1500);

    initEditorAndAttachments();

    const form = document.getElementById('legalForm');
    if (form) form.addEventListener('submit', handleSubmit);

    const btnSiren = document.getElementById('legalBtnSiren');
    const btnAiOnly = document.getElementById('legalBtnAiOnly');
    if (btnSiren) btnSiren.addEventListener('click', () => confirmConsultation(true));
    if (btnAiOnly) btnAiOnly.addEventListener('click', () => confirmConsultation(false));
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