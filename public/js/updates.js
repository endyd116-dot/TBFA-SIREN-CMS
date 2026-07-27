/* updates.js — 업데이트 소식 전용 페이지 (목록 + 상세) */
(function () {
  "use strict";
  async function api(url) {
    const r = await fetch(url, { credentials: "include" });
    let d; try { d = await r.json(); } catch (_) { d = {}; }
    return { ok: r.ok, status: r.status, data: d };
  }
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const fmtDate = (d) => { if (!d) return ""; try { const x = new Date(d); return x.getFullYear() + "." + (x.getMonth() + 1) + "." + x.getDate(); } catch (_) { return ""; } };
  function mdToHtml(md) {
    if (!md) return "";
    try { if (window.marked) return window.marked.parse(String(md)); } catch (_) {}
    return "<p>" + esc(md).replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br>") + "</p>";
  }
  function firstLine(md) {
    const t = String(md || "").replace(/[#*>`_!\[\]()]/g, "").replace(/\s+/g, " ").trim();
    return t.slice(0, 120);
  }

  /* 목록 */
  async function loadList() {
    $("backBtn").style.display = "none";
    $("lead").textContent = "싸이렌의 새 기능과 개선 사항을 확인하세요.";
    const r = await api("/api/release-notes?list=1&published=1&limit=50");
    if (!r.ok) {
      $("content").innerHTML = r.status === 401 || r.status === 403
        ? `<div class="err">로그인이 필요합니다. <a href="/login.html">로그인하기</a></div>`
        : `<div class="err">${esc(r.data && r.data.error || "불러오기 실패")}</div>`;
      return;
    }
    const items = (r.data.data && r.data.data.items) || r.data.items || [];
    if (!items.length) { $("content").innerHTML = `<div class="empty">아직 등록된 소식이 없습니다.</div>`; return; }
    $("content").innerHTML = items.map((n) => `
      <a class="card" href="#${n.id}">
        ${n.heroImageUrl ? `<img class="card-hero" src="${esc(n.heroImageUrl)}" alt="" onerror="this.style.display='none'">` : ""}
        <div class="card-body">
          <div class="card-title">${esc(n.title)}</div>
          <div class="card-meta">${fmtDate(n.publishedAt || n.createdAt)}${Array.isArray(n.items) && n.items.length ? " · 변경 " + n.items.length + "건" : ""}</div>
          ${n.body ? `<div class="card-excerpt">${esc(firstLine(n.body))}</div>` : ""}
        </div>
      </a>`).join("");
  }

  /* 상세 */
  async function loadDetail(id) {
    $("content").innerHTML = `<div class="loading">불러오는 중…</div>`;
    const r = await api("/api/release-notes?id=" + encodeURIComponent(id));
    if (!r.ok) {
      $("content").innerHTML = `<div class="err">${esc(r.data && r.data.error || "소식을 찾을 수 없습니다")}</div>`;
      $("backBtn").style.display = "inline-block";
      return;
    }
    const n = r.data.data || r.data;
    $("backBtn").style.display = "inline-block";
    $("lead").textContent = "";
    const items = Array.isArray(n.items) ? n.items : [];
    $("content").innerHTML = `
      ${n.heroImageUrl ? `<img class="detail-hero" src="${esc(n.heroImageUrl)}" alt="" onerror="this.style.display='none'">` : ""}
      <div class="detail-title">${esc(n.title)}</div>
      <div class="detail-meta">${fmtDate(n.publishedAt || n.createdAt)}</div>
      <div class="detail-body">${n.body ? mdToHtml(n.body) : '<p style="color:#9ca3af">상세 소개가 아직 작성되지 않았습니다.</p>'}</div>
      ${items.length ? `<div class="highlights"><h4>이번 변경 사항</h4><ul>${items.map((it) => `<li>${esc(it.text)}${it.link ? ` <a href="${esc(it.link)}">바로가기 →</a>` : ""}</li>`).join("")}</ul></div>` : ""}
    `;
    window.scrollTo(0, 0);
  }

  function route() {
    const id = location.hash.replace(/^#/, "").trim();
    if (id && /^\d+$/.test(id)) loadDetail(id);
    else loadList();
  }
  $("backBtn").addEventListener("click", () => { location.hash = ""; });
  window.addEventListener("hashchange", route);
  route();
})();
