// public/js/editor.js
// ★ Phase M-1: SIREN 공통 WYSIWYG 편집기 래퍼
// - Toast UI Editor v3.2.2 (CDN, lazy-load)
// - 이미지 자동 압축 (Canvas, max 1600px, JPEG 85%)
// - Netlify Blobs 업로드 어댑터 (/api/blob-upload)
// - 사용법: const ed = await SirenEditor.create({ el, ... });

(function (window) {
  'use strict';

  const TOAST_VER = '3.2.2';
  const COLOR_VER = '3.1.0';
  const COLORPICKER_VER = '2.0.3';

  const CDN = {
    editorCss: `https://cdn.jsdelivr.net/npm/@toast-ui/editor@${TOAST_VER}/dist/toastui-editor.min.css`,
    editorJs:  `https://cdn.jsdelivr.net/npm/@toast-ui/editor@${TOAST_VER}/dist/toastui-editor-all.min.js`,
    colorCss:  `https://cdn.jsdelivr.net/npm/@toast-ui/editor-plugin-color-syntax@${COLOR_VER}/dist/toastui-editor-plugin-color-syntax.min.css`,
    colorJs:   `https://cdn.jsdelivr.net/npm/@toast-ui/editor-plugin-color-syntax@${COLOR_VER}/dist/toastui-editor-plugin-color-syntax.min.js`,
    pickerCss: `https://uicdn.toast.com/tui-color-picker/v${COLORPICKER_VER}/tui-color-picker.min.css`,
    pickerJs:  `https://uicdn.toast.com/tui-color-picker/v${COLORPICKER_VER}/tui-color-picker.min.js`,
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

  async function loadLib() {
    if (_libLoaded) return;
    if (_libLoading) return _libLoading;

    _libLoading = (async () => {
      // CSS 병렬 로드
      await Promise.all([
        loadStylesheet(CDN.editorCss),
        loadStylesheet(CDN.colorCss),
        loadStylesheet(CDN.pickerCss),
        loadStylesheet('/css/editor.css'),
      ]);

      // JS는 순서 보장 (color-picker → editor → color-syntax)
      await loadScript(CDN.pickerJs);
      await loadScript(CDN.editorJs);
      await loadScript(CDN.colorJs);

      _libLoaded = true;
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
     - GIF는 애니메이션 보존 위해 압축 안 함
     - 원본보다 큰 결과물은 원본 유지
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
     업로드 (서버 어댑터)
     ============================================================ */
    /* ============================================================
     업로드 (★ M-2.5: R2 직접 업로드 — presign → PUT → confirm)
     ============================================================ */
  async function uploadFile(file, context = 'editor') {
    /* 1) presign */
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

    /* 2) R2 직접 PUT */
    const putRes = await fetch(presignData.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    });
    if (!putRes.ok) {
      throw new Error(`R2 업로드 실패 (${putRes.status})`);
    }

    /* 3) confirm */
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

    const Editor = window.toastui.Editor;
    const colorSyntax = window.toastui.Editor.plugin.colorSyntax;

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
      plugins: [colorSyntax],
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

      /* 첨부파일 업로드 헬퍼 (이미지 외 파일을 본문에 링크로 삽입) */
      uploadAttachment: async (file) => {
        el.classList.add('siren-editor-uploading');
        try {
          const result = await uploadFile(file, uploadContext);
          const safeName = (result.originalName || 'file')
            .replace(/[\[\]]/g, '');
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
    version: '1.0.0-m1',
  };

})(window);