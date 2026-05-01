/* =========================================================
   SIREN — CMS TBFA (교유협 통합 관리)
   데모 데이터 기반, 향후 실 API 연동 가능하게 구조화
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
        };
        const titleEl = document.getElementById('cmsPageTitle');
        if (titleEl) titleEl.textContent = titles[tab] || '교유협 CMS';

        /* 탭별 데이터 로딩 */
        if (tab === 'dashboard') renderDashboard();
        else if (tab === 'members') renderMembers();
        else if (tab === 'transfer') renderTransfer();
        else if (tab === 'tags') renderTags();
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

    renderDashboard();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();