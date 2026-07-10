/* =========================================================
   SIREN — incident.js (★ Phase M-5)
   - /incidents.html: 사건 앨범 목록
   - /incident.html?slug=xxx: 사건 상세 + 제보 모달
   ========================================================= */
(function () {
  'use strict';

  /* ============ 헬퍼 ============ */
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.getFullYear() + '.' +
      String(d.getMonth() + 1).padStart(2, '0') + '.' +
      String(d.getDate()).padStart(2, '0');
  }
  function categoryLabel(cat) {
    return cat === 'school' ? '학교' :
           cat === 'public' ? '공공' :
           cat === 'other' ? '기타' : cat;
  }
  function severityInfo(s) {
    const map = {
      critical: { icon: '', label: 'CRITICAL — 즉시 대응 필요', cls: 'critical' },
      high:     { icon: '', label: 'HIGH — 긴급 검토',         cls: 'high' },
      medium:   { icon: '', label: 'MEDIUM — 정상 절차',       cls: 'medium' },
      low:      { icon: '', label: 'LOW — 일반 의견',          cls: 'low' },
    };
    return map[s] || map.medium;
  }

  /* ============ 1. 사건 앨범 목록 ============ */
  async function loadIncidentList() {
    const container = document.getElementById('incidentList');
    if (!container) return;

    try {
      const res = await fetch('/api/incidents', { credentials: 'include' });
      const json = await res.json();

      if (!res.ok || !json.ok) {
        container.innerHTML = `
          <div class="incident-empty">
            <div class="icon"></div>
            <div class="title">사건 목록을 불러오지 못했습니다</div>
            <div class="desc">${escapeHtml(json.error || '잠시 후 다시 시도해 주세요')}</div>
          </div>`;
        return;
      }

      const list = (json.data && json.data.list) || [];
      if (!list.length) {
        container.innerHTML = `
          <div class="incident-empty">
            <div class="icon"></div>
            <div class="title">등록된 사건이 없습니다</div>
            <div class="desc">관리자가 사건을 등록하면 이 곳에 표시됩니다.</div>
          </div>`;
        return;
      }

      container.innerHTML = '<div class="incident-album">' + list.map((n) => `
        <a class="incident-card" href="/incident.html?slug=${encodeURIComponent(n.slug)}">
          <div class="incident-card-thumb">
            ${n.thumbnailUrl
              ? `<img src="${escapeHtml(n.thumbnailUrl)}" alt="${escapeHtml(n.title)}">`
              : `<span class="placeholder"></span>`}
            <span class="category-tag">${escapeHtml(categoryLabel(n.category))}</span>
          </div>
          <div class="incident-card-body">
            <h3 class="incident-card-title">${escapeHtml(n.title)}</h3>
            <p class="incident-card-summary">${escapeHtml(n.summary || '')}</p>
            <div class="incident-card-meta">
              <span class="date">${formatDate(n.occurredAt)}</span>
              <span class="more">제보하기 →</span>
            </div>
          </div>
        </a>
      `).join('') + '</div>';
    } catch (e) {
      console.error('[incident] list', e);
      container.innerHTML = `
        <div class="incident-empty">
          <div class="icon"></div>
          <div class="title">네트워크 오류</div>
          <div class="desc">잠시 후 다시 시도해 주세요</div>
        </div>`;
    }
  }

  /* ============ 2. 사건 상세 페이지 ============ */
  let _currentIncident = null;
  let _editor = null;
  let _attachments = null;

  async function loadIncidentDetail() {
    const params = new URLSearchParams(location.search);
    const slug = params.get('slug');
    if (!slug) {
      window.location.href = '/incidents.html';
      return;
    }

    try {
      const res = await fetch('/api/incidents?slug=' + encodeURIComponent(slug), {
        credentials: 'include',
      });
      const json = await res.json();

      if (!res.ok || !json.ok || !json.data?.incident) {
        document.getElementById('incidentTitle').textContent = '사건을 찾을 수 없습니다';
        document.getElementById('incidentContent').innerHTML = `
          <div style="text-align:center;padding:40px">
            <a href="/incidents.html" class="btn btn-primary">사건 목록으로 돌아가기</a>
          </div>`;
        return;
      }

      const inc = json.data.incident;
      _currentIncident = inc;

      /* 페이지 타이틀 */
      document.title = inc.title + ' | 교사유가족협의회';

      /* 히어로 영역 */
      const hero = document.getElementById('incidentHero');
      hero.querySelector('.eyebrow').textContent = categoryLabel(inc.category) + ' · 사건 정보';
      document.getElementById('incidentTitle').textContent = inc.title;

      /* 메타 라인 추가 */
      const heroContainer = hero.querySelector('.container');
      const existingMeta = heroContainer.querySelector('.meta-line');
      if (existingMeta) existingMeta.remove();
      const metaDiv = document.createElement('div');
      metaDiv.className = 'meta-line';
      metaDiv.innerHTML = `
        ${inc.occurredAt ? `<span>${formatDate(inc.occurredAt)}</span>` : ''}
        ${inc.location ? `<span>${escapeHtml(inc.location)}</span>` : ''}
      `;
      heroContainer.appendChild(metaDiv);

      /* 본문 */
      const content = document.getElementById('incidentContent');
      if (inc.summary) {
        content.innerHTML = `<p style="font-size:16px;color:var(--brand);font-weight:500;border-bottom:1px solid var(--line);padding-bottom:18px;margin-bottom:24px">${escapeHtml(inc.summary)}</p>` + (inc.contentHtml || '');
      } else {
        content.innerHTML = inc.contentHtml || '<p style="color:var(--text-3)">상세 내용이 없습니다.</p>';
      }

      /* 제보 CTA 표시 */
      document.getElementById('incidentCtaBox').style.display = '';

      /* 제보 모달 타이틀 */
      const irTitle = document.getElementById('irModalTitle');
      if (irTitle) irTitle.textContent = `${inc.title} — 제보하기`;
    } catch (e) {
      console.error('[incident] detail', e);
      document.getElementById('incidentTitle').textContent = '네트워크 오류';
    }
  }

  /* ============ 3. 제보 모달 ============ */
  function setupReportModal() {
    const btn = document.getElementById('btnOpenReportModal');
    if (btn) btn.addEventListener('click', openReportModal);

    /* 닫기 버튼 (위임) */
    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-ir-close]')) closeReportModal();
      if (e.target.id === 'incidentReportModal') closeReportModal();
    });

    /* 폼 제출 */
    const form = document.getElementById('incidentReportForm');
    if (form) form.addEventListener('submit', handleReportSubmit);

    /* AI 결과 후 결정 버튼 */
    const btnSiren = document.getElementById('irBtnSiren');
    const btnAiOnly = document.getElementById('irBtnAiOnly');
    if (btnSiren) btnSiren.addEventListener('click', () => confirmReport(true));
    if (btnAiOnly) btnAiOnly.addEventListener('click', () => confirmReport(false));
  }

  async function openReportModal() {
    /* 로그인 필수 */
    const auth = window.SIREN_AUTH;
    if (!auth || !auth.isLoggedIn()) {
      window.SIREN.toast('제보하려면 로그인이 필요합니다');
      setTimeout(() => {
        const loginBtn = document.querySelector('[data-target="loginModal"]');
        if (loginBtn) loginBtn.click();
      }, 600);
      return;
    }

    const modal = document.getElementById('incidentReportModal');
    if (!modal) return;

    /* 단계 초기화 */
    modal.querySelectorAll('.ir-step').forEach((s) => s.style.display = 'none');
    const step1 = modal.querySelector('[data-ir-step="1"]');
    if (step1) step1.style.display = '';

    /* 폼 리셋 */
    const form = document.getElementById('incidentReportForm');
    if (form) form.reset();

    modal.classList.add('show');
    document.body.style.overflow = 'hidden';

    /* 편집기 초기화 (한 번만) */
    if (!_editor) {
      try {
        _editor = await window.SirenEditor.create({
          el: document.getElementById('irEditor'),
          height: '320px',
          placeholder: '사건과 관련된 정보·증언을 자세히 적어주세요. 시간/장소/관련된 사람들 등 구체적일수록 좋습니다.',
          uploadContext: 'incident-report',
        });
      } catch (e) {
        console.error('[incident] editor init failed', e);
        window.SIREN.toast('편집기 로드 실패');
      }
    } else {
      try { _editor.setHTML(''); } catch (_) {}
    }

    /* 첨부 위젯 초기화 (매번 새로) */
    if (_attachments) {
      try { _attachments.clear(); } catch (_) {}
    }
    if (window.SirenAttachment && !_attachments) {
      _attachments = window.SirenAttachment.create({
        el: document.getElementById('irAttachments'),
        context: 'incident-report',
        maxFiles: 5,
      });
    }
  }

  function closeReportModal() {
    const modal = document.getElementById('incidentReportModal');
    if (!modal) return;
    modal.classList.remove('show');
    document.body.style.overflow = '';
  }

  function showStep(n) {
    const modal = document.getElementById('incidentReportModal');
    if (!modal) return;
    modal.querySelectorAll('.ir-step').forEach((s) => s.style.display = 'none');
    const target = modal.querySelector(`[data-ir-step="${n}"]`);
    if (target) target.style.display = '';
  }

  let _lastReportId = null;

  async function handleReportSubmit(e) {
    e.preventDefault();
    const form = e.target;

    const title = String(form.title.value || '').trim();
    const isAnonymous = !!form.isAnonymous.checked;

    if (!title) {
      window.SIREN.toast('제목을 입력해 주세요');
      return;
    }

    let contentHtml = '';
    try { contentHtml = _editor ? _editor.getHTML() : ''; } catch (_) {}
    contentHtml = String(contentHtml || '').trim();

    /* 본문 비어있는지 검증 (HTML 태그 제거 후 길이) */
    const plain = contentHtml.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
    if (plain.length < 10) {
      window.SIREN.toast('본문을 10자 이상 입력해 주세요');
      return;
    }

    /* 첨부 진행 중인지 확인 */
    if (_attachments && _attachments.hasUploading && _attachments.hasUploading()) {
      window.SIREN.toast('첨부 파일이 아직 업로드 중입니다');
      return;
    }

    const attachmentIds = (_attachments && _attachments.getIds) ? _attachments.getIds() : [];

    const submitBtn = document.getElementById('irSubmitBtn');
    const oldText = submitBtn ? submitBtn.textContent : '';
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'AI 분석 중...';
    }

    try {
      const res = await fetch('/api/incident-report-create', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          incidentSlug: _currentIncident?.slug,
          title,
          contentHtml,
          isAnonymous,
          attachmentIds,
        }),
      });
      const json = await res.json();

      if (!res.ok || !json.ok) {
        if (res.status === 401) {
          window.SIREN.toast('로그인이 만료되었습니다. 다시 로그인해 주세요');
        } else {
          window.SIREN.toast(json.error || '제보 처리 실패');
        }
        return;
      }

