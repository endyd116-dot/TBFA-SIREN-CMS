/* =========================================================
   SIREN — mypage-applications.js (★ Phase M-9 + v11 묶음 B-3 + B-11)
   - 마이페이지 "📋 신청 내역" 통합 탭
   - 4개 서브탭: family / incident / harassment / legal
   - v11: family 탭에 상세/삭제/보완제출 기능 추가
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
    if (type === 'legal' || type === 'family') {
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
      detailApi: '/api/support/mine',
      deleteApi: '/api/support-delete',
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

  /* ============ 캐시 / 상태 ============ */
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

  /* ============ 목록 렌더 ============ */
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
      const rawSummary = (item[cfg.summaryField] || '').toString();
      const summary = rawSummary.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').slice(0, 200);
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

      /* ★ v11 묶음 B-11: family + supplement 상태일 때 보완 제출 버튼 노출 */
      const supplementBtn = (tabKey === 'family' && status === 'supplement')
        ? `<button type="button" class="btn-detail" data-act="supplement-open" data-id="${id}" data-no="${escapeHtml(no)}" style="background:#c47a00;border-color:#c47a00">📤 보완 제출</button>`
        : '';

      /* ★ round8: family submitted 상태일 때 수정 버튼 (B 머지 전 mock 사용) */
      const editBtn = (tabKey === 'family' && status === 'submitted')
        ? `<button type="button" class="btn-detail" data-act="edit" data-id="${id}" data-no="${escapeHtml(no)}" style="background:#1a56db;border-color:#1a56db;color:#fff">✏️ 수정</button>`
        : '';

      /* 전문가 채팅방 버튼 — family(유가족지원) / legal(법률지원) 에서 배정 시 표시 */
      const chatRoomId = item.chatRoomId;
      const expertChatBtn = (tabKey === 'family' || tabKey === 'legal') && chatRoomId
        ? `<button type="button" class="btn-detail" data-act="open-expert-chat" data-room-id="${chatRoomId}"
             style="background:var(--brand);border-color:var(--brand);color:#fff">💬 전문가 채팅</button>`
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
            ${editBtn}
            ${supplementBtn}
            ${expertChatBtn}
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
    /* ★ v11 묶음 B-11: 보완 제출 버튼 (목록에서) */
    pane.querySelectorAll('[data-act="supplement-open"]').forEach((btn) => {
      btn.addEventListener('click', () => openSupplementModal(Number(btn.dataset.id), btn.dataset.no));
    });
    /* ★ round8: 유가족 지원 수정 버튼 */
    pane.querySelectorAll('[data-act="edit"]').forEach((btn) => {
      btn.addEventListener('click', () => openSupportEditModal(tabKey, Number(btn.dataset.id)));
    });
    /* 전문가 채팅방 열기 */
    pane.querySelectorAll('[data-act="open-expert-chat"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const roomId = Number(btn.dataset.roomId);
        if (roomId && window.SIREN_CHAT && typeof window.SIREN_CHAT.openChatWindow === 'function') {
          window.SIREN_CHAT.openChatWindow(roomId);
        } else {
          window.SIREN && window.SIREN.toast('채팅 모듈이 준비되지 않았습니다. 잠시 후 다시 시도해 주세요.');
        }
      });
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
      const item = data.report || data.consultation || data.request || data;

      bodyEl.innerHTML = renderDetailHtml(tabKey, item);

      /* 상세 모달 안에 보완 제출 버튼이 있으면 핸들러 바인딩 */
      bodyEl.querySelectorAll('[data-act="supplement-open"]').forEach((btn) => {
        btn.addEventListener('click', () => openSupplementModal(Number(btn.dataset.id), btn.dataset.no));
      });
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
      const isPlainText = !item.contentHtml;
      html += `
        <div class="adm-section">
          <h4>📝 신청 내용</h4>
          <div class="body" ${isPlainText ? 'style="white-space:pre-wrap"' : ''}>${isPlainText ? escapeHtml(content) : content}</div>
        </div>
      `;
    }

    /* family 신청 정보 */
    if (tabKey === 'family') {
      const blocks = [];
      if (item.category) {
        blocks.push(`<div><strong>분류:</strong> ${escapeHtml(categoryLabel(item.category, 'family'))}</div>`);
      }
      if (item.priority) {
        const sevText = severityLabel(item.priority, 'family');
        blocks.push(`<div><strong>우선순위:</strong> ${escapeHtml(sevText)}${item.priorityReason ? ' <span style="color:var(--text-3);font-size:12px">(' + escapeHtml(item.priorityReason) + ')</span>' : ''}</div>`);
      }
      if (item.assignedExpertName) {
        blocks.push(`<div><strong>담당 전문가:</strong> ${escapeHtml(item.assignedExpertName)}</div>`);
      }
      if (blocks.length > 0) {
        html += `
          <div class="adm-section">
            <h4>📋 신청 정보</h4>
            <div class="body" style="line-height:1.9">${blocks.join('')}</div>
          </div>
        `;
      }
      /* 보완 요청 박스 */
      if (item.supplementNote) {
        html += `
          <div class="adm-section" style="background:#fff8ec;border:1px solid #f0e3c4">
            <h4 style="color:#8a6a00">⚠️ 운영자 보완 요청 사항</h4>
            <div class="body" style="white-space:pre-wrap">${escapeHtml(item.supplementNote)}</div>
          </div>
        `;
      }
      /* ★ v11 묶음 B-11: supplement 상태면 보완 제출 액션 박스 */
      if (item.status === 'supplement') {
        html += `
          <div style="text-align:center;padding:18px;background:linear-gradient(135deg,#fef3c7,#fff);border:2px solid #fbbf24;border-radius:8px;margin-top:14px">
            <div style="font-size:14px;color:#8a6a00;font-weight:600;margin-bottom:10px">💡 위 보완 요청 사항을 반영한 자료를 제출해 주세요</div>
            <button type="button" data-act="supplement-open" data-id="${item.id}" data-no="${escapeHtml(no)}" style="background:var(--brand);color:#fff;border:none;padding:11px 28px;border-radius:6px;font-size:13.5px;font-weight:700;cursor:pointer;font-family:inherit">
              📤 보완 자료 제출하기
            </button>
            <div style="font-size:11.5px;color:var(--text-3);margin-top:8px">제출 후 운영자가 다시 검토합니다 (상태: 보완 요청 → 접수)</div>
          </div>
        `;
      }
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
        if (a && typeof a === 'object' && a.url) {
          html += `<div style="margin-bottom:6px"><a href="${escapeHtml(a.url)}&download=1" target="_blank" rel="noopener" style="color:var(--brand);text-decoration:none">⬇ ${escapeHtml(a.originalName || '첨부파일')}</a></div>`;
        } else if (typeof a === 'string') {
          const fileName = a.split('/').pop() || a;
          /* ★ US-023: 본인 신청 첨부는 support-download(소유자 허용·key 검증)로 직접 다운로드 가능.
             서버 권한·attachments 포함 검증을 이미 하므로 보안 추가비용 없이 끝단만 연결. */
          if (item.id) {
            const dlUrl = '/api/support/download?key=' + encodeURIComponent(a) + '&id=' + encodeURIComponent(item.id);
            html += `<div style="margin-bottom:6px"><a href="${escapeHtml(dlUrl)}" target="_blank" rel="noopener" style="color:var(--brand);text-decoration:none">⬇ ${escapeHtml(fileName)}</a></div>`;
          } else {
            html += `<div style="margin-bottom:6px;color:var(--text-2);font-size:12.5px">📎 ${escapeHtml(fileName)}</div>`;
          }
        }
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
    } else if (item.status !== 'supplement') {
      html += `<div style="text-align:center;padding:18px;color:var(--text-3);font-size:12.5px;background:var(--bg-soft);border-radius:6px;margin-top:14px">아직 관리자 답변이 등록되지 않았습니다</div>`;
    }

    return html;
  }

  function closeDetail() {
    const modal = document.getElementById('appDetailModal');
    if (modal) modal.classList.remove('show');
    const anyOpen = document.querySelector('.modal-bg.show, #supplementModal.show');
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

  /* =========================================================
     ★ v11 묶음 B-11: 보완 제출 모달
     ========================================================= */
  let _supplementUploadingCount = 0;
  let _supplementAttachmentIds = [];  // 업로드 완료된 R2 blob ID들

  /* editor.js의 SirenEditor.uploadFile 모듈을 동적 로드 */
  async function ensureUploadModule() {
    if (window.SirenEditor && typeof window.SirenEditor.uploadFile === 'function') {
      return true;
    }
    try {
      await new Promise((resolve, reject) => {
        const existing = document.querySelector('script[src*="/js/editor.js"]');
        if (existing) {
          if (existing.dataset.loaded === '1') return resolve();
          existing.addEventListener('load', () => resolve());
          existing.addEventListener('error', () => reject(new Error('editor.js 로드 실패')));
          return;
        }
        const s = document.createElement('script');
        s.src = '/js/editor.js?v=2026-05';
        s.async = false;
        s.onload = () => { s.dataset.loaded = '1'; resolve(); };
        s.onerror = () => reject(new Error('editor.js 로드 실패'));
        document.head.appendChild(s);
      });
      /* SirenEditor.loadLib는 호출하지 않음 — uploadFile은 라이브러리 없이도 동작 */
      return !!(window.SirenEditor && typeof window.SirenEditor.uploadFile === 'function');
    } catch (e) {
      console.error('[supplement] editor.js 로드 실패', e);
      return false;
    }
  }

  /* 보완 제출 모달 동적 생성 + 표시 */
  function openSupplementModal(id, requestNo) {
    /* 다른 모달 위에 표시되어야 하므로 최상위에 동적 추가 */
    closeSupplementModal();

    _supplementUploadingCount = 0;
    _supplementAttachmentIds = [];

    const modal = document.createElement('div');
    modal.id = 'supplementModal';
    modal.style.cssText = 'display:flex !important;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:10001;align-items:flex-start;justify-content:center;padding:30px 16px;overflow-y:auto';
    modal.innerHTML = `
      <div style="background:#fff;border-radius:12px;max-width:560px;width:100%;margin:auto;box-shadow:0 24px 60px rgba(0,0,0,0.3);overflow:hidden">
        <div style="padding:16px 24px;background:linear-gradient(135deg,#3a0d14,#7a1f2b);color:#fff;display:flex;justify-content:space-between;align-items:center">
          <div>
            <div style="font-family:'Noto Serif KR',serif;font-size:16px;font-weight:700">📤 보완 자료 제출</div>
            <div style="font-size:11.5px;opacity:0.85;margin-top:2px">신청번호: ${escapeHtml(requestNo || '')}</div>
          </div>
          <button type="button" data-supp-close style="background:transparent;border:none;color:#fff;font-size:24px;cursor:pointer;line-height:1">&times;</button>
        </div>
        <div style="padding:22px 24px">
          <input type="hidden" id="suppId" value="${id}">

          <div style="background:#fef3c7;border:1px solid #fbbf24;border-radius:6px;padding:11px 14px;margin-bottom:16px;font-size:12px;color:#8a6a00;line-height:1.7">
            💡 운영자가 요청한 보완 사항을 반영해서 제출해 주세요. 제출 후에는 상태가 <strong>"보완 요청"</strong>에서 <strong>"접수"</strong>로 변경되어 운영자가 다시 검토합니다.
          </div>

          <div style="margin-bottom:14px">
            <label style="display:block;font-size:12.5px;font-weight:700;margin-bottom:6px;color:var(--text-2)">
              보완 내용 <span style="color:#dc2626">*</span> <span style="font-weight:400;color:var(--text-3);font-size:11px">(5자 이상 5000자 이내)</span>
            </label>
            <textarea id="suppContent" maxlength="5000" rows="8" placeholder="보완 요청 사항에 대한 답변, 추가 설명, 보충 자료 안내 등을 작성해 주세요..." style="width:100%;padding:11px 14px;border:1px solid var(--line);border-radius:6px;font-size:13px;font-family:inherit;line-height:1.7;resize:vertical;box-sizing:border-box;min-height:140px"></textarea>
            <div style="font-size:11px;color:var(--text-3);margin-top:4px;text-align:right" id="suppContentCount">0 / 5000</div>
          </div>

          <div style="margin-bottom:16px">
            <label style="display:block;font-size:12.5px;font-weight:700;margin-bottom:6px;color:var(--text-2)">
              📎 추가 첨부 파일 <span style="font-weight:400;color:var(--text-3);font-size:11px">(선택, 최대 5개 / 파일당 10MB)</span>
            </label>
            <input type="file" id="suppFiles" multiple accept="image/*,.pdf,.hwp,.doc,.docx,.xls,.xlsx" style="display:block;font-size:12.5px;font-family:inherit">
            <div id="suppFilesList" style="margin-top:10px;font-size:12px;color:var(--text-2)"></div>
          </div>

          <div style="display:flex;gap:10px">
            <button type="button" data-supp-close style="flex:1;padding:11px 0;background:transparent;border:1px solid var(--line);color:var(--text-2);border-radius:6px;font-size:13.5px;font-weight:600;cursor:pointer;font-family:inherit">취소</button>
            <button type="button" id="suppSubmitBtn" style="flex:2;padding:11px 0;background:var(--brand);color:#fff;border:none;border-radius:6px;font-size:13.5px;font-weight:700;cursor:pointer;font-family:inherit">📤 제출하기</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';

    /* 글자수 카운터 */
    const contentEl = modal.querySelector('#suppContent');
    const countEl = modal.querySelector('#suppContentCount');
    contentEl.addEventListener('input', () => {
      countEl.textContent = `${contentEl.value.length} / 5000`;
    });
    setTimeout(() => contentEl.focus(), 100);

    /* 닫기 */
    modal.querySelectorAll('[data-supp-close]').forEach((btn) => {
      btn.addEventListener('click', closeSupplementModal);
    });
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeSupplementModal();
    });

    /* 첨부 업로드 */
    const fileInput = modal.querySelector('#suppFiles');
    const filesListEl = modal.querySelector('#suppFilesList');
    fileInput.addEventListener('change', async () => {
      const files = Array.from(fileInput.files || []);
      if (files.length === 0) return;

      const totalSlots = 5 - _supplementAttachmentIds.length;
      if (files.length > totalSlots) {
        window.SIREN.toast(`최대 ${totalSlots}개까지만 추가할 수 있습니다`);
        fileInput.value = '';
        return;
      }
      for (const f of files) {
        if (f.size > 10 * 1024 * 1024) {
          window.SIREN.toast(`"${f.name}"은(는) 10MB를 초과합니다`);
          fileInput.value = '';
          return;
        }
      }

      const ok = await ensureUploadModule();
      if (!ok) {
        window.SIREN.toast('업로드 모듈을 불러올 수 없습니다. 페이지를 새로고침해 주세요.');
        fileInput.value = '';
        return;
      }

      for (const file of files) {
        const tmpId = 'tmp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
        appendFileRow(filesListEl, tmpId, file.name, '⏳ 업로드 중...');
        _supplementUploadingCount++;
        try {
          const result = await window.SirenEditor.uploadFile(file, 'support-supplement');
          if (result && result.id) {
            _supplementAttachmentIds.push(String(result.id));
            updateFileRow(filesListEl, tmpId, file.name, '✅ 업로드 완료', String(result.id));
          } else {
            updateFileRow(filesListEl, tmpId, file.name, '❌ 업로드 실패', null);
          }
        } catch (err) {
          console.error('[supplement] upload error', err);
          updateFileRow(filesListEl, tmpId, file.name, '❌ 업로드 실패', null);
        } finally {
          _supplementUploadingCount--;
        }
      }

      fileInput.value = '';
    });

    /* 제출 */
    modal.querySelector('#suppSubmitBtn').addEventListener('click', () => submitSupplement(id, requestNo));

    /* ESC */
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        closeSupplementModal();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);
  }

  function appendFileRow(listEl, tmpId, fileName, statusText) {
    const row = document.createElement('div');
    row.dataset.suppFile = tmpId;
    row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:6px 10px;background:var(--bg-soft);border-radius:5px;margin-bottom:4px;font-size:12px';
    row.innerHTML = `
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">📎 ${escapeHtml(fileName)}</span>
      <span class="status" style="margin-left:10px;color:var(--text-3);flex-shrink:0">${escapeHtml(statusText)}</span>
      <button type="button" data-supp-remove="${tmpId}" style="margin-left:8px;background:transparent;border:none;color:#dc2626;cursor:pointer;font-size:16px;line-height:1;flex-shrink:0">×</button>
    `;
    listEl.appendChild(row);

    row.querySelector('[data-supp-remove]').addEventListener('click', () => {
      const blobId = row.dataset.suppBlobId;
      if (blobId) {
        _supplementAttachmentIds = _supplementAttachmentIds.filter(v => v !== blobId);
      }
      row.remove();
    });
  }

  function updateFileRow(listEl, tmpId, fileName, statusText, blobId) {
    const row = listEl.querySelector(`[data-supp-file="${tmpId}"]`);
    if (!row) return;
    const statusEl = row.querySelector('.status');
    if (statusEl) {
      statusEl.textContent = statusText;
      if (blobId) statusEl.style.color = '#1a8b46';
      else statusEl.style.color = '#dc2626';
    }
    if (blobId) row.dataset.suppBlobId = blobId;
  }

  function closeSupplementModal() {
    const m = document.getElementById('supplementModal');
    if (m) m.remove();
    _supplementUploadingCount = 0;
    _supplementAttachmentIds = [];
    const anyOpen = document.querySelector('.modal-bg.show, #appDetailModal.show');
    if (!anyOpen) document.body.style.overflow = '';
  }

  async function submitSupplement(id, requestNo) {
    const contentEl = document.getElementById('suppContent');
    const submitBtn = document.getElementById('suppSubmitBtn');
    if (!contentEl || !submitBtn) return;

    const supplementContent = (contentEl.value || '').trim();
    if (supplementContent.length < 5) {
      window.SIREN.toast('보완 내용을 5자 이상 작성해 주세요');
      contentEl.focus();
      return;
    }
    if (supplementContent.length > 5000) {
      window.SIREN.toast('보완 내용은 5000자 이내로 작성해 주세요');
      return;
    }
    if (_supplementUploadingCount > 0) {
      window.SIREN.toast('첨부 파일이 아직 업로드 중입니다');
      return;
    }

    if (!confirm('보완 자료를 제출하시겠습니까?\n\n• 상태가 "보완 요청" → "접수"로 변경됩니다\n• 운영자가 다시 검토합니다\n• 제출 후 추가 보완은 새로 요청 받았을 때만 가능합니다')) return;

    const oldText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = '제출 중...';

    try {
      const res = await fetch('/api/support-supplement', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          supplementContent,
          attachmentIds: _supplementAttachmentIds,
        }),
      });
      const json = await res.json();

      if (!res.ok || !json.ok) {
        window.SIREN.toast(json.error || '제출 실패');
        submitBtn.disabled = false;
        submitBtn.textContent = oldText;
        return;
      }

      window.SIREN.toast('보완 자료가 제출되었습니다. 운영자가 다시 검토합니다.');
      closeSupplementModal();

      /* 상세 모달도 닫고 family 탭 캐시 무효화 + 새로고침 */
      const detailModal = document.getElementById('appDetailModal');
      if (detailModal) detailModal.classList.remove('show');

      delete _cache.family;
      await loadTab('family');
    } catch (e) {
      console.error('[submitSupplement]', e);
      window.SIREN.toast('네트워크 오류');
      submitBtn.disabled = false;
      submitBtn.textContent = oldText;
    }
  }

  /* =========================================================
     ★ round8: 유가족 지원 신청 수정 모달
     ========================================================= */
  async function openSupportEditModal(tabKey, id) {
    const cfg = TYPES[tabKey];
    if (!cfg || !cfg.detailApi) return;

    /* 상세 데이터 fetch */
    let item = null;
    try {
      const res = await fetch(cfg.detailApi + '?id=' + id, { credentials: 'include' });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        window.SIREN && window.SIREN.toast(json.error || '데이터를 불러올 수 없습니다');
        return;
      }
      const data = json.data || {};
      item = data.request || data.report || data.consultation || data;
    } catch (e) {
      console.error('[openSupportEditModal] fetch', e);
      window.SIREN && window.SIREN.toast('네트워크 오류');
      return;
    }

    /* 기존 수정 모달 제거 */
    const existing = document.getElementById('supportEditModal');
    if (existing) existing.remove();

    const title = (item && item.title) || '';
    const content = (item && (item.content || item.contentHtml || '')) || '';
    const category = (item && item.category) || '';

    const categoryOptions = [
      { value: 'counseling', label: '심리상담' },
      { value: 'legal', label: '법률자문' },
      { value: 'scholarship', label: '장학' },
      { value: 'other', label: '기타' },
    ].map((o) => `<option value="${o.value}" ${category === o.value ? 'selected' : ''}>${o.label}</option>`).join('');

    const modal = document.createElement('div');
    modal.id = 'supportEditModal';
    modal.style.cssText = 'display:flex !important;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:10002;align-items:flex-start;justify-content:center;padding:30px 16px;overflow-y:auto';
    modal.innerHTML = `
      <div style="background:#fff;border-radius:12px;max-width:580px;width:100%;margin:auto;box-shadow:0 24px 60px rgba(0,0,0,0.3);overflow:hidden">
        <div style="padding:16px 24px;background:linear-gradient(135deg,#1e3a5f,#1a56db);color:#fff;display:flex;justify-content:space-between;align-items:center">
          <div>
            <div style="font-family:'Noto Serif KR',serif;font-size:16px;font-weight:700">✏️ 유가족 지원 신청 수정</div>
            <div style="font-size:11.5px;opacity:0.85;margin-top:2px">접수 상태에서만 수정 가능합니다</div>
          </div>
          <button type="button" data-edit-close style="background:transparent;border:none;color:#fff;font-size:24px;cursor:pointer;line-height:1">&times;</button>
        </div>
        <div style="padding:22px 24px">
          <input type="hidden" id="seId" value="${id}">

          <div style="margin-bottom:14px">
            <label style="display:block;font-size:12.5px;font-weight:700;margin-bottom:6px;color:var(--text-2)">
              제목 <span style="color:#dc2626">*</span>
            </label>
            <input type="text" id="seTitle" maxlength="200" value="${escapeHtml(title)}"
              style="width:100%;padding:10px 14px;border:1px solid var(--line);border-radius:6px;font-size:13px;font-family:inherit;box-sizing:border-box"
              placeholder="신청 제목을 입력해 주세요">
          </div>

          <div style="margin-bottom:14px">
            <label style="display:block;font-size:12.5px;font-weight:700;margin-bottom:6px;color:var(--text-2)">
              분류
            </label>
            <select id="seCategory"
              style="width:100%;padding:10px 14px;border:1px solid var(--line);border-radius:6px;font-size:13px;font-family:inherit;box-sizing:border-box">
              ${categoryOptions}
            </select>
          </div>

          <div style="margin-bottom:16px">
            <label style="display:block;font-size:12.5px;font-weight:700;margin-bottom:6px;color:var(--text-2)">
              내용 <span style="color:#dc2626">*</span>
              <span style="font-weight:400;color:var(--text-3);font-size:11px">(10자 이상 5000자 이내)</span>
            </label>
            <textarea id="seContent" maxlength="5000" rows="9"
              style="width:100%;padding:11px 14px;border:1px solid var(--line);border-radius:6px;font-size:13px;font-family:inherit;line-height:1.7;resize:vertical;box-sizing:border-box;min-height:180px"
              placeholder="신청 내용을 상세히 작성해 주세요">${escapeHtml(content.replace(/<[^>]+>/g, ''))}</textarea>
            <div style="font-size:11px;color:var(--text-3);margin-top:4px;text-align:right" id="seContentCount">0 / 5000</div>
          </div>

          <div style="display:flex;gap:10px">
            <button type="button" data-edit-close style="flex:1;padding:11px 0;background:transparent;border:1px solid var(--line);color:var(--text-2);border-radius:6px;font-size:13.5px;font-weight:600;cursor:pointer;font-family:inherit">취소</button>
            <button type="button" id="seSubmitBtn" style="flex:2;padding:11px 0;background:#1a56db;color:#fff;border:none;border-radius:6px;font-size:13.5px;font-weight:700;cursor:pointer;font-family:inherit">저장하기</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';

    /* 글자수 카운터 초기화 */
    const contentEl = modal.querySelector('#seContent');
    const countEl = modal.querySelector('#seContentCount');
    countEl.textContent = `${contentEl.value.length} / 5000`;
    contentEl.addEventListener('input', () => {
      countEl.textContent = `${contentEl.value.length} / 5000`;
    });

    /* 닫기 */
    modal.querySelectorAll('[data-edit-close]').forEach((btn) => {
      btn.addEventListener('click', () => closeSupportEditModal());
    });
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeSupportEditModal();
    });
    const escHandler = (e) => {
      if (e.key === 'Escape') { closeSupportEditModal(); document.removeEventListener('keydown', escHandler); }
    };
    document.addEventListener('keydown', escHandler);

    /* 저장 */
    modal.querySelector('#seSubmitBtn').addEventListener('click', () => submitSupportEdit(tabKey));
  }

  function closeSupportEditModal() {
    const m = document.getElementById('supportEditModal');
    if (m) m.remove();
    const anyOpen = document.querySelector('.modal-bg.show, #appDetailModal.show, #supplementModal');
    if (!anyOpen) document.body.style.overflow = '';
  }

  async function submitSupportEdit(tabKey) {
    const idEl = document.getElementById('seId');
    const titleEl = document.getElementById('seTitle');
    const contentEl = document.getElementById('seContent');
    const categoryEl = document.getElementById('seCategory');
    const submitBtn = document.getElementById('seSubmitBtn');
    if (!idEl || !titleEl || !contentEl || !submitBtn) return;

    const id = Number(idEl.value);
    const title = (titleEl.value || '').trim();
    const content = (contentEl.value || '').trim();
    const category = categoryEl ? categoryEl.value : '';

    if (!title) { window.SIREN && window.SIREN.toast('제목을 입력해 주세요'); titleEl.focus(); return; }
    if (content.length < 10) { window.SIREN && window.SIREN.toast('내용을 10자 이상 입력해 주세요'); contentEl.focus(); return; }
    if (content.length > 5000) { window.SIREN && window.SIREN.toast('내용은 5000자 이내로 작성해 주세요'); return; }

    const oldText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = '저장 중...';

    try {
      const res = await api('/api/support-update', { method: 'PATCH', body: { id, title, content, category } });
      const json = res.data;
      if (!json || !json.ok) {
        window.SIREN && window.SIREN.toast(json.error || '수정 실패');
        submitBtn.disabled = false;
        submitBtn.textContent = oldText;
        return;
      }

      window.SIREN && window.SIREN.toast('수정되었습니다.');
      closeSupportEditModal();
      delete _cache[tabKey];
      await loadTab(tabKey);
    } catch (e) {
      console.error('[submitSupportEdit]', e);
      window.SIREN && window.SIREN.toast('네트워크 오류');
      submitBtn.disabled = false;
      submitBtn.textContent = oldText;
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

  /* ============ 4개 탭 카운트 prefetch ============ */
  async function prefetchAllCounts() {
    const tabs = ['family', 'incident', 'harassment', 'legal'];
    await Promise.all(tabs.map(async (tabKey) => {
      const cfg = TYPES[tabKey];
      try {
        const res = await fetch(cfg.listApi, { credentials: 'include' });
        if (!res.ok) return;
        const json = await res.json();
        if (!json.ok) return;
        const list = (json.data && json.data[cfg.itemKey]) || [];
        _cache[tabKey] = list;
        updateCount(tabKey, list.length);
      } catch (e) {
        console.warn('[mypage-applications] prefetch failed:', tabKey, e);
      }
    }));
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

    /* 메뉴 클릭 시 첫 탭 자동 렌더 */
    const menu = document.getElementById('mpMenu');
    if (menu) {
      menu.addEventListener('click', (e) => {
        const li = e.target.closest('li[data-mp="support"]');
        if (li) {
          setTimeout(() => loadTab(_currentTab), 100);
        }
      });
    }

    /* prefetch */
    setTimeout(() => {
      prefetchAllCounts().then(() => {
        if (location.hash === '#support' || _currentTab) {
          loadTab(_currentTab);
        }
      });
    }, 500);

    if (location.hash === '#support') {
      setTimeout(() => loadTab(_currentTab), 800);
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