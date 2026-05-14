/* =========================================================
   SIREN — CMS TBFA (교유협 통합 관리)
   데모 데이터 기반, 향후 실 API 연동 가능하게 구조화
   ★ STEP H-2d-4: 영수증 설정 메뉴 추가 (사이렌 관리자와 자동 동기화)
   ========================================================= */
(function() {
  'use strict';

  /* ============ API 헬퍼 ============ */
  async function api(path, options = {}) {
    try {
      const res = await fetch(path, {
        method: options.method || 'GET',
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        credentials: 'include',
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      return { status: res.status, ok: res.ok && data.ok !== false, data };
    } catch (e) {
      return { status: 0, ok: false, data: { error: '네트워크 오류' } };
    }
  }

  /* ============ 토스트 ============ */
  function toast(msg, ms = 2400) {
    const t = document.getElementById('cmsToast');
    if (!t) return alert(msg);
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(window._cmsT);
    window._cmsT = setTimeout(() => t.classList.remove('show'), ms);
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
    );
  }

  function formatDate(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    return d.getFullYear() + '.' +
      String(d.getMonth() + 1).padStart(2, '0') + '.' +
      String(d.getDate()).padStart(2, '0');
  }

  /* ★ STEP H-2d-4: 날짜+시간 포맷터 (영수증 설정용) */
  function formatDateTime(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    return d.getFullYear() + '.' +
      String(d.getMonth() + 1).padStart(2, '0') + '.' +
      String(d.getDate()).padStart(2, '0') + ' ' +
      String(d.getHours()).padStart(2, '0') + ':' +
      String(d.getMinutes()).padStart(2, '0');
  }

  /* =========================================================
     Phase 1 단계 B — 진짜 회원 데이터 연동 (B 머지 후 mock 제거 완료)
     - DEMO_MEMBERS·DEMO_WEB_DONORS·DEMO_TAGS 제거 (#BUG-2 해결 지점)
     - API 계약: docs/DESIGN_PHASE1.md §6.2
     - 응답 구조: ok() 헬퍼 wrap → res.data = { ok, message, data: { ... payload ... } }
     ========================================================= */

  /* ============ 회원 명단 fetch (DESIGN_PHASE1.md §6.2) ============ */
  // 응답 페이로드 unwrap — ok() 헬퍼 wrap이면 한 단계 더 내려감.
  // 직접 페이로드(미래 변경)에도 호환되도록 마커(target keys) 검사 fallback.
  function unwrap(resData, markerKeys) {
    const outer = resData || {};
    if (outer.data && typeof outer.data === 'object') {
      const inner = outer.data;
      const hasMarker = markerKeys.some(k => inner[k] !== undefined);
      if (hasMarker) return inner;
    }
    return outer;
  }

  async function fetchMembers(query = {}) {
    const qs = new URLSearchParams();
    Object.entries(query).forEach(([k, v]) => { if (v !== '' && v != null) qs.set(k, v); });
    const res = await api('/api/admin/members?' + qs.toString());
    if (!res.ok) throw new Error(res.data?.error || ('HTTP ' + res.status));
    // §6.2 병행 응답: data·list 둘 다 동일 데이터, page/pageSize/total + pagination
    const payload = unwrap(res.data, ['data', 'list', 'pagination', 'total']);
    const items = payload.data || payload.list || [];
    const pg = payload.pagination || {};
    return {
      ok: true,
      data: items,
      page: payload.page ?? pg.page ?? 1,
      pageSize: payload.pageSize ?? pg.pageSize ?? 50,
      total: payload.total ?? pg.total ?? 0,
    };
  }

  /* ============ 회원별 후원 이력 fetch ============ */
  async function fetchMemberDonations(memberId, query = {}) {
    const qs = new URLSearchParams({ memberId: String(memberId) });
    if (query.page) qs.set('page', String(query.page));
    if (query.pageSize) qs.set('pageSize', String(query.pageSize));
    const res = await api('/api/admin/member-donations?' + qs.toString());
    if (!res.ok) throw new Error(res.data?.error || ('HTTP ' + res.status));
    const payload = unwrap(res.data, ['data', 'member', 'totalCount', 'totalAmount']);
    return {
      ok: true,
      member: payload.member || { id: memberId, name: '' },
      data: payload.data || [],
      totalCount: payload.totalCount || 0,
      totalAmount: payload.totalAmount || 0,
      page: payload.page || 1,
      pageSize: payload.pageSize || 30,
    };
  }

  /* ★ Phase 3 D3: 통합 회원 효성 계약 셀 렌더 (2줄 보강 — 약정일·결제수단·등록상태·계약상태·상품분류) */
  function renderHyosungContractCell(m) {
    const hy = m.hyosung;
    if (!hy) return '<span style="color:#d0d0d0;font-size:12px">—</span>';

    const contractBadge = hy.contractStatus === '사용'
      ? '<span class="cms-badge cms-b-success" style="font-size:10.5px">사용</span>'
      : hy.contractStatus === '중지'
      ? '<span class="cms-badge cms-b-mute" style="font-size:10.5px">중지</span>'
      : `<span class="cms-badge cms-b-warn" style="font-size:10.5px">${escapeHtml(hy.contractStatus || '?')}</span>`;

    const reg = hy.registrationStatus
      ? `<span class="cms-badge cms-b-info" style="font-size:10px;margin-left:3px" title="결제 등록 상태">${escapeHtml(hy.registrationStatus)}</span>`
      : '';

    const day = hy.promiseDay ? `${hy.promiseDay}일 약정` : '';
    const method = hy.paymentMethod ? escapeHtml(hy.paymentMethod) : '';
    const product = hy.productName ? escapeHtml(hy.productName) : '';
    const line2Parts = [day, method, product].filter(Boolean).join(' · ');

    return `
      <div style="line-height:1.4">
        <div>${contractBadge}${reg}</div>
        ${line2Parts ? `<div style="font-size:10.5px;color:#666;margin-top:2px">${line2Parts}</div>` : ''}
      </div>
    `;
  }

  /* ============ 가입경로/후원 상태 라벨 (5종 enum + null — §6.2) ============ */
  const SIGNUP_SOURCE_LABEL = {
    siren:   { icon: '🌐', text: '싸이렌', cls: 'cms-b-info' },
    hyosung: { icon: '🏦', text: '효성',   cls: 'cms-b-warn' },
    manual:  { icon: '✍️', text: '수기',   cls: 'cms-b-mute' },
    event:   { icon: '🎪', text: '이벤트', cls: 'cms-b-success' },
    etc:     { icon: '📦', text: '기타',   cls: 'cms-b-mute' },
  };
  const DONOR_TYPE_LABEL = {
    regular:  { icon: '🔁', text: '정기',   cls: 'cms-b-success' },
    prospect: { icon: '💡', text: '잠재',   cls: 'cms-b-warn' },
    none:     { icon: '—',  text: '비후원', cls: 'cms-b-mute' },
  };

  function renderSignupSourceBadge(member) {
    const src = member.signupSource;
    if (!src) {
      // DB 코드 자체 없는 경우 — DESIGN §6.2 라인 153: 회색 '─'
      return `<span class="cms-badge cms-b-mute" title="가입경로 미상" style="color:#8a8a8a">─</span>`;
    }
    const meta = SIGNUP_SOURCE_LABEL[src];
    const label = member.signupSourceLabel || (meta ? meta.text : src);
    const icon = meta ? meta.icon : '·';
    const cls = meta ? meta.cls : 'cms-b-mute';
    return `<span class="cms-badge ${cls}" title="${escapeHtml(label)}">${icon} ${escapeHtml(label)}</span>`;
  }
  function renderDonorTypeBadge(member) {
    const meta = DONOR_TYPE_LABEL[member.donorType] || DONOR_TYPE_LABEL.none;
    return `<span class="cms-badge ${meta.cls}" title="${escapeHtml(meta.text)}">${meta.icon} ${escapeHtml(meta.text)}</span>`;
  }

  /* 상태 — Phase 1: 서버 페이지네이션·필터 */
  let allMembers = [];      // 현재 페이지 회원만 보관 (리스트 렌더용)
  let allWebDonors = [];    // 단계 B 영역 외 — 빈 상태로 둠 (placeholder)
  let selectedTransferIds = new Set();
  let importedData = null;
  let memberPage = 1;
  let memberPageSize = 50;
  let memberTotal = 0;
  let memberQuery = { source: 'all', donorType: 'all', q: '' };
  let memberSearchTimer = null;

  /* ============ 관리자 인증 확인 ============ */
  async function checkAuth() {
    const res = await api('/api/admin/me');
    if (!res.ok || !res.data?.data) {
      location.href = '/admin.html';
      return null;
    }
    return res.data.data;
  }

  /* ============ 탭 전환 ============ */
  function setupTabs() {
    document.querySelectorAll('.cms-menu a[data-tab]').forEach(a => {
      a.addEventListener('click', e => {
        e.preventDefault();
        const tab = a.dataset.tab;
        
        document.querySelectorAll('.cms-menu a').forEach(x => x.classList.remove('on'));
        a.classList.add('on');
        
        document.querySelectorAll('.cms-page').forEach(p => p.classList.remove('show'));
        const target = document.getElementById('page-' + tab);
        if (target) target.classList.add('show');

        const titles = {
          dashboard: '대시보드',
          members: '통합 일반 회원',
          'donor-regular': '🔁 정기 후원자 관리',
          'donor-prospect': '💡 예비 후원자 관리',
          'donor-potential': '🌱 잠재 후원자 관리',
          'notify-send': '📨 알림 발송',
          'send-jobs': '📤 발송 작업',
          'send-template': '📝 발송 템플릿',
          'recipient-groups': '👥 수신자 그룹',
          'auto-trigger': '🤖 AI 자동 발송',
          'send-analytics': '📊 발송 분석',
          import: '외부 등록',
          transfer: '웹 후원자 이관',
          tags: '태그 관리',
          export: '데이터 추출',
          'receipt-settings': '영수증 설정',
          hyosung: '효성 CMS+ 관리',
          'toss-billing': '💳 토스 빌링 (자동 청구)',
          'donations': '💳 후원 결제 내역',
          'finance-income': '📈 수입 현황',
          'other-revenues': '💼 후원 외 매출',
          'expenses': '💸 지출 관리',
          'finance-budget': '📋 예산 관리',
          'bank-transactions': '🏦 통장 거래내역',
          'finance-report': '📊 재무 보고서',
          'csv-import': '📥 CSV 종합 검증 매핑 (효성 + 기업은행 + 토스)',
          'donation-dashboard': '🔍 종합 검증 대시보드',
          'ai-chat':    '🤖 AI 비서 — 대화 시작',
          'ai-history': '📜 AI 비서 — 대화 이력',
          'ai-cost':    '💰 AI 비서 — 비용 관리',
          'ai-logs':    '📊 AI 비서 — 도구 사용 로그',
          'ai-config':  '⚙️ AI 비서 — 설정·도구 관리',
        };
        const titleEl = document.getElementById('cmsPageTitle');
        if (titleEl) titleEl.textContent = titles[tab] || '교유협 CMS';

        /* 탭별 데이터 로딩 */
        if (tab === 'dashboard') renderDashboard();
        else if (tab === 'members') renderMembers();
        else if (tab === 'transfer') renderTransfer();
        else if (tab === 'tags') renderTags();
        else if (tab === 'receipt-settings') loadReceiptSettings(); /* ★ STEP H-2d-4 */
        else if (tab === 'hyosung') loadHyosungContracts(); /* ★ Phase 1 */
        else if (tab === 'toss-billing') loadTbKeys(); /* ★ Phase 2 */
        else if (tab === 'donor-regular') renderDonorRegular(); /* ★ Phase 2 C10 */
        else if (tab === 'donor-prospect') renderDonorProspect();
        else if (tab === 'donor-potential') renderPotentialDonor();
        else if (tab === 'notify-send') renderNotifySend();
        else if (tab === 'send-jobs') renderSendJobs();
        else if (tab === 'send-template') renderSendTemplate();
        else if (tab === 'recipient-groups') renderRecipientGroups();
        else if (tab === 'auto-trigger') renderAutoTrigger();
        else if (tab === 'send-analytics') renderSendAnalytics();
        else if (tab === 'csv-import') {
          /* ★ 작업 C(#15): CSV 자동 매핑 — 별도 모듈에서 init */
          if (window.CsvImport && typeof window.CsvImport.init === 'function') {
            window.CsvImport.init();
          }
        }
        else if (tab === 'donation-dashboard') renderDonationDashboard(); /* ★ Phase 3 D7 */
        /* ★ Phase 22-B-R1: 재정 관리 (admin.html에서 이전) */
        else if (tab === 'donations') {
          if (window.SIREN_DONATIONS) window.SIREN_DONATIONS.load();
        }
        else if (tab === 'finance-income') {
          if (window.SIREN_FINANCE_INCOME) window.SIREN_FINANCE_INCOME.load();
        }
        else if (tab === 'other-revenues') {
          if (window.SIREN_OTHER_REVENUES) window.SIREN_OTHER_REVENUES.load();
        }
        else if (tab === 'expenses') {
          if (window.SIREN_EXPENSES) window.SIREN_EXPENSES.load();
        }
        else if (tab === 'finance-budget') {
          if (window.SIREN_FINANCE_BUDGET) {
            const _fb = document.getElementById('page-finance-budget');
            if (_fb && !_fb.firstElementChild) window.SIREN_FINANCE_BUDGET.init();
            else window.SIREN_FINANCE_BUDGET.load();
          }
        }
        else if (tab === 'finance-report') {
          if (window.SIREN_FINANCE_REPORT) {
            const _fr = document.getElementById('page-finance-report');
            if (_fr && !_fr.firstElementChild) window.SIREN_FINANCE_REPORT.init();
            else window.SIREN_FINANCE_REPORT.load();
          }
        }
        else if (tab === 'bank-transactions') {
          if (window.SIREN_BANK_TXN) {
            const _bt = document.getElementById('page-bank-transactions');
            if (_bt && !_bt.firstElementChild) window.SIREN_BANK_TXN.init();
            else window.SIREN_BANK_TXN.load();
          }
        }
        /* ★ AI 에이전트 5개 섹션 (ai-cost 추가) */
        else if (tab === 'ai-chat')    renderAiChat();
        else if (tab === 'ai-history') renderAiHistory();
        else if (tab === 'ai-cost')    _nfLoadIframe('page-ai-cost');
        else if (tab === 'ai-logs')    renderAiLogs();
        else if (tab === 'ai-config')  _nfLoadIframe('page-ai-config');  /* iframe으로 교체됨 */
      });
    });

    /* ★ Phase 1: 계층 메뉴 토글 */
    document.querySelectorAll('[data-toggle]').forEach(toggle => {
      toggle.addEventListener('click', e => {
        e.preventDefault();
        const group = toggle.closest('.cms-menu-group');
        const submenu = group?.querySelector('.cms-submenu');
        if (!submenu) return;
        const isOpen = group.classList.contains('open');
        group.classList.toggle('open', !isOpen);
        submenu.style.display = isOpen ? 'none' : 'block';
      });
    });

    /* ★ Phase 1: 서브메뉴 항목 클릭 시 상위 그룹도 active */
    document.querySelectorAll('.cms-submenu a[data-tab]').forEach(a => {
      a.addEventListener('click', () => {
        const group = a.closest('.cms-menu-group');
        if (group) {
          group.classList.add('open');
          const submenu = group.querySelector('.cms-submenu');
          if (submenu) submenu.style.display = 'block';
        }
      });
    });
  }

  /* ============ 1. 대시보드 (Phase 1: 진짜 회원 기반 단순 KPI) ============ */
  async function renderDashboard() {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };

    // 전체 회원 카운트 + 첫 페이지 데이터로 가입경로 분포 추정
    let resp;
    try {
      resp = await fetchMembers({ source: 'all', donorType: 'all', page: 1, pageSize: memberPageSize });
    } catch (err) {
      console.warn('[dashboard] members fetch fail', err);
      ['kpiTotal','kpiNew','kpiFamily','kpiDonor','kpiRegular','kpiOnetime','kpiVolunteer','srcWeb','srcExcel','srcManual']
        .forEach(id => set(id, '—'));
      return;
    }

    const rows = resp.data || [];
    const total = resp.total || 0;
    memberTotal = total;

    set('kpiTotal', total.toLocaleString() + '명');
    set('kpiNew', '—');                 // Phase 1: 별도 집계 API 없음
    set('kpiFamily', '—');               // 단계 C에서 본격
    set('kpiDonor', '—');
    set('kpiRegular', '—');
    set('kpiOnetime', '—');
    set('kpiVolunteer', '—');

    const srcSiren  = rows.filter(m => m.signupSource === 'siren').length;
    const srcHyo    = rows.filter(m => m.signupSource === 'hyosung').length;
    // 'manual' + 'event' + 'etc' 합산 (5종 enum 도입 후 분류)
    const srcOther  = rows.filter(m => ['manual', 'event', 'etc'].includes(m.signupSource)).length;
    set('srcWeb',    srcSiren + '명');
    set('srcExcel',  srcHyo + '명');
    set('srcManual', srcOther + '명');

    // 차트 (Phase 1: 가입경로 분포로 임시 — 회원 유형 차원 없음)
    renderMemberTypeChart([srcSiren, srcHyo, srcOther]);

    // 최근 회원 활동: 현재 페이지의 가장 최신 5명
    const tbody = document.getElementById('recentActivityBody');
    if (tbody) {
      const recent = [...rows].sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5);
      if (recent.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:30px;color:#888">최근 활동이 없습니다</td></tr>`;
      } else {
        tbody.innerHTML = recent.map(m => `
          <tr>
            <td>${formatDate(m.createdAt)}</td>
            <td>${renderSignupSourceBadge(m)}</td>
            <td>${escapeHtml(m.name || '')}</td>
            <td>신규 등록 (${escapeHtml(m.signupSourceLabel || SIGNUP_SOURCE_LABEL[m.signupSource]?.text || '—')})</td>
          </tr>`).join('');
      }
    }
  }

  function renderMemberTypeChart(data) {
    const ctx = document.getElementById('chartMemberType');
    if (!ctx || typeof Chart === 'undefined') return;

    if (window._chart1) window._chart1.destroy();
    // Phase 1 임시: 가입경로 분포 (싸이렌 / 효성 / 기타: 수기·이벤트·기타) — 단계 C에서 회원 유형 차원 추가 후 복원
    window._chart1 = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['🌐 싸이렌', '🏦 효성', '🤝 기타(수기·이벤트·기타)'],
        datasets: [{
          data,
          backgroundColor: ['#1a5ec4', '#c47a00', '#8a8a8a'],
          borderWidth: 0,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { font: { size: 11 }, padding: 12, boxWidth: 12 },
          },
        },
        cutout: '60%',
      },
    });
  }

  /* ============ 2. 통합 일반 회원 (Phase 1 단계 B) ============ */
  async function renderMembers() {
    const tbody = document.getElementById('membersBody');
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:40px;color:#888">불러오는 중…</td></tr>`;

    let resp;
    try {
      resp = await fetchMembers({
        source: memberQuery.source,
        donorType: memberQuery.donorType,
        q: memberQuery.q,
        page: memberPage,
        pageSize: memberPageSize,
      });
    } catch (err) {
      console.error('[members] fetch fail', err);
      tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:40px;color:#c5293a">불러오기 실패: ${escapeHtml(err?.message || err)}</td></tr>`;
      renderMembersPagination(0);
      return;
    }

    allMembers = resp.data;
    memberTotal = resp.total;

    if (allMembers.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:40px;color:#888">조회 결과가 없습니다</td></tr>`;
      renderMembersPagination(0);
      return;
    }

    tbody.innerHTML = allMembers.map(m => {
      const status = m.status === 'blacklist'
        ? '<span class="cms-badge cms-b-danger" title="차단됨">🚫 차단</span>'
        : (m.status === 'withdrawn'
            ? '<span class="cms-badge cms-b-mute">탈퇴</span>'
            : '<span class="cms-badge cms-b-success">활성</span>');
      return `
        <tr data-member-row="${m.id}">
          <td><input type="checkbox" data-member-id="${m.id}"></td>
          <td>M-${String(m.id).padStart(5,'0')}</td>
          <td><strong>${escapeHtml(m.name || '')}</strong></td>
          <td>${status}</td>
          <td>${renderSignupSourceBadge(m)}</td>
          <td style="font-family:Inter;font-size:11.5px">${escapeHtml(m.phone || '—')}</td>
          <td>${renderDonorTypeBadge(m)}</td>
          <td style="font-family:Inter;font-size:11.5px;color:#8a8a8a">${formatDate(m.createdAt)}</td>
          <td>${renderHyosungContractCell(m)}</td>
          <td>
            <button class="cms-btn-link" data-action="view" data-id="${m.id}">상세</button>
          </td>
        </tr>
      `;
    }).join('');

    // 회원 상세 모달 열기 — 행 클릭(체크박스/버튼 제외) 또는 [상세] 버튼
    tbody.querySelectorAll('button[data-action="view"]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const id = Number(btn.dataset.id);
        openMemberDetailModal(id);
      });
    });
    tbody.querySelectorAll('tr[data-member-row]').forEach(tr => {
      tr.style.cursor = 'pointer';
      tr.addEventListener('click', e => {
        if (e.target.closest('input, button, a, label')) return;
        const id = Number(tr.dataset.memberRow);
        openMemberDetailModal(id);
      });
    });

    renderMembersPagination(memberTotal);
  }

  function renderMembersPagination(total) {
    const tbody = document.getElementById('membersBody');
    if (!tbody) return;
    const tableWrap = tbody.closest('.cms-panel');
    if (!tableWrap) return;
    let pager = tableWrap.querySelector('.cms-members-pagination');
    if (!pager) {
      pager = document.createElement('div');
      pager.className = 'cms-members-pagination';
      tableWrap.appendChild(pager);
    }
    const totalPages = Math.max(1, Math.ceil(total / memberPageSize));
    if (total === 0) { pager.innerHTML = ''; return; }

    const prev = memberPage > 1
      ? `<button class="cms-btn cms-btn-ghost" data-mp="${memberPage - 1}">← 이전</button>` : '';
    const next = memberPage < totalPages
      ? `<button class="cms-btn cms-btn-ghost" data-mp="${memberPage + 1}">다음 →</button>` : '';
    const info = `<span class="cms-members-pagination-info">${memberPage} / ${totalPages} · 총 ${total.toLocaleString()}명</span>`;
    pager.innerHTML = prev + info + next;
    pager.querySelectorAll('[data-mp]').forEach(b => {
      b.addEventListener('click', () => {
        memberPage = Number(b.dataset.mp);
        renderMembers();
      });
    });
  }

  function setupMembersFilter() {
    const sourceEl = document.getElementById('filterSource');
    if (sourceEl) {
      sourceEl.addEventListener('change', () => {
        memberQuery.source = sourceEl.value || 'all';
        memberPage = 1;
        renderMembers();
      });
    }
    const donorEl = document.getElementById('filterDonorType');
    if (donorEl) {
      donorEl.addEventListener('change', () => {
        memberQuery.donorType = donorEl.value || 'all';
        memberPage = 1;
        renderMembers();
      });
    }
    const search = document.getElementById('filterSearch');
    if (search) {
      search.addEventListener('input', () => {
        clearTimeout(memberSearchTimer);
        memberSearchTimer = setTimeout(() => {
          memberQuery.q = search.value.trim();
          memberPage = 1;
          renderMembers();
        }, 250);
      });
    }
    const btn = document.getElementById('btnRefreshMembers');
    if (btn) btn.addEventListener('click', () => {
      toast('회원 목록을 새로고침합니다');
      renderMembers();
    });
  }

  /* ============ 회원 상세 모달 ============ */
  let modalActiveTab = 'info';
  let modalCurrentMember = null;

  function openMemberDetailModal(memberId) {
    const m = allMembers.find(x => x.id === memberId);
    if (!m) { toast('회원 정보를 찾을 수 없습니다'); return; }
    modalCurrentMember = m;
    modalActiveTab = 'info';

    const modal = document.getElementById('memberDetailModal');
    if (!modal) { console.warn('memberDetailModal markup missing'); return; }

    // 헤더
    const setText = (id, val) => {
      const el = modal.querySelector(id);
      if (el) el.textContent = val;
    };
    const setHTML = (id, html) => {
      const el = modal.querySelector(id);
      if (el) el.innerHTML = html;
    };

    setText('#mdmName', m.name || '—');
    setText('#mdmId', 'M-' + String(m.id).padStart(5, '0'));
    setHTML('#mdmBadges',
      renderSignupSourceBadge(m) + ' ' + renderDonorTypeBadge(m));

    // 기본 정보 탭
    setText('#mdmInfoEmail', m.email || '—');
    setText('#mdmInfoPhone', m.phone || '—');
    setText('#mdmInfoStatus', m.status || '—');
    setText('#mdmInfoSource', m.signupSourceLabel
      || (SIGNUP_SOURCE_LABEL[m.signupSource]?.text || '—'));
    setText('#mdmInfoDonor', DONOR_TYPE_LABEL[m.donorType]?.text || '비후원');
    setText('#mdmInfoCreated', formatDate(m.createdAt));

    // 기본 정보 탭으로 시작
    switchModalTab('info');

    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
  }

  function closeMemberDetailModal() {
    const modal = document.getElementById('memberDetailModal');
    if (!modal) return;
    modal.classList.remove('show');
    document.body.style.overflow = '';
    modalCurrentMember = null;
  }

  function switchModalTab(tab) {
    modalActiveTab = tab;
    const modal = document.getElementById('memberDetailModal');
    if (!modal) return;
    modal.querySelectorAll('.mdm-tab').forEach(t => {
      t.classList.toggle('on', t.dataset.mdmTab === tab);
    });
    modal.querySelectorAll('.mdm-pane').forEach(p => {
      p.style.display = p.dataset.mdmPane === tab ? 'block' : 'none';
    });
    if (tab === 'donations' && modalCurrentMember) {
      loadModalDonations(modalCurrentMember.id);
    }
    if (tab === 'hyosung' && modalCurrentMember) {
      loadModalHyosung(modalCurrentMember);
    }
  }

  /* ★ Phase 3 D3: 회원 상세 모달 — 효성 계약 탭 */
  function loadModalHyosung(m) {
    const content = document.querySelector('#memberDetailModal #mdmHyosungContent');
    if (!content) return;
    const hy = m.hyosung;
    if (!hy) {
      content.innerHTML = `
        <div style="text-align:center;padding:36px;color:#888">
          <div style="font-size:36px;margin-bottom:12px">🏦</div>
          이 회원의 효성 CMS+ 계약 정보가 없습니다.<br>
          <span style="font-size:11.5px;color:#aaa;margin-top:6px;display:block">효성 CSV 업로드 후 매칭되면 여기에 표시됩니다.</span>
        </div>`;
      return;
    }
    const row = (label, valueHtml) =>
      `<dt>${escapeHtml(label)}</dt><dd>${valueHtml}</dd>`;
    const contractBadge = hy.contractStatus === '사용'
      ? '<span class="cms-badge cms-b-success">사용</span>'
      : hy.contractStatus === '중지'
      ? '<span class="cms-badge cms-b-mute">중지</span>'
      : `<span class="cms-badge cms-b-warn">${escapeHtml(hy.contractStatus || '?')}</span>`;
    const memberBadge = hy.memberStatus === '사용'
      ? '<span class="cms-badge cms-b-success">사용</span>'
      : hy.memberStatus === '중지'
      ? '<span class="cms-badge cms-b-mute">중지</span>'
      : `<span style="color:#888">${escapeHtml(hy.memberStatus || '—')}</span>`;
    const regBadge = hy.registrationStatus === '신청완료'
      ? '<span class="cms-badge cms-b-success">신청완료</span>'
      : hy.registrationStatus === '신청중'
      ? '<span class="cms-badge cms-b-warn">신청중</span>'
      : hy.registrationStatus === '기간만료'
      ? '<span class="cms-badge cms-b-mute">기간만료</span>'
      : `<span style="color:#aaa">${escapeHtml(hy.registrationStatus || '—')}</span>`;
    const billingEnd = hy.billingEnd === '9999-12-31' ? '무기한' : escapeHtml(hy.billingEnd || '—');
    content.innerHTML = `
      <dl class="mdm-info-grid hy-modal-section">
        ${row('효성 회원번호', `<strong>${escapeHtml(String(hy.memberNo || '—'))}</strong>`)}
        ${row('회원 상태', memberBadge)}
        ${row('계약 상태', contractBadge)}
        ${row('약정일', hy.promiseDay ? `매월 ${hy.promiseDay}일` : '—')}
        ${row('결제 방식', escapeHtml(hy.paymentTool || '—'))}
        ${row('결제 수단', escapeHtml(hy.paymentMethod || '—'))}
        ${row('결제 등록 상태', regBadge)}
        ${row('상품', escapeHtml(hy.productName || '—'))}
        ${row('월 약정금액', hy.productAmount != null ? '₩' + Number(hy.productAmount).toLocaleString() : '—')}
        ${row('청구 시작일', escapeHtml(hy.billingStart || '—'))}
        ${row('청구 종료일', billingEnd)}
      </dl>`;
  }

  async function loadModalDonations(memberId) {
    const body = document.querySelector('#memberDetailModal #mdmDonationsBody');
    const summary = document.querySelector('#memberDetailModal #mdmDonationsSummary');
    if (!body) return;
    body.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:30px;color:#888">불러오는 중…</td></tr>`;
    if (summary) summary.textContent = '';

    let resp;
    try {
      resp = await fetchMemberDonations(memberId);
    } catch (err) {
      body.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:30px;color:#c5293a">불러오기 실패: ${escapeHtml(err?.message || err)}</td></tr>`;
      return;
    }

    if (summary) {
      summary.textContent =
        `총 ${resp.totalCount.toLocaleString()}건 · ₩${(resp.totalAmount || 0).toLocaleString()}`;
    }

    if (!resp.data.length) {
      body.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:30px;color:#888">후원 이력이 없습니다</td></tr>`;
      return;
    }

    const channelLabel = { toss: '💳 토스', hyosung: '🏦 효성', ibk: '🏛 IBK', manual: '✍️ 수기' };
    const kindLabel    = { regular: '🔁 정기', onetime: '💡 일시' };

    body.innerHTML = resp.data.map(d => `
      <tr>
        <td>${formatDate(d.paidAt)}</td>
        <td>${kindLabel[d.kind] || d.kind || '—'}</td>
        <td>${channelLabel[d.channel] || d.channel || '—'}</td>
        <td style="text-align:right;font-weight:600">₩${(d.amount || 0).toLocaleString()}</td>
        <td>${escapeHtml(d.status || '—')}</td>
        <td style="color:#666;font-size:11.5px">${escapeHtml(d.memo || '')}</td>
      </tr>
    `).join('');
  }

  function setupMemberDetailModal() {
    const modal = document.getElementById('memberDetailModal');
    if (!modal) return;
    // 닫기 버튼
    modal.querySelectorAll('[data-mdm-close]').forEach(b => {
      b.addEventListener('click', closeMemberDetailModal);
    });
    // 백드롭 클릭 닫기
    modal.addEventListener('click', e => {
      if (e.target === modal) closeMemberDetailModal();
    });
    // 탭 전환
    modal.querySelectorAll('.mdm-tab').forEach(t => {
      t.addEventListener('click', () => switchModalTab(t.dataset.mdmTab));
    });
    // ESC 닫기
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && modal.classList.contains('show')) {
        closeMemberDetailModal();
      }
    });
  }

  /* ============ 3. Import (수기 등록) ============ */
  function setupManualForm() {
    const form = document.getElementById('manualAddForm');
    if (!form) return;
    form.addEventListener('submit', e => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      const newMember = {
        id: allMembers.length + 100,
        name: data.name,
        phone: data.phone,
        email: data.email || '',
        type: data.type,
        source: 'manual',
        tags: data.tags ? data.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
        createdAt: new Date().toISOString().slice(0, 10),
      };
      allMembers.unshift(newMember);
      toast(`${data.name}님이 등록되었습니다 ✅`);
      form.reset();
      renderDashboard();
    });
  }

  function setupFileUpload() {
    const zone = document.getElementById('uploadZone');
    const input = document.getElementById('uploadFile');
    const btn = document.getElementById('btnSelectFile');
    const tplBtn = document.getElementById('btnDownloadTemplate');
    const cancelBtn = document.getElementById('btnCancelImport');
    const confirmBtn = document.getElementById('btnConfirmImport');

    if (!zone || !input) return;

    const handleFile = file => {
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) return toast('파일 크기는 5MB 이하여야 합니다');
      
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const wb = XLSX.read(e.target.result, { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
          if (rows.length < 2) return toast('데이터가 없습니다');
          
          importedData = rows;
          renderPreview(rows);
          toast(`${rows.length - 1}행을 읽었습니다`);
        } catch (err) {
          console.error(err);
          toast('파일을 읽을 수 없습니다');
        }
      };
      reader.readAsArrayBuffer(file);
    };

    btn?.addEventListener('click', () => input.click());
    zone.addEventListener('click', () => input.click());
    input.addEventListener('change', e => handleFile(e.target.files[0]));
    
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      handleFile(e.dataTransfer.files[0]);
    });

    tplBtn?.addEventListener('click', () => {
      const data = [
        ['이름', '전화번호', '이메일', '회원유형', '가입일', '비고'],
        ['홍길동', '010-1234-5678', 'hong@test.com', '유족', '2024-01-15', '유족1기'],
        ['김후원', '010-9876-5432', 'kim@test.com', '후원', '2024-03-20', '월정기 30,000원'],
      ];
      const ws = XLSX.utils.aoa_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '회원등록');
      XLSX.writeFile(wb, 'TBFA_회원등록_템플릿.xlsx');
      toast('템플릿이 다운로드되었습니다');
    });

    cancelBtn?.addEventListener('click', () => {
      importedData = null;
      document.getElementById('importPreview').style.display = 'none';
      input.value = '';
    });

    confirmBtn?.addEventListener('click', () => {
      if (!importedData) return;
      const count = importedData.length - 1;
      /* 실제 등록 시뮬레이션 */
      for (let i = 1; i < importedData.length; i++) {
        const row = importedData[i];
        allMembers.unshift({
          id: allMembers.length + 200 + i,
          name: row[0] || '이름없음',
          phone: row[1] || '',
          email: row[2] || '',
          type: { '유족':'family','후원':'donor','일반':'regular','봉사':'volunteer' }[row[3]] || 'regular',
          source: 'excel',
          tags: row[5] ? [row[5]] : [],
          createdAt: row[4] || new Date().toISOString().slice(0, 10),
        });
      }
      toast(`${count}명이 일괄 등록되었습니다 ✅`);
      importedData = null;
      document.getElementById('importPreview').style.display = 'none';
      input.value = '';
    });
  }

  function renderPreview(rows) {
    const panel = document.getElementById('importPreview');
    const table = document.getElementById('previewTable');
    const count = document.getElementById('previewCount');
    if (!panel || !table) return;
    
    const headers = rows[0];
    const dataRows = rows.slice(1, 6);
    
    table.innerHTML = `
      <thead><tr>${headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
      <tbody>${dataRows.map(r => `<tr>${r.map(c => `<td>${escapeHtml(c || '')}</td>`).join('')}</tr>`).join('')}</tbody>
    `;
    if (count) count.textContent = `전체 ${rows.length - 1}행`;
    panel.style.display = 'block';
  }

  /* ============ 4. 이관 ============ */
  function renderTransfer() {
    const pending = allWebDonors.filter(d => !d.transferred);
    const done = allWebDonors.filter(d => d.transferred).length;

    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('tsWebDonors', allWebDonors.length + '명');
    set('tsPending', pending.length + '명');
    set('tsDone', done + '명');

    const tbody = document.getElementById('transferBody');
    if (!tbody) return;

    if (pending.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px;color:#888">이관할 후원자가 없습니다 ✨</td></tr>`;
      return;
    }

    tbody.innerHTML = pending.map(d => `
      <tr>
        <td><input type="checkbox" class="transfer-check" data-id="${d.id}"></td>
        <td>D-${String(d.id).padStart(4,'0')}</td>
        <td><strong>${escapeHtml(d.name)}</strong></td>
        <td style="font-family:Inter;font-size:11.5px">${escapeHtml(d.email)}</td>
        <td style="font-family:Inter;font-size:11.5px">${escapeHtml(d.phone)}</td>
        <td>${formatDate(d.firstDonation)}</td>
        <td style="font-weight:600">₩${d.totalAmount.toLocaleString()}</td>
        <td><span class="cms-badge cms-b-${d.type === 'regular' ? 'warn' : 'info'}">${d.type === 'regular' ? '정기' : '일시'}</span></td>
      </tr>
    `).join('');

    /* 체크박스 이벤트 */
    document.querySelectorAll('.transfer-check').forEach(cb => {
      cb.addEventListener('change', updateTransferSelection);
    });
  }

  function updateTransferSelection() {
    selectedTransferIds.clear();
    document.querySelectorAll('.transfer-check:checked').forEach(cb => {
      selectedTransferIds.add(Number(cb.dataset.id));
    });
    const btn = document.getElementById('btnTransferExecute');
    const count = document.getElementById('transferCount');
    if (btn) btn.disabled = selectedTransferIds.size === 0;
    if (count) count.textContent = selectedTransferIds.size;
  }

  function setupTransferActions() {
    document.getElementById('transferSelectAll')?.addEventListener('change', e => {
      document.querySelectorAll('.transfer-check').forEach(cb => cb.checked = e.target.checked);
      updateTransferSelection();
    });

    document.getElementById('btnTransferExecute')?.addEventListener('click', () => {
      if (selectedTransferIds.size === 0) return;
      if (!confirm(`${selectedTransferIds.size}명을 TBFA 회원으로 이관하시겠습니까?`)) return;
      
      selectedTransferIds.forEach(id => {
        const donor = allWebDonors.find(d => d.id === id);
        if (donor) {
          donor.transferred = true;
          allMembers.unshift({
            id: allMembers.length + 1000,
            name: donor.name,
            phone: donor.phone,
            email: donor.email,
            type: 'donor',
            source: 'web',
            tags: [donor.type === 'regular' ? '월정기' : '일시후원', '웹가입'],
            createdAt: new Date().toISOString().slice(0, 10),
          });
        }
      });
      
      toast(`${selectedTransferIds.size}명이 TBFA 회원으로 이관되었습니다 ✅`);
      selectedTransferIds.clear();
      renderTransfer();
      renderDashboard();
    });

    document.getElementById('btnTransferRefresh')?.addEventListener('click', renderTransfer);
  }

  /* ============ 5. 태그 (Phase 1: 별도 API 미배포 — placeholder) ============ */
  function renderTags() {
    const grid = document.getElementById('tagGrid');
    if (!grid) return;
    grid.innerHTML = `
      <div style="grid-column:1/-1;background:#fff7e6;border:1px dashed #f0c785;border-radius:8px;padding:24px;text-align:center;color:#c47a00;font-size:13px;line-height:1.7">
        🏷️ 회원 태그 시스템은 다음 마일스톤에서 활성화됩니다.<br>
        <span style="font-size:12px;color:#8a6500">통합 회원 명단의 가입경로/후원 상태 뱃지는 이미 적용되어 있습니다.</span>
      </div>
    `;
  }

  /* ============ 6. 알림 ============ */
  function setupNotifyForm() {
    const form = document.getElementById('notifyForm');
    const textarea = form?.querySelector('textarea');
    const charCount = form?.querySelector('.cms-char-count');
    const targetPreview = document.getElementById('targetPreview');
    const targetInputs = form?.querySelectorAll('input[name="target"]');

    textarea?.addEventListener('input', () => {
      if (charCount) charCount.textContent = `${textarea.value.length} / 2000자`;
    });

    targetInputs?.forEach(inp => {
      inp.addEventListener('change', () => {
        const v = inp.value;
        let count = 0;
        if (v === 'all') count = allMembers.length;
        else if (v === 'type') count = allMembers.filter(m => m.type === 'family').length;
        else if (v === 'tag') count = 15;
        else count = 5;
        if (targetPreview) targetPreview.textContent = `예상 수신자: 약 ${count}명`;
      });
    });

    form?.addEventListener('submit', e => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      if (!data.content) return toast('메시지 내용을 입력해주세요');
      toast(`발송 예약 완료 (${data.channel === 'sms' ? 'SMS' : data.channel === 'email' ? '이메일' : 'SMS+이메일'}) — 데모`);
      form.reset();
    });

    document.getElementById('btnTestSend')?.addEventListener('click', () => {
      toast('본인에게 테스트 메시지를 발송했습니다 (데모)');
    });
  }

  /* ============ 7. Export ============ */
  function setupExport() {
    document.querySelectorAll('.cms-export-card').forEach(card => {
      card.addEventListener('click', () => {
        const type = card.dataset.export;
        const names = {
          all: '전체_회원', family: '유족_회원', donors: '후원_이력', tax: '기부금_영수증',
        };
        
        /* 실제 XLSX 생성 */
        let data;
        if (type === 'family') data = allMembers.filter(m => m.type === 'family');
        else if (type === 'donors') data = allMembers.filter(m => m.type === 'donor');
        else data = allMembers;

        const rows = [['ID','이름','전화','이메일','유형','가입경로','태그','등록일']];
        data.forEach(m => rows.push([
          'M-' + String(m.id).padStart(5,'0'),
          m.name, m.phone, m.email || '', m.type, m.source,
          m.tags.join(','), m.createdAt,
        ]));

        const ws = XLSX.utils.aoa_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'TBFA');
        XLSX.writeFile(wb, `TBFA_${names[type]}_${new Date().toISOString().slice(0,10)}.xlsx`);
        toast(`${names[type]} 엑셀이 다운로드되었습니다`);
      });
    });
  }

  /* ============ ★ Phase 1: 효성 CMS+ 관리 ============ */

  let hyContractPage = 1;
  let hyBillingPage = 1;
  let hyUploadParsedPreview = null;

  /**
   * 효성 서브탭 전환
   */
  function switchHyosungTab(target) {
    document.querySelectorAll('.hy-tab').forEach(t => {
      const active = t.dataset.hyTab === target;
      t.classList.toggle('on', active);
      t.style.borderBottomColor = active ? '#1a5ec4' : 'transparent';
      t.style.fontWeight = active ? '600' : '500';
    });
    document.querySelectorAll('.hy-pane').forEach(p => {
      p.style.display = p.dataset.hyPane === target ? 'block' : 'none';
    });

    if (target === 'contracts') loadHyosungContracts();
    else if (target === 'billings') loadHyosungBillings();
  }

  /**
   * 계약 목록 조회
   */
  async function loadHyosungContracts() {
    const body = document.getElementById('hyContractBody');
    if (!body) return;

    const status = document.getElementById('hyContractStatus')?.value || '';
    const search = document.getElementById('hyContractSearch')?.value || '';

    body.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:30px;color:#888">로딩 중...</td></tr>';

    const params = new URLSearchParams({
      page: String(hyContractPage),
      pageSize: '50',
    });
    if (status) params.set('status', status);
    if (search) params.set('search', search);

    const res = await api('/api/admin/hyosung-import-contracts?' + params.toString());
    if (!res.ok || !res.data?.data) {
      var detailMsg = (res.data?.error || '알 수 없음');
      if (res.data?.detail) detailMsg += ' — ' + res.data.detail;
      if (res.status) detailMsg += ' (HTTP ' + res.status + ')';
      console.error('[hyosung-contracts] 조회 실패', res);
      body.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:30px;color:#c5293a">조회 실패: ' + detailMsg + '</td></tr>';
      return;
    }

    const { list, pagination } = res.data.data;

    /* 통계 */
    const totalEl = document.getElementById('hyContractTotal');
    const linkedEl = document.getElementById('hyContractLinked');
    if (totalEl) totalEl.textContent = pagination.total.toLocaleString();
    if (linkedEl) {
      const linkedCount = list.filter(c => c.linkedMemberId).length;
      linkedEl.textContent = linkedCount;
    }

    if (list.length === 0) {
      body.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:30px;color:#888">데이터가 없습니다. CSV 업로드 탭에서 먼저 계약정보를 import하세요.</td></tr>';
      return;
    }

    body.innerHTML = list.map(c => {
      const statusBadge = c.contractStatus === '사용'
        ? '<span class="cms-badge cms-b-success">사용</span>'
        : c.contractStatus === '중지'
        ? '<span class="cms-badge cms-b-mute">중지</span>'
        : '<span class="cms-badge cms-b-warn">' + escapeHtml(c.contractStatus || '-') + '</span>';

      const amount = c.productAmount ? '₩' + c.productAmount.toLocaleString() : '-';
      const linkedBadge = c.linkedMemberId
        ? '<span class="cms-badge cms-b-info">#' + c.linkedMemberId + ' ' + escapeHtml(c.linkedMemberName || '') + '</span>'
        : '<span style="color:#999">매칭없음</span>';

      return '<tr>' +
        '<td><strong>' + c.memberNo + '</strong></td>' +
        '<td>' + escapeHtml(c.memberName || '-') + '</td>' +
        '<td style="font-family:Inter;font-size:11.5px">' + escapeHtml(c.phone || '-') + '</td>' +
        '<td>' + statusBadge + '</td>' +
        '<td>' + escapeHtml(c.productName || '-') + '</td>' +
        '<td style="font-weight:600">' + amount + '</td>' +
        '<td>' + (c.promiseDay || '-') + '일</td>' +
        '<td style="font-size:11px">' + escapeHtml(c.paymentTool || '-') + '</td>' +
        '<td>' + linkedBadge + '</td>' +
        '</tr>';
    }).join('');

    /* 페이지네이션 */
    const pgEl = document.getElementById('hyContractPagination');
    if (pgEl) {
      pgEl.innerHTML = '';
      if (pagination.totalPages > 1) {
        for (let p = 1; p <= pagination.totalPages; p++) {
          const btn = document.createElement('button');
          btn.textContent = p;
          btn.className = 'cms-btn ' + (p === hyContractPage ? 'cms-btn-primary' : 'cms-btn-ghost');
          btn.style.margin = '0 2px';
          btn.onclick = () => { hyContractPage = p; loadHyosungContracts(); };
          pgEl.appendChild(btn);
        }
      }
    }
  }

  /**
   * 청구/수납 목록 조회
   */
  async function loadHyosungBillings() {
    const body = document.getElementById('hyBillingBody');
    const statsEl = document.getElementById('hyBillingStats');
    if (!body) return;

    const month = document.getElementById('hyBillingMonth')?.value || '';
    const status = document.getElementById('hyBillingStatus')?.value || '';
    const search = document.getElementById('hyBillingSearch')?.value || '';

    body.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:30px;color:#888">로딩 중...</td></tr>';

    const params = new URLSearchParams({
      page: String(hyBillingPage),
      pageSize: '100',
    });
    if (month) params.set('month', month);
    if (status) params.set('status', status);
    if (search) params.set('search', search);

    const res = await api('/api/admin/hyosung-import-billings?' + params.toString());
    if (!res.ok || !res.data?.data) {
      body.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:30px;color:#c5293a">조회 실패</td></tr>';
      return;
    }

    const { list, pagination, stats } = res.data.data;

    /* 통계 카드 */
    if (statsEl) {
      const statusColors = {
        '완납': '#1a8b46',
        '미납': '#c5293a',
        '수납대기': '#c47a00',
      };
      statsEl.innerHTML = ['완납', '미납', '수납대기', 'total'].map(s => {
        if (s === 'total') {
          const totalCount = Object.values(stats).reduce((sum, v) => sum + v.count, 0);
          const totalAmount = Object.values(stats).reduce((sum, v) => sum + v.amount, 0);
          return '<div style="padding:12px;background:#fff;border:1px solid #e8e6e3;border-radius:8px;text-align:center">' +
            '<div style="font-size:11px;color:#888;margin-bottom:4px">전체</div>' +
            '<div style="font-size:20px;font-weight:700;color:#0f0f0f">' + totalCount + '건</div>' +
            '<div style="font-size:11px;color:#525252">₩' + totalAmount.toLocaleString() + '</div>' +
            '</div>';
        }
        const st = stats[s] || { count: 0, amount: 0 };
        return '<div style="padding:12px;background:#fff;border:1px solid #e8e6e3;border-radius:8px;text-align:center;border-left:3px solid ' + statusColors[s] + '">' +
          '<div style="font-size:11px;color:#888;margin-bottom:4px">' + s + '</div>' +
          '<div style="font-size:20px;font-weight:700;color:' + statusColors[s] + '">' + st.count + '건</div>' +
          '<div style="font-size:11px;color:#525252">₩' + st.amount.toLocaleString() + '</div>' +
          '</div>';
      }).join('');
    }

    if (list.length === 0) {
      body.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:30px;color:#888">데이터가 없습니다</td></tr>';
      return;
    }

    body.innerHTML = list.map(b => {
      const statusBadge = b.receiptStatus === '완납'
        ? '<span class="cms-badge cms-b-success">완납</span>'
        : b.receiptStatus === '미납'
        ? '<span class="cms-badge cms-b-danger">미납</span>'
        : '<span class="cms-badge cms-b-warn">' + escapeHtml(b.receiptStatus || '-') + '</span>';

      return '<tr>' +
        '<td style="font-family:Inter;font-weight:600">' + escapeHtml(b.billingMonth) + '</td>' +
        '<td>' + b.memberNo + '</td>' +
        '<td>' + escapeHtml(b.memberName || '-') + '</td>' +
        '<td>' + escapeHtml(b.productName || '-') + '</td>' +
        '<td style="font-weight:600">₩' + (b.billingAmount || 0).toLocaleString() + '</td>' +
        '<td>₩' + (b.receivedAmount || 0).toLocaleString() + '</td>' +
        '<td>' + statusBadge + '</td>' +
        '<td style="font-size:11px">' + escapeHtml(b.paymentTool || '-') + '</td>' +
        '<td>' + (b.paymentDate ? formatDate(b.paymentDate) : '-') + '</td>' +
        '</tr>';
    }).join('');

    /* 페이지네이션 */
    const pgEl = document.getElementById('hyBillingPagination');
    if (pgEl) {
      pgEl.innerHTML = '';
      if (pagination.totalPages > 1) {
        for (let p = 1; p <= pagination.totalPages; p++) {
          const btn = document.createElement('button');
          btn.textContent = p;
          btn.className = 'cms-btn ' + (p === hyBillingPage ? 'cms-btn-primary' : 'cms-btn-ghost');
          btn.style.margin = '0 2px';
          btn.onclick = () => { hyBillingPage = p; loadHyosungBillings(); };
          pgEl.appendChild(btn);
        }
      }
    }
  }

  /**
   * 파일에서 추출한 CSV 텍스트 (전역 캐시)
   */
  let hyExtractedCsv = null;
  let hyExtractedFileName = '';
  let hyDetectedType = null;

  /**
   * 엑셀/CSV 파일 → CSV 텍스트 추출 (SheetJS 사용)
   */
  function extractCsvFromFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const wb = XLSX.read(data, { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          if (!ws) throw new Error('시트가 비어 있습니다');
          /* CSV 변환 (FS 옵션: 필드 구분자 콤마) */
          const csv = XLSX.utils.sheet_to_csv(ws, { FS: ',' });
          resolve(csv);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('파일 읽기 실패'));
      reader.readAsArrayBuffer(file);
    });
  }

  /**
   * CSV 헤더 분석 → 양식 자동 감지
   */
  function detectCsvType(csvText) {
    const firstLine = csvText.split('\n')[0] || '';
    if (firstLine.includes('회원상태') && firstLine.includes('계약상태') && firstLine.includes('청구시작일')) {
      return 'contracts';
    }
    if (firstLine.includes('청구월') && firstLine.includes('수납상태')) {
      return 'billings';
    }
    return null;
  }

  /**
   * 파일 선택 핸들러
   */
  async function handleHyosungFileSelected(file) {
    const infoEl = document.getElementById('hyUploadFileInfo');
    const previewBtn = document.getElementById('hyUploadPreview');
    const resetBtn = document.getElementById('hyUploadReset');
    const resultEl = document.getElementById('hyUploadResult');

    if (!file) return;

    /* 파일 크기 체크 (10MB 제한) */
    if (file.size > 10 * 1024 * 1024) {
      toast('파일 크기는 10MB 이하여야 합니다');
      return;
    }

    /* 확장자 체크 */
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!['xlsx', 'xls', 'csv'].includes(ext)) {
      toast('지원하지 않는 형식입니다 (.xlsx, .xls, .csv만 가능)');
      return;
    }

    try {
      toast('파일 분석 중...');
      const csv = await extractCsvFromFile(file);
      const detected = detectCsvType(csv);

      if (!detected) {
        toast('⚠️ 효성 CMS+ 양식이 아닙니다. 헤더를 확인하세요.');
        return;
      }

      hyExtractedCsv = csv;
      hyExtractedFileName = file.name;
      hyDetectedType = detected;

      /* 라디오 버튼 자동 선택 */
      const radio = document.querySelector(`input[name="hyUploadType"][value="${detected}"]`);
      if (radio) radio.checked = true;

      /* 행 수 카운트 (헤더 제외) */
      const lines = csv.split('\n').filter(l => l.trim()).length;
      const rowCount = Math.max(0, lines - 1);

      const typeLabel = detected === 'contracts' ? '📋 계약정보' : '📅 청구/수납 내역';
      if (infoEl) {
        infoEl.style.display = 'block';
        infoEl.innerHTML = `✅ <strong>${file.name}</strong> (${(file.size / 1024).toFixed(1)} KB)<br />` +
          `자동 감지된 양식: <strong>${typeLabel}</strong> · 데이터 ${rowCount}행 추출됨<br />` +
          `<span style="color:#888;font-size:11px">아래 "미리보기" 버튼으로 검증을 진행하세요</span>`;
      }

      if (previewBtn) previewBtn.disabled = false;
      if (resetBtn) resetBtn.disabled = false;
      if (resultEl) resultEl.style.display = 'none';

      toast('파일 추출 완료 ✅');
    } catch (err) {
      console.error('[file extract]', err);
      toast('파일 분석 실패: ' + (err.message || err));
    }
  }

  /**
   * 업로드 영역 초기화
   */
  function resetHyosungUpload() {
    hyExtractedCsv = null;
    hyExtractedFileName = '';
    hyDetectedType = null;
    hyUploadParsedPreview = null;

    const fileInput = document.getElementById('hyUploadFile');
    if (fileInput) fileInput.value = '';

    const infoEl = document.getElementById('hyUploadFileInfo');
    if (infoEl) infoEl.style.display = 'none';

    const resultEl = document.getElementById('hyUploadResult');
    if (resultEl) resultEl.style.display = 'none';

    document.getElementById('hyUploadPreview').disabled = true;
    document.getElementById('hyUploadConfirm').disabled = true;
    document.getElementById('hyUploadReset').disabled = true;
  }

  /**
   * 파일 업로드 - 미리보기
   */
  async function hyosungUploadPreview() {
    if (!hyExtractedCsv) {
      toast('먼저 파일을 선택하세요');
      return;
    }

    const csvText = hyExtractedCsv;
    const type = hyDetectedType || 'contracts';
    const resultEl = document.getElementById('hyUploadResult');
    const confirmBtn = document.getElementById('hyUploadConfirm');

    toast('미리보기 분석 중...');

    const endpoint = type === 'contracts'
      ? '/api/admin/hyosung-import-contracts'
      : '/api/admin/hyosung-import-billings';

    const res = await api(endpoint, {
      method: 'POST',
      body: { csvText, dryRun: true },
    });

    if (!res.ok) {
      toast('미리보기 실패: ' + (res.data?.error || '알 수 없음'));
      return;
    }

    const r = res.data.data;
    hyUploadParsedPreview = { csvText, type };

    let html = '<h4 style="margin-bottom:12px">🔍 미리보기 결과</h4>';
    if (type === 'contracts') {
      html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:12px">' +
        '<div style="padding:10px;background:#e8f5ed;border-radius:6px;text-align:center"><strong style="font-size:20px">' + (r.linked || 0) + '</strong><div style="font-size:11px">매칭됨</div></div>' +
        '<div style="padding:10px;background:#fff4e0;border-radius:6px;text-align:center"><strong style="font-size:20px">' + (r.unlinked || 0) + '</strong><div style="font-size:11px">매칭없음</div></div>' +
        '<div style="padding:10px;background:#fde7ea;border-radius:6px;text-align:center"><strong style="font-size:20px">' + (r.conflicts?.length || 0) + '</strong><div style="font-size:11px">중복매칭</div></div>' +
        '</div>';
      if (r.conflicts && r.conflicts.length > 0) {
        html += '<div style="background:#fde7ea;padding:10px;border-radius:6px;margin-bottom:10px;font-size:12px">⚠️ 전화번호가 여러 회원에게 매칭되는 경우: ' +
          r.conflicts.map(c => c.memberNo + '번(' + c.phone + ')').join(', ') + '</div>';
      }
    } else {
      const sc = r.statusCount || {};
      html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:12px">' +
        '<div style="padding:10px;background:#e8f5ed;border-radius:6px;text-align:center"><strong style="font-size:20px">' + (sc['완납'] || 0) + '</strong><div style="font-size:11px">완납</div></div>' +
        '<div style="padding:10px;background:#fde7ea;border-radius:6px;text-align:center"><strong style="font-size:20px">' + (sc['미납'] || 0) + '</strong><div style="font-size:11px">미납</div></div>' +
        '<div style="padding:10px;background:#fff4e0;border-radius:6px;text-align:center"><strong style="font-size:20px">' + (sc['수납대기'] || 0) + '</strong><div style="font-size:11px">수납대기</div></div>' +
        '<div style="padding:10px;background:#f4f4f2;border-radius:6px;text-align:center"><strong style="font-size:20px">' + (r.totalRows || 0) + '</strong><div style="font-size:11px">전체</div></div>' +
        '</div>';
    }

    if (r.parseErrors && r.parseErrors.length > 0) {
      html += '<div style="background:#fff4e0;padding:10px;border-radius:6px;font-size:11.5px;color:#c47a00">⚠️ 파싱 에러 ' + r.parseErrors.length + '건</div>';
    }

    html += '<div style="margin-top:12px;font-size:12px;color:#525252">✅ 검증 통과. 아래 "확정 Import" 버튼으로 실제 저장하세요.</div>';

    if (resultEl) {
      resultEl.innerHTML = html;
      resultEl.style.display = 'block';
    }
    if (confirmBtn) confirmBtn.disabled = false;
    toast('미리보기 완료 ✅');
  }

  /**
   * CSV 업로드 - 확정 Import
   */
  async function hyosungUploadConfirm() {
    if (!hyUploadParsedPreview) {
      toast('먼저 미리보기를 실행하세요');
      return;
    }
    if (!confirm(`실제로 DB에 저장하시겠습니까?\n\n파일: ${hyExtractedFileName}\n양식: ${hyDetectedType === 'contracts' ? '계약정보' : '청구/수납'}`)) return;

    const { csvText, type } = hyUploadParsedPreview;
    const resultEl = document.getElementById('hyUploadResult');

    toast('Import 실행 중... (시간이 걸릴 수 있습니다)');

    const endpoint = type === 'contracts'
      ? '/api/admin/hyosung-import-contracts'
      : '/api/admin/hyosung-import-billings';

    const res = await api(endpoint, {
      method: 'POST',
      body: { csvText, dryRun: false },
    });

    if (!res.ok) {
      toast('Import 실패: ' + (res.data?.error || '알 수 없음'));
      return;
    }

    const r = res.data.data;
    let html = '<h4 style="margin-bottom:12px;color:#1a8b46">✅ Import 완료!</h4>';

    if (type === 'contracts') {
      html += '<ul style="font-size:12.5px;line-height:1.8">' +
        '<li>신규 생성: <strong>' + r.imported + '건</strong></li>' +
        '<li>업데이트: <strong>' + r.updated + '건</strong></li>' +
        '<li>회원 매칭됨: <strong>' + r.linked + '건</strong></li>' +
        '<li>매칭 없음: ' + r.unlinked + '건 (수동 매칭 필요)</li>' +
        '</ul>';
    } else {
      html += '<ul style="font-size:12.5px;line-height:1.8">' +
        '<li>신규 생성: <strong>' + r.imported + '건</strong></li>' +
        '<li>업데이트: <strong>' + r.updated + '건</strong></li>' +
        '<li>🎉 후원 자동 확정: <strong style="color:#1a8b46">' + r.autoConfirmed + '건</strong></li>' +
        '<li>중복 스킵: ' + r.skippedDuplicate + '건</li>' +
        '<li>매칭없음 스킵: ' + r.skippedNoLink + '건</li>' +
        '<li>완납아님 스킵: ' + r.skippedNotPaid + '건</li>' +
        '</ul>';
    }

    if (resultEl) resultEl.innerHTML = html;
    toast('Import 완료! ✅');
    hyUploadParsedPreview = null;
    document.getElementById('hyUploadConfirm').disabled = true;
    /* 파일 입력 초기화 */
    setTimeout(() => resetHyosungUpload(), 1500);
  }

  /**
   * 효성 관리 초기화
   */
  function setupHyosung() {
    /* 서브탭 전환 */
    document.querySelectorAll('.hy-tab').forEach(t => {
      t.addEventListener('click', () => switchHyosungTab(t.dataset.hyTab));
    });

    /* 계약 필터 */
    ['hyContractStatus', 'hyContractSearch'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const handler = id === 'hyContractSearch'
        ? () => { clearTimeout(window._hyct); window._hyct = setTimeout(() => { hyContractPage = 1; loadHyosungContracts(); }, 300); }
        : () => { hyContractPage = 1; loadHyosungContracts(); };
      el.addEventListener(id === 'hyContractSearch' ? 'input' : 'change', handler);
    });
    document.getElementById('hyContractRefresh')?.addEventListener('click', () => { hyContractPage = 1; loadHyosungContracts(); });

    /* 청구 필터 */
    ['hyBillingMonth', 'hyBillingStatus', 'hyBillingSearch'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const handler = id === 'hyBillingSearch'
        ? () => { clearTimeout(window._hybt); window._hybt = setTimeout(() => { hyBillingPage = 1; loadHyosungBillings(); }, 300); }
        : () => { hyBillingPage = 1; loadHyosungBillings(); };
      el.addEventListener(id === 'hyBillingSearch' ? 'input' : 'change', handler);
    });
    document.getElementById('hyBillingRefresh')?.addEventListener('click', () => { hyBillingPage = 1; loadHyosungBillings(); });

    /* 업로드 버튼 */
    document.getElementById('hyUploadPreview')?.addEventListener('click', hyosungUploadPreview);
    document.getElementById('hyUploadConfirm')?.addEventListener('click', hyosungUploadConfirm);
    document.getElementById('hyUploadReset')?.addEventListener('click', resetHyosungUpload);

    /* 파일 드롭존 */
    const drop = document.getElementById('hyUploadDrop');
    const fileInput = document.getElementById('hyUploadFile');

    if (drop && fileInput) {
      drop.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (file) handleHyosungFileSelected(file);
      });

      drop.addEventListener('dragover', (e) => {
        e.preventDefault();
        drop.classList.add('drag-over');
      });
      drop.addEventListener('dragleave', () => {
        drop.classList.remove('drag-over');
      });
      drop.addEventListener('drop', (e) => {
        e.preventDefault();
        drop.classList.remove('drag-over');
        const file = e.dataTransfer.files?.[0];
        if (file) handleHyosungFileSelected(file);
      });
    }
  }

  /* ============ ★ STEP H-2d-4: 영수증 설정 (사이렌 관리자와 자동 동기화) ============ */

  /**
   * 페이지 진입 시 호출 — DB에서 현재 설정 로드 후 폼에 채움
   */
  async function loadReceiptSettings() {
    const form = document.getElementById('receiptSettingsForm');
    if (!form) return;

    /* 로딩 표시 (저장 버튼 비활성화) */
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

    /* 메타 정보 */
    const updatedAtEl = document.getElementById('rsUpdatedAt');
    const updatedByEl = document.getElementById('rsUpdatedBy');
    if (updatedAtEl) updatedAtEl.textContent = formatDateTime(s.updatedAt);
    if (updatedByEl) updatedByEl.textContent = updatedByName || (s.updatedBy ? '관리자 #' + s.updatedBy : '—');

    /* 5개 협회 정보 */
    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
    setVal('rsOrgName', s.orgName);
    setVal('rsOrgRegistrationNo', s.orgRegistrationNo);
    setVal('rsOrgRepresentative', s.orgRepresentative);
    setVal('rsOrgAddress', s.orgAddress);
    setVal('rsOrgPhone', s.orgPhone);

    /* 4개 양식 텍스트 */
    setVal('rsTitle', s.title);
    setVal('rsSubtitle', s.subtitle);
    setVal('rsProofText', s.proofText);
    setVal('rsDonationTypeLabel', s.donationTypeLabel);

    /* 하단 안내문 (배열 → 동적 row) */
    renderFooterNotes(Array.isArray(s.footerNotes) ? s.footerNotes : []);

    if (submitBtn) submitBtn.disabled = false;
  }

  /**
   * 하단 안내문 동적 렌더링
   */
  function renderFooterNotes(notes) {
    const list = document.getElementById('rsFooterList');
    if (!list) return;

    if (!notes || notes.length === 0) {
      /* 빈 상태일 때도 1개 빈 row 제공 */
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

  /**
   * 현재 폼에서 footerNotes 배열 추출
   */
  function collectFooterNotes() {
    const inputs = document.querySelectorAll('#rsFooterList .rs-footer-row input[type="text"]');
    const arr = [];
    inputs.forEach((inp) => {
      const v = (inp.value || '').trim();
      if (v.length > 0) arr.push(v);
    });
    return arr;
  }

  /**
   * 폼 제출 → 저장
   */
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
        /* 메타 정보 갱신 */
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

  /**
   * 안내문 추가/삭제 / 미리보기 / 다시 불러오기 버튼
   */
  function setupReceiptSettingsActions() {
    document.addEventListener('click', (e) => {
      /* 안내문 추가 */
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

      /* 안내문 삭제 */
      const removeBtn = e.target.closest('[data-rs-remove]');
      if (removeBtn) {
        e.preventDefault();
        const row = removeBtn.closest('.rs-footer-row');
        if (row) row.remove();
        /* 모두 삭제했을 경우 빈 row 1개 보장 */
        const list = document.getElementById('rsFooterList');
        if (list && list.querySelectorAll('.rs-footer-row').length === 0) {
          renderFooterNotes(['']);
        }
        return;
      }

      /* 다시 불러오기 */
      if (e.target.closest('#rsReloadBtn')) {
        e.preventDefault();
        loadReceiptSettings();
        toast('현재 DB 설정을 다시 불러왔습니다');
        return;
      }

      /* 미리보기 (PDF를 새 탭에서 인라인 표시) */
      if (e.target.closest('#rsPreviewBtn')) {
        e.preventDefault();
        const previewUrl = '/api/admin/receipt-preview?ts=' + Date.now();
        window.open(previewUrl, '_blank', 'noopener');
        toast('미리보기 PDF를 새 탭에서 엽니다 (현재 저장된 DB 설정 기준)');
        return;
      }
    });
  }

  /**
   * 통합 setup 함수 (init에서 호출)
   */
  function setupReceiptSettings() {
    setupReceiptSettingsForm();
    setupReceiptSettingsActions();
  }

  /* =========================================================
     ★ Phase 2 (마일스톤 #16 단계 C) — 정기/잠재 후원자 화면
     - API 계약: docs/DESIGN_PHASE2.md §6.2·§6.3
     - 응답: ok() 헬퍼 wrap → unwrap(res.data, marker) 한 단계 unwrap
     ========================================================= */

  /* ---------- 채널 뱃지 (toss/hyosung) ---------- */
  const CHANNEL_LABEL = {
    toss:    { icon: '💳', text: '토스', cls: 'cms-b-info' },
    hyosung: { icon: '🏦', text: '효성', cls: 'cms-b-warn' },
  };
  function renderChannelBadges(channels) {
    if (!Array.isArray(channels) || channels.length === 0) {
      return `<span class="cms-badge cms-b-mute" style="color:#8a8a8a">─</span>`;
    }
    return channels.map(ch => {
      const meta = CHANNEL_LABEL[ch] || { icon: '·', text: ch, cls: 'cms-b-mute' };
      return `<span class="cms-badge ${meta.cls}" title="${escapeHtml(meta.text)}">${meta.icon} ${escapeHtml(meta.text)}</span>`;
    }).join(' ');
  }

  /* ============ C10. 정기 후원자 ============ */
  let donorRegularPage = 1;
  let donorRegularPageSize = 50;
  let donorRegularQuery = { channel: 'all', q: '' };
  let donorRegularSearchTimer = null;

  /* ★ Phase 3 D4 + D보강: 정기 후원자 효성 컬럼 헬퍼 (결제수단 + 약정일 + 최근 3개월 수납 점등) */

  /* 최근 N개월 YYYY/MM 배열 생성 (내림차순) */
  function recentMonthKeys(n) {
    const now = new Date();
    const keys = [];
    for (let i = 0; i < n; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      keys.push(d.getFullYear() + '/' + String(d.getMonth() + 1).padStart(2, '0'));
    }
    return keys;
  }

  /* 수납 상태 → 점등 HTML */
  function monthlyDot(entry) {
    if (!entry) return '<span title="데이터 없음" style="color:#d0d0d0;font-size:11px">—</span>';
    const s = entry.status || '';
    if (s === '완납' || s === 'completed') {
      return `<span title="${escapeHtml(entry.month)} 완납 ₩${Number(entry.amount||0).toLocaleString()}" style="color:#2e9744;font-size:12px;font-weight:600">✓</span>`;
    }
    if (s === '미납') {
      return `<span title="${escapeHtml(entry.month)} 미납" style="color:#c5293a;font-size:12px;font-weight:600">✗</span>`;
    }
    return `<span title="${escapeHtml(entry.month)} ${escapeHtml(s)}" style="color:#e09400;font-size:11px">△</span>`;
  }

  function renderDrMonthlyDots(d, n) {
    const billings = (d.monthlyBillings && Array.isArray(d.monthlyBillings)) ? d.monthlyBillings : [];
    if (billings.length === 0) return '';
    const months = recentMonthKeys(n || 3);
    const byMonth = {};
    billings.forEach(e => { byMonth[e.month] = e; });
    const dots = months.map(m => monthlyDot(byMonth[m])).join('<span style="color:#d8d8d8;margin:0 1px">·</span>');
    return `<div style="margin-top:2px;line-height:1">${dots}</div>`;
  }

  function renderDrHyosungPayment(d) {
    const hy = d.hyosungContract;
    const dots = renderDrMonthlyDots(d, 3);
    if (!hy) {
      if (d.channels && d.channels.includes('toss') && !d.channels.includes('hyosung')) {
        return `<div style="line-height:1.3"><span style="font-size:11px;color:#1a5ec4">토스 자동</span>${dots}</div>`;
      }
      return '<span style="color:#d0d0d0;font-size:12px">—</span>';
    }
    const method = hy.paymentMethod ? escapeHtml(hy.paymentMethod) : '—';
    const day = hy.promiseDay
      ? `<div style="font-size:10px;color:#888;margin-top:1px">매월 ${hy.promiseDay}일${dots}</div>`
      : dots ? `<div>${dots}</div>` : '';
    return `<div style="line-height:1.3"><div style="font-size:11.5px">${method}</div>${day}</div>`;
  }
  function renderDrHyosungRegStatus(d) {
    const hy = d.hyosungContract;
    if (!hy) return '<span style="color:#d0d0d0;font-size:12px">—</span>';
    const s = hy.registrationStatus;
    if (s === '신청완료') return '<span class="cms-badge cms-b-success" style="font-size:10.5px">신청완료</span>';
    if (s === '신청중')   return '<span class="cms-badge cms-b-warn" style="font-size:10.5px">신청중</span>';
    if (s === '기간만료') return '<span class="cms-badge cms-b-mute" style="font-size:10.5px">기간만료</span>';
    return `<span style="color:#888;font-size:11px">${escapeHtml(s || '—')}</span>`;
  }
  function renderDrBillingLifecycle(d) {
    const hy = d.hyosungContract;
    if (!hy || !hy.billingStart) return '<span style="color:#d0d0d0;font-size:12px">—</span>';
    const end = hy.billingEnd === '9999-12-31' ? '무기한' : (hy.billingEnd || '—');
    return `<span style="font-size:10.5px;color:#525252">${escapeHtml(hy.billingStart)}<br><span style="color:#aaa">~${escapeHtml(end)}</span></span>`;
  }

  async function fetchDonorRegular(query) {
    const qs = new URLSearchParams();
    Object.entries(query).forEach(([k, v]) => { if (v !== '' && v != null) qs.set(k, v); });
    const res = await api('/api/admin/donor-regular-list?' + qs.toString());
    if (!res.ok) throw new Error(res.data?.error || ('HTTP ' + res.status));
    // ok() 헬퍼 wrap → 한 단계 unwrap (Phase 1과 동일 패턴)
    return unwrap(res.data, ['data', 'kpi', 'total']);
  }

  async function renderDonorRegular() {
    const tbody = document.getElementById('drBody');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:40px;color:#888">불러오는 중…</td></tr>`;

    let resp;
    try {
      resp = await fetchDonorRegular({
        channel: donorRegularQuery.channel,
        q: donorRegularQuery.q,
        page: donorRegularPage,
        pageSize: donorRegularPageSize,
      });
    } catch (err) {
      console.error('[donor-regular] fetch fail', err);
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:40px;color:#c5293a">불러오기 실패: ${escapeHtml(err?.message || err)}</td></tr>`;
      renderDonorRegularKpi(null);
      renderDonorRegularPagination(0);
      return;
    }

    const rows = resp.data || [];
    const total = resp.total ?? rows.length;
    renderDonorRegularKpi(resp.kpi || null);

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:40px;color:#888">조회 결과가 없습니다</td></tr>`;
      renderDonorRegularPagination(0);
      return;
    }

    tbody.innerHTML = rows.map(d => `
      <tr>
        <td>M-${String(d.id).padStart(5,'0')}</td>
        <td><strong>${escapeHtml(d.name || '')}</strong></td>
        <td style="font-family:Inter;font-size:11.5px">${escapeHtml(d.phone || '—')}</td>
        <td>${renderChannelBadges(d.channels)}</td>
        <td style="text-align:right;font-weight:600">${d.regularAmount != null ? '₩' + Number(d.regularAmount).toLocaleString() : '—'}</td>
        <td style="font-family:Inter;font-size:11.5px">${formatDate(d.nextBillingDate)}</td>
        <td style="text-align:right;font-family:Inter;font-size:11.5px">${(d.cumulativeMonths ?? 0).toLocaleString()}개월</td>
        <td style="text-align:right;font-family:Inter;font-size:11.5px">₩${Number(d.cumulativeAmount || 0).toLocaleString()}</td>
        <td>${renderDrHyosungPayment(d)}</td>
        <td>${renderDrHyosungRegStatus(d)}</td>
        <td>${renderDrBillingLifecycle(d)}</td>
      </tr>
    `).join('');

    renderDonorRegularPagination(total);
  }

  function renderDonorRegularKpi(kpi) {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    if (!kpi) { ['drKpiTotal','drKpiToss','drKpiHyosung','drKpiBoth','drKpiSum'].forEach(id => set(id, '—')); return; }
    set('drKpiTotal',   (kpi.regularTotal ?? 0).toLocaleString() + '명');
    set('drKpiToss',    (kpi.tossCount ?? 0).toLocaleString() + '명');
    set('drKpiHyosung', (kpi.hyosungCount ?? 0).toLocaleString() + '명');
    set('drKpiBoth',    (kpi.bothCount ?? 0).toLocaleString() + '명');
    set('drKpiSum',     '₩' + Number(kpi.monthlyAmountSum || 0).toLocaleString());
  }

  function renderDonorRegularPagination(total) {
    const pager = document.getElementById('drPagination');
    if (!pager) return;
    if (total === 0) { pager.innerHTML = ''; return; }
    const totalPages = Math.max(1, Math.ceil(total / donorRegularPageSize));
    const prev = donorRegularPage > 1
      ? `<button class="cms-btn cms-btn-ghost" data-drp="${donorRegularPage - 1}">← 이전</button>` : '';
    const next = donorRegularPage < totalPages
      ? `<button class="cms-btn cms-btn-ghost" data-drp="${donorRegularPage + 1}">다음 →</button>` : '';
    pager.innerHTML = prev
      + `<span class="cms-donor-pagination-info">${donorRegularPage} / ${totalPages} · 총 ${total.toLocaleString()}명</span>`
      + next;
    pager.querySelectorAll('[data-drp]').forEach(b => {
      b.addEventListener('click', () => { donorRegularPage = Number(b.dataset.drp); renderDonorRegular(); });
    });
  }

  function setupDonorRegularFilters() {
    const ch = document.getElementById('drFilterChannel');
    if (ch) ch.addEventListener('change', () => {
      donorRegularQuery.channel = ch.value || 'all';
      donorRegularPage = 1;
      renderDonorRegular();
    });
    const search = document.getElementById('drFilterSearch');
    if (search) search.addEventListener('input', () => {
      clearTimeout(donorRegularSearchTimer);
      donorRegularSearchTimer = setTimeout(() => {
        donorRegularQuery.q = search.value.trim();
        donorRegularPage = 1;
        renderDonorRegular();
      }, 250);
    });
    const btn = document.getElementById('drBtnRefresh');
    if (btn) btn.addEventListener('click', () => {
      toast('정기 후원자 목록을 새로고침합니다');
      renderDonorRegular();
    });
  }

  /* ============ C11. 잠재 후원자 ============ */
  let donorProspectPage = 1;
  let donorProspectPageSize = 50;
  let donorProspectQuery = { subtype: 'all', q: '' };
  let donorProspectSearchTimer = null;

  async function fetchDonorProspect(query) {
    const qs = new URLSearchParams();
    Object.entries(query).forEach(([k, v]) => { if (v !== '' && v != null) qs.set(k, v); });
    const res = await api('/api/admin/donor-prospect-list?' + qs.toString());
    if (!res.ok) throw new Error(res.data?.error || ('HTTP ' + res.status));
    return unwrap(res.data, ['data', 'kpi', 'total']);
  }

  const SUBTYPE_LABEL = {
    onetime:   { icon: '🎁', text: '일시',   cls: 'cms-b-info' },
    cancelled: { icon: '⏸',  text: '중단',   cls: 'cms-b-danger' },
  };
  function renderProspectSubtypeBadge(d) {
    const meta = SUBTYPE_LABEL[d.subtype] || { icon: '—', text: d.subtype || '—', cls: 'cms-b-mute' };
    let html = `<span class="cms-badge ${meta.cls}">${meta.icon} ${escapeHtml(meta.text)}</span>`;
    if (d.subtype === 'cancelled' && d.cancelledChannel) {
      const ch = CHANNEL_LABEL[d.cancelledChannel];
      if (ch) html += ` <span class="cms-badge cms-b-mute" title="${escapeHtml(ch.text)} 해지">${ch.icon} ${escapeHtml(ch.text)}</span>`;
    }
    return html;
  }

  async function renderDonorProspect() {
    const tbody = document.getElementById('dpBody');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:40px;color:#888">불러오는 중…</td></tr>`;

    let resp;
    try {
      resp = await fetchDonorProspect({
        subtype: donorProspectQuery.subtype,
        q: donorProspectQuery.q,
        page: donorProspectPage,
        pageSize: donorProspectPageSize,
      });
    } catch (err) {
      console.error('[donor-prospect] fetch fail', err);
      tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:40px;color:#c5293a">불러오기 실패: ${escapeHtml(err?.message || err)}</td></tr>`;
      renderDonorProspectKpi(null);
      renderDonorProspectPagination(0);
      return;
    }

    const rows = resp.data || [];
    const total = resp.total ?? rows.length;
    renderDonorProspectKpi(resp.kpi || null);

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="12" style="text-align:center;padding:40px;color:#888">조회 결과가 없습니다</td></tr>`;
      renderDonorProspectPagination(0);
      return;
    }

    const channelBadge = (ch) => {
      if (ch === 'hyosung')   return '<span class="cms-badge cms-b-info" title="효성 CMS+">효성</span>';
      if (ch === 'donations') return '<span class="cms-badge cms-b-success" title="토스/일반 후원">토스</span>';
      if (ch === 'contract')  return '<span class="cms-badge cms-b-warn" title="효성 약정만 등록 (수납 기록 없음)">약정</span>';
      return '<span style="color:#bbb">—</span>';
    };

    tbody.innerHTML = rows.map(d => `
      <tr>
        <td>M-${String(d.id).padStart(5,'0')}</td>
        <td><strong>${escapeHtml(d.name || '')}</strong></td>
        <td style="font-family:Inter;font-size:11.5px">${escapeHtml(d.phone || '—')}</td>
        <td style="font-size:12px">${escapeHtml(d.eventName || '—')}</td>
        <td>${channelBadge(d.donorChannel)}</td>
        <td>${renderProspectSubtypeBadge(d)}</td>
        <td style="font-family:Inter;font-size:11.5px;color:${d.cancelledAt ? '#c5293a' : '#aaa'}">${d.cancelledAt ? formatDate(d.cancelledAt) : '—'}</td>
        <td style="font-family:Inter;font-size:11.5px">${formatDate(d.lastDonationDate)}</td>
        <td style="text-align:right;font-weight:600">${d.lastDonationAmount != null ? '₩' + Number(d.lastDonationAmount).toLocaleString() : '—'}</td>
        <td style="text-align:right;font-family:Inter;font-size:11.5px">${(d.totalDonationCount ?? 0).toLocaleString()}건</td>
        <td style="text-align:right;font-family:Inter;font-size:11.5px">₩${Number(d.totalDonationAmount || 0).toLocaleString()}</td>
        <td>
          <button class="cms-btn-link" data-dp-action="email" data-id="${d.id}" title="재유치 (준비 중)">📨 이메일</button>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-dp-action="email"]').forEach(btn => {
      btn.addEventListener('click', () => toast('재유치 이메일 기능은 준비 중입니다'));
    });

    renderDonorProspectPagination(total);
  }

  function renderDonorProspectKpi(kpi) {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    if (!kpi) { ['dpKpiTotal','dpKpiOnetime','dpKpiCancelled'].forEach(id => set(id, '—')); return; }
    set('dpKpiTotal',     (kpi.prospectTotal ?? 0).toLocaleString() + '명');
    set('dpKpiOnetime',   (kpi.onetimeCount ?? 0).toLocaleString() + '명');
    set('dpKpiCancelled', (kpi.cancelledCount ?? 0).toLocaleString() + '명');
  }

  function renderDonorProspectPagination(total) {
    const pager = document.getElementById('dpPagination');
    if (!pager) return;
    if (total === 0) { pager.innerHTML = ''; return; }
    const totalPages = Math.max(1, Math.ceil(total / donorProspectPageSize));
    const prev = donorProspectPage > 1
      ? `<button class="cms-btn cms-btn-ghost" data-dpp="${donorProspectPage - 1}">← 이전</button>` : '';
    const next = donorProspectPage < totalPages
      ? `<button class="cms-btn cms-btn-ghost" data-dpp="${donorProspectPage + 1}">다음 →</button>` : '';
    pager.innerHTML = prev
      + `<span class="cms-donor-pagination-info">${donorProspectPage} / ${totalPages} · 총 ${total.toLocaleString()}명</span>`
      + next;
    pager.querySelectorAll('[data-dpp]').forEach(b => {
      b.addEventListener('click', () => { donorProspectPage = Number(b.dataset.dpp); renderDonorProspect(); });
    });
  }

  function setupDonorProspectFilters() {
    document.querySelectorAll('.dp-subtab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.dp-subtab').forEach(x => x.classList.remove('on'));
        tab.classList.add('on');
        donorProspectQuery.subtype = tab.dataset.dpSubtype || 'all';
        donorProspectPage = 1;
        renderDonorProspect();
      });
    });
    const search = document.getElementById('dpFilterSearch');
    if (search) search.addEventListener('input', () => {
      clearTimeout(donorProspectSearchTimer);
      donorProspectSearchTimer = setTimeout(() => {
        donorProspectQuery.q = search.value.trim();
        donorProspectPage = 1;
        renderDonorProspect();
      }, 250);
    });
    const btn = document.getElementById('dpBtnRefresh');
    if (btn) btn.addEventListener('click', () => {
      toast('잠재 후원자 목록을 새로고침합니다');
      renderDonorProspect();
    });
  }

  /* ============ ★ Phase 3 D7: 종합 검증 대시보드 ============ */

  async function fetchDonationDashboard() {
    const res = await api('/api/admin/donation-dashboard');
    if (!res.ok) throw new Error(res.data?.error || ('HTTP ' + res.status));
    return unwrap(res.data, ['kpi', 'alerts', 'recentCsvImports']);
  }

  async function renderDonationDashboard() {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    const alertPanel = document.getElementById('ddAlertPanel');
    const csvHistory = document.getElementById('ddCsvHistory');
    const generatedAt = document.getElementById('ddGeneratedAt');

    let resp;
    try {
      resp = await fetchDonationDashboard();
    } catch (err) {
      console.error('[donation-dashboard] fetch fail', err);
      if (alertPanel) alertPanel.innerHTML = `<div style="color:#c5293a;padding:20px">불러오기 실패: ${escapeHtml(err?.message || err)}</div>`;
      return;
    }

    const kpi = resp.kpi || {};
    const ch = kpi.regularByChannel || {};
    const ps = kpi.prospectBySubtype || {};
    set('ddKpiTotal',          (kpi.membersTotal ?? 0).toLocaleString() + '명');
    set('ddKpiRegular',        (kpi.regularTotal ?? 0).toLocaleString() + '명');
    set('ddKpiRegularDetail',  `효성 ${ch.hyosung ?? 0}·토스 ${ch.toss ?? 0}·둘다 ${ch.both ?? 0}`);
    set('ddKpiHyosung',        (ch.hyosung ?? 0).toLocaleString() + '명');
    set('ddKpiToss',           (ch.toss ?? 0).toLocaleString() + '명');
    set('ddKpiProspect',       (kpi.prospectTotal ?? 0).toLocaleString() + '명');
    set('ddKpiProspectDetail', `일시 ${ps.onetime ?? 0}·중단 ${ps.cancelled ?? 0}`);
    set('ddKpiNon',            (kpi.nonDonor ?? 0).toLocaleString() + '명');
    if (generatedAt) {
      generatedAt.textContent = resp.generatedAt ? '기준: ' + formatDate(resp.generatedAt) : '';
    }

    const ALERT_META = {
      unmatchedHyosungContract: { icon: '⚠️', label: '미매칭 효성 계약', cls: 'dd-alert-warn' },
      unmatchedHyosungBilling:  { icon: '⚠️', label: '미매칭 효성 수납', cls: 'dd-alert-warn' },
      donorTypeConflict:        { icon: '🔴', label: '후원 상태 충돌',    cls: 'dd-alert-danger' },
      recentCancellation:       { icon: '📉', label: '최근 해지',         cls: 'dd-alert-info' },
    };
    const alerts = resp.alerts || [];
    const alertTotal = alerts.reduce((sum, a) => sum + (a.count || 0), 0);
    const alertBadge = document.getElementById('ddAlertTotalBadge');
    if (alertBadge) {
      alertBadge.textContent = `총 ${alertTotal.toLocaleString()}건`;
      alertBadge.className = alertTotal === 0
        ? 'cms-badge cms-b-success'
        : (alerts.some(a => a.type === 'donorTypeConflict' && a.count > 0) ? 'cms-badge cms-b-danger' : 'cms-badge cms-b-warn');
      alertBadge.style.marginLeft = '6px';
      alertBadge.style.fontSize = '10.5px';
    }
    if (alertPanel) {
      if (alerts.length === 0 || alerts.every(a => a.count === 0)) {
        alertPanel.innerHTML = '<div style="text-align:center;color:#1a8b46;padding:24px">✅ 검증 alert 없음 — 데이터 정합성 양호</div>';
      } else {
        alertPanel.innerHTML = alerts.filter(a => a.count > 0).map(a => {
          const meta = ALERT_META[a.type] || { icon: '•', label: a.type, cls: 'dd-alert-info' };
          const samples = (a.samples || []).slice(0, 3).map(s =>
            `<li>${escapeHtml(s.description)}</li>`
          ).join('');
          const action = a.type === 'unmatchedHyosungContract'
            ? '<div class="dd-alert-action">💡 효성 CMS+ 관리 탭에서 미매칭 계약을 확인하고, 수동 매칭하거나 신규 회원 자동 생성하세요.</div>'
            : '';
          return `
            <div class="dd-alert-card ${meta.cls}">
              <div class="dd-alert-header">
                <span>${meta.icon} ${escapeHtml(meta.label)}</span>
                <span class="dd-alert-count">${a.count.toLocaleString()}건</span>
              </div>
              ${samples ? `<ul class="dd-alert-samples">${samples}</ul>` : ''}
              ${action}
            </div>`;
        }).join('') || '<div style="text-align:center;color:#1a8b46;padding:24px">✅ 검증 alert 없음 — 데이터 정합성 양호</div>';
      }
    }

    const SOURCE_LABEL = {
      hyosung_contracts: '📋 효성 계약정보',
      hyosung_billings:  '📅 효성 수납내역',
      ibk:               '🏛 IBK 거래',
      toss:              '💳 토스',
    };
    const imports = resp.recentCsvImports || [];
    if (csvHistory) {
      csvHistory.innerHTML = imports.length === 0
        ? `<tr><td colspan="5" style="text-align:center;padding:30px;color:#888">CSV import 이력이 없습니다</td></tr>`
        : imports.map(imp => `
          <tr>
            <td style="font-family:Inter;font-size:11.5px">${formatDate(imp.uploadedAt)}</td>
            <td>${escapeHtml(SOURCE_LABEL[imp.source] || imp.source)}</td>
            <td style="text-align:right">${(imp.totalRows || 0).toLocaleString()}</td>
            <td style="text-align:right">${(imp.matched || 0).toLocaleString()}</td>
            <td style="text-align:right">${(imp.created || 0).toLocaleString()}</td>
          </tr>`).join('');
    }

    document.getElementById('ddBtnRefresh')?.addEventListener('click', () => {
      toast('종합 검증 대시보드를 새로고침합니다');
      renderDonationDashboard();
    }, { once: true });

    // KPI 카드 클릭 → 정기/잠재 탭 점프 (D7 폴리시)
    document.querySelectorAll('[data-dd-jump]').forEach(card => {
      card.addEventListener('click', () => {
        const tab = card.dataset.ddJump;
        const link = document.querySelector(`.cms-menu a[data-tab="${tab}"]`);
        if (link) link.click();
      }, { once: true });
    });
  }

  /* ============ 초기화 ============ */
  async function init() {
    const auth = await checkAuth();
    if (!auth) return;

    /* 사용자 정보 표시 */
    const nameEl = document.getElementById('cmsUserName');
    const avatarEl = document.getElementById('cmsAvatar');
    if (nameEl && auth.admin.name) nameEl.textContent = auth.admin.name + '님';
    if (avatarEl && auth.admin.name) avatarEl.textContent = auth.admin.name.charAt(0);

    setupTabs();
    setupMembersFilter();
    setupMemberDetailModal(); /* ★ Phase 1 단계 B */
    setupManualForm();
    setupFileUpload();
    setupTransferActions();
    setupNotifyForm();
    setupExport();
    setupReceiptSettings(); /* ★ STEP H-2d-4 */
    setupHyosung(); /* ★ Phase 1 */
    setupTossBilling(); /* ★ Phase 2 */
    setupDonorRegularFilters(); /* ★ Phase 2 C10 */
    setupDonorProspectFilters(); /* ★ Phase 2 C11 */

    renderDashboard();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* 전역 노출 — IIFE 외부 발송 탭 함수들이 공유 사용 (★ 진짜 IIFE 내부) */
  window._cmsApi   = api;
  window._cmsToast = toast;
  window._cmsEsc   = escapeHtml;
  window._cmsFmt   = formatDate;
})();
/* ============================================================
   ★ Phase 2: 토스 빌링 자동 청구 관리
   ============================================================ */

