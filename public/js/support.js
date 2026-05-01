/* =========================================================
   SIREN — support.js
   유가족 지원 신청 모달 처리 + 파일 업로드
   ========================================================= */
(function () {
  'use strict';

  let uploadedFiles = []; // [{ key, originalName, size, mimeType }]

  /* ------------ 1. 파일 선택 시 자동 업로드 ------------ */
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
      if (listEl) listEl.innerHTML = `<span style="color:var(--brand)">⏳ 업로드 중... ${escapeHtml(file.name)}</span>`;

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
        <span style="flex:1">📎 ${escapeHtml(f.originalName)} <span style="color:var(--text-3)">(${formatSize(f.size)})</span></span>
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

  /* ------------ 2. 폼 제출 ------------ */
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
          }),
        });
        const result = await res.json();

        if (res.ok && result.ok) {
          // 1. 성공 메시지 토스트 띄우기 (api에서 내려준 완료 메시지 활용)
          window.SIREN.toast(result.message || '지원 신청이 완료되었습니다.');
          window.SIREN.closeModal('supportModal');
          form.reset();
          uploadedFiles = [];
          renderFileList();
          
          // 2. 알림을 읽을 수 있도록 1.5초 뒤 마이페이지로 강제 이동 (리다이렉트)
          setTimeout(() => {
            window.location.href = '/mypage.html'; // 탭 구분이 필요하다면 '/mypage.html#support' 등으로 수정
          }, 1500);

        } else {
          if (res.status === 401) {
            window.SIREN.toast('로그인이 필요합니다');
            setTimeout(() => window.SIREN.openModal('loginModal'), 800);
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

  /* ------------ 3. 초기화 ------------ */
  function init() {
    setupFileUpload();
    setupForm();
  }

  const prevInit = window.SIREN_PAGE_INIT;
  window.SIREN_PAGE_INIT = function () {
    if (typeof prevInit === 'function') prevInit();
    init();
  };
})();