/**
 * lib-milestone-roles.js — 역할 카탈로그 클라이언트 헬퍼
 *
 * R39 Stage 3: 모든 성과관리 화면이 /api/milestone-roles 응답으로 라벨·드롭다운 그림.
 * sessionStorage 5분 캐싱·페이지 진입 시 1회 호출.
 *
 * 전역: window.MilestoneRoles
 *  - loadActiveRoles()           : 활성 역할 일람 (캐시 우선)
 *  - getRoleLabel(code)          : 캐시된 매핑에서 라벨 반환·없으면 code 그대로
 *  - getRoleLabelSync(code)      : 동기·캐시 없으면 코드 그대로
 *  - invalidateCache()           : 신규 등록·수정·삭제 직후 호출
 *  - fillSelect(selEl, opts)     : <select>에 옵션 동적 채움
 */
(function () {
  'use strict';

  var CACHE_KEY = 'tbfa.milestoneRoles.v1';
  var TTL_MS = 5 * 60 * 1000; // 5분
  var _memoRoles = null;
  var _inflight = null;

  function readCache() {
    try {
      var raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (!obj || !Array.isArray(obj.roles) || !obj.at) return null;
      if (Date.now() - obj.at > TTL_MS) return null;
      return obj.roles;
    } catch (_) { return null; }
  }

  function writeCache(roles) {
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), roles: roles }));
    } catch (_) { /* QuotaExceeded·privacy 모드 등 무시 */ }
  }

  function clearCache() {
    try { sessionStorage.removeItem(CACHE_KEY); } catch (_) {}
    _memoRoles = null;
  }

  async function loadActiveRoles() {
    // 1) in-memory
    if (_memoRoles) return _memoRoles;
    // 2) sessionStorage
    var cached = readCache();
    if (cached) { _memoRoles = cached; return cached; }
    // 3) 진행 중 호출 공유
    if (_inflight) return _inflight;

    _inflight = (async function () {
      try {
        var res = await fetch('/api/milestone-roles', { credentials: 'include' });
        var data = null;
        try { data = await res.json(); } catch (_) {}
        if (!res.ok) {
          // 401 등 — 실패 시 빈 배열로 처리 (fallback: 코드 그대로 노출)
          return [];
        }
        var roles =
          (data && data.data && data.data.roles) ||
          (data && data.roles) || [];
        // 정렬 보장 (서버 정렬 신뢰하되 fallback)
        roles.sort(function (a, b) {
          var sa = Number(a.sortOrder || 0);
          var sb = Number(b.sortOrder || 0);
          if (sa !== sb) return sa - sb;
          return String(a.code).localeCompare(String(b.code));
        });
        _memoRoles = roles;
        writeCache(roles);
        return roles;
      } catch (_) {
        return [];
      } finally {
        _inflight = null;
      }
    })();
    return _inflight;
  }

  async function getRoleLabel(code) {
    if (code == null || code === '') return '';
    var roles = await loadActiveRoles();
    for (var i = 0; i < roles.length; i++) {
      if (roles[i].code === code) return roles[i].name || code;
    }
    return code;
  }

  function getRoleLabelSync(code) {
    if (code == null || code === '') return '';
    var roles = _memoRoles || readCache();
    if (!roles) return code;
    for (var i = 0; i < roles.length; i++) {
      if (roles[i].code === code) return roles[i].name || code;
    }
    return code;
  }

  /**
   * <select> 옵션 동적 채움.
   * @param {HTMLSelectElement} selEl
   * @param {{ includeEmpty?: boolean, emptyLabel?: string, format?: 'codeName'|'codeOnly'|'nameOnly', selected?: string }} opts
   */
  async function fillSelect(selEl, opts) {
    if (!selEl) return;
    opts = opts || {};
    var roles = await loadActiveRoles();
    var format = opts.format || 'codeName';
    var html = '';
    if (opts.includeEmpty) {
      html += '<option value="">' + (opts.emptyLabel || '— 미배정 —') + '</option>';
    }
    for (var i = 0; i < roles.length; i++) {
      var r = roles[i];
      var label;
      if (format === 'codeOnly') label = r.code;
      else if (format === 'nameOnly') label = r.name || r.code;
      else label = r.code + ' (' + (r.name || r.code) + ')';
      html += '<option value="' + esc(r.code) + '">' + esc(label) + '</option>';
    }
    selEl.innerHTML = html;
    if (opts.selected != null) {
      selEl.value = String(opts.selected);
    }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  window.MilestoneRoles = {
    loadActiveRoles: loadActiveRoles,
    getRoleLabel: getRoleLabel,
    getRoleLabelSync: getRoleLabelSync,
    invalidateCache: clearCache,
    fillSelect: fillSelect,
  };
})();
