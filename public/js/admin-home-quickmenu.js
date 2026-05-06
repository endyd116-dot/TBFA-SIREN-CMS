/* =========================================================
   SIREN — admin-home-quickmenu.js (★ Phase B Step 6-E)
   메인 화면 편집 → 퀵메뉴 (6개 박스) 편집 모듈
   ========================================================= */
(function () {
  'use strict';

  const KEYS = {
    items: 'home.quickMenu.items',
    visible: 'home.quickMenu.sectionVisible',
  };

  let _settingsMap = {};
  let _itemsDraft = [];

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
  function getCurrentJson(setting) {
    if (!setting) return null;
    if (setting.hasDraft && setting.draftValueJson !== null && setting.draftValueJson !== undefined) {
      return setting.draftValueJson;
    }
    return setting.valueJson || null;
  }

  /* ============ 데이터 로드 ============ */
  async function load() {
    const res = await api('/api/admin/site-settings?scope=home');
    if (!res.ok) return null;
    _settingsMap = {};
    (res.data?.data?.list || []).forEach((s) => { _settingsMap[s.key] = s; });
    const items = getCurrentJson(_settingsMap[KEYS.items]);
    _itemsDraft = Array.isArray(items) ? JSON.parse(JSON.stringify(items)) : [];
    return res.data?.data;
  }

  /* ============ 렌더 ============ */
  async function render() {
    const inner = document.getElementById('sbContentInner');
    if (!inner) return;
    inner.innerHTML = '<div style="text-align:center;padding:60px;color:#86868b">퀵메뉴 편집 폼 로딩 중...</div>';

    const data = await load();
    if (!data) {
      inner.innerHTML = '<div style="text-align:center;padding:60px;color:#c5293a">로드 실패</div>';
      return;
    }

    const missing = Object.values(KEYS).filter((k) => !_settingsMap[k]);
    if (missing.length > 0) {
      inner.innerHTML = `<div style="padding:32px;background:#fff5f5;border:1px solid #f5b8b8;border-radius:8px;color:#7a1f2b"><strong>⚠️ 누락 시드:</strong> ${missing.join(', ')}</div>`;
      return;
    }

    inner.innerHTML = renderForm();
    attachEvents();
  }

  function renderForm() {
    const visible = getCurrentText(_settingsMap[KEYS.visible]) === 'true';
    const draftBadgeItems = _settingsMap[KEYS.items]?.hasDraft ? '<span class="qm-badge">📝 Draft</span>' : '';
    const draftBadgeVisible = _settingsMap[KEYS.visible]?.hasDraft ? '<span class="qm-badge">📝 Draft</span>' : '';

    const cardsHtml = _itemsDraft.map((it, idx) => renderItemCard(it, idx)).join('');

    return `
      <style>
        .qm-wrap { padding:4px 4px 32px; }
        .qm-section-title { font-family:'Noto Serif KR',serif; font-size:18px; font-weight:600; margin:0 0 6px; }
        .qm-section-desc { font-size:12.5px; color:#86868b; margin:0 0 18px; }
        .qm-card {
          background:#fff; border:1px solid #e8e6e3; border-radius:10px;
          padding:18px 20px; margin-bottom:14px;
          box-shadow:0 1px 2px rgba(0,0,0,0.03);
        }
        .qm-card.siren { border-left:3px solid #c5293a; background:linear-gradient(90deg,#fef9f5,#fff); }
        .qm-card-header {
          display:flex; align-items:center; justify-content:space-between;
          margin-bottom:14px; gap:10px;
        }
        .qm-card-title { font-weight:700; font-size:14px; color:#7a1f2b; }
        .qm-card-actions { display:flex; gap:6px; }
        .qm-btn-mini {
          padding:5px 10px; font-size:11.5px; border:1px solid #d2d2d7;
          background:#fff; border-radius:6px; cursor:pointer; color:#1d1d1f;
          font-family:inherit;
        }
        .qm-btn-mini:hover:not(:disabled) { background:#f5f5f7; border-color:#7a1f2b; color:#7a1f2b; }
        .qm-btn-mini:disabled { opacity:0.4; cursor:not-allowed; }
        .qm-btn-danger { color:#c5293a; border-color:#f5c6cc; }
        .qm-field { margin-bottom:12px; }
        .qm-field-label {
          display:block; font-size:12px; font-weight:600;
          color:#1d1d1f; margin-bottom:5px;
        }
        .qm-input {
          width:100%; padding:8px 10px; font-size:13px;
          border:1px solid #d2d2d7; border-radius:6px;
          font-family:inherit; box-sizing:border-box;
        }
        .qm-input:focus { outline:none; border-color:#7a1f2b; }
        .qm-grid-3 { display:grid; grid-template-columns:80px 1fr 1fr; gap:10px; align-items:end; }
        .qm-grid-2 { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
        .qm-hint { font-size:11px; color:#86868b; margin-top:4px; }
        .qm-badge {
          display:inline-block; font-size:10px; padding:2px 7px;
          background:#fef5d8; color:#7a5e00; border-radius:10px;
          font-weight:600; vertical-align:middle; margin-left:6px;
        }
        .qm-add-btn {
          width:100%; padding:14px; font-size:13px;
          border:2px dashed #d2d2d7; background:#f9f9f9;
          border-radius:10px; cursor:pointer; color:#7a1f2b;
          font-weight:600; font-family:inherit;
        }
        .qm-add-btn:hover { border-color:#7a1f2b; background:#fef9f5; }
        .qm-save-bar {
          position:sticky; bottom:0; margin-top:24px;
          padding:14px 16px; background:#fff;
          border-top:1px solid #e8e6e3;
          display:flex; gap:10px; justify-content:flex-end;
          z-index:10;
        }
        .qm-btn-save {
          padding:10px 20px; font-size:13px; font-weight:700;
          background:linear-gradient(135deg,#7a1f2b,#a3303f);
          color:#fff; border:none; border-radius:7px;
          cursor:pointer; font-family:inherit;
        }
        .qm-btn-save:disabled { opacity:0.5; cursor:not-allowed; }
        .qm-checkbox-row {
          display:flex; align-items:center; gap:8px;
          padding:10px 12px; background:#f9f9f9; border-radius:6px;
        }
        .qm-icon-preview {
          font-size:24px; width:50px; height:50px;
          display:inline-flex; align-items:center; justify-content:center;
          background:#f5f5f7; border-radius:50%;
        }
      </style>

      <div class="qm-wrap">
        <h2 class="qm-section-title">🟦 퀵메뉴 편집 (${_itemsDraft.length}개 박스)</h2>
        <p class="qm-section-desc">
          메인 페이지 상단의 6개 박스를 편집합니다. SIREN 그룹은 빨간 배지가 표시되며, 박스 추가/삭제/순서 변경이 가능합니다.
        </p>

        <!-- 영역 표시 토글 -->
        <div class="qm-card">
          <div class="qm-card-header">
            <span class="qm-card-title">👁 영역 전체 표시 ${draftBadgeVisible}</span>
          </div>
          <div class="qm-checkbox-row">
            <input type="checkbox" id="qmVisible" ${visible ? 'checked' : ''} style="width:18px;height:18px">
            <label for="qmVisible" style="font-size:13px;cursor:pointer">메인 페이지에 퀵메뉴 영역 표시</label>
          </div>
          <div class="qm-hint">끄면 6개 박스 영역 자체가 메인 페이지에서 사라집니다</div>
        </div>

        <!-- 박스 카드들 -->
        <div id="qmItemsContainer">
          ${cardsHtml}
        </div>
        <button type="button" class="qm-add-btn" id="qmAddBtn">➕ 박스 추가</button>

        <!-- 저장 바 -->
        <div class="qm-save-bar">
          <button type="button" class="qm-btn-mini" id="qmReloadBtn">🔄 처음부터 다시 불러오기</button>
          <button type="button" class="qm-btn-save" id="qmSaveBtn">💾 변경사항 모두 임시저장</button>
        </div>
      </div>
    `;
  }

  function renderItemCard(item, idx) {
    const total = _itemsDraft.length;
    const isSiren = !!item.isSirenGroup;
    const isActive = item.isActive !== false;
    const linkType = item.opensModal ? 'modal' : 'link';
    const linkValue = item.opensModal || item.href || '';

    return `
      <div class="qm-card ${isSiren ? 'siren' : ''}" data-item-idx="${idx}" style="${isActive ? '' : 'opacity:0.5'}">
        <div class="qm-card-header">
          <span class="qm-card-title">
            박스 #${idx + 1} ${isSiren ? '<span style="color:#c5293a">🚨 SIREN</span>' : ''}
            ${isActive ? '' : '<span style="color:#86868b;font-weight:400">(비활성)</span>'}
          </span>
          <div class="qm-card-actions">
            <button type="button" class="qm-btn-mini" data-item-up="${idx}" ${idx === 0 ? 'disabled' : ''}>▲</button>
            <button type="button" class="qm-btn-mini" data-item-down="${idx}" ${idx === total - 1 ? 'disabled' : ''}>▼</button>
            <button type="button" class="qm-btn-mini" data-item-toggle="${idx}">${isActive ? '👁' : '🚫'}</button>
            <button type="button" class="qm-btn-mini qm-btn-danger" data-item-delete="${idx}">🗑</button>
          </div>
        </div>

        <div class="qm-grid-3">
          <div class="qm-field" style="margin:0">
            <label class="qm-field-label">아이콘 (이모지)</label>
            <input type="text" class="qm-input" data-item-field="icon" data-idx="${idx}" value="${escapeHtml(item.icon || '')}" maxlength="4" style="text-align:center;font-size:20px">
          </div>
          <div class="qm-field" style="margin:0">
            <label class="qm-field-label">라벨</label>
            <input type="text" class="qm-input" data-item-field="label" data-idx="${idx}" value="${escapeHtml(item.label || '')}">
          </div>
          <div class="qm-field" style="margin:0">
            <label class="qm-field-label">SIREN 그룹</label>
            <div class="qm-checkbox-row" style="padding:8px 10px">
              <input type="checkbox" data-item-field="isSirenGroup" data-idx="${idx}" ${isSiren ? 'checked' : ''} style="width:16px;height:16px">
              <span style="font-size:12px">빨간 배지 표시</span>
            </div>
          </div>
        </div>

        <div class="qm-grid-2" style="margin-top:12px">
          <div class="qm-field" style="margin:0">
            <label class="qm-field-label">동작 방식</label>
            <select class="qm-input" data-item-field="linkType" data-idx="${idx}">
              <option value="link" ${linkType === 'link' ? 'selected' : ''}>링크 이동</option>
              <option value="modal" ${linkType === 'modal' ? 'selected' : ''}>모달 열기</option>
            </select>
          </div>
          <div class="qm-field" style="margin:0">
            <label class="qm-field-label">${linkType === 'modal' ? '모달 ID' : 'URL 경로'}</label>
            <input type="text" class="qm-input" data-item-field="linkValue" data-idx="${idx}" value="${escapeHtml(linkValue)}" placeholder="${linkType === 'modal' ? '예: donateModal' : '예: /incidents.html'}">
          </div>
        </div>
      </div>
    `;
  }

  /* ============ 이벤트 ============ */
  function attachEvents() {
    bindItemEvents();
    const addBtn = document.getElementById('qmAddBtn');
    if (addBtn) addBtn.addEventListener('click', addItem);
    const saveBtn = document.getElementById('qmSaveBtn');
    if (saveBtn) saveBtn.addEventListener('click', saveAll);
    const reloadBtn = document.getElementById('qmReloadBtn');
    if (reloadBtn) reloadBtn.addEventListener('click', () => render());
    const visibleEl = document.getElementById('qmVisible');
    if (visibleEl) {
      /* 변경은 저장 시에만 반영 — 별도 이벤트 불필요 */
    }
  }

  function bindItemEvents() {
    document.querySelectorAll('[data-item-field]').forEach((el) => {
      el.addEventListener('input', onItemFieldChange);
      el.addEventListener('change', onItemFieldChange);
    });
    document.querySelectorAll('[data-item-up]').forEach((btn) => {
      btn.addEventListener('click', () => moveItem(Number(btn.dataset.itemUp), -1));
    });
    document.querySelectorAll('[data-item-down]').forEach((btn) => {
      btn.addEventListener('click', () => moveItem(Number(btn.dataset.itemDown), +1));
    });
    document.querySelectorAll('[data-item-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => toggleItem(Number(btn.dataset.itemToggle)));
    });
    document.querySelectorAll('[data-item-delete]').forEach((btn) => {
      btn.addEventListener('click', () => deleteItem(Number(btn.dataset.itemDelete)));
    });
  }

  function onItemFieldChange(e) {
    const el = e.target;
    const idx = Number(el.dataset.idx);
    const field = el.dataset.itemField;
    if (Number.isNaN(idx) || !_itemsDraft[idx]) return;

    if (field === 'isSirenGroup') {
      _itemsDraft[idx].isSirenGroup = el.checked;
      renderItemsContainer();
      return;
    }

    if (field === 'linkType') {
      const newType = el.value;
      const currentValue = _itemsDraft[idx].opensModal || _itemsDraft[idx].href || '';
      if (newType === 'modal') {
        _itemsDraft[idx].opensModal = currentValue;
        _itemsDraft[idx].href = null;
      } else {
        _itemsDraft[idx].href = currentValue || '#';
        _itemsDraft[idx].opensModal = null;
      }
      renderItemsContainer();
      return;
    }

    if (field === 'linkValue') {
      const linkType = _itemsDraft[idx].opensModal !== null && _itemsDraft[idx].opensModal !== undefined ? 'modal' : 'link';
      if (linkType === 'modal') _itemsDraft[idx].opensModal = el.value;
      else _itemsDraft[idx].href = el.value;
      return;
    }

    /* 일반 필드 */
    _itemsDraft[idx][field] = el.value;
  }

  function moveItem(idx, delta) {
    const newIdx = idx + delta;
    if (newIdx < 0 || newIdx >= _itemsDraft.length) return;
    const tmp = _itemsDraft[idx];
    _itemsDraft[idx] = _itemsDraft[newIdx];
    _itemsDraft[newIdx] = tmp;
    _itemsDraft.forEach((it, i) => { it.sortOrder = i + 1; });
    renderItemsContainer();
  }

  function toggleItem(idx) {
    if (!_itemsDraft[idx]) return;
    _itemsDraft[idx].isActive = _itemsDraft[idx].isActive === false;
    renderItemsContainer();
  }

  function deleteItem(idx) {
    if (!_itemsDraft[idx]) return;
    if (_itemsDraft.length <= 1) { toast('최소 1개 박스는 필요합니다'); return; }
    if (!confirm(`박스 #${idx + 1}을 삭제하시겠습니까?`)) return;
    _itemsDraft.splice(idx, 1);
    _itemsDraft.forEach((it, i) => { it.sortOrder = i + 1; });
    renderItemsContainer();
  }

  function addItem() {
    _itemsDraft.push({
      label: '새 메뉴',
      icon: '✨',
      isSirenGroup: false,
      href: '#',
      opensModal: null,
      sortOrder: _itemsDraft.length + 1,
      isActive: true,
    });
    renderItemsContainer();
  }

  function renderItemsContainer() {
    const container = document.getElementById('qmItemsContainer');
    if (!container) return;
    container.innerHTML = _itemsDraft.map((it, i) => renderItemCard(it, i)).join('');

    const allTitles = document.querySelectorAll('.qm-section-title');
    allTitles.forEach((t) => {
      if (t.textContent.indexOf('🟦') >= 0) {
        t.innerHTML = `🟦 퀵메뉴 편집 (${_itemsDraft.length}개 박스)`;
      }
    });

    bindItemEvents();
  }

  /* ============ 임시저장 ============ */
  async function saveAll() {
    const btn = document.getElementById('qmSaveBtn');
    if (btn) { btn.disabled = true; btn.textContent = '저장 중...'; }

    const updates = [];

    /* 1. items JSON */
    const itemsOriginal = JSON.stringify(getCurrentJson(_settingsMap[KEYS.items]) || []);
    const itemsNow = JSON.stringify(_itemsDraft);
    if (itemsOriginal !== itemsNow) {
      updates.push({ id: _settingsMap[KEYS.items].id, key: KEYS.items, type: 'json', value: _itemsDraft });
    }

    /* 2. sectionVisible */
    const visibleEl = document.getElementById('qmVisible');
    const visibleNew = visibleEl && visibleEl.checked ? 'true' : 'false';
    const visibleOriginal = getCurrentText(_settingsMap[KEYS.visible]);
    if (visibleNew !== visibleOriginal) {
      updates.push({ id: _settingsMap[KEYS.visible].id, key: KEYS.visible, type: 'text', value: visibleNew });
    }

    if (updates.length === 0) {
      if (btn) { btn.disabled = false; btn.textContent = '💾 변경사항 모두 임시저장'; }
      toast('변경된 항목이 없습니다');
      return;
    }

    let okCount = 0, failCount = 0;
    for (const u of updates) {
      const body = { id: u.id };
      if (u.type === 'json') body.valueJson = u.value;
      else body.valueText = u.value;
      const res = await api('/api/admin/site-settings', { method: 'PATCH', body });
      if (res.ok) okCount++;
      else { failCount++; console.warn('[home-quickmenu]', u.key, res.data?.error); }
    }

    if (btn) { btn.disabled = false; btn.textContent = '💾 변경사항 모두 임시저장'; }

    if (failCount === 0) toast(`${okCount}건 임시저장 완료`);
    else toast(`${okCount}건 성공 / ${failCount}건 실패`);

    if (window.SIREN_SITE_BUILDER?.reloadPreview) window.SIREN_SITE_BUILDER.reloadPreview();
    if (window.SIREN_SITE_BUILDER?.refreshDraftCount) window.SIREN_SITE_BUILDER.refreshDraftCount();

    await render();
  }

  window.SIREN_HOME_QUICKMENU = { render };
})();