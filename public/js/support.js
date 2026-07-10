/* =========================================================
   SIREN — support.js
   유가족 지원 신청 모달 처리 + 파일 업로드 + 로그인 가드
   ========================================================= */
(function () {
  'use strict';

  let uploadedFiles = []; // [{ key, originalName, size, mimeType }]

  /* ───────── 1. 모달 오픈은 허용, 비로그인 시 모달 안에 안내 배너 표시 ─────────
     이전: capture phase에서 모달 자체를 차단 → 모달 내 "일반 신청 누구나 가능"
           정책과 충돌하여 제거
     변경: 모달은 누구나 열 수 있고, 비로그인 사용자에게는 안내 배너로 알림.
           실제 차단은 폼 제출 시 백엔드 401 응답 + setupForm()이 처리. */
  function setupAuthGuard() {
    document.addEventListener('click', (e) => {
      const trigger = e.target.closest('[data-action="open-modal"][data-target="supportModal"]');
      if (!trigger) return;

      /* 모달이 DOM에 그려진 후 배너 처리 (common.js의 openModal과 타이밍 맞춤) */
      setTimeout(() => {
        const modal = document.getElementById('supportModal');
        if (!modal) return;

        const Auth = window.SIREN_AUTH;
        const isLoggedIn = Auth && Auth.isLoggedIn();

        /* 기존 배너 제거 (모달 재오픈 시 중복 방지) */
        const oldBanner = modal.querySelector('.support-login-banner');
        if (oldBanner) oldBanner.remove();

        /* 로그인 상태면 배너 없음 — 종료 */
        if (isLoggedIn) return;

        /* 비로그인 — 안내 배너 삽입 */
        const subEl = modal.querySelector('.modal-sub');
        if (!subEl) return;

        const banner = document.createElement('div');
        banner.className = 'support-login-banner';
        banner.style.cssText = [
          'background:linear-gradient(135deg,#fef9f5,#fff)',
          'border:1px solid #f0e0d4',
          'border-radius:8px',
          'padding:12px 16px',
          'margin:12px 0',
          'font-size:12.5px',
          'color:#7a1f2b',
          'line-height:1.7',
          'display:flex',
          'align-items:center',
          'gap:10px',
        ].join(';');
        banner.innerHTML = ''
          + '<span style="font-size:20px;flex-shrink:0"></span>'
          + '<div style="flex:1;min-width:0">'
          +   '<strong>신청을 위해 로그인이 필요합니다</strong><br />'
          +   '<span style="color:#86868b">미리 내용을 입력하신 후, 제출 시점에 로그인하시면 작성 내용이 유지됩니다.</span>'
          + '</div>'
          + '<button type="button" data-action="switch-modal" data-from="supportModal" data-to="loginModal"'
          + '  style="padding:6px 12px;background:#7a1f2b;color:#fff;border:none;border-radius:5px;font-size:12px;cursor:pointer;white-space:nowrap;font-family:inherit;flex-shrink:0">'
          +   '로그인'
          + '</button>';
        subEl.insertAdjacentElement('afterend', banner);
      }, 100);
    });
  }

  /* ───────── 2. 파일 선택 시 자동 업로드 ───────── */
  function setupFileUpload() {
    document.addEventListener('change', async (e) => {
      if (e.target.id !== 'supportFile') return;
      const file = e.target.files[0];
      if (!file) return;

      // 클라이언트 검증
      if (file.size > 10 * 1024 * 1024) {
        window.SIREN.toast('파일 크기는 10MB 이하여야 합니다');
        e.target.value = '';
        return;
      }

      const listEl = document.getElementById('supportFileList');
      if (listEl) listEl.innerHTML = `<span style="color:var(--brand)">업로드 중... ${escapeHtml(file.name)}</span>`;

      try {
        const fd = new FormData();
        fd.append('file', file);

        const res = await fetch('/api/support/upload', {
          method: 'POST',
          credentials: 'include',
          body: fd,
        });
        const result = await res.json();

        if (res.ok && result.ok) {
          uploadedFiles.push(result.data);
          renderFileList();
          window.SIREN.toast('파일이 업로드되었습니다');
          e.target.value = '';
        } else {
          window.SIREN.toast(result.error || '파일 업로드 실패');
          if (listEl) listEl.innerHTML = '';
          e.target.value = '';
        }
      } catch (err) {
        console.error('[Upload]', err);
        window.SIREN.toast('파일 업로드 중 오류가 발생했습니다');
        if (listEl) listEl.innerHTML = '';
      }
    });

    /* 파일 삭제 */
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-remove-file]');
      if (!btn) return;
      e.preventDefault();
      const key = btn.dataset.removeFile;
      uploadedFiles = uploadedFiles.filter(f => f.key !== key);
      renderFileList();
    });
  }

  function renderFileList() {
    const listEl = document.getElementById('supportFileList');
    if (!listEl) return;
    if (uploadedFiles.length === 0) {
      listEl.innerHTML = '';
      return;
    }
    listEl.innerHTML = uploadedFiles.map(f => `
      <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--bg-soft);border-radius:6px;margin-bottom:4px;font-size:12.5px">
        <span style="flex:1">${escapeHtml(f.originalName)} <span style="color:var(--text-3)">(${formatSize(f.size)})</span></span>
        <button data-remove-file="${escapeHtml(f.key)}" style="color:var(--danger);font-size:11px;padding:2px 8px;border:none;background:transparent;cursor:pointer">삭제</button>
      </div>
    `).join('');
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  /* ───────── 3. 폼 제출 ───────── */
    /* ───────── 2.5. "일반 신청 (AI 분석 없이)" 버튼 핸들러 ─────────
     skipAi 플래그를 폼에 심어서 submit 트리거 */
  function setupSkipAiButton() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('#supportSkipAiBtn');
      if (!btn) return;
      e.preventDefault();

      const form = btn.closest('form[data-form="support"]');
      if (!form) return;

      /* 폼에 skipAi 플래그 심기 (setupForm이 읽음) */
      form.dataset.skipAi = '1';

      /* 강제 submit */
      if (typeof form.requestSubmit === 'function') {
        form.requestSubmit();
      } else {
        form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      }
    });
  }
  function setupForm() {
    document.addEventListener('submit', async (e) => {
      const form = e.target;
      if (form.dataset.form !== 'support') return;
      e.preventDefault();

      const data = Object.fromEntries(new FormData(form).entries());
      if (!data.title || !data.content) {
        return window.SIREN.toast('제목과 내용을 입력해 주세요');
      }

      const submitBtn = form.querySelector('button[type="submit"]');
      const oldText = submitBtn ? submitBtn.textContent : '';
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '신청 중...'; }

      try {
        const res = await fetch('/api/support/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            category: data.category,
            title: data.title,
            content: data.content,
            attachments: uploadedFiles.map(f => f.key),
            skipAi: form.dataset.skipAi === '1',   // ★ 추가
          }),
        });
        const result = await res.json();

        if (res.ok && result.ok) {
          // 1. 성공 메시지 토스트
          window.SIREN.toast(result.message || '지원 신청이 완료되었습니다');
          window.SIREN.closeModal('supportModal');
          form.reset();
          uploadedFiles = [];
          renderFileList();

          // 2. 1.5초 후 마이페이지 #support 탭으로 이동 (STEP D에서 탭 구현 예정)
          setTimeout(() => {
            window.location.href = '/mypage.html#support';
          }, 1500);

        } else {
          if (res.status === 401) {
            // 세션 만료 등 — 다시 로그인 유도
            window.SIREN.toast('로그인이 필요합니다');
            setTimeout(() => window.SIREN.openModal('loginModal'), 800);
          } else if (res.status === 403) {
            // 회원 승인 대기 (pending) 등
            window.SIREN.toast(result.error || '회원 승인 후 이용 가능합니다');
          } else {
            window.SIREN.toast(result.error || '신청 처리 중 오류가 발생했습니다');
          }
        }
      } catch (err) {
        console.error('[Support]', err);
        window.SIREN.toast('네트워크 오류가 발생했습니다');
      } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = oldText; }
      }
    });
  }

  /* ───────── 4. 초기화 ───────── */
  function init() {
    setupAuthGuard();
    setupFileUpload();
    setupForm();
    setupSkipAiButton();   // ★ 추가
  }

  const prevInit = window.SIREN_PAGE_INIT;
  window.SIREN_PAGE_INIT = function () {
    if (typeof prevInit === 'function') prevInit();
    init();
  };
})();