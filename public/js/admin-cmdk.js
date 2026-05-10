/* admin-cmdk.js — Phase 20-C Cmd+K 빠른 검색 모달 */
(function () {
  'use strict';

  /* ─── API 헬퍼 ─── */
  async function api({ method = 'GET', url, body } = {}) {
    try {
      if (typeof window.adminApi === 'function') return await window.adminApi({ method, url, body });
      if (typeof window.api === 'function')      return await window.api({ method, url, body });
      const opts = { method, credentials: 'include', headers: { 'Content-Type': 'application/json' } };
      if (body !== undefined) opts.body = JSON.stringify(body);
      const r = await fetch(url, opts);
      if (r.status === 401) { window.location.href = '/admin.html'; return { ok: false, status: 401, data: {} }; }
      const data = await r.json().catch(() => ({}));
      return { ok: r.ok, status: r.status, data };
    } catch (err) {
      return { ok: false, data: { error: String(err) } };
    }
  }

  /* ─── 상태 ─── */
  let backdrop = null;
  let input = null;
  let resultsEl = null;
  let debounceTimer = null;
  let currentIndex = -1;
  let allItems = [];

  /* ─── 모달 열기 ─── */
  function open() {
    if (!backdrop) return;
    backdrop.style.display = 'block';
    input.value = '';
    resultsEl.innerHTML = '';
    currentIndex = -1;
    allItems = [];
    setTimeout(() => input.focus(), 50);
  }

  /* ─── 모달 닫기 ─── */
  function close() {
    if (!backdrop) return;
    backdrop.style.display = 'none';
    input.value = '';
    resultsEl.innerHTML = '';
    currentIndex = -1;
    allItems = [];
  }

  /* ─── 검색 요청 ─── */
  async function search(q) {
    if (!q || q.trim().length < 1) {
      resultsEl.innerHTML = '';
      allItems = [];
      return;
    }
    resultsEl.innerHTML = '<div style="padding:16px;text-align:center;color:var(--tok-text-3,#999);font-size:13px">검색 중...</div>';
    try {
      const res = await api({ url: '/api/admin-global-search?q=' + encodeURIComponent(q.trim()) });
      if (!res.ok) throw new Error(res.data?.error || 'HTTP ' + res.status);
      const data = res.data?.data || res.data || {};
      renderResults(data);
    } catch (err) {
      resultsEl.innerHTML = '<div style="padding:16px;text-align:center;color:var(--tok-text-3,#999);font-size:13px">검색 중 오류가 발생했습니다.</div>';
    }
  }

  /* ─── 결과 렌더링 ─── */
  function renderResults(data) {
    allItems = [];
    const menus = Array.isArray(data.menus) ? data.menus : [];
    const members = Array.isArray(data.members) ? data.members : [];
    const donors = Array.isArray(data.donors) ? data.donors : [];
    const reports = Array.isArray(data.reports) ? data.reports : [];

    let html = '';

    if (menus.length) {
      html += buildSection('메뉴', menus.map(item => ({
        type: 'menu',
        label: item.label || '',
        sub: item.group || '',
        key: item.key || '',
        raw: item,
      })));
    }
    if (members.length) {
      html += buildSection('회원', members.map(item => ({
        type: 'member',
        label: item.name || '',
        sub: item.email || '',
        key: item.id || '',
        raw: item,
      })));
    }
    if (donors.length) {
      html += buildSection('후원자', donors.map(item => ({
        type: 'donor',
        label: item.donorName || '',
        sub: '',
        key: item.id || '',
        raw: item,
      })));
    }
    if (reports.length) {
      html += buildSection('신고', reports.map(item => ({
        type: 'report',
        label: item.title || '',
        sub: item.type || '',
        key: item.id || '',
        raw: item,
      })));
    }

    if (!html) {
      resultsEl.innerHTML = '<div style="padding:20px;text-align:center;color:var(--tok-text-3,#999);font-size:13px">검색 결과가 없습니다.</div>';
      return;
    }
    resultsEl.innerHTML = html;
    currentIndex = -1;

    /* 클릭 이벤트 위임 */
    resultsEl.querySelectorAll('.cmdk-result-item').forEach(function (el) {
      el.addEventListener('click', function () {
        const idx = parseInt(this.dataset.index, 10);
        executeItem(allItems[idx]);
      });
    });
  }

  function buildSection(label, items) {
    if (!items.length) return '';
    let html = `<div style="padding:6px 16px 4px;font-size:11px;font-weight:700;color:var(--tok-text-3,#999);letter-spacing:0.4px;text-transform:uppercase">${esc(label)}</div>`;
    items.forEach(function (item) {
      const idx = allItems.length;
      allItems.push(item);
      html += `
        <div class="cmdk-result-item" data-index="${idx}"
          style="display:flex;align-items:center;padding:10px 16px;cursor:pointer;gap:10px;transition:background 0.1s"
          onmouseover="this.classList.add('cmdk-active')"
          onmouseout="this.classList.remove('cmdk-active')">
          <span style="flex:1;font-size:13.5px;color:var(--tok-text-1,#111)">${esc(item.label)}</span>
          ${item.sub ? `<span style="font-size:11.5px;color:var(--tok-text-3,#999)">${esc(item.sub)}</span>` : ''}
        </div>`;
    });
    return html;
  }

  /* ─── 항목 실행 ─── */
  function executeItem(item) {
    if (!item) return;
    close();
    if (item.type === 'menu') {
      window.location.hash = '#' + item.key;
    } else if (item.type === 'member') {
      window.location.hash = '#adm20-members';
    } else if (item.type === 'donor') {
      window.location.hash = '#adm20-donations';
    } else if (item.type === 'report') {
      window.location.hash = '#adm20-siren';
    }
  }

  /* ─── 키보드 네비게이션 ─── */
  function handleKeydown(e) {
    const items = resultsEl.querySelectorAll('.cmdk-result-item');
    if (!items.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[currentIndex] && items[currentIndex].classList.remove('cmdk-active');
      currentIndex = Math.min(currentIndex + 1, items.length - 1);
      items[currentIndex] && items[currentIndex].classList.add('cmdk-active');
      items[currentIndex] && items[currentIndex].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[currentIndex] && items[currentIndex].classList.remove('cmdk-active');
      currentIndex = Math.max(currentIndex - 1, 0);
      items[currentIndex] && items[currentIndex].classList.add('cmdk-active');
      items[currentIndex] && items[currentIndex].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (currentIndex >= 0 && allItems[currentIndex]) {
        executeItem(allItems[currentIndex]);
      }
    }
  }

  /* ─── 유틸 ─── */
  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  /* ─── 모달 생성 및 이벤트 바인딩 ─── */
  function setup() {
    /* 모달 HTML 동적 생성 */
    backdrop = document.createElement('div');
    backdrop.id = 'cmdk-backdrop';
    backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:9999;display:none';

    const modal = document.createElement('div');
    modal.id = 'cmdk-modal';
    modal.style.cssText = 'position:absolute;top:20%;left:50%;transform:translateX(-50%);width:560px;max-width:90vw;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.3)';

    input = document.createElement('input');
    input.id = 'cmdk-input';
    input.placeholder = '메뉴, 회원, 후원자, 신고 검색...';
    input.style.cssText = 'width:100%;padding:16px 20px;font-size:16px;border:none;border-bottom:1px solid #eee;outline:none;box-sizing:border-box';

    resultsEl = document.createElement('div');
    resultsEl.id = 'cmdk-results';
    resultsEl.style.cssText = 'max-height:400px;overflow-y:auto;padding:8px 0';

    modal.appendChild(input);
    modal.appendChild(resultsEl);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    /* 스타일 주입 */
    const style = document.createElement('style');
    style.textContent = '.cmdk-result-item:hover,.cmdk-active{background:var(--bg-soft,#fafaf8)!important}';
    document.head.appendChild(style);

    /* 전역 Cmd+K / Ctrl+K */
    document.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (backdrop.style.display === 'none' || !backdrop.style.display) {
          open();
        } else {
          close();
        }
      }
      if (e.key === 'Escape' && backdrop.style.display !== 'none') {
        close();
      }
      if (backdrop.style.display !== 'none') {
        handleKeydown(e);
      }
    });

    /* 배경 클릭 시 닫기 */
    backdrop.addEventListener('click', function (e) {
      if (e.target === backdrop) close();
    });

    /* 입력 debounce */
    input.addEventListener('input', function () {
      clearTimeout(debounceTimer);
      const q = this.value;
      debounceTimer = setTimeout(function () { search(q); }, 300);
    });

    /* 헤더의 검색 버튼 연결 */
    const cmdkTrigger = document.getElementById('adm20-cmdk-trigger');
    if (cmdkTrigger) {
      cmdkTrigger.addEventListener('click', function (e) {
        e.preventDefault();
        open();
      });
    }
  }

  /* ─── DOMContentLoaded 후 초기화 ─── */
  document.addEventListener('DOMContentLoaded', function () {
    setup();
  });

})();
