/* ============================================================
   SIREN — admin-profile-modal.js
   어드민 본인 정보 수정 모달 (이름·이메일·전화·비밀번호)

   - cms-tbfa.html 의 #cmsAvatar / #cmsUserName 클릭 시 모달
   - admin.html  의 .adm-avatar / .adm-user 클릭 시 모달
   - PATCH /api/admin-me-update 로 저장
   - 비밀번호 변경 칸은 비워두면 변경 없음 (이름·이메일·전화만 변경)
   ============================================================ */
(function () {
  'use strict';

  if (window.__adminProfileModalLoaded) return;
  window.__adminProfileModalLoaded = true;

  /* ───────── 스타일 ───────── */
  function injectStyle() {
    if (document.getElementById('apm-css')) return;
    var s = document.createElement('style');
    s.id = 'apm-css';
    s.textContent = '\
      .apm-backdrop { position:fixed; inset:0; background:rgba(0,0,0,0.45); z-index:9990; display:none; }\
      .apm-backdrop.show { display:flex; align-items:center; justify-content:center; }\
      .apm-modal { background:#fff; width:480px; max-width:92vw; max-height:88vh; overflow:auto;\
        border-radius:10px; padding:24px 26px; box-shadow:0 12px 36px rgba(0,0,0,0.2);\
        font-family:"Noto Sans KR", sans-serif; color:#1f2937; }\
      .apm-title { font-size:18px; font-weight:700; margin:0 0 4px; color:#0f172a; }\
      .apm-desc  { font-size:12.5px; color:#64748b; margin-bottom:18px; line-height:1.55; }\
      .apm-section { font-size:13px; font-weight:600; color:#475569; margin:14px 0 8px; padding-top:12px;\
        border-top:1px solid #e2e8f0; }\
      .apm-section:first-of-type { border-top:none; padding-top:0; margin-top:0; }\
      .apm-row { margin-bottom:12px; }\
      .apm-row label { display:block; font-size:12px; font-weight:600; color:#475569; margin-bottom:5px; }\
      .apm-row input { width:100%; padding:9px 11px; font-size:13.5px; border:1px solid #cbd5e1;\
        border-radius:6px; box-sizing:border-box; font-family:inherit; }\
      .apm-row input:focus { outline:none; border-color:#7a1f2b; }\
      .apm-row .apm-hint { font-size:11px; color:#94a3b8; margin-top:3px; }\
      .apm-actions { display:flex; gap:8px; justify-content:flex-end; margin-top:20px; padding-top:14px;\
        border-top:1px solid #e2e8f0; }\
      .apm-btn { padding:8px 16px; font-size:13px; font-weight:600; border-radius:6px; cursor:pointer;\
        border:1px solid transparent; }\
      .apm-btn-cancel { background:#fff; color:#475569; border-color:#cbd5e1; }\
      .apm-btn-save   { background:#7a1f2b; color:#fff; }\
      .apm-btn-save:disabled { opacity:0.55; cursor:wait; }\
      .apm-toast { position:fixed; bottom:30px; left:50%; transform:translateX(-50%); z-index:9999;\
        background:#0f172a; color:#fff; padding:11px 18px; border-radius:6px; font-size:13px;\
        font-weight:600; display:none; }\
      .apm-toast.show { display:block; }\
      .apm-toast.err  { background:#c5293a; }\
    ';
    document.head.appendChild(s);
  }

  /* ───────── 모달 HTML ───────── */
  function injectModal() {
    if (document.getElementById('apmBackdrop')) return;
    var wrap = document.createElement('div');
    wrap.id = 'apmBackdrop';
    wrap.className = 'apm-backdrop';
    wrap.innerHTML = '\
      <div class="apm-modal" role="dialog" aria-modal="true">\
        <div class="apm-title">내 정보 수정</div>\
        <div class="apm-desc">이름·이메일·연락처를 변경할 수 있어요. 비밀번호 칸은 비워두면 변경 없이 저장됩니다.</div>\
\
        <div class="apm-section">기본 정보</div>\
        <div class="apm-row">\
          <label for="apmName">이름</label>\
          <input type="text" id="apmName" maxlength="50" autocomplete="name">\
        </div>\
        <div class="apm-row">\
          <label for="apmEmail">이메일</label>\
          <input type="email" id="apmEmail" maxlength="100" autocomplete="email">\
          <div class="apm-hint">테스트 발송 수신용으로도 사용됩니다.</div>\
        </div>\
        <div class="apm-row">\
          <label for="apmPhone">연락처</label>\
          <input type="tel" id="apmPhone" maxlength="20" placeholder="010-1234-5678" autocomplete="tel">\
        </div>\
\
        <div class="apm-section">비밀번호 변경 (선택)</div>\
        <div class="apm-row">\
          <label for="apmCurPw">현재 비밀번호</label>\
          <input type="password" id="apmCurPw" autocomplete="current-password">\
        </div>\
        <div class="apm-row">\
          <label for="apmNewPw">새 비밀번호 (8자 이상)</label>\
          <input type="password" id="apmNewPw" autocomplete="new-password">\
        </div>\
        <div class="apm-row">\
          <label for="apmNewPw2">새 비밀번호 확인</label>\
          <input type="password" id="apmNewPw2" autocomplete="new-password">\
        </div>\
\
        <div class="apm-actions">\
          <button type="button" class="apm-btn apm-btn-cancel" id="apmCancel">취소</button>\
          <button type="button" class="apm-btn apm-btn-save"   id="apmSave">저장</button>\
        </div>\
      </div>\
    ';
    document.body.appendChild(wrap);

    var toast = document.createElement('div');
    toast.id = 'apmToast';
    toast.className = 'apm-toast';
    document.body.appendChild(toast);
  }

  /* ───────── 토스트 ───────── */
  function showToast(msg, isErr) {
    var t = document.getElementById('apmToast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'apm-toast show' + (isErr ? ' err' : '');
    setTimeout(function () { t.className = 'apm-toast'; }, 3000);
  }

  /* ───────── 현재 정보 로드 ───────── */
  async function loadMe() {
    try {
      var r = await fetch('/api/admin/me', { credentials: 'include' });
      if (!r.ok) return null;
      var j = await r.json();
      /* 응답 구조: { ok, data: { ... } } 또는 { user: {...} } 등 — 다중 fallback */
      return (j && j.data) || (j && j.user) || j || null;
    } catch (e) { return null; }
  }

  function fillForm(me) {
    if (!me) return;
    document.getElementById('apmName').value  = me.name  || '';
    document.getElementById('apmEmail').value = me.email || '';
    document.getElementById('apmPhone').value = me.phone || '';
    document.getElementById('apmCurPw').value = '';
    document.getElementById('apmNewPw').value = '';
    document.getElementById('apmNewPw2').value= '';
  }

  /* ───────── 열기/닫기 ───────── */
  async function openModal() {
    injectStyle(); injectModal();
    var me = await loadMe();
    fillForm(me || {});
    document.getElementById('apmBackdrop').classList.add('show');
    setTimeout(function () { document.getElementById('apmName').focus(); }, 50);
  }
  function closeModal() {
    var b = document.getElementById('apmBackdrop');
    if (b) b.classList.remove('show');
  }

  /* ───────── 저장 ───────── */
  async function save() {
    var name  = document.getElementById('apmName').value.trim();
    var email = document.getElementById('apmEmail').value.trim();
    var phone = document.getElementById('apmPhone').value.trim();
    var curPw = document.getElementById('apmCurPw').value;
    var newPw = document.getElementById('apmNewPw').value;
    var newPw2= document.getElementById('apmNewPw2').value;

    /* 클라이언트 1차 검증 */
    if (name.length < 2 || name.length > 50) return showToast('이름은 2~50자 사이여야 합니다', true);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showToast('이메일 형식이 올바르지 않습니다', true);
    if (newPw || newPw2) {
      if (newPw !== newPw2)    return showToast('새 비밀번호 확인이 일치하지 않습니다', true);
      if (newPw.length < 8)    return showToast('새 비밀번호는 8자 이상이어야 합니다', true);
      if (!curPw)              return showToast('현재 비밀번호를 입력해 주세요', true);
    }

    var body = { name: name, email: email, phone: phone || null };
    if (newPw) { body.currentPassword = curPw; body.newPassword = newPw; }

    var btn = document.getElementById('apmSave');
    btn.disabled = true; btn.textContent = '저장 중…';
    try {
      var r = await fetch('/api/admin-me-update', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      var j = await r.json().catch(function () { return {}; });
      if (!r.ok || j.ok === false) {
        showToast(j.error || ('HTTP ' + r.status), true);
        return;
      }
      showToast(j.message || '저장되었습니다');
      closeModal();
      /* 헤더에 표시된 이름·이메일도 즉시 갱신되도록 페이지 새로고침 — 단순한 방법 */
      setTimeout(function () { location.reload(); }, 800);
    } catch (e) {
      showToast('네트워크 오류', true);
    } finally {
      btn.disabled = false; btn.textContent = '저장';
    }
  }

  /* ───────── 우상단 사용자 영역 클릭 핸들러 바인딩 ───────── */
  function bindTriggers() {
    /* cms-tbfa.html: #cmsAvatar / #cmsUserName */
    var cmsAvatar = document.getElementById('cmsAvatar');
    var cmsName   = document.getElementById('cmsUserName');
    if (cmsAvatar && !cmsAvatar.dataset.apmBound) {
      cmsAvatar.dataset.apmBound = '1';
      cmsAvatar.style.cursor = 'pointer';
      cmsAvatar.addEventListener('click', openModal);
    }
    if (cmsName && !cmsName.dataset.apmBound) {
      cmsName.dataset.apmBound = '1';
      cmsName.style.cursor = 'pointer';
      cmsName.addEventListener('click', openModal);
    }
    /* admin.html: .adm-avatar (사용자 박스의 아바타) — 단순 텍스트 span도 클릭 대상으로 */
    document.querySelectorAll('.adm-user .adm-avatar, .adm-user > span').forEach(function (el) {
      if (el.dataset.apmBound) return;
      el.dataset.apmBound = '1';
      el.style.cursor = 'pointer';
      el.addEventListener('click', openModal);
    });
  }

  /* 클릭 위임 — DOM 동적 변경에도 작동.
     단, 같은 영역에 있는 로그아웃 버튼 등 인터랙티브 요소 클릭은 모달 열지 않음. */
  document.addEventListener('click', function (ev) {
    var t = ev.target;
    if (!t || !t.closest) return;
    /* 모달 안쪽 클릭(저장/취소 등)은 무시 — 별도 핸들러가 처리 */
    if (t.closest('.apm-modal') || t.closest('.apm-backdrop')) return;
    /* 우상단 사용자 영역 안의 버튼·링크·input·[data-action]은 자체 동작 우선 */
    if (t.closest('button') || t.closest('a') || t.closest('input') || t.closest('[data-action]')) return;
    /* 트리거 조건: cmsAvatar/cmsUserName/.adm-user 안 */
    if (t.closest('#cmsAvatar') || t.closest('#cmsUserName') || t.closest('.adm-user')) {
      openModal();
    }
  });

  /* 백드롭/취소/저장 이벤트 위임 */
  document.addEventListener('click', function (ev) {
    var t = ev.target;
    if (!t) return;
    if (t.id === 'apmBackdrop')   closeModal();
    if (t.id === 'apmCancel')     closeModal();
    if (t.id === 'apmSave')       save();
  });

  /* DOM 준비 후 초기 바인딩 */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { injectStyle(); injectModal(); bindTriggers(); });
  } else {
    injectStyle(); injectModal(); bindTriggers();
  }
})();
