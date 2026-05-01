/* =========================================================
   SIREN — CMS SI (SI 사업 관리 시스템) DEMO
   ========================================================= */
(function() {
  'use strict';

  /* ============ API ============ */
  async function api(path, options = {}) {
    try {
      const res = await fetch(path, {
        method: options.method || 'GET',
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        credentials: 'include',
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok && data.ok !== false, data };
    } catch (e) {
      return { ok: false, data: { error: '네트워크 오류' } };
    }
  }

  function toast(msg, ms = 2400) {
    const t = document.getElementById('cmsSiToast');
    if (!t) return alert(msg);
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(window._siT);
    window._siT = setTimeout(() => t.classList.remove('show'), ms);
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
    );
  }

  /* ============ 데모 데이터 ============ */
  const DEMO_CLIENTS = [
    { id: 1, name: '삼성SDS', contact: '김부장', projects: 3, active: 2, total: 450, status: 'active', since: '2023-05' },
    { id: 2, name: 'LG CNS', contact: '이과장', projects: 5, active: 3, total: 820, status: 'active', since: '2022-11' },
    { id: 3, name: '네이버클라우드', contact: '박팀장', projects: 2, active: 1, total: 240, status: 'active', since: '2024-02' },
    { id: 4, name: '카카오엔터프라이즈', contact: '최매니저', projects: 4, active: 2, total: 680, status: 'active', since: '2023-08' },
    { id: 5, name: '(주)테크솔루션', contact: '정대리', projects: 2, active: 0, total: 150, status: 'closed', since: '2023-01' },
    { id: 6, name: 'NHN', contact: '한과장', projects: 1, active: 0, total: 0, status: 'lead', since: '2025-04' },
    { id: 7, name: '쿠팡', contact: '강팀장', projects: 2, active: 2, total: 320, status: 'active', since: '2024-06' },
    { id: 8, name: '토스', contact: '윤PO', projects: 1, active: 1, total: 180, status: 'active', since: '2025-01' },
  ];

  const DEMO_PROJECTS = [
    { code: 'SI-2026-001', name: 'AI챗봇 개발 프로젝트', client: '삼성SDS', pm: '김진호', stage: 'active', progress: 64, contract: 180000000, due: '2026-07-15' },
    { code: 'SI-2026-002', name: '쇼핑몰 리뉴얼', client: 'LG CNS', pm: '이수현', stage: 'testing', progress: 85, contract: 120000000, due: '2026-05-30' },
    { code: 'SI-2026-003', name: 'ERP 구축', client: '네이버클라우드', pm: '박지훈', stage: 'active', progress: 42, contract: 320000000, due: '2026-09-20' },
    { code: 'SI-2026-004', name: '모바일 앱 개발', client: '카카오엔터프라이즈', pm: '정민서', stage: 'planning', progress: 15, contract: 95000000, due: '2026-08-10' },
    { code: 'SI-2026-005', name: 'CRM 시스템', client: '쿠팡', pm: '최유나', stage: 'active', progress: 72, contract: 210000000, due: '2026-06-25' },
    { code: 'SI-2025-042', name: '마케팅 플랫폼', client: '토스', pm: '강동혁', stage: 'maintenance', progress: 100, contract: 88000000, due: '2026-12-31' },
    { code: 'SI-2026-006', name: 'MES 시스템', client: '삼성SDS', pm: '김진호', stage: 'delivered', progress: 100, contract: 150000000, due: '2026-03-20' },
    { code: 'SI-2026-007', name: '데이터 레이크 구축', client: 'LG CNS', pm: '이수현', stage: 'active', progress: 35, contract: 250000000, due: '2026-10-15' },
  ];

  const DEMO_KANBAN = {
    todo: [
      { id: 1, tag: 'feature', title: '사용자 권한 관리 모듈 설계', assignees: ['김','이'], date: '5/20' },
      { id: 2, tag: 'task', title: 'AWS 인프라 셋업', assignees: ['박'], date: '5/22' },
      { id: 3, tag: 'feature', title: '결제 모듈 연동', assignees: ['이','최'], date: '5/25' },
      { id: 4, tag: 'bug', title: '로그인 오류 수정', assignees: ['김'], date: '5/18' },
      { id: 5, tag: 'task', title: 'DB 스키마 문서화', assignees: ['박'], date: '5/28' },
    ],
    progress: [
      { id: 6, tag: 'feature', title: 'REST API 설계', assignees: ['정','김'], date: '5/15' },
      { id: 7, tag: 'feature', title: '프론트엔드 컴포넌트 개발', assignees: ['최','이'], date: '5/14' },
      { id: 8, tag: 'bug', title: 'CORS 이슈 해결', assignees: ['박'], date: '5/13' },
    ],
    review: [
      { id: 9, tag: 'feature', title: '대시보드 UI 리뷰', assignees: ['정'], date: '5/10' },
      { id: 10, tag: 'task', title: 'E2E 테스트 케이스', assignees: ['최','강'], date: '5/11' },
    ],
    done: [
      { id: 11, tag: 'feature', title: '회원가입 기능 완료', assignees: ['김','이'], date: '5/2' },
      { id: 12, tag: 'task', title: 'CI/CD 파이프라인 구축', assignees: ['박'], date: '5/5' },
      { id: 13, tag: 'bug', title: 'SQL Injection 취약점 수정', assignees: ['강'], date: '5/7' },
      { id: 14, tag: 'feature', title: '이메일 발송 시스템', assignees: ['정'], date: '5/8' },
      { id: 15, tag: 'task', title: '로깅 시스템 개선', assignees: ['최'], date: '5/9' },
      { id: 16, tag: 'feature', title: '소셜 로그인 연동', assignees: ['김'], date: '5/3' },
      { id: 17, tag: 'bug', title: '메모리 누수 해결', assignees: ['박'], date: '5/6' },
      { id: 18, tag: 'feature', title: '반응형 UI 구현', assignees: ['이'], date: '5/4' },
    ],
  };

  const DEMO_INVOICES = [
    { no: 'INV-2026-0045', date: '2026-05-10', client: '삼성SDS', project: 'AI챗봇 개발', amount: 60000000, due: '2026-06-10', status: 'paid' },
    { no: 'INV-2026-0044', date: '2026-05-08', client: 'LG CNS', project: '쇼핑몰 리뉴얼', amount: 40000000, due: '2026-06-08', status: 'pending' },
    { no: 'INV-2026-0043', date: '2026-05-05', client: '네이버클라우드', project: 'ERP 구축', amount: 80000000, due: '2026-06-05', status: 'paid' },
    { no: 'INV-2026-0042', date: '2026-04-28', client: '카카오엔터프라이즈', project: '모바일 앱', amount: 30000000, due: '2026-05-28', status: 'overdue' },
    { no: 'INV-2026-0041', date: '2026-04-25', client: '쿠팡', project: 'CRM 시스템', amount: 70000000, due: '2026-05-25', status: 'paid' },
    { no: 'INV-2026-0040', date: '2026-04-20', client: '토스', project: '마케팅 플랫폼', amount: 15000000, due: '2026-05-20', status: 'paid' },
    { no: 'INV-2026-0039', date: '2026-05-12', client: '삼성SDS', project: 'MES 시스템', amount: 50000000, due: '2026-06-12', status: 'draft' },
  ];

  const DEMO_ISSUES = [
    { no: 'ISS-08432', title: '로그인 시 500 에러 발생 (특정 브라우저)', project: 'AI챗봇', type: '버그', priority: 'critical', assignee: '김진호', sla: '2h 남음', status: 'open', slaClass: 'danger' },
    { no: 'ISS-08431', title: '결제 완료 후 리다이렉트 안 됨', project: '쇼핑몰 리뉴얼', type: '버그', priority: 'high', assignee: '이수현', sla: '8h 남음', status: 'progress', slaClass: 'warning' },
    { no: 'ISS-08430', title: '관리자 메뉴에 검색 기능 추가 요청', project: 'ERP 구축', type: '개선', priority: 'normal', assignee: '박지훈', sla: '2일 남음', status: 'open', slaClass: 'safe' },
    { no: 'ISS-08429', title: 'API 응답 시간 최적화', project: 'CRM 시스템', type: '성능', priority: 'high', assignee: '최유나', sla: '1일 남음', status: 'progress', slaClass: 'warning' },
    { no: 'ISS-08428', title: '문의 페이지 오타 수정', project: '마케팅 플랫폼', type: '문의', priority: 'low', assignee: '강동혁', sla: '5일 남음', status: 'open', slaClass: 'safe' },
    { no: 'ISS-08427', title: '보고서 PDF 다운로드 실패', project: 'ERP 구축', type: '버그', priority: 'high', assignee: '박지훈', sla: '지연', status: 'open', slaClass: 'danger' },
    { no: 'ISS-08426', title: '다국어 지원 추가 (영어)', project: 'AI챗봇', type: '기능', priority: 'normal', assignee: '김진호', sla: '3일 남음', status: 'progress', slaClass: 'safe' },
    { no: 'ISS-08425', title: '모바일 레이아웃 깨짐', project: '모바일 앱', type: '버그', priority: 'critical', assignee: '정민서', sla: '4h 남음', status: 'open', slaClass: 'danger' },
  ];

  const DEMO_RESOURCES = [
    { name: '김진호', role: 'PM · 풀스택', utilization: 85, projects: ['AI챗봇', 'MES'], level: 'high' },
    { name: '이수현', role: 'PM · 백엔드', utilization: 72, projects: ['쇼핑몰', '데이터레이크'], level: 'medium' },
    { name: '박지훈', role: '백엔드 리드', utilization: 95, projects: ['ERP', 'CRM'], level: 'high' },
    { name: '정민서', role: '프론트엔드', utilization: 60, projects: ['모바일 앱'], level: 'medium' },
    { name: '최유나', role: '풀스택', utilization: 78, projects: ['CRM', 'AI챗봇'], level: 'medium' },
    { name: '강동혁', role: 'DevOps', utilization: 45, projects: ['마케팅 플랫폼'], level: 'low' },
    { name: '윤서연', role: 'QA', utilization: 55, projects: ['쇼핑몰', 'ERP'], level: 'low' },
    { name: '한지우', role: '디자이너', utilization: 68, projects: ['모바일 앱', 'AI챗봇'], level: 'medium' },
  ];

  /* ============ 인증 ============ */
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
          'si-dash': '대시보드',
          'si-client': '고객사 (CRM)',
          'si-project': '프로젝트',
          'si-task': '업무 (WBS)',
          'si-invoice': '인보이스',
          'si-issue': '이슈 트래커',
          'si-resource': '리소스 관리',
        };
        const titleEl = document.getElementById('cmsSiPageTitle');
        if (titleEl) titleEl.textContent = titles[tab] || '함께워크_SI';

        if (tab === 'si-dash') renderDashboard();
        else if (tab === 'si-client') renderClients();
        else if (tab === 'si-project') renderProjects();
        else if (tab === 'si-task') renderKanban();
        else if (tab === 'si-invoice') renderInvoices();
        else if (tab === 'si-issue') renderIssues();
        else if (tab === 'si-resource') renderResources();
      });
    });
  }

  /* ============ 1. 대시보드 ============ */
  function renderDashboard() {
    /* 매출 차트 */
    const ctx1 = document.getElementById('siChartRevenue');
    if (ctx1 && typeof Chart !== 'undefined') {
      if (window._siChart1) window._siChart1.destroy();
      window._siChart1 = new Chart(ctx1, {
        type: 'bar',
        data: {
          labels: ['12월', '1월', '2월', '3월', '4월', '5월'],
          datasets: [
            {
              label: '매출',
              data: [85, 95, 102, 115, 108, 124],
              backgroundColor: '#c47a00',
              borderRadius: 6,
              barPercentage: 0.6,
            },
            {
              label: '수주',
              data: [120, 80, 140, 110, 150, 90],
              backgroundColor: '#e0a040',
              borderRadius: 6,
              barPercentage: 0.6,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'top', labels: { font: { size: 11 }, padding: 10, boxWidth: 12 } },
            tooltip: {
              callbacks: {
                label: c => `${c.dataset.label}: ₩${c.parsed.y}M`,
              },
            },
          },
          scales: {
            y: { beginAtZero: true, ticks: { font: { size: 11 }, callback: v => '₩' + v + 'M' } },
            x: { ticks: { font: { size: 11 } }, grid: { display: false } },
          },
        },
      });
    }

    /* 프로젝트 상태 차트 */
    const ctx2 = document.getElementById('siChartStatus');
    if (ctx2 && typeof Chart !== 'undefined') {
      if (window._siChart2) window._siChart2.destroy();
      const counts = {
        planning: DEMO_PROJECTS.filter(p => p.stage === 'planning').length,
        active: DEMO_PROJECTS.filter(p => p.stage === 'active').length,
        testing: DEMO_PROJECTS.filter(p => p.stage === 'testing').length,
        delivered: DEMO_PROJECTS.filter(p => p.stage === 'delivered').length,
        maintenance: DEMO_PROJECTS.filter(p => p.stage === 'maintenance').length,
      };
      window._siChart2 = new Chart(ctx2, {
        type: 'doughnut',
        data: {
          labels: ['기획', '진행', '테스트', '납품', '유지보수'],
          datasets: [{
            data: [counts.planning, counts.active, counts.testing, counts.delivered, counts.maintenance],
            backgroundColor: ['#8a8a8a', '#c47a00', '#1a5ec4', '#1a8b46', '#b8935a'],
            borderWidth: 0,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 12, boxWidth: 12 } },
          },
          cutout: '60%',
        },
      });
    }

    /* 진행 중 프로젝트 */
    const activeList = document.getElementById('activeProjects');
    if (activeList) {
      const active = DEMO_PROJECTS.filter(p => p.stage === 'active' || p.stage === 'testing').slice(0, 4);
      activeList.innerHTML = active.map(p => `
        <div class="cms-project-item">
          <div class="cms-project-item-head">
            <div class="cms-project-name">${escapeHtml(p.name)}</div>
            <div class="cms-project-code">${escapeHtml(p.code)}</div>
          </div>
          <div class="cms-project-meta">
            <span>🏢 <span class="client">${escapeHtml(p.client)}</span> · PM ${escapeHtml(p.pm)}</span>
            <span>~ ${escapeHtml(p.due)}</span>
          </div>
          <div class="cms-project-progress">
            <div class="cms-progress-bar">
              <div class="cms-progress-fill" style="width:${p.progress}%"></div>
            </div>
            <div class="cms-progress-label">${p.progress}%</div>
          </div>
        </div>
      `).join('');
    }

    /* 최근 이슈 */
    const issueList = document.getElementById('recentIssues');
    if (issueList) {
      const critical = DEMO_ISSUES.slice(0, 4);
      issueList.innerHTML = critical.map(i => `
        <div class="cms-issue-item">
          <div class="cms-issue-priority ${i.priority}"></div>
          <div class="cms-issue-body">
            <div class="cms-issue-title">${escapeHtml(i.title)}</div>
            <div class="cms-issue-meta">
              <span>🆔 ${escapeHtml(i.no)}</span>
              <span>👤 ${escapeHtml(i.assignee)}</span>
              <span class="cms-sla-indicator ${i.slaClass}">⏱️ ${escapeHtml(i.sla)}</span>
            </div>
          </div>
        </div>
      `).join('');
    }
  }

  /* ============ 2. 고객사 ============ */
  function renderClients() {
    const grid = document.getElementById('clientGrid');
    if (!grid) return;

    const statusMap = {
      active: { label: '거래 중', cls: 'active' },
      lead: { label: '잠재 고객', cls: 'lead' },
      closed: { label: '종료', cls: 'closed' },
    };

    grid.innerHTML = DEMO_CLIENTS.map(c => {
      const initial = c.name.charAt(c.name.indexOf(')') + 1) || c.name.charAt(0);
      const st = statusMap[c.status];
      return `
        <div class="cms-client-card">
          <div class="cms-client-head">
            <div class="cms-client-logo">${escapeHtml(initial)}</div>
            <div class="cms-client-info">
              <div class="cms-client-name">${escapeHtml(c.name)}</div>
              <div class="cms-client-contact">담당 · ${escapeHtml(c.contact)}</div>
            </div>
          </div>
          <div class="cms-client-stats">
            <div class="cms-client-stat">
              <span class="cms-client-stat-num">${c.projects}</span>
              <span class="cms-client-stat-label">프로젝트</span>
            </div>
            <div class="cms-client-stat">
              <span class="cms-client-stat-num">${c.active}</span>
              <span class="cms-client-stat-label">진행 중</span>
            </div>
            <div class="cms-client-stat">
              <span class="cms-client-stat-num">${c.total}M</span>
              <span class="cms-client-stat-label">누적 매출</span>
            </div>
          </div>
          <div class="cms-client-foot">
            <span>거래 시작 · ${escapeHtml(c.since)}</span>
            <span class="cms-client-status ${st.cls}">${st.label}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  /* ============ 3. 프로젝트 ============ */
  function renderProjects() {
    const tbody = document.getElementById('projectBody');
    if (!tbody) return;

    const stageMap = {
      planning: '<span class="cms-badge cms-b-mute">기획</span>',
      active: '<span class="cms-badge cms-b-warn">진행</span>',
      testing: '<span class="cms-badge cms-b-info">테스트</span>',
      delivered: '<span class="cms-badge cms-b-success">납품</span>',
      maintenance: '<span class="cms-badge cms-b-info">유지</span>',
    };

    tbody.innerHTML = DEMO_PROJECTS.map(p => `
      <tr>
        <td style="font-family:Inter;font-size:11px;color:#8a8a8a">${escapeHtml(p.code)}</td>
        <td><strong>${escapeHtml(p.name)}</strong></td>
        <td>${escapeHtml(p.client)}</td>
        <td>${escapeHtml(p.pm)}</td>
        <td>${stageMap[p.stage] || p.stage}</td>
        <td>
          <div style="display:flex;align-items:center;gap:8px">
            <div class="cms-progress-bar" style="flex:1;max-width:80px"><div class="cms-progress-fill" style="width:${p.progress}%"></div></div>
            <span style="font-family:Inter;font-size:11px;font-weight:700;color:#c47a00">${p.progress}%</span>
          </div>
        </td>
        <td style="font-family:Inter;font-weight:600">₩${(p.contract / 1000000).toFixed(0)}M</td>
        <td style="font-family:Inter;font-size:11.5px">${escapeHtml(p.due)}</td>
        <td>
          <button class="cms-btn-link">상세</button>
        </td>
      </tr>
    `).join('');
  }

  /* ============ 4. 칸반 ============ */
  function renderKanban() {
    Object.keys(DEMO_KANBAN).forEach(status => {
      const container = document.getElementById('kanban' + status.charAt(0).toUpperCase() + status.slice(1));
      if (!container) return;

      container.innerHTML = DEMO_KANBAN[status].map(card => `
        <div class="cms-kanban-card" data-card-id="${card.id}" draggable="true">
          <span class="cms-kanban-card-tag ${card.tag}">${card.tag.toUpperCase()}</span>
          <div class="cms-kanban-card-title">${escapeHtml(card.title)}</div>
          <div class="cms-kanban-card-foot">
            <div class="cms-kanban-assignees">
              ${card.assignees.map(a => `<span class="cms-kanban-avatar">${escapeHtml(a)}</span>`).join('')}
            </div>
            <span class="cms-kanban-card-date">📅 ${escapeHtml(card.date)}</span>
          </div>
        </div>
      `).join('');
    });

    /* 드래그앤드롭 (간단 구현) */
    let draggedCard = null;

    document.querySelectorAll('.cms-kanban-card').forEach(card => {
      card.addEventListener('dragstart', e => {
        draggedCard = card;
        card.style.opacity = '0.5';
      });
      card.addEventListener('dragend', e => {
        card.style.opacity = '';
        draggedCard = null;
      });
      card.addEventListener('click', () => {
        toast(`카드 #${card.dataset.cardId} 상세 (데모)`);
      });
    });

    document.querySelectorAll('.cms-kanban-cards').forEach(col => {
      col.addEventListener('dragover', e => {
        e.preventDefault();
        col.style.background = 'rgba(196,122,0,0.05)';
      });
      col.addEventListener('dragleave', e => {
        col.style.background = '';
      });
      col.addEventListener('drop', e => {
        e.preventDefault();
        col.style.background = '';
        if (draggedCard) {
          col.appendChild(draggedCard);
          toast('카드가 이동되었습니다 (데모 - 저장되지 않음)');
        }
      });
    });
  }

  /* ============ 5. 인보이스 ============ */
  function renderInvoices() {
    const tbody = document.getElementById('invoiceBody');
    if (!tbody) return;

    const statusMap = {
      paid: { label: '✓ 수금완료', cls: 'paid' },
      pending: { label: '⏳ 대기중', cls: 'pending' },
      overdue: { label: '🚨 연체', cls: 'overdue' },
      draft: { label: '📝 초안', cls: 'draft' },
    };

    tbody.innerHTML = DEMO_INVOICES.map(i => {
      const st = statusMap[i.status];
      return `
        <tr>
          <td style="font-family:Inter;font-size:11.5px;font-weight:600">${escapeHtml(i.no)}</td>
          <td style="font-family:Inter;font-size:11.5px">${escapeHtml(i.date)}</td>
          <td><strong>${escapeHtml(i.client)}</strong></td>
          <td style="font-size:11.5px">${escapeHtml(i.project)}</td>
          <td style="font-family:Inter;font-weight:700;color:#0f0f0f">₩${i.amount.toLocaleString()}</td>
          <td style="font-family:Inter;font-size:11.5px">${escapeHtml(i.due)}</td>
          <td><span class="cms-invoice-status ${st.cls}">${st.label}</span></td>
          <td>
            <button class="cms-btn-link">PDF</button>
            <button class="cms-btn-link">수정</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  /* ============ 6. 이슈 ============ */
  function renderIssues() {
    const tbody = document.getElementById('issueBody');
    if (!tbody) return;

    const priorityMap = {
      critical: '<span class="cms-issue-priority-badge critical">🔴 긴급</span>',
      high: '<span class="cms-issue-priority-badge high">🟠 높음</span>',
      normal: '<span class="cms-issue-priority-badge normal">🟡 보통</span>',
      low: '<span class="cms-issue-priority-badge low">🔵 낮음</span>',
    };
    const statusMap = {
      open: '<span class="cms-badge cms-b-warn">오픈</span>',
      progress: '<span class="cms-badge cms-b-info">진행</span>',
      resolved: '<span class="cms-badge cms-b-success">해결</span>',
      closed: '<span class="cms-badge cms-b-mute">종료</span>',
    };

    tbody.innerHTML = DEMO_ISSUES.map(i => `
      <tr>
        <td style="font-family:Inter;font-size:11px;color:#8a8a8a">${escapeHtml(i.no)}</td>
        <td><strong style="font-size:12.5px">${escapeHtml(i.title)}</strong></td>
        <td style="font-size:11.5px">${escapeHtml(i.project)}</td>
        <td>${escapeHtml(i.type)}</td>
        <td>${priorityMap[i.priority] || i.priority}</td>
        <td>${escapeHtml(i.assignee)}</td>
        <td><span class="cms-sla-indicator ${i.slaClass}">⏱ ${escapeHtml(i.sla)}</span></td>
        <td>${statusMap[i.status] || i.status}</td>
      </tr>
    `).join('');
  }

  /* ============ 7. 리소스 ============ */
  function renderResources() {
    const grid = document.getElementById('resourceGrid');
    if (!grid) return;

    grid.innerHTML = DEMO_RESOURCES.map(r => `
      <div class="cms-resource-card">
        <div class="cms-resource-head">
          <div class="cms-resource-avatar">${escapeHtml(r.name.charAt(0))}</div>
          <div class="cms-resource-info">
            <div class="cms-resource-name">${escapeHtml(r.name)}</div>
            <div class="cms-resource-role">${escapeHtml(r.role)}</div>
          </div>
        </div>
        <div class="cms-resource-util">
          <div class="cms-util-label">
            <span>가동률</span>
            <strong>${r.utilization}%</strong>
          </div>
          <div class="cms-util-bar">
            <div class="cms-util-fill ${r.level}" style="width:${r.utilization}%"></div>
          </div>
        </div>
        <div class="cms-resource-projects">
          <strong>참여 프로젝트:</strong><br />
          ${r.projects.map(p => escapeHtml(p)).join(', ')}
        </div>
      </div>
    `).join('');

    /* 공수 차트 */
    const ctx = document.getElementById('siChartManHour');
    if (ctx && typeof Chart !== 'undefined') {
      if (window._siChart3) window._siChart3.destroy();
      window._siChart3 = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: DEMO_RESOURCES.map(r => r.name),
          datasets: [{
            label: '가동률 (%)',
            data: DEMO_RESOURCES.map(r => r.utilization),
            backgroundColor: DEMO_RESOURCES.map(r => 
              r.level === 'high' ? '#c5293a' : 
              r.level === 'medium' ? '#c47a00' : 
              '#1a8b46'
            ),
            borderRadius: 6,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: c => `가동률: ${c.parsed.y}%`,
              },
            },
          },
          scales: {
            y: { 
              beginAtZero: true, 
              max: 100,
              ticks: { font: { size: 11 }, callback: v => v + '%' } 
            },
            x: { ticks: { font: { size: 11 } }, grid: { display: false } },
          },
        },
      });
    }
  }

  /* ============ 초기화 ============ */
  async function init() {
    const auth = await checkAuth();
    if (!auth) return;

    const nameEl = document.getElementById('cmsSiUserName');
    const avatarEl = document.getElementById('cmsSiAvatar');
    if (nameEl && auth.admin.name) nameEl.textContent = auth.admin.name + '님';
    if (avatarEl && auth.admin.name) avatarEl.textContent = auth.admin.name.charAt(0);

    setupTabs();
    renderDashboard();
    
    toast('⚠️ DEMO 모드로 실행 중입니다', 3000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();