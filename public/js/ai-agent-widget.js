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

      /* === F-6: 계획 진행 버튼 === */
      .aiw-plan-bar {
        display: flex; gap: 8px; padding: 8px 12px;
        background: #fef3c7; border-left: 3px solid #f59e0b;
        margin: 4px 0; font-size: 12.5px; color: #92400e;
      }
      .aiw-plan-bar button {
        padding: 6px 14px; border: none; border-radius: 4px;
        font-size: 12px; cursor: pointer; font-weight: 500;
      }
      .aiw-plan-bar .ok { background: #10b981; color: #fff; }
      .aiw-plan-bar .ok:hover { background: #059669; }
      .aiw-plan-bar .edit { background: #fff; color: #92400e; border: 1px solid #f59e0b; }

      /* === F-4: AI 응답 마크다운 표 === */
      .aiw-tbl { border-collapse: collapse; font-size: 12px; margin: 6px 0; width: 100%; }
      .aiw-tbl th, .aiw-tbl td { padding: 5px 8px; border: 1px solid #e2e8f0; text-align: left; }
      .aiw-tbl th { background: #f8fafc; font-weight: 600; }
      .aiw-tbl tr:nth-child(even) td { background: #fafbfc; }
      .aiw-bubble code {
        background: rgba(0,0,0,0.06); padding: 1px 5px; border-radius: 3px;
        font-family: 'Consolas', 'Monaco', monospace; font-size: 11.5px;
      }
      .aiw-bubble strong { font-weight: 600; }

      /* === F-3: 빠른 명령 칩 (input-bar 위) === */
      .aiw-quick-bar {
        display: flex; gap: 6px; padding: 6px 12px;
        overflow-x: auto; overflow-y: hidden;
        border-top: 1px solid #f1f5f9;
        white-space: nowrap; scrollbar-width: thin;
      }
      .aiw-quick-bar::-webkit-scrollbar { height: 4px; }
      .aiw-quick-bar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 2px; }
      .aiw-quick-chip {
        background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 9999px;
        padding: 5px 12px; font-size: 11.5px; color: #475569; cursor: pointer;
        flex-shrink: 0; white-space: nowrap;
      }
      .aiw-quick-chip:hover { background: #eff6ff; border-color: #93c5fd; color: #1e40af; }
      .aiw-quick-chip:disabled { opacity: 0.5; cursor: not-allowed; }

      /* === F-1: 파일 첨부 === */
      .aiw-attach-btn {
        background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 6px;
        width: 36px; height: 36px; font-size: 16px; cursor: pointer; padding: 0;
        flex-shrink: 0;
      }
      .aiw-attach-btn:hover { background: #e2e8f0; }
      .aiw-attach-list {
        padding: 6px 12px; display: flex; flex-wrap: wrap; gap: 6px;
        border-top: 1px solid #f1f5f9;
      }
      .aiw-attach-list:empty { display: none; }
      .aiw-attach-item {
        background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 4px;
        padding: 3px 8px; font-size: 11.5px; color: #1e40af;
        display: flex; align-items: center; gap: 6px;
        max-width: 200px;
      }
      .aiw-attach-item .name {
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .aiw-attach-item .rm {
        background: transparent; border: none; color: #1e40af; cursor: pointer;
        font-size: 13px; padding: 0; line-height: 1;
      }
      .aiw-attach-item .rm:hover { color: #b91c1c; }

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
      <div class="aiw-attach-list"></div>
      <div class="aiw-quick-bar">
        <button class="aiw-quick-chip" data-prompt="회원 유형별 통계 알려줘">📊 회원 통계</button>
        <button class="aiw-quick-chip" data-prompt="이번달 후원 현황 요약해줘">💰 이번달 후원</button>
        <button class="aiw-quick-chip" data-prompt="최근 SIREN 신고 5건 보여줘">🚨 최근 신고</button>
        <button class="aiw-quick-chip" data-prompt="오늘 KPI 요약해줘">📋 오늘 KPI</button>
        <button class="aiw-quick-chip" data-prompt="최근 알림 10건 보여줘">🔔 최근 알림</button>
        <button class="aiw-quick-chip" data-prompt="진행 중 작업 목록 보여줘">⚠️ 미처리 작업</button>
      </div>
      <div class="aiw-input-bar">
        <button class="aiw-attach-btn" title="파일 첨부 (PDF·이미지, 최대 5MB)">📎</button>
        <input type="file" class="aiw-file-input" accept="image/jpeg,image/png,image/webp,application/pdf" multiple hidden>
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

    /* === F-3: 빠른 명령 칩 — 클릭 즉시 전송 === */
    panel.querySelectorAll('.aiw-quick-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        if (chip.disabled) return;
        var prompt = chip.dataset.prompt || '';
        if (!prompt) return;
        input.value = prompt;
        sendMsg();
      });
    });

    /* === F-1: 파일 첨부 === */
    var attachBtn = panel.querySelector('.aiw-attach-btn');
    var fileInput = panel.querySelector('.aiw-file-input');
    var attachList = panel.querySelector('.aiw-attach-list');
    attachBtn.addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', async function () {
      for (var i = 0; i < fileInput.files.length; i++) {
        var f = fileInput.files[i];
        if (f.size > 5 * 1024 * 1024) {
          alert('파일 ' + f.name + ' 크기가 5MB를 초과합니다.');
          continue;
        }
        if (pendingFiles.length >= 4) {
          alert('최대 4개까지 첨부 가능합니다.');
          break;
        }
        try {
          var data = await fileToBase64(f);
          pendingFiles.push({ name: f.name, mimeType: f.type, data: data, sizeKB: Math.round(f.size / 1024) });
        } catch (e) { console.warn('파일 읽기 실패', e); }
      }
      fileInput.value = '';
      renderAttachList(attachList);
    });
  }

  /* 첨부 파일 메모리 보관 — sendMsg 후 비움 */
  var pendingFiles = [];

  function fileToBase64(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () {
        var s = String(r.result || '');
        var idx = s.indexOf(',');
        resolve(idx >= 0 ? s.slice(idx + 1) : s);
      };
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  function renderAttachList(el) {
    el.innerHTML = pendingFiles.map(function (f, i) {
      return '<span class="aiw-attach-item">' +
        '<span class="name" title="' + escapeHtml(f.name) + '">' + escapeHtml(f.name) + ' (' + f.sizeKB + 'KB)</span>' +
        '<button class="rm" data-i="' + i + '">×</button></span>';
    }).join('');
    el.querySelectorAll('.rm').forEach(function (btn) {
      btn.addEventListener('click', function () {
        pendingFiles.splice(Number(btn.dataset.i), 1);
        renderAttachList(el);
      });
    });
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"]/g, function (c) {
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c];
    });
  }

  /* === F-4: 가벼운 마크다운 → HTML (표 + inline) === */
  function renderInline(s) {
    s = escapeHtml(s);
    s = s.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/`([^`\n]+?)`/g, '<code>$1</code>');
    return s;
  }
  function renderMarkdown(text) {
    var lines = String(text || '').split('\n');
    var out = [];
    var tbl = [];

    function flush() {
      if (tbl.length === 0) return;
      var isTable = tbl.length >= 2 && /^\s*\|?(?:\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/.test(tbl[1]);
      if (isTable) {
        var header = tbl[0].split('|').map(function (c) { return c.trim(); }).filter(function (c, i, a) {
          return !(i === 0 && c === '') && !(i === a.length - 1 && c === '');
        });
        var rows = tbl.slice(2).map(function (line) {
          return line.split('|').map(function (c) { return c.trim(); }).filter(function (c, i, a) {
            return !(i === 0 && c === '') && !(i === a.length - 1 && c === '');
          });
        });
        var html = '<table class="aiw-tbl"><thead><tr>';
        header.forEach(function (h) { html += '<th>' + renderInline(h) + '</th>'; });
        html += '</tr></thead><tbody>';
        rows.forEach(function (row) {
          html += '<tr>';
          row.forEach(function (c) { html += '<td>' + renderInline(c) + '</td>'; });
          html += '</tr>';
        });
        html += '</tbody></table>';
        out.push(html);
      } else {
        tbl.forEach(function (l) { out.push(renderInline(l)); });
      }
      tbl = [];
    }

    for (var i = 0; i < lines.length; i++) {
      if (/^\s*\|.*\|\s*$/.test(lines[i])) {
        tbl.push(lines[i]);
      } else {
        flush();
        out.push(renderInline(lines[i]));
      }
    }
    flush();
    return out.join('<br>');
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
    /* === F-4: AI 응답만 마크다운(표·굵게·코드) 렌더, user는 텍스트 그대로 === */
    var bubble = m.querySelector('.aiw-bubble');
    if (role === 'ai') {
      bubble.innerHTML = renderMarkdown(text);
    } else {
      bubble.textContent = text;
    }
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

  /* === F-6: 계획 모드 진행 버튼 === */
  function appendPlanProceedBtn() {
    var msgs = document.querySelector('.aiw-msgs');
    var box = document.createElement('div');
    box.className = 'aiw-plan-bar';
    box.innerHTML = '<span style="flex:1">↑ 위 계획대로 진행하시겠습니까?</span>' +
      '<button class="ok">▶ 진행</button>' +
      '<button class="edit">✏️ 수정 요청</button>';
    msgs.appendChild(box);
    msgs.scrollTop = msgs.scrollHeight;
    box.querySelector('.ok').addEventListener('click', function () {
      box.remove();
      var input = document.querySelector('.aiw-input');
      input.value = '진행해주세요';
      sendMsg();
    });
    box.querySelector('.edit').addEventListener('click', function () {
      box.remove();
      var input = document.querySelector('.aiw-input');
      input.value = '계획 수정: ';
      input.focus();
    });
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
    if (!text && pendingFiles.length === 0) return;
    input.value = '';
    input.style.height = 'auto';

    /* 사용자 메시지에 첨부 파일 표기 */
    var userDisplay = text || '(파일 분석 요청)';
    if (pendingFiles.length > 0) {
      userDisplay += '\n📎 ' + pendingFiles.map(function (f) { return f.name; }).join(', ');
    }
    appendMsg('user', userDisplay);

    /* 전송용 파일 복사 후 pendingFiles 비움 (재첨부 가능) */
    var filesToSend = pendingFiles.map(function (f) {
      return { mimeType: f.mimeType, data: f.data };
    });
    pendingFiles = [];
    var attachList = document.querySelector('.aiw-attach-list');
    if (attachList) renderAttachList(attachList);

    var sendBtn = document.querySelector('.aiw-send');
    sendBtn.disabled = true;
    var thinking = appendMsg('ai', '🤔 생각 중…');

    /* === F-2: 단계 상태 시각화 — 시간 흐름에 따라 메시지 자동 갱신 === */
    var stages = [
      { delay: 2000,  text: '🔍 정보 조회 중…' },
      { delay: 5000,  text: '📊 결과 정리 중…' },
      { delay: 10000, text: '⏳ 거의 끝났습니다…' },
      { delay: 18000, text: '⌛ 조금만 더 기다려주세요…' },
    ];
    var stageTimers = stages.map(function (st) {
      return setTimeout(function () {
        if (thinking && thinking.isConnected) thinking.textContent = st.text;
      }, st.delay);
    });
    function clearStages() { stageTimers.forEach(clearTimeout); }

    try {
      var res = await fetch('/api/admin-ai-agent', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: conversationId,
          userMessage: text,
          inlineFiles: filesToSend,
        }),
      });
      var j = await res.json().catch(function () { return {}; });
      clearStages();
      thinking.remove();
      if (!res.ok) throw new Error((j.error || 'HTTP ' + res.status) + (j.detail ? ' — ' + j.detail : '') + (j.step ? ' [step:' + j.step + ']' : ''));
      conversationId = j.conversationId || conversationId;
      appendMsg('ai', j.reply || '(응답 없음)');
      if (j.toolCalls && j.toolCalls.length) appendToolsInfo(j.toolCalls);
      if (j.pendingApproval) appendPendingApproval(j.pendingApproval);
      /* === F-6: 계획 모드 감지 — 응답에 "실행 계획" 있고 도구 미호출이면 진행 버튼 === */
      if ((j.reply || '').indexOf('## 실행 계획') >= 0 && (!j.toolCalls || j.toolCalls.length === 0)) {
        appendPlanProceedBtn();
      }
    } catch (err) {
      clearStages();
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
      if (!res.ok) throw new Error((j.error || 'HTTP ' + res.status) + (j.detail ? ' — ' + j.detail : '') + (j.step ? ' [step:' + j.step + ']' : ''));
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
