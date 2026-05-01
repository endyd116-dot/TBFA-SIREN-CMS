/* =========================================================
   SIREN — admin.js (v4 — 풀 동적 + AI 매칭)
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
    submitted: '<span class="badge b-info">접수</span>',
    reviewing: '<span class="badge b-warn">검토중</span>',
    supplement: '<span class="badge b-danger">보완요청</span>',
    matched: '<span class="badge b-info">매칭완료</span>',
    in_progress: '<span class="badge b-warn">진행중</span>',
    completed: '<span class="badge b-success">완료</span>',
    rejected: '<span class="badge b-mute">반려</span>',
  };

  let CURRENT_ADMIN = null;
  let CURRENT_KPI = null;

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
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
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

  /* ============ 화면 전환 ============ */
  function showLogin() {
    document.getElementById('adminLogin')?.classList.add('show');
    document.getElementById('adminWrap')?.classList.remove('show');
  }

  async function showAdminPanel() {
    document.getElementById('adminLogin')?.classList.remove('show');
    document.getElementById('adminWrap')?.classList.add('show');
    renderDashboardKPI();
    await loadDashboardActivity();
    /* 차트는 charts.js의 실 데이터 버전 호출 */
    if (window.SIREN_CHARTS && typeof window.SIREN_CHARTS.initDashboardWithData === 'function') {
      setTimeout(function () { window.SIREN_CHARTS.initDashboardWithData(); }, 150);
    }
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
    if (!res.ok || !res.data || !res.data.data) {
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
    tbody.innerHTML = recent.map(function (r) {
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
    if (!res.ok || !res.data || !res.data.data) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--danger)">조회 실패</td></tr>';
      return;
    }
    const list = res.data.data.list || [];
    const total = res.data.data.pagination ? res.data.data.pagination.total : 0;

    const kpis = panel.querySelectorAll('.kpi-value');
    if (kpis[0]) kpis[0].textContent = total.toLocaleString() + ' 명';
    if (kpis[1]) kpis[1].textContent = list.filter(function (m) { return m.type === 'family'; }).length + ' 명';
    if (kpis[2]) kpis[2].textContent = list.filter(function (m) { return m.status === 'pending'; }).length + ' 명';

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

    tbody.innerHTML = list.map(function (m) {
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
    document.addEventListener('click', async function (e) {
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
        body: { id: id, status: status },
      });
      if (res.ok) {
        toast('회원이 ' + label + '되었습니다');
        loadMembers();
      } else {
        toast(res.data && res.data.error ? res.data.error : '처리 실패');
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
    if (!res.ok || !res.data || !res.data.data) {
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

    tbody.innerHTML = list.map(function (d) {
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
    document.addEventListener('click', async function (e) {
      const btn = e.target.closest('[data-demo-action="bulk-receipt"]');
      if (!btn) return;
      e.preventDefault();

      const res = await api('/api/admin/donations?limit=100&status=completed');
      const allList = (res.data && res.data.data && res.data.data.list) ? res.data.data.list : [];
      const ids = allList.filter(function (d) { return !d.receiptIssued; }).map(function (d) { return d.id; });

      if (ids.length === 0) {
        toast('발행할 영수증이 없습니다');
        return;
      }

      const r = await api('/api/admin/donations', {
        method: 'PATCH',
        body: { ids: ids },
      });
      if (r.ok) {
        toast(r.data && r.data.message ? r.data.message : ids.length + '건 발행 완료');
        loadDonations();
      } else {
        toast('발행 실패');
      }
    });
  }

  /* ============ 콘텐츠 관리 (공지 + FAQ) ============ */
  async function loadContent() {
    const panel = document.getElementById('adm-content');
    if (!panel) return;

    /* 공지사항 */
    const noticeBody = panel.querySelector('table[data-content-tbl="notices"] tbody');
    if (noticeBody) {
      noticeBody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--text-3)">불러오는 중...</td></tr>';
      const nRes = await api('/api/notices?limit=50');
      const nList = (nRes.data && nRes.data.data && nRes.data.data.list) ? nRes.data.data.list : [];
      if (nList.length === 0) {
        noticeBody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--text-3)">공지사항이 없습니다</td></tr>';
      } else {
        const catMap = {
          general: '<span class="badge b-mute">일반</span>',
          member: '<span class="badge b-info">회원</span>',
          event: '<span class="badge b-warn">사업</span>',
          media: '<span class="badge b-success">언론</span>',
        };
        noticeBody.innerHTML = nList.map(function (n) {
          return '<tr>' +
            '<td>' + n.id + '</td>' +
            '<td>' + (catMap[n.category] || n.category) + '</td>' +
            '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(n.title) + '</td>' +
            '<td>' + (n.isPinned ? '📌' : '—') + '</td>' +
            '<td>' + (n.views || 0).toLocaleString() + '</td>' +
            '<td><button class="btn-link">수정</button></td>' +
            '</tr>';
        }).join('');
      }
    }

    /* FAQ */
    const faqBody = panel.querySelector('table[data-content-tbl="faqs"] tbody');
    if (faqBody) {
      faqBody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--text-3)">불러오는 중...</td></tr>';
      const fRes = await api('/api/faqs');
      const fList = (fRes.data && fRes.data.data && fRes.data.data.list) ? fRes.data.data.list : [];
      if (fList.length === 0) {
        faqBody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--text-3)">FAQ가 없습니다</td></tr>';
      } else {
        const catBadge = {
          general: '<span class="badge b-mute">일반</span>',
          donation: '<span class="badge b-warn">후원</span>',
          support: '<span class="badge b-info">지원</span>',
        };
        faqBody.innerHTML = fList.map(function (f) {
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

  /* ============ 지원 관리 ============ */
  async function loadSupport() {
    const panel = document.getElementById('adm-support');
    if (!panel) return;
    const tbody = panel.querySelector('table.tbl tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text-3)">불러오는 중...</td></tr>';

    const res = await api('/api/admin/support?limit=50');
    if (!res.ok || !res.data || !res.data.data) {
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

    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-3)">신청 내역이 없습니다</td></tr>';
      return;
    }

    tbody.innerHTML = list.map(function (s) {
      let actionBtns = '';
      if (s.status === 'submitted' || s.status === 'reviewing') {
        actionBtns += '<button class="btn-link" data-support-action="match" data-id="' + s.id + '">매칭</button> ';
        actionBtns += '<button class="btn-link" data-support-action="supplement" data-id="' + s.id + '" style="color:var(--warn)">보완요청</button>';
      } else if (s.status === 'matched' || s.status === 'in_progress') {
        actionBtns += '<button class="btn-link" data-support-action="complete" data-id="' + s.id + '">완료처리</button>';
      } else {
        actionBtns += '<button class="btn-link" data-support-action="view" data-id="' + s.id + '">상세</button>';
      }
      return '<tr>' +
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

  function setupSupportActions() {
    document.addEventListener('click', async function (e) {
      const btn = e.target.closest('[data-support-action]');
      if (!btn) return;
      e.preventDefault();
      const id = Number(btn.dataset.id);
      const action = btn.dataset.supportAction;

      if (action === 'match') {
        const expert = prompt('매칭할 전문가 이름을 입력하세요 (또는 AI 추천 활용)', '');
        if (!expert) return;
        const res = await api('/api/admin/support', {
          method: 'PATCH',
          body: { id: id, status: 'matched', assignedExpertName: expert },
        });
        if (res.ok) {
          toast('매칭이 완료되었습니다');
          loadSupport();
        } else {
          toast(res.data && res.data.error ? res.data.error : '처리 실패');
        }
      }
      else if (action === 'supplement') {
        const note = prompt('보완 요청 사유를 입력하세요', '');
        if (!note) return;
        const res = await api('/api/admin/support', {
          method: 'PATCH',
          body: { id: id, status: 'supplement', supplementNote: note },
        });
        if (res.ok) {
          toast('보완 요청이 전송되었습니다');
          loadSupport();
        } else {
          toast('처리 실패');
        }
      }
      else if (action === 'complete') {
        const report = prompt('완료 보고서 내용을 입력하세요', '지원 완료');
        if (!report) return;
        const res = await api('/api/admin/support', {
          method: 'PATCH',
          body: { id: id, status: 'completed', reportContent: report },
        });
        if (res.ok) {
          toast('완료 처리되었습니다');
          loadSupport();
        } else {
          toast('처리 실패');
        }
      }
      else if (action === 'view') {
        const res = await api('/api/admin/support?id=' + id);
        if (res.ok && res.data && res.data.data) {
          const r = res.data.data.request;
          alert('신청번호: ' + r.requestNo + '\n' +
                '제목: ' + r.title + '\n' +
                '내용:\n' + r.content);
        }
      }
    });
  }

  /* ============ AI 추천 센터 ============ */
  async function loadAI() {
    /* 1. 봉사자 매칭 */
    const aiPanel = document.getElementById('adm-ai');
    if (!aiPanel) return;
    const matchPanel = aiPanel.querySelector('.row-2 .panel:first-child');
    if (matchPanel) {
      const cards = matchPanel.querySelectorAll('.ai-card');
      const res = await api('/api/admin/ai/match');
      if (res.ok && res.data && res.data.data) {
        const recs = res.data.data.recommendations || [];
        const target = res.data.data.request;
        /* 신청 정보 표시 */
        const subText = matchPanel.querySelector('p[style*="font-size:13px"]');
        if (subText) {
          if (target) {
            subText.innerHTML = '신청번호 <strong style="color:var(--ink)">' + escapeHtml(target.requestNo) +
              '</strong> (' + (SUPPORT_CAT_LABEL[target.category] || target.category) + ')에 대한 추천 봉사자';
          } else {
            subText.textContent = '대기 중인 신청이 없습니다';
          }
        }
        /* 카드 갱신 */
        recs.forEach(function (rec, idx) {
          const card = cards[idx];
          if (!card) return;
          const nameEl = card.querySelector('.ai-name');
          const scoreEl = card.querySelector('.ai-score');
          const descEl = card.querySelector('.ai-desc');
          if (nameEl) nameEl.textContent = rec.name;
          if (scoreEl) scoreEl.textContent = '매칭 ' + rec.score + '%';
          if (descEl) descEl.textContent = rec.memo;
        });
        /* 카드가 추천보다 많으면 숨김 */
        cards.forEach(function (card, idx) {
          card.style.display = idx < recs.length ? '' : 'none';
        });
      }
    }

    /* 2. 차트 */
    if (window.SIREN_CHARTS && typeof window.SIREN_CHARTS.initAIWithData === 'function') {
      setTimeout(function () { window.SIREN_CHARTS.initAIWithData(); }, 100);
    }
  }
  
  /* ============ 로그인 ============ */
  /* ============ 로그인 ============ */
function setupLoginForm() {
  const form = document.querySelector('#adminLogin form');
  if (!form) return;
  form.addEventListener('submit', async function (e) {
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
      if (res.ok && res.data && res.data.data) {
        CURRENT_ADMIN = res.data.data.admin;
        toast(res.data.message || '로그인되었습니다');
        
        /* ★★★ 변경: 허브로 리다이렉트 (단, URL에 service 파라미터 있으면 유지) ★★★ */
        const urlParams = new URLSearchParams(window.location.search);
        const service = urlParams.get('service');
        
        if (service === 'siren') {
          // 허브에서 ①번 카드 통해 온 경우 → 기존 패널 표시
          await fetchAdminMe();
          await showAdminPanel();
        } else {
          // 일반 로그인 → 허브로 이동
          setTimeout(() => {
            window.location.href = '/admin-hub.html';
          }, 600);
        }
      } else {
        toast((res.data && res.data.error) ? res.data.error : '인증 실패');
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
    if (res.ok && res.data && res.data.data) {
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
    document.addEventListener('click', function (e) {
      const link = e.target.closest('.adm-menu a[data-page]');
      if (!link) return;
      e.preventDefault();
      switchAdminPage(link.dataset.page, link);
    });
  }

  function switchAdminPage(page, linkEl) {
    document.querySelectorAll('.adm-menu a').forEach(function (a) {
      a.classList.remove('on');
    });
    if (linkEl) linkEl.classList.add('on');

    document.querySelectorAll('.adm-page').forEach(function (p) {
      p.classList.remove('show');
    });
    const target = document.getElementById('adm-' + page);
    if (target) target.classList.add('show');

    const titleEl = document.getElementById('admPageTitle');
    if (titleEl) titleEl.textContent = PAGE_TITLES[page] || '관리자';

    /* 탭별 데이터 로딩 */
    if (page === 'dashboard') {
      renderDashboardKPI();
      loadDashboardActivity();
      if (window.SIREN_CHARTS && typeof window.SIREN_CHARTS.initDashboardWithData === 'function') {
        setTimeout(function () { window.SIREN_CHARTS.initDashboardWithData(); }, 100);
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
    document.addEventListener('click', async function (e) {
      const btn = e.target.closest('[data-action="admin-logout"]');
      if (!btn) return;
      e.preventDefault();
      await api('/api/admin/logout', { method: 'POST' });
      CURRENT_ADMIN = null;
      CURRENT_KPI = null;
      toast('로그아웃되었습니다');
      setTimeout(function () { location.href = '/index.html'; }, 600);
    });

    document.addEventListener('click', function (e) {
      const exit = e.target.closest('[data-action="admin-exit"]');
      if (!exit) return;
      e.preventDefault();
      location.href = '/index.html';
    });
  }

  /* ============ 데모 액션 (영수증 일괄은 별도 처리) ============ */
  function setupDemoActions() {
    document.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-demo-action]');
      if (!btn) return;
      if (btn.dataset.demoAction === 'bulk-receipt') return;
      e.preventDefault();
      toast(btn.dataset.demoMessage || '처리되었습니다');
    });
  }

  /* ============ 초기화 ============ */
  /* ============ 초기화 ============ */
async function init() {
  setupLoginForm();
  setupSidebar();
  setupLogout();
  setupDemoActions();
  setupMemberActions();
  setupDonationActions();
  setupSupportActions();

  const isLogged = await fetchAdminMe();
  if (isLogged) {
    /* ★★★ 변경: URL에 service 파라미터 있으면 패널 표시, 없으면 허브로 ★★★ */
    const urlParams = new URLSearchParams(window.location.search);
    const service = urlParams.get('service');
    
    if (service === 'siren') {
      await showAdminPanel();
    } else {
      // 이미 로그인된 상태에서 /admin.html 직접 접속 → 허브로 이동
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
      init().catch(function (e) { console.error('[admin init]', e); });
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', go);
    } else {
      go();
    }
  })();

})();