/* =========================================================
   SIREN — admin.js (v8 — STEP H-2d-3 영수증 설정 + I-3 블랙리스트 연동)
   ========================================================= */
(function () {
  'use strict';

  /* ============ 상수 ============ */
  const PAGE_TITLES = {
    dashboard: '대시보드',
    members: '회원 관리',
    donations: '기부 관리',
    support: '지원 관리',
    operators: '운영자 관리',
    chat: '채팅 관리',    
    ai: 'AI 추천 센터',
    content: '콘텐츠 관리',
    'receipt-settings': '영수증 설정',
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

  let CURRENT_ADMIN = null;
  let CURRENT_KPI = null;
  let _kpiPollTimer = null;

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
    }, 60000);
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

  /* ============ 회원 관리 ============ */
  async function loadMembers() {
    const panel = document.getElementById('adm-members');
    if (!panel) return;
    const tbody = panel.querySelector('table.tbl tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--text-3)">불러오는 중...</td></tr>';

    const res = await api('/api/admin/members?limit=50');
    if (!res.ok || !res.data?.data) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--danger)">조회 실패</td></tr>';
      return;
    }
    const list = res.data.data.list || [];
    const total = res.data.data.pagination ? res.data.data.pagination.total : 0;

    const kpis = panel.querySelectorAll('.kpi-value');
    if (kpis[0]) kpis[0].textContent = total.toLocaleString() + ' 명';
    if (kpis[1]) kpis[1].textContent = list.filter((m) => m.type === 'family').length + ' 명';
    if (kpis[2]) kpis[2].textContent = list.filter((m) => m.status === 'pending').length + ' 명';

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

  /* ============ 기부 관리 ============ */
  async function loadDonations() {
    const panel = document.getElementById('adm-donations');
    if (!panel) return;
    const tbody = panel.querySelector('table.tbl tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text-3)">불러오는 중...</td></tr>';

    const res = await api('/api/admin/donations?limit=50');
    if (!res.ok || !res.data?.data) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--danger)">조회 실패</td></tr>';
      return;
    }
    const list = res.data.data.list || [];
    const stats = res.data.data.stats || {};

    const kpis = panel.querySelectorAll('.kpi-value');
    if (kpis[0]) kpis[0].textContent = fmtMoney(stats.today);
    if (kpis[1]) kpis[1].textContent = fmtMoney(stats.month);
    if (kpis[2]) kpis[2].textContent = (stats.failedCount || 0) + ' 건';
    if (kpis[3]) kpis[3].textContent = (stats.receiptPendingCount || 0) + ' 건';

    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-3)">결제 내역이 없습니다</td></tr>';
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
      return '<tr>' +
        '<td>' + formatDateTime(d.createdAt) + '</td>' +
        '<td>' + escapeHtml(d.donorName) + '</td>' +
        '<td>' + (typeMap[d.type] || d.type) + '</td>' +
        '<td>₩ ' + (d.amount || 0).toLocaleString() + '</td>' +
        '<td>' + (payMap[d.payMethod] || d.payMethod) + '</td>' +
        '<td style="font-family:Inter;font-size:11px">' + escapeHtml(txn) + '</td>' +
        '<td>' + (statusMap[d.status] || d.status) + '</td>' +
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

  /* ============ 콘텐츠 관리 ============ */
  async function loadContent() {
    const panel = document.getElementById('adm-content');
    if (!panel) return;

    const noticeBody = panel.querySelector('table[data-content-tbl="notices"] tbody');
    if (noticeBody) {
      noticeBody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--text-3)">불러오는 중...</td></tr>';
      const nRes = await api('/api/notices?limit=50');
      const nList = nRes.data?.data?.list || [];
      if (nList.length === 0) {
        noticeBody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--text-3)">공지사항이 없습니다</td></tr>';
      } else {
        const catMap = {
          general: '<span class="badge b-mute">일반</span>',
          member: '<span class="badge b-info">회원</span>',
          event: '<span class="badge b-warn">사업</span>',
          media: '<span class="badge b-success">언론</span>',
        };
        noticeBody.innerHTML = nList.map((n) =>
          '<tr>' +
          '<td>' + n.id + '</td>' +
          '<td>' + (catMap[n.category] || n.category) + '</td>' +
          '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(n.title) + '</td>' +
          '<td>' + (n.isPinned ? '📌' : '—') + '</td>' +
          '<td>' + (n.views || 0).toLocaleString() + '</td>' +
          '<td><button class="btn-link">수정</button></td>' +
          '</tr>'
        ).join('');
      }
    }

    const faqBody = panel.querySelector('table[data-content-tbl="faqs"] tbody');
    if (faqBody) {
      faqBody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--text-3)">불러오는 중...</td></tr>';
      const fRes = await api('/api/faqs');
      const fList = fRes.data?.data?.list || [];
      if (fList.length === 0) {
        faqBody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--text-3)">FAQ가 없습니다</td></tr>';
      } else {
        const catBadge = {
          general: '<span class="badge b-mute">일반</span>',
          donation: '<span class="badge b-warn">후원</span>',
          support: '<span class="badge b-info">지원</span>',
        };
        faqBody.innerHTML = fList.map((f) => {
          const activeIcon = f.isActive !== false
            ? '<span style="color:var(--success)">●</span>'
            : '<span style="color:var(--text-3)">●</span>';
          return '<tr>' +
            '<td>' + f.id + '</td>' +
            '<td>' + (catBadge[f.category] || f.category) + '</td>' +
            '<td style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(f.question) + '</td>' +
            '<td>' + activeIcon + '</td>' +
            '<td>' + (f.sortOrder || 0) + '</td>' +
            '<td><button class="btn-link">수정</button></td>' +
            '</tr>';
        }).join('');
      }
    }
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

    const attachEl = document.getElementById('detail-attachments');
    if (attachEl) {
      let attaches = [];
      try { attaches = r.attachments ? JSON.parse(r.attachments) : []; } catch (e) {}
      if (Array.isArray(attaches) && attaches.length > 0) {
        attachEl.innerHTML =
          '<span class="support-detail-label">첨부파일 (' + attaches.length + '건)</span>' +
          '<div style="font-size:13px;color:var(--text-2);line-height:1.8">' +
          attaches.map((k) => '📎 ' + escapeHtml(String(k))).join('<br />') +
          '</div>';
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
        return '<div style="background:#fff;border:1px solid var(--line);border-radius:6px;padding:12px 14px;margin-bottom:8px">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
          '<div>' +
          '<strong style="font-size:13.5px">' + escapeHtml(r.name) + '</strong> ' +
          '<span style="color:var(--text-2);font-size:11.5px">· ' + escapeHtml(r.role) + '</span>' +
          '</div>' +
          '<span style="background:' + scoreColor + ';color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px">' +
          '매칭 ' + r.score + '%</span>' +
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

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const id = Number(document.getElementById('replyId').value);
      const status = document.getElementById('replyStatus').value;
      const adminNote = (document.getElementById('replyNote').value || '').trim();
      const sendEmail = document.getElementById('replySendEmail')?.checked === true;

      if (!id) return toast('신청 ID 없음');
      if (sendEmail && !adminNote) {
        return toast('메일 발송 시 답변 내용을 입력해 주세요');
      }

      const submitBtn = form.querySelector('button[type="submit"]');
      const oldText = submitBtn ? submitBtn.textContent : '';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = '처리 중...';
      }

      try {
        const res = await api('/api/admin/support', {
          method: 'PATCH',
          body: { id, status, adminNote, sendEmail },
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

  /* ============ ★ 회원 정보 팝업 (★ I-3 블랙/메모 연동) ============ */
  async function openMemberInfoModal(memberId) {
    const modal = document.getElementById('memberInfoModal');
    const body = document.getElementById('memberInfoBody');
    if (!modal || !body) return toast('모달 요소를 찾을 수 없습니다');

    body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-3)">로딩 중...</div>';
    modal.classList.add('show');

    const res = await api('/api/admin/member-detail?id=' + memberId);
    if (!res.ok || !res.data?.data) {
      body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--danger)">조회 실패</div>';
      return;
    }
    /* ★ I-3: blacklist + chatMemos 추가 추출 */
    const { member, donationSummary, supportSummary, blacklist, chatMemos } = res.data.data;

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

    /* 최근 지원 신청 */
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

    /* ★ I-3: 블랙리스트 박스 (있을 때만) */
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

    /* ★ I-3: 채팅 관리자 메모 목록 (있을 때만) */
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

    body.innerHTML =
      blacklistBlock +
      '<div class="member-info-grid">' +
      '<div>이름</div><div><strong>' + escapeHtml(member.name) + '</strong> ' + (typeBadge[member.type] || member.type) + ' ' + (statusBadge[member.status] || member.status) + '</div>' +
      '<div>이메일</div><div>' + escapeHtml(member.email) + (member.emailVerified ? ' <span style="color:var(--success);font-size:11px">✓ 인증됨</span>' : '') + '</div>' +
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

      '<div style="margin-bottom:14px">' +
      '<div class="support-detail-label">최근 후원 내역</div>' +
      '<div class="mini-list">' + recentDonationHtml + '</div>' +
      '</div>' +

      '<div>' +
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

    /* ★ I-3: 모달 내 액션 (블랙 해지 / 채팅 이동) */
    document.addEventListener('click', async (e) => {
      /* 블랙 해지 버튼 */
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
          /* 모달 새로고침 */
          openMemberInfoModal(memberId);
          /* 채팅 화면도 동기화 (열려 있으면) */
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

      /* 채팅 메모 행 클릭 → 채팅 관리 페이지로 이동 + 해당 방 열기 */
      const chatRow = e.target.closest('[data-mi-action="goto-chat"]');
      if (chatRow) {
        e.preventDefault();
        e.stopPropagation();
        const roomId = Number(chatRow.dataset.miRoom);
        if (!roomId) return;

        /* 회원 정보 모달 닫기 */
        document.getElementById('memberInfoModal')?.classList.remove('show');

        /* 채팅 관리 페이지로 전환 */
        const chatLink = document.querySelector('.adm-menu a[data-page="chat"]');
        if (chatLink) {
          switchAdminPage('chat', chatLink);
          /* 약간 딜레이 후 해당 방 선택 */
          setTimeout(() => {
            if (window.SIREN_ADMIN_CHAT && typeof window.SIREN_ADMIN_CHAT.selectRoom === 'function') {
              window.SIREN_ADMIN_CHAT.selectRoom(roomId);
            }
          }, 300);
        }
        return;
      }
    });
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

    const isLogged = await fetchAdminMe();

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