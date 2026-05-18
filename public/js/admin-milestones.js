/* admin-milestones.js — Phase 24 성과 관리 어드민 */
'use strict';

const AM = {
  defs: [],
  quarters: [],
  editingDefId: null,
};

/* ───── 유틸 ───── */
function amFmt(n) {
  if (n == null) return '-';
  return Number(n).toLocaleString('ko-KR') + '원';
}
function amDate(s) {
  return s ? s.slice(0, 10) : '-';
}
function amBadge(status) {
  const map = {
    UPCOMING: ['#eff6ff','#1d4ed8','예정'],
    ACTIVE:   ['#f0fdf4','#15803d','진행중'],
    ENDED:    ['#f3f4f6','#4b5563','종료'],
    SETTLED:  ['#f3e8ff','#7c3aed','정산완료'],
    DRAFT:    ['#f3f4f6','#4b5563','초안'],
    SUBMITTED:['#eff6ff','#1d4ed8','검토대기'],
    APPROVED: ['#f0fdf4','#15803d','승인'],
    PAID:     ['#f3e8ff','#7c3aed','지급완료'],
    REJECTED: ['#fee2e2','#dc2626','반려'],
  };
  const [bg, color, label] = map[status] || ['#f3f4f6','#6b7280', status];
  return `<span style="background:${bg};color:${color};padding:2px 9px;border-radius:12px;font-size:11.5px;font-weight:600">${label}</span>`;
}

async function amApi(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function amToast(msg, type = 'info') {
  const el = document.getElementById('amToast');
  if (!el) return;
  const d = document.createElement('div');
  const bg = type === 'error' ? '#dc2626' : type === 'success' ? '#16a34a' : '#374151';
  d.style.cssText = `background:${bg};color:#fff;padding:10px 18px;border-radius:8px;margin-top:8px;font-size:13.5px;box-shadow:0 4px 12px rgba(0,0,0,.2)`;
  d.textContent = msg;
  el.appendChild(d);
  setTimeout(() => d.remove(), 3500);
}

/* ───── 탭 초기화 ───── */
document.querySelectorAll('.adm-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.adm-tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.adm-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const panel = document.getElementById('panel' + capitalize(btn.dataset.panel));
    if (panel) panel.classList.add('active');
    if (btn.dataset.panel === 'defs') loadDefs();
    if (btn.dataset.panel === 'quarters') loadQuarters();
    if (btn.dataset.panel === 'settlements') loadSettlements();
    if (btn.dataset.panel === 'roles') loadRoles();
  });
});

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/* ───── 마일스톤 정의 ───── */
async function loadDefs() {
  const role = document.getElementById('defRoleFilter')?.value || '';
  const cat = document.getElementById('defCatFilter')?.value || '';
  let url = '/api/milestone-definitions';
  const params = [];
  if (role) params.push('role=' + role);
  if (cat) params.push('category=' + cat);
  if (params.length) url += '?' + params.join('&');

  const res = await amApi(url);
  if (!res.ok) { document.getElementById('defsList').innerHTML = '<p style="color:#dc2626">불러오기 실패</p>'; return; }
  AM.defs = res.data?.data?.definitions || res.data?.definitions || [];
  renderDefs();
}

function renderDefs() {
  const el = document.getElementById('defsList');
  if (!AM.defs.length) {
    el.innerHTML = '<p style="color:#9ca3af;text-align:center;padding:30px">등록된 마일스톤이 없습니다.</p>';
    return;
  }
  const roleLabel = { SM: 'SM(사무국장)', PM: 'PM(정책국장)', SI: 'SI(관리자)' };
  const catLabel = { REVENUE_LINKED: '매출연동', NON_REVENUE: '비매출' };
  el.innerHTML = `
    <table class="ms-table">
      <thead><tr>
        <th>코드</th><th>이름</th><th>역할</th><th>카테고리</th><th>사업체</th><th>정렬</th><th>관리</th>
      </tr></thead>
      <tbody>
        ${AM.defs.map(d => `
          <tr>
            <td style="font-family:monospace;font-size:12px;color:#6b7280">${d.code}</td>
            <td style="font-weight:600">${d.name}</td>
            <td>${roleLabel[d.milestoneRole] || d.milestoneRole}</td>
            <td>${catLabel[d.category] || d.category}</td>
            <td style="font-size:12px">${d.businessUnit || '-'}</td>
            <td style="font-size:12px">${d.sortOrder ?? 0}</td>
            <td>
              <button class="ms-btn ms-btn-ghost ms-btn-sm" onclick="openDefEdit(${d.id})">수정</button>
              <button class="ms-btn ms-btn-danger ms-btn-sm" style="margin-left:4px" onclick="deleteDef(${d.id})">삭제</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;
}

