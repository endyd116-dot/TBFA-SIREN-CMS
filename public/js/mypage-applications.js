/* =========================================================
   SIREN — mypage-applications.js (★ Phase M-9)
   - 마이페이지 "📋 신청 내역" 통합 탭
   - 4개 서브탭: family / incident / harassment / legal
   ========================================================= */
(function () {
  'use strict';

  /* ============ 헬퍼 ============ */
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.getFullYear() + '.' +
      String(d.getMonth() + 1).padStart(2, '0') + '.' +
      String(d.getDate()).padStart(2, '0');
  }

  function fmtDateTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.getFullYear() + '.' +
      String(d.getMonth() + 1).padStart(2, '0') + '.' +
      String(d.getDate()).padStart(2, '0') + ' ' +
      String(d.getHours()).padStart(2, '0') + ':' +
      String(d.getMinutes()).padStart(2, '0');
  }

  function statusLabel(s) {
    const map = {
      submitted: '접수',
      ai_analyzed: 'AI 분석 완료',
      reviewing: '검토 중',
      matching: '매칭 중',
      matched: '매칭 완료',
      in_progress: '진행 중',
      responded: '답변 완료',
      completed: '완료',
      closed: 'AI만 종료',
      rejected: '반려',
      supplement: '보완 요청',
    };
    return map[s] || s;
  }

  function severityLabel(s, type) {
    if (type === 'legal') {
      const m = { urgent: '🚨 긴급', high: '⚠️ 높음', normal: '⚖️ 보통', low: '💡 낮음' };
      return m[s] || s;
    }
    const m = {
      critical: '🚨 CRITICAL', high: '⚠️ HIGH',
      medium: '⚖️ MEDIUM', low: '💡 LOW',
    };
    return m[s] || s;
  }

  function categoryLabel(c, type) {
    if (type === 'family') {
      return { counseling: '심리상담', legal: '법률자문', scholarship: '장학', other: '기타' }[c] || c;
    }
    if (type === 'harassment') {
      return { parent: '학부모', student: '학생', admin: '관리자', colleague: '동료', other: '기타' }[c] || c;
    }
    if (type === 'legal') {
      return {
        school_dispute: '교권/학교', civil: '민사', criminal: '형사',
        family: '가사', labor: '노동', contract: '계약', other: '기타',
      }[c] || c;
    }
    if (type === 'incident') {
      return { school: '학교', public: '공공', other: '기타' }[c] || c;
    }
    return c;
  }

  /* ============ API 매핑 ============ */
  const TYPES = {
    family: {
      label: '유가족 지원',
      listApi: '/api/support/mine',
      deleteApi: null, // 유가족 지원은 별도 삭제 미구현
      newPage: '/support.html#family',
      itemKey: 'list',
      idField: 'id',
      noField: 'requestNo',
      titleField: 'title',
      summaryField: 'content',
      statusField: 'status',
      categoryField: 'category',
      severityField: 'priority',
    },
    incident: {
      label: '사건 제보',
      listApi: '/api/incident-reports/mine',
      detailApi: '/api/incident-report-detail',
      deleteApi: '/api/incident-report-delete',
      newPage: '/incidents.html',
      itemKey: 'list',
      idField: 'id',
      noField: 'reportNo',
      titleField: 'title',
      summaryField: 'aiSummary',
      statusField: 'status',
      severityField: 'aiSeverity',
    },
    harassment: {
      label: '악성민원 신고',
      listApi: '/api/harassment-reports/mine',
      detailApi: '/api/harassment-report-detail',
      deleteApi: '/api/harassment-report-delete',
      newPage: '/report-harassment.html',
      itemKey: 'list',
      idField: 'id',
      noField: 'reportNo',
      titleField: 'title',
      summaryField: 'aiSummary',
      statusField: 'status',
      categoryField: 'category',
      severityField: 'aiSeverity',
    },
    legal: {
      label: '법률지원 상담',
      listApi: '/api/legal-consultations/mine',
      detailApi: '/api/legal-consultation-detail',
      deleteApi: '/api/legal-consultation-delete',
      newPage: '/legal-support.html',
      itemKey: 'list',
      idField: 'id',
      noField: 'consultationNo',
      titleField: 'title',
      summaryField: 'aiSummary',
      statusField: 'status',
      categoryField: 'category',
      severityField: 'aiUrgency',
    },
  };

  /* ============ 캐시 ============ */
  const _cache = {};
  let _currentTab = 'family';
  let _initialized = false;

  /* ============ 데이터 로드 ============ */
  async function loadTab(tabKey) {
    const cfg = TYPES[tabKey];
    if (!cfg) return;

    const pane = document.querySelector(`[data-app-pane="${tabKey}"]`);
    if (!pane) return;

    if (_cache[tabKey]) {
      renderTab(tabKey, _cache[tabKey]);
      return;
    }

    pane.innerHTML = '<div style="text-align:center;color:var(--text-3);padding:40px;font-size:13px">로딩 중...</div>';

    try {
      const res = await fetch(cfg.listApi, { credentials: 'include' });
      const json = await res.json();

      if (!res.ok || !json.ok) {
        if (res.status === 401) {
          pane.innerHTML = '<div class="app-empty"><div class="icon">🔒</div><div class="title">로그인이 필요합니다</div></div>';
          return;
        }
        pane.innerHTML = `<div class="app-empty"><div class="icon">⚠️</div><div class="title">불러오기 실패</div><div class="desc">${escapeHtml(json.error || '잠시 후 다시 시도해 주세요')}</div></div>`;
        return;
      }

      const list = (json.data && json.data[cfg.itemKey]) || [];
      _cache[tabKey] = list;
      updateCount(tabKey, list.length);
      renderTab(tabKey, list);
    } catch (e) {
      console.error('[applications.loadTab]', tabKey, e);
      pane.innerHTML = `<div class="app-empty"><div class="icon">⚠️</div><div class="title">네트워크 오류</div></div>`;
    }
  }

  function updateCount(tabKey, n) {
    const badge = document.querySelector(`[data-count="${tabKey}"]`);
    if (badge) badge.textContent = n > 99 ? '99+' : String(n);
  }

  /* ============ 렌더 ============ */
  function renderTab(tabKey, list) {
    const cfg = TYPES[tabKey];
    const pane = document.querySelector(`[data-app-pane="${tabKey}"]`);
    if (!pane) return;

    if (!list || !list.length) {
      pane.innerHTML = `
        <div class="app-empty">
          <div class="icon">📭</div>
          <div class="title">${escapeHtml(cfg.label)} 신청 내역이 없습니다</div>
          <div class="desc">필요하실 때 언제든 신청하실 수 있습니다.</div>
          <a href="${escapeHtml(cfg.newPage)}" class="new-btn">+ 새 신청하기</a>
        </div>`;
      return;
    }

    let html = '<ul class="app-list">';
    list.forEach((item) => {
      const id = item[cfg.idField];
      const no = item[cfg.noField] || '';
      const title = item[cfg.titleField] || '(제목 없음)';
      const status = item[cfg.statusField] || 'submitted';
      const severity = cfg.severityField ? item[cfg.severityField] : null;
      const category = cfg.categoryField ? item[cfg.categoryField] : null;
      const summary = (item[cfg.summaryField] || '').toString().slice(0, 200);
      const hasResponse = item.adminResponse || item.respondedAt;
      const sirenRequested = item.sirenReportRequested === true;
      const sirenDeclined = item.sirenReportRequested === false;

      const sevBadge = severity
        ? `<span class="severity app-severity-${escapeHtml(severity)}">${escapeHtml(severityLabel(severity, tabKey))}</span>`
        : '';
      const catBadge = category
        ? `<span>📂 ${escapeHtml(categoryLabel(category, tabKey))}</span>`
        : '';
      const responseFlag = hasResponse ? '<span style="color:var(--brand);font-weight:700">✓ 답변</span>' : '';

      let extraFlag = '';
      if (tabKey === 'incident' || tabKey === 'harassment' || tabKey === 'legal') {
        if (sirenRequested) extraFlag = '<span style="color:var(--brand);font-weight:600">📌 정식 접수</span>';
        else if (sirenDeclined) extraFlag = '<span style="color:var(--text-3)">📋 AI만 받음</span>';
      }

      const detailBtn = cfg.detailApi
        ? `<button type="button" class="btn-detail" data-act="detail" data-id="${id}">상세 보기</button>`
        : '';
      const deleteBtn = cfg.deleteApi && !['matching', 'matched', 'in_progress', 'reviewing'].includes(status)
        ? `<button type="button" class="btn-delete" data-act="delete" data-id="${id}" data-no="${escapeHtml(no)}">삭제</button>`
        : '';

      html += `
        <li class="app-card" data-card-id="${id}">
          <div class="app-card-head">
            <span class="app-card-no">${escapeHtml(no)}</span>
            <span class="app-card-status app-status-${escapeHtml(status)}">${escapeHtml(statusLabel(status))}</span>
          </div>
          <div class="app-card-title">${escapeHtml(title)}</div>
          ${summary ? `<div class="app-card-summary">${escapeHtml(summary)}</div>` : ''}
          <div class="app-card-meta">
            <span>📅 ${fmtDate(item.createdAt)}</span>
            ${catBadge}
            ${sevBadge}
            ${extraFlag}
            ${responseFlag}
          </div>
          <div class="app-card-actions">
            ${detailBtn}
            ${deleteBtn}
          </div>
        </li>
      `;
    });
    html += '</ul>';

    pane.innerHTML = html;

    /* 액션 바인딩 */
    pane.querySelectorAll('[data-act="detail"]').forEach((btn) => {
      btn.addEventListener('click', () => openDetail(tabKey, Number(btn.dataset.id)));
    });
    pane.querySelectorAll('[data-act="delete"]').forEach((btn) => {
      btn.addEventListener('click', () => deleteItem(tabKey, Number(btn.dataset.id), btn.dataset.no));
    });
  }

  /* ============ 상세 모달 ============ */
  async function openDetail(tabKey, id) {
    const cfg = TYPES[tabKey];
    if (!cfg.detailApi) return;

    const modal = document.getElementById('appDetailModal');
    const titleEl = document.getElementById('appDetailTitle');
    const bodyEl = document.getElementById('appDetailBody');

    titleEl.textContent = cfg.label + ' 상세';
    bodyEl.innerHTML = '<div style="text-align:center;color:var(--text-3);padding:40px">로딩 중...</div>';

    modal.classList.add('show');
    document.body.style.overflow = 'hidden';

    try {
      const res = await fetch(cfg.detailApi + '?id=' + id, { credentials: 'include' });
      const json = await res.json();

      if (!res.ok || !json.ok) {
        bodyEl.innerHTML = `<div style="text-align:center;color:#dc2626;padding:40px">${escapeHtml(json.error || '불러오기 실패')}</div>`;
        return;
      }

      const data = json.data || {};
      /* incident: data.report / harassment: data.report / legal: data.consultation */
      const item = data.report || data.consultation || data.request || data;

      bodyEl.innerHTML = renderDetailHtml(tabKey, item);
    } catch (e) {
      console.error('[openDetail]', e);
      bodyEl.innerHTML = '<div style="text-align:center;color:#dc2626;padding:40px">네트워크 오류</div>';
    }
  }

    function renderDetailHtml(tabKey, item) {
    const no = item.reportNo || item.consultationNo || item.requestNo || '';
    const title = item.title || '';
    const createdAt = fmtDateTime(item.createdAt);

    let html = `
      <div style="margin-bottom:18px;padding-bottom:14px;border-bottom:1px solid var(--line)">
        <div style="font-family:'Inter';font-size:11.5px;color:var(--text-3);margin-bottom:4px">${escapeHtml(no)}</div>
        <h4 style="margin:0;font-size:17px;font-family:'Noto Serif KR',serif">${escapeHtml(title)}</h4>
        <div style="font-size:12px;color:var(--text-3);margin-top:6px">📅 접수: ${createdAt}</div>
      </div>
    `;

    /* 본문 */
    const content = item.contentHtml || item.content || '';
    if (content) {
      html += `
        <div class="adm-section">
          <h4>📝 신청 내용</h4>
          <div class="body">${content}</div>
        </div>
      `;
    }

    /* AI 분석 (incident/harassment/legal) */
    if (tabKey === 'incident' || tabKey === 'harassment' || tabKey === 'legal') {
      if (item.aiSummary) {
        const sevField = tabKey === 'legal' ? item.aiUrgency : item.aiSeverity;
        const sevText = sevField ? severityLabel(sevField, tabKey) : '';
        const sevBadge = sevField
          ? `<span class="app-severity-${escapeHtml(sevField)}" style="margin-left:auto;padding:2px 8px;border-radius:8px;font-size:11px">${escapeHtml(sevText)}</span>`
          : '';
        html += `
          <div class="adm-section">
            <h4>🤖 AI 분석 결과 ${sevBadge}</h4>
            <div class="body" style="margin-bottom:8px"><strong>요약:</strong> ${escapeHtml(item.aiSummary)}</div>
            ${item.aiSuggestion ? `<div class="body"><strong>권장사항:</strong> ${escapeHtml(item.aiSuggestion)}</div>` : ''}
          </div>
        `;

        /* 법률 추가 정보 */
        if (tabKey === 'legal') {
          if (item.aiRelatedLaws) {
            html += `<div class="adm-section"><h4>📜 관련 법령</h4><div class="body">${escapeHtml(item.aiRelatedLaws)}</div></div>`;
          }
          if (item.aiLegalOpinion) {
            html += `<div class="adm-section"><h4>⚖️ 1차 법률 의견</h4><div class="body">${escapeHtml(item.aiLegalOpinion)}</div></div>`;
          }
          if (item.aiLawyerSpecialty) {
            html += `<div class="adm-section"><h4>👨‍⚖️ 권장 변호사 전문분야</h4><div class="body">${escapeHtml(item.aiLawyerSpecialty)}</div></div>`;
          }
        }

        /* 악성민원 추가 정보 */
        if (tabKey === 'harassment') {
          if (item.aiImmediateAction) {
            html += `<div class="adm-section"><h4>🚀 즉각적 대처</h4><div class="body">${escapeHtml(item.aiImmediateAction)}</div></div>`;
          }
        }
      }
    }

    /* 첨부파일 */
    if (Array.isArray(item.attachments) && item.attachments.length) {
      html += '<div class="adm-section"><h4>📎 첨부파일</h4><div class="body">';
      item.attachments.forEach((a) => {
        html += `<div style="margin-bottom:6px"><a href="${escapeHtml(a.url)}&download=1" target="_blank" rel="noopener" style="color:var(--brand);text-decoration:none">⬇ ${escapeHtml(a.originalName)}</a></div>`;
      });
      html += '</div></div>';
    }

    /* 관리자 답변 */
    if (item.adminResponse) {
      const respondedTime = item.respondedAt
        ? `<span style="margin-left:auto;font-weight:400;color:var(--text-3);font-size:11px">${fmtDateTime(item.respondedAt)}</span>`
        : '';
      html += `
        <div class="adm-section admin-response">
          <h4>💬 관리자 답변 ${respondedTime}</h4>
          <div class="body" style="white-space:pre-wrap">${escapeHtml(item.adminResponse)}</div>
        </div>
      `;
    } else {
      html += `<div style="text-align:center;padding:18px;color:var(--text-3);font-size:12.5px;background:var(--bg-soft);border-radius:6px;margin-top:14px">아직 관리자 답변이 등록되지 않았습니다</div>`;
    }

    return html;
  }

  function closeDetail() {
    const modal = document.getElementById('appDetailModal');
    if (modal) modal.classList.remove('show');
    /* 다른 모달이 열려있지 않으면 스크롤 해제 */
    const anyOpen = document.querySelector('.modal-bg.show');
    if (!anyOpen) document.body.style.overflow = '';
  }

  /* ============ 삭제 ============ */
  async function deleteItem(tabKey, id, no) {
    const cfg = TYPES[tabKey];
    if (!cfg.deleteApi) return;

    if (!confirm(`"${no}"을(를) 삭제하시겠습니까?\n삭제된 내역은 복구할 수 없습니다.`)) return;

    try {
      const res = await fetch(cfg.deleteApi, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const json = await res.json();

      if (!res.ok || !json.ok) {
        window.SIREN.toast(json.error || '삭제 실패');
        return;
      }

      window.SIREN.toast('삭제되었습니다');
      delete _cache[tabKey];
      await loadTab(tabKey);
    } catch (e) {
      console.error('[deleteItem]', e);
      window.SIREN.toast('네트워크 오류');
    }
  }

  /* ============ 탭 전환 ============ */
  function switchTab(tabKey) {
    if (!TYPES[tabKey]) return;
    _currentTab = tabKey;

    document.querySelectorAll('.app-subtab').forEach((tab) => {
      tab.classList.toggle('active', tab.dataset.appTab === tabKey);
    });
    document.querySelectorAll('[data-app-pane]').forEach((p) => {
      p.style.display = p.dataset.appPane === tabKey ? '' : 'none';
    });

    loadTab(tabKey);
  }

  /* ============ 초기화 ============ */
  function init() {
    if (_initialized) return;
    if (document.body.dataset.page !== 'mypage') return;

    /* 탭 클릭 */
    document.querySelectorAll('.app-subtab').forEach((tab) => {
      tab.addEventListener('click', () => switchTab(tab.dataset.appTab));
    });

    /* 모달 닫기 */
    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-app-close]')) closeDetail();
      if (e.target.id === 'appDetailModal') closeDetail();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const modal = document.getElementById('appDetailModal');
        if (modal && modal.classList.contains('show')) closeDetail();
      }
    });

    /* "📋 신청 내역" 메뉴 클릭 시 자동 로드 */
    const menu = document.getElementById('mpMenu');
    if (menu) {
      menu.addEventListener('click', (e) => {
        const li = e.target.closest('li[data-mp="support"]');
        if (li) {
          /* 약간의 지연 후 (패널 표시 후) 로드 */
          setTimeout(() => loadTab(_currentTab), 100);
        }
      });
    }

    /* 페이지 진입 시 #support 해시면 즉시 로드 */
    if (location.hash === '#support') {
      setTimeout(() => loadTab(_currentTab), 300);
    }

    _initialized = true;
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