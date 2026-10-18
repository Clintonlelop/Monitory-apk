// XSS regression: plant the original audit PoC filename, then verify in real
// Chromium that (a) no inline event-handler is generated, (b) hovering/interacting
// with the Preview button does not execute attacker JS, (c) ordinary files render.
import { chromium } from 'playwright-core';
import sparticuz from '@sparticuz/chromium';
import { spawn } from 'child_process';

const PORT = 3311;
const base = `http://127.0.0.1:${PORT}`;

const server = spawn(process.execPath, ['server/src/index.js'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    NODE_ENV: 'test',
    JWT_SECRET: 'xss-regression-secret-123456789',
    DATABASE_URL: '',
    PGHOST: ''
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

function waitForServer() {
  return new Promise((resolve, reject) => {
    let out = '';
    server.stdout.on('data', (d) => {
      out += d;
      if (out.includes('running on')) resolve();
    });
    server.stderr.on('data', (d) => { out += d; if (out.includes('running on')) resolve(); });
    server.on('exit', (code) => reject(new Error('server died: ' + code + '\n' + out)));
    setTimeout(() => reject(new Error('server start timeout\n' + out)), 15000);
  });
}

async function api(method, route, { token, body } = {}) {
  const res = await fetch(base + route, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

await waitForServer();
console.log('[1] server up');

const boot = await api('POST', '/api/auth/bootstrap', {
  body: { username: 'xss_admin', email: 'xss_admin@test.local', password: 'XssAdmin123!' }
});
if (boot.status !== 200) throw new Error('bootstrap failed: ' + JSON.stringify(boot));
const adminToken = boot.data.token;
console.log('[2] admin bootstrapped');

const dev = await api('POST', '/api/devices/register-device', {
  token: adminToken,
  body: { deviceName: 'XSS Probe', deviceId: 'dev_xss_poc' }
});
const deviceId = dev.data.deviceId;
const deviceToken = dev.data.token;

// Plant BOTH original PoC payloads (attribute-breakout + tag injection) + an ordinary file
const payloadName = 'a" onmouseover=window.__xss=1 x="';
const tagPayload = '<img src=x onerror=window.__xss=1>';
const files = await api('POST', `/api/devices/${deviceId}/files`, {
  token: deviceToken,
  body: [
    { fileName: payloadName, filePath: '/storage/emulated/0/safe1.jpg', fileSize: 1234, mimeType: 'image/jpeg', isDirectory: false },
    { fileName: tagPayload, filePath: '/storage/emulated/0/safe2.jpg', fileSize: 1234, mimeType: 'image/jpeg', isDirectory: false },
    { fileName: 'ordinary-photo.jpg', filePath: '/storage/emulated/0/ordinary-photo.jpg', fileSize: 1234, mimeType: 'image/jpeg', isDirectory: false }
  ]
});
if (files.status !== 200) throw new Error('files ingest failed');
console.log('[3] payloads planted (now requires device auth):', files.status);

const executablePath = await sparticuz.executablePath();
const browser = await chromium.launch({
  executablePath,
  args: sparticuz.args,
  headless: true
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

// Login through the real UI
await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
await page.fill('#login-email', 'xss_admin@test.local');
await page.fill('#login-password', 'XssAdmin123!');
await page.click('#btn-login-submit');
await page.waitForTimeout(2500);
console.log('[4] logged in');

// Open the device detail and Files tab
await page.evaluate(() => window.openDeviceDetail && window.openDeviceDetail('dev_xss_poc'));
await page.waitForTimeout(1500);
// Click the File Explorer / Files tab
const tabClicked = await page.evaluate(() => {
  const tabs = [...document.querySelectorAll('button, a, .tab-btn, [data-tab]')];
  const t = tabs.find(el => /file/i.test(el.textContent || '') && /explor|files/i.test(el.textContent || ''));
  if (t) { t.click(); return t.textContent.trim().slice(0, 40); }
  return null;
});
console.log('[5] files tab clicked:', tabClicked);
await page.waitForTimeout(1500);

// Inspect DOM: the payload must NOT appear inside any inline event attribute
const domCheck = await page.evaluate(() => {
  const offenders = [];
  document.querySelectorAll('*').forEach(el => {
    for (const attr of el.attributes) {
      if (/^on/i.test(attr.name) && /__xss|onmouseover|onerror/i.test(attr.value)) {
        offenders.push(`${el.tagName}[${attr.name}]=${attr.value.slice(0, 120)}`);
      }
    }
    if (el.tagName === 'SCRIPT' && /__xss/.test(el.textContent || '')) {
      offenders.push('inline SCRIPT with __xss');
    }
  });
  const btns = [...document.querySelectorAll('button')].map(b => ({
    text: b.textContent.trim().slice(0, 30),
    hasOnmouse: b.hasAttribute('onmouseover') || b.hasAttribute('onerror') || b.hasAttribute('onclick'),
    actions: b.dataset ? b.dataset.action || '' : ''
  }));
  return { offenders, btns: btns.filter(b => /preview/i.test(b.text)), htmlHasPayload: document.body.innerHTML.includes('onmouseover=window.__xss'), ordinaryVisible: document.body.innerHTML.includes('ordinary-photo.jpg') };
});

console.log('[6] DOM check:', JSON.stringify(domCheck, null, 2));

// Hover + activate ONLY the preview surfaces of every file row (the real XSS
// vectors in the audit PoC) — payload must never run.
const previews = await page.$$('button[data-action="preview-file"], .stat-card[data-action="preview-file"]');
for (const el of previews) {
  try { await el.hover({ timeout: 300 }); } catch (_) {}
  try { await el.dispatchEvent('mouseover'); } catch (_) {}
  try { await el.click({ timeout: 300 }); } catch (_) {}
  await page.waitForTimeout(150);
  await page.keyboard.press('Escape').catch(() => {});
  const closeBtn = await page.$('#media-lightbox .icon, #media-lightbox button');
  if (closeBtn) { try { await closeBtn.click({ timeout: 200 }); } catch (_) {} }
}
await page.waitForTimeout(500);

const xssRan = await page.evaluate(() => window.__xss);
const ordinaryVisible = domCheck.ordinaryVisible;

console.log('[7] window.__xss =', xssRan, '| ordinary file rendered:', ordinaryVisible);

const pass = domCheck.offenders.length === 0 && !xssRan && ordinaryVisible;
console.log(pass ? 'XSS_REGRESSION_PASS' : 'XSS_REGRESSION_FAIL');

await browser.close();
server.kill('SIGKILL');
process.exit(pass ? 0 : 1);
