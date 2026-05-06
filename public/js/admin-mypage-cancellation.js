/* =========================================================
   SIREN — admin-mypage-cancellation.js (★ v11 묶음 B-1)
   메인 화면 편집기 → 마이페이지 정기 후원 해지 안내 편집 모듈
   ========================================================= */
(function () {
  'use strict';

  /* ============ 편집할 필드 정의 ============ */
  const FIELDS = [
    {
      key: 'mypage.cancellationGuide.modalTitle',
      label: '📌 모달 제목',
      type: 'text',
      hint: '안내 모달 상단에 표시되는 제목 (예: 🎗 정기 후원 해지 안내)',
      rows: 1,
      maxLength: 100,
    },
    {
      key: 'mypage.cancellationGuide.greeting',
      label: '🙏 1. 인사말',
      type: 'textarea',
      hint: '회원에게 전하는 감사 인사. 줄바꿈 가능. 정중하고 따뜻한 어조 권장',
      rows: 4,
      maxLength: 1000,
    },
    {
      key: 'mypage.cancellationGuide.procedure',
      label: '📋 2. 해지 절차',
      type: 'textarea',
      hint: '단계별 해지 방법. ▶ 또는 1) 2) 3) 같은 마커 사용 권장',
      rows: 6,
      maxLength: 1500,
    },
    {
      key: 'mypage.cancellationGuide.warnings',
      label: '⚠️ 3. 주의사항 / 안내',
      type: 'textarea',
      hint: '해지 시 발생하는 영향 안내. • (불릿) 마커 권장. 영수증 발급, 효성 CMS 등 특수 케이스 포함',
      rows: 8,
      maxLength: 2000,
    },
    {
      key: 'mypage.cancellationGuide.contactInfo',
      label: '💬 4. 문의처',
      type: 'textarea',
      hint: '해지 외 다른 옵션(일시중단/금액변경 등)이 있다면 안내. 1:1 상담 / 이메일 등',
      rows: 5,
      maxLength: 1000,
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
    const res = await api('/api/admin/site-settings?scope=mypage');
    if (!res.ok) return false;
    _settingsMap = {};
    (res.data?.data?.list || []).forEach((s) => { _settingsMap[s.key] = s; });
    return true;
  }

  /* ============ 렌더링 ============ */
  async function render() {
    const inner = document.getElementById('sbContentInner');
    if (!inner) return;
    inner.innerHTML = '<div style="text-align:center;padding:60px;color:#86868b">마이페이지 안내 편집 폼 로딩 중...</div>';

    const okLoad = await load();
    if (!okLoad) {
      inner.innerHTML = '<div style="text-align:center;padding:60px;color:#c5293a">로드 실패 — 시드 데이터가 누락되었을 수 있습니다</div>';
      return;
    }

    /* 5개 필드 모두 시드되어 있어야 함 */
    const missing = FIELDS.filter((f) => !_settingsMap[f.key]);
    if (missing.length > 0) {
      inner.innerHTML = `
        <div style="text-align:center;padding:40px;color:#c5293a">
          <p>다음 키가 DB에 없습니다:</p>
          <ul style="display:inline-block;text-align:left;color:#86868b;font-size:13px">
            ${missing.map((m) => `<li><code>${escapeHtml(m.key)}</code></li>`).join('')}
          </ul>
          <p style="margin-top:14px;font-size:12px">시드 마이그레이션을 다시 실행해 주세요.</p>
        </div>
      `;
      return;
    }

    const fieldsHtml = FIELDS.map(renderField).join('');

    inner.innerHTML = `
      <style>
        .mc-wrap { padding:4px 4px 32px; max-width:880px; margin:0 auto; }
        .mc-section-title { font-family:'Noto Serif KR',serif; font-size:18px; font-weight:600; margin:0 0 6px; }
        .mc-section-desc { font-size:12.5px; color:#86868b; margin:0 0 18px; line-height:1.7; }
        .mc-info-box { background:#fef9f5; border:1px solid #f5d97a; border-radius:8px; padding:12px 16px; margin-bottom:20px; font-size:12.5px; color:#7a5e00; line-height:1.7; }
        .mc-card { background:#fff; border:1px solid #e8e6e3; border-radius:10px; padding:18px 22px; margin-bottom:14px; }
        .mc-field-label { display:block; font-size:13px; font-weight:600; color:#1d1d1f; margin-bottom:8px; }
        .mc-input { width:100%; padding:10px 12px; font-size:13px; border:1px solid #d2d2d7; border-radius:6px; font-family:inherit; line-height:1.7; box-sizing:border-box; }
        .mc-input:focus { outline:none; border-color:#7a1f2b; }
        .mc-textarea { width:100%; padding:10px 12px; font-size:13px; border:1px solid #d2d2d7; border-radius:6px; font-family:inherit; line-height:1.7; resize:vertical; box-sizing:border-box; min-height:80px; }
        .mc-textarea:focus { outline:none; border-color:#7a1f2b; }
        .mc-hint { font-size:11.5px; color:#86868b; margin-top:6px; line-height:1.6; }
        .mc-counter { font-size:11px; color:#86868b; text-align:right; margin-top:4px; }
        .mc-badge { display:inline-block; font-size:10px; padding:2px 7px; background:#fef5d8; color:#7a5e00; border-radius:10px; font-weight:600; vertical-align:middle; margin-left:6px; }
        .mc-save-bar { position:sticky; bottom:0; margin-top:24px; padding:14px 16px; background:#fff; border-top:1px solid #e8e6e3; display:flex; gap:10px; justify-content:flex-end; z-index:10; }
        .mc-btn-mini { padding:8px 14px; font-size:12px; border:1px solid #d2d2d7; background:#fff; border-radius:6px; cursor:pointer; font-family:inherit; }
        .mc-btn-mini:hover { background:#f5f5f7; }
        .mc-btn-save { padding:10px 20px; font-size:13px; font-weight:700; background:linear-gradient(135deg,#7a1f2b,#a3303f); color:#fff; border:none; border-radius:7px; cursor:pointer; font-family:inherit; }
        .mc-btn-save:disabled { opacity:0.5; cursor:not-allowed; }
        .mc-preview-box { background:#f5f5f7; border-radius:6px; padding:10px 12px; margin-top:8px; font-size:12px; color:#424245; line-height:1.7; white-space:pre-wrap; max-height:140px; overflow-y:auto; }
      </style>

      <div class="mc-wrap">
        <h2 class="mc-section-title">🎗 정기 후원 해지 안내 편집</h2>
        <p class="mc-section-desc">
          마이페이지 → 후원 내역 → "정기 후원 해지 안내" 버튼을 누르면 표시되는 모달의 5개 영역을 편집합니다.<br />
          각 항목은 별도로 임시저장(Draft)되며, 우측 상단의 <strong>🚀 모든 변경사항 배포</strong>를 누르면 일괄 반영됩니다.
        </p>

        <div class="mc-info-box">
          💡 <strong>편집 가이드</strong><br />
          • 이 안내는 <strong>회원이 정기 후원을 해지하기 직전에</strong> 보는 화면입니다 — 정중하고 명확한 어조로 작성해 주세요<br />
          • 줄바꿈은 그대로 보존되며, 이모지·특수문자(▶, •, ✓ 등)도 자유롭게 사용 가능합니다<br />
          • 실제 해지는 모달 닫은 뒤 정기 후원 카드의 "🛑 해지하기" 버튼으로 진행됩니다 (이 모달은 안내 전용)
        </div>

        ${fieldsHtml}

        <div class="mc-save-bar">
          <button type="button" class="mc-btn-mini" id="mcReloadBtn">🔄 처음부터 다시 불러오기</button>
          <button type="button" class="mc-btn-save" id="mcSaveBtn">💾 변경사항 모두 임시저장</button>
        </div>
      </div>
    `;

    document.getElementById('mcSaveBtn')?.addEventListener('click', saveAll);
    document.getElementById('mcReloadBtn')?.addEventListener('click', () => render());

    /* 글자수 카운터 실시간 갱신 */
    document.querySelectorAll('[data-mc-counter]').forEach((counterEl) => {
      const targetKey = counterEl.dataset.mcCounter;
      const inputEl = document.querySelector(`[data-mc-key="${targetKey}"]`);
      if (!inputEl) return;
      const updateCount = () => {
        counterEl.textContent = `${inputEl.value.length} / ${counterEl.dataset.mcMax}`;
      };
      inputEl.addEventListener('input', updateCount);
      updateCount();
    });
  }

  function renderField(fld) {
    const setting = _settingsMap[fld.key];
    const value = getCurrentText(setting);
    const draftBadge = setting?.hasDraft ? '<span class="mc-badge">📝 Draft</span>' : '';
    const hintHtml = fld.hint ? `<div class="mc-hint">${escapeHtml(fld.hint)}</div>` : '';
    const counterHtml = fld.maxLength
      ? `<div class="mc-counter" data-mc-counter="${escapeHtml(fld.key)}" data-mc-max="${fld.maxLength}">0 / ${fld.maxLength}</div>`
      : '';

    let inputHtml;
    if (fld.type === 'textarea') {
      inputHtml = `
        <textarea class="mc-textarea"
                  data-mc-key="${escapeHtml(fld.key)}"
                  data-mc-type="text"
                  rows="${fld.rows || 4}"
                  maxlength="${fld.maxLength || 5000}">${escapeHtml(value)}</textarea>
      `;
    } else {
      inputHtml = `
        <input type="text" class="mc-input"
               data-mc-key="${escapeHtml(fld.key)}"
               data-mc-type="text"
               maxlength="${fld.maxLength || 200}"
               value="${escapeHtml(value)}">
      `;
    }

    return `
      <div class="mc-card">
        <label class="mc-field-label">${escapeHtml(fld.label)} ${draftBadge}</label>
        ${inputHtml}
        ${counterHtml}
        ${hintHtml}
      </div>
    `;
  }

  /* ============ 저장 ============ */
  async function saveAll() {
    const btn = document.getElementById('mcSaveBtn');
    if (btn) { btn.disabled = true; btn.textContent = '저장 중...'; }

    const updates = [];
    document.querySelectorAll('[data-mc-key]').forEach((el) => {
      const key = el.dataset.mcKey;
      const setting = _settingsMap[key];
      if (!setting) return;

      const newValue = el.value;
      const original = getCurrentText(setting);
      if (newValue === original) return;

      updates.push({ id: setting.id, key, value: newValue });
    });

    if (updates.length === 0) {
      if (btn) { btn.disabled = false; btn.textContent = '💾 변경사항 모두 임시저장'; }
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
      else { failCount++; console.warn('[mypage-cancellation]', u.key, res.data?.error); }
    }

    if (btn) { btn.disabled = false; btn.textContent = '💾 변경사항 모두 임시저장'; }
    if (failCount === 0) toast(`${okCount}건 임시저장 완료 — 우측 상단 🚀 배포 버튼으로 운영 반영`);
    else toast(`${okCount}건 성공 / ${failCount}건 실패`);

    /* 미리보기 새로고침 + Draft 카운터 갱신 */
    if (window.SIREN_SITE_BUILDER?.reloadPreview) window.SIREN_SITE_BUILDER.reloadPreview();
    if (window.SIREN_SITE_BUILDER?.refreshDraftCount) window.SIREN_SITE_BUILDER.refreshDraftCount();

    /* 폼 새로고침 (Draft 뱃지 표시) */
    await render();
  }

  /* ============ 공개 API ============ */
  window.SIREN_MYPAGE_CANCELLATION = { render };
})();