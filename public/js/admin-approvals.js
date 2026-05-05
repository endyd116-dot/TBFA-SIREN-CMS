/* =========================================================
   SIREN — admin-approvals.js
   ★ M-19-11 V2 STEP 6: 회원 자격 관리 (목록/승인/반려/재심사)
   ========================================================= */
(function () {
  'use strict';

  /* ============ 상수 ============ */
  const SUBTYPE_META = {
    family:    { label: '유가족',     icon: '🎗',   color: '#7a1f2b', bgSoft: '#fef9f5' },
    teacher:   { label: '교원',       icon: '👨‍🏫', color: '#1a5ec4', bgSoft: '#f0f5fc' },
    lawyer:    { label: '변호사',     icon: '⚖️',   color: '#5a4d8c', bgSoft: '#f8f7fc' },
    counselor: { label: '심리상담사', icon: '💗',   color: '#c5293a', bgSoft: '#fdecec' },
  };

  let _currentList = [];
  let _currentCounts = { all: 0, family: 0, teacher: 0, lawyer: 0, counselor: 0 };
  let _currentType = 'all';
  let _initialized = false;

  /* ============ 헬퍼 ============ */
  function toast(msg, ms = 2400) {
    const t = document.getElementById('toast');
    if (!t) return alert(msg);
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(window._tt);
    window._tt = setTimeout(() => t.classList.remove('show'), ms);
  }

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
      console.error('[admin-approvals API]', path, e);
      return { status: 0, ok: false, data: { error: '네트워크 오류' } };
    }
  }

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

  function formatFileSize(bytes) {
    if (!bytes) return '-';
    const num = Number(bytes);
    if (num < 1024) return num + ' B';
    if (num < 1024 * 1024) return (num / 1024).toFixed(1) + ' KB';
    return (num / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function getMimeIcon(mime) {
    if (!mime) return '📄';
    if (mime.includes('pdf')) return '📕';
    if (mime.includes('image')) return '🖼️';
    return '📄';
  }

  /* ============ 카운트/뱃지 갱신 ============ */
  function updateBadges(counts) {
    _currentCounts = counts || { all: 0, family: 0, teacher: 0, lawyer: 0, counselor: 0 };

    /* 사이드바 뱃지 (회원 관리 메뉴 옆) */
    const sideBadge = document.getElementById('membersApprovalsBadge');
    if (sideBadge) {
      const n = _currentCounts.all || 0;
      if (n > 0) {
        sideBadge.textContent = n > 99 ? '99+' : String(n);
        sideBadge.style.display = '';
      } else {
        sideBadge.style.display = 'none';
      }
    }

    /* 탭 뱃지 (회원 관리 페이지 안의 탭) */
    const tabBadge = document.getElementById('approvalsTabBadge');
    if (tabBadge) {
      const n = _currentCounts.all || 0;
      if (n > 0) {
        tabBadge.textContent = n > 99 ? '99+' : String(n);
        tabBadge.style.display = '';
      } else {
        tabBadge.style.display = 'none';
      }
    }

    /* KPI 카드 */
    const setKpi = (id, n) => {
      const el = document.getElementById(id);
      if (el) el.textContent = (n || 0).toLocaleString() + ' 명';
    };
    setKpi('apvKpiAll', _currentCounts.all);
    setKpi('apvKpiFamily', _currentCounts.family);
    setKpi('apvKpiTeacher', _currentCounts.teacher);
    setKpi('apvKpiLawyer', _currentCounts.lawyer);
    setKpi('apvKpiCounselor', _currentCounts.counselor);
  }

  /* ============ 목록 로드 ============ */
  async function loadList(typeFilter) {
    if (typeFilter) _currentType = typeFilter;

    const tbody = document.getElementById('apvTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text-3)">불러오는 중...</td></tr>';

    const params = new URLSearchParams();
    params.set('type', _currentType || 'all');

    const res = await api('/api/admin/pending-approvals?' + params.toString());

    if (!res.ok || !res.data?.data) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--danger)">조회 실패</td></tr>';
      return;
    }

    const list = res.data.data.list || [];
    const counts = res.data.data.counts || { all: 0, family: 0, teacher: 0, lawyer: 0, counselor: 0 };

    _currentList = list;
    updateBadges(counts);

    /* 카운트 표시 */
    const countEl = document.getElementById('apvCount');
    if (countEl) {
      const total = counts.all || 0;
      if (_currentType === 'all') {
        countEl.textContent = `전체 ${total.toLocaleString()}건`;
      } else {
        const filterCount = counts[_currentType] || 0;
        countEl.textContent = `${SUBTYPE_META[_currentType]?.label || _currentType}: ${filterCount}건 / 전체 ${total}건`;
      }
    }

    /* 빈 목록 */
    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:60px 20px;color:var(--text-3)">' +
        '<div style="font-size:42px;margin-bottom:10px">✨</div>' +
        '<div style="font-size:14px;font-weight:600;color:var(--text-2);margin-bottom:4px">승인 대기 중인 회원이 없습니다</div>' +
        '<div style="font-size:12px">새로운 자격 신청이 들어오면 여기에 표시됩니다</div>' +
        '</td></tr>';
      return;
    }

    tbody.innerHTML = list.map((m) => {
      const meta = SUBTYPE_META[m.subtypeKey] || { label: m.subtypeLabel || '기타', icon: '👤', color: '#525252' };
      const typeBadge = `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 9px;background:${meta.color};color:#fff;border-radius:11px;font-size:11px;font-weight:700">${meta.icon} ${escapeHtml(meta.label)}</span>`;

      const cert = m.certificate;
      const certCell = cert
        ? `<button type="button" class="btn-sm btn-sm-ghost" data-apv-action="preview-cert" data-blob-id="${cert.blobId}" 
             style="padding:5px 10px;font-size:11px;border:1px solid var(--line);background:#fff;border-radius:4px;cursor:pointer"
             title="${escapeHtml(cert.originalName || '')}">${getMimeIcon(cert.mimeType)} 보기</button>`
        : '<span style="color:var(--text-3);font-size:11px">없음</span>';

      const actions = `<div class="srn-row-actions">
        <button type="button" class="detail" data-apv-action="open-detail" data-id="${m.id}" style="background:#fff;border:1px solid var(--brand);color:var(--brand);padding:5px 11px;font-size:11.5px;border-radius:4px;cursor:pointer">📋 상세</button>
        <button type="button" data-apv-action="approve" data-id="${m.id}" data-name="${escapeHtml(m.name)}" data-subtype="${m.subtypeKey}"
          style="background:#1a8b46;color:#fff;border:none;padding:5px 11px;font-size:11.5px;border-radius:4px;cursor:pointer;font-weight:600">✓ 승인</button>
        <button type="button" data-apv-action="open-reject" data-id="${m.id}" data-name="${escapeHtml(m.name)}" data-subtype="${m.subtypeKey}"
          style="background:#fff;color:var(--danger);border:1px solid var(--danger);padding:5px 11px;font-size:11.5px;border-radius:4px;cursor:pointer">✗ 반려</button>
      </div>`;

      return `<tr>
        <td>${typeBadge}</td>
        <td style="font-family:Inter;font-size:12px">${formatDateTime(m.createdAt)}</td>
        <td>
          <div><strong>${escapeHtml(m.name)}</strong></div>
          <div style="font-size:11.5px;color:var(--text-3);font-family:Inter">${escapeHtml(m.email)}</div>
        </td>
        <td style="font-family:Inter;font-size:12px">${escapeHtml(m.phone || '—')}</td>
        <td>${certCell}</td>
        <td><span class="srn-status-pill submitted">⏳ 대기</span></td>
        <td>${actions}</td>
      </tr>`;
    }).join('');
  }

  /* ============ 사이드바 뱃지만 갱신 (다른 페이지에서도 호출) ============ */
  async function refreshBadge() {
    try {
      const res = await api('/api/admin/pending-approvals?type=all');
      if (res.ok && res.data?.data?.counts) {
        updateBadges(res.data.data.counts);
      }
    } catch (_) {}
  }

  /* ============ 상세 모달 ============ */
  async function openDetailModal(memberId) {
    const modal = document.getElementById('approvalDetailModal');
    const body = document.getElementById('approvalDetailBody');
    const titleEl = document.getElementById('apvDetailTitle');
    if (!modal || !body) return;

    body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-3)">로딩 중...</div>';
    modal.classList.add('show');

    /* 캐시에서 찾기 */
    const m = _currentList.find(x => x.id === memberId);
    if (!m) {
      body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--danger)">회원 정보를 찾을 수 없습니다. 새로고침 후 다시 시도해주세요.</div>';
      return;
    }

    const meta = SUBTYPE_META[m.subtypeKey] || { label: '기타', icon: '👤', color: '#525252', bgSoft: '#f5f4f2' };
    if (titleEl) titleEl.textContent = `${meta.icon} ${meta.label} 회원 자격 검토`;

    const cert = m.certificate;
    const certBlock = cert
      ? `<div style="background:${meta.bgSoft};border:1px solid var(--line);border-radius:8px;padding:14px 16px">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
            <div style="font-size:32px">${getMimeIcon(cert.mimeType)}</div>
            <div style="flex:1;min-width:0">
              <div style="font-size:13px;font-weight:700;color:var(--ink);word-break:break-all">${escapeHtml(cert.originalName || '증빙파일')}</div>
              <div style="font-size:11px;color:var(--text-3);margin-top:2px">
                ${escapeHtml(cert.mimeType || '')} · ${formatFileSize(cert.sizeBytes)} · 
                업로드 ${cert.uploadedAt ? formatDateTime(cert.uploadedAt) : '-'}
              </div>
            </div>
          </div>
          <button type="button" data-apv-action="preview-cert" data-blob-id="${cert.blobId}"
            style="background:${meta.color};color:#fff;border:none;padding:9px 16px;font-size:12.5px;border-radius:5px;cursor:pointer;font-weight:600;width:100%">
            🔍 증빙 파일 새 탭에서 열기
          </button>
        </div>`
      : `<div style="background:#fdecec;border:1px solid #f5b5bb;border-radius:8px;padding:14px 16px;color:#a01e2c;font-size:13px">
          ⚠️ <strong>증빙 파일이 첨부되지 않았습니다</strong><br />
          <span style="font-size:11.5px">회원에게 증빙 파일 재첨부를 요청한 후 승인을 결정하세요.</span>
        </div>`;

    const rejectedHistoryBlock = m.certificateRejectedReason
      ? `<div style="margin-top:14px;background:#fff8ec;border:1px solid #f0e3c4;border-radius:8px;padding:12px 14px">
          <div style="font-size:12px;font-weight:700;color:#8a6a00;margin-bottom:6px">📜 이전 반려 사유</div>
          <div style="font-size:12.5px;color:#6a5400;line-height:1.7;white-space:pre-wrap">${escapeHtml(m.certificateRejectedReason)}</div>
        </div>`
      : '';

    body.innerHTML = `
      <!-- 회원 기본 정보 -->
      <div style="display:flex;align-items:center;gap:14px;padding:14px 16px;background:${meta.bgSoft};border:1px solid var(--line);border-radius:8px;margin-bottom:18px">
        <div style="font-size:42px;line-height:1">${meta.icon}</div>
        <div style="flex:1">
          <div style="font-size:18px;font-weight:700;color:var(--ink)">${escapeHtml(m.name)}</div>
          <div style="font-size:12px;color:var(--text-2);margin-top:2px">
            ${escapeHtml(m.email)} ${m.phone ? '· ' + escapeHtml(m.phone) : ''}
          </div>
          <div style="margin-top:6px">
            <span style="display:inline-block;padding:3px 9px;background:${meta.color};color:#fff;border-radius:11px;font-size:11px;font-weight:700">${meta.icon} ${escapeHtml(meta.label)} 신청</span>
          </div>
        </div>
      </div>

      <!-- 신청 정보 -->
      <div class="srn-modal-info-grid">
        <div>회원 ID</div><div style="font-family:Inter;font-weight:600">M-${String(m.id).padStart(5, '0')}</div>
        <div>신청 일시</div><div>${formatDateTime(m.createdAt)}</div>
        <div>유형</div><div>${meta.icon} ${escapeHtml(meta.label)}</div>
        <div>현재 상태</div><div><span class="srn-status-pill submitted">⏳ 승인 대기</span></div>
        ${m.memo ? '<div>가입 메모</div><div style="font-size:12.5px;color:var(--text-2);white-space:pre-wrap">' + escapeHtml(m.memo) + '</div>' : ''}
      </div>

      <!-- 증빙 파일 -->
      <div class="srn-modal-section">
        <h5>📎 증빙 자료</h5>
        ${certBlock}
        ${rejectedHistoryBlock}
      </div>

      <!-- 검토 가이드 -->
      <div class="srn-modal-section srn-ai-block">
        <div class="ai-title">📋 검토 체크리스트</div>
        <div style="font-size:12.5px;color:var(--text-2);line-height:1.85">
          ${m.subtypeKey === 'family' ? `
            ✓ 가족관계증명서 또는 사망진단서로 유가족 신원 확인<br />
            ✓ 신청자 본인 명의 확인 (이름 일치)<br />
            ✓ 사망 사유가 교사 직무 관련성 있는지 확인
          ` : m.subtypeKey === 'teacher' ? `
            ✓ 재직증명서 또는 교사자격증 확인<br />
            ✓ 발급일이 1년 이내인지 확인 (재직 중 여부)<br />
            ✓ 학교명/소속 확인 → 2단계 검증 진행 (필요 시)
          ` : m.subtypeKey === 'lawyer' ? `
            ✓ 변호사 자격증 또는 등록증 확인<br />
            ✓ 대한변협 등록 확인 (가능 시)<br />
            ✓ 자격증 발급 일자 + 면허번호 확인
          ` : m.subtypeKey === 'counselor' ? `
            ✓ 심리상담사 자격증 (한국상담심리학회 1급/2급 등) 확인<br />
            ✓ 발급기관 신뢰도 확인 (학회/협회)<br />
            ✓ 자격증 만료일 확인
          ` : `
            ✓ 신청자 신원 확인<br />
            ✓ 증빙 자료 진위 확인
          `}
        </div>
      </div>

      <!-- 액션 버튼 -->
      <div class="srn-action-row" style="margin-top:18px">
        <button type="button" class="btn-save" data-apv-action="approve" data-id="${m.id}" data-name="${escapeHtml(m.name)}" data-subtype="${m.subtypeKey}"
          style="background:#1a8b46">✓ 승인 (정상 회원으로 변경)</button>
        <button type="button" class="btn-hide" data-apv-action="open-reject" data-id="${m.id}" data-name="${escapeHtml(m.name)}" data-subtype="${m.subtypeKey}"
          style="background:#fff;color:var(--danger);border:1px solid var(--danger)">✗ 반려</button>
      </div>
    `;
  }

  /* ============ 승인 처리 ============ */
  async function approveMember(memberId, memberName, subtypeKey) {
    const meta = SUBTYPE_META[subtypeKey] || { label: '회원' };

    const confirmed = confirm(
      `${memberName}님을 ${meta.label} 회원으로 승인하시겠습니까?\n\n` +
      `✓ 회원 상태가 '정상(active)'으로 변경됩니다\n` +
      `✓ 즉시 회원 목록에 추가됩니다\n` +
      `✓ 승인 안내 이메일이 자동 발송됩니다 (이메일 동의 시)\n` +
      `✓ ${meta.label} 권한이 부여됩니다`
    );
    if (!confirmed) return;

    toast('승인 처리 중...');

    const res = await api('/api/admin/pending-approvals', {
      method: 'POST',
      body: { memberId, action: 'approve' },
    });

    if (res.ok) {
      toast(`✓ ${memberName}님이 ${meta.label} 회원으로 승인되었습니다`);

      /* 모달 닫기 */
      document.getElementById('approvalDetailModal')?.classList.remove('show');

      /* 목록 새로고침 + 회원 관리 탭도 함께 새로고침 (사용자 요구) */
      await loadList(_currentType);

      /* 회원 목록 탭이 보일 때 함께 새로고침 (admin.js의 loadMembers 호출) */
      if (typeof window.loadMembers === 'function') {
        window.loadMembers();
      } else {
        /* admin.js 내부 IIFE라 직접 접근 불가 → 메뉴 클릭 시뮬레이션은 부담스러우니 그대로 둠 */
      }
    } else {
      toast(res.data?.error || '승인 실패');
    }
  }

  /* ============ 반려 모달 ============ */
  function openRejectModal(memberId, memberName, subtypeKey) {
    const modal = document.getElementById('approvalRejectModal');
    if (!modal) return;

    const meta = SUBTYPE_META[subtypeKey] || { label: '회원', icon: '👤' };

    document.getElementById('apvRejectId').value = String(memberId);
    document.getElementById('apvRejectReason').value = '';

    const infoEl = document.getElementById('apvRejectInfo');
    if (infoEl) {
      infoEl.innerHTML =
        `<strong>${meta.icon} ${escapeHtml(memberName)}</strong> ` +
        `<span style="color:var(--text-3);font-size:12px">(${escapeHtml(meta.label)} 신청 / M-${String(memberId).padStart(5, '0')})</span>`;
    }

    /* 상세 모달이 열려있으면 닫기 */
    document.getElementById('approvalDetailModal')?.classList.remove('show');

    modal.classList.add('show');
    setTimeout(() => document.getElementById('apvRejectReason')?.focus(), 100);
  }

  /* ============ 반려 폼 제출 ============ */
  function setupRejectForm() {
    const form = document.getElementById('approvalRejectForm');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const memberId = Number(document.getElementById('apvRejectId').value);
      const reason = (document.getElementById('apvRejectReason').value || '').trim();

      if (!memberId) return toast('회원 ID 없음');
      if (reason.length < 5) return toast('반려 사유를 5자 이상 입력해주세요');
      if (reason.length > 1000) return toast('반려 사유는 1000자 이하여야 합니다');

      const finalConfirm = confirm(
        '반려 처리하시겠습니까?\n\n' +
        '• 회원 상태가 \'정지(suspended)\'로 변경됩니다\n' +
        '• 반려 사유가 신청자에게 이메일로 발송됩니다\n' +
        '• 증빙 파일은 보존됩니다 (재심사 가능)\n\n' +
        '계속하려면 [확인]을 눌러주세요.'
      );
      if (!finalConfirm) return;

      const btn = form.querySelector('button[type="submit"]');
      const oldText = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.textContent = '처리 중...'; }

      try {
        const res = await api('/api/admin/pending-approvals', {
          method: 'POST',
          body: { memberId, action: 'reject', reason },
        });

        if (res.ok) {
          toast(res.data?.message || '반려 처리되었습니다');
          document.getElementById('approvalRejectModal')?.classList.remove('show');
          await loadList(_currentType);
        } else {
          toast(res.data?.error || '반려 실패');
        }
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = oldText; }
      }
    });
  }

  /* ============ 증빙 파일 미리보기 (R2 다운로드) ============ */
  function previewCertificate(blobId) {
    if (!blobId) {
      toast('증빙 파일 ID가 없습니다');
      return;
    }
    const url = `/api/blob-download?id=${blobId}`;
    window.open(url, '_blank', 'noopener');
    toast('증빙 파일을 새 탭에서 엽니다');
  }

  /* ============ 액션 핸들러 (위임) ============ */
  function setupActions() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-apv-action]');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();

      const action = btn.dataset.apvAction;
      const id = Number(btn.dataset.id);
      const name = btn.dataset.name || '';
      const subtype = btn.dataset.subtype || '';

      if (action === 'open-detail') {
        if (id) openDetailModal(id);
        return;
      }
      if (action === 'approve') {
        if (id) approveMember(id, name, subtype);
        return;
      }
      if (action === 'open-reject') {
        if (id) openRejectModal(id, name, subtype);
        return;
      }
      if (action === 'preview-cert') {
        const blobId = Number(btn.dataset.blobId);
        if (blobId) previewCertificate(blobId);
        return;
      }
    });

    /* 필터 셀렉트 */
    const typeFilter = document.getElementById('apvFilterType');
    if (typeFilter) {
      typeFilter.addEventListener('change', () => {
        _currentType = typeFilter.value || 'all';
        loadList(_currentType);
      });
    }

    /* 새로고침 버튼 */
    const reloadBtn = document.getElementById('apvReloadBtn');
    if (reloadBtn) {
      reloadBtn.addEventListener('click', (e) => {
        e.preventDefault();
        loadList(_currentType);
        toast('목록을 새로고침했습니다');
      });
    }
  }

  /* ============ 초기화 ============ */
  function init() {
    if (_initialized) return;
    _initialized = true;
    setupActions();
    setupRejectForm();
  }

  /* ============ 외부 노출 ============ */
  window.SIREN_ADMIN_APPROVALS = {
    loadList,
    refreshBadge,
    init,
  };

  /* DOM 준비 시 자동 init */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();