let tbKeysPage = 1;
let tbLogsPage = 1;

function switchTbTab(target) {
  document.querySelectorAll('.tb-tab').forEach(t => {
    const on = t.dataset.tbTab === target;
    t.classList.toggle('on', on);
    t.style.borderBottom = on ? '3px solid #3c7c42' : '3px solid transparent';
    t.style.fontWeight = on ? '600' : 'normal';
  });
  document.querySelectorAll('.tb-pane').forEach(p => {
    p.style.display = p.dataset.tbPane === target ? 'block' : 'none';
  });

  if (target === 'keys') loadTbKeys();
  else if (target === 'logs') loadTbLogs();
  else if (target === 'schedule') loadTbSchedule();
}

/* ────────── 탭 1: 빌링키 관리 ────────── */

async function loadTbKeysStats() {
  try {
    const res = await api('/api/admin/billing-keys?stats=1');
    const d = res?.data || res;
    const fmt = n => (n || 0).toLocaleString();
    setText('tbStatTotal', fmt(d.totalCount));
    setText('tbStatActive', fmt(d.activeCount));
    setText('tbStatRisky', fmt(d.riskyCount));
    setText('tbStatMonthly', fmt(d.monthlyTotal) + '원');
  } catch (e) { console.warn('[tb] stats', e); }
}

