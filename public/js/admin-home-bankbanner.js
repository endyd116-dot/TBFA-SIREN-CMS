/* =========================================================
   SIREN — admin-home-bankbanner.js (2026-10-31)
   메인 화면 편집 → «후원 계좌 안내 배너» 편집 모듈
   - 노출·제목·문구만 여기서 (home.bankBanner.visible / title / lead · 임시저장 → 배포 관리에서 배포)
   - 은행·계좌번호·예금주·입금 안내는 후원 정책(어드민 › 후원 관리 › 후원 정책)이 단일 출처 — 여기선 보여만 준다
   - 설정 행이 아직 없으면 저장 전에 자동으로 만든다(/api/admin/site-setting-ensure)
   ========================================================= */
(function () {
  'use strict';

  const KEYS = {
    visible: 'home.bankBanner.visible',
    title: 'home.bankBanner.title',
    lead: 'home.bankBanner.lead',
  };
  const DEFAULTS = {
    visible: 'true',
    title: '후원 계좌 안내',
    lead: '후원회원 가입 없이 계좌이체로 함께하실 수도 있습니다. 입금자명을 남겨 주시면 확인 후 안내드립니다.',
  };

  let _settingsMap = {};
  let _bank = null;

  function toast(msg) {
    if (window.SIREN && window.SIREN.toast) window.SIREN.toast(msg);
    else if (typeof window.toast === 'function') window.toast(msg);
    else alert(msg);
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  async function api(path, opts) {
    opts = opts || {};
    const init = { method: opts.method || 'GET', credentials: 'include', headers: { 'Content-Type': 'application/json' } };
    if (opts.body) init.body = JSON.stringify(opts.body);
    try {
      const res = await fetch(path, init);
      const data = await res.json().catch(function () { return {}; });
      return { ok: res.ok && data.ok !== false, status: res.status, data: data };
    } catch (e) {
      return { ok: false, status: 0, data: { error: String(e && e.message || e) } };
    }
  }

  /* 설정 행의 «지금 값»(임시저장 우선) */
  function currentText(row) {
    if (!row) return null;
    const hasDraft = row.hasDraft === true || row.has_draft === true;
    const draft = row.draftValueText != null ? row.draftValueText : row.draft_value_text;
    const pub = row.valueText != null ? row.valueText : row.value_text;
    if (hasDraft && draft != null) return draft;
    return pub == null ? null : pub;
  }

  async function ensureKeys() {
    for (const k of Object.keys(KEYS)) {
      const key = KEYS[k];
      if (_settingsMap[key]) continue;
      const res = await api('/api/admin/site-setting-ensure', { method: 'POST', body: { key: key, valueText: DEFAULTS[k] } });
      if (!res.ok) { console.warn('[home-bankbanner] 설정 행 생성 실패', key, res.data && res.data.error); return false; }
    }
    return true;
  }

  async function load() {
    const settingsRes = await api('/api/admin/site-settings?scope=home');
    if (!settingsRes.ok) return false;
    _settingsMap = {};
    const list = (settingsRes.data && settingsRes.data.data && settingsRes.data.data.list) || (settingsRes.data && settingsRes.data.list) || [];
    list.forEach(function (s) { _settingsMap[s.key] = s; });

    const missing = Object.keys(KEYS).some(function (k) { return !_settingsMap[KEYS[k]]; });
    if (missing) {
      const made = await ensureKeys();
      if (made) {
        const again = await api('/api/admin/site-settings?scope=home');
        const list2 = (again.data && again.data.data && again.data.data.list) || (again.data && again.data.list) || [];
        _settingsMap = {};
        list2.forEach(function (s) { _settingsMap[s.key] = s; });
      }
    }

    /* 계좌 정보는 공개 후원 정책 API(발행값)로 보여만 준다 */
    const pol = await api('/api/donation-policy');
    const p = (pol.data && pol.data.data) || {};
    _bank = { bankName: p.bankName || '-', accountNo: p.bankAccountNo || '-', holder: p.bankAccountHolder || '-', guide: p.bankGuideText || '' };
    return true;
  }

  function valueOf(k) {
    const v = currentText(_settingsMap[KEYS[k]]);
    return v == null || v === '' ? DEFAULTS[k] : v;
  }

  function renderForm() {
    const visible = String(valueOf('visible')).toLowerCase() === 'true';
    const title = valueOf('title');
    const lead = valueOf('lead');
    const drafts = Object.keys(KEYS).filter(function (k) { const r = _settingsMap[KEYS[k]]; return r && (r.hasDraft === true || r.has_draft === true); }).length;
    return (
      '<div class="sb-form" style="max-width:760px">' +
        '<h3 style="margin:0 0 6px">후원 계좌 안내 배너</h3>' +
        '<p style="margin:0 0 18px;color:#6b7280;font-size:13px;line-height:1.6">후원회원 가입 없이 계좌이체로 마음을 보내려는 분을 위한 안내 배너입니다. 홈 퀵메뉴 바로 아래에 나옵니다. ' +
        '여기서는 노출·제목·문구만 고치고, <strong>은행·계좌번호·예금주·입금 안내문은 후원 관리 › 후원 정책</strong>에서 고칩니다(한 곳만 바꾸면 배너·후원 창·계좌이체 안내가 함께 바뀜).</p>' +
        (drafts ? '<div style="margin:0 0 14px;padding:10px 12px;background:#fff7ed;border:1px solid #fdba74;border-radius:8px;color:#9a3412;font-size:13px">임시저장된 변경 ' + drafts + '건 — 배포 관리에서 배포해야 홈에 반영됩니다.</div>' : '') +
        '<label style="display:flex;align-items:center;gap:10px;margin-bottom:16px;font-weight:600"><input type="checkbox" id="bbVisible"' + (visible ? ' checked' : '') + '> 홈에 노출</label>' +
        '<label style="display:block;font-weight:600;margin-bottom:6px">제목</label>' +
        '<input type="text" id="bbTitle" maxlength="60" value="' + escapeHtml(title) + '" style="width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:8px;margin-bottom:14px">' +
        '<label style="display:block;font-weight:600;margin-bottom:6px">문구</label>' +
        '<textarea id="bbLead" maxlength="300" rows="3" style="width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:8px;margin-bottom:14px">' + escapeHtml(lead) + '</textarea>' +
        '<div style="padding:14px 16px;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:10px;margin-bottom:18px">' +
          '<div style="font-size:12px;color:#64748b;margin-bottom:6px">배너에 함께 표시되는 계좌(후원 정책 값 · 읽기 전용)</div>' +
          '<div style="font-size:16px"><strong>' + escapeHtml(_bank.bankName) + ' ' + escapeHtml(_bank.accountNo) + '</strong> <span style="color:#475569">예금주 ' + escapeHtml(_bank.holder) + '</span></div>' +
          (_bank.guide ? '<div style="font-size:12.5px;color:#64748b;margin-top:4px">' + escapeHtml(_bank.guide) + '</div>' : '') +
          '<div style="margin-top:8px"><a href="/admin.html#donations" target="_blank" rel="noopener" style="font-size:12.5px;color:#7a1f2b;text-decoration:underline">후원 정책에서 계좌 고치기 →</a></div>' +
        '</div>' +
        '<button type="button" class="btn btn-primary" id="bbSaveBtn">변경사항 임시저장</button>' +
        '<span style="margin-left:10px;font-size:12.5px;color:#6b7280">저장 뒤 «배포 관리»에서 배포하면 홈에 반영됩니다.</span>' +
      '</div>'
    );
  }

  async function save() {
    const btn = document.getElementById('bbSaveBtn');
    if (btn) { btn.disabled = true; btn.textContent = '저장 중...'; }
    const next = {
      visible: document.getElementById('bbVisible') && document.getElementById('bbVisible').checked ? 'true' : 'false',
      title: (document.getElementById('bbTitle') && document.getElementById('bbTitle').value || '').trim() || DEFAULTS.title,
      lead: (document.getElementById('bbLead') && document.getElementById('bbLead').value || '').trim() || DEFAULTS.lead,
    };
    const updates = [];
    for (const k of Object.keys(KEYS)) {
      const row = _settingsMap[KEYS[k]];
      if (!row) continue;
      if (next[k] !== (currentText(row) == null ? '' : String(currentText(row)))) updates.push({ id: row.id, key: KEYS[k], value: next[k] });
    }
    if (!updates.length) {
      if (btn) { btn.disabled = false; btn.textContent = '변경사항 임시저장'; }
      toast('변경된 항목이 없습니다');
      return;
    }
    let okCount = 0, failCount = 0;
    for (const u of updates) {
      const res = await api('/api/admin/site-settings', { method: 'PATCH', body: { id: u.id, valueText: u.value } });
      if (res.ok) okCount++; else { failCount++; console.warn('[home-bankbanner]', u.key, res.data && res.data.error); }
    }
    if (btn) { btn.disabled = false; btn.textContent = '변경사항 임시저장'; }
    toast(failCount ? okCount + '건 성공 / ' + failCount + '건 실패' : okCount + '건 임시저장 완료 — 배포 관리에서 배포해 주세요');
    if (window.SIREN_SITE_BUILDER && window.SIREN_SITE_BUILDER.reloadPreview) window.SIREN_SITE_BUILDER.reloadPreview();
    if (window.SIREN_SITE_BUILDER && window.SIREN_SITE_BUILDER.refreshDraftCount) window.SIREN_SITE_BUILDER.refreshDraftCount();
    await render();
  }

  async function render() {
    const inner = document.getElementById('sbContentInner');
    if (!inner) return;
    inner.innerHTML = '<div style="text-align:center;padding:60px;color:#86868b">계좌 안내 배너 편집 폼 로딩 중...</div>';
    const ok = await load();
    if (!ok) { inner.innerHTML = '<div style="text-align:center;padding:60px;color:#c5293a">로드 실패</div>'; return; }
    const missing = Object.keys(KEYS).filter(function (k) { return !_settingsMap[KEYS[k]]; });
    if (missing.length) {
      inner.innerHTML = '<div style="padding:32px;background:#fff5f5;border:1px solid #f5b8b8;border-radius:8px;color:#7a1f2b"><strong>설정 행을 만들지 못했습니다</strong><br />' + escapeHtml(missing.join(', ')) + '<br /><small>권한(편집 가능 운영자)과 네트워크를 확인한 뒤 다시 열어 주세요.</small></div>';
      return;
    }
    inner.innerHTML = renderForm();
    const btn = document.getElementById('bbSaveBtn');
    if (btn) btn.addEventListener('click', save);
  }

  window.SIREN_HOME_BANKBANNER = { render: render };
})();
