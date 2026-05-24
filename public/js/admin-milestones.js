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
    if (btn.dataset.panel === 'rolecat') loadRoleMgmt();
    if (btn.dataset.panel === 'roles') loadRoles();
    if (btn.dataset.panel === 'revenue') rvLoad();
    if (btn.dataset.panel === 'nonrevenue') nrLoad();
  });
});

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/* ───── 마일스톤 정의 ───── */
async function loadDefs() {
  const role = document.getElementById('defRoleFilter')?.value || '';
  const cat = document.getElementById('defCatFilter')?.value || '';
  /* 통합: 비활성(소프트삭제) 정의도 표시해 재활성화 가능하게 함 */
  const params = ['activeOnly=0'];
  if (role) params.push('role=' + role);
  if (cat) params.push('category=' + cat);
  const url = '/api/milestone-definitions?' + params.join('&');

  const res = await amApi(url);
  if (!res.ok) { document.getElementById('defsList').innerHTML = '<p style="color:#dc2626">불러오기 실패</p>'; return; }
  AM.defs =
    res.data?.data?.milestones ||
    res.data?.milestones ||
    res.data?.data?.definitions ||
    res.data?.definitions ||
    (Array.isArray(res.data?.data) ? res.data.data : null) ||
    [];
  renderDefs();
}

const NR_CAT_LABELS = {
  1: '① 미션·정책 영향력',
  2: '② 유족·회원 직접 지원',
  3: '③ 사회적 가치·인식 변화',
  4: '④ 조직 역량 강화',
  5: '⑤ 운영 효율·시스템',
};

function _defRow(d, _roleLabel) {
  const r = d.targetMilestoneRole || d.milestoneRole;
  const rLabel = r ? (_roleLabel(r) === r ? r : `${r}(${_roleLabel(r)})`) : '-';
  const active = d.isActive !== false;
  const activeBadge = active
    ? '<span style="background:#f0fdf4;color:#15803d;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600">활성</span>'
    : '<span style="background:#f3f4f6;color:#9ca3af;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600">비활성</span>';
  return `
  <tr${active ? '' : ' style="opacity:.6"'}>
    <td>${activeBadge}</td>
    <td style="font-family:monospace;font-size:12px;color:#6b7280">${d.code}</td>
    <td style="font-weight:600">${d.name}</td>
    <td>${rLabel}</td>
    <td style="font-size:12px">${d.businessUnit || '-'}</td>
    <td style="font-size:12px">${d.sortOrder ?? 0}</td>
    <td>
      <button class="ms-btn ms-btn-ghost ms-btn-sm" onclick="openDefEdit(${d.id})">수정</button>
      <button class="ms-btn ${active ? 'ms-btn-danger' : 'ms-btn-primary'} ms-btn-sm" style="margin-left:4px" onclick="toggleDefActive(${d.id})">${active ? '비활성화' : '활성화'}</button>
    </td>
  </tr>`;
}

function renderDefs() {
  const el = document.getElementById('defsList');
  if (!AM.defs.length) {
    el.innerHTML = '<p style="color:#9ca3af;text-align:center;padding:30px">등록된 마일스톤이 없습니다.</p>';
    return;
  }
  /* R39 Stage 3: 역할 라벨 동적 — 캐시된 카탈로그 사용·없으면 코드 그대로 */
  const _roleLabel = (code) =>
    (window.MilestoneRoles ? window.MilestoneRoles.getRoleLabelSync(code) : null)
    || code || '-';

  const revenue = AM.defs.filter(d => d.category === 'REVENUE_LINKED');
  const nonRev  = AM.defs.filter(d => d.category === 'NON_REVENUE');

  const tableHead = `<table class="ms-table">
    <thead><tr>
      <th>활성</th><th>코드</th><th>이름</th><th>역할</th><th>사업체</th><th>정렬</th><th>관리</th>
    </tr></thead><tbody>`;
  const tableClose = `</tbody></table>`;

  let html = '';

  /* ── 매출연동 섹션 ── */
  if (revenue.length) {
    html += `<div style="margin:0 0 6px;font-size:13px;font-weight:700;color:#1d4ed8">매출연동 정의 (${revenue.length})</div>`;
    html += tableHead + revenue.map(d => _defRow(d, _roleLabel)).join('') + tableClose;
  }

  /* ── 비매출 섹션 — 카테고리 1~5 소제목 묶음 ── */
  if (nonRev.length) {
    html += `<div style="margin:${revenue.length ? '18px' : '0'} 0 6px;font-size:13px;font-weight:700;color:#7c3aed">비매출 정의 (${nonRev.length})</div>`;

    /* 카테고리별 그룹핑 — nonRevenueCategory 다중 fallback */
    const groups = {};
    nonRev.forEach(d => {
      const cat = d.nonRevenueCategory ?? d.non_revenue_category ?? d.nrCategory ?? null;
      const key = (cat >= 1 && cat <= 5) ? cat : 0;
      if (!groups[key]) groups[key] = [];
      groups[key].push(d);
    });

    /* 카테고리 1~5 순서로 출력, 미분류(0)는 맨 끝 */
    const orderedKeys = [1, 2, 3, 4, 5, 0].filter(k => groups[k]);
    orderedKeys.forEach(k => {
      const items = groups[k];
      const subtitle = k === 0 ? '미분류' : NR_CAT_LABELS[k];
      html += `<div style="margin:10px 0 4px 2px;font-size:12px;font-weight:600;color:#6b7280;border-left:3px solid #e5e7eb;padding-left:8px">${subtitle} (${items.length})</div>`;
      html += tableHead + items.map(d => _defRow(d, _roleLabel)).join('') + tableClose;
    });
  }

  el.innerHTML = html || '<p style="color:#9ca3af;text-align:center;padding:30px">등록된 마일스톤이 없습니다.</p>';
}

