// public/js/admin-send-job-create.js
// 새 발송 만들기 — 편집 가능한 본문 + 다중 채널 + 수신자 목록

(function () {
  "use strict";

  const CHANNEL_LABEL = { email: "이메일", sms: "SMS", kakao: "카카오톡", inapp: "앱 알림" };
  const CHANNEL_ICONS = { email: "📧", sms: "📱", kakao: "💬", inapp: "🔔" };

  let templates = [];
  /* ★ 2026-05-17: 발송 작업용 이미지 상태 — 템플릿 로드 시 templateImages로 초기화.
     사용자가 수정하면 isDirty=true → 등록 시 imagesOverride로 전송. */
  let jobImages = [];
  let jobImagesDirty = false;
  let groups    = [];
  let currentTemplate = null;     /* 선택한 템플릿 객체 (variables 포함) */
  let editorDirty = false;        /* 사용자가 본문을 수정했는지 */
  let submitting = false;

  /* 수신자 목록 페이지네이션 */
  const RCPT_PAGE_SIZE = 50;
  let rcptPage = 1;
  let rcptTotal = 0;
  let lastGroupId = null;
  /* 사용자가 미리보기에서 발송 제외한 회원 ID (Set) — 그룹 변경 시 초기화 */
  let excludedIds = new Set();

  function $(id) { return document.getElementById(id); }
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  /* ── api 헬퍼 ── */
  async function api({ method = "GET", url, body }) {
    try {
      if (typeof window.adminApi === "function") return await window.adminApi({ method, url, body });
      if (typeof window.api === "function")      return await window.api({ method, url, body });
      const opts = { method, credentials: "include", headers: { "Content-Type": "application/json" } };
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

  /* ── 템플릿·그룹 셀렉트 채우기 ── */
  async function loadTemplates() {
    const res = await api({ method: "GET", url: "/api/admin-templates-list?limit=200" });
    if (!res.ok) {
      $("fTemplate").innerHTML = `<option value="">(불러오기 실패)</option>`;
      const detail = res.data?.error || res.data?.detail || ("HTTP " + res.status);
      showToast("템플릿 목록 조회 실패: " + detail, "error");
      return;
    }
    const payload = res.data?.data ?? res.data ?? {};
    const rows = payload.rows ?? res.data?.rows ?? [];
    templates = rows.filter(r => r.isActive !== false);
    if (!templates.length) {
      $("fTemplate").innerHTML = `<option value="">(활성 템플릿 없음)</option>`;
      return;
    }
    /* ★ 2026-05-16: 최초 로드 시점에 채널이 아직 안 정해졌으니 일단 카카오 전용
       제외한 일반 템플릿만 표시. 채널 선택 시 refreshTemplateOptions가 재필터. */
    refreshTemplateOptions();
  }

  async function loadGroups() {
    const res = await api({ method: "GET", url: "/api/admin-recipient-groups-list?limit=200" });
    if (!res.ok) {
      $("fGroup").innerHTML = `<option value="">(불러오기 실패)</option>`;
      const detail = res.data?.error || res.data?.detail || ("HTTP " + res.status);
      showToast("수신자 그룹 조회 실패: " + detail, "error");
      return;
    }
    const payload = res.data?.data ?? res.data ?? {};
    const rows = payload.rows ?? res.data?.rows ?? [];
    groups = rows.filter(r => r.isActive !== false);
    if (!groups.length) {
      $("fGroup").innerHTML = `<option value="">(활성 그룹 없음)</option>`;
      return;
    }
    const opts = [`<option value="">선택</option>`].concat(
      groups.map(g => {
        const cnt = (typeof g.memberCount === "number") ? `${g.memberCount.toLocaleString()}명` : "-";
        return `<option value="${g.id}">${escapeHtml(g.name || "(이름 없음)")} (${escapeHtml(cnt)})</option>`;
      })
    );
    $("fGroup").innerHTML = opts.join("");
  }

  /* ── 템플릿 선택 → 본문 편집 영역 렌더 (이미 list에서 받은 데이터 사용) ── */
  function loadTemplateDetail(tplId) {
    if (!tplId) {
      currentTemplate = null;
      $("editArea").innerHTML = `<div class="preview-empty">템플릿을 선택하면 제목과 본문이 여기에 표시됩니다.</div>`;
      return;
    }
    /* admin-templates-list 응답에 bodyTemplate·variables 모두 포함 → 별도 detail API 호출 불필요 */
    const tpl = templates.find(t => String(t.id) === String(tplId));
    if (!tpl) {
      $("editArea").innerHTML = `<div class="preview-empty" style="color:#b91c1c;">템플릿을 찾을 수 없습니다.</div>`;
      currentTemplate = null;
      return;
    }
    currentTemplate = tpl;
    editorDirty = false;
    /* ★ 2026-05-17: 템플릿의 이미지를 발송 작업용으로 초기 로드. isDirty=false */
    jobImages = Array.isArray(tpl.images) ? tpl.images.map(i => Object.assign({}, i)) : [];
    jobImagesDirty = false;
    renderEditArea();
    renderJobImagesList();
    autoCheckTemplateChannel(tpl.channel);
    applyImagesCardVisibility();
  }

  /* ★ 2026-05-17: 발송 작업용 이미지 업로드·편집 (admin-template-edit과 유사) */
  async function uploadJobImage(file) {
    const statusEl = $('jobImageUploadStatus');
    if (jobImages.length >= 20) {
      statusEl.textContent = '이미지는 최대 20개까지';
      statusEl.style.color = '#b91c1c';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      statusEl.textContent = '이미지는 5MB 이하만 가능';
      statusEl.style.color = '#b91c1c';
      return;
    }
    statusEl.textContent = '업로드 중…';
    statusEl.style.color = '#6b7280';
    const fd = new FormData();
    fd.append('file', file);
    fd.append('context', 'send_job_image');
    fd.append('isPublic', 'true');
    try {
      const res = await fetch('/api/blob-upload', { method: 'POST', credentials: 'include', body: fd });
      const raw = await res.json().catch(() => ({}));
      const payload = raw?.data ?? raw ?? {};
      const relativeUrl = payload.url || raw.url || '';
      if (!res.ok || !relativeUrl) {
        statusEl.textContent = '업로드 실패: ' + (raw.error || raw.message || ('HTTP ' + res.status));
        statusEl.style.color = '#b91c1c';
        return;
      }
      const absoluteUrl = relativeUrl.startsWith('http')
        ? relativeUrl
        : new URL(relativeUrl, window.location.origin).href;
      jobImages.push({
        url: absoluteUrl,
        blobKey: payload.blobKey || raw.blobKey || '',
        name: file.name,
        width: 600, align: 'center', position: 'above',
        order: jobImages.length, alt: '',
      });
      jobImagesDirty = true;
      statusEl.textContent = '✓ 업로드 완료';
      statusEl.style.color = '#166534';
      renderJobImagesList();
    } catch (err) {
      statusEl.textContent = '업로드 실패: ' + String(err.message || err);
      statusEl.style.color = '#b91c1c';
    }
  }

  function renderJobImagesList() {
    const wrap = $('jobImagesList');
    if (!wrap) return;
    if (!jobImages.length) {
      wrap.innerHTML = `<div style="padding:18px;text-align:center;color:#9ca3af;border:1px dashed #d1d5db;border-radius:8px;font-size:13px">첨부된 이미지가 없습니다. 위 [이미지 추가] 버튼으로 추가하세요.</div>`;
      return;
    }
    const sorted = jobImages.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    wrap.innerHTML = sorted.map(img => {
      const realIdx = jobImages.indexOf(img);
      return `
        <div style="display:flex;gap:12px;padding:12px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px">
          <img src="${escapeHtml(img.url)}" alt="${escapeHtml(img.alt || '')}" style="width:120px;height:90px;object-fit:cover;border-radius:6px;border:1px solid #d1d5db;background:#fff">
          <div style="flex:1;display:flex;flex-direction:column;gap:6px">
            <div style="font-size:12.5px;color:#374151;font-weight:600">${escapeHtml(img.name || '이미지')}</div>
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">
              <label style="font-size:11.5px;color:#6b7280">위치
                <select class="ji-pos" data-idx="${realIdx}" style="width:100%;padding:5px 6px;border:1px solid #d1d5db;border-radius:5px;font-size:12px;margin-top:2px">
                  <option value="above" ${img.position === 'above' ? 'selected' : ''}>본문 위</option>
                  <option value="below" ${img.position === 'below' ? 'selected' : ''}>본문 아래</option>
                </select>
              </label>
              <label style="font-size:11.5px;color:#6b7280">정렬
                <select class="ji-align" data-idx="${realIdx}" style="width:100%;padding:5px 6px;border:1px solid #d1d5db;border-radius:5px;font-size:12px;margin-top:2px">
                  <option value="left" ${img.align === 'left' ? 'selected' : ''}>왼쪽</option>
                  <option value="center" ${img.align === 'center' ? 'selected' : ''}>가운데</option>
                  <option value="right" ${img.align === 'right' ? 'selected' : ''}>오른쪽</option>
                </select>
              </label>
              <label style="font-size:11.5px;color:#6b7280">너비(px)
                <input type="number" class="ji-w" data-idx="${realIdx}" value="${img.width || 600}" min="50" max="1200" step="10" style="width:100%;padding:5px 6px;border:1px solid #d1d5db;border-radius:5px;font-size:12px;margin-top:2px">
              </label>
              <label style="font-size:11.5px;color:#6b7280">순서
                <input type="number" class="ji-ord" data-idx="${realIdx}" value="${img.order || 0}" min="0" max="99" step="1" style="width:100%;padding:5px 6px;border:1px solid #d1d5db;border-radius:5px;font-size:12px;margin-top:2px">
              </label>
            </div>
            <div style="display:flex;gap:6px;margin-top:4px">
              <input type="text" class="ji-alt" data-idx="${realIdx}" value="${escapeHtml(img.alt || '')}" placeholder="이미지 설명 (선택)" style="flex:1;padding:5px 8px;border:1px solid #d1d5db;border-radius:5px;font-size:12px">
              <button type="button" class="btn btn-sm ji-del" data-idx="${realIdx}" style="background:#fee2e2;border-color:#fca5a5;color:#b91c1c">삭제</button>
            </div>
          </div>
        </div>
      `;
    }).join('');
    wrap.querySelectorAll('.ji-pos, .ji-align, .ji-w, .ji-ord, .ji-alt').forEach(el => {
      el.addEventListener('change', () => {
        const i = Number(el.dataset.idx);
        const field = el.classList.contains('ji-pos') ? 'position'
                    : el.classList.contains('ji-align') ? 'align'
                    : el.classList.contains('ji-w')     ? 'width'
                    : el.classList.contains('ji-ord')   ? 'order'
                    : 'alt';
        const val = (field === 'width' || field === 'order') ? Number(el.value) : el.value;
        jobImages[i][field] = val;
        jobImagesDirty = true;
        if (field === 'order') renderJobImagesList();
      });
    });
    wrap.querySelectorAll('.ji-del').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = Number(btn.dataset.idx);
        if (confirm('이미지를 삭제하시겠습니까?')) {
          jobImages.splice(i, 1);
          jobImagesDirty = true;
          renderJobImagesList();
        }
      });
    });
  }

  /* 이미지 카드 표시 — 이메일·SMS 채널에 노출 (SMS는 자동 MMS 전환) */
  function applyImagesCardVisibility() {
    const card = $('imagesCard');
    if (!card) return;
    const channels = getSelectedChannels();
    const hasEmail = channels.includes('email');
    const hasSms = channels.includes('sms');
    card.style.display = ((hasEmail || hasSms) && currentTemplate) ? '' : 'none';
    /* SMS 채널일 때 비용 안내 추가 */
    const titleEl = card.querySelector('.card-title');
    if (titleEl) {
      const hint = hasSms && !hasEmail
        ? '🖼️ 이미지 첨부 <span class="badge-tip" style="background:#fff7ed;color:#9a3412">SMS → MMS 자동 전환 (단가 2~3배, 첫 이미지만)</span>'
        : '🖼️ 이미지 첨부 <span class="badge-tip">이번 발송에만 적용 — 템플릿 원본은 그대로</span>';
      titleEl.innerHTML = hint;
    }
    /* 발송 미리보기 카드 — 채널 1개 이상 선택 시 표시 */
    const pvCard = $('sendPreviewCard');
    if (pvCard) {
      const showPv = currentTemplate && channels.length > 0;
      pvCard.style.display = showPv ? '' : 'none';
      if (showPv) applyPreviewTabVisibility();
    }
  }

  /* ── 채널 미리보기 탭 전환 ── */
  function bindPreviewTabs() {
    document.querySelectorAll('.preview-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        switchPreviewTab(btn.dataset.tab);
      });
    });
  }

  function switchPreviewTab(tab) {
    document.querySelectorAll('.preview-tab').forEach(btn => {
      const isActive = btn.dataset.tab === tab;
      btn.style.color = isActive ? '#1e40af' : '#94a3b8';
      btn.style.fontWeight = isActive ? '700' : '500';
      btn.style.borderBottomColor = isActive ? '#1e40af' : 'transparent';
    });
    ['email', 'sms', 'kakao', 'inapp'].forEach(ch => {
      const el = $('preview-' + ch);
      if (el) el.style.display = ch === tab ? '' : 'none';
    });
  }

  /* 선택된 채널 탭만 활성화, 나머지 dim 처리 */
  function applyPreviewTabVisibility() {
    const channels = getSelectedChannels();
    const tabBar = $('previewTabBar');
    if (!tabBar) return;
    let firstActive = null;
    document.querySelectorAll('.preview-tab').forEach(btn => {
      const ch = btn.dataset.tab;
      const active = channels.includes(ch);
      btn.style.opacity = active ? '1' : '0.35';
      btn.style.pointerEvents = active ? '' : 'none';
      if (active && !firstActive) firstActive = ch;
    });
    if (firstActive) switchPreviewTab(firstActive);
  }

  /* ★ 2026-05-17: 발송 미리보기 — 채널별 분기 렌더링 */
  async function refreshSendPreview() {
    if (!currentTemplate) {
      ['email', 'sms', 'kakao', 'inapp'].forEach(ch => {
        const el = $('preview-' + ch);
        if (el) el.innerHTML = `<div style="color:#9ca3af;text-align:center;padding:24px 0">템플릿을 먼저 선택하세요.</div>`;
      });
      return;
    }
    /* 수신자 그룹 첫 멤버로 변수 치환 시도 */
    const grpId = $('fGroup')?.value;
    let memberData = { 회원이름: '박두용', 이름: '박두용', name: '박두용', email: 'donor@tbfa.co.kr', phone: '010-1234-5678' };
    if (grpId) {
      try {
        const res = await api({ method: 'GET', url: `/api/admin-recipient-group-members?id=${encodeURIComponent(grpId)}&limit=1&offset=0` });
        const m = (res.data?.members ?? res.data?.data?.members ?? [])[0];
        if (m) {
          memberData = {
            회원이름: m.name || '', 이름: m.name || '', name: m.name || '',
            이메일: m.email || '', email: m.email || '',
            연락처: m.phone || '', phone: m.phone || '',
            회원번호: String(m.id || ''), memberId: String(m.id || ''),
          };
        }
      } catch (_) {}
    }
    const variables = Array.isArray(currentTemplate.variables) ? currentTemplate.variables : [];
    const subjEl = $('fSubject');
    const bodyEl = $('fBody');
    const subjTpl = (subjEl && subjEl.value) || currentTemplate.subject || '';
    const bodyTpl = (bodyEl && bodyEl.value) || currentTemplate.bodyTemplate || '';
    const renderTpl = (tpl) => String(tpl).replace(/\{\{([^{}]+)\}\}/g, (_, rawKey) => {
      const k = String(rawKey).trim();
      if (k in memberData) return memberData[k];
      const v = variables.find(v => v.key === k);
      return v?.sample || `[${k}]`;
    });
    const subject = renderTpl(subjTpl);
    const body = renderTpl(bodyTpl);

    const channels = getSelectedChannels();

    /* ── 이메일 미리보기 ── */
    const emailEl = $('preview-email');
    if (emailEl && channels.includes('email')) {
      const images = (Array.isArray(jobImages) ? jobImages : []).slice().sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
      const buildImgTag = (img) => {
        const alignCss = img.align === 'left' ? 'left' : img.align === 'right' ? 'right' : 'center';
        const width = Math.min(Math.max(Number(img.width) || 600, 50), 1200);
        return `<div style="text-align:${alignCss};margin:12px 0"><img src="${escapeHtml(img.url)}" alt="${escapeHtml(img.alt || '')}" style="max-width:100%;width:${width}px;height:auto;display:inline-block;border:1px solid #e5e7eb;border-radius:4px"></div>`;
      };
      const aboveImgs = images.filter(img => img.position !== 'below').map(buildImgTag).join('');
      const belowImgs = images.filter(img => img.position === 'below').map(buildImgTag).join('');
      const wrapEmail = document.getElementById('fWrapEmail')?.checked;
      const subjectHtml = subject ? `<div style="font-weight:700;font-size:15px;color:#111827;padding:8px 0;border-bottom:1px solid #e5e7eb;margin-bottom:14px">제목: ${escapeHtml(subject)}</div>` : '';
      const bodyHtml = `<div style="white-space:pre-wrap">${escapeHtml(body).replace(/\n/g, '<br>')}</div>`;
      let inner = subjectHtml + aboveImgs + bodyHtml + belowImgs;
      if (wrapEmail) {
        inner = `<div style="background:#1e40af;color:#fff;padding:14px 20px;border-radius:6px 6px 0 0;font-weight:700;font-size:15px">SIREN 교사유가족협의회</div>` + inner + `<div style="background:#f8fafc;padding:10px 20px;border-radius:0 0 6px 6px;font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0">수신 거부는 마이페이지에서 설정하세요.</div>`;
      }
      emailEl.innerHTML = inner;
    }

    /* ── SMS 미리보기 ── */
    const smsEl = $('preview-sms');
    if (smsEl && channels.includes('sms')) {
      const plainBody = bodyTpl.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      const rendered = renderTpl(plainBody);
      const len = rendered.length;
      const overLimit = len > 90;
      smsEl.innerHTML = `
        <div style="font-family:monospace;font-size:0.875rem;white-space:pre-wrap;background:#f8fafc;padding:14px 16px;border-radius:8px;border:1px solid #e2e8f0;color:#1e293b;line-height:1.6">${escapeHtml(rendered)}</div>
        <div style="margin-top:8px;font-size:0.8rem;font-weight:600;color:${overLimit ? '#b91c1c' : '#475569'}">${len}/90자 ${overLimit ? '— 90자 초과 시 장문(MMS) 전환' : ''}</div>
      `;
    }

    /* ── 카카오 미리보기 ── */
    const kakaoEl = $('preview-kakao');
    if (kakaoEl && channels.includes('kakao')) {
      const plainBody = bodyTpl.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      const rendered = renderTpl(plainBody);
      const btns = Array.isArray(currentTemplate.buttons) ? currentTemplate.buttons : [];
      const btnHtml = btns.length ? `<div style="margin-top:10px;display:flex;flex-direction:column;gap:6px">${btns.map(b => `<div style="background:#f3f4f6;border:1px solid #d1d5db;border-radius:6px;padding:8px 12px;font-size:0.83rem;text-align:center;color:#374151">${escapeHtml(b.name || b.title || b.label || '버튼')}</div>`).join('')}</div>` : '';
      kakaoEl.innerHTML = `
        <div style="display:flex;justify-content:flex-start">
          <div style="max-width:78%;background:#FEE500;border-radius:0 12px 12px 12px;padding:14px 16px;box-shadow:0 2px 6px rgba(0,0,0,0.1)">
            ${subject ? `<div style="font-weight:700;font-size:14px;color:#1a1a1a;margin-bottom:6px">${escapeHtml(subject)}</div>` : ''}
            <div style="font-size:13.5px;color:#1a1a1a;white-space:pre-wrap;line-height:1.55">${escapeHtml(rendered)}</div>
            ${btnHtml}
          </div>
        </div>
      `;
    }

    /* ── 인앱 알림 카드 미리보기 ── */
    const inappEl = $('preview-inapp');
    if (inappEl && channels.includes('inapp')) {
      const plainBody = body.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      inappEl.innerHTML = `
        <div style="display:flex;align-items:flex-start;gap:12px;padding:14px 16px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,0.07);max-width:400px">
          <div style="font-size:1.5rem;line-height:1">🔔</div>
          <div style="flex:1;min-width:0">
            ${subject ? `<div style="font-weight:700;font-size:14px;color:#1e293b;margin-bottom:3px">${escapeHtml(subject)}</div>` : ''}
            <div style="font-size:13px;color:#475569;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${escapeHtml(plainBody)}</div>
          </div>
        </div>
      `;
    }

    applyPreviewTabVisibility();
  }

  function renderEditArea() {
    if (!currentTemplate) return;
    const t = currentTemplate;
    const hasSubject = t.channel === "email" || t.channel === "inapp";
    const vars = Array.isArray(t.variables) ? t.variables : [];
    const varHint = vars.length
      ? `<div class="form-hint">사용 가능 변수: ${vars.map(v => `<code>{{${escapeHtml(v.key)}}}</code>`).join(", ")}</div>`
      : `<div class="form-hint">정의된 변수 없음</div>`;

    /* ★ 2026-05-16: 카카오 전용 템플릿은 본문 read-only. 알리고 심사 통과 본문을
       글자 한 자라도 바꾸면 발송 거부되므로 편집 차단 + 안내 + 변수만 회원 데이터로
       치환됨을 명시. */
    const isKakaoOnly = !!t.isKakaoOnly || (t.channel === 'kakao' && t.alimtalkTemplateCode);
    const REVIEW_LABEL = { approved: '승인완료', pending: '검수중', rejected: '반려' };

    let html = `
      <div class="edit-meta">
        <div><span class="label">템플릿</span> ${escapeHtml(t.name || "-")}</div>
        <div><span class="label">기본 채널</span> ${escapeHtml(CHANNEL_LABEL[t.channel] || t.channel)}${isKakaoOnly ? ' <span style="color:#9a3412;font-weight:600">· 카카오 전용</span>' : ''}</div>
        ${isKakaoOnly && t.alimtalkTemplateCode ? `<div><span class="label">알리고 코드</span> <code>${escapeHtml(t.alimtalkTemplateCode)}</code></div>` : ''}
        ${isKakaoOnly && t.alimtalkReviewStatus ? `<div><span class="label">심사 상태</span> ${escapeHtml(REVIEW_LABEL[t.alimtalkReviewStatus] || t.alimtalkReviewStatus)}</div>` : ''}
        ${vars.length ? `<div><span class="label">변수</span> ${vars.length}개</div>` : ""}
      </div>
    `;

    if (isKakaoOnly) {
      html += `
        <div style="margin:8px 0 12px;padding:10px 14px;background:#fff7ed;border-left:3px solid #ea580c;border-radius:6px;font-size:13px;color:#9a3412;line-height:1.55">
          알리고 심사를 통과한 본문은 글자 한 자라도 다르면 발송이 거부됩니다.
          본문은 읽기 전용이며 <strong>#{변수}</strong>는 수신자 그룹의 회원 데이터로 자동 치환됩니다.
        </div>
      `;
    }

    if (hasSubject && !isKakaoOnly) {
      html += `
        <div class="form-row">
          <label class="form-label" for="fSubject">제목</label>
          <input class="form-input" type="text" id="fSubject" maxlength="200" value="${escapeHtml(t.subject || "")}">
        </div>
      `;
    }
    html += `
      <div class="form-row">
        <label class="form-label" for="fBody">본문${isKakaoOnly ? ' <span style="font-size:11px;color:#9a3412;font-weight:500">· 읽기 전용</span>' : ''}</label>
        <textarea class="form-textarea" id="fBody"${isKakaoOnly ? ' readonly style="background:#f9fafb;color:#374151;cursor:not-allowed"' : ''}>${escapeHtml(t.bodyTemplate || "")}</textarea>
        ${varHint}
      </div>
      ${isKakaoOnly ? '' : `
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:6px">
        <button class="btn btn-sm" id="btnResetEdit" type="button">↺ 템플릿 원본으로 되돌리기</button>
      </div>`}
    `;
    $("editArea").innerHTML = html;

    /* 변경 감지 — 카카오 전용은 편집 불가라 바인딩 생략 */
    if (!isKakaoOnly) {
      if (hasSubject) $("fSubject").addEventListener("input", () => { editorDirty = true; });
      $("fBody").addEventListener("input", () => { editorDirty = true; });
      const btnReset = document.getElementById("btnResetEdit");
      if (btnReset) btnReset.addEventListener("click", () => {
        renderEditArea();
        editorDirty = false;
        showToast("템플릿 원본으로 되돌렸습니다.");
      });
    }
  }

  /* ── 채널 다중 체크박스 ── */
  function autoCheckTemplateChannel(channel) {
    /* 사용자가 아직 아무것도 체크 안 했으면 템플릿 채널 자동 선택 */
    const checked = document.querySelectorAll('#channelGrid input[type="checkbox"]:checked').length;
    if (checked === 0 && channel) {
      const target = document.querySelector(`#channelGrid input[value="${channel}"]`);
      if (target) {
        target.checked = true;
        target.closest('.channel-item').classList.add('checked');
        /* 카카오면 다른 채널 자동 해제 (단독만 가능) */
        if (channel === 'kakao') uncheckNonKakao();
      }
    }
    /* 채널 변경에 따라 템플릿 셀렉트 옵션 다시 필터 */
    refreshTemplateOptions();
  }

  /* ★ 2026-05-16: 카카오는 다른 채널과 동시 선택 불가. 알리고 알림톡은 등록된
     본문·변수만 정확히 일치할 때 발송 가능해 다중 채널과 워크플로우가 달라짐. */
  function uncheckNonKakao() {
    let removed = [];
    document.querySelectorAll('#channelGrid input[type="checkbox"]').forEach(cb => {
      if (cb.value !== 'kakao' && cb.checked) {
        cb.checked = false;
        cb.closest('.channel-item').classList.remove('checked');
        removed.push(CHANNEL_LABEL[cb.value] || cb.value);
      }
    });
    if (removed.length) {
      showToast('카카오는 다른 채널과 동시 발송할 수 없어 ' + removed.join('·') + ' 체크를 해제했습니다.', 'info');
    }
  }
  function uncheckKakao() {
    const kakao = document.querySelector('#channelGrid input[value="kakao"]');
    if (kakao && kakao.checked) {
      kakao.checked = false;
      kakao.closest('.channel-item').classList.remove('checked');
      showToast('카카오와 다른 채널은 동시 선택할 수 없어 카카오 체크를 해제했습니다.', 'info');
    }
  }

  function bindChannelGrid() {
    document.querySelectorAll('#channelGrid .channel-item').forEach(item => {
      item.addEventListener('click', (e) => {
        /* label 클릭 → 자동으로 input 토글, 우리는 시각적 클래스만 동기화 */
        setTimeout(() => {
          const cb = item.querySelector('input');
          item.classList.toggle('checked', cb.checked);
          /* 카카오 vs 다른 채널 충돌 해소 */
          if (cb.checked) {
            if (cb.value === 'kakao') uncheckNonKakao();
            else uncheckKakao();
          }
          refreshTemplateOptions();
          applyImagesCardVisibility();
          /* ★ 2026-05-16: 이메일 옵션 영역 표시/숨김 */
          applyEmailOptionsVisibility();
        }, 0);
      });
    });
  }

  /* ★ 2026-05-16: 이메일 채널 체크 시에만 "이메일 전용 옵션" 영역 표시 */
  function applyEmailOptionsVisibility() {
    const row = document.getElementById('emailOptionsRow');
    if (!row) return;
    const channels = getSelectedChannels();
    row.style.display = channels.includes('email') ? '' : 'none';
  }

  /* ★ 2026-05-16: 현재 선택된 채널이 카카오 단독이면 카카오 전용 템플릿만,
     아니면 카카오 전용은 제외하고 표시. 카카오 전용 옵션엔 '(카카오 전용)·
     (검수상태)' 라벨 + 미승인 옵션은 회색·비활성화. */
  function refreshTemplateOptions() {
    if (!templates || !templates.length) return;
    const channels = getSelectedChannels();
    const isKakaoOnly = channels.length === 1 && channels[0] === 'kakao';

    /* 필터: 카카오 단독이면 카카오 전용(isKakaoOnly=true)만,
       나머지 경우엔 카카오 전용은 숨김 (일반 발송 워크플로우와 분리). */
    const filtered = templates.filter(t => {
      const isKakaoTpl = !!t.isKakaoOnly || (t.channel === 'kakao' && t.alimtalkTemplateCode);
      return isKakaoOnly ? isKakaoTpl : !isKakaoTpl;
    });

    const REVIEW_LABEL = { approved: '승인', pending: '검수중', rejected: '반려' };
    const sel = $('fTemplate');
    const prevValue = sel.value;
    const opts = [`<option value="">선택</option>`].concat(
      filtered.map(t => {
        const ch = CHANNEL_LABEL[t.channel] || t.channel || '-';
        const tags = [];
        if (t.isKakaoOnly || (t.channel === 'kakao' && t.alimtalkTemplateCode)) {
          tags.push('카카오 전용');
          if (t.alimtalkTemplateCode) tags.push(t.alimtalkTemplateCode);
          if (t.alimtalkReviewStatus) tags.push(REVIEW_LABEL[t.alimtalkReviewStatus] || t.alimtalkReviewStatus);
        } else {
          tags.push(ch);
        }
        const disabled = (t.alimtalkReviewStatus && t.alimtalkReviewStatus !== 'approved') ? 'disabled' : '';
        const styleAttr = disabled ? ' style="color:#9ca3af"' : '';
        return `<option value="${t.id}" ${disabled}${styleAttr}>${escapeHtml(t.name || '(이름 없음)')} (${tags.map(escapeHtml).join(' · ')})</option>`;
      })
    );
    sel.innerHTML = opts.join('');
    /* 선택 유지 시도 — 새 필터에서 사라졌으면 빈 값 */
    if (prevValue && filtered.find(t => String(t.id) === String(prevValue))) {
      sel.value = prevValue;
    } else if (prevValue) {
      sel.value = '';
      loadTemplateDetail('');
    }
  }

  function getSelectedChannels() {
    return Array.from(document.querySelectorAll('#channelGrid input[type="checkbox"]:checked'))
      .map(cb => cb.value);
  }

  /* ── 수신자 목록 ── */
  async function loadRecipients(groupId, page) {
    if (!groupId) {
      $("rcptArea").innerHTML = `<div class="preview-empty">수신자 그룹을 선택하면 발송 대상 회원 목록이 표시됩니다.</div>`;
      lastGroupId = null;
      return;
    }
    if (groupId !== lastGroupId) { rcptPage = 1; rcptTotal = 0; excludedIds.clear(); }
    lastGroupId = groupId;
    const offset = (page - 1) * RCPT_PAGE_SIZE;

    $("rcptArea").innerHTML = `<div class="preview-empty"><span class="spinner"></span>회원 목록을 불러오는 중…</div>`;

    const res = await api({
      method: "GET",
      url: `/api/admin-recipient-group-members?id=${encodeURIComponent(groupId)}&limit=${RCPT_PAGE_SIZE}&offset=${offset}`,
    });

    if (!res.ok) {
      const detail = res.data?.error || res.data?.detail || ("HTTP " + res.status);
      $("rcptArea").innerHTML = `<div class="preview-empty" style="color:#b91c1c;">회원 목록 불러오기 실패: ${escapeHtml(detail)}</div>`;
      return;
    }

    const payload = res.data?.data ?? res.data ?? {};
    const members = payload.members ?? payload.rows ?? res.data?.members ?? [];
    rcptTotal = payload.total ?? members.length;

    renderRecipients(members);
  }

  function renderRecipients(members) {
    if (!members.length) {
      $("rcptArea").innerHTML = `
        <div class="rcpt-meta">
          <div>총 발송 대상: <span class="total">0명</span></div>
        </div>
        <div class="preview-empty" style="border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc">
          이 그룹에 해당하는 회원이 없습니다.
        </div>
      `;
      return;
    }

    const totalPages = Math.max(1, Math.ceil(rcptTotal / RCPT_PAGE_SIZE));
    const STATUS_LABEL = { active: "활성", inactive: "비활성", withdrawn: "탈퇴", suspended: "정지", pending: "대기" };

    const rows = members.map(m => {
      const checked = !excludedIds.has(Number(m.id));
      const trCls = checked ? "" : "rcpt-excluded";
      return `
        <tr class="${trCls}" data-mid="${m.id}">
          <td><input type="checkbox" class="rcpt-cb" data-id="${m.id}" ${checked ? "checked" : ""}></td>
          <td class="col-id">#${m.id}</td>
          <td>${escapeHtml(m.name || "-")}</td>
          <td>${escapeHtml(m.email || "-")}</td>
          <td>${escapeHtml(m.phone || "-")}</td>
          <td>${escapeHtml(m.type || "-")}</td>
          <td class="col-status">${escapeHtml(STATUS_LABEL[m.status] || m.status || "-")}</td>
        </tr>
      `;
    }).join("");

    const includedCount = rcptTotal - excludedIds.size;

    $("rcptArea").innerHTML = `
      <div class="rcpt-meta">
        <div>총 그룹 인원: <strong>${rcptTotal.toLocaleString()}명</strong></div>
        <div>실제 발송: <span class="total">${includedCount.toLocaleString()}명</span></div>
        ${excludedIds.size > 0 ? `<div style="color:#b91c1c">제외: ${excludedIds.size.toLocaleString()}명</div>` : ""}
        <div style="color:#94a3b8;margin-left:auto">· 체크 해제 시 이번 발송에서 제외</div>
      </div>
      <div class="rcpt-table-wrap">
        <table class="rcpt-table">
          <thead>
            <tr>
              <th style="width:36px"><input type="checkbox" id="rcptSelectAllPage" title="현재 페이지 모두 선택/해제" checked></th>
              <th>ID</th><th>이름</th><th>이메일</th><th>연락처</th><th>유형</th><th>상태</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="rcpt-paging">
        <button class="btn btn-sm" id="rcptPrev" ${rcptPage <= 1 ? "disabled" : ""}>‹ 이전</button>
        <span>${rcptPage} / ${totalPages}</span>
        <button class="btn btn-sm" id="rcptNext" ${rcptPage >= totalPages ? "disabled" : ""}>다음 ›</button>
        ${excludedIds.size > 0 ? `<button class="btn btn-sm" id="rcptResetExclude" style="margin-left:14px">↺ 제외 ${excludedIds.size}명 모두 복원</button>` : ""}
      </div>
    `;

    /* 체크박스 이벤트 */
    document.querySelectorAll(".rcpt-cb").forEach(cb => {
      cb.addEventListener("change", e => {
        const id = Number(e.target.dataset.id);
        if (e.target.checked) excludedIds.delete(id);
        else excludedIds.add(id);
        renderRecipients(members);
      });
    });
    $("rcptSelectAllPage")?.addEventListener("change", e => {
      const all = e.target.checked;
      members.forEach(m => {
        if (all) excludedIds.delete(Number(m.id));
        else excludedIds.add(Number(m.id));
      });
      renderRecipients(members);
    });
    $("rcptResetExclude")?.addEventListener("click", () => {
      excludedIds.clear();
      renderRecipients(members);
    });

    $("rcptPrev")?.addEventListener("click", () => {
      if (rcptPage > 1) { rcptPage--; loadRecipients(lastGroupId, rcptPage); }
    });
    $("rcptNext")?.addEventListener("click", () => {
      if (rcptPage < totalPages) { rcptPage++; loadRecipients(lastGroupId, rcptPage); }
    });
  }

  /* ── 등록 ── */
  function getScheduleType() {
    const checked = document.querySelector('input[name="scheduleType"]:checked');
    return checked ? checked.value : "now";
  }

  function validateForm() {
    const name = $("fName").value.trim();
    if (!name)            return { ok: false, msg: "발송 이름을 입력해 주세요." };
    if (name.length > 200) return { ok: false, msg: "발송 이름은 200자 이하여야 합니다." };

    const tplId = $("fTemplate").value;
    if (!tplId) return { ok: false, msg: "템플릿을 선택해 주세요." };

    const channels = getSelectedChannels();
    if (!channels.length) return { ok: false, msg: "발송 채널을 1개 이상 선택해 주세요." };

    /* ★ 2026-05-16: 카카오 + 다른 채널 동시 선택 차단 (UI에서 막혔지만 안전망) */
    if (channels.includes('kakao') && channels.length > 1) {
      return { ok: false, msg: "카카오는 다른 채널과 동시 발송할 수 없습니다. 카카오 단독으로 선택해 주세요." };
    }

    /* ★ 2026-05-16: 카카오 단독 + 미승인 템플릿 차단 */
    if (channels.length === 1 && channels[0] === 'kakao' && currentTemplate) {
      const isKakaoOnly = !!currentTemplate.isKakaoOnly || (currentTemplate.channel === 'kakao' && currentTemplate.alimtalkTemplateCode);
      if (!isKakaoOnly) {
        return { ok: false, msg: "카카오 채널은 알리고에 등록된 카카오 전용 템플릿만 사용할 수 있습니다." };
      }
      if (currentTemplate.alimtalkReviewStatus !== 'approved') {
        const label = { pending: '검수중', rejected: '반려' }[currentTemplate.alimtalkReviewStatus] || currentTemplate.alimtalkReviewStatus || '미승인';
        return { ok: false, msg: `이 카카오 템플릿은 '${label}' 상태라 발송할 수 없습니다. 알리고 콘솔에서 승인 완료 후 다시 시도해 주세요.` };
      }
    }

    const grpId = $("fGroup").value;
    if (!grpId) return { ok: false, msg: "수신자 그룹을 선택해 주세요." };

    const sType = getScheduleType();
    let scheduledAt = null;
    if (sType === "scheduled") {
      const v = $("fScheduledAt").value;
      if (!v) return { ok: false, msg: "예약 시각을 입력해 주세요." };
      const d = new Date(v);
      if (isNaN(d.getTime())) return { ok: false, msg: "예약 시각 형식이 올바르지 않습니다." };
      const minFuture = Date.now() + 60 * 1000;
      if (d.getTime() < minFuture) return { ok: false, msg: "예약 시각은 현재로부터 1분 이후여야 합니다." };
      scheduledAt = d.toISOString();
    }

    /* override — 사용자가 수정했고, 원본과 다르면 전송 */
    let subjectOverride = "";
    let bodyOverride = "";
    if (currentTemplate) {
      const subjEl = $("fSubject");
      const bodyEl = $("fBody");
      if (subjEl && subjEl.value.trim() !== String(currentTemplate.subject || "").trim()) {
        subjectOverride = subjEl.value;
      }
      if (bodyEl && bodyEl.value.trim() !== String(currentTemplate.bodyTemplate || "").trim()) {
        bodyOverride = bodyEl.value;
      }
    }

    /* ★ 2026-05-17: 이미지 override — 이메일 채널이고 사용자가 수정한 경우만 전송 */
    let imagesOverride;
    if (channels.includes('email') && jobImagesDirty) {
      imagesOverride = jobImages;
    }

    /* ★ 2026-05-16: 이메일 전용 옵션 — wrapEmail + attachments */
    const wrapEmail = document.getElementById('fWrapEmail')?.checked === true;
    const attachmentBlobIds = Array.isArray(window._sendJobAttachmentIds) ? window._sendJobAttachmentIds.filter(n => Number.isInteger(n)) : [];

    return {
      ok: true,
      body: {
        name,
        templateId:       Number(tplId),
        recipientGroupId: Number(grpId),
        channels,
        scheduleType:     sType,
        ...(scheduledAt ? { scheduledAt } : {}),
        ...(subjectOverride ? { subjectOverride } : {}),
        ...(bodyOverride ? { bodyOverride } : {}),
        ...(excludedIds.size > 0 ? { excludedMemberIds: Array.from(excludedIds) } : {}),
        ...(imagesOverride !== undefined ? { imagesOverride } : {}),
        ...(channels.includes('email') ? { wrapEmailWithLayout: wrapEmail, attachmentBlobIds } : {}),
      },
    };
  }

  /* ★ 2026-05-16: 첨부파일 업로드 — fAttachments change 시 R2 업로드 + blob_id 누적 */
  function bindAttachmentUpload() {
    const fileInput = document.getElementById('fAttachments');
    const listEl = document.getElementById('fAttachmentList');
    if (!fileInput || !listEl) return;
    if (!window._sendJobAttachmentIds) window._sendJobAttachmentIds = [];

    fileInput.addEventListener('change', async () => {
      const files = Array.from(fileInput.files || []);
      if (files.length === 0) return;
      for (const file of files) {
        if (file.size > 20 * 1024 * 1024) {
          showToast(`${file.name} — 20MB 이하만 첨부 가능`, 'error');
          continue;
        }
        listEl.innerHTML += `<div data-file="uploading">⏳ ${escapeHtml(file.name)} 업로드 중...</div>`;
        try {
          if (!window.SirenEditor || typeof window.SirenEditor.uploadFile !== 'function') {
            throw new Error('업로드 모듈 미설치');
          }
          const result = await window.SirenEditor.uploadFile(file, 'email_attachment');
          if (!result || !result.id) throw new Error('업로드 실패');
          window._sendJobAttachmentIds.push(Number(result.id));
          /* 마지막 uploading 줄을 성공으로 교체 */
          const last = listEl.querySelector('[data-file="uploading"]');
          if (last) last.outerHTML = `✅ ${escapeHtml(file.name)} (${(file.size/1024).toFixed(1)}KB) <button type="button" class="btn-mini" onclick="window._removeAttachment(${result.id}, this)" style="font-size:0.72rem;margin-left:4px;padding:1px 6px">×</button><br>`;
        } catch (err) {
          const last = listEl.querySelector('[data-file="uploading"]');
          if (last) last.outerHTML = `❌ ${escapeHtml(file.name)} 업로드 실패: ${escapeHtml(err.message || '')}<br>`;
        }
      }
      fileInput.value = '';
    });

    window._removeAttachment = (id, btn) => {
      window._sendJobAttachmentIds = (window._sendJobAttachmentIds || []).filter(n => n !== id);
      const line = btn.closest('div') || btn.parentNode;
      if (line && line.remove) line.remove();
    };
  }

  /* ── 파일함 모달 ── */
  const FILE_ICON = { image: '🖼️', pdf: '📄', video: '🎬', audio: '🎵', zip: '🗜️', word: '📝', excel: '📊', ppt: '📋' };
  function fileIcon(name) {
    const ext = String(name || '').split('.').pop().toLowerCase();
    if (['jpg','jpeg','png','gif','webp','svg'].includes(ext)) return FILE_ICON.image;
    if (ext === 'pdf') return FILE_ICON.pdf;
    if (['mp4','mov','avi','mkv'].includes(ext)) return FILE_ICON.video;
    if (['mp3','wav','aac'].includes(ext)) return FILE_ICON.audio;
    if (['zip','gz','tar'].includes(ext)) return FILE_ICON.zip;
    if (['doc','docx'].includes(ext)) return FILE_ICON.word;
    if (['xls','xlsx','csv'].includes(ext)) return FILE_ICON.excel;
    if (['ppt','pptx'].includes(ext)) return FILE_ICON.ppt;
    return '📎';
  }
  function fmtSize(bytes) {
    if (!bytes) return '-';
    if (bytes < 1024) return bytes + 'B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
    return (bytes / 1024 / 1024).toFixed(1) + 'MB';
  }
  function fmtDate(d) {
    if (!d) return '';
    const dt = new Date(d);
    return isNaN(dt) ? '' : dt.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
  }

  let _pickerFiles = [];
  let _pickerSelected = new Set();
  let _pickerSearch = '';

  async function fetchPickerFiles(search) {
    const url = '/api/admin-workspace-files?limit=50' + (search ? '&search=' + encodeURIComponent(search) : '');
    const listEl = $('filePickerList');
    if (listEl) listEl.innerHTML = `<div style="color:#9ca3af;text-align:center;padding:32px 0">불러오는 중…</div>`;
    const res = await api({ method: 'GET', url });
    const payload = res.data?.data ?? res.data ?? {};
    _pickerFiles = payload.rows ?? payload.files ?? res.data?.rows ?? [];
    renderPickerList();
  }

  function renderPickerList() {
    const listEl = $('filePickerList');
    if (!listEl) return;
    if (!_pickerFiles.length) {
      listEl.innerHTML = `<div style="color:#9ca3af;text-align:center;padding:32px 0">파일이 없습니다.</div>`;
      return;
    }
    listEl.innerHTML = _pickerFiles.map(f => {
      const sel = _pickerSelected.has(f.id);
      return `
        <div class="fp-item" data-id="${f.id}" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;cursor:pointer;background:${sel ? '#eff6ff' : '#fff'};border:1px solid ${sel ? '#3b82f6' : '#e2e8f0'};margin-bottom:6px;transition:all 0.1s">
          <div style="font-size:1.3rem;flex-shrink:0">${fileIcon(f.name || f.fileName)}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:0.875rem;font-weight:500;color:#1e293b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(f.name || f.fileName || '파일')}</div>
            <div style="font-size:0.75rem;color:#94a3b8">${fmtSize(f.size || f.fileSize)} · ${fmtDate(f.createdAt || f.uploadedAt)}</div>
          </div>
          <div style="font-size:1.1rem;color:${sel ? '#1e40af' : '#d1d5db'}">${sel ? '✅' : '○'}</div>
        </div>
      `;
    }).join('');
    listEl.querySelectorAll('.fp-item').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.id;
        if (_pickerSelected.has(id)) _pickerSelected.delete(id);
        else _pickerSelected.add(id);
        renderPickerList();
      });
    });
  }

  function openFilePicker() {
    const modal = $('filePickerModal');
    if (!modal) return;
    _pickerSelected.clear();
    _pickerSearch = '';
    const searchEl = $('filePickerSearch');
    if (searchEl) searchEl.value = '';
    modal.style.display = 'flex';
    fetchPickerFiles('');
  }

  function closeFilePicker() {
    const modal = $('filePickerModal');
    if (modal) modal.style.display = 'none';
  }

  function bindFilePickerModal() {
    $('btnPickFromFiles')?.addEventListener('click', openFilePicker);
    $('btnFilePickerClose')?.addEventListener('click', closeFilePicker);
    $('btnFilePickerCancel')?.addEventListener('click', closeFilePicker);

    let searchTimer;
    $('filePickerSearch')?.addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        _pickerSearch = e.target.value.trim();
        fetchPickerFiles(_pickerSearch);
      }, 350);
    });

    $('filePickerModal')?.addEventListener('click', (e) => {
      if (e.target === $('filePickerModal')) closeFilePicker();
    });

    $('btnFilePickerConfirm')?.addEventListener('click', () => {
      const listEl = $('fAttachmentList');
      if (!window._sendJobAttachmentIds) window._sendJobAttachmentIds = [];
      _pickerSelected.forEach(sid => {
        const f = _pickerFiles.find(x => String(x.id) === String(sid));
        if (!f) return;
        const id = Number(f.id);
        if (window._sendJobAttachmentIds.includes(id)) return;
        window._sendJobAttachmentIds.push(id);
        if (listEl) {
          const div = document.createElement('div');
          div.innerHTML = `✅ [파일함] ${escapeHtml(f.name || f.fileName || '파일')} <button type="button" class="btn-mini" style="font-size:0.72rem;margin-left:4px;padding:1px 6px" onclick="window._removeAttachment(${id}, this)">×</button><br>`;
          listEl.appendChild(div.firstChild);
        }
      });
      closeFilePicker();
      if (_pickerSelected.size > 0) showToast(`파일함에서 ${_pickerSelected.size}개 파일 첨부됨`);
    });
  }

  async function submit() {
    if (submitting) return;
    const v = validateForm();
    if (!v.ok) { showToast(v.msg, "error"); return; }

    submitting = true;
    $("btnSubmit").disabled = true;
    $("btnSubmit").textContent = "등록 중…";

    const res = await api({ method: "POST", url: "/api/admin-send-job-create", body: v.body });

    if (!res.ok) {
      const detail = res.data?.error || res.data?.detail || ("HTTP " + res.status);
      showToast("등록 실패: " + detail, "error");
      console.error("[send-job-create]", res);
      submitting = false;
      $("btnSubmit").disabled = false;
      $("btnSubmit").textContent = "등록";
      return;
    }

    const payload = res.data?.data ?? res.data ?? {};
    const ids = payload.ids ?? res.data?.ids ?? [];
    const id  = payload.id  ?? res.data?.id ?? (ids[0] ?? null);
    const channels = v.body.channels;

    if (channels.length > 1) {
      showToast(`${channels.length}개 채널로 발송 작업이 등록되었습니다.`);
    } else if (v.body.scheduleType === "now") {
      showToast("발송이 등록되었습니다. 곧 시작됩니다.");
    } else {
      const when = $("fScheduledAt").value.replace("T", " ");
      showToast(`${when}에 자동 발송됩니다.`);
    }

    setTimeout(() => {
      if (id && channels.length === 1) {
        window.location.href = "/admin-send-job-detail.html?id=" + encodeURIComponent(id);
      } else {
        window.location.href = "/admin-send-jobs.html";
      }
    }, 700);
  }

  function bindEvents() {
    document.querySelectorAll('input[name="scheduleType"]').forEach(el => {
      el.addEventListener("change", () => {
        const t = getScheduleType();
        $("scheduledRow").style.display = (t === "scheduled") ? "" : "none";
      });
    });

    $("fTemplate").addEventListener("change", (e) => {
      loadTemplateDetail(e.target.value);
    });
    $("fGroup").addEventListener("change", (e) => {
      rcptPage = 1;
      loadRecipients(e.target.value, 1);
    });

    bindChannelGrid();
    bindAttachmentUpload();

    $("btnCancel").addEventListener("click", () => {
      window.location.href = "/admin-send-jobs.html";
    });
    $("btnSubmit").addEventListener("click", submit);

    /* ★ 2026-05-17: 발송 작업 이미지 — 업로드·원본 복원 버튼 */
    $('btnJobImageUpload')?.addEventListener('click', () => $('fJobImageFile')?.click());
    $('fJobImageFile')?.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) uploadJobImage(file);
      e.target.value = '';
    });
    $('btnResetJobImages')?.addEventListener('click', () => {
      if (!currentTemplate) return;
      if (!confirm('이미지를 템플릿 원본 상태로 되돌립니다. 이번 발송에서 변경한 내용이 사라집니다. 계속할까요?')) return;
      jobImages = Array.isArray(currentTemplate.images) ? currentTemplate.images.map(i => Object.assign({}, i)) : [];
      jobImagesDirty = false;
      renderJobImagesList();
      const st = $('jobImageUploadStatus');
      if (st) { st.textContent = '↺ 템플릿 원본으로 복원'; st.style.color = '#9a3412'; }
    });

    /* ★ 2026-05-17: 발송 미리보기 새로고침 + 탭 */
    $('btnSendPreview')?.addEventListener('click', refreshSendPreview);
    bindPreviewTabs();

    /* ★ 2026-05-18: 파일함 모달 */
    bindFilePickerModal();
  }

  document.addEventListener("DOMContentLoaded", async () => {
    bindEvents();
    await Promise.all([loadTemplates(), loadGroups()]);
  });
})();