async function loadTbKeys() {
  await loadTbKeysStats();
  try {
    const search = (document.getElementById('tbKeysSearch')?.value || '').trim();
    const status = document.getElementById('tbKeysStatus')?.value || '';
    const params = new URLSearchParams({ list: '1', page: String(tbKeysPage), pageSize: '50' });
    if (search) params.set('search', search);
    if (status) params.set('status', status);

    const res = await api('/api/admin/billing-keys?' + params.toString());
    const data = res?.data || res;
    const rows = data.list || [];
    const tbody = document.getElementById('tbKeysBody');
    if (!tbody) return;

    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="10" style="padding:20px;text-align:center;color:#999">조회된 빌링키가 없습니다</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map(r => {
      const statusBadge = r.isActive
        ? '<span style="padding:2px 8px;background:#e8f5e9;color:#2e7d32;border-radius:4px;font-size:12px">활성</span>'
        : '<span style="padding:2px 8px;background:#ffebee;color:#c62828;border-radius:4px;font-size:12px">해지</span>';
      const failBadge = (r.consecutiveFailCount || 0) > 0
        ? `<span style="color:#c62828;font-weight:600">${r.consecutiveFailCount}회</span>`
        : '<span style="color:#999">-</span>';
      const nextCharge = r.nextBillingDate ? new Date(r.nextBillingDate).toLocaleDateString('ko-KR') : '-';
      const expiryDisplay = r.cardExpiryMonth || '<span style="color:#c62828">미입력</span>';
      const toggleBtn = r.isActive
        ? `<button class="cms-btn" onclick="tbToggleKeyActive(${r.id}, false)" style="background:#d32f2f;color:#fff;padding:4px 8px;font-size:12px">해지</button>`
        : `<button class="cms-btn" onclick="tbToggleKeyActive(${r.id}, true)" style="background:#2e7d32;color:#fff;padding:4px 8px;font-size:12px">재활성</button>`;

      return `<tr>
        <td>${r.id}</td>
        <td><strong>${escapeHtml(r.memberName || '-')}</strong><br /><span style="color:#888;font-size:12px">${escapeHtml(r.memberEmail || '')}</span></td>
        <td>${escapeHtml(r.cardCompany || '-')}<br /><span style="color:#888;font-size:12px">${escapeHtml(r.cardNumberMasked || '')}</span></td>
        <td>${expiryDisplay} <a href="#" onclick="tbEditExpiryMonth(${r.id}, '${r.cardExpiryMonth || ''}'); return false" style="font-size:11px;color:#1976d2">✏️</a></td>
        <td>${r.billingDay || '-'}일</td>
        <td>${nextCharge}</td>
        <td style="text-align:right">${(r.amount || 0).toLocaleString()}원</td>
        <td>${statusBadge}</td>
        <td style="text-align:center">${failBadge}</td>
        <td>${toggleBtn} <button class="cms-btn" onclick="tbManualCharge(${r.memberId}, '${escapeHtml(r.memberName || '')}')" style="padding:4px 8px;font-size:12px">즉시청구</button></td>
      </tr>`;
    }).join('');

    renderTbPagination('tbKeysPagination', data.page, data.pageSize, data.total, (p) => { tbKeysPage = p; loadTbKeys(); });
  } catch (e) {
    console.error('[tb] loadTbKeys', e);
    alert('빌링키 조회 실패: ' + (e?.message || e));
  }
}

