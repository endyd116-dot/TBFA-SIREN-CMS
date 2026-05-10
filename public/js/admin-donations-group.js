/* admin-donations-group.js — Phase 20-B 후원·재정 그룹 (후원 4탭) */
(function () {
  'use strict';

  const USE_MOCK = false;

  /* ─── mock 데이터 ─── */
  const MOCK = {
    ok: true,
    donations: [
      { id: 1, memberName: '김철수', type: '정기', amount: 50000, method: '카드', status: 'completed', approvalNo: 'A20240501', paidAt: '2026-05-01 09:12', receiptNo: 'R-2026-001' },
      { id: 2, memberName: '이영희', type: '일시', amount: 100000, method: '가상계좌', status: 'completed', approvalNo: 'A20240502', paidAt: '2026-05-02 14:30', receiptNo: 'R-2026-002' },
      { id: 3, memberName: '박민준', type: '정기', amount: 30000, method: '카드', status: 'failed', approvalNo: '', paidAt: '2026-05-03 11:05', receiptNo: '' },
      { id: 4, memberName: '최수연', type: '일시', amount: 200000, method: '카드', status: 'completed', approvalNo: 'A20240504', paidAt: '2026-05-04 16:20', receiptNo: 'R-2026-004' },
      { id: 5, memberName: '정도윤', type: '정기', amount: 50000, method: '카드', status: 'refunded', approvalNo: 'A20240505', paidAt: '2026-05-05 10:00', receiptNo: '' },
    ],
    hyosung: [
      { id: 1, memberName: '김철수', phone: '010-****-1234', amount: 30000, billingDay: 15, status: '정상', lastPaidAt: '2026-04-15', contractNo: 'CMS-001' },
      { id: 2, memberName: '이영희', phone: '010-****-5678', amount: 50000, billingDay: 20, status: '정상', lastPaidAt: '2026-04-20', contractNo: 'CMS-002' },
      { id: 3, memberName: '박민준', phone: '010-****-9012', amount: 20000, billingDay: 10, status: '실패', lastPaidAt: '2026-04-10', contractNo: 'CMS-003' },
    ],
    csvMapping: [
      { field: '이름', column: 'name', required: true, sample: '홍길동' },
      { field: '금액', column: 'amount', required: true, sample: '50000' },
      { field: '납부일', column: 'paidDate', required: true, sample: '2026-05-01' },
      { field: '방법', column: 'method', required: false, sample: '가상계좌' },
      { field: '메모', column: 'note', required: false, sample: '정기 이체' },
    ],
    receiptSettings: {
      orgName: '(사)교사유가족협의회',
      regNo: '1188271215',
      representative: '홍길동',
      address: '서울특별시 중구 ...',
      phone: '02-1234-5678',
      autoIssue: true,
      autoIssueDays: 3,
      emailTemplate: '기부금 영수증이 발행되었습니다.',
    },
  };

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

  /* ─── 토스트 ─── */
  function showToast(msg, type = 'error') {
    const el = document.getElementById('toast') || document.getElementById('admToast');
    if (el) {
      el.textContent = msg;
      el.className = 'toast show' + (type === 'error' ? ' toast-error' : '');
      setTimeout(() => el.classList.remove('show'), 3500);
    } else {
      console.warn('[DonationsGroup]', msg);
    }
  }

  /* ─── 상태 ─── */
  let currentTab = 'donations';
  let donData = null;

  /* ─── 진입 ─── */
  function init() {
    const container = document.getElementById('adm20-donations');
    if (!container) return;
    container.innerHTML = buildShell();
    bindTabs(container);
    loadData();
  }

  /* ─── 탭 셸 HTML ─── */
  function buildShell() {
    return `
      <div class="adm-card">
        <div class="adm-group-tabs">
          <button class="adm-group-tab is-active" data-tab="donations">💳 후원금 관리</button>
          <button class="adm-group-tab" data-tab="hyosung">🏦 효성 CMS+</button>
          <button class="adm-group-tab" data-tab="csv">📂 CSV 자동 매핑</button>
          <button class="adm-group-tab" data-tab="receipt">🧾 영수증 설정</button>
        </div>

        <div class="adm-group-panel is-active" data-panel="donations">
          <div class="adm-toolbar" style="margin-bottom:12px">
            <select id="dg-filter-type">
              <option value="">전체 유형</option>
              <option value="정기">정기</option>
              <option value="일시">일시</option>
            </select>
            <select id="dg-filter-status">
              <option value="">전체 상태</option>
              <option value="completed">승인</option>
              <option value="pending">대기</option>
              <option value="failed">실패</option>
              <option value="refunded">환불</option>
              <option value="cancelled">취소</option>
            </select>
            <input type="search" id="dg-filter-q" placeholder="이름·승인번호·영수증번호 검색">
            <button class="btn-sm btn-sm-ghost" id="dg-btn-export">📥 엑셀 내보내기</button>
            <button class="btn-sm btn-sm-primary" id="dg-btn-receipt-bulk">📄 영수증 일괄 발행</button>
          </div>
          <div id="dg-donations-table-wrap"></div>
        </div>

        <div class="adm-group-panel" data-panel="hyosung">
          <div class="adm-toolbar" style="margin-bottom:12px">
            <input type="search" id="dg-hy-search" placeholder="이름·계약번호 검색">
            <select id="dg-hy-status">
              <option value="">전체 상태</option>
              <option value="정상">정상</option>
              <option value="실패">실패</option>
              <option value="해지">해지</option>
            </select>
          </div>
          <div id="dg-hyosung-table-wrap"></div>
        </div>

        <div class="adm-group-panel" data-panel="csv">
          <div id="dg-csv-wrap"></div>
        </div>

        <div class="adm-group-panel" data-panel="receipt">
          <div id="dg-receipt-wrap"></div>
        </div>
      </div>`;
  }

  /* ─── 탭 바인딩 ─── */
  function bindTabs(container) {
    container.querySelectorAll('.adm-group-tab').forEach(btn => {
      btn.addEventListener('click', function () {
        const tab = this.dataset.tab;
        container.querySelectorAll('.adm-group-tab').forEach(b => b.classList.remove('is-active'));
        container.querySelectorAll('.adm-group-panel').forEach(p => p.classList.remove('is-active'));
        this.classList.add('is-active');
        const panel = container.querySelector('[data-panel="' + tab + '"]');
        if (panel) panel.classList.add('is-active');
        currentTab = tab;
        if (donData) renderTab(tab, donData);
      });
    });
  }

  /* ─── 데이터 로드 ─── */
  async function loadData() {
    let d;
    if (USE_MOCK) {
      d = MOCK;
    } else {
      const res = await api({ url: '/api/admin-donations-unified' });
      if (!res.ok) {
        showToast((res.data?.error || res.data?.data?.error || '후원 데이터를 불러오지 못했습니다.') + (res.data?.detail ? ' — ' + res.data.detail : ''));
        d = {};
      } else {
        d = res.data?.data || res.data || {};
      }
    }
    donData = d;
    renderTab(currentTab, d);
  }

  /* ─── 탭별 렌더 ─── */
  function renderTab(tab, d) {
    if (tab === 'donations') renderDonations(d.donations || []);
    else if (tab === 'hyosung') renderHyosung(d.hyosung || []);
    else if (tab === 'csv') renderCsv(d.csvMapping || []);
    else if (tab === 'receipt') renderReceipt(d.receiptSettings || {});
  }

  /* ─── 후원금 목록 ─── */
  function renderDonations(rows) {
    const wrap = document.getElementById('dg-donations-table-wrap');
    if (!wrap) return;
    const statusLabel = { completed: '승인', pending: '대기', failed: '실패', refunded: '환불', cancelled: '취소' };
    const statusColor = { completed: '#1a8b46', pending: '#c47a00', failed: '#c5293a', refunded: '#6b6b6b', cancelled: '#6b6b6b' };
    if (!rows.length) {
      wrap.innerHTML = '<p style="text-align:center;padding:30px;color:var(--tok-text-3)">후원 내역이 없습니다.</p>';
      return;
    }
    wrap.innerHTML = `
      <div style="overflow-x:auto">
        <table class="tbl" style="min-width:900px">
          <thead><tr>
            <th>결제일</th><th>회원</th><th>유형</th><th>금액</th>
            <th>수단</th><th>승인번호</th><th>상태</th><th>관리</th>
          </tr></thead>
          <tbody>
            ${rows.map(r => `
              <tr>
                <td style="font-size:12px;white-space:nowrap">${r.paidAt}</td>
                <td>${r.memberName}</td>
                <td><span style="background:#f0f4ff;color:#1a5ec4;padding:2px 8px;border-radius:10px;font-size:11.5px">${r.type}</span></td>
                <td style="font-weight:600">₩ ${r.amount.toLocaleString()}</td>
                <td style="font-size:12.5px">${r.method}</td>
                <td style="font-size:12px;color:var(--tok-text-3)">${r.approvalNo || '-'}</td>
                <td><span style="color:${statusColor[r.status]};font-weight:600;font-size:12.5px">${statusLabel[r.status] || r.status}</span></td>
                <td>
                  ${r.receiptNo
                    ? `<button class="btn-sm btn-sm-ghost" style="font-size:11.5px">영수증 재발송</button>`
                    : `<button class="btn-sm btn-sm-ghost" style="font-size:11.5px;color:var(--tok-text-3)" disabled>영수증 없음</button>`
                  }
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <p style="font-size:12px;color:var(--tok-text-3);margin-top:8px">총 ${rows.length}건 (mock 데이터)</p>`;
  }

  /* ─── 효성 CMS+ ─── */
  function renderHyosung(rows) {
    const wrap = document.getElementById('dg-hyosung-table-wrap');
    if (!wrap) return;
    if (!rows.length) {
      wrap.innerHTML = '<p style="text-align:center;padding:30px;color:var(--tok-text-3)">효성 CMS+ 계약이 없습니다.</p>';
      return;
    }
    wrap.innerHTML = `
      <div style="overflow-x:auto">
        <table class="tbl" style="min-width:700px">
          <thead><tr>
            <th>계약번호</th><th>회원</th><th>연락처</th><th>월 금액</th>
            <th>출금일</th><th>마지막 납부</th><th>상태</th><th>관리</th>
          </tr></thead>
          <tbody>
            ${rows.map(r => `
              <tr>
                <td style="font-size:12px;font-family:'Inter',monospace">${r.contractNo}</td>
                <td>${r.memberName}</td>
                <td style="font-size:12.5px;color:var(--tok-text-3)">${r.phone}</td>
                <td style="font-weight:600">₩ ${r.amount.toLocaleString()}</td>
                <td style="font-size:12.5px">${r.billingDay}일</td>
                <td style="font-size:12px;color:var(--tok-text-3)">${r.lastPaidAt}</td>
                <td><span style="color:${r.status === '정상' ? '#1a8b46' : '#c5293a'};font-weight:600;font-size:12.5px">${r.status}</span></td>
                <td><button class="btn-sm btn-sm-ghost" style="font-size:11.5px">상세</button></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <p style="font-size:12px;color:var(--tok-text-3);margin-top:8px">총 ${rows.length}건 (mock 데이터)</p>`;
  }

  /* ─── CSV 매핑 ─── */
  function renderCsv(mappings) {
    const wrap = document.getElementById('dg-csv-wrap');
    if (!wrap) return;
    wrap.innerHTML = `
      <div class="adm-card" style="margin-bottom:16px">
        <div class="adm-card__title" style="margin-bottom:12px">📂 CSV 컬럼 자동 매핑 규칙</div>
        <p style="font-size:13px;color:var(--tok-text-2);margin-bottom:16px">
          은행·CMS CSV 파일을 업로드하면 아래 규칙으로 자동 매핑합니다.
        </p>
        <table class="tbl">
          <thead><tr><th>시스템 필드</th><th>CSV 컬럼명</th><th>필수</th><th>샘플 값</th></tr></thead>
          <tbody>
            ${mappings.map(m => `
              <tr>
                <td style="font-weight:600">${m.field}</td>
                <td style="font-family:'Inter',monospace;font-size:12.5px;color:#1a5ec4">${m.column}</td>
                <td>${m.required ? '<span style="color:#c5293a;font-weight:700">필수</span>' : '<span style="color:var(--tok-text-3)">선택</span>'}</td>
                <td style="font-size:12px;color:var(--tok-text-3)">${m.sample}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="adm-card">
        <div class="adm-card__title" style="margin-bottom:12px">📤 CSV 업로드</div>
        <div style="border:2px dashed var(--tok-line);border-radius:8px;padding:40px;text-align:center;color:var(--tok-text-3)">
          <div style="font-size:32px;margin-bottom:12px">📂</div>
          <p style="margin-bottom:12px">CSV 파일을 드래그하거나 클릭하여 업로드</p>
          <button class="btn-sm btn-sm-primary">파일 선택</button>
        </div>
      </div>`;
  }

  /* ─── 영수증 설정 ─── */
  function renderReceipt(s) {
    const wrap = document.getElementById('dg-receipt-wrap');
    if (!wrap) return;
    wrap.innerHTML = `
      <div class="adm-card">
        <div class="adm-card__title" style="margin-bottom:16px">🧾 기부금 영수증 발급 설정</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
          <div>
            <label style="font-size:12.5px;font-weight:600;color:var(--tok-text-2);display:block;margin-bottom:4px">기관명</label>
            <input type="text" value="${s.orgName || ''}" style="width:100%;padding:8px 12px;border:1px solid var(--tok-line);border-radius:5px;font-size:13px">
          </div>
          <div>
            <label style="font-size:12.5px;font-weight:600;color:var(--tok-text-2);display:block;margin-bottom:4px">사업자번호</label>
            <input type="text" value="${s.regNo || ''}" style="width:100%;padding:8px 12px;border:1px solid var(--tok-line);border-radius:5px;font-size:13px">
          </div>
          <div>
            <label style="font-size:12.5px;font-weight:600;color:var(--tok-text-2);display:block;margin-bottom:4px">대표자명</label>
            <input type="text" value="${s.representative || ''}" style="width:100%;padding:8px 12px;border:1px solid var(--tok-line);border-radius:5px;font-size:13px">
          </div>
          <div>
            <label style="font-size:12.5px;font-weight:600;color:var(--tok-text-2);display:block;margin-bottom:4px">연락처</label>
            <input type="text" value="${s.phone || ''}" style="width:100%;padding:8px 12px;border:1px solid var(--tok-line);border-radius:5px;font-size:13px">
          </div>
          <div style="grid-column:1/-1">
            <label style="font-size:12.5px;font-weight:600;color:var(--tok-text-2);display:block;margin-bottom:4px">주소</label>
            <input type="text" value="${s.address || ''}" style="width:100%;padding:8px 12px;border:1px solid var(--tok-line);border-radius:5px;font-size:13px">
          </div>
        </div>
        <div style="border-top:1px solid var(--tok-line);padding-top:16px;margin-bottom:20px">
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer;margin-bottom:12px">
            <input type="checkbox" ${s.autoIssue ? 'checked' : ''} style="width:16px;height:16px">
            <span style="font-size:13px;font-weight:600">납부 후 자동 발행 사용</span>
          </label>
          <div style="display:flex;align-items:center;gap:8px;margin-left:26px">
            <span style="font-size:13px;color:var(--tok-text-2)">납부 후</span>
            <input type="number" value="${s.autoIssueDays || 3}" min="1" max="30"
              style="width:60px;padding:6px 10px;border:1px solid var(--tok-line);border-radius:5px;font-size:13px;text-align:center">
            <span style="font-size:13px;color:var(--tok-text-2)">일 이내 자동 발행</span>
          </div>
        </div>
        <div style="text-align:right">
          <button class="btn-sm btn-sm-primary" onclick="alert('[mock] 저장되었습니다.')">저장</button>
        </div>
      </div>`;
  }

  /* ─── 진입점: adm20-donations가 보일 때 초기화 ─── */
  function tryInit() {
    const container = document.getElementById('adm20-donations');
    if (!container) return;
    if (container.dataset.donGroupInit) return;
    container.dataset.donGroupInit = '1';
    init();
  }

  /* adm20-donations 뷰가 is-active가 되는 순간 감지 */
  const obs = new MutationObserver(function (muts) {
    muts.forEach(function (m) {
      if (m.target && m.target.id === 'adm20-donations' && m.target.classList.contains('is-active')) {
        tryInit();
      }
    });
  });

  document.addEventListener('DOMContentLoaded', function () {
    const container = document.getElementById('adm20-donations');
    if (container) {
      obs.observe(container, { attributes: true, attributeFilter: ['class'] });
      if (container.classList.contains('is-active')) tryInit();
    }
  });

})();
