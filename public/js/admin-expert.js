/* =========================================================
   SIREN — admin-expert.js
   6순위 #8: 어드민 1:1 매칭 관리 모듈
   (대기 목록 + 전문가 배정 모달 + 세션 종료)
   ========================================================= */
(function () {
  'use strict';

  var _currentStatus = 'pending';
  var _assignTarget  = null; /* { matchId, matchType } */

  var STATUS_LABEL = {
    pending:   '대기',
    matched:   '배정',
    active:    '진행중',
    closed:    '종료',
    rejected:  '반려',
  };

  var MATCH_TYPE_LABEL = {
    lawyer:    '변호사',
    counselor: '심리상담사',
  };

  var DOMAIN_LABEL = {
    incident:  '사건 제보',
    harassment:'악성민원',
    legal:     '법률지원',
    support:   '유족지원',
  };

  /* ─── 헬퍼 ─── */
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function toast(msg) {
    if (window.SIREN && window.SIREN.toast) return window.SIREN.toast(msg);
    alert(msg);
  }

  function fmtDate(s) {
    if (!s) return '';
    try { return new Date(s).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }); } catch (e) { return String(s); }
  }

  async function api(path, opts) {
    opts = opts || {};
    var init = {
      method: opts.method || 'GET',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    };
    if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
    try {
      var res = await fetch(path, init);
      var data = await res.json().catch(function () { return {}; });
      return { status: res.status, ok: res.ok && data.ok !== false, data: data };
    } catch (e) {
      return { status: 0, ok: false, data: { error: '네트워크 오류' } };
    }
  }

  /* ─── 패널 컨테이너 ─── */
  function ensureContainer() {
    return document.getElementById('adm-expert-match');
  }

  /* ─── 패널 껍데기 (1회 렌더) ─── */
  function renderShell() {
    var page = ensureContainer();
    if (!page || page.dataset.expertInit === '1') return;
    page.dataset.expertInit = '1';

    page.innerHTML = '' +
      '<div class="panel">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:14px">' +
          '<h3 style="margin:0">1:1 매칭 관리</h3>' +
          '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
            '<button class="btn-sm btn-sm-ghost" data-em-adm-tab="pending" type="button">' +
              '대기 <span id="emAdmCntPending" class="adm-badge" style="display:none">0</span>' +
            '</button>' +
            '<button class="btn-sm btn-sm-ghost" data-em-adm-tab="active"  type="button">진행중</button>' +
            '<button class="btn-sm btn-sm-ghost" data-em-adm-tab="closed"  type="button">완료</button>' +
            '<button class="btn-sm btn-sm-ghost" data-em-adm-tab="all"     type="button">전체</button>' +
            '<button class="btn-sm btn-sm-ghost" id="btnEmAdmRefresh"      type="button">새로고침</button>' +
          '</div>' +
        '</div>' +
        '<table class="tbl">' +
          '<thead><tr>' +
            '<th style="width:100px">ID/일자</th>' +
            '<th style="width:160px">신청자</th>' +
            '<th style="width:130px">유형/도메인</th>' +
            '<th>신청 사유</th>' +
            '<th style="width:160px">배정 전문가</th>' +
            '<th style="width:110px">상태</th>' +
            '<th style="width:170px">작업</th>' +
          '</tr></thead>' +
          '<tbody id="emAdmTbody">' +
            '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text-3)">불러오는 중...</td></tr>' +
          '</tbody>' +
        '</table>' +
      '</div>' +

      /* ─── 배정 모달 (인라인) ─── */
      '<div id="emAssignModal" style="' +
        'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.55);' +
        'z-index:9999;align-items:flex-start;justify-content:center;' +
        'padding:40px 20px;overflow-y:auto' +
      '">' +
        '<div style="background:#fff;border-radius:12px;max-width:520px;width:100%;' +
             'box-shadow:0 20px 60px rgba(0,0,0,0.3);margin:auto;overflow:hidden">' +
          '<div style="padding:16px 22px;background:var(--ink);color:#fff;' +
               'display:flex;justify-content:space-between;align-items:center">' +
            '<div style="font-weight:700;font-size:15px">전문가 배정</div>' +
            '<button id="btnEmModalClose" style="background:transparent;border:none;color:#fff;font-size:24px;cursor:pointer;line-height:1">&times;</button>' +
          '</div>' +
          '<div style="padding:20px 24px">' +
            '<div id="emAssignInfo" style="background:var(--bg-soft);border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:13px;line-height:1.7"></div>' +
            '<div class="fg">' +
              '<label>전문가 선택 <span style="color:var(--danger)">*</span></label>' +
              '<select id="emExpertSelect"><option value="">불러오는 중...</option></select>' +
            '</div>' +
            '<div class="fg">' +
              '<label>어드민 메모 <span class="hint">(선택)</span></label>' +
              '<textarea id="emAdminNote" rows="3" maxlength="1000" placeholder="배정 관련 메모 (내부용)"></textarea>' +
            '</div>' +
            '<div style="display:flex;gap:10px;margin-top:14px">' +
              '<button class="btn btn-primary" id="btnEmDoAssign" type="button">배정하기</button>' +
              '<button class="btn" id="btnEmCancelAssign" type="button" ' +
                'style="background:transparent;border:1px solid var(--line);color:var(--text-2)">취소</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  /* ─── 목록 row 렌더 ─── */
  function renderRow(it) {
    var user        = it.user   || it.member || {};
    var expert      = it.expert || {};
    var statusLabel = STATUS_LABEL[it.status]    || it.status;
    var typeLabel   = MATCH_TYPE_LABEL[it.matchType]   || it.matchType;
    var domainLabel = DOMAIN_LABEL[it.sourceDomain] || it.sourceDomain;

    var actions = '<span style="color:var(--text-3);font-size:12px">' + escapeHtml(statusLabel) + '</span>';
    if (it.status === 'pending') {
      actions = '<button class="btn-sm btn-sm-primary" ' +
        'data-em-assign="' + it.id + '" ' +
        'data-em-match-type="' + escapeHtml(it.matchType || '') + '" ' +
        'type="button">배정</button> ' +
        '<button class="btn-sm" data-em-reject="' + it.id + '" type="button" ' +
          'style="border:1px solid #d1d5db;color:#6b7280;background:#fff;border-radius:4px;' +
          'padding:4px 10px;font-size:11.5px;cursor:pointer;font-weight:600">반려</button>';
    } else if (it.status === 'matched' || it.status === 'active') {
      actions = '' +
        (it.chatRoomId
          ? '<button class="btn-sm btn-sm-ghost" data-em-view-chat="' + it.chatRoomId + '" type="button">채팅 #' + it.chatRoomId + '</button> '
          : '') +
        '<button class="btn-sm" data-em-end-session="' + it.id + '" type="button" ' +
          'style="border:1px solid #fca5a5;color:#dc2626;background:#fff;border-radius:4px;' +
          'padding:4px 10px;font-size:11.5px;cursor:pointer;font-weight:600">종료</button>';
    }

    var expertCell = expert.name
      ? '' +
        '<strong>' + escapeHtml(expert.memberName || expert.name || '') + '</strong>' +
        (expert.memberEmail || expert.email
          ? '<div style="font-size:11.5px;color:var(--text-3)">' + escapeHtml(expert.memberEmail || expert.email) + '</div>'
          : '')
      : '<span style="color:var(--text-3);font-size:12px">미배정</span>';

    return '' +
      '<tr>' +
        '<td style="white-space:nowrap">' +
          '#' + it.id +
          '<div style="font-size:11.5px;color:var(--text-3)">' + escapeHtml(fmtDate(it.createdAt)) + '</div>' +
        '</td>' +
        '<td>' +
          '<strong>' + escapeHtml(user.name || '(이름?)') + '</strong>' +
          '<div style="font-size:12px;color:var(--text-3)">' + escapeHtml(user.email || '') + '</div>' +
        '</td>' +
        '<td>' +
          '<span style="background:#eef2ff;color:#4338ca;padding:2px 8px;border-radius:10px;font-size:11.5px;font-weight:600">' +
            escapeHtml(typeLabel) +
          '</span>' +
          '<div style="font-size:11.5px;color:var(--text-3);margin-top:3px">' + escapeHtml(domainLabel) + '</div>' +
        '</td>' +
        '<td style="max-width:240px">' +
          '<div style="white-space:pre-wrap;word-break:break-word;font-size:12.5px">' +
            escapeHtml((it.reason || '').slice(0, 200)) +
          '</div>' +
          (it.adminNote ? '<div style="margin-top:5px;font-size:11.5px;color:var(--text-3);background:#f8fafc;' +
            'border-left:3px solid #cbd5e1;padding:4px 8px;border-radius:3px">메모: ' + escapeHtml(it.adminNote) + '</div>' : '') +
        '</td>' +
        '<td style="font-size:13px">' + expertCell + '</td>' +
        '<td>' +
          '<span style="padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;background:#f3f4f6;color:#525252">' +
            escapeHtml(statusLabel) +
          '</span>' +
        '</td>' +
        '<td style="white-space:nowrap">' + actions + '</td>' +
      '</tr>';
  }

  /* ─── 탭 버튼 활성화 ─── */
  function setActiveTab(status) {
    document.querySelectorAll('#adm-expert-match [data-em-adm-tab]').forEach(function (b) {
      b.classList.toggle('btn-sm-primary', b.dataset.emAdmTab === status);
      b.classList.toggle('btn-sm-ghost',   b.dataset.emAdmTab !== status);
    });
  }

  /* ─── 목록 로드 ─── */
  async function load(status) {
    renderShell();
    _currentStatus = status || _currentStatus || 'pending';
    setActiveTab(_currentStatus);

    var tbody = document.getElementById('emAdmTbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-3)">불러오는 중...</td></tr>';

    var r = await api('/api/admin-expert-list?status=' + encodeURIComponent(_currentStatus));
    if (!r.ok) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:#b91c1c">로드 실패: ' +
        escapeHtml((r.data && r.data.error) || ('HTTP ' + r.status)) + '</td></tr>';
      return;
    }

    var payload = (r.data && r.data.data) || r.data || {};
    var items   = payload.items || payload.matches || [];
    var counts  = payload.counts || {};

    /* 대기 배지 갱신 */
    var pendingBadge = document.getElementById('emAdmCntPending');
    if (pendingBadge) {
      var pn = Number(counts.pending || 0);
      pendingBadge.textContent = String(pn);
      pendingBadge.style.display = pn > 0 ? '' : 'none';
    }
    var sidebarBadge = document.getElementById('expertMatchMenuBadge');
    if (sidebarBadge) {
      var pn2 = Number(counts.pending || 0);
      sidebarBadge.textContent = String(pn2);
      sidebarBadge.style.display = pn2 > 0 ? '' : 'none';
    }

    if (!items.length) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text-3)">해당 상태의 신청이 없습니다.</td></tr>';
      return;
    }
    if (tbody) tbody.innerHTML = items.map(renderRow).join('');
  }

  /* ─── 배정 모달 열기 ─── */
  async function openAssignModal(matchId, matchType) {
    _assignTarget = { matchId: Number(matchId), matchType: matchType };

    var modal = document.getElementById('emAssignModal');
    if (!modal) return;
    modal.style.display = 'flex';

    /* 신청 정보 표시 */
    var info = document.getElementById('emAssignInfo');
    if (info) {
      info.innerHTML = '' +
        '<strong>매칭 #' + matchId + '</strong> &nbsp;—&nbsp; ' +
        '<span style="background:#eef2ff;color:#4338ca;padding:2px 8px;border-radius:10px;font-size:12px;font-weight:600">' +
          escapeHtml(MATCH_TYPE_LABEL[matchType] || matchType) +
        '</span>' +
        '<br><span style="font-size:12px;color:var(--text-3);margin-top:4px;display:block">' +
          '아래에서 전문가를 선택하고 배정하면 1:1 채팅방이 자동 생성됩니다.' +
        '</span>';
    }

    /* 전문가 목록 조회: GET /api/admin/experts-for-match?type=lawyer|counselor */
    var sel = document.getElementById('emExpertSelect');
    if (sel) {
      sel.innerHTML = '<option value="">전문가 목록 불러오는 중...</option>';
      sel.disabled = true;
    }

    var r = await api('/api/admin/experts-for-match?type=' + encodeURIComponent(matchType));
    if (sel) {
      sel.disabled = false;
      var experts = [];
      if (r.ok) {
        experts = (r.data && r.data.experts)
          || (r.data && r.data.data && r.data.data.experts)
          || [];
      }
      if (!r.ok || !experts.length) {
        sel.innerHTML = '<option value="">' +
          (r.ok ? '배정 가능한 전문가가 없습니다' : '전문가 목록 조회 실패') +
          '</option>';
      } else {
        sel.innerHTML = '<option value="">전문가를 선택하세요</option>' +
          experts.map(function (ex) {
            var name  = escapeHtml(ex.memberName || ex.name || '');
            var email = ex.memberEmail || ex.email;
            return '<option value="' + ex.id + '">' + name + (email ? ' (' + escapeHtml(email) + ')' : '') + '</option>';
          }).join('');
      }
    }

    /* 메모 초기화 */
    var note = document.getElementById('emAdminNote');
    if (note) note.value = '';
  }

  /* ─── 배정 모달 닫기 ─── */
  function closeAssignModal() {
    var modal = document.getElementById('emAssignModal');
    if (modal) modal.style.display = 'none';
    _assignTarget = null;
  }

  /* ─── 배정 실행 ─── */
  async function doAssign() {
    if (!_assignTarget) return;
    var expertId  = Number(((document.getElementById('emExpertSelect') || {}).value) || 0);
    var adminNote = ((document.getElementById('emAdminNote') || {}).value || '').trim();

    if (!expertId) return toast('전문가를 선택해 주세요');

    var btn = document.getElementById('btnEmDoAssign');
    if (btn) { btn.disabled = true; btn.textContent = '배정 중...'; }

    var r = await api('/api/admin-expert-assign', {
      method: 'POST',
      body: {
        matchId:   _assignTarget.matchId,
        expertId:  expertId,
        adminNote: adminNote || undefined,
      },
    });

    if (btn) { btn.disabled = false; btn.textContent = '배정하기'; }

    if (!r.ok) {
      var err = (r.data && r.data.error) || ('HTTP ' + r.status);
      return toast('배정 실패: ' + err);
    }

    var d = (r.data && r.data.data) || {};
    toast('전문가 배정 완료! 채팅방 #' + (d.chatRoomId || '?') + ' 이(가) 자동 생성되었습니다.');
    closeAssignModal();
    load(_currentStatus);
  }

  /* ─── 세션 종료 ─── */
  async function doSessionEnd(matchId) {
    var reason = window.prompt('세션 종료 사유를 입력해 주세요 (선택, Enter로 생략)', '') ;
    if (reason === null) return; /* 취소 */
    reason = (reason || '').trim() || 'completed';

    var r = await api('/api/expert-session-end', {
      method: 'POST',
      body: { matchId: Number(matchId), closedReason: reason },
    });
    if (!r.ok) {
      return toast('세션 종료 실패: ' + ((r.data && r.data.error) || ('HTTP ' + r.status)));
    }
    toast((r.data && r.data.message) || '세션이 종료되었습니다.');
    load(_currentStatus);
  }

  /* AD-057: 대기(미배정) 신청 반려 — 부적절·중복 신청 정리 */
  async function doRejectPending(matchId) {
    var r = await api('/api/expert-session-end', {
      method: 'POST',
      body: { matchId: Number(matchId), rejectPending: true },
    });
    if (!r.ok) {
      return toast('반려 실패: ' + ((r.data && r.data.error) || ('HTTP ' + r.status)));
    }
    toast((r.data && r.data.message) || '대기 신청을 반려했습니다.');
    load(_currentStatus);
  }

  /* ─── 직접 배정 모달 (유가족지원/법률지원 신청에서 바로 배정) ─── */
  var _directTarget = null; /* { sourceType, sourceId, userId, defaultMatchType } */

  async function openDirectAssignModal(sourceType, sourceId, userId, defaultMatchType) {
    _directTarget = {
      sourceType: sourceType,
      sourceId: Number(sourceId),
      userId: Number(userId),
      defaultMatchType: defaultMatchType || 'counselor',
    };

    /* 모달 재활용 — renderShell이 한 번 이상 실행됐을 때만 사용 가능 */
    var modal = document.getElementById('emAssignModal');
    if (!modal) {
      /* 아직 패널이 렌더되지 않은 경우 — 임시 모달을 body에 직접 붙임 */
      var tmp = document.createElement('div');
      tmp.id = 'emDirectModal';
      tmp.style.cssText = 'display:flex;position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;align-items:flex-start;justify-content:center;padding:40px 20px;overflow-y:auto';
      tmp.innerHTML =
        '<div style="background:#fff;border-radius:12px;max-width:520px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.3);margin:auto;overflow:hidden">' +
          '<div style="padding:16px 22px;background:var(--ink);color:#fff;display:flex;justify-content:space-between;align-items:center">' +
            '<div style="font-weight:700;font-size:15px">전문가 직접 배정</div>' +
            '<button id="btnEmDirectClose" style="background:transparent;border:none;color:#fff;font-size:24px;cursor:pointer;line-height:1">&times;</button>' +
          '</div>' +
          '<div style="padding:20px 24px">' +
            '<div id="emDirectInfo" style="background:var(--bg-soft);border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:13px;line-height:1.7"></div>' +
            '<div class="fg">' +
              '<label>상담 유형 <span style="color:var(--danger)">*</span></label>' +
              '<select id="emDirectTypeSelect">' +
                '<option value="lawyer">변호사</option>' +
                '<option value="counselor">심리상담사</option>' +
              '</select>' +
            '</div>' +
            '<div class="fg" style="margin-top:12px">' +
              '<label>전문가 선택 <span style="color:var(--danger)">*</span></label>' +
              '<select id="emDirectExpertSelect"><option value="">상담 유형을 먼저 선택하세요</option></select>' +
            '</div>' +
            '<div class="fg" style="margin-top:12px">' +
              '<label>어드민 메모 <span class="hint">(선택)</span></label>' +
              '<textarea id="emDirectNote" rows="3" maxlength="1000" placeholder="배정 관련 메모 (내부용)"></textarea>' +
            '</div>' +
            '<div style="display:flex;gap:10px;margin-top:14px">' +
              '<button class="btn btn-primary" id="btnEmDirectAssign" type="button">배정하기</button>' +
              '<button class="btn" id="btnEmDirectCancel" type="button" style="background:transparent;border:1px solid var(--line);color:var(--text-2)">취소</button>' +
            '</div>' +
          '</div>' +
        '</div>';
      document.body.appendChild(tmp);

      tmp.querySelector('#btnEmDirectClose').addEventListener('click', closeDirectModal);
      tmp.querySelector('#btnEmDirectCancel').addEventListener('click', closeDirectModal);
      tmp.addEventListener('click', function (e) { if (e.target === tmp) closeDirectModal(); });

      var typeSelect = tmp.querySelector('#emDirectTypeSelect');
      typeSelect.value = _directTarget.defaultMatchType;
      typeSelect.addEventListener('change', function () { loadDirectExperts(typeSelect.value); });

      tmp.querySelector('#btnEmDirectAssign').addEventListener('click', doDirectAssign);

      loadDirectExperts(_directTarget.defaultMatchType);
      updateDirectInfo();
      return;
    }

    /* 기존 배정 모달 재활용 */
    modal.style.display = 'flex';
    var info = document.getElementById('emAssignInfo');
    if (info) {
      info.innerHTML =
        '<strong>직접 배정</strong> — ' +
        (sourceType === 'support' ? '유가족지원' : '법률지원') + ' 신청 #' + sourceId +
        '<br><span style="font-size:12px;color:var(--text-3);margin-top:4px;display:block">전문가를 선택하면 즉시 1:1 채팅방이 생성됩니다.</span>';
    }
    var sel = document.getElementById('emExpertSelect');
    if (sel) {
      sel.innerHTML = '<option value="">전문가 목록 불러오는 중...</option>';
      sel.disabled = true;
    }
    var r = await api('/api/admin/experts-for-match?type=' + encodeURIComponent(defaultMatchType || 'counselor'));
    if (sel) {
      sel.disabled = false;
      var experts = (r.ok && ((r.data && r.data.experts) || (r.data && r.data.data && r.data.data.experts))) || [];
      sel.innerHTML = experts.length
        ? '<option value="">전문가를 선택하세요</option>' + experts.map(function (ex) {
            return '<option value="' + ex.id + '">' + escapeHtml(ex.memberName || ex.name || '') +
              (ex.memberEmail || ex.email ? ' (' + escapeHtml(ex.memberEmail || ex.email) + ')' : '') + '</option>';
          }).join('')
        : '<option value="">배정 가능한 전문가가 없습니다</option>';
    }
    var note = document.getElementById('emAdminNote');
    if (note) note.value = '';

    /* 배정 버튼 핸들러 임시 교체 */
    var doBtn = document.getElementById('btnEmDoAssign');
    if (doBtn) {
      doBtn.onclick = function () { doDirectAssignViaMainModal(); };
    }
  }

  function updateDirectInfo() {
    var info = document.getElementById('emDirectInfo');
    if (!info || !_directTarget) return;
    info.innerHTML =
      '<strong>직접 배정</strong> — ' +
      (_directTarget.sourceType === 'support' ? '유가족지원' : '법률지원') + ' 신청 #' + _directTarget.sourceId +
      '<br><span style="font-size:12px;color:var(--text-3);margin-top:4px;display:block">전문가를 선택하면 즉시 1:1 채팅방이 생성됩니다.</span>';
  }

  async function loadDirectExperts(matchType) {
    var sel = document.getElementById('emDirectExpertSelect');
    if (!sel) return;
    sel.disabled = true;
    sel.innerHTML = '<option value="">목록 불러오는 중...</option>';
    var r = await api('/api/admin/experts-for-match?type=' + encodeURIComponent(matchType || 'counselor'));
    sel.disabled = false;
    var experts = (r.ok && ((r.data && r.data.experts) || (r.data && r.data.data && r.data.data.experts))) || [];
    sel.innerHTML = experts.length
      ? '<option value="">전문가를 선택하세요</option>' + experts.map(function (ex) {
          return '<option value="' + ex.id + '">' + escapeHtml(ex.memberName || ex.name || '') +
            (ex.memberEmail || ex.email ? ' (' + escapeHtml(ex.memberEmail || ex.email) + ')' : '') + '</option>';
        }).join('')
      : '<option value="">배정 가능한 전문가가 없습니다</option>';
  }

  function closeDirectModal() {
    var tmp = document.getElementById('emDirectModal');
    if (tmp) tmp.remove();
    _directTarget = null;
    /* 기존 배정 모달도 닫기 */
    var modal = document.getElementById('emAssignModal');
    if (modal) modal.style.display = 'none';
    /* 배정 버튼 핸들러 원복 */
    var doBtn = document.getElementById('btnEmDoAssign');
    if (doBtn) doBtn.onclick = null;
  }

  async function doDirectAssign() {
    if (!_directTarget) return;
    var typeSelect = document.getElementById('emDirectTypeSelect');
    var expertSelect = document.getElementById('emDirectExpertSelect');
    var noteEl = document.getElementById('emDirectNote');
    var matchType = (typeSelect && typeSelect.value) || _directTarget.defaultMatchType;
    var expertId = Number((expertSelect && expertSelect.value) || 0);
    var adminNote = ((noteEl && noteEl.value) || '').trim();

    if (!expertId) return toast('전문가를 선택해 주세요');

    var btn = document.getElementById('btnEmDirectAssign');
    if (btn) { btn.disabled = true; btn.textContent = '배정 중...'; }

    var r = await api('/api/admin-expert-direct-assign', {
      method: 'POST',
      body: {
        sourceType:  _directTarget.sourceType,
        sourceId:    _directTarget.sourceId,
        userId:      _directTarget.userId,
        matchType:   matchType,
        expertId:    expertId,
        adminNote:   adminNote || undefined,
      },
    });

    if (btn) { btn.disabled = false; btn.textContent = '배정하기'; }

    if (!r.ok) {
      return toast('배정 실패: ' + ((r.data && r.data.error) || ('HTTP ' + r.status)));
    }
    var d = (r.data && r.data.data) || {};
    toast('전문가 배정 완료! 채팅방 #' + (d.chatRoomId || '?') + ' 이(가) 자동 생성되었습니다.');
    closeDirectModal();
  }

  async function doDirectAssignViaMainModal() {
    if (!_directTarget) { doAssign(); return; }
    var expertSel = document.getElementById('emExpertSelect');
    var noteEl    = document.getElementById('emAdminNote');
    var expertId  = Number((expertSel && expertSel.value) || 0);
    var adminNote = ((noteEl && noteEl.value) || '').trim();

    if (!expertId) return toast('전문가를 선택해 주세요');

    var btn = document.getElementById('btnEmDoAssign');
    if (btn) { btn.disabled = true; btn.textContent = '배정 중...'; }

    var r = await api('/api/admin-expert-direct-assign', {
      method: 'POST',
      body: {
        sourceType:  _directTarget.sourceType,
        sourceId:    _directTarget.sourceId,
        userId:      _directTarget.userId,
        matchType:   _directTarget.defaultMatchType,
        expertId:    expertId,
        adminNote:   adminNote || undefined,
      },
    });

    if (btn) { btn.disabled = false; btn.textContent = '배정하기'; btn.onclick = null; }

    if (!r.ok) {
      return toast('배정 실패: ' + ((r.data && r.data.error) || ('HTTP ' + r.status)));
    }
    var d = (r.data && r.data.data) || {};
    toast('전문가 배정 완료! 채팅방 #' + (d.chatRoomId || '?') + ' 이(가) 자동 생성되었습니다.');
    closeAssignModal();
    _directTarget = null;
  }

  /* ─── 사이드바 배지 갱신 (admin.js 초기화 시 호출) ─── */
  async function refreshBadge() {
    var r = await api('/api/admin-expert-list?status=pending&limit=1');
    if (!r.ok) return;
    var payload = (r.data && r.data.data) || r.data || {};
    var counts  = payload.counts || {};
    var sidebar = document.getElementById('expertMatchMenuBadge');
    if (sidebar) {
      var pn = Number(counts.pending || 0);
      sidebar.textContent = String(pn);
      sidebar.style.display = pn > 0 ? '' : 'none';
    }
  }

  /* ─── 이벤트 위임 ─── */
  document.addEventListener('click', async function (e) {
    /* 탭 전환 */
    var tabBtn = e.target.closest && e.target.closest('#adm-expert-match [data-em-adm-tab]');
    if (tabBtn) { e.preventDefault(); load(tabBtn.dataset.emAdmTab); return; }

    /* 새로고침 */
    var refBtn = e.target.closest && e.target.closest('#btnEmAdmRefresh');
    if (refBtn) { e.preventDefault(); load(_currentStatus); return; }

    /* 배정 모달 열기 */
    var assignBtn = e.target.closest && e.target.closest('[data-em-assign]');
    if (assignBtn) {
      e.preventDefault();
      openAssignModal(assignBtn.dataset.emAssign, assignBtn.dataset.emMatchType);
      return;
    }

    /* 배정 실행 */
    var doBtn = e.target.closest && e.target.closest('#btnEmDoAssign');
    if (doBtn) { e.preventDefault(); doAssign(); return; }

    /* 모달 닫기 */
    var closeBtn = e.target.closest && e.target.closest('#btnEmModalClose, #btnEmCancelAssign');
    if (closeBtn) { closeAssignModal(); return; }
    var modal = document.getElementById('emAssignModal');
    if (modal && e.target === modal) { closeAssignModal(); return; }

    /* 세션 종료 */
    var endBtn = e.target.closest && e.target.closest('[data-em-end-session]');
    if (endBtn) {
      e.preventDefault();
      if (confirm('이 매칭 세션을 종료하시겠습니까?')) doSessionEnd(endBtn.dataset.emEndSession);
      return;
    }

    /* AD-057: 대기 신청 반려 */
    var rejectBtn = e.target.closest && e.target.closest('[data-em-reject]');
    if (rejectBtn) {
      e.preventDefault();
      if (confirm('이 대기 신청을 반려하시겠습니까?\n신청자는 같은 종류를 다시 신청할 수 있습니다.')) doRejectPending(rejectBtn.dataset.emReject);
      return;
    }

    /* 채팅 조회 (어드민용 — 채팅방 ID 토스트) */
    var chatBtn = e.target.closest && e.target.closest('[data-em-view-chat]');
    if (chatBtn) {
      e.preventDefault();
      toast('채팅방 #' + chatBtn.dataset.emViewChat + ' — 해당 사용자 마이페이지에서 내역 확인 가능합니다.');
      return;
    }
  });

  window.SIREN_ADMIN_EXPERT = {
    load: load,
    refreshBadge: refreshBadge,
    openDirectAssignModal: openDirectAssignModal,
  };
})();
