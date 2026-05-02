/* =========================================================
   SIREN — admin-chat.js (STEP G-4 + H-1 + I-1 중복 렌더 픽스)
   관리자측 채팅 관리 (좌우 분할 레이아웃)
   ★ H-1: 이미지 인라인 표시 + 라이트박스 + 다운로드
   ★ I-1: 마지막 메시지 5초마다 반복 렌더되는 버그 수정 (_renderedMsgIds 추가)
   ========================================================= */
(function () {
  'use strict';

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
  let _renderedMsgIds = new Set();  /* ★ I-1: 중복 렌더 방지 */

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

  /* ============ ★ I-1: 메시지 중복 방지 + 일괄 렌더 헬퍼 ============ */
  /**
   * 새 메시지만 필터해서 _renderedMsgIds에 등록한 후
   * 메시지 영역(#acMsgArea)에 추가합니다.
   *
   * @param {Array} msgs — 메시지 배열
   * @returns {boolean} — 1개 이상 새로 렌더됐으면 true
   */
  function appendNewMessages(msgs) {
    if (!Array.isArray(msgs) || msgs.length === 0) return false;
    if (!_currentRoom) return false;

    /* 이미 렌더된 ID 제외 */
    const newMsgs = msgs.filter((m) => m && m.id && !_renderedMsgIds.has(m.id));
    if (newMsgs.length === 0) return false;

    /* ID 등록 */
    for (const m of newMsgs) _renderedMsgIds.add(m.id);

    /* 마지막 createdAt 갱신 */
    const last = newMsgs[newMsgs.length - 1];
    if (last && last.createdAt) _lastMsgAt = last.createdAt;

    /* 영역에 삽입 */
    const area = document.getElementById('acMsgArea');
    if (area) {
      area.insertAdjacentHTML('beforeend', renderMessages(newMsgs, _currentRoom.memberId));
      area.scrollTop = area.scrollHeight;
    }
    return true;
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
      const statusLabel = r.status === 'closed' ? '<span style="color:var(--text-3);font-size:10px">종료</span>' : r.status === 'archived' ? '<span style="color:var(--text-3);font-size:10px">보관</span>' : '';
      const isActive = _currentRoom && _currentRoom.id === r.id;
      return `
        <div class="ac-room-item${isActive ? ' active' : ''}" data-ac-room="${r.id}" style="padding:12px 14px;border-bottom:1px solid var(--line);cursor:pointer;${isActive ? 'background:#f0f0ff;' : ''}">
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

  /* ============ 채팅방 선택 → 대화 로드 ============ */
  async function selectRoom(roomId) {
    stopPoll();
    _currentRoom = { id: roomId };
    _lastMsgAt = null;
    _renderedMsgIds.clear();  /* ★ I-1: 새 방 진입 시 초기화 */

    const detail = document.getElementById('acChatDetail');
    if (!detail) return;
    detail.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-3);font-size:13px">⏳ 로딩 중...</div>';

    const roomRes = await api('/api/admin/chat/rooms?id=' + roomId);
    if (!roomRes.ok || !roomRes.data?.data) {
      detail.innerHTML = '<div style="text-align:center;padding:60px;color:var(--danger)">조회 실패</div>';
      return;
    }
    const { room, member, summary, blacklist } = roomRes.data.data;
    _currentRoom = room;

    const msgRes = await api('/api/admin/chat/messages?roomId=' + roomId);
    const messages = msgRes.data?.data?.messages || [];

    const cat = CAT_LABEL[room.category] || '💬 기타';
    const isActive = room.status === 'active';

    detail.innerHTML = `
      <div style="padding:14px 18px;border-bottom:1px solid var(--line);background:#fafafa">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap">
          <div>
            <span style="font-size:12px;color:var(--text-2)">${cat}</span>
            <div style="font-weight:700;font-size:15px;margin:4px 0">${esc(member?.name || '회원')} <span style="font-weight:400;color:var(--text-3);font-size:12px">${esc(member?.email || '')}</span></div>
            <div style="font-size:11.5px;color:var(--text-3)">가입 ${fmtDate(member?.createdAt)} · 후원 ₩${(summary?.donationTotal || 0).toLocaleString()} (${summary?.donationCount || 0}건) · 지원 ${summary?.supportCount || 0}건</div>
            ${blacklist ? '<div style="margin-top:4px;font-size:12px;color:#a01e2c">⚠️ 블랙리스트: ' + esc(blacklist.reason) + '</div>' : ''}
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0">
            ${isActive ? `<button class="btn-sm btn-sm-ghost" data-ac-action="close" data-ac-id="${room.id}" style="font-size:11px">🔒 종료</button>` : ''}
            ${!blacklist ? `<button class="btn-sm btn-sm-ghost" data-ac-action="block" data-ac-member="${room.memberId}" data-ac-name="${esc(member?.name)}" style="font-size:11px;color:var(--danger)">⛔ 블랙</button>` : ''}
          </div>
        </div>
        <div style="margin-top:8px">
          <input type="text" id="acMemoInput" value="${esc(room.adminMemo || '')}" placeholder="관리자 메모 (Enter로 저장)" style="width:100%;font-size:12px;padding:6px 10px;border:1px solid var(--line);border-radius:5px;background:#fff" data-room-id="${room.id}">
        </div>
      </div>

      <div id="acMsgArea" style="flex:1;overflow-y:auto;padding:16px;background:#f5f6f8">
        ${messages.length === 0
          ? '<div style="text-align:center;color:var(--text-3);padding:30px;font-size:12.5px">대화가 아직 없습니다</div>'
          : ''}
      </div>

      ${isActive ? `
      <div style="padding:12px 16px;border-top:1px solid var(--line);display:flex;gap:10px;align-items:flex-end;background:#fff">
        <textarea id="acMsgInput" rows="1" placeholder="관리자 메시지 입력 (Enter: 전송)" style="flex:1;border:1px solid var(--line);border-radius:18px;padding:10px 16px;font-size:13px;resize:none;font-family:inherit;max-height:100px"></textarea>
        <button id="acMsgSendBtn" style="background:var(--brand);color:#fff;border:none;border-radius:50%;width:38px;height:38px;cursor:pointer;font-size:16px;flex-shrink:0">➤</button>
      </div>` : '<div style="padding:14px;text-align:center;color:var(--text-3);font-size:13px;background:#f8f8f8;border-top:1px solid var(--line)">종료된 채팅방입니다</div>'}
    `;

    /* ★ I-1: 초기 메시지 렌더 시에도 _renderedMsgIds에 등록 */
    if (messages.length > 0) {
      appendNewMessages(messages);
    }

    /* 읽음 처리 */
    api('/api/admin/chat/messages', { method: 'PATCH', body: { roomId } });

    document.querySelectorAll('.ac-room-item').forEach(el => {
      el.style.background = Number(el.dataset.acRoom) === roomId ? '#f0f0ff' : '';
      el.classList.toggle('active', Number(el.dataset.acRoom) === roomId);
    });

    if (isActive) startPoll(roomId);
  }

  /* ============ ★ H-1: 메시지 본문 빌드 (텍스트 + 이미지) ============ */
  function buildMsgBody(m, isUser) {
    const att = m.attachment;

    if (att && att.id) {
      const safeName = esc(att.originalName || '이미지');
      const imgTag =
        `<img class="chat-msg-image" src="/api/chat/image?id=${att.id}" alt="${safeName}" ` +
        `data-att-id="${att.id}" data-att-name="${safeName}" loading="lazy" ` +
        `style="max-width:240px;max-height:240px;border-radius:10px;cursor:zoom-in;display:block;background:#eee" />`;

      const text = (m.content || '').trim();
      const textHtml = text && !text.startsWith('[이미지]')
        ? `<div style="padding:10px 14px;border-radius:14px;background:${isUser ? '#fff' : 'var(--brand)'};color:${isUser ? 'inherit' : '#fff'};font-size:13px;line-height:1.55;${isUser ? 'border:1px solid var(--line);' : ''}margin-bottom:6px">${esc(text).replace(/\n/g, '<br />')}</div>`
        : '';

      return textHtml + imgTag;
    }

    /* 일반 텍스트 */
    return `<div style="max-width:65%;padding:10px 14px;border-radius:${isUser ? '14px 14px 14px 4px' : '14px 14px 4px 14px'};background:${isUser ? '#fff' : 'var(--brand)'};color:${isUser ? 'inherit' : '#fff'};${isUser ? 'border:1px solid var(--line);' : ''}font-size:13px;line-height:1.55">${esc(m.content || '').replace(/\n/g, '<br />')}</div>`;
  }

  /* ============ 메시지 렌더 ============ */
  function renderMessages(messages, userMemberId) {
    return messages.map(m => {
      if (m.isSystem || m.senderRole === 'system' || m.messageType === 'system_notice') {
        return `<div style="text-align:center;margin:8px 0"><span style="background:#fff8ec;color:#8a6a00;border:1px solid #f0e3c4;font-size:12px;padding:4px 12px;border-radius:12px;display:inline-block">📢 ${esc(m.content || '')}</span></div>`;
      }
      const isUser = m.senderId === userMemberId;
      const time = fmtTime(m.createdAt);
      const body = buildMsgBody(m, isUser);

      if (isUser) {
        return `<div style="display:flex;margin-bottom:10px;align-items:flex-end;gap:6px">
          <div style="max-width:65%">${body}</div>
          <span style="font-size:10px;color:var(--text-3)">${time}</span>
        </div>`;
      }
      return `<div style="display:flex;justify-content:flex-end;margin-bottom:10px;align-items:flex-end;gap:6px">
        <span style="font-size:10px;color:var(--text-3)">${time}</span>
        <div style="max-width:65%">${body}</div>
      </div>`;
    }).join('');
  }

  /* ============ ★ H-1: 이미지 클릭 → 라이트박스 ============ */
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
      /* ★ I-1: appendNewMessages 사용 (중복 방지) */
      appendNewMessages([res.data.data.message]);
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

  /* ============ 종료 / 블랙 ============ */
  function setupActions() {
    document.addEventListener('click', async (e) => {
      const closeBtn = e.target.closest('[data-ac-action="close"]');
      if (closeBtn) {
        const id = Number(closeBtn.dataset.acId);
        if (!confirm('이 채팅방을 종료하시겠습니까?')) return;
        const res = await api('/api/admin/chat/rooms', { method: 'PATCH', body: { id, status: 'closed' } });
        if (res.ok) { toast('채팅방이 종료되었습니다'); loadRoomList(); selectRoom(id); }
        else toast(res.data?.error || '종료 실패');
        return;
      }

      const blockBtn = e.target.closest('[data-ac-action="block"]');
      if (blockBtn) {
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

  /* ============ 폴링 ============ */
  function startPoll(roomId) {
    stopPoll();
    _pollTimer = setInterval(async () => {
      if (!_currentRoom || _currentRoom.id !== roomId) return;
      const url = '/api/admin/chat/messages?roomId=' + roomId + (_lastMsgAt ? '&since=' + encodeURIComponent(_lastMsgAt) : '');
      const res = await api(url);
      const msgs = res.data?.data?.messages || [];
      /* ★ I-1: appendNewMessages가 중복을 자동 필터 */
      appendNewMessages(msgs);
      api('/api/admin/chat/messages', { method: 'PATCH', body: { roomId } });
    }, POLL_INTERVAL);
  }

  function stopPoll() {
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
    /* ★ I-1: 폴링 중단 시 ID 추적도 초기화 (다음 방 진입 대비) */
    _renderedMsgIds.clear();
  }

  /* ============ 외부 노출 ============ */
  window.SIREN_ADMIN_CHAT = {
    loadRoomList,
    selectRoom,
    stopPoll,
    openLightbox,
  };

  /* ============ 초기화 ============ */
  function init() {
    setupAdminSend();
    setupMemo();
    setupActions();
    setupFilters();
    setupImageClick(); // ★ H-1
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();