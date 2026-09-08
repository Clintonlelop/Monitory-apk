/**
 * pages/gallery.js — Media gallery page
 * Grid of uploaded photos/videos with lightbox viewer
 */
(function () {
  'use strict';

  let media = [];
  let filterType = 'all';

  async function init(container) {
    const deviceId = App.currentDeviceId;
    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Gallery</h1>
          <p class="page-subtitle">Uploaded photos and videos</p>
        </div>
        <div class="page-actions">
          <div class="chart-toggle-group">
            <button class="chart-toggle-btn ${filterType === 'all' ? 'active' : ''}" data-type="all">All</button>
            <button class="chart-toggle-btn ${filterType === 'photo' ? 'active' : ''}" data-type="photo">Photos</button>
            <button class="chart-toggle-btn ${filterType === 'video' ? 'active' : ''}" data-type="video">Videos</button>
          </div>
        </div>
      </div>
      <div id="galleryContent">
        <div class="loading-container"><div class="loading-spinner"></div><span>Loading media…</span></div>
      </div>
    `;

    if (!deviceId) {
      document.getElementById('galleryContent').innerHTML = '';
      document.getElementById('galleryContent').appendChild(
        UI.emptyState('No device selected', null, 'Select a device to view media.')
      );
      return;
    }

    container.querySelectorAll('.chart-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        filterType = btn.dataset.type;
        container.querySelectorAll('.chart-toggle-btn').forEach(b => b.classList.toggle('active', b === btn));
        renderGallery();
      });
    });

    await loadMedia();

    App.subscribeWS('MEDIA_UPLOADED', () => loadMedia());
  }

  async function loadMedia() {
    const deviceId = App.currentDeviceId;
    if (!deviceId) return;
    try {
      const res = await API.media.list({ device_id: deviceId, limit: 200 });
      media = res.data || res || [];
      renderGallery();
    } catch (err) {
      document.getElementById('galleryContent').innerHTML = '';
      document.getElementById('galleryContent').appendChild(
        UI.emptyState('Failed to load media', null, err.message)
      );
    }
  }

  function getMediaType(item) {
    const type = (item.mime_type || item.type || item.file_type || '').toLowerCase();
    if (type.startsWith('video') || type === 'video') return 'video';
    return 'photo';
  }

  function renderGallery() {
    const content = document.getElementById('galleryContent');
    if (!content) return;

    let filtered = media;
    if (filterType !== 'all') {
      filtered = media.filter(m => getMediaType(m) === filterType);
    }

    if (filtered.length === 0) {
      content.innerHTML = '';
      content.appendChild(UI.emptyState(
        media.length === 0 ? 'No media yet' : 'No media in this category',
        '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>',
        media.length === 0
          ? 'Photos and videos captured or synced from the device will appear here.'
          : 'Try a different filter.'
      ));
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'gallery-grid';

    filtered.forEach(item => {
      const isVideo = getMediaType(item) === 'video';
      const el = document.createElement('div');
      el.className = 'gallery-item';
      const thumbUrl = item.thumbnail_url || item.url || (item.id ? '/api/media/' + item.id + '/download' : '');
      const downloadUrl = item.download_url || item.url || (item.id ? '/api/media/' + item.id + '/download' : '');

      el.innerHTML = `
        ${thumbUrl ? `<img class="gallery-thumbnail" src="${thumbUrl}" alt="${UI.escapeHtml(item.filename || item.name || '')}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">` : ''}
        <div class="gallery-placeholder" style="${thumbUrl ? 'display:none;' : ''}">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">${isVideo ? '<polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>' : '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline>'}</svg>
        </div>
        ${isVideo ? `<div class="gallery-play-badge"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg></div>` : ''}
        <div class="gallery-item-overlay">
          <div class="gallery-item-name">${UI.escapeHtml(item.filename || item.name || 'Untitled')}</div>
          <div class="gallery-item-meta">${item.size != null ? UI.formatBytes(item.size) : ''} • ${UI.formatDateString(item.uploaded_at || item.created_at || item.timestamp)}</div>
        </div>
      `;

      el.addEventListener('click', () => openLightbox(item, isVideo, downloadUrl));
      grid.appendChild(el);
    });

    content.innerHTML = '';
    content.appendChild(grid);
  }

  function openLightbox(item, isVideo, url) {
    const overlay = document.createElement('div');
    overlay.className = 'lightbox';
    overlay.innerHTML = `
      <button class="lightbox-close">&times;</button>
      <div class="lightbox-content">
        ${isVideo
          ? `<video controls autoplay><source src="${url}" type="${item.mime_type || 'video/mp4'}">Your browser does not support video.</video>`
          : `<img src="${url}" alt="${UI.escapeHtml(item.filename || '')}">`
        }
        <div class="lightbox-caption">${UI.escapeHtml(item.filename || item.name || '')} — ${item.size != null ? UI.formatBytes(item.size) : ''}</div>
      </div>
    `;
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.classList.contains('lightbox-close')) {
        overlay.remove();
      }
    });
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape') {
        overlay.remove();
        document.removeEventListener('keydown', escHandler);
      }
    });
    document.body.appendChild(overlay);
  }

  const module = { init, refresh: loadMedia };
  App.registerPage('gallery', module);
})();
