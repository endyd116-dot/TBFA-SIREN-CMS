/* =========================================================
   SIREN — admin.js (v9 — H-2d-3 영수증 + I-3 블랙리스트 + I-4 컬럼 정렬)
   ========================================================= */
(function () {
  'use strict';

  /* ============ 상수 ============ */
  const PAGE_TITLES = {
  dashboard: '대시보드',
  members: '회원 관리',
  donations: '후원금 관리',
  support: '유가족 지원 관리',
  'siren-incidents': '🔍 사건 제보 관리',
  'siren-harassment': '⚠️ 악성민원 신고 관리',
  'siren-legal': '⚖️ 법률지원 상담 관리',
  'siren-board': '💬 자유게시판 관리',
  operators: '운영자 관리',
  chat: '문의 관리',    
  ai: 'AI 추천 센터',
  content: '콘텐츠 관리',
  'receipt-settings': '영수증 설정',
  hyosung: '효성 CMS+ 관리',  /* ★ L-8 추가 */
  audit: '감사 로그',
  settings: '시스템 설정',
  };

  const SUPPORT_CAT_LABEL = {
    counseling: '심리상담',
    legal: '법률자문',
    scholarship: '장학사업',
    other: '기타',
  };

  const SUPPORT_STATUS_LABEL = {
    submitted: '접수됨',
    reviewing: '검토 중',
    supplement: '보완 요청',
    matched: '매칭 완료',
    in_progress: '진행 중',
    completed: '완료',
    rejected: '반려',
  };

  const MEMBER_TYPE_LABEL = {
    regular: '정기 후원',
    family: '유가족',
    volunteer: '봉사자',
    admin: '관리자',
  };

  /* ★ I-3: 채팅 카테고리 라벨 (회원 모달의 채팅 메모 목록용) */
  const CHAT_CAT_LABEL = {
    support_donation: '💝 후원 문의',
    support_homepage: '🌐 홈페이지',
    support_signup: '📝 가입 절차',
    support_other: '💬 기타',
  };

  /* ★ I-4: 회원 정렬 — type 그룹 우선순위 (작은 값 먼저) */
  const MEMBER_TYPE_PRIORITY = {
    admin: 1,      // 관리자 먼저
    family: 2,     // 유가족
    regular: 3,    // 정기후원
    volunteer: 4,  // 봉사자
  };

  /* ★ I-4: 회원 정렬 — status 그룹 우선순위 */
  const MEMBER_STATUS_PRIORITY = {
    active: 1,      // 정상 먼저
    pending: 2,     // 승인대기
    suspended: 3,   // 정지(블랙)
    withdrawn: 4,   // 탈퇴
  };

  let CURRENT_ADMIN = null;
  let CURRENT_KPI = null;
  let _kpiPollTimer = null;

  /* ★ I-4: 회원 목록 캐시 + 정렬 상태 */
  let _currentMembers = [];
  let _currentMembersTotal = 0;
  let _memberSort = { field: null, dir: 'asc' };  // field: 'id'|'name'|'type'|'createdAt'|'lastLoginAt'|'status'|null

  /* ============ 헬퍼 ============ */
  function toast(msg, ms = 2400) {
    const t = document.getElementById('toast');
    if (!t) return alert(msg);
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(window._tt);
    window._tt = setTimeout(() => t.classList.remove('show'), ms);
  }

  async function api(path, options = {}) {
    const opts = {
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      credentials: 'include',
    };
    if (options.body) opts.body = JSON.stringify(options.body);
    try {
      const res = await fetch(path, opts);
      const data = await res.json().catch(() => ({}));
      return { status: res.status, ok: res.ok && data.ok !== false, data };
    } catch (e) {
      console.error('[Admin API]', path, e);
      return { status: 0, ok: false, data: { error: '네트워크 오류' } };
    }
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  function formatDate(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    return d.getFullYear() + '.' +
      String(d.getMonth() + 1).padStart(2, '0') + '.' +
      String(d.getDate()).padStart(2, '0');
  }

  function formatDateTime(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    return d.getFullYear() + '.' +
      String(d.getMonth() + 1).padStart(2, '0') + '.' +
      String(d.getDate()).padStart(2, '0') + ' ' +
      String(d.getHours()).padStart(2, '0') + ':' +
      String(d.getMinutes()).padStart(2, '0');
  }

  function formatShortDateTime(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    return String(d.getMonth() + 1).padStart(2, '0') + '/' +
      String(d.getDate()).padStart(2, '0') + ' ' +
      String(d.getHours()).padStart(2, '0') + ':' +
      String(d.getMinutes()).padStart(2, '0');
  }

  function fmtMoney(n) {
    return '₩ ' + (Number(n || 0) / 1_000_000).toFixed(1) + 'M';
  }

  function statusBadgeHtml(status) {
    const map = {
      submitted: '<span class="badge b-info">🆕 접수</span>',
      reviewing: '<span class="badge b-warn">검토중</span>',
      supplement: '<span class="badge b-danger">보완요청</span>',
      matched: '<span class="badge b-info">매칭완료</span>',
      in_progress: '<span class="badge b-warn">진행중</span>',
      completed: '<span class="badge b-success">완료</span>',
      rejected: '<span class="badge b-mute">반려</span>',
    };
    return map[status] || status;
  }

    function priorityMarkerHtml(priority, reason) {
    const safeReason = reason ? String(reason).replace(/"/g, '&quot;') : '';
    if (priority === 'urgent') {
      return '<span title="긴급: ' + safeReason + '" style="color:#c5293a;font-weight:700">🔴</span>';
    }
    if (priority === 'low') {
      return '<span title="낮음: ' + safeReason + '" style="color:#1a8b46">🟢</span>';
    }
    if (priority === 'normal') {
      return '<span title="보통: ' + safeReason + '" style="color:#c47a00">🟡</span>';
    }
    return '<span style="color:#bbb">⚪</span>';
  }
    function priorityCellLabel(priority, reason) {
    const safeReason = reason ? String(reason).replace(/"/g, '&quot;') : '';
    if (priority === 'urgent') {
      return '<span title="' + safeReason + '" style="display:inline-flex;align-items:center;gap:4px;background:#c5293a;color:#fff;font-size:11.5px;font-weight:700;padding:3px 8px;border-radius:11px">🔴 긴급</span>';
    }
    if (priority === 'low') {
      return '<span title="' + safeReason + '" style="display:inline-flex;align-items:center;gap:4px;background:#1a8b46;color:#fff;font-size:11.5px;font-weight:600;padding:3px 8px;border-radius:11px">🟢 낮음</span>';
    }
    if (priority === 'normal') {
      return '<span title="' + safeReason + '" style="display:inline-flex;align-items:center;gap:4px;background:#c47a00;color:#fff;font-size:11.5px;font-weight:600;padding:3px 8px;border-radius:11px">🟡 보통</span>';
    }
    return '<span style="color:#bbb;font-size:11.5px">⚪ —</span>';
  }
  /* ============ 신규 뱃지 ============ */
  function updateSupportBadge(count) {
    const badge = document.getElementById('supportNewBadge');
    if (!badge) return;
    const n = Number(count) || 0;
    if (n > 0) {
      badge.textContent = n > 99 ? '99+' : String(n);
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
  }

    function startKpiPolling() {
    if (_kpiPollTimer) clearInterval(_kpiPollTimer);
    _kpiPollTimer = setInterval(async () => {
      const ok = await fetchAdminMe();
      if (ok) {
        renderDashboardKPI();
        if (CURRENT_KPI) updateSupportBadge(CURRENT_KPI.pendingSupportCount);
      }
      /* ★ L-8: 효성 대기 건수 뱃지 갱신 (관리자 페이지 밖에 있어도 표시) */
      fetchHyosungPendingBadge().catch(() => {});
    }, 60000);
  }

  /* ★ L-8: 효성 대기 건수만 가볍게 조회 */
  async function fetchHyosungPendingBadge() {
    try {
      const res = await api('/api/admin/hyosung?status=pending&limit=1&page=1');
      if (res.ok && res.data?.data?.stats) {
        updateHyosungPendingBadge(res.data.data.stats.pending?.count || 0);
      }
    } catch (e) {}
  }

  function stopKpiPolling() {
    if (_kpiPollTimer) {
      clearInterval(_kpiPollTimer);
      _kpiPollTimer = null;
    }
  }

  /* ============ 화면 전환 ============ */
  function showLogin() {
    document.getElementById('adminLogin')?.classList.add('show');
    document.getElementById('adminWrap')?.classList.remove('show');
    stopKpiPolling();
  }

    async function showAdminPanel() {
    document.getElementById('adminLogin')?.classList.remove('show');
    document.getElementById('adminWrap')?.classList.add('show');
    renderDashboardKPI();
    if (CURRENT_KPI) updateSupportBadge(CURRENT_KPI.pendingSupportCount);
    await loadDashboardActivity();
    if (window.SIREN_CHARTS && typeof window.SIREN_CHARTS.initDashboardWithData === 'function') {
      setTimeout(() => window.SIREN_CHARTS.initDashboardWithData(), 150);
    }
    fetchHyosungPendingBadge().catch(() => {});  /* ★ L-8: 첫 로그인 시 뱃지 표시 */
    /* ★ M-10: 사이렌 관리 4개 사이드바 뱃지 갱신 */
    if (window.SIREN_ADMIN_SIREN && typeof window.SIREN_ADMIN_SIREN.refreshBadgesOnly === 'function') {
      window.SIREN_ADMIN_SIREN.refreshBadgesOnly().catch(() => {});
    }
    startKpiPolling();
  }

  /* ============ 대시보드 KPI ============ */
  function renderDashboardKPI() {
    if (!CURRENT_KPI) return;
    const dash = document.getElementById('adm-dashboard');
    if (!dash) return;
    const kpis = dash.querySelectorAll('.kpi-grid > .kpi .kpi-value');
    if (kpis.length < 4) return;
    kpis[0].textContent = fmtMoney(CURRENT_KPI.monthlyDonation);
    kpis[1].textContent = (CURRENT_KPI.newRegularCount || 0) + ' 명';
    kpis[2].textContent = (CURRENT_KPI.pendingSupportCount || 0) + ' 건';
    kpis[3].textContent = (CURRENT_KPI.totalMembers || 0).toLocaleString();

    const adminAvatar = document.querySelector('.adm-avatar');
    if (adminAvatar && CURRENT_ADMIN) {
      adminAvatar.textContent = (CURRENT_ADMIN.name || 'A').charAt(0);
    }
  }

  async function loadDashboardActivity() {
    const dash = document.getElementById('adm-dashboard');
    const panels = dash ? dash.querySelectorAll('.row-1-1 .panel') : [];
    const tbody = panels[1] ? panels[1].querySelector('table.tbl tbody') : null;
    if (!tbody) return;

    const res = await api('/api/admin/stats');
    if (!res.ok || !res.data?.data) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:30px;color:var(--text-3)">통계 조회 실패</td></tr>';
      return;
    }
    const recent = res.data.data.recentActivity || [];
    if (recent.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:30px;color:var(--text-3)">최근 활동 없음</td></tr>';
      return;
    }
    const typeMap = { regular: '정기후원', onetime: '일시후원' };
    const statusMap = {
      completed: '<span class="badge b-success">완료</span>',
      pending: '<span class="badge b-warn">대기</span>',
      failed: '<span class="badge b-danger">실패</span>',
    };
    tbody.innerHTML = recent.map((r) => {
      const t = new Date(r.createdAt);
      const hh = String(t.getHours()).padStart(2, '0');
      const mm = String(t.getMinutes()).padStart(2, '0');
      return '<tr>' +
        '<td>' + hh + ':' + mm + '</td>' +
        '<td>' + (typeMap[r.type] || r.type) + '</td>' +
        '<td>' + escapeHtml(r.donorName || '-') + ' (₩' + (r.amount || 0).toLocaleString() + ')</td>' +
        '<td>' + (statusMap[r.status] || r.status) + '</td>' +
        '</tr>';
    }).join('');
  }

  /* ============ ★ I-4 + K-7: 회원 관리 ============ */
  let _mmSearchTimer = null;

  async function loadMembers() {
    const panel = document.getElementById('adm-members');
    if (!panel) return;
    const tbody = panel.querySelector('table.tbl tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--text-3)">불러오는 중...</td></tr>';

    /* 필터 수집 */
    const params = new URLSearchParams();
    params.set('limit', '100');
    params.set('page', '1');
    const t = document.getElementById('mmFilterType')?.value || '';
    const s = document.getElementById('mmFilterStatus')?.value || '';
    const q = (document.getElementById('mmFilterQ')?.value || '').trim();
    if (t) params.set('type', t);
    if (s) params.set('status', s);
    if (q && q.length >= 2) params.set('q', q);

    const res = await api('/api/admin/members?' + params.toString());
    if (!res.ok || !res.data?.data) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--danger)">조회 실패</td></tr>';
      return;
    }
    _currentMembers = res.data.data.list || [];
    _currentMembersTotal = res.data.data.pagination ? res.data.data.pagination.total : 0;

    /* KPI */
    const kpis = panel.querySelectorAll('.kpi-value');
    if (kpis[0]) kpis[0].textContent = _currentMembersTotal.toLocaleString() + ' 명';
    if (kpis[1]) kpis[1].textContent = _currentMembers.filter((m) => m.type === 'family').length + ' 명';
    if (kpis[2]) kpis[2].textContent = _currentMembers.filter((m) => m.status === 'pending').length + ' 명';

    /* ★ K-7: 검색 결과 카운트 */
    const countEl = document.getElementById('mmCount');
    if (countEl) {
      if (q || t || s) {
        countEl.textContent = `필터: ${_currentMembers.length}건 / 전체 ${_currentMembersTotal.toLocaleString()}명`;
      } else {
        countEl.textContent = `전체 ${_currentMembersTotal.toLocaleString()}명`;
      }
    }

    decorateMemberHeaders();
    renderMemberTable();
  }

  /**
   * ★ I-4: 회원 정렬 비교 함수
   * @param list - 회원 배열
   * @param field - 'id'|'name'|'type'|'createdAt'|'lastLoginAt'|'status'|null
   * @param dir   - 'asc'|'desc'
   */
  function sortMembers(list, field, dir) {
    if (!field) return list.slice();
    const arr = list.slice();
    const mult = dir === 'desc' ? -1 : 1;

    arr.sort((a, b) => {
      let av, bv, primary;

      if (field === 'id') {
        av = Number(a.id) || 0;
        bv = Number(b.id) || 0;
        return (av - bv) * mult;
      }

      if (field === 'name') {
        av = String(a.name || '');
        bv = String(b.name || '');
        return av.localeCompare(bv, 'ko') * mult;
      }

      if (field === 'type') {
        av = MEMBER_TYPE_PRIORITY[a.type] || 99;
        bv = MEMBER_TYPE_PRIORITY[b.type] || 99;
        primary = (av - bv) * mult;
        if (primary !== 0) return primary;
        /* 같은 등급끼리는 이름순 보조 정렬 */
        return String(a.name || '').localeCompare(String(b.name || ''), 'ko');
      }

      if (field === 'status') {
        av = MEMBER_STATUS_PRIORITY[a.status] || 99;
        bv = MEMBER_STATUS_PRIORITY[b.status] || 99;
        primary = (av - bv) * mult;
        if (primary !== 0) return primary;
        /* 같은 상태끼리는 이름순 보조 정렬 */
        return String(a.name || '').localeCompare(String(b.name || ''), 'ko');
      }

      if (field === 'createdAt' || field === 'lastLoginAt') {
        av = a[field] ? new Date(a[field]).getTime() : 0;
        bv = b[field] ? new Date(b[field]).getTime() : 0;
        /* null/0 값은 항상 끝으로 보내기 (정렬 방향 무시) */
        if (!av && bv) return 1;
        if (av && !bv) return -1;
        if (!av && !bv) return 0;
        return (av - bv) * mult;
      }

      return 0;
    });

    return arr;
  }

  /**
   * ★ I-4: 회원 테이블 헤더에 정렬 가능 표시 (한 번만 호출)
   */
  function decorateMemberHeaders() {
    const panel = document.getElementById('adm-members');
    if (!panel) return;
    const ths = panel.querySelectorAll('table.tbl thead th');
    if (!ths || ths.length === 0) return;

    /* 컬럼 인덱스 매핑: 0=체크박스, 1=회원ID, 2=이름, 3=등급, 4=가입일, 5=최종활동, 6=상태, 7=관리 */
    const fields = [null, 'id', 'name', 'type', 'createdAt', 'lastLoginAt', 'status', null];
    const labels = ['', '회원ID', '이름', '등급', '가입일', '최종 활동', '상태', '관리'];

    ths.forEach((th, i) => {
      const f = fields[i];
      if (!f) {
        /* 정렬 불가 컬럼 — 원본 유지 */
        if (i === 0 && !th.querySelector('input')) {
          th.innerHTML = '<input type="checkbox">';
        }
        th.dataset.sortField = '';
        th.style.cursor = '';
        return;
      }
      th.dataset.sortField = f;
      th.style.cursor = 'pointer';
      th.style.userSelect = 'none';
      th.title = '클릭하여 정렬';

      let arrow = '⇅';
      let color = 'var(--text-3)';
      if (_memberSort.field === f) {
        arrow = _memberSort.dir === 'asc' ? '▲' : '▼';
        color = 'var(--brand)';
      }
      th.innerHTML = labels[i] + ' <span style="font-size:10px;color:' + color + ';margin-left:3px">' + arrow + '</span>';
    });
  }

  /**
   * ★ I-4: 헤더 화살표만 갱신 (라벨은 유지)
   */
  function updateSortArrows() {
    const panel = document.getElementById('adm-members');
    if (!panel) return;
    const ths = panel.querySelectorAll('table.tbl thead th[data-sort-field]');
    ths.forEach((th) => {
      const f = th.dataset.sortField;
      if (!f) return;
      let arrow = '⇅';
      let color = 'var(--text-3)';
      if (_memberSort.field === f) {
        arrow = _memberSort.dir === 'asc' ? '▲' : '▼';
        color = 'var(--brand)';
      }
      /* 기존 라벨 추출 (화살표/공백 제거) */
      const labelText = th.textContent.replace(/[⇅▲▼]/g, '').trim();
      th.innerHTML = labelText + ' <span style="font-size:10px;color:' + color + ';margin-left:3px">' + arrow + '</span>';
    });
  }

  /**
   * ★ I-4: 회원 테이블 본문 렌더 (정렬 적용)
   */
  function renderMemberTable() {
    const panel = document.getElementById('adm-members');
    if (!panel) return;
    const tbody = panel.querySelector('table.tbl tbody');
    if (!tbody) return;

    /* 화살표 갱신 */
    updateSortArrows();

    /* 정렬 */
    const list = sortMembers(_currentMembers, _memberSort.field, _memberSort.dir);

    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text-3)">회원이 없습니다</td></tr>';
      return;
    }

    const typeMap = {
      regular: '<span class="badge b-info">정기후원</span>',
      family: '<span class="badge b-danger">유가족</span>',
      volunteer: '<span class="badge b-success">봉사자</span>',
      admin: '<span class="badge b-warn">관리자</span>',
    };
    const statusMap = {
      active: '<span class="badge b-success">정상</span>',
      pending: '<span class="badge b-warn">승인대기</span>',
      suspended: '<span class="badge b-danger">정지</span>',
      withdrawn: '<span class="badge b-mute">탈퇴</span>',
    };

    tbody.innerHTML = list.map((m) => {
      let actionBtns = '';
      if (m.status === 'pending') {
        actionBtns += '<button class="btn-link" data-member-action="approve" data-id="' + m.id + '">승인</button>';
      }
      if (m.status === 'active' && m.type !== 'admin') {
        actionBtns += '<button class="btn-link" data-member-action="suspend" data-id="' + m.id + '" style="color:var(--danger)">정지</button>';
      }
      if (m.status === 'suspended') {
        actionBtns += '<button class="btn-link" data-member-action="approve" data-id="' + m.id + '">정상화</button>';
      }
      return '<tr>' +
        '<td><input type="checkbox"></td>' +
        '<td>M-' + String(m.id).padStart(5, '0') + '</td>' +
        '<td><span class="clickable-name" data-member-info-id="' + m.id + '">' + escapeHtml(m.name) + '</span></td>' +
        '<td>' + (typeMap[m.type] || m.type) + '</td>' +
        '<td>' + formatDate(m.createdAt) + '</td>' +
        '<td>' + formatDate(m.lastLoginAt) + '</td>' +
        '<td>' + (statusMap[m.status] || m.status) + '</td>' +
        '<td>' + actionBtns + '</td>' +
        '</tr>';
    }).join('');
  }

  /**
   * ★ I-4: 컬럼 헤더 클릭 → 정렬 전환 (이벤트 위임)
   */
  function setupMemberSort() {
    document.addEventListener('click', (e) => {
      const th = e.target.closest('#adm-members table.tbl thead th[data-sort-field]');
      if (!th) return;
      const field = th.dataset.sortField;
      if (!field) return;
      e.preventDefault();

      if (_memberSort.field === field) {
        /* 같은 필드 → 방향 토글 */
        _memberSort.dir = _memberSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        /* 다른 필드 → 새 필드 + 오름차순 시작 */
        _memberSort.field = field;
        _memberSort.dir = 'asc';
      }
      renderMemberTable();
    });
  }
  /* ★ K-7: 회원 관리 검색/필터 디바운스 */
  function setupMemberSearch() {
    const qInput = document.getElementById('mmFilterQ');
    if (qInput) {
      qInput.addEventListener('input', () => {
        clearTimeout(_mmSearchTimer);
        _mmSearchTimer = setTimeout(loadMembers, 400);
      });
    }
    ['mmFilterType', 'mmFilterStatus'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', loadMembers);
    });
  }

  function setupMemberActions() {
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-member-action]');
      if (!btn) return;
      e.preventDefault();
      const id = Number(btn.dataset.id);
      const action = btn.dataset.memberAction;
      const status = action === 'approve' ? 'active' : 'suspended';
      const label = action === 'approve' ? '승인' : '정지';
      if (!confirm('회원을 ' + label + '하시겠습니까?')) return;

      const res = await api('/api/admin/members', {
        method: 'PATCH',
        body: { id, status },
      });
      if (res.ok) {
        toast('회원이 ' + label + '되었습니다');
        loadMembers();
      } else {
        toast(res.data?.error || '처리 실패');
      }
    });
  }

  /* ============ ★ K-8: 기부 관리 (확장) ============ */
  let _dmSearchTimer = null;

  async function loadDonations() {
    const panel = document.getElementById('adm-donations');
    if (!panel) return;
    const tbody = panel.querySelector('table.tbl tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--text-3)">불러오는 중...</td></tr>';

    /* 필터 수집 */
    const params = new URLSearchParams();
    params.set('limit', '50');
    params.set('page', '1');
    const t = document.getElementById('dmFilterType')?.value || '';
    const s = document.getElementById('dmFilterStatus')?.value || '';
    const q = (document.getElementById('dmFilterQ')?.value || '').trim();
    if (t) params.set('type', t);
    if (s) params.set('status', s);
    if (q && q.length >= 2) params.set('q', q);

    const res = await api('/api/admin/donations?' + params.toString());
    if (!res.ok || !res.data?.data) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--danger)">조회 실패</td></tr>';
      return;
    }
    const list = res.data.data.list || [];
    const stats = res.data.data.stats || {};
    const pagination = res.data.data.pagination || {};

    /* KPI */
    const kpis = panel.querySelectorAll('.kpi-value');
    if (kpis[0]) kpis[0].textContent = fmtMoney(stats.today);
    if (kpis[1]) kpis[1].textContent = fmtMoney(stats.month);
    if (kpis[2]) kpis[2].textContent = (stats.failedCount || 0) + ' 건';
    if (kpis[3]) kpis[3].textContent = (stats.receiptPendingCount || 0) + ' 건';
    const refundedEl = document.getElementById('dmKpiRefunded');
    const cancelledEl = document.getElementById('dmKpiCancelled');
    if (refundedEl) refundedEl.textContent = (stats.refundedCount || 0) + ' 건';
    if (cancelledEl) cancelledEl.textContent = (stats.cancelledCount || 0) + ' 건';

    /* 카운트 표시 */
    const countEl = document.getElementById('dmCount');
    if (countEl) {
      const total = pagination.total || 0;
      if (q || t || s) {
        countEl.textContent = `필터: ${list.length}건 / 전체 ${total.toLocaleString()}건`;
      } else {
        countEl.textContent = `전체 ${total.toLocaleString()}건`;
      }
    }

    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text-3)">결제 내역이 없습니다</td></tr>';
      return;
    }

    const typeMap = { regular: '정기후원', onetime: '일시후원' };
    const payMap = { cms: 'CMS', card: '카드', bank: '계좌이체' };
    const statusMap = {
      completed: '<span class="badge b-success">승인</span>',
      pending: '<span class="badge b-warn">대기</span>',
      failed: '<span class="badge b-danger">실패</span>',
      cancelled: '<span class="badge b-mute">취소</span>',
      refunded: '<span class="badge b-mute">환불</span>',
    };

    tbody.innerHTML = list.map((d) => {
      const txn = d.transactionId ? d.transactionId.slice(-12) : '-';
      const anonMark = d.isAnonymous ? '<span class="dm-anonymous-mark">익명</span>' : '';
      const campaignMark = d.campaignTag ? '<span class="dm-campaign-tag">' + escapeHtml(d.campaignTag) + '</span>' : '';

      /* 액션 버튼 */
      const canRefund = d.status === 'completed';
      const canCancel = d.status === 'pending' || d.status === 'completed';
      const actions = '<div class="dm-row-actions">' +
        '<button type="button" class="detail" data-dm-action="detail" data-id="' + d.id + '">📝 상세</button>' +
        (canRefund ? '<button type="button" class="refund" data-dm-action="refund" data-id="' + d.id + '" data-name="' + escapeHtml(d.donorName || '') + '" data-amount="' + (d.amount || 0) + '">💸 환불</button>' : '') +
        (canCancel ? '<button type="button" class="cancel" data-dm-action="cancel" data-id="' + d.id + '" data-name="' + escapeHtml(d.donorName || '') + '" data-amount="' + (d.amount || 0) + '">❌ 취소</button>' : '') +
        '</div>';

      return '<tr>' +
        '<td>' + formatDateTime(d.createdAt) + '</td>' +
        '<td>' + escapeHtml(d.donorName) + anonMark + '</td>' +
        '<td>' + (typeMap[d.type] || d.type) + campaignMark + '</td>' +
        '<td>₩ ' + (d.amount || 0).toLocaleString() + '</td>' +
        '<td>' + (payMap[d.payMethod] || d.payMethod) + '</td>' +
        '<td style="font-family:Inter;font-size:11px">' + escapeHtml(txn) + '</td>' +
        '<td>' + (statusMap[d.status] || d.status) + '</td>' +
        '<td>' + actions + '</td>' +
        '</tr>';
    }).join('');
  }

  function setupDonationActions() {
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-demo-action="bulk-receipt"]');
      if (!btn) return;
      e.preventDefault();

      const res = await api('/api/admin/donations?limit=100&status=completed');
      const allList = res.data?.data?.list || [];
      const ids = allList.filter((d) => !d.receiptIssued).map((d) => d.id);

      if (ids.length === 0) return toast('발행할 영수증이 없습니다');

      const r = await api('/api/admin/donations', {
        method: 'PATCH',
        body: { ids },
      });
      if (r.ok) {
        toast(r.data?.message || ids.length + '건 발행 완료');
        loadDonations();
      } else {
        toast('발행 실패');
      }
    });
  }

  /* ★ K-8: 기부 관리 검색/필터 디바운스 */
  function setupDonationSearch() {
    const qInput = document.getElementById('dmFilterQ');
    if (qInput) {
      qInput.addEventListener('input', () => {
        clearTimeout(_dmSearchTimer);
        _dmSearchTimer = setTimeout(loadDonations, 400);
      });
    }
    ['dmFilterType', 'dmFilterStatus'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', loadDonations);
    });
  }

  /* ★ K-8: 행 액션 핸들러 (상세/환불/취소) */
  function setupDonationRowActions() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-dm-action]');
      if (!btn) return;
      e.preventDefault();

      const action = btn.dataset.dmAction;
      const id = Number(btn.dataset.id);
      if (!id) return;

      if (action === 'detail') {
        openDonationDetailModal(id);
        return;
      }
      if (action === 'refund') {
        openRefundModal(id, btn.dataset.name || '', Number(btn.dataset.amount) || 0);
        return;
      }
      if (action === 'cancel') {
        openCancelModal(id, btn.dataset.name || '', Number(btn.dataset.amount) || 0);
        return;
      }
    });
  }

  /* ★ K-8: 후원 상세 모달 */
  async function openDonationDetailModal(id) {
    const modal = document.getElementById('donationDetailModal');
    const body = document.getElementById('donationDetailBody');
    if (!modal || !body) return;

    body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-3)">로딩 중...</div>';
    modal.classList.add('show');

    const res = await api('/api/admin/donations?id=' + id);
    if (!res.ok || !res.data?.data?.donation) {
      body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--danger)">조회 실패</div>';
      return;
    }
    const d = res.data.data.donation;

    const typeMap = { regular: '정기 후원', onetime: '일시 후원' };
    const payMap = { cms: 'CMS 자동이체', card: '신용카드', bank: '계좌이체' };
    const statusKr = {
      completed: '승인 완료',
      pending: '결제 대기',
      failed: '실패',
      cancelled: '취소',
      refunded: '환불',
    };
    const statusClass = d.status;

    const statusCard = '<div class="dd-status-card ' + statusClass + '">' +
      '<div class="icon">' +
      (d.status === 'completed' ? '✅' :
       d.status === 'pending' ? '⏳' :
       d.status === 'refunded' ? '💸' :
       d.status === 'cancelled' ? '❌' : '⚠️') +
      '</div>' +
      '<div class="text">' +
        '<strong>' + (statusKr[d.status] || d.status) + '</strong>' +
        '₩ ' + (d.amount || 0).toLocaleString() + ' · ' + (typeMap[d.type] || d.type) +
      '</div>' +
      '</div>';

    const safeMemo = String(d.memo || '').replace(/"/g, '&quot;');
    const safeCampaign = String(d.campaignTag || '').replace(/"/g, '&quot;');

    body.innerHTML =
      statusCard +

      '<div class="dd-grid">' +
        '<div>후원 ID</div><div style="font-family:Inter;font-weight:600">D-' + String(d.id).padStart(7, '0') + '</div>' +
        '<div>후원자</div><div><strong>' + escapeHtml(d.donorName) + '</strong>' + (d.isAnonymous ? ' <span class="dm-anonymous-mark">익명</span>' : '') + '</div>' +
        (d.donorEmail ? '<div>이메일</div><div>' + escapeHtml(d.donorEmail) + '</div>' : '') +
        (d.donorPhone ? '<div>연락처</div><div>' + escapeHtml(d.donorPhone) + '</div>' : '') +
        '<div>금액</div><div style="font-weight:700">₩ ' + (d.amount || 0).toLocaleString() + '</div>' +
        '<div>유형</div><div>' + (typeMap[d.type] || d.type) + '</div>' +
        '<div>결제수단</div><div>' + (payMap[d.payMethod] || d.payMethod) + '</div>' +
        '<div>승인번호</div><div style="font-family:Inter;font-size:11.5px">' + escapeHtml(d.transactionId || '—') + '</div>' +
        (d.receiptNumber ? '<div>영수증번호</div><div style="font-family:Inter;font-size:11.5px">' + escapeHtml(d.receiptNumber) + '</div>' : '') +
        '<div>결제일시</div><div>' + formatDateTime(d.createdAt) + '</div>' +
      '</div>' +

      /* 캠페인 태그 */
      '<div class="dd-section">' +
        '<h5>🏷️ 캠페인 태그</h5>' +
        '<div class="field-row">' +
          '<input type="text" id="ddCampaignInput" maxlength="50" value="' + safeCampaign + '" placeholder="예) 2026-spring-memorial">' +
          '<button type="button" class="small-btn" data-dd-action="save-campaign" data-id="' + d.id + '">💾 저장</button>' +
        '</div>' +
      '</div>' +

      /* 익명 토글 */
      '<div class="dd-section">' +
        '<h5>🎭 익명 후원 표시</h5>' +
        '<label style="display:inline-flex;align-items:center;gap:8px;cursor:pointer;font-size:12.5px">' +
          '<input type="checkbox" id="ddAnonymousToggle" ' + (d.isAnonymous ? 'checked' : '') + ' data-id="' + d.id + '">' +
          '<span>관리자 외 다른 사용자에게 후원자 정보 노출 안 함 (현재: ' + (d.isAnonymous ? '익명' : '공개') + ')</span>' +
        '</label>' +
      '</div>' +

      /* 메모 */
      '<div class="dd-section">' +
        '<h5>📝 관리자 메모</h5>' +
        '<textarea id="ddMemoInput" maxlength="2000" placeholder="이 후원에 대한 메모...">' + safeMemo + '</textarea>' +
        '<div class="field-row" style="margin-top:8px">' +
          '<button type="button" class="small-btn" data-dd-action="save-memo" data-id="' + d.id + '">💾 메모 저장</button>' +
        '</div>' +
      '</div>';
  }

  /* ★ K-8: 환불 모달 */
  function openRefundModal(id, donorName, amount) {
    const modal = document.getElementById('refundReasonModal');
    if (!modal) return;

    document.getElementById('rcRefundId').value = String(id);
    document.getElementById('rcRefundReason').value = '';

    const infoEl = document.getElementById('rcRefundInfo');
    if (infoEl) {
      infoEl.innerHTML =
        '<div>후원 ID</div><div style="font-family:Inter;font-weight:600">D-' + String(id).padStart(7, '0') + '</div>' +
        '<div>후원자</div><div><strong>' + escapeHtml(donorName) + '</strong></div>' +
        '<div>금액</div><div style="font-weight:700;color:#c47a00">₩ ' + amount.toLocaleString() + '</div>';
    }

    modal.classList.add('show');
    setTimeout(() => document.getElementById('rcRefundReason')?.focus(), 100);
  }

  /* ★ K-8: 취소 모달 */
  function openCancelModal(id, donorName, amount) {
    const modal = document.getElementById('cancelReasonModal');
    if (!modal) return;

    document.getElementById('rcCancelId').value = String(id);
    document.getElementById('rcCancelReason').value = '';

    const infoEl = document.getElementById('rcCancelInfo');
    if (infoEl) {
      infoEl.innerHTML =
        '<div>후원 ID</div><div style="font-family:Inter;font-weight:600">D-' + String(id).padStart(7, '0') + '</div>' +
        '<div>후원자</div><div><strong>' + escapeHtml(donorName) + '</strong></div>' +
        '<div>금액</div><div style="font-weight:700;color:var(--danger)">₩ ' + amount.toLocaleString() + '</div>';
    }

    modal.classList.add('show');
    setTimeout(() => document.getElementById('rcCancelReason')?.focus(), 100);
  }

  /* ★ K-8: 환불/취소 폼 + 상세 모달 액션 */
  function setupDonationDetailActions() {
    /* 환불 폼 제출 */
    const refundForm = document.getElementById('refundForm');
    if (refundForm) {
      refundForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = Number(document.getElementById('rcRefundId').value);
        const reason = (document.getElementById('rcRefundReason').value || '').trim();
        if (!id) return;

        const finalConfirm = confirm(
          '정말 환불 처리하시겠습니까?\n\n' +
          '• 시스템 상태가 refunded로 변경됩니다\n' +
          '• 실제 PG사 환불은 별도 진행해야 합니다\n' +
          '• 되돌릴 수 없습니다'
        );
        if (!finalConfirm) return;

        const btn = document.getElementById('btnRefundConfirm');
        const oldText = btn ? btn.textContent : '';
        if (btn) { btn.disabled = true; btn.textContent = '처리 중...'; }

        try {
          const res = await api('/api/admin/donations', {
            method: 'PATCH',
            body: { id, refundOne: true, reason: reason || undefined },
          });

          if (res.ok) {
            toast(res.data?.message || '환불 처리되었습니다');
            document.getElementById('refundReasonModal')?.classList.remove('show');
            loadDonations();
          } else {
            toast(res.data?.error || '환불 실패');
          }
        } finally {
          if (btn) { btn.disabled = false; btn.textContent = oldText; }
        }
      });
    }

    /* 취소 폼 제출 */
    const cancelForm = document.getElementById('cancelForm');
    if (cancelForm) {
      cancelForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = Number(document.getElementById('rcCancelId').value);
        const reason = (document.getElementById('rcCancelReason').value || '').trim();
        if (!id) return;

        const finalConfirm = confirm(
          '정말 취소 처리하시겠습니까?\n\n' +
          '• 결제가 무효 처리됩니다\n' +
          '• 정기 후원은 다음 결제부터 자동 청구가 중단됩니다\n' +
          '• 한 번 취소되면 되돌릴 수 없습니다'
        );
        if (!finalConfirm) return;

        const btn = document.getElementById('btnCancelConfirm');
        const oldText = btn ? btn.textContent : '';
        if (btn) { btn.disabled = true; btn.textContent = '처리 중...'; }

        try {
          const res = await api('/api/admin/donations', {
            method: 'PATCH',
            body: { id, cancelOne: true, reason: reason || undefined },
          });

          if (res.ok) {
            toast(res.data?.message || '취소 처리되었습니다');
            document.getElementById('cancelReasonModal')?.classList.remove('show');
            loadDonations();
          } else {
            toast(res.data?.error || '취소 실패');
          }
        } finally {
          if (btn) { btn.disabled = false; btn.textContent = oldText; }
        }
      });
    }

    /* 상세 모달 내 액션 (메모/캠페인 저장 + 익명 토글) */
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-dd-action]');
      if (!btn) return;
      e.preventDefault();
      const action = btn.dataset.ddAction;
      const id = Number(btn.dataset.id);
      if (!id) return;

      if (action === 'save-memo') {
        const memo = (document.getElementById('ddMemoInput')?.value || '').slice(0, 2000);
        btn.disabled = true;
        const oldText = btn.textContent;
        btn.textContent = '저장 중...';

        const res = await api('/api/admin/donations', {
          method: 'PATCH',
          body: { id, inlineMemoOnly: true, memo },
        });

        btn.disabled = false;
        btn.textContent = oldText;

        if (res.ok) {
          toast(res.data?.message || '메모가 저장되었습니다');
        } else {
          toast(res.data?.error || '저장 실패');
        }
        return;
      }

      if (action === 'save-campaign') {
        const campaignTag = (document.getElementById('ddCampaignInput')?.value || '').trim();
        btn.disabled = true;
        const oldText = btn.textContent;
        btn.textContent = '저장 중...';

        const res = await api('/api/admin/donations', {
          method: 'PATCH',
          body: { id, campaignTag: campaignTag || null },
        });

        btn.disabled = false;
        btn.textContent = oldText;

        if (res.ok) {
          toast('캠페인 태그가 저장되었습니다');
          loadDonations();
        } else {
          toast(res.data?.error || '저장 실패');
        }
        return;
      }
    });

    /* 익명 토글 */
    document.addEventListener('change', async (e) => {
      const cb = e.target.closest('#ddAnonymousToggle');
      if (!cb) return;
      const id = Number(cb.dataset.id);
      const newVal = cb.checked;

      const res = await api('/api/admin/donations', {
        method: 'PATCH',
        body: { id, isAnonymous: newVal },
      });

      if (res.ok) {
        toast(newVal ? '익명 후원으로 변경되었습니다' : '공개 후원으로 변경되었습니다');
        loadDonations();
      } else {
        toast(res.data?.error || '변경 실패');
        cb.checked = !newVal;
      }
    });
  }

  /* ============ ★ K-9: 관리자 비밀번호 변경 ============ */
  function calcPasswordStrength(pw) {
    let score = 0;
    if (pw.length >= 8) score++;
    if (pw.length >= 12) score++;
    if (/[A-Z]/.test(pw)) score++;
    if (/[a-z]/.test(pw)) score++;
    if (/\d/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    return score;
  }

  function setupAdminPasswordForm() {
    /* 새 비번 강도 + 일치 실시간 표시 */
    document.addEventListener('input', (e) => {
      if (e.target.id === 'apNewPw') {
        const pw = e.target.value;
        const score = calcPasswordStrength(pw);
        const pct = Math.min(100, (score / 6) * 100);
        const bar = document.getElementById('apMeterBar');
        const label = document.getElementById('apStrength');

        let color = '#dc2626';
        let text = '약함';
        if (score >= 5) { color = '#10b981'; text = '강함'; }
        else if (score >= 3) { color = '#f59e0b'; text = '보통'; }

        if (bar) {
          bar.style.width = pct + '%';
          bar.style.background = color;
        }
        if (label) {
          label.textContent = '비밀번호 강도: ' + text;
          label.style.color = color;
        }

        /* 확인 입력란이 채워져 있으면 일치도 갱신 */
        const pw2El = document.getElementById('apNewPw2');
        if (pw2El && pw2El.value) {
          const matchEl = document.getElementById('apMatch');
          if (matchEl) {
            const match = pw === pw2El.value;
            matchEl.textContent = match ? '✓ 일치합니다' : '✗ 일치하지 않습니다';
            matchEl.style.color = match ? '#10b981' : '#dc2626';
          }
        }
      }

      if (e.target.id === 'apNewPw2') {
        const pw = (document.getElementById('apNewPw') || {}).value || '';
        const pw2 = e.target.value;
        const matchEl = document.getElementById('apMatch');
        if (!matchEl) return;
        if (!pw2) { matchEl.textContent = ''; return; }
        const match = pw === pw2;
        matchEl.textContent = match ? '✓ 일치합니다' : '✗ 일치하지 않습니다';
        matchEl.style.color = match ? '#10b981' : '#dc2626';
      }
    });

    /* 폼 제출 */
    const form = document.getElementById('adminPasswordForm');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const currentPassword = (document.getElementById('apCurrentPw') || {}).value || '';
      const newPassword = (document.getElementById('apNewPw') || {}).value || '';
      const newPassword2 = (document.getElementById('apNewPw2') || {}).value || '';

      if (!currentPassword) return toast('현재 비밀번호를 입력해 주세요');
      if (newPassword.length < 8) return toast('새 비밀번호는 8자 이상이어야 합니다');
      if (!/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
        return toast('새 비밀번호는 영문과 숫자를 모두 포함해야 합니다');
      }
      if (newPassword !== newPassword2) return toast('새 비밀번호가 일치하지 않습니다');
      if (currentPassword === newPassword) return toast('새 비밀번호는 현재와 달라야 합니다');
      if (newPassword.toLowerCase() === 'admin1234') {
        return toast('기본 비밀번호는 사용할 수 없습니다');
      }

      const finalConfirm = confirm(
        '관리자 비밀번호를 변경하시겠습니까?\n\n' +
        '• 변경 후 즉시 새 비밀번호로 사용해야 합니다\n' +
        '• 다른 관리자 세션은 유지됩니다 (본인만 영향)\n\n' +
        '계속하려면 [확인]을 눌러주세요.'
      );
      if (!finalConfirm) return;

      const btn = document.getElementById('apSubmitBtn');
      const oldText = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.textContent = '변경 중...'; }

      try {
        const res = await api('/api/admin/password', {
          method: 'POST',
          body: { currentPassword, newPassword },
        });

        if (res.ok) {
          toast(res.data?.message || '비밀번호가 변경되었습니다');
          form.reset();
          /* 강도/일치 표시 초기화 */
          const bar = document.getElementById('apMeterBar');
          const label = document.getElementById('apStrength');
          const matchEl = document.getElementById('apMatch');
          if (bar) bar.style.width = '0%';
          if (label) {
            label.textContent = '비밀번호 강도: —';
            label.style.color = 'var(--text-3)';
          }
          if (matchEl) matchEl.textContent = '';
        } else {
          toast(res.data?.error || '비밀번호 변경 실패');
        }
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = oldText; }
      }
    });
  }

  /* ============ ★ K-5: 콘텐츠 관리 (공지/FAQ CRUD) ============ */
  let _cmNoticeSearchTimer = null;
  let _cmFaqSearchTimer = null;

  const NOTICE_CATEGORY_BADGE = {
    general: '<span class="badge b-mute">일반</span>',
    member: '<span class="badge b-info">회원</span>',
    event: '<span class="badge b-warn">사업</span>',
    media: '<span class="badge b-success">언론</span>',
  };

  async function loadContent() {
    await Promise.all([loadNotices(), loadFaqs()]);
  }

  async function loadNotices() {
    const tbody = document.querySelector('#adm-content table[data-content-tbl="notices"] tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text-3)">불러오는 중...</td></tr>';

    const params = new URLSearchParams({ limit: '50', page: '1' });
    const cat = document.getElementById('cmNoticeCategory')?.value || '';
    const pub = document.getElementById('cmNoticePublished')?.value || '';
    const q = (document.getElementById('cmNoticeQ')?.value || '').trim();
    if (cat) params.set('category', cat);
    if (pub) params.set('published', pub);
    if (q && q.length >= 2) params.set('q', q);

    const res = await api('/api/admin/notices?' + params.toString());

    if (!res.ok || !res.data?.data) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--danger)">조회 실패</td></tr>';
      return;
    }

    const list = res.data.data.list || [];
    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text-3)">공지사항이 없습니다</td></tr>';
      return;
    }

    tbody.innerHTML = list.map((n) => {
      const catBadge = NOTICE_CATEGORY_BADGE[n.category] || n.category;
      const pinnedMark = n.isPinned ? '<span class="cm-pinned-mark" title="상단 고정">📌</span>' : '<span style="color:var(--text-3)">—</span>';
      const publishedIcon = n.isPublished
        ? '<span style="color:var(--success);font-size:13px">●</span>'
        : '<span style="color:var(--text-3);font-size:13px">○</span>';

      return '<tr>' +
        '<td>' + n.id + '</td>' +
        '<td>' + catBadge + '</td>' +
        '<td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escapeHtml(n.title) + '">' + escapeHtml(n.title) + '</td>' +
        '<td style="text-align:center">' + pinnedMark + '</td>' +
        '<td style="text-align:center">' + publishedIcon + '</td>' +
        '<td style="text-align:right;font-family:Inter;font-size:11.5px">' + (n.views || 0).toLocaleString() + '</td>' +
        '<td><div class="cm-row-actions">' +
          '<button class="edit" data-cm-action="edit-notice" data-id="' + n.id + '">✏️ 수정</button>' +
          '<button class="delete" data-cm-action="delete-notice" data-id="' + n.id + '" data-title="' + escapeHtml(n.title) + '">🗑 삭제</button>' +
        '</div></td>' +
        '</tr>';
    }).join('');
  }

  async function loadFaqs() {
    const tbody = document.querySelector('#adm-content table[data-content-tbl="faqs"] tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--text-3)">불러오는 중...</td></tr>';

    const params = new URLSearchParams({ limit: '100', page: '1' });
    const cat = (document.getElementById('cmFaqCategory')?.value || '').trim();
    const active = document.getElementById('cmFaqActive')?.value || '';
    const q = (document.getElementById('cmFaqQ')?.value || '').trim();
    if (cat) params.set('category', cat);
    if (active) params.set('active', active);
    if (q && q.length >= 2) params.set('q', q);

    const res = await api('/api/admin/faqs?' + params.toString());

    if (!res.ok || !res.data?.data) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--danger)">조회 실패</td></tr>';
      return;
    }

    const list = res.data.data.list || [];
    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--text-3)">FAQ가 없습니다</td></tr>';
      return;
    }

    tbody.innerHTML = list.map((f) => {
      const activeIcon = f.isActive
        ? '<span class="cm-inline-active on" data-cm-action="toggle-faq-active" data-id="' + f.id + '" data-current="true" title="클릭하여 비활성화">●</span>'
        : '<span class="cm-inline-active off" data-cm-action="toggle-faq-active" data-id="' + f.id + '" data-current="false" title="클릭하여 활성화">○</span>';
      const catText = f.category ? escapeHtml(f.category) : '<span style="color:var(--text-3)">—</span>';

      return '<tr>' +
        '<td>' + f.id + '</td>' +
        '<td style="font-size:11.5px">' + catText + '</td>' +
        '<td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escapeHtml(f.question) + '">' + escapeHtml(f.question) + '</td>' +
        '<td style="text-align:center">' + activeIcon + '</td>' +
        '<td style="text-align:center"><input type="number" class="cm-inline-order" value="' + (f.sortOrder || 0) + '" min="0" max="9999" data-cm-action="change-faq-order" data-id="' + f.id + '"></td>' +
        '<td><div class="cm-row-actions">' +
          '<button class="edit" data-cm-action="edit-faq" data-id="' + f.id + '">✏️ 수정</button>' +
          '<button class="delete" data-cm-action="delete-faq" data-id="' + f.id + '" data-title="' + escapeHtml(f.question) + '">🗑 삭제</button>' +
        '</div></td>' +
        '</tr>';
    }).join('');
  }

  /* ===== 공지 모달 열기 ===== */
  async function openNoticeEditModal(id) {
    const modal = document.getElementById('noticeEditModal');
    if (!modal) return;

    const titleEl = document.getElementById('noticeModalTitle');
    const idEl = document.getElementById('noticeEditId');
    const catEl = document.getElementById('noticeEditCategory');
    const thumbEl = document.getElementById('noticeEditThumb');
    const tEl = document.getElementById('noticeEditTitle');
    const exEl = document.getElementById('noticeEditExcerpt');
    const cEl = document.getElementById('noticeEditContent');
    const pinEl = document.getElementById('noticeEditPinned');
    const pubEl = document.getElementById('noticeEditPublished');

    /* 신규 작성 모드 */
    if (!id) {
      if (titleEl) titleEl.textContent = '📢 새 공지 작성';
      if (idEl) idEl.value = '';
      if (catEl) catEl.value = 'general';
      if (thumbEl) thumbEl.value = '';
      if (tEl) tEl.value = '';
      if (exEl) exEl.value = '';
      if (cEl) cEl.value = '';
      if (pinEl) pinEl.checked = false;
      if (pubEl) pubEl.checked = true;
      modal.classList.add('show');
      setTimeout(() => tEl?.focus(), 100);
      return;
    }

    /* 수정 모드: 기존 데이터 로드 */
    if (titleEl) titleEl.textContent = '✏️ 공지 수정';
    modal.classList.add('show');

    const res = await api('/api/admin/notices?id=' + id);
    if (!res.ok || !res.data?.data?.notice) {
      toast('공지사항을 불러오지 못했습니다');
      modal.classList.remove('show');
      return;
    }
    const n = res.data.data.notice;
    if (idEl) idEl.value = String(n.id);
    if (catEl) catEl.value = n.category || 'general';
    if (thumbEl) thumbEl.value = n.thumbnailUrl || '';
    if (tEl) tEl.value = n.title || '';
    if (exEl) exEl.value = n.excerpt || '';
    if (cEl) cEl.value = n.content || '';
    if (pinEl) pinEl.checked = !!n.isPinned;
    if (pubEl) pubEl.checked = n.isPublished !== false;
  }

  /* ===== FAQ 모달 열기 ===== */
  async function openFaqEditModal(id) {
    const modal = document.getElementById('faqEditModal');
    if (!modal) return;

    const titleEl = document.getElementById('faqModalTitle');
    const idEl = document.getElementById('faqEditId');
    const catEl = document.getElementById('faqEditCategory');
    const sortEl = document.getElementById('faqEditSort');
    const qEl = document.getElementById('faqEditQuestion');
    const aEl = document.getElementById('faqEditAnswer');
    const actEl = document.getElementById('faqEditActive');

    if (!id) {
      if (titleEl) titleEl.textContent = '❓ 새 FAQ 작성';
      if (idEl) idEl.value = '';
      if (catEl) catEl.value = 'general';
      if (sortEl) sortEl.value = '0';
      if (qEl) qEl.value = '';
      if (aEl) aEl.value = '';
      if (actEl) actEl.checked = true;
      modal.classList.add('show');
      setTimeout(() => qEl?.focus(), 100);
      return;
    }

    if (titleEl) titleEl.textContent = '✏️ FAQ 수정';
    modal.classList.add('show');

    const res = await api('/api/admin/faqs?id=' + id);
    if (!res.ok || !res.data?.data?.faq) {
      toast('FAQ를 불러오지 못했습니다');
      modal.classList.remove('show');
      return;
    }
    const f = res.data.data.faq;
    if (idEl) idEl.value = String(f.id);
    if (catEl) catEl.value = f.category || 'general';
    if (sortEl) sortEl.value = String(f.sortOrder || 0);
    if (qEl) qEl.value = f.question || '';
    if (aEl) aEl.value = f.answer || '';
    if (actEl) actEl.checked = f.isActive !== false;
  }

  /* ===== 공지 폼 제출 ===== */
  function setupNoticeEditForm() {
    const form = document.getElementById('noticeEditForm');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('noticeEditId').value;
      const body = {
        category: document.getElementById('noticeEditCategory').value || 'general',
        title: document.getElementById('noticeEditTitle').value.trim(),
        content: document.getElementById('noticeEditContent').value.trim(),
        excerpt: document.getElementById('noticeEditExcerpt').value.trim() || undefined,
        thumbnailUrl: document.getElementById('noticeEditThumb').value.trim() || undefined,
        isPinned: document.getElementById('noticeEditPinned').checked,
        isPublished: document.getElementById('noticeEditPublished').checked,
      };

      if (!body.title || !body.content) {
        return toast('제목과 본문을 입력해 주세요');
      }

      const submitBtn = form.querySelector('button[type="submit"]');
      const oldText = submitBtn ? submitBtn.textContent : '';
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '저장 중...'; }

      try {
        let res;
        if (id) {
          res = await api('/api/admin/notices', {
            method: 'PATCH',
            body: { id: Number(id), ...body },
          });
        } else {
          res = await api('/api/admin/notices', { method: 'POST', body });
        }

        if (res.ok) {
          toast(res.data?.message || '저장되었습니다');
          document.getElementById('noticeEditModal')?.classList.remove('show');
          loadNotices();
        } else {
          toast(res.data?.error || '저장 실패');
        }
      } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = oldText; }
      }
    });
  }

  /* ===== FAQ 폼 제출 ===== */
  function setupFaqEditForm() {
    const form = document.getElementById('faqEditForm');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('faqEditId').value;
      const body = {
        category: document.getElementById('faqEditCategory').value.trim() || 'general',
        question: document.getElementById('faqEditQuestion').value.trim(),
        answer: document.getElementById('faqEditAnswer').value.trim(),
        sortOrder: Number(document.getElementById('faqEditSort').value) || 0,
        isActive: document.getElementById('faqEditActive').checked,
      };

      if (!body.question || !body.answer) {
        return toast('질문과 답변을 입력해 주세요');
      }

      const submitBtn = form.querySelector('button[type="submit"]');
      const oldText = submitBtn ? submitBtn.textContent : '';
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '저장 중...'; }

      try {
        let res;
        if (id) {
          res = await api('/api/admin/faqs', {
            method: 'PATCH',
            body: { id: Number(id), ...body },
          });
        } else {
          res = await api('/api/admin/faqs', { method: 'POST', body });
        }

        if (res.ok) {
          toast(res.data?.message || '저장되었습니다');
          document.getElementById('faqEditModal')?.classList.remove('show');
          loadFaqs();
        } else {
          toast(res.data?.error || '저장 실패');
        }
      } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = oldText; }
      }
    });
  }

    /* ============ ★ L-8: 효성 CMS+ 관리 ============ */
  let _hySearchTimer = null;
  let _hyCurrentList = [];

  const HY_STATUS_LABEL = {
    pending: '🟡 대기',
    completed: '✅ 활성',
    cancelled: '🚫 해지',
    failed: '❌ 실패',
    refunded: '💸 환불',
  };

  async function loadHyosung() {
    const panel = document.getElementById('adm-hyosung');
    if (!panel) return;
    const tbody = document.getElementById('hyTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--text-3)">불러오는 중...</td></tr>';

    /* 필터 수집 */
    const params = new URLSearchParams();
    params.set('limit', '100');
    params.set('page', '1');
    const status = document.getElementById('hyFilterStatus')?.value || '';
    const q = (document.getElementById('hyFilterQ')?.value || '').trim();
    if (status) params.set('status', status);
    if (q && q.length >= 2) params.set('q', q);

    const res = await api('/api/admin/hyosung?' + params.toString());
    if (!res.ok || !res.data?.data) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--danger)">조회 실패</td></tr>';
      return;
    }

    const list = res.data.data.list || [];
    const pagination = res.data.data.pagination || {};
    const stats = res.data.data.stats || {};

    _hyCurrentList = list;

    /* KPI 갱신 */
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('hyKpiPending', (stats.pending?.count || 0) + ' 건');
    set('hyKpiPendingAmt', '₩ ' + (stats.pending?.amount || 0).toLocaleString());
    set('hyKpiCompleted', (stats.completed?.count || 0) + ' 건');
    set('hyKpiCompletedAmt', '₩ ' + (stats.completed?.amount || 0).toLocaleString());
    set('hyKpiCancelled', (stats.cancelled?.count || 0) + ' 건');
    set('hyKpiFailed', (stats.failed?.count || 0) + ' 건');

    /* 사이드바 대기 뱃지 갱신 */
    updateHyosungPendingBadge(stats.pending?.count || 0);

    /* 카운트 */
    const countEl = document.getElementById('hyCount');
    if (countEl) {
      const total = pagination.total || 0;
      if (q || status) {
        countEl.textContent = `필터: ${list.length}건 / 전체 ${total.toLocaleString()}건`;
      } else {
        countEl.textContent = `전체 ${total.toLocaleString()}건`;
      }
    }

    /* 목록 렌더 */
    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text-3)">조회된 후원이 없습니다</td></tr>';
      return;
    }

    tbody.innerHTML = list.map((r) => {
      const donationNo = 'D-' + String(r.id).padStart(7, '0');
      const statusClass = r.status || 'pending';
      const statusText = HY_STATUS_LABEL[r.status] || r.status;
      const anonMark = r.isAnonymous ? '<span class="hy-info-badge">익명</span>' : '';

      const actions = '<div class="hy-row-actions">' +
        '<button type="button" class="detail" data-hy-action="detail" data-id="' + r.id + '">📝 상세</button>' +
        (r.status === 'pending'
          ? '<button type="button" class="complete" data-hy-action="complete" data-id="' + r.id + '" data-name="' + escapeHtml(r.donorName || '') + '">✅ 완료</button>'
          : '') +
        (r.status !== 'cancelled' && r.status !== 'failed'
          ? '<button type="button" class="cancel" data-hy-action="cancel" data-id="' + r.id + '" data-name="' + escapeHtml(r.donorName || '') + '">🚫 해지</button>'
          : '') +
        '</div>';

            /* ★ L-9: 효성 회원번호 표시 (있으면 배지, 없으면 경고) */
      const hyosungBadge = r.hyosungMemberNo
        ? '<span style="font-family:Inter;font-size:11px;background:#e7f7ec;color:#1a5e2c;padding:2px 7px;border-radius:8px;font-weight:600">#' + String(r.hyosungMemberNo).padStart(8, '0') + '</span>'
        : (r.status === 'pending'
          ? '<span style="font-size:11px;color:var(--text-3)">—</span>'
          : '<span style="font-size:11px;color:#c47a00" title="효성 회원번호가 등록되지 않았습니다">⚠️ 미등록</span>');

      return '<tr>' +
        '<td style="font-family:Inter;font-size:12px">' + donationNo + '</td>' +
        '<td style="font-family:Inter;font-size:12px">' + formatDateTime(r.createdAt) + '</td>' +
        '<td>' + escapeHtml(r.donorName || '') + anonMark + '</td>' +
        '<td style="font-weight:600">₩ ' + (r.amount || 0).toLocaleString() + '</td>' +
        '<td>' + hyosungBadge + '</td>' +
        '<td style="font-family:Inter;font-size:11.5px">' + escapeHtml(r.donorEmail || '—') + '</td>' +
        '<td style="font-family:Inter;font-size:11.5px">' + escapeHtml(r.donorPhone || '—') + '</td>' +
        '<td><span class="hy-status-pill ' + statusClass + '">' + statusText + '</span></td>' +
        '<td>' + actions + '</td>' +
        '</tr>';
        
    }).join('');
  }

  /* 사이드바 대기 건수 뱃지 */
  function updateHyosungPendingBadge(count) {
    const badge = document.getElementById('hyosungPendingBadge');
    if (!badge) return;
    const n = Number(count) || 0;
    if (n > 0) {
      badge.textContent = n > 99 ? '99+' : String(n);
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
  }

  /* 검색/필터 디바운스 */
  function setupHyosungSearch() {
    const qInput = document.getElementById('hyFilterQ');
    if (qInput) {
      qInput.addEventListener('input', () => {
        clearTimeout(_hySearchTimer);
        _hySearchTimer = setTimeout(loadHyosung, 400);
      });
    }
    const statusSel = document.getElementById('hyFilterStatus');
    if (statusSel) statusSel.addEventListener('change', loadHyosung);
  }

  /* 행 액션 (상세/완료/해지) */
    /* ★ L-8 + L-9: 효성 CMS+ 통합 액션 핸들러 */
  function setupHyosungActions() {
    /* ─── 행 액션 (상세/완료/해지) ─── */
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-hy-action]');
      if (btn) {
        e.preventDefault();
        const action = btn.dataset.hyAction;
        const id = Number(btn.dataset.id);
        if (!id) return;

        if (action === 'detail') {
          openHyosungDetailModal(id);
          return;
        }
        if (action === 'complete') {
          openHyosungQuickComplete(id, btn.dataset.name || '');
          return;
        }
        if (action === 'cancel') {
          openHyosungQuickCancel(id, btn.dataset.name || '');
          return;
        }
      }
    });

    /* ─── ★ L-9: CSV 추출 실 동작화 ─── */
    document.addEventListener('click', (e) => {
      var exportBtn = e.target.closest('[data-demo-action="hyosung-csv-export"]');
      if (exportBtn) {
        e.preventDefault();
        e.stopPropagation();
        var statusFilter = document.getElementById('hyFilterStatus')?.value || 'pending';
        window.open('/api/admin/hyosung-export?status=' + encodeURIComponent(statusFilter), '_blank');
        toast('효성 CMS+ CSV를 다운로드합니다');
        return;
      }

      /* ─── ★ L-9: CSV 업로드 실 동작화 ─── */
      var importBtn = e.target.closest('[data-demo-action="hyosung-csv-import"]');
      if (importBtn) {
        e.preventDefault();
        e.stopPropagation();

        /* 숨겨진 file input 생성/재사용 */
        var fileInput = document.getElementById('hyImportFileInput');
        if (!fileInput) {
          fileInput = document.createElement('input');
          fileInput.type = 'file';
          fileInput.id = 'hyImportFileInput';
          fileInput.accept = '.csv';
          fileInput.style.display = 'none';
          document.body.appendChild(fileInput);

          fileInput.addEventListener('change', async function (ev) {
            var file = ev.target.files[0];
            if (!file) return;

            if (file.size > 5 * 1024 * 1024) {
              toast('파일 크기는 5MB 이하여야 합니다');
              fileInput.value = '';
              return;
            }

            var confirmed = confirm(
              '효성 CMS+ 수납 결과 CSV를 업로드합니다.\n\n' +
              '파일: ' + file.name + '\n' +
              '크기: ' + (file.size / 1024).toFixed(1) + ' KB\n\n' +
              '• billing_update 형식(10컬럼)이어야 합니다\n' +
              '• 회원번호로 DB와 자동 매칭됩니다\n' +
              '• 중복 청구번호는 자동 스킵됩니다\n\n' +
              '계속하시겠습니까?'
            );
            if (!confirmed) {
              fileInput.value = '';
              return;
            }

            var fd = new FormData();
            fd.append('file', file);

            toast('CSV 업로드 처리 중...');

            try {
              var res = await fetch('/api/admin/hyosung-import', {
                method: 'POST',
                credentials: 'include',
                body: fd,
              });
              var data = await res.json().catch(function () { return {}; });

              if (res.ok && data.ok !== false) {
                var d = data.data || {};
                toast(data.message || '처리 완료');

                alert(
                  '📥 효성 CSV 업로드 결과\n\n' +
                  '파일: ' + (d.fileName || file.name) + '\n' +
                  '전체 행: ' + (d.totalRows || 0) + '건\n' +
                  '매칭 성공: ' + (d.matched || 0) + '건\n' +
                  '생성됨: ' + (d.created || 0) + '건\n' +
                  '스킵 (중복): ' + (d.skipped || 0) + '건\n' +
                  '매칭 실패: ' + (d.failed || 0) + '건\n\n' +
                  (d.failed > 0
                    ? '⚠️ 매칭 실패 건:\n' +
                      (d.failures || []).slice(0, 10).map(function (f) {
                        return '  - 효성#' + f.hyosungMemberNo + ' (' + (f.donorName || '') + '): ' + f.reason;
                      }).join('\n')
                    : '✅ 모든 건이 정상 처리되었습니다')
                );

                loadHyosung();
              } else {
                toast(data.error || '업로드 실패');
              }
            } catch (err) {
              console.error('[hyosung-import]', err);
              toast('네트워크 오류가 발생했습니다');
            } finally {
              fileInput.value = '';
            }
          });
        }

        fileInput.click();
        return;
      }
    });

    /* ─── 검색/필터 디바운스 ─── */
    setupHyosungSearch();
  }

  /* 효성 상세 모달 */
  async function openHyosungDetailModal(id) {
    const modal = document.getElementById('hyosungDetailModal');
    const body = document.getElementById('hyosungDetailBody');
    if (!modal || !body) return;

    body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-3)">로딩 중...</div>';
    modal.classList.add('show');

    const res = await api('/api/admin/hyosung?id=' + id);
    if (!res.ok || !res.data?.data?.donation) {
      body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--danger)">조회 실패</div>';
      return;
    }

    const d = res.data.data.donation;
    const member = res.data.data.member;
    const donationNo = 'D-' + String(d.id).padStart(7, '0');
    const statusClass = d.status;
    const statusLabel = HY_STATUS_LABEL[d.status] || d.status;

    const statusCard = '<div class="hy-status-card ' + statusClass + '">' +
      '<div class="icon">' +
      (d.status === 'pending' ? '🟡' :
       d.status === 'completed' ? '✅' :
       d.status === 'cancelled' ? '🚫' :
       d.status === 'failed' ? '❌' : '💸') +
      '</div>' +
      '<div class="text">' +
        '<strong>' + statusLabel + '</strong>' +
        '₩ ' + (d.amount || 0).toLocaleString() + ' / 월 · 정기 후원 · 효성 CMS+' +
      '</div>' +
      '</div>';

    const safeMemo = String(d.memo || '').replace(/"/g, '&quot;');
    const memberInfoHtml = member
      ? '<div class="hy-detail-grid">' +
          '<div>회원 구분</div><div>' + (member.type === 'regular' ? '정기후원' : member.type === 'family' ? '유가족' : member.type === 'volunteer' ? '봉사자' : member.type) + '</div>' +
          '<div>회원 가입일</div><div>' + formatDate(member.createdAt) + '</div>' +
          '<div>회원 상태</div><div>' + (member.status === 'active' ? '정상' : member.status === 'pending' ? '승인대기' : member.status === 'suspended' ? '정지' : '탈퇴') + '</div>' +
        '</div>'
      : '<div class="hy-detail-grid"><div>비회원</div><div>로그인하지 않은 상태에서 신청한 후원입니다</div></div>';

    /* 액션 버튼 영역 (상태에 따라) */
    let actionButtons = '';

    if (d.status === 'pending') {
      actionButtons = `
        <div class="hy-section">
          <h5>✅ 효성 CMS+ 등록 완료 처리</h5>
          <div class="field-row">
            <textarea id="hyCompleteReason" placeholder="(선택) 효성 등록 상세 내역을 기록하세요. 예: 2026.5.3 효성 CMS+ 수동 등록 완료, 회원 ID M-15"></textarea>
            <button type="button" class="small-btn success" data-hy-complete="${d.id}">✅ 등록 완료 처리 (감사 메일 발송)</button>
            <div class="action-warn">※ 클릭 시 즉시 상태가 '활성'으로 변경되고 신청자에게 감사 메일이 발송됩니다.</div>
          </div>
        </div>

        <div class="hy-section">
          <h5>🚫 신청 취소 처리</h5>
          <div class="field-row">
            <textarea id="hyCancelReason" placeholder="취소 사유 (예: 회원 요청으로 취소, 연락처 오류 등)"></textarea>
            <button type="button" class="small-btn danger" data-hy-cancel="${d.id}">🚫 취소 처리</button>
          </div>
        </div>

        <div class="hy-section">
          <h5>❌ 실패 처리 (등록 불가)</h5>
          <div class="field-row">
            <textarea id="hyFailReason" placeholder="실패 사유 (필수, 예: 계좌번호 오류로 효성 등록 불가)"></textarea>
            <button type="button" class="small-btn ghost" data-hy-fail="${d.id}">❌ 실패 처리</button>
          </div>
        </div>
      `;
        } else if (d.status === 'completed') {
      actionButtons = `
        <div class="hy-section">
          <h5>🏦 효성 CMS+ 정보</h5>
          <div style="background:#e7f7ec;border:1px solid #a3d9b4;border-radius:8px;padding:14px 16px;margin-bottom:14px">
            <div style="display:flex;gap:24px;flex-wrap:wrap;font-size:13px">
              <div>
                <span style="color:#1a5e2c;font-weight:600">효성 회원번호</span><br />
                <strong style="font-family:Inter,monospace;font-size:15px;color:var(--ink)">${d.hyosungMemberNo ? '#' + String(d.hyosungMemberNo).padStart(8, '0') : '미등록'}</strong>
              </div>
              <div>
                <span style="color:#1a5e2c;font-weight:600">계약번호</span><br />
                <strong style="font-family:Inter,monospace">${escapeHtml(d.hyosungContractNo || '001')}</strong>
              </div>
              ${d.hyosungBillNo ? '<div><span style="color:#1a5e2c;font-weight:600">최근 청구번호</span><br /><strong style="font-family:Inter,monospace;font-size:11px">' + escapeHtml(d.hyosungBillNo) + '</strong></div>' : ''}
            </div>
            <button type="button" class="small-btn ghost" data-hy-edit-info="${d.id}" style="margin-top:10px;font-size:11.5px">✏️ 효성 정보 수정</button>
          </div>
        </div>

        <div class="hy-section" id="hyEditInfoSection" style="display:none">
          <h5>✏️ 효성 정보 수정</h5>
          <div class="field-row">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
              <div>
                <label style="font-size:12px;font-weight:700;display:block;margin-bottom:4px">효성 회원번호</label>
                <input type="number" id="hyEditMemberNo" value="${d.hyosungMemberNo || ''}" min="1" style="width:100%;padding:8px 12px;border:1px solid var(--line);border-radius:5px;font-size:13px;font-family:Inter,monospace">
              </div>
              <div>
                <label style="font-size:12px;font-weight:700;display:block;margin-bottom:4px">계약번호</label>
                <input type="text" id="hyEditContractNo" value="${escapeHtml(d.hyosungContractNo || '001')}" maxlength="20" style="width:100%;padding:8px 12px;border:1px solid var(--line);border-radius:5px;font-size:13px;font-family:Inter,monospace">
              </div>
            </div>
            <button type="button" class="small-btn" data-hy-save-info="${d.id}">💾 효성 정보 저장</button>
          </div>
        </div>

        <div class="hy-section">
          <h5>🚫 해지 처리</h5>
          <div class="field-row">
            <textarea id="hyCancelReason" placeholder="해지 사유 (예: 회원 요청, 효성 CMS+ 측 해지 반영 등)"></textarea>
            <button type="button" class="small-btn danger" data-hy-cancel="${d.id}">🚫 해지 처리</button>
            <div class="action-warn">※ 효성 CMS+ 측에서 먼저 해지 처리 후 이 버튼을 눌러 주세요.</div>
          </div>
        </div>
      `;
    } else {
      actionButtons = `
        <div class="hy-section">
          <div style="padding:14px 16px;background:#f0f0f0;border-radius:6px;color:var(--text-3);font-size:12.5px;line-height:1.6">
            이 후원은 <strong>${statusLabel}</strong> 상태로 더 이상 상태 변경이 불가합니다.<br />
            새로 신청을 받으려면 회원에게 다시 신청 링크를 안내해 주세요.
          </div>
        </div>
      `;
    }

    body.innerHTML =
      statusCard +

      '<div class="hy-detail-grid">' +
        '<div>후원 번호</div><div style="font-family:Inter;font-weight:600">' + donationNo + '</div>' +
        '<div>신청자</div><div><strong>' + escapeHtml(d.donorName || '') + '</strong>' + (d.isAnonymous ? ' <span class="hy-info-badge">익명</span>' : '') + '</div>' +
        '<div>이메일</div><div style="font-family:Inter">' + escapeHtml(d.donorEmail || '—') + '</div>' +
        '<div>연락처</div><div style="font-family:Inter">' + escapeHtml(d.donorPhone || '—') + '</div>' +
        '<div>월 후원 금액</div><div style="font-weight:700;color:var(--brand)">₩ ' + (d.amount || 0).toLocaleString() + '</div>' +
        '<div>신청 일시</div><div>' + formatDateTime(d.createdAt) + '</div>' +
        '<div>최근 갱신</div><div>' + formatDateTime(d.updatedAt) + '</div>' +
      '</div>' +

      '<div class="hy-section">' +
        '<h5>👤 회원 정보</h5>' +
      '</div>' +
      memberInfoHtml +

      '<div class="hy-section">' +
        '<h5>📝 관리자 메모 (히스토리 포함)</h5>' +
        '<div class="field-row">' +
          '<textarea id="hyMemoInput" placeholder="이 후원에 대한 메모...">' + safeMemo + '</textarea>' +
          '<button type="button" class="small-btn" data-hy-memo="' + d.id + '">💾 메모 저장</button>' +
        '</div>' +
      '</div>' +

      actionButtons;
  }

  /* 효성 빠른 완료 처리 (행에서 클릭) */
    /* 효성 빠른 완료 처리 (행에서 클릭) — ★ L-9: 번호 입력 */
  async function openHyosungQuickComplete(id, name) {
    const safeName = name || '후원자';

    const hyMemberNo = prompt(
      safeName + '님의 효성 CMS+ 등록을 완료합니다.\n\n' +
      '효성 CMS+에서 부여된 회원번호를 입력해 주세요 (숫자만):\n' +
      '(예: 60)',
    );

    if (hyMemberNo === null) return; // 취소
    const numMemberNo = Number(hyMemberNo);
    if (!numMemberNo || numMemberNo <= 0) {
      return toast('올바른 효성 회원번호를 입력해 주세요 (양수 숫자)');
    }

    const confirmed = confirm(
      safeName + '님의 효성 CMS+ 신청을 완료 처리하시겠습니까?\n\n' +
      '• 효성 회원번호: ' + numMemberNo + '\n' +
      '• 감사 메일이 자동 발송됩니다\n' +
      '• 향후 수납 CSV 매칭에 사용됩니다',
    );
    if (!confirmed) return;

    const res = await api('/api/admin/hyosung', {
      method: 'PATCH',
      body: {
        id,
        markCompleted: true,
        hyosungMemberNo: numMemberNo,
        reason: '행 액션 빠른 완료 (회원번호: ' + numMemberNo + ')',
      },
    });

    if (res.ok) {
      toast(res.data?.message || '완료 처리되었습니다');
      loadHyosung();
    } else {
      toast(res.data?.error || '처리 실패');
    }
  }

  /* 효성 빠른 해지 처리 */
  async function openHyosungQuickCancel(id, name) {
    const safeName = name || '후원자';
    const reason = prompt(
      safeName + '님의 효성 CMS+ 후원을 해지 처리합니다.\n해지 사유를 입력하세요 (선택):',
      '',
    );
    if (reason === null) return;

    const res = await api('/api/admin/hyosung', {
      method: 'PATCH',
      body: { id, markCancelled: true, reason: reason.trim() || undefined },
    });

    if (res.ok) {
      toast(res.data?.message || '해지 처리되었습니다');
      loadHyosung();
    } else {
      toast(res.data?.error || '처리 실패');
    }
  }

  /* 효성 상세 모달 내 액션 (메모/완료/해지/실패) */
  function setupHyosungDetailActions() {
    document.addEventListener('click', async (e) => {
      /* 메모 저장 */
      const memoBtn = e.target.closest('[data-hy-memo]');
      if (memoBtn) {
        e.preventDefault();
        const id = Number(memoBtn.dataset.hyMemo);
        const memo = (document.getElementById('hyMemoInput')?.value || '').slice(0, 2000);
        memoBtn.disabled = true;
        const oldText = memoBtn.textContent;
        memoBtn.textContent = '저장 중...';

        const res = await api('/api/admin/hyosung', {
          method: 'PATCH',
          body: { id, inlineMemoOnly: true, memo },
        });

        memoBtn.disabled = false;
        memoBtn.textContent = oldText;

        if (res.ok) {
          toast(res.data?.message || '메모가 저장되었습니다');
        } else {
          toast(res.data?.error || '저장 실패');
        }
        return;
      }

      /* 모달 내 완료 처리 (사유 포함) */
            /* 모달 내 완료 처리 (★ L-9: 효성 회원번호 필수) */
      const completeBtn = e.target.closest('[data-hy-complete]');
      if (completeBtn) {
        e.preventDefault();
        const id = Number(completeBtn.dataset.hyComplete);
        const reason = (document.getElementById('hyCompleteReason')?.value || '').trim();
        const hyMemberNo = document.getElementById('hyMemberNoInput')?.value || '';
        const hyContractNo = (document.getElementById('hyContractNoInput')?.value || '').trim();

        if (!hyMemberNo || Number(hyMemberNo) <= 0) {
          return toast('효성 회원번호를 입력해 주세요 (필수)');
        }

        const confirmed = confirm(
          '효성 CMS+ 등록 완료로 처리하시겠습니까?\n\n' +
          '• 효성 회원번호: ' + hyMemberNo + '\n' +
          '• 상태가 \'활성\'으로 변경됩니다\n' +
          '• 신청자에게 감사 메일이 자동 발송됩니다\n' +
          '• 이 번호로 향후 수납 CSV가 자동 매칭됩니다',
        );
        if (!confirmed) return;

        completeBtn.disabled = true;
        const oldText = completeBtn.textContent;
        completeBtn.textContent = '처리 중...';

        const res = await api('/api/admin/hyosung', {
          method: 'PATCH',
          body: {
            id,
            markCompleted: true,
            hyosungMemberNo: Number(hyMemberNo),
            hyosungContractNo: hyContractNo || undefined,
            reason: reason || undefined,
          },
        });

        if (res.ok) {
          toast(res.data?.message || '완료 처리되었습니다');
          document.getElementById('hyosungDetailModal')?.classList.remove('show');
          loadHyosung();
        } else {
          toast(res.data?.error || '처리 실패');
          completeBtn.disabled = false;
          completeBtn.textContent = oldText;
        }
        return;
      }
      /* ★ L-9: 효성 정보 수정 표시/숨김 토글 */
      const editInfoBtn = e.target.closest('[data-hy-edit-info]');
      if (editInfoBtn) {
        e.preventDefault();
        const section = document.getElementById('hyEditInfoSection');
        if (section) {
          section.style.display = section.style.display === 'none' ? 'block' : 'none';
        }
        return;
      }

      /* ★ L-9: 효성 정보 저장 */
      const saveInfoBtn = e.target.closest('[data-hy-save-info]');
      if (saveInfoBtn) {
        e.preventDefault();
        const id = Number(saveInfoBtn.dataset.hySaveInfo);
        const hyMemberNo = document.getElementById('hyEditMemberNo')?.value || '';
        const hyContractNo = (document.getElementById('hyEditContractNo')?.value || '').trim();

        if (!hyMemberNo || Number(hyMemberNo) <= 0) {
          return toast('효성 회원번호를 입력해 주세요');
        }

        saveInfoBtn.disabled = true;
        const oldText = saveInfoBtn.textContent;
        saveInfoBtn.textContent = '저장 중...';

        const res = await api('/api/admin/hyosung', {
          method: 'PATCH',
          body: {
            id,
            updateHyosungInfo: true,
            hyosungMemberNo: Number(hyMemberNo),
            hyosungContractNo: hyContractNo || undefined,
          },
        });

        saveInfoBtn.disabled = false;
        saveInfoBtn.textContent = oldText;

        if (res.ok) {
          toast(res.data?.message || '효성 정보가 저장되었습니다');
          /* 모달 새로고침 */
          openHyosungDetailModal(id);
          loadHyosung();
        } else {
          toast(res.data?.error || '저장 실패');
        }
        return;
      }
      /* 모달 내 해지 처리 */
      const cancelBtn = e.target.closest('[data-hy-cancel]');
      if (cancelBtn) {
        e.preventDefault();
        const id = Number(cancelBtn.dataset.hyCancel);
        const reason = (document.getElementById('hyCancelReason')?.value || '').trim();

        const confirmed = confirm(
          '해지 처리하시겠습니까?\n\n' +
          '• 상태가 \'해지\'로 변경됩니다\n' +
          '• 되돌릴 수 없습니다',
        );
        if (!confirmed) return;

        cancelBtn.disabled = true;
        const oldText = cancelBtn.textContent;
        cancelBtn.textContent = '처리 중...';

        const res = await api('/api/admin/hyosung', {
          method: 'PATCH',
          body: { id, markCancelled: true, reason: reason || undefined },
        });

        if (res.ok) {
          toast(res.data?.message || '해지 처리되었습니다');
          document.getElementById('hyosungDetailModal')?.classList.remove('show');
          loadHyosung();
        } else {
          toast(res.data?.error || '처리 실패');
          cancelBtn.disabled = false;
          cancelBtn.textContent = oldText;
        }
        return;
      }

      /* 모달 내 실패 처리 */
      const failBtn = e.target.closest('[data-hy-fail]');
      if (failBtn) {
        e.preventDefault();
        const id = Number(failBtn.dataset.hyFail);
        const reason = (document.getElementById('hyFailReason')?.value || '').trim();

        if (!reason) {
          return toast('실패 처리 시 사유 입력이 필요합니다');
        }

        const confirmed = confirm(
          '실패 처리하시겠습니까?\n\n' +
          '사유: ' + reason.slice(0, 100) + '\n\n' +
          '• 상태가 \'실패\'로 변경됩니다\n' +
          '• 되돌릴 수 없습니다',
        );
        if (!confirmed) return;

        failBtn.disabled = true;
        const oldText = failBtn.textContent;
        failBtn.textContent = '처리 중...';

        const res = await api('/api/admin/hyosung', {
          method: 'PATCH',
          body: { id, markFailed: true, reason },
        });

        if (res.ok) {
          toast(res.data?.message || '실패 처리되었습니다');
          document.getElementById('hyosungDetailModal')?.classList.remove('show');
          loadHyosung();
        } else {
          toast(res.data?.error || '처리 실패');
          failBtn.disabled = false;
          failBtn.textContent = oldText;
        }
        return;
      }
    });
  }
  /* ===== 통합 액션 핸들러 (작성/수정/삭제/인라인) ===== */
  function setupContentActions() {
    /* 클릭 액션 */
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-cm-action]');
      if (!btn) return;
      const action = btn.dataset.cmAction;

      if (action === 'new-notice') {
        e.preventDefault();
        openNoticeEditModal(null);
        return;
      }
      if (action === 'edit-notice') {
        e.preventDefault();
        openNoticeEditModal(Number(btn.dataset.id));
        return;
      }
      if (action === 'delete-notice') {
        e.preventDefault();
        const id = Number(btn.dataset.id);
        const title = btn.dataset.title || '';
        if (!confirm('공지사항을 삭제하시겠습니까?\n\n"' + title + '"\n\n※ 삭제 후 복구할 수 없습니다.')) return;
        const res = await api('/api/admin/notices?id=' + id, { method: 'DELETE' });
        if (res.ok) {
          toast(res.data?.message || '삭제되었습니다');
          loadNotices();
        } else {
          toast(res.data?.error || '삭제 실패');
        }
        return;
      }

      if (action === 'new-faq') {
        e.preventDefault();
        openFaqEditModal(null);
        return;
      }
      if (action === 'edit-faq') {
        e.preventDefault();
        openFaqEditModal(Number(btn.dataset.id));
        return;
      }
      if (action === 'delete-faq') {
        e.preventDefault();
        const id = Number(btn.dataset.id);
        const title = btn.dataset.title || '';
        if (!confirm('FAQ를 삭제하시겠습니까?\n\n"' + title + '"\n\n※ 삭제 후 복구할 수 없습니다.')) return;
        const res = await api('/api/admin/faqs?id=' + id, { method: 'DELETE' });
        if (res.ok) {
          toast(res.data?.message || '삭제되었습니다');
          loadFaqs();
        } else {
          toast(res.data?.error || '삭제 실패');
        }
        return;
      }

      /* FAQ 인라인 활성 토글 */
      if (action === 'toggle-faq-active') {
        e.preventDefault();
        const id = Number(btn.dataset.id);
        const current = btn.dataset.current === 'true';
        const newVal = !current;
        const res = await api('/api/admin/faqs', {
          method: 'PATCH',
          body: { id, inlineOnly: true, isActive: newVal },
        });
        if (res.ok) {
          toast(newVal ? '활성화되었습니다' : '비활성화되었습니다');
          loadFaqs();
        } else {
          toast(res.data?.error || '변경 실패');
        }
        return;
      }
    });

    /* FAQ 순서 인라인 변경 (debounce) */
    let _orderTimer = null;
    document.addEventListener('input', (e) => {
      const inp = e.target.closest('[data-cm-action="change-faq-order"]');
      if (!inp) return;
      const id = Number(inp.dataset.id);
      const newSort = Number(inp.value) || 0;
      clearTimeout(_orderTimer);
      _orderTimer = setTimeout(async () => {
        const res = await api('/api/admin/faqs', {
          method: 'PATCH',
          body: { id, inlineOnly: true, sortOrder: newSort },
        });
        if (res.ok) {
          toast('순서가 변경되었습니다');
        } else {
          toast(res.data?.error || '변경 실패');
        }
      }, 600);
    });

    /* 검색/필터 디바운스 */
    const noticeQ = document.getElementById('cmNoticeQ');
    if (noticeQ) {
      noticeQ.addEventListener('input', () => {
        clearTimeout(_cmNoticeSearchTimer);
        _cmNoticeSearchTimer = setTimeout(loadNotices, 400);
      });
    }
    const faqQ = document.getElementById('cmFaqQ');
    if (faqQ) {
      faqQ.addEventListener('input', () => {
        clearTimeout(_cmFaqSearchTimer);
        _cmFaqSearchTimer = setTimeout(loadFaqs, 400);
      });
    }
    ['cmNoticeCategory', 'cmNoticePublished'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', loadNotices);
    });
    ['cmFaqCategory', 'cmFaqActive'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        if (id === 'cmFaqCategory') {
          el.addEventListener('input', () => {
            clearTimeout(_cmFaqSearchTimer);
            _cmFaqSearchTimer = setTimeout(loadFaqs, 400);
          });
        } else {
          el.addEventListener('change', loadFaqs);
        }
      }
    });
  }

  /* ============ ★ STEP H-2d-3: 영수증 설정 ============ */
  async function loadReceiptSettings() {
    const form = document.getElementById('receiptSettingsForm');
    if (!form) return;

    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;

    const res = await api('/api/admin/receipt-settings');
    if (!res.ok || !res.data?.data) {
      toast('영수증 설정 조회 실패');
      if (submitBtn) submitBtn.disabled = false;
      return;
    }

    const s = res.data.data.settings || {};
    const updatedByName = res.data.data.updatedByName;

    const updatedAtEl = document.getElementById('rsUpdatedAt');
    const updatedByEl = document.getElementById('rsUpdatedBy');
    if (updatedAtEl) updatedAtEl.textContent = formatDateTime(s.updatedAt);
    if (updatedByEl) updatedByEl.textContent = updatedByName || (s.updatedBy ? '관리자 #' + s.updatedBy : '—');

    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
    setVal('rsOrgName', s.orgName);
    setVal('rsOrgRegistrationNo', s.orgRegistrationNo);
    setVal('rsOrgRepresentative', s.orgRepresentative);
    setVal('rsOrgAddress', s.orgAddress);
    setVal('rsOrgPhone', s.orgPhone);

    setVal('rsTitle', s.title);
    setVal('rsSubtitle', s.subtitle);
    setVal('rsProofText', s.proofText);
    setVal('rsDonationTypeLabel', s.donationTypeLabel);

    renderFooterNotes(Array.isArray(s.footerNotes) ? s.footerNotes : []);

    if (submitBtn) submitBtn.disabled = false;
  }

  function renderFooterNotes(notes) {
    const list = document.getElementById('rsFooterList');
    if (!list) return;

    if (!notes || notes.length === 0) {
      notes = [''];
    }

    list.innerHTML = notes.map((note, idx) => {
      const safeVal = String(note || '').replace(/"/g, '&quot;');
      return '<div class="rs-footer-row" data-rs-idx="' + idx + '">' +
        '<input type="text" value="' + safeVal + '" placeholder="• 안내문 내용..." maxlength="200">' +
        '<button type="button" data-rs-remove="' + idx + '" title="삭제">✕</button>' +
        '</div>';
    }).join('');
  }

  function collectFooterNotes() {
    const inputs = document.querySelectorAll('#rsFooterList .rs-footer-row input[type="text"]');
    const arr = [];
    inputs.forEach((inp) => {
      const v = (inp.value || '').trim();
      if (v.length > 0) arr.push(v);
    });
    return arr;
  }

  function setupReceiptSettingsForm() {
    const form = document.getElementById('receiptSettingsForm');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const body = {
        orgName: document.getElementById('rsOrgName')?.value || '',
        orgRegistrationNo: document.getElementById('rsOrgRegistrationNo')?.value || '',
        orgRepresentative: document.getElementById('rsOrgRepresentative')?.value || '',
        orgAddress: document.getElementById('rsOrgAddress')?.value || '',
        orgPhone: document.getElementById('rsOrgPhone')?.value || '',
        title: document.getElementById('rsTitle')?.value || '',
        subtitle: document.getElementById('rsSubtitle')?.value || '',
        proofText: document.getElementById('rsProofText')?.value || '',
        donationTypeLabel: document.getElementById('rsDonationTypeLabel')?.value || '',
        footerNotes: collectFooterNotes(),
      };

      const submitBtn = form.querySelector('button[type="submit"]');
      const oldText = submitBtn ? submitBtn.textContent : '';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = '저장 중...';
      }

      const res = await api('/api/admin/receipt-settings', {
        method: 'PATCH',
        body,
      });

      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = oldText;
      }

      if (res.ok) {
        toast(res.data?.message || '영수증 설정이 저장되었습니다');
        const s = res.data?.data?.settings || {};
        const updatedByName = res.data?.data?.updatedByName;
        const updatedAtEl = document.getElementById('rsUpdatedAt');
        const updatedByEl = document.getElementById('rsUpdatedBy');
        if (updatedAtEl) updatedAtEl.textContent = formatDateTime(s.updatedAt);
        if (updatedByEl) updatedByEl.textContent = updatedByName || '—';
      } else {
        toast(res.data?.error || '저장 실패');
      }
    });
  }

  function setupReceiptSettingsActions() {
    document.addEventListener('click', (e) => {
      if (e.target.closest('#rsAddFooterBtn')) {
        e.preventDefault();
        const list = document.getElementById('rsFooterList');
        if (!list) return;
        const currentRows = list.querySelectorAll('.rs-footer-row').length;
        if (currentRows >= 10) {
          toast('안내문은 최대 10개까지 추가할 수 있습니다');
          return;
        }
        const newRow = document.createElement('div');
        newRow.className = 'rs-footer-row';
        newRow.dataset.rsIdx = String(currentRows);
        newRow.innerHTML =
          '<input type="text" value="" placeholder="• 안내문 내용..." maxlength="200">' +
          '<button type="button" data-rs-remove="' + currentRows + '" title="삭제">✕</button>';
        list.appendChild(newRow);
        newRow.querySelector('input')?.focus();
        return;
      }

      const removeBtn = e.target.closest('[data-rs-remove]');
      if (removeBtn) {
        e.preventDefault();
        const row = removeBtn.closest('.rs-footer-row');
        if (row) row.remove();
        const list = document.getElementById('rsFooterList');
        if (list && list.querySelectorAll('.rs-footer-row').length === 0) {
          renderFooterNotes(['']);
        }
        return;
      }

      if (e.target.closest('#rsReloadBtn')) {
        e.preventDefault();
        loadReceiptSettings();
        toast('현재 DB 설정을 다시 불러왔습니다');
        return;
      }

      if (e.target.closest('#rsPreviewBtn')) {
        e.preventDefault();
        const previewUrl = '/api/admin/receipt-preview?ts=' + Date.now();
        window.open(previewUrl, '_blank', 'noopener');
        toast('미리보기 PDF를 새 탭에서 엽니다 (현재 저장된 DB 설정 기준)');
        return;
      }
    });
  }

  function setupReceiptSettings() {
    setupReceiptSettingsForm();
    setupReceiptSettingsActions();
  }

  /* ============ ★ 지원 관리 (STEP E-2 개선) ============ */
  async function loadSupport() {
    const panel = document.getElementById('adm-support');
    if (!panel) return;
    const tbody = panel.querySelector('table.tbl tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:30px;color:var(--text-3)">불러오는 중...</td></tr>';

    const res = await api('/api/admin/support?limit=50');
    if (!res.ok || !res.data?.data) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:30px;color:var(--danger)">조회 실패</td></tr>';
      return;
    }
    const list = res.data.data.list || [];
    const stats = res.data.data.stats || {};

    const kpis = panel.querySelectorAll('.kpi-value');
    if (kpis[0]) kpis[0].textContent = (stats.submitted || 0) + ' 건';
    if (kpis[1]) kpis[1].textContent = (stats.inProgress || 0) + ' 건';
    if (kpis[2]) kpis[2].textContent = (stats.completed || 0) + ' 건';
    if (kpis[3]) kpis[3].textContent = (stats.avgDays || 0) + ' 일';

    updateSupportBadge(stats.submitted || 0);

    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--text-3)">신청 내역이 없습니다</td></tr>';
      return;
    }

    function buildStatusSelect(currentStatus, requestId) {
      let html = '<select class="inline-status-select" data-inline-id="' + requestId + '">';
      Object.keys(SUPPORT_STATUS_LABEL).forEach((key) => {
        const sel = key === currentStatus ? ' selected' : '';
        html += '<option value="' + key + '"' + sel + '>' + SUPPORT_STATUS_LABEL[key] + '</option>';
      });
      html += '</select>';
      return html;
    }

    tbody.innerHTML = list.map((s) => {
      let rowAttr = '';
      if (s.priority === 'urgent') rowAttr = ' style="background:#fdecec"';
      else if (s.status === 'submitted') rowAttr = ' style="background:#fff8ec"';

      const requesterName = s.requesterName ? escapeHtml(s.requesterName) : ('유가족 #' + s.memberId);
      const answererName = s.answererName ? escapeHtml(s.answererName) : '—';
      const answeredAt = s.answeredAt ? formatShortDateTime(s.answeredAt) : '—';

      const priorityCellHtml = priorityCellLabel(s.priority, s.priorityReason);

      return '<tr' + rowAttr + '>' +
        '<td>' + priorityCellHtml + '</td>' +
        '<td style="font-family:Inter;font-size:12px">' + escapeHtml(s.requestNo) + '</td>' +
        '<td>' + (SUPPORT_CAT_LABEL[s.category] || s.category) + '</td>' +
        '<td><span class="clickable-name" data-member-info-id="' + s.memberId + '">' + requesterName + '</span></td>' +
        '<td style="font-family:Inter;font-size:12px">' + formatShortDateTime(s.createdAt) + '</td>' +
        '<td>' + escapeHtml(s.assignedExpertName || '—') + '</td>' +
        '<td>' + buildStatusSelect(s.status, s.id) + '</td>' +
        '<td>' + answererName + '</td>' +
        '<td style="font-family:Inter;font-size:12px">' + answeredAt + '</td>' +
        '<td><button class="btn-link" data-support-action="open" data-id="' + s.id + '">📝 상세/답변</button></td>' +
        '</tr>';
    }).join('');

    const urgentCount = list.filter((s) => s.priority === 'urgent').length;
    const urgentEl = document.getElementById('support-kpi-urgent');
    if (urgentEl) urgentEl.textContent = urgentCount + ' 건';
    const urgentCard = document.getElementById('kpiUrgentCard');
    if (urgentCard) {
      if (urgentCount > 0) {
        urgentCard.style.borderLeft = '4px solid #c5293a';
        urgentCard.style.background = '#fdecec';
      } else {
        urgentCard.style.borderLeft = '4px solid var(--line)';
        urgentCard.style.background = 'transparent';
      }
    }
  }

  function setupInlineStatusChange() {
    document.addEventListener('change', async (e) => {
      const sel = e.target.closest('.inline-status-select');
      if (!sel) return;

      const id = Number(sel.dataset.inlineId);
      const newStatus = sel.value;
      if (!id || !newStatus) return;

      sel.disabled = true;
      const res = await api('/api/admin/support', {
        method: 'PATCH',
        body: { id, status: newStatus, inlineStatusOnly: true },
      });
      sel.disabled = false;

      if (res.ok) {
        toast(res.data?.message || '단계가 변경되었습니다');
        const tr = sel.closest('tr');
        if (tr) {
          if (newStatus === 'submitted') tr.setAttribute('style', 'background:#fff8ec');
          else tr.removeAttribute('style');
        }
        fetchAdminMe().then(() => {
          renderDashboardKPI();
          if (CURRENT_KPI) updateSupportBadge(CURRENT_KPI.pendingSupportCount);
        });
      } else {
        toast(res.data?.error || '변경 실패');
        loadSupport();
      }
    });
  }

    async function openSupportModal(id) {
    const modal = document.getElementById('supportDetailModal');
    if (!modal) {
      console.error('supportDetailModal not found');
      return toast('모달 요소를 찾을 수 없습니다');
    }

    modal.classList.add('show');

    document.getElementById('detail-info').textContent = '로딩 중...';
    document.getElementById('detail-title').textContent = '';
    document.getElementById('detail-content').textContent = '';
    document.getElementById('detail-attachments').innerHTML = '';
    document.getElementById('detail-answer-history').innerHTML = '';
    document.getElementById('replyId').value = id;
    document.getElementById('replyNote').value = '';
    document.getElementById('replySendEmail').checked = false;

    /* ★ K-3: 새 입력칸 초기화 */
    const expertEl = document.getElementById('replyAssignedExpert');
    const supplementEl = document.getElementById('replySupplement');
    const reportEl = document.getElementById('replyReport');
    if (expertEl) expertEl.value = '';
    if (supplementEl) supplementEl.value = '';
    if (reportEl) reportEl.value = '';

    const urgentBox = document.getElementById('urgentWarningBox');
    if (urgentBox) urgentBox.style.display = 'none';

    const res = await api('/api/admin/support?id=' + id);
    if (!res.ok || !res.data?.data) {
      document.getElementById('detail-info').textContent = '상세 조회 실패';
      return toast('상세 조회 실패');
    }
    const r = res.data.data.request;
    const requester = res.data.data.requester || {};
    const answerer = res.data.data.answerer || null;

    const infoEl = document.getElementById('detail-info');
    if (infoEl) {
      infoEl.innerHTML =
        '<strong>' + escapeHtml(r.requestNo) + '</strong> · ' +
        escapeHtml(requester.name || '알 수 없음') +
        (requester.email ? ' (' + escapeHtml(requester.email) + ')' : '') +
        ' · ' + (SUPPORT_CAT_LABEL[r.category] || r.category) +
        ' · 접수 ' + formatDateTime(r.createdAt);
    }

    document.getElementById('detail-title').textContent = r.title || '';
    document.getElementById('detail-content').textContent = r.content || '';

    if (r.priority === 'urgent') {
      const urgentBox = document.getElementById('urgentWarningBox');
      const urgentReason = document.getElementById('urgentReason');
      if (urgentBox) urgentBox.style.display = 'block';
      if (urgentReason) {
        urgentReason.textContent = r.priorityReason
          ? `AI 판단 근거: ${r.priorityReason}`
          : 'AI가 긴급 신청으로 분류했습니다';
      }
    }

    /* ★ K-3: 첨부파일을 다운로드 링크로 렌더링 */
    const attachEl = document.getElementById('detail-attachments');
    if (attachEl) {
      let attaches = [];
      try { attaches = r.attachments ? JSON.parse(r.attachments) : []; } catch (e) {}
      if (Array.isArray(attaches) && attaches.length > 0) {
        const linksHtml = attaches.map((k) => {
          const safeKey = encodeURIComponent(String(k));
          const fileName = String(k).split('/').pop() || k;
          /* originalName은 다운로드 시 메타데이터에서 가져오므로 키 마지막 부분으로 표시 */
          const displayName = fileName.replace(/^\d+-/, ''); // timestamp prefix 제거
          return `<a href="/api/support/download?key=${safeKey}&id=${r.id}" 
                     target="_blank" rel="noopener"
                     class="k3-attach-item"
                     title="다운로드: ${escapeHtml(String(k))}">
                    <span class="file-icon">📎</span>
                    <span class="file-name">${escapeHtml(displayName)}</span>
                    <span class="download-icon">⬇ 다운로드</span>
                  </a>`;
        }).join('');
        attachEl.innerHTML =
          '<span class="support-detail-label">첨부파일 (' + attaches.length + '건)</span>' +
          '<div class="k3-attach-list">' + linksHtml + '</div>';
      } else {
        attachEl.innerHTML = '';
      }
    }

    const historyEl = document.getElementById('detail-answer-history');
    if (historyEl && r.adminNote) {
      historyEl.innerHTML =
        '<span class="support-detail-label">📝 기존 답변 이력</span>' +
        '<div style="background:#fff;border:1px solid var(--line);border-radius:6px;padding:12px 14px;font-size:13px;line-height:1.7">' +
        '<div style="font-size:11.5px;color:var(--text-3);margin-bottom:6px">' +
        '답변자: <strong>' + (answerer ? escapeHtml(answerer.name) : '—') + '</strong> · ' +
        '답변시간: ' + (r.answeredAt ? formatDateTime(r.answeredAt) : '—') +
        '</div>' +
        '<div style="white-space:pre-wrap">' + escapeHtml(r.adminNote) + '</div>' +
        '</div>';
    } else if (historyEl) {
      historyEl.innerHTML = '';
    }

    document.getElementById('replyStatus').value = r.status || 'submitted';
    document.getElementById('replyNote').value = r.adminNote || '';

    /* ★ K-3: 기존 값 채우기 */
    if (expertEl) expertEl.value = r.assignedExpertName || '';
    if (supplementEl) supplementEl.value = r.supplementNote || '';
    if (reportEl) reportEl.value = r.reportContent || '';

    /* ★ K-3: 상태에 따라 입력칸 표시/숨김 */
    toggleSupportConditionalFields(r.status || 'submitted');

    injectAiDraftButton();
    loadExpertMatch(id);
    loadSimilarCases(id);
  }

  async function loadSimilarCases(supportId) {
    const container = document.getElementById('aiSimilarCasesSection');
    if (!container) return;

    container.innerHTML =
      '<span class="support-detail-label">🔍 AI 유사 처리 사례</span>' +
      '<div style="text-align:center;padding:14px;color:var(--text-3);font-size:12.5px">⏳ 비슷한 사례 검색 중... (3-5초)</div>';

    try {
      const res = await api('/api/admin/ai/similar-cases', {
        method: 'POST',
        body: { id: supportId },
      });

      if (!res.ok) {
        container.innerHTML =
          '<span class="support-detail-label">🔍 AI 유사 처리 사례</span>' +
          '<div style="color:var(--danger);font-size:12.5px;padding:8px">검색 실패</div>';
        return;
      }

      const cases = res.data?.data?.cases || [];

      if (cases.length === 0) {
        container.innerHTML =
          '<span class="support-detail-label">🔍 AI 유사 처리 사례</span>' +
          '<div style="font-size:12.5px;color:var(--text-3);padding:10px;background:var(--bg-soft);border-radius:6px;text-align:center">' +
          '동일 카테고리에 완료된 유사 사례가 아직 없습니다' +
          '</div>';
        return;
      }

      const cardsHtml = cases.map((c) => {
        const simColor = c.similarity >= 80 ? '#1a8b46' : c.similarity >= 60 ? '#c47a00' : '#8a8a8a';
        const simBadge = c.similarity > 0
          ? '<span style="background:' + simColor + ';color:#fff;font-size:10.5px;font-weight:700;padding:2px 7px;border-radius:10px">유사도 ' + c.similarity + '%</span>'
          : '<span style="color:var(--text-3);font-size:11px">최근 완료</span>';
        const daysText = c.processingDays !== null
          ? '<span style="color:var(--text-3)">· ' + c.processingDays + '일 만에 완료</span>'
          : '';

        return '<div style="background:#fff;border:1px solid var(--line);border-radius:6px;padding:11px 14px;margin-bottom:8px">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">' +
          '<div style="font-size:12px;color:var(--text-2);font-family:Inter">' + escapeHtml(c.requestNo) + ' ' + daysText + '</div>' +
          simBadge +
          '</div>' +
          '<div style="font-size:13px;font-weight:600;margin-bottom:4px">' + escapeHtml(c.title) + '</div>' +
          '<div style="font-size:12px;color:var(--text-2);line-height:1.5;border-left:2px solid var(--brand);padding-left:8px">' +
          '💡 ' + escapeHtml(c.summary) +
          '</div>' +
          '</div>';
      }).join('');

      container.innerHTML =
        '<span class="support-detail-label">🔍 AI 유사 처리 사례 <span style="font-weight:400;color:var(--text-3);font-size:11px">(Gemini 분석)</span></span>' +
        cardsHtml;
    } catch (err) {
      console.error('[loadSimilarCases]', err);
      container.innerHTML =
        '<span class="support-detail-label">🔍 AI 유사 처리 사례</span>' +
        '<div style="color:var(--danger);font-size:12.5px;padding:8px">분석 호출 중 오류</div>';
    }
  }

    async function loadExpertMatch(supportId) {
    const container = document.getElementById('aiExpertMatchSection');
    if (!container) return;

    container.innerHTML =
      '<span class="support-detail-label">🤝 AI 추천 전문가</span>' +
      '<div style="text-align:center;padding:14px;color:var(--text-3);font-size:12.5px">⏳ 매칭 분석 중... (3-5초)</div>';

    try {
      const res = await api('/api/admin/ai/expert-match', {
        method: 'POST',
        body: { id: supportId },
      });

      if (!res.ok || !res.data?.data?.recommendations) {
        container.innerHTML =
          '<span class="support-detail-label">🤝 AI 추천 전문가</span>' +
          '<div style="color:var(--danger);font-size:12.5px;padding:8px">매칭 실패: ' + (res.data?.error || '알 수 없음') + '</div>';
        return;
      }

      const recs = res.data.data.recommendations;
      const cardsHtml = recs.map((r, idx) => {
        const scoreColor = r.score >= 85 ? '#1a8b46' : r.score >= 70 ? '#c47a00' : '#8a8a8a';
        /* ★ K-3: "이 전문가로 배정" 버튼 추가 */
        const safeName = String(r.name).replace(/"/g, '&quot;');
        const safeRole = String(r.role).replace(/"/g, '&quot;');
        const expertLabel = `${r.name} ${r.role}`;
        const safeLabel = expertLabel.replace(/"/g, '&quot;');

        return '<div style="background:#fff;border:1px solid var(--line);border-radius:6px;padding:12px 14px;margin-bottom:8px">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;gap:8px;flex-wrap:wrap">' +
          '<div style="flex:1;min-width:160px">' +
          '<strong style="font-size:13.5px">' + escapeHtml(r.name) + '</strong> ' +
          '<span style="color:var(--text-2);font-size:11.5px">· ' + escapeHtml(r.role) + '</span>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:6px">' +
          '<span style="background:' + scoreColor + ';color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px">' +
          '매칭 ' + r.score + '%</span>' +
          '<button type="button" class="k3-assign-btn" data-k3-assign="' + safeLabel + '">' +
          '✓ 이 전문가로 배정' +
          '</button>' +
          '</div>' +
          '</div>' +
          '<div style="font-size:12px;color:var(--brand);margin-bottom:4px">' + escapeHtml(r.specialty) + '</div>' +
          '<div style="font-size:12px;color:var(--text-2);line-height:1.5">' + escapeHtml(r.reason) + '</div>' +
          '</div>';
      }).join('');

      container.innerHTML =
        '<span class="support-detail-label">🤝 AI 추천 전문가 <span style="font-weight:400;color:var(--text-3);font-size:11px">(Gemini 분석)</span></span>' +
        cardsHtml;
    } catch (err) {
      console.error('[loadExpertMatch]', err);
      container.innerHTML =
        '<span class="support-detail-label">🤝 AI 추천 전문가</span>' +
        '<div style="color:var(--danger);font-size:12.5px;padding:8px">매칭 호출 중 오류 발생</div>';
    }
  }

  function injectAiDraftButton() {
    const note = document.getElementById('replyNote');
    if (!note) return;
    if (document.getElementById('btnAiDraft')) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'btnAiDraft';
    btn.className = 'btn-sm btn-sm-ghost';
    btn.style.cssText = 'margin-bottom:6px;font-size:12px;color:var(--brand);border:1px dashed var(--brand);padding:6px 12px;border-radius:5px;background:#fff;cursor:pointer';
    btn.innerHTML = '✍️ AI 답변 초안 생성 (Gemini)';
    note.parentElement.insertBefore(btn, note);

    btn.addEventListener('click', async () => {
      const id = Number(document.getElementById('replyId').value);
      if (!id) return toast('신청을 먼저 선택하세요');

      btn.disabled = true;
      const oldText = btn.innerHTML;
      btn.innerHTML = '⏳ 생성 중... (3-5초)';

      try {
        const res = await api('/api/admin/ai/reply-draft', {
          method: 'POST',
          body: { id },
        });

        if (res.ok && res.data?.data?.draft) {
          const cur = note.value.trim();
          if (cur && !confirm('현재 입력된 답변이 있습니다. AI 초안으로 덮어쓸까요?')) {
            return;
          }
          note.value = res.data.data.draft;
          toast('AI 답변 초안이 생성되었습니다 (수정 후 저장하세요)');
        } else {
          toast(res.data?.error || 'AI 초안 생성 실패');
        }
      } finally {
        btn.disabled = false;
        btn.innerHTML = oldText;
      }
    });
  }

    function setupSupportReplyForm() {
    const form = document.getElementById('supportReplyForm');
    if (!form) return;

    /* ★ K-3: 상태 변경 시 보완/완료 입력칸 표시/숨김 */
    const statusEl = document.getElementById('replyStatus');
    if (statusEl) {
      statusEl.addEventListener('change', (e) => {
        toggleSupportConditionalFields(e.target.value);
      });
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const id = Number(document.getElementById('replyId').value);
      const status = document.getElementById('replyStatus').value;
      const adminNote = (document.getElementById('replyNote').value || '').trim();
      const sendEmail = document.getElementById('replySendEmail')?.checked === true;

      /* ★ K-3: 새 필드 수집 */
      const assignedExpertName = (document.getElementById('replyAssignedExpert')?.value || '').trim();
      const supplementNote = (document.getElementById('replySupplement')?.value || '').trim();
      const reportContent = (document.getElementById('replyReport')?.value || '').trim();

      if (!id) return toast('신청 ID 없음');
      if (sendEmail && !adminNote) {
        return toast('메일 발송 시 답변 내용을 입력해 주세요');
      }

      /* ★ K-3: 상태별 필수 입력 검증 */
      if (status === 'supplement' && !supplementNote) {
        return toast('보완 요청 시 보완 안내 내용을 입력해 주세요');
      }
      if (status === 'completed' && !reportContent) {
        const ok = confirm('완료 보고서 없이 저장하시겠습니까?\n(추후 입력 가능합니다)');
        if (!ok) return;
      }

      const submitBtn = form.querySelector('button[type="submit"]');
      const oldText = submitBtn ? submitBtn.textContent : '';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = '처리 중...';
      }

      try {
        /* ★ K-3: 새 필드를 PATCH body에 포함 */
        const body = {
          id,
          status,
          adminNote,
          sendEmail,
        };
        if (assignedExpertName) body.assignedExpertName = assignedExpertName;
        if (supplementNote) body.supplementNote = supplementNote;
        if (reportContent) body.reportContent = reportContent;

        const res = await api('/api/admin/support', {
          method: 'PATCH',
          body,
        });

        if (res.ok) {
          toast(res.data?.message || '저장되었습니다');
          document.getElementById('supportDetailModal')?.classList.remove('show');
          loadSupport();
          fetchAdminMe().then(() => {
            renderDashboardKPI();
            if (CURRENT_KPI) updateSupportBadge(CURRENT_KPI.pendingSupportCount);
          });
        } else {
          toast(res.data?.error || '저장 실패');
        }
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = oldText;
        }
      }
    });
  }

    /* ★ K-3: 상태별 입력칸 표시/숨김 */
  function toggleSupportConditionalFields(status) {
    const supplementGroup = document.getElementById('replySupplementGroup');
    const reportGroup = document.getElementById('replyReportGroup');

    if (supplementGroup) {
      supplementGroup.style.display = (status === 'supplement') ? 'block' : 'none';
    }
    if (reportGroup) {
      reportGroup.style.display = (status === 'completed') ? 'block' : 'none';
    }
  }

  /* ★ K-3: AI 추천 전문가 → 배정 입력칸 자동 입력 */
  function setupExpertAssignClick() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-k3-assign]');
      if (!btn) return;
      e.preventDefault();
      const expertLabel = btn.dataset.k3Assign || '';
      const expertEl = document.getElementById('replyAssignedExpert');
      if (expertEl) {
        expertEl.value = expertLabel;
        expertEl.focus();
        /* 시각적 피드백 */
        btn.classList.add('assigned');
        btn.textContent = '✓ 입력됨';
        setTimeout(() => {
          btn.classList.remove('assigned');
          btn.textContent = '✓ 이 전문가로 배정';
        }, 2000);
        toast('전문가 정보가 입력되었습니다. 저장 버튼을 눌러주세요.');
      }
    });
  }

  function setupSupportActions() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-support-action]');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      const id = Number(btn.dataset.id);
      const action = btn.dataset.supportAction;

      if (action === 'open' || action === 'view') {
        openSupportModal(id);
      }
    });
  }

  /* ============ ★ 회원 정보 팝업 (★ I-3 블랙/메모 + ★ K-7 메모/잠금/인증) ============ */
  async function openMemberInfoModal(memberId) {
    const modal = document.getElementById('memberInfoModal');
    const body = document.getElementById('memberInfoBody');
    if (!modal || !body) return toast('모달 요소를 찾을 수 없습니다');

    body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-3)">로딩 중...</div>';
    modal.classList.add('show');

    /* 회원 상세 (member-detail) + 추가로 admin-members?id=N 도 호출해서 잠금/인증 정보 가져오기 */
    const [detailRes, adminRes] = await Promise.all([
      api('/api/admin/member-detail?id=' + memberId),
      api('/api/admin/members?id=' + memberId),
    ]);

    if (!detailRes.ok || !detailRes.data?.data) {
      body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--danger)">조회 실패</div>';
      return;
    }
    const { member, donationSummary, supportSummary, blacklist, chatMemos } = detailRes.data.data;
    /* admin-members 응답에서 lockedUntil/emailVerified/memo/agree* 보강 */
    const adminMember = adminRes.ok ? (adminRes.data?.data?.member || {}) : {};
    const lockedUntil = adminMember.lockedUntil || member.lockedUntil;
    const emailVerified = adminMember.emailVerified !== undefined ? adminMember.emailVerified : member.emailVerified;
    const memo = adminMember.memo !== undefined ? adminMember.memo : (member.memo || '');

    const typeBadge = {
      regular: '<span class="badge b-info">정기후원</span>',
      family: '<span class="badge b-danger">유가족</span>',
      volunteer: '<span class="badge b-success">봉사자</span>',
      admin: '<span class="badge b-warn">관리자</span>',
    };
    const statusBadge = {
      active: '<span class="badge b-success">정상</span>',
      pending: '<span class="badge b-warn">승인대기</span>',
      suspended: '<span class="badge b-danger">정지</span>',
      withdrawn: '<span class="badge b-mute">탈퇴</span>',
    };

    /* ★ K-7: 잠금 상태 박스 */
    const isLocked = lockedUntil && new Date(lockedUntil) > new Date();
    const lockedBlock = isLocked
      ? '<div class="mi-locked-box">' +
          '<strong>🔒 계정이 잠겨 있습니다</strong><br />' +
          '잠금 해제 시점: ' + formatDateTime(lockedUntil) +
          ' (5회 로그인 실패로 자동 잠금)' +
        '</div>'
      : '';

    /* ★ K-7: 미인증 안내 박스 */
    const unverifiedBlock = !emailVerified
      ? '<div class="mi-unverified-box">' +
          '<span style="font-size:18px">✉️</span>' +
          '<span style="flex:1">이메일 미인증 상태입니다</span>' +
          '<button type="button" class="mi-action-row button success" data-mi-k7="verify-email" data-mi-id="' + member.id + '" style="padding:5px 12px;font-size:11.5px;background:#e7f7ec;color:#1a5e2c;border:1px solid #a3d9b4;border-radius:5px;cursor:pointer;font-weight:600">✓ 강제 인증</button>' +
        '</div>'
      : '';

    /* 최근 후원 5건 */
    const recentDonationHtml = (donationSummary.recent || []).length === 0
      ? '<div style="text-align:center;color:var(--text-3);padding:14px">후원 내역 없음</div>'
      : (donationSummary.recent || []).map((d) =>
          '<div class="mini-list-row">' +
          formatDate(d.createdAt) + ' · ' +
          (d.type === 'regular' ? '정기' : '일시') + ' · ' +
          '₩' + (d.amount || 0).toLocaleString() +
          ' (' + (d.status === 'completed' ? '완료' : d.status) + ')' +
          '</div>'
        ).join('');

    const recentSupportHtml = (supportSummary.list || []).length === 0
      ? '<div style="text-align:center;color:var(--text-3);padding:14px">지원 내역 없음</div>'
      : (supportSummary.list || []).slice(0, 5).map((s) =>
          '<div class="mini-list-row">' +
          escapeHtml(s.requestNo) + ' · ' +
          (SUPPORT_CAT_LABEL[s.category] || s.category) + ' · ' +
          (SUPPORT_STATUS_LABEL[s.status] || s.status) + ' · ' +
          formatDate(s.createdAt) +
          '</div>'
        ).join('');

    const blacklistBlock = blacklist
      ? '<div style="background:#fdecec;border:1px solid #f5b5bb;border-radius:8px;padding:14px 16px;margin-bottom:16px">' +
          '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;margin-bottom:8px">' +
            '<div>' +
              '<div style="font-weight:700;color:#a01e2c;font-size:14px;margin-bottom:4px">⛔ 채팅 블랙리스트</div>' +
              '<div style="font-size:12.5px;color:#a01e2c;line-height:1.6">' +
                '사유: <strong>' + escapeHtml(blacklist.reason) + '</strong>' +
              '</div>' +
              '<div style="font-size:11.5px;color:var(--text-3);margin-top:4px">' +
                '등록자: ' + escapeHtml(blacklist.blockedByName || '관리자 #' + blacklist.blockedBy) +
                ' · ' + formatDateTime(blacklist.blockedAt) +
              '</div>' +
            '</div>' +
            '<button class="btn-sm btn-sm-ghost" data-mi-action="unblock" data-mi-member="' + member.id + '" data-mi-name="' + escapeHtml(member.name) + '" style="font-size:11px;color:#1a8b46;border:1px solid #1a8b46;background:#fff;padding:5px 12px;border-radius:5px;cursor:pointer;flex-shrink:0">🔓 블랙 해지</button>' +
          '</div>' +
        '</div>'
      : '';

    const chatMemoBlock = (chatMemos && chatMemos.length > 0)
      ? '<div style="margin-bottom:14px">' +
          '<div class="support-detail-label">💬 채팅 관리자 메모 (' + chatMemos.length + '건)</div>' +
          '<div class="mini-list">' +
            chatMemos.map((m) => {
              const cat = CHAT_CAT_LABEL[m.category] || '💬 기타';
              const memoText = String(m.adminMemo || '').slice(0, 100);
              const isClosed = m.status !== 'active';
              return '<div class="mini-list-row" style="cursor:pointer;display:flex;justify-content:space-between;align-items:flex-start;gap:8px" data-mi-action="goto-chat" data-mi-room="' + m.roomId + '">' +
                '<div style="flex:1;min-width:0">' +
                  '<div style="font-size:11.5px;color:var(--text-3);margin-bottom:2px">' +
                    cat + (isClosed ? ' · <span style="color:var(--text-3)">종료</span>' : '') + ' · ' + formatDate(m.updatedAt) +
                  '</div>' +
                  '<div style="font-size:12.5px;color:var(--text-1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
                    escapeHtml(memoText) +
                  '</div>' +
                '</div>' +
                '<span style="font-size:11px;color:var(--brand);flex-shrink:0">채팅으로 →</span>' +
              '</div>';
            }).join('') +
          '</div>' +
        '</div>'
      : '';

    const safeMemo = String(memo || '').replace(/"/g, '&quot;');
    const isAdminType = member.type === 'admin';

    body.innerHTML =
      blacklistBlock +
      lockedBlock +
      unverifiedBlock +

      '<div class="member-info-grid">' +
      '<div>이름</div><div><strong>' + escapeHtml(member.name) + '</strong> ' + (typeBadge[member.type] || member.type) + ' ' + (statusBadge[member.status] || member.status) + '</div>' +
      '<div>이메일</div><div>' + escapeHtml(member.email) + (emailVerified ? ' <span style="color:var(--success);font-size:11px">✓ 인증됨</span>' : ' <span style="color:var(--text-3);font-size:11px">미인증</span>') + '</div>' +
      '<div>연락처</div><div>' + escapeHtml(member.phone || '—') + '</div>' +
      '<div>가입일</div><div>' + formatDate(member.createdAt) + '</div>' +
      '<div>최종 로그인</div><div>' + formatDateTime(member.lastLoginAt) + '</div>' +
      '<div>알림 동의</div><div>' +
      (member.agreeEmail ? '✉️ ' : '') +
      (member.agreeSms ? '📱 ' : '') +
      (member.agreeMail ? '📬 ' : '') +
      (!member.agreeEmail && !member.agreeSms && !member.agreeMail ? '없음' : '') +
      '</div>' +
      '</div>' +

      '<div class="activity-stat-grid">' +
      '<div class="activity-stat">' +
      '<div class="activity-stat-label">💰 누적 후원</div>' +
      '<div class="activity-stat-value">₩' + (donationSummary.totalAmount || 0).toLocaleString() + '</div>' +
      '<div style="font-size:11.5px;color:var(--text-3);margin-top:2px">총 ' + (donationSummary.totalCount || 0) + '건</div>' +
      '</div>' +
      '<div class="activity-stat">' +
      '<div class="activity-stat-label">🤝 지원 신청</div>' +
      '<div class="activity-stat-value">' + (supportSummary.total || 0) + '건</div>' +
      '<div style="font-size:11.5px;color:var(--text-3);margin-top:2px">진행 ' + (supportSummary.inProgress || 0) + ' · 완료 ' + (supportSummary.completed || 0) + '</div>' +
      '</div>' +
      '</div>' +

      chatMemoBlock +

      /* ★ K-7: 관리자 메모 입력 */
      '<div class="mi-section">' +
        '<h5>📝 관리자 메모 <span style="font-weight:400;color:var(--text-3);font-size:11.5px">(회원에게 노출되지 않음)</span></h5>' +
        '<textarea id="miMemoInput" class="mi-memo-textarea" maxlength="2000" placeholder="이 회원에 대한 메모를 입력하세요...">' + safeMemo + '</textarea>' +
        '<div class="mi-action-row">' +
          '<button type="button" class="primary" data-mi-k7="save-memo" data-mi-id="' + member.id + '">💾 메모 저장</button>' +
          (isLocked
            ? '<button type="button" class="warn" data-mi-k7="unlock" data-mi-id="' + member.id + '">🔓 잠금 해제</button>'
            : '') +
          (member.status === 'pending' && !isAdminType
            ? '<button type="button" class="success" data-mi-k7="approve" data-mi-id="' + member.id + '">✓ 승인 (정상으로 변경)</button>'
            : '') +
        '</div>' +
      '</div>' +

      '<div class="mi-section">' +
      '<div class="support-detail-label">최근 후원 내역</div>' +
      '<div class="mini-list">' + recentDonationHtml + '</div>' +
      '</div>' +

      '<div class="mi-section">' +
      '<div class="support-detail-label">최근 지원 신청</div>' +
      '<div class="mini-list">' + recentSupportHtml + '</div>' +
      '</div>';
  }

    function setupMemberInfoActions() {
    /* 회원 이름 클릭 → 모달 오픈 */
    document.addEventListener('click', (e) => {
      const span = e.target.closest('[data-member-info-id]');
      if (!span) return;
      e.preventDefault();
      e.stopPropagation();
      const id = Number(span.dataset.memberInfoId);
      if (id) openMemberInfoModal(id);
    });

    /* 모달 내 액션 (블랙 해지 / 채팅 이동) */
    document.addEventListener('click', async (e) => {
      const unblockBtn = e.target.closest('[data-mi-action="unblock"]');
      if (unblockBtn) {
        e.preventDefault();
        e.stopPropagation();
        const memberId = Number(unblockBtn.dataset.miMember);
        const name = unblockBtn.dataset.miName || '해당 회원';
        if (!confirm(`${name}님의 채팅 블랙리스트를 해지하시겠습니까?\n해지 후 다시 채팅을 이용할 수 있습니다.`)) return;

        unblockBtn.disabled = true;
        unblockBtn.textContent = '처리 중...';

        const res = await api('/api/admin/chat/rooms?action=blacklist&memberId=' + memberId, { method: 'DELETE' });

        if (res.ok) {
          toast(res.data?.message || '블랙 해지 완료');
          openMemberInfoModal(memberId);
          if (window.SIREN_ADMIN_CHAT && typeof window.SIREN_ADMIN_CHAT.loadRoomList === 'function') {
            window.SIREN_ADMIN_CHAT.loadRoomList();
          }
        } else {
          toast(res.data?.error || '해지 실패');
          unblockBtn.disabled = false;
          unblockBtn.textContent = '🔓 블랙 해지';
        }
        return;
      }

      const chatRow = e.target.closest('[data-mi-action="goto-chat"]');
      if (chatRow) {
        e.preventDefault();
        e.stopPropagation();
        const roomId = Number(chatRow.dataset.miRoom);
        if (!roomId) return;

        document.getElementById('memberInfoModal')?.classList.remove('show');

        const chatLink = document.querySelector('.adm-menu a[data-page="chat"]');
        if (chatLink) {
          switchAdminPage('chat', chatLink);
          setTimeout(() => {
            if (window.SIREN_ADMIN_CHAT && typeof window.SIREN_ADMIN_CHAT.selectRoom === 'function') {
              window.SIREN_ADMIN_CHAT.selectRoom(roomId);
            }
          }, 300);
        }
        return;
      }

      /* ★ K-7: 메모 저장 / 잠금 해제 / 강제 인증 / 승인 */
      const k7Btn = e.target.closest('[data-mi-k7]');
      if (k7Btn) {
        e.preventDefault();
        e.stopPropagation();
        const action = k7Btn.dataset.miK7;
        const memberId = Number(k7Btn.dataset.miId);
        if (!memberId) return;

        if (action === 'save-memo') {
          const memo = (document.getElementById('miMemoInput')?.value || '').slice(0, 2000);
          k7Btn.disabled = true;
          const oldText = k7Btn.textContent;
          k7Btn.textContent = '저장 중...';

          const res = await api('/api/admin/members', {
            method: 'PATCH',
            body: { id: memberId, inlineMemoOnly: true, memo },
          });

          k7Btn.disabled = false;
          k7Btn.textContent = oldText;

          if (res.ok) {
            toast(res.data?.message || '메모가 저장되었습니다');
            /* 회원 목록 갱신 (메모 컬럼은 표에는 없지만 캐시 일관성) */
            if (typeof loadMembers === 'function') loadMembers();
          } else {
            toast(res.data?.error || '저장 실패');
          }
          return;
        }

        if (action === 'unlock') {
          if (!confirm('이 계정의 잠금을 해제하시겠습니까?\n로그인 실패 카운트도 0으로 초기화됩니다.')) return;
          k7Btn.disabled = true;
          const oldText = k7Btn.textContent;
          k7Btn.textContent = '처리 중...';

          const res = await api('/api/admin/members', {
            method: 'PATCH',
            body: { id: memberId, unlock: true },
          });

          if (res.ok) {
            toast(res.data?.message || '잠금이 해제되었습니다');
            openMemberInfoModal(memberId);
            loadMembers();
          } else {
            toast(res.data?.error || '해제 실패');
            k7Btn.disabled = false;
            k7Btn.textContent = oldText;
          }
          return;
        }

        if (action === 'verify-email') {
          if (!confirm('이 회원의 이메일을 강제로 인증 처리하시겠습니까?\n(예: 전화로 본인 확인 완료한 경우)')) return;
          k7Btn.disabled = true;
          const oldText = k7Btn.textContent;
          k7Btn.textContent = '처리 중...';

          const res = await api('/api/admin/members', {
            method: 'PATCH',
            body: { id: memberId, verifyEmail: true },
          });

          if (res.ok) {
            toast(res.data?.message || '이메일 인증이 완료 처리되었습니다');
            openMemberInfoModal(memberId);
          } else {
            toast(res.data?.error || '처리 실패');
            k7Btn.disabled = false;
            k7Btn.textContent = oldText;
          }
          return;
        }

        if (action === 'approve') {
          if (!confirm('이 회원을 정상(active) 상태로 승인하시겠습니까?')) return;
          k7Btn.disabled = true;
          const oldText = k7Btn.textContent;
          k7Btn.textContent = '처리 중...';

          const res = await api('/api/admin/members', {
            method: 'PATCH',
            body: { id: memberId, inlineStatusOnly: true, status: 'active' },
          });

          if (res.ok) {
            toast(res.data?.message || '승인되었습니다');
            openMemberInfoModal(memberId);
            loadMembers();
          } else {
            toast(res.data?.error || '승인 실패');
            k7Btn.disabled = false;
            k7Btn.textContent = oldText;
          }
          return;
        }
      }
    });
  }

    /* ★ K-7: 회원 추가 모달 */
  function setupAddMemberModal() {
    /* + 회원 추가 버튼 클릭 → 모달 오픈 */
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#btnAddMember')) return;
      e.preventDefault();
      const modal = document.getElementById('addMemberModal');
      if (!modal) return;
      /* 폼 초기화 */
      const ids = ['amEmail', 'amName', 'amPhone', 'amMemo'];
      ids.forEach((id) => { const el = document.getElementById(id); if (el) el.value = ''; });
      const typeEl = document.getElementById('amType');
      if (typeEl) typeEl.value = 'regular';
      modal.classList.add('show');
      setTimeout(() => document.getElementById('amEmail')?.focus(), 100);
    });

    /* 폼 제출 */
    const form = document.getElementById('addMemberForm');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const email = (document.getElementById('amEmail')?.value || '').trim();
      const name = (document.getElementById('amName')?.value || '').trim();
      const phone = (document.getElementById('amPhone')?.value || '').trim();
      const type = document.getElementById('amType')?.value || 'regular';
      const memo = (document.getElementById('amMemo')?.value || '').trim();

      if (!email || !name || !phone) {
        return toast('이메일/이름/연락처를 모두 입력해 주세요');
      }

      const btn = document.getElementById('btnAddMemberSubmit');
      const oldText = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.textContent = '처리 중...'; }

      try {
        const res = await api('/api/admin/members', {
          method: 'POST',
          body: { email, name, phone, type, memo: memo || undefined },
        });

        if (res.ok && res.data?.data) {
          const newMember = res.data.data.member;
          const tempPw = res.data.data.tempPassword;

          /* 회원 추가 모달 닫기 */
          document.getElementById('addMemberModal')?.classList.remove('show');

          /* 임시 비번 결과 모달 오픈 */
          showTempPasswordModal(newMember, tempPw);

          /* 회원 목록 갱신 */
          loadMembers();
        } else {
          toast(res.data?.error || '회원 추가 실패');
        }
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = oldText; }
      }
    });
  }

  /* ★ K-7: 임시 비밀번호 결과 모달 */
  function showTempPasswordModal(member, tempPassword) {
    const modal = document.getElementById('tempPasswordModal');
    if (!modal) return;

    const infoEl = document.getElementById('tpMemberInfo');
    const pwEl = document.getElementById('tpPassword');
    const copyBtn = document.getElementById('tpCopyBtn');

    if (infoEl) infoEl.textContent = `${member.name} (${member.email})`;
    if (pwEl) pwEl.textContent = tempPassword;
    if (copyBtn) {
      copyBtn.classList.remove('copied');
      copyBtn.textContent = '📋 복사하기';
    }

    modal.classList.add('show');
  }

  /* ★ K-7: 임시 비번 복사 버튼 */
  function setupTempPasswordCopy() {
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('#tpCopyBtn');
      if (!btn) return;
      e.preventDefault();

      const pwEl = document.getElementById('tpPassword');
      const pw = pwEl?.textContent || '';
      if (!pw || pw === '—') return;

      try {
        await navigator.clipboard.writeText(pw);
        btn.classList.add('copied');
        btn.textContent = '✓ 복사됨';
        toast('임시 비밀번호가 클립보드에 복사되었습니다');
        setTimeout(() => {
          btn.classList.remove('copied');
          btn.textContent = '📋 복사하기';
        }, 3000);
      } catch (err) {
        /* 클립보드 API 실패 시 fallback (선택 텍스트) */
        const range = document.createRange();
        range.selectNode(pwEl);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        toast('수동으로 Ctrl+C를 눌러 복사해 주세요');
      }
    });
  }
    /* ============ ★ K-4: 감사 로그 ============ */
  let _auditPage = 1;
  const _auditLimit = 50;
  let _auditTotalPages = 1;
  let _auditSearchTimer = null;

  const AUDIT_ACTION_LABEL = {
    login_success: '🟢 로그인 성공',
    login_failed: '🔴 로그인 실패',
    login_locked: '🔒 로그인 잠금',
    login_blocked: '🚫 로그인 차단',
    signup_success: '✨ 회원가입',
    signup_failed: '❌ 가입 실패',
    password_reset_request: '🔑 비번 재설정 요청',
    password_reset_success: '✅ 비번 재설정 완료',
    password_reset_failed: '❌ 비번 재설정 실패',
    email_verify_request: '✉️ 이메일 인증 요청',
    email_verify_success: '✅ 이메일 인증 완료',
    email_verify_failed: '❌ 이메일 인증 실패',
    email_verify_already_done: 'ℹ️ 이미 인증됨',
    withdraw_success: '👋 회원 탈퇴',
    withdraw_blocked: '🚫 탈퇴 차단',
    withdraw_failed: '❌ 탈퇴 실패',
    donate_success: '💝 후원 완료',
    support_create: '🤝 지원 신청',
    support_status_change: '📝 지원 상태 변경',
    support_inline_status: '🔄 지원 인라인 변경',
    support_download_success: '📎 첨부 다운로드',
    support_download_denied: '🚫 다운로드 차단',
    support_download_failed: '❌ 다운로드 실패',
    file_upload: '📤 파일 업로드',
    admin_login_success: '👨‍💼 관리자 로그인',
    admin_login_failed: '❌ 관리자 로그인 실패',
    member_status_change: '🔧 회원 상태 변경',
    receipt_issue_bulk: '📄 영수증 일괄 발행',
  };

  function getAuditActionLabel(action) {
    return AUDIT_ACTION_LABEL[action] || action;
  }

  function getAuditTypeLabel(type) {
    const map = {
      admin: '👨‍💼 관리자',
      user: '👤 회원',
      system: '⚙️ 시스템',
      anonymous: '🌐 익명',
    };
    return map[type] || type || '—';
  }

  async function loadAudit() {
    const tbody = document.getElementById('auTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text-3)">불러오는 중...</td></tr>';

    /* 필터 값 수집 */
    const params = new URLSearchParams();
    params.set('page', String(_auditPage));
    params.set('limit', String(_auditLimit));

    const userType = document.getElementById('auFilterType')?.value || '';
    const action = document.getElementById('auFilterAction')?.value || '';
    const success = document.getElementById('auFilterSuccess')?.value || '';
    const dateFrom = document.getElementById('auFilterDateFrom')?.value || '';
    const dateTo = document.getElementById('auFilterDateTo')?.value || '';
    const q = (document.getElementById('auFilterQ')?.value || '').trim();

    if (userType) params.set('userType', userType);
    if (action) params.set('action', action);
    if (success) params.set('success', success);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    if (q && q.length >= 2) params.set('q', q);

    const res = await api('/api/admin/audit?' + params.toString());

    if (!res.ok || !res.data?.data) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--danger)">조회 실패</td></tr>';
      return;
    }

    const list = res.data.data.list || [];
    const stats = res.data.data.stats?.last7Days || {};
    const pagination = res.data.data.pagination || {};

    /* KPI */
    const total = stats.total || 0;
    const success7 = stats.success || 0;
    const fail7 = stats.fail || 0;
    const failRate = total > 0 ? ((fail7 / total) * 100).toFixed(1) : '0';

    const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setText('auKpiTotal', total.toLocaleString());
    setText('auKpiSuccess', success7.toLocaleString());
    setText('auKpiFail', fail7.toLocaleString());
    setText('auKpiFailRate', failRate + '%');

    /* 페이지네이션 정보 저장 */
    _auditTotalPages = pagination.totalPages || 1;
    const pInfo = document.getElementById('auPageInfo');
    if (pInfo) pInfo.textContent = `${pagination.page} / ${_auditTotalPages} (전체 ${pagination.total?.toLocaleString() || 0}건)`;
    const pagBox = document.getElementById('auPagination');
    if (pagBox) pagBox.style.display = _auditTotalPages > 1 ? 'flex' : 'none';

    const prevBtn = document.querySelector('[data-au-page="prev"]');
    const nextBtn = document.querySelector('[data-au-page="next"]');
    if (prevBtn) prevBtn.disabled = _auditPage <= 1;
    if (nextBtn) nextBtn.disabled = _auditPage >= _auditTotalPages;

    /* 목록 렌더 */
    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-3)">조회된 로그가 없습니다</td></tr>';
      return;
    }

    tbody.innerHTML = list.map((row) => {
      const time = formatDateTime(row.createdAt);
      const typeLabel = getAuditTypeLabel(row.userType);
      const userName = row.userName ? escapeHtml(row.userName) : '<span style="color:var(--text-3)">—</span>';
      const actionLabel = getAuditActionLabel(row.action);
      const target = row.target ? escapeHtml(row.target) : '';
      const detailPreview = row.detail
        ? escapeHtml(String(row.detail).slice(0, 80)) + (row.detail.length > 80 ? '...' : '')
        : '';
      const targetCell = target
        ? `<strong>${target}</strong>${detailPreview ? '<br /><span style="font-size:11px;color:var(--text-3)">' + detailPreview + '</span>' : ''}`
        : detailPreview
          ? `<span style="font-size:11.5px;color:var(--text-3)">${detailPreview}</span>`
          : '<span style="color:var(--text-3)">—</span>';
      const ip = row.ipAddress ? escapeHtml(row.ipAddress) : '—';
      const successIcon = row.success
        ? '<span class="audit-status-icon success">✓</span>'
        : '<span class="audit-status-icon fail">✗</span>';

      return `<tr data-au-detail-id="${row.id}">
        <td class="col-time">${time}</td>
        <td><span class="audit-badge-type ${row.userType || ''}">${typeLabel}</span></td>
        <td>${userName}</td>
        <td class="col-action">${actionLabel}</td>
        <td>${targetCell}</td>
        <td class="col-ip">${ip}</td>
        <td style="text-align:center">${successIcon}</td>
      </tr>`;
    }).join('');
  }

  function setupAuditActions() {
    /* 검색 버튼 */
    document.addEventListener('click', (e) => {
      if (e.target.closest('#auBtnSearch')) {
        e.preventDefault();
        _auditPage = 1;
        loadAudit();
        return;
      }

      /* 초기화 버튼 */
      if (e.target.closest('#auBtnReset')) {
        e.preventDefault();
        const ids = ['auFilterType', 'auFilterAction', 'auFilterSuccess', 'auFilterDateFrom', 'auFilterDateTo', 'auFilterQ'];
        ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        _auditPage = 1;
        loadAudit();
        return;
      }

      /* 페이지네이션 */
      const pageBtn = e.target.closest('[data-au-page]');
      if (pageBtn) {
        e.preventDefault();
        const dir = pageBtn.dataset.auPage;
        if (dir === 'prev' && _auditPage > 1) {
          _auditPage--;
          loadAudit();
        } else if (dir === 'next' && _auditPage < _auditTotalPages) {
          _auditPage++;
          loadAudit();
        }
        return;
      }

      /* 행 클릭 → 상세 모달 */
      const row = e.target.closest('[data-au-detail-id]');
      if (row) {
        const id = Number(row.dataset.auDetailId);
        if (id) openAuditDetailModal(id);
      }
    });

    /* 검색어 디바운스 */
    const qInput = document.getElementById('auFilterQ');
    if (qInput) {
      qInput.addEventListener('input', () => {
        clearTimeout(_auditSearchTimer);
        _auditSearchTimer = setTimeout(() => {
          _auditPage = 1;
          loadAudit();
        }, 500);
      });
    }

    /* 셀렉트 변경 즉시 검색 */
    ['auFilterType', 'auFilterAction', 'auFilterSuccess', 'auFilterDateFrom', 'auFilterDateTo'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('change', () => {
          _auditPage = 1;
          loadAudit();
        });
      }
    });
  }

  async function openAuditDetailModal(id) {
    const modal = document.getElementById('auditDetailModal');
    const body = document.getElementById('auditDetailBody');
    if (!modal || !body) return;

    body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-3)">로딩 중...</div>';
    modal.classList.add('show');

    /* 현재 페이지 데이터에서 찾기 (별도 API 없이 캐시 활용) */
    /* 단순화를 위해 다시 API 호출 (단일 행) */
    const params = new URLSearchParams();
    params.set('limit', '1');
    params.set('userId', '0'); // 사용 안 함
    /* id로 필터하는 API 분기가 없으므로, 현재 테이블의 행에서 데이터 직접 추출 */

    const row = document.querySelector(`[data-au-detail-id="${id}"]`);
    if (!row) {
      body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--danger)">데이터를 찾을 수 없습니다</div>';
      return;
    }

    /* 테이블 행에는 요약만 있으므로 API에서 단건 가져오기 */
    /* admin-audit.ts는 단건 GET을 제공하지 않음 → 현재 페이지 검색 결과에서 매칭 */
    /* 실용적으로 처리: 행에서 보이는 정보 + tooltip 정보로 충분히 표시 */

    const cells = row.querySelectorAll('td');
    const time = cells[0]?.textContent || '—';
    const typeBadge = cells[1]?.querySelector('.audit-badge-type')?.textContent || '—';
    const userName = cells[2]?.textContent || '—';
    const actionLabel = cells[3]?.textContent || '—';
    const targetText = cells[4]?.textContent || '—';
    const ip = cells[5]?.textContent || '—';
    const successText = cells[6]?.querySelector('.success') ? '✅ 성공' : '❌ 실패';

    /* 추가로 detail 전체를 가져오려면 별도 API 필요 — 현재는 테이블 데이터로 표시 */
    /* 실 운영에서 더 자세히 보고 싶다면 GET /api/admin/audit?id=N 분기 추가 필요 */

    body.innerHTML = `
      <div class="audit-detail-grid">
        <div>로그 ID</div>
        <div style="font-family:Inter;font-weight:600">#${id}</div>
        <div>시간</div>
        <div style="font-family:Inter">${escapeHtml(time)}</div>
        <div>사용자 유형</div>
        <div>${escapeHtml(typeBadge)}</div>
        <div>사용자</div>
        <div><strong>${escapeHtml(userName)}</strong></div>
        <div>액션</div>
        <div style="font-family:Inter;font-weight:600">${escapeHtml(actionLabel)}</div>
        <div>결과</div>
        <div>${successText}</div>
        <div>IP 주소</div>
        <div style="font-family:Inter">${escapeHtml(ip)}</div>
      </div>

      <div style="margin-top:14px">
        <div style="font-size:12.5px;font-weight:600;color:var(--text-2);margin-bottom:6px">📋 대상 / 상세</div>
        <div class="audit-detail-json">${escapeHtml(targetText)}</div>
      </div>

      <div style="margin-top:14px;padding:12px 14px;background:var(--bg-soft);border-radius:6px;font-size:11.5px;color:var(--text-3);line-height:1.6">
        💡 <strong>전체 detail 정보</strong>는 테이블에서 미리보기만 표시됩니다.<br />
        상세한 JSON 내용이 필요하면 같은 사용자/액션으로 필터링한 후 행의 "대상 / 상세" 칸을 확인하세요.
      </div>
    `;
  }
  /* ============ ★ 운영자 관리 (STEP F-2) ============ */
  let _promoteSelectedMember = null;

  async function loadOperators() {
    const panel = document.getElementById('adm-operators');
    if (!panel) return;
    const tbody = panel.querySelector('table.tbl tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text-3)">불러오는 중...</td></tr>';

    const res = await api('/api/admin/operators');
    if (!res.ok || !res.data?.data) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--danger)">조회 실패</td></tr>';
      return;
    }
    const ops = res.data.data.operators || [];
    const stats = res.data.data.stats || {};

    const total = document.getElementById('opKpiTotal');
    const sup = document.getElementById('opKpiSuper');
    const reg = document.getElementById('opKpiOperator');
    const act = document.getElementById('opKpiActive');
    if (total) total.textContent = (stats.total || 0) + ' 명';
    if (sup) sup.textContent = (stats.superAdmins || 0) + ' 명';
    if (reg) reg.textContent = (stats.regular || 0) + ' 명';
    if (act) act.textContent = (stats.active || 0) + ' 명';

    if (ops.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-3)">운영자가 없습니다</td></tr>';
      return;
    }

    tbody.innerHTML = ops.map((op) => {
      const roleBadge = op.role === 'super_admin'
        ? '<span class="badge b-danger">슈퍼 관리자</span>'
        : '<span class="badge b-info">운영자</span>';
      const notifyToggle = `<label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-size:12px">
        <input type="checkbox" ${op.notifyOnSupport ? 'checked' : ''} data-op-toggle="notify" data-op-id="${op.id}">
        ${op.notifyOnSupport ? '✅' : '⬜'}
      </label>`;
      const statusBadge = op.operatorActive
        ? '<span class="badge b-success">활성</span>'
        : '<span class="badge b-mute">비활성</span>';

      const actionBtns =
        `<button class="btn-link" data-op-action="toggle-active" data-op-id="${op.id}" data-current="${op.operatorActive}">${op.operatorActive ? '비활성화' : '활성화'}</button> ` +
        `<button class="btn-link" data-op-action="demote" data-op-id="${op.id}" data-name="${escapeHtml(op.name)}" style="color:var(--danger)">강등</button>`;

      return `<tr>
        <td><strong>${escapeHtml(op.name)}</strong></td>
        <td style="font-size:12px">${escapeHtml(op.email)}</td>
        <td>${roleBadge}</td>
        <td>${notifyToggle}</td>
        <td>${statusBadge}</td>
        <td style="font-size:12px">${formatDate(op.lastLoginAt)}</td>
        <td>${actionBtns}</td>
      </tr>`;
    }).join('');
  }

  let _promoteSearchTimer = null;
  function setupPromoteSearch() {
    const input = document.getElementById('promoteSearchInput');
    const results = document.getElementById('promoteSearchResults');
    if (!input || !results) return;

    input.addEventListener('input', () => {
      clearTimeout(_promoteSearchTimer);
      const q = input.value.trim();

      if (q.length < 2) {
        results.innerHTML = '<div style="text-align:center;color:var(--text-3);padding:20px;font-size:13px">2자 이상 입력하세요</div>';
        return;
      }

      results.innerHTML = '<div style="text-align:center;color:var(--text-3);padding:20px;font-size:13px">⏳ 검색 중...</div>';

      _promoteSearchTimer = setTimeout(async () => {
        const res = await api('/api/admin/operators?candidates=1&q=' + encodeURIComponent(q));
        if (!res.ok || !res.data?.data) {
          results.innerHTML = '<div style="text-align:center;color:var(--danger);padding:20px">검색 실패</div>';
          return;
        }
        const list = res.data.data.candidates || [];
        if (list.length === 0) {
          results.innerHTML = '<div style="text-align:center;color:var(--text-3);padding:20px;font-size:13px">검색 결과가 없습니다</div>';
          return;
        }
        results.innerHTML = list.map((m) => `
          <div data-promote-pick="${m.id}" data-name="${escapeHtml(m.name)}" data-email="${escapeHtml(m.email)}" 
               style="padding:10px 12px;border-bottom:1px solid var(--line);cursor:pointer;display:flex;justify-content:space-between;align-items:center;font-size:13px"
               onmouseover="this.style.background='#f8f9fa'" onmouseout="this.style.background='transparent'">
            <div>
              <strong>${escapeHtml(m.name)}</strong>
              <span style="color:var(--text-3);font-size:11.5px;margin-left:8px">${escapeHtml(m.email)}</span>
            </div>
            <span style="font-size:11px;color:var(--brand)">선택 →</span>
          </div>
        `).join('');
      }, 300);
    });
  }

  function setupPromotePick() {
    document.addEventListener('click', (e) => {
      const row = e.target.closest('[data-promote-pick]');
      if (!row) return;

      _promoteSelectedMember = {
        id: Number(row.dataset.promotePick),
        name: row.dataset.name,
        email: row.dataset.email,
      };

      const info = document.getElementById('promoteSelectedInfo');
      const sel = document.getElementById('promoteSelected');
      if (info) info.innerHTML = `<strong>${escapeHtml(_promoteSelectedMember.name)}</strong> <span style="color:var(--text-3);font-weight:400;font-size:12px">(${escapeHtml(_promoteSelectedMember.email)})</span>`;
      if (sel) sel.style.display = 'block';

      document.querySelectorAll('[data-promote-pick]').forEach((el) => {
        el.style.background = el.dataset.promotePick === String(_promoteSelectedMember.id) ? '#fff8ec' : 'transparent';
      });
    });
  }

  function setupPromoteConfirm() {
    const btn = document.getElementById('promoteConfirmBtn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      if (!_promoteSelectedMember) return toast('회원을 선택하세요');

      const role = document.getElementById('promoteRole').value;
      const notify = document.getElementById('promoteNotify').checked;

      btn.disabled = true;
      btn.textContent = '처리 중...';

      const res = await api('/api/admin/operators', {
        method: 'POST',
        body: {
          memberId: _promoteSelectedMember.id,
          role,
          notifyOnSupport: notify,
        },
      });

      btn.disabled = false;
      btn.textContent = '운영자로 승급하기';

      if (res.ok) {
        toast(res.data?.message || '승급 완료');
        document.getElementById('promoteOperatorModal')?.classList.remove('show');
        _promoteSelectedMember = null;
        document.getElementById('promoteSearchInput').value = '';
        document.getElementById('promoteSearchResults').innerHTML = '<div style="text-align:center;color:var(--text-3);padding:20px;font-size:13px">검색어를 입력하세요</div>';
        document.getElementById('promoteSelected').style.display = 'none';
        loadOperators();
      } else {
        toast(res.data?.error || '승급 실패');
      }
    });
  }

  function setupOperatorActions() {
    document.addEventListener('change', async (e) => {
      const cb = e.target.closest('[data-op-toggle="notify"]');
      if (!cb) return;
      const id = Number(cb.dataset.opId);
      const newVal = cb.checked;

      const res = await api('/api/admin/operators', {
        method: 'PATCH',
        body: { id, notifyOnSupport: newVal },
      });
      if (res.ok) {
        toast('알림 수신 ' + (newVal ? '활성화' : '비활성화'));
        loadOperators();
      } else {
        toast(res.data?.error || '변경 실패');
        cb.checked = !newVal;
      }
    });

    document.addEventListener('click', async (e) => {
      const promoteBtn = e.target.closest('[data-op-action="open-promote"]');
      if (promoteBtn) {
        e.preventDefault();
        document.getElementById('promoteOperatorModal')?.classList.add('show');
        document.getElementById('promoteSearchInput')?.focus();
        return;
      }

      const toggleBtn = e.target.closest('[data-op-action="toggle-active"]');
      if (toggleBtn) {
        e.preventDefault();
        const id = Number(toggleBtn.dataset.opId);
        const isActive = toggleBtn.dataset.current === 'true';
        const newVal = !isActive;

        if (!confirm('운영자를 ' + (newVal ? '활성화' : '비활성화') + '하시겠습니까?')) return;

        const res = await api('/api/admin/operators', {
          method: 'PATCH',
          body: { id, operatorActive: newVal },
        });
        if (res.ok) {
          toast('운영자가 ' + (newVal ? '활성화' : '비활성화') + '되었습니다');
          loadOperators();
        } else {
          toast(res.data?.error || '변경 실패');
        }
        return;
      }

      const demoteBtn = e.target.closest('[data-op-action="demote"]');
      if (demoteBtn) {
        e.preventDefault();
        const id = Number(demoteBtn.dataset.opId);
        const name = demoteBtn.dataset.name;
        if (!confirm(name + '님을 일반 회원으로 강등하시겠습니까?\n(운영자 권한이 모두 해제됩니다)')) return;

        const res = await api('/api/admin/operators?id=' + id, { method: 'DELETE' });
        if (res.ok) {
          toast(res.data?.message || '강등 완료');
          loadOperators();
        } else {
          toast(res.data?.error || '강등 실패');
        }
      }
    });
  }
  /* ============ AI 추천 센터 ============ */
  async function loadAI() {
    const aiPanel = document.getElementById('adm-ai');
    if (!aiPanel) return;
    const matchPanel = aiPanel.querySelector('.row-2 .panel:first-child');
    if (matchPanel) {
      const cards = matchPanel.querySelectorAll('.ai-card');
      const res = await api('/api/admin/ai/match');
      if (res.ok && res.data?.data) {
        const recs = res.data.data.recommendations || [];
        const target = res.data.data.request;
        const subText = matchPanel.querySelector('p[style*="font-size:13px"]');
        if (subText) {
          if (target) {
            subText.innerHTML = '신청번호 <strong style="color:var(--ink)">' + escapeHtml(target.requestNo) +
              '</strong> (' + (SUPPORT_CAT_LABEL[target.category] || target.category) + ')에 대한 추천 봉사자';
          } else {
            subText.textContent = '대기 중인 신청이 없습니다';
          }
        }
        recs.forEach((rec, idx) => {
          const card = cards[idx];
          if (!card) return;
          const nameEl = card.querySelector('.ai-name');
          const scoreEl = card.querySelector('.ai-score');
          const descEl = card.querySelector('.ai-desc');
          if (nameEl) nameEl.textContent = rec.name;
          if (scoreEl) scoreEl.textContent = '매칭 ' + rec.score + '%';
          if (descEl) descEl.textContent = rec.memo;
        });
        cards.forEach((card, idx) => {
          card.style.display = idx < recs.length ? '' : 'none';
        });
      }
    }
    if (window.SIREN_CHARTS && typeof window.SIREN_CHARTS.initAIWithData === 'function') {
      setTimeout(() => window.SIREN_CHARTS.initAIWithData(), 100);
    }
  }

  /* ============ 로그인 ============ */
  function setupLoginForm() {
    const form = document.querySelector('#adminLogin form');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = (document.getElementById('adm_id') || {}).value || '';
      const pw = (document.getElementById('adm_pw') || {}).value || '';
      const submitBtn = form.querySelector('button[type="submit"]');
      const oldText = submitBtn ? submitBtn.textContent : '';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = '인증 중...';
      }
      try {
        const res = await api('/api/admin/login', {
          method: 'POST',
          body: { id: id.trim(), password: pw },
        });
        if (res.ok && res.data?.data) {
          CURRENT_ADMIN = res.data.data.admin;
          toast(res.data.message || '로그인되었습니다');

          const urlParams = new URLSearchParams(window.location.search);
          const service = urlParams.get('service');

          if (service === 'siren') {
            await fetchAdminMe();
            await showAdminPanel();
          } else {
            setTimeout(() => {
              window.location.href = '/admin-hub.html';
            }, 600);
          }
        } else {
          toast(res.data?.error || '인증 실패');
        }
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = oldText;
        }
      }
    });
  }

  async function fetchAdminMe() {
    const res = await api('/api/admin/me');
    if (res.ok && res.data?.data) {
      CURRENT_ADMIN = res.data.data.admin;
      CURRENT_KPI = res.data.data.kpi;
      return true;
    }
    CURRENT_ADMIN = null;
    CURRENT_KPI = null;
    return false;
  }

  /* ============ 사이드바 ============ */
  function setupSidebar() {
    document.addEventListener('click', (e) => {
      const link = e.target.closest('.adm-menu a[data-page]');
      if (!link) return;
      e.preventDefault();
      switchAdminPage(link.dataset.page, link);
    });
  }

  function switchAdminPage(page, linkEl) {
    document.querySelectorAll('.adm-menu a').forEach((a) => a.classList.remove('on'));
    if (linkEl) linkEl.classList.add('on');

    document.querySelectorAll('.adm-page').forEach((p) => p.classList.remove('show'));
    const target = document.getElementById('adm-' + page);
    if (target) target.classList.add('show');

    const titleEl = document.getElementById('admPageTitle');
    if (titleEl) titleEl.textContent = PAGE_TITLES[page] || '관리자';

    if (page === 'dashboard') {
      renderDashboardKPI();
      loadDashboardActivity();
      if (window.SIREN_CHARTS && typeof window.SIREN_CHARTS.initDashboardWithData === 'function') {
        setTimeout(() => window.SIREN_CHARTS.initDashboardWithData(), 100);
      }
    } else if (page === 'members') {
      loadMembers();
    } else if (page === 'donations') {
      loadDonations();
    } else if (page === 'support') {
      loadSupport();
    } else if (page === 'operators') {
      loadOperators();
    } else if (page === 'chat') {
      if (window.SIREN_ADMIN_CHAT) window.SIREN_ADMIN_CHAT.loadRoomList();
    } else if (page === 'content') {
      loadContent();
    } else if (page === 'receipt-settings') {
      loadReceiptSettings();
    } else if (page === 'hyosung') {       /* ★ L-8 추가 */
      loadHyosung();

    /* ★ M-10: 사이렌 관리 4개 페이지 */
    } else if (page === 'siren-incidents') {
      if (window.SIREN_ADMIN_SIREN) window.SIREN_ADMIN_SIREN.loadList('incident');
    } else if (page === 'siren-harassment') {
      if (window.SIREN_ADMIN_SIREN) window.SIREN_ADMIN_SIREN.loadList('harassment');
    } else if (page === 'siren-legal') {
      if (window.SIREN_ADMIN_SIREN) window.SIREN_ADMIN_SIREN.loadList('legal');
    } else if (page === 'siren-board') {
      if (window.SIREN_ADMIN_SIREN) window.SIREN_ADMIN_SIREN.loadList('board');

    } else if (page === 'audit') {

    } else if (page === 'audit') {
      _auditPage = 1;
      loadAudit();
    } else if (page === 'ai') {
      loadAI();
    }
  }

  /* ============ 로그아웃 ============ */
  function setupLogout() {
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action="admin-logout"]');
      if (!btn) return;
      e.preventDefault();
      await api('/api/admin/logout', { method: 'POST' });
      CURRENT_ADMIN = null;
      CURRENT_KPI = null;
      stopKpiPolling();
      toast('로그아웃되었습니다');
      setTimeout(() => location.href = '/index.html', 600);
    });

    document.addEventListener('click', (e) => {
      const exit = e.target.closest('[data-action="admin-exit"]');
      if (!exit) return;
      e.preventDefault();
      location.href = '/index.html';
    });
  }

  /* ============ 데모 액션 ============ */
  function setupDemoActions() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-demo-action]');
      if (!btn) return;
      if (btn.dataset.demoAction === 'bulk-receipt') return;
      e.preventDefault();
      toast(btn.dataset.demoMessage || '처리되었습니다');
    });
  }

  /* ============ 초기화 ============ */
    async function init() {
    setupLoginForm();
    setupSidebar();
    setupLogout();
    setupDemoActions();
    setupMemberActions();
    setupMemberSort();
    setupDonationActions();
    setupSupportActions();
    setupSupportReplyForm();
    setupInlineStatusChange();
    setupMemberInfoActions();
    setupPromoteSearch();
    setupPromotePick();
    setupPromoteConfirm();
    setupOperatorActions();
    setupReceiptSettings();
    setupExpertAssignClick();  /* ★ K-3 추가 */
    setupContentActions();     /* K-5 */
    setupNoticeEditForm();     /* K-5 */
    setupFaqEditForm();        /* K-5 */
    setupMemberSearch();       /* K-7 */
    setupAddMemberModal();     /* K-7 */
    setupTempPasswordCopy();   /* K-7 */
    setupDonationSearch();     /* K-8 */
    setupDonationRowActions(); /* K-8 */
    setupDonationDetailActions(); /* K-8 */
    setupAdminPasswordForm();  /* K-9 */
    setupHyosungActions();       /* ★ L-8 추가 */
    setupHyosungDetailActions(); /* ★ L-8 추가 */

    const isLogged = await fetchAdminMe();
    // ... 이하 기존 코드 그대로

    if (isLogged) {
      const urlParams = new URLSearchParams(window.location.search);
      const service = urlParams.get('service');

      if (service === 'siren') {
        await showAdminPanel();
      } else {
        window.location.href = '/admin-hub.html';
        return;
      }
    } else {
      showLogin();
    }
  }

  /* ============ 부트스트랩 ============ */
  (function bootstrap() {
    function go() {
      const login = document.getElementById('adminLogin');
      const wrap = document.getElementById('adminWrap');
      if (login && !login.classList.contains('show') &&
          (!wrap || !wrap.classList.contains('show'))) {
        login.classList.add('show');
      }
      init().catch((e) => console.error('[admin init]', e));
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', go);
    } else {
      go();
    }
  })();

})();