document.getElementById('defRoleFilter')?.addEventListener('change', loadDefs);
document.getElementById('defCatFilter')?.addEventListener('change', loadDefs);
document.getElementById('btnNewDef')?.addEventListener('click', () => openDefEdit(null));

function openDefEdit(id) {
  AM.editingDefId = id;
  const modal = document.getElementById('defModal');
  const title = document.getElementById('defModalTitle');
  if (!id) {
    title.textContent = '마일스톤 등록';
    ['fCode','fName','fRevSrc','fThrVal','fThrUnit','fFormula'].forEach(f => {
      const el = document.getElementById(f);
      if (el) el.value = '';
    });
    document.getElementById('fRole').value = 'SM';
    document.getElementById('fCategory').value = 'REVENUE_LINKED';
    document.getElementById('fBU').value = 'ASSOCIATION';
    document.getElementById('fSortOrder').value = '0';
    document.getElementById('fQApplicable').value = '';
    document.getElementById('fThrEnabled').checked = false;
    document.getElementById('thrFields').style.display = 'none';
  } else {
    const d = AM.defs.find(x => x.id === id);
    if (!d) return;
    title.textContent = '마일스톤 수정';
    document.getElementById('fCode').value = d.code;
    document.getElementById('fName').value = d.name;
    document.getElementById('fRole').value = d.milestoneRole;
    document.getElementById('fCategory').value = d.category;
    document.getElementById('fBU').value = d.businessUnit || 'ASSOCIATION';
    document.getElementById('fRevSrc').value = d.revenueSource || '';
    document.getElementById('fSortOrder').value = d.sortOrder ?? 0;
    document.getElementById('fQApplicable').value = d.quarterApplicable || '';
    const thr = d.threshold || {};
    document.getElementById('fThrEnabled').checked = !!thr.enabled;
    document.getElementById('fThrVal').value = thr.value || '';
    document.getElementById('fThrUnit').value = thr.unit || '';
    document.getElementById('thrFields').style.display = thr.enabled ? '' : 'none';
    document.getElementById('fFormula').value = d.bonusFormula ? JSON.stringify(d.bonusFormula, null, 2) : '';
  }
  modal.style.display = '';
}

document.getElementById('fThrEnabled')?.addEventListener('change', e => {
  document.getElementById('thrFields').style.display = e.target.checked ? '' : 'none';
});
document.getElementById('defModalClose')?.addEventListener('click', () => {
  document.getElementById('defModal').style.display = 'none';
});

