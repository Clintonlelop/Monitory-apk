/**
 * pages/sms.js — SMS page
 * Conversation list + message thread view (chat-style bubbles)
 */
(function () {
  'use strict';

  let conversations = [];
  let messages = [];
  let activeThread = null;
  let searchQuery = '';

  async function init(container) {
    const deviceId = App.currentDeviceId;
    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">SMS</h1>
          <p class="page-subtitle">Text message conversations</p>
        </div>
        <div class="page-actions">
          <input type="text" class="form-input" id="smsSearch" placeholder="Search messages…" style="width: 200px;">
          <button class="btn btn-primary btn-sm" id="btnSyncSMS">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>
            Sync SMS
          </button>
        </div>
      </div>
      <div id="smsContent">
        <div class="loading-container"><div class="loading-spinner"></div><span>Loading messages…</span></div>
      </div>
    `;

    if (!deviceId) {
      document.getElementById('smsContent').innerHTML = '';
      document.getElementById('smsContent').appendChild(
        UI.emptyState('No device selected', null, 'Select a device to view SMS.')
      );
      return;
    }

    document.getElementById('smsSearch').addEventListener('input', (e) => {
      searchQuery = e.target.value.toLowerCase();
      renderConversations();
    });

    document.getElementById('btnSyncSMS').addEventListener('click', () => {
      API.commands.create(deviceId, 'SYNC_SMS', {}).then(() => {
        UI.showToast('SMS sync command sent', 'success');
      }).catch(() => {});
    });

    await loadSMS();

    App.subscribeWS('SMS_SYNCED', () => loadSMS());
  }

  async function loadSMS() {
    const deviceId = App.currentDeviceId;
    if (!deviceId) return;
    try {
      const res = await API.sms.list(deviceId, { limit: 1000 });
      messages = res.data || res || [];
      buildConversations();
      renderSMSLayout();
    } catch (err) {
      document.getElementById('smsContent').innerHTML = '';
      document.getElementById('smsContent').appendChild(
        UI.emptyState('Failed to load SMS', null, err.message)
      );
    }
  }

  function buildConversations() {
    const map = {};
    messages.forEach(msg => {
      const address = msg.address || msg.sender || msg.recipient || msg.thread_id || 'unknown';
      if (!map[address]) {
        map[address] = {
          address,
          contact_name: msg.contact_name || null,
          messages: [],
          last_message: null,
          last_timestamp: 0
        };
      }
      map[address].messages.push(msg);
      const ts = new Date(msg.timestamp || msg.date || msg.created_at).getTime();
      if (ts > map[address].last_timestamp) {
        map[address].last_timestamp = ts;
        map[address].last_message = msg;
      }
    });
    conversations = Object.values(map).sort((a, b) => b.last_timestamp - a.last_timestamp);
    if (!activeThread && conversations.length > 0) {
      activeThread = conversations[0].address;
    }
  }

  function renderSMSLayout() {
    const content = document.getElementById('smsContent');
    if (!content) return;

    if (conversations.length === 0) {
      content.innerHTML = '';
      content.appendChild(UI.emptyState(
        'No SMS messages yet',
        '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>',
        'Click "Sync SMS" to pull messages from the device. SMS access may require the app to be set as the default SMS app on some Android versions.'
      ));
      return;
    }

    content.innerHTML = `
      <div class="sms-layout">
        <div class="sms-conversation-list" id="smsConvList"></div>
        <div class="sms-thread" id="smsThread">
          <div class="sms-thread-header" id="smsThreadHeader">Select a conversation</div>
          <div class="sms-thread-messages" id="smsThreadMessages"></div>
        </div>
      </div>
    `;
    renderConversations();
    renderThread();
  }

  function renderConversations() {
    const list = document.getElementById('smsConvList');
    if (!list) return;

    let filtered = conversations;
    if (searchQuery) {
      filtered = conversations.filter(c =>
        (c.address || '').toLowerCase().includes(searchQuery) ||
        (c.contact_name || '').toLowerCase().includes(searchQuery) ||
        c.messages.some(m => (m.body || m.text || '').toLowerCase().includes(searchQuery))
      );
    }

    list.innerHTML = '';
    if (filtered.length === 0) {
      list.appendChild(UI.emptyState('No conversations', null, ''));
      return;
    }

    filtered.forEach(conv => {
      const item = document.createElement('div');
      item.className = 'sms-conversation-item' + (conv.address === activeThread ? ' active' : '');
      const name = conv.contact_name || conv.address;
      const preview = conv.last_message ? (conv.last_message.body || conv.last_message.text || '') : '';
      item.innerHTML = `
        <div class="sms-conversation-avatar">${name.charAt(0).toUpperCase()}</div>
        <div class="sms-conversation-info">
          <div class="sms-conversation-name">${UI.escapeHtml(name)}</div>
          <div class="sms-conversation-preview">${UI.escapeHtml(preview.substring(0, 60))}</div>
        </div>
        <div class="sms-conversation-time">${UI.formatDateString(conv.last_timestamp || conv.last_message?.timestamp)}</div>
      `;
      item.addEventListener('click', () => {
        activeThread = conv.address;
        document.querySelectorAll('.sms-conversation-item').forEach(el => el.classList.remove('active'));
        item.classList.add('active');
        renderThread();
      });
      list.appendChild(item);
    });
  }

  function renderThread() {
    const header = document.getElementById('smsThreadHeader');
    const messagesEl = document.getElementById('smsThreadMessages');
    if (!header || !messagesEl) return;

    const conv = conversations.find(c => c.address === activeThread);
    if (!conv) {
      header.textContent = 'Select a conversation';
      messagesEl.innerHTML = '';
      return;
    }

    header.textContent = conv.contact_name || conv.address;
    const sorted = [...conv.messages].sort((a, b) =>
      new Date(a.timestamp || a.date || a.created_at) - new Date(b.timestamp || b.date || b.created_at)
    );

    messagesEl.innerHTML = '';
    sorted.forEach(msg => {
      const isSent = msg.type === 'sent' || msg.direction === 'outgoing' || msg.type === '2';
      const bubble = document.createElement('div');
      bubble.className = 'sms-message ' + (isSent ? 'sent' : 'received');
      bubble.innerHTML = `
        <div>${UI.escapeHtml(msg.body || msg.text || '')}</div>
        <div class="sms-message-time">${UI.formatDateString(msg.timestamp || msg.date || msg.created_at)}</div>
      `;
      messagesEl.appendChild(bubble);
    });
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  const module = { init, refresh: loadSMS };
  App.registerPage('sms', module);
})();