/* 통합: 정의 활성/비활성 토글 (소프트삭제와 동일·milestone-definitions PATCH) */
async function toggleDefActive(id) {
  const d = AM.defs.find(x => x.id === id);
  if (!d) return;
  const next = d.isActive === false; // 비활성이면 활성화로
  if (!confirm(`[${d.name}] 마일스톤을 ${next ? '활성화' : '비활성화'}하시겠습니까?`)) return;
  const res = await amApi(`/api/milestone-definitions/${id}`, { method: 'PATCH', body: { isActive: next } });
  if (!res.ok || res.data?.ok === false) { amToast((res.data?.error || '변경 실패'), 'error'); return; }
  amToast(next ? '활성화되었습니다.' : '비활성화되었습니다.', 'success');
  loadDefs();
}
window.toggleDefActive = toggleDefActive;

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
    /* R39 Stage 3: 첫 옵션을 기본값 (역할 카탈로그가 동적이므로 SM 고정 불가) */
    const _fRole = document.getElementById('fRole');
    if (_fRole && _fRole.options.length > 0) _fRole.selectedIndex = 0;
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
    /* R39 Stage 3: 기존 정의의 역할 코드로 설정. 카탈로그에서 비활성/삭제된 경우 옵션 추가 후 선택 */
    (function () {
      const code = d.targetMilestoneRole || d.milestoneRole || '';
      const sel = document.getElementById('fRole');
      if (sel && code) {
        const found = Array.from(sel.options).some(o => o.value === code);
        if (!found) {
          const opt = document.createElement('option');
          opt.value = code;
          opt.textContent = code + ' (비활성·이전 정의)';
          sel.appendChild(opt);
        }
        sel.value = code;
      }
    })();
    document.getElementById('fCategory').value = d.category;
    document.getElementById('fBU').value = d.businessUnit || 'ASSOCIATION';
    document.getElementById('fRevSrc').value = d.revenueSource || '';
    document.getElementById('fSortOrder').value = d.sortOrder ?? 0;
    document.getElementById('fQApplicable').value = d.quarterApplicable || '';
    /* ★ R29-GAP-P1-H3: threshold 객체 분해 → 평탄 키(schema 일치) */
    const thrEnabled = !!d.thresholdEnabled;
    document.getElementById('fThrEnabled').checked = thrEnabled;
    document.getElementById('fThrVal').value = d.thresholdValue ?? '';
    document.getElementById('fThrUnit').value = d.thresholdUnit ?? '';
    document.getElementById('thrFields').style.display = thrEnabled ? '' : 'none';
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
  /* ★ R29-GAP-P1-H3: 필수 4개(code/name/category/targetMilestoneRole) 입력 차단 */
  const code = document.getElementById('fCode').value.trim();
  const name = document.getElementById('fName').value.trim();
  const category = document.getElementById('fCategory').value;
  const targetMilestoneRole = document.getElementById('fRole').value;
  if (!code || !name || !category || !targetMilestoneRole) {
    amToast('코드·이름·카테고리·담당 역할은 필수입니다.', 'error'); return;
  }

  let bonusFormula = null;
  const formulaStr = document.getElementById('fFormula').value.trim();
  if (formulaStr) {
    try { bonusFormula = JSON.parse(formulaStr); }
    catch { amToast('인센티브 공식 JSON 형식이 올바르지 않습니다.', 'error'); return; }
  }

  /* ★ R29-GAP-P1-H3: threshold 평탄 키 — schema(milestone_definitions)와 일치 */
  const thresholdEnabled = document.getElementById('fThrEnabled').checked;
  const thresholdValue = thresholdEnabled
    ? (parseFloat(document.getElementById('fThrVal').value) || 0) : null;
  const thresholdUnit = thresholdEnabled
    ? (document.getElementById('fThrUnit').value.trim() || null) : null;

  const body = {
    code,
    name,
    category,
    targetMilestoneRole,
    businessUnit: document.getElementById('fBU').value,
    revenueSource: document.getElementById('fRevSrc').value.trim() || null,
    sortOrder: parseInt(document.getElementById('fSortOrder').value) || 0,
    quarterApplicable: document.getElementById('fQApplicable').value || null,
    thresholdEnabled,
    thresholdValue,
    thresholdUnit,
    bonusFormula,
  };

  const isEdit = !!AM.editingDefId;
  const res = await amApi(
    isEdit ? `/api/milestone-definitions/${AM.editingDefId}` : '/api/milestone-definitions',
    { method: isEdit ? 'PATCH' : 'POST', body }
  );
  /* ★ R29-GAP-P1-H3: HTTP ok + 응답 본문 ok 이중 검증 */
  if (!res.ok || res.data?.ok === false) {
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

/* ───── 🤖 매트릭스 AI 매핑 (③) ───── */
AM.matrix = { candidates: [], orphans: [] };

function mxCatLabel(c) { return c === 'REVENUE_LINKED' ? '매출연동' : c === 'NON_REVENUE' ? '비매출' : c; }
function mxConfBadge(conf) {
  const pct = Math.round((conf || 0) * 100);
  const [bg, fg] = conf >= 0.8 ? ['#f0fdf4', '#15803d'] : conf >= 0.6 ? ['#fefce8', '#a16207'] : ['#fee2e2', '#dc2626'];
  return `<span style="background:${bg};color:${fg};padding:1px 8px;border-radius:10px;font-size:11px;font-weight:600">신뢰 ${pct}%</span>`;
}
/* 역할 옵션 HTML — 매트릭스 힌트 select에서 그대로 가져옴(이미 동적 채워짐) */
function mxRoleOptions(selected) {
  const src = document.getElementById('matrixRoleHint');
  let opts = '';
  if (src) {
    Array.from(src.options).forEach(o => {
      if (!o.value) return; // '자동 판별' 제외
      opts += `<option value="${o.value}"${o.value === selected ? ' selected' : ''}>${escHtmlAm(o.textContent)}</option>`;
    });
  }
  if (selected && opts.indexOf(`value="${selected}"`) === -1) {
    opts = `<option value="${selected}" selected>${escHtmlAm(selected)} (미확인)</option>` + opts;
  }
  return opts;
}

function openMatrixModal() {
  AM.matrix = { candidates: [], orphans: [] };
  document.getElementById('matrixText').value = '';
  document.getElementById('matrixReviewBox').style.display = 'none';
  document.getElementById('matrixInputBox').style.display = '';
  document.getElementById('matrixModal').style.display = '';
}

async function runMatrixParse() {
  const text = document.getElementById('matrixText').value.trim();
  if (text.length < 10) { amToast('매트릭스 텍스트를 붙여넣으세요 (최소 10자).', 'error'); return; }
  const roleHint = document.getElementById('matrixRoleHint').value || '';
  const btn = document.getElementById('matrixParseBtn');
  btn.disabled = true; btn.textContent = '분석 중…';
  try {
    const res = await amApi('/api/admin-milestone-matrix-parse', { method: 'POST', body: { text, roleHint } });
    if (!res.ok || res.data?.ok === false) {
      amToast((res.data?.error || 'AI 분석 실패') + (res.data?.detail ? ': ' + res.data.detail : '') + ' — 실패 시 "+ 신규 등록"으로 직접 입력하세요.', 'error');
      return;
    }
    const d = res.data.data || res.data;
    AM.matrix.candidates = d.candidates || [];
    AM.matrix.orphans = d.orphans || [];
    renderMatrixReview(d);
    document.getElementById('matrixInputBox').style.display = 'none';
    document.getElementById('matrixReviewBox').style.display = '';
  } catch (e) {
    amToast('분석 실패: ' + e.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = '🔍 분석';
  }
}

/* 후보 1건 편집 카드 */
function mxCandCard(c) {
  const isUpdate = c.action === 'UPDATE' && c.matchExistingId;
  const thrChk = c.thresholdEnabled ? 'checked' : '';
  const formulaStr = c.bonusFormula ? JSON.stringify(c.bonusFormula) : '';
  const flagsHtml = (c.flags || []).map(f => `<span style="background:#fef3c7;color:#92400e;padding:1px 7px;border-radius:9px;font-size:10.5px;margin-left:4px">${escHtmlAm(f)}</span>`).join('');

  // 매출/역할/카테고리: UPDATE는 기존 정의 정체성 유지(PATCH 불가) → 읽기전용 표시
  let identity;
  if (isUpdate) {
    const m = c.matchExisting || {};
    identity = `<div style="font-size:11.5px;color:#6b7280;margin-bottom:6px">
      🔁 기존 <code style="background:#f3f4f6;padding:1px 5px;border-radius:4px">${escHtmlAm(m.code || '')}</code> 수정
      · 역할 ${escHtmlAm(m.role || '')} · ${mxCatLabel(m.category)}
      <span style="color:#9ca3af">(역할·카테고리·코드는 변경 안 됨)</span></div>
      ${m.bonusFormula ? `<div style="font-size:11px;color:#9ca3af;margin-bottom:6px">기존 공식: <code>${escHtmlAm(JSON.stringify(m.bonusFormula))}</code></div>` : ''}`;
  } else {
    identity = `<div class="form-row" style="margin-bottom:6px">
      <div class="form-group" style="margin-bottom:6px"><label>코드</label><input data-f="code" value="${escHtmlAm(c.code || '')}" maxlength="20"></div>
      <div class="form-group" style="margin-bottom:6px"><label>담당 역할</label><select data-f="role">${mxRoleOptions(c.targetMilestoneRole)}</select></div>
      <div class="form-group" style="margin-bottom:6px"><label>카테고리</label><select data-f="category">
        <option value="REVENUE_LINKED"${c.category === 'REVENUE_LINKED' ? ' selected' : ''}>매출연동</option>
        <option value="NON_REVENUE"${c.category === 'NON_REVENUE' ? ' selected' : ''}>비매출</option>
      </select></div>
    </div>`;
  }

  return `<div class="mx-cand" data-tempid="${c.tempId}" style="border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin-bottom:8px">
    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:8px">
      <input type="checkbox" class="mx-use" style="width:auto" ${c.autoApply ? 'checked' : ''}>
      <strong style="font-size:13.5px">${escHtmlAm(c.name || '(이름 없음)')}</strong>
      ${mxConfBadge(c.confidence)}${flagsHtml}
    </label>
    ${c.reason ? `<div style="font-size:11.5px;color:#9ca3af;margin-bottom:6px">💬 ${escHtmlAm(c.reason)}</div>` : ''}
    ${identity}
    <div class="form-group" style="margin-bottom:6px"><label>이름</label><input data-f="name" value="${escHtmlAm(c.name || '')}" maxlength="200"></div>
    <div class="form-group" style="margin-bottom:6px"><label>인센티브 공식 (JSON)</label>
      <input data-f="formula" value="${escHtmlAm(formulaStr)}" placeholder='{"type":"FLAT","unitAmount":50000}'></div>
    <div class="form-row">
      <div class="form-group" style="margin-bottom:6px"><label>사업체</label><select data-f="bu">
        <option value="ASSOCIATION"${c.businessUnit === 'ASSOCIATION' ? ' selected' : ''}>협의회</option>
        <option value="HAMKEWORK"${c.businessUnit === 'HAMKEWORK' ? ' selected' : ''}>함께워크ON</option>
        <option value="PLEO"${c.businessUnit === 'PLEO' ? ' selected' : ''}>플레오</option>
        <option value="POLICY"${c.businessUnit === 'POLICY' ? ' selected' : ''}>정책</option>
      </select></div>
      <div class="form-group" style="margin-bottom:6px"><label>분기 한정</label><select data-f="quarter">
        <option value=""${!c.quarterApplicable ? ' selected' : ''}>해당없음</option>
        <option value="ALL"${c.quarterApplicable === 'ALL' ? ' selected' : ''}>전체</option>
        <option value="Q1"${c.quarterApplicable === 'Q1' ? ' selected' : ''}>Q1</option>
        <option value="Q2"${c.quarterApplicable === 'Q2' ? ' selected' : ''}>Q2</option>
        <option value="Q3"${c.quarterApplicable === 'Q3' ? ' selected' : ''}>Q3</option>
        <option value="Q4"${c.quarterApplicable === 'Q4' ? ' selected' : ''}>Q4</option>
      </select></div>
    </div>
    <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">
      <label style="display:flex;align-items:center;gap:6px;font-size:12.5px;cursor:pointer"><input type="checkbox" data-f="thrEnabled" style="width:auto" ${thrChk}>임계점</label>
      <div class="form-group" style="margin:0;max-width:130px"><input type="number" data-f="thrVal" step="any" value="${c.thresholdValue ?? ''}" placeholder="임계값"></div>
      <div class="form-group" style="margin:0;max-width:110px"><input data-f="thrUnit" value="${escHtmlAm(c.thresholdUnit || '')}" placeholder="단위"></div>
    </div>
  </div>`;
}

function renderMatrixReview(d) {
  const cands = AM.matrix.candidates;
  const auto = cands.filter(c => c.autoApply);
  const updates = cands.filter(c => c.action === 'UPDATE');
  const review = cands.filter(c => !c.autoApply && c.action === 'NEW');
  const keeps = cands.filter(c => c.action === 'KEEP');
  const orphans = AM.matrix.orphans;
  const s = d.summary || {};

  /* warning 박스 — data.summary.warning 있을 때만 표시 */
  const warnEl = document.getElementById('matrixWarning');
  if (warnEl) {
    const warning = s.warning || null;
    if (warning) {
      warnEl.innerHTML = `<span style="font-size:14px;margin-right:6px">⚠️</span>${escHtmlAm(warning)}`;
      warnEl.style.display = 'flex';
    } else {
      warnEl.style.display = 'none';
    }
  }

  document.getElementById('matrixSummary').innerHTML =
    `📊 추출 <strong>${cands.length}</strong>건 · 자동선택(신규) <strong>${auto.length}</strong> · 충돌(수정) <strong>${updates.length}</strong> · 검토필요 <strong>${review.length}</strong> · 변경없음 ${keeps.length} · 삭제후보 <strong>${orphans.length}</strong>`
    + `<br><span style="font-size:11.5px;color:#3b82f6">체크된 항목만 적용됩니다. 모든 값은 적용 전 수정 가능. 역할·카테고리는 기존 정의 수정 시 변경되지 않습니다.</span>`;

  const sec = (title, color, items) => items.length
    ? `<div style="margin:14px 0 6px;font-size:13px;font-weight:700;color:${color}">${title} (${items.length})</div>` + items.map(mxCandCard).join('')
    : '';

  let html = '';
  html += sec('✅ 자동 적용 — 고신뢰·충돌 없는 신규', '#15803d', auto);
  html += sec('⚠️ 충돌 — 기존 정의 수정', '#a16207', updates);
  html += sec('🔍 검토 필요 — 저신뢰·역할 미확인', '#dc2626', review);

  // 변경 없음
  if (keeps.length) {
    html += `<div style="margin:14px 0 6px;font-size:13px;font-weight:700;color:#6b7280">⏸ 변경 없음 (${keeps.length})</div>`;
    html += keeps.map(c => `<div style="font-size:12.5px;color:#9ca3af;padding:4px 8px">• ${escHtmlAm(c.name)} <span style="font-size:11px">(기존과 동일)</span></div>`).join('');
  }

  // 삭제 후보 (orphans) — 기본 미선택(유지)
  if (orphans.length) {
    html += `<div style="margin:14px 0 6px;font-size:13px;font-weight:700;color:#dc2626">🗑 삭제 후보 — 새 매트릭스에 없는 기존 정의 (${orphans.length})</div>`;
    html += `<div style="font-size:11.5px;color:#9ca3af;margin-bottom:6px">체크하면 비활성화(소프트삭제)됩니다. 기본은 유지입니다.</div>`;
    html += orphans.map(o => `<label class="mx-orphan" data-id="${o.id}" style="display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid #fee2e2;border-radius:6px;margin-bottom:5px;font-size:12.5px;cursor:pointer">
      <input type="checkbox" class="mx-orphan-del" style="width:auto">
      <span><code style="background:#f3f4f6;padding:1px 5px;border-radius:4px">${escHtmlAm(o.code)}</code> ${escHtmlAm(o.name)} <span style="color:#9ca3af">· ${escHtmlAm(o.role || '')} · ${mxCatLabel(o.category)}</span></span>
    </label>`).join('');
  }

  if (!html) html = '<p style="color:#9ca3af;text-align:center;padding:24px">추출된 마일스톤이 없습니다. 텍스트를 확인하거나 직접 등록하세요.</p>';
  document.getElementById('matrixReview').innerHTML = html;
}

async function mxApply() {
  const cards = document.querySelectorAll('#matrixReview .mx-cand');
  let created = 0, updated = 0, deactivated = 0, failed = 0;
  const errs = [];
  const get = (card, k) => card.querySelector(`[data-f="${k}"]`);

  for (const card of cards) {
    const use = card.querySelector('.mx-use');
    if (!use || !use.checked) continue;
    const c = AM.matrix.candidates.find(x => x.tempId === card.dataset.tempid);
    if (!c) continue;

    const name = (get(card, 'name')?.value || '').trim();
    let formula;
    try { formula = JSON.parse((get(card, 'formula')?.value || '').trim() || '{}'); }
    catch { failed++; errs.push(`${name || card.dataset.tempid}: 공식 JSON 형식 오류`); continue; }
    const thrEnabled = !!get(card, 'thrEnabled')?.checked;
    const thrVal = thrEnabled ? (parseFloat(get(card, 'thrVal')?.value) || 0) : null;
    const thrUnit = thrEnabled ? ((get(card, 'thrUnit')?.value || '').trim() || null) : null;
    const bu = get(card, 'bu')?.value || null;
    const quarter = get(card, 'quarter')?.value || null;

    if (c.action === 'UPDATE' && c.matchExistingId) {
      const body = { name, businessUnit: bu, quarterApplicable: quarter, thresholdEnabled: thrEnabled, thresholdValue: thrVal, thresholdUnit: thrUnit, bonusFormula: formula };
      const res = await amApi(`/api/milestone-definitions/${c.matchExistingId}`, { method: 'PATCH', body });
      if (!res.ok || res.data?.ok === false) { failed++; errs.push(`${name}: ${res.data?.error || '수정 실패'}`); } else updated++;
    } else {
      const code = (get(card, 'code')?.value || '').trim();
      const category = get(card, 'category')?.value || c.category;
      const role = get(card, 'role')?.value || c.targetMilestoneRole;
      if (!name || !code || !category || !role) { failed++; errs.push(`${name || code}: 코드·이름·역할·카테고리 필수`); continue; }
      const body = { code, name, category, targetMilestoneRole: role, businessUnit: bu, revenueSource: c.revenueSource || null, sortOrder: 0, quarterApplicable: quarter, thresholdEnabled: thrEnabled, thresholdValue: thrVal, thresholdUnit: thrUnit, bonusFormula: formula };
      const res = await amApi('/api/milestone-definitions', { method: 'POST', body });
      if (!res.ok || res.data?.ok === false) { failed++; errs.push(`${name}: ${res.data?.error || '등록 실패'}`); } else created++;
    }
  }

  // 삭제 후보
  for (const row of document.querySelectorAll('#matrixReview .mx-orphan')) {
    const cb = row.querySelector('.mx-orphan-del');
    if (!cb || !cb.checked) continue;
    const id = Number(row.dataset.id);
    const res = await amApi(`/api/milestone-definitions/${id}`, { method: 'PATCH', body: { isActive: false } });
    if (!res.ok || res.data?.ok === false) { failed++; errs.push(`비활성#${id}: ${res.data?.error || '실패'}`); } else deactivated++;
  }

  const parts = [];
  if (created) parts.push(`${created}건 등록`);
  if (updated) parts.push(`${updated}건 수정`);
  if (deactivated) parts.push(`${deactivated}건 비활성`);
  amToast((parts.join(' · ') || '적용된 항목이 없습니다') + (failed ? ` (실패 ${failed}건)` : ''), failed ? 'error' : 'success');
  if (errs.length) console.warn('[매트릭스 적용 실패]', errs);
  document.getElementById('matrixModal').style.display = 'none';
  loadDefs();
}

document.getElementById('btnMatrixImport')?.addEventListener('click', openMatrixModal);
document.getElementById('matrixModalClose')?.addEventListener('click', () => { document.getElementById('matrixModal').style.display = 'none'; });
document.getElementById('matrixModalCancel')?.addEventListener('click', () => { document.getElementById('matrixModal').style.display = 'none'; });
document.getElementById('matrixParseBtn')?.addEventListener('click', runMatrixParse);
document.getElementById('matrixBackBtn')?.addEventListener('click', () => {
  document.getElementById('matrixReviewBox').style.display = 'none';
  document.getElementById('matrixInputBox').style.display = '';
});
document.getElementById('matrixApplyBtn')?.addEventListener('click', async () => {
  const btn = document.getElementById('matrixApplyBtn');
  const useCount = document.querySelectorAll('#matrixReview .mx-use:checked').length;
  const delCount = document.querySelectorAll('#matrixReview .mx-orphan-del:checked').length;
  if (!useCount && !delCount) { amToast('적용할 항목을 선택하세요.', 'error'); return; }
  if (!confirm(`선택 ${useCount}건 등록·수정${delCount ? ` + ${delCount}건 비활성화` : ''}를 적용할까요?`)) return;
  btn.disabled = true; btn.textContent = '적용 중…';
  try { await mxApply(); } finally { btn.disabled = false; btn.textContent = '선택 항목 적용'; }
});

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
    /* ★ R29-GAP-P1-H5: 기본 선택 — ACTIVE 우선, 없으면 최신 SETTLED */
    if (!sel.value) {
      const active = AM.quarters.find(q => q.status === 'ACTIVE');
      const latestSettled = [...AM.quarters]
        .filter(q => q.status === 'SETTLED')
        .sort((a, b) => (b.year - a.year) || (b.quarter - a.quarter))[0];
      const pick = active || latestSettled;
      if (pick) sel.value = String(pick.id);
    }
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
  /* R39 Stage 3: 결산 표 역할 동적 라벨 */
  const _roleLabel = (code) => code || '-';  // 결산 표는 코드만 보여주는 원본 동작 유지
  el.innerHTML = `
    <table class="ms-table">
      <thead><tr>
        <th>역할</th><th>담당자</th><th>분기</th><th>매출연동</th><th>비매출보너스</th><th>합계</th><th>상태</th><th>관리</th>
      </tr></thead>
      <tbody>
        ${list.map(s => `
          <tr>
            <td>${_roleLabel(s.milestoneRole)}</td>
            <td style="font-weight:600">${s.memberName || '-'}</td>
            <td style="font-size:12px">${s.year ? s.year + '년 Q' + s.quarter : '-'}</td>
            <td>${amFmt(s.revenueLinkedTotal)}</td>
            <td>${amFmt(s.nonRevenueTotal)}</td>
            <td style="font-weight:700">${amFmt(s.totalBonus)}</td>
            <td>${amBadge(s.status)}</td>
            <td>
              ${s.status === 'SUBMITTED' || s.status === 'REVIEWED' ? `
                <button class="ms-btn ms-btn-primary ms-btn-sm" onclick="approveSettlement(${s.id})">승인</button>
                <button class="ms-btn ms-btn-ghost ms-btn-sm" style="margin-left:4px;background:#fff7ed;color:#c2410c;border:1px solid #fed7aa" onclick="holdSettlement(${s.id})">⏸ 보류</button>
                <button class="ms-btn ms-btn-danger ms-btn-sm" style="margin-left:4px" onclick="rejectSettlement(${s.id})">반려</button>
              ` : ''}
              ${s.status === 'HOLD' ? `
                <div style="font-size:11px;color:#c2410c;margin-bottom:3px">사유: ${escHtmlAm(s.holdReason || '-')}</div>
                <button class="ms-btn ms-btn-ghost ms-btn-sm" onclick="resumeSettlement(${s.id})">재검토 복귀</button>
                <button class="ms-btn ms-btn-primary ms-btn-sm" style="margin-left:4px" onclick="approveSettlement(${s.id})">승인</button>
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

/* ───── 급여 내보내기 ───── */
document.getElementById('btnExportSalary')?.addEventListener('click', async () => {
  const quarterId = document.getElementById('settlQuarterFilter')?.value || '';
  const btn = document.getElementById('btnExportSalary');
  if (btn) btn.textContent = '내보내는 중...';
  try {
    const url = '/api/admin/milestone-settlement-export' + (quarterId ? `?quarterId=${quarterId}` : '');
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      amToast((err.error || '내보내기 실패'), 'error');
      return;
    }
    const blob = await res.blob();
    const a = document.createElement('a');
    const qLabel = quarterId ? `_Q${quarterId}` : '';
    a.href = URL.createObjectURL(blob);
    a.download = `milestone_salary${qLabel}_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    amToast('CSV 다운로드 완료', 'success');
  } catch (e) { amToast('내보내기 실패: ' + e.message, 'error'); }
  finally { if (btn) btn.textContent = '📥 급여 내보내기'; }
});

