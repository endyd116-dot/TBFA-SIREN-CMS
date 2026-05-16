// public/js/admin-send-analytics.js
// Phase 10 R4 — 발송 분석 대시보드

(function () {
  "use strict";

  const CHANNEL_LABEL = { email: "이메일", sms: "SMS", kakao: "카카오", inapp: "인앱" };

  let trendChartInstance = null;

  function $(id) { return document.getElementById(id); }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  function fmtNum(n) { return n == null ? "—" : Number(n).toLocaleString(); }
  function fmtRate(n) { return n == null ? "—" : Number(n).toFixed(1) + "%"; }

  async function api({ url }) {
    try {
      if (typeof window.adminApi === "function") return await window.adminApi({ url });
      if (typeof window.api === "function")      return await window.api({ url });
      const r = await fetch(url, { credentials: "include" });
      const data = await r.json().catch(() => ({}));
      return { ok: r.ok, status: r.status, data };
    } catch (err) {
      return { ok: false, data: { error: String(err) } };
    }
  }

  function showToast(msg, type = "") {
    const el = $("toast");
    el.textContent = msg;
    el.className = "toast" + (type ? " " + type : "");
    el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 3500);
  }

  function getDateRange() {
    const period = $("periodSelect").value;
    if (period === "custom") {
      return { from: $("fromDate").value, to: $("toDate").value };
    }
    const now = new Date();
    const to  = now.toISOString().slice(0, 10);
    const past = new Date(now);
    past.setDate(past.getDate() - Number(period));
    return { from: past.toISOString().slice(0, 10), to };
  }

  window.loadAll = async function () {
    const { from, to } = getDateRange();
    if (!from || !to) { showToast("날짜를 선택해 주세요.", "error"); return; }

    const [ovRes, chRes] = await Promise.all([
      api({ url: `/api/admin-send-analytics-overview?from=${from}&to=${to}` }),
      api({ url: `/api/admin-send-analytics-channel?from=${from}&to=${to}` }),
    ]);

    /* ★ 2026-05-16 (2차): API 실패 시 detail(서버 SQL 에러 본문)까지 합쳐 표시.
       이전 fix는 error 또는 detail 중 하나만 → '발송 통계 조회 실패: 발송 통계
       조회 실패' 같은 무의미 출력. 둘을 합쳐 진짜 원인이 화면에 노출되도록. */
    if (!ovRes.ok) {
      const err = ovRes.data && ovRes.data.error;
      const det = ovRes.data && ovRes.data.detail;
      const stp = ovRes.data && ovRes.data.step;
      const parts = [];
      if (err) parts.push(err);
      if (stp) parts.push('[' + stp + ']');
      if (det) parts.push(det);
      const msg = parts.length ? parts.join(' ') : ('HTTP ' + (ovRes.status || '?'));
      console.error('[send-analytics] overview API 실패:', ovRes.data);
      showToast('발송 통계 조회 실패: ' + msg, 'error');
      const errHtml = '<p class="empty" style="color:#b91c1c;white-space:pre-wrap">조회 실패\n' + escapeHtml(msg) + '</p>';
      $("trendEmpty").style.display = 'block';
      $("trendEmpty").textContent = '조회 실패: ' + msg;
      $("channelBody").innerHTML = '<tr><td colspan="6" class="empty" style="color:#b91c1c;white-space:pre-wrap">조회 실패\n' + escapeHtml(msg) + '</td></tr>';
      $("topJobsList").innerHTML = errHtml;
      $("triggerEffectList").innerHTML = errHtml;
      return;
    }

    const ov = ovRes.data?.overview || ovRes.data?.data?.overview || ovRes.data || {};
    const ch = chRes.ok
      ? (chRes.data?.channels || chRes.data?.data?.channels || chRes.data?.byChannel || ov.byChannel || {})
      : (ov.byChannel || {});

    /* ★ 2026-05-16 (3차): 200 응답이지만 일부 쿼리 실패한 경우 _errors 표시 */
    const errs = [];
    if (ovRes.data && Array.isArray(ovRes.data._errors)) errs.push(...ovRes.data._errors);
    if (chRes.data && Array.isArray(chRes.data._errors)) errs.push(...chRes.data._errors);
    if (errs.length) {
      console.warn('[send-analytics] 부분 실패:', errs);
      const msg = errs.map(e => '[' + e.step + '] ' + e.detail).join(' | ');
      showToast('일부 데이터 누락: ' + msg, 'error');
    }

    renderKPI(ov);
    renderTrendChart(ov.trend || []);
    renderChannelTable(ch);
    renderTopJobs(ov.topJobs || []);
    renderTriggerEffect(ov.aiTriggerEffect || ov.triggerEffect || []);
  };

  function renderKPI(ov) {
    $("kpiJobs").textContent      = fmtNum(ov.total_jobs ?? ov.totalJobs);
    $("kpiRecipients").textContent = fmtNum(ov.total_recipients ?? ov.totalRecipients);

    const delivRate = ov.deliveryRate ?? ov.delivery_rate;
    $("kpiDelivery").textContent  = delivRate != null ? fmtRate(delivRate) : "—";
    $("kpiDeliverySub").textContent = ov.delivered ? `${fmtNum(ov.delivered)}명 전송 성공` : "";

    const openRate  = ov.openRate  ?? ov.open_rate;
    const clickRate = ov.clickRate ?? ov.click_rate;
    $("kpiOpen").textContent   = openRate != null ? fmtRate(openRate) : "—";
    $("kpiOpenSub").textContent = clickRate != null ? `클릭률 ${fmtRate(clickRate)}` : "";
  }

  function renderTrendChart(trend) {
    const canvas  = $("trendChart");
    const emptyEl = $("trendEmpty");

    if (!trend.length) {
      canvas.style.display  = "none";
      emptyEl.style.display = "block";
      return;
    }
    canvas.style.display  = "";
    emptyEl.style.display = "none";

    const labels  = trend.map(d => d.date);
    const sent    = trend.map(d => d.sent    ?? 0);
    const opened  = trend.map(d => d.opened  ?? 0);
    const clicked = trend.map(d => d.clicked ?? 0);

    if (trendChartInstance) trendChartInstance.destroy();

    trendChartInstance = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          { label: "발송", data: sent,    borderColor: "#3b82f6", backgroundColor: "rgba(59,130,246,.08)", tension: .3, fill: true },
          { label: "열람", data: opened,  borderColor: "#22c55e", backgroundColor: "rgba(34,197,94,.08)",  tension: .3, fill: true },
          { label: "클릭", data: clicked, borderColor: "#f59e0b", backgroundColor: "rgba(245,158,11,.08)", tension: .3, fill: false },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: "top" } },
        scales: {
          x: { ticks: { maxTicksLimit: 14, font: { size: 11 } } },
          y: { beginAtZero: true, ticks: { font: { size: 11 } } },
        },
      },
    });
  }

  function renderChannelTable(ch) {
    const channels = typeof ch === "object" && !Array.isArray(ch)
      ? Object.entries(ch).map(([key, val]) => ({ channel: key, ...val }))
      : (Array.isArray(ch) ? ch : []);

    $("channelBody").innerHTML = channels.length
      ? channels.map(c => `
          <tr>
            <td><span class="badge-ch">${escapeHtml(CHANNEL_LABEL[c.channel] || c.channel)}</span></td>
            <td>${fmtNum(c.sent)}</td>
            <td>${fmtNum(c.delivered ?? c.sent)}</td>
            <td>${c.openRate != null ? fmtRate(c.openRate) : "—"}</td>
            <td>${c.clickRate != null ? fmtRate(c.clickRate) : "—"}</td>
            <td style="color:${(c.failed || 0) > 0 ? '#b91c1c' : '#94a3b8'}">${fmtNum(c.failed ?? 0)}</td>
          </tr>
        `).join("")
      : `<tr><td colspan="6" class="empty">데이터 없음</td></tr>`;
  }

  function renderTopJobs(jobs) {
    if (!jobs.length) {
      $("topJobsList").innerHTML = `<p class="empty">데이터가 없습니다.</p>`;
      return;
    }
    $("topJobsList").innerHTML = jobs.slice(0, 10).map((j, i) => `
      <div class="trigger-stat">
        <span>${i + 1}. ${escapeHtml(j.jobName || j.name || "-")}</span>
        <span style="font-weight:600;color:#1e40af">${j.openRate != null ? fmtRate(j.openRate) : "—"}</span>
      </div>
    `).join("");
  }

  function renderTriggerEffect(effects) {
    if (!effects.length) {
      $("triggerEffectList").innerHTML = `<p class="empty">AI 트리거 발송 이력이 없습니다.</p>`;
      return;
    }
    $("triggerEffectList").innerHTML = effects.map(e => `
      <div class="trigger-stat">
        <span>${escapeHtml(e.triggerName || e.name || "-")}</span>
        <span style="font-size:0.82rem;color:#64748b">
          발송 ${fmtNum(e.sent)}명 / 열람 ${fmtNum(e.opened)}명
          ${e.openRate != null ? `(${fmtRate(e.openRate)})` : ""}
        </span>
      </div>
    `).join("");
  }

  /* ── 기간 셀렉트 변경 ── */
  $("periodSelect").addEventListener("change", function () {
    const cr = $("customRange");
    if (this.value === "custom") {
      cr.classList.add("show");
    } else {
      cr.classList.remove("show");
      loadAll();
    }
  });

  loadAll();
})();
