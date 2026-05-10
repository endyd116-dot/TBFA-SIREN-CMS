/* =========================================================
   SIREN — my-reports.js (★ Phase 12 신고 진행 공개)
   - 사용자가 본인 신고의 처리 단계를 타임라인으로 확인
   ========================================================= */
(function () {
  'use strict';

  const PAGE_SIZE = 10;
  let _activeTab = 'incident';
  let _page = 1;

  /* ── 상수 ── */
  const TAB_CONFIG = {
    incident:   { label: '사건 제보',   api: '/api/incidents-mine',   icon: '🔍', typeLabel: '사건 제보' },
    harassment: { label: '악성민원',    api: '/api/harassment-reports-mine', icon: '⚠️', typeLabel: '악성민원 신고' },
    legal:      { label: '법률지원',    api: '/api/legal-consultations-mine', icon: '⚖️', typeLabel: '법률 지원' },
  };

  const STATUS_LABEL = {
    submitted:   '접수 완료',
    ai_analyzed: 'AI 분석 완료',
    reviewing:   '검토 중',
    matching:    '담당자 배정 중',
    matched:     '담당자 배정 완료',
    in_progress: '처리 중',
    responded:   '답변 완료',
    completed:   '처리 완료',
    closed:      '종결',
    rejected:    '반려',
  };

  /* 신고 유형별 단계 흐름 */
  const STAGE_FLOW = {
    incident: ['submitted', 'ai_analyzed', 'reviewing', 'in_progress', 'completed', 'closed'],
    harassment: ['submitted', 'ai_analyzed', 'reviewing', 'responding', 'responded', 'closed'],
    legal: ['submitted', 'ai_analyzed', 'reviewing', 'matching', 'matched', 'in_progress', 'completed', 'closed'],
  };

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '.' +
      String(d.getMonth() + 1).padStart(2, '0') + '.' +
      String(d.getDate()).padStart(2, '0') + ' ' +
      String(d.getHours()).padStart(2, '0') + ':' +
      String(d.getMinutes()).padStart(2, '0');
  }

  function statusBadge(status) {
    const cls = 'status-' + (status || 'submitted');
    const label = STATUS_LABEL[status] || status;
    return `<span class="report-status-badge ${escapeHtml(cls)}">${escapeHtml(label)}</span>`;
  }

  /* ── 타임라인 HTML 생성 ── */
  function buildTimeline(report, tabKey) {
    const flow = STAGE_FLOW[tabKey] || STAGE_FLOW.incident;
    const current = report.status || 'submitted';
    const curIdx = flow.indexOf(current);
    const isTerminal = current === 'closed' || current === 'rejected';

    let html = '<div class="timeline">';
    flow.forEach((stage, i) => {
      const isPast = isTerminal ? i <= flow.indexOf('closed') : i < curIdx;
      const isActive = stage === current;
      const isFuture = !isPast && !isActive;

      let dotClass = isFuture ? '' : (isActive ? 'active' : 'completed');
      let labelClass = isFuture ? 'dimmed' : '';
      const label = STATUS_LABEL[stage] || stage;

      /* 해당 단계의 일시 */
      let dateStr = '';
      if (!isFuture && report.statusHistory) {
        const entry = report.statusHistory.find((h) => h.status === stage);
        if (entry) dateStr = fmtDate(entry.changedAt);
      } else if (isActive) {
        dateStr = fmtDate(report.updatedAt || report.createdAt);
      }

      html += `
        <div class="tl-item">
          <div class="tl-dot ${escapeHtml(dotClass)}"></div>
          <div class="tl-label ${escapeHtml(labelClass)}">${escapeHtml(label)}</div>
          ${dateStr ? `<div class="tl-date">${escapeHtml(dateStr)}</div>` : ''}
        </div>
      `;
    });

    if (current === 'rejected') {
      html += `
        <div class="tl-item">
          <div class="tl-dot active" style="background:#ef4444;box-shadow:0 0 0 2px #ef4444"></div>
          <div class="tl-label">반려</div>
          ${report.rejectedReason ? `<div class="tl-desc">사유: ${escapeHtml(report.rejectedReason)}</div>` : ''}
        </div>
      `;
    }

    html += '</div>';
    return html;
  }

  /* ── 카드 HTML 생성 ── */
  function buildCard(report, tabKey) {
    const cfg = TAB_CONFIG[tabKey];
    const anonBadge = report.isAnonymous ? '<span class="anon-badge">익명</span>' : '';
    const title = report.title || report.subject || cfg.typeLabel;
    const cardId = 'card-tl-' + report.id;

    return `
      <div class="report-card">
        <div class="report-card-header">
          <div class="report-card-icon">${cfg.icon}</div>
          <div class="report-card-info">
            <div class="report-card-title">${escapeHtml(title)}${anonBadge}</div>
            <div class="report-card-meta">
              접수번호 ${escapeHtml(String(report.reportNo || report.id))} · 접수일 ${fmtDate(report.createdAt)}
            </div>
          </div>
          ${statusBadge(report.status)}
        </div>

        ${report.aiSummary ? `
          <div style="background:var(--bg-soft);border-radius:8px;padding:12px 14px;margin-bottom:12px;font-size:13px;color:var(--text-2);line-height:1.7">
            <strong style="color:var(--ink)">AI 분석 요약</strong><br>${escapeHtml(report.aiSummary)}
          </div>
        ` : ''}

        ${report.adminComment ? `
          <div style="background:#fffaf5;border:1px solid #f5dcc8;border-radius:8px;padding:12px 14px;margin-bottom:12px;font-size:13px;line-height:1.7">
            <strong style="color:var(--brand)">📝 담당자 답변</strong><br>${escapeHtml(report.adminComment)}
            ${report.adminCommentAt ? `<div style="font-size:11px;color:var(--text-3);margin-top:4px">${fmtDate(report.adminCommentAt)}</div>` : ''}
          </div>
        ` : ''}

        <div id="${escapeHtml(cardId)}" style="display:none">
          ${buildTimeline(report, tabKey)}
        </div>

        <button class="toggle-tl-btn" onclick="toggleTimeline('${escapeHtml(cardId)}', this)">
          ▶ 처리 단계 타임라인 보기
        </button>
      </div>
    `;
  }

  /* ── 타임라인 토글 ── */
  window.toggleTimeline = function (id, btn) {
    const el = document.getElementById(id);
    if (!el) return;
    const isOpen = el.style.display !== 'none';
    el.style.display = isOpen ? 'none' : '';
    btn.textContent = isOpen ? '▶ 처리 단계 타임라인 보기' : '▼ 타임라인 닫기';
  };

  /* ── 목록 로드 ── */
  async function loadList() {
    const cfg = TAB_CONFIG[_activeTab];
    const list = document.getElementById('reportsList');
    list.innerHTML = '<div class="report-empty"><div class="icon">⏳</div>불러오는 중...</div>';

    try {
      const params = new URLSearchParams({ page: _page, limit: PAGE_SIZE });
      const res = await fetch(cfg.api + '?' + params, { credentials: 'include' });
      const json = await res.json();

      if (!res.ok || !json.ok) {
        if (res.status === 401) {
          list.innerHTML = '<div class="report-empty"><div class="icon">🔒</div>로그인이 필요합니다</div>';
          return;
        }
        list.innerHTML = '<div class="report-empty"><div class="icon">⚠️</div>불러오지 못했습니다</div>';
        return;
      }

      const rows = json.data?.rows || json.data?.list || json.data || [];
      const total = json.data?.total || rows.length;
      const totalPages = Math.ceil(total / PAGE_SIZE) || 1;

      if (!rows.length) {
        const goUrl = _activeTab === 'incident' ? '/incidents.html'
          : _activeTab === 'harassment' ? '/report-harassment.html'
          : '/legal-support.html';
        list.innerHTML = `
          <div class="report-empty">
            <div class="icon">${cfg.icon}</div>
            아직 접수된 ${escapeHtml(cfg.typeLabel)}이 없습니다
            <br><a href="${goUrl}">${escapeHtml(cfg.typeLabel)} 신청하러 가기</a>
          </div>`;
        document.getElementById('reportsPagination').style.display = 'none';
        return;
      }

      list.innerHTML = rows.map((r) => buildCard(r, _activeTab)).join('');
      renderPagination(totalPages);
    } catch (e) {
      console.error('[my-reports]', e);
      list.innerHTML = '<div class="report-empty"><div class="icon">⚠️</div>네트워크 오류</div>';
    }
  }

  /* ── 페이지네이션 ── */
  function renderPagination(totalPages) {
    const box = document.getElementById('reportsPagination');
    if (totalPages <= 1) { box.style.display = 'none'; return; }
    box.style.display = 'flex';

    const maxBtns = 5;
    let start = Math.max(1, _page - 2);
    let end = Math.min(totalPages, start + maxBtns - 1);
    if (end - start < maxBtns - 1) start = Math.max(1, end - maxBtns + 1);

    let html = `<button data-p="1" ${_page === 1 ? 'disabled' : ''}>«</button>`;
    html += `<button data-p="${_page - 1}" ${_page <= 1 ? 'disabled' : ''}>‹</button>`;
    for (let i = start; i <= end; i++) {
      html += `<button data-p="${i}" class="${i === _page ? 'active' : ''}">${i}</button>`;
    }
    html += `<button data-p="${_page + 1}" ${_page >= totalPages ? 'disabled' : ''}>›</button>`;
    html += `<button data-p="${totalPages}" ${_page >= totalPages ? 'disabled' : ''}>»</button>`;
    box.innerHTML = html;

    box.querySelectorAll('button[data-p]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        const p = Number(btn.dataset.p);
        if (Number.isFinite(p)) { _page = p; loadList(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
      });
    });
  }

  /* ── 초기화 ── */
  function init() {
    if (document.body.dataset.page !== 'my-reports') return;

    /* 로그인 확인 */
    setTimeout(() => {
      const auth = window.SIREN_AUTH;
      if (!auth || !auth.isLoggedIn()) {
        window.SIREN.toast('로그인이 필요합니다');
        setTimeout(() => location.href = '/index.html', 1000);
      }
    }, 1200);

    document.querySelectorAll('.report-tab').forEach((t) => {
      t.addEventListener('click', () => {
        document.querySelectorAll('.report-tab').forEach((x) => x.classList.remove('active'));
        t.classList.add('active');
        _activeTab = t.dataset.tab;
        _page = 1;
        loadList();
      });
    });

    loadList();
  }

  const prevInit = window.SIREN_PAGE_INIT;
  window.SIREN_PAGE_INIT = function () {
    if (typeof prevInit === 'function') prevInit();
    init();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