/* ───── AI 인사이트 ───── */
async function callAiInsight(type) {
  const quarterId = document.getElementById('settlQuarterFilter')?.value || '';
  const resultEl = document.getElementById('aiInsightResult');
  if (!resultEl) return;
  resultEl.innerHTML = '<span style="color:#6b7280">분석 중...</span>';

  const body = { type };
  if (type !== 'recommend' && quarterId) body.quarterId = Number(quarterId);

  try {
    const res = await amApi('/api/ai-milestone-insight', { method: 'POST', body });
    if (!res.ok) { resultEl.innerHTML = `<span style="color:#dc2626">오류: ${res.data?.error || '분석 실패'}</span>`; return; }
    const text = res.data?.data?.text || res.data?.text || '';
    const items = res.data?.data?.items || res.data?.items || [];
    if (items.length) {
      resultEl.innerHTML = `<ul style="margin:0;padding-left:18px">${items.map(it => `<li style="margin-bottom:4px">${escHtmlAm(it)}</li>`).join('')}</ul>`;
    } else {
      resultEl.innerHTML = escHtmlAm(text).replace(/\n/g, '<br>') || '<span style="color:#9ca3af">결과 없음</span>';
    }
  } catch (e) { resultEl.innerHTML = `<span style="color:#dc2626">오류: ${e.message}</span>`; }
}

