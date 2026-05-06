// public/js/admin-activity-report-list.js
// ★ C안 Step 3-A: AI 활동보고서 목록 화면 모듈
//
// 의존:
//   - window.SIREN_ACTIVITY_REPORT.openModal (admin-activity-report.js)
//   - 컨테이너: <div id="adm-activity-report"></div>
//
// 외부 노출:
//   window.SIREN_ADMIN_ACTIVITY_REPORT_LIST.load()      — 진입 시 호출
//   window.SIREN_ADMIN_ACTIVITY_REPORT_LIST.refresh()   — 데이터만 새로고침
(function () {
  'use strict';

  let _initialized = false;
  let _filters = { published: '', year: '' };
  let _list = [];

  /* ===== 헬퍼 ===== */
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function fmtDateTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.getFullYear() + '.' +
      String(d.getMonth() + 1).padStart(2, '0') + '.' +
      String(d.getDate()).padStart(2, '0') + ' ' +
      String(d.getHours()).padStart(2, '0') + ':' +
      String(d.getMinutes()).padStart(2, '0');
  }

  function fmtPeriod(year, month) {
    if (!year) return '—';
    if (!month) return `${year}년 (연간)`;
    /* 월에서 분기/반기 추정 */
    if (month === 1 || month === 4 || month === 7 || month === 10) {
      const q = Math.floor((month - 1) / 3) + 1;
      return `${year}년 ${q}분기`;
    }
    return `${year}.${String(month).padStart(2, '0')}`;
  }

  function fmtSize(bytes) {
    if (!bytes || bytes <= 0) return '—';
    if (bytes < 1024) return bytes + 'B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
    return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
  }

  function toast(msg, ms) {
    if (window.SIREN && window.SIREN.toast) return window.SIREN.toast(msg, ms);
    const t = document.getElementById('toast');
    if (!t) return alert(msg);
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(window._tt);
    window._tt = setTimeout(() => t.classList.remove('show'), ms || 2400);
  }

  async function api(path, opts) {
    opts = opts || {};
    const init = {
      method: opts.method || 'GET',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    };
    if (opts.body) init.body = JSON.stringify(opts.body);
    const res = await fetch(path, init);
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok && data.ok !== false, data };
  }

  /* ===== UI 빌드 ===== */
  function buildUI() {
    const container = document.getElementById('adm-activity-report');
    if (!container) return;

    container.innerHTML = `
      <style>
        #adm-activity-report .ar-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:18px; flex-wrap:wrap; gap:10px; }
        #adm-activity-report .ar-header h2 { margin:0; font-size:18px; font-weight:700; color:var(--text-1); }
        #adm-activity-report .ar-header p { margin:4px 0 0; font-size:12.5px; color:var(--text-3); }
        #adm-activity-report .ar-toolbar { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:14px; }
        #adm-activity-report .ar-toolbar select { padding:7px 12px; border:1px solid var(--line); border-radius:5px; font-size:12.5px; min-width:120px; }
        #adm-activity-report .ar-toolbar .btn-create { background:var(--brand); color:#fff; border:none; padding:9px 18px; border-radius:5px; font-size:13px; font-weight:600; cursor:pointer; margin-left:auto; }
        #adm-activity-report .ar-toolbar .btn-create:hover { background:var(--brand-deep, #5a1620); }
        #adm-activity-report .ar-toolbar .btn-refresh { background:#fff; color:var(--text-2); border:1px solid var(--line); padding:7px 14px; border-radius:5px; font-size:12.5px; cursor:pointer; }
        #adm-activity-report .ar-toolbar .btn-refresh:hover { background:#f5f4f2; }

        #adm-activity-report .ar-table { width:100%; border-collapse:collapse; background:#fff; border:1px solid var(--line); border-radius:6px; overflow:hidden; }
        #adm-activity-report .ar-table thead th { background:#f5f4f2; padding:10px 12px; text-align:left; font-size:11.5px; font-weight:700; color:var(--text-2); border-bottom:1px solid var(--line); white-space:nowrap; }
        #adm-activity-report .ar-table tbody td { padding:11px 12px; font-size:12.5px; border-bottom:1px solid #f5f4f2; vertical-align:middle; }
        #adm-activity-report .ar-table tbody tr:hover { background:#fefcfa; }
        #adm-activity-report .ar-empty { text-align:center; padding:50px 20px; color:var(--text-3); font-size:13px; }

        #adm-activity-report .ar-badge-pub { display:inline-block; padding:2px 8px; border-radius:10px; font-size:11px; font-weight:600; }
        #adm-activity-report .ar-badge-pub.published { background:#e8f5ec; color:#1a8b46; }
        #adm-activity-report .ar-badge-pub.draft { background:#f0f0f0; color:var(--text-3); }
        #adm-activity-report .ar-pin { font-size:13px; }

        #adm-activity-report .ar-actions { display:inline-flex; gap:5px; flex-wrap:wrap; }
        #adm-activity-report .ar-actions button { padding:4px 10px; font-size:11px; border:1px solid var(--line); background:#fff; border-radius:4px; cursor:pointer; white-space:nowrap; }
        #adm-activity-report .ar-actions button:hover { background:#f5f4f2; }
        #adm-activity-report .ar-actions button.preview { color:#1a5ec4; border-color:#cfe1f9; }
        #adm-activity-report .ar-actions button.preview:hover { background:#f0f6fe; }
        #adm-activity-report .ar-actions button.publish { color:#1a8b46; border-color:#bce5c8; }
        #adm-activity-report .ar-actions button.publish:hover { background:#f0faf3; }
        #adm-activity-report .ar-actions button.unpublish { color:#8a6a00; border-color:#f5e2a8; }
        #adm-activity-report .ar-actions button.unpublish:hover { background:#fffaee; }
        #adm-activity-report .ar-actions button.edit { color:var(--brand); border-color:#f0e0e3; }
        #adm-activity-report .ar-actions button.edit:hover { background:#fefcfa; }
        #adm-activity-report .ar-actions button.delete { color:var(--danger); border-color:#f5b5bb; }
        #adm-activity-report .ar-actions button.delete:hover { background:#fdecec; }

        #adm-activity-report .ar-stats-bar { display:flex; gap:16px; margin-bottom:18px; flex-wrap:wrap; }
        #adm-activity-report .ar-stat-mini { background:#fff; border:1px solid var(--line); border-radius:6px; padding:12px 16px; min-width:120px; flex:1; }
        #adm-activity-report .ar-stat-mini .label { font-size:11px; color:var(--text-3); margin-bottom:4px; }
        #adm-activity-report .ar-stat-mini .value { font-size:18px; font-weight:700; color:var(--text-1); }

        /* 미리보기 모달 */
        .ar-preview-modal { display:none; position:fixed; inset:0; z-index:9999; background:rgba(0,0,0,0.6); }
        .ar-preview-modal.show { display:flex; align-items:center; justify-content:center; padding:30px 20px; }
        .ar-preview-modal .ar-preview-box { background:#fff; border-radius:8px; max-width:900px; width:100%; max-height:90vh; display:flex; flex-direction:column; overflow:hidden; }
        .ar-preview-modal .ar-preview-head { padding:14px 20px; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; align-items:center; }
        .ar-preview-modal .ar-preview-head h3 { margin:0; font-size:15px; font-weight:700; }
        .ar-preview-modal .ar-preview-head .close { background:none; border:none; font-size:24px; cursor:pointer; color:var(--text-3); padding:0 6px; }
        .ar-preview-modal .ar-preview-body { padding:24px 28px; overflow-y:auto; flex:1; }
        .ar-preview-modal .ar-preview-body h1, .ar-preview-modal .ar-preview-body h2, .ar-preview-modal .ar-preview-body h3 { font-family:'Noto Serif KR', serif; }

        /* 제목 수정 모달 */
        .ar-edit-modal { display:none; position:fixed; inset:0; z-index:10000; background:rgba(0,0,0,0.6); }
        .ar-edit-modal.show { display:flex; align-items:center; justify-content:center; padding:30px 20px; }
        .ar-edit-modal .ar-edit-box { background:#fff; border-radius:8px; max-width:480px; width:100%; padding:22px; }
        .ar-edit-modal h3 { margin:0 0 14px; font-size:15px; font-weight:700; }
        .ar-edit-modal label { display:block; font-size:12px; color:var(--text-2); font-weight:600; margin-bottom:5px; }
        .ar-edit-modal input { width:100%; padding:9px 12px; border:1px solid var(--line); border-radius:5px; font-size:13px; box-sizing:border-box; }
        .ar-edit-modal .actions { margin-top:16px; display:flex; justify-content:flex-end; gap:8px; }
        .ar-edit-modal button { padding:8px 16px; border-radius:5px; font-size:12.5px; cursor:pointer; border:1px solid var(--line); background:#fff; }
        .ar-edit-modal button.primary { background:var(--brand); color:#fff; border-color:var(--brand); }
      </style>

      <div class="ar-header">
        <div>
          <h2>📊 AI 활동보고서</h2>
          <p>AI가 생성한 활동보고서를 관리합니다 — 발행 시 사용자 페이지에 자동 노출됩니다.</p>
        </div>
      </div>

      <div class="ar-stats-bar" id="arListStats"></div>

      <div class="ar-toolbar">
        <select id="arListFilterPublished">
          <option value="">전체 상태</option>
          <option value="true">📢 발행됨</option>
          <option value="false">📝 비공개(초안)</option>
        </select>
        <select id="arListFilterYear">
          <option value="">전체 연도</option>
        </select>
        <button class="btn-refresh" type="button" id="arListRefreshBtn">🔄 새로고침</button>
        <button class="btn-create" type="button" id="arListCreateBtn">🤖 새 보고서 생성</button>
      </div>

      <div id="arListTableBox">
        <div class="ar-empty">불러오는 중...</div>
      </div>

      <!-- 미리보기 모달 -->
      <div class="ar-preview-modal" id="arPreviewModal">
        <div class="ar-preview-box">
          <div class="ar-preview-head">
            <h3 id="arPreviewTitle">미리보기</h3>
            <button class="close" type="button" data-close-preview>&times;</button>
          </div>
          <div class="ar-preview-body" id="arPreviewBody"></div>
        </div>
      </div>

      <!-- 제목 수정 모달 -->
      <div class="ar-edit-modal" id="arEditModal">
        <div class="ar-edit-box">
          <h3>✏️ 보고서 제목 수정</h3>
          <label for="arEditTitleInput">제목</label>
          <input type="text" id="arEditTitleInput" maxlength="200" placeholder="보고서 제목" />
          <div class="actions">
            <button type="button" data-close-edit>취소</button>
            <button type="button" class="primary" id="arEditSaveBtn">💾 저장</button>
          </div>
        </div>
      </div>

      <!-- ★ 본문 수정 모달 (AI 초안 다듬기) -->
      <div class="ar-preview-modal" id="arBodyEditModal" style="z-index:10001">
        <div class="ar-preview-box" style="max-width:1100px;width:95vw;max-height:92vh">
          <div class="ar-preview-head">
            <h3 id="arBodyEditTitle">📝 본문 수정 (AI 초안 다듬기)</h3>
            <div style="display:flex;gap:8px;align-items:center">
              <button type="button" id="arBodyEditSaveBtn" style="background:var(--brand);color:#fff;border:none;padding:8px 18px;border-radius:5px;font-size:13px;font-weight:600;cursor:pointer">💾 저장</button>
              <button class="close" type="button" data-close-body-edit>&times;</button>
            </div>
          </div>
          <div style="padding:14px 20px;background:#fef9f5;border-bottom:1px solid var(--line);font-size:12px;color:var(--text-2)">
            💡 AI가 작성한 초안입니다. 사실 확인 후 표현/수치/문맥을 다듬어 주세요. 발행 전에는 반드시 검토하세요.
          </div>
          <div id="arBodyEditEditor" style="padding:16px 18px;min-height:520px;height:520px;background:#fff;overflow:auto"></div>
        </div>
      </div>
    `;
  }

  /* ===== 데이터 로드 ===== */
  async function loadData() {
    const tableBox = document.getElementById('arListTableBox');
    if (!tableBox) return;
    tableBox.innerHTML = '<div class="ar-empty">불러오는 중...</div>';

    const params = new URLSearchParams({ list: '1', limit: '100' });
    if (_filters.published) params.set('published', _filters.published);
    if (_filters.year) params.set('year', _filters.year);

    const res = await api('/api/admin/activity-report-ai?' + params.toString());
    if (!res.ok) {
      tableBox.innerHTML = `<div class="ar-empty" style="color:var(--danger)">조회 실패: ${escapeHtml(res.data?.error || '오류')}</div>`;
      return;
    }

    _list = res.data.data?.list || [];
    renderStats();
    renderTable();
    populateYearFilter();
  }

  /* ===== 통계 카드 ===== */
  function renderStats() {
    const el = document.getElementById('arListStats');
    if (!el) return;
    const total = _list.length;
    const published = _list.filter((p) => p.isPublished).length;
    const draft = total - published;
    const withPdf = _list.filter((p) => p.pdfBlobId).length;

    el.innerHTML = `
      <div class="ar-stat-mini">
        <div class="label">총 보고서</div>
        <div class="value">${total}</div>
      </div>
      <div class="ar-stat-mini">
        <div class="label">📢 발행됨</div>
        <div class="value" style="color:#1a8b46">${published}</div>
      </div>
      <div class="ar-stat-mini">
        <div class="label">📝 비공개</div>
        <div class="value" style="color:var(--text-3)">${draft}</div>
      </div>
      <div class="ar-stat-mini">
        <div class="label">📎 PDF 보유</div>
        <div class="value" style="color:#1a5ec4">${withPdf}</div>
      </div>
    `;
  }

  /* ===== 테이블 렌더 ===== */
  function renderTable() {
    const tableBox = document.getElementById('arListTableBox');
    if (!tableBox) return;

    if (_list.length === 0) {
      tableBox.innerHTML = `
        <div class="ar-empty">
          📊 생성된 활동보고서가 없습니다<br />
          <button class="btn-create" type="button" id="arListCreateBtnEmpty" style="margin-top:14px">🤖 첫 보고서 생성하기</button>
        </div>
      `;
      return;
    }

    const rows = _list.map((p) => {
      const pubBadge = p.isPublished
        ? '<span class="ar-badge-pub published">📢 발행됨</span>'
        : '<span class="ar-badge-pub draft">📝 비공개</span>';
      const pinIcon = p.isPinned ? '<span class="ar-pin">📌</span>' : '';
      const pdfBtn = p.pdfDownloadUrl
        ? `<a href="${escapeHtml(p.pdfDownloadUrl)}" target="_blank" rel="noopener" style="color:#1a5ec4;text-decoration:none;font-size:12px">📎 PDF</a>`
        : '<span style="color:var(--text-3);font-size:11px">없음</span>';
      const pubAction = p.isPublished
        ? `<button class="unpublish" data-action="unpublish" data-id="${p.id}">🔒 비공개</button>`
        : `<button class="publish" data-action="publish" data-id="${p.id}">📢 발행</button>`;

      return `<tr>
        <td style="font-family:Inter;font-size:11.5px;white-space:nowrap;color:var(--text-3)">${fmtDateTime(p.createdAt)}</td>
        <td style="white-space:nowrap;font-weight:600">${escapeHtml(fmtPeriod(p.year, p.month))}</td>
        <td>
          ${pinIcon}
          <span title="${escapeHtml(p.title)}">${escapeHtml(p.title)}</span>
          <div style="font-size:11px;color:var(--text-3);margin-top:2px">조회 ${p.views || 0}</div>
        </td>
        <td>${pubBadge}</td>
        <td>${pdfBtn}</td>
        <td><div class="ar-actions">
          <button class="preview" data-action="preview" data-id="${p.id}">👁 미리보기</button>
          <button class="edit" data-action="edit-body" data-id="${p.id}" data-title="${escapeHtml(p.title)}">📝 본문</button>
          ${pubAction}
          <button class="edit" data-action="edit-title" data-id="${p.id}" data-title="${escapeHtml(p.title)}">✏️ 제목</button>
          <button class="delete" data-action="delete" data-id="${p.id}" data-title="${escapeHtml(p.title)}">🗑 삭제</button>
        </div></td>
      </tr>`;
    }).join('');

    tableBox.innerHTML = `
      <table class="ar-table">
        <thead>
          <tr>
            <th>생성일</th>
            <th>기간</th>
            <th>제목</th>
            <th>상태</th>
            <th>PDF</th>
            <th>액션</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  /* ===== 연도 필터 옵션 채우기 ===== */
  function populateYearFilter() {
    const sel = document.getElementById('arListFilterYear');
    if (!sel) return;
    const years = [...new Set(_list.map((p) => p.year))].sort((a, b) => b - a);
    const current = sel.value;
    sel.innerHTML = '<option value="">전체 연도</option>' +
      years.map((y) => `<option value="${y}"${y === Number(current) ? ' selected' : ''}>${y}년</option>`).join('');
    if (current) sel.value = current;
  }

  /* ===== 액션 핸들러 ===== */
  async function previewReport(id) {
    const modal = document.getElementById('arPreviewModal');
    const titleEl = document.getElementById('arPreviewTitle');
    const bodyEl = document.getElementById('arPreviewBody');
    if (!modal || !titleEl || !bodyEl) return;

    titleEl.textContent = '불러오는 중...';
    bodyEl.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-3)">불러오는 중...</div>';
    modal.classList.add('show');

    const res = await api('/api/admin/activity-report-ai?postId=' + id);
    if (!res.ok) {
      bodyEl.innerHTML = `<div style="color:var(--danger);text-align:center;padding:40px">조회 실패: ${escapeHtml(res.data?.error || '오류')}</div>`;
      return;
    }
    const post = res.data.data?.post || {};
    titleEl.textContent = '👁 ' + (post.title || '미리보기');
    bodyEl.innerHTML = post.contentHtml || '<p>본문이 비어있습니다</p>';
  }

  async function togglePublish(id, makePublished) {
    const verb = makePublished ? '발행' : '비공개로 전환';
    if (!confirm(`보고서를 ${verb}하시겠습니까?\n\n${makePublished ? '※ 발행 시 사용자 페이지(/report.html)에 즉시 노출됩니다' : '※ 비공개 전환 시 사용자 페이지에서 사라집니다'}`)) return;

    const res = await api('/api/admin/activity-report-ai', {
      method: 'PATCH',
      body: { id, isPublished: makePublished },
    });
    if (res.ok) {
      toast(`${verb}되었습니다`);
      loadData();
    } else {
      toast(res.data?.error || `${verb} 실패`);
    }
  }

  function openEditTitleModal(id, currentTitle) {
    const modal = document.getElementById('arEditModal');
    const input = document.getElementById('arEditTitleInput');
    const saveBtn = document.getElementById('arEditSaveBtn');
    if (!modal || !input || !saveBtn) return;

    input.value = currentTitle || '';
    saveBtn.dataset.id = id;
    modal.classList.add('show');
    setTimeout(() => input.focus(), 100);
  }

  async function saveEditTitle() {
    const saveBtn = document.getElementById('arEditSaveBtn');
    const input = document.getElementById('arEditTitleInput');
    const id = Number(saveBtn?.dataset?.id);
    const title = (input?.value || '').trim();

    if (!Number.isFinite(id)) return toast('ID 오류');
    if (!title) return toast('제목을 입력해 주세요');

    saveBtn.disabled = true;
    saveBtn.textContent = '저장 중...';
    try {
      const res = await api('/api/admin/activity-report-ai', {
        method: 'PATCH',
        body: { id, title },
      });
      if (res.ok) {
        toast('제목이 수정되었습니다');
        document.getElementById('arEditModal').classList.remove('show');
        loadData();
      } else {
        toast(res.data?.error || '수정 실패');
      }
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = '💾 저장';
    }
  }

  /* ===== 본문 수정 (AI 초안 다듬기) ===== */
  let _bodyEditor = null;
  let _bodyEditingId = null;

  async function openBodyEditModal(id, title) {
    const modal = document.getElementById('arBodyEditModal');
    const titleEl = document.getElementById('arBodyEditTitle');
    const editorEl = document.getElementById('arBodyEditEditor');
    if (!modal || !editorEl) return;

    titleEl.textContent = `📝 본문 수정 — ${title || ''}`;
    _bodyEditingId = id;
    modal.classList.add('show');

    /* 본문 로드 */
    editorEl.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-3)">불러오는 중...</div>';
    const res = await api('/api/admin/activity-report-ai?postId=' + id);
    if (!res.ok) {
      editorEl.innerHTML = `<div style="padding:40px;text-align:center;color:var(--danger)">불러오기 실패: ${escapeHtml(res.data?.error || '오류')}</div>`;
      return;
    }
    const post = res.data.data?.post || {};

    /* Toast UI Editor 준비 */
    if (!window.SirenEditor || typeof window.SirenEditor.create !== 'function') {
      editorEl.innerHTML = `<div style="padding:40px;text-align:center;color:var(--danger)">편집기 모듈을 찾을 수 없습니다 (editor.js 로드 필요)</div>`;
      return;
    }

    /* 기존 인스턴스 정리 */
    editorEl.innerHTML = '';
    if (_bodyEditor) {
      try { _bodyEditor.destroy && _bodyEditor.destroy(); } catch (_) {}
      _bodyEditor = null;
    }

    try {
      /* ★ Toast UI 호환 — 빈 값으로 생성 후 setHTML로 별도 주입 */
      _bodyEditor = await window.SirenEditor.create({
        el: editorEl,
        height: '480px',
        initialValue: '',
        uploadContext: 'activity-report',
      });

      /* HTML 본문 주입 (AI가 생성한 풍부한 HTML이라 markdown 파싱 회피) */
      const html = post.contentHtml || '';
      if (html) {
        let injected = false;
        /* 1순위: setHTML */
        if (_bodyEditor.setHTML) {
          try { _bodyEditor.setHTML(html); injected = true; } catch (e1) {
            console.warn('[ar body editor] setHTML 실패:', e1);
          }
        }
        /* 2순위: 내부 인스턴스의 setHTML */
        if (!injected && _bodyEditor.editor && _bodyEditor.editor.setHTML) {
          try { _bodyEditor.editor.setHTML(html); injected = true; } catch (e2) {
            console.warn('[ar body editor] editor.setHTML 실패:', e2);
          }
        }
        /* 3순위: HTML 직접 DOM 주입 (최후 수단) */
        if (!injected) {
          const ww = editorEl.querySelector('.toastui-editor-ww-container .ProseMirror');
          if (ww) {
            ww.innerHTML = html;
            injected = true;
          }
        }
        if (!injected) {
          console.error('[ar body editor] HTML 주입 실패 — 모든 fallback 실패');
        }
      }
    } catch (e) {
      console.error('[ar body editor]', e);
      editorEl.innerHTML = `<div style="padding:40px;text-align:center;color:var(--danger)">편집기 로드 실패: ${escapeHtml(e?.message || '오류')}</div>`;
    }
  }

  async function saveBodyEdit() {
    if (!_bodyEditingId || !_bodyEditor) return toast('편집기 상태 오류');

    let contentHtml = '';
    try { contentHtml = _bodyEditor.getHTML(); } catch (e) {
      console.error(e);
      return toast('본문 추출 실패');
    }

    const saveBtn = document.getElementById('arBodyEditSaveBtn');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '저장 중...'; }

    try {
      const res = await api('/api/admin/activity-report-ai', {
        method: 'PATCH',
        body: { id: _bodyEditingId, contentHtml },
      });
      if (res.ok) {
        toast('본문이 저장되었습니다');
        document.getElementById('arBodyEditModal').classList.remove('show');
        loadData();
      } else {
        toast(res.data?.error || '저장 실패');
      }
    } finally {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '💾 저장'; }
    }
  }

  function closeBodyEditModal() {
    const modal = document.getElementById('arBodyEditModal');
    if (modal) modal.classList.remove('show');
    if (_bodyEditor) {
      try { _bodyEditor.destroy && _bodyEditor.destroy(); } catch (_) {}
      _bodyEditor = null;
    }
    _bodyEditingId = null;
  }

  async function deleteReport(id, title) {
    if (!confirm(`보고서를 삭제하시겠습니까?\n\n"${title}"\n\n※ 삭제 후 복구할 수 없습니다.\n※ PDF 첨부파일도 함께 사라집니다.`)) return;

    const res = await api('/api/admin/activity-report-ai?id=' + id, { method: 'DELETE' });
    if (res.ok) {
      toast('삭제되었습니다');
      loadData();
    } else {
      toast(res.data?.error || '삭제 실패');
    }
  }

  /* ===== 이벤트 위임 ===== */
  function setupEvents() {
    /* 컨테이너 위임 */
    document.addEventListener('click', (e) => {
      const container = document.getElementById('adm-activity-report');
      if (!container || !container.classList.contains('show')) {
        /* 미리보기 모달 닫기는 항상 처리 */
        if (e.target.matches('[data-close-preview]') || e.target.closest('[data-close-preview]')) {
          document.getElementById('arPreviewModal')?.classList.remove('show');
        }
        if (e.target.matches('[data-close-edit]') || e.target.closest('[data-close-edit]')) {
          document.getElementById('arEditModal')?.classList.remove('show');
        }
        return;
      }

      /* 새 보고서 생성 */
      if (e.target.closest('#arListCreateBtn') || e.target.closest('#arListCreateBtnEmpty')) {
        e.preventDefault();
        if (window.SIREN_ACTIVITY_REPORT && window.SIREN_ACTIVITY_REPORT.openModal) {
          window.SIREN_ACTIVITY_REPORT.openModal();
        } else {
          toast('보고서 생성 모듈이 로드되지 않았습니다');
        }
        return;
      }

      /* 새로고침 */
      if (e.target.closest('#arListRefreshBtn')) {
        e.preventDefault();
        loadData();
        return;
      }

      /* 액션 버튼 */
      const actionBtn = e.target.closest('[data-action]');
      if (actionBtn) {
        e.preventDefault();
        const action = actionBtn.dataset.action;
        const id = Number(actionBtn.dataset.id);
        if (!Number.isFinite(id)) return;

        if (action === 'preview') previewReport(id);
        else if (action === 'publish') togglePublish(id, true);
        else if (action === 'unpublish') togglePublish(id, false);
        else if (action === 'edit-title') openEditTitleModal(id, actionBtn.dataset.title || '');
        else if (action === 'edit-body') openBodyEditModal(id, actionBtn.dataset.title || '');
        else if (action === 'delete') deleteReport(id, actionBtn.dataset.title || '');
        return;
      }

      /* 미리보기 모달 닫기 */
      if (e.target.matches('[data-close-preview]') || e.target.closest('[data-close-preview]')) {
        document.getElementById('arPreviewModal')?.classList.remove('show');
        return;
      }
      if (e.target.id === 'arPreviewModal') {
        document.getElementById('arPreviewModal')?.classList.remove('show');
        return;
      }

      /* 제목 수정 모달 닫기 */
      if (e.target.matches('[data-close-edit]') || e.target.closest('[data-close-edit]')) {
        document.getElementById('arEditModal')?.classList.remove('show');
        return;
      }
      if (e.target.id === 'arEditModal') {
        document.getElementById('arEditModal')?.classList.remove('show');
        return;
      }

      /* 제목 수정 저장 */
      if (e.target.closest('#arEditSaveBtn')) {
        e.preventDefault();
        saveEditTitle();
        return;
      }

      /* ★ 본문 수정 모달 닫기 + 저장 */
      if (e.target.matches('[data-close-body-edit]') || e.target.closest('[data-close-body-edit]')) {
        e.preventDefault();
        closeBodyEditModal();
        return;
      }
      if (e.target.id === 'arBodyEditModal') {
        closeBodyEditModal();
        return;
      }
      if (e.target.closest('#arBodyEditSaveBtn')) {
        e.preventDefault();
        saveBodyEdit();
        return;
      }
    });

    /* 필터 변경 */
    document.addEventListener('change', (e) => {
      if (e.target.id === 'arListFilterPublished') {
        _filters.published = e.target.value;
        loadData();
      } else if (e.target.id === 'arListFilterYear') {
        _filters.year = e.target.value;
        loadData();
      }
    });

    /* 제목 수정 모달 Enter 키 */
    document.addEventListener('keydown', (e) => {
      const editModal = document.getElementById('arEditModal');
      if (editModal && editModal.classList.contains('show')) {
        if (e.key === 'Enter' && e.target.id === 'arEditTitleInput') {
          e.preventDefault();
          saveEditTitle();
        } else if (e.key === 'Escape') {
          editModal.classList.remove('show');
        }
      }
      const previewModal = document.getElementById('arPreviewModal');
      if (previewModal && previewModal.classList.contains('show') && e.key === 'Escape') {
        previewModal.classList.remove('show');
      }
    });
  }

  /* ===== 진입점 ===== */
  function load() {
    if (!_initialized) {
      buildUI();
      setupEvents();
      _initialized = true;
    }
    loadData();
  }

  function refresh() {
    if (_initialized) loadData();
  }

  /* 외부 노출 */
  window.SIREN_ADMIN_ACTIVITY_REPORT_LIST = { load, refresh };
})();