async function tbToggleKeyActive(id, newActive) {
  const reason = newActive ? null : (prompt('해지 사유를 입력하세요:', '관리자 수동 해지') || '관리자 수동 해지');
  if (!newActive && reason === null) return;
  try {
    const res = await api('/api/admin/billing-keys', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, isActive: newActive, deactivatedReason: reason })
    });
    alert(newActive ? '빌링키가 재활성화되었습니다' : '빌링키가 해지되었습니다');
    loadTbKeys();
  } catch (e) {
    alert('변경 실패: ' + (e?.message || e));
  }
}

async function tbEditExpiryMonth(id, current) {
  const newVal = prompt('카드 만료월 (YYMM 형식, 예: 2712):', current || '');
  if (newVal === null) return;
  const v = newVal.trim();
  if (v && !/^\d{4}$/.test(v)) {
    alert('YYMM 4자리 형식으로 입력하세요 (예: 2712)');
    return;
  }
  try {
    await api('/api/admin/billing-keys', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, cardExpiryMonth: v || null })
    });
    alert('만료월이 저장되었습니다');
    loadTbKeys();
  } catch (e) {
    alert('저장 실패: ' + (e?.message || e));
  }
}

async function tbManualCharge(memberId, memberName) {
  if (!confirm(`${memberName}님에게 즉시 청구를 예약하시겠습니까?\n(다음 cron 실행 시 자동 처리됩니다)`)) return;
  try {
    await api('/api/admin/billing-logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'manual_charge', memberId })
    });
    alert('즉시 청구가 예약되었습니다. 다음 cron 실행 시 자동 처리됩니다.');
    loadTbKeys();
  } catch (e) {
    alert('예약 실패: ' + (e?.message || e));
  }
}

