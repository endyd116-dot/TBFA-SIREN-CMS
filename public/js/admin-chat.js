/* =========================================================
   SIREN — admin-chat.js (★ K-9 핫픽스 v2 — DOM 기반 영구 차단)
   관리자측 채팅 관리 (좌우 분할 레이아웃)
   ★ H-1: 이미지 인라인 표시 + 라이트박스 + 다운로드
   ★ I-3: 보관함(archived) 액션
   ★ K-9 v2:
     1. 모든 메시지 ID를 String()으로 정규화
     2. DOM 검증 (querySelector data-msg-id)
     3. selectRoom 토큰으로 stale 요청 차단
     4. init() 중복 실행 방지
     5. appendMessagesIfNew 통합 헬퍼 (idempotent)
   ========================================================= */
(function () {
  'use strict';

  /* ★ 중복 init 방지 */
  if (window.__SIREN_ADMIN_CHAT_LOADED__) return;
  window.__SIREN_ADMIN_CHAT_LOADED__ = true;

  const POLL_INTERVAL = 5000;
  const CAT_LABEL = {
    support_donation: '💝 후원',
    support_homepage: '🌐 홈페이지',
    support_signup: '📝 가입',
    support_other: '💬 기타',
  };

  let _currentRoom = null;
  let _pollTimer = null;
  let _lastMsgAt = null;
  /* ★ ID는 항상 String으로 저장 */
  let _seenMessageIds = new Set();
  /* ★ selectRoom stale 요청 차단 */
  let _selectRoomToken = 0;

  /* ============ API ============ */
  async function api(path, opts = {}) {
    const o = { method: opts.method || 'GET', headers: { 'Content-Type': 'application/json' }, credentials: 'include' };
    if (opts.body) o.body = JSON.stringify(opts.body);
    try {
      const r = await fetch(path, o);
      const d = await r.json().catch(() => ({}));
      return { ok: r.ok && d.ok !== false, data: d };
    } catch (e) { return { ok: false, data: { error: '네트워크 오류' } }; }
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function fmtTime(iso) { if (!iso) return ''; const d = new Date(iso); return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0'); }
  function fmtRel(iso) {
    if (!iso) return '';
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return '방금';
    if (s < 3600) return Math.floor(s/60) + '분 전';
    if (s < 86400) return Math.floor(s/3600) + '시간 전';
    const d = Math.floor(s/86400);
    return d < 7 ? d + '일 전' : (new Date(iso).getMonth()+1) + '/' + new Date(iso).getDate();
  }
  function fmtDate(iso) { if (!iso) return '-'; const d = new Date(iso); return d.getFullYear() + '.' + String(d.getMonth()+1).padStart(2,'0') + '.' + String(d.getDate()).padStart(2,'0'); }
  function toast(msg) { const t = document.getElementById('toast'); if (!t) return; t.textContent = msg; t.classList.add('show'); clearTimeout(window._tt); window._tt = setTimeout(() => t.classList.remove('show'), 2400); }

  /* ★ K-9 v2: ID 정규화 */
  function normalizeId(id) {
    if (id == null) return null;
    return String(id);
  }

  /* ★ K-9 v2: DOM 셀렉터 안전 이스케이프 */
  function safeAttrSelector(value) {
    /* CSS.escape이 있으면 사용, 없으면 직접 처리 */
    if (typeof CSS !== 'undefined' && CSS.escape) {
      return CSS.escape(value);
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  /* ★ K-9 v2: 통합 헬퍼 — 메시지를 안전하게 DOM에 추가 (이중 검증)
     - Set 검증 + DOM 검증으로 중복 방지
     - 이미 있으면 무시, 새로운 것만 렌더
     - 사용처: 초기 로드, 폴링, 송신 모두 동일 */
  function appendMessagesIfNew(area, messages, userMemberId) {
    if (!area || !Array.isArray(messages) || messages.length === 0) return 0;

    const trulyNew = [];

    for (const m of messages) {
      const idStr = normalizeId(m.id);
      if (idStr == null) continue;

      /* 1차: Set 검증 */
      if (_seenMessageIds.has(idStr)) continue;

      /* 2차: DOM 검증 (Set이 깨져도 안전) */
      const selector = '[data-msg-id="' + safeAttrSelector(idStr) + '"]';
      try {
        if (area.querySelector(selector)) {
          /* DOM에는 있는데 Set에는 없음 → Set 보정 */
          _seenMessageIds.add(idStr);
          continue;
        }
      } catch (e) {
        /* 셀렉터 에러 시 안전 폴백 */
      }

      /* 3차: 둘 다 없음 → 추가 대상 */
      _seenMessageIds.add(idStr);
      trulyNew.push(m);
    }

    if (trulyNew.length === 0) return 0;

    area.insertAdjacentHTML('beforeend', renderMessages(trulyNew, userMemberId));
    area.scrollTop = area.scrollHeight;

    /* _lastMsgAt 업데이트 */
    const last = trulyNew[trulyNew.length - 1];
    if (last && last.createdAt) _lastMsgAt = last.createdAt;

    return trulyNew.length;
  }

  /* ============ ★ H-1: 라이트박스 ============ */
  function openLightbox(attId, originalName) {
    const existing = document.querySelector('.lightbox-overlay');
    if (existing) existing.remove();

    const safeName = esc(originalName || '이미지');
    const overlay = document.createElement('div');
    overlay.className = 'lightbox-overlay';
    overlay.innerHTML = `
      <div class="lightbox-controls">
        <button type="button" class="lightbox-btn" data-lb-action="download" title="다운로드 (${safeName})" aria-label="다운로드">💾</button>
        <button type="button" class="lightbox-btn" data-lb-action="close" title="닫기 (ESC)" aria-label="닫기">✕</button>
      </div>
      <img class="lightbox-img" src="/api/chat/image?id=${encodeURIComponent(attId)}" alt="${safeName}" />
    `;

    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    function closeLb() {
      overlay.remove();
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onEsc);
    }
    function onEsc(e) {
      if (e.key === 'Escape') closeLb();
    }

    overlay.addEventListener('click', async (e) => {
      const closeBtn = e.target.closest('[data-lb-action="close"]');
      const dlBtn = e.target.closest('[data-lb-action="download"]');

      if (dlBtn) {
        e.stopPropagation();
        if (dlBtn.classList.contains('is-loading')) return;
        dlBtn.classList.add('is-loading');
        try {
          const res = await fetch('/api/chat/image?id=' + encodeURIComponent(attId) + '&download=1', {
            credentials: 'include',
          });
          if (!res.ok) {
            toast('다운로드 실패');
            return;
          }
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = originalName || 'chat-image-' + attId + '.jpg';
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (err) {
          console.error('[lightbox] download error', err);
          toast('다운로드 중 오류');
        } finally {
          dlBtn.classList.remove('is-loading');
        }
        return;
      }

      if (closeBtn) { closeLb(); return; }
      if (e.target === overlay) closeLb();
    });

    document.addEventListener('keydown', onEsc);
  }

  /* ============ 채팅방 목록 로드 ============ */
  async function loadRoomList() {
    const list = document.getElementById('acRoomList');
    if (!list) return;

    list.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-3);font-size:12.5px">⏳ 로딩 중...</div>';

    const statusFilter = document.getElementById('acFilterStatus')?.value || '';
    const catFilter = document.getElementById('acFilterCat')?.value || '';
    const q = (document.getElementById('acSearchInput')?.value || '').trim();

    let url = '/api/admin/chat/rooms?limit=100';
    if (statusFilter) url += '&status=' + statusFilter;
    if (catFilter) url += '&category=' + catFilter;
    if (q.length >= 2) url += '&q=' + encodeURIComponent(q);

    const res = await api(url);
    if (!res.ok) {
      list.innerHTML = '<div style="text-align:center;padding:30px;color:var(--danger);font-size:13px">조회 실패</div>';
      return;
    }

    const rooms = res.data?.data?.rooms || [];
    const stats = res.data?.data?.stats || {};

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('acKpiActive', (stats.active || 0) + ' 건');
    set('acKpiClosed', (stats.closed || 0) + ' 건');
    set('acKpiArchived', (stats.archived || 0) + ' 건');
    set('acKpiUnread', (stats.totalUnread || 0) + ' 건');

    const badge = document.getElementById('chatNewBadge');
    if (badge) {
      const u = stats.totalUnread || 0;
      if (u > 0) { badge.textContent = u > 99 ? '99+' : String(u); badge.style.display = ''; }
      else badge.style.display = 'none';
    }

    if (rooms.length === 0) {
      list.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-3);font-size:13px">채팅방이 없습니다</div>';
      return;
    }

    list.innerHTML = rooms.map(r => {
      const cat = CAT_LABEL[r.category] || '💬 기타';
      const unread = r.unreadForAdmin > 0 ? `<span style="background:var(--danger);color:#fff;font-size:10px;font-weight:700;min-width:18px;height:18px;line-height:18px;text-align:center;border-radius:10px;padding:0 5px;display:inline-block">${r.unreadForAdmin}</span>` : '';
      const statusLabel =
        r.status === 'closed'   ? '<span style="color:var(--text-3);font-size:10px">🔒 종료</span>' :
        r.status === 'archived' ? '<span style="color:#8a6a00;background:#fff8ec;font-size:10px;padding:1px 6px;border-radius:8px">🗄 보관</span>' :
        '';
      const isActive = _currentRoom && _currentRoom.id === r.id;
      return `
        <div class="ac-room-item${isActive ? ' active' : ''}" data-ac-room="${r.id}" style="padding:12px 14px;border-bottom:1px solid var(--line);cursor:pointer;${isActive ? 'background:#f0f0ff;' : ''}${r.status === 'archived' ? 'opacity:0.7;' : ''}">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">
            <span style="font-size:11.5px;color:var(--text-2)">${cat} ${statusLabel}</span>
            <span style="font-size:10.5px;color:var(--text-3)">${fmtRel(r.lastMessageAt)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
            <div style="flex:1;min-width:0">
              <div style="font-weight:600;font-size:13px;margin-bottom:2px">${esc(r.memberName || '회원 #' + r.memberId)}</div>
              <div style="font-size:12px;color:var(--text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.lastMessagePreview || '')}</div>
            </div>
            ${unread}
          </div>
        </div>`;
    }).join('');
  }

  /* ============ ★ I-3: 상태별 액션 버튼 빌더 ============ */
  function buildActionButtons(room, blacklist, memberName) {
    const safeName = esc(memberName || '회원');
    const status = room.status;
    const buttons = [];

    if (status === 'active') {
      buttons.push(`<button class="btn-sm btn-sm-ghost" data-ac-action="status-change" data-ac-id="${room.id}" data-ac-status="closed" data-ac-confirm="이 채팅방을 종료하시겠습니까?" data-ac-msg="채팅방이 종료되었습니다" style="font-size:11px">🔒 종료</button>`);
    } else if (status === 'closed') {
      buttons.push(`<button class="btn-sm btn-sm-ghost" data-ac-action="status-change" data-ac-id="${room.id}" data-ac-status="archived" data-ac-confirm="이 채팅방을 보관함으로 이동하시겠습니까?\\n(보관함은 일반 목록에서 숨겨집니다)" data-ac-msg="🗄 보관함으로 이동되었습니다" style="font-size:11px;color:#8a6a00">🗄 보관</button>`);
      buttons.push(`<button class="btn-sm btn-sm-ghost" data-ac-action="status-change" data-ac-id="${room.id}" data-ac-status="active" data-ac-confirm="이 채팅방을 다시 활성 상태로 되돌리시겠습니까?" data-ac-msg="🔓 채팅방이 재개되었습니다" style="font-size:11px;color:#1a8b46">🔓 재개</button>`);
    } else if (status === 'archived') {
      buttons.push(`<button class="btn-sm btn-sm-ghost" data-ac-action="status-change" data-ac-id="${room.id}" data-ac-status="closed" data-ac-confirm="이 채팅방을 보관함에서 꺼내시겠습니까?\\n(종료 상태로 되돌립니다)" data-ac-msg="🔓 보관함에서 복구되었습니다" style="font-size:11px;color:#1a5ec4">🔓 복구</button>`);
    }

    if (!blacklist && status !== 'archived') {
      buttons.push(`<button class="btn-sm btn-sm-ghost" data-ac-action="block" data-ac-member="${room.memberId}" data-ac-name="${safeName}" style="font-size:11px;color:var(--danger)">⛔ 블랙</button>`);
    }

    return buttons.join('');
  }

  /* ============ 채팅방 선택 → 대화 로드 ============ */
  async function selectRoom(roomId) {
    /* ★ K-9 v2: 토큰으로 stale 요청 차단 */
    const myToken = ++_selectRoomToken;

    stopPoll();
    _currentRoom = { id: roomId };
    _lastMsgAt = null;
    _seenMessageIds = new Set();

    const detail = document.getElementById('acChatDetail');
    if (!detail) return;
    detail.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-3);font-size:13px">⏳ 로딩 중...</div>';

    const roomRes = await api('/api/admin/chat/rooms?id=' + roomId);
    /* ★ stale 요청 검증 — 다른 방을 클릭했으면 중단 */
    if (myToken !== _selectRoomToken) return;

    if (!roomRes.ok || !roomRes.data?.data) {
      detail.innerHTML = '<div style="text-align:center;padding:60px;color:var(--danger)">조회 실패</div>';
      return;
    }
    const { room, member, summary, blacklist } = roomRes.data.data;
    _currentRoom = room;

    const msgRes = await api('/api/admin/chat/messages?roomId=' + roomId);
    /* ★ stale 요청 재검증 */
    if (myToken !== _selectRoomToken) return;

    const messages = msgRes.data?.data?.messages || [];

    /* ★ K-9 v2: 초기 메시지 ID 미리 등록 (innerHTML 직전에) */
    messages.forEach(m => {
      const idStr = normalizeId(m.id);
      if (idStr) _seenMessageIds.add(idStr);
    });
    if (messages.length > 0) {
      _lastMsgAt = messages[messages.length - 1].createdAt;
    }

    const cat = CAT_LABEL[room.category] || '💬 기타';
    const isActive = room.status === 'active';
    const isArchived = room.status === 'archived';

    const statusBadgeHtml =
      room.status === 'active'   ? '' :
      room.status === 'closed'   ? '<span style="display:inline-block;background:#f0f0f0;color:#525252;font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px;margin-left:8px">🔒 종료됨</span>' :
      room.status === 'archived' ? '<span style="display:inline-block;background:#fff8ec;color:#8a6a00;font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px;margin-left:8px">🗄 보관함</span>' :
      '';

    const archivedBannerHtml = isArchived
      ? '<div style="margin:0 0 0;padding:10px 16px;background:#fff8ec;border-bottom:1px solid #f0e3c4;font-size:12px;color:#8a6a00;line-height:1.5">📦 이 채팅방은 보관함에 있습니다. 메시지 전송이 불가능하며, "🔓 복구" 버튼으로 종료 상태로 되돌릴 수 있습니다.</div>'
      : '';

    const actionBtnsHtml = buildActionButtons(room, blacklist, member?.name);

    detail.innerHTML = `
      <div style="padding:14px 18px;border-bottom:1px solid var(--line);background:#fafafa">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap">
          <div>
            <span style="font-size:12px;color:var(--text-2)">${cat}${statusBadgeHtml}</span>
            <div style="font-weight:700;font-size:15px;margin:4px 0">${esc(member?.name || '회원')} <span style="font-weight:400;color:var(--text-3);font-size:12px">${esc(member?.email || '')}</span></div>
            <div style="font-size:11.5px;color:var(--text-3)">가입 ${fmtDate(member?.createdAt)} · 후원 ₩${(summary?.donationTotal || 0).toLocaleString()} (${summary?.donationCount || 0}건) · 지원 ${summary?.supportCount || 0}건</div>
            ${blacklist ? '<div style="margin-top:4px;font-size:12px;color:#a01e2c">⚠️ 블랙리스트: ' + esc(blacklist.reason) + '</div>' : ''}
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap">
            ${actionBtnsHtml}
          </div>
        </div>
        <div style="margin-top:8px">
          <input type="text" id="acMemoInput" value="${esc(room.adminMemo || '')}" placeholder="관리자 메모 (Enter로 저장)" style="width:100%;font-size:12px;padding:6px 10px;border:1px solid var(--line);border-radius:5px;background:#fff" data-room-id="${room.id}">
        </div>
      </div>

      ${archivedBannerHtml}

      <div id="acMsgArea" style="flex:1;overflow-y:auto;padding:16px;background:#f5f6f8;min-width:0;word-wrap:break-word">
        ${messages.length === 0
          ? '<div style="text-align:center;color:var(--text-3);padding:30px;font-size:12.5px">대화가 아직 없습니다</div>'
          : renderMessages(messages, room.memberId)}
      </div>

      ${isActive ? `
      <div style="padding:12px 16px;border-top:1px solid var(--line);display:flex;gap:10px;align-items:flex-end;background:#fff">
        <textarea id="acMsgInput" rows="1" placeholder="관리자 메시지 입력 (Enter: 전송)" style="flex:1;border:1px solid var(--line);border-radius:18px;padding:10px 16px;font-size:13px;resize:none;font-family:inherit;max-height:100px"></textarea>
        <button id="acMsgSendBtn" style="background:var(--brand);color:#fff;border:none;border-radius:50%;width:38px;height:38px;cursor:pointer;font-size:16px;flex-shrink:0">➤</button>
      </div>` : (isArchived
        ? '<div style="padding:14px;text-align:center;color:#8a6a00;font-size:13px;background:#fff8ec;border-top:1px solid #f0e3c4">🗄 보관된 채팅방입니다</div>'
        : '<div style="padding:14px;text-align:center;color:var(--text-3);font-size:13px;background:#f8f8f8;border-top:1px solid var(--line)">종료된 채팅방입니다</div>')}
    `;

    const area = document.getElementById('acMsgArea');
    if (area) area.scrollTop = area.scrollHeight;

    api('/api/admin/chat/messages', { method: 'PATCH', body: { roomId } });

    document.querySelectorAll('.ac-room-item').forEach(el => {
      el.style.background = Number(el.dataset.acRoom) === roomId ? '#f0f0ff' : '';
      el.classList.toggle('active', Number(el.dataset.acRoom) === roomId);
    });

    if (isActive) startPoll(roomId, myToken);
  }

  /* ============ 메시지 본문 빌드 (세로 표시 차단 유지) ============ */
  function buildMsgBody(m, isUser) {
    const att = m.attachment;

    const bubbleBaseStyle =
      'display:inline-block;' +
      'padding:10px 14px;' +
      'font-size:13px;' +
      'line-height:1.55;' +
      'word-break:keep-all;' +
      'overflow-wrap:anywhere;' +
      'white-space:pre-wrap;' +
      'writing-mode:horizontal-tb;' +
      'text-orientation:mixed;' +
      'text-align:left;' +
      'max-width:100%;' +
      'box-sizing:border-box;';

    const userColor = 'background:#fff;color:inherit;border:1px solid var(--line);';
    const adminColor = 'background:var(--brand);color:#fff;';

    if (att && att.id) {
      const safeName = esc(att.originalName || '이미지');
      const imgTag =
        `<img class="chat-msg-image" src="/api/chat/image?id=${att.id}" alt="${safeName}" ` +
        `data-att-id="${att.id}" data-att-name="${safeName}" loading="lazy" ` +
        `style="max-width:240px;max-height:240px;border-radius:10px;cursor:zoom-in;display:block;background:#eee" />`;

      const text = (m.content || '').trim();
      const textHtml = text && !text.startsWith('[이미지]')
        ? `<div style="${bubbleBaseStyle}border-radius:14px;${isUser ? userColor : adminColor}margin-bottom:6px">${esc(text).replace(/\n/g, '<br />')}</div>`
        : '';

      return textHtml + imgTag;
    }

    const radius = isUser ? '14px 14px 14px 4px' : '14px 14px 4px 14px';
    return `<div style="${bubbleBaseStyle}border-radius:${radius};${isUser ? userColor : adminColor}">${esc(m.content || '').replace(/\n/g, '<br />')}</div>`;
  }

  /* ============ 메시지 렌더 (data-msg-id 필수) ============ */
  function renderMessages(messages, userMemberId) {
    return messages.map(m => {
      const msgId = normalizeId(m.id) || '';
      const safeId = esc(msgId);

      if (m.isSystem || m.senderRole === 'system' || m.messageType === 'system_notice') {
        return `<div data-msg-id="${safeId}" style="text-align:center;margin:8px 0"><span style="background:#fff8ec;color:#8a6a00;border:1px solid #f0e3c4;font-size:12px;padding:4px 12px;border-radius:12px;display:inline-block">📢 ${esc(m.content || '')}</span></div>`;
      }
      const isUser = m.senderId === userMemberId;
      const time = fmtTime(m.createdAt);
      const body = buildMsgBody(m, isUser);

      if (isUser) {
        return `<div data-msg-id="${safeId}" style="display:flex;margin-bottom:10px;align-items:flex-end;gap:6px;justify-content:flex-start;width:100%">
          <div style="max-width:65%;min-width:0;display:flex;flex-direction:column">${body}</div>
          <span style="font-size:10px;color:var(--text-3);flex-shrink:0;white-space:nowrap">${time}</span>
        </div>`;
      }
      return `<div data-msg-id="${safeId}" style="display:flex;justify-content:flex-end;margin-bottom:10px;align-items:flex-end;gap:6px;width:100%">
        <span style="font-size:10px;color:var(--text-3);flex-shrink:0;white-space:nowrap">${time}</span>
        <div style="max-width:65%;min-width:0;display:flex;flex-direction:column">${body}</div>
      </div>`;
    }).join('');
  }

  /* ============ 이미지 클릭 → 라이트박스 ============ */
  function setupImageClick() {
    document.addEventListener('click', (e) => {
      const img = e.target.closest('.chat-msg-image');
      if (!img) return;
      const attId = img.dataset.attId;
      const name = img.dataset.attName;
      if (attId) openLightbox(attId, name);
    });
  }

  /* ============ 관리자 메시지 전송 ============ */
  function setupAdminSend() {
    document.addEventListener('click', async (e) => {
      if (!e.target.closest('#acMsgSendBtn')) return;
      await doAdminSend();
    });
    document.addEventListener('keydown', (e) => {
      if (e.target.id !== 'acMsgInput') return;
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doAdminSend(); }
    });
    document.addEventListener('input', (e) => {
      if (e.target.id !== 'acMsgInput') return;
      e.target.style.height = 'auto';
      e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px';
    });
  }

  async function doAdminSend() {
    const input = document.getElementById('acMsgInput');
    if (!input || !_currentRoom?.id) return;
    const text = (input.value || '').trim();
    if (!text) return;

    const btn = document.getElementById('acMsgSendBtn');
    if (btn) btn.disabled = true;

    const res = await api('/api/admin/chat/messages', {
      method: 'POST',
      body: { roomId: _currentRoom.id, content: text, messageType: 'text' },
    });

    if (btn) btn.disabled = false;

    if (res.ok && res.data?.data?.message) {
      input.value = '';
      input.style.height = 'auto';
      const area = document.getElementById('acMsgArea');
      if (area) {
        const msg = res.data.data.message;
        /* ★ K-9 v2: 통합 헬퍼로 안전 추가 */
        appendMessagesIfNew(area, [msg], _currentRoom.memberId);
      }
    } else {
      toast(res.data?.error || '전송 실패');
    }
    input.focus();
  }

  /* ============ 메모 저장 ============ */
  function setupMemo() {
    document.addEventListener('keydown', async (e) => {
      if (e.target.id !== 'acMemoInput' || e.key !== 'Enter') return;
      e.preventDefault();
      const roomId = Number(e.target.dataset.roomId);
      const memo = e.target.value;
      const res = await api('/api/admin/chat/rooms', { method: 'PATCH', body: { id: roomId, adminMemo: memo } });
      if (res.ok) toast('메모가 저장되었습니다');
      else toast('메모 저장 실패');
    });
  }

  /* ============ ★ I-3: 통합 액션 ============ */
  function setupActions() {
    document.addEventListener('click', async (e) => {
      const statusBtn = e.target.closest('[data-ac-action="status-change"]');
      if (statusBtn) {
        e.preventDefault();
        const id = Number(statusBtn.dataset.acId);
        const newStatus = statusBtn.dataset.acStatus;
        const confirmMsg = (statusBtn.dataset.acConfirm || '').replace(/\\n/g, '\n');
        const successMsg = statusBtn.dataset.acMsg || '상태가 변경되었습니다';

        if (confirmMsg && !confirm(confirmMsg)) return;

        const res = await api('/api/admin/chat/rooms', {
          method: 'PATCH',
          body: { id, status: newStatus },
        });

        if (res.ok) {
          toast(successMsg);
          loadRoomList();
          selectRoom(id);
        } else {
          toast(res.data?.error || '변경 실패');
        }
        return;
      }

      const blockBtn = e.target.closest('[data-ac-action="block"]');
      if (blockBtn) {
        e.preventDefault();
        const memberId = Number(blockBtn.dataset.acMember);
        const name = blockBtn.dataset.acName;
        const reason = prompt(`${name}님을 채팅 블랙리스트에 등록합니다.\n차단 사유를 입력하세요:`);
        if (!reason || reason.trim().length < 2) return;
        const res = await api('/api/admin/chat/rooms?action=blacklist', { method: 'POST', body: { memberId, reason: reason.trim() } });
        if (res.ok) { toast(res.data?.message || '블랙리스트 등록 완료'); loadRoomList(); if (_currentRoom) selectRoom(_currentRoom.id); }
        else toast(res.data?.error || '블랙 등록 실패');
        return;
      }

      const roomItem = e.target.closest('.ac-room-item');
      if (roomItem) {
        const id = Number(roomItem.dataset.acRoom);
        if (id) selectRoom(id);
      }
    });
  }

  /* ============ 필터 / 검색 ============ */
  function setupFilters() {
    let searchTimer = null;
    document.addEventListener('change', (e) => {
      if (e.target.id === 'acFilterStatus' || e.target.id === 'acFilterCat') loadRoomList();
    });
    document.addEventListener('input', (e) => {
      if (e.target.id !== 'acSearchInput') return;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => loadRoomList(), 300);
    });
  }

  /* ============ ★ K-9 v2: 폴링 (토큰 + DOM 검증) ============ */
  function startPoll(roomId, ownerToken) {
    stopPoll();
    _pollTimer = setInterval(async () => {
      /* ★ stale 토큰 검사 — selectRoom이 새로 호출되면 즉시 중단 */
      if (ownerToken !== undefined && ownerToken !== _selectRoomToken) {
        stopPoll();
        return;
      }
      if (!_currentRoom || _currentRoom.id !== roomId) return;

      const url = '/api/admin/chat/messages?roomId=' + roomId + (_lastMsgAt ? '&since=' + encodeURIComponent(_lastMsgAt) : '');
      const res = await api(url);

      /* 응답 도착 후에도 토큰 재검사 */
      if (ownerToken !== undefined && ownerToken !== _selectRoomToken) return;
      if (!_currentRoom || _currentRoom.id !== roomId) return;

      const msgs = res.data?.data?.messages || [];

      const area = document.getElementById('acMsgArea');
      if (area && msgs.length > 0) {
        /* ★ 통합 헬퍼로 안전 추가 (Set + DOM 이중 검증) */
        appendMessagesIfNew(area, msgs, _currentRoom.memberId);
      }

      api('/api/admin/chat/messages', { method: 'PATCH', body: { roomId } });
    }, POLL_INTERVAL);
  }

  function stopPoll() {
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  }

  /* ============ 외부 노출 ============ */
  window.SIREN_ADMIN_CHAT = {
    loadRoomList,
    selectRoom,
    stopPoll,
    openLightbox,
  };

  /* ============ 초기화 ============ */
  let _initialized = false;
  function init() {
    if (_initialized) return;
    _initialized = true;

    setupAdminSend();
    setupMemo();
    setupActions();
    setupFilters();
    setupImageClick();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();