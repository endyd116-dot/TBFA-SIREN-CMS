/**
 * Phase 21 R1 — BroadcastChannel 기반 탭 간 동기화
 *
 * 사용법:
 *   WorkspaceSync.notify('task:updated', { id: 123 });
 *   WorkspaceSync.on('task:updated', (payload) => refetch());
 */
(function () {
  'use strict';

  const CHANNEL_NAME = 'workspace-tasks';
  const LS_KEY = 'ws_sync_fallback';

  const handlers = {};
  let bc = null;

  // BroadcastChannel 지원 시 사용, 미지원(구형 Safari) 시 localStorage fallback
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      bc = new BroadcastChannel(CHANNEL_NAME);
      bc.onmessage = function (e) {
        dispatch(e.data);
      };
    } catch (_) {
      bc = null;
    }
  }

  // localStorage fallback
  if (!bc) {
    window.addEventListener('storage', function (e) {
      if (e.key !== LS_KEY) return;
      try {
        const msg = JSON.parse(e.newValue || '{}');
        if (msg && msg.type) dispatch(msg);
      } catch (_) {}
    });
  }

  function dispatch(msg) {
    if (!msg || !msg.type) return;
    const list = handlers[msg.type] || [];
    list.forEach(function (fn) {
      try { fn(msg.payload || {}); } catch (err) { console.warn('[WorkspaceSync] 핸들러 오류:', err); }
    });
    // '*' 와일드카드 핸들러
    (handlers['*'] || []).forEach(function (fn) {
      try { fn(msg.type, msg.payload || {}); } catch (err) { console.warn('[WorkspaceSync] 핸들러 오류:', err); }
    });
  }

  window.WorkspaceSync = {
    /**
     * 변경 발신
     * @param {string} eventName  예: 'task:updated'
     * @param {object} payload
     */
    notify: function (eventName, payload) {
      const msg = { type: eventName, payload: payload || {}, ts: Date.now() };
      if (bc) {
        try { bc.postMessage(msg); } catch (_) {}
      } else {
        try { localStorage.setItem(LS_KEY, JSON.stringify(msg)); } catch (_) {}
      }
    },

    /**
     * 변경 수신
     * @param {string} eventName  예: 'task:updated' | '*'
     * @param {function} handler
     */
    on: function (eventName, handler) {
      if (!handlers[eventName]) handlers[eventName] = [];
      handlers[eventName].push(handler);
    },

    /**
     * 핸들러 제거
     */
    off: function (eventName, handler) {
      if (!handlers[eventName]) return;
      handlers[eventName] = handlers[eventName].filter(function (fn) { return fn !== handler; });
    }
  };

  // 페이지 숨김 → 표시(다른 탭에서 돌아옴) 시 강제 refetch 발신
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') {
      dispatch({ type: 'page:visible', payload: {} });
    }
  });

  // 페이지 언로드 시 채널 닫기
  window.addEventListener('beforeunload', function () {
    if (bc) { try { bc.close(); } catch (_) {} }
  });
})();