// public/js/incident.js — handleReportSubmit 내 AI 결과 표시 블록 교체
      const data = json.data || {};
      _lastReportId = data.reportId;

      document.getElementById('irReportNo').textContent = data.reportNo || '-';

      /* ★ M-17: 후원자 여부에 따른 분기 표시 */
      if (data.isDonor && data.ai) {
        /* 후원자 — AI 분석 결과 정상 표시 */
        const ai = data.ai;
        const sev = ai.severity || 'medium';
        const sevInfo = severityInfo(sev);

        const sevBox = document.getElementById('irAiSeverity');
        sevBox.style.display = '';
        sevBox.className = 'ir-ai-severity ' + sevInfo.cls;
        document.getElementById('irSeverityIcon').textContent = sevInfo.icon;
        document.getElementById('irSeverityLabel').textContent = sevInfo.label;
        document.getElementById('irAiSummary').textContent = ai.summary || '(AI 분석을 일시적으로 사용할 수 없습니다)';
        document.getElementById('irAiSuggestion').textContent = ai.suggestion || '(권장 후속조치 정보가 없습니다)';

        /* 비후원자 안내 박스가 있다면 숨김 */
        const notice = document.getElementById('irPremiumNotice');
        if (notice) notice.style.display = 'none';
      } else if (data.premiumNotice) {
        /* 비후원자 — 후원 회원 전용 안내 표시 */
        const sevBox = document.getElementById('irAiSeverity');
        if (sevBox) sevBox.style.display = 'none';
        document.getElementById('irAiSummary').textContent = '';
        document.getElementById('irAiSuggestion').textContent = '';

        renderPremiumNotice(data.premiumNotice);
      }

      showStep(2);
    } catch (e) {
      console.error('[incident] submit', e);
      window.SIREN.toast('네트워크 오류. 잠시 후 다시 시도해 주세요');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = oldText;
      }
    }
  }

  async function confirmReport(requested) {
    if (!_lastReportId) return;

    const btnSiren = document.getElementById('irBtnSiren');
    const btnAiOnly = document.getElementById('irBtnAiOnly');
    [btnSiren, btnAiOnly].forEach((b) => { if (b) b.disabled = true; });

    try {
      const res = await fetch('/api/incident-report-confirm', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportId: _lastReportId,
          sirenReportRequested: requested,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        window.SIREN.toast(json.error || '처리 실패');
        return;
      }

      /* 완료 화면 */
      if (requested) {
        document.getElementById('irFinalIcon').textContent = '';
        document.getElementById('irFinalTitle').textContent = '사이렌에 정식 접수되었습니다';
        document.getElementById('irFinalMsg').innerHTML =
          '소중한 제보 감사합니다.<br />' +
          '운영진 검토 후 답변을 드리며,<br />' +
          '마이페이지 &gt; 신청 내역에서 진행 상태를 확인하실 수 있습니다.';
      } else {
        document.getElementById('irFinalIcon').textContent = '';
        document.getElementById('irFinalTitle').textContent = 'AI 답변으로 종료 처리되었습니다';
        document.getElementById('irFinalMsg').innerHTML =
          '제보가 기록되었습니다.<br />' +
          '추후 사이렌 정식 접수가 필요하시면<br />' +
          '마이페이지 &gt; 1:1 상담을 이용해 주세요.';
      }
      showStep(3);
    } catch (e) {
      console.error('[incident] confirm', e);
      window.SIREN.toast('네트워크 오류');
    } finally {
      [btnSiren, btnAiOnly].forEach((b) => { if (b) b.disabled = false; });
    }
  }

  // public/js/incident.js — confirmReport 함수 다음에 추가
  /* ★ M-17: 비후원자 안내 박스 렌더 */
  function renderPremiumNotice(notice) {
    const step2 = document.querySelector('[data-ir-step="2"]');
    if (!step2) return;

    let box = document.getElementById('irPremiumNotice');
    if (!box) {
      box = document.createElement('div');
      box.id = 'irPremiumNotice';
      box.style.cssText = 'background:linear-gradient(135deg,#fef9f5,#fff);border:2px solid #7a1f2b;border-radius:10px;padding:24px;margin:16px 0;text-align:center';

      const summaryBox = document.getElementById('irAiSummary');
      if (summaryBox && summaryBox.parentElement) {
        summaryBox.parentElement.insertBefore(box, summaryBox);
      } else {
        step2.appendChild(box);
      }
    }
    box.style.display = '';

    const safeMessage = String(notice.message || '').replace(/\n/g, '<br />');
    box.innerHTML =
      '<div style="font-family:\'Noto Serif KR\',serif;font-size:18px;font-weight:700;color:#7a1f2b;margin-bottom:12px">' +
        escapeHtml(notice.title || '사이렌 후원 회원 전용 서비스') +
      '</div>' +
      '<div style="font-size:13.5px;color:#525252;line-height:1.8;margin-bottom:18px">' +
        safeMessage +
      '</div>' +
      '<a href="' + escapeHtml(notice.ctaUrl || '/support.html') + '" ' +
         'style="display:inline-block;padding:12px 28px;background:#7a1f2b;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px">' +
        escapeHtml(notice.ctaText || '후원하러 가기') + ' →' +
      '</a>';
  }
  
  /* ===========================================================
     ★ R10 / R41 Q2-003: 댓글 시스템 (투표 + 신고)
     - 댓글 목록: /api/incident-comments?incidentId=X
     - 투표: /api/incident-comments (action=vote, voteType=like|dislike)
     - 신고: /api/incident-comments (action=report)
     =========================================================== */


  let _comments = [];
  let _isLoggedIn = false;
  let _reportTargetId = null;

  function toast(msg) {
    if (window.SIREN && window.SIREN.toast) { window.SIREN.toast(msg); return; }
    alert(msg);
  }
  function fmtTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${mm}/${dd} ${hh}:${mi}`;
  }

  function setupCommentSection() {
    const auth = window.SIREN_AUTH;
    _isLoggedIn = !!(auth && auth.isLoggedIn());

    const section = document.getElementById('incidentCommentSection');
    if (!section) return;
    section.style.display = '';

    if (_isLoggedIn) {
      document.getElementById('icCommentForm').style.display = '';
      document.getElementById('icLoginNotice').style.display = 'none';
    } else {
      document.getElementById('icCommentForm').style.display = 'none';
      document.getElementById('icLoginNotice').style.display = '';
    }

    /* 이벤트 위임 */
    section.addEventListener('click', (e) => {
      const submitBtn = e.target.closest('#icCommentSubmit');
      if (submitBtn) { submitComment(); return; }

      const actionBtn = e.target.closest('[data-cmt-action]');
      if (!actionBtn) return;

      const action = actionBtn.dataset.cmtAction;
      const cid = Number(actionBtn.dataset.cmtId);
      if (action === 'vote') {
        voteComment(cid, actionBtn.dataset.voteType, actionBtn);
      } else if (action === 'report') {
        openCommentReportModal(cid);
      }
    });

    /* 신고 모달 닫기 위임 */
    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-icr-close]')) closeCommentReportModal();
    });
    const reportBtn = document.getElementById('icReportSubmit');
    if (reportBtn) reportBtn.addEventListener('click', submitReport);

    loadComments();
  }

  async function loadComments() {
    if (!_currentIncident?.id) return;
    const listEl = document.getElementById('icCommentList');
    const countEl = document.getElementById('icCommentCount');
    if (!listEl) return;

    try {
      const r = await fetch('/api/incident-comments?incidentId=' + _currentIncident.id, {
        credentials: 'include',
      });
      const json = await r.json().catch(() => ({}));

      const rawList = json?.data?.comments || json?.comments || [];
      _comments = rawList.map((c) => ({
        id: c.id,
        authorName: c.authorName || (c.isAnonymous ? '익명' : '회원'),
        content: c.content,
        isAnonymous: !!c.isAnonymous,
        isHidden: !!c.isHidden,
        createdAt: c.createdAt,
        upCount: c.upCount != null ? c.upCount : (c.likeCount || 0),
        downCount: c.downCount != null ? c.downCount : (c.dislikeCount || 0),
        myVote: c.myVote === 'like' ? 'up' : c.myVote === 'dislike' ? 'down' : (c.myVote || null),
      }));

      renderComments();
      if (countEl) countEl.textContent = `(${_comments.length})`;
    } catch (e) {
      console.warn('[incident] loadComments fallback', e);
      _comments = [];
      renderComments();
      if (countEl) countEl.textContent = '(0)';
    }
  }

  function renderComments() {
    const listEl = document.getElementById('icCommentList');
    if (!listEl) return;
    if (_comments.length === 0) {
      listEl.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-3);font-size:13px">아직 댓글이 없습니다. 첫 댓글을 남겨보세요.</div>';
      return;
    }
    listEl.innerHTML = _comments.map(renderCommentItem).join('');
  }

  function renderCommentItem(c) {
    const upCls = c.myVote === 'up' ? ' voted' : '';
    const downCls = c.myVote === 'down' ? ' voted' : '';
    const reportBtn = _isLoggedIn
      ? `<button type="button" class="ic-action-btn report-btn" data-cmt-action="report" data-cmt-id="${c.id}">신고</button>`
      : '';
    const anonBadge = c.isAnonymous ? '<span class="ic-badge-anon">익명</span>' : '';

    return `
      <div class="ic-comment${c.isHidden ? ' hidden-comment' : ''}" data-cid="${c.id}">
        <div class="ic-comment-meta">
          <span class="ic-comment-author">${escapeHtml(c.authorName)}</span>
          ${anonBadge}
          <span class="ic-comment-time">${fmtTime(c.createdAt)}</span>
        </div>
        <div class="ic-comment-content">${escapeHtml(c.content)}</div>
        <div class="ic-comment-actions">
          <button type="button" class="ic-action-btn${upCls}" data-cmt-action="vote" data-cmt-id="${c.id}" data-vote-type="up"><span class="ic-up-n">${c.upCount}</span></button>
          <button type="button" class="ic-action-btn${downCls}" data-cmt-action="vote" data-cmt-id="${c.id}" data-vote-type="down"><span class="ic-down-n">${c.downCount}</span></button>
          ${reportBtn}
        </div>
      </div>
    `;
  }

  async function submitComment() {
    if (!_isLoggedIn) { toast('로그인이 필요합니다'); return; }
    if (!_currentIncident?.id) return;

    const input = document.getElementById('icCommentInput');
    const content = (input?.value || '').trim();
    if (content.length < 2) { toast('댓글은 2자 이상 입력해 주세요'); return; }

    const isAnonymous = !!document.getElementById('icAnonymous')?.checked;

    try {
      const r = await fetch('/api/incident-comments', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          incidentId: _currentIncident.id,
          content,
          isAnonymous,
        }),
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok || json.ok === false) {
        toast(json.error || '댓글 작성 실패');
        return;
      }
      input.value = '';
      const anonCb = document.getElementById('icAnonymous');
      if (anonCb) anonCb.checked = false;
      toast('댓글이 등록되었습니다');
      await loadComments();
    } catch (e) {
      console.error('[incident] submitComment', e);
      toast('네트워크 오류');
    }
  }

  async function voteComment(commentId, voteType, btnEl) {
    if (!_isLoggedIn) { toast('로그인이 필요합니다'); return; }

    /* 로컬 표기(up/down) → 서버 표기(like/dislike) */
    const serverVoteType = voteType === 'up' ? 'like' : 'dislike';

    let data = null;
    try {
      const r = await fetch('/api/incident-comments', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'vote', commentId, voteType: serverVoteType }),
      });
      const json = await r.json().catch(() => ({}));
      if (r.ok && json.ok) {
        data = json.data || json;
      } else {
        toast(json.error || '투표 처리 실패');
        return;
      }
    } catch (err) {
      toast('오류가 발생했습니다.');
      return;
    }

    /* 로컬 상태 + UI 갱신 (취소면 myVote 해제, 서버 갱신 카운트 반영) */
    const c = _comments.find((x) => x.id === commentId);
    if (c) {
      c.myVote = data.action === 'cancelled' ? null : voteType;
      if (data.likeCount != null) c.upCount = data.likeCount;
      if (data.dislikeCount != null) c.downCount = data.dislikeCount;
    }
    renderComments();
    toast(data.action === 'cancelled' ? '투표가 취소되었습니다.' : '투표했습니다.');
  }

  function openCommentReportModal(commentId) {
    if (!_isLoggedIn) { toast('로그인이 필요합니다'); return; }
    _reportTargetId = commentId;
    const modal = document.getElementById('icReportModal');
    if (!modal) return;
    /* 폼 리셋 */
    modal.querySelectorAll('input[name="icReportReason"]').forEach((r) => { r.checked = false; });
    const detail = document.getElementById('icReportDetail');
    if (detail) detail.value = '';
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
  }
  function closeCommentReportModal() {
    const modal = document.getElementById('icReportModal');
    if (!modal) return;
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
    _reportTargetId = null;
  }

  async function submitReport() {
    if (!_reportTargetId) return;
    const reasonEl = document.querySelector('input[name="icReportReason"]:checked');
    if (!reasonEl) { toast('신고 사유를 선택해 주세요'); return; }
    const detail = (document.getElementById('icReportDetail')?.value || '').trim();
    const reason = reasonEl.value + (detail ? (' — ' + detail) : '');

    const btn = document.getElementById('icReportSubmit');
    if (btn) { btn.disabled = true; btn.textContent = '처리 중...'; }

    try {
      const r = await fetch('/api/incident-comments', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'report',
          commentId: _reportTargetId,
          reason,
        }),
      });
      const json = await r.json().catch(() => ({}));
      if (r.ok && json.ok) {
        toast('신고되었습니다. 검토 후 처리됩니다.');
      } else if (r.status === 409) {
        toast('이미 신고한 항목입니다.');
      } else {
        toast(json.error || '신고 처리 실패. 잠시 후 다시 시도해 주세요.');
      }
    } catch (_) {
      toast('오류가 발생했습니다.');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '신고하기'; }
      closeCommentReportModal();
    }
  }

  /* ============ 초기화 ============ */
  let _initialized = false;
  function init() {
    if (_initialized) return;
    _initialized = true;
    const page = document.body.dataset.page;
    if (page === 'incidents') {
      loadIncidentList();
    } else if (page === 'incident-detail') {
      loadIncidentDetail().then(() => {
        if (_currentIncident?.id) setupCommentSection();
      });
      setupReportModal();
    }
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