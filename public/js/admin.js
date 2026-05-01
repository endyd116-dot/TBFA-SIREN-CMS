/* =========================================================
   SIREN — admin.js (v5 — 지원 답변 모달 + 신규 뱃지)
   ========================================================= */
(function () {
  'use strict';

  /* ============ 상수 ============ */
  const PAGE_TITLES = {
    dashboard: '대시보드',
    members: '회원 관리',
    donations: '기부 관리',
    support: '지원 관리',
    ai: 'AI 추천 센터',
    content: '콘텐츠 관리',
    settings: '시스템 설정',
  };

  const SUPPORT_CAT_LABEL = {
    counseling: '심리상담',
    legal: '법률자문',
    scholarship: '장학사업',
    other: '기타',
  };

  const SUPPORT_STATUS_BADGE = {
    submitted: '<span class="badge b-info">🆕 접수</span>',
    reviewing: '<span class="badge b-warn">검토중</span>',
    supplement: '<span class="badge b-danger">보완요청</span>',
    matched: '<span class="badge b-info">매칭완료</span>',
    in_progress: '<span class="badge b-warn">진행중</span>',
    completed: '<span class="badge b-success">완료</span>',
    rejected: '<span class="badge b-mute">반려</span>',
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
    return String(s || '').replace(/[&<>"']/g, (c) =>
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
    return formatDate(iso) + ' ' +
      String(d.getHours()).padStart(2, '0') + ':' +
      String(d.getMinutes()).padStart(2, '0');
  }

  function fmtMoney(n) {
    return '₩ ' + (Number(n || 0) / 1_000_000).toFixed(1) + 'M';
  }

  /* ============ 🆕 신규 뱃지 (사이드바) ============ */
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

  /* 관리자 KPI 주기적 갱신 (60초) — 뱃지 자동 업데이트 */
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

  /* ============ 대시보드 최근 활동 ============ */
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
        '<td>' + escapeHtml(m.name) + '</td>' +
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

    /* 공지 */
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

    /* FAQ */
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

  /* ============ 🆕 지원 관리 + 답변 모달 ============ */
  async function loadSupport() {
    const panel = document.getElementById('adm-support');
    if (!panel) return;
    const tbody = panel.querySelector('table.tbl tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text-3)">불러오는 중...</td></tr>';

    const res = await api('/api/admin/support?limit=50');
    if (!res.ok || !res.data?.data) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--danger)">조회 실패</td></tr>';
      return;
    }
    const list = res.data.data.list || [];
    const stats = res.data.data.stats || {};

    /* KPI */
    const kpis = panel.querySelectorAll('.kpi-value');
    if (kpis[0]) kpis[0].textContent = (stats.submitted || 0) + ' 건';
    if (kpis[1]) kpis[1].textContent = (stats.inProgress || 0) + ' 건';
    if (kpis[2]) kpis[2].textContent = (stats.completed || 0) + ' 건';
    if (kpis[3]) kpis[3].textContent = (stats.avgDays || 0) + ' 일';

    /* 사이드바 뱃지 동기화 */
    updateSupportBadge(stats.submitted || 0);

    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-3)">신청 내역이 없습니다</td></tr>';
      return;
    }

    tbody.innerHTML = list.map((s) => {
      /* 신규(submitted) 행 강조 */
      const rowAttr = s.status === 'submitted'
        ? ' style="background:#fff8ec"'
        : '';
      /* 모든 행에 "상세/답변" 버튼 추가 → 모달 오픈 */
      const actionBtns = '<button class="btn-link" data-support-action="open" data-id="' + s.id + '">📝 상세/답변</button>';

      return '<tr' + rowAttr + '>' +
        '<td>' + escapeHtml(s.requestNo) + '</td>' +
        '<td>' + (SUPPORT_CAT_LABEL[s.category] || s.category) + '</td>' +
        '<td>유가족 #' + s.memberId + '</td>' +
        '<td>' + formatDate(s.createdAt) + '</td>' +
        '<td>' + escapeHtml(s.assignedExpertName || '—') + '</td>' +
        '<td>' + (SUPPORT_STATUS_BADGE[s.status] || s.status) + '</td>' +
        '<td>' + actionBtns + '</td>' +
        '</tr>';
    }).join('');
  }

  /* 지원 행 → 모달 오픈 */
  async function openSupportModal(id) {
    const modal = document.getElementById('supportDetailModal');
    if (!modal) return toast('모달 요소를 찾을 수 없습니다');

    const res = await api('/api/admin/support?id=' + id);
    if (!res.ok || !res.data?.data) {
      return toast('상세 조회 실패');
    }
    const r = res.data.data.request;
    const requester = res.data.data.requester || {};

    /* 폼 데이터 채우기 */
    document.getElementById('replyId').value = r.id;

    const infoEl = document.getElementById('detail-info');
    if (infoEl) {
      infoEl.innerHTML =
        '<strong>' + escapeHtml(r.requestNo) + '</strong> · ' +
        escapeHtml(requester.name || '알 수 없음') +
        (requester.email ? ' (' + escapeHtml(requester.email) + ')' : '') +
        ' · ' + (SUPPORT_CAT_LABEL[r.category] || r.category) +
        ' · 접수 ' + formatDate(r.createdAt);
    }

    const titleEl = document.getElementById('detail-title');
    if (titleEl) titleEl.textContent = r.title || '';

    const contentEl = document.getElementById('detail-content');
    if (contentEl) contentEl.textContent = r.content || '';

    /* 첨부파일 */
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

    /* 상태 select / 답변 내용 채우기 */
    const statusSel = document.getElementById('replyStatus');
    if (statusSel) statusSel.value = r.status || 'submitted';

    const noteEl = document.getElementById('replyNote');
    if (noteEl) noteEl.value = r.adminNote || '';

    /* 메일 발송 체크박스는 항상 OFF로 초기화 */
    const sendEmailEl = document.getElementById('replySendEmail');
    if (sendEmailEl) sendEmailEl.checked = false;

    modal.classList.add('show');
  }

  /* 지원 답변 폼 제출 */
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
          /* KPI도 즉시 갱신 (뱃지 반영) */
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
      const id = Number(btn.dataset.id);
      const action = btn.dataset.supportAction;

      if (action === 'open' || action === 'view') {
        openSupportModal(id);
      }
      /* 'match', 'supplement', 'complete'는 모달로 통합되었음 */
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

  /* ============ 사이드바 라우팅 ============ */
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
    } else if (page === 'content') {
      loadContent();
    } else if (page === 'ai') {
      loadAI();
    }
  }

  /* ============ 로그아웃 / 사이트 복귀 ============ */
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
    setupSupportReplyForm(); // ★ 신규: 답변 모달 폼

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

  /* ============ 강제 부트스트랩 ============ */
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