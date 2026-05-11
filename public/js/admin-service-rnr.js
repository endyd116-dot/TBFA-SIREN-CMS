/**
 * Phase 21 R3 — 운영자 관리 R&R 탭
 *
 * API:
 *   GET    /api/admin-service-rnr      → { ok, data: { fallback: {...}, items: [...], total, canEdit } }
 *   POST   /api/admin-service-rnr      { serviceKind, serviceCategory, primaryUid, backupUid, isFallback? }
 *   DELETE /api/admin-service-rnr?id=X
 *
 * 권한:
 *   - GET : 모든 운영자 (읽기 전용 표시)
 *   - POST/DELETE : super_admin 만 (일반 운영자는 disabled + 토스트)
 */
(function () {
  'use strict';

  const STATE = {
    members: [],
    fallback: null,
    mappings: [],
    isEditor: false,   // super_admin 여부 (서버가 401/403 주면 false)
    loaded: false,
  };

  // 서비스 유형·카테고리 카탈로그 (UI 표시용)
  const SERVICE_CATALOG = [
    {
      kind: 'incident',
      label: '🚨 신고 (사건제보)',
      categories: [
        { value: 'school_violence',    label: '학교폭력' },
        { value: 'neighborhood_conflict', label: '이웃갈등' },
        { value: 'traffic_accident',   label: '교통사고' },
        { value: 'other',              label: '기타' },
      ],
    },
    {
      kind: 'harassment',
      label: '⚠️ 괴롭힘',
      categories: [
        { value: 'parent',  label: '학부모' },
        { value: 'student', label: '학생' },
        { value: 'admin',   label: '관리자' },
        { value: 'colleague', label: '동료' },
        { value: 'other',   label: '기타' },
      ],
    },
    {
      kind: 'legal',
      label: '⚖️ 법률 상담',
      categories: [
        { value: 'school_dispute', label: '학교 분쟁' },
        { value: 'civil',          label: '민사' },
        { value: 'criminal',       label: '형사' },
        { value: 'labor',          label: '노동' },
        { value: 'other',          label: '기타' },
      ],
    },
    {
      kind: 'support',
      label: '🤝 유족 지원',
      categories: [
        { value: 'psychological', label: '심리상담' },
        { value: 'legal',         label: '법률지원' },
        { value: 'scholarship',   label: '장학지원' },
        { value: 'financial',     label: '재정지원' },
        { value: 'other',         label: '기타' },
      ],
    },
  ];

  function $(s) { return document.querySelector(s); }
  function $$(s) { return Array.from(document.querySelectorAll(s)); }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[m]));
  }

  function toast(msg, type) {
    // admin.html 공용 토스트 사용 (있으면)
    if (typeof window.showToast === 'function') {
      window.showToast(msg, type);
      return;
    }
    // fallback
    const root = document.body;
    const el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = 'position:fixed;bottom:24px;right:24px;padding:12px 18px;background:' +
      (type === 'error' ? '#b91c1c' : type === 'success' ? '#15803d' : '#334155') +
      ';color:#fff;border-radius:6px;z-index:99999;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.15)';
    root.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  async function api(path, opts) {
    opts = opts || {};
    const res = await fetch(path, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      method: opts.method || 'GET',
      body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body
    });
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) throw new Error((data && (data.error || data.message)) || 'HTTP ' + res.status);
    return data;
  }

  /* ─────────── 데이터 로드 ─────────── */
  async function loadMembers() {
    try {
      const res = await api('/api/admin-workspace-members');
      const items = (res && res.data && res.data.items) || (res && res.items) || (res && res.data) || [];
      STATE.members = Array.isArray(items) ? items : [];
    } catch (err) {
      console.warn('[rnr] members 실패:', err);
      STATE.members = [];
    }
  }

  async function loadRnr() {
    try {
      const res = await api('/api/admin-service-rnr');
      const data = (res && res.data) || res || {};
      STATE.fallback = data.fallback || null;
      // B 응답: data.items[] (다른 API와 표준 일관)
      STATE.mappings = Array.isArray(data.items) ? data.items : (Array.isArray(data.mappings) ? data.mappings : []);
    } catch (err) {
      console.warn('[rnr] load 실패:', err);
      STATE.fallback = null;
      STATE.mappings = [];
    }
  }

  async function detectEditor() {
    try {
      const res = await api('/api/admin-me');
      const me = (res && res.data) || res || {};
      STATE.isEditor = !!(me && (me.role === 'super_admin'));
    } catch (_) {
      STATE.isEditor = false;
    }
  }

  /* ─────────── 렌더 ─────────── */
  function memberOptionsHtml(selectedUid) {
    const opts = ['<option value="">— 없음 —</option>'];
    STATE.members.forEach(m => {
      const uid = m.id || m.uid;
      if (!uid) return;
      const name = m.name || m.email || ('#' + uid);
      const away = m.outOfOffice ? ' (부재 중 ⚠️)' : '';
      const sel = Number(uid) === Number(selectedUid) ? ' selected' : '';
      opts.push('<option value="' + uid + '"' + sel + '>' + escapeHtml(name + away) + '</option>');
    });
    return opts.join('');
  }

  function renderFallback() {
    const sel = $('#rnrFallbackUid');
    const hint = $('#rnrFallbackHint');
    const saveBtn = $('#rnrFallbackSave');
    if (!sel) return;

    const fbUid = STATE.fallback ? STATE.fallback.primaryUid : null;
    sel.innerHTML = memberOptionsHtml(fbUid);

    if (hint) {
      hint.textContent = fbUid
        ? '현재 Fallback: ' + (STATE.fallback.primaryName || ('#' + fbUid))
        : '아직 지정되지 않음 — 미할당 카드는 풀에 쌓입니다';
    }

    if (saveBtn) {
      saveBtn.disabled = !STATE.isEditor;
      saveBtn.title = STATE.isEditor ? '' : '어드민만 편집할 수 있어요';
    }
    if (sel) sel.disabled = !STATE.isEditor;
  }

  function renderMappingGroups() {
    const wrap = $('#rnrMappingGroups');
    if (!wrap) return;

    // 카테고리별 현재 매핑을 빠르게 찾기
    const mapByKey = {};
    STATE.mappings.forEach(m => {
      if (m.isFallback) return;
      const key = (m.serviceKind || '') + '::' + (m.serviceCategory || '');
      mapByKey[key] = m;
    });

    const groups = SERVICE_CATALOG.map(group => {
      const rows = group.categories.map(cat => {
        const key = group.kind + '::' + cat.value;
        const m = mapByKey[key] || {};
        const disabled = STATE.isEditor ? '' : ' disabled';
        return `
          <tr data-rnr-row data-kind="${escapeHtml(group.kind)}" data-category="${escapeHtml(cat.value)}" ${m.id ? `data-id="${m.id}"` : ''}>
            <td style="padding:8px 10px;border-bottom:1px solid var(--line)">${escapeHtml(cat.label)}</td>
            <td style="padding:8px 10px;border-bottom:1px solid var(--line)">
              <select data-rnr-primary class="wk-input" style="min-width:180px"${disabled}>${memberOptionsHtml(m.primaryUid)}</select>
            </td>
            <td style="padding:8px 10px;border-bottom:1px solid var(--line)">
              <select data-rnr-backup class="wk-input" style="min-width:180px"${disabled}>${memberOptionsHtml(m.backupUid)}</select>
            </td>
            <td style="padding:8px 10px;border-bottom:1px solid var(--line);text-align:right">
              <button type="button" class="btn-sm btn-sm-primary" data-rnr-save${disabled}>저장</button>
              ${m.id && STATE.isEditor ? `<button type="button" class="btn-sm btn-sm-ghost" data-rnr-delete style="margin-left:4px">삭제</button>` : ''}
            </td>
          </tr>
        `;
      }).join('');

      return `
        <div class="rnr-group" style="margin-bottom:18px">
          <h4 style="margin:0 0 8px;font-size:14px;color:var(--text-1)">${escapeHtml(group.label)}</h4>
          <table class="tbl" style="width:100%;font-size:13px">
            <thead>
              <tr>
                <th style="width:22%;text-align:left;padding:8px 10px;background:#f8fafc">카테고리</th>
                <th style="width:32%;text-align:left;padding:8px 10px;background:#f8fafc">1차 담당자</th>
                <th style="width:32%;text-align:left;padding:8px 10px;background:#f8fafc">백업 담당자</th>
                <th style="width:14%;text-align:right;padding:8px 10px;background:#f8fafc">관리</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      `;
    }).join('');

    wrap.innerHTML = groups;

    const disabledHint = $('#rnrEditDisabledHint');
    if (disabledHint) disabledHint.style.display = STATE.isEditor ? 'none' : '';
  }

  /* ─────────── 저장·삭제 ─────────── */
  async function saveFallback() {
    if (!STATE.isEditor) {
      toast('어드민만 편집할 수 있어요', 'error');
      return;
    }
    const sel = $('#rnrFallbackUid');
    if (!sel) return;
    const uid = Number(sel.value) || null;
    try {
      await api('/api/admin-service-rnr', {
        method: 'POST',
        body: {
          serviceKind: '_global',
          serviceCategory: '_fallback',
          isFallback: true,
          primaryUid: uid,
          backupUid: null,
        }
      });
      toast('매핑이 저장됐어요', 'success');
      await loadRnr();
      renderFallback();
    } catch (err) {
      toast('저장 실패: ' + err.message, 'error');
    }
  }

  async function saveMapping(row) {
    if (!STATE.isEditor) {
      toast('어드민만 편집할 수 있어요', 'error');
      return;
    }
    const kind = row.dataset.kind;
    const category = row.dataset.category;
    const primarySel = row.querySelector('[data-rnr-primary]');
    const backupSel = row.querySelector('[data-rnr-backup]');
    const primaryUid = primarySel ? (Number(primarySel.value) || null) : null;
    const backupUid = backupSel ? (Number(backupSel.value) || null) : null;

    try {
      await api('/api/admin-service-rnr', {
        method: 'POST',
        body: {
          serviceKind: kind,
          serviceCategory: category,
          primaryUid: primaryUid,
          backupUid: backupUid,
          isFallback: false,
        }
      });
      toast('매핑이 저장됐어요', 'success');
      await loadRnr();
      renderMappingGroups();
    } catch (err) {
      toast('저장 실패: ' + err.message, 'error');
    }
  }

  async function deleteMapping(row) {
    if (!STATE.isEditor) {
      toast('어드민만 편집할 수 있어요', 'error');
      return;
    }
    const id = row.dataset.id;
    if (!id) return;
    if (!confirm('이 매핑을 삭제하시겠어요?')) return;
    try {
      await api('/api/admin-service-rnr?id=' + encodeURIComponent(id), { method: 'DELETE' });
      toast('매핑이 삭제됐어요', 'success');
      await loadRnr();
      renderMappingGroups();
    } catch (err) {
      toast('삭제 실패: ' + err.message, 'error');
    }
  }

  /* ─────────── 탭 전환 ─────────── */
  function bindTabs() {
    document.addEventListener('click', (e) => {
      const tab = e.target.closest('.op-tab');
      if (!tab) return;
      const which = tab.dataset.opTab;
      document.querySelectorAll('.op-tab').forEach(t => {
        const active = t === tab;
        t.classList.toggle('is-active', active);
        t.setAttribute('aria-selected', active ? 'true' : 'false');
        t.style.color = active ? 'var(--text-1)' : 'var(--text-3)';
        t.style.fontWeight = active ? '600' : '500';
        t.style.borderBottomColor = active ? 'var(--gold)' : 'transparent';
      });
      document.querySelectorAll('.op-tab-panel').forEach(p => {
        p.hidden = p.dataset.opPanel !== which;
      });
      if (which === 'rnr' && !STATE.loaded) {
        STATE.loaded = true;
        loadRnrPanel();
      }
    });
  }

  function bindActions() {
    document.addEventListener('click', (e) => {
      const fbBtn = e.target.closest('#rnrFallbackSave');
      if (fbBtn) { e.preventDefault(); saveFallback(); return; }

      const reloadBtn = e.target.closest('#rnrReload');
      if (reloadBtn) { e.preventDefault(); loadRnrPanel(); return; }

      const saveBtn = e.target.closest('[data-rnr-save]');
      if (saveBtn) {
        const row = saveBtn.closest('[data-rnr-row]');
        if (row) saveMapping(row);
        return;
      }
      const delBtn = e.target.closest('[data-rnr-delete]');
      if (delBtn) {
        const row = delBtn.closest('[data-rnr-row]');
        if (row) deleteMapping(row);
        return;
      }
    });
  }

  async function loadRnrPanel() {
    await Promise.all([loadMembers(), loadRnr(), detectEditor()]);
    renderFallback();
    renderMappingGroups();
  }

  function init() {
    // 운영자 관리 페이지(adm-operators)가 활성화될 때만 로드 — 탭 클릭으로 lazy 로드
    bindTabs();
    bindActions();

    // 페이지 진입 시 운영자 관리 화면이 활성이고 R&R 탭이 active면 즉시 로드
    const page = $('#adm-operators');
    if (page && page.classList.contains('active')) {
      // 기본은 list 탭이지만 일단 멤버는 로드해둠 (R&R 클릭 시 빠른 응답)
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
