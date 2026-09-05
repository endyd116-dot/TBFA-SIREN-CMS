/* =========================================================
   SIREN — lantern-complete.js (2026-09-06 「등불의 기적」)
   결제 완료 화면(payment-success / billing-success)에서
   ① 디지털 후원 증서(등불 N번 · 이름 마스킹 선택 · 「함께 지키는 사람」) — S8
   ② 「선생님께 한마디」(60자) + 캠페인 페이지 공개 동의 — S11
   ③ 랜딩(withwork)으로 되돌아가기 (?lit=1&am_anon&gate) — S6-b
   주소에 lantern=1 이 있을 때만 켜진다. 컨테이너: #lanternComplete
   ========================================================= */
(function () {
  'use strict';

  var params = new URLSearchParams(location.search);
  var box = document.getElementById('lanternComplete');
  if (!box) return;
  if (params.get('lantern') !== '1') return;

  var donationId = Number(params.get('donationId') || 0);
  var amLp = String(params.get('am_lp') || '').trim();
  var amAnon = String(params.get('am_anon') || '').trim();
  var gate = String(params.get('gate') || '').trim();
  var intent = String(params.get('intent') || '').trim();   /* 통보문 ⑧ — AM 모달 결제 의도 id */
  var NOTICE_DONE = '후원 내역·해지·증서는 교사유가족협의회 홈페이지 마이페이지에서 보실 수 있습니다.';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function unwrap(json) {
    if (!json || typeof json !== 'object') return {};
    return (json.data && json.data.data) || json.data || json || {};
  }
  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + String(d.getDate()).padStart(2, '0');
  }
  function toast(msg) {
    if (window.SIREN && typeof window.SIREN.toast === 'function') window.SIREN.toast(msg);
  }

  /* 랜딩 되돌아가기 주소 — 서버가 준 값 우선, 없으면 주소 파라미터로 조립 */
  function buildReturnUrl(data) {
    if (data && data.returnUrl) return data.returnUrl;
    var lp = amLp || (data && data.landingLp) || '';
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(lp)) return '';
    var base = (data && data.landingBase) || 'https://withwork.tbfa.co.kr';
    var u = base.replace(/\/+$/, '') + '/lp/' + encodeURIComponent(lp) + '?lit=1';
    if (amAnon && /^[a-zA-Z0-9_.:-]{1,120}$/.test(amAnon)) u += '&am_anon=' + encodeURIComponent(amAnon);
    if (/^[1-3]$/.test(gate)) u += '&gate=' + gate;
    if (/^[a-f0-9]{32}$/.test(intent)) u += '&intent=' + intent;
    return u;
  }

  var _data = null;
  var _masked = false;

  function cardHtml() {
    var d = _data;
    var name = _masked ? d.maskedName : d.name;
    return (
      '<div class="lt-card" id="ltCard">' +
        '<div class="lc-eyebrow">' + esc((d.certificate && d.certificate.campaignLabel) || '등불의 기적') + '</div>' +
        '<div class="lc-orb"></div>' +
        '<div class="lc-no">' + esc(d.lanternNo) + '<small>번째 등불</small></div>' +
        '<div class="lc-name">' + esc(name) + ' 님</div>' +
        '<div class="lc-tag">' + esc((d.certificate && d.certificate.tagline) || '함께 지키는 사람') + '</div>' +
        '<div class="lc-foot">교사유가족협의회 · ' + esc((d.certificate && d.certificate.campaignLabel) || '등불의 기적') + '</div>' +
        '<div class="lc-date">' + esc(fmtDate(d.at)) + (d.monthly ? ' · 정기 후원회원' : ' · 일시 후원') + '</div>' +
      '</div>'
    );
  }

  function render() {
    var d = _data;
    var returnUrl = buildReturnUrl(d);
    box.innerHTML =
      '<div class="lt-complete">' +
        '<h2>당신의 등불이 켜졌습니다</h2>' +
        '<p class="lt-complete-sub">이 증서는 마이페이지에서 언제든 다시 볼 수 있습니다.<br />카카오톡 프로필·학교 게시용으로 이미지로 저장해 보세요.</p>' +
        '<div id="ltCardWrap">' + cardHtml() + '</div>' +
        '<label class="lt-mask-line"><input type="checkbox" id="ltMaskToggle"' + (_masked ? ' checked' : '') + '> 이름을 마스킹해서 보여주기 (' + esc(d.maskedName) + ')</label>' +
        '<div class="lt-tools">' +
          '<button type="button" class="lt-btn" id="ltSaveImg">🖼️ 증서 이미지 저장·공유</button>' +
          '<button type="button" class="lt-btn" id="ltCopyLink">🔗 캠페인 링크 복사</button>' +
          (returnUrl ? '<a class="lt-btn gold" id="ltReturn" href="' + esc(returnUrl) + '">내 등불 보러 가기 →</a>' : '') +
        '</div>' +
        '<div class="lt-note">' +
          '<label class="lt-note-title" for="ltNote">선생님께 한마디 <small>선택 · 60자</small></label>' +
          '<textarea id="ltNote" maxlength="60" placeholder="예: 선생님, 이제 여기는 걱정 마세요.">' + esc(d.note || '') + '</textarea>' +
          '<div class="lt-count"><span id="ltNoteCount">' + String(d.note || '').length + '</span>/60</div>' +
          '<label class="lt-consent"><input type="checkbox" id="ltConsent"' + (d.publicConsent ? ' checked' : '') + '> 이름(마스킹)·한마디를 캠페인 페이지에 보여줘도 됩니다</label>' +
          '<div class="lt-note-actions"><button type="button" class="lt-btn gold" id="ltNoteSave">저장</button><span class="lt-note-msg" id="ltNoteMsg"></span></div>' +
        '</div>' +
        '<p class="lt-receipt-line">' + esc(NOTICE_DONE) + (d.receiptNotice ? '<br />' + esc(d.receiptNotice) : '') + '</p>' +
      '</div>';

    var mask = document.getElementById('ltMaskToggle');
    if (mask) mask.addEventListener('change', function () {
      _masked = !!mask.checked;
      var wrap = document.getElementById('ltCardWrap');
      if (wrap) wrap.innerHTML = cardHtml();
    });

    var note = document.getElementById('ltNote');
    var count = document.getElementById('ltNoteCount');
    if (note && count) note.addEventListener('input', function () { count.textContent = String(Array.from(note.value).length); });

    var save = document.getElementById('ltNoteSave');
    if (save) save.addEventListener('click', saveNote);

    var img = document.getElementById('ltSaveImg');
    if (img) img.addEventListener('click', saveImage);

    var copy = document.getElementById('ltCopyLink');
    if (copy) copy.addEventListener('click', function () {
      var slug = d.campaign && d.campaign.slug ? d.campaign.slug : '';
      var url = location.origin + '/campaign.html?slug=' + encodeURIComponent(slug);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () { toast('캠페인 링크가 복사되었습니다'); }, function () { toast(url); });
      } else { toast(url); }
    });

    box.hidden = false;
  }

  async function saveNote() {
    var note = document.getElementById('ltNote');
    var consent = document.getElementById('ltConsent');
    var msg = document.getElementById('ltNoteMsg');
    var btn = document.getElementById('ltNoteSave');
    if (btn) btn.disabled = true;
    if (msg) msg.textContent = '저장 중...';
    try {
      var res = await fetch('/api/lantern-donation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ donationId: donationId, note: note ? note.value : '', publicConsent: !!(consent && consent.checked) })
      });
      var json = await res.json().catch(function () { return {}; });
      if (!res.ok || json.ok === false) throw new Error(json.error || '저장 실패');
      var d = unwrap(json);
      if (d && d.donationId) { _data = Object.assign({}, _data, d); }
      if (msg) msg.textContent = (consent && consent.checked) ? '저장했습니다 — 캠페인 페이지 «최근 켜진 등불»에 보입니다' : '저장했습니다';
      toast('저장되었습니다');
    } catch (e) {
      if (msg) msg.textContent = e.message || '저장하지 못했습니다';
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  /* 증서를 이미지(PNG)로 — 카카오톡 공유(모바일 공유 시트) 또는 내려받기 */
  async function saveImage() {
    var d = _data;
    var W = 1080, H = 1350;
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var ctx = cv.getContext('2d');

    var g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#141519'); g.addColorStop(1, '#0a0b0d');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#8a6420'; ctx.lineWidth = 4; ctx.strokeRect(40, 40, W - 80, H - 80);
    ctx.strokeStyle = 'rgba(240,207,142,0.18)'; ctx.lineWidth = 2; ctx.strokeRect(70, 70, W - 140, H - 140);

    /* 등불(빛) */
    var rg = ctx.createRadialGradient(W / 2, 400, 10, W / 2, 400, 260);
    rg.addColorStop(0, 'rgba(240,207,142,0.55)'); rg.addColorStop(0.4, 'rgba(217,164,65,0.18)'); rg.addColorStop(1, 'rgba(217,164,65,0)');
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(W / 2, 400, 260, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f0cf8e'; ctx.beginPath(); ctx.arc(W / 2, 400, 18, 0, Math.PI * 2); ctx.fill();

    ctx.textAlign = 'center';
    ctx.fillStyle = '#8b8880';
    ctx.font = '400 30px "Noto Sans KR", sans-serif';
    ctx.fillText((d.certificate && d.certificate.campaignLabel) || '등불의 기적', W / 2, 200);

    ctx.fillStyle = '#f0cf8e';
    ctx.font = '900 190px "Noto Serif KR", serif';
    ctx.fillText(String(d.lanternNo), W / 2, 660);
    ctx.fillStyle = '#8b8880';
    ctx.font = '400 32px "Noto Sans KR", sans-serif';
    ctx.fillText('번째 등불', W / 2, 720);

    ctx.fillStyle = '#ffffff';
    ctx.font = '600 64px "Noto Serif KR", serif';
    ctx.fillText((_masked ? d.maskedName : d.name) + ' 님', W / 2, 850);
    ctx.fillStyle = '#b5b1a9';
    ctx.font = '400 40px "Noto Sans KR", sans-serif';
    ctx.fillText((d.certificate && d.certificate.tagline) || '함께 지키는 사람', W / 2, 920);

    ctx.strokeStyle = '#1e2126'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(160, 1080); ctx.lineTo(W - 160, 1080); ctx.stroke();
    ctx.fillStyle = '#5c5a55';
    ctx.font = '400 28px "Noto Sans KR", sans-serif';
    ctx.fillText('교사유가족협의회 · ' + ((d.certificate && d.certificate.campaignLabel) || '등불의 기적'), W / 2, 1140);
    ctx.fillStyle = '#8b8880';
    ctx.fillText(fmtDate(d.at) + (d.monthly ? ' · 정기 후원회원' : ' · 일시 후원'), W / 2, 1190);
    ctx.fillStyle = '#5c5a55';
    ctx.font = '400 24px "Noto Sans KR", sans-serif';
    ctx.fillText('tbfa.co.kr', W / 2, 1250);

    var fileName = 'lantern-' + d.lanternNo + '.png';
    cv.toBlob(async function (blob) {
      if (!blob) { toast('이미지를 만들지 못했습니다'); return; }
      try {
        var file = new File([blob], fileName, { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
          await navigator.share({ files: [file], title: '등불의 기적 — ' + d.lanternNo + '번째 등불', text: '함께 지키는 사람 · 교사유가족협의회' });
          return;
        }
      } catch (e) { /* 공유 취소·미지원 → 내려받기 */ }
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      toast('증서 이미지를 저장했습니다');
    }, 'image/png');
  }

  function renderFallback() {
    var returnUrl = buildReturnUrl(null);
    box.innerHTML =
      '<div class="lt-complete">' +
        '<h2>당신의 등불이 켜졌습니다</h2>' +
        '<p class="lt-complete-sub">' + esc(NOTICE_DONE) + '<br />등불 증서와 「선생님께 한마디」는 마이페이지 &gt; 후원 내역에서 볼 수 있습니다(비밀번호는 가입 메일의 링크로 설정).</p>' +
        (returnUrl ? '<div class="lt-tools"><a class="lt-btn gold" href="' + esc(returnUrl) + '">내 등불 보러 가기 →</a></div>' : '') +
      '</div>';
    box.hidden = false;
  }

  (async function init() {
    try { sessionStorage.removeItem('siren_am_return'); } catch (e) {}
    if (!donationId) { renderFallback(); return; }
    try {
      var res = await fetch('/api/lantern-donation?donationId=' + donationId, { credentials: 'include' });
      var json = await res.json().catch(function () { return {}; });
      if (!res.ok || json.ok === false) { renderFallback(); return; }
      _data = unwrap(json);
      if (!_data || !_data.lanternNo) { renderFallback(); return; }
      render();
    } catch (e) {
      renderFallback();
    }
  })();
})();
