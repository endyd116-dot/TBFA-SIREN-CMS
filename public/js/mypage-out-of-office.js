/**
 * Phase 21 R3 — 마이페이지 운영자 부재 토글 카드
 *
 * - 운영자(관리자 세션 보유)일 때만 카드를 표시
 * - API: GET/POST/DELETE /api/admin-user-preferences
 *
 * 동작:
 *   GET    /api/admin-user-preferences        → { outOfOffice, outOfOfficeStart, outOfOfficeEnd, outOfOfficeNote }
 *   POST   /api/admin-user-preferences        { outOfOfficeStart, outOfOfficeEnd, outOfOfficeNote }
 *   DELETE /api/admin-user-preferences        → 부재 해제
 */
(function () {
  'use strict';

  function $(s, root) { return (root || document).querySelector(s); }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[m]));
  }

  function toast(msg, type) {
    // mypage 공용 토스트 — 없으면 alert 대체
    const root = document.getElementById('mpToastRoot') || document.body;
    const el = document.createElement('div');
    el.className = 'mp-out-toast';
    el.textContent = msg;
    el.style.cssText = 'position:fixed;bottom:24px;right:24px;padding:12px 18px;background:' +
      (type === 'error' ? '#b91c1c' : type === 'success' ? '#15803d' : '#334155') +
      ';color:#fff;border-radius:6px;z-index:99999;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.15)';
    root.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  async function api(path, opts) {
    opts = opts || {};
    const res = await fetch(path, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      method: opts.method || 'GET',
      body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body
    });
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) {
      // 401/403 → 일반 회원이라 미노출
      const err = new Error((data && (data.error || data.message)) || 'HTTP ' + res.status);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function isActive(start, end) {
    if (!start || !end) return false;
    try {
      const today = new Date();
      const todayYmd = today.toISOString().slice(0, 10);
      return start <= todayYmd && todayYmd <= end;
    } catch (_) { return false; }
  }

  function fmtDate(d) {
    if (!d) return '';
    return String(d).slice(0, 10);
  }

  function renderCard(card, state) {
    const start = state && state.outOfOfficeStart ? fmtDate(state.outOfOfficeStart) : '';
    const end = state && state.outOfOfficeEnd ? fmtDate(state.outOfOfficeEnd) : '';
    const note = state && state.outOfOfficeNote ? state.outOfOfficeNote : '';
    const active = isActive(start, end) || (state && state.outOfOffice);

    const hasReservation = !!(start && end);

    card.innerHTML = `
      <h3 class="serif">내 부재 일정</h3>
      <p class="sub">부재 기간을 미리 등록하면, 부재 중에 들어오는 새 카드는 백업 담당자에게 자동 인계됩니다.</p>

      <div class="mp-ooo-status" style="padding:14px 16px;border:1px solid var(--line);border-radius:8px;background:${active ? '#fef3c7' : '#f0fdf4'};margin-bottom:14px">
        <strong style="font-size:14px;color:${active ? '#92400e' : '#15803d'}">
          현재 상태: ${active ? '부재 중' : '근무 중'}
        </strong>
        ${hasReservation ? `<div style="font-size:12.5px;color:var(--text-3);margin-top:6px">
          예약: ${escapeHtml(start)} ~ ${escapeHtml(end)} ${note ? '· ' + escapeHtml(note) : ''}
        </div>` : ''}
      </div>

      <div class="mp-ooo-form" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:end">
        <div>
          <label style="display:block;font-size:12.5px;color:var(--text-3);margin-bottom:4px">시작일</label>
          <input type="date" id="mpOooStart" value="${escapeHtml(start)}" style="width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:6px;font-size:13px">
        </div>
        <div>
          <label style="display:block;font-size:12.5px;color:var(--text-3);margin-bottom:4px">종료일</label>
          <input type="date" id="mpOooEnd" value="${escapeHtml(end)}" style="width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:6px;font-size:13px">
        </div>
        <div style="grid-column:1 / -1">
          <label style="display:block;font-size:12.5px;color:var(--text-3);margin-bottom:4px">사유 (선택)</label>
          <input type="text" id="mpOooNote" value="${escapeHtml(note)}" placeholder="예: 휴가 / 교육 / 병가" maxlength="100" style="width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:6px;font-size:13px">
        </div>
      </div>
      <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" id="mpOooSave" class="btn btn-primary" style="padding:9px 18px;font-size:13px">예약 저장</button>
        ${hasReservation ? `<button type="button" id="mpOooClear" class="btn-sm btn-sm-ghost">부재 해제</button>` : ''}
      </div>
    `;

    // 카드 스타일 (mp-panel과 유사하게)
    card.style.cssText = 'background:#fff;border:1px solid var(--line);border-radius:10px;padding:22px 24px;margin-bottom:18px;display:block';

    const saveBtn = $('#mpOooSave', card);
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        const startVal = $('#mpOooStart', card).value;
        const endVal = $('#mpOooEnd', card).value;
        const noteVal = $('#mpOooNote', card).value.trim();
        if (!startVal || !endVal) {
          toast('시작일과 종료일을 모두 선택하세요', 'error');
          return;
        }
        if (startVal > endVal) {
          toast('시작일이 종료일보다 늦을 수 없어요', 'error');
          return;
        }
        saveBtn.disabled = true;
        try {
          await api('/api/admin-user-preferences', {
            method: 'POST',
            body: {
              outOfOfficeStart: startVal,
              outOfOfficeEnd: endVal,
              outOfOfficeNote: noteVal || null
            }
          });
          toast(startVal + ' ~ ' + endVal + ' 부재 예약', 'success');
          await load();
        } catch (err) {
          toast('저장 실패: ' + err.message, 'error');
        } finally {
          saveBtn.disabled = false;
        }
      });
    }

    const clearBtn = $('#mpOooClear', card);
    if (clearBtn) {
      clearBtn.addEventListener('click', async () => {
        if (!confirm('부재 예약을 해제하시겠어요?')) return;
        clearBtn.disabled = true;
        try {
          await api('/api/admin-user-preferences', { method: 'DELETE' });
          toast('근무 상태로 돌아왔어요', 'success');
          await load();
        } catch (err) {
          toast('해제 실패: ' + err.message, 'error');
        } finally {
          clearBtn.disabled = false;
        }
      });
    }
  }

  async function load() {
    const card = document.getElementById('mpOutOfOfficeCard');
    if (!card) return;
    try {
      const res = await api('/api/admin-user-preferences');
      const state = (res && res.data) || res || {};
      renderCard(card, state);
      // WBS 기본 보기 카드도 함께 렌더
      renderWbsViewCard(state);
      // 관리자 도구 탭 표시
      const tab = document.getElementById('mpAdminToolsTab');
      if (tab) tab.style.display = '';
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        // 일반 회원 — 탭 숨김 유지 (이미 display:none)
      } else {
        console.warn('[mp-ooo] 로드 실패:', err);
      }
    }
  }

  /* ─── WBS 기본 보기 모드 카드 ─── */
  function renderWbsViewCard(state) {
    const card = document.getElementById('mpWbsViewCard');
    if (!card) return;

    const currentView = state && state.defaultWbsView ? state.defaultWbsView : 'board';

    card.innerHTML = `
      <h3 class="serif">WBS 기본 보기 모드</h3>
      <p class="sub">WBS 업무 보드 페이지를 처음 열 때 보여줄 보기 방식을 설정하세요.</p>

      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px">
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:10px 14px;border:2px solid ${currentView==='board'?'#3b82f6':'#e2e8f0'};border-radius:8px;background:${currentView==='board'?'#eff6ff':'#fff'}">
          <input type="radio" name="mpWbsView" value="board" ${currentView==='board'?'checked':''} style="accent-color:#3b82f6">
          <span>
            <strong style="font-size:13.5px">보드 (기본)</strong>
            <span style="display:block;font-size:12px;color:#64748b">5컬럼 칸반 형식</span>
          </span>
        </label>
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:10px 14px;border:2px solid ${currentView==='list'?'#3b82f6':'#e2e8f0'};border-radius:8px;background:${currentView==='list'?'#eff6ff':'#fff'}">
          <input type="radio" name="mpWbsView" value="list" ${currentView==='list'?'checked':''} style="accent-color:#3b82f6">
          <span>
            <strong style="font-size:13.5px">리스트</strong>
            <span style="display:block;font-size:12px;color:#64748b">표 형식 목록</span>
          </span>
        </label>
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:10px 14px;border:2px solid ${currentView==='calendar'?'#3b82f6':'#e2e8f0'};border-radius:8px;background:${currentView==='calendar'?'#eff6ff':'#fff'}">
          <input type="radio" name="mpWbsView" value="calendar" ${currentView==='calendar'?'checked':''} style="accent-color:#3b82f6">
          <span>
            <strong style="font-size:13.5px">캘린더</strong>
            <span style="display:block;font-size:12px;color:#64748b">마감일 기준 월별 달력</span>
          </span>
        </label>
      </div>
      <button type="button" id="mpWbsViewSave" class="btn btn-primary" style="padding:9px 18px;font-size:13px">저장</button>
    `;

    card.style.cssText = 'background:#fff;border:1px solid var(--line);border-radius:10px;padding:22px 24px;margin-bottom:18px;display:block';

    // 라디오 변경 시 border 색상 갱신
    card.querySelectorAll('input[name="mpWbsView"]').forEach(radio => {
      radio.addEventListener('change', () => {
        card.querySelectorAll('label').forEach(label => {
          const r = label.querySelector('input');
          const selected = r && r.checked;
          label.style.borderColor = selected ? '#3b82f6' : '#e2e8f0';
          label.style.background   = selected ? '#eff6ff' : '#fff';
        });
      });
    });

    // 저장 버튼
    const saveBtn = card.querySelector('#mpWbsViewSave');
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        const selected = card.querySelector('input[name="mpWbsView"]:checked');
        if (!selected) { toast('보기 모드를 선택해주세요', 'error'); return; }
        const val = selected.value;
        saveBtn.disabled = true;
        try {
          await api('/api/admin-user-preferences', {
            method: 'POST',
            body: { defaultWbsView: val },
          });
          toast('기본 보기 모드 저장됐어요', 'success');
          // localStorage도 동기화
          localStorage.setItem('wkViewMode', val);
        } catch (err) {
          toast('저장 실패: ' + err.message, 'error');
        } finally {
          saveBtn.disabled = false;
        }
      });
    }
  }

  function init() {
    load();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