function escHtmlAm(s) {
  return String(s||'').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
}

document.getElementById('btnAiSummary')?.addEventListener('click', () => callAiInsight('summary'));
document.getElementById('btnAiAnomaly')?.addEventListener('click', () => callAiInsight('anomaly'));
document.getElementById('btnAiRecommend')?.addEventListener('click', () => callAiInsight('recommend'));

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

/* ★ R29-MS-GAP1-D: HOLD 처리 (자료 보완 요청) */
async function holdSettlement(id) {
  const holdReason = prompt('보류 사유를 입력하세요 (운영자에게 알림 전송):');
  if (!holdReason || !holdReason.trim()) return;
  const res = await amApi(`/api/admin-milestone-settlement/${id}/hold`, { method: 'POST', body: { holdReason: holdReason.trim() } });
  if (!res.ok) { amToast(res.data?.error || '실패', 'error'); return; }
  amToast('보류 처리되었습니다. 운영자에게 자료 보완 요청 알림이 발송되었습니다.', 'success');
  loadSettlements();
}

/* ★ R29-MS-GAP1-D: HOLD → REVIEWED 복귀 */
async function resumeSettlement(id) {
  if (!confirm('재검토 상태로 복귀시키시겠습니까?')) return;
  const res = await amApi(`/api/admin-milestone-settlement/${id}/resume`, { method: 'POST' });
  if (!res.ok) { amToast(res.data?.error || '실패', 'error'); return; }
  amToast('재검토 복귀되었습니다.', 'success');
  loadSettlements();
}

/* ───── 직원 역할·마일스톤 (역할 배정 + 직원별 정의 뷰 통합) ───── */
async function loadRoles() {
  const el = document.getElementById('rolesList');
  if (el) el.innerHTML = '<p style="color:#9ca3af;padding:20px">로딩 중...</p>';
  /* 멤버(운영자+어드민) + 전체 정의(비활성 포함) 병렬 로드 */
  const [memRes, defRes] = await Promise.all([
    amApi('/api/milestone-members'),
    amApi('/api/milestone-definitions?activeOnly=0'),
  ]);
  if (!memRes.ok) { if (el) el.innerHTML = '<p style="color:#dc2626">불러오기 실패</p>'; return; }
  AM.staffMembers = memRes.data?.data?.members || memRes.data?.members || [];
  AM.staffDefs = defRes.ok ? (defRes.data?.data?.milestones || defRes.data?.milestones || []) : [];
  renderRoles(AM.staffMembers);
}

function _staffRoleOptionsHtml(roles) {
  return '<option value="">미배정</option>'
    + (roles || []).map(r => `<option value="${r.code}">${r.code} (${r.name || r.code})</option>`).join('');
}

function renderRoles(members) {
  const el = document.getElementById('rolesList');
  if (!members.length) {
    el.innerHTML = '<p style="color:#9ca3af;text-align:center;padding:30px">운영 중인 멤버가 없습니다.</p>';
    return;
  }
  /* 역할별 활성 정의 수 집계 */
  const defCnt = {}, revCnt = {};
  (AM.staffDefs || []).forEach(d => {
    if (d.isActive === false) return;
    const r = d.targetMilestoneRole || d.milestoneRole;
    if (!r) return;
    defCnt[r] = (defCnt[r] || 0) + 1;
    if (d.category === 'REVENUE_LINKED') revCnt[r] = (revCnt[r] || 0) + 1;
  });
  /* 드롭다운 옵션 — 캐시된 카탈로그 우선, 이후 비동기 갱신 */
  const cachedRoles = (function () {
    try { return JSON.parse(sessionStorage.getItem('tbfa.milestoneRoles.v1') || '{}').roles || []; }
    catch (_) { return []; }
  })();
  const roleOptions = _staffRoleOptionsHtml(cachedRoles);
  el.innerHTML = `
    <table class="ms-table">
      <thead><tr>
        <th>이름</th><th>이메일</th><th>시스템 역할</th><th>성과 역할</th>
        <th style="text-align:right">정의 수</th><th style="text-align:right">매출연동</th><th>관리</th>
      </tr></thead>
      <tbody>
        ${members.map(m => {
          const mr = m.milestoneRole || '';
          const dCnt = mr ? (defCnt[mr] || 0) : 0;
          const rCnt = mr ? (revCnt[mr] || 0) : 0;
          const detailBtn = mr
            ? `<button class="ms-btn ms-btn-ghost ms-btn-sm" style="margin-left:4px" onclick="openStaffDetail(${m.id})">상세</button>`
            : `<span style="color:#9ca3af;font-size:11.5px;margin-left:4px">역할 배정 필요</span>`;
          return `
          <tr>
            <td style="font-weight:600">${m.name || '-'}</td>
            <td style="font-size:12.5px;color:#6b7280">${m.email || '-'}</td>
            <td style="font-size:12.5px">${m.role || '-'}</td>
            <td>
              <select id="msRole_${m.id}" style="padding:5px 10px;border:1px solid #e5e7eb;border-radius:6px;font-size:13px">
                ${roleOptions}
              </select>
            </td>
            <td style="text-align:right;font-variant-numeric:tabular-nums">${dCnt}</td>
            <td style="text-align:right;font-variant-numeric:tabular-nums;color:#5b21b6">${rCnt}</td>
            <td>
              <button class="ms-btn ms-btn-primary ms-btn-sm" onclick="saveRole(${m.id})">저장</button>
              ${detailBtn}
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;

  function _applySelections() {
    members.forEach(m => {
      const sel = document.getElementById('msRole_' + m.id);
      if (sel && m.milestoneRole) sel.value = m.milestoneRole;
    });
  }
  _applySelections();
  if (window.MilestoneRoles) {
    window.MilestoneRoles.loadActiveRoles().then(function (roles) {
      if (!roles.length) return;
      members.forEach(m => {
        const sel = document.getElementById('msRole_' + m.id);
        if (sel) sel.innerHTML = _staffRoleOptionsHtml(roles);
      });
      _applySelections();
    });
  }
}

