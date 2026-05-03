// public/js/attachment.js
// ★ Phase M-2.5: SIREN 공통 첨부파일 위젯 (R2 직접 업로드)
// - 흐름: presign → R2 직접 PUT → confirm
// - 이미지 20MB / 일반 파일 100MB
// - 다중 파일 + 드래그&드롭 + 진행률 + 썸네일 + 다운로드 + 삭제

(function (window, document) {
  'use strict';

  const DEFAULTS = {
    context: 'attachment',
    maxFiles: 10,
    maxImageSize: 20 * 1024 * 1024, // 20MB
    maxFileSize: 100 * 1024 * 1024, // 100MB
    accept: '',
    autoCompress: true,
    onChange: null,
    onError: null,
  };

  function fmtSize(bytes) {
    if (!bytes) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fileIcon(mime) {
    if (!mime) return '📎';
    if (mime.startsWith('image/')) return '🖼️';
    if (mime === 'application/pdf') return '📕';
    if (mime.includes('word')) return '📄';
    if (mime.includes('excel') || mime.includes('spreadsheet')) return '📊';
    if (mime.includes('hwp') || mime.includes('hancom')) return '📃';
    if (mime.includes('zip')) return '🗜️';
    if (mime.startsWith('text/')) return '📃';
    return '📎';
  }

  function isImageType(mime) {
    return mime && mime.startsWith('image/');
  }

  /* 이미지 자동 압축 */
  async function compressIfImage(file, autoCompress) {
    if (!autoCompress) return file;
    if (!isImageType(file.type)) return file;
    if (file.type === 'image/gif') return file;

    if (window.SirenEditor && typeof window.SirenEditor.compressImage === 'function') {
      try { return await window.SirenEditor.compressImage(file, 1600, 0.85); }
      catch (e) { return file; }
    }
    return file;
  }

  /* ============================================================
     R2 직접 업로드 (presign → PUT → confirm)
     ============================================================ */
  async function uploadToR2(file, context, onProgress) {
    /* 1) presign 요청 */
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
    const presignJson = await presignRes.json();
    const { id, uploadUrl } = presignJson.data;

    /* 2) R2에 직접 PUT (XHR로 진행률 추적) */
    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', uploadUrl, true);
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && typeof onProgress === 'function') {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(`R2 업로드 실패 (${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error('R2 업로드 네트워크 오류'));
      xhr.send(file);
    });

    /* 3) 서버 확인 */
    const confirmRes = await fetch('/api/blob-confirm', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });

    if (!confirmRes.ok) {
      let msg = 'confirm 실패';
      try { const err = await confirmRes.json(); msg = err.error || msg; } catch (_) {}
      throw new Error(msg);
    }
    const confirmJson = await confirmRes.json();
    return confirmJson.data;
  }

  /* ============================================================
     create — 메인 팩토리
     ============================================================ */
  function create(opts) {
    opts = Object.assign({}, DEFAULTS, opts || {});
    if (!opts.el) throw new Error('SirenAttachment.create: el이 필요합니다');

    const root = opts.el;
    root.classList.add('siren-attachment');

    const items = [];

    if (Array.isArray(opts.initialFiles)) {
      opts.initialFiles.forEach((f) => {
        items.push({
          id: f.id,
          originalName: f.originalName || f.name || 'file',
          mimeType: f.mimeType || f.mime || '',
          sizeBytes: f.sizeBytes || f.size || 0,
          url: f.url || (f.id ? `/api/blob-image?id=${f.id}` : null),
          status: 'done',
        });
      });
    }

    root.innerHTML = `
      <div class="siren-attachment-dropzone" data-role="dropzone">
        <button type="button" class="siren-attachment-pick" data-role="pick">📎 파일 선택</button>
        <span class="siren-attachment-hint">또는 이 영역에 드래그&amp;드롭하세요</span>
        <small class="siren-attachment-limit">최대 ${opts.maxFiles}개 / 이미지 ${fmtSize(opts.maxImageSize)} / 일반 ${fmtSize(opts.maxFileSize)}</small>
        <input type="file" multiple data-role="input" style="display:none" ${opts.accept ? `accept="${escapeHtml(opts.accept)}"` : ''}>
      </div>
      <ul class="siren-attachment-list" data-role="list"></ul>
    `;

    const dropzone = root.querySelector('[data-role="dropzone"]');
    const pickBtn = root.querySelector('[data-role="pick"]');
    const fileInput = root.querySelector('[data-role="input"]');
    const listEl = root.querySelector('[data-role="list"]');

    function render() {
      listEl.innerHTML = items.map((item, idx) => {
        const isImg = isImageType(item.mimeType);
        const thumb = isImg && item.url
          ? `<img src="${escapeHtml(item.url)}" alt="">`
          : `<span class="siren-attachment-icon">${fileIcon(item.mimeType)}</span>`;

        let statusHtml = '';
        if (item.status === 'uploading') {
          statusHtml = `<progress max="100" value="${item.progress || 0}"></progress>`;
        } else if (item.status === 'error') {
          statusHtml = `<span class="siren-attachment-error">⚠ ${escapeHtml(item.error || '오류')}</span>`;
        } else if (item.status === 'done') {
          statusHtml = `<span class="siren-attachment-done">✓ 완료</span>`;
        }

        const downloadBtn = (item.status === 'done' && item.id)
          ? `<a class="siren-attachment-download" href="/api/blob-image?id=${item.id}&download=1" target="_blank" rel="noopener" title="다운로드">⬇</a>`
          : '';

        const removeBtn = item.status === 'uploading'
          ? ''
          : `<button type="button" class="siren-attachment-remove" data-idx="${idx}" title="삭제">×</button>`;

        return `
          <li class="siren-attachment-item" data-status="${item.status || 'done'}">
            <div class="siren-attachment-thumb">${thumb}</div>
            <div class="siren-attachment-meta">
              <div class="siren-attachment-name">${escapeHtml(item.originalName || 'file')}</div>
              <div class="siren-attachment-info">
                <span>${fmtSize(item.sizeBytes || 0)}</span>
                ${statusHtml}
              </div>
            </div>
            ${downloadBtn}
            ${removeBtn}
          </li>
        `;
      }).join('');

      listEl.querySelectorAll('.siren-attachment-remove').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = Number(btn.dataset.idx);
          if (Number.isFinite(idx)) {
            items.splice(idx, 1);
            render();
            fireChange();
          }
        });
      });
    }

    function fireChange() {
      if (typeof opts.onChange === 'function') {
        try { opts.onChange(items.filter((x) => x.status === 'done')); }
        catch (e) { console.error('[SirenAttachment onChange]', e); }
      }
    }

    function fireError(msg) {
      if (typeof opts.onError === 'function') opts.onError(msg);
      else alert(msg);
    }

    async function addFiles(fileList) {
      const files = Array.from(fileList || []);
      if (!files.length) return;

      for (const rawFile of files) {
        if (items.length >= opts.maxFiles) {
          fireError(`첨부파일은 최대 ${opts.maxFiles}개까지 가능합니다`);
          break;
        }

        const isImg = isImageType(rawFile.type);
        const limit = isImg ? opts.maxImageSize : opts.maxFileSize;
        if (rawFile.size > limit) {
          fireError(`"${rawFile.name}" 파일이 ${fmtSize(limit)}를 초과합니다`);
          continue;
        }

        const slot = {
          id: null,
          originalName: rawFile.name,
          mimeType: rawFile.type,
          sizeBytes: rawFile.size,
          url: null,
          status: 'uploading',
          progress: 0,
        };
        items.push(slot);
        render();

        try {
          const file = await compressIfImage(rawFile, opts.autoCompress);
          slot.sizeBytes = file.size;
          render();

          const result = await uploadToR2(file, opts.context, (pct) => {
            slot.progress = pct;
            const idx = items.indexOf(slot);
            const progEl = listEl.querySelector(
              `.siren-attachment-item:nth-child(${idx + 1}) progress`
            );
            if (progEl) progEl.value = pct;
          });

          slot.id = result.id;
          slot.url = result.url;
          slot.originalName = result.originalName || slot.originalName;
          slot.mimeType = result.mimeType || slot.mimeType;
          slot.sizeBytes = result.sizeBytes || slot.sizeBytes;
          slot.status = 'done';
        } catch (err) {
          console.error('[SirenAttachment]', err);
          slot.status = 'error';
          slot.error = err.message || '업로드 실패';
        }
        render();
        fireChange();
      }
    }

    pickBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      addFiles(e.target.files);
      fileInput.value = '';
    });

    ['dragenter', 'dragover'].forEach((evt) => {
      dropzone.addEventListener(evt, (e) => {
        e.preventDefault(); e.stopPropagation();
        dropzone.classList.add('dragover');
      });
    });
    ['dragleave', 'drop'].forEach((evt) => {
      dropzone.addEventListener(evt, (e) => {
        e.preventDefault(); e.stopPropagation();
        dropzone.classList.remove('dragover');
      });
    });
    dropzone.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      if (dt && dt.files && dt.files.length) addFiles(dt.files);
    });

    render();

    return {
      _root: root,
      getFiles: () => items.filter((x) => x.status === 'done').map((x) => ({
        id: x.id,
        originalName: x.originalName,
        mimeType: x.mimeType,
        sizeBytes: x.sizeBytes,
        url: x.url,
      })),
      getIds: () => items.filter((x) => x.status === 'done' && x.id).map((x) => x.id),
      getCount: () => items.filter((x) => x.status === 'done').length,
      hasUploading: () => items.some((x) => x.status === 'uploading'),
      addFiles,
      clear: () => { items.length = 0; render(); fireChange(); },
      remove: (id) => {
        const idx = items.findIndex((x) => x.id === id);
        if (idx >= 0) { items.splice(idx, 1); render(); fireChange(); }
      },
      destroy: () => {
        root.innerHTML = '';
        root.classList.remove('siren-attachment');
      },
    };
  }

  window.SirenAttachment = {
    create,
    version: '2.0.0-m2-5-r2',
  };

})(window, document);