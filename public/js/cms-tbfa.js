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
          'csv-import': '📥 CSV 종합 검증 매핑 (효성 + 기업은행 + 토스)',
          'donation-dashboard': '🔍 종합 검증 대시보드',
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
      body.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:30px;color:#c5293a">조회 실패: ' + (res.data?.error || '알 수 없음') + '</td></tr>';
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
      tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:40px;color:#888">조회 결과가 없습니다</td></tr>`;
      renderDonorProspectPagination(0);
      return;
    }

    tbody.innerHTML = rows.map(d => `
      <tr>
        <td>M-${String(d.id).padStart(5,'0')}</td>
        <td><strong>${escapeHtml(d.name || '')}</strong></td>
        <td style="font-family:Inter;font-size:11.5px">${escapeHtml(d.phone || '—')}</td>
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
  document.getElementById('pdBtnAdd')?.addEventListener('click', function() {
    const name = prompt('이름 (필수):');
    if (!name?.trim()) return;
    const phone = prompt('연락처:', '');
    const address = prompt('주소:', '');
    const birthdate = prompt('생년월일 (YYYY-MM-DD):', '');
    const eventName = prompt('이벤트·활동명:', '');
    const entryPath = prompt('유입 경로:', '');
    const memo = prompt('메모:', '');
    api('/api/admin/potential-donor-crud', { method: 'POST', body: { name: name.trim(), phone, address, birthdate, eventName, entryPath, memo } })
      .then(function(res) { if (!res.ok) return toast('등록 실패: ' + (res.data?.error || '')); toast('등록 완료'); renderPotentialDonor(); });
  });
  /* 전역 노출 — IIFE 외부 발송 탭 함수들이 공유 사용 */
  window._cmsApi   = api;
  window._cmsToast = toast;
  window._cmsEsc   = escapeHtml;
  window._cmsFmt   = formatDate;
});

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
   ★ 알림·발송 5개 탭 (CMS 내부 SPA — 별도 페이지 완전 대체)
   ================================================================ */

/* IIFE 내부 헬퍼 참조 (window 노출 경유) */
function api(path, opts) { return window._cmsApi(path, opts); }
function toast(msg, ms)  { return window._cmsToast(msg, ms); }
function cmsToast(msg, ms) { return window._cmsToast(msg, ms); }
function escapeHtml(s)   { return window._cmsEsc(s); }
function formatDate(s)   { return window._cmsFmt(s); }

/* ---- 공통 상태 ---- */
var _sjState = { page: 1, total: 0, init: false };
var _stState = { page: 1, total: 0, init: false };
var _rgState = { page: 1, total: 0, init: false };
var _atState = { init: false };
var _saState = { page: 1, init: false };
var SJ2_PAGE = 20, ST_PAGE = 20, RG2_PAGE = 20, SA_PAGE = 20;

var CH_LABEL = { email:'이메일', sms:'SMS', kakao:'카카오', inapp:'인앱' };
var SJ_STATUS = { pending:'대기', processing:'진행 중', completed:'완료', failed:'실패', cancelled:'취소됨' };
var ST_CAT = { newsletter:'뉴스레터', announcement:'공지', auto_trigger:'AI 트리거', campaign:'캠페인', system:'시스템' };

/* ================================================================
   📤 발송 작업
   ================================================================ */
function renderSendJobs() {
  if (!_sjState.init) {
    _sjState.init = true;
    var el = function(id){ return document.getElementById(id); };
    el('sjFilterStatus')?.addEventListener('change', function(){ _sjState.page=1; _loadSendJobs(); });
    el('sjFilterFrom')?.addEventListener('change', function(){ _sjState.page=1; _loadSendJobs(); });
    el('sjFilterTo')?.addEventListener('change', function(){ _sjState.page=1; _loadSendJobs(); });
    el('sjFilterSearch')?.addEventListener('keydown', function(e){ if(e.key==='Enter'){_sjState.page=1;_loadSendJobs();} });
    el('sjBtnRefresh')?.addEventListener('click', function(){ _sjState.page=1; _loadSendJobs(); });
    el('sjBtnCreate')?.addEventListener('click', function(){ _sjOpenCreate(); });
    el('sjDetailClose')?.addEventListener('click', function(){ document.getElementById('sjDetailPanel').style.display='none'; });
    document.getElementById('sjBody')?.addEventListener('click', function(e) {
      var tr = e.target.closest('tr[data-id]');
      if (tr) _sjOpenDetail(tr.dataset.id);
    });
  }
  _loadSendJobs();
}

async function _loadSendJobs() {
  var tbody = document.getElementById('sjBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:30px;color:#888">불러오는 중…</td></tr>';
  var qs = new URLSearchParams({
    limit: String(SJ2_PAGE),
    offset: String((_sjState.page-1)*SJ2_PAGE)
  });
  var status = document.getElementById('sjFilterStatus')?.value;
  var from   = document.getElementById('sjFilterFrom')?.value;
  var to     = document.getElementById('sjFilterTo')?.value;
  var q      = document.getElementById('sjFilterSearch')?.value?.trim();
  if (status) qs.set('status', status);
  if (from)   qs.set('from', from);
  if (to)     qs.set('to', to);
  if (q)      qs.set('q', q);
  try {
    var res = await api('/api/admin-send-jobs-list?' + qs.toString());
    if (!res.ok) throw new Error(res.data?.error || 'HTTP ' + res.status);
    var d = res.data?.data ?? res.data ?? {};
    var rows = d.rows ?? [];
    _sjState.total = d.total ?? rows.length;
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:30px;color:#888">발송 작업이 없습니다</td></tr>';
    } else {
      tbody.innerHTML = rows.map(function(r) {
        var sl = SJ_STATUS[r.status] || r.status;
        var sc = r.status==='completed'?'cms-b-success':r.status==='failed'?'cms-b-danger':'cms-b-mute';
        return '<tr data-id="'+r.id+'" style="cursor:pointer">'
          +'<td style="font-family:Inter;font-size:11px">#'+r.id+'</td>'
          +'<td><strong>'+escapeHtml(r.name||'')+'</strong></td>'
          +'<td>'+escapeHtml(CH_LABEL[r.channel]||r.channel||'—')+'</td>'
          +'<td style="font-size:12px">'+escapeHtml(r.templateName||'—')+'</td>'
          +'<td style="font-size:12px">'+escapeHtml(r.groupName||'—')+'</td>'
          +'<td><span class="cms-badge '+sc+'">'+sl+'</span></td>'
          +'<td style="text-align:right;font-family:Inter">'+Number(r.totalRecipients||0).toLocaleString()+'</td>'
          +'<td style="text-align:right;font-family:Inter;color:#2e7d32">'+Number(r.successCount||0).toLocaleString()+'</td>'
          +'<td style="text-align:right;font-family:Inter;color:#c5293a">'+Number(r.failureCount||0).toLocaleString()+'</td>'
          +'<td style="font-family:Inter;font-size:11px">'+formatDate(r.scheduledAt||r.createdAt)+'</td>'
          +'<td><button class="cms-btn-link" onclick="event.stopPropagation();_sjOpenDetail('+r.id+')">상세</button></td>'
          +'</tr>';
      }).join('');
    }
    _sjRenderPager();
  } catch(err) {
    tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:30px;color:#c5293a">조회 실패: '+escapeHtml(String(err?.message||err))+'</td></tr>';
  }
}

function _sjRenderPager() {
  var pager = document.getElementById('sjPagination');
  if (!pager) return;
  var tp = Math.max(1, Math.ceil(_sjState.total/SJ2_PAGE));
  var prev = _sjState.page>1?'<button class="cms-donor-pagination-btn" data-sj2p="'+(_sjState.page-1)+'">‹ 이전</button>':'';
  var next = _sjState.page<tp?'<button class="cms-donor-pagination-btn" data-sj2p="'+(_sjState.page+1)+'">다음 ›</button>':'';
  pager.innerHTML = prev+'<span class="cms-donor-pagination-info">'+_sjState.page+' / '+tp+' · 총 '+_sjState.total.toLocaleString()+'건</span>'+next;
  pager.querySelectorAll('[data-sj2p]').forEach(function(b){ b.addEventListener('click', function(){ _sjState.page=Number(b.dataset.sj2p); _loadSendJobs(); }); });
}

async function _sjOpenDetail(id) {
  var panel = document.getElementById('sjDetailPanel');
  var content = document.getElementById('sjDetailContent');
  var title = document.getElementById('sjDetailTitle');
  if (!panel||!content) return;
  panel.style.display = '';
  content.innerHTML = '불러오는 중…';
  title.textContent = '발송 작업 #'+id+' 상세';
  panel.scrollIntoView({ behavior:'smooth', block:'nearest' });
  try {
    var res = await api('/api/admin-send-job-detail?id='+id);
    if (!res.ok) throw new Error(res.data?.error||'HTTP '+res.status);
    var d = res.data?.data ?? res.data ?? {};
    var job = d.job ?? d;
    var sl = SJ_STATUS[job.status]||job.status;
    var sc = job.status==='completed'?'#2e7d32':job.status==='failed'?'#c5293a':'#888';
    var total = Number(job.totalRecipients||0);
    var done  = Number(job.successCount||0)+Number(job.failureCount||0);
    var pct   = total>0 ? Math.round(done/total*100) : 0;
    content.innerHTML = '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:14px">'
      +'<div><span style="font-size:11px;color:#888;display:block">채널</span><strong>'+escapeHtml(CH_LABEL[job.channel]||job.channel||'—')+'</strong></div>'
      +'<div><span style="font-size:11px;color:#888;display:block">상태</span><strong style="color:'+sc+'">'+escapeHtml(sl)+'</strong></div>'
      +'<div><span style="font-size:11px;color:#888;display:block">진행률</span><strong>'+pct+'%</strong> ('+done.toLocaleString()+'/'+total.toLocaleString()+')</div>'
      +'<div><span style="font-size:11px;color:#888;display:block">성공</span><strong style="color:#2e7d32">'+Number(job.successCount||0).toLocaleString()+'</strong></div>'
      +'<div><span style="font-size:11px;color:#888;display:block">실패</span><strong style="color:#c5293a">'+Number(job.failureCount||0).toLocaleString()+'</strong></div>'
      +'<div><span style="font-size:11px;color:#888;display:block">예약</span>'+escapeHtml(formatDate(job.scheduledAt||job.createdAt))+'</div>'
      +'</div>'
      +(job.status==='failed'?'<button class="cms-btn cms-btn-ghost" onclick="_sjRetry('+id+')" style="font-size:12px">🔄 실패 건 재발송</button>':'');
  } catch(err) {
    content.innerHTML = '<span style="color:#c5293a">조회 실패: '+escapeHtml(String(err?.message||err))+'</span>';
  }
}

function _sjOpenCreate() {
  var name = prompt('발송 작업명을 입력하세요:');
  if (!name) return;
  cmsToast('발송 작업 생성은 템플릿·수신자 그룹을 먼저 설정하세요. (기능 준비 중)');
}

async function _sjRetry(id) {
  if (!confirm('실패한 발송을 재시도할까요?')) return;
  try {
    var res = await api('/api/admin-send-job-retry-failed', { method:'POST', body:{ jobId:id } });
    if (!res.ok) throw new Error(res.data?.error||'HTTP '+res.status);
    cmsToast('재발송 요청 완료');
    _sjOpenDetail(id);
  } catch(err) { cmsToast('재발송 실패: '+String(err?.message||err)); }
}

/* ================================================================
   📝 발송 템플릿
   ================================================================ */
function renderSendTemplate() {
  if (!_stState.init) {
    _stState.init = true;
    var el = function(id){ return document.getElementById(id); };
    el('stFilterChannel')?.addEventListener('change', function(){ _stState.page=1; _loadTemplates(); });
    el('stFilterCategory')?.addEventListener('change', function(){ _stState.page=1; _loadTemplates(); });
    el('stFilterInactive')?.addEventListener('change', function(){ _stState.page=1; _loadTemplates(); });
    el('stFilterSearch')?.addEventListener('keydown', function(e){ if(e.key==='Enter'){_stState.page=1;_loadTemplates();} });
    el('stBtnRefresh')?.addEventListener('click', function(){ _stState.page=1; _loadTemplates(); });
    el('stBtnCreate')?.addEventListener('click', function(){ _stOpenEdit(null); });
    el('stEditCancel')?.addEventListener('click', _stShowList);
    el('stEditCancel2')?.addEventListener('click', _stShowList);
    el('stBtnSave')?.addEventListener('click', _stSave);
    el('stBody')?.addEventListener('click', function(e) {
      var btn = e.target.closest('button[data-act]');
      if (!btn) return;
      if (btn.dataset.act==='edit') _stOpenEdit(btn.dataset.id);
      else if (btn.dataset.act==='delete') _stDelete(btn.dataset.id, btn.dataset.name);
    });
  }
  _stShowList();
  _loadTemplates();
}

function _stShowList() {
  document.getElementById('stListView').style.display = '';
  document.getElementById('stEditView').style.display = 'none';
}
function _stShowEdit() {
  document.getElementById('stListView').style.display = 'none';
  document.getElementById('stEditView').style.display = '';
}

async function _loadTemplates() {
  var tbody = document.getElementById('stBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:#888">불러오는 중…</td></tr>';
  var qs = new URLSearchParams({ limit:String(ST_PAGE), offset:String((_stState.page-1)*ST_PAGE) });
  var ch  = document.getElementById('stFilterChannel')?.value;
  var cat = document.getElementById('stFilterCategory')?.value;
  var q   = document.getElementById('stFilterSearch')?.value?.trim();
  var inc = document.getElementById('stFilterInactive')?.checked;
  if (ch)  qs.set('channel', ch);
  if (cat) qs.set('category', cat);
  if (q)   qs.set('q', q);
  if (inc) qs.set('includeInactive','1');
  try {
    var res = await api('/api/admin-templates-list?' + qs.toString());
    if (!res.ok) throw new Error(res.data?.error||'HTTP '+res.status);
    var d = res.data?.data ?? res.data ?? {};
    var rows = d.rows ?? [];
    _stState.total = d.total ?? rows.length;
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:#888">템플릿이 없습니다</td></tr>';
    } else {
      tbody.innerHTML = rows.map(function(r) {
        var inactive = r.isActive===false;
        var chLbl = CH_LABEL[r.channel]||r.channel||'—';
        var catLbl = ST_CAT[r.category]||r.category||'—';
        return '<tr'+(inactive?' style="opacity:.6"':'')+'>'
          +'<td style="font-family:Inter;font-size:11px">#'+r.id+'</td>'
          +'<td>'+escapeHtml(r.name||'')+(inactive?'<span class="cms-badge cms-b-mute" style="margin-left:4px">비활성</span>':'')+'</td>'
          +'<td><span class="cms-badge cms-b-info">'+escapeHtml(chLbl)+'</span></td>'
          +'<td><span class="cms-badge cms-b-mute">'+escapeHtml(catLbl)+'</span></td>'
          +'<td style="font-family:Inter;font-size:11px">'+formatDate(r.updatedAt)+'</td>'
          +'<td>'
            +'<button class="cms-btn-link" data-act="edit" data-id="'+r.id+'">수정</button> '
            +'<button class="cms-btn-link" style="color:#c5293a" data-act="delete" data-id="'+r.id+'" data-name="'+escapeHtml(r.name||'')+'">삭제</button>'
          +'</td>'
          +'</tr>';
      }).join('');
    }
    var pager = document.getElementById('stPagination');
    if (pager) {
      var tp = Math.max(1, Math.ceil(_stState.total/ST_PAGE));
      var prev = _stState.page>1?'<button class="cms-donor-pagination-btn" data-stp="'+(_stState.page-1)+'">‹ 이전</button>':'';
      var next = _stState.page<tp?'<button class="cms-donor-pagination-btn" data-stp="'+(_stState.page+1)+'">다음 ›</button>':'';
      pager.innerHTML = prev+'<span class="cms-donor-pagination-info">'+_stState.page+' / '+tp+' · 총 '+_stState.total.toLocaleString()+'개</span>'+next;
      pager.querySelectorAll('[data-stp]').forEach(function(b){ b.addEventListener('click', function(){ _stState.page=Number(b.dataset.stp); _loadTemplates(); }); });
    }
  } catch(err) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:#c5293a">조회 실패: '+escapeHtml(String(err?.message||err))+'</td></tr>';
  }
}

async function _stOpenEdit(id) {
  document.getElementById('stEditTitle').textContent = id ? '템플릿 수정 #'+id : '새 템플릿 작성';
  document.getElementById('stEditId').value = id || '';
  var flds = ['stFldName','stFldChannel','stFldCategory','stFldSubject','stFldBody'];
  flds.forEach(function(f){ var el=document.getElementById(f); if(el) el.value=''; });
  _stShowEdit();
  if (id) {
    try {
      var res = await api('/api/admin-template-detail?id='+id);
      if (!res.ok) throw new Error(res.data?.error||'HTTP '+res.status);
      var t = res.data?.data ?? res.data ?? {};
      document.getElementById('stFldName').value = t.name||'';
      document.getElementById('stFldChannel').value = t.channel||'email';
      document.getElementById('stFldCategory').value = t.category||'newsletter';
      document.getElementById('stFldSubject').value = t.subjectTemplate||'';
      document.getElementById('stFldBody').value = t.bodyTemplate||'';
    } catch(err) { cmsToast('템플릿 조회 실패: '+String(err?.message||err)); }
  }
}

async function _stSave() {
  var id      = document.getElementById('stEditId').value;
  var name    = document.getElementById('stFldName')?.value?.trim();
  var channel = document.getElementById('stFldChannel')?.value;
  var category= document.getElementById('stFldCategory')?.value;
  var subject = document.getElementById('stFldSubject')?.value?.trim();
  var body    = document.getElementById('stFldBody')?.value?.trim();
  if (!name||!body) { cmsToast('템플릿명과 본문은 필수입니다.'); return; }
  var url = id ? '/api/admin-template-update?id='+id : '/api/admin-template-create';
  try {
    var res = await api(url, { method:'POST', body:{ name, channel, category, subjectTemplate:subject, bodyTemplate:body } });
    if (!res.ok) throw new Error(res.data?.error||'HTTP '+res.status);
    cmsToast(id?'템플릿이 수정됐습니다.':'새 템플릿이 생성됐습니다.');
    _stShowList();
    _stState.page=1; _loadTemplates();
  } catch(err) { cmsToast('저장 실패: '+String(err?.message||err)); }
}

async function _stDelete(id, name) {
  if (!confirm('"'+name+'" 템플릿을 삭제합니다. 계속할까요?')) return;
  try {
    var res = await api('/api/admin-template-delete?id='+id, { method:'POST' });
    if (!res.ok) throw new Error(res.data?.error||'HTTP '+res.status);
    cmsToast('템플릿이 삭제됐습니다.');
    _loadTemplates();
  } catch(err) { cmsToast('삭제 실패: '+String(err?.message||err)); }
}

/* ================================================================
   👥 수신자 그룹
   ================================================================ */

/* 빠른 선택 프리셋 */
var RG_QUICK_PRESETS = {
  'donor-regular':   { type:'filter', logic:'and', filters:[{ field:'donorType', op:'eq', value:'regular' }] },
  'donor-prospect':  { type:'filter', logic:'and', filters:[{ field:'donorType', op:'eq', value:'prospect' }] },
  'donor-potential': { type:'filter', logic:'and', filters:[{ field:'donorType', op:'eq', value:'none' }, { field:'status', op:'eq', value:'active' }] },
  'hyosung-regular': { type:'filter', logic:'and', filters:[{ field:'donorType', op:'eq', value:'regular' }, { field:'donorChannels', op:'eq', value:'hyosung' }] },
  'toss-regular':    { type:'filter', logic:'and', filters:[{ field:'donorType', op:'eq', value:'regular' }, { field:'donorChannels', op:'eq', value:'toss' }] },
  'manual-regular':  { type:'filter', logic:'and', filters:[{ field:'donorType', op:'eq', value:'regular' }, { field:'donorChannels', op:'eq', value:'manual' }] },
  'all-active':      { type:'filter', logic:'and', filters:[{ field:'status', op:'eq', value:'active' }] },
  'family':          { type:'filter', logic:'and', filters:[{ field:'type', op:'eq', value:'family' }, { field:'status', op:'eq', value:'active' }] },
};

var RG_FIELD_OPTIONS = [
  { value:'donorType',    label:'후원자 분류', ops:[{v:'eq',l:'='},{v:'ne',l:'≠'},{v:'in',l:'포함'}],
    values:[{v:'regular',l:'정기'},{v:'prospect',l:'예비'},{v:'none',l:'잠재'}] },
  { value:'donorChannels',label:'후원 채널',   ops:[{v:'eq',l:'='},{v:'in',l:'포함'}],
    values:[{v:'toss',l:'토스'},{v:'hyosung',l:'효성 CMS'},{v:'manual',l:'수기'}] },
  { value:'type',         label:'회원 유형',   ops:[{v:'eq',l:'='},{v:'in',l:'포함'}],
    values:[{v:'regular',l:'일반'},{v:'family',l:'유가족'},{v:'volunteer',l:'봉사자'},{v:'admin',l:'관리자'}] },
  { value:'status',       label:'회원 상태',   ops:[{v:'eq',l:'='},{v:'in',l:'포함'}],
    values:[{v:'active',l:'활성'},{v:'pending',l:'대기'},{v:'suspended',l:'정지'},{v:'withdrawn',l:'탈퇴'}] },
  { value:'hasActiveRegularDonation', label:'활성 정기 후원', ops:[{v:'eq',l:'여부'}], valueType:'boolean' },
  { value:'blacklisted',  label:'블랙 처리',   ops:[{v:'eq',l:'여부'}], valueType:'boolean' },
];

var _rgClauses = [];

function renderRecipientGroups() {
  if (!_rgState.init) {
    _rgState.init = true;
    document.getElementById('rgFilterSearch')?.addEventListener('keydown', function(e){ if(e.key==='Enter'){_rgState.page=1;_loadRgList();} });
    document.getElementById('rgFilterInactive')?.addEventListener('change', function(){ _rgState.page=1;_loadRgList(); });
    document.getElementById('rgBtnRefresh')?.addEventListener('click', function(){ _rgState.page=1;_loadRgList(); });
    document.getElementById('rgBtnCreate')?.addEventListener('click', function(){ _rgOpenEdit(null); });
    document.getElementById('rgEditCancel')?.addEventListener('click', _rgShowList);
    document.getElementById('rgEditCancel2')?.addEventListener('click', _rgShowList);
    document.getElementById('rgAddFilter')?.addEventListener('click', function(){ _rgClauses.push({field:'donorType',op:'eq',value:'regular'}); _rgRenderClauses(); });
    document.getElementById('rgBtnPreview')?.addEventListener('click', _rgPreview);
    document.getElementById('rgBtnSave')?.addEventListener('click', _rgSave);
    document.querySelectorAll('[data-quick]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var preset = RG_QUICK_PRESETS[btn.dataset.quick];
        if (!preset) return;
        document.getElementById('rgCriteriaTypeFilter').checked = true;
        document.getElementById('rgFilterBuilder').style.display = '';
        document.getElementById('rgManualBuilder').style.display = 'none';
        _rgClauses = preset.filters.map(function(f){ return Object.assign({}, f); });
        document.getElementById('rgFilterLogic').value = preset.logic;
        _rgRenderClauses();
      });
    });
    document.querySelectorAll('input[name="rgCriteriaType"]').forEach(function(r) {
      r.addEventListener('change', function() {
        var isFilter = document.getElementById('rgCriteriaTypeFilter').checked;
        document.getElementById('rgFilterBuilder').style.display = isFilter ? '' : 'none';
        document.getElementById('rgManualBuilder').style.display = isFilter ? 'none' : '';
      });
    });
    document.getElementById('rgBody')?.addEventListener('click', function(e) {
      var btn = e.target.closest('button[data-act]');
      if (!btn) return;
      if (btn.dataset.act==='edit')   _rgOpenEdit(btn.dataset.id);
      if (btn.dataset.act==='delete') _rgDelete(btn.dataset.id, btn.dataset.name);
    });
  }
  _rgShowList();
  _loadRgList();
}

function _rgShowList() {
  document.getElementById('rgListView').style.display = '';
  document.getElementById('rgEditView').style.display = 'none';
  document.getElementById('rgPreviewArea').style.display = 'none';
}
function _rgShowEdit() {
  document.getElementById('rgListView').style.display = 'none';
  document.getElementById('rgEditView').style.display = '';
}

async function _loadRgList() {
  var tbody = document.getElementById('rgBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:#888">불러오는 중…</td></tr>';
  var qs = new URLSearchParams({ limit:String(RG2_PAGE), offset:String((_rgState.page-1)*RG2_PAGE) });
  var q   = document.getElementById('rgFilterSearch')?.value?.trim();
  var inc = document.getElementById('rgFilterInactive')?.checked;
  if (q)   qs.set('q', q);
  if (inc) qs.set('includeInactive','1');
  try {
    var res = await api('/api/admin-recipient-groups-list?'+qs.toString());
    if (!res.ok) throw new Error(res.data?.error||'HTTP '+res.status);
    var d = res.data?.data ?? res.data ?? {};
    var rows = d.rows ?? [];
    _rgState.total = d.total ?? rows.length;
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:#888">수신자 그룹이 없습니다</td></tr>';
    } else {
      tbody.innerHTML = rows.map(function(r) {
        return '<tr>'
          +'<td style="font-family:Inter;font-size:11px">#'+r.id+'</td>'
          +'<td><strong>'+escapeHtml(r.name||'')+'</strong></td>'
          +'<td style="font-size:12px;color:#666">'+escapeHtml(r.criteriaSummary||'—')+'</td>'
          +'<td style="text-align:right;font-family:Inter">'+((r.memberCount!=null)?Number(r.memberCount).toLocaleString():'—')+'</td>'
          +'<td>'+(r.isActive?'<span class="cms-badge cms-b-success">활성</span>':'<span class="cms-badge cms-b-mute">비활성</span>')+'</td>'
          +'<td style="font-family:Inter;font-size:11px">'+formatDate(r.createdAt)+'</td>'
          +'<td>'
            +'<button class="cms-btn-link" data-act="edit" data-id="'+r.id+'">수정</button> '
            +'<button class="cms-btn-link" style="color:#c5293a" data-act="delete" data-id="'+r.id+'" data-name="'+escapeHtml(r.name||'')+'">삭제</button>'
          +'</td>'
          +'</tr>';
      }).join('');
    }
    var pager = document.getElementById('rgPagination');
    if (pager) {
      var tp = Math.max(1,Math.ceil(_rgState.total/RG2_PAGE));
      var prev = _rgState.page>1?'<button class="cms-donor-pagination-btn" data-rg2p="'+(_rgState.page-1)+'">‹ 이전</button>':'';
      var next = _rgState.page<tp?'<button class="cms-donor-pagination-btn" data-rg2p="'+(_rgState.page+1)+'">다음 ›</button>':'';
      pager.innerHTML = prev+'<span class="cms-donor-pagination-info">'+_rgState.page+' / '+tp+' · 총 '+_rgState.total.toLocaleString()+'개</span>'+next;
      pager.querySelectorAll('[data-rg2p]').forEach(function(b){ b.addEventListener('click', function(){ _rgState.page=Number(b.dataset.rg2p); _loadRgList(); }); });
    }
  } catch(err) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:#c5293a">조회 실패: '+escapeHtml(String(err?.message||err))+'</td></tr>';
  }
}

async function _rgOpenEdit(id) {
  _rgClauses = [];
  document.getElementById('rgFldName').value = '';
  document.getElementById('rgFldDesc').value = '';
  document.getElementById('rgEditId').value = id||'';
  document.getElementById('rgEditTitle').textContent = id ? '수신자 그룹 수정 #'+id : '새 수신자 그룹';
  document.getElementById('rgCriteriaTypeFilter').checked = true;
  document.getElementById('rgFilterBuilder').style.display = '';
  document.getElementById('rgManualBuilder').style.display = 'none';
  document.getElementById('rgPreviewArea').style.display = 'none';
  _rgRenderClauses();
  _rgShowEdit();
  if (id) {
    try {
      var res = await api('/api/admin-recipient-group-detail?id='+id);
      if (!res.ok) throw new Error(res.data?.error||'HTTP '+res.status);
      var g = res.data?.data ?? res.data ?? {};
      document.getElementById('rgFldName').value = g.name||'';
      document.getElementById('rgFldDesc').value = g.description||'';
      var c = g.criteria;
      if (c && c.type==='manual') {
        document.getElementById('rgCriteriaTypeManual').checked = true;
        document.getElementById('rgFilterBuilder').style.display = 'none';
        document.getElementById('rgManualBuilder').style.display = '';
        document.getElementById('rgManualIds').value = (c.memberIds||[]).join('\n');
      } else if (c && c.type==='filter') {
        _rgClauses = (c.filters||[]).map(function(f){ return Object.assign({},f); });
        document.getElementById('rgFilterLogic').value = c.logic||'and';
        _rgRenderClauses();
      }
    } catch(err) { cmsToast('그룹 조회 실패: '+String(err?.message||err)); }
  }
}

function _rgRenderClauses() {
  var container = document.getElementById('rgFilterClauses');
  if (!container) return;
  if (!_rgClauses.length) {
    container.innerHTML = '<div style="font-size:12px;color:#94a0b3;padding:8px">조건을 추가하거나 위 빠른 선택 버튼을 클릭하세요.</div>';
    return;
  }
  container.innerHTML = _rgClauses.map(function(clause, idx) {
    var fieldSpec = RG_FIELD_OPTIONS.find(function(f){ return f.value===clause.field; }) || RG_FIELD_OPTIONS[0];
    var fieldSel = '<select class="cms-input rg-clause-field" data-idx="'+idx+'" style="width:130px">'
      + RG_FIELD_OPTIONS.map(function(f){ return '<option value="'+f.value+'"'+(f.value===clause.field?' selected':'')+'>'+f.label+'</option>'; }).join('')
      + '</select>';
    var opSel = '<select class="cms-input rg-clause-op" data-idx="'+idx+'" style="width:80px">'
      + (fieldSpec.ops||[]).map(function(o){ return '<option value="'+o.v+'"'+(o.v===clause.op?' selected':'')+'>'+o.l+'</option>'; }).join('')
      + '</select>';
    var valEl;
    if (fieldSpec.valueType==='boolean') {
      valEl = '<select class="cms-input rg-clause-val" data-idx="'+idx+'" style="width:90px">'
        +'<option value="true"'+(clause.value===true?' selected':'')+'>예</option>'
        +'<option value="false"'+(clause.value===false?' selected':'')+'>아니오</option>'
        +'</select>';
    } else {
      valEl = '<select class="cms-input rg-clause-val" data-idx="'+idx+'" style="width:110px">'
        + (fieldSpec.values||[]).map(function(v){ return '<option value="'+v.v+'"'+((clause.value===v.v||Array.isArray(clause.values)&&clause.values.includes(v.v))?' selected':'')+'>'+v.l+'</option>'; }).join('')
        + '</select>';
    }
    return '<div style="display:flex;gap:8px;align-items:center;padding:8px;background:#fff;border:1px solid var(--line,#e3e6eb);border-radius:6px">'
      + fieldSel + opSel + valEl
      + '<button class="cms-btn cms-btn-ghost rg-clause-del" data-idx="'+idx+'" style="font-size:12px;padding:4px 8px;color:#c5293a">✕</button>'
      + '</div>';
  }).join('');
  container.querySelectorAll('.rg-clause-field').forEach(function(sel) {
    sel.addEventListener('change', function() {
      var idx = Number(sel.dataset.idx);
      var newSpec = RG_FIELD_OPTIONS.find(function(f){ return f.value===sel.value; });
      _rgClauses[idx] = { field:sel.value, op:(newSpec?.ops?.[0]?.v||'eq'), value: newSpec?.values?.[0]?.v ?? true };
      _rgRenderClauses();
    });
  });
  container.querySelectorAll('.rg-clause-op').forEach(function(sel) {
    sel.addEventListener('change', function() { _rgClauses[Number(sel.dataset.idx)].op = sel.value; });
  });
  container.querySelectorAll('.rg-clause-val').forEach(function(sel) {
    sel.addEventListener('change', function() {
      var idx = Number(sel.dataset.idx);
      var val = sel.value;
      if (val==='true') val=true; else if(val==='false') val=false;
      _rgClauses[idx].value = val;
    });
  });
  container.querySelectorAll('.rg-clause-del').forEach(function(btn) {
    btn.addEventListener('click', function() { _rgClauses.splice(Number(btn.dataset.idx),1); _rgRenderClauses(); });
  });
}

async function _rgPreview() {
  var criteria = _rgBuildCriteria();
  if (!criteria) return;
  var area = document.getElementById('rgPreviewArea');
  var content = document.getElementById('rgPreviewContent');
  area.style.display = '';
  content.innerHTML = '계산 중…';
  try {
    var res = await api('/api/admin-recipient-group-preview', { method:'POST', body:{ criteria } });
    if (!res.ok) throw new Error(res.data?.error||'HTTP '+res.status);
    var d = res.data?.data ?? res.data ?? {};
    var p = d.preview ?? d;
    var sample = (p.sampleMembers||[]).map(function(m){ return escapeHtml(m.name||'#'+m.id); }).join(', ');
    content.innerHTML = '<strong style="font-size:14px;color:#1a5ec4">'+Number(p.memberCount||0).toLocaleString()+'명</strong>'
      +(sample?' <span style="font-size:12px;color:#666">— 예시: '+sample+'</span>':'');
  } catch(err) {
    content.innerHTML = '<span style="color:#c5293a">미리보기 실패: '+escapeHtml(String(err?.message||err))+'</span>';
  }
}

function _rgBuildCriteria() {
  var isManual = document.getElementById('rgCriteriaTypeManual')?.checked;
  if (isManual) {
    var raw = document.getElementById('rgManualIds')?.value||'';
    var ids = raw.split(/[\s,]+/).map(Number).filter(function(n){ return Number.isInteger(n)&&n>0; });
    if (!ids.length) { cmsToast('회원 ID를 입력하세요.'); return null; }
    return { type:'manual', memberIds:ids };
  }
  if (!_rgClauses.length) { cmsToast('최소 1개 이상의 조건을 추가하세요.'); return null; }
  return {
    type:'filter',
    logic: document.getElementById('rgFilterLogic')?.value || 'and',
    filters: _rgClauses.map(function(c){ return Object.assign({},c); })
  };
}

async function _rgSave() {
  var id   = document.getElementById('rgEditId').value;
  var name = document.getElementById('rgFldName')?.value?.trim();
  var desc = document.getElementById('rgFldDesc')?.value?.trim();
  if (!name) { cmsToast('그룹명은 필수입니다.'); return; }
  var criteria = _rgBuildCriteria();
  if (!criteria) return;
  var url = id ? '/api/admin-recipient-group-update?id='+id : '/api/admin-recipient-group-create';
  try {
    var res = await api(url, { method:'POST', body:{ name, description:desc, criteria } });
    if (!res.ok) throw new Error(res.data?.error||'HTTP '+res.status);
    cmsToast(id?'그룹이 수정됐습니다.':'새 그룹이 생성됐습니다.');
    _rgShowList();
    _rgState.page=1; _loadRgList();
  } catch(err) { cmsToast('저장 실패: '+String(err?.message||err)); }
}

async function _rgDelete(id, name) {
  if (!confirm('"'+name+'" 그룹을 삭제합니다. 계속할까요?')) return;
  try {
    var res = await api('/api/admin-recipient-group-delete?id='+id, { method:'POST' });
    if (!res.ok) throw new Error(res.data?.error||'HTTP '+res.status);
    cmsToast('그룹이 삭제됐습니다.');
    _loadRgList();
  } catch(err) { cmsToast('삭제 실패: '+String(err?.message||err)); }
}

/* ================================================================
   🤖 AI 자동 발송 트리거
   ================================================================ */
var AT_TRIGGER_LABELS = {
  new_member:'신규 가입', member_withdrawn:'회원 탈퇴', member_approved:'가입 승인',
  first_donation:'첫 후원 완료', donation_complete:'후원 결제 완료', donation_failed:'후원 결제 실패',
  regular_started:'정기 후원 시작', regular_cancelled:'정기 후원 취소', regular_resumed:'정기 후원 재개',
  donation_anniversary:'후원 기념일', upgrade_to_regular:'예비→정기 전환', downgrade_from_regular:'정기→예비 전환',
  birthday:'생일 당일', anniversary:'협의회 기념일',
  inactive_60d:'60일 미접속', inactive_180d:'180일 미후원', one_year_no_donation:'1년 무후원',
  support_approved:'유족 지원 승인', support_rejected:'유족 지원 반려',
  grade_upgrade:'등급 상향', grade_downgrade:'등급 하향',
  receipt_issued:'영수증 발급', campaign_end:'캠페인 종료 감사',
};

function renderAutoTrigger() {
  if (!_atState.init) {
    _atState.init = true;
    document.getElementById('atBtnCreate')?.addEventListener('click', function(){ _atOpenEdit(null); });
    document.getElementById('atEditCancel')?.addEventListener('click', _atShowList);
    document.getElementById('atEditCancel2')?.addEventListener('click', _atShowList);
    document.getElementById('atBtnSave')?.addEventListener('click', _atSave);
    document.getElementById('atBody')?.addEventListener('click', function(e) {
      var btn = e.target.closest('button[data-act]');
      if (!btn) return;
      if (btn.dataset.act==='edit') _atOpenEdit(btn.dataset.id);
      if (btn.dataset.act==='toggle') _atToggle(btn.dataset.id, btn.dataset.active==='true');
      if (btn.dataset.act==='delete') _atDelete(btn.dataset.id, btn.dataset.name);
    });
  }
  _atShowList();
  _loadTriggers();
}

function _atShowList() {
  document.getElementById('atListView').style.display = '';
  document.getElementById('atEditView').style.display = 'none';
}
function _atShowEdit() {
  document.getElementById('atListView').style.display = 'none';
  document.getElementById('atEditView').style.display = '';
}

async function _loadTriggers() {
  var tbody = document.getElementById('atBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:#888">불러오는 중…</td></tr>';
  try {
    var res = await api('/api/admin-auto-triggers-list');
    if (!res.ok) throw new Error(res.data?.error||'HTTP '+res.status);
    var d = res.data?.data ?? res.data ?? {};
    var rows = Array.isArray(d) ? d : (d.rows ?? d.triggers ?? []);
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:#888">등록된 트리거가 없습니다</td></tr>';
    } else {
      tbody.innerHTML = rows.map(function(r) {
        var active = r.isActive !== false;
        return '<tr>'
          +'<td style="font-family:Inter;font-size:11px">#'+r.id+'</td>'
          +'<td><strong>'+escapeHtml(r.name||'')+'</strong></td>'
          +'<td><span class="cms-badge cms-b-info">'+escapeHtml(AT_TRIGGER_LABELS[r.triggerType]||r.triggerType||'—')+'</span></td>'
          +'<td style="font-size:12px;color:#666">'+escapeHtml(r.groupName||'전체 해당자')+'</td>'
          +'<td style="font-size:12px">'+escapeHtml(r.templateName||'—')+'</td>'
          +'<td style="font-family:Inter;font-size:12px">'+(r.delayHours>0?r.delayHours+'시간':'즉시')+'</td>'
          +'<td>'+(active?'<span class="cms-badge cms-b-success">활성</span>':'<span class="cms-badge cms-b-mute">비활성</span>')+'</td>'
          +'<td>'
            +'<button class="cms-btn-link" data-act="edit" data-id="'+r.id+'">수정</button> '
            +'<button class="cms-btn-link" data-act="toggle" data-id="'+r.id+'" data-active="'+active+'">'+(active?'비활성화':'활성화')+'</button> '
            +'<button class="cms-btn-link" style="color:#c5293a" data-act="delete" data-id="'+r.id+'" data-name="'+escapeHtml(r.name||'')+'">삭제</button>'
          +'</td>'
          +'</tr>';
      }).join('');
    }
  } catch(err) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:#c5293a">조회 실패: '+escapeHtml(String(err?.message||err))+'</td></tr>';
  }
}

async function _atOpenEdit(id) {
  document.getElementById('atEditTitle').textContent = id ? '트리거 수정 #'+id : '새 트리거 설정';
  document.getElementById('atEditId').value = id||'';
  ['atFldName','atFldType','atFldTemplate','atFldGroup','atFldDelay','atFldCooldown'].forEach(function(f){
    var el=document.getElementById(f); if(el) el.value = f==='atFldDelay'?'0':f==='atFldCooldown'?'30':'';
  });
  document.getElementById('atFldActive').checked = true;
  _atShowEdit();
  /* 템플릿·그룹 목록 로드 */
  _atLoadSelects();
  if (id) {
    try {
      var res = await api('/api/admin-auto-trigger-detail?id='+id);
      if (!res.ok) throw new Error(res.data?.error||'HTTP '+res.status);
      var t = res.data?.data ?? res.data ?? {};
      document.getElementById('atFldName').value = t.name||'';
      document.getElementById('atFldType').value = t.triggerType||'new_member';
      document.getElementById('atFldDelay').value = t.delayHours??0;
      document.getElementById('atFldCooldown').value = t.cooldownDays??30;
      document.getElementById('atFldActive').checked = t.isActive!==false;
      setTimeout(function(){
        document.getElementById('atFldTemplate').value = t.templateId||'';
        document.getElementById('atFldGroup').value = t.recipientGroupId||'';
      }, 500);
    } catch(err) { cmsToast('트리거 조회 실패: '+String(err?.message||err)); }
  }
}

async function _atLoadSelects() {
  try {
    var [tRes, gRes] = await Promise.all([
      api('/api/admin-templates-list?limit=100'),
      api('/api/admin-recipient-groups-list?limit=100')
    ]);
    var tRows = (tRes.data?.data ?? tRes.data ?? {}).rows ?? [];
    var gRows = (gRes.data?.data ?? gRes.data ?? {}).rows ?? [];
    var tSel = document.getElementById('atFldTemplate');
    var gSel = document.getElementById('atFldGroup');
    if (tSel) tSel.innerHTML = '<option value="">템플릿 선택…</option>' + tRows.map(function(r){ return '<option value="'+r.id+'">'+escapeHtml(r.name)+'</option>'; }).join('');
    if (gSel) gSel.innerHTML = '<option value="">전체 (조건 해당자)</option>' + gRows.map(function(r){ return '<option value="'+r.id+'">'+escapeHtml(r.name)+'</option>'; }).join('');
  } catch(e) {}
}

async function _atSave() {
  var id       = document.getElementById('atEditId').value;
  var name     = document.getElementById('atFldName')?.value?.trim();
  var type     = document.getElementById('atFldType')?.value;
  var tplId    = document.getElementById('atFldTemplate')?.value;
  var grpId    = document.getElementById('atFldGroup')?.value;
  var delay    = Number(document.getElementById('atFldDelay')?.value||0);
  var cooldown = Number(document.getElementById('atFldCooldown')?.value||30);
  var active   = document.getElementById('atFldActive')?.checked;
  if (!name||!type||!tplId) { cmsToast('트리거명·발동 조건·템플릿은 필수입니다.'); return; }
  var url = id ? '/api/admin-auto-trigger-update?id='+id : '/api/admin-auto-trigger-create';
  try {
    var res = await api(url, { method:'POST', body:{
      name, triggerType:type, templateId:Number(tplId),
      recipientGroupId: grpId ? Number(grpId) : null,
      delayHours:delay, cooldownDays:cooldown, isActive:active
    }});
    if (!res.ok) throw new Error(res.data?.error||'HTTP '+res.status);
    cmsToast(id?'트리거가 수정됐습니다.':'새 트리거가 생성됐습니다.');
    _atShowList(); _loadTriggers();
  } catch(err) { cmsToast('저장 실패: '+String(err?.message||err)); }
}

async function _atToggle(id, currentActive) {
  try {
    var res = await api('/api/admin-auto-trigger-update?id='+id, { method:'POST', body:{ isActive:!currentActive } });
    if (!res.ok) throw new Error(res.data?.error||'HTTP '+res.status);
    cmsToast(currentActive?'트리거가 비활성화됐습니다.':'트리거가 활성화됐습니다.');
    _loadTriggers();
  } catch(err) { cmsToast('변경 실패: '+String(err?.message||err)); }
}

async function _atDelete(id, name) {
  if (!confirm('"'+name+'" 트리거를 삭제합니다. 계속할까요?')) return;
  try {
    var res = await api('/api/admin-auto-trigger-delete?id='+id, { method:'POST' });
    if (!res.ok) throw new Error(res.data?.error||'HTTP '+res.status);
    cmsToast('트리거가 삭제됐습니다.');
    _loadTriggers();
  } catch(err) { cmsToast('삭제 실패: '+String(err?.message||err)); }
}

/* ================================================================
   📊 발송 분석
   ================================================================ */
function renderSendAnalytics() {
  if (!_saState.init) {
    _saState.init = true;
    document.getElementById('saFilterPeriod')?.addEventListener('change', function(){ _saState.page=1; _loadSendAnalytics(); });
    document.getElementById('saBtnRefresh')?.addEventListener('click', function(){ _saState.page=1; _loadSendAnalytics(); });
  }
  _loadSendAnalytics();
}

async function _loadSendAnalytics() {
  var period = document.getElementById('saFilterPeriod')?.value || '30d';
  var qs = new URLSearchParams({ period, limit:String(SA_PAGE), offset:String((_saState.page-1)*SA_PAGE) });
  /* KPI 초기화 */
  ['saKpiTotal','saKpiSuccess','saKpiFail','saKpiRate'].forEach(function(id){ var el=document.getElementById(id); if(el) el.textContent='—'; });
  var tbody = document.getElementById('saLogBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:#888">불러오는 중…</td></tr>';
  try {
    var res = await api('/api/admin-notification-logs?'+qs.toString());
    if (!res.ok) throw new Error(res.data?.error||'HTTP '+res.status);
    var d = res.data?.data ?? res.data ?? {};
    var rows = d.rows ?? d.logs ?? [];
    var stats = d.stats ?? {};
    var total = Number(stats.total||0);
    var succ  = Number(stats.success||0);
    var fail  = Number(stats.failed||0);
    var rate  = total>0 ? Math.round(succ/total*100)+'%' : '—';
    var set = function(id,v){ var el=document.getElementById(id); if(el) el.textContent=v; };
    set('saKpiTotal', total.toLocaleString()+'건');
    set('saKpiSuccess', succ.toLocaleString()+'건');
    set('saKpiFail', fail.toLocaleString()+'건');
    set('saKpiRate', rate);
    if (tbody) {
      if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:#888">발송 이력이 없습니다</td></tr>';
      } else {
        tbody.innerHTML = rows.map(function(r) {
          var sl = SJ_STATUS[r.status]||r.status;
          var sc = r.status==='completed'?'cms-b-success':r.status==='failed'?'cms-b-danger':'cms-b-mute';
          return '<tr>'
            +'<td>'+escapeHtml(r.jobName||r.name||'#'+r.jobId||r.id)+'</td>'
            +'<td>'+escapeHtml(CH_LABEL[r.channel]||r.channel||'—')+'</td>'
            +'<td><span class="cms-badge '+sc+'">'+sl+'</span></td>'
            +'<td style="text-align:right;font-family:Inter">'+Number(r.totalRecipients||0).toLocaleString()+'</td>'
            +'<td style="text-align:right;font-family:Inter;color:#2e7d32">'+Number(r.successCount||0).toLocaleString()+'</td>'
            +'<td style="text-align:right;font-family:Inter;color:#c5293a">'+Number(r.failureCount||0).toLocaleString()+'</td>'
            +'<td style="font-family:Inter;font-size:11px">'+formatDate(r.completedAt||r.updatedAt||r.createdAt)+'</td>'
            +'</tr>';
        }).join('');
      }
    }
    var pager = document.getElementById('saPagination');
    if (pager) {
      var saTotal = d.total ?? rows.length;
      var tp = Math.max(1,Math.ceil(saTotal/SA_PAGE));
      var prev = _saState.page>1?'<button class="cms-donor-pagination-btn" data-sap="'+(_saState.page-1)+'">‹ 이전</button>':'';
      var next = _saState.page<tp?'<button class="cms-donor-pagination-btn" data-sap="'+(_saState.page+1)+'">다음 ›</button>':'';
      pager.innerHTML = prev+'<span class="cms-donor-pagination-info">'+_saState.page+' / '+tp+' · 총 '+saTotal.toLocaleString()+'건</span>'+next;
      pager.querySelectorAll('[data-sap]').forEach(function(b){ b.addEventListener('click', function(){ _saState.page=Number(b.dataset.sap); _loadSendAnalytics(); }); });
    }
  } catch(err) {
    if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:#c5293a">조회 실패: '+escapeHtml(String(err?.message||err))+'</td></tr>';
  }
}

/* ---- cmsToast 헬퍼 (없으면 생성) ---- */
function cmsToast(msg) {
  var t = document.getElementById('cmsToast');
  if (!t) { alert(msg); return; }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(window._cmsToastT);
  window._cmsToastT = setTimeout(function(){ t.classList.remove('show'); }, 2800);
}
