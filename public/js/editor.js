// public/js/editor.js
// ★ Phase M-1 + 2026-05 v3 패치
// - Toast UI Editor v3.2.2 (CDN, lazy-load)
// - ★ NEW: 3-tier CDN fallback (jsdelivr → unpkg → uicdn.toast.com)
// - color-syntax 플러그인 완전 옵셔널화
// - 이미지 자동 압축 + R2 직접 업로드

(function (window) {
  'use strict';

  const TOAST_VER = '3.2.2';
  const COLOR_VER = '3.1.0';
  const COLORPICKER_VER = '2.0.3';

  /* ★ 2026-05 v3: 3-tier CDN fallback 시스템
     순서: jsdelivr → unpkg → uicdn.toast.com (공식)
     하나라도 성공하면 진행 */
  const CDN_FALLBACKS = {
    editorCss: [
      `https://cdn.jsdelivr.net/npm/@toast-ui/editor@${TOAST_VER}/dist/toastui-editor.min.css`,
      `https://unpkg.com/@toast-ui/editor@${TOAST_VER}/dist/toastui-editor.min.css`,
      `https://uicdn.toast.com/editor/${TOAST_VER}/toastui-editor.min.css`,
    ],
    editorJs: [
      `https://cdn.jsdelivr.net/npm/@toast-ui/editor@${TOAST_VER}/dist/toastui-editor-all.min.js`,
      `https://unpkg.com/@toast-ui/editor@${TOAST_VER}/dist/toastui-editor-all.min.js`,
      `https://uicdn.toast.com/editor/${TOAST_VER}/toastui-editor-all.min.js`,
    ],
    colorCss: [
      `https://cdn.jsdelivr.net/npm/@toast-ui/editor-plugin-color-syntax@${COLOR_VER}/dist/toastui-editor-plugin-color-syntax.min.css`,
      `https://unpkg.com/@toast-ui/editor-plugin-color-syntax@${COLOR_VER}/dist/toastui-editor-plugin-color-syntax.min.css`,
      `https://uicdn.toast.com/editor-plugin-color-syntax/${COLOR_VER}/toastui-editor-plugin-color-syntax.min.css`,
    ],
    colorJs: [
      `https://cdn.jsdelivr.net/npm/@toast-ui/editor-plugin-color-syntax@${COLOR_VER}/dist/toastui-editor-plugin-color-syntax.min.js`,
      `https://unpkg.com/@toast-ui/editor-plugin-color-syntax@${COLOR_VER}/dist/toastui-editor-plugin-color-syntax.min.js`,
      `https://uicdn.toast.com/editor-plugin-color-syntax/${COLOR_VER}/toastui-editor-plugin-color-syntax.min.js`,
    ],
    pickerCss: [
      `https://cdn.jsdelivr.net/npm/tui-color-picker@${COLORPICKER_VER}/dist/tui-color-picker.min.css`,
      `https://unpkg.com/tui-color-picker@${COLORPICKER_VER}/dist/tui-color-picker.min.css`,
      `https://uicdn.toast.com/tui-color-picker/v${COLORPICKER_VER}/tui-color-picker.min.css`,
    ],
    pickerJs: [
      `https://cdn.jsdelivr.net/npm/tui-color-picker@${COLORPICKER_VER}/dist/tui-color-picker.min.js`,
      `https://unpkg.com/tui-color-picker@${COLORPICKER_VER}/dist/tui-color-picker.min.js`,
      `https://uicdn.toast.com/tui-color-picker/v${COLORPICKER_VER}/tui-color-picker.min.js`,
    ],
  };

  let _libLoaded = false;
  let _libLoading = null;

  /* ============================================================
     CDN 동적 로더
     ============================================================ */
  function loadStylesheet(url) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`link[href="${url}"]`)) return resolve();
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = url;
      link.onload = () => resolve();
      link.onerror = () => reject(new Error('CSS 로드 실패: ' + url));
      document.head.appendChild(link);
    });
  }

  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const exist = document.querySelector(`script[src="${url}"]`);
      if (exist) {
        if (exist.dataset.loaded === '1') return resolve();
        exist.addEventListener('load', () => resolve());
        exist.addEventListener('error', () => reject(new Error('JS 로드 실패: ' + url)));
        return;
      }
      const script = document.createElement('script');
      script.src = url;
      script.async = false;
      script.onload = () => { script.dataset.loaded = '1'; resolve(); };
      script.onerror = () => reject(new Error('JS 로드 실패: ' + url));
      document.head.appendChild(script);
    });
  }

  /* ★ 2026-05 v3: fallback 시도 — 첫 번째 성공한 URL 사용 */
  async function loadCssWithFallback(urls, label) {
    for (let i = 0; i < urls.length; i++) {
      try {
        await loadStylesheet(urls[i]);
        if (i > 0) console.info(`[SirenEditor] ${label} loaded from fallback #${i + 1}: ${new URL(urls[i]).hostname}`);
        return true;
      } catch (e) {
        console.warn(`[SirenEditor] ${label} CDN ${i + 1} failed: ${new URL(urls[i]).hostname}`);
      }
    }
    return false;
  }

  async function loadJsWithFallback(urls, label) {
    for (let i = 0; i < urls.length; i++) {
      try {
        await loadScript(urls[i]);
        if (i > 0) console.info(`[SirenEditor] ${label} loaded from fallback #${i + 1}: ${new URL(urls[i]).hostname}`);
        return true;
      } catch (e) {
        console.warn(`[SirenEditor] ${label} CDN ${i + 1} failed: ${new URL(urls[i]).hostname}`);
      }
    }
    return false;
  }

  async function loadLib() {
    if (_libLoaded) return;
    if (_libLoading) return _libLoading;

    _libLoading = (async () => {
      /* 핵심 CSS (필수) — 모든 CDN 실패하면 throw */
      const editorCssOk = await loadCssWithFallback(CDN_FALLBACKS.editorCss, 'editor.css');
      if (!editorCssOk) {
        throw new Error('Toast UI Editor CSS를 로드할 수 없습니다 (모든 CDN 실패)');
      }
      await loadStylesheet('/css/editor.css').catch(() => {});

      /* 색상 관련 CSS (옵셔널) */
      await loadCssWithFallback(CDN_FALLBACKS.colorCss, 'colorSyntax.css');
      await loadCssWithFallback(CDN_FALLBACKS.pickerCss, 'colorPicker.css');

      /* ★ 핵심 editor JS (필수) — 모든 CDN 실패하면 throw */
      const editorJsOk = await loadJsWithFallback(CDN_FALLBACKS.editorJs, 'editor.js');
      if (!editorJsOk) {
        throw new Error('Toast UI Editor JS를 로드할 수 없습니다 (모든 CDN 실패) — 네트워크 또는 CDN 차단을 확인해주세요');
      }

      /* 색상 플러그인 JS (옵셔널) */
      await loadJsWithFallback(CDN_FALLBACKS.pickerJs, 'colorPicker.js');
      await loadJsWithFallback(CDN_FALLBACKS.colorJs, 'colorSyntax.js');

      _libLoaded = true;
      console.info('[SirenEditor] All libraries loaded successfully');
    })();

    try {
      await _libLoading;
    } catch (e) {
      _libLoading = null;
      throw e;
    }
  }

  /* ============================================================
     이미지 압축 (Canvas)
     ============================================================ */
  async function compressImage(file, maxSize = 1600, quality = 0.85) {
    if (!file || !file.type) return file;
    if (!file.type.startsWith('image/')) return file;
    if (file.type === 'image/gif') return file;

    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          if (width > maxSize || height > maxSize) {
            if (width > height) {
              height = Math.round(height * maxSize / width);
              width = maxSize;
            } else {
              width = Math.round(width * maxSize / height);
              height = maxSize;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob((blob) => {
            if (!blob || blob.size >= file.size) return resolve(file);
            const newName = file.name.replace(/\.\w+$/, '.jpg');
            resolve(new File([blob], newName, { type: 'image/jpeg', lastModified: Date.now() }));
          }, 'image/jpeg', quality);
        };
        img.onerror = () => resolve(file);
        img.src = e.target.result;
      };
      reader.onerror = () => resolve(file);
      reader.readAsDataURL(file);
    });
  }

  /* ============================================================
     업로드 (R2 직접)
     ============================================================ */
  async function uploadFile(file, context = 'editor') {
    const presignRes = await fetch('/api/blob-presign', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        originalName: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        context,
        isPublic: true,
      }),
    });
    if (!presignRes.ok) {
      let msg = 'presign 실패';
      try { const err = await presignRes.json(); msg = err.error || msg; } catch (_) {}
      throw new Error(msg);
    }
    const { data: presignData } = await presignRes.json();

    const putRes = await fetch(presignData.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    });
    if (!putRes.ok) throw new Error(`R2 업로드 실패 (${putRes.status})`);

    const confirmRes = await fetch('/api/blob-confirm', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: presignData.id }),
    });
    if (!confirmRes.ok) {
      let msg = 'confirm 실패';
      try { const err = await confirmRes.json(); msg = err.error || msg; } catch (_) {}
      throw new Error(msg);
    }
    const json = await confirmRes.json();
    return json.data;
  }

  /* ============================================================
     create — 메인 팩토리
     ============================================================ */
  async function create(opts) {
    opts = opts || {};
    const {
      el,
      initialValue = '',
      height = '500px',
      placeholder = '내용을 입력하세요...',
      onChange,
      uploadContext = 'editor',
      readonly = false,
      previewStyle = 'tab',
      initialEditType = 'wysiwyg',
    } = opts;

    if (!el) throw new Error('SirenEditor.create: el 옵션이 필요합니다');

    await loadLib();

    if (!el.classList.contains('siren-editor-wrap')) {
      el.classList.add('siren-editor-wrap');
    }
    if (readonly) el.classList.add('siren-editor-readonly');

    const Editor = window.toastui && window.toastui.Editor;
    if (!Editor) {
      throw new Error('Toast UI Editor 코어가 로드되지 않았습니다 — 페이지를 새로고침해 주세요');
    }

    /* colorSyntax 옵셔널 */
    const plugins = [];
    try {
      const cs = window.toastui && window.toastui.Editor && window.toastui.Editor.plugin && window.toastui.Editor.plugin.colorSyntax;
      if (typeof cs === 'function') plugins.push(cs);
    } catch (_) {}

    const toolbarItems = readonly ? [] : [
      ['heading', 'bold', 'italic', 'strike'],
      ['hr', 'quote'],
      ['ul', 'ol', 'task', 'indent', 'outdent'],
      ['table', 'image', 'link'],
      ['code', 'codeblock'],
      ['scrollSync'],
    ];

    const editor = new Editor({
      el,
      height,
      initialValue,
      placeholder,
      previewStyle,
      initialEditType,
      usageStatistics: false,
      hideModeSwitch: false,
      language: 'ko',
      plugins,
      toolbarItems,
      hooks: {
        addImageBlobHook: async (blob, callback) => {
          try {
            el.classList.add('siren-editor-uploading');
            const filename = (blob.name) ? blob.name : `image_${Date.now()}.jpg`;
            const file = (blob instanceof File)
              ? blob
              : new File([blob], filename, { type: blob.type || 'image/jpeg' });
            const compressed = await compressImage(file);
            const result = await uploadFile(compressed, uploadContext);
            callback(result.url, result.originalName || 'image');
          } catch (err) {
            console.error('[SirenEditor] 이미지 업로드 실패', err);
            alert('이미지 업로드 실패: ' + err.message);
          } finally {
            el.classList.remove('siren-editor-uploading');
          }
        },
      },
      events: {
        change: () => {
          if (typeof onChange === 'function') {
            try { onChange(editor.getHTML()); }
            catch (e) { console.error('[SirenEditor onChange]', e); }
          }
        },
      },
    });

    return {
      _instance: editor,
      getHTML: () => editor.getHTML(),
      getMarkdown: () => editor.getMarkdown(),
      setHTML: (html) => editor.setHTML(html || ''),
      setMarkdown: (md) => editor.setMarkdown(md || ''),
      focus: () => editor.focus(),
      destroy: () => { try { editor.destroy(); } catch (_) {} },

      uploadAttachment: async (file) => {
        el.classList.add('siren-editor-uploading');
        try {
          const result = await uploadFile(file, uploadContext);
          const safeName = (result.originalName || 'file').replace(/[\[\]]/g, '');
          editor.insertText(`\n[📎 ${safeName}](${result.url})\n`);
          return result;
        } finally {
          el.classList.remove('siren-editor-uploading');
        }
      },
    };
  }

  /* ============================================================
     공개 API
     ============================================================ */
  window.SirenEditor = {
    create,
    loadLib,
    compressImage,
    uploadFile,
    version: '1.3.0-fallback',
  };

})(window);