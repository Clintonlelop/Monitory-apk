/**
 * pages/recordings.js — Screen recordings page
 * Start/stop recording, recording list, video player, download
 */
(function () {
  'use strict';

  let recordings = [];
  let isRecording = false;
  let recordingStartTime = null;
  let recordingTimer = null;

  async function init(container) {
    const deviceId = App.currentDeviceId;
    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Recordings</h1>
          <p class="page-subtitle">Screen recording management and playback</p>
        </div>
      </div>
      <div class="card" style="margin-bottom: 16px;">
        <div class="card-header"><div class="card-title">Recording Controls</div></div>
        <div class="card-body">
          <div class="recording-controls">
            <div class="recording-status-indicator">
              <div class="recording-dot" id="recordingDot"></div>
              <div>
                <div style="font-size: 13px; font-weight: 600;" id="recordingStatusText">Not Recording</div>
                <div class="recording-timer" id="recordingTimer">00:00</div>
              </div>
            </div>
            <div style="flex: 1;"></div>
            <button class="btn btn-danger" id="btnStartRecording" style="padding: 10px 24px;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="8"></circle></svg>
              Start Recording
            </button>
            <button class="btn btn-secondary" id="btnStopRecording" style="padding: 10px 24px; display: none;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg>
              Stop Recording
            </button>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-header">
          <div class="card-title">Recordings</div>
          <span class="text-muted" style="font-size: 12px;" id="recordingsCount"></span>
        </div>
        <div class="card-body no-padding">
          <div id="recordingsList">
            <div class="loading-container"><div class="loading-spinner"></div><span>Loading recordings…</span></div>
          </div>
        </div>
      </div>
    `;

    if (!deviceId) {
      document.getElementById('recordingsList').innerHTML = '';
      document.getElementById('recordingsList').appendChild(
        UI.emptyState('No device selected', null, 'Select a device to manage recordings.')
      );
      return;
    }

    document.getElementById('btnStartRecording').addEventListener('click', startRecording);
    document.getElementById('btnStopRecording').addEventListener('click', stopRecording);

    await loadRecordings();

    // WebSocket events
    App.subscribeWS('SCREEN_RECORDING_STARTED', (data) => {
      isRecording = true;
      recordingStartTime = Date.now();
      updateRecordingUI();
      UI.showToast('Screen recording started', 'info');
    });
    App.subscribeWS('SCREEN_RECORDING_COMPLETED', (data) => {
      isRecording = false;
      stopTimer();
      updateRecordingUI();
      loadRecordings();
      UI.showToast('Screen recording completed', 'success');
    });
  }

  async function startRecording() {
    const deviceId = App.currentDeviceId;
    if (!deviceId) return;
    try {
      await API.commands.create(deviceId, 'START_SCREEN_RECORDING', {});
      UI.showToast('Start recording command sent', 'info');
    } catch (err) {
      UI.showToast('Failed to start recording: ' + err.message, 'error');
    }
  }

  async function stopRecording() {
    const deviceId = App.currentDeviceId;
    if (!deviceId) return;
    try {
      await API.commands.create(deviceId, 'STOP_SCREEN_RECORDING', {});
      UI.showToast('Stop recording command sent', 'info');
    } catch (err) {
      UI.showToast('Failed to stop recording: ' + err.message, 'error');
    }
  }

  function updateRecordingUI() {
    const dot = document.getElementById('recordingDot');
    const statusText = document.getElementById('recordingStatusText');
    const startBtn = document.getElementById('btnStartRecording');
    const stopBtn = document.getElementById('btnStopRecording');
    if (!dot || !statusText || !startBtn || !stopBtn) return;

    if (isRecording) {
      dot.classList.add('active');
      statusText.textContent = 'Recording…';
      startBtn.style.display = 'none';
      stopBtn.style.display = 'inline-flex';
      startTimer();
    } else {
      dot.classList.remove('active');
      statusText.textContent = 'Not Recording';
      startBtn.style.display = 'inline-flex';
      stopBtn.style.display = 'none';
      stopTimer();
    }
  }

  function startTimer() {
    stopTimer();
    recordingTimer = setInterval(() => {
      if (!recordingStartTime) return;
      const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
      const timerEl = document.getElementById('recordingTimer');
      if (timerEl) timerEl.textContent = UI.formatDuration(elapsed);
    }, 1000);
  }

  function stopTimer() {
    if (recordingTimer) {
      clearInterval(recordingTimer);
      recordingTimer = null;
    }
  }

  async function loadRecordings() {
    const deviceId = App.currentDeviceId;
    const listEl = document.getElementById('recordingsList');
    const countEl = document.getElementById('recordingsCount');
    if (!listEl || !deviceId) return;
    try {
      const res = await API.recordings.list({ device_id: deviceId, limit: 100 });
      recordings = res.data || res || [];
      if (countEl) countEl.textContent = recordings.length + ' recordings';

      if (recordings.length === 0) {
        listEl.innerHTML = '';
        listEl.appendChild(UI.emptyState(
          'No recordings yet',
          '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>',
          'Click "Start Recording" to begin a screen recording. Requires Screen Capture permission via MediaProjection consent.'
        ));
        return;
      }

      const headers = [
        { label: 'Filename', key: 'filename' },
        { label: 'Duration', key: 'duration' },
        { label: 'Size', key: 'size' },
        { label: 'Status', key: 'status' },
        { label: 'Date', key: 'date' },
        { label: 'Actions', key: 'actions', sortable: false }
      ];
      const rows = recordings.map(r => {
        const actions = document.createElement('div');
        actions.style.display = 'flex';
        actions.style.gap = '6px';

        const playBtn = document.createElement('button');
        playBtn.className = 'btn btn-secondary btn-sm btn-icon';
        playBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
        playBtn.title = 'Play';
        playBtn.addEventListener('click', () => playRecording(r));
        actions.appendChild(playBtn);

        const downloadBtn = document.createElement('a');
        downloadBtn.className = 'btn btn-secondary btn-sm btn-icon';
        downloadBtn.href = r.download_url || API.recordings.download(r.id);
        downloadBtn.download = r.filename || 'recording.mp4';
        downloadBtn.title = 'Download';
        downloadBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>';
        actions.appendChild(downloadBtn);

        return {
          filename: r.filename || r.name || 'recording.mp4',
          duration: r.duration != null ? UI.formatDuration(r.duration) : '—',
          size: r.size != null ? UI.formatBytes(r.size) : '—',
          status: UI.createStatusBadge(r.status || 'COMPLETED'),
          date: UI.formatDateString(r.created_at || r.timestamp || r.date),
          actions
        };
      });

      listEl.innerHTML = '';
      const wrapper = document.createElement('div');
      wrapper.style.overflowX = 'auto';
      wrapper.appendChild(UI.createTable(headers, rows));
      listEl.appendChild(wrapper);
    } catch (err) {
      listEl.innerHTML = '';
      listEl.appendChild(UI.emptyState('Failed to load recordings', null, err.message));
    }
  }

  function playRecording(recording) {
    const url = recording.playback_url || recording.url || API.recordings.download(recording.id);
    const overlay = document.createElement('div');
    overlay.className = 'lightbox';
    overlay.innerHTML = `
      <button class="lightbox-close">&times;</button>
      <div class="lightbox-content">
        <video controls autoplay style="max-width: 80vw; max-height: 75vh; border-radius: 8px;">
          <source src="${url}" type="${recording.mime_type || 'video/mp4'}">
          Your browser does not support video playback.
        </video>
        <div class="lightbox-caption">${UI.escapeHtml(recording.filename || recording.name || '')}</div>
      </div>
    `;
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.classList.contains('lightbox-close')) overlay.remove();
    });
    document.body.appendChild(overlay);
  }

  const module = { init, refresh: loadRecordings };
  App.registerPage('recordings', module);
})();