/* ────────── 탭 2: 빌링 이력 ────────── */

async function loadTbLogsStats() {
  try {
    const res = await api('/api/admin/billing-logs?stats=1&days=30');
    const d = res?.data || res;
    setText('tbLogsTotal', (d.total || 0).toLocaleString() + '건');
    setText('tbLogsRate', (d.successRate || 0) + '%');
    setText('tbLogsFailed', (d.failedCount || 0).toLocaleString() + '건');
    setText('tbLogsAmount', (d.totalAmount || 0).toLocaleString() + '원');

    const top = document.getElementById('tbLogsTopErrorsList');
    if (top) {
      if (!d.topErrors || d.topErrors.length === 0) {
        top.innerHTML = '<span style="color:#2e7d32">최근 30일 실패 없음 ✅</span>';
      } else {
        top.innerHTML = d.topErrors.map((e, i) =>
          `${i + 1}. <code style="background:#f5f5f5;padding:2px 6px;border-radius:3px">${escapeHtml(e.code)}</code> — <strong>${e.count}건</strong>`
        ).join('<br />');
      }
    }
  } catch (e) { console.warn('[tb] logs stats', e); }
}

async function loadTbLogs() {
  await loadTbLogsStats();
  try {
    const status = document.getElementById('tbLogsStatus')?.value || '';
    const attemptType = document.getElementById('tbLogsAttemptType')?.value || '';
    const params = new URLSearchParams({ list: '1', page: String(tbLogsPage), pageSize: '50' });
    if (status) params.set('status', status);
    if (attemptType) params.set('attemptType', attemptType);

    const res = await api('/api/admin/billing-logs?' + params.toString());
    const data = res?.data || res;
    const rows = data.list || [];
    const tbody = document.getElementById('tbLogsBody');
    if (!tbody) return;

    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" style="padding:20px;text-align:center;color:#999">조회된 로그가 없습니다</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map(r => {
      const dt = r.requestedAt ? new Date(r.requestedAt).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-';
      const statusBadge = r.status === 'success'
        ? '<span style="padding:2px 8px;background:#e8f5e9;color:#2e7d32;border-radius:4px;font-size:12px">✓ 성공</span>'
        : r.status === 'failed'
          ? '<span style="padding:2px 8px;background:#ffebee;color:#c62828;border-radius:4px;font-size:12px">✗ 실패</span>'
          : '<span style="padding:2px 8px;background:#fff3e0;color:#e65100;border-radius:4px;font-size:12px">⏳ 대기</span>';
      const typeLabel = { scheduled: '정기', retry: '재시도', manual: '수동' }[r.attemptType] || r.attemptType;
      const errorCell = r.status === 'failed' && r.tossResponseCode
        ? `<code style="background:#ffebee;padding:2px 6px;border-radius:3px;font-size:11px">${escapeHtml(r.tossResponseCode)}</code><br /><span style="color:#888;font-size:11px">${escapeHtml((r.tossResponseMessage || '').slice(0, 50))}</span>`
        : '-';
      const retryBtn = (r.status === 'failed' && (r.attemptNumber || 1) < 3)
        ? `<button class="cms-btn" onclick="tbRetryLog(${r.id})" style="padding:4px 8px;font-size:12px;background:#1976d2;color:#fff">재시도</button>`
        : '-';

      return `<tr>
        <td>${r.id}</td>
        <td style="font-size:12px">${dt}</td>
        <td>${escapeHtml(r.memberName || '-')}<br /><span style="color:#888;font-size:11px">${escapeHtml(r.memberEmail || '')}</span></td>
        <td>${typeLabel}</td>
        <td style="text-align:center">${r.attemptNumber}</td>
        <td style="text-align:right">${(r.amount || 0).toLocaleString()}원</td>
        <td>${statusBadge}</td>
        <td>${errorCell}</td>
        <td>${retryBtn}</td>
      </tr>`;
    }).join('');

    renderTbPagination('tbLogsPagination', data.page, data.pageSize, data.total, (p) => { tbLogsPage = p; loadTbLogs(); });
  } catch (e) {
    console.error('[tb] loadTbLogs', e);
    alert('로그 조회 실패: ' + (e?.message || e));
  }
}

async function tbRetryLog(logId) {
  if (!confirm('이 실패 건을 재시도 하시겠습니까? (다음 cron 실행 시 처리됩니다)')) return;
  try {
    await api('/api/admin/billing-logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'retry', logId })
    });
    alert('재시도가 예약되었습니다');
    loadTbLogs();
  } catch (e) {
    alert('재시도 실패: ' + (e?.message || e));
  }
}

/* ────────── 탭 3: 스케줄 & 만료 ────────── */

