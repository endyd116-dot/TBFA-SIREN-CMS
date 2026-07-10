/* admin-budget-accounts.js — 예산과목 체계 관(款)-항(項)-목(目) 3계층 관리 (2026-07-01)
 * 예산안 고도화 배치1. API: /api/admin-budget-accounts (트리 조회·CRUD·계정과목 매핑)
 * window.SIREN_BUDGET_ACCOUNTS = { init, load }
 */
(function () {
  'use strict';

  let myRole = null;
  let treeCache = [];
  let curYear = new Date().getFullYear();
  const collapsed = {};   // { nodeId: true } 접힘 상태

  function api(method, path, body) {
    const opts = { method, credentials: 'include', headers: {} };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return fetch(path, opts).then(async r => {
      const data = await r.json().catch(() => null);
      return { ok: r.ok && data && data.ok !== false, status: r.status, data, error: data?.error };
    }).catch(e => ({ ok: false, error: String(e) }));
  }
  function fmtKRW(n) {
    if (n == null || n === '') return '0원';
    return Number(n).toLocaleString('ko-KR') + '원';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function canEdit() { return myRole === 'super_admin' || myRole === 'admin'; }

  async function loadMyRole() {
    if (myRole !== null) return;
    const res = await api('GET', '/api/admin/me');
    const me = res.ok ? (res.data?.data?.admin || res.data?.admin || res.data?.data || res.data) : null;
    myRole = me?.role || 'admin';
  }

  function renderShell(container) {
    const years = [];
    const y0 = new Date().getFullYear();
    for (let y = y0 + 1; y >= y0 - 3; y--) years.push(y);
    container.innerHTML = `
      <div class="panel">
        <div class="p-head">
          <div class="p-title">예산과목 체계 <span style="font-weight:400;color:var(--text-3);font-size:13px">관(款) · 항(項) · 목(目)</span></div>
          <div class="p-actions" style="display:flex;gap:8px;align-items:center">
            <select id="baYear" class="input-sm" style="width:110px">
              ${years.map(y => `<option value="${y}">${y}년 집행</option>`).join('')}
            </select>
            ${canEdit() ? '<button class="btn-sm btn-sm-primary" id="baAddGwan" type="button">+ 관 추가</button>' : ''}
          </div>
        </div>
        <div style="font-size:12px;color:var(--text-3);margin:2px 0 10px">
          목(目)에서 예산을 편성하고 지출이 물립니다. 계정과목을 목에 연결하면 AI 통장분류가 해당 예산 목으로 자동 배정됩니다.
        </div>
        <div id="baTree" style="margin-top:6px"></div>
      </div>`;
    document.getElementById('baYear').value = String(curYear);
    document.getElementById('baYear')?.addEventListener('change', e => {
      curYear = parseInt(e.target.value) || y0;
      loadTree();
    });
    document.getElementById('baAddGwan')?.addEventListener('click', () => addNode('관', null));
  }

  async function loadTree() {
    const el = document.getElementById('baTree');
    if (!el) return;
    el.innerHTML = '<div style="color:var(--text-3);padding:12px">불러오는 중…</div>';
    const res = await api('GET', `/api/admin-budget-accounts?fiscalYear=${curYear}`);
    if (!res.ok) {
      el.innerHTML = `<div style="color:var(--danger);padding:12px">조회 실패: ${esc(res.error || '')}</div>`;
      return;
    }
    treeCache = res.data?.data?.tree || res.data?.tree || [];
    renderTree(el);
  }

  function rateBar(node) {
    if (node.planned == null) return '';
    const rate = node.rate != null ? Math.round(node.rate * 100) : (node.planned > 0 ? Math.round((node.executed / node.planned) * 100) : 0);
    const over = (node.executed || 0) > (node.planned || 0) && (node.planned || 0) > 0;
    const color = over ? 'var(--danger)' : rate >= 90 ? 'var(--danger)' : rate >= 70 ? '#f59e0b' : 'var(--success)';
    return `
      <span style="color:var(--text-2);font-size:12px;min-width:96px;text-align:right">${fmtKRW(node.planned)}</span>
      <span style="color:var(--text-3);font-size:11px">/ 집행 ${fmtKRW(node.executed || 0)}</span>
      <span style="display:inline-flex;align-items:center;gap:6px;min-width:120px">
        <span style="flex:1;height:8px;border-radius:4px;background:#e5e7eb;overflow:hidden;display:inline-block;width:70px">
          <span style="display:block;height:100%;width:${Math.min(rate, 100)}%;background:${color}"></span>
        </span>
        <span style="color:${color};font-weight:600;font-size:12px">${rate}%${over ? ' ' : ''}</span>
      </span>`;
  }

  function nodeControls(node) {
    if (!canEdit()) return '';
    const A = 'window.SIREN_BUDGET_ACCOUNTS._';
    let btns = '';
    if (node.level === '관') btns += `<button class="btn-xs" onclick="${A}addChild(${node.id},'항')">+ 항</button>`;
    if (node.level === '항') btns += `<button class="btn-xs" onclick="${A}addChild(${node.id},'목')">+ 목</button>`;
    if (node.level === '목') btns += `<button class="btn-xs" onclick="${A}mapCode(${node.id})">+ 계정과목</button>`;
    btns += `<button class="btn-xs" onclick="${A}rename(${node.id})">이름</button>`;
    btns += `<button class="btn-xs" onclick="${A}toggleActive(${node.id},${node.isActive ? 'false' : 'true'})">${node.isActive ? '비활성' : '활성'}</button>`;
    btns += `<button class="btn-xs btn-xs-danger" onclick="${A}del(${node.id})">삭제</button>`;
    return `<span class="ba-ctrl" style="display:inline-flex;gap:4px;margin-left:8px">${btns}</span>`;
  }

  function mappedChips(node) {
    if (node.level !== '목' || !node.mappedCodes || !node.mappedCodes.length) return '';
    return `<span style="margin-left:8px">${node.mappedCodes.map(c =>
      `<span style="display:inline-block;background:#eef2ff;color:#4338ca;border-radius:10px;padding:1px 8px;font-size:11px;margin:1px 2px">${esc(c)}${canEdit() ? ` <a href="#" onclick="window.SIREN_BUDGET_ACCOUNTS._unmap(${node.id},'${esc(c)}');return false" style="color:#818cf8;text-decoration:none">×</a>` : ''}</span>`
    ).join('')}</span>`;
  }

  function renderNode(node, depth) {
    const pad = 8 + depth * 22;
    const hasKids = node.children && node.children.length;
    const isCol = collapsed[node.id];
    const levelColor = node.level === '관' ? '#7a1f2b' : node.level === '항' ? '#b45309' : '#374151';
    const levelBg = node.level === '관' ? '#fdf2f4' : node.level === '항' ? '#fffbeb' : '#f9fafb';
    const dim = node.isActive ? '' : 'opacity:.5';
    const toggle = hasKids
      ? `<span onclick="window.SIREN_BUDGET_ACCOUNTS._toggle(${node.id})" style="cursor:pointer;display:inline-block;width:16px;color:var(--text-3)">${isCol ? '▸' : '▾'}</span>`
      : '<span style="display:inline-block;width:16px"></span>';

    let html = `
      <div style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:8px;margin:2px 0;margin-left:${pad}px;background:${levelBg};${dim}">
        ${toggle}
        <span style="font-size:10px;font-weight:700;color:${levelColor};background:#fff;border:1px solid ${levelColor}33;border-radius:4px;padding:0 5px">${node.level}</span>
        <span style="font-size:10.5px;color:var(--text-3);font-family:monospace">${esc(node.code)}</span>
        <span style="font-weight:${node.level === '관' ? 700 : 500};font-size:13.5px">${esc(node.name)}</span>
        ${mappedChips(node)}
        <span style="flex:1"></span>
        ${rateBar(node)}
        ${nodeControls(node)}
      </div>`;
    if (hasKids && !isCol) {
      html += node.children.map(c => renderNode(c, depth + 1)).join('');
    }
    return html;
  }

  function renderTree(el) {
    if (!treeCache.length) {
      el.innerHTML = `<div style="color:var(--text-3);padding:16px;text-align:center">예산과목이 없습니다.${canEdit() ? ' 우측 상단 "+ 관 추가"로 시작하세요.' : ''}</div>`;
      return;
    }
    el.innerHTML = treeCache.map(n => renderNode(n, 0)).join('');
  }

  /* ── 액션 ── */
  async function addNode(level, parentId) {
    const name = prompt(`${level} 이름을 입력하세요`);
    if (!name || !name.trim()) return;
    const res = await api('POST', '/api/admin-budget-accounts', { action: 'create', level, parentId, name: name.trim() });
    if (!res.ok) { alert('추가 실패: ' + (res.data?.error || res.error || '')); return; }
    if (parentId) collapsed[parentId] = false;
    loadTree();
  }
  async function rename(id) {
    const node = findNode(id);
    const name = prompt('새 이름', node?.name || '');
    if (!name || !name.trim()) return;
    const res = await api('POST', '/api/admin-budget-accounts', { action: 'update', id, name: name.trim() });
    if (!res.ok) { alert('변경 실패: ' + (res.data?.error || res.error || '')); return; }
    loadTree();
  }
  async function toggleActive(id, active) {
    const res = await api('POST', '/api/admin-budget-accounts', { action: 'update', id, isActive: active });
    if (!res.ok) { alert('변경 실패: ' + (res.data?.error || res.error || '')); return; }
    loadTree();
  }
  async function del(id) {
    if (!confirm('이 예산과목을 삭제할까요?\n편성·지출이 물려 있으면 비활성으로 전환됩니다.')) return;
    const res = await api('POST', '/api/admin-budget-accounts', { action: 'delete', id });
    if (!res.ok) { alert('삭제 실패: ' + (res.data?.error || res.error || '')); return; }
    if (res.data?.message) alert(res.data.message);
    loadTree();
  }
  async function mapCode(id) {
    const code = prompt('연결할 회계 계정과목 코드를 입력하세요 (account_codes.code)');
    if (!code || !code.trim()) return;
    const res = await api('POST', '/api/admin-budget-accounts', { action: 'mapCode', budgetAccountId: id, accountCode: code.trim() });
    if (!res.ok) { alert('연결 실패: ' + (res.data?.error || res.error || '')); return; }
    loadTree();
  }
  async function unmap(id, code) {
    const res = await api('POST', '/api/admin-budget-accounts', { action: 'unmapCode', budgetAccountId: id, accountCode: code });
    if (!res.ok) { alert('해제 실패: ' + (res.data?.error || res.error || '')); return; }
    loadTree();
  }
  function toggleNode(id) { collapsed[id] = !collapsed[id]; renderTree(document.getElementById('baTree')); }

  function findNode(id, list) {
    list = list || treeCache;
    for (const n of list) {
      if (n.id === id) return n;
      if (n.children) { const f = findNode(id, n.children); if (f) return f; }
    }
    return null;
  }

  async function init() {
    const container = document.getElementById('page-budget-accounts') || document.getElementById('adm-budget-accounts');
    if (!container) return;
    await loadMyRole();
    renderShell(container);
    await loadTree();
  }

  window.SIREN_BUDGET_ACCOUNTS = {
    init, load: init,
    _: { addChild: addNode, rename, toggleActive, del, mapCode },
    _toggle: toggleNode,
    _unmap: unmap,
  };
})();
