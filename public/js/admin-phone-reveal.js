/**
 * admin-phone-reveal.js — 전화번호 [원본 보기] / [숨기기] 공통 헬퍼
 *
 * 사용법 A (DOM 직접): createRevealButton(type, id, phoneCell) → 버튼 DOM 반환
 *   phoneCell: 전화번호 텍스트를 직접 포함하는 <td> 또는 <span> 등 DOM 요소
 *
 * 사용법 B (일괄 처리): attachRevealButtons(container)
 *   container 내부에서 data-phone-type, data-phone-id를 가진 <td>를 찾아
 *   자동으로 버튼을 삽입한다.
 *   렌더링 후 한 번 호출: attachRevealButtons(document.getElementById('...'))
 */
(function (global) {
  'use strict';

  function createRevealButton(type, id, phoneCell) {
    let maskedValue = null;

    const btn = document.createElement('button');
    btn.textContent = '원본 보기';
    btn.className = 'adm-phone-reveal-btn';
    btn.style.cssText =
      'margin-left:6px;padding:2px 7px;font-size:11px;' +
      'border:1px solid var(--tok-line,#ddd);border-radius:4px;' +
      'background:#fff;color:var(--tok-text-2,#555);cursor:pointer;' +
      'vertical-align:middle;white-space:nowrap;';

    btn.addEventListener('click', async function () {
      if (btn.dataset.revealed === '1') {
        // 숨기기 — 저장해둔 마스킹 값으로 복귀
        if (maskedValue !== null) {
          const textNode = phoneCell.querySelector('.adm-phone-text');
          if (textNode) textNode.textContent = maskedValue;
          else phoneCell.childNodes[0].textContent = maskedValue;
        }
        btn.textContent = '원본 보기';
        btn.dataset.revealed = '0';
        return;
      }

      btn.textContent = '...';
      btn.disabled = true;

      try {
        const res = await fetch(
          '/api/admin-phone-reveal?type=' + encodeURIComponent(type) +
          '&id=' + encodeURIComponent(id),
          { credentials: 'include' }
        );
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || 'HTTP ' + res.status);

        const textNode = phoneCell.querySelector('.adm-phone-text');
        maskedValue = textNode ? textNode.textContent : phoneCell.childNodes[0]?.textContent;
        if (textNode) textNode.textContent = data.phone;
        else if (phoneCell.childNodes[0]) phoneCell.childNodes[0].textContent = data.phone;

        btn.textContent = '숨기기';
        btn.dataset.revealed = '1';
      } catch (err) {
        btn.textContent = '원본 보기';
        console.warn('[phone-reveal] 오류:', err);
        if (typeof window.toast === 'function') {
          window.toast('전화번호 조회 실패: ' + (err.message || err));
        }
      } finally {
        btn.disabled = false;
      }
    });

    return btn;
  }

  /**
   * container 내 [data-phone-type][data-phone-id] <td> 에 버튼 일괄 삽입
   * 이미 버튼이 삽입된 셀은 건너뜀 (중복 방지)
   */
  function attachRevealButtons(container) {
    if (!container) return;
    container.querySelectorAll('td[data-phone-type][data-phone-id]').forEach(function (td) {
      if (td.querySelector('.adm-phone-reveal-btn')) return; // 이미 삽입됨

      // 기존 텍스트를 span으로 감싸기
      const text = td.textContent.trim();
      td.innerHTML = '';
      const span = document.createElement('span');
      span.className = 'adm-phone-text';
      span.textContent = text;
      td.appendChild(span);

      const btn = createRevealButton(td.dataset.phoneType, td.dataset.phoneId, td);
      td.appendChild(btn);
    });
  }

  global.createRevealButton = createRevealButton;
  global.attachRevealButtons = attachRevealButtons;
})(window);