async function loadTbSchedule() {
  const upcomingEl = document.getElementById('tbScheduleUpcoming');
  const expiringEl = document.getElementById('tbScheduleExpiring');
  if (upcomingEl) upcomingEl.innerHTML = '조회 중…';
  if (expiringEl) expiringEl.innerHTML = '조회 중…';

  try {
    // 다음 30일 청구 예정 = billing_keys list 중 nextBillingDate 기준 정렬
    const res = await api('/api/admin/billing-keys?list=1&pageSize=200&status=active');
    const data = res?.data || res;
    const rows = (data.list || []).filter(r => r.nextBillingDate);

    // 30일 이내 필터링
    const now = new Date();
    const in30 = new Date(now);
    in30.setDate(in30.getDate() + 30);
    const upcoming = rows.filter(r => {
      const d = new Date(r.nextBillingDate);
      return d >= now && d <= in30;
    }).sort((a, b) => new Date(a.nextBillingDate) - new Date(b.nextBillingDate));

    if (upcomingEl) {
      if (upcoming.length === 0) {
        upcomingEl.innerHTML = '<span style="color:#999">30일 이내 청구 예정자가 없습니다</span>';
      } else {
        upcomingEl.innerHTML = '<div style="max-height:400px;overflow-y:auto">' +
          upcoming.slice(0, 50).map(r => `
            <div style="padding:8px;border-bottom:1px solid #f0f0f0;display:flex;justify-content:space-between;align-items:center">
              <div>
                <strong>${escapeHtml(r.memberName || '-')}</strong>
                <span style="color:#888;font-size:12px">${new Date(r.nextBillingDate).toLocaleDateString('ko-KR')}</span>
              </div>
              <span style="color:#2e7d32;font-weight:600">${(r.amount || 0).toLocaleString()}원</span>
            </div>
          `).join('') +
          (upcoming.length > 50 ? `<div style="padding:8px;text-align:center;color:#888;font-size:12px">... 외 ${upcoming.length - 50}명</div>` : '') +
          '</div>';
      }
    }

    // 만료 예정/만료됨 = cardExpiryMonth 기준
    const currentYY = String(now.getFullYear()).slice(2);
    const currentMM = String(now.getMonth() + 1).padStart(2, '0');
    const currentYYMM = `${currentYY}${currentMM}`;
    const in30YY = String(in30.getFullYear()).slice(2);
    const in30MM = String(in30.getMonth() + 1).padStart(2, '0');
    const in30YYMM = `${in30YY}${in30MM}`;

    const expiring = rows.filter(r => {
      if (!r.cardExpiryMonth || r.cardExpiryMonth.length !== 4) return false;
      return r.cardExpiryMonth <= in30YYMM;
    }).sort((a, b) => (a.cardExpiryMonth || '').localeCompare(b.cardExpiryMonth || ''));

    if (expiringEl) {
      if (expiring.length === 0) {
        expiringEl.innerHTML = '<span style="color:#2e7d32">30일 이내 만료 예정 카드 없음 ✅</span>';
      } else {
        expiringEl.innerHTML = '<div style="max-height:400px;overflow-y:auto">' +
          expiring.map(r => {
            const isExpired = r.cardExpiryMonth < currentYYMM;
            const badge = isExpired
              ? '<span style="padding:2px 6px;background:#ffebee;color:#c62828;border-radius:3px;font-size:11px">만료됨</span>'
              : '<span style="padding:2px 6px;background:#fff3e0;color:#e65100;border-radius:3px;font-size:11px">예정</span>';
            const yy = r.cardExpiryMonth.slice(0, 2);
            const mm = r.cardExpiryMonth.slice(2);
            return `
              <div style="padding:8px;border-bottom:1px solid #f0f0f0;display:flex;justify-content:space-between;align-items:center">
                <div>
                  <strong>${escapeHtml(r.memberName || '-')}</strong> ${badge}
                  <br /><span style="color:#888;font-size:12px">${escapeHtml(r.cardCompany || '')} ${escapeHtml(r.cardNumberMasked || '')} · 20${yy}년 ${mm}월</span>
                </div>
              </div>
            `;
          }).join('') + '</div>';
      }
    }
  } catch (e) {
    console.error('[tb] schedule', e);
    if (upcomingEl) upcomingEl.innerHTML = '<span style="color:#c62828">조회 실패</span>';
    if (expiringEl) expiringEl.innerHTML = '<span style="color:#c62828">조회 실패</span>';
  }
}

/* ────────── 공통 헬퍼 ────────── */

function renderTbPagination(containerId, page, pageSize, total, onClick) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) { el.innerHTML = ''; return; }

  const prev = page > 1 ? `<button class="cms-btn" data-tb-page="${page - 1}">← 이전</button>` : '';
  const next = page < totalPages ? `<button class="cms-btn" data-tb-page="${page + 1}">다음 →</button>` : '';
  const info = `<span style="align-self:center;color:#666">${page} / ${totalPages} (총 ${total.toLocaleString()}건)</span>`;
  el.innerHTML = prev + info + next;
  el.querySelectorAll('[data-tb-page]').forEach(b => {
    b.addEventListener('click', () => onClick(Number(b.dataset.tbPage)));
  });
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function setupTossBilling() {
  document.querySelectorAll('.tb-tab').forEach(t => {
    t.addEventListener('click', () => switchTbTab(t.dataset.tbTab));
  });
  document.getElementById('tbKeysRefresh')?.addEventListener('click', () => { tbKeysPage = 1; loadTbKeys(); });
  document.getElementById('tbKeysSearch')?.addEventListener('input', () => {
    clearTimeout(window._tbKeysSearchTimer);
    window._tbKeysSearchTimer = setTimeout(() => { tbKeysPage = 1; loadTbKeys(); }, 400);
  });
  document.getElementById('tbKeysStatus')?.addEventListener('change', () => { tbKeysPage = 1; loadTbKeys(); });

  document.getElementById('tbLogsRefresh')?.addEventListener('click', () => { tbLogsPage = 1; loadTbLogs(); });
  document.getElementById('tbLogsStatus')?.addEventListener('change', () => { tbLogsPage = 1; loadTbLogs(); });
  document.getElementById('tbLogsAttemptType')?.addEventListener('change', () => { tbLogsPage = 1; loadTbLogs(); });
}

/* ============================================================
   ★ Phase 2: 토스 빌링 자동 청구 관리
   ============================================================ */


/* ============================================================
   ★ 잠재 후원자 관리 (potential_donors) — 이벤트·활동 참여자
   ============================================================ */

let potentialDonorQuery = { q: '', eventName: '', linked: 'all' };
let potentialDonorPage = 1;
const potentialDonorPageSize = 50;
let potentialDonorSearchTimer = null;

async function renderPotentialDonor() {
  const tbody = document.getElementById('pdBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:40px;color:#888">불러오는 중…</td></tr>';

  let resp;
  try {
    const qs = new URLSearchParams();
    if (potentialDonorQuery.q) qs.set('q', potentialDonorQuery.q);
    if (potentialDonorQuery.eventName) qs.set('eventName', potentialDonorQuery.eventName);
    if (potentialDonorQuery.linked !== 'all') qs.set('linked', potentialDonorQuery.linked);
    qs.set('page', String(potentialDonorPage));
    qs.set('pageSize', String(potentialDonorPageSize));
    const res = await api('/api/admin/potential-donor-list?' + qs.toString());
    if (!res.ok) throw new Error(res.data?.error || 'HTTP ' + res.status);
    resp = unwrap(res.data, ['data', 'kpi', 'total']);
  } catch (err) {
    console.error('[potential-donor] fetch fail', err);
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:40px;color:#c5293a">불러오기 실패: ' + escapeHtml(String(err?.message || err)) + '</td></tr>';
    return;
  }

  const rows = resp.data || [];
  const total = resp.total != null ? resp.total : rows.length;
  const kpi = resp.kpi || {};
  const set = function(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('pdKpiTotal', (kpi.total != null ? kpi.total : 0).toLocaleString() + '명');
  set('pdKpiLinked', (kpi.linked != null ? kpi.linked : 0).toLocaleString() + '명');
  set('pdKpiUnlinked', (kpi.unlinked != null ? kpi.unlinked : 0).toLocaleString() + '명');

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:40px;color:#888">조회 결과가 없습니다</td></tr>';
    renderPotentialDonorPagination(0);
    return;
  }

  tbody.innerHTML = rows.map(function(d) {
    const linkedBadge = d.linkedMemberId
      ? '<span class="cms-badge cms-b-success">🔗 M-' + String(d.linkedMemberId).padStart(5,'0') + ' ' + escapeHtml(d.linkedMemberName || '') + '</span>'
      : '<span class="cms-badge cms-b-mute">미연결</span>';
    const mapBtn = d.linkedMemberId
      ? '<button class="cms-btn-link" style="color:#888" onclick="pdUnmap(' + d.id + ')">연결해제</button>'
      : '<button class="cms-btn-link" style="color:#1a5ec4" onclick="pdMapMember(' + d.id + ', \'' + escapeHtml(d.name || '').replace(/'/g,'&#39;') + '\')">회원연결</button>';
    return '<tr>'
      + '<td style="font-family:Inter;font-size:11.5px">PD-' + String(d.id).padStart(5,'0') + '</td>'
      + '<td><strong>' + escapeHtml(d.name || '') + '</strong></td>'
      + '<td style="font-family:Inter;font-size:11.5px">' + escapeHtml(d.phone || '—') + '</td>'
      + '<td style="font-size:12px">' + escapeHtml(d.eventName || '—') + '</td>'
      + '<td style="font-family:Inter;font-size:11.5px">' + formatDate(d.participatedAt) + '</td>'
      + '<td style="font-size:12px;color:#666">' + escapeHtml(d.entryPath || '—') + '</td>'
      + '<td>' + linkedBadge + '</td>'
      + '<td style="font-size:12px;color:#666;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escapeHtml(d.memo || '') + '">' + escapeHtml(d.memo || '—') + '</td>'
      + '<td><button class="cms-btn-link" onclick="pdEditRow(' + d.id + ')">수정</button> ' + mapBtn + ' <button class="cms-btn-link" style="color:#c5293a" onclick="pdDeleteRow(' + d.id + ', \'' + escapeHtml(d.name || '').replace(/'/g,'&#39;') + '\')">삭제</button></td>'
      + '</tr>';
  }).join('');

  renderPotentialDonorPagination(total);
}

function renderPotentialDonorPagination(total) {
  const pager = document.getElementById('pdPagination');
  if (!pager) return;
  if (!total) { pager.innerHTML = ''; return; }
  const totalPages = Math.ceil(total / potentialDonorPageSize);
  const prev = potentialDonorPage > 1 ? '<button class="cms-donor-pagination-btn" data-pdp="' + (potentialDonorPage - 1) + '">‹ 이전</button>' : '';
  const next = potentialDonorPage < totalPages ? '<button class="cms-donor-pagination-btn" data-pdp="' + (potentialDonorPage + 1) + '">다음 ›</button>' : '';
  pager.innerHTML = prev + '<span class="cms-donor-pagination-info">' + potentialDonorPage + ' / ' + totalPages + ' · 총 ' + total.toLocaleString() + '명</span>' + next;
  pager.querySelectorAll('[data-pdp]').forEach(function(b) {
    b.addEventListener('click', function() { potentialDonorPage = Number(b.dataset.pdp); renderPotentialDonor(); });
  });
}

function pdEditRow(id) {
  const name = prompt('이름:');
  if (!name) return;
  const phone = prompt('연락처:', '');
  const address = prompt('주소:', '');
  const birthdate = prompt('생년월일 (YYYY-MM-DD):', '');
  const eventName = prompt('이벤트·활동명:', '');
  const entryPath = prompt('유입 경로:', '');
  const memo = prompt('메모:', '');
  api('/api/admin/potential-donor-crud', { method: 'PUT', body: { id, name, phone, address, birthdate, eventName, entryPath, memo } })
    .then(function(res) { if (!res.ok) return toast('수정 실패: ' + (res.data?.error || '')); toast('수정 완료'); renderPotentialDonor(); });
}

function pdDeleteRow(id, name) {
  if (!confirm('"' + name + '"을(를) 삭제하시겠습니까?')) return;
  api('/api/admin/potential-donor-crud', { method: 'DELETE', body: { id } })
    .then(function(res) { if (!res.ok) return toast('삭제 실패: ' + (res.data?.error || '')); toast('삭제 완료'); renderPotentialDonor(); });
}

function pdMapMember(id, name) {
  const memberIdInput = prompt('"' + name + '"을(를) 연결할 회원번호(숫자)를 입력하세요:');
  const memberId = parseInt(memberIdInput, 10);
  if (!memberId) return;
  api('/api/admin/potential-donor-crud?action=map-member', { method: 'POST', body: { id, memberId } })
    .then(function(res) { if (!res.ok) return toast('매핑 실패: ' + (res.data?.error || '')); toast('정식 회원으로 연결 완료'); renderPotentialDonor(); });
}

function pdUnmap(id) {
  if (!confirm('회원 연결을 해제하시겠습니까?')) return;
  api('/api/admin/potential-donor-crud?action=unmap', { method: 'POST', body: { id } })
    .then(function(res) { if (!res.ok) return toast('해제 실패: ' + (res.data?.error || '')); toast('연결 해제 완료'); renderPotentialDonor(); });
}

document.addEventListener('DOMContentLoaded', function() {
  document.getElementById('pdFilterSearch')?.addEventListener('input', function(e) {
    clearTimeout(potentialDonorSearchTimer);
    potentialDonorSearchTimer = setTimeout(function() { potentialDonorQuery.q = e.target.value.trim(); potentialDonorPage = 1; renderPotentialDonor(); }, 300);
  });
  document.getElementById('pdFilterEvent')?.addEventListener('input', function(e) {
    clearTimeout(potentialDonorSearchTimer);
    potentialDonorSearchTimer = setTimeout(function() { potentialDonorQuery.eventName = e.target.value.trim(); potentialDonorPage = 1; renderPotentialDonor(); }, 300);
  });
  document.getElementById('pdFilterLinked')?.addEventListener('change', function(e) {
    potentialDonorQuery.linked = e.target.value; potentialDonorPage = 1; renderPotentialDonor();
  });
  document.getElementById('pdBtnRefresh')?.addEventListener('click', function() { renderPotentialDonor(); });
  document.getElementById('pdBtnAdd')?.addEventListener('click', function() { openPdAddModal(); });

  /* ── 모달 기본 동작 ── */
  document.getElementById('pdAddModalClose')?.addEventListener('click', closePdAddModal);
  document.getElementById('pdfBtnCancel')?.addEventListener('click', closePdAddModal);
  document.getElementById('pdAddModal')?.addEventListener('click', function(e){
    if (e.target.id === 'pdAddModal') closePdAddModal();
  });

  /* ── 탭 전환 ── */
  document.querySelectorAll('.pd-tab').forEach(function(t){
    t.addEventListener('click', function(){
      document.querySelectorAll('.pd-tab').forEach(function(x){ x.classList.remove('active'); });
      t.classList.add('active');
      var name = t.dataset.pdTab;
      document.querySelectorAll('[data-pd-panel]').forEach(function(p){
        p.style.display = p.dataset.pdPanel === name ? '' : 'none';
      });
    });
  });

  /* ── 직접 입력 폼 제출 ── */
  document.getElementById('pdAddForm')?.addEventListener('submit', async function(e){
    e.preventDefault();
    var payload = {
      name:           document.getElementById('pdfName').value.trim(),
      phone:          document.getElementById('pdfPhone').value.trim(),
      birthdate:      document.getElementById('pdfBirthdate').value,
      address:        document.getElementById('pdfAddress').value.trim(),
      eventName:      document.getElementById('pdfEventName').value.trim(),
      participatedAt: document.getElementById('pdfParticipatedAt').value,
      entryPath:      document.getElementById('pdfEntryPath').value,
      memo:           document.getElementById('pdfMemo').value.trim(),
    };
    if (!payload.name) { (window._cmsToast||alert)('이름은 필수입니다'); return; }
    var btn = document.getElementById('pdfBtnSubmit');
    btn.disabled = true; btn.textContent = '등록 중…';
    try {
      var res = await (window._cmsApi||api)('/api/admin/potential-donor-crud', { method:'POST', body: payload });
      if (!res.ok) throw new Error(res.data?.error || 'HTTP '+res.status);
      (window._cmsToast||alert)('등록 완료');
      closePdAddModal();
      renderPotentialDonor();
    } catch(err) {
      (window._cmsToast||alert)('등록 실패: '+(err.message||err));
    } finally {
      btn.disabled = false; btn.textContent = '등록';
    }
  });

  /* ── AI 자동 분석 흐름 ── */
  document.getElementById('pdAiFile')?.addEventListener('change', function(e){
    var f = e.target.files?.[0];
    var info = document.getElementById('pdAiFileInfo');
    if (info) info.textContent = f ? (f.name + ' · ' + Math.round(f.size/1024) + 'KB') : '';
  });

  document.getElementById('pdAiBtnExtract')?.addEventListener('click', async function(){
    var fileInput = document.getElementById('pdAiFile');
    var f = fileInput?.files?.[0];
    if (!f) { (window._cmsToast||alert)('파일을 선택해주세요'); return; }

    var btn = document.getElementById('pdAiBtnExtract');
    btn.disabled = true; btn.textContent = '🤖 AI 분석 중…';

    var eventNameHint = document.getElementById('pdAiEventHint').value.trim();
    var entryPathHint = document.getElementById('pdAiEntryHint').value;

    try {
      var ext = (f.name.split('.').pop()||'').toLowerCase();
      var body = { eventNameHint: eventNameHint, entryPathHint: entryPathHint };

      if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') {
        /* 엑셀·CSV: 클라이언트에서 SheetJS로 텍스트 변환 */
        if (typeof XLSX === 'undefined') throw new Error('SheetJS 미로드');
        var arrayBuf = await f.arrayBuffer();
        var wb = XLSX.read(arrayBuf, { type: 'array' });
        var sheet = wb.Sheets[wb.SheetNames[0]];
        var rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        body.parsedText = rows.slice(0, 200).map(function(r){ return r.join(' | '); }).join('\n');
      } else {
        /* 사진·PDF: base64로 변환해서 AI에 직접 첨부 */
        var b64 = await new Promise(function(resolve, reject){
          var r = new FileReader();
          r.onload = function(){ resolve(r.result); };
          r.onerror = reject;
          r.readAsDataURL(f);
        });
        body.fileBase64 = b64;
        body.mimeType   = f.type || (ext==='pdf'?'application/pdf':'image/jpeg');
      }

      var res = await (window._cmsApi||api)('/api/admin/potential-donor-ai-extract', { method:'POST', body: body });
      if (!res.ok) throw new Error(res.data?.error || 'HTTP '+res.status);
      var items = res.data?.items || [];
      _pdRenderAiPreview(items);
    } catch(err) {
      (window._cmsToast||alert)('AI 분석 실패: '+(err.message||err));
    } finally {
      btn.disabled = false; btn.textContent = '🤖 AI로 추출 시작';
    }
  });

  document.getElementById('pdAiBtnReset')?.addEventListener('click', function(){
    var prev = document.getElementById('pdAiPreview'); if (prev) prev.style.display = 'none';
    var fileInput = document.getElementById('pdAiFile'); if (fileInput) fileInput.value = '';
    var info = document.getElementById('pdAiFileInfo'); if (info) info.textContent = '';
  });

  document.getElementById('pdAiSelectAll')?.addEventListener('change', function(e){
    document.querySelectorAll('#pdAiPreviewBody input[type=checkbox]').forEach(function(cb){ cb.checked = e.target.checked; });
  });

  document.getElementById('pdAiBtnImport')?.addEventListener('click', async function(){
    var checks = document.querySelectorAll('#pdAiPreviewBody input[type=checkbox]:checked');
    if (!checks.length) { (window._cmsToast||alert)('등록할 항목을 선택하세요'); return; }
    var btn = document.getElementById('pdAiBtnImport');
    btn.disabled = true; btn.textContent = '등록 중… (0/' + checks.length + ')';
    var ok = 0, fail = 0;
    for (var i = 0; i < checks.length; i++) {
      try {
        var data = JSON.parse(checks[i].dataset.item);
        var res = await (window._cmsApi||api)('/api/admin/potential-donor-crud', { method:'POST', body: data });
        if (res.ok) ok++; else fail++;
      } catch { fail++; }
      btn.textContent = '등록 중… (' + (i+1) + '/' + checks.length + ')';
    }
    (window._cmsToast||alert)('등록 완료: 성공 '+ok+'건 / 실패 '+fail+'건');
    btn.disabled = false; btn.textContent = '선택 항목 일괄 등록';
    closePdAddModal();
    renderPotentialDonor();
  });

  /* ============================================================
     예비 후원자 등록 모달 (members INSERT donor_type=prospect)
     ============================================================ */
  document.getElementById('dpBtnAdd')?.addEventListener('click', function() { openDpAddModal(); });
  document.getElementById('dpAddModalClose')?.addEventListener('click', closeDpAddModal);
  document.getElementById('dpfBtnCancel')?.addEventListener('click', closeDpAddModal);
  document.getElementById('dpAddModal')?.addEventListener('click', function(e){
    if (e.target.id === 'dpAddModal') closeDpAddModal();
  });

  /* 탭 전환 */
  document.querySelectorAll('#dpAddModal .pd-tab').forEach(function(t){
    t.addEventListener('click', function(){
      document.querySelectorAll('#dpAddModal .pd-tab').forEach(function(x){ x.classList.remove('active'); });
      t.classList.add('active');
      var name = t.dataset.dpTab;
      document.querySelectorAll('#dpAddModal [data-dp-panel]').forEach(function(p){
        p.style.display = p.dataset.dpPanel === name ? '' : 'none';
      });
    });
  });

  /* 직접 입력 폼 제출 */
  document.getElementById('dpAddForm')?.addEventListener('submit', async function(e){
    e.preventDefault();
    var payload = {
      name:      document.getElementById('dpfName').value.trim(),
      email:     document.getElementById('dpfEmail').value.trim(),
      phone:     document.getElementById('dpfPhone').value.trim(),
      eventName: document.getElementById('dpfEventName').value.trim(),
      entryPath: document.getElementById('dpfEntryPath').value,
      memo:      document.getElementById('dpfMemo').value.trim(),
    };
    if (!payload.name) { (window._cmsToast||alert)('이름은 필수입니다'); return; }
    var btn = document.getElementById('dpfBtnSubmit');
    btn.disabled = true; btn.textContent = '등록 중…';
    try {
      var res = await (window._cmsApi||api)('/api/admin/prospect-donor-create', { method:'POST', body: payload });
      if (!res.ok) throw new Error(res.data?.error || 'HTTP '+res.status);
      (window._cmsToast||alert)(res.data?.message || '등록 완료');
      closeDpAddModal();
      renderDonorProspect();
    } catch(err) {
      (window._cmsToast||alert)('등록 실패: '+(err.message||err));
    } finally {
      btn.disabled = false; btn.textContent = '등록';
    }
  });

  /* AI 자동 분석 */
  document.getElementById('dpAiFile')?.addEventListener('change', function(e){
    var f = e.target.files?.[0];
    var info = document.getElementById('dpAiFileInfo');
    if (info) info.textContent = f ? (f.name + ' · ' + Math.round(f.size/1024) + 'KB') : '';
  });

  document.getElementById('dpAiBtnExtract')?.addEventListener('click', async function(){
    var fileInput = document.getElementById('dpAiFile');
    var f = fileInput?.files?.[0];
    if (!f) { (window._cmsToast||alert)('파일을 선택해주세요'); return; }

    var btn = document.getElementById('dpAiBtnExtract');
    btn.disabled = true; btn.textContent = '🤖 AI 분석 중…';

    var eventNameHint = document.getElementById('dpAiEventHint').value.trim();
    var entryPathHint = document.getElementById('dpAiEntryHint').value;

    try {
      var ext = (f.name.split('.').pop()||'').toLowerCase();
      var body = { eventNameHint: eventNameHint, entryPathHint: entryPathHint };

      if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') {
        if (typeof XLSX === 'undefined') throw new Error('SheetJS 미로드');
        var arrayBuf = await f.arrayBuffer();
        var wb = XLSX.read(arrayBuf, { type: 'array' });
        var sheet = wb.Sheets[wb.SheetNames[0]];
        var rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        body.parsedText = rows.slice(0, 200).map(function(r){ return r.join(' | '); }).join('\n');
      } else {
        var b64 = await new Promise(function(resolve, reject){
          var r = new FileReader();
          r.onload = function(){ resolve(r.result); };
          r.onerror = reject;
          r.readAsDataURL(f);
        });
        body.fileBase64 = b64;
        body.mimeType   = f.type || (ext==='pdf'?'application/pdf':'image/jpeg');
      }

      /* 잠재 후원자용 추출 API 재사용 (범용 — 이름·연락처·이메일 추출) */
      var res = await (window._cmsApi||api)('/api/admin/potential-donor-ai-extract', { method:'POST', body: body });
      if (!res.ok) throw new Error(res.data?.error || 'HTTP '+res.status);
      var items = res.data?.items || [];
      _dpRenderAiPreview(items);
    } catch(err) {
      (window._cmsToast||alert)('AI 분석 실패: '+(err.message||err));
    } finally {
      btn.disabled = false; btn.textContent = '🤖 AI로 추출 시작';
    }
  });

  document.getElementById('dpAiBtnReset')?.addEventListener('click', function(){
    var prev = document.getElementById('dpAiPreview'); if (prev) prev.style.display = 'none';
    var fileInput = document.getElementById('dpAiFile'); if (fileInput) fileInput.value = '';
    var info = document.getElementById('dpAiFileInfo'); if (info) info.textContent = '';
  });

  document.getElementById('dpAiSelectAll')?.addEventListener('change', function(e){
    document.querySelectorAll('#dpAiPreviewBody input[type=checkbox]').forEach(function(cb){ cb.checked = e.target.checked; });
  });

  document.getElementById('dpAiBtnImport')?.addEventListener('click', async function(){
    var checks = document.querySelectorAll('#dpAiPreviewBody input[type=checkbox]:checked');
    if (!checks.length) { (window._cmsToast||alert)('등록할 항목을 선택하세요'); return; }
    var btn = document.getElementById('dpAiBtnImport');
    btn.disabled = true; btn.textContent = '등록 중… (0/' + checks.length + ')';
    var ok = 0, fail = 0, dup = 0;
    for (var i = 0; i < checks.length; i++) {
      try {
        var item = JSON.parse(checks[i].dataset.item);
        /* potential_donor_ai_extract 응답을 prospect-donor-create 형식으로 변환 */
        var payload = {
          name:      item.name,
          email:     item.email || '',
          phone:     item.phone,
          eventName: item.eventName,
          entryPath: item.entryPath,
          memo:      item.memo,
        };
        var res = await (window._cmsApi||api)('/api/admin/prospect-donor-create', { method:'POST', body: payload });
        if (res.ok) ok++;
        else if (res.status === 409 || res.data?.step === 'duplicate') dup++;
        else fail++;
      } catch { fail++; }
      btn.textContent = '등록 중… (' + (i+1) + '/' + checks.length + ')';
    }
    var msg = '등록 완료: 성공 '+ok+'건';
    if (dup > 0)  msg += ' / 중복 '+dup+'건';
    if (fail > 0) msg += ' / 실패 '+fail+'건';
    (window._cmsToast||alert)(msg);
    btn.disabled = false; btn.textContent = '선택 항목 일괄 등록';
    closeDpAddModal();
    renderDonorProspect();
  });
});

/* ── 예비 후원자 모달 헬퍼 (전역) ── */
function openDpAddModal() {
  var m = document.getElementById('dpAddModal');
  if (!m) return;
  ['dpfName','dpfEmail','dpfPhone','dpfEventName','dpfMemo','dpAiEventHint'].forEach(function(id){
    var el = document.getElementById(id); if (el) el.value = '';
  });
  var sel = document.getElementById('dpfEntryPath'); if (sel) sel.value = '';
  var sel2 = document.getElementById('dpAiEntryHint'); if (sel2) sel2.value = '';
  var fileInput = document.getElementById('dpAiFile'); if (fileInput) fileInput.value = '';
  var info = document.getElementById('dpAiFileInfo'); if (info) info.textContent = '';
  var prev = document.getElementById('dpAiPreview'); if (prev) prev.style.display = 'none';
  document.querySelectorAll('#dpAddModal .pd-tab').forEach(function(x){ x.classList.remove('active'); });
  document.querySelector('#dpAddModal .pd-tab[data-dp-tab="manual"]')?.classList.add('active');
  document.querySelectorAll('#dpAddModal [data-dp-panel]').forEach(function(p){
    p.style.display = p.dataset.dpPanel === 'manual' ? '' : 'none';
  });
  m.style.display = 'flex';
}

function closeDpAddModal() {
  var m = document.getElementById('dpAddModal');
  if (m) m.style.display = 'none';
}

function _dpRenderAiPreview(items) {
  var prev = document.getElementById('dpAiPreview');
  var body = document.getElementById('dpAiPreviewBody');
  var cnt  = document.getElementById('dpAiPreviewCount');
  if (!prev || !body) return;
  if (cnt) cnt.textContent = items.length;
  if (!items.length) {
    body.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:#888">추출된 항목이 없습니다</td></tr>';
  } else {
    var esc = window._cmsEsc || function(s){ return String(s||''); };
    body.innerHTML = items.map(function(it){
      var conf = Math.round((it.confidence||0)*100);
      var confColor = conf >= 80 ? '#2e7d32' : conf >= 50 ? '#e65100' : '#c5293a';
      return '<tr>'
        +'<td><input type="checkbox" checked data-item="'+esc(JSON.stringify(it)).replace(/"/g,'&quot;')+'"></td>'
        +'<td><strong>'+esc(it.name)+'</strong></td>'
        +'<td>'+esc(it.phone||'—')+'</td>'
        +'<td style="font-size:11.5px;color:#666">'+esc(it.email||'—')+'</td>'
        +'<td style="font-size:11.5px">'+esc(it.eventName||'—')+'</td>'
        +'<td style="font-family:Inter;color:'+confColor+';font-weight:600">'+conf+'%</td>'
        +'</tr>';
    }).join('');
  }
  prev.style.display = '';
  var sel = document.getElementById('dpAiSelectAll'); if (sel) sel.checked = true;
}

/* ── 잠재 후원자 모달 헬퍼 (전역) ── */
function openPdAddModal() {
  var m = document.getElementById('pdAddModal');
  if (!m) return;
  /* 폼 초기화 */
  ['pdfName','pdfPhone','pdfBirthdate','pdfAddress','pdfEventName','pdfParticipatedAt','pdfMemo','pdAiEventHint'].forEach(function(id){
    var el = document.getElementById(id); if (el) el.value = '';
  });
  var sel = document.getElementById('pdfEntryPath'); if (sel) sel.value = '';
  var sel2 = document.getElementById('pdAiEntryHint'); if (sel2) sel2.value = '';
  var fileInput = document.getElementById('pdAiFile'); if (fileInput) fileInput.value = '';
  var info = document.getElementById('pdAiFileInfo'); if (info) info.textContent = '';
  var prev = document.getElementById('pdAiPreview'); if (prev) prev.style.display = 'none';
  /* 직접 입력 탭으로 시작 */
  document.querySelectorAll('.pd-tab').forEach(function(x){ x.classList.remove('active'); });
  document.querySelector('.pd-tab[data-pd-tab="manual"]')?.classList.add('active');
  document.querySelectorAll('[data-pd-panel]').forEach(function(p){
    p.style.display = p.dataset.pdPanel === 'manual' ? '' : 'none';
  });
  m.style.display = 'flex';
}

function closePdAddModal() {
  var m = document.getElementById('pdAddModal');
  if (m) m.style.display = 'none';
}

function _pdRenderAiPreview(items) {
  var prev = document.getElementById('pdAiPreview');
  var body = document.getElementById('pdAiPreviewBody');
  var cnt  = document.getElementById('pdAiPreviewCount');
  if (!prev || !body) return;
  if (cnt) cnt.textContent = items.length;
  if (!items.length) {
    body.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:#888">추출된 항목이 없습니다</td></tr>';
  } else {
    var esc = window._cmsEsc || function(s){ return String(s||''); };
    body.innerHTML = items.map(function(it){
      var conf = Math.round((it.confidence||0)*100);
      var confColor = conf >= 80 ? '#2e7d32' : conf >= 50 ? '#e65100' : '#c5293a';
      return '<tr>'
        +'<td><input type="checkbox" checked data-item="'+esc(JSON.stringify(it)).replace(/"/g,'&quot;')+'"></td>'
        +'<td><strong>'+esc(it.name)+'</strong></td>'
        +'<td>'+esc(it.phone||'—')+'</td>'
        +'<td style="font-size:11.5px;color:#666">'+esc(it.address||'—')+'</td>'
        +'<td style="font-size:11.5px">'+esc(it.eventName||'—')+'</td>'
        +'<td style="font-family:Inter;color:'+confColor+';font-weight:600">'+conf+'%</td>'
        +'</tr>';
    }).join('');
  }
  prev.style.display = '';
  var sel = document.getElementById('pdAiSelectAll'); if (sel) sel.checked = true;
}

/* ============================================================
   ★ 알림 발송 탭 통합 (notify-send)
   ============================================================ */

let notifySendInitialized = false;
let sjPage = 1;
const SJ_PAGE_SIZE = 20;
let rgPage = 1;
const RG_PAGE_SIZE = 20;

async function renderNotifySend() {
  if (!notifySendInitialized) {
    notifySendInitialized = true;
    document.querySelectorAll('[data-ns-tab]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        document.querySelectorAll('[data-ns-tab]').forEach(function(b) {
          b.style.borderBottom = 'none'; b.style.color = 'var(--text-2,#4a5568)';
        });
        btn.style.borderBottom = '2px solid #1a5ec4'; btn.style.color = '#1a5ec4';
        const tab = btn.dataset.nsTab;
        document.getElementById('nsTabJobs').style.display  = tab === 'jobs'   ? '' : 'none';
        document.getElementById('nsTabGroups').style.display = tab === 'groups' ? '' : 'none';
        if (tab === 'jobs') loadNotifyJobs(); else loadNotifyGroups();
      });
    });
    document.getElementById('sjFilterStatus')?.addEventListener('change', function() { sjPage = 1; loadNotifyJobs(); });
    document.getElementById('sjBtnRefresh')?.addEventListener('click', function() { sjPage = 1; loadNotifyJobs(); });
    document.getElementById('sjBtnCreate')?.addEventListener('click', function() { window.open('/admin-send-job-create.html', '_blank'); });
    document.getElementById('rgBtnRefresh')?.addEventListener('click', function() { rgPage = 1; loadNotifyGroups(); });
    document.getElementById('rgBtnCreate')?.addEventListener('click', function() { window.open('/admin-recipient-group-edit.html', '_blank'); });
    document.getElementById('rgFilterSearch')?.addEventListener('input', function() { rgPage = 1; loadNotifyGroups(); });
  }
  loadNotifyJobs();
}

