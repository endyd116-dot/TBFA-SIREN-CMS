/* =========================================================
   SIREN — admin-anon-audit.js (★ Phase 12 익명 보호 감사 로그)
   - 어드민이 익명 신원을 식별한 모든 기록 조회 + 통계 + CSV
   ========================================================= */
(function () {
  'use strict';

  const PAGE_SIZE = 25;
  let _page = 1;
  let _rows = [];

  const TYPE_LABEL = {
    incident: '사건 제보', harassment: '악성민원', legal: '법률지원',
  };
  const TYPE_BADGE = {
    incident: 'badge-incident', harassment: 'badge-harassment', legal: 'badge-legal',
  };

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

  async function api({ url }) {
    const res = await fetch(url, { credentials: 'include' });
    let data;
    try { data = await res.json(); } catch (_) { data = {}; }
    return { ok: res.ok && data.ok !== false, status: res.status, data };
  }

  /* ── 감사 로그 로드 ── */
  window.loadAuditLog = async function (page) {
    _page = page || _page;
    const tbody = document.getElementById('auditBody');
    tbody.innerHTML = '<tr><td colspan="7" class="empty-msg">조회 중...</td></tr>';

    const params = new URLSearchParams({ page: _page, limit: PAGE_SIZE });
    const adminQ = document.getElementById('filterAdmin').value.trim();
    const level  = document.getElementById('filterLevel').value;
    const type   = document.getElementById('filterType').value;
    const from   = document.getElementById('filterDateFrom').value;
    const to     = document.getElementById('filterDateTo').value;
    if (adminQ) params.set('adminName', adminQ);
    if (level)  params.set('level', level);
    if (type)   params.set('reportType', type);
    if (from)   params.set('dateFrom', from);
    if (to)     params.set('dateTo', to);

    const res = await api({ url: '/api/admin-anonymous-reveal-logs?' + params });
    if (!res.ok) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-msg">${escapeHtml(res.data?.error || '조회 실패')}</td></tr>`;
      return;
    }

    const rows = res.data?.items || res.data?.data?.items || res.data?.rows || res.data?.data?.rows || [];
    const total = res.data?.total || res.data?.data?.total || rows.length;
    const stats = res.data?.stats || res.data?.data?.stats || {};
    const totalPages = Math.ceil(total / PAGE_SIZE) || 1;

    _rows = rows;

    /* KPI 갱신 */
    document.getElementById('kpiTotal').textContent = (stats.totalCount || total || 0).toLocaleString();
    document.getElementById('kpiToday').textContent = (stats.todayCount || 0).toLocaleString();
    document.getElementById('kpiLevel2').textContent = (stats.level2Count || 0).toLocaleString();
    document.getElementById('kpiMonth').textContent = (stats.monthCount || 0).toLocaleString();

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-msg">조회 기록이 없습니다</td></tr>';
      renderPagination(1, 1);
      return;
    }

    tbody.innerHTML = rows.map((r) => {
      const typeBadge = `<span class="badge ${escapeHtml(TYPE_BADGE[r.reportType] || '')}">${escapeHtml(TYPE_LABEL[r.reportType] || r.reportType)}</span>`;
      const lvl = r.revealLevel || r.level || 1;
      const adminName = r.revealedByName || r.adminName || '—';
      const levelBadge = `<span class="badge badge-level-${lvl}">${lvl}단계</span>`;
      return `
        <tr>
          <td>${escapeHtml(String(r.id))}</td>
          <td class="admin-name">${escapeHtml(adminName)}</td>
          <td>${typeBadge}</td>
          <td class="report-title" title="${escapeHtml(r.reportTitle || '')}">${escapeHtml(r.reportTitle || '(제목 없음)')}</td>
          <td>${levelBadge}</td>
          <td class="reason-cell" title="${escapeHtml(r.reason || '')}">${escapeHtml(r.reason || '—')}</td>
          <td>${fmtDateTime(r.createdAt)}</td>
        </tr>
      `;
    }).join('');

    renderPagination(_page, totalPages);
  };

  /* ── 페이지네이션 ── */
  function renderPagination(page, totalPages) {
    const box = document.getElementById('pagination');
    if (totalPages <= 1) { box.innerHTML = ''; return; }

    const maxBtns = 5;
    let start = Math.max(1, page - 2);
    let end = Math.min(totalPages, start + maxBtns - 1);
    if (end - start < maxBtns - 1) start = Math.max(1, end - maxBtns + 1);

    let html = `<button data-p="1" ${page === 1 ? 'disabled' : ''}>«</button>`;
    html += `<button data-p="${page - 1}" ${page <= 1 ? 'disabled' : ''}>‹</button>`;
    for (let i = start; i <= end; i++) {
      html += `<button data-p="${i}" class="${i === page ? 'active' : ''}">${i}</button>`;
    }
    html += `<button data-p="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>›</button>`;
    html += `<button data-p="${totalPages}" ${page >= totalPages ? 'disabled' : ''}>»</button>`;
    box.innerHTML = html;

    box.querySelectorAll('button[data-p]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        const p = Number(btn.dataset.p);
        if (Number.isFinite(p)) loadAuditLog(p);
      });
    });
  }

  /* ── CSV 내보내기 ── */
  window.exportCsv = function () {
    if (!_rows.length) {
      window.SIREN && window.SIREN.toast('내보낼 데이터가 없습니다');
      return;
    }
    const headers = ['로그ID', '담당자', '신고유형', '신고제목', '식별수준', '사유', '조회일시'];
    const csvRows = [headers.join(',')];
    _rows.forEach((r) => {
      const csvAdminName = r.revealedByName || r.adminName || '';
      const csvLevel = r.revealLevel || r.level || '';
      csvRows.push([
        r.id,
        '"' + csvAdminName.replace(/"/g, '""') + '"',
        TYPE_LABEL[r.reportType] || r.reportType,
        '"' + (r.reportTitle || '').replace(/"/g, '""') + '"',
        csvLevel + '단계',
        '"' + (r.reason || '').replace(/"/g, '""') + '"',
        fmtDateTime(r.createdAt),
      ].join(','));
    });

    const blob = new Blob(['﻿' + csvRows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '익명감사로그_' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  /* ── 초기화 ── */
  function init() {
    loadAuditLog(1);

    document.getElementById('filterAdmin')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') loadAuditLog(1);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
