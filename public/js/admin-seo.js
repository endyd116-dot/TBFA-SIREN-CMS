/* R42-A: SEO 메타 관리 — admin SEO 화면 (페이지별·단체·기본값 3탭)
   B(서버)가 머지되기 전까지 USE_MOCK=true로 동작. 응답 키는 B 응답과 1:1 일치.
*/
(function () {
  'use strict';

  /* ── 라이브 모드 (B 머지 완료·키 align 완료) ── */
  var USE_MOCK = false;

  var MOCK = {
    list: {
      ok: true,
      pages: [
        { path: '/index.html',       title: '교사유가족협의회 | 존엄한 기억, 투명한 동행', hasDraft: false, lastUpdated: '2026-05-28T10:00:00Z' },
        { path: '/about.html',       title: '소개 | 교사유가족협의회',                hasDraft: true,  lastUpdated: '2026-05-28T11:00:00Z' },
        { path: '/campaigns.html',   title: '캠페인 | 교사유가족협의회',               hasDraft: false, lastUpdated: '2026-05-27T09:00:00Z' },
        { path: '/memorial.html',    title: '추모관 | 교사유가족협의회',               hasDraft: false, lastUpdated: '2026-05-26T15:00:00Z' },
      ],
    },
    get: function (path) {
      return {
        ok: true,
        path: path,
        hasDraft: false,
        published: {
          title:          '교사유가족협의회 | 존엄한 기억, 투명한 동행',
          description:    '교사 유가족들의 지원과 수사...',
          og_title:       '교사유가족협의회',
          og_description: '존엄한 기억과 투명한 동행.',
          og_image_url:   'https://tbfa.co.kr/og-default.png',
          canonical:      'https://tbfa.co.kr' + path,
        },
        draft: null,
      };
    },
    save:    { ok: true, saved: true },
    publish: { ok: true, published: 1, buildTriggered: true },
    org: {
      ok: true,
      org: {
        name:            '교사유가족협의회',
        legal_name:      '(사)교사유가족협의회',
        registration_no: '1188271215',
        logo_url:        'https://tbfa.co.kr/og-default.png',
        same_as:         [],
      },
    },
    defaults: {
      ok: true,
      defaults: {
        default_og_image_url: 'https://tbfa.co.kr/og-default.png',
        description:          '교사 유가족들의 지원과 권익 보호를 위한 통합 NPO 플랫폼.',
        site_name:            '교사유가족협의회',
        twitter_handle:       '',
        locale:               'ko_KR',
        title_suffix:         '| 교사유가족협의회',
      },
    },
  };

  /* ── 상태 ── */
  var state = {
    pages:       [],
    filterText:  '',
    currentPath: null,
    currentData: null,
    isDirty:     false,
  };

  /* ── 헬퍼 ── */
  function toast(msg, type) {
    var el = document.getElementById('toast');
    if (!el) { console.log('[seo]', msg); return; }
    el.textContent = msg;
    el.classList.add('show');
    if (type === 'error') el.style.background = '#dc2626'; else el.style.background = '';
    setTimeout(function () { el.classList.remove('show'); }, 2500);
  }

  async function api(path, opts) {
    opts = opts || {};
    try {
      var r = await fetch(path, {
        method: opts.method || 'GET',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
      var data = await r.json().catch(function () { return {}; });
      return { ok: r.ok, status: r.status, data: data };
    } catch (e) {
      return { ok: false, data: { error: e.message } };
    }
  }

  function $(id) { return document.getElementById(id); }

  function fmtDate(iso) {
    if (!iso) return '—';
    return iso.slice(0, 10) + ' ' + iso.slice(11, 16);
  }

  /* ── 페이지 목록 로드 ── */
  async function loadPages() {
    var listEl = $('seoPageList');
    if (listEl) listEl.innerHTML = '<li style="padding:14px;color:var(--text-3);text-align:center">불러오는 중...</li>';

    var res;
    if (USE_MOCK) {
      res = { ok: true, data: MOCK.list };
    } else {
      res = await api('/api/admin-seo-list');
    }

    if (!res.ok || !res.data.ok) {
      if (listEl) listEl.innerHTML = '<li style="padding:14px;color:#dc2626;text-align:center">' + ((res.data && res.data.error) || '목록 로드 실패') + '</li>';
      return;
    }

    state.pages = res.data.pages || [];
    renderPageList();
  }

  function renderPageList() {
    var listEl = $('seoPageList');
    if (!listEl) return;

    var q = (state.filterText || '').trim().toLowerCase();
    var pages = state.pages.filter(function (p) {
      if (!q) return true;
      return (p.path || '').toLowerCase().indexOf(q) !== -1
          || (p.title || '').toLowerCase().indexOf(q) !== -1;
    });

    if (!pages.length) {
      listEl.innerHTML = '<li style="padding:14px;color:var(--text-3);text-align:center">검색 결과 없음</li>';
      return;
    }

    listEl.innerHTML = pages.map(function (p) {
      var isActive = state.currentPath === p.path;
      var draftBadge = p.hasDraft
        ? '<span style="display:inline-block;background:#fef3c7;color:#92400e;font-size:11px;padding:1px 6px;border-radius:8px;margin-left:6px">초안</span>'
        : '';
      return ''
        + '<li data-seo-path="' + escapeAttr(p.path) + '" '
        + '    style="padding:10px 12px;border-radius:6px;cursor:pointer;margin-bottom:4px;'
        +              (isActive ? 'background:#eff6ff;border:1px solid #2563eb' : 'border:1px solid transparent') + '">'
        +   '<div style="font-size:13px;color:var(--text-3)">' + escapeHtml(p.path) + draftBadge + '</div>'
        +   '<div style="font-weight:600;font-size:14px;margin-top:2px">' + escapeHtml(p.title || '(제목 없음)') + '</div>'
        +   '<div style="font-size:11px;color:var(--text-3);margin-top:4px">' + fmtDate(p.lastUpdated) + '</div>'
        + '</li>';
    }).join('');
  }

  function escapeHtml(s) {
    s = String(s == null ? '' : s);
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function escapeAttr(s) { return escapeHtml(s); }

  /* ── 페이지 선택 ── */
  async function selectPage(path) {
    if (state.isDirty) {
      if (!confirm('편집 중인 변경사항이 있습니다. 저장하지 않고 이동하시겠습니까?')) return;
    }
    state.currentPath = path;
    renderPageList();

    $('seoEditorEmpty').style.display = 'none';
    $('seoEditorForm').style.display  = 'block';
    $('seoEditorPath').textContent    = path;
    $('seoSaveStatus').textContent    = '불러오는 중...';

    var res;
    if (USE_MOCK) {
      res = { ok: true, data: MOCK.get(path) };
    } else {
      res = await api('/api/admin-seo-get?path=' + encodeURIComponent(path));
    }

    if (!res.ok || !res.data.ok) {
      toast((res.data && res.data.error) || '페이지 메타 로드 실패', 'error');
      $('seoSaveStatus').textContent = '로드 실패';
      return;
    }

    state.currentData = res.data;
    var src = res.data.draft || res.data.published || {};
    $('seoTitle').value         = src.title          || '';
    $('seoDescription').value   = src.description    || '';
    $('seoOgTitle').value       = src.og_title       || '';
    $('seoOgDescription').value = src.og_description || '';
    $('seoOgImageUrl').value    = src.og_image_url   || '';
    $('seoCanonical').value     = src.canonical      || ('https://tbfa.co.kr' + path);

    updateCounts();
    updateOgPreview();

    var badge = $('seoEditorBadge');
    if (res.data.hasDraft || res.data.draft) {
      badge.style.display = 'inline-block';
      badge.textContent   = '초안 있음';
    } else {
      badge.style.display = 'none';
    }
    state.isDirty = false;
    $('seoSaveStatus').textContent = '';
  }

  function updateCounts() {
    var t = $('seoTitle').value || '';
    var d = $('seoDescription').value || '';
    $('seoTitleCount').textContent = t.length + '자' + (t.length > 60 ? ' (60자 초과)' : '');
    $('seoDescCount').textContent  = d.length + '자' + (d.length > 160 ? ' (160자 초과)' : '');
  }

  function updateOgPreview() {
    var url = $('seoOgImageUrl').value || '';
    var prev = $('seoOgImagePreview');
    if (!url) { prev.innerHTML = ''; return; }
    prev.innerHTML = '<img src="' + escapeAttr(url) + '" alt="OG 미리보기" '
      + 'style="max-width:240px;max-height:126px;border:1px solid #e5e7eb;border-radius:6px"'
      + ' onerror="this.style.display=\'none\'">';
  }

  /* ── 저장·발행 ── */
  async function saveDraft() {
    if (!state.currentPath) return;
    var payload = collectForm();
    $('seoSaveStatus').textContent = '저장 중...';

    var res;
    if (USE_MOCK) {
      res = { ok: true, data: MOCK.save };
    } else {
      res = await api('/api/admin-seo-save', { method: 'POST', body: { path: state.currentPath, ...payload } });
    }

    if (!res.ok || !res.data.ok) {
      toast((res.data && res.data.error) || '저장 실패', 'error');
      $('seoSaveStatus').textContent = '저장 실패';
      return;
    }
    state.isDirty = false;
    $('seoSaveStatus').textContent = '✅ 초안 저장됨';
    $('seoEditorBadge').style.display = 'inline-block';
    $('seoEditorBadge').textContent   = '초안 있음';

    var p = state.pages.find(function (x) { return x.path === state.currentPath; });
    if (p) { p.hasDraft = true; p.lastUpdated = new Date().toISOString(); renderPageList(); }
    toast('초안 저장 완료', 'success');
  }

  async function publish() {
    if (!state.currentPath) return;
    if (!confirm('현재 페이지의 SEO 메타를 발행하시겠습니까?\n발행 후 빌드 트리거가 실행됩니다.')) return;
    var payload = collectForm();
    $('seoSaveStatus').textContent = '발행 중...';

    var res;
    if (USE_MOCK) {
      res = { ok: true, data: MOCK.publish };
    } else {
      res = await api('/api/admin-seo-publish', { method: 'POST', body: { path: state.currentPath, ...payload } });
    }

    if (!res.ok || !res.data.ok) {
      toast((res.data && res.data.error) || '발행 실패', 'error');
      $('seoSaveStatus').textContent = '발행 실패';
      return;
    }
    state.isDirty = false;
    var msg = '✅ 발행 완료';
    if (res.data.buildTriggered) msg += ' (빌드 트리거됨)';
    $('seoSaveStatus').textContent = msg;
    $('seoEditorBadge').style.display = 'none';

    var p = state.pages.find(function (x) { return x.path === state.currentPath; });
    if (p) { p.hasDraft = false; p.lastUpdated = new Date().toISOString(); renderPageList(); }
    toast('발행 완료', 'success');
  }

  function collectForm() {
    return {
      title:          $('seoTitle').value.trim(),
      description:    $('seoDescription').value.trim(),
      og_title:       $('seoOgTitle').value.trim(),
      og_description: $('seoOgDescription').value.trim(),
      og_image_url:   $('seoOgImageUrl').value.trim(),
      canonical:      $('seoCanonical').value.trim(),
    };
  }

  /* ── OG 이미지 업로드 (기존 /api/blob-upload 활용) ── */
  function setupOgImageUpload() {
    var fileInput = $('seoOgImageFile');
    var btn = $('seoOgImageUploadBtn');
    if (!btn || !fileInput) return;

    btn.addEventListener('click', function () { fileInput.click(); });

    fileInput.addEventListener('change', async function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;

      if (USE_MOCK) {
        $('seoOgImageUrl').value = 'https://tbfa.co.kr/og-default.png';
        updateOgPreview();
        state.isDirty = true;
        toast('Mock 모드: 기본 이미지 사용', 'success');
        fileInput.value = '';
        return;
      }

      var fd = new FormData();
      fd.append('file', file);
      fd.append('context', 'seo_og_image');
      fd.append('isPublic', 'true');
      toast('업로드 중...');
      try {
        var r = await fetch('/api/blob-upload', { method: 'POST', credentials: 'include', body: fd });
        var d = await r.json().catch(function () { return {}; });
        if (!r.ok || d.ok === false) { toast((d && (d.error || d.message)) || '업로드 실패', 'error'); return; }
        var id = (d.data && d.data.id) || d.id || d.blobId;
        if (!id) { toast('업로드 응답에 ID가 없습니다.', 'error'); return; }
        var url = '/api/blob-image?id=' + id;
        $('seoOgImageUrl').value = url;
        updateOgPreview();
        state.isDirty = true;
        toast('이미지 업로드 완료', 'success');
      } catch (e) {
        toast('업로드 실패: ' + e.message, 'error');
      } finally {
        fileInput.value = '';
      }
    });
  }

  /* ── 단체 구조화데이터 (Organization) ── */
  async function loadOrg() {
    var res;
    if (USE_MOCK) {
      res = { ok: true, data: MOCK.org };
    } else {
      res = await api('/api/admin-seo-org');
    }
    if (!res.ok || !res.data.ok) {
      toast((res.data && res.data.error) || '단체 정보 로드 실패', 'error');
      return;
    }
    var o = res.data.org || {};
    $('seoOrgName').value           = o.name            || '';
    $('seoOrgLegalName').value      = o.legal_name      || '';
    $('seoOrgRegistrationNo').value = o.registration_no || '';
    $('seoOrgLogoUrl').value        = o.logo_url        || '';
    $('seoOrgSameAs').value         = Array.isArray(o.same_as) ? o.same_as.join('\n') : '';
  }

  async function saveOrg() {
    var sameAs = ($('seoOrgSameAs').value || '').split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    var payload = {
      name:            $('seoOrgName').value.trim(),
      legal_name:      $('seoOrgLegalName').value.trim(),
      registration_no: $('seoOrgRegistrationNo').value.trim(),
      logo_url:        $('seoOrgLogoUrl').value.trim(),
      same_as:         sameAs,
    };

    $('seoOrgStatus').textContent = '저장 중...';
    var res;
    if (USE_MOCK) {
      res = { ok: true, data: { ok: true } };
    } else {
      res = await api('/api/admin-seo-org', { method: 'POST', body: payload });
    }

    if (!res.ok || !res.data.ok) {
      toast((res.data && res.data.error) || '저장 실패', 'error');
      $('seoOrgStatus').textContent = '저장 실패';
      return;
    }
    $('seoOrgStatus').textContent = '✅ 저장됨';
    toast('단체 정보 저장 완료', 'success');
  }

  /* ── 사이트 기본값 ── */
  async function loadDefaults() {
    var res;
    if (USE_MOCK) {
      res = { ok: true, data: MOCK.defaults };
    } else {
      res = await api('/api/admin-seo-defaults');
    }
    if (!res.ok || !res.data.ok) {
      toast((res.data && res.data.error) || '기본값 로드 실패', 'error');
      return;
    }
    var d = res.data.defaults || {};
    $('seoDefOgImage').value     = d.default_og_image_url || '';
    $('seoDefDescription').value = d.description          || '';
    $('seoDefSiteName').value    = d.site_name            || '';
    $('seoDefTwitter').value     = d.twitter_handle       || '';
  }

  async function saveDefaults() {
    var payload = {
      default_og_image_url: $('seoDefOgImage').value.trim(),
      description:          $('seoDefDescription').value.trim(),
      site_name:            $('seoDefSiteName').value.trim(),
      twitter_handle:       $('seoDefTwitter').value.trim(),
    };
    $('seoDefStatus').textContent = '저장 중...';
    var res;
    if (USE_MOCK) {
      res = { ok: true, data: { ok: true } };
    } else {
      res = await api('/api/admin-seo-defaults', { method: 'POST', body: payload });
    }
    if (!res.ok || !res.data.ok) {
      toast((res.data && res.data.error) || '저장 실패', 'error');
      $('seoDefStatus').textContent = '저장 실패';
      return;
    }
    $('seoDefStatus').textContent = '✅ 저장됨';
    toast('기본값 저장 완료', 'success');
  }

  /* ── 탭 전환 ── */
  function setupTabs() {
    var tabs = document.querySelectorAll('#seoTabs .ct-tab');
    tabs.forEach(function (t) {
      t.addEventListener('click', function () {
        var name = t.getAttribute('data-seo-tab');
        tabs.forEach(function (x) { x.classList.remove('on'); });
        t.classList.add('on');
        document.querySelectorAll('[data-seo-pane]').forEach(function (p) {
          p.style.display = (p.getAttribute('data-seo-pane') === name) ? '' : 'none';
        });
        if (name === 'org')      loadOrg();
        if (name === 'defaults') loadDefaults();
      });
    });
  }

  /* ── 이벤트 바인딩 ── */
  function setupEvents() {
    /* 페이지 목록 검색 */
    var search = $('seoPageSearch');
    if (search) {
      search.addEventListener('input', function () {
        state.filterText = search.value;
        renderPageList();
      });
    }

    /* 페이지 목록 클릭 (이벤트 위임) */
    var listEl = $('seoPageList');
    if (listEl) {
      listEl.addEventListener('click', function (e) {
        var li = e.target.closest('[data-seo-path]');
        if (!li) return;
        selectPage(li.getAttribute('data-seo-path'));
      });
    }

    /* 폼 입력 — dirty + 카운트 */
    ['seoTitle', 'seoDescription', 'seoOgTitle', 'seoOgDescription', 'seoOgImageUrl', 'seoCanonical'].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.addEventListener('input', function () {
        state.isDirty = true;
        if (id === 'seoTitle' || id === 'seoDescription') updateCounts();
        if (id === 'seoOgImageUrl') updateOgPreview();
        $('seoSaveStatus').textContent = '저장되지 않음';
      });
    });

    /* 저장·발행 */
    var saveBtn = $('seoSaveDraftBtn');
    if (saveBtn) saveBtn.addEventListener('click', saveDraft);
    var pubBtn = $('seoPublishBtn');
    if (pubBtn) pubBtn.addEventListener('click', publish);

    /* 단체 저장 */
    var orgBtn = $('seoOrgSaveBtn');
    if (orgBtn) orgBtn.addEventListener('click', saveOrg);

    /* 기본값 저장 */
    var defBtn = $('seoDefSaveBtn');
    if (defBtn) defBtn.addEventListener('click', saveDefaults);

    setupOgImageUpload();
    setupTabs();
  }

  /* ── 초기화 ── */
  var initialized = false;
  function init() {
    if (!initialized) {
      setupEvents();
      initialized = true;
    }
    loadPages();
  }

  /* 외부 노출 */
  window.SIREN_ADMIN_SEO = { init: init };
})();