async function loadNotifyJobs() {
  const tbody = document.getElementById('sjBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:30px;color:#888">불러오는 중…</td></tr>';
  const status = document.getElementById('sjFilterStatus')?.value || '';
  const qs = new URLSearchParams({ limit: String(SJ_PAGE_SIZE), offset: String((sjPage - 1) * SJ_PAGE_SIZE) });
  if (status) qs.set('status', status);
  try {
    const res = await api('/api/admin-send-jobs-list?' + qs.toString());
    if (!res.ok) throw new Error(res.data?.error || 'HTTP ' + res.status);
    const payload = res.data?.data != null ? res.data.data : (res.data != null ? res.data : {});
    const rows = payload.rows != null ? payload.rows : [];
    const total = payload.total != null ? payload.total : rows.length;
    const STATUS_LABEL = { pending:'대기', processing:'진행 중', completed:'완료', failed:'실패', cancelled:'취소됨' };
    const CHAN_LABEL = { email:'이메일', sms:'SMS', kakao:'카카오', inapp:'인앱' };
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:30px;color:#888">발송 작업이 없습니다</td></tr>';
    } else {
      tbody.innerHTML = rows.map(function(r) {
        const sl = STATUS_LABEL[r.status] || r.status;
        const sc = r.status === 'completed' ? 'cms-b-success' : r.status === 'failed' ? 'cms-b-danger' : 'cms-b-mute';
        return '<tr>'
          + '<td style="font-family:Inter;font-size:11.5px">#' + r.id + '</td>'
          + '<td><strong>' + escapeHtml(r.name || '') + '</strong></td>'
          + '<td>' + escapeHtml(CHAN_LABEL[r.channel] || r.channel || '—') + '</td>'
          + '<td><span class="cms-badge ' + sc + '">' + sl + '</span></td>'
          + '<td style="text-align:right;font-family:Inter">' + (r.totalRecipients || 0).toLocaleString() + '</td>'
          + '<td style="text-align:right;font-family:Inter;color:#2e7d32">' + (r.successCount || 0).toLocaleString() + '</td>'
          + '<td style="text-align:right;font-family:Inter;color:#c5293a">' + (r.failureCount || 0).toLocaleString() + '</td>'
          + '<td style="font-family:Inter;font-size:11.5px">' + formatDate(r.scheduledAt || r.createdAt) + '</td>'
          + '<td><a href="/admin-send-job-detail.html?id=' + r.id + '" target="_blank" class="cms-btn-link">상세</a></td>'
          + '</tr>';
      }).join('');
    }
    const pager = document.getElementById('sjPagination');
    if (pager) {
      const tp = Math.max(1, Math.ceil(total / SJ_PAGE_SIZE));
      const prev = sjPage > 1 ? '<button class="cms-donor-pagination-btn" data-sjp="' + (sjPage-1) + '">‹ 이전</button>' : '';
      const next = sjPage < tp ? '<button class="cms-donor-pagination-btn" data-sjp="' + (sjPage+1) + '">다음 ›</button>' : '';
      pager.innerHTML = prev + '<span class="cms-donor-pagination-info">' + sjPage + ' / ' + tp + ' · 총 ' + total.toLocaleString() + '건</span>' + next;
      pager.querySelectorAll('[data-sjp]').forEach(function(b) { b.addEventListener('click', function() { sjPage = Number(b.dataset.sjp); loadNotifyJobs(); }); });
    }
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:30px;color:#c5293a">조회 실패: ' + escapeHtml(String(err?.message || err)) + '</td></tr>';
  }
}

/* ============================================================
   ★ 2026-05-11: 회원 추가 모달 + 4개 탭 CSV·엑셀 내보내기
   - 통합 일반 회원 / 정기 후원자 / 예비 후원자 / 잠재 후원자
   ============================================================ */
