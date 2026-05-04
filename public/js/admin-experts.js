// public/js/admin-experts.js
// ★ Phase M-19-11: 전문가 관리 어드민 모듈
(function () {
  'use strict';

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  function toast(msg) {
    const t = document.getElementById('toast');
    if (!t) return alert(msg);
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2400);
  }

  async function api(path, opts) {
    opts = opts || {};
    const o = {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    };
    if (opts.body) o.body = JSON.stringify(opts.body);
    try {
      const res = await fetch(path, o);
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok && data.ok !== false, status: res.status, data: data };
    } catch (e) {
      return { ok: false, data: { error: '네트워크 오류' } };
    }
  }

  const STATUS_BADGES = {
    pending: '<span style="background:#fff8ec;color:#8a6a00;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600">승인 대기</span>',
    approved: '<span style="background:#e7f7ec;color:#1a5e2c;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600">✅ 승인</span>',
    rejected: '<span style="background:#fdecec;color:#a01e2c;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600">반려</span>',
    suspended: '<span style="background:#f0f0f0;color:#888;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600">정지</span>',
  };

  async function loadExperts() {
    const tbody = document.getElementById('expertsTbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--text-3)">불러오는 중...</td></tr>';

    const status = document.getElementById('expFilterStatus').value;
    const type = document.getElementById('expFilterType').value;
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (type) params.set('type', type);

    const res = await api('/api/admin/experts?' + params.toString());
    if (!res.ok) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--danger)">조회 실패</td></tr>';
      return;
    }

    /* KPI 업데이트 */
    const s = res.data.data.stats || {};
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val + ' 명';
    };
    set('kpiExpertPending', (s.pending || 0));
    set('kpiExpertApproved', (s.approved || 0));
    set('kpiExpertLawyer', (s.lawyer || 0));
    set('kpiExpertCounselor', (s.counselor || 0));

    /* 승인 대기 뱃지 */
    const badge = document.getElementById('expertPendingBadge');
    if (badge) {
      if (s.pending > 0) {
        badge.style.display = '';
        badge.textContent = s.pending;
      } else {
        badge.style.display = 'none';
      }
    }

    /* 목록 렌더 */
    const list = res.data.data.list || [];
    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text-3)">전문가 회원이 없습니다</td></tr>';
      return;
    }

    tbody.innerHTML = list.map(e => `
      <tr>
        <td style="font-weight:600">${e.typeLabel}</td>
        <td><strong>${escapeHtml(e.memberName)}</strong><br /><span style="font-size:11px;color:var(--text-3)">${escapeHtml(e.memberEmail)}</span></td>
        <td>${escapeHtml(e.specialty || '—')}</td>
        <td>${escapeHtml(e.affiliation || '—')}</td>
        <td style="text-align:center">${e.yearsOfExperience || 0}년</td>
        <td>${STATUS_BADGES[e.expertStatus] || e.statusLabel}</td>
        <td style="font-size:11px">${new Date(e.createdAt).toISOString().slice(0, 10)}</td>
        <td>
          <button type="button" class="btn-sm btn-sm-ghost" data-exp-act="detail" data-id="${e.id}" style="font-size:11px">📋 상세</button>
          ${e.expertStatus === 'pending' ? `
            <button type="button" class="btn-sm btn-sm-primary" data-exp-act="approve" data-id="${e.id}" style="font-size:11px">✅ 승인</button>
          ` : ''}
        </td>
      </tr>
    `).join('');
  }

  async function openExpertDetail(id) {
    const modal = document.getElementById('expertDetailModal');
    const body = document.getElementById('expertDetailBody');
    if (!modal || !body) return;

    body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-3)">로딩 중...</div>';
    modal.classList.add('show');

    const res = await api('/api/admin/experts?id=' + id);
    if (!res.ok) {
      body.innerHTML = '<div style="color:var(--danger);padding:20px;text-align:center">조회 실패</div>';
      return;
    }

    const p = res.data.data.profile;
    const m = res.data.data.member;
    const cert = res.data.data.certificate;

    const availableDaysArr = Array.isArray(p.availableDays) ? p.availableDays : [];

    let actionButtons = '';
    if (p.expertStatus === 'pending') {
      actionButtons = `
        <div style="display:flex;gap:8px;margin-top:16px">
          <button type="button" class="btn btn-primary" style="flex:1" data-exp-act="approve-modal" data-id="${p.id}">✅ 승인하기</button>
          <button type="button" class="btn btn-ghost" style="background:#fdecec;color:var(--danger);border:1px solid #f5b5bb" data-exp-act="reject-modal" data-id="${p.id}">❌ 반려</button>
        </div>
      `;
    } else if (p.expertStatus === 'approved') {
      actionButtons = `
        <div style="margin-top:16px;padding:12px;background:#e7f7ec;border-radius:8px">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="checkbox" id="expMatchable" ${p.isMatchable ? 'checked' : ''}>
            <span style="font-size:13px">🎯 매칭 가능 상태</span>
          </label>
          <button type="button" class="btn-sm btn-sm-primary" data-exp-act="toggle-matchable" data-id="${p.id}" style="margin-top:8px;font-size:11px">변경 저장</button>
        </div>
      `;
    }

    body.innerHTML = `
      <div style="display:grid;grid-template-columns:120px 1fr;gap:10px 16px;margin-bottom:20px;padding:14px;background:var(--bg-soft);border-radius:8px;font-size:13px">
        <div style="color:var(--text-3);font-weight:600">이름</div>
        <div><strong style="font-size:15px">${escapeHtml(m.name)}</strong></div>
        <div style="color:var(--text-3);font-weight:600">이메일</div>
        <div>${escapeHtml(m.email)}</div>
        <div style="color:var(--text-3);font-weight:600">연락처</div>
        <div>${escapeHtml(m.phone || '—')}</div>
        <div style="color:var(--text-3);font-weight:600">유형</div>
        <div>${p.typeLabel}</div>
        <div style="color:var(--text-3);font-weight:600">상태</div>
        <div>${STATUS_BADGES[p.expertStatus] || p.statusLabel}</div>
      </div>

      <div style="margin-bottom:20px">
        <h4 style="margin:0 0 10px;font-size:14px;color:var(--ink)">🎓 전문가 정보</h4>
        <div style="display:grid;grid-template-columns:120px 1fr;gap:8px 16px;font-size:13px">
          <div style="color:var(--text-3);font-weight:600">세부 분야</div><div>${escapeHtml(p.specialty || '—')}</div>
          <div style="color:var(--text-3);font-weight:600">소속</div><div>${escapeHtml(p.affiliation || '—')}</div>
          <div style="color:var(--text-3);font-weight:600">경력</div><div>${p.yearsOfExperience || 0}년</div>
          <div style="color:var(--text-3);font-weight:600">자격번호</div><div>${escapeHtml(p.licenseNumber || '—')}</div>
          <div style="color:var(--text-3);font-weight:600">활동지역</div><div>${escapeHtml(p.preferredArea || '—')}</div>
          ${p.bio ? `<div style="color:var(--text-3);font-weight:600;grid-column:1;padding-top:6px">자기소개</div><div style="grid-column:2;white-space:pre-wrap;line-height:1.6">${escapeHtml(p.bio)}</div>` : ''}
        </div>
      </div>

      ${cert ? `
        <div style="margin-bottom:20px;padding:12px 14px;background:#fef9f5;border:1px solid #f0d8d8;border-radius:8px">
          <h4 style="margin:0 0 8px;font-size:13px;color:var(--brand)">📄 자격증 증빙</h4>
          <a href="${cert.url}" target="_blank" rel="noopener" style="font-size:12.5px;color:var(--brand);text-decoration:underline">
            ${escapeHtml(cert.originalName)} (${(cert.sizeBytes / 1024).toFixed(1)}KB)
          </a>
        </div>
      ` : '<div style="margin-bottom:20px;padding:12px;background:#fdecec;border-radius:8px;font-size:12px;color:var(--danger)">⚠️ 증빙 파일이 없습니다</div>'}

      ${p.rejectedReason ? `
        <div style="margin-bottom:20px;padding:12px 14px;background:#fdecec;border-left:3px solid var(--danger);border-radius:6px">
          <h4 style="margin:0 0 6px;font-size:12.5px;color:var(--danger)">📝 반려 사유</h4>
          <div style="font-size:12.5px;line-height:1.6;white-space:pre-wrap">${escapeHtml(p.rejectedReason)}</div>
        </div>
      ` : ''}

      ${actionButtons}
    `;
  }

  async function approveExpert(id) {
    if (!confirm('이 전문가 회원을 승인하시겠습니까?\n\n승인 시 매칭 가능 상태로 자동 활성화됩니다.')) return;
    const res = await api('/api/admin/experts', {
      method: 'PATCH',
      body: { id: id, action: 'approve' },
    });
    if (res.ok) {
      toast('✅ 승인 완료');
      document.getElementById('expertDetailModal').classList.remove('show');
      loadExperts();
    } else {
      toast(res.data.error || '승인 실패');
    }
  }

  async function rejectExpert(id) {
    const reason = prompt('반려 사유를 입력해주세요 (필수):');
    if (!reason || !reason.trim()) return;
    const res = await api('/api/admin/experts', {
      method: 'PATCH',
      body: { id: id, action: 'reject', reason: reason.trim() },
    });
    if (res.ok) {
      toast('반려 처리되었습니다');
      document.getElementById('expertDetailModal').classList.remove('show');
      loadExperts();
    } else {
      toast(res.data.error || '반려 실패');
    }
  }

  async function toggleMatchable(id) {
    const checked = document.getElementById('expMatchable').checked;
    const res = await api('/api/admin/experts', {
      method: 'PATCH',
      body: { id: id, isMatchable: checked },
    });
    if (res.ok) {
      toast('매칭 상태 변경 완료');
      loadExperts();
    } else {
      toast('변경 실패');
    }
  }

  function setup() {
    /* 탭 변경 감지 */
    document.addEventListener('click', (e) => {
      const tab = e.target.closest('[data-page="experts"]');
      if (tab) {
        setTimeout(loadExperts, 100);
      }

      /* 행 액션 */
      const btn = e.target.closest('[data-exp-act]');
      if (btn) {
        e.preventDefault();
        const act = btn.dataset.expAct;
        const id = Number(btn.dataset.id);

        if (act === 'detail') openExpertDetail(id);
        else if (act === 'approve' || act === 'approve-modal') approveExpert(id);
        else if (act === 'reject-modal') rejectExpert(id);
        else if (act === 'toggle-matchable') toggleMatchable(id);
      }
    });

    /* 필터 변경 */
    document.addEventListener('change', (e) => {
      if (e.target.id === 'expFilterStatus' || e.target.id === 'expFilterType') {
        loadExperts();
      }
    });
  }

  window.SIREN_ADMIN_EXPERTS = { loadExperts: loadExperts };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }
})();