document.getElementById('defModalSave')?.addEventListener('click', async () => {
  const code = document.getElementById('fCode').value.trim();
  const name = document.getElementById('fName').value.trim();
  if (!code || !name) { amToast('코드와 이름은 필수입니다.', 'error'); return; }

  let bonusFormula = null;
  const formulaStr = document.getElementById('fFormula').value.trim();
  if (formulaStr) {
    try { bonusFormula = JSON.parse(formulaStr); }
    catch { amToast('인센티브 공식 JSON 형식이 올바르지 않습니다.', 'error'); return; }
  }

  const thrEnabled = document.getElementById('fThrEnabled').checked;
  const threshold = thrEnabled ? {
    enabled: true,
    value: parseFloat(document.getElementById('fThrVal').value) || 0,
    unit: document.getElementById('fThrUnit').value.trim(),
  } : { enabled: false };

  const body = {
    code,
    name,
    milestoneRole: document.getElementById('fRole').value,
    category: document.getElementById('fCategory').value,
    businessUnit: document.getElementById('fBU').value,
    revenueSource: document.getElementById('fRevSrc').value.trim() || null,
    sortOrder: parseInt(document.getElementById('fSortOrder').value) || 0,
    quarterApplicable: document.getElementById('fQApplicable').value || null,
    threshold,
    bonusFormula,
  };

  const isEdit = !!AM.editingDefId;
  const res = await amApi(
    isEdit ? `/api/milestone-definitions/${AM.editingDefId}` : '/api/milestone-definitions',
    { method: isEdit ? 'PATCH' : 'POST', body }
  );
  if (!res.ok) {
    amToast((res.data?.error || '저장 실패') + (res.data?.detail ? ': ' + res.data.detail : ''), 'error');
    return;
  }
  amToast(isEdit ? '수정되었습니다.' : '등록되었습니다.', 'success');
  document.getElementById('defModal').style.display = 'none';
  loadDefs();
});

async function deleteDef(id) {
  if (!confirm('이 마일스톤을 삭제하시겠습니까?')) return;
  const res = await amApi(`/api/milestone-definitions/${id}`, { method: 'DELETE' });
  if (!res.ok) { amToast(res.data?.error || '삭제 실패', 'error'); return; }
  amToast('삭제되었습니다.');
  loadDefs();
}

/* ───── 분기 관리 ───── */
async function loadQuarters() {
  const res = await amApi('/api/milestone-quarters');
  if (!res.ok) { document.getElementById('quartersList').innerHTML = '<p style="color:#dc2626">불러오기 실패</p>'; return; }
  AM.quarters = res.data?.data?.quarters || res.data?.quarters || [];
  renderQuarters();
}

function renderQuarters() {
  const el = document.getElementById('quartersList');
  if (!AM.quarters.length) {
    el.innerHTML = '<p style="color:#9ca3af;text-align:center;padding:30px">등록된 분기가 없습니다.</p>';
    return;
  }
  el.innerHTML = `
    <table class="ms-table">
      <thead><tr>
        <th>분기</th><th>상태</th><th>시작일</th><th>종료일</th><th>결산일</th><th>관리</th>
      </tr></thead>
      <tbody>
        ${AM.quarters.map(q => `
          <tr>
            <td style="font-weight:700">${q.year}년 Q${q.quarter}</td>
            <td>${amBadge(q.status)}</td>
            <td>${amDate(q.startDate)}</td>
            <td>${amDate(q.endDate)}</td>
            <td>${amDate(q.settlementDate)}</td>
            <td>
              ${q.status === 'UPCOMING' ? `<button class="ms-btn ms-btn-ghost ms-btn-sm" onclick="activateQuarter(${q.id})">활성화</button>` : ''}
              ${q.status === 'ACTIVE' ? `<button class="ms-btn ms-btn-ghost ms-btn-sm" onclick="endQuarter(${q.id})">종료</button>` : ''}
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;

  // 결산 필터 옵션 동기화
  const sel = document.getElementById('settlQuarterFilter');
  if (sel) {
    const existing = Array.from(sel.options).map(o => o.value);
    AM.quarters.forEach(q => {
      const val = String(q.id);
      if (!existing.includes(val)) {
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = `${q.year}년 Q${q.quarter}`;
        sel.appendChild(opt);
      }
    });
  }
}

