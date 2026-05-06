/* =========================================================
   SIREN — admin-home-hero.js (★ Phase B Step 6-D)
   메인 화면 편집 → 히어로 배너 편집 모듈
   - site_settings의 home.hero.* 키들을 CRUD
   - admin-stats-edit.js와 동일 패턴 (Draft → Publish)
   ========================================================= */
(function () {
  'use strict';

  /* ============ 상수 ============ */
  const KEYS = {
    slides: 'home.hero.slides',
    eyebrow: 'home.hero.eyebrow',
    lead: 'home.hero.lead',
    autoplaySpeed: 'home.hero.autoplaySpeed',
    autoplayEnabled: 'home.hero.autoplayEnabled',
  };

  /* ============ 상태 ============ */
  let _settingsMap = {};       /* key → setting row 전체 */
  let _slidesDraft = [];       /* 화면에서 작업 중인 슬라이드 배열 (Draft 우선) */

  /* ============ 헬퍼 ============ */
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function toast(msg) {
    if (window.SIREN && window.SIREN.toast) return window.SIREN.toast(msg);
    const t = document.getElementById('toast');
    if (!t) return alert(msg);
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(window._tt);
    window._tt = setTimeout(() => t.classList.remove('show'), 2400);
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
      console.error('[home-hero]', path, e);
      return { status: 0, ok: false, data: { error: '네트워크 오류' } };
    }
  }

  /* setting row에서 현재값 추출 (Draft 우선) */
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

    /* 슬라이드 작업본 초기화 */
    const slides = getCurrentJson(_settingsMap[KEYS.slides]);
    _slidesDraft = Array.isArray(slides) ? JSON.parse(JSON.stringify(slides)) : [];

    return res.data?.data;
  }

  /* ============ 렌더 ============ */
  async function render() {
    const inner = document.getElementById('sbContentInner');
    if (!inner) return;

    inner.innerHTML = '<div style="text-align:center;padding:60px;color:#86868b">HERO 편집 폼 로딩 중...</div>';

    const data = await load();
    if (!data) {
      inner.innerHTML = '<div style="text-align:center;padding:60px;color:#c5293a">로드 실패 — 관리자 로그인을 확인해 주세요.</div>';
      return;
    }

    /* 5개 키가 모두 있는지 점검 */
    const missingKeys = Object.values(KEYS).filter((k) => !_settingsMap[k]);
    if (missingKeys.length > 0) {
      inner.innerHTML = `
        <div style="padding:32px;background:#fff5f5;border:1px solid #f5b8b8;border-radius:8px;color:#7a1f2b">
          <strong>⚠️ 일부 시드 키가 없습니다</strong><br />
          누락: ${missingKeys.map(escapeHtml).join(', ')}<br />
          <small>시드 마이그레이션을 다시 실행하거나 관리자에게 문의하세요.</small>
        </div>
      `;
      return;
    }

    inner.innerHTML = renderForm();
    attachEvents();
  }

  function renderForm() {
    const eyebrow = getCurrentText(_settingsMap[KEYS.eyebrow]);
    const lead = getCurrentText(_settingsMap[KEYS.lead]);
    const speed = getCurrentText(_settingsMap[KEYS.autoplaySpeed]);
    const enabled = getCurrentText(_settingsMap[KEYS.autoplayEnabled]) === 'true';

    const draftBadges = {
      slides: _settingsMap[KEYS.slides]?.hasDraft ? '<span class="hh-badge">📝 Draft</span>' : '',
      eyebrow: _settingsMap[KEYS.eyebrow]?.hasDraft ? '<span class="hh-badge">📝 Draft</span>' : '',
      lead: _settingsMap[KEYS.lead]?.hasDraft ? '<span class="hh-badge">📝 Draft</span>' : '',
      speed: _settingsMap[KEYS.autoplaySpeed]?.hasDraft ? '<span class="hh-badge">📝 Draft</span>' : '',
      enabled: _settingsMap[KEYS.autoplayEnabled]?.hasDraft ? '<span class="hh-badge">📝 Draft</span>' : '',
    };

    const slidesHtml = _slidesDraft.map((slide, idx) => renderSlideCard(slide, idx)).join('');

    return `
      <style>
        .hh-wrap { padding:4px 4px 32px; }
        .hh-section-title { font-family:'Noto Serif KR',serif; font-size:18px; font-weight:600; margin:0 0 6px; }
        .hh-section-desc { font-size:12.5px; color:#86868b; margin:0 0 18px; }
        .hh-card {
          background:#fff; border:1px solid #e8e6e3; border-radius:10px;
          padding:18px 20px; margin-bottom:14px;
          box-shadow:0 1px 2px rgba(0,0,0,0.03);
        }
        .hh-card-header {
          display:flex; align-items:center; justify-content:space-between;
          margin-bottom:14px; gap:10px;
        }
        .hh-card-title { font-weight:700; font-size:14px; color:#7a1f2b; }
        .hh-card-actions { display:flex; gap:6px; }
        .hh-btn-mini {
          padding:5px 10px; font-size:11.5px; border:1px solid #d2d2d7;
          background:#fff; border-radius:6px; cursor:pointer; color:#1d1d1f;
          font-family:inherit;
        }
        .hh-btn-mini:hover:not(:disabled) { background:#f5f5f7; border-color:#7a1f2b; color:#7a1f2b; }
        .hh-btn-mini:disabled { opacity:0.4; cursor:not-allowed; }
        .hh-btn-danger { color:#c5293a; border-color:#f5c6cc; }
        .hh-btn-danger:hover { background:#fff5f5; }
        .hh-field { margin-bottom:12px; }
        .hh-field-label {
          display:block; font-size:12px; font-weight:600;
          color:#1d1d1f; margin-bottom:5px;
        }
        .hh-input, .hh-textarea {
          width:100%; padding:8px 10px; font-size:13px;
          border:1px solid #d2d2d7; border-radius:6px;
          font-family:inherit; box-sizing:border-box;
        }
        .hh-textarea { resize:vertical; min-height:60px; }
        .hh-input:focus, .hh-textarea:focus { outline:none; border-color:#7a1f2b; }
        .hh-grid-2 { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
        .hh-cta-row { display:grid; grid-template-columns:140px 1fr 1fr; gap:8px; align-items:end; }
        .hh-hint { font-size:11px; color:#86868b; margin-top:4px; }
        .hh-badge {
          display:inline-block; font-size:10px; padding:2px 7px;
          background:#fef5d8; color:#7a5e00; border-radius:10px;
          font-weight:600; vertical-align:middle; margin-left:6px;
        }
        .hh-add-btn {
          width:100%; padding:14px; font-size:13px;
          border:2px dashed #d2d2d7; background:#f9f9f9;
          border-radius:10px; cursor:pointer; color:#7a1f2b;
          font-weight:600; font-family:inherit;
        }
        .hh-add-btn:hover { border-color:#7a1f2b; background:#fef9f5; }
        .hh-save-bar {
          position:sticky; bottom:0; margin-top:24px;
          padding:14px 16px; background:#fff;
          border-top:1px solid #e8e6e3;
          display:flex; gap:10px; justify-content:flex-end;
          z-index:10;
        }
        .hh-btn-save {
          padding:10px 20px; font-size:13px; font-weight:700;
          background:linear-gradient(135deg,#7a1f2b,#a3303f);
          color:#fff; border:none; border-radius:7px;
          cursor:pointer; font-family:inherit;
        }
        .hh-btn-save:disabled { opacity:0.5; cursor:not-allowed; }
        .hh-checkbox-row {
          display:flex; align-items:center; gap:8px;
          padding:10px 12px; background:#f9f9f9; border-radius:6px;
        }
      </style>

      <div class="hh-wrap">
        <h2 class="hh-section-title">🎬 히어로 배너 편집</h2>
        <p class="hh-section-desc">
          메인 페이지 최상단 큰 영역의 슬라이더와 텍스트를 편집합니다.
          모든 변경사항은 임시저장(Draft)이며, 우측 상단 "배포" 버튼을 눌러야 운영에 반영됩니다.
        </p>

        <!-- ===== 1. 일반 텍스트 영역 ===== -->
        <div class="hh-card">
          <div class="hh-card-header">
            <span class="hh-card-title">📝 텍스트 영역</span>
          </div>

          <div class="hh-field">
            <label class="hh-field-label">
              상단 라벨 (eyebrow) ${draftBadges.eyebrow}
            </label>
            <input type="text" class="hh-input" id="hhEyebrow" value="${escapeHtml(eyebrow)}" placeholder="예: 기억 · 지원 · 연대 (REMEMBER · SUPPORT · SOLIDARITY)">
            <div class="hh-hint">슬라이드 위에 작게 표시되는 짧은 라벨</div>
          </div>

          <div class="hh-field">
            <label class="hh-field-label">
              본문 (lead) ${draftBadges.lead}
            </label>
            <textarea class="hh-textarea" id="hhLead" rows="3" placeholder="슬라이드 아래 표시되는 본문">${escapeHtml(lead)}</textarea>
            <div class="hh-hint">슬라이드 아래에 표시되는 회색 본문 텍스트</div>
          </div>
        </div>

        <!-- ===== 2. 슬라이드 카드 N장 ===== -->
        <div class="hh-card">
          <div class="hh-card-header">
            <span class="hh-card-title">🎞 슬라이드 (${_slidesDraft.length}장) ${draftBadges.slides}</span>
          </div>
          <div id="hhSlidesContainer">
            ${slidesHtml}
          </div>
          <button type="button" class="hh-add-btn" id="hhAddSlideBtn">
            ➕ 슬라이드 추가
          </button>
        </div>

        <!-- ===== 3. 자동재생 ===== -->
        <div class="hh-card">
          <div class="hh-card-header">
            <span class="hh-card-title">⏱ 자동재생 설정</span>
          </div>

          <div class="hh-grid-2">
            <div class="hh-field">
              <label class="hh-field-label">
                자동전환 속도 (초) ${draftBadges.speed}
              </label>
              <input type="number" min="2" max="60" class="hh-input" id="hhAutoplaySpeed" value="${escapeHtml(speed)}">
              <div class="hh-hint">슬라이드가 자동으로 넘어가는 시간</div>
            </div>

            <div class="hh-field">
              <label class="hh-field-label">
                자동재생 켜기/끄기 ${draftBadges.enabled}
              </label>
              <div class="hh-checkbox-row">
                <input type="checkbox" id="hhAutoplayEnabled" ${enabled ? 'checked' : ''} style="width:18px;height:18px">
                <label for="hhAutoplayEnabled" style="font-size:13px;cursor:pointer">자동전환 활성화</label>
              </div>
              <div class="hh-hint">끄면 사용자가 점을 클릭해야만 슬라이드 전환</div>
            </div>
          </div>
        </div>

        <!-- ===== 저장 바 (sticky) ===== -->
        <div class="hh-save-bar">
          <button type="button" class="hh-btn-mini" id="hhReloadBtn">🔄 처음부터 다시 불러오기</button>
          <button type="button" class="hh-btn-save" id="hhSaveBtn">💾 변경사항 모두 임시저장</button>
        </div>
      </div>
    `;
  }

  /* ============ 슬라이드 카드 1장 ============ */
  function renderSlideCard(slide, idx) {
    const total = _slidesDraft.length;
    const title = slide.title || '';
    const ctaP = slide.ctaPrimary || {};
    const ctaS = slide.ctaSecondary || {};
    const isActive = slide.isActive !== false;

    const ctaPType = ctaP.action || 'modal';
    const ctaSType = ctaS.action || 'link';
    const ctaPTarget = ctaPType === 'modal' ? (ctaP.target || '') : (ctaP.href || '');
    const ctaSTarget = ctaSType === 'modal' ? (ctaS.target || '') : (ctaS.href || '');

    return `
      <div class="hh-card" data-slide-idx="${idx}" style="border-left:3px solid ${isActive ? '#7a1f2b' : '#d2d2d7'}">
        <div class="hh-card-header">
          <span class="hh-card-title">슬라이드 #${idx + 1} ${isActive ? '' : '<span style="color:#86868b;font-weight:400">(비활성)</span>'}</span>
          <div class="hh-card-actions">
            <button type="button" class="hh-btn-mini" data-slide-up="${idx}" ${idx === 0 ? 'disabled' : ''} title="위로">▲</button>
            <button type="button" class="hh-btn-mini" data-slide-down="${idx}" ${idx === total - 1 ? 'disabled' : ''} title="아래로">▼</button>
            <button type="button" class="hh-btn-mini" data-slide-toggle="${idx}" title="활성/비활성">${isActive ? '👁' : '🚫'}</button>
            <button type="button" class="hh-btn-mini hh-btn-danger" data-slide-delete="${idx}" title="삭제">🗑</button>
          </div>
        </div>

        <div class="hh-field">
          <label class="hh-field-label">제목 (HTML 태그 사용 가능)</label>
          <textarea class="hh-textarea" data-slide-field="title" data-idx="${idx}" rows="3">${escapeHtml(title)}</textarea>
          <div class="hh-hint">&lt;em&gt;강조&lt;/em&gt; 와 &lt;br /&gt; 줄바꿈 사용 가능</div>
        </div>

        <!-- CTA Primary -->
        <div class="hh-field">
          <label class="hh-field-label">메인 버튼 (Primary CTA)</label>
          <div class="hh-cta-row">
            <input type="text" class="hh-input" placeholder="라벨" data-slide-field="ctaPrimary.label" data-idx="${idx}" value="${escapeHtml(ctaP.label || '')}">
            <select class="hh-input" data-slide-field="ctaPrimary.action" data-idx="${idx}">
              <option value="modal" ${ctaPType === 'modal' ? 'selected' : ''}>모달 열기</option>
              <option value="link" ${ctaPType === 'link' ? 'selected' : ''}>링크 이동</option>
            </select>
            <input type="text" class="hh-input" placeholder="${ctaPType === 'modal' ? '모달 ID (예: donateModal)' : 'URL (예: /support.html)'}" data-slide-field="ctaPrimary.target" data-idx="${idx}" value="${escapeHtml(ctaPTarget)}">
          </div>
        </div>

        <!-- CTA Secondary -->
        <div class="hh-field">
          <label class="hh-field-label">보조 버튼 (Secondary CTA)</label>
          <div class="hh-cta-row">
            <input type="text" class="hh-input" placeholder="라벨 (비우면 표시 안 함)" data-slide-field="ctaSecondary.label" data-idx="${idx}" value="${escapeHtml(ctaS.label || '')}">
            <select class="hh-input" data-slide-field="ctaSecondary.action" data-idx="${idx}">
              <option value="modal" ${ctaSType === 'modal' ? 'selected' : ''}>모달 열기</option>
              <option value="link" ${ctaSType === 'link' ? 'selected' : ''}>링크 이동</option>
            </select>
            <input type="text" class="hh-input" placeholder="${ctaSType === 'modal' ? '모달 ID' : 'URL'}" data-slide-field="ctaSecondary.target" data-idx="${idx}" value="${escapeHtml(ctaSTarget)}">
          </div>
        </div>
      </div>
    `;
  }

  /* ============ 이벤트 ============ */
  function attachEvents() {
    /* 슬라이드 필드 변경 → 작업본 갱신 */
    document.querySelectorAll('[data-slide-field]').forEach((el) => {
      el.addEventListener('input', onSlideFieldChange);
      el.addEventListener('change', onSlideFieldChange);
    });

    /* 슬라이드 액션 버튼 */
    document.querySelectorAll('[data-slide-up]').forEach((btn) => {
      btn.addEventListener('click', () => moveSlide(Number(btn.dataset.slideUp), -1));
    });
    document.querySelectorAll('[data-slide-down]').forEach((btn) => {
      btn.addEventListener('click', () => moveSlide(Number(btn.dataset.slideDown), +1));
    });
    document.querySelectorAll('[data-slide-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => toggleSlideActive(Number(btn.dataset.slideToggle)));
    });
    document.querySelectorAll('[data-slide-delete]').forEach((btn) => {
      btn.addEventListener('click', () => deleteSlide(Number(btn.dataset.slideDelete)));
    });

    const addBtn = document.getElementById('hhAddSlideBtn');
    if (addBtn) addBtn.addEventListener('click', addSlide);

    const saveBtn = document.getElementById('hhSaveBtn');
    if (saveBtn) saveBtn.addEventListener('click', saveAll);

    const reloadBtn = document.getElementById('hhReloadBtn');
    if (reloadBtn) reloadBtn.addEventListener('click', () => render());
  }

  function onSlideFieldChange(e) {
    const el = e.target;
    const idx = Number(el.dataset.idx);
    const field = el.dataset.slideField;
    if (Number.isNaN(idx) || !_slidesDraft[idx]) return;

    /* 점(.)이 있으면 nested 필드 (예: ctaPrimary.label) */
    if (field.indexOf('.') > 0) {
      const [outer, inner] = field.split('.');
      if (!_slidesDraft[idx][outer]) _slidesDraft[idx][outer] = {};
      if (inner === 'action') {
        /* action 변경 시 target/href 키 자동 정리 */
        _slidesDraft[idx][outer].action = el.value;
      } else if (inner === 'target') {
        const action = _slidesDraft[idx][outer].action || 'modal';
        if (action === 'modal') {
          _slidesDraft[idx][outer].target = el.value;
          delete _slidesDraft[idx][outer].href;
        } else {
          _slidesDraft[idx][outer].href = el.value;
          delete _slidesDraft[idx][outer].target;
        }
      } else {
        _slidesDraft[idx][outer][inner] = el.value;
      }

      /* action 셀렉트 변경이면 placeholder 갱신 위해 재렌더 */
      if (inner === 'action') {
        renderSlidesContainer();
      }
    } else {
      _slidesDraft[idx][field] = el.value;
    }
  }

  function moveSlide(idx, delta) {
    const newIdx = idx + delta;
    if (newIdx < 0 || newIdx >= _slidesDraft.length) return;
    const tmp = _slidesDraft[idx];
    _slidesDraft[idx] = _slidesDraft[newIdx];
    _slidesDraft[newIdx] = tmp;
    /* sortOrder 재할당 */
    _slidesDraft.forEach((s, i) => { s.sortOrder = i + 1; });
    renderSlidesContainer();
  }

  function toggleSlideActive(idx) {
    if (!_slidesDraft[idx]) return;
    _slidesDraft[idx].isActive = _slidesDraft[idx].isActive === false;
    renderSlidesContainer();
  }

  function deleteSlide(idx) {
    if (!_slidesDraft[idx]) return;
    if (_slidesDraft.length <= 1) {
      toast('최소 1장의 슬라이드는 필요합니다');
      return;
    }
    if (!confirm(`슬라이드 #${idx + 1}을 삭제하시겠습니까?`)) return;
    _slidesDraft.splice(idx, 1);
    _slidesDraft.forEach((s, i) => { s.sortOrder = i + 1; });
    renderSlidesContainer();
  }

  function addSlide() {
    _slidesDraft.push({
      title: '새 슬라이드 제목',
      ctaPrimary: { label: '후원 동참하기', action: 'modal', target: 'donateModal' },
      ctaSecondary: { label: '자세히 보기', action: 'link', href: '/about.html' },
      sortOrder: _slidesDraft.length + 1,
      isActive: true,
    });
    renderSlidesContainer();
  }

  /* 슬라이드 컨테이너만 부분 재렌더 (텍스트 입력 포커스 유지를 위해 슬라이드 카드 영역만) */
  function renderSlidesContainer() {
    const container = document.getElementById('hhSlidesContainer');
    if (!container) return;
    container.innerHTML = _slidesDraft.map((s, i) => renderSlideCard(s, i)).join('');

    /* 카드 헤더의 카운트 갱신 */
    const titleEl = document.querySelector('.hh-card-title');
    /* 슬라이드 카드 영역의 헤더는 다른 카드 안에 있으니 별도 셀렉터 */
    const allTitles = document.querySelectorAll('.hh-card-title');
    allTitles.forEach((t) => {
      if (t.textContent.indexOf('🎞') >= 0) {
        const draftBadge = _settingsMap[KEYS.slides]?.hasDraft ? ' 📝' : '';
        t.innerHTML = `🎞 슬라이드 (${_slidesDraft.length}장)${draftBadge}`;
      }
    });

    /* 이벤트 재바인딩 */
    document.querySelectorAll('[data-slide-field]').forEach((el) => {
      el.addEventListener('input', onSlideFieldChange);
      el.addEventListener('change', onSlideFieldChange);
    });
    document.querySelectorAll('[data-slide-up]').forEach((btn) => {
      btn.addEventListener('click', () => moveSlide(Number(btn.dataset.slideUp), -1));
    });
    document.querySelectorAll('[data-slide-down]').forEach((btn) => {
      btn.addEventListener('click', () => moveSlide(Number(btn.dataset.slideDown), +1));
    });
    document.querySelectorAll('[data-slide-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => toggleSlideActive(Number(btn.dataset.slideToggle)));
    });
    document.querySelectorAll('[data-slide-delete]').forEach((btn) => {
      btn.addEventListener('click', () => deleteSlide(Number(btn.dataset.slideDelete)));
    });
  }

  /* ============ 임시저장 (PATCH) ============ */
  async function saveAll() {
    const btn = document.getElementById('hhSaveBtn');
    if (btn) { btn.disabled = true; btn.textContent = '저장 중...'; }

    const updates = [];

    /* 1. 슬라이드 JSON */
    const slidesOriginal = JSON.stringify(getCurrentJson(_settingsMap[KEYS.slides]) || []);
    const slidesNow = JSON.stringify(_slidesDraft);
    if (slidesOriginal !== slidesNow) {
      updates.push({ id: _settingsMap[KEYS.slides].id, key: KEYS.slides, type: 'json', value: _slidesDraft });
    }

    /* 2. eyebrow */
    const eyebrowEl = document.getElementById('hhEyebrow');
    const eyebrowNew = eyebrowEl ? eyebrowEl.value : '';
    const eyebrowOriginal = getCurrentText(_settingsMap[KEYS.eyebrow]);
    if (eyebrowNew !== eyebrowOriginal) {
      updates.push({ id: _settingsMap[KEYS.eyebrow].id, key: KEYS.eyebrow, type: 'text', value: eyebrowNew });
    }

    /* 3. lead */
    const leadEl = document.getElementById('hhLead');
    const leadNew = leadEl ? leadEl.value : '';
    const leadOriginal = getCurrentText(_settingsMap[KEYS.lead]);
    if (leadNew !== leadOriginal) {
      updates.push({ id: _settingsMap[KEYS.lead].id, key: KEYS.lead, type: 'text', value: leadNew });
    }

    /* 4. autoplaySpeed */
    const speedEl = document.getElementById('hhAutoplaySpeed');
    const speedNew = speedEl ? String(speedEl.value) : '';
    const speedOriginal = getCurrentText(_settingsMap[KEYS.autoplaySpeed]);
    if (speedNew !== speedOriginal && speedNew.trim() !== '') {
      updates.push({ id: _settingsMap[KEYS.autoplaySpeed].id, key: KEYS.autoplaySpeed, type: 'text', value: speedNew });
    }

    /* 5. autoplayEnabled */
    const enabledEl = document.getElementById('hhAutoplayEnabled');
    const enabledNew = enabledEl && enabledEl.checked ? 'true' : 'false';
    const enabledOriginal = getCurrentText(_settingsMap[KEYS.autoplayEnabled]);
    if (enabledNew !== enabledOriginal) {
      updates.push({ id: _settingsMap[KEYS.autoplayEnabled].id, key: KEYS.autoplayEnabled, type: 'text', value: enabledNew });
    }

    if (updates.length === 0) {
      if (btn) { btn.disabled = false; btn.textContent = '💾 변경사항 모두 임시저장'; }
      toast('변경된 항목이 없습니다');
      return;
    }

    /* PATCH 다중 호출 */
    let okCount = 0, failCount = 0;
    for (const u of updates) {
      const body = { id: u.id };
      if (u.type === 'json') body.valueJson = u.value;
      else body.valueText = u.value;

      const res = await api('/api/admin/site-settings', { method: 'PATCH', body });
      if (res.ok) okCount++;
      else { failCount++; console.warn('[home-hero] save failed:', u.key, res.data?.error); }
    }

    if (btn) { btn.disabled = false; btn.textContent = '💾 변경사항 모두 임시저장'; }

    if (failCount === 0) {
      toast(`${okCount}건 임시저장 완료`);
    } else {
      toast(`${okCount}건 성공 / ${failCount}건 실패`);
    }

    /* 미리보기 새로고침 (Draft 모드라서 변경 즉시 반영) */
    if (window.SIREN_SITE_BUILDER && window.SIREN_SITE_BUILDER.reloadPreview) {
      window.SIREN_SITE_BUILDER.reloadPreview();
    }
    if (window.SIREN_SITE_BUILDER && window.SIREN_SITE_BUILDER.refreshDraftCount) {
      window.SIREN_SITE_BUILDER.refreshDraftCount();
    }

    /* 폼 다시 로드 — Draft 뱃지 반영 */
    await render();
  }

  /* ============ 외부 노출 ============ */
  window.SIREN_HOME_HERO = {
    render,
  };
})();