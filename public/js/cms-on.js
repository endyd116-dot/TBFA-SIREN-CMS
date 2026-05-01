/* =========================================================
   SIREN — CMS ON (공유오피스 + 스터디카페)
   데모 데이터 기반
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

  function toast(msg, ms = 2400) {
    const t = document.getElementById('cmsOnToast');
    if (!t) return alert(msg);
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(window._onT);
    window._onT = setTimeout(() => t.classList.remove('show'), ms);
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
    );
  }

  function formatTime(h, m = 0) {
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  }

  /* ============ 데모 데이터 ============ */
  const DEMO_SPACES = [
    { id: 1, name: '회의실 A', type: 'meeting', capacity: 8, status: 'available', rate: 15000, branch: 'gn' },
    { id: 2, name: '회의실 B', type: 'meeting', capacity: 12, status: 'occupied', rate: 25000, branch: 'gn' },
    { id: 3, name: '회의실 C', type: 'meeting', capacity: 4, status: 'available', rate: 10000, branch: 'gn' },
    { id: 4, name: '1인실 101', type: 'private', capacity: 1, status: 'occupied', rate: 5000, branch: 'gn' },
    { id: 5, name: '1인실 102', type: 'private', capacity: 1, status: 'available', rate: 5000, branch: 'gn' },
    { id: 6, name: '1인실 103', type: 'private', capacity: 1, status: 'maintenance', rate: 5000, branch: 'gn' },
    { id: 7, name: '스터디존 A구역', type: 'study', capacity: 30, status: 'available', rate: 3000, branch: 'gn' },
    { id: 8, name: '스터디존 B구역', type: 'study', capacity: 30, status: 'occupied', rate: 3000, branch: 'gn' },
    { id: 9, name: '오픈데스크 1층', type: 'desk', capacity: 20, status: 'available', rate: 8000, branch: 'gn' },
    { id: 10, name: '오픈데스크 2층', type: 'desk', capacity: 20, status: 'available', rate: 8000, branch: 'gn' },
  ];

  const DEMO_MEMBERS = [
    { id: 1, name: '김개인', phone: '010-1234-5678', plan: '월정기', expire: '2026-06-15', usage: 42, status: 'active' },
    { id: 2, name: '이학생', phone: '010-2345-6789', plan: '주간권', expire: '2026-05-10', usage: 8, status: 'active' },
    { id: 3, name: '박프리', phone: '010-3456-7890', plan: '월정기', expire: '2026-05-20', usage: 65, status: 'active' },
    { id: 4, name: '최일일', phone: '010-4567-8901', plan: '일일권', expire: '2026-05-01', usage: 1, status: 'expired' },
    { id: 5, name: '정직장', phone: '010-5678-9012', plan: '연정기', expire: '2027-03-15', usage: 120, status: 'active' },
    { id: 6, name: '강학습', phone: '010-6789-0123', plan: '스터디_월', expire: '2026-05-30', usage: 28, status: 'active' },
    { id: 7, name: '윤미들', phone: '010-7890-1234', plan: '월정기', expire: '2026-06-01', usage: 52, status: 'active' },
  ];

  const DEMO_CORPS = [
    { id: 1, name: '(주)테크스타트', type: '법인', employees: 8, desks: 8, contract: '연 계약', expire: '2026-12-31', monthly: 1600000 },
    { id: 2, name: 'AI솔루션즈', type: '법인', employees: 15, desks: 15, contract: '연 계약', expire: '2026-10-15', monthly: 3000000 },
    { id: 3, name: '김프리랜서', type: '개인사업자', employees: 1, desks: 1, contract: '월 단위', expire: '2026-06-30', monthly: 200000 },
    { id: 4, name: '(주)크리에이티브랩', type: '법인', employees: 6, desks: 8, contract: '연 계약', expire: '2027-01-20', monthly: 1500000 },
    { id: 5, name: '디자인스튜디오', type: '법인', employees: 4, desks: 4, contract: '월 단위', expire: '2026-05-31', monthly: 800000 },
  ];

  const DEMO_PLANS = [
    { id: 1, name: '일일권', desc: '1일 자유 이용', price: 15000, period: '1일', features: ['오픈 데스크', '와이파이', '음료 무제한'], icon: '☀️', featured: false },
    { id: 2, name: '주간권', desc: '7일 이용권', price: 80000, period: '7일', features: ['오픈 데스크', '회의실 3시간', '사물함', '음료'], icon: '📅', featured: false },
    { id: 3, name: '월정기', desc: '매일 이용 가능', price: 280000, period: '30일', features: ['지정 데스크', '회의실 12시간', '사물함', '우편함', '주차 10시간'], icon: '🏢', featured: true },
    { id: 4, name: '연정기', desc: '1년 장기 할인', price: 2800000, period: '365일', features: ['지정 데스크', '회의실 무제한', 'VIP 사물함', '우편함', '주차 무제한'], icon: '💎', featured: false },
    { id: 5, name: '스터디_일', desc: '스터디존 1일', price: 8000, period: '1일', features: ['스터디 좌석', '와이파이'], icon: '📚', featured: false },
    { id: 6, name: '스터디_월', desc: '스터디 정기권', price: 120000, period: '30일', features: ['스터디 좌석', '와이파이', '사물함', '음료'], icon: '📖', featured: false },
  ];

  const DEMO_TICKETS = [
    { no: 'T-20260501-001', member: '김개인', product: '월정기', period: '2026.05.01 ~ 05.31', remain: '18일', status: 'active' },
    { no: 'T-20260428-032', member: '이학생', product: '주간권', period: '2026.04.28 ~ 05.04', remain: '2일', status: 'active' },
    { no: 'T-20260425-028', member: '박프리', product: '월정기', period: '2026.04.25 ~ 05.24', remain: '13일', status: 'active' },
    { no: 'T-20260430-045', member: '최일일', product: '일일권', period: '2026.04.30', remain: '종료', status: 'expired' },
    { no: 'T-20260315-012', member: '정직장', product: '연정기', period: '2026.03.15 ~ 2027.03.14', remain: '318일', status: 'active' },
  ];

  const DEMO_PAYMENTS = [
    { time: '2026-05-12 14:23', member: '김개인', product: '월정기', amount: 280000, method: '카드', status: 'completed' },
    { time: '2026-05-12 10:45', member: '(주)테크스타트', product: '법인 데스크 x8', amount: 1600000, method: '세금계산서', status: 'pending' },
    { time: '2026-05-11 16:12', member: '이학생', product: '주간권', amount: 80000, method: '카드', status: 'completed' },
    { time: '2026-05-11 09:30', member: '박프리', product: '회의실 B (3h)', amount: 75000, method: '카드', status: 'completed' },
    { time: '2026-05-10 18:45', member: '최일일', product: '일일권', amount: 15000, method: '카드', status: 'failed' },
    { time: '2026-05-10 11:20', member: 'AI솔루션즈', product: '법인 데스크 x15', amount: 3000000, method: '계좌이체', status: 'completed' },
  ];

  const DEMO_ACCESS = [
    { time: '14:32', member: '김개인', location: '메인 게이트', direction: 'in', method: 'QR' },
    { time: '14:28', member: '이학생', location: '스터디존', direction: 'in', method: 'NFC' },
    { time: '14:25', member: '박프리', location: '오피스존', direction: 'out', method: 'QR' },
    { time: '14:20', member: '정직장', location: '메인 게이트', direction: 'in', method: 'QR' },
    { time: '14:15', member: '강학습', location: '스터디존', direction: 'out', method: 'NFC' },
    { time: '14:10', member: '윤미들', location: '메인 게이트', direction: 'in', method: 'QR' },
    { time: '14:05', member: '김개인', location: '회의실 A', direction: 'in', method: '지문' },
    { time: '13:55', member: '(주)테크스타트 홍실장', location: '오피스존', direction: 'in', method: 'QR' },
  ];

  const DEMO_TODAY_RESERVE = [
    { time: '09:00-11:00', space: '회의실 A', member: '김개인', status: 'done' },
    { time: '10:00-12:00', space: '1인실 102', member: '박프리', status: 'active' },
    { time: '13:00-15:00', space: '회의실 B', member: '(주)AI솔루션즈', status: 'active' },
    { time: '14:00-16:00', space: '회의실 C', member: '정직장', status: 'upcoming' },
    { time: '16:00-18:00', space: '회의실 A', member: '디자인스튜디오', status: 'upcoming' },
  ];

  /* ============ 상태 ============ */
  let currentMonth = new Date();
  let currentSubTab = 'indiv';

  /* ============ 인증 확인 ============ */
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
          dash: '대시보드',
          space: '공간 관리',
          reserve: '예약 / 이용권',
          seat: '좌석 현황',
          member: '회원 / 입주사',
          plan: '멤버십 플랜',
          payment: '결제 / 정산',
          access: '출입 로그',
        };
        const titleEl = document.getElementById('cmsOnPageTitle');
        if (titleEl) titleEl.textContent = titles[tab] || '함께워크_ON';

        /* 탭별 렌더 */
        if (tab === 'dash') renderDashboard();
        else if (tab === 'space') renderSpaces();
        else if (tab === 'reserve') renderCalendar();
        else if (tab === 'seat') renderSeats();
        else if (tab === 'member') renderMembers();
        else if (tab === 'plan') renderPlans();
        else if (tab === 'payment') renderPayments();
        else if (tab === 'access') renderAccess();
      });
    });

    /* 서브탭 (회원/입주사) */
    document.querySelectorAll('.cms-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const sub = btn.dataset.subtab;
        document.querySelectorAll('.cms-tab-btn').forEach(x => x.classList.remove('on'));
        btn.classList.add('on');
        document.querySelectorAll('.cms-subpage').forEach(p => p.classList.remove('show'));
        document.querySelector(`.cms-subpage[data-subpage="${sub}"]`)?.classList.add('show');
        currentSubTab = sub;
        if (sub === 'corp') renderCorps();
        else renderMembers();
      });
    });
  }

  /* ============ 1. 대시보드 ============ */
  function renderDashboard() {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('onKpiRevenue', '₩ 84.2M');
    set('onKpiOccupancy', '72%');
    set('onKpiMembers', (DEMO_MEMBERS.length + DEMO_CORPS.reduce((a,c)=>a+c.employees,0)) + '명');
    set('onKpiReserve', DEMO_TODAY_RESERVE.length + '건');

    /* 매출 차트 */
    const ctx = document.getElementById('onChartRevenue');
    if (ctx && typeof Chart !== 'undefined') {
      if (window._onChart1) window._onChart1.destroy();
      window._onChart1 = new Chart(ctx, {
        type: 'line',
        data: {
          labels: ['6월','7월','8월','9월','10월','11월','12월','1월','2월','3월','4월','5월'],
          datasets: [
            {
              label: '공유오피스',
              data: [52,58,62,65,68,72,78,82,85,80,82,84],
              borderColor: '#1a8b46',
              backgroundColor: 'rgba(26,139,70,0.08)',
              tension: 0.35, fill: true, borderWidth: 2,
            },
            {
              label: '스터디카페',
              data: [18,20,22,25,28,30,35,38,40,42,44,48],
              borderColor: '#c47a00',
              backgroundColor: 'rgba(196,122,0,0.08)',
              tension: 0.35, fill: true, borderWidth: 2,
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
                label: ctx => `${ctx.dataset.label}: ₩${ctx.parsed.y}M`,
              },
            },
          },
          scales: {
            y: { beginAtZero: true, ticks: { font: { size: 11 }, callback: v => '₩' + v + 'M' } },
            x: { ticks: { font: { size: 11 } } },
          },
        },
      });
    }

    /* 오늘 예약 */
    const reserveBody = document.getElementById('todayReserveBody');
    if (reserveBody) {
      reserveBody.innerHTML = DEMO_TODAY_RESERVE.map(r => {
        const statusMap = {
          done: '<span class="cms-badge cms-b-mute">완료</span>',
          active: '<span class="cms-badge cms-b-success">● 이용 중</span>',
          upcoming: '<span class="cms-badge cms-b-info">예정</span>',
        };
        return `<tr>
          <td style="font-family:Inter;font-weight:600">${escapeHtml(r.time)}</td>
          <td>${escapeHtml(r.space)}</td>
          <td>${escapeHtml(r.member)}</td>
          <td>${statusMap[r.status] || r.status}</td>
        </tr>`;
      }).join('');
    }

    /* 출입 로그 */
    const accessBody = document.getElementById('recentAccessBody');
    if (accessBody) {
      accessBody.innerHTML = DEMO_ACCESS.slice(0, 6).map(a => `
        <tr>
          <td style="font-family:Inter;font-weight:600">${escapeHtml(a.time)}</td>
          <td>${escapeHtml(a.member)}</td>
          <td style="font-size:11.5px;color:#525252">${escapeHtml(a.location)}</td>
          <td>${a.direction === 'in' ? '<span style="color:#1a8b46">→ 입장</span>' : '<span style="color:#c5293a">← 퇴장</span>'}</td>
        </tr>
      `).join('');
    }
  }

  /* ============ 2. 공간 관리 ============ */
  function renderSpaces() {
    const grid = document.getElementById('spaceGrid');
    if (!grid) return;

    const typeFilter = document.getElementById('spaceTypeFilter')?.value || '';
    const search = (document.getElementById('spaceSearch')?.value || '').toLowerCase();

    let filtered = DEMO_SPACES;
    if (typeFilter) filtered = filtered.filter(s => s.type === typeFilter);
    if (search) filtered = filtered.filter(s => s.name.toLowerCase().includes(search));

    const typeMap = {
      meeting: { label: '회의실', icon: '🪑' },
      private: { label: '1인실', icon: '🚪' },
      study: { label: '스터디', icon: '📚' },
      desk: { label: '오픈데스크', icon: '💻' },
    };
    const statusMap = {
      available: { label: '이용 가능', cls: 'available' },
      occupied: { label: '사용 중', cls: 'occupied' },
      maintenance: { label: '점검 중', cls: 'maintenance' },
    };

    grid.innerHTML = filtered.map(s => {
      const t = typeMap[s.type] || { label: s.type, icon: '🏢' };
      const st = statusMap[s.status];
      return `
        <div class="cms-space-card" data-space-id="${s.id}">
          <div class="cms-space-card-head">
            <div class="cms-space-icon">${t.icon}</div>
            <div class="cms-space-status ${st.cls}">● ${st.label}</div>
          </div>
          <h4>${escapeHtml(s.name)}</h4>
          <div class="cms-space-card-sub">${t.label} · 수용인원 ${s.capacity}명</div>
          <div class="cms-space-card-meta">
            <span>💰 ₩${s.rate.toLocaleString()}/시간</span>
            <span>📍 강남점</span>
          </div>
        </div>
      `;
    }).join('');

    grid.querySelectorAll('.cms-space-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.dataset.spaceId;
        toast(`공간 #${id} 상세 보기 (데모)`);
      });
    });
  }

  function setupSpaceFilters() {
    document.getElementById('spaceTypeFilter')?.addEventListener('change', renderSpaces);
    document.getElementById('spaceSearch')?.addEventListener('input', renderSpaces);
    document.getElementById('btnAddSpace')?.addEventListener('click', () => {
      toast('공간 추가 기능 (데모)');
    });
  }

  /* ============ 3. 예약 달력 ============ */
  function renderCalendar() {
    const grid = document.getElementById('calendarGrid');
    const monthLabel = document.getElementById('calMonth');
    if (!grid) return;

    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    if (monthLabel) monthLabel.textContent = `${year}년 ${month + 1}월`;

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date();
    const isThisMonth = today.getFullYear() === year && today.getMonth() === month;

    let html = `
      <div class="cms-cal-header sunday">일</div>
      <div class="cms-cal-header">월</div>
      <div class="cms-cal-header">화</div>
      <div class="cms-cal-header">수</div>
      <div class="cms-cal-header">목</div>
      <div class="cms-cal-header">금</div>
      <div class="cms-cal-header saturday">토</div>
    `;

    /* 이전 달 여백 */
    for (let i = 0; i < firstDay; i++) {
      html += `<div class="cms-cal-day other-month"></div>`;
    }

    /* 이번 달 */
    for (let d = 1; d <= daysInMonth; d++) {
      const isToday = isThisMonth && today.getDate() === d;
      const dow = new Date(year, month, d).getDay();
      const dayClass = isToday ? 'today' : '';

      /* 데모 이벤트 (특정 일에만) */
      let events = '';
      if (d === 8) events += `<div class="cms-cal-event meeting">10시 회의실A</div>`;
      if (d === 8) events += `<div class="cms-cal-event private">14시 1인실</div>`;
      if (d === 12) events += `<div class="cms-cal-event meeting">09시 회의실B</div>`;
      if (d === 15) events += `<div class="cms-cal-event study">스터디 종일</div>`;
      if (d === 20) events += `<div class="cms-cal-event private">11시 1인실103</div>`;
      if (d === 25) events += `<div class="cms-cal-event meeting">15시 회의실A</div>`;

      const dateColor = dow === 0 ? 'color:#c5293a' : dow === 6 ? 'color:#1a5ec4' : '';
      html += `
        <div class="cms-cal-day ${dayClass}" data-date="${d}">
          <div class="cms-cal-date" style="${dateColor}">${d}</div>
          <div class="cms-cal-events">${events}</div>
        </div>
      `;
    }

    grid.innerHTML = html;

    /* 이용권 목록 */
    const ticketBody = document.getElementById('ticketBody');
    if (ticketBody) {
      ticketBody.innerHTML = DEMO_TICKETS.map(t => {
        const statusMap = {
          active: '<span class="cms-badge cms-b-success">활성</span>',
          expired: '<span class="cms-badge cms-b-mute">만료</span>',
        };
        return `<tr>
          <td style="font-family:Inter;font-size:11px">${escapeHtml(t.no.split('-').slice(0,2).join('-'))}</td>
          <td style="font-family:Inter;font-size:11px">${escapeHtml(t.no.split('-')[2])}</td>
          <td><strong>${escapeHtml(t.member)}</strong></td>
          <td>${escapeHtml(t.product)}</td>
          <td style="font-size:11.5px;color:#525252">${escapeHtml(t.period)}</td>
          <td style="font-family:Inter;font-weight:600">${escapeHtml(t.remain)}</td>
          <td>${statusMap[t.status]}</td>
        </tr>`;
      }).join('');
    }
  }

  function setupCalendar() {
    document.getElementById('calPrev')?.addEventListener('click', () => {
      currentMonth.setMonth(currentMonth.getMonth() - 1);
      renderCalendar();
    });
    document.getElementById('calNext')?.addEventListener('click', () => {
      currentMonth.setMonth(currentMonth.getMonth() + 1);
      renderCalendar();
    });
    document.getElementById('btnNewReserve')?.addEventListener('click', () => {
      toast('새 예약 등록 (데모)');
    });
    document.getElementById('btnIssueTicket')?.addEventListener('click', () => {
      toast('이용권 발급 (데모)');
    });
  }

  /* ============ 4. 좌석 현황 ============ */
  function renderSeats() {
    const layout = document.getElementById('seatLayout');
    if (!layout) return;

    const timeEl = document.getElementById('seatUpdateTime');
    if (timeEl) {
      const now = new Date();
      timeEl.textContent = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    }

    const makeSeats = (prefix, count, statuses) => {
      let html = '';
      for (let row = 0; row < Math.ceil(count / 10); row++) {
        html += '<div class="cms-seat-row">';
        for (let col = 0; col < 10 && row * 10 + col < count; col++) {
          const idx = row * 10 + col;
          const num = idx + 1;
          const status = statuses[idx] || 'empty';
          html += `<div class="cms-seat ${status}" data-seat="${prefix}${num}" title="${prefix}${num} — ${status}">${num}</div>`;
        }
        html += '</div>';
      }
      return html;
    };

    /* 랜덤 상태 */
    const randomStatus = (count) => {
      const arr = [];
      for (let i = 0; i < count; i++) {
        const r = Math.random();
        arr.push(r < 0.4 ? 'occupied' : r < 0.55 ? 'reserved' : r < 0.6 ? 'maintenance' : 'empty');
      }
      return arr;
    };

    layout.innerHTML = `
      <div class="cms-seat-zone">
        <h4>📚 스터디존 A <span>${30}석</span></h4>
        ${makeSeats('A', 30, randomStatus(30))}
      </div>
      <div class="cms-seat-zone">
        <h4>📚 스터디존 B <span>${30}석</span></h4>
        ${makeSeats('B', 30, randomStatus(30))}
      </div>
      <div class="cms-seat-zone">
        <h4>💻 오픈 데스크 1F <span>${20}석</span></h4>
        ${makeSeats('D1-', 20, randomStatus(20))}
      </div>
      <div class="cms-seat-zone">
        <h4>💻 오픈 데스크 2F <span>${20}석</span></h4>
        ${makeSeats('D2-', 20, randomStatus(20))}
      </div>
    `;

    /* 좌석 클릭 */
    layout.querySelectorAll('.cms-seat').forEach(s => {
      s.addEventListener('click', () => {
        const no = s.dataset.seat;
        const status = s.className.replace('cms-seat ', '').trim() || 'empty';
        toast(`좌석 ${no} — ${status === 'occupied' ? '사용 중' : status === 'reserved' ? '예약됨' : status === 'maintenance' ? '점검 중' : '빈 좌석'}`);
      });
    });
  }

  function setupSeatRefresh() {
    document.getElementById('btnSeatRefresh')?.addEventListener('click', () => {
      renderSeats();
      toast('좌석 현황이 갱신되었습니다');
    });
  }

  /* ============ 5. 회원 / 입주사 ============ */
  function renderMembers() {
    const tbody = document.getElementById('onMemberBody');
    if (!tbody) return;

    tbody.innerHTML = DEMO_MEMBERS.map(m => {
      const statusMap = {
        active: '<span class="cms-badge cms-b-success">활성</span>',
        expired: '<span class="cms-badge cms-b-mute">만료</span>',
      };
      return `<tr>
        <td>M-${String(m.id).padStart(4,'0')}</td>
        <td><strong>${escapeHtml(m.name)}</strong></td>
        <td><span class="cms-badge cms-b-info">${escapeHtml(m.plan)}</span></td>
        <td style="font-family:Inter;font-size:11.5px">${escapeHtml(m.expire)}</td>
        <td style="font-family:Inter;font-weight:600">${m.usage}회</td>
        <td style="font-family:Inter;font-size:11.5px">${escapeHtml(m.phone)}</td>
        <td>
          <button class="cms-btn-link">상세</button>
          <button class="cms-btn-link">연장</button>
        </td>
      </tr>`;
    }).join('');
  }

  function renderCorps() {
    const grid = document.getElementById('corpGrid');
    if (!grid) return;

    grid.innerHTML = DEMO_CORPS.map(c => {
      const initial = c.name.charAt(c.name.indexOf(')') + 1) || c.name.charAt(0);
      return `
        <div class="cms-corp-card">
          <div class="cms-corp-head">
            <div class="cms-corp-logo">${escapeHtml(initial)}</div>
            <div class="cms-corp-info">
              <div class="cms-corp-name">${escapeHtml(c.name)}</div>
              <div class="cms-corp-type">${escapeHtml(c.type)} · 임직원 ${c.employees}명</div>
            </div>
          </div>
          <div class="cms-corp-body">
            <div>계약 형태: <strong>${escapeHtml(c.contract)}</strong></div>
            <div>사용 데스크: <strong>${c.desks}석</strong></div>
            <div>월 이용료: <strong>₩${c.monthly.toLocaleString()}</strong></div>
            <div>만료일: <strong>${escapeHtml(c.expire)}</strong></div>
          </div>
          <div class="cms-corp-foot">
            <span>계약서 1건</span>
            <button class="cms-btn-link">상세</button>
          </div>
        </div>
      `;
    }).join('');
  }

  /* ============ 6. 멤버십 플랜 ============ */
  function renderPlans() {
    const grid = document.getElementById('planGrid');
    if (!grid) return;

    grid.innerHTML = DEMO_PLANS.map(p => `
      <div class="cms-plan-card ${p.featured ? 'featured' : ''}">
        <div class="cms-plan-icon">${p.icon}</div>
        <h4>${escapeHtml(p.name)}</h4>
        <div class="cms-plan-desc">${escapeHtml(p.desc)}</div>
        <div class="cms-plan-price">₩${p.price.toLocaleString()}</div>
        <div class="cms-plan-period">${escapeHtml(p.period)}</div>
        <ul class="cms-plan-features">
          ${p.features.map(f => `<li>${escapeHtml(f)}</li>`).join('')}
        </ul>
      </div>
    `).join('');

    document.getElementById('btnAddPlan')?.addEventListener('click', () => {
      toast('플랜 추가 기능 (데모)');
    });
  }

  /* ============ 7. 결제 ============ */
  function renderPayments() {
    const tbody = document.getElementById('paymentBody');
    if (!tbody) return;

    tbody.innerHTML = DEMO_PAYMENTS.map(p => {
      const statusMap = {
        completed: '<span class="cms-badge cms-b-success">완료</span>',
        pending: '<span class="cms-badge cms-b-warn">대기</span>',
        failed: '<span class="cms-badge cms-b-danger">실패</span>',
      };
      return `<tr>
        <td style="font-family:Inter;font-size:11.5px">${escapeHtml(p.time)}</td>
        <td><strong>${escapeHtml(p.member)}</strong></td>
        <td style="font-size:11.5px">${escapeHtml(p.product)}</td>
        <td style="font-family:Inter;font-weight:600">₩${p.amount.toLocaleString()}</td>
        <td>${escapeHtml(p.method)}</td>
        <td>${statusMap[p.status] || p.status}</td>
        <td><button class="cms-btn-link">발급</button></td>
      </tr>`;
    }).join('');
  }

  /* ============ 8. 출입 ============ */
  function renderAccess() {
    const tbody = document.getElementById('accessBody');
    if (!tbody) return;

    tbody.innerHTML = DEMO_ACCESS.map(a => `
      <tr>
        <td style="font-family:Inter;font-weight:600">2026.05.12 ${escapeHtml(a.time)}</td>
        <td><strong>${escapeHtml(a.member)}</strong></td>
        <td style="font-size:11.5px">${escapeHtml(a.location)}</td>
        <td>${a.direction === 'in' ? '<span style="color:#1a8b46;font-weight:600">→ 입장</span>' : '<span style="color:#c5293a;font-weight:600">← 퇴장</span>'}</td>
        <td><span class="cms-badge cms-b-info">${escapeHtml(a.method)}</span></td>
        <td style="font-size:11px;color:#8a8a8a">정상</td>
      </tr>
    `).join('');

    /* 오늘 날짜 기본 세팅 */
    const dateInp = document.getElementById('accessDate');
    if (dateInp && !dateInp.value) {
      dateInp.value = new Date().toISOString().slice(0, 10);
    }
  }

  /* ============ 초기화 ============ */
  async function init() {
    const auth = await checkAuth();
    if (!auth) return;

    const nameEl = document.getElementById('cmsOnUserName');
    const avatarEl = document.getElementById('cmsOnAvatar');
    if (nameEl && auth.admin.name) nameEl.textContent = auth.admin.name + '님';
    if (avatarEl && auth.admin.name) avatarEl.textContent = auth.admin.name.charAt(0);

    setupTabs();
    setupSpaceFilters();
    setupCalendar();
    setupSeatRefresh();

    /* 지점 변경 */
    document.getElementById('branchSelector')?.addEventListener('change', e => {
      toast(`지점 변경: ${e.target.options[e.target.selectedIndex].text}`);
      renderDashboard();
    });

    /* 초기 렌더 */
    renderDashboard();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();