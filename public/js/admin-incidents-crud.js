/* =========================================================
   SIREN — admin-incidents-crud.js (B-3)
   사건 게시글 CRUD (관리자 탭)
   ========================================================= */
(function () {
  'use strict';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '—' : d.getFullYear() + '.' + String(d.getMonth()+1).padStart(2,'0') + '.' + String(d.getDate()).padStart(2,'0');
  }
  function toast(msg) {
    if (window.SIREN && window.SIREN.toast) { window.SIREN.toast(msg); return; }
    const t = document.getElementById('toast');
    if (t) { t.textContent = msg; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2400); }
  }
  async function api(path, opts) {
    opts = opts || {};
    const init = { method: opts.method || 'GET', credentials: 'include', headers: { 'Content-Type': 'application/json' } };
    if (opts.body) init.body = JSON.stringify(opts.body);
    const res = await fetch(path, init);
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok && data.ok !== false, data };
  }

  const CAT_LABEL = { school: '학교', public: '공개', other: '기타' };

  async function loadPosts() {
    const tbody = document.getElementById('icPostsTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text-3)">불러오는 중...</td></tr>';

    const res = await api('/api/admin/incidents-crud');
    if (!res.ok) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--danger)">조회 실패</td></tr>';
      return;
    }

    const list = res.data?.data?.list || [];
    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-3)">등록된 사건이 없습니다</td></tr>';
      return;
    }

    tbody.innerHTML = list.map(i => {
      const statusBadge = i.status === 'active'
        ? '<span class="badge b-success">활성</span>'
        : '<span class="badge b-mute">비활성</span>';
      return `<tr>
        <td>${i.id}</td>
        <td><strong>${esc(i.title)}</strong><div style="font-size:11px;color:var(--text-3);font-family:Inter">${esc(i.slug)}</div></td>
        <td>${CAT_LABEL[i.category] || i.category}</td>
        <td style="font-size:12px">${fmtDate(i.occurredAt)}</td>
        <td style="font-size:12px">${esc(i.location || '—')}</td>
        <td>${statusBadge}</td>
        <td>
          <div style="display:flex;gap:4px">
            <button type="button" class="btn-sm btn-sm-ghost" data-ic-edit="${i.id}" style="font-size:11px;padding:4px 10px">수정</button>
            <button type="button" class="btn-sm btn-sm-ghost" data-ic-delete="${i.id}" data-title="${esc(i.title)}" style="font-size:11px;padding:4px 10px;color:var(--danger);border-color:#f5b5bb">삭제</button>
          </div>
        </td>
      </tr>`;
    }).join('');
  }

  async function openEditModal(id) {
    const title = id ? '사건 수정' : '새 사건 등록';
    let data = { title: '', slug: '', summary: '', contentHtml: '', category: 'school', location: '', occurredAt: '', status: 'active', sortOrder: 0 };

    if (id) {
      const res = await api('/api/admin/incidents-crud?id=' + id);
      if (!res.ok) { toast('사건 조회 실패'); return; }
      data = res.data?.data?.incident || data;
    }

    const html = `
      <div style="background:#fff;border-radius:12px;max-width:680px;width:100%;padding:28px 32px;margin:auto;box-shadow:0 20px 60px rgba(0,0,0,0.3)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">
          <h3 class="serif" style="margin:0">${title}</h3>
          <button type="button" id="icModalClose" style="background:none;border:none;font-size:24px;cursor:pointer;color:var(--text-3)">${Icons.svg('x')}</button>
        </div>
        <form id="icEditForm">
          <input type="hidden" id="icEditId" value="${id || ''}">
          <div class="fg"><label>제목 <span style="color:var(--danger)">*</span></label><input type="text" id="icTitle" required maxlength="200" value="${esc(data.title)}"></div>
          <div class="fg"><label>slug <span style="font-weight:400;color:var(--text-3);font-size:11px">(URL용, 자동생성)</span></label><input type="text" id="icSlug" maxlength="100" value="${esc(data.slug)}"></div>
          <div class="fg"><label>요약</label><textarea id="icSummary" rows="2" maxlength="500">${esc(data.summary || '')}</textarea></div>
          <div class="fg"><label>본문 HTML</label><textarea id="icContentHtml" rows="8" maxlength="100000">${esc(data.contentHtml || '')}</textarea></div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:14px">
            <div class="fg" style="margin:0"><label>분류</label>
              <select id="icCategory"><option value="school" ${data.category==='school'?'selected':''}>학교</option><option value="public" ${data.category==='public'?'selected':''}>공개</option><option value="other" ${data.category==='other'?'selected':''}>기타</option></select>
            </div>
            <div class="fg" style="margin:0"><label>발생일</label><input type="date" id="icOccurredAt" value="${data.occurredAt ? new Date(data.occurredAt).toISOString().slice(0,10) : ''}"></div>
            <div class="fg" style="margin:0"><label>지역</label><input type="text" id="icLocation" maxlength="200" value="${esc(data.location || '')}"></div>
          </div>
          <div style="display:flex;gap:14px;margin-bottom:14px">
            <label style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px;cursor:pointer">
              <input type="radio" name="icStatus" value="active" ${data.status==='active'?'checked':''}> 활성
            </label>
            <label style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px;cursor:pointer">
              <input type="radio" name="icStatus" value="inactive" ${data.status!=='active'?'checked':''}> 비활성
            </label>
          </div>
          <div style="display:flex;gap:10px;margin-top:14px">
            <button type="submit" class="btn btn-primary" style="flex:1">저장</button>
            <button type="button" id="icModalCancel" class="btn btn-outline" style="padding:11px 20px">취소</button>
          </div>
        </form>
      </div>
    `;

    let overlay = document.getElementById('icEditOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'icEditOverlay';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:40px 20px;overflow-y:auto';
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = html;
    overlay.style.display = 'flex';

    overlay.querySelector('#icModalClose').addEventListener('click', () => overlay.style.display = 'none');
    overlay.querySelector('#icModalCancel').addEventListener('click', () => overlay.style.display = 'none');
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.style.display = 'none'; });

    overlay.querySelector('#icEditForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const editId = document.getElementById('icEditId').value;
      const body = {
        title: document.getElementById('icTitle').value.trim(),
        slug: document.getElementById('icSlug').value.trim() || undefined,
        summary: document.getElementById('icSummary').value.trim() || null,
        contentHtml: document.getElementById('icContentHtml').value.trim() || null,
        category: document.getElementById('icCategory').value,
        occurredAt: document.getElementById('icOccurredAt').value || null,
        location: document.getElementById('icLocation').value.trim() || null,
        status: document.querySelector('input[name="icStatus"]:checked')?.value || 'active',
      };

      if (!body.title) { toast('제목을 입력해주세요'); return; }

      let res;
      if (editId) {
        res = await api('/api/admin/incidents-crud', { method: 'PATCH', body: { id: Number(editId), ...body } });
      } else {
        res = await api('/api/admin/incidents-crud', { method: 'POST', body });
      }

      if (res.ok) {
        toast(res.data?.message || '저장되었습니다');
        overlay.style.display = 'none';
        loadPosts();
      } else {
        toast(res.data?.error || '저장 실패');
      }
    });
  }

  /* ============ 이벤트 ============ */
   /* ============ 이벤트 ============ */
  function setup() {
    /* 서브탭 전환 */
    document.addEventListener('click', (e) => {
      const tab = e.target.closest('[data-ictab]');
      if (!tab) return;
      e.preventDefault();
      const target = tab.dataset.ictab;
      document.querySelectorAll('#adm-siren-incidents .ct-tab[data-ictab]').forEach(t => t.classList.remove('on'));
      tab.classList.add('on');
      /* 7번 수정: 부모 ID 셀렉터 제거 + setProperty로 important 덮기 */
      document.querySelectorAll('.ic-tab-pane[data-ictab-pane]').forEach(p => {
        if (p.dataset.ictabPane === target) {
          p.style.setProperty('display', 'block', 'important');
        } else {
          p.style.setProperty('display', 'none', 'important');
        }
      });
      console.log('[B-3] 탭 전환:', target);
      if (target === 'posts') {
        setTimeout(() => loadPosts(), 50);
      }
      if (target === 'reports' && window.SIREN_ADMIN_SIREN) {
        window.SIREN_ADMIN_SIREN.loadList('incident');
      }
    });
    /* 새 사건 등록 */
    document.addEventListener('click', (e) => {
      if (e.target.closest('#icNewPostBtn')) { e.preventDefault(); openEditModal(null); }
    });

    /* 수정/삭제 */
    document.addEventListener('click', async (e) => {
      const editBtn = e.target.closest('[data-ic-edit]');
      if (editBtn) { e.preventDefault(); openEditModal(Number(editBtn.dataset.icEdit)); return; }

      const delBtn = e.target.closest('[data-ic-delete]');
      if (delBtn) {
        e.preventDefault();
        const id = Number(delBtn.dataset.icDelete);
        const title = delBtn.dataset.title || '';
        if (!confirm(`"${title}" 사건을 삭제하시겠습니까?\n\n관련 제보와 댓글도 모두 삭제됩니다.`)) return;

        const res = await api('/api/admin/incidents-crud?id=' + id, { method: 'DELETE' });
        if (res.ok) { toast('삭제되었습니다'); loadPosts(); }
        else toast(res.data?.error || '삭제 실패');
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }
})();