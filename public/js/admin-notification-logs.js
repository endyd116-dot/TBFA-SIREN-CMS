/* admin-notification-logs.js — Phase 8 C: 알림 발송 로그 어드민 화면 */
(function () {
  "use strict";

  const CHANNEL_LABEL = { inapp: "인앱", email: "이메일", sms: "SMS", kakao: "알림톡" };
  const STATUS_LABEL = { pending: "대기", sent: "성공", failed: "실패", dead: "사망" };
  const STATUS_COLOR = { pending: "#999", sent: "#1aa37a", failed: "#e89c1f", dead: "#d04141" };

  let topErrorChart = null;
  let currentPage = 1;

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }
  function fmtDate(s) {
    if (!s) return "-";
    const d = new Date(s);
    return d.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false });
  }
  function fmtMs(ms) {
    if (ms == null) return "-";
    if (ms < 1000) return ms + "ms";
    return (ms / 1000).toFixed(2) + "s";
  }

  function api(url) {
    return fetch(url, { credentials: "include" })
      .then(r => r.json())
      .catch(e => ({ ok: false, error: String(e) }));
  }

  function renderShell(container) {
    container.innerHTML = `
      <div class="panel">
        <h2>알림 발송 로그</h2>
        <div class="filter-bar" style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0;">
          <label>기간 시작 <input type="date" id="nlFrom"></label>
          <label>기간 종료 <input type="date" id="nlTo"></label>
          <label>채널
            <select id="nlChannel">
              <option value="all">전체</option>
              <option value="inapp">인앱</option>
              <option value="email">이메일</option>
              <option value="sms">SMS</option>
              <option value="kakao">알림톡</option>
            </select>
          </label>
          <label>상태
            <select id="nlStatus">
              <option value="all">전체</option>
              <option value="pending">대기</option>
              <option value="sent">성공</option>
              <option value="failed">실패</option>
              <option value="dead">사망</option>
            </select>
          </label>
          <label>이벤트
            <select id="nlEvent">
              <option value="all">전체</option>
              <option value="billing.success">빌링 성공</option>
              <option value="billing.failed">빌링 실패</option>
              <option value="billing.canceled">빌링 취소</option>
              <option value="card.expiring">카드 만료</option>
              <option value="workspace.activity">워크스페이스</option>
              <option value="admin.daily_briefing">일일 브리핑</option>
              <option value="support.reply">지원 답변</option>
              <option value="siren.assigned">사이렌 배정</option>
              <option value="member.eligibility_decided">자격 판정</option>
            </select>
          </label>
          <button id="nlReload" class="btn">조회</button>
        </div>
      </div>
      <div class="kpi-grid" id="nlKpi" style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:12px 0;"></div>
      <div class="panel" style="margin:12px 0;">
        <h3 style="margin:0 0 8px 0;">실패 사유 상위 5</h3>
        <div style="max-width:480px;"><canvas id="nlTopErrorChart" height="240"></canvas></div>
        <div id="nlTopErrorLegend" style="margin-top:8px;font-size:0.9em;color:#555;"></div>
      </div>
      <div class="panel">
        <h3 style="margin:0 0 8px 0;">발송 로그 (최근 24시간 기본)</h3>
        <div style="overflow-x:auto;">
          <table class="basic-table" id="nlTable" style="width:100%;border-collapse:collapse;">
            <thead><tr>
              <th>시각</th><th>이벤트</th><th>대상</th><th>채널</th>
              <th>상태</th><th>시도</th><th>지연</th><th>에러</th>
            </tr></thead>
            <tbody id="nlTbody"><tr><td colspan="8" style="text-align:center;padding:20px;">로딩 중…</td></tr></tbody>
          </table>
        </div>
        <div id="nlPagination" style="margin-top:12px;text-align:center;"></div>
      </div>
    `;
  }

  function renderKpi(byChannel) {
    const order = ["inapp", "email", "sms", "kakao"];
    const html = order.map(key => {
      const c = byChannel[key] || { total: 0, sent: 0, failed: 0, dead: 0, pending: 0, successRate: 0, avgLatencyMs: 0 };
      const isPlaceholder = key === "sms" || key === "kakao";
      return `
        <div class="card" style="border:1px solid #ddd;border-radius:8px;padding:12px;">
          <div style="font-size:0.85em;color:#666;">${CHANNEL_LABEL[key]}${isPlaceholder ? ' <span style="color:#999;">(placeholder)</span>' : ''}</div>
          <div style="font-size:1.4em;font-weight:bold;margin:4px 0;">${c.total.toLocaleString()}건</div>
          <div style="font-size:0.85em;">
            성공률 <strong>${c.successRate}%</strong> · 평균 ${fmtMs(c.avgLatencyMs)}
          </div>
          <div style="font-size:0.8em;color:#888;margin-top:4px;">
            성공 ${c.sent} · 실패 ${c.failed} · 사망 ${c.dead} · 대기 ${c.pending}
          </div>
        </div>
      `;
    }).join("");
    document.getElementById("nlKpi").innerHTML = html;
  }

  function renderTable(items) {
    const tbody = document.getElementById("nlTbody");
    if (!items || items.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:20px;color:#999;">선택한 조건의 발송 로그가 없습니다.</td></tr>';
      return;
    }
    tbody.innerHTML = items.map(r => `
      <tr>
        <td>${fmtDate(r.created_at)}</td>
        <td>${escapeHtml(r.event_type)}</td>
        <td>${escapeHtml(r.target_type)}#${r.target_id}</td>
        <td>${CHANNEL_LABEL[r.channel] || r.channel}</td>
        <td><span style="color:${STATUS_COLOR[r.status] || '#000'};font-weight:bold;">${STATUS_LABEL[r.status] || r.status}</span></td>
        <td class="num">${r.attempt}</td>
        <td class="num">${fmtMs(r.latency_ms)}</td>
        <td style="color:#a33;font-size:0.85em;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(r.error || '')}">${escapeHtml(r.error || '-')}</td>
      </tr>
    `).join("");
  }

  function renderTopErrorChart(topErrors) {
    const legend = document.getElementById("nlTopErrorLegend");
    if (!topErrors || topErrors.length === 0) {
      if (topErrorChart) { topErrorChart.destroy(); topErrorChart = null; }
      const canvas = document.getElementById("nlTopErrorChart");
      const ctx = canvas?.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      legend.innerHTML = '<span style="color:#999;">실패·사망 없음</span>';
      return;
    }
    const labels = topErrors.map(e => e.error.length > 30 ? e.error.slice(0, 30) + "…" : e.error);
    const counts = topErrors.map(e => e.count);
    const colors = ["#d04141", "#e89c1f", "#f4ce5e", "#7da9c4", "#9b8fc7"];
    if (topErrorChart) topErrorChart.destroy();
    if (typeof Chart === "undefined") {
      legend.innerHTML = '<span style="color:#999;">Chart.js 미로드 — 텍스트로 표시</span>';
      legend.innerHTML += topErrors.map((e, i) => `<div>${i+1}. ${escapeHtml(e.error)} (${e.count}건)</div>`).join("");
      return;
    }
    const ctx = document.getElementById("nlTopErrorChart").getContext("2d");
    topErrorChart = new Chart(ctx, {
      type: "doughnut",
      data: { labels, datasets: [{ data: counts, backgroundColor: colors.slice(0, labels.length) }] },
      options: { plugins: { legend: { position: "bottom", labels: { font: { size: 11 } } } } },
    });
    legend.innerHTML = "";
  }

  function renderPagination(page, totalPages) {
    const div = document.getElementById("nlPagination");
    if (!totalPages || totalPages <= 1) { div.innerHTML = ""; return; }
    const prev = page > 1 ? `<button class="btn" data-pg="${page - 1}">◀ 이전</button>` : "";
    const next = page < totalPages ? `<button class="btn" data-pg="${page + 1}">다음 ▶</button>` : "";
    div.innerHTML = `${prev} <span style="margin:0 12px;">${page} / ${totalPages}</span> ${next}`;
    div.querySelectorAll("button[data-pg]").forEach(btn =>
      btn.addEventListener("click", () => { currentPage = Number(btn.dataset.pg); load(); })
    );
  }

  function buildQs() {
    const from = document.getElementById("nlFrom")?.value;
    const to = document.getElementById("nlTo")?.value;
    const channel = document.getElementById("nlChannel")?.value || "all";
    const status = document.getElementById("nlStatus")?.value || "all";
    const eventType = document.getElementById("nlEvent")?.value || "all";
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (channel !== "all") params.set("channel", channel);
    if (status !== "all") params.set("status", status);
    if (eventType !== "all") params.set("event_type", eventType);
    params.set("page", String(currentPage));
    return "?" + params.toString();
  }

  async function load() {
    const res = await api("/api/admin-notification-logs" + buildQs());
    if (!res.ok) {
      const tbody = document.getElementById("nlTbody");
      if (tbody) tbody.innerHTML = `<tr><td colspan="8" style="color:#a33;padding:20px;">조회 실패: ${escapeHtml(res.error || res.detail || "알 수 없음")}</td></tr>`;
      return;
    }
    const d = res.data || res;
    renderKpi(d.kpi?.byChannel || {});
    renderTopErrorChart(d.kpi?.topErrors || []);
    renderTable(d.items || []);
    renderPagination(d.page || 1, d.totalPages || 1);
  }

  function init() {
    const container = document.getElementById("adm-notification-logs");
    if (!container) return;
    if (container.dataset.inited === "1") return;
    container.dataset.inited = "1";
    renderShell(container);
    document.getElementById("nlReload")?.addEventListener("click", () => { currentPage = 1; load(); });
  }

  function loadEntry() {
    init();
    currentPage = 1;
    load();
  }

  window.SIREN_NOTIFICATION_LOGS = { load: loadEntry, init };
})();
