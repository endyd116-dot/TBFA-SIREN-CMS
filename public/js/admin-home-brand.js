/**
 * admin-home-brand.js — 사이트빌더 "브랜드" 패널
 * 2026-06-03: 로고 심볼·파비콘 업로드 + 사이트 이름·홈 타이틀.
 * 저장 시 즉시 운영 적용(Netlify Blobs 영구 저장 → /api/public/brand 서빙 → common.js가 전 페이지 적용).
 *
 * API:
 *   GET  /api/admin/brand-settings  → { siteName, homeTitle, logoUrl, faviconUrl, version }
 *   POST /api/admin/brand-settings  (multipart) → 저장
 */
(function () {
  'use strict';

  let _state = { siteName: '', homeTitle: '', logoUrl: null, faviconUrl: null, version: 0 };
  let _logoFile = null, _faviconFile = null;

  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]); }); }

  function toast(msg) {
    if (window.SIREN_SITE_BUILDER && window.SIREN_SITE_BUILDER.toast) return window.SIREN_SITE_BUILDER.toast(msg);
    const t = $('#toast'); if (t) { t.textContent = msg; t.classList.add('show'); setTimeout(function () { t.classList.remove('show'); }, 2400); }
    else alert(msg);
  }

  async function load() {
    try {
      const res = await fetch('/api/admin/brand-settings', { credentials: 'include' });
      if (res.status === 401) { location.href = '/admin.html'; return; }
      const j = await res.json().catch(function () { return null; });
      if (j && j.ok) _state = Object.assign(_state, j.data || {});
    } catch (e) { console.warn('[brand] load 실패', e); }
  }

  function previewBox(label, hint, curUrl, inputId, fileId, shape) {
    const round = shape === 'favicon' ? 'border-radius:8px' : 'border-radius:10px';
    const cur = curUrl
      ? '<img src="' + esc(curUrl) + '" alt="" style="max-width:96px;max-height:96px;object-fit:contain;background:#f1f5f9;padding:6px;' + round + '">'
      : '<div style="width:96px;height:96px;display:flex;align-items:center;justify-content:center;background:#f1f5f9;color:#94a3b8;font-size:12px;' + round + '">없음</div>';
    return '' +
      '<div style="margin-bottom:22px">' +
        '<div style="font-weight:700;font-size:14px;margin-bottom:4px">' + esc(label) + '</div>' +
        '<div style="font-size:12px;color:#64748b;margin-bottom:10px">' + esc(hint) + '</div>' +
        '<div style="display:flex;align-items:center;gap:16px">' +
          '<div id="' + inputId + 'Cur">' + cur + '</div>' +
          '<div>' +
            '<input type="file" id="' + fileId + '" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/x-icon" style="font-size:13px">' +
            '<div id="' + inputId + 'New" style="margin-top:8px;font-size:12px;color:#16a34a"></div>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function render() {
    const inner = $('#sbContentInner');
    if (!inner) return;
    inner.innerHTML = '<div class="sb-loading" style="padding:30px;color:#94a3b8">불러오는 중…</div>';
    _logoFile = null; _faviconFile = null;

    load().then(function () {
      inner.innerHTML =
        '<div style="max-width:680px">' +
          '<h2 style="font-size:20px;font-weight:800;margin-bottom:6px">🎴 로고 · 파비콘 · 타이틀</h2>' +
          '<p style="font-size:13px;color:#64748b;margin-bottom:8px">협의회 로고, 브라우저 탭 아이콘(파비콘), 사이트 이름, 홈 화면 탭 제목을 코드 없이 바꿉니다.</p>' +
          '<p style="font-size:12px;color:#b45309;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px 12px;margin-bottom:22px">💡 <b>저장하면 즉시 전체 사이트에 적용</b>됩니다(다른 편집처럼 별도 배포 불필요). 파비콘은 방문자 브라우저 캐시 때문에 탭을 새로 열거나 강력 새로고침해야 보일 수 있어요.</p>' +

          previewBox('로고 심볼', '헤더·푸터에 표시되는 심볼. 정사각형 PNG(투명 배경) 권장 · 3MB 이하.', _state.logoUrl, 'logo', 'brandLogoFile') +
          previewBox('파비콘', '브라우저 탭 아이콘. 정사각형 PNG/ICO 권장(작게 보이니 단순한 심볼).', _state.faviconUrl, 'favicon', 'brandFaviconFile') +

          '<div style="margin-bottom:18px">' +
            '<label style="display:block;font-weight:700;font-size:14px;margin-bottom:6px">사이트 이름</label>' +
            '<div style="font-size:12px;color:#64748b;margin-bottom:8px">헤더·푸터에 로고 옆 표시되는 단체명. (비워두면 기존 "교사유가족협의회" 유지)</div>' +
            '<input type="text" id="brandSiteName" value="' + esc(_state.siteName || '') + '" placeholder="교사유가족협의회" maxlength="100" style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px">' +
          '</div>' +

          '<div style="margin-bottom:24px">' +
            '<label style="display:block;font-weight:700;font-size:14px;margin-bottom:6px">홈 페이지 탭 제목</label>' +
            '<div style="font-size:12px;color:#64748b;margin-bottom:8px">홈(메인) 화면의 브라우저 탭 제목. 예: "교사유가족협의회 | 존엄한 기억, 투명한 동행" · (비워두면 기존 제목 유지 · 다른 페이지 제목은 영향 없음)</div>' +
            '<input type="text" id="brandHomeTitle" value="' + esc(_state.homeTitle || '') + '" placeholder="교사유가족협의회 | 존엄한 기억, 투명한 동행" maxlength="200" style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px">' +
          '</div>' +

          '<div style="display:flex;gap:10px;align-items:center">' +
            '<button type="button" id="brandSaveBtn" style="background:#2563eb;color:#fff;border:none;border-radius:8px;padding:12px 24px;font-size:14px;font-weight:700;cursor:pointer">💾 저장하고 바로 적용</button>' +
            '<span id="brandSaveMsg" style="font-size:13px;color:#16a34a"></span>' +
          '</div>' +
        '</div>';

      bind();
    });
  }

  function bind() {
    const logoInput = $('#brandLogoFile'), favInput = $('#brandFaviconFile');
    if (logoInput) logoInput.addEventListener('change', function () {
      _logoFile = logoInput.files[0] || null;
      $('#logoNew').textContent = _logoFile ? '새 파일 선택됨: ' + _logoFile.name : '';
    });
    if (favInput) favInput.addEventListener('change', function () {
      _faviconFile = favInput.files[0] || null;
      $('#faviconNew').textContent = _faviconFile ? '새 파일 선택됨: ' + _faviconFile.name : '';
    });

    const btn = $('#brandSaveBtn');
    if (btn) btn.addEventListener('click', save);
  }

  async function save() {
    const btn = $('#brandSaveBtn'), msg = $('#brandSaveMsg');
    btn.disabled = true; btn.textContent = '저장 중…'; if (msg) msg.textContent = '';

    const fd = new FormData();
    fd.append('siteName', $('#brandSiteName') ? $('#brandSiteName').value : '');
    fd.append('homeTitle', $('#brandHomeTitle') ? $('#brandHomeTitle').value : '');
    if (_logoFile) fd.append('logo', _logoFile);
    if (_faviconFile) fd.append('favicon', _faviconFile);

    try {
      const res = await fetch('/api/admin/brand-settings', { method: 'POST', credentials: 'include', body: fd });
      const j = await res.json().catch(function () { return null; });
      if (!res.ok || !j || !j.ok) throw new Error((j && j.error) || ('HTTP ' + res.status));
      _state = Object.assign(_state, j.data || {});
      _logoFile = null; _faviconFile = null;
      toast('브랜드 설정 저장 완료 — 즉시 적용됩니다');
      if (msg) msg.textContent = '✓ 저장됨 (전체 사이트 적용)';
      render();   // 미리보기 갱신
      if (window.SIREN_SITE_BUILDER && window.SIREN_SITE_BUILDER.reloadPreview) window.SIREN_SITE_BUILDER.reloadPreview();
    } catch (e) {
      toast('저장 실패: ' + e.message);
      if (msg) { msg.style.color = '#dc2626'; msg.textContent = '저장 실패: ' + e.message; }
    } finally {
      btn.disabled = false; btn.textContent = '💾 저장하고 바로 적용';
    }
  }

  window.SIREN_HOME_BRAND = { render: render };
})();
