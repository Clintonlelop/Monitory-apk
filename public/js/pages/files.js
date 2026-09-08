/**
 * pages/files.js — Device files page
 * File metadata table with type filtering, search, and sync
 */
(function () {
  'use strict';

  let files = [];
  let filterType = '';
  let searchQuery = '';

  const FILE_TYPES = [
    { value: '', label: 'All Files' },
    { value: 'image', label: 'Photos' },
    { value: 'video', label: 'Videos' },
    { value: 'audio', label: 'Audio' },
    { value: 'document', label: 'Documents' },
    { value: 'download', label: 'Downloads' }
  ];

  async function init(container) {
    const deviceId = App.currentDeviceId;
    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Files</h1>
          <p class="page-subtitle">Device file metadata and synced files</p>
        </div>
        <div class="page-actions">
          <button class="btn btn-primary btn-sm" id="btnSyncFiles">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>
            Sync Files
          </button>
        </div>
      </div>
      <div class="filter-bar">
        <input type="text" class="search-input form-input" id="filesSearch" placeholder="Search by filename…">
        <select class="filter-select form-select" id="filesTypeFilter">
          ${FILE_TYPES.map(t => `<option value="${t.value}">${t.label}</option>`).join('')}
        </select>
        <span class="text-muted" id="filesCount" style="font-size: 12px;"></span>
      </div>
      <div class="card">
        <div class="card-body no-padding">
          <div id="filesContent">
            <div class="loading-container"><div class="loading-spinner"></div><span>Loading files…</span></div>
          </div>
        </div>
      </div>
    `;

    if (!deviceId) {
      document.getElementById('filesContent').innerHTML = '';
      document.getElementById('filesContent').appendChild(
        UI.emptyState('No device selected', null, 'Select a device to view files.')
      );
      return;
    }

    document.getElementById('filesSearch').addEventListener('input', (e) => {
      searchQuery = e.target.value.toLowerCase();
      renderFiles();
    });

    document.getElementById('filesTypeFilter').addEventListener('change', (e) => {
      filterType = e.target.value;
      renderFiles();
    });

    document.getElementById('btnSyncFiles').addEventListener('click', () => {
      API.commands.create(deviceId, 'SYNC_FILES', {}).then(() => {
        UI.showToast('File sync command sent', 'success');
      }).catch(() => {});
    });

    await loadFiles();

    App.subscribeWS('FILES_SYNCED', () => loadFiles());
  }

  async function loadFiles() {
    const deviceId = App.currentDeviceId;
    if (!deviceId) return;
    try {
      const res = await API.files.list(deviceId, { limit: 1000 });
      files = res.data || res || [];
      renderFiles();
    } catch (err) {
      document.getElementById('filesContent').innerHTML = '';
      document.getElementById('filesContent').appendChild(
        UI.emptyState('Failed to load files', null, err.message)
      );
    }
  }

  function getFileType(file) {
    const type = (file.mime_type || file.type || '').toLowerCase();
    const name = (file.filename || file.name || '').toLowerCase();
    if (type.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|bmp|heic)$/.test(name)) return 'image';
    if (type.startsWith('video/') || /\.(mp4|avi|mkv|mov|wmv|flv)$/.test(name)) return 'video';
    if (type.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|flac)$/.test(name)) return 'audio';
    if (type.startsWith('application/') || /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv)$/.test(name)) return 'document';
    if (name.includes('download')) return 'download';
    return 'other';
  }

  function renderFiles() {
    const content = document.getElementById('filesContent');
    const countEl = document.getElementById('filesCount');
    if (!content) return;

    let filtered = files;
    if (filterType) {
      filtered = filtered.filter(f => getFileType(f) === filterType);
    }
    if (searchQuery) {
      filtered = filtered.filter(f =>
        (f.filename || f.name || '').toLowerCase().includes(searchQuery) ||
        (f.path || '').toLowerCase().includes(searchQuery)
      );
    }

    if (countEl) countEl.textContent = filtered.length + ' / ' + files.length + ' files';

    if (filtered.length === 0) {
      content.innerHTML = '';
      content.appendChild(UI.emptyState(
        files.length === 0 ? 'No files yet' : 'No matching files',
        '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>',
        files.length === 0
          ? 'Click "Sync Files" to index files on the device. Requires Storage/Media permission.'
          : 'Try adjusting your search or filter.'
      ));
      return;
    }

    const headers = [
      { label: 'File', key: 'file' },
      { label: 'Type', key: 'type' },
      { label: 'Size', key: 'size' },
      { label: 'Modified', key: 'modified' },
      { label: 'Path', key: 'path', className: 'mono' }
    ];
    const rows = filtered.map(f => {
      const fileType = getFileType(f);
      const ext = (f.filename || f.name || '').split('.').pop().substring(0, 4).toUpperCase();
      const icon = document.createElement('span');
      icon.className = 'file-icon ' + fileType;
      icon.textContent = ext || 'FILE';

      const nameWrap = document.createElement('div');
      nameWrap.style.display = 'flex';
      nameWrap.style.alignItems = 'center';
      nameWrap.style.gap = '10px';
      nameWrap.appendChild(icon);
      const nameSpan = document.createElement('span');
      nameSpan.textContent = f.filename || f.name || '—';
      nameWrap.appendChild(nameSpan);

      return {
        file: nameWrap,
        type: f.mime_type || f.type || fileType,
        size: f.size != null ? UI.formatBytes(f.size) : '—',
        modified: UI.formatDateString(f.modified_date || f.last_modified || f.timestamp || f.created_at),
        path: f.path || '—'
      };
    });

    content.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.style.overflowX = 'auto';
    wrapper.appendChild(UI.createTable(headers, rows));
    content.appendChild(wrapper);
  }

  const module = { init, refresh: loadFiles };
  App.registerPage('files', module);
})();
