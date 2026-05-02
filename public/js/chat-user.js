/* =========================================================
   SIREN — chat-user.js (STEP G-3 + H-1)
   사용자측 1:1 채팅 (마이페이지 내 모달)
   ★ H-1: 이미지 인라인 표시 + 라이트박스 + 다운로드
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

  let _chatInitDone = false;
  let _currentRoom = null;
  let _pollTimer = null;
  let _lastMessageAt = null;
  let _renderedMsgIds = new Set();
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

  /* ============ ★ H-1: 라이트박스 ============ */
  function openLightbox(attId, originalName) {
    /* 기존 라이트박스 제거 */
    const existing = document.querySelector('.lightbox-overlay');
    if (existing) existing.remove();

    const safeName = escapeHtml(originalName || '이미지');
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
    document.body.style.overflow = 'hidden'; // 스크롤 잠금

    /* 닫기 함수 */
    function closeLb() {
      overlay.remove();
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onEsc);
    }
    function onEsc(e) {
      if (e.key === 'Escape') closeLb();
    }

    /* 이벤트: 닫기 / 배경 클릭 / 다운로드 */
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
            SIREN.toast('다운로드 실패');
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
          SIREN.toast('다운로드 중 오류');
        } finally {
          dlBtn.classList.remove('is-loading');
        }
        return;
      }

      if (closeBtn) { closeLb(); return; }

      /* 배경 클릭 (이미지 본체 외) */
      if (e.target === overlay) closeLb();
    });

    document.addEventListener('keydown', onEsc);
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

  /* ============ 채팅방 카드 클릭 ============ */
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
      if (e.target.id === 'chatCategoryModal') {
        e.target.classList.remove('show');
      }
      if (e.target.id === 'chatWindowModal') {
        e.target.classList.remove('show');
        stopChatWindow();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      /* 라이트박스가 열려 있으면 ESC를 라이트박스에서 처리 — 여기는 스킵 */
      if (document.querySelector('.lightbox-overlay')) return;
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

    await fetchMessages(roomId, true);
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

  /* ============ ★ H-1: 메시지 본문 빌드 (텍스트 + 이미지) ============ */
  function buildMessageBody(m) {
    const att = m.attachment;

    /* 이미지 첨부가 있는 경우 */
    if (att && att.id) {
      const safeName = escapeHtml(att.originalName || '이미지');
      const imgTag =
        `<img class="chat-msg-image" src="/api/chat/image?id=${att.id}" alt="${safeName}" ` +
        `data-att-id="${att.id}" data-att-name="${safeName}" loading="lazy" />`;

      /* 이미지 외 텍스트 메시지 본문이 "[이미지] xxx" 형식이면 표시 안 함 */
      const text = (m.content || '').trim();
      const textHtml = text && !text.startsWith('[이미지]')
        ? `<div class="msg-bubble">${escapeHtml(text).replace(/\n/g, '<br />')}</div>`
        : '';

      return textHtml + imgTag;
    }

    /* 일반 텍스트 메시지 */
    return `<div class="msg-bubble">${escapeHtml(m.content || '').replace(/\n/g, '<br />')}</div>`;
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

    const newMessages = messages.filter((m) => !_renderedMsgIds.has(m.id));
    if (newMessages.length === 0) return;

    const html = newMessages.map((m) => {
      _renderedMsgIds.add(m.id);

      if (m.isSystem || m.senderRole === 'system' || m.messageType === 'system_notice') {
        return `<div class="msg-row system"><div class="msg-bubble">📢 ${escapeHtml(m.content || '')}</div></div>`;
      }
      const isMine = m.senderId === myUid;
      const time = formatTime(m.createdAt);
      const body = buildMessageBody(m);
      const meta = `<span class="msg-meta">${time}</span>`;
      return isMine
        ? `<div class="msg-row mine">${meta}${body}</div>`
        : `<div class="msg-row theirs">${body}${meta}</div>`;
    }).join('');

    if (html) {
      msgsEl.insertAdjacentHTML('beforeend', html);
      msgsEl.scrollTop = msgsEl.scrollHeight;
    }
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

  /* ============ 이미지 업로드 (클라이언트 압축 + 전송) ============ */
  function setupImageUpload() {
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#chatImageBtn')) return;
      e.preventDefault();
      if (!_currentRoom?.id) return;
      const input = document.getElementById('chatImageInput');
      if (input) input.click();
    });

    document.addEventListener('change', async (e) => {
      if (e.target.id !== 'chatImageInput') return;
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = '';

      if (file.size > 10 * 1024 * 1024) {
        SIREN.toast('파일 크기는 10MB 이하여야 합니다');
        return;
      }

      SIREN.toast('⏳ 이미지 처리 중...');

      try {
        const compressed = await compressImage(file, 1200, 0.75);

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

  function compressImage(file, maxDim, quality) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);

      img.onload = () => {
        URL.revokeObjectURL(url);
        let { width, height } = img;

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

  /* ============ 메시지 전송 ============ */
  function setupSend() {
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

    document.addEventListener('click', (e) => {
      if (e.target.closest('#chatSendBtn')) {
        e.preventDefault();
        doSend();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.target.id !== 'chatInputText') return;
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        doSend();
      }
    });

    document.addEventListener('input', (e) => {
      if (e.target.id !== 'chatInputText') return;
      e.target.style.height = 'auto';
      e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px';
    });
  }

  /* ============ 폴링 ============ */
  function startPolling(roomId) {
    if (_pollTimer) {
      clearInterval(_pollTimer);
      _pollTimer = null;
    }
    _pollTimer = setInterval(async () => {
      if (!_currentRoom || _currentRoom.id !== roomId) return;
      await fetchMessages(roomId, false);
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
    _renderedMsgIds.clear();
    if (document.querySelector('.mp-panel[data-mp-panel="consult"]')?.style.display !== 'none') {
      loadRooms();
    }
  }

  /* ============ 초기화 ============ */
  function init() {
    if (_chatInitDone) return;
    _chatInitDone = true;

    setupRoomClick();
    setupNewChatBtn();
    setupModalClose();
    setupSend();
    setupImageUpload();
    setupImageClick(); // ★ H-1
  }

  /* 전역 노출 */
  window.SIREN_CHAT = {
    loadRooms,
    openChatWindow,
    openLightbox, // ★ H-1: 외부에서도 호출 가능
  };

  /* SIREN_PAGE_INIT 훅 */
  const prevInit = window.SIREN_PAGE_INIT;
  window.SIREN_PAGE_INIT = function () {
    if (typeof prevInit === 'function') prevInit();
    init();
  };

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(init, 600);
  } else {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 600));
  }
})();