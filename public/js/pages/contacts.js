/**
 * pages/contacts.js — Contacts page
 * Contacts table with search, sync, and last sync timestamp
 */
(function () {
  'use strict';

  let contacts = [];
  let searchQuery = '';
  let lastSync = null;

  async function init(container) {
    const deviceId = App.currentDeviceId;
    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Contacts</h1>
          <p class="page-subtitle" id="contactsSubtitle">Synchronized device contacts</p>
        </div>
        <div class="page-actions">
          <button class="btn btn-primary btn-sm" id="btnSyncContacts">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>
            Sync Contacts
          </button>
        </div>
      </div>
      <div class="filter-bar">
        <input type="text" class="search-input form-input" id="contactsSearch" placeholder="Search by name or phone…">
        <span class="text-muted" id="contactsCount" style="font-size: 12px;"></span>
      </div>
      <div class="card">
        <div class="card-body no-padding">
          <div id="contactsContent">
            <div class="loading-container"><div class="loading-spinner"></div><span>Loading contacts…</span></div>
          </div>
        </div>
      </div>
    `;

    if (!deviceId) {
      document.getElementById('contactsContent').innerHTML = '';
      document.getElementById('contactsContent').appendChild(
        UI.emptyState('No device selected', null, 'Select a device to view contacts.')
      );
      return;
    }

    document.getElementById('contactsSearch').addEventListener('input', (e) => {
      searchQuery = e.target.value.toLowerCase();
      renderContacts();
    });

    document.getElementById('btnSyncContacts').addEventListener('click', () => {
      API.commands.create(deviceId, 'SYNC_CONTACTS', {}).then(() => {
        UI.showToast('Contacts sync command sent', 'success');
      }).catch(() => {});
    });

    await loadContacts();

    App.subscribeWS('CONTACTS_SYNCED', () => {
      lastSync = new Date();
      loadContacts();
    });
  }

  async function loadContacts() {
    const deviceId = App.currentDeviceId;
    if (!deviceId) return;
    try {
      const res = await API.contacts.list(deviceId);
      contacts = res.data || res || [];
      renderContacts();
    } catch (err) {
      document.getElementById('contactsContent').innerHTML = '';
      document.getElementById('contactsContent').appendChild(
        UI.emptyState('Failed to load contacts', null, err.message)
      );
    }
  }

  function renderContacts() {
    const content = document.getElementById('contactsContent');
    const countEl = document.getElementById('contactsCount');
    const subtitle = document.getElementById('contactsSubtitle');
    if (!content) return;

    let filtered = contacts;
    if (searchQuery) {
      filtered = contacts.filter(c =>
        (c.name || '').toLowerCase().includes(searchQuery) ||
        (c.phone || c.phone_number || '').toLowerCase().includes(searchQuery) ||
        (c.email || '').toLowerCase().includes(searchQuery)
      );
    }

    if (countEl) countEl.textContent = filtered.length + ' / ' + contacts.length + ' contacts';
    if (subtitle && lastSync) subtitle.textContent = 'Last sync: ' + UI.formatDateString(lastSync);

    if (filtered.length === 0) {
      content.innerHTML = '';
      content.appendChild(UI.emptyState(
        contacts.length === 0 ? 'No contacts yet' : 'No matching contacts',
        '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>',
        contacts.length === 0
          ? 'Click "Sync Contacts" to pull contacts from the device. Requires Contacts permission.'
          : 'Try adjusting your search.'
      ));
      return;
    }

    const headers = [
      { label: 'Name', key: 'name' },
      { label: 'Phone', key: 'phone' },
      { label: 'Email', key: 'email' }
    ];
    const rows = filtered.map(c => ({
      name: c.name || '—',
      phone: c.phone || c.phone_number || '—',
      email: c.email || '—'
    }));

    content.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.style.overflowX = 'auto';
    wrapper.appendChild(UI.createTable(headers, rows));
    content.appendChild(wrapper);
  }

  const module = { init, refresh: loadContacts };
  App.registerPage('contacts', module);
})();
