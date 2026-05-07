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

  /* ============ 데모 데이터 ============ */
  const DEMO_MEMBERS = [
    { id: 1, name: '김유족', phone: '010-1111-2222', email: 'family1@test.com', type: 'family', source: 'excel', tags: ['유족1기', '서울'], createdAt: '2025-01-15' },
    { id: 2, name: '이후원', phone: '010-3333-4444', email: 'donor1@test.com', type: 'donor', source: 'web', tags: ['월정기', '50,000원'], createdAt: '2025-03-20' },
    { id: 3, name: '박봉사', phone: '010-5555-6666', email: 'vol1@test.com', type: 'volunteer', source: 'manual', tags: ['심리상담사'], createdAt: '2025-02-10' },
    { id: 4, name: '최일반', phone: '010-7777-8888', email: '', type: 'regular', source: 'excel', tags: ['경기'], createdAt: '2024-12-05' },
    { id: 5, name: '정유족', phone: '010-9999-0000', email: 'family2@test.com', type: 'family', source: 'manual', tags: ['유족2기', '부산'], createdAt: '2025-04-01' },
    { id: 6, name: '한후원', phone: '010-1234-5678', email: 'donor2@test.com', type: 'donor', source: 'web', tags: ['연정기', '100,000원'], createdAt: '2025-05-12' },
    { id: 7, name: '강봉사', phone: '010-8765-4321', email: 'vol2@test.com', type: 'volunteer', source: 'manual', tags: ['변호사'], createdAt: '2025-01-08' },
  ];

  const DEMO_WEB_DONORS = [
    { id: 101, name: '웹후원자A', email: 'wd1@test.com', phone: '010-2222-1111', totalAmount: 150000, type: 'regular', firstDonation: '2025-03-10', transferred: false },
    { id: 102, name: '웹후원자B', email: 'wd2@test.com', phone: '010-4444-3333', totalAmount: 50000, type: 'onetime', firstDonation: '2025-04-15', transferred: false },
    { id: 103, name: '웹후원자C', email: 'wd3@test.com', phone: '010-6666-5555', totalAmount: 300000, type: 'regular', firstDonation: '2025-02-22', transferred: false },
    { id: 104, name: '웹후원자D', email: 'wd4@test.com', phone: '010-8888-7777', totalAmount: 100000, type: 'onetime', firstDonation: '2025-05-01', transferred: false },
  ];

  const DEMO_TAGS = [
    { name: '유족1기', count: 15, category: 'family' },
    { name: '유족2기', count: 8, category: 'family' },
    { name: '유족3기', count: 12, category: 'family' },
    { name: '월정기', count: 42, category: 'donation' },
    { name: '연정기', count: 18, category: 'donation' },
    { name: '서울', count: 35, category: 'region' },
    { name: '경기', count: 22, category: 'region' },
    { name: '부산', count: 11, category: 'region' },
    { name: '심리상담사', count: 6, category: 'volunteer' },
    { name: '변호사', count: 4, category: 'volunteer' },
  ];

  /* 상태 */
  let allMembers = [...DEMO_MEMBERS];
  let allWebDonors = [...DEMO_WEB_DONORS];
  let selectedTransferIds = new Set();
  let importedData = null;

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
          members: '통합 회원',
          import: '외부 등록',
          transfer: '웹 후원자 이관',
          tags: '태그 관리',
          notify: '알림 발송',
          export: '데이터 추출',
          'receipt-settings': '영수증 설정', /* ★ STEP H-2d-4 */
          hyosung: '효성 CMS+ 관리', /* ★ Phase 1 */
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

  /* ============ 1. 대시보드 ============ */
  function renderDashboard() {
    const total = allMembers.length;
    const family = allMembers.filter(m => m.type === 'family').length;
    const donor = allMembers.filter(m => m.type === 'donor').length;
    const volunteer = allMembers.filter(m => m.type === 'volunteer').length;
    const srcWeb = allMembers.filter(m => m.source === 'web').length;
    const srcExcel = allMembers.filter(m => m.source === 'excel').length;
    const srcManual = allMembers.filter(m => m.source === 'manual').length;

    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('kpiTotal', total.toLocaleString() + '명');
    set('kpiNew', Math.floor(total * 0.08));
    set('kpiFamily', family.toLocaleString() + '명');
    set('kpiDonor', donor.toLocaleString() + '명');
    set('kpiRegular', Math.floor(donor * 0.7));
    set('kpiOnetime', Math.floor(donor * 0.3));
    set('kpiVolunteer', volunteer.toLocaleString() + '명');
    set('srcWeb', srcWeb + '명');
    set('srcExcel', srcExcel + '명');
    set('srcManual', srcManual + '명');

    /* 차트 */
    renderMemberTypeChart([family, donor, allMembers.filter(m=>m.type==='regular').length, volunteer]);

    /* 최근 활동 */
    const tbody = document.getElementById('recentActivityBody');
    if (tbody) {
      const recent = [...allMembers].sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5);
      tbody.innerHTML = recent.map(m => {
        const typeMap = { family:'유족', donor:'후원', regular:'일반', volunteer:'봉사' };
        return `<tr>
          <td>${formatDate(m.createdAt)}</td>
          <td><span class="cms-badge cms-b-info">${typeMap[m.type] || m.type}</span></td>
          <td>${escapeHtml(m.name)}</td>
          <td>신규 등록 (${m.source === 'web' ? '웹' : m.source === 'excel' ? 'Excel' : '수기'})</td>
        </tr>`;
      }).join('');
    }
  }

  function renderMemberTypeChart(data) {
    const ctx = document.getElementById('chartMemberType');
    if (!ctx || typeof Chart === 'undefined') return;
    
    if (window._chart1) window._chart1.destroy();
    window._chart1 = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['유족', '후원', '일반', '봉사'],
        datasets: [{
          data,
          backgroundColor: ['#c5293a', '#c47a00', '#1a5ec4', '#1a8b46'],
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

  /* ============ 2. 통합 회원 ============ */
  function renderMembers() {
    const tbody = document.getElementById('membersBody');
    if (!tbody) return;

    const typeFilter = document.getElementById('filterType')?.value || '';
    const sourceFilter = document.getElementById('filterSource')?.value || '';
    const search = (document.getElementById('filterSearch')?.value || '').toLowerCase();

    let filtered = allMembers;
    if (typeFilter) filtered = filtered.filter(m => m.type === typeFilter);
    if (sourceFilter) filtered = filtered.filter(m => m.source === sourceFilter);
    if (search) {
      filtered = filtered.filter(m =>
        m.name.toLowerCase().includes(search) ||
        (m.email && m.email.toLowerCase().includes(search)) ||
        m.phone.includes(search)
      );
    }

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:40px;color:#888">조회 결과가 없습니다</td></tr>`;
      return;
    }

    const typeMap = {
      family: '<span class="cms-badge cms-b-danger">유족</span>',
      donor: '<span class="cms-badge cms-b-warn">후원</span>',
      regular: '<span class="cms-badge cms-b-info">일반</span>',
      volunteer: '<span class="cms-badge cms-b-success">봉사</span>',
    };
    const sourceMap = {
      web: '🌐 웹', excel: '📋 Excel', manual: '📞 수기',
    };

    tbody.innerHTML = filtered.map(m => `
      <tr>
        <td><input type="checkbox" data-member-id="${m.id}"></td>
        <td>M-${String(m.id).padStart(5,'0')}</td>
        <td><strong>${escapeHtml(m.name)}</strong></td>
        <td>${typeMap[m.type] || m.type}</td>
        <td style="color:#525252;font-size:11.5px">${sourceMap[m.source] || m.source}</td>
        <td style="font-family:Inter;font-size:11.5px">${escapeHtml(m.phone)}</td>
        <td>
          <div class="cms-tags-cell">
            ${m.tags.map(t => `<span class="cms-tag-chip">${escapeHtml(t)}</span>`).join('')}
          </div>
        </td>
        <td style="font-family:Inter;font-size:11.5px;color:#8a8a8a">${formatDate(m.createdAt)}</td>
        <td>
          <button class="cms-btn-link" data-action="view" data-id="${m.id}">상세</button>
          <button class="cms-btn-link" data-action="edit" data-id="${m.id}">수정</button>
        </td>
      </tr>
    `).join('');
  }

  function setupMembersFilter() {
    ['filterType', 'filterSource'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', renderMembers);
    });
    const search = document.getElementById('filterSearch');
    if (search) {
      let timer;
      search.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(renderMembers, 200);
      });
    }
    const btn = document.getElementById('btnRefreshMembers');
    if (btn) btn.addEventListener('click', () => {
      toast('회원 목록을 새로고침합니다');
      renderMembers();
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

  /* ============ 5. 태그 ============ */
  function renderTags() {
    const grid = document.getElementById('tagGrid');
    if (!grid) return;
    grid.innerHTML = DEMO_TAGS.map(t => `
      <div class="cms-tag-card">
        <div class="cms-tag-info-wrap">
          <div class="cms-tag-name">🏷️ ${escapeHtml(t.name)}</div>
          <div class="cms-tag-count">${t.count}명</div>
        </div>
        <div class="cms-tag-actions">
          <button class="cms-btn-link">필터</button>
        </div>
      </div>
    `).join('');
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
   * CSV 업로드 - 미리보기
   */
  async function hyosungUploadPreview() {
    const csvText = document.getElementById('hyUploadCsv')?.value || '';
    const type = document.querySelector('input[name="hyUploadType"]:checked')?.value || 'contracts';
    const resultEl = document.getElementById('hyUploadResult');
    const confirmBtn = document.getElementById('hyUploadConfirm');

    if (!csvText || csvText.length < 10) {
      toast('CSV 텍스트를 붙여넣으세요');
      return;
    }

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
    if (!confirm('실제로 DB에 저장하시겠습니까?')) return;

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
    document.getElementById('hyUploadCsv').value = '';
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
    setupManualForm();
    setupFileUpload();
    setupTransferActions();
    setupNotifyForm();
    setupExport();
    setupReceiptSettings(); /* ★ STEP H-2d-4 */
    setupHyosung(); /* ★ Phase 1 */

    renderDashboard();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();