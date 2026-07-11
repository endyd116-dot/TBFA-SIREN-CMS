/* =========================================================
   SIREN — admin-home-banner.js (★ Phase B Step 6-G)
   메인 화면 편집 → 특별 캠페인 배너 (하단) 편집 모듈
   - 모드 1: 직접 입력
   - 모드 2: 캠페인 연결 (linkedCampaignId)
   ========================================================= */
(function () {
  'use strict';

  const KEYS = {
    visible: 'home.specialBanner.visible',
    tag: 'home.specialBanner.tag',
    title: 'home.specialBanner.title',
    lead: 'home.specialBanner.lead',
    goalAmount: 'home.specialBanner.goalAmount',
    raisedAmount: 'home.specialBanner.raisedAmount',
    cta: 'home.specialBanner.cta',
    linkedCampaignId: 'home.specialBanner.linkedCampaignId',
  };

  let _settingsMap = {};
  let _ctaDraft = { primary: {}, secondary: {} };
  let _campaignList = []; /* 어드민 캠페인 목록 캐시 */

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

  /* ============ 캠페인 목록 로드 (어드민 → 공개 자동 폴백) ============ */
  async function loadCampaigns() {
    /* 어드민 API 우선 시도 */
    let res = await api('/api/admin/campaigns');
    if (!res.ok) {
      /* 공개 API 폴백 */
      res = await api('/api/campaigns');
    }
    if (!res.ok) return [];

    const list = res.data?.data?.list || res.data?.data || res.data?.list || [];
    return Array.isArray(list) ? list : [];
  }

  /* ============ 데이터 로드 ============ */
  async function load() {
    const [settingsRes, campaigns] = await Promise.all([
      api('/api/admin/site-settings?scope=home'),
      loadCampaigns(),
    ]);

    if (!settingsRes.ok) return false;

    _settingsMap = {};
    (settingsRes.data?.data?.list || []).forEach((s) => { _settingsMap[s.key] = s; });

    const cta = getCurrentJson(_settingsMap[KEYS.cta]) || { primary: {}, secondary: {} };
    _ctaDraft = JSON.parse(JSON.stringify(cta));
    if (!_ctaDraft.primary) _ctaDraft.primary = {};
    if (!_ctaDraft.secondary) _ctaDraft.secondary = {};

    _campaignList = campaigns;

    return true;
  }

  /* ============ 렌더 ============ */
  async function render() {
    const inner = document.getElementById('sbContentInner');
    if (!inner) return;
    inner.innerHTML = '<div style="text-align:center;padding:60px;color:#86868b">배너 편집 폼 로딩 중...</div>';

    const ok = await load();
    if (!ok) {
      inner.innerHTML = '<div style="text-align:center;padding:60px;color:#c5293a">로드 실패</div>';
      return;
    }

    if (!_settingsMap[KEYS.linkedCampaignId]) {
      inner.innerHTML = `
        <div style="padding:32px;background:#fff5f5;border:1px solid #f5b8b8;border-radius:8px;color:#7a1f2b">
          <strong>시드 키 누락</strong><br />
          <code>home.specialBanner.linkedCampaignId</code> 키가 없습니다.<br />
          <small>1회용 마이그레이션 <code>migrate-add-banner-campaign-key</code>를 먼저 실행해 주세요.</small>
        </div>
      `;
      return;
    }

    inner.innerHTML = renderForm();
    attachEvents();
  }

  function renderForm() {
    const visible = getCurrentText(_settingsMap[KEYS.visible]) === 'true';
    const tag = getCurrentText(_settingsMap[KEYS.tag]);
    const title = getCurrentText(_settingsMap[KEYS.title]);
    const lead = getCurrentText(_settingsMap[KEYS.lead]);
    const goal = getCurrentText(_settingsMap[KEYS.goalAmount]);
    const raised = getCurrentText(_settingsMap[KEYS.raisedAmount]);
    const linkedId = getCurrentText(_settingsMap[KEYS.linkedCampaignId]);
    const isLinked = linkedId && linkedId !== '';

    const draftBadges = {};
    Object.keys(KEYS).forEach((k) => {
      draftBadges[k] = _settingsMap[KEYS[k]]?.hasDraft ? '<span class="hb-badge">Draft</span>' : '';
    });

    /* 캠페인 옵션 */
    const campaignOptions = _campaignList.map((c) => {
      const sel = String(c.id) === String(linkedId) ? 'selected' : '';
      const titleStr = c.title || c.name || `캠페인 #${c.id}`;
      return `<option value="${escapeHtml(String(c.id))}" ${sel}>${escapeHtml(titleStr)}</option>`;
    }).join('');

    const ctaP = _ctaDraft.primary || {};
    const ctaS = _ctaDraft.secondary || {};
    const ctaPType = ctaP.action || 'modal';
    const ctaSType = ctaS.action || 'link';
    const ctaPVal = ctaPType === 'modal' ? (ctaP.target || '') : (ctaP.href || '');
    const ctaSVal = ctaSType === 'modal' ? (ctaS.target || '') : (ctaS.href || '');

    return `
      <style>
        .hb-wrap { padding:4px 4px 32px; }
        .hb-section-title { font-family:'Noto Serif KR',serif; font-size:18px; font-weight:600; margin:0 0 6px; }
        .hb-section-desc { font-size:12.5px; color:#86868b; margin:0 0 18px; }
        .hb-card {
          background:#fff; border:1px solid #e8e6e3; border-radius:10px;
          padding:18px 22px; margin-bottom:14px;
          box-shadow:0 1px 2px rgba(0,0,0,0.03);
        }
        .hb-card-title {
          font-weight:700; font-size:14px; color:#7a1f2b;
          margin:0 0 14px; padding-bottom:10px;
          border-bottom:1px solid #f0eeec;
        }
        .hb-field { margin-bottom:12px; }
        .hb-field-label {
          display:block; font-size:12px; font-weight:600;
          color:#1d1d1f; margin-bottom:5px;
        }
        .hb-input, .hb-textarea {
          width:100%; padding:8px 10px; font-size:13px;
          border:1px solid #d2d2d7; border-radius:6px;
          font-family:inherit; box-sizing:border-box;
        }
        .hb-textarea { resize:vertical; min-height:60px; }
        .hb-input:focus, .hb-textarea:focus { outline:none; border-color:#7a1f2b; }
        .hb-grid-2 { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
        .hb-cta-row { display:grid; grid-template-columns:140px 1fr 1fr; gap:8px; align-items:end; }
        .hb-hint { font-size:11px; color:#86868b; margin-top:4px; }
        .hb-badge {
          display:inline-block; font-size:10px; padding:2px 7px;
          background:#fef5d8; color:#7a5e00; border-radius:10px;
          font-weight:600; vertical-align:middle; margin-left:6px;
        }
        .hb-checkbox-row {
          display:flex; align-items:center; gap:8px;
          padding:10px 12px; background:#f9f9f9; border-radius:6px;
        }
        .hb-mode-tabs {
          display:flex; gap:0; margin-bottom:14px;
          border:1px solid #e8e6e3; border-radius:8px; overflow:hidden;
        }
        .hb-mode-tab {
          flex:1; padding:12px; text-align:center;
          background:#f9f9f9; cursor:pointer;
          font-size:13px; font-weight:600;
          border-right:1px solid #e8e6e3;
          color:#1d1d1f;
        }
        .hb-mode-tab:last-child { border-right:none; }
        .hb-mode-tab.active { background:#7a1f2b; color:#fff; }
        .hb-mode-body { display:none; }
        .hb-mode-body.active { display:block; }
        .hb-locked-hint {
          padding:10px 14px; background:#f5f5f7; border-radius:6px;
          color:#86868b; font-size:12px; margin-bottom:10px;
        }
        .hb-save-bar {
          position:sticky; bottom:0; margin-top:24px;
          padding:14px 16px; background:#fff;
          border-top:1px solid #e8e6e3;
          display:flex; gap:10px; justify-content:flex-end; z-index:10;
        }
        .hb-btn-mini { padding:8px 14px; font-size:12px; border:1px solid #d2d2d7; background:#fff; border-radius:6px; cursor:pointer; font-family:inherit; }
        .hb-btn-save { padding:10px 20px; font-size:13px; font-weight:700; background:linear-gradient(135deg,#7a1f2b,#a3303f); color:#fff; border:none; border-radius:7px; cursor:pointer; font-family:inherit; }
        .hb-btn-save:disabled { opacity:0.5; cursor:not-allowed; }
      </style>

      <div class="hb-wrap">
        <h2 class="hb-section-title">특별 캠페인 배너 편집 (하단)</h2>
        <p class="hb-section-desc">
          메인 페이지 하단에 표시되는 큰 배너입니다. 두 가지 모드 중 선택:<br />
          <strong>직접 입력</strong> — 모든 텍스트/금액/CTA를 어드민이 직접 편집<br />
          <strong>캠페인 연결</strong> — 캠페인 1개 선택 시 제목/모금액이 자동 반영
        </p>

        <!-- 영역 표시 토글 -->
        <div class="hb-card">
          <div class="hb-card-title">영역 전체 표시 ${draftBadges.visible}</div>
          <div class="hb-checkbox-row">
            <input type="checkbox" id="hbVisible" ${visible ? 'checked' : ''} style="width:18px;height:18px">
            <label for="hbVisible" style="font-size:13px;cursor:pointer">메인 페이지에 특별 배너 표시</label>
          </div>
        </div>

        <!-- 모드 탭 -->
        <div class="hb-card">
          <div class="hb-card-title">운영 모드 ${draftBadges.linkedCampaignId}</div>
          <div class="hb-mode-tabs" id="hbModeTabs">
            <div class="hb-mode-tab ${!isLinked ? 'active' : ''}" data-mode="direct">직접 입력</div>
            <div class="hb-mode-tab ${isLinked ? 'active' : ''}" data-mode="linked">캠페인 연결</div>
          </div>

          <!-- 모드 1: 직접 입력 -->
          <div class="hb-mode-body ${!isLinked ? 'active' : ''}" data-mode-body="direct">
            <div class="hb-field">
              <label class="hb-field-label">태그 ${draftBadges.tag}</label>
              <input type="text" class="hb-input" id="hbTag" value="${escapeHtml(tag)}" placeholder="예: 특별 캠페인 (SPECIAL CAMPAIGN)">
            </div>

            <div class="hb-field">
              <label class="hb-field-label">제목 (HTML 가능) ${draftBadges.title}</label>
              <textarea class="hb-textarea" id="hbTitle" rows="2">${escapeHtml(title)}</textarea>
              <div class="hb-hint">&lt;br /&gt; 줄바꿈 사용 가능</div>
            </div>

            <div class="hb-field">
              <label class="hb-field-label">본문 (lead) ${draftBadges.lead}</label>
              <textarea class="hb-textarea" id="hbLead" rows="3">${escapeHtml(lead)}</textarea>
            </div>

            <div class="hb-grid-2">
              <div class="hb-field">
                <label class="hb-field-label">목표 금액 (원) ${draftBadges.goalAmount}</label>
                <input type="number" class="hb-input" id="hbGoal" value="${escapeHtml(goal)}" placeholder="100000000">
                <div class="hb-hint">단위는 원. 1억이면 100000000</div>
              </div>
              <div class="hb-field">
                <label class="hb-field-label">현재 모금액 (원) ${draftBadges.raisedAmount}</label>
                <input type="number" class="hb-input" id="hbRaised" value="${escapeHtml(raised)}">
              </div>
            </div>
          </div>

          <!-- 모드 2: 캠페인 연결 -->
          <div class="hb-mode-body ${isLinked ? 'active' : ''}" data-mode-body="linked">
            <div class="hb-locked-hint">
              캠페인 연결 모드 — 선택한 캠페인의 제목·모금액·목표가 자동 반영됩니다.<br />
              직접 편집은 비활성화되며, 태그/본문은 직접 입력 값이 그대로 사용됩니다.
            </div>
            <div class="hb-field">
              <label class="hb-field-label">연결할 캠페인 선택</label>
              <select class="hb-input" id="hbLinkedId">
                <option value="">— 캠페인을 선택하세요 —</option>
                ${campaignOptions}
              </select>
              ${_campaignList.length === 0 ? '<div class="hb-hint" style="color:#c5293a">캠페인 목록이 비어있습니다. 어드민 → 캠페인 관리에서 먼저 캠페인을 만들어 주세요.</div>' : ''}
            </div>

            <div class="hb-field">
              <label class="hb-field-label">태그 (캠페인 연결 모드에서도 사용됨)</label>
              <input type="text" class="hb-input" id="hbTagLinked" value="${escapeHtml(tag)}">
            </div>

            <div class="hb-field">
              <label class="hb-field-label">본문 (캠페인 연결 모드에서도 사용됨)</label>
              <textarea class="hb-textarea" id="hbLeadLinked" rows="3">${escapeHtml(lead)}</textarea>
            </div>
          </div>
        </div>

        <!-- CTA 버튼 -->
        <div class="hb-card">
          <div class="hb-card-title">CTA 버튼 2개 ${draftBadges.cta}</div>

          <div class="hb-field">
            <label class="hb-field-label">메인 버튼 (Primary)</label>
            <div class="hb-cta-row">
              <input type="text" class="hb-input" placeholder="라벨" data-cta="primary.label" value="${escapeHtml(ctaP.label || '')}">
              <select class="hb-input" data-cta="primary.action">
                <option value="modal" ${ctaPType === 'modal' ? 'selected' : ''}>모달 열기</option>
                <option value="link" ${ctaPType === 'link' ? 'selected' : ''}>링크 이동</option>
              </select>
              <input type="text" class="hb-input" placeholder="${ctaPType === 'modal' ? '모달 ID' : 'URL'}" data-cta="primary.target" value="${escapeHtml(ctaPVal)}">
            </div>
          </div>

          <div class="hb-field">
            <label class="hb-field-label">보조 버튼 (Secondary, 비우면 표시 안 함)</label>
            <div class="hb-cta-row">
              <input type="text" class="hb-input" placeholder="라벨" data-cta="secondary.label" value="${escapeHtml(ctaS.label || '')}">
              <select class="hb-input" data-cta="secondary.action">
                <option value="modal" ${ctaSType === 'modal' ? 'selected' : ''}>모달 열기</option>
                <option value="link" ${ctaSType === 'link' ? 'selected' : ''}>링크 이동</option>
              </select>
              <input type="text" class="hb-input" placeholder="${ctaSType === 'modal' ? '모달 ID' : 'URL'}" data-cta="secondary.target" value="${escapeHtml(ctaSVal)}">
            </div>
          </div>
        </div>

        <div class="hb-save-bar">
          <button type="button" class="hb-btn-mini" id="hbReloadBtn">처음부터 다시 불러오기</button>
          <button type="button" class="hb-btn-save" id="hbSaveBtn">변경사항 모두 임시저장</button>
        </div>
      </div>
    `;
  }

  /* ============ 이벤트 ============ */
  function attachEvents() {
    /* 모드 탭 */
    document.querySelectorAll('[data-mode]').forEach((tab) => {
      tab.addEventListener('click', () => {
        const mode = tab.dataset.mode;
        document.querySelectorAll('[data-mode]').forEach((t) => t.classList.toggle('active', t.dataset.mode === mode));
        document.querySelectorAll('[data-mode-body]').forEach((b) => b.classList.toggle('active', b.dataset.modeBody === mode));
      });
    });

    /* CTA 필드 변경 → _ctaDraft 갱신 */
    document.querySelectorAll('[data-cta]').forEach((el) => {
      el.addEventListener('input', onCtaChange);
      el.addEventListener('change', onCtaChange);
    });

    document.getElementById('hbSaveBtn')?.addEventListener('click', saveAll);
    document.getElementById('hbReloadBtn')?.addEventListener('click', () => render());
  }

  function onCtaChange(e) {
    const el = e.target;
    const path = el.dataset.cta; /* 예: primary.label */
    const [outer, inner] = path.split('.');
    if (!_ctaDraft[outer]) _ctaDraft[outer] = {};

    if (inner === 'action') {
      _ctaDraft[outer].action = el.value;
    } else if (inner === 'target') {
      const action = _ctaDraft[outer].action || 'modal';
      if (action === 'modal') {
        _ctaDraft[outer].target = el.value;
        delete _ctaDraft[outer].href;
      } else {
        _ctaDraft[outer].href = el.value;
        delete _ctaDraft[outer].target;
      }
    } else {
      _ctaDraft[outer][inner] = el.value;
    }
  }

  /* ============ 임시저장 ============ */
  async function saveAll() {
    const btn = document.getElementById('hbSaveBtn');
    if (btn) { btn.disabled = true; btn.textContent = '저장 중...'; }

    const updates = [];

    /* 현재 활성 모드 확인 */
    const activeMode = document.querySelector('[data-mode].active')?.dataset.mode || 'direct';
    const isLinkedMode = activeMode === 'linked';

    /* 1. visible */
    const visibleNew = document.getElementById('hbVisible').checked ? 'true' : 'false';
    if (visibleNew !== getCurrentText(_settingsMap[KEYS.visible])) {
      updates.push({ id: _settingsMap[KEYS.visible].id, key: KEYS.visible, type: 'text', value: visibleNew });
    }

    /* 2. linkedCampaignId — 모드 1이면 빈 값, 모드 2면 선택값 */
    let linkedNew = '';
    if (isLinkedMode) {
      linkedNew = document.getElementById('hbLinkedId')?.value || '';
    }
    if (linkedNew !== getCurrentText(_settingsMap[KEYS.linkedCampaignId])) {
      updates.push({ id: _settingsMap[KEYS.linkedCampaignId].id, key: KEYS.linkedCampaignId, type: 'text', value: linkedNew });
    }

    /* 3. tag — 모드 1/2 둘 다 동일 키. 활성 탭의 입력 사용 */
    const tagNew = isLinkedMode
      ? (document.getElementById('hbTagLinked')?.value || '')
      : (document.getElementById('hbTag')?.value || '');
    if (tagNew !== getCurrentText(_settingsMap[KEYS.tag])) {
      updates.push({ id: _settingsMap[KEYS.tag].id, key: KEYS.tag, type: 'text', value: tagNew });
    }

    /* 4. lead — 모드 1/2 둘 다 동일 */
    const leadNew = isLinkedMode
      ? (document.getElementById('hbLeadLinked')?.value || '')
      : (document.getElementById('hbLead')?.value || '');
    if (leadNew !== getCurrentText(_settingsMap[KEYS.lead])) {
      updates.push({ id: _settingsMap[KEYS.lead].id, key: KEYS.lead, type: 'text', value: leadNew });
    }

    /* 5~7. 모드 1 전용 필드 (title/goal/raised) */
    if (!isLinkedMode) {
      const titleNew = document.getElementById('hbTitle')?.value || '';
      if (titleNew !== getCurrentText(_settingsMap[KEYS.title])) {
        updates.push({ id: _settingsMap[KEYS.title].id, key: KEYS.title, type: 'text', value: titleNew });
      }
      const goalNew = document.getElementById('hbGoal')?.value || '';
      if (goalNew !== getCurrentText(_settingsMap[KEYS.goalAmount])) {
        updates.push({ id: _settingsMap[KEYS.goalAmount].id, key: KEYS.goalAmount, type: 'text', value: goalNew });
      }
      const raisedNew = document.getElementById('hbRaised')?.value || '';
      if (raisedNew !== getCurrentText(_settingsMap[KEYS.raisedAmount])) {
        updates.push({ id: _settingsMap[KEYS.raisedAmount].id, key: KEYS.raisedAmount, type: 'text', value: raisedNew });
      }
    }

    /* 8. cta JSON */
    const ctaOriginal = JSON.stringify(getCurrentJson(_settingsMap[KEYS.cta]) || {});
    const ctaNow = JSON.stringify(_ctaDraft);
    if (ctaOriginal !== ctaNow) {
      updates.push({ id: _settingsMap[KEYS.cta].id, key: KEYS.cta, type: 'json', value: _ctaDraft });
    }

    if (updates.length === 0) {
      if (btn) { btn.disabled = false; btn.textContent = '변경사항 모두 임시저장'; }
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
      else { failCount++; console.warn('[home-banner]', u.key, res.data?.error); }
    }

    if (btn) { btn.disabled = false; btn.textContent = '변경사항 모두 임시저장'; }

    if (failCount === 0) toast(`${okCount}건 임시저장 완료`);
    else toast(`${okCount}건 성공 / ${failCount}건 실패`);

    if (window.SIREN_SITE_BUILDER?.reloadPreview) window.SIREN_SITE_BUILDER.reloadPreview();
    if (window.SIREN_SITE_BUILDER?.refreshDraftCount) window.SIREN_SITE_BUILDER.refreshDraftCount();

    await render();
  }

  window.SIREN_HOME_BANNER = { render };
})();