/* workspace-contract.js — 직원 '내 근로계약' (조회·서명·반려·부속서류) */
(function () {
  "use strict";

  async function api(url, opts) {
    opts = opts || {};
    const o = { method: opts.method || "GET", credentials: "include", headers: {} };
    if (opts.body) { o.headers["Content-Type"] = "application/json"; o.body = JSON.stringify(opts.body); }
    const r = await fetch(url, o);
    let data; try { data = await r.json(); } catch (_) { data = {}; }
    return { ok: r.ok, status: r.status, data };
  }
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  let _t; function toast(m, err) { const e = $("toast"); e.textContent = m; e.className = "toast show" + (err ? " err" : ""); clearTimeout(_t); _t = setTimeout(() => (e.className = "toast"), 2800); }
  const SL = { sent: "서명 대기", completed: "완료", rejected: "반려", voided: "무효" };
  const badge = (s) => `<span class="badge b-${s}">${SL[s] || s}</span>`;
  const fmtDT = (d) => { if (!d) return "—"; try { return new Date(d).toLocaleString("ko-KR"); } catch (_) { return "—"; } };

  const logoutBtn = $("wsBtnLogout");
  if (logoutBtn) logoutBtn.addEventListener("click", async () => { try { await api("/api/auth-logout", { method: "POST" }); } catch (_) {} location.href = "/login.html"; });

  /* ── 목록 ── */
  async function loadList() {
    const r = await api("/api/contract-my");
    const box = $("list");
    if (!r.ok) { box.innerHTML = `<div class="muted" style="text-align:center;padding:40px">${esc(r.data && r.data.error || "불러오기 실패 — 로그인이 필요할 수 있습니다")}</div>`; return; }
    const items = (r.data.data && r.data.data.items) || [];
    if (!items.length) { box.innerHTML = `<div class="muted" style="text-align:center;padding:50px">전달된 근로계약이 없습니다.</div>`; return; }
    box.innerHTML = items.map((c) => `
      <div class="wc-card" data-id="${c.id}">
        <div class="wc-card-top">
          <div class="wc-card-title">${esc(c.title || "근로계약서")} · ${esc(c.ent_name)}</div>
          ${badge(c.status)}
        </div>
        <div class="wc-card-meta">전달 ${fmtDT(c.sent_at)}${c.employee_signed_at ? " · 서명 " + fmtDT(c.employee_signed_at) : ""}${c.status === "sent" ? " · <b style='color:#2563eb'>서명이 필요합니다</b>" : ""}</div>
      </div>`).join("");
    box.querySelectorAll(".wc-card").forEach((el) => el.addEventListener("click", () => openDetail(el.dataset.id)));
  }

  /* ── 상세·서명 ── */
  let SIGN_MODE = "draw";
  async function openDetail(id) {
    const r = await api("/api/contract-my?id=" + id);
    if (!r.ok) { toast(r.data && r.data.error || "조회 실패", true); return; }
    const c = r.data.data;

    const canSign = c.status === "sent";
    const atts = (c.attachments || []).map((a) => `<div class="att-row">📎 ${esc(a.label || a.file_name || a.kind)}</div>`).join("") || '<div class="muted">첨부한 서류 없음</div>';

    let signArea = "";
    if (canSign) {
      signArea = `
        <div style="border-top:1px solid #eef0f4;margin-top:16px;padding-top:14px">
          <div style="font-weight:700;margin-bottom:4px">서명</div>
          <div class="muted">아래에서 방식을 고르고 서명하면 계약이 체결됩니다. 내용에 동의하지 않으면 반려할 수 있습니다.</div>
          <div style="margin:12px 0">
            <label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">주민등록번호 ${c.residentNoMask ? "(등록됨: " + esc(c.residentNoMask) + " · 바꾸려면 새로 입력)" : "(계약서에 표기됩니다)"}</label>
            <input id="sigResident" placeholder="${c.residentNoMask ? "그대로 두면 유지" : "000000-0000000"}" autocomplete="off" inputmode="numeric" style="padding:9px 11px;border:1px solid #d1d5db;border-radius:8px;width:100%;font-size:14px">
            <div class="muted" style="margin-top:3px">본인만 입력하며, 이후 화면에는 앞자리만 보이고 안전하게 암호화되어 보관됩니다.</div>
          </div>
          <div class="sign-tabs">
            <button class="sign-tab active" data-mode="draw">손글씨 서명</button>
            <button class="sign-tab" data-mode="type">성명 입력</button>
            <button class="sign-tab" data-mode="seal">도장 이미지</button>
          </div>
          <div id="signDraw"><canvas id="sigCanvas"></canvas><div style="margin-top:6px"><button class="btn btn-default btn-sm" id="sigClear">지우기</button></div></div>
          <div id="signType" style="display:none"><input id="sigName" placeholder="성명을 입력하세요" style="padding:10px;border:1px solid #d1d5db;border-radius:8px;width:100%;font-size:14px"></div>
          <div id="signSeal" style="display:none"><input type="file" id="sigSealFile" accept="image/png,image/jpeg"><div class="muted" style="margin-top:4px">본인 도장 이미지(PNG 권장)</div></div>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
            <button class="btn btn-danger" id="btnReject">반려</button>
            <button class="btn btn-primary" id="btnSign">동의하고 서명 완료</button>
          </div>
        </div>`;
    } else {
      const dl = (c.status === "completed") ? `<a class="btn btn-primary btn-sm" href="/api/contract-my-pdf?id=${c.id}" target="_blank">계약서 PDF 내려받기</a>` : "";
      signArea = `<div style="border-top:1px solid #eef0f4;margin-top:16px;padding-top:14px">
        ${c.status === "rejected" ? `<div class="muted">반려함: ${esc(c.rejectedReason || "")}</div>` : ""}
        ${c.status === "completed" ? `<div class="muted" style="margin-bottom:8px">${fmtDT(c.employeeSignedAt)}에 서명 완료</div>` : ""}
        ${dl}
        <div style="margin-top:14px"><div style="font-weight:700;margin-bottom:6px">부속 서류 (신분증·통장 사본 등)</div>${atts}
          <div style="margin-top:8px"><input type="file" id="attFile"><select id="attKind" style="padding:6px;border-radius:6px;border:1px solid #d1d5db;margin:0 6px"><option value="id_card">신분증 사본</option><option value="bankbook">통장 사본</option><option value="etc">기타</option></select><button class="btn btn-default btn-sm" id="btnAttach">첨부</button></div>
          <div class="muted" style="margin-top:4px">세금·4대보험 등록용. 회사(이사장)만 열람합니다.</div>
        </div>
      </div>`;
    }

    $("detailBody").innerHTML = `
      <div class="mhead"><strong>${esc(c.title || "근로계약서")} ${badge(c.status)}</strong><button class="x" id="dClose">&times;</button></div>
      <div class="muted" style="margin-bottom:8px">${esc(c.entityName)} · 대표 ${esc(c.entityRepresentative || "")}${c.companySignedAt ? " · 회사 날인 " + fmtDT(c.companySignedAt) : ""}</div>
      <div class="doc">${esc(c.bodySnapshot || "")}</div>
      ${signArea}`;
    $("detailModal").classList.add("open");
    $("dClose").addEventListener("click", () => $("detailModal").classList.remove("open"));

    if (canSign) setupSign(id);
    else setupAttach(id);
  }

  /* ── 서명 UI ── */
  function setupSign(id) {
    SIGN_MODE = "draw";
    document.querySelectorAll(".sign-tab").forEach((t) => t.addEventListener("click", () => {
      document.querySelectorAll(".sign-tab").forEach((x) => x.classList.remove("active"));
      t.classList.add("active"); SIGN_MODE = t.dataset.mode;
      $("signDraw").style.display = SIGN_MODE === "draw" ? "block" : "none";
      $("signType").style.display = SIGN_MODE === "type" ? "block" : "none";
      $("signSeal").style.display = SIGN_MODE === "seal" ? "block" : "none";
    }));

    const canvas = $("sigCanvas");
    const ctx = canvas.getContext("2d");
    function resize() { const r = canvas.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1; canvas.width = r.width * dpr; canvas.height = r.height * dpr; ctx.scale(dpr, dpr); ctx.lineWidth = 2.4; ctx.lineCap = "round"; ctx.strokeStyle = "#111"; }
    resize();
    let drawing = false, dirty = false;
    const pos = (e) => { const r = canvas.getBoundingClientRect(); const p = e.touches ? e.touches[0] : e; return { x: p.clientX - r.left, y: p.clientY - r.top }; };
    const down = (e) => { drawing = true; dirty = true; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); e.preventDefault(); };
    const move = (e) => { if (!drawing) return; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); e.preventDefault(); };
    const up = () => { drawing = false; };
    canvas.addEventListener("pointerdown", down); canvas.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    $("sigClear").addEventListener("click", () => { ctx.clearRect(0, 0, canvas.width, canvas.height); dirty = false; });

    $("btnReject").addEventListener("click", async () => {
      const reason = prompt("반려 사유를 입력하세요");
      if (!reason || reason.trim().length < 2) { toast("사유를 입력하세요", true); return; }
      const r = await api("/api/contract-my-sign", { method: "POST", body: { id, action: "reject", reason } });
      toast(r.ok ? "반려했습니다" : (r.data.error || "실패"), !r.ok);
      if (r.ok) { $("detailModal").classList.remove("open"); loadList(); }
    });

    $("btnSign").addEventListener("click", async () => {
      const body = { id, action: "sign", signatureType: SIGN_MODE };
      const rn = ($("sigResident") && $("sigResident").value || "").trim();
      if (rn) body.residentNo = rn;
      if (SIGN_MODE === "draw") {
        if (!dirty) { toast("서명란에 서명해 주세요", true); return; }
        body.signaturePng = canvas.toDataURL("image/png");
      } else if (SIGN_MODE === "type") {
        const n = $("sigName").value.trim(); if (!n) { toast("성명을 입력하세요", true); return; }
        body.signedName = n;
      } else if (SIGN_MODE === "seal") {
        const f = $("sigSealFile").files[0]; if (!f) { toast("도장 이미지를 선택하세요", true); return; }
        body.signaturePng = await fileToDataUrl(f);
      }
      if (!confirm("계약 내용에 동의하고 서명하시겠습니까?")) return;
      const r = await api("/api/contract-my-sign", { method: "POST", body });
      toast(r.ok ? "서명이 완료되었습니다" : (r.data.error || "실패"), !r.ok);
      if (r.ok) { $("detailModal").classList.remove("open"); loadList(); }
    });
  }

  /* ── 부속서류 업로드 (blob-presign 3단계) ── */
  function setupAttach(id) {
    const btn = $("btnAttach"); if (!btn) return;
    btn.addEventListener("click", async () => {
      const f = $("attFile").files[0]; if (!f) { toast("파일을 선택하세요", true); return; }
      const kind = $("attKind").value;
      btn.disabled = true; btn.textContent = "업로드 중…";
      try {
        const pre = await api("/api/blob-presign", { method: "POST", body: { originalName: f.name, mimeType: f.type || "application/octet-stream", sizeBytes: f.size, context: "contract-doc" } });
        const pd = pre.data.data || pre.data;
        if (!pre.ok || !pd || !pd.uploadUrl) { toast("업로드 준비 실패: " + (pre.data.error || ""), true); return; }
        const put = await fetch(pd.uploadUrl, { method: "PUT", headers: { "Content-Type": f.type || "application/octet-stream" }, body: f });
        if (!put.ok) { toast("파일 전송 실패", true); return; }
        await api("/api/blob-confirm", { method: "POST", body: { id: pd.id } });
        const link = await api("/api/contract-my-attach", { method: "POST", body: { contractId: Number(id), blobId: pd.id, blobKey: pd.key, fileName: f.name, mimeType: f.type, sizeBytes: f.size, kind } });
        toast(link.ok ? "서류를 첨부했습니다" : (link.data.error || "첨부 실패"), !link.ok);
        if (link.ok) openDetail(id);
      } catch (e) { toast("업로드 오류", true); }
      finally { btn.disabled = false; btn.textContent = "첨부"; }
    });
  }

  function fileToDataUrl(f) { return new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(f); }); }

  loadList();
})();
