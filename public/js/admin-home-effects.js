/* =========================================================
   SIREN — admin-home-effects.js (★ Phase B Step 6-H)
   메인 화면 편집 → 효과/애니메이션 편집 모듈
   ========================================================= */
(function () {
  'use strict';

  const FIELDS = [
    {
      key: 'home.effects.counterDuration',
      label: '통계 카운터 애니메이션 속도',
      type: 'number',
      unit: 'ms',
      hint: '메인의 통계 4개 숫자가 0부터 카운트업 되는 시간 (밀리초). 기본 1600. 작을수록 빠르게 카운트',
    },
    {
      key: 'home.effects.progressBarDuration',
      label: '진행률 게이지 애니메이션 속도',
      type: 'number',
      unit: 'ms',
      hint: '하단 특별 캠페인 배너의 진행률 바 채우는 시간 (밀리초). 기본 1200',
    },
    {
      key: 'home.effects.sirenPulseEnabled',
      label: '사이렌 메뉴 펄스 효과',
      type: 'bool',
      hint: '사이렌 메뉴 아이콘()과 SIREN 배지의 깜빡임 효과 켜기/끄기',
    },
  ];

  let _settingsMap = {};

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function toast(msg) {
    if (window.SIREN && window.SIREN.toast) return window.SIREN.toast(msg);
    alert(msg);
  }
  async function api(path, opts) {
    opts = opts || {};
    const init = {
      method: opts.method || 'GET',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    };
    if (opts.body) init.body = JSON.stringify(opts.body);
    try {
      const res = await fetch(path, init);
      const data = await res.json().catch(() => ({}));
      return { status: res.status, ok: res.ok && data.ok !== false, data };
    } catch (e) {
      return { status: 0, ok: false, data: { error: '네트워크 오류' } };
    }
  }

  function getCurrentText(setting) {
    if (!setting) return '';
    if (setting.hasDraft && setting.draftValueText !== null && setting.draftValueText !== undefined) {
      return setting.draftValueText;
    }
    return setting.valueText || '';
  }

  async function load() {
    const res = await api('/api/admin/site-settings?scope=home');
    if (!res.ok) return false;
    _settingsMap = {};
    (res.data?.data?.list || []).forEach((s) => { _settingsMap[s.key] = s; });
    return true;
  }

  async function render() {
    const inner = document.getElementById('sbContentInner');
    if (!inner) return;
    inner.innerHTML = '<div style="text-align:center;padding:60px;color:#86868b">효과 편집 폼 로딩 중...</div>';

    const ok = await load();
    if (!ok) {
      inner.innerHTML = '<div style="text-align:center;padding:60px;color:#c5293a">로드 실패</div>';
      return;
    }

    const fieldsHtml = FIELDS.map(renderField).join('');

    inner.innerHTML = `
      <style>
        .he-wrap { padding:4px 4px 32px; }
        .he-section-title { font-family:'Noto Serif KR',serif; font-size:18px; font-weight:600; margin:0 0 6px; }
        .he-section-desc { font-size:12.5px; color:#86868b; margin:0 0 18px; }
        .he-card { background:#fff; border:1px solid #e8e6e3; border-radius:10px; padding:18px 22px; margin-bottom:14px; }
        .he-field-label { display:block; font-size:13px; font-weight:600; color:#1d1d1f; margin-bottom:8px; }
        .he-input { width:140px; padding:8px 10px; font-size:13px; border:1px solid #d2d2d7; border-radius:6px; font-family:inherit; }
        .he-input:focus { outline:none; border-color:#7a1f2b; }
        .he-unit { display:inline-block; margin-left:8px; color:#86868b; font-size:12px; }
        .he-hint { font-size:11.5px; color:#86868b; margin-top:6px; line-height:1.6; }
        .he-badge { display:inline-block; font-size:10px; padding:2px 7px; background:#fef5d8; color:#7a5e00; border-radius:10px; font-weight:600; vertical-align:middle; margin-left:6px; }
        .he-checkbox-row { display:flex; align-items:center; gap:8px; padding:10px 12px; background:#f9f9f9; border-radius:6px; }
        .he-save-bar { position:sticky; bottom:0; margin-top:24px; padding:14px 16px; background:#fff; border-top:1px solid #e8e6e3; display:flex; gap:10px; justify-content:flex-end; z-index:10; }
        .he-btn-mini { padding:8px 14px; font-size:12px; border:1px solid #d2d2d7; background:#fff; border-radius:6px; cursor:pointer; font-family:inherit; }
        .he-btn-save { padding:10px 20px; font-size:13px; font-weight:700; background:linear-gradient(135deg,#7a1f2b,#a3303f); color:#fff; border:none; border-radius:7px; cursor:pointer; font-family:inherit; }
        .he-btn-save:disabled { opacity:0.5; cursor:not-allowed; }
      </style>

      <div class="he-wrap">
        <h2 class="he-section-title">효과 / 애니메이션 편집</h2>
        <p class="he-section-desc">
          메인 페이지의 애니메이션 속도와 효과를 조절합니다. 모바일 사용자나 시각 민감 사용자를 위해 효과를 끄거나 느리게 할 수 있습니다.
        </p>

        ${fieldsHtml}

        <div class="he-save-bar">
          <button type="button" class="he-btn-mini" id="heReloadBtn">처음부터 다시 불러오기</button>
          <button type="button" class="he-btn-save" id="heSaveBtn">변경사항 모두 임시저장</button>
        </div>
      </div>
    `;

    document.getElementById('heSaveBtn')?.addEventListener('click', saveAll);
    document.getElementById('heReloadBtn')?.addEventListener('click', () => render());
  }

  function renderField(fld) {
    const setting = _settingsMap[fld.key];
    const value = getCurrentText(setting);
    const draftBadge = setting?.hasDraft ? '<span class="he-badge">Draft</span>' : '';
    const hintHtml = fld.hint ? `<div class="he-hint">${escapeHtml(fld.hint)}</div>` : '';

    let inputHtml;
    if (fld.type === 'bool') {
      const checked = value === 'true' ? 'checked' : '';
      inputHtml = `
        <div class="he-checkbox-row" style="display:inline-flex">
          <input type="checkbox" data-he-key="${escapeHtml(fld.key)}" data-he-type="bool" ${checked} style="width:18px;height:18px">
          <span style="font-size:13px">활성화</span>
        </div>
      `;
    } else {
      inputHtml = `
        <input type="number" class="he-input" data-he-key="${escapeHtml(fld.key)}" data-he-type="number" value="${escapeHtml(value)}">
        ${fld.unit ? `<span class="he-unit">${escapeHtml(fld.unit)}</span>` : ''}
      `;
    }

    return `
      <div class="he-card">
        <label class="he-field-label">${escapeHtml(fld.label)} ${draftBadge}</label>
        ${inputHtml}
        ${hintHtml}
      </div>
    `;
  }

  async function saveAll() {
    const btn = document.getElementById('heSaveBtn');
    if (btn) { btn.disabled = true; btn.textContent = '저장 중...'; }

    const updates = [];
    document.querySelectorAll('[data-he-key]').forEach((el) => {
      const key = el.dataset.heKey;
      const type = el.dataset.heType;
      const setting = _settingsMap[key];
      if (!setting) return;

      const newValue = type === 'bool' ? (el.checked ? 'true' : 'false') : el.value;
      const original = getCurrentText(setting);
      if (newValue === original) return;

      updates.push({ id: setting.id, key, value: newValue });
    });

    if (updates.length === 0) {
      if (btn) { btn.disabled = false; btn.textContent = '변경사항 모두 임시저장'; }
      toast('변경된 항목이 없습니다');
      return;
    }

    let okCount = 0, failCount = 0;
    for (const u of updates) {
      const res = await api('/api/admin/site-settings', {
        method: 'PATCH',
        body: { id: u.id, valueText: u.value },
      });
      if (res.ok) okCount++; else { failCount++; console.warn('[home-effects]', u.key, res.data?.error); }
    }

    if (btn) { btn.disabled = false; btn.textContent = '변경사항 모두 임시저장'; }
    if (failCount === 0) toast(`${okCount}건 임시저장 완료`);
    else toast(`${okCount}건 성공 / ${failCount}건 실패`);

    if (window.SIREN_SITE_BUILDER?.reloadPreview) window.SIREN_SITE_BUILDER.reloadPreview();
    if (window.SIREN_SITE_BUILDER?.refreshDraftCount) window.SIREN_SITE_BUILDER.refreshDraftCount();

    await render();
  }

  window.SIREN_HOME_EFFECTS = { render };
})();