// Shared test harness: boots an isolated in-memory server instance per test
// file with synthetic credentials only. No real data, no production services.
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = path.join(__dirname, '..', 'src', 'index.js');

export async function startServer(extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      NODE_ENV: 'test',
      PORT: '0',
      JWT_SECRET: 'unit-test-secret-not-for-production-1234567890',
      ADMIN_EMAIL: '',
      ADMIN_PASSWORD: '',
      DATABASE_URL: '',
      PGHOST: '',
      ...extraEnv
    };
    const child = spawn(process.execPath, [SERVER_ENTRY], {
      env,
      cwd: path.join(__dirname, '..'),
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let output = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill('SIGKILL');
        reject(new Error(`Server did not start in time. Output:\n${output}`));
      }
    }, 15000);

    function onData(chunk) {
      output += chunk.toString();
      const match = output.match(/running on http:\/\/0\.0\.0\.0:(\d+)/);
      if (match && !settled) {
        settled = true;
        clearTimeout(timer);
        const port = Number(match[1]);
        resolve({
          port,
          base: `http://127.0.0.1:${port}`,
          wsBase: `ws://127.0.0.1:${port}`,
          child,
          output: () => output,
          close: () => new Promise((res) => {
            child.once('exit', res);
            child.kill('SIGTERM');
            setTimeout(() => { child.kill('SIGKILL'); res(); }, 2000);
          })
        });
      }
    }

    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`Server exited early (code ${code}). Output:\n${output}`));
      }
    });
  });
}

export async function api(base, method, route, { token, body, formData, headers } = {}) {
  const opts = { method, headers: { ...(headers || {}) } };
  if (token) opts.headers['Authorization'] = `Bearer ${token}`;
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  if (formData) {
    opts.body = formData;
  }
  const res = await fetch(`${base}${route}`, opts);
  let data = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
  return { status: res.status, data, headers: res.headers, text };
}

/** Bootstraps the first admin on a fresh instance; returns {token, user}. */
export async function bootstrapAdmin(base, suffix = 'a') {
  const res = await api(base, 'POST', '/api/auth/bootstrap', {
    body: {
      username: `admin_${suffix}`,
      email: `admin_${suffix}@test.local`,
      password: 'AdminPass123!'
    }
  });
  if (res.status !== 200) throw new Error(`bootstrap failed: ${res.status} ${res.text}`);
  return res.data;
}

export function openWs(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const messages = [];
    ws.on('message', (data) => {
      try { messages.push(JSON.parse(data.toString())); } catch (_) { messages.push({ raw: data.toString() }); }
    });
    ws.on('open', () => resolve({ ws, messages }));
    ws.on('error', reject);
    // For rejected handshakes the 'unexpected-response' event fires.
    ws.on('unexpected-response', (req, res) => {
      reject(new Error(`WS handshake rejected with HTTP ${res.statusCode}`));
    });
    setTimeout(() => reject(new Error('WS connect timeout')), 5000).unref?.();
  });
}

export function waitFor(predicate, { timeout = 5000, interval = 50 } = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      let result;
      try { result = predicate(); } catch (_) { result = false; }
      if (result) {
        clearInterval(timer);
        resolve(result);
      } else if (Date.now() - start > timeout) {
        clearInterval(timer);
        reject(new Error('waitFor timed out'));
      }
    }, interval);
  });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
