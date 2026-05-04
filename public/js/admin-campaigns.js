// public/js/admin-campaigns.js
// ★ Phase M-19-2: 캠페인 관리 어드민 모듈
(function () {
  'use strict';

  let _cmpSearchTimer = null;

  const TYPE_LABEL = {
    fundraising: '<span style="background:#e7f7ec;color:#1a5e2c;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600">💰 모금</span>',
    memorial: '<span style="background:#fef9f5;color:#7a1f2b;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600">🎗 추모</span>',
    awareness: '<span style="background:#eef2ff;color:#4338ca;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600">📣 인식</span>',
  };

  const STATUS_LABEL = {
    draft: '<span class="badge b-mute">초안</span>',
    active: '<span class="badge b-success">활성</span>',
    closed: '<span class="badge b-warn">종료</span>',
    archived: '<span class="badge b-mute">보관</span>',
  };

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  function formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0');
  }

  function toast(msg) {
    const t = document.getElementById('toast');
    if (!t) return alert(msg);
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2400);
  }

  async function api(path, opts = {}) {
    const o = {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      credentials: 'include',
    };
    if (opts.body) o.body = JSON.stringify(opts.body);
    const res = await fetch(path, o);
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok && data.ok !== false, status: res.status, data };
  }

  function normalizeSlug(s) {
    return String(s || '').toLowerCase().trim()
      .replace(/[^a-z0-9가-힣\-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 100);
  }

  /* ====== 목록 로드 ====== */
  async function loadCampaigns() {
    const tbody = document.getElementById('cmpTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:30px;color:var(--text-3)">불러오는 중...</td></tr>';

    const params = new URLSearchParams({ page: '1', limit: '100' });
    const type = document.getElementById('cmpFilterType')?.value || '';
    const status = document.getElementById('cmpFilterStatus')?.value || '';
    const pub = document.getElementById('cmpFilterPublished')?.value || '';
    const q = (document.getElementById('cmpFilterQ')?.value || '').trim();
    if (type) params.set('type', type);
    if (status) params.set('status', status);
    if (pub) params.set('published', pub);
    if (q && q.length >= 2) params.set('q', q);

    const res = await api('/api/admin/campaigns?' + params.toString());
    if (!res.ok) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:30px;color:var(--danger)">조회 실패</td></tr>';
      return;
    }

    const list = res.data.data.list || [];
    const stats = res.data.data.stats || {};
    const pagination = res.data.data.pagination || {};

    /* KPI */
    const setKpi = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setKpi('cmpKpiTotal', (stats.total || 0).toLocaleString());
    setKpi('cmpKpiActive', (stats.active || 0).toLocaleString());
    setKpi('cmpKpiDraft', (stats.draft || 0).toLocaleString());
    setKpi('cmpKpiRaised', '₩ ' + (stats.totalRaisedActive || 0).toLocaleString());
    setKpi('cmpKpiDonors', (stats.totalDonorsActive || 0).toLocaleString());

    const countEl = document.getElementById('cmpCount');
    if (countEl) countEl.textContent = `${list.length}건 / 전체 ${(pagination.total || 0).toLocaleString()}`;

    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--text-3)">캠페인이 없습니다</td></tr>';
      return;
    }

    tbody.innerHTML = list.map((c) => {
      const goal = c.goalAmount || 0;
      const raised = c.raisedAmount || 0;
      const pct = goal > 0 ? Math.min(100, Math.round((raised / goal) * 100)) : null;
      const progressBar = pct !== null
        ? `<div style="background:#f0f0f0;border-radius:8px;height:8px;overflow:hidden">
            <div style="background:${pct >= 100 ? '#1a8b46' : 'var(--brand)'};height:100%;width:${pct}%"></div>
          </div>
          <div style="font-size:11px;color:var(--text-3);margin-top:2px">${pct}%</div>`
        : '<span style="font-size:11px;color:var(--text-3)">목표 미설정</span>';

      const period = c.startDate || c.endDate
        ? `${formatDate(c.startDate)}~${formatDate(c.endDate)}`
        : '<span style="color:var(--text-3)">—</span>';

      return `<tr>
        <td style="text-align:center">${c.isPinned ? '📌' : ''}</td>
        <td>${TYPE_LABEL[c.type] || c.type}</td>
        <td>
          <div><strong>${escapeHtml(c.title)}</strong>${c.isPublished ? '' : ' <span style="color:var(--text-3);font-size:10px">🔒</span>'}</div>
          <div style="font-size:11px;color:var(--text-3);font-family:Inter,monospace">${escapeHtml(c.slug)}</div>
        </td>
        <td>${STATUS_LABEL[c.status] || c.status}</td>
        <td>${progressBar}</td>
        <td style="font-family:Inter">₩${raised.toLocaleString()}</td>
        <td style="text-align:right">${(c.donorCount || 0).toLocaleString()}</td>
        <td style="font-size:11px">${period}</td>
        <td>
          <button type="button" class="btn-sm btn-sm-ghost" data-cmp-act="edit" data-id="${c.id}" style="font-size:11px">✏️ 수정</button>
          <button type="button" class="btn-sm btn-sm-ghost" data-cmp-act="stats" data-id="${c.id}" style="font-size:11px;color:var(--brand)">📊 통계</button>
          <button type="button" class="btn-sm btn-sm-ghost" data-cmp-act="recalc" data-id="${c.id}" style="font-size:11px">🔄</button>
        </td>
      </tr>`;
    }).join('');
  }

  /* ====== 모달 열기 ====== */
  async function openCampaignModal(id) {
    const modal = document.getElementById('campaignEditModal');
    if (!modal) return;

    const titleEl = document.getElementById('cmpModalTitle');
    const deleteBtn = document.getElementById('cmpDeleteBtn');

    /* 폼 초기화 */
    document.getElementById('cmpEditId').value = '';
    document.getElementById('cmpType').value = 'fundraising';
    document.getElementById('cmpStatus').value = 'draft';
    document.getElementById('cmpTitle').value = '';
    document.getElementById('cmpSlug').value = '';
    document.getElementById('cmpSummary').value = '';
    document.getElementById('cmpContentHtml').value = '';
    document.getElementById('cmpGoalAmount').value = '';
    document.getElementById('cmpStartDate').value = '';
    document.getElementById('cmpEndDate').value = '';
    document.getElementById('cmpPublished').checked = false;
    document.getElementById('cmpPinned').checked = false;
    document.getElementById('cmpThumbId').value = '';
    document.getElementById('cmpThumbPreview').style.backgroundImage = '';
    document.getElementById('cmpSlugPreview').textContent = '—';

    if (!id) {
      titleEl.textContent = '📢 새 캠페인';
      if (deleteBtn) deleteBtn.style.display = 'none';
      modal.classList.add('show');
      setTimeout(() => document.getElementById('cmpTitle')?.focus(), 100);
      return;
    }

    titleEl.textContent = '✏️ 캠페인 수정';
    if (deleteBtn) deleteBtn.style.display = '';
    modal.classList.add('show');

    const res = await api('/api/admin/campaigns?id=' + id);
    if (!res.ok || !res.data?.data?.campaign) {
      toast('캠페인 조회 실패');
      modal.classList.remove('show');
      return;
    }
    const c = res.data.data.campaign;
    document.getElementById('cmpEditId').value = String(c.id);
    document.getElementById('cmpType').value = c.type || 'fundraising';
    document.getElementById('cmpStatus').value = c.status || 'draft';
    document.getElementById('cmpTitle').value = c.title || '';
    document.getElementById('cmpSlug').value = c.slug || '';
    document.getElementById('cmpSummary').value = c.summary || '';
    document.getElementById('cmpContentHtml').value = c.contentHtml || '';
    document.getElementById('cmpGoalAmount').value = c.goalAmount || '';
    document.getElementById('cmpStartDate').value = c.startDate ? new Date(c.startDate).toISOString().slice(0, 10) : '';
    document.getElementById('cmpEndDate').value = c.endDate ? new Date(c.endDate).toISOString().slice(0, 10) : '';
    document.getElementById('cmpPublished').checked = !!c.isPublished;
    document.getElementById('cmpPinned').checked = !!c.isPinned;
    document.getElementById('cmpSlugPreview').textContent = c.slug || '—';
    if (c.thumbnailBlobId) {
      document.getElementById('cmpThumbId').value = String(c.thumbnailBlobId);
      document.getElementById('cmpThumbPreview').style.backgroundImage = `url('/api/blob-image?id=${c.thumbnailBlobId}')`;
    }
  }

  /* ====== 폼 제출 ====== */
  async function saveCampaign(e) {
    e.preventDefault();
    const id = document.getElementById('cmpEditId').value;
    const slug = normalizeSlug(document.getElementById('cmpSlug').value);
    document.getElementById('cmpSlug').value = slug;

    const body = {
      slug,
      type: document.getElementById('cmpType').value,
      status: document.getElementById('cmpStatus').value,
      title: document.getElementById('cmpTitle').value.trim(),
      summary: document.getElementById('cmpSummary').value.trim() || null,
      contentHtml: document.getElementById('cmpContentHtml').value.trim() || null,
      goalAmount: Number(document.getElementById('cmpGoalAmount').value) || null,
      startDate: document.getElementById('cmpStartDate').value || null,
      endDate: document.getElementById('cmpEndDate').value || null,
      isPublished: document.getElementById('cmpPublished').checked,
      isPinned: document.getElementById('cmpPinned').checked,
      thumbnailBlobId: Number(document.getElementById('cmpThumbId').value) || null,
    };

    if (!body.title) return toast('제목을 입력해주세요');
    if (!body.slug || body.slug.length < 3) return toast('slug를 3자 이상 입력해주세요');

    const btn = e.target.querySelector('button[type="submit"]');
    if (btn) { btn.disabled = true; btn.textContent = '저장 중...'; }

    try {
      const res = id
        ? await api('/api/admin/campaigns', { method: 'PATCH', body: { id: Number(id), ...body } })
        : await api('/api/admin/campaigns', { method: 'POST', body });

      if (res.ok) {
        toast(res.data?.message || '저장되었습니다');
        document.getElementById('campaignEditModal')?.classList.remove('show');
        loadCampaigns();
      } else {
        toast(res.data?.error || '저장 실패');
      }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '💾 저장'; }
    }
  }

  /* ====== 삭제 ====== */
  async function deleteCampaign() {
    const id = Number(document.getElementById('cmpEditId').value);
    if (!id) return;
    if (!confirm('이 캠페인을 삭제하시겠습니까?\n연결된 후원 내역의 캠페인 연결만 해제되며, 후원 내역 자체는 보존됩니다.')) return;

    const res = await api('/api/admin/campaigns?id=' + id, { method: 'DELETE' });
    if (res.ok) {
      toast(res.data?.message || '삭제되었습니다');
      document.getElementById('campaignEditModal')?.classList.remove('show');
      loadCampaigns();
    } else {
      toast(res.data?.error || '삭제 실패');
    }
  }

  /* ====== 통계 모달 (간단) ====== */
  async function showStats(id) {
    const res = await api('/api/admin/campaign-stats?id=' + id);
    if (!res.ok) return toast('통계 조회 실패');
    const d = res.data.data;
    const msg = `📊 ${d.campaign.title}\n\n` +
      `진행: ${d.stats.progressPercent || '-'}% (${d.stats.progressStatus})\n` +
      `모금: ₩${d.stats.raisedAmount.toLocaleString()} / ₩${(d.stats.goalAmount || 0).toLocaleString()}\n` +
      `후원자: ${d.stats.donorCount}명 (${d.stats.totalDonations}건)\n` +
      `평균: ₩${d.stats.avgAmount.toLocaleString()}\n` +
      `정기: ${d.stats.regularCount} / 일시: ${d.stats.onetimeCount}\n\n` +
      `최근 후원자:\n${d.recentDonors.slice(0, 3).map(r => `  - ${r.donorName}: ₩${r.amount.toLocaleString()}`).join('\n')}`;
    alert(msg);
  }

  /* ====== AI 카피 ====== */
  async function generateAiCopy() {
    const type = document.getElementById('cmpType').value;
    const theme = document.getElementById('cmpAiTheme').value.trim();
    const tone = document.getElementById('cmpAiTone').value;
    const goalAmount = Number(document.getElementById('cmpGoalAmount').value) || null;

    if (!theme || theme.length < 5) return toast('주제를 5자 이상 입력해주세요');

    const btn = document.getElementById('cmpAiBtn');
    btn.disabled = true;
    btn.textContent = '⏳ 생성 중... (3~5초)';

    try {
      const res = await api('/api/admin/campaign-ai-copy', {
        method: 'POST',
        body: { type, theme, toneOfVoice: tone, goalAmount },
      });
      if (res.ok && res.data?.data) {
        const d = res.data.data;
        const overwrite = !document.getElementById('cmpTitle').value || confirm('기존 입력값이 있습니다. AI 결과로 덮어쓸까요?');
        if (overwrite) {
          document.getElementById('cmpTitle').value = d.suggestedTitle || '';
          document.getElementById('cmpSummary').value = d.suggestedSummary || '';
          document.getElementById('cmpContentHtml').value = d.suggestedContent || '';
          /* slug 자동 생성 (영문 미존재 시 한글이라도 유지) */
          if (!document.getElementById('cmpSlug').value && d.suggestedTitle) {
            const auto = normalizeSlug(d.suggestedTitle.slice(0, 30));
            document.getElementById('cmpSlug').value = auto;
            document.getElementById('cmpSlugPreview').textContent = auto;
          }
          toast('AI 카피가 생성되었습니다');
        }
      } else {
        toast(res.data?.error || 'AI 생성 실패');
      }
    } finally {
      btn.disabled = false;
      btn.textContent = '✨ AI 카피 생성';
    }
  }

  /* ====== 썸네일 업로드 ====== */
  function setupThumbUpload() {
    const btn = document.getElementById('cmpThumbBtn');
    const input = document.getElementById('cmpThumbInput');
    const clearBtn = document.getElementById('cmpThumbClearBtn');

    if (btn) btn.addEventListener('click', () => input?.click());
    if (clearBtn) clearBtn.addEventListener('click', () => {
      document.getElementById('cmpThumbId').value = '';
      document.getElementById('cmpThumbPreview').style.backgroundImage = '';
    });

    if (input) input.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      input.value = '';
      if (!window.SirenEditor || !window.SirenEditor.uploadFile) {
        return toast('업로드 모듈을 찾을 수 없습니다');
      }
      toast('업로드 중...');
      try {
        let toUpload = file;
        if (window.SirenEditor.compressImage) {
          toUpload = await window.SirenEditor.compressImage(file, 1600, 0.85);
        }
        const r = await window.SirenEditor.uploadFile(toUpload, 'campaign');
        if (r && r.id) {
          document.getElementById('cmpThumbId').value = String(r.id);
          document.getElementById('cmpThumbPreview').style.backgroundImage = `url('/api/blob-image?id=${r.id}')`;
          toast('썸네일이 업로드되었습니다');
        }
      } catch (e) {
        toast('업로드 실패');
      }
    });
  }

  /* ====== 이벤트 등록 ====== */
  function setupCampaigns() {
    /* 검색/필터 */
    const qInput = document.getElementById('cmpFilterQ');
    if (qInput) qInput.addEventListener('input', () => {
      clearTimeout(_cmpSearchTimer);
      _cmpSearchTimer = setTimeout(loadCampaigns, 400);
    });
    ['cmpFilterType', 'cmpFilterStatus', 'cmpFilterPublished'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', loadCampaigns);
    });

    /* slug 미리보기 */
    const slugInput = document.getElementById('cmpSlug');
    if (slugInput) slugInput.addEventListener('input', (e) => {
      document.getElementById('cmpSlugPreview').textContent = normalizeSlug(e.target.value) || '—';
    });

    /* 신규 / 재계산 / 행 액션 */
    document.addEventListener('click', async (e) => {
      if (e.target.closest('#cmpNewBtn')) {
        e.preventDefault();
        openCampaignModal(null);
        return;
      }
      if (e.target.closest('#cmpRecalcAllBtn')) {
        e.preventDefault();
        if (!confirm('모든 활성 캠페인의 통계를 재계산하시겠습니까?')) return;
        const r = await api('/api/admin/campaign-stats', { method: 'POST', body: {} });
        if (r.ok) {
          toast(r.data?.message || '재계산 완료');
          loadCampaigns();
        } else {
          toast(r.data?.error || '재계산 실패');
        }
        return;
      }
      if (e.target.closest('#cmpAiBtn')) {
        e.preventDefault();
        generateAiCopy();
        return;
      }
      if (e.target.closest('#cmpDeleteBtn')) {
        e.preventDefault();
        deleteCampaign();
        return;
      }

      const actBtn = e.target.closest('[data-cmp-act]');
      if (actBtn) {
        e.preventDefault();
        const act = actBtn.dataset.cmpAct;
        const id = Number(actBtn.dataset.id);
        if (!id) return;
        if (act === 'edit') openCampaignModal(id);
        else if (act === 'stats') showStats(id);
        else if (act === 'recalc') {
          const r = await api('/api/admin/campaign-stats', { method: 'POST', body: { id } });
          if (r.ok) {
            toast('재계산 완료');
            loadCampaigns();
          } else {
            toast('재계산 실패');
          }
        }
      }
    });

    /* 폼 제출 */
    const form = document.getElementById('campaignEditForm');
    if (form) form.addEventListener('submit', saveCampaign);

    setupThumbUpload();
  }

  window.SIREN_ADMIN_CAMPAIGNS = { loadCampaigns, openCampaignModal };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupCampaigns);
  } else {
    setupCampaigns();
  }
})();