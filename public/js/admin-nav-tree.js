/**
 * public/js/admin-nav-tree.js — 메뉴 관리 (드래그 트리)
 * 설계서: docs/active/2026-08-03-page-menu-redesign.md §2.3·§7 5단계
 *
 * 예전 화면의 문제
 *   · 상위/하위를 구분해 보여주지도, 만들지도 못했다 (납작한 표 하나뿐)
 *   · 순서를 바꾸려면 숫자를 직접 입력해야 했다
 *   · 새 메뉴는 무조건 1단으로만 생겼다
 *
 * 새 화면
 *   · 손잡이를 잡고 끌어서 순서를 바꾸고, 다른 메뉴 안에 넣으면 하위 메뉴가 된다
 *   · 마우스를 못 쓰는 상황을 위해 ↑ ↓ ← → 버튼도 함께 둔다
 *   · 각 줄에서 그 메뉴가 가리키는 페이지의 내용을 바로 편집할 수 있다
 *   · 상단 메뉴는 2단까지만 보이므로 3단은 아예 만들지 못하게 막는다
 */
(function () {
  'use strict';

  var SORTABLE_SRCS = [
    'https://cdn.jsdelivr.net/npm/sortablejs@1.15.2/Sortable.min.js',
    'https://unpkg.com/sortablejs@1.15.2/Sortable.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/Sortable/1.15.2/Sortable.min.js'
  ];

  var _opts = null;      // { location, title, intro }
  var _items = [];       // 트리
  var _pages = [];       // 연결 가능한 페이지 목록
  var _linkReady = false;
  var _sortables = [];

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function toast(msg) {
    var t = $('#toast');
    if (!t) return alert(msg);
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(window._nttt);
    window._nttt = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }

  async function api(path, opts) {
    opts = opts || {};
    var init = {
      method: opts.method || 'GET',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' }
    };
    if (opts.body) init.body = JSON.stringify(opts.body);
    try {
      var res = await fetch(path, init);
      var data = await res.json().catch(function () { return {}; });
      return { status: res.status, ok: res.ok && data.ok !== false, data: data };
    } catch (e) {
      console.error('[nav-tree]', path, e);
      return { status: 0, ok: false, data: { error: '네트워크 오류' } };
    }
  }

  function unwrap(res, key) {
    var d = res && res.data;
    if (!d) return null;
    if (d.data && d.data[key] !== undefined) return d.data[key];
    if (d[key] !== undefined) return d[key];
    return null;
  }

  function loadSortable() {
    if (window.Sortable) return Promise.resolve(true);
    return new Promise(function (resolve) {
      var i = 0;
      function tryNext() {
        if (i >= SORTABLE_SRCS.length) return resolve(false);
        var s = document.createElement('script');
        s.src = SORTABLE_SRCS[i++];
        s.onload = function () { resolve(!!window.Sortable); };
        s.onerror = tryNext;
        document.head.appendChild(s);
      }
      tryNext();
    });
  }

  /* =========================================================
     화면 그리기
     ========================================================= */
  async function render(opts) {
    _opts = opts || { location: 'header', title: '메뉴 관리' };
    var inner = $('#sbContentInner');
    if (!inner) return;
    inner.innerHTML = '<div class="sb-placeholder"><p>메뉴를 불러오는 중…</p></div>';

    var menuRes = await api('/api/admin/nav-menus?tree=1&preferDraft=1&location=' + encodeURIComponent(_opts.location));
    if (!menuRes.ok) {
      inner.innerHTML = '<div class="sb-placeholder"><h3>메뉴를 불러오지 못했습니다</h3><p>' +
        esc((menuRes.data && menuRes.data.error) || '알 수 없는 오류') + '</p></div>';
      return;
    }

    _items = unwrap(menuRes, 'items') || [];
    _linkReady = !!unwrap(menuRes, 'linkReady');
    var draftCount = unwrap(menuRes, 'draftCount') || 0;

    var pagesRes = await api('/api/admin/nav-menus?pages=1');
    _pages = (pagesRes.ok && unwrap(pagesRes, 'pages')) || [];

    inner.innerHTML = '' +
      '<div class="nt-wrap">' +
        '<div class="nt-head">' +
          '<div>' +
            '<h2 class="nt-h2">' + esc(_opts.title || '메뉴 관리') + '</h2>' +
            '<p class="nt-intro">' + esc(_opts.intro ||
              '손잡이를 잡고 끌어서 순서를 바꿉니다. 다른 메뉴 안으로 넣으면 하위 메뉴가 됩니다.') + '</p>' +
          '</div>' +
          '<button type="button" class="nt-btn primary lg" id="ntAddBtn">＋ 메뉴 추가</button>' +
        '</div>' +

        (!_linkReady
          ? '<div class="nt-warn">저장소 준비가 아직 끝나지 않아 <strong>페이지 연결 기능</strong>을 쓸 수 없습니다. ' +
            '관리자 주소창에 <code>/api/migrate-site-pages?run=1</code> 을 한 번 실행해 주세요.</div>'
          : '') +

        '<div class="nt-legend">' +
          '<span><i class="nt-dot page"></i> 페이지</span>' +
          '<span><i class="nt-dot url"></i> 주소 링크</span>' +
          '<span><i class="nt-dot modal"></i> 창 열기</span>' +
          '<span><i class="nt-dot none"></i> 연결 없음</span>' +
          '<span class="nt-legend-right">순서·상위 이동은 <strong>즉시 반영</strong>, 이름 변경은 배포 필요' +
            (draftCount > 0 ? ' — 현재 임시저장 <strong>' + draftCount + '</strong>건' : '') + '</span>' +
        '</div>' +

        (_items.length === 0
          ? '<div class="sb-placeholder" style="margin-top:16px"><h3>메뉴가 없습니다</h3>' +
            '<p>[＋ 메뉴 추가]로 첫 메뉴를 만들어 보세요.</p></div>'
          : '<ul class="nt-list nt-root" data-parent="">' + _items.map(renderItem).join('') + '</ul>') +
      '</div>';

    injectStyles();
    bindEvents();

    var hasDrag = await loadSortable();
    if (hasDrag) setupDrag();
    else {
      var lg = $('.nt-legend-right');
      if (lg) lg.innerHTML = '끌어서 옮기기를 쓸 수 없습니다 — <strong>↑ ↓ ← →</strong> 버튼을 이용하세요';
    }
  }

  function renderItem(it) {
    var linkType = it.linkType || (it.opensModal ? 'modal' : (it.href ? 'url' : 'none'));
    var isDivider = linkType === 'divider';

    var target = '';
    if (isDivider) target = '<span class="nt-target muted">┈ 구분선</span>';
    else if (linkType === 'page') {
      target = it.pageSlug
        ? '<span class="nt-target"><i class="nt-dot page"></i>' + esc(it.pageTitle || it.pageSlug) +
          (it.pageStatus && it.pageStatus !== 'published' ? ' <span class="nt-chip off">숨김</span>' : '') +
          (it.pageHasDraft ? ' <span class="nt-chip draft">임시저장</span>' : '') + '</span>'
        : '<span class="nt-target warn"><i class="nt-dot none"></i>연결된 페이지가 없어졌습니다</span>';
    }
    else if (linkType === 'modal') target = '<span class="nt-target"><i class="nt-dot modal"></i>' + esc(it.opensModal) + '</span>';
    else if (linkType === 'url') target = '<span class="nt-target"><i class="nt-dot url"></i>' + esc(it.href || '') + '</span>';
    else target = '<span class="nt-target muted"><i class="nt-dot none"></i>연결 없음</span>';

    var children = (it.children || []).map(renderItem).join('');

    return '' +
      '<li class="nt-item" data-id="' + it.id + '" data-has-children="' + ((it.children || []).length ? '1' : '0') + '">' +
        '<div class="nt-row' + (it.isActive ? '' : ' off') + '">' +
          '<span class="nt-handle" title="끌어서 옮기기">⠿</span>' +
          '<span class="nt-label">' + esc(it.label) +
            (it.hasDraft ? ' <span class="nt-chip draft">수정됨</span>' : '') + '</span>' +
          target +
          '<span class="nt-move">' +
            '<button type="button" class="nt-ico" data-act="up" title="위로">↑</button>' +
            '<button type="button" class="nt-ico" data-act="down" title="아래로">↓</button>' +
            '<button type="button" class="nt-ico" data-act="indent" title="바로 위 메뉴의 하위로">→</button>' +
            '<button type="button" class="nt-ico" data-act="outdent" title="상위 단계로 빼기">←</button>' +
          '</span>' +
          '<label class="nt-switch" title="사이트에 보이기">' +
            '<input type="checkbox" data-act="toggle"' + (it.isActive ? ' checked' : '') + ' />' +
            '<span></span>' +
          '</label>' +
          '<span class="nt-actions">' +
            (linkType === 'page' && it.sitePageId
              ? '<button type="button" class="nt-btn xs primary" data-act="editpage">내용 편집</button>' : '') +
            '<button type="button" class="nt-btn xs" data-act="edit">수정</button>' +
            '<button type="button" class="nt-btn xs" data-act="delete">삭제</button>' +
          '</span>' +
        '</div>' +
        '<ul class="nt-list nt-sub" data-parent="' + it.id + '">' + children + '</ul>' +
      '</li>';
  }

  /* =========================================================
     드래그
     ========================================================= */
  function setupDrag() {
    _sortables.forEach(function (s) { try { s.destroy(); } catch (_) {} });
    _sortables = [];

    $$('.nt-list').forEach(function (list) {
      _sortables.push(window.Sortable.create(list, {
        group: 'siren-menus',
        handle: '.nt-handle',
        animation: 140,
        fallbackOnBody: true,
        ghostClass: 'nt-ghost',
        /* 3단 방지: 자식을 가진 메뉴는 다른 메뉴 안으로 못 들어간다 */
        onMove: function (evt) {
          var dragged = evt.dragged;
          var toSub = evt.to.classList.contains('nt-sub');
          var hasChildren = dragged.getAttribute('data-has-children') === '1' ||
                            !!dragged.querySelector('.nt-sub > .nt-item');
          if (toSub && hasChildren) return false;
          return true;
        },
        onEnd: function () { saveOrder(); }
      }));
    });
  }

  /** 화면의 트리를 그대로 읽어 서버에 저장한다 */
  async function saveOrder() {
    var rows = [];
    $$('.nt-list').forEach(function (list) {
      var parent = list.getAttribute('data-parent');
      var parentId = parent ? Number(parent) : null;
      Array.prototype.slice.call(list.children).forEach(function (li, idx) {
        if (!li.classList.contains('nt-item')) return;
        rows.push({ id: Number(li.getAttribute('data-id')), parentId: parentId, sortOrder: (idx + 1) * 10 });
      });
    });
    if (rows.length === 0) return;

    var res = await api('/api/admin/nav-menus?action=reorder', {
      method: 'POST', body: { location: _opts.location, items: rows }
    });
    if (!res.ok) {
      toast((res.data && res.data.error) || '순서를 저장하지 못했습니다');
      render(_opts);           // 서버 상태로 되돌린다
      return;
    }
    toast('메뉴 순서가 바뀌었습니다');
    reloadSitePreview();
  }

  /* 버튼으로 옮기기 — 마우스 드래그를 못 쓰는 상황용 */
  function moveByButton(li, act) {
    var list = li.parentElement;
    if (act === 'up') {
      var prev = li.previousElementSibling;
      if (prev) list.insertBefore(li, prev);
    } else if (act === 'down') {
      var next = li.nextElementSibling;
      if (next) list.insertBefore(next, li);
    } else if (act === 'indent') {
      var above = li.previousElementSibling;
      if (!above) return toast('위에 넣을 메뉴가 없습니다');
      if (li.querySelector('.nt-sub > .nt-item')) return toast('하위 메뉴가 있는 메뉴는 더 안쪽으로 넣을 수 없습니다');
      if (above.parentElement.classList.contains('nt-sub')) return toast('메뉴는 2단까지만 만들 수 있습니다');
      above.querySelector('.nt-sub').appendChild(li);
    } else if (act === 'outdent') {
      if (!list.classList.contains('nt-sub')) return toast('이미 가장 바깥 단계입니다');
      var parentLi = list.closest('.nt-item');
      parentLi.parentElement.insertBefore(li, parentLi.nextElementSibling);
    }
    saveOrder();
  }

  /* =========================================================
     동작 연결
     ========================================================= */
  function bindEvents() {
    var addBtn = $('#ntAddBtn');
    if (addBtn) addBtn.addEventListener('click', openAddModal);

    $$('.nt-row [data-act]').forEach(function (el) {
      el.addEventListener(el.tagName === 'INPUT' ? 'change' : 'click', function (e) {
        var li = el.closest('.nt-item');
        var id = Number(li.getAttribute('data-id'));
        var act = el.getAttribute('data-act');

        if (act === 'toggle') return toggleActive(id, el.checked, el);
        if (act === 'delete') return removeMenu(id, li.querySelector('.nt-label').textContent);
        if (act === 'edit') return openEditModal(id);
        if (act === 'editpage') return openLinkedPage(id);
        if (['up', 'down', 'indent', 'outdent'].indexOf(act) >= 0) {
          e.preventDefault();
          return moveByButton(li, act);
        }
      });
    });
  }

  function findItem(list, id) {
    for (var i = 0; i < list.length; i++) {
      if (Number(list[i].id) === Number(id)) return list[i];
      if (list[i].children && list[i].children.length) {
        var hit = findItem(list[i].children, id);
        if (hit) return hit;
      }
    }
    return null;
  }

  async function toggleActive(id, checked, el) {
    var res = await api('/api/admin/nav-menus?action=meta', {
      method: 'PATCH', body: { id: id, isActive: checked }
    });
    if (!res.ok) {
      el.checked = !checked;
      return toast((res.data && res.data.error) || '변경하지 못했습니다');
    }
    var row = el.closest('.nt-row');
    if (row) row.classList.toggle('off', !checked);
    toast(checked ? '메뉴를 사이트에 보이게 했습니다' : '메뉴를 감췄습니다');
    reloadSitePreview();
  }

  async function removeMenu(id, label) {
    if (!confirm('“' + label + '” 메뉴를 삭제할까요?\n\n하위 메뉴가 있으면 함께 삭제됩니다.\n' +
      '연결된 페이지 자체는 지워지지 않습니다.')) return;
    var res = await api('/api/admin/nav-menus?id=' + id, { method: 'DELETE' });
    if (!res.ok) return toast((res.data && res.data.error) || '삭제하지 못했습니다');
    toast('메뉴를 삭제했습니다');
    render(_opts);
  }

  function openLinkedPage(id) {
    var it = findItem(_items, id);
    if (!it || !it.sitePageId) return toast('연결된 페이지가 없습니다');
    if (window.SIREN_SITE_BUILDER && window.SIREN_SITE_BUILDER.selectNode) {
      window.SIREN_SITE_BUILDER.selectNode('pages');
    }
    setTimeout(function () {
      if (window.SIREN_SITE_PAGES && window.SIREN_SITE_PAGES.openEditor) {
        window.SIREN_SITE_PAGES.openEditor(it.sitePageId);
      }
    }, 60);
  }

  function reloadSitePreview() {
    try {
      if (window.SIREN_SITE_BUILDER && window.SIREN_SITE_BUILDER.reloadPreview) {
        window.SIREN_SITE_BUILDER.reloadPreview();
      }
      if (window.SIREN_SITE_BUILDER && window.SIREN_SITE_BUILDER.refreshDraftCount) {
        window.SIREN_SITE_BUILDER.refreshDraftCount();
      }
    } catch (_) {}
  }

  /* =========================================================
     연결 방식 고르기 (추가·수정 공용)
     ========================================================= */
  function linkChooserHtml(cur) {
    cur = cur || {};
    var t = cur.linkType || 'none';
    var pageOpts = _pages.map(function (p) {
      return '<option value="' + p.id + '"' + (Number(cur.sitePageId) === p.id ? ' selected' : '') + '>' +
        esc(p.title) + ' (/p/' + esc(p.slug) + ')' + (p.status !== 'published' ? ' — 숨김' : '') + '</option>';
    }).join('');

    return '' +
      '<label class="nt-field"><span>이 메뉴를 누르면</span>' +
        '<select id="ntLinkType">' +
          '<option value="page"' + (t === 'page' ? ' selected' : '') + '>페이지 열기</option>' +
          '<option value="url"' + (t === 'url' ? ' selected' : '') + '>주소로 이동</option>' +
          '<option value="modal"' + (t === 'modal' ? ' selected' : '') + '>창 띄우기 (후원·신청 등)</option>' +
          '<option value="none"' + (t === 'none' ? ' selected' : '') + '>아무 동작 없음 (하위 메뉴만 펼침)</option>' +
          '<option value="divider"' + (t === 'divider' ? ' selected' : '') + '>구분선</option>' +
        '</select></label>' +

      '<div class="nt-link-box" data-for="page">' +
        '<label class="nt-field"><span>어떤 페이지</span>' +
          '<select id="ntPageId">' +
            '<option value="">＋ 새 페이지를 만들어 연결</option>' + pageOpts +
          '</select>' +
          '<small class="nt-help">새로 만들면 빈 페이지가 생기고, 내용을 채운 뒤 [보임]으로 바꾸면 방문자에게 나타납니다.</small>' +
        '</label>' +
      '</div>' +

      '<div class="nt-link-box" data-for="url">' +
        '<label class="nt-field"><span>이동할 주소</span>' +
          '<input type="text" id="ntHref" value="' + esc(cur.href || '') + '" placeholder="/resources.html 또는 https://…" />' +
        '</label>' +
      '</div>' +

      '<div class="nt-link-box" data-for="modal">' +
        '<label class="nt-field"><span>띄울 창</span>' +
          '<select id="ntModal">' +
            '<option value="donateModal"' + (cur.opensModal === 'donateModal' ? ' selected' : '') + '>후원하기</option>' +
            '<option value="supportModal"' + (cur.opensModal === 'supportModal' ? ' selected' : '') + '>유가족 지원 신청</option>' +
          '</select>' +
        '</label>' +
      '</div>';
  }

  function bindLinkChooser(root) {
    function sync() {
      var t = $('#ntLinkType', root).value;
      $$('.nt-link-box', root).forEach(function (b) {
        b.style.display = b.getAttribute('data-for') === t ? '' : 'none';
      });
    }
    $('#ntLinkType', root).addEventListener('change', sync);
    sync();
  }

  function readLinkChooser(root) {
    var t = $('#ntLinkType', root).value;
    var out = { linkType: t };
    if (t === 'page') {
      var v = $('#ntPageId', root).value;
      out.sitePageId = v ? Number(v) : null;
    } else if (t === 'url') {
      out.href = $('#ntHref', root).value.trim();
    } else if (t === 'modal') {
      out.opensModal = $('#ntModal', root).value;
    }
    return out;
  }

  function modal(title, bodyHtml, onSave, saveLabel) {
    var bg = document.createElement('div');
    bg.className = 'nt-modal-bg';
    bg.innerHTML =
      '<div class="nt-modal">' +
        '<div class="nt-modal-head"><strong>' + esc(title) + '</strong>' +
          '<button type="button" class="nt-modal-x" data-close>×</button></div>' +
        '<div class="nt-modal-body">' + bodyHtml + '</div>' +
        '<div class="nt-modal-foot">' +
          '<button type="button" class="nt-btn" data-close>취소</button>' +
          '<button type="button" class="nt-btn primary" data-save>' + esc(saveLabel || '저장') + '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(bg);

    $$('[data-close]', bg).forEach(function (b) {
      b.addEventListener('click', function () { bg.remove(); });
    });
    bg.addEventListener('click', function (e) { if (e.target === bg) bg.remove(); });
    $('[data-save]', bg).addEventListener('click', function () { onSave(bg); });
    return bg;
  }

  /* =========================================================
     메뉴 추가
     ========================================================= */
  function openAddModal() {
    var parentOpts = _items.map(function (it) {
      return '<option value="' + it.id + '">' + esc(it.label) + ' 아래</option>';
    }).join('');

    var body = '' +
      '<label class="nt-field"><span>메뉴 이름</span>' +
        '<input type="text" id="ntLabel" placeholder="예) 후원금 사용 내역" /></label>' +
      '<label class="nt-field"><span>위치</span>' +
        '<select id="ntParent"><option value="">가장 바깥 (1단)</option>' + parentOpts + '</select></label>' +
      linkChooserHtml({ linkType: 'page' });

    var bg = modal('메뉴 추가', body, async function (root) {
      var label = $('#ntLabel', root).value.trim();
      if (!label) return toast('메뉴 이름을 입력해주세요');

      var link = readLinkChooser(root);
      if (link.linkType === 'url' && !link.href) return toast('이동할 주소를 입력해주세요');
      if (link.linkType === 'page' && !_linkReady) {
        return toast('저장소 준비가 끝나야 페이지를 연결할 수 있습니다');
      }

      var payload = {
        menuLocation: _opts.location,
        label: label,
        parentId: $('#ntParent', root).value || null,
        sortOrder: 9990,
        linkType: link.linkType,
        sitePageId: link.sitePageId || null,
        href: link.href || null,
        opensModal: link.opensModal || null
      };

      var res = await api('/api/admin/nav-menus', { method: 'POST', body: payload });
      if (!res.ok) return toast((res.data && res.data.error) || '메뉴를 만들지 못했습니다');

      bg.remove();
      toast((res.data && res.data.message) || '메뉴가 만들어졌습니다');

      var createdPage = unwrap(res, 'createdPage');
      await render(_opts);
      reloadSitePreview();

      /* 새 페이지를 함께 만들었으면 바로 내용을 채우도록 편집기로 보낸다 */
      if (createdPage && createdPage.id &&
          confirm('페이지가 만들어졌습니다. 지금 내용을 작성할까요?')) {
        if (window.SIREN_SITE_BUILDER && window.SIREN_SITE_BUILDER.selectNode) {
          window.SIREN_SITE_BUILDER.selectNode('pages');
        }
        setTimeout(function () {
          if (window.SIREN_SITE_PAGES) window.SIREN_SITE_PAGES.openEditor(createdPage.id);
        }, 60);
      }
    }, '만들기');

    bindLinkChooser(bg);
  }

  /* =========================================================
     메뉴 수정
     ========================================================= */
  function openEditModal(id) {
    var it = findItem(_items, id);
    if (!it) return toast('메뉴를 찾을 수 없습니다');

    var body = '' +
      '<label class="nt-field"><span>메뉴 이름</span>' +
        '<input type="text" id="ntLabel" value="' + esc(it.label) + '" />' +
        '<small class="nt-help">이름 변경은 [모든 변경사항 배포]를 눌러야 사이트에 반영됩니다.</small></label>' +
      linkChooserHtml(it) +
      '<label class="nt-field"><span>새 창으로 열기</span>' +
        '<select id="ntTarget">' +
          '<option value="_self"' + (it.target !== '_blank' ? ' selected' : '') + '>현재 창에서 열기</option>' +
          '<option value="_blank"' + (it.target === '_blank' ? ' selected' : '') + '>새 창에서 열기</option>' +
        '</select></label>';

    var bg = modal('메뉴 수정 — ' + it.label, body, async function (root) {
      var label = $('#ntLabel', root).value.trim();
      if (!label) return toast('메뉴 이름을 입력해주세요');

      var link = readLinkChooser(root);
      if (link.linkType === 'url' && !link.href) return toast('이동할 주소를 입력해주세요');

      /* 이름은 임시저장, 연결·새창은 즉시 반영 — 원래 체계를 그대로 따른다 */
      if (label !== it.label) {
        var r1 = await api('/api/admin/nav-menus', { method: 'PATCH', body: { id: id, label: label } });
        if (!r1.ok) return toast((r1.data && r1.data.error) || '이름을 저장하지 못했습니다');
      }

      var r2 = await api('/api/admin/nav-menus?action=link', {
        method: 'PATCH',
        body: {
          id: id,
          linkType: link.linkType,
          sitePageId: link.sitePageId || null,
          href: link.href || null,
          opensModal: link.opensModal || null
        }
      });
      if (!r2.ok) return toast((r2.data && r2.data.error) || '연결을 저장하지 못했습니다');

      var tgt = $('#ntTarget', root).value;
      if (tgt !== (it.target || '_self')) {
        await api('/api/admin/nav-menus?action=meta', { method: 'PATCH', body: { id: id, target: tgt } });
      }

      bg.remove();
      toast(label !== it.label
        ? '저장했습니다 — 이름 변경은 [배포] 후 사이트에 반영됩니다'
        : '저장했습니다');
      await render(_opts);
      reloadSitePreview();
    });

    bindLinkChooser(bg);
  }

  /* =========================================================
     스타일
     ========================================================= */
  function injectStyles() {
    if (document.getElementById('ntStyles')) return;
    var css = '' +
      '.nt-wrap{background:#fff;padding:24px;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.04)}' +
      '.nt-head{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;margin-bottom:14px}' +
      '.nt-h2{margin:0 0 6px;font-family:"Noto Serif KR",serif;font-size:20px}' +
      '.nt-intro{margin:0;font-size:13px;color:#6b7280;line-height:1.7;max-width:620px}' +
      '.nt-warn{background:#fef3c7;border:1px solid #fcd34d;color:#92400e;padding:11px 14px;border-radius:8px;font-size:13px;margin-bottom:14px;line-height:1.6}' +
      '.nt-warn code{background:#fff;padding:1px 6px;border-radius:4px;font-size:12px}' +
      '.nt-legend{display:flex;gap:14px;align-items:center;flex-wrap:wrap;font-size:12px;color:#6b7280;padding:9px 12px;background:#f7f8fa;border-radius:8px;margin-bottom:14px}' +
      '.nt-legend-right{margin-left:auto}' +
      '.nt-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px;vertical-align:middle}' +
      '.nt-dot.page{background:#1f5eff}.nt-dot.url{background:#0d9488}.nt-dot.modal{background:#a855f7}.nt-dot.none{background:#cbd5e1}' +
      '.nt-list{list-style:none;margin:0;padding:0}' +
      '.nt-sub{margin-left:34px;border-left:2px dashed #e5e7eb;padding-left:10px;min-height:12px}' +
      '.nt-item{margin:0 0 6px}' +
      '.nt-row{display:flex;align-items:center;gap:10px;padding:9px 12px;border:1px solid #e5e7eb;border-radius:8px;background:#fff}' +
      '.nt-row:hover{border-color:#c7cbd1;background:#fcfcfd}' +
      '.nt-row.off{opacity:.5}' +
      '.nt-handle{cursor:grab;color:#c0c4ca;font-size:15px;user-select:none}' +
      '.nt-handle:active{cursor:grabbing}' +
      '.nt-label{font-weight:600;font-size:14px;min-width:130px}' +
      '.nt-target{font-size:12px;color:#6b7280;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.nt-target.muted{color:#b6bcc4}.nt-target.warn{color:#b91c1c}' +
      '.nt-chip{display:inline-block;padding:1px 7px;border-radius:999px;font-size:10px;font-weight:600}' +
      '.nt-chip.off{background:#f1f3f5;color:#868e96}.nt-chip.draft{background:#fef3c7;color:#92400e}' +
      '.nt-move{display:flex;gap:2px}' +
      '.nt-ico{width:24px;height:24px;border:1px solid #e5e7eb;background:#fff;border-radius:5px;cursor:pointer;color:#6b7280;font-size:12px;line-height:1;padding:0}' +
      '.nt-ico:hover{background:#f1f3f5;color:#111}' +
      '.nt-switch{position:relative;display:inline-block;width:36px;height:20px;flex-shrink:0}' +
      '.nt-switch input{opacity:0;width:0;height:0}' +
      '.nt-switch span{position:absolute;inset:0;background:#cbd5e1;border-radius:999px;transition:.2s;cursor:pointer}' +
      '.nt-switch span:before{content:"";position:absolute;width:14px;height:14px;left:3px;top:3px;background:#fff;border-radius:50%;transition:.2s}' +
      '.nt-switch input:checked+span{background:#22c55e}' +
      '.nt-switch input:checked+span:before{transform:translateX(16px)}' +
      '.nt-actions{display:flex;gap:5px}' +
      '.nt-btn{padding:7px 13px;border:1px solid #d5d7db;background:#fff;border-radius:6px;font-size:13px;cursor:pointer;color:#374151}' +
      '.nt-btn:hover{background:#f7f8fa}' +
      '.nt-btn.primary{background:#1f5eff;border-color:#1f5eff;color:#fff}' +
      '.nt-btn.lg{padding:11px 18px;font-size:14px;white-space:nowrap}' +
      '.nt-btn.xs{padding:5px 10px;font-size:12px}' +
      '.nt-ghost{opacity:.4}' +
      '.nt-modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.42);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px}' +
      '.nt-modal{background:#fff;border-radius:12px;width:100%;max-width:480px;max-height:88vh;display:flex;flex-direction:column;box-shadow:0 20px 50px rgba(0,0,0,.22)}' +
      '.nt-modal-head{display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid #eceef1}' +
      '.nt-modal-x{background:none;border:none;font-size:22px;cursor:pointer;color:#9ca3af;line-height:1}' +
      '.nt-modal-body{padding:18px 20px;overflow-y:auto;display:flex;flex-direction:column;gap:13px}' +
      '.nt-modal-foot{display:flex;justify-content:flex-end;gap:8px;padding:14px 20px;border-top:1px solid #eceef1}' +
      '.nt-field{display:flex;flex-direction:column;gap:5px;font-size:13px}' +
      '.nt-field>span{font-weight:600;color:#374151}' +
      '.nt-field input,.nt-field select{padding:9px 11px;border:1px solid #d5d7db;border-radius:6px;font-size:14px;font-family:inherit;width:100%;box-sizing:border-box}' +
      '.nt-help{font-size:11px;color:#9ca3af;font-weight:400;line-height:1.6}' +
      '@media(max-width:1100px){.nt-target{display:none}.nt-label{min-width:0}}';

    var st = document.createElement('style');
    st.id = 'ntStyles';
    st.textContent = css;
    document.head.appendChild(st);
  }

  window.SIREN_NAV_TREE = { render: render };
})();
