/* admin-ai-group.js — Phase 20-B AI 에이전트 그룹 (추천·활동보고서·자동 트리거 3메뉴) mock */
(function () {
  'use strict';

  const USE_MOCK = true;

  /* ─── mock 데이터 ─── */
  const MOCK = {
    ok: true,
    recommendations: [
      {
        id: 1, type: 'churn_risk', memberId: 102, memberName: '김철수',
        title: '이탈 위험 회원 — 3개월 미납',
        summary: '최근 3개월간 후원이 중단되었습니다. 개인 연락을 권장합니다.',
        priority: 'high', score: 87, createdAt: '2026-05-11 06:30',
        actions: ['감사 문자 발송', '전화 상담 예약', '보류'],
      },
      {
        id: 2, type: 'upgrade', memberId: 205, memberName: '이영희',
        title: '등급 업그레이드 추천 — 후원 6개월 이상',
        summary: '6개월 연속 정기 후원자입니다. 정회원 전환을 안내하는 것이 좋습니다.',
        priority: 'medium', score: 72, createdAt: '2026-05-11 06:30',
        actions: ['정회원 안내 이메일', '보류'],
      },
      {
        id: 3, type: 'followup', memberId: 318, memberName: '박민준',
        title: '법률 지원 후속 상담 권장',
        summary: '법률 상담 완료 후 30일이 경과했습니다. 후속 상담 여부를 확인하세요.',
        priority: 'medium', score: 65, createdAt: '2026-05-11 06:30',
        actions: ['후속 상담 예약', '완료 처리', '보류'],
      },
      {
        id: 4, type: 'campaign', memberId: null, memberName: null,
        title: '5월 캠페인 성과 저조 — 홍보 강화 권장',
        summary: '5월 캠페인 목표 달성률이 42%입니다. 추가 홍보 채널을 고려하세요.',
        priority: 'low', score: 48, createdAt: '2026-05-11 06:30',
        actions: ['SNS 홍보 발송', '이메일 재발송', '무시'],
      },
    ],
    activityReports: [
      {
        id: 1, period: '2026년 4월',
        summary: '4월 한 달간 총 후원자 312명이 후원에 참여하였습니다. 신규 회원 28명이 가입하였으며, 유가족 법률 지원 신청은 전월 대비 15% 증가하였습니다.',
        highlights: ['신규 후원자 28명 가입', '법률 지원 신청 15% 증가', '캠페인 달성률 78%'],
        generatedAt: '2026-05-01 07:00',
        status: 'finalized',
      },
      {
        id: 2, period: '2026년 3월',
        summary: '3월 한 달간 총 후원자 305명이 후원에 참여하였습니다. 심리 상담 지원이 활성화되어 신청 건수가 전월 대비 20% 증가하였습니다.',
        highlights: ['심리 상담 신청 20% 증가', '정기 후원 전환율 12%', '뉴스레터 열람율 41%'],
        generatedAt: '2026-04-01 07:00',
        status: 'finalized',
      },
    ],
    autoTriggers: [
      {
        id: 1, name: '이탈 위험 자동 감사 문자',
        condition: '3개월 연속 미납 시',
        channel: 'sms',
        templateName: '후원 감사 문자',
        isActive: true,
        lastFiredAt: '2026-05-08 09:00',
        firedCount: 17,
      },
      {
        id: 2, name: '신규 가입 환영 이메일',
        condition: '가입 후 1일 이내',
        channel: 'email',
        templateName: '환영 이메일 기본형',
        isActive: true,
        lastFiredAt: '2026-05-11 10:30',
        firedCount: 342,
      },
      {
        id: 3, name: '생일 축하 카카오 알림',
        condition: '생일 당일 오전 9시',
        channel: 'kakao',
        templateName: '생일 카카오 기본형',
        isActive: false,
        lastFiredAt: '2026-04-20 09:00',
        firedCount: 28,
      },
      {
        id: 4, name: '후원 만료 30일 전 안내',
        condition: '후원 만료 30일 전',
        channel: 'email',
        templateName: '후원 연장 안내 메일',
        isActive: true,
        lastFiredAt: '2026-05-05 09:00',
        firedCount: 54,
      },
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

  /* ─── 상태 ─── */
  let currentTab = 'recommend';
  let aiData = null;

  /* ─── 진입 ─── */
  function init() {
    const container = document.getElementById('adm20-ai-recommend');
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
          <button class="adm-group-tab is-active" data-tab="recommend">🤖 AI 추천 센터</button>
          <button class="adm-group-tab" data-tab="activity">📊 AI 활동보고서</button>
          <button class="adm-group-tab" data-tab="triggers">⚡ 자동 발송 트리거</button>
        </div>

        <div class="adm-group-panel is-active" data-panel="recommend">
          <div id="ag-recommend-wrap"></div>
        </div>

        <div class="adm-group-panel" data-panel="activity">
          <div id="ag-activity-wrap"></div>
        </div>

        <div class="adm-group-panel" data-panel="triggers">
          <div id="ag-triggers-wrap"></div>
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
        if (aiData) renderTab(tab, aiData);
      });
    });
  }

  /* ─── 데이터 로드 ─── */
  async function loadData() {
    let d;
    if (USE_MOCK) {
      d = MOCK;
    } else {
      const res = await api({ url: '/api/admin-ai-unified' });
      d = res.data?.data || res.data || {};
    }
    aiData = d;
    renderTab(currentTab, d);
  }

  /* ─── 탭별 렌더 ─── */
  function renderTab(tab, d) {
    if (tab === 'recommend') renderRecommend(d.recommendations || []);
    else if (tab === 'activity') renderActivity(d.activityReports || []);
    else if (tab === 'triggers') renderTriggers(d.autoTriggers || []);
  }

  /* ─── AI 추천 센터 ─── */
  function renderRecommend(recs) {
    const wrap = document.getElementById('ag-recommend-wrap');
    if (!wrap) return;
    const priorityLabel = { high: '높음', medium: '보통', low: '낮음' };
    const priorityColor = { high: '#c5293a', medium: '#c47a00', low: '#1a8b46' };
    const typeIcon = { churn_risk: '⚠️', upgrade: '⬆️', followup: '🔄', campaign: '📢' };

    const highCount = recs.filter(r => r.priority === 'high').length;
    const medCount  = recs.filter(r => r.priority === 'medium').length;

    wrap.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:20px">
        <div class="kpi">
          <div class="kpi-label">전체 추천</div>
          <div class="kpi-value">${recs.length}건</div>
        </div>
        <div class="kpi" style="border-left:3px solid #c5293a">
          <div class="kpi-label">높음</div>
          <div class="kpi-value" style="color:#c5293a">${highCount}건</div>
        </div>
        <div class="kpi" style="border-left:3px solid #c47a00">
          <div class="kpi-label">보통</div>
          <div class="kpi-value" style="color:#c47a00">${medCount}건</div>
        </div>
      </div>

      <div style="font-size:12px;color:var(--tok-text-3);margin-bottom:12px">
        🤖 매일 오전 6:30 AI가 자동으로 분석·생성합니다 (mock 데이터)
      </div>

      <div style="display:flex;flex-direction:column;gap:12px">
        ${recs.map(r => `
          <div style="border:1px solid var(--tok-line);border-radius:8px;padding:16px;border-left:3px solid ${priorityColor[r.priority]}">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
              <div>
                <span style="font-size:16px;margin-right:6px">${typeIcon[r.type] || '💡'}</span>
                <span style="font-weight:600;font-size:14px">${r.title}</span>
                ${r.memberName ? `<span style="margin-left:8px;font-size:12.5px;color:var(--tok-text-3)">— ${r.memberName}</span>` : ''}
              </div>
              <div style="display:flex;align-items:center;gap:8px">
                <span style="font-size:20px;font-weight:700;color:${priorityColor[r.priority]}">${r.score}</span>
                <span style="background:${priorityColor[r.priority]}20;color:${priorityColor[r.priority]};padding:2px 8px;border-radius:10px;font-size:11.5px;font-weight:600">${priorityLabel[r.priority]}</span>
              </div>
            </div>
            <p style="font-size:13px;color:var(--tok-text-2);margin-bottom:12px;line-height:1.6">${r.summary}</p>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              ${r.actions.map(a => `<button class="btn-sm btn-sm-ghost" style="font-size:12px" onclick="alert('[mock] ' + '${a}')">${a}</button>`).join('')}
            </div>
            <div style="font-size:11.5px;color:var(--tok-text-3);margin-top:8px">생성: ${r.createdAt}</div>
          </div>`).join('')}
      </div>`;
  }

  /* ─── AI 활동보고서 ─── */
  function renderActivity(reports) {
    const wrap = document.getElementById('ag-activity-wrap');
    if (!wrap) return;
    wrap.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div style="font-size:13px;font-weight:600;color:var(--tok-text-1)">AI 생성 활동보고서</div>
        <button class="btn-sm btn-sm-primary" onclick="alert('[mock] 보고서 수동 재생성')">🔄 재생성</button>
      </div>
      <p style="font-size:12.5px;color:var(--tok-text-2);margin-bottom:16px">
        매월 1일 자동으로 AI가 전월 활동을 분석하여 보고서 초안을 생성합니다.
      </p>
      <div style="display:flex;flex-direction:column;gap:16px">
        ${reports.map(rep => `
          <div style="border:1px solid var(--tok-line);border-radius:8px;padding:20px">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
              <div>
                <div style="font-weight:700;font-size:15px">${rep.period} 활동보고서</div>
                <div style="font-size:12px;color:var(--tok-text-3);margin-top:2px">생성: ${rep.generatedAt}</div>
              </div>
              <div style="display:flex;gap:6px">
                <span style="background:#f0f9f3;color:#1a8b46;padding:3px 10px;border-radius:10px;font-size:12px;font-weight:600">
                  ${rep.status === 'finalized' ? '✅ 확정' : '✏️ 초안'}
                </span>
                <button class="btn-sm btn-sm-ghost" style="font-size:12px" onclick="alert('[mock] 보고서 편집')">편집</button>
                <button class="btn-sm btn-sm-ghost" style="font-size:12px" onclick="window.print()">인쇄</button>
              </div>
            </div>
            <p style="font-size:13.5px;color:var(--tok-text-1);line-height:1.7;margin-bottom:14px">${rep.summary}</p>
            <div style="display:flex;flex-wrap:wrap;gap:8px">
              ${rep.highlights.map(h => `
                <div style="background:#f5f5f0;border-radius:6px;padding:6px 12px;font-size:12.5px;color:var(--tok-text-2)">
                  ✦ ${h}
                </div>`).join('')}
            </div>
          </div>`).join('')}
      </div>
      <p style="font-size:12px;color:var(--tok-text-3);margin-top:12px">mock 데이터</p>`;
  }

  /* ─── 자동 발송 트리거 ─── */
  function renderTriggers(triggers) {
    const wrap = document.getElementById('ag-triggers-wrap');
    if (!wrap) return;
    const channelLabel = { email: '이메일', sms: 'SMS', kakao: '카카오' };
    const channelColor = { email: '#1a5ec4', sms: '#1a8b46', kakao: '#c47a00' };
    wrap.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div style="font-size:13px;font-weight:600;color:var(--tok-text-1)">자동 발송 트리거</div>
        <button class="btn-sm btn-sm-primary" onclick="alert('[mock] 새 트리거 생성')">+ 새 트리거</button>
      </div>
      <p style="font-size:12.5px;color:var(--tok-text-2);margin-bottom:16px">
        조건이 충족되면 자동으로 지정된 채널로 발송합니다.
      </p>
      <div style="display:flex;flex-direction:column;gap:10px">
        ${triggers.map(t => `
          <div style="border:1px solid var(--tok-line);border-radius:8px;padding:16px;opacity:${t.isActive ? 1 : 0.6}">
            <div style="display:flex;justify-content:space-between;align-items:flex-start">
              <div style="flex:1">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
                  <span style="font-weight:600;font-size:14px">${t.name}</span>
                  <span style="background:#f0f4ff;color:${channelColor[t.channel]};padding:2px 8px;border-radius:10px;font-size:11.5px">${channelLabel[t.channel] || t.channel}</span>
                  <span style="background:${t.isActive ? '#f0f9f3' : '#f5f5f5'};color:${t.isActive ? '#1a8b46' : '#888'};padding:2px 8px;border-radius:10px;font-size:11.5px;font-weight:600">
                    ${t.isActive ? '활성' : '비활성'}
                  </span>
                </div>
                <div style="font-size:12.5px;color:var(--tok-text-2);margin-bottom:4px">
                  <span style="font-weight:600">조건:</span> ${t.condition}
                </div>
                <div style="font-size:12.5px;color:var(--tok-text-2);margin-bottom:4px">
                  <span style="font-weight:600">템플릿:</span> ${t.templateName}
                </div>
                <div style="font-size:12px;color:var(--tok-text-3)">
                  총 발송 ${t.firedCount}회 · 마지막 발송: ${t.lastFiredAt}
                </div>
              </div>
              <div style="display:flex;gap:6px;margin-left:12px">
                <button class="btn-sm btn-sm-ghost" style="font-size:12px" onclick="alert('[mock] 편집')">편집</button>
                <button class="btn-sm btn-sm-ghost" style="font-size:12px;color:${t.isActive ? '#c5293a' : '#1a8b46'}"
                  onclick="alert('[mock] ${t.isActive ? '비활성화' : '활성화'}')">
                  ${t.isActive ? '비활성화' : '활성화'}
                </button>
              </div>
            </div>
          </div>`).join('')}
      </div>
      <p style="font-size:12px;color:var(--tok-text-3);margin-top:12px">총 ${triggers.length}개 트리거 (mock 데이터)</p>`;
  }

  /* ─── 진입점 ─── */
  function tryInit() {
    const container = document.getElementById('adm20-ai-recommend');
    if (!container) return;
    if (container.dataset.aiGroupInit) return;
    container.dataset.aiGroupInit = '1';
    init();
  }

  const obs = new MutationObserver(function (muts) {
    muts.forEach(function (m) {
      if (m.target && m.target.id === 'adm20-ai-recommend' && m.target.classList.contains('is-active')) {
        tryInit();
      }
    });
  });

  document.addEventListener('DOMContentLoaded', function () {
    const container = document.getElementById('adm20-ai-recommend');
    if (container) {
      obs.observe(container, { attributes: true, attributeFilter: ['class'] });
      if (container.classList.contains('is-active')) tryInit();
    }
  });

})();
