/* ============================================================
   SIREN AI 에이전트 위젯
   - 우하단 플로팅 🤖 버튼 (admin·operator만)
   - 클릭 시 우측 슬라이드 패널 (400px)
   - 전체화면 페이지(/admin-ai-assistant.html)에서는 자동 비활성
   ============================================================ */
(function () {
  'use strict';

  if (window.__aiAgentWidgetLoaded) return;
  window.__aiAgentWidgetLoaded = true;

  /* 풀스크린 페이지에서는 위젯 안 띄움 */
  if (location.pathname === '/admin-ai-assistant.html') return;

  /* ── 권한 체크 ── */
  async function isAdminOrOperator() {
    try {
      var r = await fetch('/api/auth/me', { credentials: 'include' });
      if (r.ok) {
        var j = await r.json().catch(function(){ return {}; });
        var u = (j && j.data && j.data.user) || (j && j.user) || null;
        if (u && (u.canAdminMode || u.isAdmin || u.isOperator || u.type === 'admin')) return true;
      }
    } catch (_) {}
    try {
      var r2 = await fetch('/api/admin/me', { credentials: 'include' });
      if (r2.ok) return true;
    } catch (_) {}
    return false;
  }

  /* ── 스타일 주입 ── */
  function injectStyle() {
    if (document.getElementById('ai-agent-widget-css')) return;
    var s = document.createElement('style');
    s.id = 'ai-agent-widget-css';
    s.textContent = `
      .aiw-fab {
        position: fixed; bottom: 28px; right: 28px; z-index: 9998;
        width: 60px; height: 60px; border-radius: 50%;
        background: linear-gradient(135deg, #7a1f2b, #c5293a);
        color: #fff; border: none; cursor: pointer;
        box-shadow: 0 8px 24px rgba(122,31,43,0.4);
        font-size: 28px; display: flex; align-items: center; justify-content: center;
        transition: all 0.2s; font-family: 'Apple Color Emoji','Segoe UI Emoji',sans-serif;
      }
      .aiw-fab:hover { transform: scale(1.08); box-shadow: 0 12px 32px rgba(122,31,43,0.55); }

      .aiw-panel {
        position: fixed; top: 0; right: -440px; width: 420px; height: 100vh;
        background: #fff; box-shadow: -8px 0 24px rgba(0,0,0,0.15);
        z-index: 9999; display: flex; flex-direction: column;
        transition: right 0.28s cubic-bezier(.16,1,.3,1);
        font-family: 'Noto Sans KR', sans-serif;
      }
      .aiw-panel.open { right: 0; }
      .aiw-head {
        display: flex; align-items: center; justify-content: space-between;
        padding: 14px 18px; background: #1e293b; color: #fff;
      }
      .aiw-head strong { font-size: 14px; font-weight: 600; }
      .aiw-head .aiw-title-sub { font-size: 11px; color: #94a3b8; margin-left: 6px; }
      .aiw-close {
        background: transparent; border: none; color: #fff; font-size: 22px;
        cursor: pointer; line-height: 1; padding: 0 6px;
      }
      .aiw-close:hover { color: #fca5a5; }
      .aiw-fullscreen {
        background: transparent; border: 1px solid #475569; color: #cbd5e1;
        padding: 3px 8px; border-radius: 4px; font-size: 11px;
        cursor: pointer; margin-right: 6px;
      }
      .aiw-fullscreen:hover { border-color: #94a3b8; color: #fff; }

      .aiw-msgs {
        flex: 1; overflow-y: auto; padding: 16px 18px;
        background: #f8fafc; display: flex; flex-direction: column; gap: 12px;
      }
      .aiw-msg { display: flex; flex-direction: column; gap: 4px; }
      .aiw-msg.user { align-items: flex-end; }
      .aiw-msg.ai   { align-items: flex-start; }
      .aiw-bubble {
        max-width: 85%; padding: 10px 14px; border-radius: 14px;
        font-size: 13.5px; line-height: 1.55; white-space: pre-wrap; word-break: break-word;
      }
      .aiw-msg.user .aiw-bubble { background: #1e40af; color: #fff; border-bottom-right-radius: 4px; }
      .aiw-msg.ai   .aiw-bubble { background: #fff; color: #1e293b; border: 1px solid #e2e8f0; border-bottom-left-radius: 4px; }
      .aiw-tools {
        background: #fff8e1; border-left: 3px solid #ca8a04;
        padding: 10px 12px; border-radius: 6px; font-size: 11.5px; color: #713f12;
        max-width: 95%;
      }
      .aiw-tools b { font-family: monospace; }
      .aiw-pending {
        background: #fef9c3; border: 2px solid #facc15; border-radius: 8px;
        padding: 12px 14px; font-size: 12.5px;
      }
      .aiw-pending h5 { margin: 0 0 6px; color: #713f12; font-size: 13px; }
      .aiw-pending pre {
        background: #fff; padding: 8px 10px; border-radius: 4px;
        font-size: 11px; overflow-x: auto; margin: 6px 0;
        max-height: 200px; white-space: pre-wrap; word-break: break-all;
      }
      .aiw-pending-actions { display: flex; gap: 8px; margin-top: 8px; }
      .aiw-pending-actions button {
        flex: 1; padding: 7px 12px; border: none; border-radius: 6px;
        font-size: 12px; cursor: pointer; font-weight: 600;
      }
      .aiw-approve { background: #16a34a; color: #fff; }
      .aiw-reject  { background: #e2e8f0; color: #1e293b; }

      .aiw-input-bar {
        padding: 14px 16px; border-top: 1px solid #e2e8f0; background: #fff;
        display: flex; gap: 8px; align-items: flex-end;
      }
      .aiw-input {
        flex: 1; min-height: 40px; max-height: 120px; resize: none;
        padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 8px;
        font-size: 13.5px; font-family: inherit; line-height: 1.4;
      }
      .aiw-input:focus { outline: none; border-color: #1e40af; box-shadow: 0 0 0 3px rgba(30,64,175,0.1); }
      .aiw-send {
        background: #1e40af; color: #fff; border: none; border-radius: 8px;
        padding: 10px 18px; font-size: 13px; font-weight: 600; cursor: pointer;
        white-space: nowrap;
      }
      .aiw-send:disabled { background: #94a3b8; cursor: not-allowed; }

      .aiw-empty {
        text-align: center; color: #94a3b8; font-size: 13px; padding: 32px 12px;
      }
      .aiw-empty .aiw-suggest {
        display: block; background: #fff; border: 1px solid #e2e8f0; border-radius: 6px;
        padding: 8px 12px; margin: 6px 0; font-size: 12px; color: #475569; cursor: pointer;
        text-align: left;
      }
      .aiw-empty .aiw-suggest:hover { border-color: #1e40af; color: #1e40af; }

      @media (max-width: 600px) {
        .aiw-panel { width: 92vw; right: -100vw; }
        .aiw-panel.open { right: 0; }
      }
    `;
    document.head.appendChild(s);
  }

  /* ── 위젯 DOM 생성 ── */
  function buildWidget() {
    var fab = document.createElement('button');
    fab.className = 'aiw-fab';
    fab.title = 'SIREN AI 비서 (베타)';
    fab.innerHTML = '🤖';
    document.body.appendChild(fab);

    var panel = document.createElement('div');
    panel.className = 'aiw-panel';
    panel.innerHTML = `
      <div class="aiw-head">
        <div>
          <strong>🤖 SIREN AI 비서</strong>
          <span class="aiw-title-sub">베타 — 콘텐츠·관리</span>
        </div>
        <div>
          <button class="aiw-fullscreen" title="전체화면">⛶</button>
          <button class="aiw-close" title="닫기">×</button>
        </div>
      </div>
      <div class="aiw-msgs"></div>
      <div class="aiw-input-bar">
        <textarea class="aiw-input" placeholder="명령을 입력하세요…  (Enter로 전송, Shift+Enter 줄바꿈)" rows="1"></textarea>
        <button class="aiw-send">보내기</button>
      </div>
    `;
    document.body.appendChild(panel);

    /* 초기 화면 */
    showEmpty(panel.querySelector('.aiw-msgs'));

    /* 이벤트 바인딩 */
    fab.addEventListener('click', function () { panel.classList.add('open'); });
    panel.querySelector('.aiw-close').addEventListener('click', function () { panel.classList.remove('open'); });
    panel.querySelector('.aiw-fullscreen').addEventListener('click', function () {
      window.open('/admin-ai-assistant.html', '_blank');
    });

    var input = panel.querySelector('.aiw-input');
    var sendBtn = panel.querySelector('.aiw-send');
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); }
    });
    sendBtn.addEventListener('click', sendMsg);

    /* 자동 높이 조절 */
    input.addEventListener('input', function () {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });
  }

  function showEmpty(msgsEl) {
    msgsEl.innerHTML = `
      <div class="aiw-empty">
        무엇을 도와드릴까요?
        <button class="aiw-suggest" data-prompt="현재 메인 페이지 콘텐츠 목록 보여줘">
          📄 메인 페이지 콘텐츠 목록 보여줘
        </button>
        <button class="aiw-suggest" data-prompt="공지사항 새로 작성하고 싶어">
          📢 공지사항 작성하기
        </button>
        <button class="aiw-suggest" data-prompt="새 캠페인 등록하고 싶어">
          🎯 캠페인 등록하기
        </button>
        <button class="aiw-suggest" data-prompt="헤더 메뉴 구조 보여줘">
          📋 헤더 메뉴 구조 조회
        </button>
      </div>
    `;
    msgsEl.querySelectorAll('.aiw-suggest').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var input = document.querySelector('.aiw-input');
        input.value = btn.dataset.prompt;
        input.focus();
      });
    });
  }

  /* ── 메시지 전송 ── */
  var conversationId = null;
  var lastPendingApproval = null;

  function appendMsg(role, text) {
    var msgs = document.querySelector('.aiw-msgs');
    /* empty 상태 제거 */
    var empty = msgs.querySelector('.aiw-empty');
    if (empty) empty.remove();
    var m = document.createElement('div');
    m.className = 'aiw-msg ' + role;
    m.innerHTML = '<div class="aiw-bubble"></div>';
    m.querySelector('.aiw-bubble').textContent = text;
    msgs.appendChild(m);
    msgs.scrollTop = msgs.scrollHeight;
    return m;
  }

  function appendToolsInfo(toolCalls) {
    if (!toolCalls || !toolCalls.length) return;
    var msgs = document.querySelector('.aiw-msgs');
    var box = document.createElement('div');
    box.className = 'aiw-tools';
    box.innerHTML = '🔧 사용한 도구: ' + toolCalls.map(function (t) {
      return '<b>' + escapeHtml(t.name) + '</b>(' + (t.result.ok ? 'ok' : 'error') + ')';
    }).join(', ');
    msgs.appendChild(box);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function appendPendingApproval(p) {
    lastPendingApproval = p;
    var msgs = document.querySelector('.aiw-msgs');
    var box = document.createElement('div');
    box.className = 'aiw-pending';
    box.innerHTML = `
      <h5>⚠️ 작업 승인이 필요합니다</h5>
      <div>도구: <b>${escapeHtml(p.toolName)}</b></div>
      <pre>${escapeHtml(JSON.stringify(p.preview, null, 2))}</pre>
      <div class="aiw-pending-actions">
        <button class="aiw-approve">✅ 승인하고 실행</button>
        <button class="aiw-reject">취소</button>
      </div>
    `;
    msgs.appendChild(box);
    msgs.scrollTop = msgs.scrollHeight;

    box.querySelector('.aiw-approve').addEventListener('click', function () {
      box.remove();
      /* requireApproval=false로 다시 호출 */
      var argsApproved = Object.assign({}, p.args, { requireApproval: false });
      sendApprovedTool(p.toolName, argsApproved);
    });
    box.querySelector('.aiw-reject').addEventListener('click', function () {
      box.remove();
      appendMsg('ai', '취소했습니다. 다른 작업을 도와드릴까요?');
    });
  }

  async function sendMsg() {
    var input = document.querySelector('.aiw-input');
    var text = input.value.trim();
    if (!text) return;
    input.value = '';
    input.style.height = 'auto';
    appendMsg('user', text);

    var sendBtn = document.querySelector('.aiw-send');
    sendBtn.disabled = true;
    var thinking = appendMsg('ai', '🤔 생각 중…');

    try {
      var res = await fetch('/api/admin-ai-agent', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: conversationId,
          userMessage: text,
        }),
      });
      var j = await res.json().catch(function () { return {}; });
      thinking.remove();
      if (!res.ok) throw new Error(j.error || ('HTTP ' + res.status));
      conversationId = j.conversationId || conversationId;
      appendMsg('ai', j.reply || '(응답 없음)');
      if (j.toolCalls && j.toolCalls.length) appendToolsInfo(j.toolCalls);
      if (j.pendingApproval) appendPendingApproval(j.pendingApproval);
    } catch (err) {
      thinking.remove();
      appendMsg('ai', '❌ 오류: ' + (err.message || err));
    } finally {
      sendBtn.disabled = false;
      input.focus();
    }
  }

  /* 승인된 도구 재호출 — 사용자 메시지 없이 시스템이 자동 진행 */
  async function sendApprovedTool(toolName, argsApproved) {
    var sendBtn = document.querySelector('.aiw-send');
    sendBtn.disabled = true;
    var thinking = appendMsg('ai', '⚙️ 적용 중…');
    try {
      var res = await fetch('/api/admin-ai-agent', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: conversationId,
          userMessage: `(시스템) 사용자가 승인. ${toolName}을 다음 인자로 실제 적용해주세요: ${JSON.stringify(argsApproved)}`,
        }),
      });
      var j = await res.json().catch(function () { return {}; });
      thinking.remove();
      if (!res.ok) throw new Error(j.error || ('HTTP ' + res.status));
      appendMsg('ai', j.reply || '(응답 없음)');
      if (j.toolCalls && j.toolCalls.length) appendToolsInfo(j.toolCalls);
    } catch (err) {
      thinking.remove();
      appendMsg('ai', '❌ 오류: ' + (err.message || err));
    } finally {
      sendBtn.disabled = false;
    }
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]);
    });
  }

  /* ── 초기화 ── */
  async function init() {
    if (!await isAdminOrOperator()) return;
    injectStyle();
    buildWidget();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 800); });
  } else {
    setTimeout(init, 800);
  }
})();
