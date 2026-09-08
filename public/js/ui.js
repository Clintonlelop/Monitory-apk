/**
 * ui.js — Shared UI components (modals, toasts, tables, helpers)
 * Android MDM Dashboard
 */
const UI = (function () {
  'use strict';

  const DEBUG = false;
  function log(...args) { if (DEBUG) console.log('[UI]', ...args); }

  // ============================================================
  // Toast notifications
  // ============================================================
  const toastIcons = {
    success: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>',
    warning: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
    error: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>',
    info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>'
  };

  function showToast(message, type = 'info', duration = 4000) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast ' + type;
    const title = typeof message === 'object' ? (message.title || '') : '';
    const msg = typeof message === 'object' ? (message.message || message.title || '') : message;

    toast.innerHTML = `
      <div class="toast-icon">${toastIcons[type] || toastIcons.info}</div>
      <div class="toast-content">
        ${title ? `<div class="toast-title">${escapeHtml(title)}</div>` : ''}
        <div class="toast-message">${escapeHtml(msg)}</div>
      </div>
    `;
    container.appendChild(toast);

    const timer = setTimeout(() => removeToast(toast), duration);
    toast.addEventListener('click', () => {
      clearTimeout(timer);
      removeToast(toast);
    });
  }

  function removeToast(toast) {
    toast.classList.add('closing');
    setTimeout(() => toast.remove(), 200);
  }

  // ============================================================
  // Modal dialog
  // ============================================================
  function showModal(title, content, options = {}) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';

      const sizeClass = options.size === 'large' ? 'large' : options.size === 'small' ? 'small' : '';
      const modal = document.createElement('div');
      modal.className = 'modal ' + sizeClass;

      const footerButtons = options.buttons || [
        { text: 'Close', class: 'btn-secondary', value: null }
      ];

      modal.innerHTML = `
        <div class="modal-header">
          <div class="modal-title">${escapeHtml(title)}</div>
          <button class="modal-close" data-action="close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
        <div class="modal-body"></div>
        <div class="modal-footer"></div>
      `;

      const body = modal.querySelector('.modal-body');
      if (typeof content === 'string') {
        body.innerHTML = content;
      } else if (content instanceof HTMLElement) {
        body.appendChild(content);
      }

      const footer = modal.querySelector('.modal-footer');
      footerButtons.forEach((btn) => {
        const button = document.createElement('button');
        button.className = 'btn ' + (btn.class || 'btn-secondary');
        button.textContent = btn.text;
        button.addEventListener('click', () => {
          close();
          resolve(btn.value !== undefined ? btn.value : btn.text);
        });
        footer.appendChild(button);
      });

      function close() {
        overlay.remove();
        document.body.style.overflow = '';
      }

      modal.querySelector('[data-action="close"]').addEventListener('click', () => {
        close();
        resolve(null);
      });
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          close();
          resolve(null);
        }
      });

      overlay.appendChild(modal);
      document.body.appendChild(overlay);
      document.body.style.overflow = 'hidden';

      // Focus first input if any
      setTimeout(() => {
        const firstInput = body.querySelector('input, select, textarea');
        if (firstInput) firstInput.focus();
      }, 100);
    });
  }

  // ============================================================
  // Confirm dialog
  // ============================================================
  function confirmDialog(message, title = 'Confirm') {
    return showModal(title, `<p style="color: var(--text-secondary); font-size: 14px; line-height: 1.6;">${escapeHtml(message)}</p>`, {
      size: 'small',
      buttons: [
        { text: 'Cancel', class: 'btn-secondary', value: false },
        { text: 'Confirm', class: 'btn-danger', value: true }
      ]
    });
  }

  // ============================================================
  // Status badge
  // ============================================================
  function createStatusBadge(status) {
    const badge = document.createElement('span');
    const s = (status || '').toUpperCase();
    let cls = 'badge-muted';
    if (['ONLINE', 'GRANTED', 'COMPLETED', 'SUCCESS', 'ACTIVE', 'RECEIVED', 'EXECUTING'].includes(s)) cls = 'badge-success';
    else if (['OFFLINE', 'DENIED', 'FAILED', 'ERROR', 'MISSED'].includes(s)) cls = 'badge-danger';
    else if (['QUEUED', 'SENDING', 'PENDING', 'REQUIRES_USER_ACTION', 'CONNECTING', 'CHARGING'].includes(s)) cls = 'badge-warning';
    else if (['INFO', 'NOT_AVAILABLE', 'DISABLED'].includes(s)) cls = 'badge-info';
    badge.className = 'badge ' + cls;
    badge.textContent = status || 'UNKNOWN';
    return badge;
  }

  // ============================================================
  // Formatting helpers
  // ============================================================
  function formatBytes(bytes) {
    if (bytes === null || bytes === undefined || isNaN(bytes)) return '—';
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function formatDuration(seconds) {
    if (seconds === null || seconds === undefined || isNaN(seconds)) return '—';
    seconds = Math.floor(seconds);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) {
      return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function formatDate(timestamp) {
    if (!timestamp) return '—';
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return '—';
    const now = Date.now();
    const diff = now - date.getTime();
    const seconds = Math.floor(diff / 1000);
    let relative;
    if (seconds < 60) relative = 'just now';
    else if (seconds < 3600) relative = Math.floor(seconds / 60) + ' min ago';
    else if (seconds < 86400) relative = Math.floor(seconds / 3600) + ' hr ago';
    else if (seconds < 604800) relative = Math.floor(seconds / 86400) + ' days ago';
    else relative = date.toLocaleDateString();

    const absolute = date.toLocaleString();
    const span = document.createElement('span');
    span.textContent = relative;
    span.title = absolute;
    span.style.cursor = 'help';
    return span;
  }

  function formatDateString(timestamp) {
    if (!timestamp) return '—';
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return '—';
    return date.toLocaleString();
  }

  // ============================================================
  // Reusable table with sorting
  // ============================================================
  function createTable(headers, rows, options = {}) {
    const table = document.createElement('table');
    table.className = 'data-table';

    // Header
    const thead = document.createElement('thead');
    const tr = document.createElement('tr');
    headers.forEach((h, i) => {
      const th = document.createElement('th');
      if (typeof h === 'string') {
        th.textContent = h;
      } else {
        th.textContent = h.label;
        if (h.sortable !== false) {
          th.innerHTML += '<span class="sort-icon">▼</span>';
          th.addEventListener('click', () => sortTable(table, i, h));
        }
        if (h.className) th.className = h.className;
      }
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    table.appendChild(thead);

    // Body
    const tbody = document.createElement('tbody');
    renderTableRows(tbody, headers, rows);
    table.appendChild(tbody);

    if (options.className) table.classList.add(options.className);
    return table;
  }

  function renderTableRows(tbody, headers, rows) {
    tbody.innerHTML = '';
    if (!rows || rows.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = headers.length;
      td.style.textAlign = 'center';
      td.style.padding = '32px';
      td.style.color = 'var(--text-muted)';
      td.textContent = 'No data';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }
    rows.forEach(row => {
      const tr = document.createElement('tr');
      if (row._className) tr.className = row._className;
      if (row._onClick) {
        tr.style.cursor = 'pointer';
        tr.addEventListener('click', row._onClick);
      }
      headers.forEach((h, i) => {
        const td = document.createElement('td');
        const key = typeof h === 'string' ? h.toLowerCase().replace(/\s+/g, '_') : h.key;
        const label = typeof h === 'string' ? h : h.label;
        td.setAttribute('data-label', label);
        const value = row[key];
        if (value instanceof HTMLElement) {
          td.appendChild(value);
        } else if (value !== undefined && value !== null) {
          td.textContent = value;
        } else {
          td.textContent = '—';
        }
        if (h && h.className) td.classList.add(h.className);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  }

  function sortTable(table, colIndex, header) {
    const tbody = table.querySelector('tbody');
    const rows = Array.from(tbody.querySelectorAll('tr'));
    const isCurrentlySorted = table.querySelector('th.sorted') === table.querySelectorAll('th')[colIndex];
    const ascending = !isCurrentlySorted || !table.dataset.sortAsc || table.dataset.sortAsc === 'false';

    table.querySelectorAll('th').forEach(th => th.classList.remove('sorted'));
    table.querySelectorAll('th')[colIndex].classList.add('sorted');
    table.dataset.sortAsc = ascending;

    const key = header.key;
    rows.sort((a, b) => {
      const aVal = a.children[colIndex]?.textContent || '';
      const bVal = b.children[colIndex]?.textContent || '';
      const aNum = parseFloat(aVal);
      const bNum = parseFloat(bVal);
      let cmp;
      if (!isNaN(aNum) && !isNaN(bNum)) cmp = aNum - bNum;
      else cmp = aVal.localeCompare(bVal);
      return ascending ? cmp : -cmp;
    });
    rows.forEach(r => tbody.appendChild(r));
  }

  // ============================================================
  // Empty state
  // ============================================================
  function emptyState(message, icon, description) {
    const div = document.createElement('div');
    div.className = 'empty-state';
    div.innerHTML = `
      ${icon ? `<div class="empty-state-icon">${icon}</div>` : ''}
      <div class="empty-state-title">${escapeHtml(message)}</div>
      ${description ? `<div class="empty-state-desc">${escapeHtml(description)}</div>` : ''}
    `;
    return div;
  }

  // ============================================================
  // Loading spinner
  // ============================================================
  function loadingSpinner(message) {
    const div = document.createElement('div');
    div.className = 'loading-container';
    div.innerHTML = `<div class="loading-spinner"></div>${message ? `<span>${escapeHtml(message)}</span>` : ''}`;
    return div;
  }

  // ============================================================
  // HTML escape
  // ============================================================
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  // ============================================================
  // Create element helper
  // ============================================================
  function el(tag, className, html) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (html !== undefined) element.innerHTML = html;
    return element;
  }

  return {
    showToast,
    showModal,
    confirmDialog,
    createStatusBadge,
    formatBytes,
    formatDuration,
    formatDate,
    formatDateString,
    createTable,
    emptyState,
    loadingSpinner,
    escapeHtml,
    el
  };
})();
