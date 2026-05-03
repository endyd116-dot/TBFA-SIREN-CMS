/* =========================================================
   SIREN — admin-siren.js (★ Phase M-10)
   사이렌 관리 통합 모듈 (사건/악성민원/법률/자유게시판)
   - admin.js와 분리하여 유지보수 용이
   - window.SIREN_ADMIN_SIREN으로 외부 노출
   ========================================================= */
(function () {
  'use strict';

  /* ============ 헬퍼 ============ */
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.getFullYear() + '.' +
      String(d.getMonth() + 1).padStart(2, '0') + '.' +
      String(d.getDate()).padStart(2, '0');
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
    try {
      const res = await fetch(path, init);
      const data = await res.json().catch(() => ({}));
      return { status: res.status, ok: res.ok && data.ok !== false, data };
    } catch (e) {
      console.error('[siren-admin]', path, e);
      return { status: 0, ok: false, data: { error: '네트워크 오류' } };
    }
  }

  /* ============ 카테고리 라벨 ============ */
  const SEV_LABEL = {
    critical: '🚨 CRITICAL', high: '⚠️ HIGH',
    medium: '⚖️ MEDIUM', low: '💡 LOW',
    urgent: '🚨 URGENT', normal: '⚖️ NORMAL',
  };
  const STATUS_LABEL = {
    submitted: '접수', ai_analyzed: 'AI 분석',
    reviewing: '검토 중', matching: '매칭 중',
    matched: '매칭 완료', in_progress: '진행 중',
    responded: '답변 완료', closed: '종결', rejected: '반려',
  };
  const HARASS_CAT = { parent: '학부모', student: '학생', admin: '관리자', colleague: '동료', other: '기타' };
  const LEGAL_CAT = {
    school_dispute: '교권/학교', civil: '민사', criminal: '형사',
    family: '가사', labor: '노동', contract: '계약', other: '기타',
  };
  const BOARD_CAT = { general: '자유', share: '공유', question: '질문', info: '정보', etc: '기타' };

  /* ============ 카테고리별 설정 ============ */
  const KIND_CONFIG = {
    incident: {
      listApi: '/api/admin/incident-reports',
      detailApi: '/api/admin/incident-report-detail',
      tbody: '[data-srn-tbody="incident"]',
      kpiPrefix: 'si',
      noField: 'reportNo',
      categoryMap: null,
      sevField: 'aiSeverity',
      hasSiren: true,
      modalTitle: '🔍 사건 제보 상세',
    },
    harassment: {
      listApi: '/api/admin/harassment-reports',
      detailApi: '/api/admin/harassment-report-detail',
      tbody: '[data-srn-tbody="harassment"]',
      kpiPrefix: 'sh',
      noField: 'reportNo',
      categoryMap: HARASS_CAT,
      sevField: 'aiSeverity',
      hasSiren: true,
      modalTitle: '⚠️ 악성민원 신고 상세',
    },
    legal: {
      listApi: '/api/admin/legal-consultations',
      detailApi: '/api/admin/legal-consultation-detail',
      tbody: '[data-srn-tbody="legal"]',
      kpiPrefix: 'sl',
      noField: 'consultationNo',
      categoryMap: LEGAL_CAT,
      sevField: 'aiUrgency',
      hasSiren: true,
      hasLawyer: true,
      modalTitle: '⚖️ 법률지원 상담 상세',
    },
    board: {
      listApi: '/api/admin/board-posts',
      detailApi: '/api/admin/board-posts',
      tbody: '[data-srn-tbody="board"]',
      kpiPrefix: 'sb',
      noField: 'postNo',
      categoryMap: BOARD_CAT,
      sevField: null,
      hasSiren: false,
      hasBoard: true,
      modalTitle: '💬 자유게시판 게시글 상세',
    },
  };

  /* 필터 상태 (kind별) */
  const _filters = {
    incident: {}, harassment: {}, legal: {}, board: {},
  };
  const _searchTimer = {};
  let _currentDetailKind = null;
  let _currentDetailId = null;

  /* ============ 목록 로드 ============ */
  async function loadList(kind) {
    const cfg = KIND_CONFIG[kind];
    if (!cfg) return;

    const tbody = document.querySelector(cfg.tbody);
    if (!tbody) return;

    const colspan = (kind === 'board') ? 9 : 8;
    tbody.innerHTML = `<tr><td colspan="${colspan}" style="text-align:center;padding:30px;color:var(--text-3)">불러오는 중...</td></tr>`;

    const params = new URLSearchParams();
    params.set('limit', '50');
    params.set('page', '1');

    const f = _filters[kind] || {};
    Object.keys(f).forEach((k) => {
      const v = f[k];
      if (v === '' || v == null || v === false) return;
      if (k === 'q' && String(v).trim().length < 2) return;
      params.set(k, String(v));
    });

    const res = await api(cfg.listApi + '?' + params.toString());
    if (!res.ok || !res.data?.data) {
      tbody.innerHTML = `<tr><td colspan="${colspan}" style="text-align:center;padding:30px;color:var(--danger)">조회 실패</td></tr>`;
      return;
    }

    const list = res.data.data.list || [];
    const stats = res.data.data.stats || {};
    const pagination = res.data.data.pagination || {};

    /* KPI */
    renderKpi(kind, stats);

    /* 카운트 */
    const countEl = document.querySelector(`[data-srn-count="${kind}"]`);
    if (countEl) {
      const total = pagination.total || 0;
      countEl.textContent = `${list.length} / ${total.toLocaleString()}건`;
    }

    /* 사이드바 뱃지 (정식 접수/검토 중인 미답변 건수) */
    updateSidebarBadge(kind, stats);

    /* 목록 렌더 */
    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="${colspan}" style="text-align:center;padding:40px;color:var(--text-3)">조회된 항목이 없습니다</td></tr>`;
      return;
    }

    if (kind === 'incident') tbody.innerHTML = list.map(renderIncidentRow).join('');
    else if (kind === 'harassment') tbody.innerHTML = list.map(renderHarassmentRow).join('');
    else if (kind === 'legal') tbody.innerHTML = list.map(renderLegalRow).join('');
    else if (kind === 'board') tbody.innerHTML = list.map(renderBoardRow).join('');
  }

  function renderKpi(kind, stats) {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = String(v ?? 0); };

    if (kind === 'incident') {
      set('siKpiHigh', stats.highSeverity);
      set('siKpiAi', stats.aiAnalyzed);
      set('siKpiSiren', stats.sirenRequested);
      set('siKpiReviewing', stats.reviewing);
      set('siKpiResponded', stats.responded);
    } else if (kind === 'harassment') {
      set('shKpiHigh', stats.highSeverity);
      set('shKpiAi', stats.aiAnalyzed);
      set('shKpiSiren', stats.sirenRequested);
      set('shKpiReviewing', stats.reviewing);
      set('shKpiResponded', stats.responded);
    } else if (kind === 'legal') {
      set('slKpiUrgent', stats.urgent);
      set('slKpiSubmitted', stats.submitted);
      set('slKpiMatching', stats.matching);
      set('slKpiMatched', stats.matched);
      set('slKpiResponded', stats.responded);
    } else if (kind === 'board') {
      set('sbKpiTotal', stats.total);
      set('sbKpiPinned', stats.pinned);
      set('sbKpiHidden', stats.hidden);
      set('sbKpiComments', stats.commentTotal);
    }
  }

  function updateSidebarBadge(kind, stats) {
    const map = {
      incident: 'sirenIncidentBadge',
      harassment: 'sirenHarassmentBadge',
      legal: 'sirenLegalBadge',
      board: 'sirenBoardBadge',
    };
    const badge = document.getElementById(map[kind]);
    if (!badge) return;

    let n = 0;
    if (kind === 'incident' || kind === 'harassment') {
      n = (stats.sirenRequested || 0) - (stats.responded || 0);
      if (n < 0) n = 0;
    } else if (kind === 'legal') {
      n = (stats.matching || 0) + (stats.submitted || 0);
    } else if (kind === 'board') {
      n = stats.hidden || 0;
    }

    if (n > 0) {
      badge.textContent = n > 99 ? '99+' : String(n);
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
  }

  /* ============ 행 렌더링 ============ */
  function sevPill(sev) {
    if (!sev) return '<span class="srn-sev-pill empty">—</span>';
    return `<span class="srn-sev-pill ${escapeHtml(sev)}">${escapeHtml(SEV_LABEL[sev] || sev)}</span>`;
  }
  function statusPill(s) {
    return `<span class="srn-status-pill ${escapeHtml(s)}">${escapeHtml(STATUS_LABEL[s] || s)}</span>`;
  }
  function reporterCell(name, isAnon) {
    const safe = escapeHtml(name || '회원');
    return safe + (isAnon ? '<span class="srn-anon-badge">익명</span>' : '');
  }
  function summaryCell(title, summary) {
    return `<div style="font-weight:600;color:var(--ink)">${escapeHtml(title || '')}</div>` +
      (summary ? `<div class="srn-row-summary">${escapeHtml(summary)}</div>` : '');
  }
  function detailBtn(kind, id) {
    return `<button type="button" class="detail" data-srn-action="detail" data-srn-kind="${kind}" data-srn-id="${id}">📝 상세</button>`;
  }

  function renderIncidentRow(r) {
    const sirenMark = r.sirenReportRequested === true
      ? '<span style="color:var(--brand);font-weight:700">📌</span>'
      : (r.sirenReportRequested === false
        ? '<span style="color:var(--text-3)">📋</span>'
        : '<span style="color:var(--text-3)">—</span>');
    const reporterName = r.isAnonymous ? '제보자' : (r.memberName || r.reporterName || '회원');
    return `<tr>
      <td>${sevPill(r.aiSeverity)}</td>
      <td style="font-family:Inter;font-size:12px">${escapeHtml(r.reportNo)}</td>
      <td style="font-size:11.5px">${fmtDateTime(r.createdAt)}</td>
      <td>${summaryCell(r.title, r.aiSummary)}</td>
      <td>${reporterCell(reporterName, r.isAnonymous)}</td>
      <td>${statusPill(r.status)}</td>
      <td style="text-align:center">${sirenMark}</td>
      <td><div class="srn-row-actions">${detailBtn('incident', r.id)}</div></td>
    </tr>`;
  }

  function renderHarassmentRow(r) {
    const sirenMark = r.sirenReportRequested === true
      ? '<span style="color:var(--brand);font-weight:700">📌</span>'
      : '<span style="color:var(--text-3)">—</span>';
    const reporterName = r.isAnonymous ? '신고자' : (r.memberName || r.reporterName || '회원');
    const catLabel = HARASS_CAT[r.category] || r.category;
    return `<tr>
      <td>${sevPill(r.aiSeverity)}</td>
      <td style="font-family:Inter;font-size:12px">${escapeHtml(r.reportNo)}</td>
      <td style="font-size:11.5px">${escapeHtml(catLabel)}</td>
      <td style="font-size:11.5px">${fmtDateTime(r.createdAt)}</td>
      <td>${summaryCell(r.title, r.aiSummary)} ${sirenMark}</td>
      <td>${reporterCell(reporterName, r.isAnonymous)}</td>
      <td>${statusPill(r.status)}</td>
      <td><div class="srn-row-actions">${detailBtn('harassment', r.id)}</div></td>
    </tr>`;
  }

  function renderLegalRow(r) {
    const reporterName = r.isAnonymous ? '신청자' : (r.memberName || '회원');
    const catLabel = LEGAL_CAT[r.category] || r.category;
    const lawyerCell = r.assignedLawyerName
      ? `<strong style="color:#5a4d8c">${escapeHtml(r.assignedLawyerName)}</strong>`
      : (r.sirenReportRequested ? '<span style="color:var(--text-3)">매칭 대기</span>' : '<span style="color:var(--text-3)">—</span>');
    return `<tr>
      <td>${sevPill(r.aiUrgency)}</td>
      <td style="font-family:Inter;font-size:12px">${escapeHtml(r.consultationNo)}</td>
      <td style="font-size:11.5px">${escapeHtml(catLabel)}</td>
      <td style="font-size:11.5px">${fmtDateTime(r.createdAt)}</td>
      <td>${summaryCell(r.title, r.aiSummary)}<div style="font-size:11px;color:var(--text-3);margin-top:2px">${reporterCell(reporterName, r.isAnonymous)}</div></td>
      <td>${lawyerCell}</td>
      <td>${statusPill(r.status)}</td>
      <td><div class="srn-row-actions">${detailBtn('legal', r.id)}</div></td>
    </tr>`;
  }

  function renderBoardRow(r) {
    const catLabel = BOARD_CAT[r.category] || r.category;
    const hiddenMark = r.isHidden ? '🚫' : '✓';
    const hiddenColor = r.isHidden ? 'var(--danger)' : 'var(--success)';
    const pinMark = r.isPinned ? '<span style="color:var(--brand);margin-right:4px">📌</span>' : '';
    const author = r.isAnonymous ? '익명' : (r.authorName || '회원');
    const toggleBtn = r.isHidden
      ? `<button type="button" class="unhide" data-srn-action="quick-unhide" data-srn-id="${r.id}">↻ 복원</button>`
      : `<button type="button" class="hide" data-srn-action="quick-hide" data-srn-id="${r.id}">🚫 숨김</button>`;
    return `<tr ${r.isHidden ? 'style="opacity:0.55"' : ''}>
      <td style="font-family:Inter;font-size:12px">${r.id}</td>
      <td>${escapeHtml(catLabel)}</td>
      <td style="font-size:11.5px">${fmtDateTime(r.createdAt)}</td>
      <td>${pinMark}<strong>${escapeHtml(r.title)}</strong></td>
      <td>${escapeHtml(author)}</td>
      <td style="text-align:center;font-size:11.5px">${(r.views || 0).toLocaleString()}</td>
      <td style="text-align:center">${r.commentCount || 0}</td>
      <td style="text-align:center;color:${hiddenColor};font-size:14px">${hiddenMark}</td>
      <td><div class="srn-row-actions">${detailBtn('board', r.id)} ${toggleBtn}</div></td>
    </tr>`;
  }

  /* ============ 빠른 숨김/복원 ============ */
  async function quickToggleHidden(id, hideValue) {
    if (!confirm(hideValue ? '이 게시글을 숨김 처리하시겠습니까?\n사용자에게 노출되지 않습니다.' : '이 게시글의 숨김을 해제하시겠습니까?')) return;
    const res = await api('/api/admin/board-posts', {
      method: 'PATCH',
      body: { id, isHidden: hideValue },
    });
    if (res.ok) {
      toast(res.data?.message || '처리되었습니다');
      loadList('board');
    } else {
      toast(res.data?.error || '처리 실패');
    }
  }

  /* ============ 상세 모달 ============ */
  async function openDetail(kind, id) {
    const cfg = KIND_CONFIG[kind];
    if (!cfg) return;

    _currentDetailKind = kind;
    _currentDetailId = id;

    const modal = document.getElementById('sirenDetailModal');
    const title = document.getElementById('srnModalTitle');
    const body = document.getElementById('srnModalBody');
    if (!modal || !body) return;

    if (title) title.textContent = cfg.modalTitle;
    body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-3)">로딩 중...</div>';
    modal.classList.add('show');

    /* board는 다른 분기 (id query param) */
    const url = (kind === 'board')
      ? cfg.detailApi + '?id=' + id
      : cfg.detailApi + '?id=' + id;

    const res = await api(url);
    if (!res.ok || !res.data?.data) {
      body.innerHTML = `<div style="text-align:center;padding:40px;color:var(--danger)">${escapeHtml(res.data?.error || '조회 실패')}</div>`;
      return;
    }

    const data = res.data.data;
    if (kind === 'incident') renderIncidentDetail(body, data.report);
    else if (kind === 'harassment') renderHarassmentDetail(body, data.report);
    else if (kind === 'legal') renderLegalDetail(body, data.consultation);
    else if (kind === 'board') renderBoardDetail(body, data.post, data.comments || []);
  }

  /* ============ 상세 — 사건제보 ============ */
  function renderIncidentDetail(body, r) {
    if (!r) return;

    const reporterName = r.isAnonymous ? '제보자 (익명)' : (r.memberName || r.reporterName || '회원');
    const responderInfo = r.responder
      ? `${escapeHtml(r.responder.name)} · ${fmtDateTime(r.respondedAt)}`
      : '';

    const aiBlock = r.aiSummary ? `
      <div class="srn-modal-section">
        <h5>🤖 AI 분석 ${r.aiSeverity ? sevPill(r.aiSeverity) : ''}</h5>
        ${r.aiSummary ? `<div class="srn-ai-block"><div class="ai-title">📋 요약</div>${escapeHtml(r.aiSummary)}</div>` : ''}
        ${r.aiSuggestion ? `<div class="srn-ai-block"><div class="ai-title">💡 권장사항</div>${escapeHtml(r.aiSuggestion)}</div>` : ''}
      </div>` : '';

    const attachBlock = (r.attachments && r.attachments.length) ? `
      <div class="srn-modal-section">
        <h5>📎 첨부파일 (${r.attachments.length}개)</h5>
        <div class="srn-attach-list">
          ${r.attachments.map((a) => `
            <a class="srn-attach-link" href="${escapeHtml(a.url)}&download=1" target="_blank" rel="noopener">
              📎 ${escapeHtml(a.originalName)} <span style="color:var(--text-3);font-size:11px">⬇</span>
            </a>`).join('')}
        </div>
      </div>` : '';

    body.innerHTML = `
      <div class="srn-modal-info-grid">
        <div>접수번호</div><div style="font-family:Inter;font-weight:600">${escapeHtml(r.reportNo)}</div>
        <div>제목</div><div><strong>${escapeHtml(r.title)}</strong></div>
        <div>관련 사건</div><div>${r.incidentTitle ? escapeHtml(r.incidentTitle) : '—'}</div>
        <div>제보자</div><div>${escapeHtml(reporterName)}${r.memberEmail && !r.isAnonymous ? ` · ${escapeHtml(r.memberEmail)}` : ''}</div>
        <div>접수일시</div><div>${fmtDateTime(r.createdAt)}</div>
        <div>상태</div><div>${statusPill(r.status)}</div>
        <div>정식 접수</div><div>${r.sirenReportRequested === true ? '✅ Yes' : (r.sirenReportRequested === false ? '❌ No (AI만)' : '미결정')}</div>
        ${responderInfo ? `<div>답변자</div><div>${responderInfo}</div>` : ''}
      </div>

      <div class="srn-modal-section">
        <h5>📝 제보 내용</h5>
        <div class="srn-content-box">${r.contentHtml || ''}</div>
      </div>

      ${aiBlock}
      ${attachBlock}

      ${renderResponseForm('incident', r)}
    `;

    bindResponseFormEvents();
  }

  /* ============ 상세 — 악성민원 ============ */
  function renderHarassmentDetail(body, r) {
    if (!r) return;

    const reporterName = r.isAnonymous ? '신고자 (익명)' : (r.memberName || r.reporterName || '회원');
    const catLabel = HARASS_CAT[r.category] || r.category;

    const aiBlock = r.aiSummary ? `
      <div class="srn-modal-section">
        <h5>🤖 AI 분석 ${r.aiSeverity ? sevPill(r.aiSeverity) : ''}</h5>
        <div class="srn-ai-block"><div class="ai-title">📋 요약</div>${escapeHtml(r.aiSummary)}</div>
        ${r.aiImmediateAction ? `<div class="srn-ai-block danger"><div class="ai-title">🚀 즉각적 대처</div>${escapeHtml(r.aiImmediateAction)}</div>` : ''}
        ${r.aiLegalReviewNeeded ? `<div class="srn-ai-block legal"><div class="ai-title">⚖️ 법률 자문 권장</div>${escapeHtml(r.aiLegalReason || '')}</div>` : ''}
        ${r.aiPsychSupportNeeded ? `<div class="srn-ai-block"><div class="ai-title">💗 심리상담 권장</div>전문 상담사 매칭 권장</div>` : ''}
        ${r.aiSuggestion ? `<div class="srn-ai-block"><div class="ai-title">💡 종합 권장</div>${escapeHtml(r.aiSuggestion)}</div>` : ''}
      </div>` : '';

    const attachBlock = (r.attachments && r.attachments.length) ? `
      <div class="srn-modal-section">
        <h5>📎 첨부파일 (${r.attachments.length}개)</h5>
        <div class="srn-attach-list">
          ${r.attachments.map((a) => `
            <a class="srn-attach-link" href="${escapeHtml(a.url)}&download=1" target="_blank" rel="noopener">
              📎 ${escapeHtml(a.originalName)} <span style="color:var(--text-3);font-size:11px">⬇</span>
            </a>`).join('')}
        </div>
      </div>` : '';

    body.innerHTML = `
      <div class="srn-modal-info-grid">
        <div>신고번호</div><div style="font-family:Inter;font-weight:600">${escapeHtml(r.reportNo)}</div>
        <div>제목</div><div><strong>${escapeHtml(r.title)}</strong></div>
        <div>유형</div><div>${escapeHtml(catLabel)}</div>
        <div>발생 빈도</div><div>${r.frequency === 'once' ? '1회성' : r.frequency === 'recurring' ? '반복적' : r.frequency === 'ongoing' ? '진행 중' : '—'}</div>
        ${r.occurredAt ? `<div>발생 시기</div><div>${fmtDate(r.occurredAt)}</div>` : ''}
        <div>신고자</div><div>${escapeHtml(reporterName)}${r.memberEmail && !r.isAnonymous ? ` · ${escapeHtml(r.memberEmail)}` : ''}</div>
        <div>접수일시</div><div>${fmtDateTime(r.createdAt)}</div>
        <div>상태</div><div>${statusPill(r.status)}</div>
        <div>정식 신고</div><div>${r.sirenReportRequested === true ? '✅ Yes' : (r.sirenReportRequested === false ? '❌ No (AI만)' : '미결정')}</div>
      </div>

      <div class="srn-modal-section">
        <h5>📝 신고 내용</h5>
        <div class="srn-content-box">${r.contentHtml || ''}</div>
      </div>

      ${aiBlock}
      ${attachBlock}

      ${renderResponseForm('harassment', r)}
    `;

    bindResponseFormEvents();
  }

  /* ============ 상세 — 법률지원 ============ */
  function renderLegalDetail(body, r) {
    if (!r) return;

    const reporterName = r.isAnonymous ? '신청자 (익명)' : (r.memberName || '회원');
    const catLabel = LEGAL_CAT[r.category] || r.category;

    const aiBlock = r.aiSummary ? `
      <div class="srn-modal-section">
        <h5>🤖 AI 1차 분석 ${r.aiUrgency ? sevPill(r.aiUrgency) : ''}</h5>
        <div class="srn-ai-block"><div class="ai-title">📋 요약</div>${escapeHtml(r.aiSummary)}</div>
        ${r.aiRelatedLaws ? `<div class="srn-ai-block legal"><div class="ai-title">📜 관련 법령</div>${escapeHtml(r.aiRelatedLaws)}</div>` : ''}
        ${r.aiLegalOpinion ? `<div class="srn-ai-block legal"><div class="ai-title">⚖️ 1차 의견</div>${escapeHtml(r.aiLegalOpinion)}</div>` : ''}
        ${r.aiLawyerSpecialty ? `<div class="srn-ai-block legal"><div class="ai-title">👨‍⚖️ 권장 변호사 전문분야</div>${escapeHtml(r.aiLawyerSpecialty)}</div>` : ''}
        ${r.aiImmediateAction ? `<div class="srn-ai-block danger"><div class="ai-title">🔴 즉시 조치</div>${escapeHtml(r.aiImmediateAction)}</div>` : ''}
        ${r.aiSuggestion ? `<div class="srn-ai-block"><div class="ai-title">💡 종합 권장</div>${escapeHtml(r.aiSuggestion)}</div>` : ''}
      </div>` : '';

    const attachBlock = (r.attachments && r.attachments.length) ? `
      <div class="srn-modal-section">
        <h5>📎 증거 자료 (${r.attachments.length}개)</h5>
        <div class="srn-attach-list">
          ${r.attachments.map((a) => `
            <a class="srn-attach-link" href="${escapeHtml(a.url)}&download=1" target="_blank" rel="noopener">
              📎 ${escapeHtml(a.originalName)} <span style="color:var(--text-3);font-size:11px">⬇</span>
            </a>`).join('')}
        </div>
      </div>` : '';

    body.innerHTML = `
      <div class="srn-modal-info-grid">
        <div>접수번호</div><div style="font-family:Inter;font-weight:600">${escapeHtml(r.consultationNo)}</div>
        <div>제목</div><div><strong>${escapeHtml(r.title)}</strong></div>
        <div>법률 분야</div><div>${escapeHtml(catLabel)}</div>
        ${r.partyInfo ? `<div>상대방</div><div>${escapeHtml(r.partyInfo)}</div>` : ''}
        ${r.occurredAt ? `<div>발생 시기</div><div>${fmtDate(r.occurredAt)}</div>` : ''}
        <div>신청자</div><div>${escapeHtml(reporterName)}${r.memberEmail && !r.isAnonymous ? ` · ${escapeHtml(r.memberEmail)}` : ''}</div>
        <div>접수일시</div><div>${fmtDateTime(r.createdAt)}</div>
        <div>상태</div><div>${statusPill(r.status)}</div>
        <div>매칭 신청</div><div>${r.sirenReportRequested === true ? '✅ Yes' : '❌ AI만'}</div>
        <div>매칭 변호사</div><div>${r.assignedLawyerName ? `<strong style="color:#5a4d8c">${escapeHtml(r.assignedLawyerName)}</strong>` : '<span style="color:var(--text-3)">미배정</span>'}</div>
      </div>

      <div class="srn-modal-section">
        <h5>📝 사실관계</h5>
        <div class="srn-content-box">${r.contentHtml || ''}</div>
      </div>

      ${aiBlock}
      ${attachBlock}

      ${renderResponseForm('legal', r)}
    `;

    bindResponseFormEvents();
  }

  /* ============ 상세 — 자유게시판 ============ */
  function renderBoardDetail(body, p, comments) {
    if (!p) return;

    const author = p.isAnonymous ? '익명' : (p.authorName || '회원');
    const catLabel = BOARD_CAT[p.category] || p.category;

    const attachBlock = (p.attachments && p.attachments.length) ? `
      <div class="srn-modal-section">
        <h5>📎 첨부파일 (${p.attachments.length}개)</h5>
        <div class="srn-attach-list">
          ${p.attachments.map((a) => `
            <a class="srn-attach-link" href="${escapeHtml(a.url)}&download=1" target="_blank" rel="noopener">
              📎 ${escapeHtml(a.originalName)} <span style="color:var(--text-3);font-size:11px">⬇</span>
            </a>`).join('')}
        </div>
      </div>` : '';

    const commentsBlock = comments.length > 0 ? `
      <div class="srn-modal-section">
        <h5>💬 댓글 (${comments.length}개)</h5>
        <ul class="srn-comment-list">
          ${comments.map((c) => `
            <li class="srn-comment-item ${c.isHidden ? 'hidden' : ''}" data-cmt-id="${c.id}">
              <div class="meta">
                <span><strong>${escapeHtml(c.authorName)}</strong> · ${fmtDateTime(c.createdAt)}${c.isHidden ? ' · 🚫숨김' : ''}</span>
                <button class="del-btn" data-srn-action="delete-comment" data-cmt-id="${c.id}">삭제</button>
              </div>
              <div class="content">${escapeHtml(c.content)}</div>
            </li>`).join('')}
        </ul>
      </div>` : '';

    const memoSafe = String(p.adminMemo || '').replace(/"/g, '&quot;');

    body.innerHTML = `
      <div class="srn-modal-info-grid">
        <div>게시글 번호</div><div style="font-family:Inter;font-weight:600">${escapeHtml(p.postNo)}</div>
        <div>제목</div><div><strong>${escapeHtml(p.title)}</strong></div>
        <div>분류</div><div>${escapeHtml(catLabel)}</div>
        <div>작성자</div><div>${escapeHtml(author)}${p.memberEmail && !p.isAnonymous ? ` · ${escapeHtml(p.memberEmail)}` : ''}</div>
        <div>작성일</div><div>${fmtDateTime(p.createdAt)}</div>
        <div>조회 / 댓글</div><div>${(p.views || 0).toLocaleString()} / ${p.commentCount || 0}</div>
        <div>상태</div><div>${p.isHidden ? '<span style="color:var(--danger);font-weight:700">🚫 숨김</span>' : '<span style="color:var(--success);font-weight:700">✓ 노출</span>'} ${p.isPinned ? '<span style="color:var(--brand);margin-left:6px">📌 고정</span>' : ''}</div>
      </div>

      <div class="srn-modal-section">
        <h5>📝 본문</h5>
        <div class="srn-content-box">${p.contentHtml || ''}</div>
      </div>

      ${attachBlock}
      ${commentsBlock}

      <div class="srn-modal-section">
        <h5>🔧 운영자 도구</h5>
        <div class="srn-form-group">
          <label>관리자 메모 <span class="hint">(다른 운영자만 볼 수 있음)</span></label>
          <textarea id="srnBoardMemo" maxlength="5000" placeholder="이 게시글에 대한 메모...">${memoSafe}</textarea>
        </div>

        <div class="srn-form-group">
          <label>📢 운영진 공식 답변 작성 <span class="hint">(저장 시 댓글로 등록되며 작성자에게 알림 발송)</span></label>
          <button type="button" class="srn-ai-draft-btn" data-srn-action="ai-draft" data-srn-kind="board" data-srn-id="${p.id}" data-srn-target="srnBoardResponse">✍️ AI 답변 초안 생성 (Gemini)</button>
          <textarea id="srnBoardResponse" maxlength="1000" placeholder="작성자에게 전달할 운영진 공식 답변 (1000자 이내, 댓글로 게시됨)"></textarea>
        </div>

        <div class="srn-checkbox-block">
          <label>
            <input type="checkbox" id="srnBoardSendEmail">
            <span style="flex:1;line-height:1.6">
              <strong>📧 작성자에게 알림 메일 발송</strong><br />
              <span style="color:var(--text-3);font-size:11.5px">체크 시 답변 등록 알림 메일이 함께 발송됩니다 (익명 게시글은 작성자가 회원이어야 발송됨)</span>
            </span>
          </label>
        </div>

        <div class="srn-action-row">
          <button type="button" class="btn-save" data-srn-action="save-board" data-srn-id="${p.id}">💾 저장하기</button>
          ${p.isHidden
            ? `<button type="button" class="btn-unhide" data-srn-action="toggle-hidden" data-srn-id="${p.id}" data-srn-hide="false">↻ 숨김 해제</button>`
            : `<button type="button" class="btn-hide" data-srn-action="toggle-hidden" data-srn-id="${p.id}" data-srn-hide="true">🚫 숨김 처리</button>`}
          ${p.isPinned
            ? `<button type="button" class="btn-unhide" data-srn-action="toggle-pinned" data-srn-id="${p.id}" data-srn-pin="false">📌 고정 해제</button>`
            : `<button type="button" class="btn-unhide" data-srn-action="toggle-pinned" data-srn-id="${p.id}" data-srn-pin="true">📌 고정</button>`}
        </div>
      </div>
    `;
  }

  /* ============ 답변 폼 (사건/악성/법률 공통) ============ */
  function renderResponseForm(kind, r) {
    const cfg = KIND_CONFIG[kind];
    const noField = cfg.noField;
    const itemNo = r[noField];
    const currentResponse = String(r.adminResponse || '').replace(/"/g, '&quot;');

    const VALID_STATUS = {
      incident: [
        ['ai_analyzed', 'AI 분석 완료'],
        ['reviewing', '검토 중'],
        ['responded', '답변 완료'],
        ['closed', '종결'],
        ['rejected', '반려'],
      ],
      harassment: [
        ['ai_analyzed', 'AI 분석 완료'],
        ['reviewing', '검토 중'],
        ['responded', '답변 완료'],
        ['closed', '종결'],
        ['rejected', '반려'],
      ],
      legal: [
        ['ai_analyzed', 'AI 분석 완료'],
        ['matching', '변호사 매칭 중'],
        ['matched', '매칭 완료'],
        ['in_progress', '상담 진행 중'],
        ['responded', '답변 완료'],
        ['closed', '종결'],
        ['rejected', '반려'],
      ],
    };

    const statusOptions = (VALID_STATUS[kind] || []).map(([v, l]) =>
      `<option value="${v}" ${r.status === v ? 'selected' : ''}>${l}</option>`
    ).join('');

    const lawyerField = (kind === 'legal') ? `
      <div class="srn-form-group">
        <label>👨‍⚖️ 매칭 변호사 <span class="hint">(이름·전문분야)</span></label>
        <input type="text" id="srnAssignedLawyer" maxlength="50" value="${escapeHtml(r.assignedLawyerName || '')}" placeholder="예) 김○○ 변호사 (교육법 전문)">
      </div>` : '';

    return `
      <div class="srn-modal-section">
        <h5>📝 운영진 답변 작성</h5>

        <div class="srn-form-group">
          <label>처리 상태</label>
          <select id="srnStatus">${statusOptions}</select>
        </div>

        ${lawyerField}

        <div class="srn-form-group">
          <label>답변 메시지 <span class="hint">(마이페이지에서 신청자가 확인합니다)</span></label>
          <button type="button" class="srn-ai-draft-btn" data-srn-action="ai-draft" data-srn-kind="${kind}" data-srn-id="${r.id}" data-srn-target="srnResponse">✍️ AI 답변 초안 생성 (Gemini)</button>
          <textarea id="srnResponse" placeholder="신청자/제보자에게 전달할 답변을 입력하세요...">${currentResponse}</textarea>
        </div>

        <div class="srn-checkbox-block">
          <label>
            <input type="checkbox" id="srnSendEmail">
            <span style="flex:1;line-height:1.6">
              <strong>📧 저장 시 신청자에게 알림 메일 발송</strong><br />
              <span style="color:var(--text-3);font-size:11.5px">체크하면 답변 등록 알림이 메일로 함께 발송됩니다. (답변 본문은 메일에 노출되지 않으며, 마이페이지 로그인 후 열람 가능)</span>
            </span>
          </label>
        </div>

        <div class="srn-action-row">
          <button type="button" class="btn-save" data-srn-action="save-response" data-srn-kind="${kind}" data-srn-id="${r.id}">💾 답변 저장</button>
        </div>
      </div>
    `;
  }

  function bindResponseFormEvents() {
    /* 상세 모달 내 동적 요소들은 이벤트 위임으로 처리 (setupGlobalEvents에서) */
  }

  /* ============ AI 답변 초안 생성 ============ */
  async function generateAiDraft(kind, id, targetTextareaId) {
    const btn = document.querySelector(`[data-srn-action="ai-draft"][data-srn-id="${id}"][data-srn-kind="${kind}"]`);
    const textarea = document.getElementById(targetTextareaId);
    if (!textarea) return;

    if (textarea.value && textarea.value.trim().length > 0) {
      if (!confirm('현재 입력된 답변이 있습니다. AI 초안으로 덮어쓸까요?')) return;
    }

    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ AI 분석 중... (3-7초)';
    }

    try {
      const res = await api('/api/admin/ai/reply-draft-v2', {
        method: 'POST',
        body: { kind, id },
      });

      if (res.ok && res.data?.data?.draft) {
        textarea.value = res.data.data.draft;
        textarea.focus();
        toast('AI 답변 초안이 생성되었습니다 (수정 후 저장하세요)');
      } else {
        toast(res.data?.error || 'AI 초안 생성 실패');
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '✍️ AI 답변 초안 생성 (Gemini)';
      }
    }
  }

  /* ============ 답변 저장 (사건/악성/법률) ============ */
  async function saveResponse(kind, id) {
    const cfg = KIND_CONFIG[kind];
    const status = (document.getElementById('srnStatus') || {}).value || '';
    const adminResponse = (document.getElementById('srnResponse') || {}).value || '';
    const sendEmail = !!(document.getElementById('srnSendEmail') || {}).checked;
    const lawyer = (document.getElementById('srnAssignedLawyer') || {}).value;

    if (sendEmail && !adminResponse.trim()) {
      return toast('메일 발송 시 답변 내용을 입력해 주세요');
    }

    const btn = document.querySelector(`[data-srn-action="save-response"][data-srn-id="${id}"][data-srn-kind="${kind}"]`);
    if (btn) { btn.disabled = true; btn.textContent = '저장 중...'; }

    const payload = { id, status, adminResponse, sendEmail };
    if (kind === 'legal' && lawyer !== undefined) {
      payload.assignedLawyerName = lawyer;
    }

    const res = await api(cfg.detailApi, { method: 'PATCH', body: payload });

    if (btn) { btn.disabled = false; btn.textContent = '💾 답변 저장'; }

    if (res.ok) {
      toast(res.data?.message || '저장되었습니다');
      document.getElementById('sirenDetailModal')?.classList.remove('show');
      loadList(kind);
    } else {
      toast(res.data?.error || '저장 실패');
    }
  }

  /* ============ 자유게시판 저장 ============ */
  async function saveBoard(id) {
    const adminMemo = (document.getElementById('srnBoardMemo') || {}).value || '';
    const adminResponse = ((document.getElementById('srnBoardResponse') || {}).value || '').trim();
    const sendEmail = !!(document.getElementById('srnBoardSendEmail') || {}).checked;

    if (sendEmail && !adminResponse) {
      return toast('메일 발송 시 답변 내용을 입력해 주세요');
    }

    const btn = document.querySelector(`[data-srn-action="save-board"][data-srn-id="${id}"]`);
    if (btn) { btn.disabled = true; btn.textContent = '저장 중...'; }

    const res = await api('/api/admin/board-posts', {
      method: 'PATCH',
      body: { id, adminMemo, adminResponse: adminResponse || undefined, sendEmail },
    });

    if (btn) { btn.disabled = false; btn.textContent = '💾 저장하기'; }

    if (res.ok) {
      toast(res.data?.message || '저장되었습니다');
      if (adminResponse) {
        document.getElementById('sirenDetailModal')?.classList.remove('show');
      } else {
        /* 메모만 변경된 경우엔 모달 유지하고 다시 열기 */
        openDetail('board', id);
      }
      loadList('board');
    } else {
      toast(res.data?.error || '저장 실패');
    }
  }

  async function toggleHidden(id, hideValue) {
    const msg = hideValue ? '이 게시글을 숨김 처리하시겠습니까?' : '숨김을 해제하시겠습니까?';
    if (!confirm(msg)) return;

    const res = await api('/api/admin/board-posts', {
      method: 'PATCH',
      body: { id, isHidden: hideValue },
    });
    if (res.ok) {
      toast(res.data?.message || '처리되었습니다');
      document.getElementById('sirenDetailModal')?.classList.remove('show');
      loadList('board');
    } else {
      toast(res.data?.error || '처리 실패');
    }
  }

  async function togglePinned(id, pinValue) {
    const res = await api('/api/admin/board-posts', {
      method: 'PATCH',
      body: { id, isPinned: pinValue },
    });
    if (res.ok) {
      toast(pinValue ? '상단 고정되었습니다' : '고정 해제되었습니다');
      openDetail('board', id);
      loadList('board');
    } else {
      toast(res.data?.error || '처리 실패');
    }
  }

  async function deleteComment(commentId) {
    if (!confirm('이 댓글을 삭제하시겠습니까?\n관리자 권한으로 영구 삭제됩니다.')) return;
    const res = await api('/api/admin/board-posts?action=comment&commentId=' + commentId, { method: 'DELETE' });
    if (res.ok) {
      toast('댓글이 삭제되었습니다');
      if (_currentDetailKind === 'board' && _currentDetailId) {
        openDetail('board', _currentDetailId);
      }
    } else {
      toast(res.data?.error || '삭제 실패');
    }
  }

  /* ============ 글로벌 이벤트 위임 ============ */
  function setupGlobalEvents() {
    /* 필터 변경 (select / checkbox) */
    document.addEventListener('change', (e) => {
      const el = e.target.closest('[data-srn-filter][data-srn-kind]');
      if (!el) return;
      const kind = el.dataset.srnKind;
      const key = el.dataset.srnFilter;
      if (!_filters[kind]) _filters[kind] = {};
      if (el.type === 'checkbox') {
        _filters[kind][key] = el.checked ? '1' : '';
      } else {
        _filters[kind][key] = el.value;
      }
      loadList(kind);
    });

    /* 검색 디바운스 */
    document.addEventListener('input', (e) => {
      const el = e.target.closest('[data-srn-filter="q"][data-srn-kind]');
      if (!el) return;
      const kind = el.dataset.srnKind;
      if (!_filters[kind]) _filters[kind] = {};
      _filters[kind].q = el.value || '';
      clearTimeout(_searchTimer[kind]);
      _searchTimer[kind] = setTimeout(() => loadList(kind), 400);
    });

    /* 액션 버튼 */
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-srn-action]');
      if (!btn) return;

      const action = btn.dataset.srnAction;

      if (action === 'detail') {
        e.preventDefault();
        const kind = btn.dataset.srnKind;
        const id = Number(btn.dataset.srnId);
        if (kind && id) openDetail(kind, id);
        return;
      }

      if (action === 'quick-hide') {
        e.preventDefault();
        const id = Number(btn.dataset.srnId);
        if (id) quickToggleHidden(id, true);
        return;
      }
      if (action === 'quick-unhide') {
        e.preventDefault();
        const id = Number(btn.dataset.srnId);
        if (id) quickToggleHidden(id, false);
        return;
      }

      if (action === 'ai-draft') {
        e.preventDefault();
        const kind = btn.dataset.srnKind;
        const id = Number(btn.dataset.srnId);
        const targetId = btn.dataset.srnTarget || 'srnResponse';
        if (kind && id) generateAiDraft(kind, id, targetId);
        return;
      }

      if (action === 'save-response') {
        e.preventDefault();
        const kind = btn.dataset.srnKind;
        const id = Number(btn.dataset.srnId);
        if (kind && id) saveResponse(kind, id);
        return;
      }

      if (action === 'save-board') {
        e.preventDefault();
        const id = Number(btn.dataset.srnId);
        if (id) saveBoard(id);
        return;
      }

      if (action === 'toggle-hidden') {
        e.preventDefault();
        const id = Number(btn.dataset.srnId);
        const hide = btn.dataset.srnHide === 'true';
        if (id) toggleHidden(id, hide);
        return;
      }

      if (action === 'toggle-pinned') {
        e.preventDefault();
        const id = Number(btn.dataset.srnId);
        const pin = btn.dataset.srnPin === 'true';
        if (id) togglePinned(id, pin);
        return;
      }

      if (action === 'delete-comment') {
        e.preventDefault();
        const cid = Number(btn.dataset.cmtId);
        if (cid) deleteComment(cid);
        return;
      }
    });
  }

  /* ============ 외부 노출 ============ */
  window.SIREN_ADMIN_SIREN = {
    loadList,
    openDetail,
    refreshAll: function () {
      ['incident', 'harassment', 'legal', 'board'].forEach((k) => loadList(k));
    },
    refreshBadgesOnly: async function () {
      /* 페이지 진입 안 했어도 사이드바 뱃지만 가볍게 갱신 */
      for (const kind of ['incident', 'harassment', 'legal', 'board']) {
        try {
          const cfg = KIND_CONFIG[kind];
          const res = await api(cfg.listApi + '?limit=1&page=1');
          if (res.ok && res.data?.data?.stats) {
            updateSidebarBadge(kind, res.data.data.stats);
          }
        } catch (_) {}
      }
    },
  };

  /* ============ 초기화 ============ */
  function init() {
    setupGlobalEvents();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();