document.getElementById('btnNewQuarter')?.addEventListener('click', () => {
  document.getElementById('quarterModal').style.display = '';
});
document.getElementById('quarterModalClose')?.addEventListener('click', () => {
  document.getElementById('quarterModal').style.display = 'none';
});
document.getElementById('quarterModalSave')?.addEventListener('click', async () => {
  const body = {
    year: parseInt(document.getElementById('qYear').value),
    quarter: parseInt(document.getElementById('qQ').value),
    startDate: document.getElementById('qStart').value,
    endDate: document.getElementById('qEnd').value,
    settlementDate: document.getElementById('qSettle').value,
  };
  if (!body.year || !body.quarter || !body.startDate || !body.endDate) {
    amToast('연도, 분기, 시작일, 종료일은 필수입니다.', 'error'); return;
  }
  const res = await amApi('/api/milestone-quarters', { method: 'POST', body });
  if (!res.ok) { amToast(res.data?.error || '저장 실패', 'error'); return; }
  amToast('분기가 추가되었습니다.', 'success');
  document.getElementById('quarterModal').style.display = 'none';
  loadQuarters();
});

async function activateQuarter(id) {
  if (!confirm('이 분기를 활성화하시겠습니까?')) return;
  const res = await amApi(`/api/milestone-quarters/${id}`, { method: 'PATCH', body: { status: 'ACTIVE' } });
  if (!res.ok) { amToast(res.data?.error || '실패', 'error'); return; }
  amToast('활성화되었습니다.', 'success');
  loadQuarters();
}

async function endQuarter(id) {
  if (!confirm('이 분기를 종료하시겠습니까?')) return;
  const res = await amApi(`/api/milestone-quarters/${id}`, { method: 'PATCH', body: { status: 'ENDED' } });
  if (!res.ok) { amToast(res.data?.error || '실패', 'error'); return; }
  amToast('종료되었습니다.', 'success');
  loadQuarters();
}

/* ───── 결산 승인 ───── */
async function loadSettlements() {
  const qId = document.getElementById('settlQuarterFilter')?.value || '';
  const status = document.getElementById('settlStatusFilter')?.value || 'SUBMITTED';
  let url = '/api/admin-milestone-settlement';
  const params = [];
  if (qId) params.push('quarterId=' + qId);
  if (status) params.push('status=' + status);
  if (params.length) url += '?' + params.join('&');

  const res = await amApi(url);
  if (!res.ok) { document.getElementById('settlementsList').innerHTML = '<p style="color:#dc2626">불러오기 실패</p>'; return; }
  const settlements = res.data?.data?.settlements || res.data?.settlements || [];
  renderSettlements(settlements);
}

function renderSettlements(list) {
  const el = document.getElementById('settlementsList');
  if (!list.length) {
    el.innerHTML = '<p style="color:#9ca3af;text-align:center;padding:30px">결산 내역이 없습니다.</p>';
    return;
  }
  const roleLabel = { SM: 'SM', PM: 'PM', SI: 'SI' };
  el.innerHTML = `
    <table class="ms-table">
      <thead><tr>
        <th>역할</th><th>담당자</th><th>분기</th><th>매출연동</th><th>비매출보너스</th><th>합계</th><th>상태</th><th>관리</th>
      </tr></thead>
      <tbody>
        ${list.map(s => `
          <tr>
            <td>${roleLabel[s.milestoneRole] || s.milestoneRole || '-'}</td>
            <td style="font-weight:600">${s.memberName || '-'}</td>
            <td style="font-size:12px">${s.quarterYear ? s.quarterYear + '년 Q' + s.quarterQ : '-'}</td>
            <td>${amFmt(s.revenueIncentive)}</td>
            <td>${amFmt(s.nonRevenueBonus)}</td>
            <td style="font-weight:700">${amFmt(s.totalAmount)}</td>
            <td>${amBadge(s.status)}</td>
            <td>
              ${s.status === 'SUBMITTED' ? `
                <button class="ms-btn ms-btn-primary ms-btn-sm" onclick="approveSettlement(${s.id})">승인</button>
                <button class="ms-btn ms-btn-danger ms-btn-sm" style="margin-left:4px" onclick="rejectSettlement(${s.id})">반려</button>
              ` : ''}
              ${s.status === 'APPROVED' ? `
                <button class="ms-btn ms-btn-primary ms-btn-sm" onclick="paidSettlement(${s.id})">지급완료</button>
              ` : ''}
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;
}