(function() {
  'use strict';

  function _toast(msg) {
    var t = document.getElementById('cmsToast');
    if (!t) return alert(msg);
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(window._addmemberT);
    window._addmemberT = setTimeout(function(){ t.classList.remove('show'); }, 2400);
  }

  /* ── 회원 추가 모달 ── */
  function openAddMember() {
    var modal = document.getElementById('addMemberModal');
    if (!modal) return;
    var form = document.getElementById('addMemberForm');
    if (form) form.reset();
    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
    setTimeout(function(){ form?.querySelector('input[name=name]')?.focus(); }, 50);
  }
  function closeAddMember() {
    var modal = document.getElementById('addMemberModal');
    if (!modal) return;
    modal.classList.remove('show');
    document.body.style.overflow = '';
  }
  document.addEventListener('click', function(e) {
    if (e.target.closest('#btnAddMember')) {
      e.preventDefault(); openAddMember(); return;
    }
    if (e.target.closest('[data-am-close]')) {
      closeAddMember(); return;
    }
    var modal = document.getElementById('addMemberModal');
    if (modal && modal.classList.contains('show') && e.target === modal) {
      closeAddMember();
    }
  });

  document.addEventListener('DOMContentLoaded', function() {
    var submitBtn = document.getElementById('amBtnSubmit');
    if (submitBtn) submitBtn.addEventListener('click', submitAddMember);
  });

  async function submitAddMember() {
    var form = document.getElementById('addMemberForm');
    if (!form) return;
    var fd = new FormData(form);
    var body = {
      name: String(fd.get('name') || '').trim(),
      email: String(fd.get('email') || '').trim().toLowerCase(),
      phone: String(fd.get('phone') || '').trim(),
      type: String(fd.get('type') || 'regular'),
    };
    var memo = String(fd.get('memo') || '').trim();
    if (memo) body.memo = memo;
    var category = String(fd.get('memberCategory') || '').trim();
    if (category) body.memberCategory = category;

    if (!body.name || body.name.length < 2) { _toast('이름은 2자 이상 입력하세요'); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email)) { _toast('이메일 형식을 확인하세요'); return; }
    if (!/^[0-9\-+\s()]{8,20}$/.test(body.phone)) { _toast('연락처 형식을 확인하세요 (숫자·하이픈)'); return; }

    var btn = document.getElementById('amBtnSubmit');
    if (btn) { btn.disabled = true; btn.textContent = '등록 중...'; }
    try {
      var res = await fetch('/api/admin/members', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      var data = await res.json().catch(function(){ return {}; });
      if (!res.ok || data.ok === false) {
        var err = data.error || data.message || ('HTTP ' + res.status);
        if (Array.isArray(data.errors) && data.errors.length) {
          err = data.errors.map(function(x){ return x.field + ': ' + x.message; }).join('\n');
        } else if (data.data && Array.isArray(data.data.errors)) {
          err = data.data.errors.map(function(x){ return x.field + ': ' + x.message; }).join('\n');
        }
        throw new Error(err);
      }
      _toast('회원이 추가되었습니다');
      closeAddMember();
      var refreshBtn = document.getElementById('btnRefreshMembers');
      if (refreshBtn) refreshBtn.click();
    } catch (err) {
      alert('회원 추가 실패\n\n' + (err && err.message || err));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '등록'; }
    }
  }

  /* ── 내보내기 헬퍼 ── */
  function _today() { return new Date().toISOString().slice(0, 10); }
  function _csvCell(v) {
    var s = (v == null) ? '' : String(v);
    if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function _downloadCsv(rows, headers, filename) {
    var lines = [headers.map(_csvCell).join(',')];
    rows.forEach(function(r){ lines.push(r.map(_csvCell).join(',')); });
    var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function(){ URL.revokeObjectURL(url); a.parentNode && a.parentNode.removeChild(a); }, 100);
  }
  function _downloadXlsx(rows, headers, filename, sheet) {
    if (typeof XLSX === 'undefined') { _toast('엑셀 라이브러리(SheetJS) 로드 실패'); return; }
    var aoa = [headers].concat(rows);
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheet || 'Sheet1');
    XLSX.writeFile(wb, filename);
  }
  async function _fetchAllPages(path, baseQs) {
    var all = [];
    var page = 1;
    var pageSize = 500;
    while (true) {
      var qs = new URLSearchParams(baseQs || {});
      qs.set('page', String(page));
      qs.set('pageSize', String(pageSize));
      qs.set('limit', String(pageSize));
      var res = await fetch(path + '?' + qs.toString(), { credentials: 'include' });
      var data = await res.json().catch(function(){ return {}; });
      if (!res.ok || data.ok === false) {
        throw new Error((data && (data.error || data.message)) || ('HTTP ' + res.status));
      }
      var payload = (data && data.data) ? data.data : data;
      var list = payload.list || payload.data || payload.rows || [];
      all = all.concat(list);
      var total = payload.total || (payload.pagination && payload.pagination.total) || all.length;
      if (all.length >= total || !list.length) break;
      page++;
      if (page > 100) break;
    }
    return all;
  }

  /* ── 통합 일반 회원 ── */
  async function exportMembers(format) {
    var btnCsv = document.getElementById('btnExportMembersCsv');
    var btnXl = document.getElementById('btnExportMembersXlsx');
    [btnCsv, btnXl].forEach(function(b){ if (b) b.disabled = true; });
    try {
      var qs = {};
      var src = document.getElementById('filterSource')?.value || '';
      if (src && src !== 'all') qs.source = src;
      var dt = document.getElementById('filterDonorType')?.value || '';
      if (dt && dt !== 'all') qs.donorType = dt;
      var q = (document.getElementById('filterSearch')?.value || '').trim();
      if (q) qs.q = q;
      _toast('회원 데이터 추출 중...');
      var rows = await _fetchAllPages('/api/admin/members', qs);
      var headers = ['ID','이름','이메일','연락처','회원유형','상태','후원상태','가입경로','등록일'];
      var data = rows.map(function(m){
        return [
          'M-' + String(m.id).padStart(5,'0'),
          m.name || '', m.email || '', m.phone || '',
          m.type || '', m.status || '',
          m.donorType || (m.donorState || ''),
          (m.sourceLabel || m.signupSourceLabel || m.signupSource || ''),
          m.createdAt ? String(m.createdAt).slice(0,10) : '',
        ];
      });
      var name = 'TBFA_통합회원_' + _today();
      if (format === 'csv') _downloadCsv(data, headers, name + '.csv');
      else _downloadXlsx(data, headers, name + '.xlsx', '통합회원');
      _toast(rows.length.toLocaleString() + '명 내보내기 완료');
    } catch (err) {
      alert('내보내기 실패\n\n' + (err && err.message || err));
    } finally {
      [btnCsv, btnXl].forEach(function(b){ if (b) b.disabled = false; });
    }
  }

  /* ── 정기 후원자 ── */
  async function exportDonorRegular(format) {
    try {
      var qs = {};
      var ch = document.getElementById('drFilterChannel')?.value || '';
      if (ch && ch !== 'all') qs.channel = ch;
      var q = (document.getElementById('drFilterSearch')?.value || '').trim();
      if (q) qs.q = q;
      _toast('정기 후원자 데이터 추출 중...');
      var rows = await _fetchAllPages('/api/admin/donor-regular-list', qs);
      var headers = ['회원번호','이름','연락처','채널','정기금액','다음결제일','누적개월','누적합계'];
      var data = rows.map(function(d){
        return [
          'M-' + String(d.id).padStart(5,'0'),
          d.name || '', d.phone || '',
          Array.isArray(d.channels) ? d.channels.join('+') : (d.channels || ''),
          d.regularAmount != null ? Number(d.regularAmount) : '',
          d.nextBillingDate ? String(d.nextBillingDate).slice(0,10) : '',
          d.cumulativeMonths || 0,
          d.cumulativeAmount || 0,
        ];
      });
      var name = 'TBFA_정기후원자_' + _today();
      if (format === 'csv') _downloadCsv(data, headers, name + '.csv');
      else _downloadXlsx(data, headers, name + '.xlsx', '정기후원자');
      _toast(rows.length.toLocaleString() + '명 내보내기 완료');
    } catch (err) {
      alert('내보내기 실패\n\n' + (err && err.message || err));
    }
  }

  /* ── 예비 후원자 ── */
  async function exportDonorProspect(format) {
    try {
      var qs = {};
      var sub = document.querySelector('.dp-subtab.on')?.dataset.dpSubtype || 'all';
      if (sub && sub !== 'all') qs.subtype = sub;
      var q = (document.getElementById('dpFilterSearch')?.value || '').trim();
      if (q) qs.q = q;
      _toast('예비 후원자 데이터 추출 중...');
      var rows = await _fetchAllPages('/api/admin/donor-prospect-list', qs);
      var headers = ['회원번호','이름','연락처','분류','중단일','마지막후원일','마지막금액','누적건수','누적합계'];
      var data = rows.map(function(d){
        return [
          'M-' + String(d.id).padStart(5,'0'),
          d.name || '', d.phone || '',
          d.subtype || '',
          d.cancelledAt ? String(d.cancelledAt).slice(0,10) : '',
          d.lastDonationDate ? String(d.lastDonationDate).slice(0,10) : '',
          d.lastDonationAmount || 0,
          d.totalDonationCount || 0,
          d.totalDonationAmount || 0,
        ];
      });
      var name = 'TBFA_예비후원자_' + _today();
      if (format === 'csv') _downloadCsv(data, headers, name + '.csv');
      else _downloadXlsx(data, headers, name + '.xlsx', '예비후원자');
      _toast(rows.length.toLocaleString() + '명 내보내기 완료');
    } catch (err) {
      alert('내보내기 실패\n\n' + (err && err.message || err));
    }
  }

  /* ── 잠재 후원자 ── */
  async function exportDonorPotential(format) {
    try {
      var qs = {};
      var q = (document.getElementById('pdFilterSearch')?.value || '').trim();
      if (q) qs.q = q;
      var ev = (document.getElementById('pdFilterEvent')?.value || '').trim();
      if (ev) qs.eventName = ev;
      var lk = document.getElementById('pdFilterLinked')?.value || 'all';
      if (lk && lk !== 'all') qs.linked = lk;
      _toast('잠재 후원자 데이터 추출 중...');
      var rows = await _fetchAllPages('/api/admin/potential-donor-list', qs);
      var headers = ['번호','이름','연락처','이벤트·활동','참여일','유입경로','연결회원ID','연결회원명','메모'];
      var data = rows.map(function(d){
        return [
          'PD-' + String(d.id).padStart(5,'0'),
          d.name || '', d.phone || '',
          d.eventName || '',
          d.participatedAt ? String(d.participatedAt).slice(0,10) : '',
          d.entryPath || '',
          d.linkedMemberId || '',
          d.linkedMemberName || '',
          d.memo || '',
        ];
      });
      var name = 'TBFA_잠재후원자_' + _today();
      if (format === 'csv') _downloadCsv(data, headers, name + '.csv');
      else _downloadXlsx(data, headers, name + '.xlsx', '잠재후원자');
      _toast(rows.length.toLocaleString() + '명 내보내기 완료');
    } catch (err) {
      alert('내보내기 실패\n\n' + (err && err.message || err));
    }
  }

  document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('btnExportMembersCsv')?.addEventListener('click', function(){ exportMembers('csv'); });
    document.getElementById('btnExportMembersXlsx')?.addEventListener('click', function(){ exportMembers('xlsx'); });
    document.getElementById('drBtnExportCsv')?.addEventListener('click', function(){ exportDonorRegular('csv'); });
    document.getElementById('drBtnExportXlsx')?.addEventListener('click', function(){ exportDonorRegular('xlsx'); });
    document.getElementById('dpBtnExportCsv')?.addEventListener('click', function(){ exportDonorProspect('csv'); });
    document.getElementById('dpBtnExportXlsx')?.addEventListener('click', function(){ exportDonorProspect('xlsx'); });
    document.getElementById('pdBtnExportCsv')?.addEventListener('click', function(){ exportDonorPotential('csv'); });
    document.getElementById('pdBtnExportXlsx')?.addEventListener('click', function(){ exportDonorPotential('xlsx'); });
  });
})();

async function loadNotifyGroups() {
  const tbody = document.getElementById('rgBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:#888">불러오는 중…</td></tr>';
  const q = document.getElementById('rgFilterSearch')?.value.trim() || '';
  const qs = new URLSearchParams({ limit: String(RG_PAGE_SIZE), offset: String((rgPage - 1) * RG_PAGE_SIZE) });
  if (q) qs.set('q', q);
  try {
    const res = await api('/api/admin-recipient-groups-list?' + qs.toString());
    if (!res.ok) throw new Error(res.data?.error || 'HTTP ' + res.status);
    const payload = res.data?.data != null ? res.data.data : (res.data != null ? res.data : {});
    const rows = payload.rows != null ? payload.rows : (payload.data != null ? payload.data : []);
    const total = payload.total != null ? payload.total : rows.length;
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:#888">수신자 그룹이 없습니다</td></tr>';
    } else {
      tbody.innerHTML = rows.map(function(r) {
        return '<tr>'
          + '<td style="font-family:Inter;font-size:11.5px">#' + r.id + '</td>'
          + '<td><strong>' + escapeHtml(r.name || '') + '</strong></td>'
          + '<td style="font-size:12px;color:#666">' + escapeHtml(r.description || '—') + '</td>'
          + '<td>' + (r.isActive ? '<span class="cms-badge cms-b-success">활성</span>' : '<span class="cms-badge cms-b-mute">비활성</span>') + '</td>'
          + '<td style="font-family:Inter;font-size:11.5px">' + formatDate(r.createdAt) + '</td>'
          + '<td><a href="/admin-recipient-group-edit.html?id=' + r.id + '" target="_blank" class="cms-btn-link">편집</a></td>'
          + '</tr>';
      }).join('');
    }
    const pager = document.getElementById('rgPagination');
    if (pager) {
      const tp = Math.max(1, Math.ceil(total / RG_PAGE_SIZE));
      const prev = rgPage > 1 ? '<button class="cms-donor-pagination-btn" data-rgp="' + (rgPage-1) + '">‹ 이전</button>' : '';
      const next = rgPage < tp ? '<button class="cms-donor-pagination-btn" data-rgp="' + (rgPage+1) + '">다음 ›</button>' : '';
      pager.innerHTML = prev + '<span class="cms-donor-pagination-info">' + rgPage + ' / ' + tp + ' · 총 ' + total.toLocaleString() + '개</span>' + next;
      pager.querySelectorAll('[data-rgp]').forEach(function(b) { b.addEventListener('click', function() { rgPage = Number(b.dataset.rgp); loadNotifyGroups(); }); });
    }
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:#c5293a">조회 실패: ' + escapeHtml(String(err?.message || err)) + '</td></tr>';
  }
}


/* ================================================================
   ★ 알림·발송 5탭 — 원본 디자인·기능 100% 유지 (iframe lazy load)
   admin-send-jobs / admin-templates / admin-recipient-groups /
   admin-auto-triggers / admin-send-analytics 페이지를 iframe으로 통합.
   메뉴 클릭 시 최초 1회만 src 주입 (캐시 유지) → 재방문 시 즉시 표시.
   ================================================================ */
function _nfLoadIframe(pageId) {
  var sec = document.getElementById(pageId);
  if (!sec) return;
  var iframe = sec.querySelector('iframe.nf-iframe');
  if (!iframe) return;
  if (iframe.src) return; /* 이미 로드된 경우 스킵 */
  var src = iframe.dataset.nfSrc;
  if (src) iframe.src = src;
}
function renderSendJobs()        { _nfLoadIframe('page-send-jobs'); }
function renderSendTemplate()    { _nfLoadIframe('page-send-template'); }
function renderRecipientGroups() { _nfLoadIframe('page-recipient-groups'); }
function renderAutoTrigger()     { _nfLoadIframe('page-auto-trigger'); }
function renderSendAnalytics()   { _nfLoadIframe('page-send-analytics'); }

/* ================================================================
   ★ AI 에이전트 4개 섹션 (Phase A)
   ================================================================ */
function renderAiChat() { _nfLoadIframe('page-ai-chat'); }

async function renderAiHistory() {
  var tbody = document.getElementById('aiHistoryBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:#888">불러오는 중…</td></tr>';
  try {
    var res = await (window._cmsApi || api)('/api/admin-ai-conversations-list?limit=50');
    if (!res.ok) throw new Error(res.data?.error || 'HTTP ' + res.status);
    var rows = res.data?.rows || [];
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:#888">아직 AI 대화 기록이 없습니다</td></tr>';
      return;
    }
    var esc = window._cmsEsc || function(s){ return String(s||''); };
    var fmt = window._cmsFmt || function(s){ return String(s||''); };
    tbody.innerHTML = rows.map(function(r){
      return '<tr>'
        + '<td style="font-family:Inter;font-size:11px">#'+r.id+'</td>'
        + '<td><strong>'+esc(r.title || '제목 없음')+'</strong></td>'
        + '<td>'+esc(r.admin_name || '#'+r.admin_id)+'</td>'
        + '<td style="text-align:right;font-family:Inter">'+(r.message_count||0)+'</td>'
        + '<td style="font-family:Inter;font-size:11px">'+fmt(r.updated_at)+'</td>'
        + '<td><button class="cms-btn-link" data-aih-detail="'+r.id+'">상세</button></td>'
        + '</tr>';
    }).join('');

    /* 상세 버튼 이벤트 */
    tbody.querySelectorAll('[data-aih-detail]').forEach(function(b){
      b.addEventListener('click', function(){
        _aiHistoryOpenDetail(Number(b.dataset.aihDetail));
      });
    });
  } catch(err) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:#c5293a">조회 실패: '+(err.message||err)+'</td></tr>';
  }
}

async function _aiHistoryOpenDetail(id) {
  var panel = document.getElementById('aiHistoryDetail');
  var titleEl = document.getElementById('aiHistoryDetailTitle');
  var body = document.getElementById('aiHistoryDetailBody');
  if (!panel || !body) return;
  panel.style.display = '';
  body.innerHTML = '<div style="padding:20px;color:#888">불러오는 중…</div>';

  try {
    var res = await (window._cmsApi || api)('/api/admin-ai-conversation-detail?id=' + id);
    if (!res.ok) throw new Error(res.data?.error || 'HTTP ' + res.status);
    var conv = res.data?.conversation || {};
    var logs = res.data?.logs || [];
    var msgs = Array.isArray(conv.messages) ? conv.messages : [];
    titleEl.textContent = '대화 #' + id + ' — ' + (conv.title || '');

    var esc = window._cmsEsc || function(s){ return String(s||''); };
    var msgHtml = msgs.map(function(m){
      var who = m.role === 'user' ? '👤 사용자' : (m.role === 'model' ? '🤖 AI' : m.role);
      var bg = m.role === 'user' ? '#eff6ff' : '#f8fafc';
      var text = (m.parts || []).filter(function(p){ return p.text; }).map(function(p){ return p.text; }).join('\n');
      var fnCalls = (m.parts || []).filter(function(p){ return p.functionCall; });
      var fnHtml = fnCalls.map(function(p){
        return '<div style="background:#fff8e1;padding:6px 10px;border-radius:4px;margin-top:4px;font-size:11px;font-family:monospace">🔧 '+esc(p.functionCall.name)+'('+esc(JSON.stringify(p.functionCall.args).slice(0,200))+')</div>';
      }).join('');
      return '<div style="background:'+bg+';padding:10px 14px;border-radius:6px;margin-bottom:8px">'
        + '<div style="font-size:11px;color:#64748b;margin-bottom:4px">'+who+'</div>'
        + '<div style="white-space:pre-wrap;font-size:13px">'+esc(text)+'</div>'
        + fnHtml
        + '</div>';
    }).join('');

    var logsHtml = logs.length ? '<details style="margin-top:14px"><summary style="cursor:pointer;font-size:12px;color:#64748b">🔍 도구 호출 로그 '+logs.length+'건</summary><div style="margin-top:8px">' +
      logs.map(function(l){
        var color = l.status === 'ok' ? '#16a34a' : '#c5293a';
        return '<div style="padding:6px 10px;border-left:3px solid '+color+';background:#fafafa;margin-bottom:4px;font-size:11.5px;font-family:monospace">'
          + '<b>'+esc(l.tool_name)+'</b> ['+l.status+'] '+l.duration_ms+'ms'
          + (l.error ? '<br><span style="color:#c5293a">'+esc(l.error)+'</span>' : '')
          + '</div>';
      }).join('') + '</div></details>' : '';

    body.innerHTML = msgHtml + logsHtml;
  } catch(err) {
    body.innerHTML = '<div style="padding:20px;color:#c5293a">조회 실패: '+(err.message||err)+'</div>';
  }
}

async function renderAiLogs() {
  /* 통계 + 최근 50건 동시 */
  var statsBody = document.getElementById('aiToolStatsBody');
  var logsBody  = document.getElementById('aiLogsBody');
  if (statsBody) statsBody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:#888">불러오는 중…</td></tr>';
  if (logsBody)  logsBody.innerHTML  = '<tr><td colspan="6" style="text-align:center;padding:30px;color:#888">불러오는 중…</td></tr>';

  var esc = window._cmsEsc || function(s){ return String(s||''); };
  var fmt = window._cmsFmt || function(s){ return String(s||''); };

  try {
    var statsRes = await (window._cmsApi || api)('/api/admin-ai-logs-list?stats=1');
    if (statsRes.ok && statsBody) {
      var stats = statsRes.data?.stats || [];
      if (!stats.length) statsBody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:#888">아직 도구 호출이 없습니다</td></tr>';
      else statsBody.innerHTML = stats.map(function(s){
        return '<tr>'
          + '<td style="font-family:monospace"><b>'+esc(s.tool_name)+'</b></td>'
          + '<td style="text-align:right;font-family:Inter">'+s.total_count+'</td>'
          + '<td style="text-align:right;font-family:Inter;color:#16a34a">'+s.ok_count+'</td>'
          + '<td style="text-align:right;font-family:Inter;color:#c5293a">'+s.error_count+'</td>'
          + '<td style="text-align:right;font-family:Inter">'+(s.avg_duration_ms||0)+'</td>'
          + '<td style="font-family:Inter;font-size:11px">'+fmt(s.last_called_at)+'</td>'
          + '</tr>';
      }).join('');
    }
  } catch(err) {
    if (statsBody) statsBody.innerHTML = '<tr><td colspan="6" style="color:#c5293a;padding:30px;text-align:center">'+(err.message||err)+'</td></tr>';
  }

  try {
    var logsRes = await (window._cmsApi || api)('/api/admin-ai-logs-list?limit=50');
    if (logsRes.ok && logsBody) {
      var rows = logsRes.data?.rows || [];
      if (!rows.length) logsBody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:#888">로그 없음</td></tr>';
      else logsBody.innerHTML = rows.map(function(l){
        var color = l.status === 'ok' ? '#16a34a' : '#c5293a';
        return '<tr>'
          + '<td style="font-family:Inter;font-size:11px">'+fmt(l.created_at)+'</td>'
          + '<td>'+esc(l.admin_name || '#'+l.admin_id)+'</td>'
          + '<td style="font-family:monospace;font-size:11.5px">'+esc(l.tool_name)+'</td>'
          + '<td style="color:'+color+';font-weight:600">'+esc(l.status)+'</td>'
          + '<td style="font-family:monospace;font-size:11px;color:#64748b">'+esc(JSON.stringify(l.input_args||{}).slice(0,120))+'</td>'
          + '<td style="text-align:right;font-family:Inter">'+(l.duration_ms||0)+'</td>'
          + '</tr>';
      }).join('');
    }
  } catch(err) {
    if (logsBody) logsBody.innerHTML = '<tr><td colspan="6" style="color:#c5293a;padding:30px;text-align:center">'+(err.message||err)+'</td></tr>';
  }
}

function renderAiConfig() {
  /* 시스템 프롬프트 미리보기 — 정적 (admin-ai-agent.ts의 프롬프트와 동기화) */
  var pre = document.getElementById('aiSystemPromptPreview');
  if (!pre) return;
  pre.textContent = `당신은 (사)교사유가족협의회의 통합 관리 시스템 SIREN의 AI 비서입니다.

## 역할
관리자(super_admin/operator)가 자연어로 명령하면, 적절한 SIREN 도구를 호출해 작업을 수행합니다.

## 사용 가능한 도구 (총 22개)
... (콘텐츠·관리 5 / 회원 4 / 후원 3 / SIREN 신고 4 / 게시판·캠페인 3 / 워크스페이스·KPI 3)

## 원칙
1. 변경 작업은 항상 dry-run 우선 → 사용자 명시 승인 후 적용
2. 의도 모호하면 다시 물어보기
3. 여러 도구 조합 가능
4. 결과는 한국어 자연어로 (raw JSON 덤프 금지)
5. 권한 우선

## 답변 스타일
- 한국어 존댓말, 친근·전문 톤
- 이모지는 결과 표시에만
- 간결하게 — 표·리스트 활용

(전체 프롬프트는 netlify/functions/admin-ai-agent.ts 의 SYSTEM_PROMPT 상수에서 관리합니다)`;

  document.getElementById('aiHistoryRefresh')?.addEventListener('click', renderAiHistory);
  document.getElementById('aiHistoryDetailClose')?.addEventListener('click', function(){
    var p = document.getElementById('aiHistoryDetail');
    if (p) p.style.display = 'none';
  });
}