async function saveRole(memberId) {
  const sel = document.getElementById('msRole_' + memberId);
  const milestoneRole = sel?.value || null;
  /* 단일 endpoint(admin-milestone-role-assign)로 통일 */
  const res = await amApi('/api/admin-milestone-role-assign', {
    method: 'PUT',
    body: { memberId, milestoneRole: milestoneRole || null },
  });
  if (!res.ok || res.data?.ok === false) { amToast((res.data?.error || '저장 실패'), 'error'); return; }
  amToast('역할이 저장되었습니다.', 'success');
  /* 로컬 반영 후 정의 수 카운트 갱신 */
  const m = (AM.staffMembers || []).find(x => x.id === memberId);
  if (m) m.milestoneRole = milestoneRole;
  renderRoles(AM.staffMembers);
}

/* ── 직원별 마일스톤 상세 모달 (설정 화면 bymember 이식) ── */
window.openStaffDetail = function (memberId) {
  const m = (AM.staffMembers || []).find(x => x.id === memberId);
  if (!m || !m.milestoneRole) { amToast('먼저 성과 역할을 배정·저장하세요.', 'error'); return; }
  AM.bmCurrent = m;
  document.getElementById('byMemberModalTitle').textContent = `${m.name}의 ${m.milestoneRole} 마일스톤`;
  document.getElementById('byMemberModalSubtitle').textContent =
    `${m.email} · 성과 역할 ${m.milestoneRole} — 담당 마일스톤 정의 일람`;
  renderStaffDefs(m.milestoneRole);
  document.getElementById('byMemberModal').style.display = 'block';
};

