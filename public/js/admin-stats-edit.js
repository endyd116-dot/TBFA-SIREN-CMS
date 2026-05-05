/* =========================================================
   SIREN — admin-stats-edit.js (★ 2026-05 Phase A)
   콘텐츠 관리 → 통계 편집 모듈
   - site_settings의 'stats' scope를 CRUD
   - Draft 저장 → 최종 배포 (Publish) 분리
   ========================================================= */
(function () {
  'use strict';

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
      console.error('[stats-edit]', path, e);
      return { status: 0, ok: false, data: { error: '네트워크 오류' } };
    }
  }

  /* ============ 그룹 정의 (UI 표시용) ============ */
  const STAT_GROUPS = [
    {
      title: '💰 후원 통계',
      keys: [
        { key: 'donations.totalAmount', label: '누적 후원금 (원)', type: 'number', hint: '단위는 원. 1,283,000,000 처럼 숫자만 입력' },
      ],
    },
    {
      title: '📊 월별 후원금 추이 (활동 보고서 차트용)',
      keys: [
        { key: 'donations.monthlyTrend', label: '월별 추이 JSON', type: 'json', hint: '예: [{"month":"1월","amount":84200000}, ...]' },
      ],
    },
    {
      title: '🤝 활동 통계',
      keys: [
        { key: 'support.totalCount', label: '유가족 지원 건수', type: 'number' },
        { key: 'members.regularDonors', label: '정기 후원 회원 수', type: 'number' },
        { key: 'members.volunteers', label: '전문 봉사자 수', type: 'number' },
      ],
    },
    {
      title: '🥧 집행 비율 (도넛 차트, %)',
      keys: [
        { key: 'distribution.directSupport', label: '직접 지원 (%)', type: 'number', hint: '4개 항목 합이 100이 되어야 정확한 차트' },
        { key: 'distribution.memorial', label: '추모 사업 (%)', type: 'number' },
        { key: 'distribution.scholarship', label: '장학 사업 (%)', type: 'number' },
        { key: 'distribution.operation', label: '운영비 (%)', type: 'number' },
      ],
    },
    {
      title: '🏆 인증',
      keys: [
        { key: 'transparency.grade', label: '투명성 등급', type: 'text', hint: '예: A+' },
      ],
    },
  ];

  let _stats = null; /* 캐시 */
  let _settingsMap = {}; /* key → setting row */

  /* ============ 데이터 로드 ============ */
  async function loadStats() {
    const container = document.getElementById('statsEditContainer');
    if (!container) return;

    container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-3)">로딩 중...</div>';

    const res = await api('/api/admin/site-settings?scope=stats');
    if (!res.ok) {
      container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--danger)">조회 실패: ' + escapeHtml(res.data?.error || '오류') + '</div>';
      return;
    }

    _stats = res.data.data;
    _settingsMap = {};
    (_stats.list || []).forEach((s) => {
      _settingsMap[s.key] = s;
    });

    render();
  }

  function render() {
    const container = document.getElementById('statsEditContainer');
    if (!container) return;

    const draftCount = (_stats?.list || []).filter((s) => s.hasDraft).length;
    const draftBanner = draftCount > 0
      ? '<div class="stats-draft-banner">' +
        '<span>💾 임시 저장된 변경사항: <strong>' + draftCount + '건</strong></span>' +
        '<div style="display:flex;gap:8px">' +
          '<button type="button" class="btn-publish" id="statsPublishBtn">🚀 최종 배포 (운영 적용)</button>' +
          '<button type="button" class="btn-discard-all" id="statsDiscardAllBtn">↩️ 모든 변경사항 폐기</button>' +
        '</div>' +
        '</div>'
      : '<div class="stats-no-draft">✅ 임시 저장된 변경사항이 없습니다 (운영 사이트와 동기화됨)</div>';

    let groupsHtml = '';
    for (const group of STAT_GROUPS) {
      let rowsHtml = '';
      for (const fld of group.keys) {
        const setting = _settingsMap[fld.key];
        if (!setting) continue;

        /* 현재 값 vs Draft 값 */
        const currentValue = setting.valueType === 'json'
          ? JSON.stringify(setting.valueJson, null, 2)
          : (setting.valueText || '');

        const draftValue = setting.hasDraft
          ? (setting.valueType === 'json'
              ? JSON.stringify(setting.draftValueJson, null, 2)
              : (setting.draftValueText || ''))
          : currentValue;

        const draftBadge = setting.hasDraft
          ? '<span class="stats-draft-badge">📝 임시저장됨</span>'
          : '';

        const inputHtml = fld.type === 'json'
          ? '<textarea class="stats-input-json" data-stats-key="' + escapeHtml(fld.key) + '" data-type="json" rows="6">' + escapeHtml(draftValue) + '</textarea>'
          : '<input type="' + (fld.type === 'number' ? 'number' : 'text') + '" class="stats-input" data-stats-key="' + escapeHtml(fld.key) + '" data-type="' + fld.type + '" value="' + escapeHtml(draftValue) + '">';

        rowsHtml += '<div class="stats-row">' +
          '<div class="stats-row-label">' +
            '<span class="label">' + escapeHtml(fld.label) + '</span>' +
            draftBadge +
          '</div>' +
          '<div class="stats-row-input">' + inputHtml + '</div>' +
          (fld.hint ? '<div class="stats-row-hint">' + escapeHtml(fld.hint) + '</div>' : '') +
          (setting.hasDraft
            ? '<div class="stats-row-actions">' +
              '<button type="button" class="btn-mini btn-discard" data-stats-discard="' + setting.id + '">↩️ 이 항목 변경 폐기</button>' +
              '<span style="font-size:11px;color:var(--text-3);margin-left:auto">현재 운영 값: <code>' + escapeHtml(currentValue.slice(0, 60)) + (currentValue.length > 60 ? '...' : '') + '</code></span>' +
            '</div>'
            : '') +
          '</div>';
      }

      groupsHtml += '<div class="stats-group">' +
        '<h4 class="stats-group-title">' + escapeHtml(group.title) + '</h4>' +
        rowsHtml +
        '</div>';
    }

    container.innerHTML =
      '<div class="stats-edit-header">' +
        '<h3 style="margin:0;font-family:Noto Serif KR,serif">📊 통계 편집</h3>' +
        '<p class="stats-edit-desc">활동 보고서 페이지와 메인 페이지의 통계 수치를 직접 편집할 수 있습니다.<br />변경 후 저장하면 임시 저장(Draft) 상태가 되며, "최종 배포" 버튼을 눌러야 운영에 반영됩니다.</p>' +
      '</div>' +
      draftBanner +
      groupsHtml +
      '<div class="stats-save-bar">' +
        '<button type="button" class="btn-save-all" id="statsSaveAllBtn">💾 변경된 항목 모두 임시 저장</button>' +
        '<button type="button" class="btn-reload" id="statsReloadBtn">🔄 처음부터 다시 불러오기</button>' +
      '</div>';
  }

  /* ============ 변경된 입력값 수집 ============ */
  function collectChanges() {
    const inputs = document.querySelectorAll('[data-stats-key]');
    const changes = [];
    inputs.forEach((inp) => {
      const key = inp.dataset.statsKey;
      const type = inp.dataset.type;
      const setting = _settingsMap[key];
      if (!setting) return;

      const newValue = inp.value;
      let originalValue;
      if (setting.hasDraft) {
        originalValue = type === 'json'
          ? JSON.stringify(setting.draftValueJson, null, 2)
          : String(setting.draftValueText || '');
      } else {
        originalValue = type === 'json'
          ? JSON.stringify(setting.valueJson, null, 2)
          : String(setting.valueText || '');
      }

      if (newValue.trim() === originalValue.trim()) return;

      changes.push({ id: setting.id, key, type, newValue });
    });
    return changes;
  }

  /* ============ 임시 저장 ============ */
  async function saveAll() {
    const changes = collectChanges();
    if (changes.length === 0) {
      toast('변경된 항목이 없습니다');
      return;
    }

    const btn = document.getElementById('statsSaveAllBtn');
    if (btn) { btn.disabled = true; btn.textContent = '저장 중...'; }

    let okCount = 0, failCount = 0;
    for (const c of changes) {
      const body = { id: c.id };
      if (c.type === 'json') {
        try {
          body.valueJson = JSON.parse(c.newValue);
        } catch (e) {
          toast('JSON 파싱 실패: ' + c.key);
          failCount++;
          continue;
        }
      } else {
        body.valueText = c.newValue;
      }

      const res = await api('/api/admin/site-settings', { method: 'PATCH', body });
      if (res.ok) okCount++;
      else { failCount++; console.warn('[stats-edit] save failed:', c.key, res.data?.error); }
    }

    if (btn) { btn.disabled = false; btn.textContent = '💾 변경된 항목 모두 임시 저장'; }

    if (failCount === 0) {
      toast(`${okCount}건 임시 저장됨 (배포 전까지 운영 미반영)`);
    } else {
      toast(`${okCount}건 성공 / ${failCount}건 실패`);
    }
    await loadStats();
  }

  /* ============ 최종 배포 ============ */
  async function publish() {
    const draftCount = (_stats?.list || []).filter((s) => s.hasDraft).length;
    if (draftCount === 0) return toast('배포할 변경사항이 없습니다');

    const ok = confirm(
      `${draftCount}건의 변경사항을 운영에 적용하시겠습니까?\n\n` +
      '• 즉시 활동 보고서 페이지/메인 페이지에 반영됩니다\n' +
      '• 운영 적용 후에는 이전 값으로 되돌릴 수 없습니다 (수동 재입력 필요)\n' +
      '• 모든 임시 저장된 항목이 한 번에 배포됩니다'
    );
    if (!ok) return;

    const btn = document.getElementById('statsPublishBtn');
    if (btn) { btn.disabled = true; btn.textContent = '배포 중...'; }

    const res = await api('/api/admin/site-settings', {
      method: 'POST',
      body: { action: 'publish', scope: 'stats' },
    });

    if (btn) { btn.disabled = false; btn.textContent = '🚀 최종 배포 (운영 적용)'; }

    if (res.ok) {
      toast(res.data?.message || `${res.data?.data?.affectedCount || 0}건 배포 완료`);
      await loadStats();
    } else {
      toast(res.data?.error || '배포 실패');
    }
  }

  /* ============ 단일 Draft 폐기 ============ */
  async function discardOne(id) {
    if (!confirm('이 항목의 변경사항을 폐기하시겠습니까?')) return;

    const res = await api('/api/admin/site-settings?id=' + id + '&action=discard', { method: 'DELETE' });
    if (res.ok) {
      toast('변경사항이 폐기되었습니다');
      await loadStats();
    } else {
      toast(res.data?.error || '폐기 실패');
    }
  }

  /* ============ 모든 Draft 폐기 ============ */
  async function discardAll() {
    const draftCount = (_stats?.list || []).filter((s) => s.hasDraft).length;
    if (draftCount === 0) return;

    if (!confirm(`${draftCount}건의 모든 임시 변경사항을 폐기하시겠습니까?\n\n폐기된 변경사항은 복구할 수 없습니다.`)) return;

    let okCount = 0;
    for (const s of (_stats?.list || [])) {
      if (!s.hasDraft) continue;
      const res = await api('/api/admin/site-settings?id=' + s.id + '&action=discard', { method: 'DELETE' });
      if (res.ok) okCount++;
    }
    toast(`${okCount}건 폐기 완료`);
    await loadStats();
  }

  /* ============ 이벤트 위임 ============ */
  function setupEvents() {
    document.addEventListener('click', (e) => {
      if (e.target.closest('#statsSaveAllBtn')) { e.preventDefault(); saveAll(); return; }
      if (e.target.closest('#statsPublishBtn')) { e.preventDefault(); publish(); return; }
      if (e.target.closest('#statsDiscardAllBtn')) { e.preventDefault(); discardAll(); return; }
      if (e.target.closest('#statsReloadBtn')) { e.preventDefault(); loadStats(); return; }

      const discardBtn = e.target.closest('[data-stats-discard]');
      if (discardBtn) {
        e.preventDefault();
        const id = Number(discardBtn.dataset.statsDiscard);
        if (id) discardOne(id);
      }
    });
  }

  /* ============ 초기화 ============ */
  let _initialized = false;
  function init() {
    if (_initialized) return;
    _initialized = true;
    setupEvents();
  }

  /* 외부 노출 */
  window.SIREN_STATS_EDIT = {
    init,
    loadStats,
    refresh: loadStats,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();