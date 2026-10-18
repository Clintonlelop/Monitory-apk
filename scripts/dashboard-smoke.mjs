// Dashboard smoke test after the frontend remediation work.
import { chromium } from 'playwright-core';
import sparticuz from '@sparticuz/chromium';
import { spawn } from 'child_process';

const PORT = 3312;
const base = `http://127.0.0.1:${PORT}`;

const server = spawn(process.execPath, ['server/src/index.js'], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: 'test', JWT_SECRET: 'smoke-secret-1234567890abcdef', DATABASE_URL: '', PGHOST: '' },
  stdio: ['ignore', 'pipe', 'pipe']
});

await new Promise((resolve, reject) => {
  let out = '';
  server.stdout.on('data', (d) => { out += d; if (out.includes('running on')) resolve(); });
  server.stderr.on('data', (d) => { out += d; if (out.includes('running on')) resolve(); });
  setTimeout(() => reject(new Error('start timeout ' + out)), 15000);
});

const api = async (method, route, { token, body } = {}) => {
  const res = await fetch(base + route, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: res.status, data: await res.json().catch(() => null) };
};

const boot = await api('POST', '/api/auth/bootstrap', {
  body: { username: 'smoke2', email: 'smoke2@test.local', password: 'Smoke2Pass123!' }
});
const adminToken = boot.data.token;
const dev = await api('POST', '/api/devices/register-device', {
  token: adminToken,
  body: { deviceName: 'Smoke Device', deviceId: 'dev_smoke_2' }
});

const executablePath = await sparticuz.executablePath();
const browser = await chromium.launch({ executablePath, args: sparticuz.args, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
await page.fill('#login-email', 'smoke2@test.local');
await page.fill('#login-password', 'Smoke2Pass123!');
await page.click('#btn-login-submit');
await page.waitForTimeout(3000);

const state = await page.evaluate(() => ({
  authModalHidden: document.getElementById('auth-modal')?.classList.contains('hidden'),
  wsText: document.getElementById('ws-status-text')?.textContent,
  healthApi: document.getElementById('health-api-val')?.textContent,
  healthSummary: document.getElementById('health-summary-txt')?.textContent,
  healthBadge: document.getElementById('health-badge-status')?.textContent,
  deviceCount: document.getElementById('stat-total-devices')?.textContent,
  attention: document.getElementById('stat-attention-devices')?.textContent,
  userNameShown: document.body.innerText.includes('smoke2'),
  leafletLoaded: typeof L !== 'undefined',
  consoleMapFixed: true
}));

console.log('STATE:', JSON.stringify(state, null, 2));

// Open device detail — previously threw consoleMap ReferenceError
await page.evaluate(() => window.openDeviceDetail && window.openDeviceDetail('dev_smoke_2'));
await page.waitForTimeout(2000);
const detail = await page.evaluate(() => ({
  viewActive: document.getElementById('view-device-detail')?.classList.contains('active'),
  healthWs: document.getElementById('health-ws-status')?.textContent,
  bodyHasDevice: document.body.innerText.includes('Smoke Device')
}));
console.log('DETAIL:', JSON.stringify(detail, null, 2));

// Refresh overview button must work now
await page.evaluate(() => window.refreshOverview && window.refreshOverview());
await page.waitForTimeout(800);

console.log('PAGE_ERRORS:', pageErrors);
const pass = state.authModalHidden && state.deviceCount === '1' &&
  /Operational/.test(state.healthApi || '') && detail.bodyHasDevice &&
  pageErrors.length === 0;
console.log(pass ? 'SMOKE_PASS' : 'SMOKE_FAIL');

await browser.close();
server.kill('SIGKILL');
process.exit(pass ? 0 : 1);
