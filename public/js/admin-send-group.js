/* admin-send-group.js — Phase 20-B 발송 그룹 (발송 5메뉴) */
(function () {
  'use strict';

  const USE_MOCK = false;

  /* ─── mock 데이터 ─── */
  const MOCK = {
    ok: true,
    jobs: [
      { id: 1, title: '5월 뉴스레터', type: 'email', status: 'completed', scheduledAt: '2026-05-01 10:00', sentCount: 312, failCount: 3, createdBy: '운영자A' },
      { id: 2, title: '후원 감사 문자', type: 'sms', status: 'scheduled', scheduledAt: '2026-05-15 09:00', sentCount: 0, failCount: 0, createdBy: '운영자B' },
      { id: 3, title: '법률 지원 안내 카카오', type: 'kakao', status: 'failed', scheduledAt: '2026-05-08 14:00', sentCount: 0, failCount: 45, createdBy: '운영자A' },
      { id: 4, title: '상담 예약 확인', type: 'email', status: 'completed', scheduledAt: '2026-05-10 08:30', sentCount: 87, failCount: 1, createdBy: '운영자C' },
    ],
    templates: [
      { id: 1, name: '뉴스레터 기본형', channel: 'email', subject: '[SIREN] 월간 뉴스레터', usedCount: 12, updatedAt: '2026-05-01' },
      { id: 2, name: '후원 감사 문자', channel: 'sms', subject: '', usedCount: 8, updatedAt: '2026-04-20' },
      { id: 3, name: '카카오 공지 기본형', channel: 'kakao', subject: '', usedCount: 5, updatedAt: '2026-04-15' },
      { id: 4, name: '상담 예약 확인 메일', channel: 'email', subject: '[SIREN] 상담 예약이 확인되었습니다', usedCount: 23, updatedAt: '2026-05-08' },
    ],
    groups: [
      { id: 1, name: '정기 후원자 전체', memberCount: 312, channels: ['email', 'sms'], updatedAt: '2026-05-01' },
      { id: 2, name: '법률 지원 대기자', memberCount: 45, channels: ['kakao', 'email'], updatedAt: '2026-04-28' },
      { id: 3, name: '신규 가입 30일', memberCount: 28, channels: ['email'], updatedAt: '2026-05-10' },
      { id: 4, name: '미납 2개월+', memberCount: 17, channels: ['sms', 'kakao'], updatedAt: '2026-05-05' },
    ],
    analytics: {
      totalSent: 450,
      totalFailed: 12,
      openRate: 38.2,
      clickRate: 12.5,
      byChannel: [
        { channel: '이메일', sent: 312, opened: 119, clicked: 56 },
        { channel: 'SMS', sent: 98, delivered: 96, failed: 2 },
        { channel: '카카오', sent: 40, read: 35, failed: 5 },
      ],
    },
    logs: [
      { id: 1, channel: 'email', recipient: 'kim@example.com', subject: '5월 뉴스레터', status: 'delivered', sentAt: '2026-05-01 10:05' },
      { id: 2, channel: 'sms', recipient: '010-****-1234', subject: '후원 감사 문자', status: 'pending', sentAt: '-' },
      { id: 3, channel: 'kakao', recipient: '010-****-5678', subject: '법률 지원 안내', status: 'failed', sentAt: '2026-05-08 14:02' },
      { id: 4, channel: 'email', recipient: 'lee@example.com', subject: '상담 예약 확인', status: 'delivered', sentAt: '2026-05-10 08:32' },
      { id: 5, channel: 'email', recipient: 'park@example.com', subject: '5월 뉴스레터', status: 'bounced', sentAt: '2026-05-01 10:06' },
    ],
  };

  /* ─── API 헬퍼 ─── */
  async function api({ method = 'GET', url, body } = {}) {
    try {
      if (typeof window.adminApi === 'function') return await window.adminApi({ method, url, body });
      if (typeof window.api === 'function')      return await window.api({ method, url, body });
      const opts = { method, credentials: 'include', headers: { 'Content-Type': 'application/json' } };
      if (body !== undefined) opts.body = JSON.stringify(body);
      const r = await fetch(url, opts);
      if (r.status === 401) { window.location.href = '/admin.html'; return { ok: false, status: 401, data: {} }; }
      const data = await r.json().catch(() => ({}));
      return { ok: r.ok, status: r.status, data };
    } catch (err) {
      return { ok: false, data: { error: String(err) } };
    }
  }

  /* ─── 토스트 ─── */
  function showToast(msg, type = 'error') {
    const el = document.getElementById('toast') || document.getElementById('admToast');
    if (el) {
      el.textContent = msg;
      el.className = 'toast show' + (type === 'error' ? ' toast-error' : '');
      setTimeout(() => el.classList.remove('show'), 3500);
    } else {
      console.warn('[SendGroup]', msg);
    }
  }

  /* ─── 상태 ─── */
  let currentTab = 'jobs';
  let sendData = null;

  /* ─── 진입 ─── */
  function init() {
    const container = document.getElementById('adm20-send-jobs');
    if (!container) return;
    container.innerHTML = buildShell();
    bindTabs(container);
    loadData();
  }

  /* ─── 탭 셸 HTML ─── */
  function buildShell() {
    return `
      <div class="adm-card">
        <div class="adm-group-tabs">
          <button class="adm-group-tab is-active" data-tab="jobs">📤 발송 작업</button>
          <button class="adm-group-tab" data-tab="templates">📝 발송 템플릿</button>
          <button class="adm-group-tab" data-tab="groups">👥 수신자 그룹</button>
          <button class="adm-group-tab" data-tab="analytics">📊 발송 분석</button>
          <button class="adm-group-tab" data-tab="logs">📋 알림 로그</button>
        </div>

        <div class="adm-group-panel is-active" data-panel="jobs">
          <div id="sg-jobs-wrap"></div>
        </div>

        <div class="adm-group-panel" data-panel="templates">
          <div id="sg-templates-wrap"></div>
        </div>

        <div class="adm-group-panel" data-panel="groups">
          <div id="sg-groups-wrap"></div>
        </div>

        <div class="adm-group-panel" data-panel="analytics">
          <div id="sg-analytics-wrap"></div>
        </div>

        <div class="adm-group-panel" data-panel="logs">
          <div id="sg-logs-wrap"></div>
        </div>
      </div>`;
  }

  /* ─── 탭 바인딩 ─── */
  function bindTabs(container) {
    container.querySelectorAll('.adm-group-tab').forEach(btn => {
      btn.addEventListener('click', function () {
        const tab = this.dataset.tab;
        container.querySelectorAll('.adm-group-tab').forEach(b => b.classList.remove('is-active'));
        container.querySelectorAll('.adm-group-panel').forEach(p => p.classList.remove('is-active'));
        this.classList.add('is-active');
        const panel = container.querySelector('[data-panel="' + tab + '"]');
        if (panel) panel.classList.add('is-active');
        currentTab = tab;
        if (sendData) renderTab(tab, sendData);
      });
    });
  }

  /* ─── 데이터 로드 ─── */
  async function loadData() {
    let d;
    if (USE_MOCK) {
      d = MOCK;
    } else {
      const res = await api({ url: '/api/admin-send-unified' });
      if (!res.ok) {
        showToast((res.data?.error || res.data?.data?.error || '발송 데이터를 불러오지 못했습니다.') + (res.data?.detail ? ' — ' + res.data.detail : ''));
        d = {};
      } else {
        d = res.data?.data || res.data || {};
      }
    }
    sendData = d;
    renderTab(currentTab, d);
  }

  /* ─── 탭별 렌더 ─── */
  function renderTab(tab, d) {
    if (tab === 'jobs') renderJobs(d.jobs || []);
    else if (tab === 'templates') renderTemplates(d.templates || []);
    else if (tab === 'groups') renderGroups(d.groups || []);
    else if (tab === 'analytics') renderAnalytics(d.analytics || {});
    else if (tab === 'logs') renderLogs(d.logs || []);
  }

  /* ─── 발송 작업 ─── */
  function renderJobs(jobs) {
    const wrap = document.getElementById('sg-jobs-wrap');
    if (!wrap) return;
    const statusLabel = { completed: '완료', scheduled: '예약', failed: '실패', sending: '발송중', draft: '초안' };
    const statusColor = { completed: '#1a8b46', scheduled: '#1a5ec4', failed: '#c5293a', sending: '#c47a00', draft: '#888' };
    const channelLabel = { email: '이메일', sms: 'SMS', kakao: '카카오' };
    const channelColor = { email: '#1a5ec4', sms: '#1a8b46', kakao: '#c47a00' };
    wrap.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div style="font-size:13px;font-weight:600;color:var(--tok-text-1)">발송 작업 목록</div>
        <button class="btn-sm btn-sm-primary" onclick="alert('[mock] 새 발송 작업 생성')">+ 새 발송 작업</button>
      </div>
      <div style="overflow-x:auto">
        <table class="tbl">
          <thead><tr><th>제목</th><th>채널</th><th>예약 시각</th><th>발송</th><th>실패</th><th>상태</th><th>담당자</th><th>관리</th></tr></thead>
          <tbody>
            ${jobs.map(j => `
              <tr>
                <td style="font-weight:600">${j.title}</td>
                <td><span style="background:#f0f4ff;color:${channelColor[j.type]};padding:2px 8px;border-radius:10px;font-size:11.5px">${channelLabel[j.type] || j.type}</span></td>
                <td style="font-size:12px;white-space:nowrap">${j.scheduledAt}</td>
                <td style="font-weight:600;color:#1a8b46">${j.sentCount.toLocaleString()}</td>
                <td style="font-weight:600;color:${j.failCount > 0 ? '#c5293a' : 'var(--tok-text-3)'}">
                  ${j.failCount > 0 ? j.failCount : '-'}
                </td>
                <td><span style="color:${statusColor[j.status]};font-weight:600;font-size:12.5px">${statusLabel[j.status] || j.status}</span></td>
                <td style="font-size:12.5px;color:var(--tok-text-3)">${j.createdBy}</td>
                <td>
                  <button class="btn-sm btn-sm-ghost" style="font-size:11.5px" onclick="alert('[mock] 상세 보기')">상세</button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <p style="font-size:12px;color:var(--tok-text-3);margin-top:8px">총 ${jobs.length}건 (mock 데이터)</p>`;
  }

  /* ─── 발송 템플릿 ─── */
  function renderTemplates(templates) {
    const wrap = document.getElementById('sg-templates-wrap');
    if (!wrap) return;
    const channelLabel = { email: '이메일', sms: 'SMS', kakao: '카카오' };
    const channelColor = { email: '#1a5ec4', sms: '#1a8b46', kakao: '#c47a00' };
    wrap.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div style="font-size:13px;font-weight:600;color:var(--tok-text-1)">발송 템플릿</div>
        <button class="btn-sm btn-sm-primary" onclick="alert('[mock] 새 템플릿 생성')">+ 새 템플릿</button>
      </div>
      <div style="overflow-x:auto">
        <table class="tbl">
          <thead><tr><th>템플릿명</th><th>채널</th><th>제목</th><th>사용 횟수</th><th>수정일</th><th>관리</th></tr></thead>
          <tbody>
            ${templates.map(t => `
              <tr>
                <td style="font-weight:600">${t.name}</td>
                <td><span style="background:#f0f4ff;color:${channelColor[t.channel]};padding:2px 8px;border-radius:10px;font-size:11.5px">${channelLabel[t.channel] || t.channel}</span></td>
                <td style="font-size:12.5px;color:var(--tok-text-2)">${t.subject || '-'}</td>
                <td style="text-align:center">${t.usedCount}회</td>
                <td style="font-size:12px;color:var(--tok-text-3)">${t.updatedAt}</td>
                <td>
                  <button class="btn-sm btn-sm-ghost" style="font-size:11.5px" onclick="alert('[mock] 편집')">편집</button>
                  <button class="btn-sm btn-sm-ghost" style="font-size:11.5px;color:#c5293a" onclick="alert('[mock] 삭제')">삭제</button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <p style="font-size:12px;color:var(--tok-text-3);margin-top:8px">총 ${templates.length}건 (mock 데이터)</p>`;
  }

  /* ─── 수신자 그룹 ─── */
  function renderGroups(groups) {
    const wrap = document.getElementById('sg-groups-wrap');
    if (!wrap) return;
    const channelLabel = { email: '이메일', sms: 'SMS', kakao: '카카오' };
    wrap.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div style="font-size:13px;font-weight:600;color:var(--tok-text-1)">수신자 그룹</div>
        <button class="btn-sm btn-sm-primary" onclick="alert('[mock] 새 그룹 생성')">+ 새 그룹</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px">
        ${groups.map(g => `
          <div style="border:1px solid var(--tok-line);border-radius:8px;padding:16px">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
              <div style="font-weight:600;font-size:14px">${g.name}</div>
              <div style="font-size:20px;font-weight:700;color:var(--tok-brand)">${g.memberCount.toLocaleString()}</div>
            </div>
            <div style="margin-bottom:10px">
              ${g.channels.map(c => `<span style="background:#f0f4ff;color:#1a5ec4;padding:2px 8px;border-radius:10px;font-size:11.5px;margin-right:4px">${channelLabel[c] || c}</span>`).join('')}
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center">
              <span style="font-size:12px;color:var(--tok-text-3)">갱신: ${g.updatedAt}</span>
              <div style="display:flex;gap:6px">
                <button class="btn-sm btn-sm-ghost" style="font-size:11.5px" onclick="alert('[mock] 편집')">편집</button>
                <button class="btn-sm btn-sm-primary" style="font-size:11.5px" onclick="alert('[mock] 이 그룹으로 발송')">발송</button>
              </div>
            </div>
          </div>`).join('')}
      </div>
      <p style="font-size:12px;color:var(--tok-text-3);margin-top:12px">총 ${groups.length}개 그룹 (mock 데이터)</p>`;
  }

  /* ─── 발송 분석 ─── */
  function renderAnalytics(analytics) {
    const wrap = document.getElementById('sg-analytics-wrap');
    if (!wrap) return;
    const byChannel = analytics.byChannel || [];
    wrap.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px">
        <div class="kpi">
          <div class="kpi-label">총 발송</div>
          <div class="kpi-value">${(analytics.totalSent || 0).toLocaleString()}</div>
        </div>
        <div class="kpi" style="border-left:3px solid #c5293a">
          <div class="kpi-label">실패</div>
          <div class="kpi-value" style="color:#c5293a">${analytics.totalFailed || 0}</div>
        </div>
        <div class="kpi" style="border-left:3px solid #1a8b46">
          <div class="kpi-label">열람율 (이메일)</div>
          <div class="kpi-value" style="color:#1a8b46">${analytics.openRate || 0}%</div>
        </div>
        <div class="kpi" style="border-left:3px solid var(--tok-brand)">
          <div class="kpi-label">클릭율 (이메일)</div>
          <div class="kpi-value" style="color:var(--tok-brand)">${analytics.clickRate || 0}%</div>
        </div>
      </div>

      <div style="font-size:13px;font-weight:600;margin-bottom:12px;color:var(--tok-text-1)">채널별 발송 현황</div>
      <table class="tbl" style="margin-bottom:16px">
        <thead><tr><th>채널</th><th style="text-align:right">발송</th><th style="text-align:right">도달/열람</th><th style="text-align:right">클릭</th><th style="text-align:right">실패</th></tr></thead>
        <tbody>
          ${byChannel.map(c => `
            <tr>
              <td style="font-weight:600">${c.channel}</td>
              <td style="text-align:right">${c.sent.toLocaleString()}</td>
              <td style="text-align:right;color:#1a8b46">${(c.opened || c.delivered || c.read || 0).toLocaleString()}</td>
              <td style="text-align:right;color:var(--tok-brand)">${(c.clicked || '-')}</td>
              <td style="text-align:right;color:#c5293a">${(c.failed || 0)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      <p style="font-size:12px;color:var(--tok-text-3)">mock 데이터 — 실 API 연결 후 실제 통계로 표시됩니다.</p>`;
  }

  /* ─── 알림 로그 ─── */
  function renderLogs(logs) {
    const wrap = document.getElementById('sg-logs-wrap');
    if (!wrap) return;
    const statusLabel = { delivered: '전달됨', pending: '대기', failed: '실패', bounced: '반송' };
    const statusColor = { delivered: '#1a8b46', pending: '#c47a00', failed: '#c5293a', bounced: '#888' };
    const channelLabel = { email: '이메일', sms: 'SMS', kakao: '카카오' };
    wrap.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div style="font-size:13px;font-weight:600;color:var(--tok-text-1)">알림 발송 로그</div>
        <div style="display:flex;gap:8px">
          <select style="padding:6px 10px;border:1px solid var(--tok-line);border-radius:5px;font-size:12.5px">
            <option>전체 채널</option>
            <option>이메일</option>
            <option>SMS</option>
            <option>카카오</option>
          </select>
          <select style="padding:6px 10px;border:1px solid var(--tok-line);border-radius:5px;font-size:12.5px">
            <option>전체 상태</option>
            <option>전달됨</option>
            <option>실패</option>
            <option>반송</option>
          </select>
        </div>
      </div>
      <div style="overflow-x:auto">
        <table class="tbl">
          <thead><tr><th>채널</th><th>수신자</th><th>내용</th><th>발송 시각</th><th>상태</th></tr></thead>
          <tbody>
            ${logs.map(l => `
              <tr>
                <td><span style="background:#f0f4ff;color:#1a5ec4;padding:2px 8px;border-radius:10px;font-size:11.5px">${channelLabel[l.channel] || l.channel}</span></td>
                <td style="font-size:12.5px;color:var(--tok-text-2)">${l.recipient}</td>
                <td style="font-size:12.5px">${l.subject}</td>
                <td style="font-size:12px;white-space:nowrap;color:var(--tok-text-3)">${l.sentAt}</td>
                <td><span style="color:${statusColor[l.status]};font-weight:600;font-size:12.5px">${statusLabel[l.status] || l.status}</span></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <p style="font-size:12px;color:var(--tok-text-3);margin-top:8px">총 ${logs.length}건 (mock 데이터)</p>`;
  }

  /* ─── 진입점 ─── */
  function tryInit() {
    const container = document.getElementById('adm20-send-jobs');
    if (!container) return;
    if (container.dataset.sendGroupInit) return;
    container.dataset.sendGroupInit = '1';
    init();
  }

  const obs = new MutationObserver(function (muts) {
    muts.forEach(function (m) {
      if (m.target && m.target.id === 'adm20-send-jobs' && m.target.classList.contains('is-active')) {
        tryInit();
      }
    });
  });

  document.addEventListener('DOMContentLoaded', function () {
    const container = document.getElementById('adm20-send-jobs');
    if (container) {
      obs.observe(container, { attributes: true, attributeFilter: ['class'] });
      if (container.classList.contains('is-active')) tryInit();
    }
  });

})();
