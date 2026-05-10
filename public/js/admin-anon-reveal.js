/* =========================================================
   SIREN — admin-anon-reveal.js (★ Phase 12 익명 신원 식별)
   - 익명 신고의 신원을 단계적으로 식별 + 감사 로그 자동 기록
   ========================================================= */
(function () {
  'use strict';

  const PAGE_SIZE = 20;
  let _page = 1;
  let _selectedReport = null;
  let _selectedLevel = 0;

  const TYPE_LABEL = {
    incident: '사건 제보', harassment: '악성민원', legal: '법률지원',
  };
  const TYPE_BADGE = {
    incident: 'badge-incident', harassment: 'badge-harassment', legal: 'badge-legal',
  };
  const STATUS_LABEL = {
    submitted: '접수', ai_analyzed: 'AI분석', reviewing: '검토중',
    matching: '배정중', matched: '배정완료', in_progress: '처리중',
    responded: '답변완료', completed: '완료', closed: '종결', rejected: '반려',
  };

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

  async function api({ method = 'GET', url, body }) {
    const opts = { method, credentials: 'include', headers: {} };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch(url, opts);
    let data;
    try { data = await res.json(); } catch (_) { data = {}; }
    return { ok: res.ok && (data.ok !== false), status: res.status, data };
  }

  /* ── 목록 로드 ── */
  window.loadList = async function (page) {
    _page = page || _page;
    const tbody = document.getElementById('listBody');
    tbody.innerHTML = '<tr><td colspan="7" class="empty-msg">조회 중...</td></tr>';

    const params = new URLSearchParams({
      page: _page, limit: PAGE_SIZE, onlyAnonymous: '1',
    });
    const type = document.getElementById('filterType').value;
    const level = document.getElementById('filterLevel').value;
    const keyword = document.getElementById('filterKeyword').value.trim();
    if (type) params.set('type', type);
    if (level !== '') params.set('anonLevel', level);
    if (keyword) params.set('q', keyword);

    const res = await api({ url: '/api/admin-report-list-by-status?' + params });
    if (!res.ok) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-msg">⚠️ ${escapeHtml(res.data?.error || '조회 실패')}</td></tr>`;
      return;
    }

    let allRows = res.data?.items || res.data?.data?.items || res.data?.rows || res.data?.data?.rows || [];
    // 익명 신고만 필터링 (onlyAnonymous=1)
    const onlyAnon = params.get('onlyAnonymous') === '1';
    const anonLevelParam = params.get('anonLevel');
    if (onlyAnon) allRows = allRows.filter((r) => r.isAnonymous);
    // anonLevel은 현재 DB에 미존재 — 필터 스킵 (UI는 항상 0단계 표시)
    const rows = allRows;
    const total = rows.length;
    const totalPages = Math.ceil(total / PAGE_SIZE) || 1;

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-msg">익명 신고가 없습니다</td></tr>';
      renderPagination(1, 1);
      return;
    }

    tbody.innerHTML = rows.map((r) => {
      const typeBadge = `<span class="badge ${escapeHtml(TYPE_BADGE[r.reportType] || '')}">${escapeHtml(TYPE_LABEL[r.reportType] || r.reportType)}</span>`;
      const levelBadge = `<span class="badge badge-anon-${r.anonLevel || 0}">${r.anonLevel || 0}단계</span>`;
      const statusLabel = STATUS_LABEL[r.status] || r.status;
      return `
        <tr>
          <td>${escapeHtml(String(r.id))}</td>
          <td>${typeBadge}</td>
          <td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(r.title || '(제목 없음)')}</td>
          <td>${fmtDate(r.createdAt)}</td>
          <td>${escapeHtml(statusLabel)}</td>
          <td>${levelBadge}</td>
          <td>
            <button class="btn btn-sm" onclick="openReveal(${r.id}, '${escapeHtml(r.reportType)}', '${escapeHtml(r.title || '')}', ${r.anonLevel || 0})">
              🔍 신원 식별
            </button>
          </td>
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
        if (Number.isFinite(p)) loadList(p);
      });
    });
  }

  /* ── 신원 식별 모달 열기 ── */
  window.openReveal = function (id, type, title, currentLevel) {
    _selectedReport = { id, type, title, currentLevel };
    _selectedLevel = 0;
    document.getElementById('revealReason').value = '';
    document.getElementById('identityResult').style.display = 'none';
    document.getElementById('identityResult').innerHTML = '';

    /* 이미 최고 수준이면 경고 */
    const warn = document.getElementById('revealWarning');
    const warnText = document.getElementById('revealWarningText');
    if (currentLevel >= 2) {
      warn.style.display = 'flex';
      warnText.textContent = '이미 2단계(전체 공개) 상태입니다. 추가 식별이 기록됩니다.';
    } else {
      warn.style.display = 'none';
    }

    /* 레벨 버튼 초기화 */
    document.querySelectorAll('.reveal-level-btn').forEach((b) => b.classList.remove('selected'));
    document.getElementById('revealModal').classList.add('show');
  };

  window.closeModal = function () {
    document.getElementById('revealModal').classList.remove('show');
    _selectedReport = null;
    _selectedLevel = 0;
  };

  window.selectLevel = function (level, btn) {
    _selectedLevel = level;
    document.querySelectorAll('.reveal-level-btn').forEach((b) => b.classList.remove('selected'));
    btn.classList.add('selected');
    /* 이전 결과 숨기기 */
    document.getElementById('identityResult').style.display = 'none';
  };

  /* ── 신원 확인 실행 ── */
  window.doReveal = async function () {
    if (!_selectedReport) return;
    if (_selectedLevel < 1) {
      window.SIREN && window.SIREN.toast('공개 수준을 선택하세요');
      return;
    }
    const reason = (document.getElementById('revealReason').value || '').trim();
    if (!reason) {
      window.SIREN && window.SIREN.toast('사유를 입력하세요 (감사 로그에 기록)');
      return;
    }

    const btn = document.getElementById('btnReveal');
    btn.disabled = true;
    btn.textContent = '처리 중...';

    try {
      const res = await api({
        method: 'POST',
        url: '/api/admin-anonymous-reveal',
        body: {
          reportId: _selectedReport.id,
          reportType: _selectedReport.type,
          revealLevel: _selectedLevel,
          reason,
        },
      });

      if (!res.ok) {
        window.SIREN && window.SIREN.toast(res.data?.error || '처리 실패');
        return;
      }

      const identity = res.data?.reporter || res.data?.data?.reporter || res.data?.identity || {};
      renderIdentityResult(identity);
      window.SIREN && window.SIREN.toast('신원이 확인되었습니다. 감사 로그에 기록됩니다.');
    } catch (e) {
      console.error('[anon-reveal]', e);
      window.SIREN && window.SIREN.toast('네트워크 오류');
    } finally {
      btn.disabled = false;
      btn.textContent = '🔓 신원 확인';
    }
  };

  function renderIdentityResult(identity) {
    const el = document.getElementById('identityResult');

    const rows = [];
    if (identity.name) rows.push({ field: '이름', value: identity.name });
    if (identity.email) rows.push({ field: '이메일', value: identity.email });
    if (_selectedLevel >= 2) {
      if (identity.phone) rows.push({ field: '전화번호', value: identity.phone });
      if (identity.address) rows.push({ field: '주소', value: identity.address });
      if (identity.joinedAt) rows.push({ field: '가입일', value: fmtDate(identity.joinedAt) });
      if (identity.memberNo) rows.push({ field: '회원번호', value: identity.memberNo });
    }

    if (!rows.length) {
      el.innerHTML = '<div style="color:#64748b;font-size:13px;margin-top:12px">조회된 신원 정보가 없습니다</div>';
      el.style.display = '';
      return;
    }

    el.innerHTML = `
      <div class="identity-result">
        <div class="identity-label">🔓 ${_selectedLevel}단계 신원 정보 (감사 로그 기록됨)</div>
        ${rows.map((r) => `
          <div class="identity-row">
            <span class="field">${escapeHtml(r.field)}</span>
            <span class="value">${escapeHtml(r.value)}</span>
          </div>
        `).join('')}
      </div>
    `;
    el.style.display = '';

    /* 목록 새로고침 (레벨 반영) */
    loadList(_page);
  }

  /* ── 초기화 ── */
  function init() {
    loadList(1);

    /* Enter 검색 */
    document.getElementById('filterKeyword')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') loadList(1);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
