// public/js/admin-template-edit.js
// Phase 10 R1 — 발송 템플릿 신규/수정 + 미리보기

(function () {
  "use strict";

  function $(id) { return document.getElementById(id); }
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  /* ── 상태 ── */
  const params = new URLSearchParams(location.search);
  const editId = params.get("id");
  let isEdit = !!editId;

  /* ★ 2026-05-17: 이미지 첨부 상태 — 템플릿 저장 시 페이로드에 포함 */
  let templateImages = [];

  /* ── api 헬퍼 ── */
  async function api({ method = "GET", url, body }) {
    try {
      if (typeof window.adminApi === "function") return await window.adminApi({ method, url, body });
      if (typeof window.api === "function")      return await window.api({ method, url, body });
      const opts = {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      };
      if (body !== undefined) opts.body = JSON.stringify(body);
      const r = await fetch(url, opts);
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

  /* ★ 2026-05-17: 자주 쓰는 변수 카테고리별 카탈로그.
     운영자가 키·라벨·샘플을 직접 입력하지 않고 클릭 한 번에 추가.
     알리고 카카오 변수 표기(#{회원이름})와 우리 시스템({{회원이름}}) 둘 다
     지원되도록 한글 키 그대로 채택. */
  const VAR_PRESETS = {
    "회원 정보": [
      { key: "회원이름",   label: "회원 이름",       sample: "박두용" },
      { key: "회원ID",     label: "회원 아이디(이메일)", sample: "donor@tbfa.co.kr" },
      { key: "회원번호",   label: "회원 번호",       sample: "12345" },
      { key: "이메일",     label: "회원 이메일",     sample: "donor@tbfa.co.kr" },
      { key: "연락처",     label: "회원 연락처",     sample: "010-1234-5678" },
      { key: "가입일",     label: "가입일",          sample: "2025-03-15" },
      { key: "회원유형",   label: "회원 유형(정기/일시/잠재)", sample: "정기 후원자" },
      { key: "회원등급",   label: "회원 등급",       sample: "골드" },
    ],
    "후원·결제": [
      { key: "금액",         label: "후원 금액",        sample: "30,000" },
      { key: "출금금액",     label: "이번 회차 출금 금액", sample: "30,000" },
      { key: "출금예정일",   label: "출금 예정일",       sample: "2026-06-01" },
      { key: "출금일시",     label: "출금 완료 일시",     sample: "2026-05-15 09:00" },
      { key: "결제수단",     label: "결제 수단",         sample: "신한카드" },
      { key: "카드번호뒷자리", label: "카드 번호 뒷 4자리", sample: "4321" },
      { key: "카드만료일",   label: "카드 만료일",       sample: "2026-08" },
      { key: "잔여일수",     label: "카드 만료 잔여 일수", sample: "30" },
      { key: "누적후원금액", label: "누적 후원 금액",     sample: "360,000" },
      { key: "연간후원금액", label: "연간 후원 총액",     sample: "360,000" },
      { key: "실패사유",     label: "결제 실패 사유",     sample: "한도초과" },
      { key: "연속실패횟수", label: "연속 결제 실패 횟수", sample: "1" },
      { key: "재시도일자",   label: "다음 결제 재시도 일자", sample: "2026-05-22" },
    ],
    "후원 정보 변경": [
      { key: "변경항목",   label: "변경 항목",     sample: "결제수단" },
      { key: "변경전내용", label: "변경 전 내용",   sample: "현대카드 9999" },
      { key: "변경후내용", label: "변경 후 내용",   sample: "신한카드 4321" },
      { key: "처리일시",   label: "처리 일시",     sample: "2026-05-16 14:30" },
    ],
    "영수증": [
      { key: "영수증종류",   label: "영수증 종류",     sample: "기부금영수증" },
      { key: "발급가능기간", label: "발급 가능 기간",   sample: "2027-01-01 ~ 2027-01-31" },
      { key: "발급일자",     label: "발급 일자",       sample: "2027-01-15" },
    ],
    "SIREN 신고": [
      { key: "신고번호",   label: "신고 번호",       sample: "SR-2026-001" },
      { key: "신고유형",   label: "신고 유형",       sample: "사건·사고" },
      { key: "신고일자",   label: "신고 접수 일자",   sample: "2026-05-16" },
      { key: "처리상태",   label: "현재 처리 상태",   sample: "검토 중" },
      { key: "담당자",     label: "담당자 이름",     sample: "김상담" },
      { key: "처리완료일", label: "처리 완료 일자",   sample: "2026-05-20" },
    ],
    "협회 정보": [
      { key: "협회명",       label: "협회 이름",       sample: "교사유가족협의회" },
      { key: "협회연락처",   label: "협회 대표 전화",   sample: "02-707-2072" },
      { key: "협회이메일",   label: "협회 대표 이메일", sample: "contact@tbfa.co.kr" },
      { key: "협회주소",     label: "협회 주소",       sample: "서울특별시 강서구 공항대로 426 VIP오피스텔 618호" },
      { key: "대표자명",     label: "대표자 이름",     sample: "홍길동" },
      { key: "사업자번호",   label: "사업자등록번호",   sample: "118-82-71215" },
    ],
    "일자·기타": [
      { key: "오늘날짜",     label: "오늘 날짜",       sample: "2026-05-17" },
      { key: "현재시각",     label: "현재 시각",       sample: "14:30" },
      { key: "연도",         label: "올해 연도",       sample: "2026" },
      { key: "월",           label: "이번 달",         sample: "5" },
      { key: "발송일자",     label: "발송 일자",       sample: "2026-05-17" },
    ],
  };

  /* 프리셋 모달 열기 — 이미 정의된 변수는 회색 + 클릭 불가 */
  function openVarPresetModal() {
    const defined = new Set(readVariables().map(v => v.key));
    let html = "";
    for (const [cat, items] of Object.entries(VAR_PRESETS)) {
      html += `<div style="margin-bottom:16px"><div style="font-size:14px;font-weight:700;color:#374151;margin-bottom:8px;padding-bottom:4px;border-bottom:2px solid #e5e7eb">${escapeHtml(cat)}</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">`;
      for (const v of items) {
        const isDefined = defined.has(v.key);
        const styleBg = isDefined ? "#f3f4f6;color:#9ca3af;cursor:not-allowed" : "#fff;color:#1f2937;cursor:pointer";
        const styleBorder = isDefined ? "#e5e7eb" : "#d1d5db";
        html += `<button type="button" class="var-preset-btn" data-key="${escapeHtml(v.key)}" data-label="${escapeHtml(v.label)}" data-sample="${escapeHtml(v.sample)}" ${isDefined ? "disabled" : ""} style="text-align:left;padding:8px 12px;background:${styleBg};border:1px solid ${styleBorder};border-radius:6px;font-size:12.5px"><div style="font-weight:600">${escapeHtml(v.label)}${isDefined ? " ✓" : ""}</div><div style="font-size:11px;color:#6b7280;margin-top:2px">{{${escapeHtml(v.key)}}} <span style="opacity:.6">— ${escapeHtml(v.sample)}</span></div></button>`;
      }
      html += `</div></div>`;
    }
    $("varPresetBody").innerHTML = html;
    $("varPresetModal").style.display = "flex";
    $("varPresetBody").querySelectorAll(".var-preset-btn:not([disabled])").forEach(btn => {
      btn.addEventListener("click", () => {
        addVarRow({ key: btn.dataset.key, label: btn.dataset.label, sample: btn.dataset.sample });
        btn.disabled = true;
        btn.style.background = "#f3f4f6";
        btn.style.color = "#9ca3af";
        btn.style.cursor = "not-allowed";
        const titleEl = btn.querySelector("div");
        if (titleEl && !titleEl.textContent.endsWith(" ✓")) titleEl.textContent += " ✓";
      });
    });
  }
  function closeVarPresetModal() { $("varPresetModal").style.display = "none"; }

  /* ★ 2026-05-17: 이미지 첨부 — 업로드·미리보기·크기/정렬/위치/순서 조절 */
  async function uploadTemplateImage(file) {
    const statusEl = $("imageUploadStatus");
    if (templateImages.length >= 20) {
      statusEl.textContent = "이미지는 최대 20개까지";
      statusEl.style.color = "#b91c1c";
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      statusEl.textContent = "이미지는 5MB 이하만 가능";
      statusEl.style.color = "#b91c1c";
      return;
    }
    statusEl.textContent = "업로드 중…";
    statusEl.style.color = "#6b7280";

    const fd = new FormData();
    fd.append("file", file);
    fd.append("context", "template_image");
    fd.append("isPublic", "true");
    try {
      const res = await fetch("/api/blob-upload", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const raw = await res.json().catch(() => ({}));
      /* ★ 2026-05-17: blob-upload는 ok() 헬퍼로 wrap → {ok, message, data:{url, blobKey, ...}}.
         data.data.url을 우선 + data.url을 fallback (다른 응답 형태 안전망). */
      const payload = raw?.data ?? raw ?? {};
      const relativeUrl = payload.url || raw.url || "";
      if (!res.ok || !relativeUrl) {
        const detail = raw.error || raw.message || ("HTTP " + res.status);
        statusEl.textContent = "업로드 실패: " + detail;
        statusEl.style.color = "#b91c1c";
        return;
      }
      /* ★ 2026-05-17: 이메일에 박힐 때 절대 URL이어야 외부에서 접근 가능 →
         상대 경로면 window.location.origin과 결합. */
      const absoluteUrl = relativeUrl.startsWith("http")
        ? relativeUrl
        : new URL(relativeUrl, window.location.origin).href;
      templateImages.push({
        url: absoluteUrl,
        blobKey: payload.blobKey || raw.blobKey || "",
        name: file.name,
        width: 600,
        align: "center",
        position: "above",
        order: templateImages.length,
        alt: "",
      });
      statusEl.textContent = "✓ 업로드 완료";
      statusEl.style.color = "#166534";
      renderImagesList();
    } catch (err) {
      statusEl.textContent = "업로드 실패: " + String(err.message || err);
      statusEl.style.color = "#b91c1c";
    }
  }

  function renderImagesList() {
    const wrap = $("imagesList");
    if (!wrap) return;
    if (!templateImages.length) {
      wrap.innerHTML = `<div style="padding:20px;text-align:center;color:#9ca3af;border:1px dashed #d1d5db;border-radius:8px">첨부된 이미지가 없습니다. 위 [이미지 업로드] 버튼으로 추가하세요.</div>`;
      return;
    }
    /* order로 정렬 */
    const sorted = templateImages.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    wrap.innerHTML = sorted.map((img, idx) => {
      const realIdx = templateImages.indexOf(img);
      return `
        <div style="display:flex;gap:12px;padding:12px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px" data-img-idx="${realIdx}">
          <img src="${escapeHtml(img.url)}" alt="${escapeHtml(img.alt || '')}" style="width:120px;height:90px;object-fit:cover;border-radius:6px;border:1px solid #d1d5db;background:#fff">
          <div style="flex:1;display:flex;flex-direction:column;gap:6px">
            <div style="font-size:12.5px;color:#374151;font-weight:600">${escapeHtml(img.name)}</div>
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">
              <label style="font-size:11.5px;color:#6b7280">위치
                <select class="img-position" data-idx="${realIdx}" style="width:100%;padding:5px 6px;border:1px solid #d1d5db;border-radius:5px;font-size:12px;margin-top:2px">
                  <option value="above" ${img.position === 'above' ? 'selected' : ''}>본문 위</option>
                  <option value="below" ${img.position === 'below' ? 'selected' : ''}>본문 아래</option>
                </select>
              </label>
              <label style="font-size:11.5px;color:#6b7280">정렬
                <select class="img-align" data-idx="${realIdx}" style="width:100%;padding:5px 6px;border:1px solid #d1d5db;border-radius:5px;font-size:12px;margin-top:2px">
                  <option value="left" ${img.align === 'left' ? 'selected' : ''}>왼쪽</option>
                  <option value="center" ${img.align === 'center' ? 'selected' : ''}>가운데</option>
                  <option value="right" ${img.align === 'right' ? 'selected' : ''}>오른쪽</option>
                </select>
              </label>
              <label style="font-size:11.5px;color:#6b7280">너비(px)
                <input type="number" class="img-width" data-idx="${realIdx}" value="${img.width || 600}" min="50" max="1200" step="10" style="width:100%;padding:5px 6px;border:1px solid #d1d5db;border-radius:5px;font-size:12px;margin-top:2px">
              </label>
              <label style="font-size:11.5px;color:#6b7280">순서
                <input type="number" class="img-order" data-idx="${realIdx}" value="${img.order || 0}" min="0" max="99" step="1" style="width:100%;padding:5px 6px;border:1px solid #d1d5db;border-radius:5px;font-size:12px;margin-top:2px">
              </label>
            </div>
            <div style="display:flex;gap:6px;margin-top:4px">
              <input type="text" class="img-alt" data-idx="${realIdx}" value="${escapeHtml(img.alt || '')}" placeholder="이미지 설명 (선택, 스크린리더용)" style="flex:1;padding:5px 8px;border:1px solid #d1d5db;border-radius:5px;font-size:12px">
              <button type="button" class="btn btn-sm img-delete" data-idx="${realIdx}" style="background:#fee2e2;border-color:#fca5a5;color:#b91c1c">삭제</button>
            </div>
          </div>
        </div>
      `;
    }).join("");

    /* 이벤트 바인딩 */
    wrap.querySelectorAll(".img-position, .img-align, .img-width, .img-order, .img-alt").forEach(el => {
      el.addEventListener("change", () => {
        const i = Number(el.dataset.idx);
        const field = el.classList.contains("img-position") ? "position"
                    : el.classList.contains("img-align")    ? "align"
                    : el.classList.contains("img-width")    ? "width"
                    : el.classList.contains("img-order")    ? "order"
                    : "alt";
        const val = (field === "width" || field === "order") ? Number(el.value) : el.value;
        templateImages[i][field] = val;
        if (field === "order") renderImagesList(); /* 정렬 즉시 반영 */
      });
    });
    wrap.querySelectorAll(".img-delete").forEach(btn => {
      btn.addEventListener("click", () => {
        const i = Number(btn.dataset.idx);
        if (confirm("이미지를 삭제하시겠습니까?")) {
          templateImages.splice(i, 1);
          renderImagesList();
        }
      });
    });
  }

  /* ── 변수 정의 표 ── */
  function addVarRow(v = { key: "", label: "", sample: "" }) {
    const tbody = $("varTbody");
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input type="text" class="var-key"    value="${escapeHtml(v.key)}"    placeholder="예) member_name" /></td>
      <td><input type="text" class="var-label"  value="${escapeHtml(v.label)}"  placeholder="예) 회원이름" /></td>
      <td><input type="text" class="var-sample" value="${escapeHtml(v.sample)}" placeholder="예) 홍길동" /></td>
      <td class="col-act"><button type="button" class="btn-icon" title="삭제">×</button></td>
    `;
    tr.querySelector(".btn-icon").addEventListener("click", () => tr.remove());
    tbody.appendChild(tr);
  }

  function readVariables() {
    const rows = $("varTbody").querySelectorAll("tr");
    const list = [];
    rows.forEach(tr => {
      const key    = tr.querySelector(".var-key").value.trim();
      const label  = tr.querySelector(".var-label").value.trim();
      const sample = tr.querySelector(".var-sample").value.trim();
      if (!key && !label && !sample) return;
      list.push({ key, label, sample });
    });
    return list;
  }

  /* ── 채널 동적 동작 ── */
  function getChannel() {
    const checked = document.querySelector('input[name="channel"]:checked');
    return checked ? checked.value : "";
  }

  function applyChannelUI() {
    const ch = getChannel();
    const subjectCard = $("subjectCard");
    const charCounter = $("charCounter");
    const kakaoNotice = $("kakaoNotice");
    const alimtalkCard = $("alimtalkCard"); /* ★ 2026-05-16 */
    const imagesCard = $("imagesCard");     /* ★ 2026-05-17 */

    /* ★ 2026-05-17: SIREN 레이아웃 카드 — 이메일 채널만 노출 */
    const sirenCard = $("sirenLayoutCard");
    if (sirenCard) sirenCard.style.display = (ch === "email") ? "" : "none";

    /* 이미지 카드: 이메일·SMS 채널 노출. SMS는 이미지 있으면 자동 MMS 전환 (단가 2~3배). */
    if (imagesCard) {
      imagesCard.style.display = (ch === "email" || ch === "sms") ? "" : "none";
      const titleEl = imagesCard.querySelector("h3");
      if (titleEl) {
        titleEl.innerHTML = ch === "sms"
          ? "이미지 첨부 (SMS → MMS 자동 전환 · 단가 2~3배)"
          : "이미지 첨부 (이메일 전용)";
      }
    }

    // 제목 칸: 이메일·인앱만 노출
    if (ch === "email" || ch === "inapp") {
      subjectCard.style.display = "";
    } else {
      subjectCard.style.display = "none";
    }

    // SMS 글자수 카운터
    if (ch === "sms") {
      charCounter.style.display = "";
      updateCharCounter();
    } else {
      charCounter.style.display = "none";
    }

    // 카카오 안내 + 알리고 전용 입력 카드
    kakaoNotice.style.display = (ch === "kakao") ? "" : "none";
    if (alimtalkCard) alimtalkCard.style.display = (ch === "kakao") ? "" : "none";
  }

  function updateCharCounter() {
    const len = $("fBody").value.length;
    const el  = $("charCounter");
    const over = len > 2000;
    el.classList.toggle("over", over);
    el.textContent = `현재 ${len}자 / SMS 90자 / LMS 2000자`;
  }

  /* ── 변수 참조 검증 (클라이언트 사전 점검) ── */
  function findUsedKeys(text) {
    if (!text) return [];
    const set = new Set();
    const re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
    let m;
    while ((m = re.exec(text)) !== null) set.add(m[1]);
    return Array.from(set);
  }

  function findUndefinedKeys(template, vars) {
    const used    = findUsedKeys(template);
    const defined = new Set((vars || []).map(v => v.key));
    return used.filter(k => !defined.has(k));
  }

  /* ── 폼 → 페이로드 ── */
  function buildPayload() {
    const channel = getChannel();
    const name      = $("fName").value.trim();
    const category  = $("fCategory").value;
    const subject   = $("fSubject").value;
    const bodyTemplate = $("fBody").value;
    const variables = readVariables();
    const payload = {
      name, channel, category,
      subject: (channel === "email" || channel === "inapp") ? subject : null,
      bodyTemplate,
      variables,
    };
    /* ★ 2026-05-17: 이메일 채널이면 templateImages 페이로드에 포함 */
    if (channel === "email") {
      payload.images = templateImages;
      payload.useSirenLayout = $("fUseSirenLayout")?.checked || false;
    }

    /* ★ 2026-05-16: 카카오 채널이면 알리고 전용 필드 함께 페이로드에 포함 */
    if (channel === "kakao") {
      payload.alimtalkTemplateCode = ($("fAlimtalkTemplateCode")?.value || "").trim();
      payload.alimtalkReviewStatus = $("fAlimtalkReviewStatus")?.value || "";
      const btnText = ($("fAlimtalkButtonJson")?.value || "").trim();
      if (btnText) {
        try {
          payload.alimtalkButtonJson = JSON.parse(btnText);
        } catch (_) {
          /* 검증 단계에서 잡힘 */
          payload.alimtalkButtonJson = btnText;
        }
      } else {
        payload.alimtalkButtonJson = null;
      }
    }
    return payload;
  }

  function validate(payload) {
    if (!payload.name) return "템플릿 이름을 입력해 주세요.";
    if (!payload.channel) return "채널을 선택해 주세요.";
    if (!payload.bodyTemplate || !payload.bodyTemplate.trim()) return "본문을 입력해 주세요.";
    if ((payload.channel === "email" || payload.channel === "inapp")
        && (!payload.subject || !payload.subject.trim())) {
      return "이메일·인앱 채널은 제목을 입력해 주세요.";
    }
    // 변수 참조 검증
    const undef = [
      ...findUndefinedKeys(payload.bodyTemplate, payload.variables),
      ...findUndefinedKeys(payload.subject || "", payload.variables),
    ];
    if (undef.length) {
      const list = undef.map(k => "{{" + k + "}}").join(", ");
      return "본문에 정의되지 않은 변수가 있습니다: " + list;
    }
    /* ★ 2026-05-16: 카카오 채널 추가 검증 */
    if (payload.channel === "kakao") {
      if (!payload.alimtalkTemplateCode) {
        return "카카오 알림톡은 알리고 템플릿 코드(예: UH_7533)가 필요합니다.";
      }
      if (!/^[A-Za-z0-9_]{1,50}$/.test(payload.alimtalkTemplateCode)) {
        return "알리고 템플릿 코드는 영문·숫자·언더스코어만 가능합니다.";
      }
      if (!payload.alimtalkReviewStatus) {
        return "카카오 알림톡 심사 상태를 선택해 주세요.";
      }
      if (!["pending","approved","rejected"].includes(payload.alimtalkReviewStatus)) {
        return "심사 상태 값이 올바르지 않습니다.";
      }
      /* 버튼 JSON 검증 — 입력했다면 유효한 JSON이어야 */
      if (payload.alimtalkButtonJson && typeof payload.alimtalkButtonJson === "string") {
        return "버튼 JSON 형식이 올바르지 않습니다. JSON 객체로 입력해 주세요.";
      }
    }
    return null;
  }

  /* ── 저장 ── */
  async function save() {
    const payload = buildPayload();
    const err = validate(payload);
    if (err) { showToast(err, "error"); return; }

    const btn = $("btnSave");
    btn.disabled = true;
    btn.textContent = "저장 중…";

    const url = isEdit
      ? "/api/admin-template-update?id=" + encodeURIComponent(editId)
      : "/api/admin-template-create";
    const res = await api({ method: "POST", url, body: payload });

    btn.disabled = false;
    btn.textContent = "저장";

    if (res.ok) {
      showToast(isEdit ? "템플릿이 수정되었습니다." : "템플릿이 등록되었습니다.");
      setTimeout(() => { window.location.href = "/admin-templates.html"; }, 600);
    } else {
      const detail = res.data?.error || res.data?.detail || ("HTTP " + res.status);
      showToast("저장 실패: " + detail, "error");
    }
  }

  /* ── 미리보기 ── */
  function openPreview() {
    const payload = buildPayload();
    if (!payload.bodyTemplate || !payload.bodyTemplate.trim()) {
      showToast("본문을 입력해 주세요.", "error");
      return;
    }

    // 변수 입력 폼 채우기
    const form = $("previewForm");
    form.innerHTML = "";
    if (!payload.variables.length) {
      form.innerHTML = `<p class="helper-text">정의된 변수가 없습니다. 본문 그대로 미리보기 합니다.</p>`;
    } else {
      payload.variables.forEach(v => {
        const wrap = document.createElement("div");
        wrap.innerHTML = `
          <label>${escapeHtml(v.label || v.key)} <span style="color:#94a3b8;">(${escapeHtml(v.key)})</span></label>
          <input type="text" data-pv-key="${escapeHtml(v.key)}" value="${escapeHtml(v.sample || "")}" />
        `;
        form.appendChild(wrap);
      });
    }

    $("previewResult").style.display   = "none";
    $("previewWarnings").style.display = "none";
    $("previewModal").classList.add("show");
  }

  async function runPreview() {
    const payload = buildPayload();
    const overrides = {};
    document.querySelectorAll("#previewForm input[data-pv-key]").forEach(inp => {
      overrides[inp.dataset.pvKey] = inp.value;
    });

    const btn = $("btnPreviewRun");
    btn.disabled = true;
    btn.textContent = "처리 중…";

    const res = await api({
      method: "POST",
      url: "/api/admin-template-preview",
      body: {
        channel:      payload.channel,
        subject:      payload.subject,
        bodyTemplate: payload.bodyTemplate,
        variables:    payload.variables,
        overrides,
      },
    });

    btn.disabled = false;
    btn.textContent = "치환 결과 보기";

    if (!res.ok) {
      const detail = res.data?.error || res.data?.detail || ("HTTP " + res.status);
      showToast("미리보기 실패: " + detail, "error");
      return;
    }

    const data = res.data?.data ?? res.data ?? {};
    const preview = data.preview ?? res.data?.preview ?? {};
    const warnings = data.warnings ?? res.data?.warnings ?? [];

    $("pvSubject").textContent = preview.subject || "(제목 없음)";
    /* ★ 2026-05-17: 이메일 채널이고 이미지가 있으면 본문 위/아래에 inject. textContent 대신 innerHTML. */
    const pvBodyEl = $("pvBody");
    const useSiren = payload.channel === "email" && $("fUseSirenLayout")?.checked;
    if (payload.channel === "email" && (Array.isArray(templateImages) && templateImages.length > 0 || useSiren)) {
      const images = (templateImages || []).slice().sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
      const buildImgTag = (img) => {
        const alignCss = img.align === "left" ? "left" : img.align === "right" ? "right" : "center";
        const width = Math.min(Math.max(Number(img.width) || 600, 50), 1200);
        return `<div style="text-align:${alignCss};margin:12px 0"><img src="${escapeHtml(img.url)}" alt="${escapeHtml(img.alt || '')}" style="max-width:100%;width:${width}px;height:auto;display:inline-block;border:1px solid #e5e7eb;border-radius:4px"></div>`;
      };
      const aboveImgs = images.filter(img => img.position !== "below").map(buildImgTag).join("");
      const belowImgs = images.filter(img => img.position === "below").map(buildImgTag).join("");
      const escapedBody = escapeHtml(preview.body || "").replace(/\n/g, "<br>");
      let innerHtml = aboveImgs + `<div style="white-space:pre-wrap;line-height:1.55">${escapedBody}</div>` + belowImgs;
      if (useSiren) {
        /* SIREN 레이아웃 wrap — baseLayout 시뮬레이션 */
        const title = preview.subject || "(제목 없음)";
        innerHtml = `
          <div style="background:#f5f4f2;padding:20px;border-radius:8px">
            <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.06)">
              <div style="background:#0f0f0f;padding:20px 32px;border-bottom:3px solid #b8935a">
                <div style="color:#fff;font-size:18px;font-weight:700;letter-spacing:1px">SIREN</div>
                <div style="color:#b8935a;font-size:12px;margin-top:2px;letter-spacing:2px">존엄한 기억, 투명한 동행</div>
              </div>
              <div style="padding:32px 32px 12px">
                <h1 style="margin:0;font-size:20px;color:#0f0f0f;font-weight:700;line-height:1.4">${escapeHtml(title)}</h1>
              </div>
              <div style="padding:8px 32px 24px;font-size:14px;line-height:1.7;color:#333">
                ${innerHtml}
              </div>
              <div style="background:#fafaf8;padding:20px 32px;border-top:1px solid #e8e6e3;font-size:12px;color:#8a8a8a;line-height:1.6">
                <div>이 메일은 자동 발송된 알림 메일입니다.</div>
                <div style="margin-top:6px">© SIREN 교사유가족협의회</div>
              </div>
            </div>
          </div>
        `;
      }
      pvBodyEl.innerHTML = innerHtml;
    } else {
      pvBodyEl.textContent = preview.body || "";
    }
    $("pvSubject").style.display = (payload.channel === "email" || payload.channel === "inapp") ? "" : "none";
    $("previewResult").style.display = "";

    if (Array.isArray(warnings) && warnings.length) {
      $("previewWarnings").innerHTML = `
        <strong>주의</strong>
        <ul>${warnings.map(w => `<li>${escapeHtml(w)}</li>`).join("")}</ul>
      `;
      $("previewWarnings").style.display = "";
    } else {
      $("previewWarnings").style.display = "none";
    }
  }

  function closePreview() {
    $("previewModal").classList.remove("show");
  }

  /* ── 수정 모드 데이터 로드 ── */
  async function loadExisting() {
    $("formArea").style.display    = "none";
    $("loadingArea").style.display = "";

    const res = await api({
      method: "GET",
      url: "/api/admin-template-detail?id=" + encodeURIComponent(editId),
    });

    $("loadingArea").style.display = "none";
    $("formArea").style.display    = "";

    if (!res.ok) {
      const detail = res.data?.error || res.data?.detail || ("HTTP " + res.status);
      showToast("템플릿 조회 실패: " + detail, "error");
      return;
    }

    const data = res.data?.data ?? res.data ?? {};
    const t = data.template ?? res.data?.template ?? null;
    if (!t) {
      showToast("템플릿 데이터를 찾을 수 없습니다.", "error");
      return;
    }

    $("pageTitle").textContent = `템플릿 수정 #${t.id}`;
    $("fName").value     = t.name || "";
    $("fCategory").value = t.category || "newsletter";

    const chRadio = document.querySelector(`input[name="channel"][value="${t.channel}"]`);
    if (chRadio) chRadio.checked = true;

    $("fSubject").value = t.subject || "";
    $("fBody").value    = t.bodyTemplate || "";

    $("varTbody").innerHTML = "";
    const vars = Array.isArray(t.variables) ? t.variables : [];
    if (vars.length === 0) {
      addVarRow();
    } else {
      vars.forEach(v => addVarRow(v));
    }

    /* ★ 2026-05-17: 이미지·SIREN 레이아웃 필드 복원 */
    templateImages = Array.isArray(t.images) ? t.images.slice() : [];
    renderImagesList();
    const sirenCb = $("fUseSirenLayout");
    if (sirenCb) sirenCb.checked = !!t.useSirenLayout;

    /* ★ 2026-05-16: 카카오 전용 필드 복원 */
    if (t.channel === "kakao") {
      const codeEl = $("fAlimtalkTemplateCode");
      const reviewEl = $("fAlimtalkReviewStatus");
      const btnEl = $("fAlimtalkButtonJson");
      if (codeEl) codeEl.value = t.alimtalkTemplateCode || "";
      if (reviewEl) reviewEl.value = t.alimtalkReviewStatus || "";
      if (btnEl) {
        const v = t.alimtalkButtonJson;
        btnEl.value = v
          ? (typeof v === "string" ? v : JSON.stringify(v, null, 2))
          : "";
      }
    }

    applyChannelUI();
  }

  /* ── 이벤트 ── */
  function bindEvents() {
    $("btnAddVar").addEventListener("click", () => addVarRow());
    /* ★ 2026-05-17: 변수 프리셋 모달 트리거 + 닫기 */
    $("btnAddVarPreset")?.addEventListener("click", openVarPresetModal);
    $("varPresetClose")?.addEventListener("click", closeVarPresetModal);
    $("varPresetModal")?.addEventListener("click", (e) => {
      if (e.target === $("varPresetModal")) closeVarPresetModal();
    });

    /* ★ 2026-05-17: 이미지 업로드 — file input + button */
    $("btnImageUpload")?.addEventListener("click", () => $("fImageFile")?.click());
    $("fImageFile")?.addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) uploadTemplateImage(file);
      e.target.value = ""; /* 같은 파일 재업로드 가능하도록 reset */
    });

    /* 빈 화면 초기 렌더 */
    renderImagesList();

    document.querySelectorAll('input[name="channel"]').forEach(r =>
      r.addEventListener("change", applyChannelUI)
    );

    $("fBody").addEventListener("input", () => {
      if (getChannel() === "sms") updateCharCounter();
    });

    $("btnSave").addEventListener("click", save);
    $("btnCancel").addEventListener("click", () => {
      window.location.href = "/admin-templates.html";
    });

    $("btnPreview").addEventListener("click", openPreview);
    $("btnPreviewRun").addEventListener("click", runPreview);
    $("btnPreviewClose").addEventListener("click", closePreview);
    $("previewModal").addEventListener("click", (e) => {
      if (e.target === $("previewModal")) closePreview();
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    bindEvents();

    if (isEdit) {
      loadExisting();
    } else {
      $("pageTitle").textContent = "템플릿 신규 작성";
      // 기본 채널: 이메일
      document.querySelector('input[name="channel"][value="email"]').checked = true;
      addVarRow(); // 빈 행 1개로 시작
      applyChannelUI();
    }
  });
})();
