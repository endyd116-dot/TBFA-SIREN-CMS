/* =========================================================
   SIREN — admin-home-sections.js (★ Phase B Step 6-F)
   메인 화면 편집 → 섹션 제목 (캠페인/공지/FAQ) 편집 모듈
   ========================================================= */
(function () {
  'use strict';

  const FIELDS = [
    {
      title: '진행 중인 캠페인 영역',
      keys: [
        { key: 'home.campaign.sectionVisible', label: '영역 표시', type: 'bool', hint: '꺼두면 캠페인 영역이 메인에서 사라집니다' },
        { key: 'home.campaign.title',          label: '제목',     type: 'text', hint: '예: 진행 중인 캠페인' },
        { key: 'home.campaign.subtitle',       label: '부제',     type: 'textarea', hint: '제목 아래 작은 설명문 (줄바꿈 가능)' },
        { key: 'home.campaign.maxItems',       label: '노출 개수', type: 'number', hint: '메인에 표시할 캠페인 카드 수 (기본 3)' },
      ],
    },
    {
      title: '공지사항 영역',
      keys: [
        { key: 'home.notice.sectionVisible', label: '영역 표시', type: 'bool' },
        { key: 'home.notice.title',          label: '제목',     type: 'text', hint: '예: 통합 공지사항' },
        { key: 'home.notice.maxItems',       label: '노출 개수', type: 'number', hint: '메인에 표시할 공지 수 (기본 5)' },
      ],
    },
    {
      title: 'FAQ 영역',
      keys: [
        { key: 'home.faq.sectionVisible', label: '영역 표시', type: 'bool' },
        { key: 'home.faq.title',          label: '제목',     type: 'text', hint: '예: 자주 묻는 질문' },
        { key: 'home.faq.maxItems',       label: '노출 개수', type: 'number', hint: '메인에 표시할 FAQ 수 (기본 4)' },
      ],
    },
  ];

  let _settingsMap = {};

  /* ============ 헬퍼 ============ */
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

  /* ============ 데이터 로드 ============ */
  async function load() {
    const res = await api('/api/admin/site-settings?scope=home');
    if (!res.ok) return false;
    _settingsMap = {};
    (res.data?.data?.list || []).forEach((s) => { _settingsMap[s.key] = s; });
    return true;
  }

  /* ============ 렌더 ============ */
  async function render() {
    const inner = document.getElementById('sbContentInner');
    if (!inner) return;
    inner.innerHTML = '<div style="text-align:center;padding:60px;color:#86868b">섹션 제목 편집 폼 로딩 중...</div>';

    const ok = await load();
    if (!ok) {
      inner.innerHTML = '<div style="text-align:center;padding:60px;color:#c5293a">로드 실패</div>';
      return;
    }

    inner.innerHTML = renderForm();
    attachEvents();
  }

  function renderForm() {
    const groupsHtml = FIELDS.map(renderGroup).join('');

    return `
      <style>
        .hs-wrap { padding:4px 4px 32px; }
        .hs-section-title { font-family:'Noto Serif KR',serif; font-size:18px; font-weight:600; margin:0 0 6px; }
        .hs-section-desc { font-size:12.5px; color:#86868b; margin:0 0 18px; }
        .hs-card {
          background:#fff; border:1px solid #e8e6e3; border-radius:10px;
          padding:18px 22px; margin-bottom:14px;
          box-shadow:0 1px 2px rgba(0,0,0,0.03);
        }
        .hs-card-title {
          font-weight:700; font-size:14px; color:#7a1f2b;
          margin:0 0 14px; padding-bottom:10px;
          border-bottom:1px solid #f0eeec;
        }
        .hs-field { margin-bottom:14px; }
        .hs-field:last-child { margin-bottom:0; }
        .hs-field-label {
          display:block; font-size:12px; font-weight:600;
          color:#1d1d1f; margin-bottom:5px;
        }
        .hs-input, .hs-textarea {
          width:100%; padding:8px 10px; font-size:13px;
          border:1px solid #d2d2d7; border-radius:6px;
          font-family:inherit; box-sizing:border-box;
        }
        .hs-textarea { resize:vertical; min-height:60px; }
        .hs-input:focus, .hs-textarea:focus { outline:none; border-color:#7a1f2b; }
        .hs-hint { font-size:11px; color:#86868b; margin-top:4px; }
        .hs-badge {
          display:inline-block; font-size:10px; padding:2px 7px;
          background:#fef5d8; color:#7a5e00; border-radius:10px;
          font-weight:600; vertical-align:middle; margin-left:6px;
        }
        .hs-checkbox-row {
          display:flex; align-items:center; gap:8px;
          padding:10px 12px; background:#f9f9f9; border-radius:6px;
        }
        .hs-save-bar {
          position:sticky; bottom:0; margin-top:24px;
          padding:14px 16px; background:#fff;
          border-top:1px solid #e8e6e3;
          display:flex; gap:10px; justify-content:flex-end;
          z-index:10;
        }
        .hs-btn-mini {
          padding:8px 14px; font-size:12px; border:1px solid #d2d2d7;
          background:#fff; border-radius:6px; cursor:pointer; color:#1d1d1f;
          font-family:inherit;
        }
        .hs-btn-save {
          padding:10px 20px; font-size:13px; font-weight:700;
          background:linear-gradient(135deg,#7a1f2b,#a3303f);
          color:#fff; border:none; border-radius:7px;
          cursor:pointer; font-family:inherit;
        }
        .hs-btn-save:disabled { opacity:0.5; cursor:not-allowed; }
      </style>

      <div class="hs-wrap">
        <h2 class="hs-section-title">섹션 제목 편집</h2>
        <p class="hs-section-desc">
          캠페인·공지·FAQ 영역의 제목·부제·표시여부·노출 개수를 편집합니다.<br />
          공지와 FAQ의 실제 내용은 다른 어드민 메뉴(공지/FAQ 관리)에서 작성합니다.
        </p>

        ${groupsHtml}

        <div class="hs-save-bar">
          <button type="button" class="hs-btn-mini" id="hsReloadBtn">처음부터 다시 불러오기</button>
          <button type="button" class="hs-btn-save" id="hsSaveBtn">변경사항 모두 임시저장</button>
        </div>
      </div>
    `;
  }

  function renderGroup(group) {
    const fieldsHtml = group.keys.map(renderField).join('');
    return `
      <div class="hs-card">
        <h3 class="hs-card-title">${escapeHtml(group.title)}</h3>
        ${fieldsHtml}
      </div>
    `;
  }

  function renderField(fld) {
    const setting = _settingsMap[fld.key];
    const value = getCurrentText(setting);
    const draftBadge = setting?.hasDraft ? '<span class="hs-badge">Draft</span>' : '';
    const hintHtml = fld.hint ? `<div class="hs-hint">${escapeHtml(fld.hint)}</div>` : '';

    let inputHtml;
    if (fld.type === 'bool') {
      const checked = value === 'true' ? 'checked' : '';
      inputHtml = `
        <div class="hs-checkbox-row">
          <input type="checkbox" data-hs-key="${escapeHtml(fld.key)}" data-hs-type="bool" ${checked} style="width:18px;height:18px">
          <span style="font-size:13px">활성화</span>
        </div>
      `;
    } else if (fld.type === 'textarea') {
      inputHtml = `<textarea class="hs-textarea" data-hs-key="${escapeHtml(fld.key)}" data-hs-type="text" rows="2">${escapeHtml(value)}</textarea>`;
    } else {
      const inputType = fld.type === 'number' ? 'number' : 'text';
      inputHtml = `<input type="${inputType}" class="hs-input" data-hs-key="${escapeHtml(fld.key)}" data-hs-type="${fld.type}" value="${escapeHtml(value)}">`;
    }

    return `
      <div class="hs-field">
        <label class="hs-field-label">${escapeHtml(fld.label)} ${draftBadge}</label>
        ${inputHtml}
        ${hintHtml}
      </div>
    `;
  }

  /* ============ 이벤트 ============ */
  function attachEvents() {
    const saveBtn = document.getElementById('hsSaveBtn');
    if (saveBtn) saveBtn.addEventListener('click', saveAll);
    const reloadBtn = document.getElementById('hsReloadBtn');
    if (reloadBtn) reloadBtn.addEventListener('click', () => render());
  }

  /* ============ 임시저장 ============ */
  async function saveAll() {
    const btn = document.getElementById('hsSaveBtn');
    if (btn) { btn.disabled = true; btn.textContent = '저장 중...'; }

    const updates = [];
    document.querySelectorAll('[data-hs-key]').forEach((el) => {
      const key = el.dataset.hsKey;
      const type = el.dataset.hsType;
      const setting = _settingsMap[key];
      if (!setting) return;

      let newValue;
      if (type === 'bool') {
        newValue = el.checked ? 'true' : 'false';
      } else {
        newValue = el.value;
      }

      const originalValue = getCurrentText(setting);
      if (newValue === originalValue) return;

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
      if (res.ok) okCount++;
      else { failCount++; console.warn('[home-sections]', u.key, res.data?.error); }
    }

    if (btn) { btn.disabled = false; btn.textContent = '변경사항 모두 임시저장'; }

    if (failCount === 0) toast(`${okCount}건 임시저장 완료`);
    else toast(`${okCount}건 성공 / ${failCount}건 실패`);

    if (window.SIREN_SITE_BUILDER?.reloadPreview) window.SIREN_SITE_BUILDER.reloadPreview();
    if (window.SIREN_SITE_BUILDER?.refreshDraftCount) window.SIREN_SITE_BUILDER.refreshDraftCount();

    await render();
  }

  window.SIREN_HOME_SECTIONS = { render };
})();