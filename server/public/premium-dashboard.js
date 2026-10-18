/* Monitory premium dashboard enhancement layer. Uses only existing confirmed endpoints. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const token = () => localStorage.getItem('token') || localStorage.getItem('mdm_jwt_token') || '';
  const headers = () => ({ Authorization: 'Bearer ' + token() });
  const state = { devices: [], events: [], calls: [], recordings: [], notifications: [], locations: [], commands: [], socket: 'Synchronizing', api: 'Checking', startedAt: Date.now(), map: null, mapLayer: null };
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const time = (v) => { if (!v) return '—'; const d = new Date(v); return Number.isNaN(d.getTime()) ? esc(v) : d.toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}); };
  const ago = (v) => { if (!v) return 'Not reported'; const n = Date.now() - new Date(v).getTime(); if (!Number.isFinite(n) || n < 0) return time(v); if (n < 60000) return 'Just now'; if (n < 3600000) return Math.floor(n/60000)+'m ago'; if (n < 86400000) return Math.floor(n/3600000)+'h ago'; return Math.floor(n/86400000)+'d ago'; };
  const deviceName = (d) => d && (d.device_name || d.name || d.model || d.id) || 'Unknown device';
  const deviceById = (id) => state.devices.find(d => String(d.id) === String(id));
  const deviceAllowed = (d, kind) => {
    if (!d || !d.permissions) return false;
    const p = d.permissions;
    const keys = ({calls:['call_log','call_logs','READ_CALL_LOG','callLog'], recordings:['record_audio','microphone','RECORD_AUDIO','audio_recording'], notifications:['notification_listener','notifications','notification_access'], locations:['location','fine_location','ACCESS_FINE_LOCATION','location_permission']})[kind] || [];
    return keys.some(k => p[k] === true || p[k] === 'granted' || p[k] === 'GRANTED');
  };
  async function api(path, options={}) {
    const r = await fetch(path, { ...options, headers: { ...headers(), ...(options.headers || {}) } });
    if (r.status === 401) { state.api='Session expired'; updateHealth(); throw new Error('Your session has expired. Sign in again.'); }
    if (!r.ok) throw new Error('Request failed ('+r.status+')');
    if (r.status === 204) return null;
    return r.json();
  }
  function emptyRow(cols, title, detail='') { return '<tr><td colspan="'+cols+'" class="text-center">'+esc(title)+(detail?'<br><small>'+esc(detail)+'</small>':'')+'</td></tr>'; }
  function chip(status) {
    const s=String(status||'unknown').toLowerCase();
    const cls=/online|complete|success|granted|available|acknowledged/.test(s)?'success':/fail|error|denied|critical/.test(s)?'danger':/pending|queue|upload|stale|review|unknown/.test(s)?'warning':'';
    return '<span class="status-chip '+cls+'"><i class="state-dot"></i>'+esc(String(status||'Unavailable').replace(/_/g,' '))+'</span>';
  }
  function updateHealth() {
    const el=$('stat-server-health'), note=$('stat-server-health-note'), apiEl=$('premium-settings-api-status'), wsEl=$('premium-settings-ws-status');
    if(el) el.textContent=state.api==='Healthy' && state.socket==='Connected'?'Operational':state.api==='Healthy'?'API reachable':'Unavailable';
    if(note) note.textContent=state.api==='Healthy' ? (state.socket==='Connected'?'API and dashboard stream connected':'API reachable; live stream '+state.socket.toLowerCase()) : state.api;
    if(apiEl) apiEl.textContent=state.api;
    if(wsEl) wsEl.textContent=state.socket;
    const chipEl=$('premium-live-state'); if(chipEl){chipEl.className='status-chip '+(state.socket==='Connected'?'success':state.socket==='Disconnected'?'danger':'warning');chipEl.innerHTML='<i class="state-dot"></i>'+esc(state.socket);}
    const top=$('ws-status-text'); if(top) top.textContent=state.socket;
  }
  function addEvent(type,title,detail,deviceId,stamp=Date.now()) {
    state.events.unshift({type,title,detail,deviceId,stamp}); state.events=state.events.slice(0,150);
    const n=$('stat-recent-events'); if(n) n.textContent=String(state.events.length);
    renderEvents(); renderChart();
  }
  function categoryFor(type) {
    const t=String(type||'').toLowerCase();
    if(t.includes('location')) return 'location';
    if(t.includes('notif')) return 'notifications';
    if(t.includes('command')) return 'commands';
    if(t.includes('record')) return 'recordings';
    if(t.includes('alert')||t.includes('error')||t.includes('fail')) return 'alerts';
    if(t.includes('enroll')||t.includes('pair')) return 'enrollment';
    return 'status';
  }
  function renderEvents() {
    const target=$('premium-live-activity-list'), overview=$('overview-activity-list');
    const search=(($('premium-live-search')||{}).value||'').toLowerCase(), cat=(($('premium-live-category')||{}).value||'all');
    const filtered=state.events.filter(e=>(cat==='all'||categoryFor(e.type)===cat)&&(!search||(e.title+' '+e.detail+' '+deviceName(deviceById(e.deviceId))).toLowerCase().includes(search)));
    const markup=filtered.map(e=>'<div class="activity-row"><span class="activity-marker">'+(categoryFor(e.type)==='location'?'⌖':categoryFor(e.type)==='commands'?'↗':categoryFor(e.type)==='notifications'?'◉':'◇')+'</span><div class="activity-body"><b>'+esc(e.title)+'</b><p>'+esc(e.detail)+' · '+esc(deviceName(deviceById(e.deviceId)))+'</p></div><time class="activity-time">'+esc(ago(e.stamp))+'</time></div>').join('');
    if(target) target.innerHTML=markup||'<div class="empty-state"><span class="empty-symbol">↗</span><b>No matching events</b><p>Verified WebSocket events received in this session will appear here.</p></div>';
    if(overview) overview.innerHTML=state.events.slice(0,5).map(e=>'<div class="activity-row"><span class="activity-marker">◇</span><div class="activity-body"><b>'+esc(e.title)+'</b><p>'+esc(e.detail)+' · '+esc(deviceName(deviceById(e.deviceId)))+'</p></div><time class="activity-time">'+esc(ago(e.stamp))+'</time></div>').join('')||'<div class="empty-state compact">No audit events observed in this session.</div>';
    const sum=$('premium-live-summary'); if(sum) sum.textContent=filtered.length+' session events · newest first';
  }
  function renderChart() {
    const svg=$('activity-chart-svg'), empty=$('activity-chart-empty'), cap=$('fleet-activity-caption');
    if(!svg) return;
    const points=state.events.filter(e=>/status|connect|disconnect|telemetry/i.test(e.type)).slice(0,20).reverse();
    const online=state.devices.filter(d=>String(d.status).toUpperCase()==='ONLINE').length, offline=Math.max(0,state.devices.length-online);
    if(cap) cap.textContent=state.devices.length ? state.devices.length+' current devices' : 'No device telemetry';
    if(empty) empty.style.display=points.length?'none':'block';
    svg.querySelectorAll('.series-line,.series-point').forEach(n=>n.remove());
    if(!points.length) return;
    const width=684, x0=18, y0=146, xStep=width/Math.max(points.length-1,1), max=Math.max(state.devices.length,1);
    const onlineY=y0-(online/max)*115, offlineY=y0-(offline/max)*115;
    const path=(y,offset)=>points.map((p,i)=>(i?'L':'M')+(x0+i*xStep)+' '+Math.max(20,Math.min(146,y+Math.sin(i*1.3+offset)*5))).join(' ');
    const ns='http://www.w3.org/2000/svg';
    [[path(onlineY,0),'#40d9a2'],[path(offlineY,2),'#7c8497']].forEach(([d,color])=>{const el=document.createElementNS(ns,'path');el.setAttribute('d',d);el.setAttribute('fill','none');el.setAttribute('stroke',color);el.setAttribute('stroke-width','2.5');el.setAttribute('stroke-linecap','round');el.setAttribute('class','series-line');svg.appendChild(el);});
    const start=$('activity-chart-start'), end=$('activity-chart-end'); if(start) start.textContent=time(points[0].stamp); if(end) end.textContent='Now';
  }
  function renderDevices() {
    const q=(($('premium-device-model-filter')||{}).value||'').toLowerCase(), status=(($('premium-device-status-filter')||{}).value||'all');
    const filtered=state.devices.filter(d=>(status==='all'||String(d.status).toUpperCase()===status)&&(!q||(deviceName(d)+' '+(d.model||'')+' '+d.id).toLowerCase().includes(q)));
    if(typeof renderDevicesGrid==='function') renderDevicesGrid(filtered);
    const total=$('stat-total-devices'), online=$('stat-online-devices'), off=$('stat-attention-devices'), badge=$('badge-device-count');
    if(total) total.textContent=state.devices.length; if(online) online.textContent=state.devices.filter(d=>String(d.status).toUpperCase()==='ONLINE').length;
    if(off) off.textContent=state.devices.filter(d=>String(d.status).toUpperCase()!=='ONLINE').length; if(badge) badge.textContent=state.devices.length;
    const list=$('overview-devices-list')||$('overview-devices');
    if(list) list.innerHTML=state.devices.slice(0,5).map(d=>'<div class="activity-row"><span class="activity-marker">▯</span><div class="activity-body"><b>'+esc(deviceName(d))+'</b><p>'+esc(d.model||'Model unavailable')+' · Android '+esc(d.android_version||d.androidVersion||'—')+' · '+esc(d.status||'Unknown')+'</p></div><time class="activity-time">'+esc(ago(d.last_seen||d.lastSeen||d.updated_at))+'</time></div>').join('')||'<div class="empty-state compact">No devices enrolled yet.</div>';
    const selectors=['premium-calls-device-filter','premium-recordings-device-filter','premium-notifications-device-filter','premium-locations-device-filter','premium-command-device','premium-collection-device-filter'];
    selectors.forEach(id=>{const el=$(id);if(!el)return;const prev=el.value;el.innerHTML=(id==='premium-command-device'?'<option value="">Select an enrolled device</option>':id==='premium-collection-device-filter'?'<option value="">Select a device for manual sync</option>':'<option value="all">All permitted devices</option>')+state.devices.map(d=>'<option value="'+esc(d.id)+'">'+esc(deviceName(d))+'</option>').join('');if([...el.options].some(o=>o.value===prev))el.value=prev;});
    const hint=$('premium-command-permission-hint'); if(hint){const d=deviceById(($('premium-command-device')||{}).value);hint.textContent=d?'Reported permissions are checked by the Android agent; unknown permissions remain unverified.':'Choose a device to see its current permission state.';}
    renderChart();
  }
  async function loadDevices() {
    try { const data=await api('/api/devices'); state.devices=Array.isArray(data)?data:[]; renderDevices(); }
    catch(e){ if($('stat-total-devices')) $('stat-total-devices').textContent='—'; console.warn('Monitory devices unavailable:',e.message); }
  }
  async function perDevice(kind, endpoint) {
    const result=[];
    for(const d of state.devices) {
      if(!deviceAllowed(d,kind)) continue;
      try { const rows=await api('/api/devices/'+encodeURIComponent(d.id)+'/'+endpoint); if(Array.isArray(rows)) rows.forEach(row=>result.push({...row,_deviceId:d.id})); }
      catch(e){ console.warn('Could not load '+endpoint+' for '+deviceName(d)+':',e.message); }
    }
    return result;
  }
  async function loadCalls() {
    const tbody=$('premium-calls-table-body'); if(tbody) tbody.innerHTML=emptyRow(6,'Loading authorized call records…');
    state.calls=await perDevice('calls','calls');
    renderCalls();
  }
  function renderCalls() {
    const q=(($('premium-calls-search')||{}).value||'').toLowerCase(), dev=(($('premium-calls-device-filter')||{}).value||'all'), dir=(($('premium-calls-direction-filter')||{}).value||'all');
    const rows=state.calls.filter(c=>(dev==='all'||String(c._deviceId)===dev)&&(dir==='all'||String(c.type||c.direction).toUpperCase()===dir)&&(!q||String(c.number||c.phone_number||c.contact_name||'').toLowerCase().includes(q)));
    const body=$('premium-calls-table-body'); if(body) body.innerHTML=rows.map(c=>'<tr><td><b>'+esc(c.contact_name||c.name||c.number||'Unknown contact')+'</b><br><small>'+esc(c.number||c.phone_number||'Number unavailable')+'</small></td><td>'+esc(deviceName(deviceById(c._deviceId)))+'</td><td>'+chip(c.type||c.direction)+'</td><td>'+esc(time(c.call_date||c.timestamp||c.created_at))+'</td><td>'+esc(c.duration==null?'—':Math.floor(c.duration/60)+'m '+(c.duration%60)+'s')+'</td><td>'+chip(c.recording_id||c.recordingId?'Match available':'No verified match')+'</td></tr>').join('')||emptyRow(6,'No permitted call records available','Confirm call-log permission on an enrolled device, then refresh.');
    const sum=$('premium-calls-summary');if(sum)sum.textContent=rows.length+' permitted records';
  }
  async function loadRecordings() {
    const target=$('premium-recordings-list');if(target)target.innerHTML='<div class="empty-state">Loading permitted recording metadata…</div>';
    state.recordings=await perDevice('recordings','recordings'); renderRecordings();
  }
  function renderRecordings() {
    const q=(($('premium-recordings-search')||{}).value||'').toLowerCase(), dev=(($('premium-recordings-device-filter')||{}).value||'all');
    const rows=state.recordings.filter(r=>(dev==='all'||String(r._deviceId)===dev)&&String(r.file_name||r.filename||'').toLowerCase().includes(q));
    const target=$('premium-recordings-list'); if(target) target.innerHTML=rows.map((r,i)=>'<div class="recording-row" data-recording-index="'+i+'"><span class="recording-file-icon">♫</span><div class="recording-row-main"><b>'+esc(r.file_name||r.filename||'Recording metadata')+'</b><small>'+esc(deviceName(deviceById(r._deviceId)))+' · '+esc(time(r.created_at||r.uploaded_at))+'</small></div>'+chip(r.upload_status||'Metadata only')+'</div>').join('')||'<div class="empty-state"><span class="empty-symbol">▷</span><b>No authorized recordings found</b><p>Only devices reporting recording permission are queried. No audio files are linked without a protected playback endpoint.</p></div>';
    const sum=$('premium-recordings-summary');if(sum)sum.textContent=rows.length+' permitted metadata records';
    target&&target.querySelectorAll('[data-recording-index]').forEach((el)=>el.addEventListener('click',()=>{const r=rows[Number(el.dataset.recordingIndex)];$('premium-player-title').textContent=r.file_name||r.filename||'Recording metadata';$('premium-player-meta').textContent=deviceName(deviceById(r._deviceId))+' · '+time(r.created_at||r.uploaded_at);$('premium-player-status').textContent='Protected streaming endpoint unavailable';}));
  }
  async function loadNotifications() {
    const target=$('premium-notifications-table-body');if(target)target.innerHTML=emptyRow(5,'Loading permitted notifications…');
    state.notifications=await perDevice('notifications','notifications');renderNotifications();
  }
  function renderNotifications() {
    const q=(($('premium-notifications-search')||{}).value||'').toLowerCase(), dev=(($('premium-notifications-device-filter')||{}).value||'all');
    const rows=state.notifications.filter(n=>(dev==='all'||String(n._deviceId)===dev)&&String((n.title||'')+' '+(n.app_name||n.package_name||'')+' '+(n.text||n.content||'')).toLowerCase().includes(q));
    const body=$('premium-notifications-table-body');if(body)body.innerHTML=rows.map(n=>'<tr><td>'+esc(n.app_name||n.package_name||'Unknown app')+'</td><td><b>'+esc(n.title||'Notification')+'</b><br><small>'+esc(n.text||n.content||'Content unavailable')+'</small></td><td>'+esc(deviceName(deviceById(n._deviceId)))+'</td><td>'+esc(time(n.created_at||n.timestamp))+'</td><td>'+chip('Received')+'</td></tr>').join('')||emptyRow(5,'No permitted notifications found','Notification access must be reported by the enrolled device.');
    const sum=$('premium-notifications-summary');if(sum)sum.textContent=rows.length+' received records · read state not supplied by API';
  }
  async function loadLocations() {
    const target=$('premium-locations-table-body');if(target)target.innerHTML=emptyRow(5,'Loading authorized location records…');
    state.locations=await perDevice('locations','locations');renderLocations();
  }
  function renderLocations() {
    const q=(($('premium-locations-search')||{}).value||'').toLowerCase(),dev=(($('premium-locations-device-filter')||{}).value||'all');
    const rows=state.locations.filter(l=>(dev==='all'||String(l._deviceId)===dev)&&String(deviceName(deviceById(l._deviceId))+' '+(l.provider||'')).toLowerCase().includes(q));
    const body=$('premium-locations-table-body');if(body)body.innerHTML=rows.map(l=>'<tr><td>'+esc(deviceName(deviceById(l._deviceId)))+'</td><td>'+esc(time(l.timestamp||l.created_at||l.recorded_at))+'</td><td>'+esc(l.accuracy==null?'—':l.accuracy+' m')+'</td><td>'+esc(l.provider||'—')+'</td><td>'+esc(l.latitude==null||l.longitude==null?'Coordinates unavailable':Number(l.latitude).toFixed(5)+', '+Number(l.longitude).toFixed(5))+'</td></tr>').join('')||emptyRow(5,'No authorized location entries','The current location endpoint may be device-scoped; permission and fresh coordinates are required.');
    const sum=$('premium-locations-summary');if(sum)sum.textContent=rows.length+' location records';
    const points=rows.filter(l=>Number.isFinite(Number(l.latitude))&&Number.isFinite(Number(l.longitude)));
    const empty=$('premium-location-map-empty'), mapEl=$('premium-fleet-map');
    if(points.length&&window.L&&mapEl) {
      empty.hidden=true;mapEl.hidden=false;
      if(!state.map){state.map=L.map(mapEl,{scrollWheelZoom:false}).setView([Number(points[0].latitude),Number(points[0].longitude)],5);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'&copy; OpenStreetMap contributors',maxZoom:19}).addTo(state.map);state.mapLayer=L.layerGroup().addTo(state.map);}
      state.mapLayer.clearLayers();points.forEach(p=>L.marker([Number(p.latitude),Number(p.longitude)]).bindPopup(esc(deviceName(deviceById(p._deviceId)))+'<br>'+esc(time(p.timestamp||p.created_at))).addTo(state.mapLayer));state.map.fitBounds(points.map(p=>[Number(p.latitude),Number(p.longitude)]),{padding:[20,20],maxZoom:13});setTimeout(()=>state.map.invalidateSize(),80);
    } else if(empty){empty.hidden=false;if(mapEl)mapEl.hidden=true;}
  }
  async function loadCommands() {
    const body=$('premium-commands-table-body');if(body)body.innerHTML=emptyRow(5,'Loading command history…');
    const result=[];
    for(const d of state.devices){try{const rows=await api('/api/devices/'+encodeURIComponent(d.id)+'/commands');if(Array.isArray(rows))rows.forEach(r=>result.push({...r,_deviceId:d.id}));}catch(e){}}
    state.commands=result;const sorted=result.sort((a,b)=>new Date(b.created_at||b.requested_at||0)-new Date(a.created_at||a.requested_at||0));
    if(body)body.innerHTML=sorted.map(c=>'<tr><td>'+esc(time(c.created_at||c.requested_at))+'</td><td>'+esc(deviceName(deviceById(c._deviceId)))+'</td><td>'+esc(c.command_type||c.type||c.command||'Command')+'</td><td>'+chip(c.status)+'</td><td>'+esc(c.error_message||c.result||c.failure_reason||'—')+'</td></tr>').join('')||emptyRow(5,'No command records available');
    const sum=$('premium-commands-summary');if(sum)sum.textContent=result.length+' persisted commands';
    const pending=$('stat-pending-commands');if(pending)pending.textContent=result.filter(c=>/queued|pending|sent|executing/i.test(c.status||'')).length;
  }
  function renderCollection() {
    const body=$('premium-collection-table-body');if(!body)return;
    const rows=[];
    state.devices.forEach(d=>{const p=d.permissions;if(!p){rows.push({d,cat:'Permission state',perm:'Unknown'});return;}
      Object.entries(p).forEach(([k,v])=>rows.push({d,cat:k,perm:v===true?'Granted':v===false?'Denied':String(v)}));});
    body.innerHTML=rows.map(r=>'<tr><td>'+esc(deviceName(r.d))+'</td><td>'+esc(r.cat.replace(/_/g,' '))+'</td><td>'+chip(r.perm)+'</td><td>'+chip(r.d.status||'Unknown')+'</td><td>'+esc(ago(r.d.last_seen||r.d.lastSeen||r.d.updated_at))+'</td></tr>').join('')||emptyRow(5,'No enrolled devices','Enroll a device to see reported permission states.');
    const sum=$('premium-collection-summary');if(sum)sum.textContent=rows.length+' reported permission states · unknown is not granted';
  }
  function openView(view) {
    document.querySelectorAll('.view-content').forEach(el=>el.classList.remove('active'));
    const target=$('view-'+view);if(target)target.classList.add('active');
    document.querySelectorAll('.nav-item').forEach(el=>el.classList.toggle('active',el.dataset.view===view));
    const crumb=$('crumb-current-name');if(crumb)crumb.textContent=({calls:'Call History',locations:'Location History',commands:'Remote Commands',collection:'Data Collection','live-activity':'Live Activity'}[view]||view.charAt(0).toUpperCase()+view.slice(1));
    $('sidebar')?.classList.remove('open');
    if(view==='devices')renderDevices();
    if(view==='live-activity')renderEvents();
    if(view==='calls')loadCalls();
    if(view==='recordings')loadRecordings();
    if(view==='notifications')loadNotifications();
    if(view==='locations')loadLocations();
    if(view==='commands')loadCommands();
    if(view==='collection')renderCollection();
    if(view==='settings')updateHealth();
  }
  function confirmCommand(deviceId,type,note) {
    const d=deviceById(deviceId);if(!d){$('premium-command-feedback').textContent='Select a device first.';return;}
    if(String(d.status).toUpperCase()!=='ONLINE'){ $('premium-command-feedback').textContent='This device is not marked online. No request was sent.';return; }
    if(type==='REQUEST_LOCATION'&&!deviceAllowed(d,'locations')){ $('premium-command-feedback').textContent='Location permission is not confirmed for this device. No request was sent.';return; }
    const label=type.replace(/_/g,' ').toLowerCase();
    if(!window.confirm('Send “'+label+'” to '+deviceName(d)+'?'+(note?'\nReason: '+note:'')+'\n\nThe device may not acknowledge immediately.'))return;
    sendCommand(d.id,type,note);
  }
  async function sendCommand(deviceId,type,note) {
    const feedback=$('premium-command-feedback');feedback.textContent='Sending request…';
    try {
      const res=await fetch('/api/devices/'+encodeURIComponent(deviceId)+'/commands',{method:'POST',headers:{...headers(),'Content-Type':'application/json'},body:JSON.stringify({command_type:type,parameters:note?{note}: {}})});
      const payload=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(payload.message||payload.error||'Request rejected ('+res.status+')');
      feedback.textContent='Request accepted by the API. Awaiting device acknowledgement; status is not assumed complete.';
      addEvent('COMMAND_REQUESTED','Command requested',type.replace(/_/g,' '),deviceId);
      await loadCommands();
    } catch(e){feedback.textContent='Request failed: '+e.message;}
  }
  function wire() {
    document.addEventListener('click',e=>{
      const a=e.target.closest('[data-view]');if(a){const view=a.dataset.view;if($('view-'+view)){e.preventDefault();e.stopImmediatePropagation();openView(view);}}
      if(e.target.closest('#btn-pair-modal-sidebar')){e.preventDefault();$('btn-pair-device')?.click();}
      if(e.target.closest('#btn-server-config-sidebar')||e.target.closest('#premium-open-server-config')){e.preventDefault();$('btn-server-config')?.click();}
    },true);
    ['premium-device-model-filter','premium-device-status-filter','premium-device-enrollment-filter'].forEach(id=>$(id)?.addEventListener('input',renderDevices));
    ['premium-live-search','premium-live-category'].forEach(id=>$(id)?.addEventListener('input',renderEvents));
    ['premium-calls-search','premium-calls-device-filter','premium-calls-direction-filter'].forEach(id=>$(id)?.addEventListener('input',renderCalls));
    ['premium-recordings-search','premium-recordings-device-filter'].forEach(id=>$(id)?.addEventListener('input',renderRecordings));
    ['premium-notifications-search','premium-notifications-device-filter'].forEach(id=>$(id)?.addEventListener('input',renderNotifications));
    ['premium-locations-search','premium-locations-device-filter'].forEach(id=>$(id)?.addEventListener('input',renderLocations));
    $('premium-live-clear')?.addEventListener('click',()=>{state.events=[];renderEvents();renderChart();});
    $('premium-calls-refresh')?.addEventListener('click',loadCalls);$('premium-recordings-refresh')?.addEventListener('click',loadRecordings);
    $('premium-notifications-refresh')?.addEventListener('click',loadNotifications);$('premium-locations-refresh')?.addEventListener('click',loadLocations);
    $('premium-commands-refresh')?.addEventListener('click',loadCommands);$('premium-collection-refresh')?.addEventListener('click',async()=>{await loadDevices();renderCollection();});
    $('premium-settings-health-refresh')?.addEventListener('click',checkHealth);
    $('premium-settings-theme')?.addEventListener('click',()=>{document.body.classList.toggle('light-theme');localStorage.setItem('monitory-theme',document.body.classList.contains('light-theme')?'light':'dark');});
    $('premium-settings-logout')?.addEventListener('click',()=>{if($('logout-btn'))$('logout-btn').click();else if(window.confirm('Sign out of this workspace?')){localStorage.removeItem('token');localStorage.removeItem('mdm_jwt_token');location.reload();}});
    $('premium-command-device')?.addEventListener('change',()=>{const d=deviceById($('premium-command-device').value);$('premium-command-permission-hint').textContent=d?'Reported permissions are checked by the Android agent; unknown permissions remain unverified.':'Choose a device to see its current permission state.';});
    $('premium-command-form')?.addEventListener('submit',e=>{e.preventDefault();confirmCommand($('premium-command-device').value,$('premium-command-type').value,$('premium-command-note').value.trim());});
    $('premium-collection-sync')?.addEventListener('click',()=>confirmCommand($('premium-collection-device-filter').value,'SYNC_DEVICE','Manual sync from Data Collection'));
    $('premium-open-alerts')?.addEventListener('click',()=>openView('alerts'));
    $('premium-audio-player')?.addEventListener('error',()=>{$('premium-player-status').textContent='Playback failed. Protected media streaming is not configured.';});
    if(localStorage.getItem('monitory-theme')==='light')document.body.classList.add('light-theme');
    if($('premium-player-play'))$('premium-player-play').title='Playback disabled until a protected streaming endpoint is available';
  }
  async function checkHealth() {
    state.api='Unavailable';
    try { const r=await fetch('/api/auth/me',{headers:headers()}); if(r.status===401)state.api='Session expired';else if(r.ok)state.api='Healthy';else state.api='API error ('+r.status+')'; }
    catch(e){state.api='Unavailable';}
    updateHealth();
  }
  function onWsEvent(event) {
    const msg=event.detail||event;
    const type=msg.type||'DEVICE_EVENT', id=msg.deviceId||msg.device_id;
    const title=({DEVICE_STATUS_CHANGED:'Device status changed',DEVICE_TELEMETRY_UPDATED:'Device telemetry updated',DEVICE_LOCATION_UPDATED:'Location update received',COMMAND_STATUS_CHANGED:'Command status updated',NEW_NOTIFICATION:'Notification received',RECORDING_UPLOADED:'Recording uploaded',DEVICE_CONNECTED:'Device connected',DEVICE_DISCONNECTED:'Device disconnected'})[type]||type.replace(/_/g,' ').toLowerCase().replace(/^./c=>c.toUpperCase());
    const detail=msg.status?'Status: '+msg.status:msg.commandType||msg.command_type||msg.description||'Event received from the dashboard stream';
    addEvent(type,title,detail,id);
    if(type==='DEVICE_STATUS_CHANGED'||type==='DEVICE_TELEMETRY_UPDATED')loadDevices();
    if(/COMMAND/.test(type))loadCommands();
  }
  function hookWebSocket() {
    const existing=window.ws;
    if(existing && typeof existing.addEventListener==='function') {
      existing.addEventListener('open',()=>{state.socket='Connected';updateHealth();});
      existing.addEventListener('close',()=>{state.socket='Disconnected';updateHealth();});
      existing.addEventListener('error',()=>{state.socket='Disconnected';updateHealth();});
      existing.addEventListener('message',e=>{try{onWsEvent(JSON.parse(e.data));}catch(_){}});
      if(existing.readyState===1){state.socket='Connected';updateHealth();}
    }
    // app.js owns the actual socket lifecycle; observe its visible status and never infer it from API health.
    const top=$('ws-status-text');
    if(top && window.MutationObserver) new MutationObserver(()=>{const t=top.textContent||'';state.socket=/live|synced|connected/i.test(t)?'Connected':/reconnect/i.test(t)?'Reconnecting':'Disconnected';updateHealth();}).observe(top,{childList:true,subtree:true,characterData:true});
  }
  document.addEventListener('DOMContentLoaded',()=>{
    wire();updateHealth();
    if(token()) { checkHealth();loadDevices().then(()=>{renderCollection();renderChart();}); }
    hookWebSocket();
    window.addEventListener('online',()=>{state.socket='Synchronizing';updateHealth();checkHealth();});
    window.addEventListener('offline',()=>{state.api='Unavailable';state.socket='Disconnected';updateHealth();});
    setInterval(()=>{const el=$('premium-live-summary');if(el&&state.events.length)el.textContent=state.events.length+' session events · latest '+ago(state.events[0].stamp);},15000);
  });
})();