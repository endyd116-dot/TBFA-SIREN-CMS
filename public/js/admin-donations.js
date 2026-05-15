/* admin-donations.js — Phase 22-B-R1: 후원 결제 내역 (admin.html → 통합 CMS 이전)
 * window.SIREN_DONATIONS 전역 객체 패턴. 컨테이너 ID adm-donations || page-donations 폴백.
 * 결제 거래 원장 — 정기/예비/잠재 후원자 관리(CRM)와는 별개 기능.
 */
(function () {
  'use strict';

  let _dmSearchTimer = null;
  let _listenersBound = false;

  /* ── API 헬퍼 ── */
  async function api(path, options = {}) {
    const opts = {
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      credentials: 'include',
    };
    if (options.body) opts.body = JSON.stringify(options.body);
    try {
      const res = await fetch(path, opts);
      const data = await res.json().catch(() => ({}));
      return { status: res.status, ok: res.ok && data.ok !== false, data };
    } catch (e) {
      console.error('[Donations API]', path, e);
      return { status: 0, ok: false, data: { error: '네트워크 오류' } };
    }
  }

  /* ── 포맷·이스케이프 헬퍼 ── */
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }
  function formatDateTime(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    return d.getFullYear() + '.' +
      String(d.getMonth() + 1).padStart(2, '0') + '.' +
      String(d.getDate()).padStart(2, '0') + ' ' +
      String(d.getHours()).padStart(2, '0') + ':' +
      String(d.getMinutes()).padStart(2, '0');
  }
  function fmtMoney(n) {
    const num = Math.floor(Number(n) || 0);
    if (Math.abs(num) < 10000) return '₩ ' + num.toLocaleString() + '원';
    if (Math.abs(num) < 100000000) {
      const man = Math.floor(num / 10000);
      return '₩ ' + man.toLocaleString() + '만원';
    }
    const eok = Math.floor(num / 100000000);
    const remainMan = Math.floor((num % 100000000) / 10000);
    if (remainMan === 0) return '₩ ' + eok.toLocaleString() + '억';
    return '₩ ' + eok.toLocaleString() + '억 ' + remainMan.toLocaleString() + '만원';
  }
  function toast(msg) {
    let t = document.getElementById('_sirenToast');
    if (!t) {
      t = document.createElement('div');
      t.id = '_sirenToast';
      t.style.cssText = 'position:fixed;left:50%;bottom:40px;transform:translateX(-50%);' +
        'background:#222;color:#fff;padding:11px 22px;border-radius:8px;font-size:13px;' +
        'z-index:99999;opacity:0;transition:opacity .2s;pointer-events:none';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.style.opacity = '0'; }, 2400);
  }
  async function ensureSheetJS() {
    if (typeof window.XLSX !== 'undefined') return;
    const cdns = [
      'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
      'https://unpkg.com/xlsx@0.18.5/dist/xlsx.full.min.js',
      'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
    ];
    let lastErr;
    for (const url of cdns) {
      try {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = url;
          s.onload = resolve;
          s.onerror = () => reject(new Error('load fail: ' + url));
          document.head.appendChild(s);
        });
        if (typeof window.XLSX !== 'undefined') return;
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('SheetJS 로드 실패');
  }

  /* ── 화면 골격 (KPI 6 + 필터 툴바 + 테이블 + 모달 3종) ── */
  function renderShell(container) {
    container.innerHTML = `
      <div class="kpi-grid" style="grid-template-columns:repeat(6,1fr)">
        <div class="kpi"><div class="kpi-label">금일 결제</div><div class="kpi-value">₩ 0.0M</div></div>
        <div class="kpi"><div class="kpi-label">금월 결제</div><div class="kpi-value">₩ 0.0M</div></div>
        <div class="kpi"><div class="kpi-label">실패 건</div><div class="kpi-value">0 건</div></div>
        <div class="kpi"><div class="kpi-label">영수증 대기</div><div class="kpi-value">0 건</div></div>
        <div class="kpi" style="border-left:3px solid #c47a00"><div class="kpi-label" style="color:#c47a00">환불</div><div class="kpi-value" id="dmKpiRefunded" style="color:#c47a00">0 건</div></div>
        <div class="kpi" style="border-left:3px solid var(--danger)"><div class="kpi-label" style="color:var(--danger)">취소</div><div class="kpi-value" id="dmKpiCancelled" style="color:var(--danger)">0 건</div></div>
      </div>

      <div class="panel">
        <div class="p-head">
          <div class="p-title">결제 내역</div>
          <div class="p-actions">
            <button class="btn-sm btn-sm-ghost" id="dmBtnExportDonations" type="button">📥 수납내역 엑셀 내보내기</button>
            <button class="btn-sm btn-sm-primary" data-dm-action="bulk-receipt" type="button">📄 영수증 일괄 발행</button>
          </div>
        </div>

        <div class="dm-toolbar">
          <select id="dmFilterType">
            <option value="">전체 유형</option>
            <option value="regular">정기 후원</option>
            <option value="onetime">일시 후원</option>
          </select>
          <select id="dmFilterStatus">
            <option value="">전체 상태</option>
            <option value="completed">승인</option>
            <option value="pending">대기</option>
            <option value="failed">실패</option>
            <option value="cancelled">취소</option>
            <option value="refunded">환불</option>
          </select>
          <input type="search" id="dmFilterQ" placeholder="🔍 이름·이메일·승인번호·영수증번호 검색 (2자 이상)">
          <span class="dm-count" id="dmCount">—</span>
        </div>

        <div style="overflow-x:auto">
          <table class="tbl" style="min-width:1100px">
            <thead><tr><th>결제일</th><th>회원</th><th>유형</th><th>금액</th><th>수단</th><th>승인번호</th><th>상태</th><th style="width:160px">관리</th></tr></thead>
            <tbody><tr><td colspan="8" style="text-align:center;padding:30px;color:var(--text-3)">불러오는 중...</td></tr></tbody>
          </table>
        </div>
      </div>

      <!-- 후원 상세 -->
      <div id="donationDetailModal" class="modal">
        <div class="modal-content" style="max-width:680px">
          <div class="modal-header">
            <h3 class="serif">💝 후원 상세</h3>
            <button class="modal-close" data-action="close-modal">&times;</button>
          </div>
          <div class="modal-body" id="donationDetailBody">
            <div style="text-align:center;padding:40px;color:var(--text-3)">로딩 중...</div>
          </div>
        </div>
      </div>

      <!-- 환불 사유 -->
      <div id="refundReasonModal" class="modal">
        <div class="modal-content" style="max-width:520px">
          <div class="modal-header">
            <h3 class="serif">💸 후원 환불 처리</h3>
            <button class="modal-close" data-action="close-modal">&times;</button>
          </div>
          <div class="modal-body">
            <div class="rc-warn-box">
              ⚠️ <strong>환불 처리 안내</strong><br />
              • 토스 결제는 <strong>"토스 자동 환불 진행" 체크 시 PG에서 실제 환불</strong>이 됩니다 (즉시·비가역)<br />
              • 효성·계좌이체는 시스템 상태만 변경되니, 실제 환불은 효성 사이트 또는 계좌 송금으로 별도 진행<br />
              • 환불 후 상태는 'refunded'로 변경 — 영수증 발급에 영향이 갈 수 있습니다<br />
              • 사유는 후원 메모에 누적 기록됩니다 (감사 로그용)
            </div>
            <div class="rc-info-grid" id="rcRefundInfo"></div>
            <form id="refundForm">
              <input type="hidden" id="rcRefundId" value="">
              <input type="hidden" id="rcRefundPg" value="">
              <input type="hidden" id="rcRefundPaymentKey" value="">

              <!-- 토스 자동 환불 체크박스 (토스 결제일 때만 노출) -->
              <div id="rcTossAutoRefundWrap" style="display:none;background:#fff3e0;border:1px solid #ffb74d;border-radius:6px;padding:11px 14px;margin-top:14px;font-size:12.5px;line-height:1.65">
                <label style="display:flex;align-items:flex-start;gap:9px;cursor:pointer">
                  <input type="checkbox" id="rcTossAutoRefund" style="margin-top:2px;width:16px;height:16px;cursor:pointer">
                  <span>
                    <strong>💳 토스에서 실제 환불까지 진행 (자동)</strong><br>
                    <span style="color:#7d5400">체크 시 토스 PG에 즉시 환불 요청 → 카드사 환불 절차 시작.<br>
                    실패 시 DB 상태도 변경되지 않습니다 (안전 롤백).</span>
                  </span>
                </label>
              </div>

              <!-- 비토스 결제 안내 -->
              <div id="rcNonTossNotice" style="display:none;background:#f3f3f3;border:1px solid #ddd;border-radius:6px;padding:10px 14px;margin-top:14px;font-size:12px;color:#666;line-height:1.6">
                ℹ️ 이 결제는 <strong id="rcNonTossPgLabel">—</strong> 채널입니다. 시스템 상태만 변경되며, 실제 환불은 해당 채널에서 별도 진행해 주세요.
              </div>

              <div class="fg" style="margin-top:14px">
                <label style="font-size:12.5px;font-weight:600;color:var(--text-2);display:block;margin-bottom:5px">
                  환불 사유 <span style="font-weight:400;color:var(--text-3);font-size:11.5px">(권장, 500자 이하)</span>
                </label>
                <textarea id="rcRefundReason" maxlength="500" style="width:100%;min-height:90px;padding:9px 12px;border:1px solid var(--line);border-radius:5px;font-size:13px;font-family:inherit;resize:vertical;line-height:1.6;box-sizing:border-box" placeholder="예) 회원 요청, 중복 결제 등"></textarea>
              </div>
              <div style="display:flex;gap:10px;margin-top:14px">
                <button type="submit" id="btnRefundConfirm" style="flex:1;background:#c47a00;color:#fff;border:none;padding:11px;border-radius:6px;cursor:pointer;font-weight:600;font-size:13px">💸 환불 처리 확정</button>
                <button type="button" data-action="close-modal" style="background:transparent;border:1px solid var(--line);color:var(--text-2);padding:11px 20px;border-radius:6px;cursor:pointer">취소</button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <!-- 결제 취소 사유 -->
      <div id="cancelReasonModal" class="modal">
        <div class="modal-content" style="max-width:520px">
          <div class="modal-header">
            <h3 class="serif">❌ 후원 취소 처리</h3>
            <button class="modal-close" data-action="close-modal">&times;</button>
          </div>
          <div class="modal-body">
            <div class="rc-warn-box danger">
              ⚠️ <strong>관리자 강제 취소</strong><br />
              • 결제 자체가 무효 처리됩니다 (cancelled)<br />
              • 정기 후원은 다음 결제부터 자동 청구가 중단됩니다<br />
              • 한 번 취소되면 되돌릴 수 없습니다<br />
              • 사유는 후원 메모에 누적 기록됩니다
            </div>
            <div class="rc-info-grid" id="rcCancelInfo"></div>
            <form id="cancelForm">
              <input type="hidden" id="rcCancelId" value="">
              <div class="fg">
                <label style="font-size:12.5px;font-weight:600;color:var(--text-2);display:block;margin-bottom:5px">
                  취소 사유 <span style="font-weight:400;color:var(--text-3);font-size:11.5px">(권장, 500자 이하)</span>
                </label>
                <textarea id="rcCancelReason" maxlength="500" style="width:100%;min-height:90px;padding:9px 12px;border:1px solid var(--line);border-radius:5px;font-size:13px;font-family:inherit;resize:vertical;line-height:1.6;box-sizing:border-box" placeholder="예) 결제 실패 후 정리 등"></textarea>
              </div>
              <div style="display:flex;gap:10px;margin-top:14px">
                <button type="submit" id="btnCancelConfirm" style="flex:1;background:var(--danger);color:#fff;border:none;padding:11px;border-radius:6px;cursor:pointer;font-weight:600;font-size:13px">❌ 취소 처리 확정</button>
                <button type="button" data-action="close-modal" style="background:transparent;border:1px solid var(--line);color:var(--text-2);padding:11px 20px;border-radius:6px;cursor:pointer">취소</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    `;
  }

  /* ── 결제 내역 로드 ── */
  async function loadDonations() {
    const panel = document.getElementById('adm-donations') || document.getElementById('page-donations');
    if (!panel) return;
    const tbody = panel.querySelector('table.tbl tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--text-3)">불러오는 중...</td></tr>';

    const params = new URLSearchParams();
    params.set('limit', '50');
    params.set('page', '1');
    const t = document.getElementById('dmFilterType')?.value || '';
    const s = document.getElementById('dmFilterStatus')?.value || '';
    const q = (document.getElementById('dmFilterQ')?.value || '').trim();
    if (t) params.set('type', t);
    if (s) params.set('status', s);
    if (q && q.length >= 2) params.set('q', q);

    const res = await api('/api/admin/donations?' + params.toString());
    if (!res.ok || !res.data?.data) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--danger)">조회 실패</td></tr>';
      return;
    }
    /* ★ 버그픽스 20260515-2차 (#7): 응답 래핑 단계가 바뀌어도 list/stats/pagination을
       정확히 풀도록 공용 unwrap 사용 (없으면 기존 res.data.data 경로 폴백) */
    const _uw = window._cmsUnwrap ||
      ((d, m) => (d && d.data && typeof d.data === 'object' && m.some(k => d.data[k] !== undefined)) ? d.data : (d || {}));
    const payload = _uw(res.data, ['list', 'stats', 'pagination']);
    const list = payload.list || [];
    const stats = payload.stats || {};
    const pagination = payload.pagination || {};

    const kpis = panel.querySelectorAll('.kpi-value');
    if (kpis[0]) kpis[0].textContent = fmtMoney(stats.today ?? stats.todayTotal ?? 0);
    /* ★ #7: 금월 결제금액 = 효성정기+CMS정기+일시(직접계좌)+일시(토스) 4채널 합산.
       B가 추가하는 합계 필드명을 알 수 없어 다중 fallback (§6.2) */
    if (kpis[1]) kpis[1].textContent = fmtMoney(
      stats.month ?? stats.monthTotal ?? stats.monthAll ?? stats.monthAllChannels ?? stats.thisMonth ?? 0
    );
    if (kpis[2]) kpis[2].textContent = (stats.failedCount || 0) + ' 건';
    if (kpis[3]) kpis[3].textContent = (stats.receiptPendingCount || 0) + ' 건';
    const refundedEl = document.getElementById('dmKpiRefunded');
    const cancelledEl = document.getElementById('dmKpiCancelled');
    if (refundedEl) refundedEl.textContent = (stats.refundedCount || 0) + ' 건';
    if (cancelledEl) cancelledEl.textContent = (stats.cancelledCount || 0) + ' 건';

    const countEl = document.getElementById('dmCount');
    if (countEl) {
      const total = pagination.total || 0;
      if (q || t || s) {
        countEl.textContent = `필터: ${list.length}건 / 전체 ${total.toLocaleString()}건`;
      } else {
        countEl.textContent = `전체 ${total.toLocaleString()}건`;
      }
    }

    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text-3)">결제 내역이 없습니다</td></tr>';
      return;
    }

    const typeMap = { regular: '정기후원', onetime: '일시후원' };
    const payMap = { cms: 'CMS', card: '카드', bank: '계좌이체' };
    const statusMap = {
      completed: '<span class="badge b-success">승인</span>',
      pending: '<span class="badge b-warn">대기</span>',
      pending_hyosung: '<span class="badge b-warn">⏳ 효성 확인중</span>',
      failed: '<span class="badge b-danger">실패</span>',
      cancelled: '<span class="badge b-mute">취소</span>',
      refunded: '<span class="badge b-mute">환불</span>',
    };

    tbody.innerHTML = list.map((d) => {
      const txn = d.transactionId ? d.transactionId.slice(-12) : '-';
      const anonMark = d.isAnonymous ? '<span class="dm-anonymous-mark">익명</span>' : '';
      const campaignMark = d.campaignTag ? '<span class="dm-campaign-tag">' + escapeHtml(d.campaignTag) + '</span>' : '';

      const canRefund = d.status === 'completed';
      const canCancel = d.status === 'pending' || d.status === 'completed';
      const canReceipt = d.status === 'completed';
      const actions = '<div class="dm-row-actions">' +
        '<button type="button" class="detail" data-dm-action="detail" data-id="' + d.id + '">📝 상세</button>' +
        (canReceipt ? '<button type="button" class="detail" data-dm-action="receipt" data-id="' + d.id + '" style="color:#1a5e2c;border-color:#a3d9b4">📄 영수증</button>' : '') +
        (canRefund ? '<button type="button" class="refund" data-dm-action="refund" data-id="' + d.id + '" data-name="' + escapeHtml(d.donorName || '') + '" data-amount="' + (d.amount || 0) + '" data-pg="' + escapeHtml(d.pgProvider || '') + '" data-payment-key="' + escapeHtml(d.tossPaymentKey || '') + '">💸 환불</button>' : '') +
        (canCancel ? '<button type="button" class="cancel" data-dm-action="cancel" data-id="' + d.id + '" data-name="' + escapeHtml(d.donorName || '') + '" data-amount="' + (d.amount || 0) + '">❌ 취소</button>' : '') +
        '</div>';

      return '<tr>' +
        '<td>' + formatDateTime(d.createdAt) + '</td>' +
        '<td>' + escapeHtml(d.donorName) + anonMark + '</td>' +
        '<td>' + (typeMap[d.type] || d.type) + campaignMark + '</td>' +
        '<td>₩ ' + (d.amount || 0).toLocaleString() + '</td>' +
        '<td>' + (payMap[d.payMethod] || d.payMethod) + '</td>' +
        '<td style="font-family:Inter;font-size:11px">' + escapeHtml(txn) + '</td>' +
        '<td>' + (statusMap[d.status] || d.status) + '</td>' +
        '<td>' + actions + '</td>' +
        '</tr>';
    }).join('');
  }

  /* ── 후원 상세 모달 ── */
  async function openDonationDetailModal(id) {
    const modal = document.getElementById('donationDetailModal');
    const body = document.getElementById('donationDetailBody');
    if (!modal || !body) return;

    body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-3)">로딩 중...</div>';
    modal.classList.add('show');

    const res = await api('/api/admin/donations?id=' + id);
    if (!res.ok || !res.data?.data?.donation) {
      body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--danger)">조회 실패</div>';
      return;
    }
    const d = res.data.data.donation;

    const typeMap = { regular: '정기 후원', onetime: '일시 후원' };
    const payMap = { cms: 'CMS 자동이체', card: '신용카드', bank: '계좌이체' };
    const statusKr = {
      completed: '승인 완료',
      pending: '결제 대기',
      pending_hyosung: '효성 CMS+ 입금 확인중',
      failed: '실패',
      cancelled: '취소',
      refunded: '환불',
    };
    const statusClass = d.status;

    const statusCard = '<div class="dd-status-card ' + statusClass + '">' +
      '<div class="icon">' +
      (d.status === 'completed' ? '✅' :
       d.status === 'pending' ? '⏳' :
       d.status === 'pending_hyosung' ? '⏳' :
       d.status === 'refunded' ? '💸' :
       d.status === 'cancelled' ? '❌' : '⚠️') +
      '</div>' +
      '<div class="text">' +
        '<strong>' + (statusKr[d.status] || d.status) + '</strong>' +
        '₩ ' + (d.amount || 0).toLocaleString() + ' · ' + (typeMap[d.type] || d.type) +
      '</div>' +
      '</div>';

    const safeMemo = String(d.memo || '').replace(/"/g, '&quot;');
    const safeCampaign = String(d.campaignTag || '').replace(/"/g, '&quot;');

    body.innerHTML =
      statusCard +
      '<div class="dd-grid">' +
        '<div>후원 ID</div><div style="font-family:Inter;font-weight:600">D-' + String(d.id).padStart(7, '0') + '</div>' +
        '<div>후원자</div><div><strong>' + escapeHtml(d.donorName) + '</strong>' + (d.isAnonymous ? ' <span class="dm-anonymous-mark">익명</span>' : '') + '</div>' +
        (d.donorEmail ? '<div>이메일</div><div>' + escapeHtml(d.donorEmail) + '</div>' : '') +
        (d.donorPhone ? '<div>연락처</div><div>' + escapeHtml(d.donorPhone) + '</div>' : '') +
        '<div>금액</div><div style="font-weight:700">₩ ' + (d.amount || 0).toLocaleString() + '</div>' +
        '<div>유형</div><div>' + (typeMap[d.type] || d.type) + '</div>' +
        '<div>결제수단</div><div>' + (payMap[d.payMethod] || d.payMethod) + '</div>' +
        '<div>승인번호</div><div style="font-family:Inter;font-size:11.5px">' + escapeHtml(d.transactionId || '—') + '</div>' +
        (d.receiptNumber ? '<div>영수증번호</div><div style="font-family:Inter;font-size:11.5px">' + escapeHtml(d.receiptNumber) + '</div>' : '') +
        '<div>결제일시</div><div>' + formatDateTime(d.createdAt) + '</div>' +
      '</div>' +

      '<div class="dd-section">' +
        '<h5>🏷️ 캠페인 태그</h5>' +
        '<div class="field-row">' +
          '<input type="text" id="ddCampaignInput" maxlength="50" value="' + safeCampaign + '" placeholder="예) 2026-spring-memorial">' +
          '<button type="button" class="small-btn" data-dd-action="save-campaign" data-id="' + d.id + '">💾 저장</button>' +
        '</div>' +
      '</div>' +

      '<div class="dd-section">' +
        '<h5>🎭 익명 후원 표시</h5>' +
        '<label style="display:inline-flex;align-items:center;gap:8px;cursor:pointer;font-size:12.5px">' +
          '<input type="checkbox" id="ddAnonymousToggle" ' + (d.isAnonymous ? 'checked' : '') + ' data-id="' + d.id + '">' +
          '<span>관리자 외 다른 사용자에게 후원자 정보 노출 안 함 (현재: ' + (d.isAnonymous ? '익명' : '공개') + ')</span>' +
        '</label>' +
      '</div>' +

      '<div class="dd-section">' +
        '<h5>📝 관리자 메모</h5>' +
        '<textarea id="ddMemoInput" maxlength="2000" placeholder="이 후원에 대한 메모...">' + safeMemo + '</textarea>' +
        '<div class="field-row" style="margin-top:8px">' +
          '<button type="button" class="small-btn" data-dd-action="save-memo" data-id="' + d.id + '">💾 메모 저장</button>' +
        '</div>' +
      '</div>';
  }

  /* ── 환불 모달 ── */
  function openRefundModal(id, donorName, amount, pgProvider, tossPaymentKey) {
    const modal = document.getElementById('refundReasonModal');
    if (!modal) return;
    document.getElementById('rcRefundId').value = String(id);
    document.getElementById('rcRefundReason').value = '';
    document.getElementById('rcRefundPg').value = pgProvider || '';
    document.getElementById('rcRefundPaymentKey').value = tossPaymentKey || '';

    /* 토스 자동 환불 체크박스 — 토스+paymentKey 있을 때만 노출 */
    const isToss = pgProvider === 'toss' && !!tossPaymentKey;
    const tossWrap = document.getElementById('rcTossAutoRefundWrap');
    const tossCb   = document.getElementById('rcTossAutoRefund');
    const nonToss  = document.getElementById('rcNonTossNotice');
    const nonTossLabel = document.getElementById('rcNonTossPgLabel');
    if (tossWrap) tossWrap.style.display = isToss ? 'block' : 'none';
    if (tossCb)   tossCb.checked = false;
    if (nonToss)  nonToss.style.display = isToss ? 'none' : 'block';
    if (nonTossLabel) {
      const pgLabel = !pgProvider ? '미지정' :
        pgProvider === 'hyosung' ? '효성 CMS+' :
        pgProvider === 'manual'  ? '직접 계좌이체/수기' :
        pgProvider === 'toss'    ? '토스 (paymentKey 없음)' :
        pgProvider;
      nonTossLabel.textContent = pgLabel;
    }

    const infoEl = document.getElementById('rcRefundInfo');
    if (infoEl) {
      const pgLabelShort = !pgProvider ? '—' :
        pgProvider === 'toss'    ? '💳 토스' :
        pgProvider === 'hyosung' ? '🏦 효성 CMS+' :
        pgProvider === 'manual'  ? '✍️ 직접/수기' :
        pgProvider;
      infoEl.innerHTML =
        '<div>후원 ID</div><div style="font-family:Inter;font-weight:600">D-' + String(id).padStart(7, '0') + '</div>' +
        '<div>후원자</div><div><strong>' + escapeHtml(donorName) + '</strong></div>' +
        '<div>금액</div><div style="font-weight:700;color:#c47a00">₩ ' + amount.toLocaleString() + '</div>' +
        '<div>결제 채널</div><div>' + pgLabelShort + '</div>';
    }
    modal.classList.add('show');
    setTimeout(() => document.getElementById('rcRefundReason')?.focus(), 100);
  }

  /* ── 취소 모달 ── */
  function openCancelModal(id, donorName, amount) {
    const modal = document.getElementById('cancelReasonModal');
    if (!modal) return;
    document.getElementById('rcCancelId').value = String(id);
    document.getElementById('rcCancelReason').value = '';
    const infoEl = document.getElementById('rcCancelInfo');
    if (infoEl) {
      infoEl.innerHTML =
        '<div>후원 ID</div><div style="font-family:Inter;font-weight:600">D-' + String(id).padStart(7, '0') + '</div>' +
        '<div>후원자</div><div><strong>' + escapeHtml(donorName) + '</strong></div>' +
        '<div>금액</div><div style="font-weight:700;color:var(--danger)">₩ ' + amount.toLocaleString() + '</div>';
    }
    modal.classList.add('show');
    setTimeout(() => document.getElementById('rcCancelReason')?.focus(), 100);
  }

  /* ── 수납내역 엑셀 내보내기 ── */
  async function exportDonationsExcel(btn) {
    const origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ 처리 중...';
    try {
      const params = new URLSearchParams();
      const fType = document.getElementById('dmFilterType')?.value;
      const fStatus = document.getElementById('dmFilterStatus')?.value;
      const fFrom = document.getElementById('dmFilterFrom')?.value;
      const fTo = document.getElementById('dmFilterTo')?.value;
      if (fType) params.set('type', fType);
      if (fStatus) params.set('status', fStatus);
      if (fFrom) params.set('from', fFrom);
      if (fTo) params.set('to', fTo);

      const res = await fetch('/api/admin-donations-export?' + params.toString(), { credentials: 'include' });
      if (res.status === 401) { location.href = '/admin.html'; return; }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || ('HTTP ' + res.status));
      }
      const json = await res.json();
      const items = (json.data && json.data.items) || json.items || [];
      if (!items.length) { toast('내보낼 수납내역이 없습니다'); return; }

      await ensureSheetJS();
      const ws = XLSX.utils.json_to_sheet(items);
      const headers = Object.keys(items[0] || {});
      ws['!cols'] = headers.map((h) => {
        const wRaw = Math.max(h.length, 8);
        return { wch: Math.min(wRaw + 4, 30) };
      });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '수납내역');
      const today = new Date();
      const ymd = today.getFullYear() +
        String(today.getMonth() + 1).padStart(2, '0') +
        String(today.getDate()).padStart(2, '0');
      XLSX.writeFile(wb, '수납내역_' + ymd + '.xlsx');
      toast('수납내역 ' + items.length + '건 다운로드');
    } catch (err) {
      console.error('[donations-export]', err);
      toast('내보내기 실패: ' + (err && err.message ? err.message : '알 수 없는 오류'));
    } finally {
      btn.disabled = false;
      btn.textContent = origText;
    }
  }

  /* ── 전역 위임 리스너 (최초 1회만 바인딩) ── */
  function bindListeners() {
    if (_listenersBound) return;
    _listenersBound = true;

    /* 모달 닫기 */
    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="close-modal"]')) {
        const modal = e.target.closest('.modal');
        if (modal) modal.classList.remove('show');
        return;
      }
      if (e.target.classList.contains('modal')) {
        e.target.classList.remove('show');
      }
    });

    /* 영수증 일괄 발행 + 엑셀 내보내기 */
    document.addEventListener('click', async (e) => {
      const exportBtn = e.target.closest('#dmBtnExportDonations');
      if (exportBtn) {
        e.preventDefault();
        exportDonationsExcel(exportBtn);
        return;
      }
      const bulkBtn = e.target.closest('[data-dm-action="bulk-receipt"]');
      if (bulkBtn) {
        e.preventDefault();
        const res = await api('/api/admin/donations?limit=100&status=completed');
        const allList = res.data?.data?.list || [];
        const ids = allList.filter((d) => !d.receiptIssued).map((d) => d.id);
        if (ids.length === 0) { toast('발행할 영수증이 없습니다'); return; }
        const r = await api('/api/admin/donations', { method: 'PATCH', body: { ids } });
        if (r.ok) {
          toast(r.data?.message || ids.length + '건 발행 완료');
          loadDonations();
        } else {
          toast('발행 실패');
        }
      }
    });

    /* 검색/필터 디바운스 */
    document.addEventListener('input', (e) => {
      if (e.target && e.target.id === 'dmFilterQ') {
        clearTimeout(_dmSearchTimer);
        _dmSearchTimer = setTimeout(loadDonations, 400);
      }
    });
    document.addEventListener('change', (e) => {
      if (e.target && (e.target.id === 'dmFilterType' || e.target.id === 'dmFilterStatus')) {
        loadDonations();
      }
    });

    /* 행 액션 (상세/환불/취소/영수증) */
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-dm-action]');
      if (!btn) return;
      const action = btn.dataset.dmAction;
      if (action === 'bulk-receipt') return;
      e.preventDefault();
      const id = Number(btn.dataset.id);
      if (!id) return;
      if (action === 'detail') { openDonationDetailModal(id); return; }
      if (action === 'refund') { openRefundModal(id, btn.dataset.name || '', Number(btn.dataset.amount) || 0, btn.dataset.pg || '', btn.dataset.paymentKey || ''); return; }
      if (action === 'cancel') { openCancelModal(id, btn.dataset.name || '', Number(btn.dataset.amount) || 0); return; }
      if (action === 'receipt') {
        window.open('/api/donation-receipt?id=' + id, '_blank', 'noopener');
        toast('영수증 PDF를 새 탭에서 엽니다');
        return;
      }
    });

    /* 환불 폼 제출 */
    document.addEventListener('submit', async (e) => {
      if (e.target && e.target.id === 'refundForm') {
        e.preventDefault();
        const id = Number(document.getElementById('rcRefundId').value);
        const reason = (document.getElementById('rcRefundReason').value || '').trim();
        const autoRefundToss = !!document.getElementById('rcTossAutoRefund')?.checked;
        if (!id) return;
        const confirmMsg = autoRefundToss
          ? '⚠️ 토스 PG에 실제 환불을 요청합니다.\n\n• 카드사 환불 절차가 즉시 시작됩니다\n• 결제 자체가 비가역적으로 취소됨\n• 시스템 상태도 refunded로 변경\n\n정말 진행하시겠습니까?'
          : '시스템 상태만 환불(refunded)로 변경합니다.\n\n• 실제 PG사 환불은 별도 진행 필요\n• 되돌릴 수 없습니다\n\n진행할까요?';
        if (!confirm(confirmMsg)) return;
        const btn = document.getElementById('btnRefundConfirm');
        const oldText = btn ? btn.textContent : '';
        if (btn) { btn.disabled = true; btn.textContent = autoRefundToss ? '토스 환불 요청 중...' : '처리 중...'; }
        try {
          const res = await api('/api/admin/donations', {
            method: 'PATCH',
            body: { id, refundOne: true, reason: reason || undefined, autoRefundToss },
          });
          if (res.ok) {
            toast(res.data?.message || '환불 처리되었습니다');
            document.getElementById('refundReasonModal')?.classList.remove('show');
            loadDonations();
          } else {
            toast(res.data?.error || '환불 실패');
          }
        } finally {
          if (btn) { btn.disabled = false; btn.textContent = oldText; }
        }
      }
      if (e.target && e.target.id === 'cancelForm') {
        e.preventDefault();
        const id = Number(document.getElementById('rcCancelId').value);
        const reason = (document.getElementById('rcCancelReason').value || '').trim();
        if (!id) return;
        if (!confirm('정말 취소 처리하시겠습니까?\n\n• 결제가 무효 처리됩니다\n• 정기 후원은 다음 결제부터 자동 청구가 중단됩니다\n• 한 번 취소되면 되돌릴 수 없습니다')) return;
        const btn = document.getElementById('btnCancelConfirm');
        const oldText = btn ? btn.textContent : '';
        if (btn) { btn.disabled = true; btn.textContent = '처리 중...'; }
        try {
          const res = await api('/api/admin/donations', { method: 'PATCH', body: { id, cancelOne: true, reason: reason || undefined } });
          if (res.ok) {
            toast(res.data?.message || '취소 처리되었습니다');
            document.getElementById('cancelReasonModal')?.classList.remove('show');
            loadDonations();
          } else {
            toast(res.data?.error || '취소 실패');
          }
        } finally {
          if (btn) { btn.disabled = false; btn.textContent = oldText; }
        }
      }
    });

    /* 상세 모달 내 액션 (메모/캠페인 저장) */
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-dd-action]');
      if (!btn) return;
      e.preventDefault();
      const action = btn.dataset.ddAction;
      const id = Number(btn.dataset.id);
      if (!id) return;

      if (action === 'save-memo') {
        const memo = (document.getElementById('ddMemoInput')?.value || '').slice(0, 2000);
        btn.disabled = true;
        const oldText = btn.textContent;
        btn.textContent = '저장 중...';
        const res = await api('/api/admin/donations', { method: 'PATCH', body: { id, inlineMemoOnly: true, memo } });
        btn.disabled = false;
        btn.textContent = oldText;
        toast(res.ok ? (res.data?.message || '메모가 저장되었습니다') : (res.data?.error || '저장 실패'));
        return;
      }
      if (action === 'save-campaign') {
        const campaignTag = (document.getElementById('ddCampaignInput')?.value || '').trim();
        btn.disabled = true;
        const oldText = btn.textContent;
        btn.textContent = '저장 중...';
        const res = await api('/api/admin/donations', { method: 'PATCH', body: { id, campaignTag: campaignTag || null } });
        btn.disabled = false;
        btn.textContent = oldText;
        if (res.ok) {
          toast('캠페인 태그가 저장되었습니다');
          loadDonations();
        } else {
          toast(res.data?.error || '저장 실패');
        }
        return;
      }
    });

    /* 익명 토글 */
    document.addEventListener('change', async (e) => {
      const cb = e.target.closest('#ddAnonymousToggle');
      if (!cb) return;
      const id = Number(cb.dataset.id);
      const newVal = cb.checked;
      const res = await api('/api/admin/donations', { method: 'PATCH', body: { id, isAnonymous: newVal } });
      if (res.ok) {
        toast(newVal ? '익명 후원으로 변경되었습니다' : '공개 후원으로 변경되었습니다');
        loadDonations();
      } else {
        toast(res.data?.error || '변경 실패');
        cb.checked = !newVal;
      }
    });
  }

  /* ── 초기화 / 재진입 통합 ── */
  function init() {
    const container = document.getElementById('adm-donations') || document.getElementById('page-donations');
    if (!container) return;
    if (!container.querySelector('.panel')) {
      renderShell(container);
    }
    bindListeners();
    loadDonations();
  }

  window.SIREN_DONATIONS = {
    init, load: init,
    openDetail: openDonationDetailModal,
    openRefund: openRefundModal,
    openCancel: openCancelModal,
  };
})();