function renderStaffDefs(role) {
  const el = document.getElementById('byMemberDefsList');
  const catLabel = { REVENUE_LINKED: '매출연동', NON_REVENUE: '비매출' };
  const rows = (AM.staffDefs || []).filter(d => (d.targetMilestoneRole || d.milestoneRole) === role);
  if (!rows.length) {
    el.innerHTML = `<p style="color:#9ca3af;text-align:center;padding:24px">${role} 역할로 정의된 마일스톤이 없습니다. 우측 상단 [+ 마일스톤 추가]로 추가하세요.</p>`;
    return;
  }
  el.innerHTML = `
    <table class="ms-table">
      <thead><tr>
        <th>활성</th><th>코드</th><th>이름</th><th>카테고리</th><th>목표값</th><th>분기</th><th>관리</th>
      </tr></thead>
      <tbody>
        ${rows.map(d => {
          const active = d.isActive !== false;
          const activeBadge = active
            ? '<span style="background:#f0fdf4;color:#15803d;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600">활성</span>'
            : '<span style="background:#f3f4f6;color:#9ca3af;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600">비활성</span>';
          const threshold = d.thresholdEnabled
            ? `${d.thresholdValue ?? '-'} ${d.thresholdUnit || ''}`
            : '<span style="color:#9ca3af">-</span>';
          return `
          <tr${active ? '' : ' style="opacity:.6"'}>
            <td>${activeBadge}</td>
            <td style="font-family:monospace;font-size:12px;color:#6b7280">${d.code}</td>
            <td style="font-weight:600">${d.name}</td>
            <td>${catLabel[d.category] || d.category}</td>
            <td style="font-size:12.5px">${threshold}</td>
            <td style="font-size:12.5px;color:#6b7280">${d.quarterApplicable || '전체'}</td>
            <td>
              <button class="ms-btn ms-btn-ghost ms-btn-sm" onclick="bmEditDef(${d.id})">편집</button>
              <button class="ms-btn ${active ? 'ms-btn-danger' : 'ms-btn-primary'} ms-btn-sm" style="margin-left:4px" onclick="bmToggleDef(${d.id})">${active ? '비활성화' : '활성화'}</button>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

window.bmEditDef = function (id) {
  /* 정의 탭 목록(AM.defs)에 없으면 상세 목록(staffDefs)에서 채워 openDefEdit가 찾도록 보장 */
  const d = (AM.staffDefs || []).find(x => x.id === id);
  if (d && !(AM.defs || []).some(x => x.id === id)) AM.defs = (AM.defs || []).concat([d]);
  document.getElementById('byMemberModal').style.display = 'none';
  openDefEdit(id);
};

window.bmToggleDef = async function (id) {
  const d = (AM.staffDefs || []).find(x => x.id === id);
  if (!d) return;
  const next = d.isActive === false;
  if (!confirm(`[${d.name}] 마일스톤을 ${next ? '활성화' : '비활성화'}하시겠습니까?`)) return;
  const res = await amApi(`/api/milestone-definitions/${id}`, { method: 'PATCH', body: { isActive: next } });
  if (!res.ok || res.data?.ok === false) { amToast((res.data?.error || '변경 실패'), 'error'); return; }
  amToast(next ? '활성화되었습니다.' : '비활성화되었습니다.', 'success');
  const defRes = await amApi('/api/milestone-definitions?activeOnly=0');
  AM.staffDefs = defRes.data?.data?.milestones || defRes.data?.milestones || [];
  if (AM.bmCurrent) renderStaffDefs(AM.bmCurrent.milestoneRole);
  renderRoles(AM.staffMembers);
};

document.getElementById('byMemberModalClose')?.addEventListener('click', () => {
  document.getElementById('byMemberModal').style.display = 'none';
});
document.getElementById('byMemberModal')?.addEventListener('click', function (e) {
  if (e.target === this) this.style.display = 'none';
});
document.getElementById('btnBmAddDef')?.addEventListener('click', () => {
  if (!AM.bmCurrent) return;
  document.getElementById('byMemberModal').style.display = 'none';
  openDefEdit(null);
  const sel = document.getElementById('fRole');
  if (sel && AM.bmCurrent.milestoneRole) sel.value = AM.bmCurrent.milestoneRole;
});

/* ───── 초기 로드 ───── */
/* R39 Stage 3: 정의 모달·필터 드롭다운 동적 채움 */
(function fillRoleDropdownsDynamic() {
  if (!window.MilestoneRoles) return;
  window.MilestoneRoles.loadActiveRoles().then(function (roles) {
    if (!roles.length) return;
    // 정의 모달 fRole — 미배정 옵션 없음
    const fRole = document.getElementById('fRole');
    if (fRole) {
      fRole.innerHTML = roles.map(r =>
        `<option value="${r.code}">${r.code} (${r.name || r.code})</option>`
      ).join('');
    }
    // 정의 필터 defRoleFilter — 전체 옵션 + 역할들
    const filter = document.getElementById('defRoleFilter');
    if (filter) {
      const cur = filter.value;
      filter.innerHTML = '<option value="">전체 역할</option>'
        + roles.map(r => `<option value="${r.code}">${r.code} (${r.name || r.code})</option>`).join('');
      if (cur) filter.value = cur;
    }
    // 매트릭스 분석 역할 힌트 (③) — 자동 판별 + 역할들
    const mHint = document.getElementById('matrixRoleHint');
    if (mHint) {
      mHint.innerHTML = '<option value="">자동 판별</option>'
        + roles.map(r => `<option value="${r.code}">${r.code} (${r.name || r.code})</option>`).join('');
    }
  });
})();

loadDefs();

/* ════════════════════════════════════════
   R39 Stage 8: 비매출 검토 패널
   - GET /api/admin-milestone-nonrevenue?status=&quarterId=
   - POST /api/admin-milestone-nonrevenue/:id/review
   - POST /api/admin-milestone-nonrevenue/:id/verify
   - POST /api/admin-milestone-nonrevenue/:id/reject
   - PATCH /api/admin-milestone-nonrevenue/:id/event-range
   ════════════════════════════════════════ */
const NR = { rows: [], current: null };

function nrEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function nrStatusBadge(s) {
  const map = {
    PENDING:  ['#fef3c7','#92400e','검토 대기'],
    REVIEWED: ['#dbeafe','#1d4ed8','1차 검토'],
    VERIFIED: ['#dcfce7','#15803d','최종 승인'],
    REJECTED: ['#fee2e2','#b91c1c','반려'],
  };
  const [bg,c,l] = map[s] || ['#f3f4f6','#6b7280', s || '—'];
  return `<span style="background:${bg};color:${c};padding:2px 8px;border-radius:12px;font-size:11.5px;font-weight:600">${l}</span>`;
}

async function nrLoad() {
  const status = document.getElementById('nrStatusFilter')?.value || 'PENDING';
  const quarterId = document.getElementById('nrQuarterFilter')?.value || '';
  const qs = '?status=' + encodeURIComponent(status) + (quarterId ? '&quarterId=' + encodeURIComponent(quarterId) : '');
  const el = document.getElementById('nrList');
  if (el) el.textContent = '로딩 중...';
  const res = await amApi('/api/admin-milestone-nonrevenue' + qs);
  if (!res.ok) {
    if (el) el.innerHTML = '<p style="color:#dc2626">조회 실패: ' + nrEsc(res.data?.error || '') + '</p>';
    return;
  }
  NR.rows = res.data?.data?.achievements || [];
  nrRender();
  // 분기 필터 동적 채움 (분기 일람 활용)
  nrFillQuarterFilter();
}

async function nrFillQuarterFilter() {
  const sel = document.getElementById('nrQuarterFilter');
  if (!sel || sel.options.length > 1) return; // 이미 채워졌으면 스킵
  try {
    if (!AM.quarters || !AM.quarters.length) {
      const r = await amApi('/api/milestone-quarters');
      AM.quarters = r.data?.data?.quarters || r.data?.quarters || [];
    }
    const cur = sel.value;
    sel.innerHTML = '<option value="">전체 분기</option>'
      + AM.quarters.map(q => `<option value="${q.id}">${q.year} Q${q.quarter}</option>`).join('');
    if (cur) sel.value = cur;
  } catch (_) {}
}

function nrRender() {
  const el = document.getElementById('nrList');
  const cntEl = document.getElementById('nrCount');
  if (cntEl) cntEl.textContent = (NR.rows.length || 0) + '건';
  if (!NR.rows.length) {
    el.innerHTML = '<p style="color:#9ca3af;text-align:center;padding:30px">해당 상태의 비매출 성과가 없습니다.</p>';
    return;
  }
  el.innerHTML = `
    <table class="ms-table">
      <thead><tr>
        <th>제출자</th><th>역할</th><th>마일스톤</th><th>달성일</th>
        <th style="text-align:right">금액</th><th>상태</th><th>관리</th>
      </tr></thead>
      <tbody>
        ${NR.rows.map(r => `
          <tr>
            <td style="font-weight:600">${nrEsc(r.submittedByName || '—')}</td>
            <td>${nrEsc(r.milestoneRole || '-')}</td>
            <td>
              <code style="font-size:11.5px;background:#f1f5f9;padding:2px 5px;border-radius:4px">${nrEsc(r.milestoneCode || '')}</code>
              <span style="margin-left:5px">${nrEsc(r.milestoneName || '')}</span>
            </td>
            <td style="font-size:12.5px">${nrEsc(amDate(r.achievedDate))}</td>
            <td style="text-align:right;font-variant-numeric:tabular-nums">${amFmt(r.eventRangeAmount || r.bonusAmount)}</td>
            <td>${nrStatusBadge(r.status)}</td>
            <td><button class="ms-btn ms-btn-ghost ms-btn-sm" onclick="nrOpenDetail(${r.id})">상세</button></td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

window.nrOpenDetail = function (id) {
  const r = NR.rows.find(x => x.id === id);
  if (!r) return;
  NR.current = r;
  document.getElementById('nrModalId').value = id;

  const formulaType = (r.bonusFormula && (r.bonusFormula.type || r.bonusFormula.kind)) || '';
  const isEventRange = String(formulaType).toUpperCase() === 'EVENT_RANGE';

  const body = document.getElementById('nrModalBody');
  body.innerHTML = `
    <div style="display:grid;grid-template-columns:120px 1fr;gap:8px 16px">
      <div style="color:#9ca3af">제출자</div><div><strong>${nrEsc(r.submittedByName || '—')}</strong></div>
      <div style="color:#9ca3af">담당 역할</div><div>${nrEsc(r.milestoneRole || '-')}</div>
      <div style="color:#9ca3af">마일스톤</div><div><code style="background:#f1f5f9;padding:2px 6px;border-radius:4px">${nrEsc(r.milestoneCode || '')}</code> ${nrEsc(r.milestoneName || '')}</div>
      <div style="color:#9ca3af">달성일</div><div>${nrEsc(amDate(r.achievedDate))}</div>
      <div style="color:#9ca3af">현재 상태</div><div>${nrStatusBadge(r.status)}</div>
      <div style="color:#9ca3af">기본 금액</div><div style="font-variant-numeric:tabular-nums">${amFmt(r.bonusAmount)}</div>
      ${isEventRange ? `<div style="color:#9ca3af">EVENT_RANGE 금액</div><div style="font-variant-numeric:tabular-nums">${r.eventRangeAmount != null ? amFmt(r.eventRangeAmount) : '<span style="color:#dc2626">미설정 — 슈퍼어드민이 결정 필요</span>'}</div>` : ''}
      <div style="color:#9ca3af">공식</div><div style="font-size:12px;color:#6b7280">${nrEsc(formulaType || '—')}</div>
    </div>
    <div style="margin-top:14px">
      <div style="color:#9ca3af;font-size:12px;margin-bottom:4px">내용</div>
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:10px;font-size:13px;white-space:pre-wrap">${nrEsc(r.description || '—')}</div>
    </div>
    ${r.evidenceFiles && r.evidenceFiles.length ? `
      <div style="margin-top:10px">
        <div style="color:#9ca3af;font-size:12px;margin-bottom:4px">증빙 파일 (${r.evidenceFiles.length})</div>
        <ul style="margin:0;padding-left:18px;font-size:12.5px">
          ${r.evidenceFiles.map(f => `<li><a href="${nrEsc(f.url || f)}" target="_blank">${nrEsc(f.name || f.url || f)}</a></li>`).join('')}
        </ul>
      </div>` : ''}
    ${r.rejectReason ? `
      <div style="margin-top:10px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:10px;font-size:12.5px;color:#b91c1c">
        <strong>이전 반려 사유:</strong> ${nrEsc(r.rejectReason)}
      </div>` : ''}
  `;

  // EVENT_RANGE 금액 결정 영역 토글
  const evBox = document.getElementById('nrEventRangeBox');
  evBox.style.display = isEventRange ? '' : 'none';
  document.getElementById('nrEventRangeAmount').value = r.eventRangeAmount || '';
  document.getElementById('nrEventRangeHint').textContent =
    'EVENT_RANGE 마일스톤 — 슈퍼어드민이 직접 금액을 결정한 뒤 최종 승인하세요.';

  // 액션 버튼 활성/비활성 (상태별)
  const btnReview = document.getElementById('nrBtnReview');
  const btnVerify = document.getElementById('nrBtnVerify');
  const btnReject = document.getElementById('nrBtnReject');
  btnReview.disabled = (r.status !== 'PENDING');
  btnVerify.disabled = !(r.status === 'PENDING' || r.status === 'REVIEWED');
  btnReject.disabled = (r.status === 'VERIFIED' || r.status === 'REJECTED');

  document.getElementById('nrDetailModal').style.display = 'block';
};

function nrCloseDetail() {
  document.getElementById('nrDetailModal').style.display = 'none';
  NR.current = null;
}

async function nrAction(action) {
  if (!NR.current) return;
  const id = NR.current.id;
  let body = null;
  if (action === 'reject') {
    const reason = prompt('반려 사유를 입력하세요 (필수):', '');
    if (reason == null) return;
    if (!reason.trim()) { amToast('반려 사유 필수', 'error'); return; }
    body = { rejectReason: reason.trim() };
  }
  const res = await amApi('/api/admin-milestone-nonrevenue/' + id + '/' + action, {
    method: 'POST',
    body: body || undefined,
  });
  if (!res.ok) { amToast('처리 실패: ' + (res.data?.error || ''), 'error'); return; }
  amToast(action === 'verify' ? '최종 승인 완료' : action === 'reject' ? '반려 처리 완료' : '1차 검토 완료', 'success');
  nrCloseDetail();
  await nrLoad();
}

async function nrSetEventRangeAmount() {
  if (!NR.current) return;
  const id = NR.current.id;
  const amt = parseFloat(document.getElementById('nrEventRangeAmount').value);
  if (!Number.isFinite(amt) || amt < 0) { amToast('금액을 올바르게 입력하세요', 'error'); return; }
  const res = await amApi('/api/admin-milestone-nonrevenue/' + id + '/event-range', {
    method: 'PATCH',
    body: { eventRangeAmount: amt },
  });
  if (!res.ok) { amToast('금액 저장 실패: ' + (res.data?.error || ''), 'error'); return; }
  amToast('EVENT_RANGE 금액 저장 완료 (' + amt.toLocaleString('ko-KR') + '원)', 'success');
  // current 갱신
  NR.current.eventRangeAmount = String(amt);
  // 모달 본문 일부만 다시 그림
  nrOpenDetail(id);
}

document.getElementById('nrStatusFilter')?.addEventListener('change', nrLoad);
document.getElementById('nrQuarterFilter')?.addEventListener('change', nrLoad);
document.getElementById('btnNrReload')?.addEventListener('click', nrLoad);
document.getElementById('nrModalClose')?.addEventListener('click', nrCloseDetail);
document.getElementById('nrDetailModal')?.addEventListener('click', function (e) {
  if (e.target === this) nrCloseDetail();
});
document.getElementById('nrBtnReview')?.addEventListener('click', () => nrAction('review'));
document.getElementById('nrBtnVerify')?.addEventListener('click', () => nrAction('verify'));
document.getElementById('nrBtnReject')?.addEventListener('click', () => nrAction('reject'));
document.getElementById('nrBtnSetAmount')?.addEventListener('click', nrSetEventRangeAmount);

// URL 해시로 초기 탭 설정
const hash = location.hash.replace('#', '');
if (hash) {
  const btn = document.querySelector(`.adm-tab[data-panel="${hash}"]`);
  if (btn) btn.click();
}

/* ════════════════════════════════════════
   역할 카탈로그 관리 (설정 화면 rolemgmt 이식)
   - /api/milestone-roles GET·POST·PATCH·DELETE
   - 변경 시 sessionStorage 캐시 무효화 + 정의 모달·필터 드롭다운 재구성
   ════════════════════════════════════════ */
async function loadRoleMgmt() {
  const el = document.getElementById('roleMgmtList');
  if (el) el.innerHTML = '<p style="color:#9ca3af;padding:20px">로딩 중...</p>';
  const res = await amApi('/api/milestone-roles?includeInactive=1');
  if (!res.ok) { if (el) el.innerHTML = '<p style="color:#dc2626">불러오기 실패</p>'; return; }
  renderRoleMgmt(res.data?.data?.roles || []);
}

function renderRoleMgmt(roles) {
  const el = document.getElementById('roleMgmtList');
  AM._rolesById = {};
  roles.forEach(r => { AM._rolesById[r.id] = r; });
  if (!roles.length) {
    el.innerHTML = '<p style="color:#9ca3af;text-align:center;padding:30px">등록된 역할이 없습니다. "+ 신규 등록"으로 추가하세요.</p>';
    return;
  }
  el.innerHTML = `
    <table class="ms-table">
      <thead><tr>
        <th style="width:90px">코드</th><th>이름</th><th>설명</th>
        <th style="width:110px">매출 캡</th><th style="width:110px">비매출 캡</th>
        <th style="text-align:right;width:70px">정렬</th><th style="width:70px">활성</th><th style="width:170px">관리</th>
      </tr></thead>
      <tbody>
        ${roles.map(r => {
          const activeBadge = r.isActive
            ? '<span style="background:#f0fdf4;color:#15803d;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600">활성</span>'
            : '<span style="background:#f3f4f6;color:#9ca3af;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600">비활성</span>';
          const toggleBtn = r.isActive
            ? `<button class="ms-btn ms-btn-danger ms-btn-sm" style="margin-left:4px" onclick="deactivateRoleCat(${r.id})">비활성화</button>`
            : `<button class="ms-btn ms-btn-primary ms-btn-sm" style="margin-left:4px" onclick="reactivateRoleCat(${r.id})">활성화</button>`;
          const rcap = r.revenueCap ?? r.revenue_cap ?? null;
          const nrcap = r.nonRevenueCap ?? r.non_revenue_cap ?? null;
          const fmtCap = (v) => v != null ? (Math.round(v / 10000).toLocaleString('ko-KR') + '만원') : '<span style="color:#9ca3af">무제한</span>';
          return `
          <tr${r.isActive ? '' : ' style="opacity:.6"'}>
            <td style="font-family:monospace;font-size:12.5px;font-weight:600">${r.code}</td>
            <td style="font-weight:600">${r.name}</td>
            <td style="font-size:12.5px;color:#6b7280">${r.description || '-'}</td>
            <td style="font-size:12.5px">${fmtCap(rcap)}</td>
            <td style="font-size:12.5px">${fmtCap(nrcap)}</td>
            <td style="text-align:right">${r.sortOrder ?? 0}</td>
            <td>${activeBadge}</td>
            <td>
              <button class="ms-btn ms-btn-ghost ms-btn-sm" onclick="editRoleCat(${r.id})">편집</button>
              ${toggleBtn}
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

function openAddRoleCat() {
  AM.editingRoleId = null;
  document.getElementById('roleModalTitle').textContent = '역할 등록';
  document.getElementById('roleId').value = '';
  document.getElementById('roleCode').value = '';
  document.getElementById('roleCode').disabled = false;
  document.getElementById('roleName').value = '';
  document.getElementById('roleDescription').value = '';
  document.getElementById('roleSortOrder').value = '0';
  document.getElementById('roleIsActive').checked = true;
  document.getElementById('roleActiveGroup').style.display = 'none';
  document.getElementById('roleRevenueCap').value = '';
  document.getElementById('roleNonRevenueCap').value = '';
  document.getElementById('roleModal').style.display = 'block';
  setTimeout(() => document.getElementById('roleCode').focus(), 50);
}

window.editRoleCat = function (id) {
  const r = AM._rolesById && AM._rolesById[id];
  if (!r) return;
  AM.editingRoleId = id;
  document.getElementById('roleModalTitle').textContent = '역할 편집';
  document.getElementById('roleId').value = id;
  document.getElementById('roleCode').value = r.code;
  document.getElementById('roleCode').disabled = true; // 코드는 변경 불가
  document.getElementById('roleName').value = r.name || '';
  document.getElementById('roleDescription').value = r.description || '';
  document.getElementById('roleSortOrder').value = r.sortOrder ?? 0;
  document.getElementById('roleIsActive').checked = !!r.isActive;
  document.getElementById('roleActiveGroup').style.display = '';
  /* 캡: 원 단위 API 값 → 만원 단위로 표시 (null/undefined → 빈칸) */
  const rcap = r.revenueCap ?? r.revenue_cap ?? null;
  const nrcap = r.nonRevenueCap ?? r.non_revenue_cap ?? null;
  document.getElementById('roleRevenueCap').value = rcap != null ? Math.round(rcap / 10000) : '';
  document.getElementById('roleNonRevenueCap').value = nrcap != null ? Math.round(nrcap / 10000) : '';
  document.getElementById('roleModal').style.display = 'block';
};

async function saveRoleCat() {
  const codeRaw = (document.getElementById('roleCode').value || '').trim().toUpperCase();
  const name = (document.getElementById('roleName').value || '').trim();
  const description = (document.getElementById('roleDescription').value || '').trim();
  const sortOrder = Number(document.getElementById('roleSortOrder').value || 0);
  const isActive = document.getElementById('roleIsActive').checked;

  /* 캡: 만원 입력 → 원 환산. 빈칸 = null(무제한) */
  const rcapMan = document.getElementById('roleRevenueCap').value.trim();
  const nrcapMan = document.getElementById('roleNonRevenueCap').value.trim();
  const revenueCap = rcapMan !== '' ? Math.round(Number(rcapMan) * 10000) : null;
  const nonRevenueCap = nrcapMan !== '' ? Math.round(Number(nrcapMan) * 10000) : null;

  if (!AM.editingRoleId && !/^[A-Z]{2,10}$/.test(codeRaw)) {
    amToast('코드는 영문 대문자 2~10자 (예: SM, MARKETING)', 'error'); return;
  }
  if (!name) { amToast('이름은 필수입니다.', 'error'); return; }
  if (name.length > 50) { amToast('이름은 50자 이내', 'error'); return; }

  const res = AM.editingRoleId
    ? await amApi(`/api/milestone-roles/${AM.editingRoleId}`, {
        method: 'PATCH', body: { name, description: description || null, sortOrder, isActive, revenueCap, nonRevenueCap },
      })
    : await amApi('/api/milestone-roles', {
        method: 'POST', body: { code: codeRaw, name, description: description || null, sortOrder, revenueCap, nonRevenueCap },
      });
  if (!res.ok || res.data?.ok === false) { amToast((res.data?.error || '저장 실패'), 'error'); return; }
  amToast(AM.editingRoleId ? '역할 수정 완료' : '역할 등록 완료', 'success');
  document.getElementById('roleModal').style.display = 'none';
  await _afterRoleCatChange();
}

window.deactivateRoleCat = async function (id) {
  const r = AM._rolesById && AM._rolesById[id];
  if (!r) return;
  if (!confirm(`[${r.code} (${r.name})] 역할을 비활성화하시겠습니까?\n과거 결산·정의는 보존되고 드롭다운에서만 사라집니다.`)) return;
  const res = await amApi(`/api/milestone-roles/${id}`, { method: 'DELETE' });
  if (!res.ok || res.data?.ok === false) { amToast((res.data?.error || '비활성화 실패'), 'error'); return; }
  amToast('비활성화 완료', 'success');
  await _afterRoleCatChange();
};

window.reactivateRoleCat = async function (id) {
  const res = await amApi(`/api/milestone-roles/${id}`, { method: 'PATCH', body: { isActive: true } });
  if (!res.ok || res.data?.ok === false) { amToast((res.data?.error || '활성화 실패'), 'error'); return; }
  amToast('활성화 완료', 'success');
  await _afterRoleCatChange();
};

async function _afterRoleCatChange() {
  if (window.MilestoneRoles) window.MilestoneRoles.invalidateCache();
  await loadRoleMgmt();
  const roles = window.MilestoneRoles ? await window.MilestoneRoles.loadActiveRoles() : [];
  _refillDefRoleDropdowns(roles);
}

function _refillDefRoleDropdowns(roles) {
  const fRole = document.getElementById('fRole');
  if (fRole) {
    const cur = fRole.value;
    fRole.innerHTML = (roles || []).map(r => `<option value="${r.code}">${r.code} (${r.name || r.code})</option>`).join('');
    if (cur) fRole.value = cur;
  }
  const filter = document.getElementById('defRoleFilter');
  if (filter) {
    const cur = filter.value;
    filter.innerHTML = '<option value="">전체 역할</option>'
      + (roles || []).map(r => `<option value="${r.code}">${r.code} (${r.name || r.code})</option>`).join('');
    if (cur) filter.value = cur;
  }
}

/* 역할 카탈로그 모달 이벤트 */
document.getElementById('btnAddRole')?.addEventListener('click', openAddRoleCat);
document.getElementById('btnRoleCancel')?.addEventListener('click', () => {
  document.getElementById('roleModal').style.display = 'none';
});
document.getElementById('btnRoleSave')?.addEventListener('click', saveRoleCat);
document.getElementById('roleModal')?.addEventListener('click', function (e) {
  if (e.target === this) this.style.display = 'none';
});
document.getElementById('roleCode')?.addEventListener('input', function (e) {
  const up = e.target.value.toUpperCase().replace(/[^A-Z]/g, '');
  if (e.target.value !== up) e.target.value = up;
});

/* ════════════════════════════════════════
   매출 검토 패널 (워크스페이스 검토 UI를 통합 화면으로 이관 — 갭2)
   - GET  /api/admin-milestone-revenue?status=&quarterId=
   - POST /api/admin-milestone-revenue/:id/verify
   - POST /api/admin-milestone-revenue/:id/reject { rejectReason }
   - PUT  /api/admin-milestone-revenue/:id { eventRangeAmount }  (EVENT_RANGE·super only)
   ════════════════════════════════════════ */
const RV = { rows: [] };

async function rvLoad() {
  const status = document.getElementById('rvStatusFilter')?.value || 'PENDING';
  const quarterId = document.getElementById('rvQuarterFilter')?.value || '';
  const qs = '?status=' + encodeURIComponent(status) + (quarterId ? '&quarterId=' + encodeURIComponent(quarterId) : '');
  const el = document.getElementById('rvList');
  if (el) el.textContent = '로딩 중...';
  const res = await amApi('/api/admin-milestone-revenue' + qs);
  if (!res.ok) {
    if (el) el.innerHTML = '<p style="color:#dc2626">조회 실패: ' + escHtmlAm(res.data?.error || '') + '</p>';
    return;
  }
  RV.rows = res.data?.data?.entries || res.data?.entries || [];
  rvRender();
  rvFillQuarterFilter();
}

async function rvFillQuarterFilter() {
  const sel = document.getElementById('rvQuarterFilter');
  if (!sel || sel.options.length > 1) return; // 이미 채워졌으면 스킵
  try {
    if (!AM.quarters || !AM.quarters.length) {
      const r = await amApi('/api/milestone-quarters');
      AM.quarters = r.data?.data?.quarters || r.data?.quarters || [];
    }
    const cur = sel.value;
    sel.innerHTML = '<option value="">전체 분기</option>'
      + AM.quarters.map(q => `<option value="${q.id}">${q.year} Q${q.quarter}</option>`).join('');
    if (cur) sel.value = cur;
  } catch (_) {}
}

function rvStatusBadge(s) {
  const map = { PENDING: ['#fef3c7','#92400e','대기'], VERIFIED: ['#dcfce7','#15803d','완료'], REJECTED: ['#fee2e2','#b91c1c','반려'] };
  const [bg, c, l] = map[s] || ['#f3f4f6','#6b7280', s || '—'];
  return `<span style="background:${bg};color:${c};padding:2px 8px;border-radius:12px;font-size:11.5px;font-weight:600">${l}</span>`;
}

function rvRender() {
  const el = document.getElementById('rvList');
  const cntEl = document.getElementById('rvCount');
  if (cntEl) cntEl.textContent = (RV.rows.length || 0) + '건';
  if (!RV.rows.length) {
    el.innerHTML = '<p style="color:#9ca3af;text-align:center;padding:30px">해당 상태의 매출 실적이 없습니다.</p>';
    return;
  }
  el.innerHTML = `
    <table class="ms-table">
      <thead><tr>
        <th>날짜</th><th>입력자</th><th>마일스톤</th><th style="text-align:right">금액</th><th>증빙</th><th>상태</th><th>관리</th>
      </tr></thead>
      <tbody>
        ${RV.rows.map(e => {
          const formula = e.bonusFormula || {};
          const isEventRange = String(formula.type || formula.formula_type || '').toUpperCase() === 'EVENT_RANGE';
          const rangeMin = Number(formula.minAmount ?? formula.min ?? 0);
          const rangeMax = Number(formula.maxAmount ?? formula.max ?? 0);
          const evidence = Array.isArray(e.evidenceFiles) ? e.evidenceFiles : [];
          const evidenceHtml = evidence.length
            ? evidence.map(f => `<a href="${escHtmlAm(f.url || f)}" target="_blank" style="font-size:11.5px;margin-right:6px">📎${escHtmlAm(f.name || '파일')}</a>`).join('')
            : '<span style="color:#9ca3af;font-size:11.5px">없음</span>';
          let actions;
          if (e.status === 'PENDING') {
            if (isEventRange) {
              actions = `
                <div style="font-size:11px;color:#7c3aed;margin-bottom:3px">범위 ${(rangeMin/10000).toLocaleString()}~${(rangeMax/10000).toLocaleString()}만원 (원 단위 입력)</div>
                <input type="number" id="rvEvAmt_${e.id}" placeholder="원 단위 금액" min="${rangeMin}" max="${rangeMax}" style="width:130px;padding:4px 8px;border:1px solid #d1d5db;border-radius:6px;font-size:12.5px">
                <button class="ms-btn ms-btn-primary ms-btn-sm" style="margin-left:4px" onclick="rvEventRange(${e.id})">검증+금액확정</button>
                <button class="ms-btn ms-btn-danger ms-btn-sm" style="margin-left:4px" onclick="rvReject(${e.id})">반려</button>`;
            } else {
              actions = `
                <button class="ms-btn ms-btn-primary ms-btn-sm" onclick="rvVerify(${e.id})">✅ 승인</button>
                <button class="ms-btn ms-btn-danger ms-btn-sm" style="margin-left:4px" onclick="rvReject(${e.id})">반려</button>`;
            }
          } else if (e.status === 'REJECTED' && e.rejectReason) {
            actions = `<span style="font-size:11px;color:#b91c1c">사유: ${escHtmlAm(e.rejectReason)}</span>`;
          } else {
            actions = '<span style="color:#9ca3af;font-size:12px">—</span>';
          }
          return `
          <tr>
            <td style="font-size:12px;white-space:nowrap">${amDate(e.revenueDate)}</td>
            <td style="font-size:12.5px">${escHtmlAm(e.enteredByName || '—')}</td>
            <td><code style="font-size:11.5px;background:#f1f5f9;padding:2px 5px;border-radius:4px">${escHtmlAm(e.milestoneCode || '')}</code> ${escHtmlAm(e.milestoneName || '')}</td>
            <td style="text-align:right;font-weight:600;font-variant-numeric:tabular-nums">${Number(e.amount || 0).toLocaleString()} ${escHtmlAm(e.amountUnit || '원')}</td>
            <td>${evidenceHtml}</td>
            <td>${rvStatusBadge(e.status)}</td>
            <td>${actions}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

window.rvVerify = async function (id) {
  if (!confirm('이 매출 실적을 검증(승인) 처리하시겠습니까?')) return;
  const res = await amApi(`/api/admin-milestone-revenue/${id}/verify`, { method: 'POST' });
  if (!res.ok || res.data?.ok === false) { amToast((res.data?.error || '승인 실패'), 'error'); return; }
  amToast('매출 검증 완료', 'success');
  await rvLoad();
};

window.rvReject = async function (id) {
  const reason = prompt('반려 사유를 입력하세요 (필수):', '');
  if (reason == null) return;
  if (!reason.trim()) { amToast('반려 사유 필수', 'error'); return; }
  const res = await amApi(`/api/admin-milestone-revenue/${id}/reject`, { method: 'POST', body: { rejectReason: reason.trim() } });
  if (!res.ok || res.data?.ok === false) { amToast((res.data?.error || '반려 실패'), 'error'); return; }
  amToast('반려 처리 완료', 'success');
  await rvLoad();
};

window.rvEventRange = async function (id) {
  const input = document.getElementById(`rvEvAmt_${id}`);
  const amt = input ? Number(input.value) : 0;
  if (!Number.isFinite(amt) || amt <= 0) { amToast('금액을 입력하세요', 'error'); return; }
  const minA = Number(input.min || 0), maxA = Number(input.max || 0);
  if (maxA > 0 && (amt < minA || amt > maxA)) {
    amToast(`범위 내 금액을 입력하세요 (${(minA/10000).toLocaleString()}~${(maxA/10000).toLocaleString()}만원)`, 'error'); return;
  }
  const res = await amApi(`/api/admin-milestone-revenue/${id}`, { method: 'PUT', body: { eventRangeAmount: amt } });
  if (!res.ok || res.data?.ok === false) { amToast((res.data?.error || '금액 확정 실패'), 'error'); return; }
  amToast('검증 및 금액 확정 완료', 'success');
  await rvLoad();
};

document.getElementById('rvStatusFilter')?.addEventListener('change', rvLoad);
document.getElementById('rvQuarterFilter')?.addEventListener('change', rvLoad);
document.getElementById('btnRvReload')?.addEventListener('click', rvLoad);
