/* =========================================================
   SIREN — chat-user.js (STEP G-3)
   사용자측 1:1 채팅 (마이페이지 내 모달)
   ========================================================= */
(function () {
  'use strict';

  const POLL_INTERVAL = 5000; // 5초
  const CATEGORY_LABEL = {
    support_donation: { emoji: '💝', label: '후원 문의', cls: 'cat-donation' },
    support_homepage: { emoji: '🌐', label: '홈페이지', cls: 'cat-homepage' },
    support_signup:   { emoji: '📝', label: '가입 절차', cls: 'cat-signup' },
    support_other:    { emoji: '💬', label: '기타',     cls: 'cat-other' },
  };

  let _currentRoom = null;
  let _pollTimer = null;
  let _lastMessageAt = null;
  let _renderedMsgIds = new Set(); // ★ 중복 방지
  let _isBlacklisted = null;

  /* ============ API ============ */
  async function api(path, options = {}) {
    const opts = {
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    };
    if (options.body) opts.body = JSON.stringify(options.body);
    try {
      const res = await fetch(path, opts);
      const data = await res.json().catch(() => ({}));
      return { status: res.status, ok: res.ok && data.ok !== false, data };
    } catch (e) {
      console.error('[Chat API]', path, e);
      return { status: 0, ok: false, data: { error: '네트워크 오류' } };
    }
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  function formatTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function formatRelative(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const now = Date.now();
    const diff = (now - d.getTime()) / 1000;
    if (diff < 60) return '방금';
    if (diff < 3600) return Math.floor(diff / 60) + '분 전';
    if (diff < 86400) return Math.floor(diff / 3600) + '시간 전';
    const day = Math.floor(diff / 86400);
    if (day < 7) return day + '일 전';
    return (d.getMonth() + 1) + '/' + d.getDate();
  }

  /* ============ 채팅방 목록 로드 ============ */
  async function loadRooms() {
    const container = document.getElementById('chatRoomsList');
    if (!container) return;

    container.innerHTML = '<div style="text-align:center;color:var(--text-3);padding:40px;font-size:13px">⏳ 로딩 중...</div>';

    const res = await api('/api/chat/mine');
    if (!res.ok) {
      container.innerHTML = '<div style="text-align:center;color:var(--danger);padding:40px;font-size:13px">조회 실패</div>';
      return;
    }

    const rooms = res.data?.data?.rooms || [];
    _isBlacklisted = res.data?.data?.blacklisted || null;

    /* 블랙리스트 안내 */
    let blackBanner = '';
    if (_isBlacklisted) {
      blackBanner = `
        <div style="background:#fdecec;border:1px solid #f5b5bb;border-radius:8px;padding:14px 18px;margin-bottom:14px">
          <div style="font-weight:700;color:#a01e2c;font-size:13.5px;margin-bottom:4px">⚠️ 채팅 이용이 제한된 상태입니다</div>
          <div style="font-size:12.5px;color:var(--text-2);line-height:1.6">사유: ${escapeHtml(_isBlacklisted.reason)}</div>
        </div>`;
    }

    if (rooms.length === 0) {
      container.innerHTML = blackBanner +
        '<div style="text-align:center;color:var(--text-3);padding:40px;font-size:13px;background:var(--bg-soft);border-radius:8px">' +
        '아직 진행 중인 상담이 없습니다.<br /><span style="font-size:12px">상단의 "+ 새 상담 시작" 버튼을 클릭하여 문의해 주세요.</span>' +
        '</div>';
      return;
    }

    const html = rooms.map((r) => {
      const cat = CATEGORY_LABEL[r.category] || CATEGORY_LABEL.support_other;
      const isClosed = r.status !== 'active';
      const unreadBadge = r.unreadForUser > 0
        ? `<span class="unread-dot">${r.unreadForUser}</span>`
        : '';
      const statusBadge = isClosed
        ? `<span style="font-size:11px;color:var(--text-3)">${r.status === 'closed' ? '종료' : '보관'}</span>`
        : '';

      return `
        <div class="chat-room-card ${isClosed ? 'closed' : ''}" data-room-id="${r.id}" data-status="${r.status}">
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
              <span class="cat-badge ${cat.cls}">${cat.emoji} ${cat.label}</span>
              ${statusBadge}
            </div>
            <div style="font-weight:600;font-size:13.5px;margin-bottom:3px">${escapeHtml(r.title || '상담')}</div>
            <div style="font-size:12px;color:var(--text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%">
              ${escapeHtml(r.lastMessagePreview || '대화 없음')}
            </div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="font-size:11px;color:var(--text-3);margin-bottom:4px">${formatRelative(r.lastMessageAt)}</div>
            ${unreadBadge}
          </div>
        </div>`;
    }).join('');

    container.innerHTML = blackBanner + html;
  }

  /* ============ 채팅방 카드 클릭 → 채팅 창 열기 ============ */
  function setupRoomClick() {
    document.addEventListener('click', (e) => {
      const card = e.target.closest('.chat-room-card');
      if (!card) return;
      if (card.dataset.status !== 'active') {
        SIREN.toast('종료된 채팅방입니다');
        return;
      }
      const roomId = Number(card.dataset.roomId);
      if (roomId) openChatWindow(roomId);
    });
  }

  /* ============ "+ 새 상담 시작" 버튼 ============ */
  function setupNewChatBtn() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('#btnNewChat');
      if (!btn) return;
      e.preventDefault();

      if (_isBlacklisted) {
        return SIREN.toast('채팅 이용이 제한된 상태입니다');
      }

      const modal = document.getElementById('chatCategoryModal');
      if (modal) modal.classList.add('show');
    });

    /* 카테고리 선택 → 채팅방 생성 */
    document.addEventListener('click', async (e) => {
      const catBtn = e.target.closest('.chat-cat-btn[data-cat]');
      if (!catBtn) return;
      e.preventDefault();

      const category = catBtn.dataset.cat;
      catBtn.disabled = true;
      catBtn.style.opacity = '0.6';

      const res = await api('/api/chat/mine', {
        method: 'POST',
        body: { category },
      });

      catBtn.disabled = false;
      catBtn.style.opacity = '1';

      if (res.ok && res.data?.data?.room) {
        document.getElementById('chatCategoryModal')?.classList.remove('show');
        SIREN.toast(res.data.data.isNew ? '새 상담이 시작되었습니다' : '기존 상담으로 입장합니다');
        await loadRooms();
        openChatWindow(res.data.data.room.id);
      } else {
        SIREN.toast(res.data?.error || '채팅방 생성 실패');
      }
    });
  }

  /* ============ 모달 닫기 ============ */
  function setupModalClose() {
    document.addEventListener('click', (e) => {
      const closeBtn = e.target.closest('[data-chat-close]');
      if (closeBtn) {
        const modal = closeBtn.closest('#chatCategoryModal, #chatWindowModal');
        if (modal) {
          modal.classList.remove('show');
          if (modal.id === 'chatWindowModal') stopChatWindow();
        }
        return;
      }
      /* 배경 클릭 */
      if (e.target.id === 'chatCategoryModal') {
        e.target.classList.remove('show');
      }
      if (e.target.id === 'chatWindowModal') {
        e.target.classList.remove('show');
        stopChatWindow();
      }
    });

    /* ESC 닫기 */
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      ['chatCategoryModal', 'chatWindowModal'].forEach((id) => {
        const m = document.getElementById(id);
        if (m && m.classList.contains('show')) {
          m.classList.remove('show');
          if (id === 'chatWindowModal') stopChatWindow();
        }
      });
    });
  }

  /* ============ 채팅 창 열기 ============ */
  async function openChatWindow(roomId) {
    const modal = document.getElementById('chatWindowModal');
    if (!modal) return;

    _currentRoom = { id: roomId };
    _lastMessageAt = null;

    const titleEl = document.getElementById('chatWinTitle');
    const statusEl = document.getElementById('chatWinStatus');
    const msgsEl = document.getElementById('chatMessages');
    const inputEl = document.getElementById('chatInputText');

    if (titleEl) titleEl.textContent = '상담 채팅';
    if (statusEl) statusEl.textContent = '연결 중...';
    if (msgsEl) msgsEl.innerHTML = '<div style="text-align:center;color:var(--text-3);padding:30px;font-size:12.5px">로딩 중...</div>';
    if (inputEl) inputEl.value = '';

    modal.classList.add('show');

    /* 첫 로드 + 폴링 시작 */
    await fetchMessages(roomId, true);
    /* 읽음 처리 */
    api('/api/chat/messages', { method: 'PATCH', body: { roomId } });

    startPolling(roomId);

    setTimeout(() => inputEl?.focus(), 200);
  }

  /* ============ 메시지 조회 ============ */
  async function fetchMessages(roomId, isInitial) {
    const url = '/api/chat/messages?roomId=' + roomId + (_lastMessageAt && !isInitial ? '&since=' + encodeURIComponent(_lastMessageAt) : '');
    const res = await api(url);
    if (!res.ok) {
      if (isInitial) {
        const msgsEl = document.getElementById('chatMessages');
        if (msgsEl) msgsEl.innerHTML = '<div style="text-align:center;color:var(--danger);padding:30px;font-size:12.5px">조회 실패</div>';
      }
      return;
    }

    const messages = res.data?.data?.messages || [];
    const room = res.data?.data?.room;

    /* 헤더 정보 갱신 */
    if (room) {
      _currentRoom = room;
      const cat = CATEGORY_LABEL[room.category] || CATEGORY_LABEL.support_other;
      const titleEl = document.getElementById('chatWinTitle');
      const statusEl = document.getElementById('chatWinStatus');
      if (titleEl) titleEl.textContent = (room.title || cat.label);
      if (statusEl) {
        if (room.status === 'active') {
          statusEl.textContent = `${cat.emoji} ${cat.label} · 진행 중`;
        } else {
          statusEl.textContent = `${cat.emoji} ${cat.label} · 종료됨`;
          /* 입력창 비활성화 */
          const inputEl = document.getElementById('chatInputText');
          const sendBtn = document.getElementById('chatSendBtn');
          if (inputEl) { inputEl.disabled = true; inputEl.placeholder = '종료된 상담입니다'; }
          if (sendBtn) sendBtn.disabled = true;
        }
      }
    }

    if (messages.length === 0 && isInitial) {
      const msgsEl = document.getElementById('chatMessages');
      if (msgsEl) msgsEl.innerHTML = '<div style="text-align:center;color:var(--text-3);padding:30px;font-size:12.5px">대화를 시작해 보세요 💬</div>';
      return;
    }

    if (messages.length > 0) {
      _lastMessageAt = messages[messages.length - 1].createdAt;
      appendMessages(messages, isInitial);
    }
  }

  /* ============ 메시지 렌더 ============ */
  function appendMessages(messages, replace) {
    const msgsEl = document.getElementById('chatMessages');
    if (!msgsEl) return;
    if (replace) {
      msgsEl.innerHTML = '';
      _renderedMsgIds.clear();
    }

    const myUid = window.SIREN_AUTH?.user?.id;

    /* 이미 렌더된 메시지 제외 */
    const newMessages = messages.filter((m) => !_renderedMsgIds.has(m.id));
    if (newMessages.length === 0) return;

    const html = newMessages.map((m) => {
      _renderedMsgIds.add(m.id);

      if (m.isSystem || m.senderRole === 'system' || m.messageType === 'system_notice') {
        return `<div class="msg-row system"><div class="msg-bubble">📢 ${escapeHtml(m.content || '')}</div></div>`;
      }
      const isMine = m.senderId === myUid;
      const time = formatTime(m.createdAt);
      const bubble = `<div class="msg-bubble">${escapeHtml(m.content || '').replace(/\n/g, '<br />')}</div>`;
      const meta = `<span class="msg-meta">${time}</span>`;
      return isMine
        ? `<div class="msg-row mine">${meta}${bubble}</div>`
        : `<div class="msg-row theirs">${bubble}${meta}</div>`;
    }).join('');

    if (html) {
      msgsEl.insertAdjacentHTML('beforeend', html);
      msgsEl.scrollTop = msgsEl.scrollHeight;
    }
  }
  /* ============ 이미지 업로드 (클라이언트 압축 + 전송) ============ */
  function setupImageUpload() {
    /* 📷 버튼 → 파일 선택 창 열기 */
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#chatImageBtn')) return;
      e.preventDefault();
      if (!_currentRoom?.id) return;
      const input = document.getElementById('chatImageInput');
      if (input) input.click();
    });

    /* 파일 선택 → 압축 → 업로드 → 메시지 전송 */
    document.addEventListener('change', async (e) => {
      if (e.target.id !== 'chatImageInput') return;
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = ''; // 리셋

      if (file.size > 10 * 1024 * 1024) {
        SIREN.toast('파일 크기는 10MB 이하여야 합니다');
        return;
      }

      SIREN.toast('⏳ 이미지 처리 중...');

      try {
        /* 클라이언트 압축 (Canvas API) */
        const compressed = await compressImage(file, 1200, 0.75);

        /* FormData로 업로드 */
        const fd = new FormData();
        fd.append('file', compressed, file.name);
        fd.append('roomId', String(_currentRoom.id));

        const uploadRes = await fetch('/api/chat/upload', {
          method: 'POST',
          credentials: 'include',
          body: fd,
        });
        const uploadData = await uploadRes.json();

        if (!uploadRes.ok || !uploadData?.ok) {
          SIREN.toast(uploadData?.error || '이미지 업로드 실패');
          return;
        }

        const att = uploadData.data?.attachment;
        if (!att) { SIREN.toast('업로드 응답 오류'); return; }

        /* 이미지 메시지 전송 */
        const msgRes = await api('/api/chat/messages', {
          method: 'POST',
          body: {
            roomId: _currentRoom.id,
            content: `[이미지] ${att.originalName}`,
            messageType: 'image',
            attachmentId: att.id,
          },
        });

        if (msgRes.ok && msgRes.data?.data?.message) {
          appendMessages([msgRes.data.data.message], false);
          _lastMessageAt = msgRes.data.data.message.createdAt;
          SIREN.toast('이미지가 전송되었습니다');
        } else {
          SIREN.toast('이미지 메시지 전송 실패');
        }
      } catch (err) {
        console.error('[chat] 이미지 업로드 에러:', err);
        SIREN.toast('이미지 처리 중 오류가 발생했습니다');
      }
    });
  }

  /**
   * Canvas API 기반 이미지 압축
   * @param {File} file - 원본 파일
   * @param {number} maxDim - 최대 가로/세로 (px)
   * @param {number} quality - JPEG 품질 (0.0 ~ 1.0)
   * @returns {Promise<Blob>}
   */
  function compressImage(file, maxDim, quality) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);

      img.onload = () => {
        URL.revokeObjectURL(url);
        let { width, height } = img;

        /* 리사이즈 */
        if (width > maxDim || height > maxDim) {
          const ratio = Math.min(maxDim / width, maxDim / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (blob) resolve(blob);
            else reject(new Error('Canvas toBlob 실패'));
          },
          'image/jpeg',
          quality
        );
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('이미지 로드 실패'));
      };

      img.src = url;
    });
  }

  /* ============ 메시지 전송 (이벤트 위임 방식) ============ */
  function setupSend() {
    /* 전송 함수 */
    async function doSend() {
      const input = document.getElementById('chatInputText');
      const sendBtn = document.getElementById('chatSendBtn');
      if (!input) return;

      const text = (input.value || '').trim();
      if (!text) return;
      if (!_currentRoom || !_currentRoom.id) {
        console.warn('[chat] _currentRoom 없음', _currentRoom);
        return;
      }

      if (sendBtn) sendBtn.disabled = true;

      try {
        const res = await api('/api/chat/messages', {
          method: 'POST',
          body: { roomId: _currentRoom.id, content: text, messageType: 'text' },
        });

        if (res.ok && res.data?.data?.message) {
          input.value = '';
          input.style.height = 'auto';
          appendMessages([res.data.data.message], false);
          _lastMessageAt = res.data.data.message.createdAt;
        } else {
          SIREN.toast(res.data?.error || '전송 실패');
        }
      } catch (err) {
        console.error('[chat] 전송 에러:', err);
        SIREN.toast('메시지 전송 중 오류가 발생했습니다');
      } finally {
        if (sendBtn) sendBtn.disabled = false;
        input.focus();
      }
    }

    /* 전송 버튼 클릭 (이벤트 위임) */
    document.addEventListener('click', (e) => {
      if (e.target.closest('#chatSendBtn')) {
        e.preventDefault();
        doSend();
      }
    });

    /* Enter 키 (이벤트 위임) */
    document.addEventListener('keydown', (e) => {
      if (e.target.id !== 'chatInputText') return;
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        doSend();
      }
    });

    /* textarea 자동 높이 (이벤트 위임) */
    document.addEventListener('input', (e) => {
      if (e.target.id !== 'chatInputText') return;
      e.target.style.height = 'auto';
      e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px';
    });
  }

  /* ============ 폴링 ============ */
  function startPolling(roomId) {
    /* 이전 타이머만 정리 (방 데이터는 유지) */
    if (_pollTimer) {
      clearInterval(_pollTimer);
      _pollTimer = null;
    }
    _pollTimer = setInterval(async () => {
      if (!_currentRoom || _currentRoom.id !== roomId) return;
      await fetchMessages(roomId, false);
      /* 읽음 처리 */
      api('/api/chat/messages', { method: 'PATCH', body: { roomId } });
    }, POLL_INTERVAL);
  }

  function stopChatWindow() {
    if (_pollTimer) {
      clearInterval(_pollTimer);
      _pollTimer = null;
    }
    _currentRoom = null;
    _lastMessageAt = null;
    _renderedMsgIds.clear(); // ★ 초기화
    /* 목록 새로고침 (미읽음/마지막 메시지 갱신) */
    if (document.querySelector('.mp-panel[data-mp-panel="consult"]')?.style.display !== 'none') {
      loadRooms();
    }
  }

  /* ============ 초기화 ============ */
  function init() {
    setupRoomClick();
    setupNewChatBtn();
    setupModalClose();
    setupImageUpload();
    setupSend();
  }

  /* 전역 노출 */
  window.SIREN_CHAT = {
    loadRooms,
    openChatWindow,
  };

  /* SIREN_PAGE_INIT 훅 */
  const prevInit = window.SIREN_PAGE_INIT;
  window.SIREN_PAGE_INIT = function () {
    if (typeof prevInit === 'function') prevInit();
    init();
  };

  /* 백업 진입 */
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(init, 600);
  } else {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 600));
  }
})();