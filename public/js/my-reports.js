/* =========================================================
   SIREN — my-reports.js (Phase 12 신고 진행 공개)
   - 사용자가 본인 신고의 처리 단계를 타임라인으로 확인
   ========================================================= */
(function () {
  'use strict';

  const PAGE_SIZE = 10;
  let _activeTab = 'incident';
  let _page = 1;

  /* ── 상수 ── */
  const TAB_CONFIG = {
    incident:   { label: '사건 제보',   api: '/api/user-my-reports?type=incident',   icon: '', typeLabel: '사건 제보' },
    harassment: { label: '악성민원',    api: '/api/user-my-reports?type=harassment', icon: '', typeLabel: '악성민원 신고' },
    legal:      { label: '법률지원',    api: '/api/user-my-reports?type=legal',      icon: '', typeLabel: '법률 지원' },
  };

  const STATUS_LABEL = {
    submitted:   '접수 완료',
    ai_analyzed: 'AI 분석 완료',
    reviewing:   '검토 중',
    matching:    '담당자 배정 중',
    matched:     '담당자 배정 완료',
    in_progress: '처리 중',
    responded:   '답변 완료',
    completed:   '처리 완료',
    closed:      '종결',
    rejected:    '반려',
  };

  /* 신고 유형별 단계 흐름 — US-020: 실제 DB status enum과 1:1 정합.
     (incident/harassment enum: submitted·ai_analyzed·reviewing·responded·closed·rejected
      legal enum: submitted·ai_analyzed·matching·matched·in_progress·responded·closed·rejected)
     이전엔 in_progress·completed·responding 같이 enum에 없는 '유령 단계'가 타임라인에 항상 회색으로 떠
     '아직 처리 중 단계가 남았나' 오해를 유발했음. rejected는 종결 분기라 배지로만 표시. */
  const STAGE_FLOW = {
    incident: ['submitted', 'ai_analyzed', 'reviewing', 'responded', 'closed'],
    harassment: ['submitted', 'ai_analyzed', 'reviewing', 'responded', 'closed'],
    legal: ['submitted', 'ai_analyzed', 'matching', 'matched', 'in_progress', 'responded', 'closed'],
  };

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '.' +
      String(d.getMonth() + 1).padStart(2, '0') + '.' +
      String(d.getDate()).padStart(2, '0') + ' ' +
      String(d.getHours()).padStart(2, '0') + ':' +
      String(d.getMinutes()).padStart(2, '0');
  }

  function statusBadge(status) {
    const cls = 'status-' + (status || 'submitted');
    const label = STATUS_LABEL[status] || status;
    return `<span class="report-status-badge ${escapeHtml(cls)}">${escapeHtml(label)}</span>`;
  }

  /* ── 타임라인 HTML 생성 ── */
  function buildTimeline(report, tabKey) {
    const flow = STAGE_FLOW[tabKey] || STAGE_FLOW.incident;
    const current = report.status || 'submitted';
    const curIdx = flow.indexOf(current);
    const isTerminal = current === 'closed' || current === 'rejected';

    let html = '<div class="timeline">';
    flow.forEach((stage, i) => {
      const isPast = isTerminal ? i <= flow.indexOf('closed') : i < curIdx;
      const isActive = stage === current;
      const isFuture = !isPast && !isActive;

      let dotClass = isFuture ? '' : (isActive ? 'active' : 'completed');
      let labelClass = isFuture ? 'dimmed' : '';
      const label = STATUS_LABEL[stage] || stage;

      /* 해당 단계의 일시 */
      let dateStr = '';
      if (!isFuture && report.statusHistory) {
        const entry = report.statusHistory.find((h) => h.status === stage);
        if (entry) dateStr = fmtDate(entry.changedAt);
      } else if (isActive) {
        dateStr = fmtDate(report.updatedAt || report.createdAt);
      }

      html += `
        <div class="tl-item">
          <div class="tl-dot ${escapeHtml(dotClass)}"></div>
          <div class="tl-label ${escapeHtml(labelClass)}">${escapeHtml(label)}</div>
          ${dateStr ? `<div class="tl-date">${escapeHtml(dateStr)}</div>` : ''}
        </div>
      `;
    });

    if (current === 'rejected') {
      html += `
        <div class="tl-item">
          <div class="tl-dot active" style="background:#ef4444;box-shadow:0 0 0 2px #ef4444"></div>
          <div class="tl-label">반려</div>
          ${report.rejectedReason ? `<div class="tl-desc">사유: ${escapeHtml(report.rejectedReason)}</div>` : ''}
        </div>
      `;
    }

    html += '</div>';
    return html;
  }

  /* ── 카드 HTML 생성 ── */
  function buildCard(report, tabKey) {
    const cfg = TAB_CONFIG[tabKey];
    const anonBadge = report.isAnonymous ? '<span class="anon-badge">익명</span>' : '';
    const title = report.title || report.subject || cfg.typeLabel;
    const cardId = 'card-tl-' + report.id;
    /* R41 Q2-004: 운영자 검토 전(submitted·ai_analyzed)까지 본인 수정/삭제 허용
       2026-06-27: 반려(rejected)도 수정 후 재제출 허용(저장 시 접수 상태로 복귀) */
    const isEditable = ['submitted', 'ai_analyzed', 'rejected'].includes(report.status || '');

    const editBtn = isEditable
      ? `<button type="button" class="rpt-edit-btn" data-rpt-edit="${report.id}" data-tab="${tabKey}">수정</button>`
      : '';
    /* 법률 상담만 삭제 버튼 추가 */
    const deleteBtn = (tabKey === 'legal' && isEditable)
      ? `<button type="button" class="rpt-del-btn" data-rpt-del="${report.id}" data-tab="${tabKey}" data-no="${escapeHtml(String(report.reportNo || report.id))}">삭제</button>`
      : '';

    return `
      <div class="report-card">
        <div class="report-card-header">
          <div class="report-card-icon">${cfg.icon}</div>
          <div class="report-card-info">
            <div class="report-card-title">${escapeHtml(title)}${anonBadge}</div>
            <div class="report-card-meta">
              접수번호 ${escapeHtml(String(report.reportNo || report.id))} · 접수일 ${fmtDate(report.createdAt)}
            </div>
          </div>
          ${statusBadge(report.status)}
        </div>

        ${report.aiSummary ? `
          <div style="background:var(--bg-soft);border-radius:8px;padding:12px 14px;margin-bottom:12px;font-size:13px;color:var(--text-2);line-height:1.7">
            <strong style="color:var(--ink)">AI 분석 요약</strong><br>${escapeHtml(report.aiSummary)}
          </div>
        ` : ''}

        ${report.adminResponse ? `
          <div style="background:#fffaf5;border:1px solid #f5dcc8;border-radius:8px;padding:12px 14px;margin-bottom:12px;font-size:13px;line-height:1.7">
            <strong style="color:var(--brand)">담당자 답변</strong><br>${escapeHtml(report.adminResponse)}
            ${report.respondedAt ? `<div style="font-size:11px;color:var(--text-3);margin-top:4px">${fmtDate(report.respondedAt)}</div>` : ''}
          </div>
        ` : ''}

        <div id="${escapeHtml(cardId)}" style="display:none">
          ${buildTimeline(report, tabKey)}
        </div>

        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <button class="toggle-tl-btn" onclick="toggleTimeline('${escapeHtml(cardId)}', this)">
            처리 단계 타임라인 보기
          </button>
          ${editBtn}
          ${deleteBtn}
        </div>
      </div>
    `;
  }

  /* ── 타임라인 토글 ── */
  window.toggleTimeline = function (id, btn) {
    const el = document.getElementById(id);
    if (!el) return;
    const isOpen = el.style.display !== 'none';
    el.style.display = isOpen ? 'none' : '';
    btn.textContent = isOpen ? '처리 단계 타임라인 보기' : '▼ 타임라인 닫기';
  };

  /* ── 목록 로드 ── */
  async function loadList() {
    const cfg = TAB_CONFIG[_activeTab];
    const list = document.getElementById('reportsList');
    list.innerHTML = '<div class="report-empty"><div class="icon"></div>불러오는 중...</div>';

    try {
      const params = new URLSearchParams({ page: _page, limit: PAGE_SIZE });
      const res = await fetch(cfg.api + '?' + params, { credentials: 'include' });
      const json = await res.json();

      if (!res.ok || !json.ok) {
        if (res.status === 401) {
          list.innerHTML = '<div class="report-empty"><div class="icon"></div>로그인이 필요합니다</div>';
          return;
        }
        list.innerHTML = '<div class="report-empty"><div class="icon"></div>불러오지 못했습니다</div>';
        return;
      }

      const rows = json.items || json.data?.rows || json.data?.list || json.data || [];
      const total = json.total || json.data?.total || rows.length;
      const totalPages = Math.ceil(total / PAGE_SIZE) || 1;

      if (!rows.length) {
        const goUrl = _activeTab === 'incident' ? '/incidents.html'
          : _activeTab === 'harassment' ? '/report-harassment.html'
          : '/legal-support.html';
        list.innerHTML = `
          <div class="report-empty">
            <div class="icon">${cfg.icon}</div>
            아직 접수된 ${escapeHtml(cfg.typeLabel)}이 없습니다
            <br><a href="${goUrl}">${escapeHtml(cfg.typeLabel)} 신청하러 가기</a>
          </div>`;
        document.getElementById('reportsPagination').style.display = 'none';
        return;
      }

      list.innerHTML = rows.map((r) => buildCard(r, _activeTab)).join('');
      renderPagination(totalPages);
      bindCardActions(rows);
    } catch (e) {
      console.error('[my-reports]', e);
      list.innerHTML = '<div class="report-empty"><div class="icon"></div>네트워크 오류</div>';
    }
  }

  /* ── 페이지네이션 ── */
  function renderPagination(totalPages) {
    const box = document.getElementById('reportsPagination');
    if (totalPages <= 1) { box.style.display = 'none'; return; }
    box.style.display = 'flex';

    const maxBtns = 5;
    let start = Math.max(1, _page - 2);
    let end = Math.min(totalPages, start + maxBtns - 1);
    if (end - start < maxBtns - 1) start = Math.max(1, end - maxBtns + 1);

    let html = `<button data-p="1" ${_page === 1 ? 'disabled' : ''}>«</button>`;
    html += `<button data-p="${_page - 1}" ${_page <= 1 ? 'disabled' : ''}>‹</button>`;
    for (let i = start; i <= end; i++) {
      html += `<button data-p="${i}" class="${i === _page ? 'active' : ''}">${i}</button>`;
    }
    html += `<button data-p="${_page + 1}" ${_page >= totalPages ? 'disabled' : ''}>›</button>`;
    html += `<button data-p="${totalPages}" ${_page >= totalPages ? 'disabled' : ''}>»</button>`;
    box.innerHTML = html;

    box.querySelectorAll('button[data-p]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        const p = Number(btn.dataset.p);
        if (Number.isFinite(p)) { _page = p; loadList(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
      });
    });
  }

  /* =========================================================
     round8: 수정/삭제 버튼 이벤트 바인딩
     ========================================================= */
  function bindCardActions(rows) {
    /* 수정 버튼 */
    document.querySelectorAll('[data-rpt-edit]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = Number(btn.dataset.rptEdit);
        const tabKey = btn.dataset.tab;
        const report = rows.find((r) => r.id === id);
        if (report) openReportEditModal(tabKey, report);
      });
    });
    /* 삭제 버튼 (법률) */
    document.querySelectorAll('[data-rpt-del]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = Number(btn.dataset.rptDel);
        const no = btn.dataset.no || String(id);
        deleteReport(id, no);
      });
    });
  }

  /* ── 수정 모달 열기 ── */
  function openReportEditModal(tabKey, report) {
    const existing = document.getElementById('reportEditModal');
    if (existing) existing.remove();

    const id = report.id;
    const title = report.title || '';
    const content = (report.contentHtml || report.content || '').replace(/<[^>]+>/g, '');
    const category = report.category || '';

    /* 탭별 카테고리 옵션 */
    const catMap = {
      incident:   [{ value: 'school', label: '학교' }, { value: 'public', label: '공공' }, { value: 'other', label: '기타' }],
      harassment: [{ value: 'parent', label: '학부모' }, { value: 'student', label: '학생' }, { value: 'admin', label: '관리자' }, { value: 'colleague', label: '동료' }, { value: 'other', label: '기타' }],
      legal:      [{ value: 'school_dispute', label: '교권/학교' }, { value: 'civil', label: '민사' }, { value: 'criminal', label: '형사' }, { value: 'family', label: '가사' }, { value: 'labor', label: '노동' }, { value: 'contract', label: '계약' }, { value: 'other', label: '기타' }],
    };
    const catOptions = (catMap[tabKey] || [])
      .map((o) => `<option value="${o.value}" ${category === o.value ? 'selected' : ''}>${o.label}</option>`)
      .join('');

    /* 탭별 추가 필드 */
    let extraFields = '';
    if (tabKey === 'harassment') {
      /* R41 Q2-011: 발생일은 occurredAt 키로 통일(서버·신고폼 일치), 빈도는 enum(once|recurring|ongoing) 선택 */
      const freq = report.frequency || '';
      const occurred = report.occurredAt ? String(report.occurredAt).slice(0, 10) : '';
      const freqOptions = [
        { value: '', label: '선택 안 함' },
        { value: 'once', label: '1회성' },
        { value: 'recurring', label: '반복적' },
        { value: 'ongoing', label: '진행 중' },
      ].map((o) => `<option value="${o.value}" ${freq === o.value ? 'selected' : ''}>${o.label}</option>`).join('');
      extraFields = `
        <div style="margin-bottom:14px">
          <label style="display:block;font-size:12.5px;font-weight:700;margin-bottom:6px;color:var(--text-2)">발생일</label>
          <input type="date" id="reOccurredAt" value="${escapeHtml(occurred)}"
            style="width:100%;padding:10px 14px;border:1px solid var(--line);border-radius:6px;font-size:13px;font-family:inherit;box-sizing:border-box">
        </div>
        <div style="margin-bottom:14px">
          <label style="display:block;font-size:12.5px;font-weight:700;margin-bottom:6px;color:var(--text-2)">발생 빈도</label>
          <select id="reFrequency"
            style="width:100%;padding:10px 14px;border:1px solid var(--line);border-radius:6px;font-size:13px;font-family:inherit;box-sizing:border-box">
            ${freqOptions}
          </select>
        </div>
      `;
    }
    if (tabKey === 'legal') {
      const urgency = report.urgency || report.aiUrgency || '';
      const partyInfo = report.partyInfo || '';
      /* R41 Q2-011: 긴급도 값을 서버 검증(urgent|normal|reference)·신고폼과 일치 */
      const urgencyOptions = [
        { value: 'urgent', label: '긴급' },
        { value: 'normal', label: '보통' },
        { value: 'reference', label: '참고' },
      ].map((o) => `<option value="${o.value}" ${urgency === o.value ? 'selected' : ''}>${o.label}</option>`).join('');
      extraFields = `
        <div style="margin-bottom:14px">
          <label style="display:block;font-size:12.5px;font-weight:700;margin-bottom:6px;color:var(--text-2)">긴급도</label>
          <select id="reUrgency"
            style="width:100%;padding:10px 14px;border:1px solid var(--line);border-radius:6px;font-size:13px;font-family:inherit;box-sizing:border-box">
            ${urgencyOptions}
          </select>
        </div>
        <div style="margin-bottom:14px">
          <label style="display:block;font-size:12.5px;font-weight:700;margin-bottom:6px;color:var(--text-2)">당사자 정보</label>
          <textarea id="rePartyInfo" maxlength="500" rows="3"
            style="width:100%;padding:10px 14px;border:1px solid var(--line);border-radius:6px;font-size:13px;font-family:inherit;resize:vertical;box-sizing:border-box"
            placeholder="상대방 정보, 관계 등 (선택)">${escapeHtml(partyInfo)}</textarea>
        </div>
      `;
    }

    const typeLabel = TAB_CONFIG[tabKey] ? TAB_CONFIG[tabKey].label : tabKey;
    const modal = document.createElement('div');
    modal.id = 'reportEditModal';
    modal.style.cssText = 'display:flex !important;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:10002;align-items:flex-start;justify-content:center;padding:30px 16px;overflow-y:auto';
    modal.innerHTML = `
      <div style="background:#fff;border-radius:12px;max-width:580px;width:100%;margin:auto;box-shadow:0 24px 60px rgba(0,0,0,0.3);overflow:hidden">
        <div style="padding:16px 24px;background:linear-gradient(135deg,#1e3a5f,#1a56db);color:#fff;display:flex;justify-content:space-between;align-items:center">
          <div>
            <div style="font-family:'Noto Serif KR',serif;font-size:16px;font-weight:700">${escapeHtml(typeLabel)} 수정</div>
            <div style="font-size:11.5px;opacity:0.85;margin-top:2px">접수 상태에서만 수정 가능합니다</div>
          </div>
          <button type="button" data-re-close style="background:transparent;border:none;color:#fff;font-size:24px;cursor:pointer;line-height:1">&times;</button>
        </div>
        <div style="padding:22px 24px">
          <input type="hidden" id="reId" value="${id}">
          <input type="hidden" id="reTab" value="${tabKey}">

          <div style="margin-bottom:14px">
            <label style="display:block;font-size:12.5px;font-weight:700;margin-bottom:6px;color:var(--text-2)">
              제목 <span style="color:#dc2626">*</span>
            </label>
            <input type="text" id="reTitle" maxlength="200" value="${escapeHtml(title)}"
              style="width:100%;padding:10px 14px;border:1px solid var(--line);border-radius:6px;font-size:13px;font-family:inherit;box-sizing:border-box"
              placeholder="제목을 입력해 주세요">
          </div>

          ${catOptions ? `
          <div style="margin-bottom:14px">
            <label style="display:block;font-size:12.5px;font-weight:700;margin-bottom:6px;color:var(--text-2)">분류</label>
            <select id="reCategory"
              style="width:100%;padding:10px 14px;border:1px solid var(--line);border-radius:6px;font-size:13px;font-family:inherit;box-sizing:border-box">
              ${catOptions}
            </select>
          </div>` : ''}

          ${extraFields}

          <div style="margin-bottom:16px">
            <label style="display:block;font-size:12.5px;font-weight:700;margin-bottom:6px;color:var(--text-2)">
              내용 <span style="color:#dc2626">*</span>
              <span style="font-weight:400;color:var(--text-3);font-size:11px">(10자 이상 5000자 이내)</span>
            </label>
            <textarea id="reContent" maxlength="5000" rows="9"
              style="width:100%;padding:11px 14px;border:1px solid var(--line);border-radius:6px;font-size:13px;font-family:inherit;line-height:1.7;resize:vertical;box-sizing:border-box;min-height:180px"
              placeholder="내용을 상세히 작성해 주세요">${escapeHtml(content)}</textarea>
            <div style="font-size:11px;color:var(--text-3);margin-top:4px;text-align:right" id="reContentCount">0 / 5000</div>
          </div>

          <div style="display:flex;gap:10px">
            <button type="button" data-re-close style="flex:1;padding:11px 0;background:transparent;border:1px solid var(--line);color:var(--text-2);border-radius:6px;font-size:13.5px;font-weight:600;cursor:pointer;font-family:inherit">취소</button>
            <button type="button" id="reSubmitBtn" style="flex:2;padding:11px 0;background:#1a56db;color:#fff;border:none;border-radius:6px;font-size:13.5px;font-weight:700;cursor:pointer;font-family:inherit">저장하기</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';

    /* 글자수 카운터 초기화 */
    const contentEl = modal.querySelector('#reContent');
    const countEl = modal.querySelector('#reContentCount');
    countEl.textContent = `${contentEl.value.length} / 5000`;
    contentEl.addEventListener('input', () => {
      countEl.textContent = `${contentEl.value.length} / 5000`;
    });

    /* 닫기 */
    modal.querySelectorAll('[data-re-close]').forEach((btn) => {
      btn.addEventListener('click', closeReportEditModal);
    });
    modal.addEventListener('click', (e) => { if (e.target === modal) closeReportEditModal(); });
    const escHandler = (e) => {
      if (e.key === 'Escape') { closeReportEditModal(); document.removeEventListener('keydown', escHandler); }
    };
    document.addEventListener('keydown', escHandler);

    /* 저장 */
    modal.querySelector('#reSubmitBtn').addEventListener('click', submitReportEdit);
  }

  function closeReportEditModal() {
    const m = document.getElementById('reportEditModal');
    if (m) m.remove();
    document.body.style.overflow = '';
  }

  async function submitReportEdit() {
    const idEl       = document.getElementById('reId');
    const tabEl      = document.getElementById('reTab');
    const titleEl    = document.getElementById('reTitle');
    const contentEl  = document.getElementById('reContent');
    const catEl      = document.getElementById('reCategory');
    const submitBtn  = document.getElementById('reSubmitBtn');
    if (!idEl || !titleEl || !contentEl || !submitBtn) return;

    const id      = Number(idEl.value);
    const tabKey  = tabEl ? tabEl.value : _activeTab;
    const title   = (titleEl.value || '').trim();
    const content = (contentEl.value || '').trim();
    const category = catEl ? catEl.value : '';

    if (!title) { window.SIREN && window.SIREN.toast('제목을 입력해 주세요'); titleEl.focus(); return; }
    if (content.length < 10) { window.SIREN && window.SIREN.toast('내용을 10자 이상 입력해 주세요'); contentEl.focus(); return; }

    /* 탭별 추가 필드 수집 */
    const extra = {};
    if (tabKey === 'harassment') {
      /* R41 Q2-011: 발생일 occurredAt 키·빈도 enum 전송 */
      const dateEl = document.getElementById('reOccurredAt');
      const freqEl = document.getElementById('reFrequency');
      if (dateEl && dateEl.value) extra.occurredAt = dateEl.value;
      if (freqEl && freqEl.value) extra.frequency = freqEl.value;
    }
    if (tabKey === 'legal') {
      const urgEl   = document.getElementById('reUrgency');
      const partyEl = document.getElementById('rePartyInfo');
      if (urgEl) extra.urgency = urgEl.value;
      if (partyEl) extra.partyInfo = partyEl.value.trim();
    }

    const oldText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = '저장 중...';

    try {
      const apiPath = tabKey === 'incident'   ? '/api/incident-report-update'
                    : tabKey === 'harassment'  ? '/api/harassment-report-update'
                    :                           '/api/legal-consultation-update';
      const res = await fetch(apiPath, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, title, content, category, ...extra }),
      });
      const json = await res.json();

      if (!json || !json.ok) {
        window.SIREN && window.SIREN.toast(json.error || '수정 실패');
        submitBtn.disabled = false;
        submitBtn.textContent = oldText;
        return;
      }

      window.SIREN && window.SIREN.toast('수정되었습니다.');
      closeReportEditModal();
      _page = 1;
      await loadList();
    } catch (e) {
      console.error('[submitReportEdit]', e);
      window.SIREN && window.SIREN.toast('네트워크 오류');
      submitBtn.disabled = false;
      submitBtn.textContent = oldText;
    }
  }

  /* ── 법률 상담 삭제 ── */
  async function deleteReport(id, no) {
    if (!confirm(`"${no}"을(를) 삭제하시겠습니까?\n삭제된 내역은 복구할 수 없습니다.`)) return;

    try {
      const res = await fetch('/api/legal-consultation-delete', {
        method: 'DELETE', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const json = await res.json();

      if (!json || !json.ok) {
        window.SIREN && window.SIREN.toast(json.error || '삭제 실패');
        return;
      }

      window.SIREN && window.SIREN.toast('삭제되었습니다.');
      _page = 1;
      await loadList();
    } catch (e) {
      console.error('[deleteReport]', e);
      window.SIREN && window.SIREN.toast('네트워크 오류');
    }
  }

  /* ── 초기화 ── */
  function init() {
    if (document.body.dataset.page !== 'my-reports') return;

    /* 로그인 확인 */
    setTimeout(() => {
      const auth = window.SIREN_AUTH;
      if (!auth || !auth.isLoggedIn()) {
        window.SIREN.toast('로그인이 필요합니다');
        setTimeout(() => location.href = '/index.html', 1000);
      }
    }, 1200);

    document.querySelectorAll('.report-tab').forEach((t) => {
      t.addEventListener('click', () => {
        document.querySelectorAll('.report-tab').forEach((x) => x.classList.remove('active'));
        t.classList.add('active');
        _activeTab = t.dataset.tab;
        _page = 1;
        loadList();
      });
    });

    loadList();
  }

  const prevInit = window.SIREN_PAGE_INIT;
  window.SIREN_PAGE_INIT = function () {
    if (typeof prevInit === 'function') prevInit();
    init();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
