// public/js/home-campaigns.js
// ★ Phase M-19-2: 홈페이지 캠페인 카드 자동 노출
// - 진행 중인 캠페인 최대 3개 (isPinned 우선)
// - 빈 경우 영역 자체를 숨김
(function () {
  'use strict';

  const TYPE_LABEL = { fundraising: '💰 모금', memorial: '🎗 추모', awareness: '📣 인식' };

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function loadHomeCampaigns() {
    const section = document.getElementById('homeCampaignSection');
    const grid = document.getElementById('homeCampaignGrid');
    if (!section || !grid) return;

    try {
      const res = await fetch('/api/campaigns?featured=1', { credentials: 'include' });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        section.style.display = 'none';
        return;
      }
      const list = (data.data?.list || []).slice(0, 3);
      if (list.length === 0) {
        section.style.display = 'none';
        return;
      }

      grid.innerHTML = list.map(c => {
        const thumb = c.thumbnailBlobId
          ? `background-image:url('/api/blob-image?id=${c.thumbnailBlobId}')`
          : 'background:linear-gradient(135deg,#7a1f2b,#a64252)';
        const goal = c.goalAmount || 0;
        const raised = c.raisedAmount || 0;
        const pct = c.progressPercent;
        const progressBlock = goal > 0
          ? `<div style="background:#f0f0f0;height:6px;border-radius:3px;overflow:hidden;margin-bottom:6px">
              <div style="background:var(--brand);height:100%;width:${pct}%"></div>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:12px">
              <span style="font-weight:700;color:var(--brand);font-family:Inter,monospace">₩${raised.toLocaleString()}</span>
              <span style="color:var(--text-3)">${pct}%</span>
            </div>`
          : `<div style="font-size:12px;color:var(--text-2)">
              👥 ${c.donorCount || 0}명 후원
              ${c.remainingDays !== null ? ` · D-${c.remainingDays}` : ''}
            </div>`;

        return `<a href="/campaign.html?slug=${encodeURIComponent(c.slug)}"
                   style="display:block;background:#fff;border:1px solid var(--line);border-radius:12px;overflow:hidden;text-decoration:none;color:inherit;transition:all 0.2s"
                   onmouseover="this.style.boxShadow='0 8px 20px rgba(0,0,0,0.08)';this.style.transform='translateY(-2px)'"
                   onmouseout="this.style.boxShadow='';this.style.transform=''">
          <div style="width:100%;height:160px;${thumb};background-size:cover;background-position:center;position:relative">
            ${c.isPinned ? '<span style="position:absolute;top:10px;left:10px;background:var(--brand);color:#fff;padding:2px 9px;border-radius:10px;font-size:10.5px;font-weight:600">📌 추천</span>' : ''}
            <span style="position:absolute;top:10px;right:10px;background:rgba(255,255,255,0.95);padding:2px 9px;border-radius:10px;font-size:10.5px;font-weight:600">${TYPE_LABEL[c.type] || c.type}</span>
          </div>
          <div style="padding:16px 18px">
            <div style="font-size:15px;font-weight:700;line-height:1.4;margin-bottom:6px;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden">${escapeHtml(c.title)}</div>
            <div style="font-size:12.5px;color:var(--text-3);line-height:1.5;min-height:38px;margin-bottom:10px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${escapeHtml(c.summary || '')}</div>
            ${progressBlock}
          </div>
        </a>`;
      }).join('');

      section.style.display = '';
    } catch (e) {
      console.warn('[home-campaigns]', e);
      section.style.display = 'none';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadHomeCampaigns);
  } else {
    loadHomeCampaigns();
  }
})();