/**
 * public/js/editor-page.js — 페이지 통 편집용 리치 편집기 (썬에디터)
 * 설계서: docs/active/2026-08-03-page-menu-redesign.md §5
 *
 * 기존 편집기(editor.js·Toast UI)는 그대로 둔다. 게시판·신고폼 8곳이 쓰고 있어
 * 한꺼번에 갈아치우면 회귀 위험이 크다. 이 파일은 **페이지 통 편집 전용**이다.
 *
 * 왜 썬에디터인가
 *  - 기존 편집기는 마크다운 기반이라 글자색·정렬·글자크기를 원리상 지원하지 못한다.
 *  - 썬에디터는 이 셋 + 표·사진 크기조절·동영상까지 기본 제공하고 한국어 메뉴가 내장이다.
 *  - MIT·의존성 없음·주소 한 줄로 로드.
 *
 * 버전을 2.47.5로 고정한 이유: 3.x는 폴더 구조와 옵션 체계가 바뀌었는데 공개 문서가
 * 부족해 동작을 확신할 수 없다. 라이브에서 편집기가 안 뜨는 사고를 피하려 검증된 2.x를 쓴다.
 * (3.x 문서가 갖춰지면 재검토 — 저장 형식이 HTML로 같아 교체 부담은 작다.)
 *
 * 사진 업로드는 기존과 같은 3단계 경로를 그대로 쓴다:
 *   주소 발급(/api/blob-presign) → 저장소로 직접 전송 → 확정(/api/blob-confirm)
 */
