// public/js/attachment.js
// ★ Phase M-2: SIREN 공통 첨부파일 위젯
// - /api/blob-upload (M-1) 재사용
// - 다중 파일 + 드래그&드롭 + 진행률 + 썸네일 + 삭제
// - 이미지 자동 압축 (SirenEditor 로드되어 있으면 재사용)
// - 사용법: const att = SirenAttachment.create({ el, ... });

(function (window, document) {
  'use strict';

  const DEFAULTS = {
    context: 'attachment',
    maxFiles: 10,
    maxFileSize: 10 * 1024 * 1024, // 10MB
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
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fileIcon(mime) {
    if (!mime) return '📎';
    if (mime.startsWith('image/')) return '🖼️';
    if (mime === 'application/pdf') return '📕';
    if (mime.includes('word')) return '📄';
    if (mime.includes('excel') || mime.includes('spreadsheet')) return '📊';
    if (mime.includes('hwp') || mime.includes('hancom')) return '📃';
    if (mime.startsWith('text/')) return '📃';
    return '📎';
  }

  /* 이미지 자동 압축 — SirenEditor(M-1)가 로드되어 있으면 그 함수 재사용 */
  async function compressIfImage(file, autoCompress) {
    if (!autoCompress) return file;
    if (!file.type || !file.type.startsWith('image/')) return file;
    if (file.type === 'image/gif') return file;

    if (window.SirenEditor && typeof window.SirenEditor.compressImage === 'function') {
      try { return await window.SirenEditor.compressImage(file, 1600, 0.85); }
      catch (e) { return file; }
    }
    return file;
  }

  /* XHR 기반 업로드 (진행률 추적) */
  function uploadWithProgress(file, context, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const fd = new FormData();
      fd.append('file', file);
      fd.append('context', context);
      fd.append('isPublic', 'true');

      xhr.open('POST', '/api/blob-upload', true);
      xhr.withCredentials = true;

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && typeof onProgress === 'function') {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const json = JSON.parse(xhr.responseText);
            if (json.ok && json.data) resolve(json.data);
            else reject(new Error(json.error || '업로드 실패'));
          } catch (e) {
            reject(new Error('응답 파싱 실패'));
          }
        } else {
          let msg = `업로드 실패 (${xhr.status})`;
          try {
            const err = JSON.parse(xhr.responseText);
            msg = err.error || msg;
          } catch (_) {}
          reject(new Error(msg));
        }
      };

      xhr.onerror = () => reject(new Error('네트워크 오류'));
      xhr.send(fd);
    });
  }

  /* ============================================================
     create — 메인 팩토리
     ============================================================ */
  function create(opts) {
    opts = Object.assign({}, DEFAULTS, opts || {});
    if (!opts.el) throw new Error('SirenAttachment.create: el이 필요합니다');

    const root = opts.el;
    root.classList.add('siren-attachment');

    /* 내부 상태:
       [{ id, originalName, mimeType, sizeBytes, url, status, progress, error }, ...]
       status: 'uploading' | 'done' | 'error' */
    const items = [];

    /* 초기 파일 (서버에서 불러온 기존 첨부 표시용) */
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

    /* DOM 생성 */
    root.innerHTML = `
      <div class="siren-attachment-dropzone" data-role="dropzone">
        <button type="button" class="siren-attachment-pick" data-role="pick">📎 파일 선택</button>
        <span class="siren-attachment-hint">또는 이 영역에 드래그&amp;드롭하세요</span>
        <small class="siren-attachment-limit">최대 ${opts.maxFiles}개 / 파일당 ${fmtSize(opts.maxFileSize)}</small>
        <input type="file" multiple data-role="input" style="display:none" ${opts.accept ? `accept="${escapeHtml(opts.accept)}"` : ''}>
      </div>
      <ul class="siren-attachment-list" data-role="list"></ul>
    `;

    const dropzone = root.querySelector('[data-role="dropzone"]');
    const pickBtn = root.querySelector('[data-role="pick"]');
    const fileInput = root.querySelector('[data-role="input"]');
    const listEl = root.querySelector('[data-role="list"]');

    /* 렌더 */
    function render() {
      listEl.innerHTML = items.map((item, idx) => {
        const isImage = item.mimeType && item.mimeType.startsWith('image/');
        const thumb = isImage && item.url
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
            ${removeBtn}
          </li>
        `;
      }).join('');

      /* 삭제 버튼 바인딩 */
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

    /* 파일 추가 */
    async function addFiles(fileList) {
      const files = Array.from(fileList || []);
      if (!files.length) return;

      for (const rawFile of files) {
        if (items.length >= opts.maxFiles) {
          fireError(`첨부파일은 최대 ${opts.maxFiles}개까지 가능합니다`);
          break;
        }
        if (rawFile.size > opts.maxFileSize) {
          fireError(`"${rawFile.name}" 파일이 ${fmtSize(opts.maxFileSize)}를 초과합니다`);
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

          const result = await uploadWithProgress(file, opts.context, (pct) => {
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

    /* 이벤트 바인딩 */
    pickBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      addFiles(e.target.files);
      fileInput.value = '';
    });

    ['dragenter', 'dragover'].forEach((evt) => {
      dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.add('dragover');
      });
    });
    ['dragleave', 'drop'].forEach((evt) => {
      dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove('dragover');
      });
    });
    dropzone.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      if (dt && dt.files && dt.files.length) addFiles(dt.files);
    });

    render();

    /* 공개 API */
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
    version: '1.0.0-m2',
  };

})(window, document);