document.getElementById('settlQuarterFilter')?.addEventListener('change', loadSettlements);
document.getElementById('settlStatusFilter')?.addEventListener('change', loadSettlements);
document.getElementById('btnReloadSettlements')?.addEventListener('click', loadSettlements);

async function approveSettlement(id) {
  if (!confirm('이 결산을 승인하시겠습니까?')) return;
  const res = await amApi(`/api/admin-milestone-settlement/${id}/approve`, { method: 'POST' });
  if (!res.ok) { amToast(res.data?.error || '실패', 'error'); return; }
  amToast('승인되었습니다.', 'success');
  loadSettlements();
}

async function rejectSettlement(id) {
  const reason = prompt('반려 사유를 입력하세요:');
  if (reason === null) return;
  const res = await amApi(`/api/admin-milestone-settlement/${id}/reject`, { method: 'POST', body: { reason } });
  if (!res.ok) { amToast(res.data?.error || '실패', 'error'); return; }
  amToast('반려되었습니다.');
  loadSettlements();
}

async function paidSettlement(id) {
  if (!confirm('지급 완료 처리하시겠습니까?')) return;
  const res = await amApi(`/api/admin-milestone-settlement/${id}/paid`, { method: 'POST' });
  if (!res.ok) { amToast(res.data?.error || '실패', 'error'); return; }
  amToast('지급 완료 처리되었습니다.', 'success');
  loadSettlements();
}

/* ───── 담당 역할 설정 ───── */
async function loadRoles() {
  const res = await amApi('/api/milestone-members');
  if (!res.ok) { document.getElementById('rolesList').innerHTML = '<p style="color:#dc2626">불러오기 실패</p>'; return; }
  const members = res.data?.data?.members || res.data?.members || [];
  renderRoles(members);
}

function renderRoles(members) {
  const el = document.getElementById('rolesList');
  if (!members.length) {
    el.innerHTML = '<p style="color:#9ca3af;text-align:center;padding:30px">운영 중인 멤버가 없습니다.</p>';
    return;
  }
  const roleOptions = `
    <option value="">미배정</option>
    <option value="SM">SM (사무국장)</option>
    <option value="PM">PM (정책국장)</option>
    <option value="SI">SI (SI관리자)</option>
  `;
  el.innerHTML = `
    <table class="ms-table">
      <thead><tr>
        <th>이름</th><th>이메일</th><th>시스템 역할</th><th>마일스톤 역할</th><th>저장</th>
      </tr></thead>
      <tbody>
        ${members.map(m => `
          <tr>
            <td style="font-weight:600">${m.name || '-'}</td>
            <td style="font-size:12.5px;color:#6b7280">${m.email || '-'}</td>
            <td style="font-size:12.5px">${m.role || '-'}</td>
            <td>
              <select id="msRole_${m.id}" style="padding:5px 10px;border:1px solid #e5e7eb;border-radius:6px;font-size:13px">
                ${roleOptions}
              </select>
            </td>
            <td>
              <button class="ms-btn ms-btn-primary ms-btn-sm" onclick="saveRole(${m.id})">저장</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;

  // 현재 역할 세팅
  members.forEach(m => {
    const sel = document.getElementById('msRole_' + m.id);
    if (sel && m.milestoneRole) sel.value = m.milestoneRole;
  });
}

async function saveRole(memberId) {
  const sel = document.getElementById('msRole_' + memberId);
  const milestoneRole = sel?.value || null;
  const res = await amApi(`/api/milestone-members/${memberId}/role`, {
    method: 'PATCH',
    body: { milestoneRole: milestoneRole || null },
  });
  if (!res.ok) { amToast(res.data?.error || '저장 실패', 'error'); return; }
  amToast('역할이 저장되었습니다.', 'success');
}

/* ───── 초기 로드 ───── */
loadDefs();

// URL 해시로 초기 탭 설정
const hash = location.hash.replace('#', '');
if (hash) {
  const btn = document.querySelector(`.adm-tab[data-panel="${hash}"]`);
  if (btn) btn.click();
}