(function () {
  'use strict';

  var VER = '2.47.5';
  var LOADED = false;
  var LOADING = null;

  /* 주소가 막히는 상황(사내망 차단·장애)에 대비해 3곳을 차례로 시도한다 */
  var SOURCES = [
    {
      css: 'https://cdn.jsdelivr.net/npm/suneditor@' + VER + '/dist/css/suneditor.min.css',
      js: 'https://cdn.jsdelivr.net/npm/suneditor@' + VER + '/dist/suneditor.min.js',
      lang: 'https://cdn.jsdelivr.net/npm/suneditor@' + VER + '/src/lang/ko.js'
    },
    {
      css: 'https://unpkg.com/suneditor@' + VER + '/dist/css/suneditor.min.css',
      js: 'https://unpkg.com/suneditor@' + VER + '/dist/suneditor.min.js',
      lang: 'https://unpkg.com/suneditor@' + VER + '/src/lang/ko.js'
    },
    {
      css: 'https://cdnjs.cloudflare.com/ajax/libs/suneditor/' + VER + '/css/suneditor.min.css',
      js: 'https://cdnjs.cloudflare.com/ajax/libs/suneditor/' + VER + '/suneditor.min.js',
      lang: 'https://cdnjs.cloudflare.com/ajax/libs/suneditor/' + VER + '/lang/ko.js'
    }
  ];

  function loadCss(href) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('link[data-sun-css="' + href + '"]')) return resolve();
      var el = document.createElement('link');
      el.rel = 'stylesheet';
      el.href = href;
      el.setAttribute('data-sun-css', href);
      el.onload = function () { resolve(); };
      el.onerror = function () { reject(new Error('css')); };
      document.head.appendChild(el);
    });
  }

  function loadJs(src) {
    return new Promise(function (resolve, reject) {
      var el = document.createElement('script');
      el.src = src;
      el.async = false;
      el.onload = function () { resolve(); };
      el.onerror = function () { reject(new Error('js')); };
      document.head.appendChild(el);
    });
  }

  /** 편집기 본체를 불러온다. 여러 번 불러도 실제 로드는 한 번만 일어난다. */
  function loadLib() {
    if (LOADED) return Promise.resolve();
    if (LOADING) return LOADING;

    LOADING = (async function () {
      var lastErr = null;
      for (var i = 0; i < SOURCES.length; i++) {
        var s = SOURCES[i];
        try {
          await loadCss(s.css);
          await loadJs(s.js);
          if (!window.SUNEDITOR) throw new Error('편집기 전역 객체 없음');
          /* 한국어 메뉴는 있으면 좋고 없어도 동작한다 — 실패해도 넘어간다 */
          try { await loadJs(s.lang); } catch (_) {}
          LOADED = true;
          return;
        } catch (e) {
          lastErr = e;
        }
      }
      LOADING = null;
      throw lastErr || new Error('편집기를 불러오지 못했습니다');
    })();

    return LOADING;
  }

  /* =========================================================
     사진 업로드 — 기존과 같은 3단계 경로
     ========================================================= */

  /** 큰 사진을 올리기 전에 줄인다. 실패하면 원본을 그대로 쓴다. */
  function compressImage(file, maxSize, quality) {
    maxSize = maxSize || 1600;
    quality = quality || 0.85;
    return new Promise(function (resolve) {
      if (!file || !/^image\//.test(file.type) || /gif$/i.test(file.type)) return resolve(file);
      var reader = new FileReader();
      reader.onload = function (e) {
        var img = new Image();
        img.onload = function () {
          try {
            var w = img.width, h = img.height;
            if (w <= maxSize && h <= maxSize) return resolve(file);
            if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
            else { w = Math.round(w * maxSize / h); h = maxSize; }

            var canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            canvas.toBlob(function (blob) {
              if (!blob || blob.size >= file.size) return resolve(file);
              var name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
              resolve(new File([blob], name, { type: 'image/jpeg' }));
            }, 'image/jpeg', quality);
          } catch (_) { resolve(file); }
        };
        img.onerror = function () { resolve(file); };
        img.src = e.target.result;
      };
      reader.onerror = function () { resolve(file); };
      reader.readAsDataURL(file);
    });
  }

  /** 파일 하나를 저장소에 올리고 보여줄 주소를 돌려준다. */
  async function uploadFile(file, context) {
    var presignRes = await fetch('/api/blob-presign', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        originalName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        context: context || 'site-page',
        isPublic: true
      })
    });
    var presignJson = await presignRes.json();
    if (!presignRes.ok || presignJson.ok === false) {
      throw new Error(presignJson.error || '업로드 주소를 받지 못했습니다');
    }
    var pd = presignJson.data || presignJson;

    var putRes = await fetch(pd.uploadUrl, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': file.type }
    });
    if (!putRes.ok) throw new Error('파일 전송에 실패했습니다');

    var confirmRes = await fetch('/api/blob-confirm', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: pd.id })
    });
    var confirmJson = await confirmRes.json();
    if (!confirmRes.ok || confirmJson.ok === false) {
      throw new Error(confirmJson.error || '업로드 확정에 실패했습니다');
    }
    var cd = confirmJson.data || confirmJson;
    return { url: cd.url, name: file.name, size: file.size };
  }

  /* =========================================================
     툴바 — 네이버 블로그에서 쓰던 기능들이 그대로 보이도록 배치
     ========================================================= */
  var TOOLBAR = [
    ['undo', 'redo'],
    ['font', 'fontSize', 'formatBlock'],
    ['bold', 'underline', 'italic', 'strike', 'subscript', 'superscript'],
    ['fontColor', 'hiliteColor', 'textStyle'],
    ['removeFormat'],
    ['align', 'lineHeight', 'list', 'outdent', 'indent'],
    ['horizontalRule', 'table', 'link', 'image', 'video'],
    ['showBlocks', 'codeView'],
    ['preview', 'fullScreen']
  ];

  /* 본문에서 쓸 수 있는 글꼴 — 사이트에 실제로 적용되는 것만 */
  var FONT_LIST = [
    'Pretendard', 'Noto Sans KR', '맑은 고딕', '나눔고딕', '돋움', '굴림', '바탕',
    'Arial', 'Georgia', 'Courier New'
  ];

  /**
   * 편집기를 만든다.
   * @param {Object} opts
   *   el            대상 요소 또는 선택자
   *   initialValue  처음 보여줄 HTML
   *   height        높이 (기본 600px)
   *   placeholder   빈 화면 안내문
   *   uploadContext 업로드 분류 이름
   *   onChange      내용이 바뀔 때 호출
   *   onSave        Ctrl+S 눌렀을 때 호출
   * @returns 편집기 조작 핸들
   */
  async function create(opts) {
    opts = opts || {};
    await loadLib();

    var el = typeof opts.el === 'string' ? document.querySelector(opts.el) : opts.el;
    if (!el) throw new Error('편집기를 놓을 자리를 찾지 못했습니다');

    var editor = window.SUNEDITOR.create(el, {
      lang: (window.SUNEDITOR_LANG && window.SUNEDITOR_LANG.ko) || undefined,
      buttonList: TOOLBAR,
      font: FONT_LIST,
      fontSize: [10, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48],
      formats: ['p', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5'],
      lineHeights: [
        { text: '1.0', value: 1 }, { text: '1.3', value: 1.3 },
        { text: '1.6', value: 1.6 }, { text: '2.0', value: 2 }
      ],
      height: opts.height || '600px',
      minHeight: '400px',
      placeholder: opts.placeholder || '내용을 입력하세요. 사진은 끌어다 놓으면 올라갑니다.',
      defaultStyle: 'font-family: Pretendard, "Noto Sans KR", sans-serif; font-size: 16px; line-height: 1.7;',
      charCounter: true,
      imageResizing: true,
      imageWidth: '100%',
      imageMultipleFile: true,
      videoResizing: true,
      videoFileInput: false,          // 동영상은 파일 업로드 대신 주소 붙여넣기 (용량·비용)
      videoUrlInput: true,
      tabDisable: false,
      attributesWhitelist: { all: 'style|class|data-.+' }
    });

    /* 사진을 넣을 때 우리 저장소로 올린다.
       아무것도 돌려주지 않으면 편집기가 uploadHandler 호출을 기다린다. */
    editor.onImageUploadBefore = function (files, info, core, uploadHandler) {
      (async function () {
        try {
          var result = [];
          for (var i = 0; i < files.length; i++) {
            var compressed = await compressImage(files[i], 1600, 0.85);
            var up = await uploadFile(compressed, opts.uploadContext || 'site-page');
            result.push({ url: up.url, name: up.name, size: up.size });
          }
          uploadHandler({ result: result });
        } catch (e) {
          uploadHandler({ errorMessage: (e && e.message) || '사진 업로드에 실패했습니다' });
        }
      })();
      return undefined;
    };

    if (typeof opts.onChange === 'function') {
      editor.onChange = function (contents) { opts.onChange(contents); };
    }

    /* Ctrl+S로 저장 — 편집 중 습관적으로 누르는 사람이 많다 */
    if (typeof opts.onSave === 'function') {
      editor.onKeyDown = function (e) {
        if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 's') {
          e.preventDefault();
          opts.onSave();
        }
      };
    }

    if (opts.initialValue) {
      try { editor.setContents(opts.initialValue); } catch (_) {}
    }

    return {
      _editor: editor,
      getHTML: function () {
        try { return editor.getContents(true); } catch (_) { return ''; }
      },
      setHTML: function (html) {
        try { editor.setContents(html || ''); } catch (_) {}
      },
      insertHTML: function (html) {
        try { editor.insertHTML(html, true, false); } catch (_) {}
      },
      /** 지도·후원 버튼 같은 특수 요소를 본문에 넣는다 (자리표시 문법) */
      insertShortcode: function (type, value) {
        var code = value ? '{{' + type + ':' + value + '}}' : '{{' + type + '}}';
        try { editor.insertHTML('<p>' + code + '</p>', true, false); } catch (_) {}
      },
      focus: function () {
        try { editor.core.focus(); } catch (_) {}
      },
      readOnly: function (on) {
        try { editor.readOnly(!!on); } catch (_) {}
      },
      destroy: function () {
        try { editor.destroy(); } catch (_) {}
      }
    };
  }

  window.SirenPageEditor = {
    create: create,
    loadLib: loadLib,
    compressImage: compressImage,
    uploadFile: uploadFile,
    version: VER
  };
})();
