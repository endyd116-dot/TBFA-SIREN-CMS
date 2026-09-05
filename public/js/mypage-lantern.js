/* =========================================================
   SIREN — mypage-lantern.js (2026-09-06 「등불의 기적」 S8·S11)
   마이페이지 > 후원 내역 안에 «내 등불» 패널:
   등불 번호 · 증서 다시 보기 · 「선생님께 한마디」(60자) · 캠페인 페이지 공개 동의
   (auth.js는 보호 파일이라 건드리지 않고 별도 파일로 덧붙인다)
   ========================================================= */
(function () {
  'use strict';

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

  var _rendered = false;

  async function load() {
    if (_rendered) return;
    var anchor = document.getElementById('mpBillingContainer');
    if (!anchor) return;
    try {
      var res = await fetch('/api/lantern-donation?mine=1', { credentials: 'include' });
      if (!res.ok) return;
      var json = await res.json().catch(function () { return {}; });
      var list = (unwrap(json).list) || [];
      if (!list.length) return;
      _rendered = true;

      var wrap = document.createElement('div');
      wrap.className = 'lt-mine';
      wrap.innerHTML =
        '<h4>🕯️ 내 등불</h4>' +
        list.map(function (d) {
          var certUrl = '/payment-success.html?donationId=' + d.donationId + '&donationNo=D-' + String(d.donationId).padStart(7, '0') + '&lantern=1';
          return (
            '<div class="lt-mine-item" data-id="' + d.donationId + '">' +
              '<div><div class="lt-mine-no">' + (d.lanternNo ? esc(d.lanternNo) : '·') + '<small>번째 등불</small></div></div>' +
              '<div>' +
                '<div class="lt-mine-meta">' + esc(d.campaign && d.campaign.title) + ' · ' + esc(fmtDate(d.at)) + ' · ' + Number(d.amount || 0).toLocaleString() + '원' + (d.monthly ? ' (정기)' : ' (일시)') +
                  ' · <a href="' + esc(certUrl) + '" style="color:var(--lt-emh)">증서 보기</a></div>' +
                '<div class="lt-note">' +
                  '<label class="lt-note-title">선생님께 한마디 <small>선택 · 60자</small></label>' +
                  '<textarea maxlength="60" data-note>' + esc(d.note || '') + '</textarea>' +
                  '<label class="lt-consent"><input type="checkbox" data-consent' + (d.publicConsent ? ' checked' : '') + '> 이름(마스킹)·한마디를 캠페인 페이지에 보여줘도 됩니다</label>' +
                  '<div class="lt-note-actions"><button type="button" class="lt-btn gold" data-save>저장</button><span class="lt-note-msg" data-msg></span></div>' +
                '</div>' +
              '</div>' +
            '</div>'
          );
        }).join('');
      anchor.insertAdjacentElement('afterend', wrap);

      wrap.addEventListener('click', async function (e) {
        var btn = e.target.closest('[data-save]');
        if (!btn) return;
        var item = btn.closest('.lt-mine-item');
        var id = Number(item.dataset.id);
        var note = item.querySelector('[data-note]');
        var consent = item.querySelector('[data-consent]');
        var msg = item.querySelector('[data-msg]');
        btn.disabled = true;
        if (msg) msg.textContent = '저장 중...';
        try {
          var r = await fetch('/api/lantern-donation', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ donationId: id, note: note ? note.value : '', publicConsent: !!(consent && consent.checked) })
          });
          var j = await r.json().catch(function () { return {}; });
          if (!r.ok || j.ok === false) throw new Error(j.error || '저장 실패');
          if (msg) msg.textContent = '저장했습니다';
          toast('저장되었습니다');
        } catch (err) {
          if (msg) msg.textContent = err.message || '저장하지 못했습니다';
        } finally {
          btn.disabled = false;
        }
      });
    } catch (e) {
      /* 비로그인·컬럼 미적용 등은 조용히 */
    }
  }

  /* 로그인 확인이 끝난 뒤 그린다 — auth.js 가 후원 내역을 갱신하는 시점을 기다린다 */
  var tries = 0;
  var timer = setInterval(function () {
    tries++;
    var auth = window.SIREN_AUTH;
    if (auth && auth.isLoggedIn()) {
      clearInterval(timer);
      load();
    } else if (tries > 40) {
      clearInterval(timer);
    }
  }, 500);
})();
