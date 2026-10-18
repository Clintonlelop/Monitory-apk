# Monitory — Full-Stack Runtime Audit, Browser Testing & Bug Detection

**Repository:** https://github.com/Clintonlelop/Monitory-apk
**Audited checkout:** `/home/user/Monitory-apk`, branch `arena/a6e658e6-monitory-apk` (from `aca1847`, *feat: implement QR-based device pairing and theme toggle*)
**Date:** 2026-10-18
**Mode:** Audit-only. No application code was modified; nothing committed or pushed. No production VPS, database, Pterodactyl service, DNS, TLS, or live container was touched. All runtime testing used an isolated in-memory instance on `127.0.0.1:3100` with synthetic data and throwaway accounts.

---

## 1. Executive Summary

Monitory is an Android device-management/monitoring product (Kotlin agent + Node.js/Express/WebSocket backend + static web dashboard, PostgreSQL or embedded in-memory store). The dashboard UI is polished and the happy path *looks* functional, but the platform in its current state has **catastrophic security and integrity defects** and is **not safe to deploy for any real user data**.

Top-line conclusions:

1. **Authentication is effectively disabled.** Any password is accepted for any existing account (and the wrong password *overwrites* the stored hash), and registering with a known username resets that account's password. Both confirmed end-to-end. (P0)
2. **There is no object-level authorization.** Any logged-in user — and any *device* token — can read, modify, and delete every device; device `auth_token` values are returned in API responses. Confirmed. (P0)
3. **The WebSocket hub has no authentication at all.** Any client can impersonate any device, receive admin-issued commands (including file-exfiltration orders), forge command results, and eavesdrop on all dashboard events. Confirmed with live sockets. (P0)
4. **Device ingestion endpoints and the file store are unauthenticated.** Anyone can write telemetry/SMS/call data for any device ID and upload files that are then publicly readable at `/uploads/...`. Confirmed. (P0)
5. **Committed secrets**: a production JWT secret in `docker-compose.yml`, default admin credentials (in source, HTML prefills, and Android defaults), and a base64 debug signing keystore in `codemagic.yaml`. (P0)
6. **A confirmed stored XSS** fires in the dashboard Files tab from data injected via the unauthenticated files endpoint (executed `window.__xss=1` on hover during testing). (P1)
7. **The advertised pairing/QR flow is largely non-functional** in the Android app (QR parsing is dead code, `PairingScreen` is unreachable, QR payload keys don't match), several commands are **synthetic mockups** (fake screenshots/camera/“screen recording”), and the dashboard **fabricates device telemetry** at claim time (device shown ONLINE at 95% battery with no device attached). (P1–P2)
8. **The reported “Disconnected while backend healthy” symptom is explained**: the indicator reflects only the browser↔`/ws/dashboard` socket, several “health” labels are hardcoded cosmetics, and `getHostUrls()` forces `https/wss` URLs for any non-loopback host — so plain-HTTP LAN/VPS deployments hand the Android app TLS URLs that cannot connect. Exact production reverse-proxy behavior is untested (no nginx config in repo).
9. **Deployment is broken as committed**: the Docker build installs `server/package.json`, which is missing the `qrcode` dependency that `src/index.js` imports → crash-loop; the Android project cannot be built from this repo at all (Gradle project files missing outside `.platform/gradle-backup/`).

**Readiness verdict: NOT production-ready. Not safe for real user data.** Do not deploy until the P0 set is fixed and re-tested. The web dashboard's *presentation layer* is in decent shape; the security model, contract consistency, and several core features are not.

---

## 2. Application Startup Results

### 2.1 Environment & tooling

| Tool | Status |
|---|---|
| Node.js | v22.22.3 available |
| npm | 10.9.8 available |
| Docker / Podman | **Not available** in this sandbox (no container runtime) |
| PostgreSQL client/server | **Not available** |
| Java / Gradle / adb | **Not available** |
| Playwright 1.64.1 (npx) | Available; browser download from `cdn.playwright.dev` **blocked by sandbox egress policy** |
| Headless browser | Obtained via npm (`@sparticuz/chromium` 153 + `playwright-core` 1.64.1) with bundled NSS libs — real Chromium, driven via CDP |

### 2.2 Dependency install

```text
$ npm install --no-save --package-lock=false --ignore-scripts
added 147 packages … found 0 vulnerabilities
stderr: npm warn deprecated multer@1.4.5-lts.2: Multer 1.x is impacted by a number of
vulnerabilities, which have been patched in 2.x. You should upgrade to the latest 2.x.
```

* PASS, with a multer 1.x deprecation/security warning (upgrade to 2.x recommended).
* `npm audit`: **0 known vulnerabilities** at install time (still upgrade multer; the LTS line is explicitly flagged by the maintainers).
* No `package-lock.json` exists; only a `bun.lock` (for a tool that is not installed). `npm install` is therefore **non-reproducible**.

### 2.3 Server startup (isolated test instance)

```text
$ PORT=3100 JWT_SECRET='audit-only-ephemeral-secret-not-production' NODE_ENV=test node server/src/index.js
No DATABASE_URL provided. Running with integrated embedded data store.
Device Management Backend running on http://0.0.0.0:3100
WebSocket endpoints: ws://0.0.0.0:3100/ws/device & ws://0.0.0.0:3100/ws/dashboard
```

* PASS. Binds `0.0.0.0:3100`, clean logs, no startup errors. Memory store used (no `DATABASE_URL`). All test state is in RAM and resets on restart.
* `GET /api/health` → `200 {"status":"healthy","postgres":false,"activeDevices":N,"activeDashboards":N}`. PASS.
* `GET /api/server/config` on loopback → `serverUrl: http://127.0.0.1:3100`, `wsUrl: ws://127.0.0.1:3100/ws/device`. PASS.
* Static dashboard serves at `/` (200), `/login.html`, `/app.js`, `/style.css`. Unknown non-API path `/definitely-not-found` → SPA fallback `200 index.html`; unknown API path `/api/not-real` → `404 JSON`. PASS.
* Headers: `Access-Control-Allow-Origin: *`, `X-Powered-By: Express`, no CSP/HSTS/security headers (index.js uses no helmet).
* Server log across the whole audit: clean (WS connect/disconnect lines only). No crashes.

### 2.4 What could not be started here

| Target | Reason |
|---|---|
| `docker-compose up` (PostgreSQL + backend) | No container runtime in sandbox. Additionally the image **would crash-loop**: `server/package.json` lacks `qrcode`, imported by `server/src/index.js` (see F-06). |
| PostgreSQL-mode runtime tests | Same reason. Schema/SQL findings below are **code-confirmed** but were not executed against a live PG. |
| Android app / emulator | No JDK/Gradle/SDK/adb; and the repo **cannot build the APK at all** (missing Gradle project files, see F-08). |
| Production VPS / Pterodactyl / TLS | Intentionally untouched per rules. |

---

## 3. Browser Testing Results

Real Chromium (headless), 1440×1000 desktop and 390×844 mobile, against the isolated server. Flows exercised with synthetic accounts (`clintonumelo15@gmail.com`/`admin123` prefill, plus throwaway `@example.test` accounts) and synthetic devices (`QA Browser Device`, `XSS Probe`, `ws-audit-*`).

### 3.1 What works (verified)

| Flow | Result |
|---|---|
| Login (form submit, prefilled test creds) | PASS — modal closes, `GET /api/auth/me` 200, user name shown |
| WebSocket indicator after login | PASS — `Connecting…` → **`Live Synced`**, reconnects every 3 s on close |
| Overview stats + connected-devices table | PASS — counts, battery average, last-seen render |
| Sidebar navigation (Overview / Devices / Audit / Alerts) | PASS — view switching and active state correct |
| Device search (devices view) | PASS — filters live; no-match shows empty state |
| Device detail open (telemetry HUD, tabs) | PASS — name/status/telemetry render; 14 parallel sub-resource fetches fire |
| Command dispatch (“Sync Telemetry”) | PARTIAL — HTTP 200, row appears `PENDING`, blocking `alert()` confirms “dispatched” — but **nothing is ever delivered/executed** without a real device, and queued commands are never replayed (F-05) |
| Pairing modal → Generate Code | PASS — 6-digit code, real QR `data:image/png` payload, 30 s countdown UI |
| Pair & claim tab (enter code + name) | PASS mechanically — creates device **instantly** with **fabricated** ONLINE/95 %/Wi-Fi state (F-12) |
| Audit log & Alerts views | PASS — render real audit entries / empty states |
| Server Config modal (“Test Backend Connection”) | PASS — shows healthy/Embedded DB/0 devices (but only tests HTTP, never WebSocket — see §6) |
| Mobile 390 px: hamburger menu, sidebar drawer, view switching | PASS — `#menuBtn` visible, `.sidebar.open` toggles, no horizontal overflow (scrollWidth == 390) |
| Logout | PASS — auth modal returns, `localStorage` token/user cleared, page reload |

### 3.2 Browser console / network problems (observed)

```text
ERR_CONNECTION_CLOSED  https://fonts.googleapis.com/css2?family=Inter…      (fonts)
ERR_CONNECTION_CLOSED  https://unpkg.com/leaflet@1.9.4/dist/leaflet.css     (map css)
ERR_CONNECTION_CLOSED  https://unpkg.com/leaflet@1.9.4/dist/leaflet.js      (map js)
ReferenceError: consoleMap is not defined   at drawGeofencesOnMap (app.js:1667)
ReferenceError: L is not defined            at initConsoleMap (app.js:881) / initMap (app.js:864)
404  /api/devices/{id}/health               (frontend calls an endpoint that does not exist)
```

* The CDN failures are partly a sandbox egress artifact — but they expose a real fragility: **the dashboard hard-depends on unpkg/Google Fonts with no local fallback**, so any offline, firewalled, or CDN-outage environment loses maps and gets uncaught `L is not defined` exceptions when a device detail is opened (F-14).
* `consoleMap` is a genuine typo in shipped code (`consoleMapInstance` is the real variable) — confirmed JS exception on every device load (F-13).
* No other JS exceptions in the main flows; no infinite spinners observed; empty states are present and correct.

### 3.3 Confirmed stored XSS (Files tab)

Reproduction (all steps succeeded against the audit instance):

1. `POST /api/devices/{id}/files` **with no authentication**, body:
   `[{"fileName":"a\" onmouseover=window.__xss=1 x=\"","filePath":"/storage/emulated/0/safe1.jpg","fileSize":1,"mimeType":"image/jpeg","isDirectory":false}]` → `200`.
2. Log into the dashboard, open the device, switch to **File Explorer**.
3. The Preview button’s `onclick` attribute is broken out of (the renderer only runs `escapeJs`, which does not HTML-escape `"` inside the attribute):

```html
<button … onclick="openMediaPreview('a\" onmouseover=window.__xss=1 x=\"', …
```

4. Hovering the button executes attacker JS — **verified**: `window.__xss === 1` in the page.

Chaining F-04 (no-auth ingestion) with this XSS gives **unauthenticated remote code execution in any admin’s browser session** (JWT in `localStorage` is then readable). Severity: **P1** (P0 in any deployment where admins use the Files tab on real fleets). Files: `public/app.js:2043–2072` (`renderFilesTable`), `2668–2801` (`openMediaPreview` innerHTML injection of `actualUrl`/`mime`).

### 3.4 Not testable in a real browser

Real Android agent behavior, camera/mic/SMS/call capture, offline Room queue, TLS/reverse-proxy termination, and Play Store constraints. No emulator/device exists in this environment (see §9).

---

## 4. Frontend Findings

| ID | Finding | Evidence | Fix location |
|---|---|---|---|
| F-13 | **`consoleMap` undefined** — geofence drawing throws `ReferenceError` on every device load; geofences never render on the map | browser console; `public/app.js:1666–1685` (`drawGeofencesOnMap`) uses `consoleMap`, the variable is `consoleMapInstance` (`app.js:500`) | `public/app.js:1666–1685` |
| F-14 | **Hard CDN dependency (Leaflet + Google Fonts), no fallback** — maps break and `L is not defined` exceptions when CDN unreachable | failed requests + page errors; `public/index.html:9–13,1071` | vendor Leaflet locally (or serve from backend), self-host fonts; guard `if (typeof L === 'undefined')` |
| F-15 | **Frontend calls nonexistent `/api/devices/:id/health`** — device “service status” panel never receives real data; also the response fields it expects (`notification_service`, `location_service`, `telemetry_service`) don’t match the backend’s `/service-health` payload (`notificationMonitor`, `locationService`, `telemetryCollector`) | 404 in browser; `public/app.js:2154` vs `server/src/index.js:1861` | point to `/service-health` and map the actual field names |
| F-16 | **Hardcoded “System health” cosmetics** — Overview card (“● LIVE”, score 100, “Everything looks good”, “API availability: Operational”, “Database: Connected”, “Device sync: Active”) is never bound to backend state; `stat-attention-devices` always 0; “Refresh overview” button is dead (`window.refreshOverview` never defined) | `public/index.html:171–189,127,107`; grep shows no updater and no `refreshOverview` in `app.js` | bind health card to `/api/health` + WS state; implement or remove the refresh button |
| F-17 | **“WebSocket Transport / Connected” on the device page reflects the admin browser’s dashboard socket, not the device’s socket** | `loadDeviceHealth` (`app.js:2140`) sets `health-ws-status` from the global `ws` object; `applyTelemetry` (`app.js:665–668`) derives `status-srv-ws` from `currentDevice.status` only | show per-device socket presence from backend (`activeDevices`/device WS registry), with last-heartbeat timestamp |
| F-18 | **Duplicate DOM id `btn-pull-preview`** (static “Refresh Files” button + dynamic “Stream File Now” button) — `getElementById` binds the streaming handler to the wrong element; the static “Refresh Files” button has **no handler at all** | `public/index.html:661`, `public/app.js:2718,2724` | unique ids; wire “Refresh Files” to `SYNC_FILES` |
| F-19 | **Fabricated device state rendered as live data** — dashboard-claim path stores invented battery 95 %, RAM/storage numbers, SSID “Monitory-WLAN”, and *all permissions true*, status ONLINE, before any device exists | `server/src/index.js:520–630` (claim handler); browser screenshot of `QA Browser Device` showing `🔋 95% 📡 Wi-Fi 🕒 2m ago` | claim should create an `ENROLLED/OFFLINE` device with empty telemetry; never invent metrics or permission grants |
| F-20 | Blocking `alert()`/`confirm()`/`prompt()` used for command dispatch, deletions, notifications (`app.js:1409,1452,1467,…`) inconsistent with the toast system | code inspection | use existing `#toast` + confirm-modal component; reflect `dispatchedToOnlineDevice:false` (“device offline — command queued”) instead of unconditional success |
| F-21 | `escapeJs` (quote-escaping) used as if it were HTML-escaping inside `onclick="…"` attributes; `openMediaPreview` injects `actualUrl`, `mime`, `name` into `innerHTML` unescaped | `app.js:1183–1186, 2045–2060, 2682–2792` | use `escapeHtml` for all HTML contexts, `addEventListener`/dataset instead of inline `onclick` strings |
| F-22 | Every WS event triggers `loadDevices()` full refetch (`DEVICE_STATUS_CHANGED`, `DEVICE_TELEMETRY_UPDATED`, `DEVICE_PAIRED`) → request storms on busy fleets | `app.js:299–307` | patch state locally from event payload; debounce refetch |
| F-23 | Dead/orphan assets: `public/css/responsive.css` never linked and targets a different DOM (`.app-layout`, `.topbar`…); `public/login.html` + `public/js/auth.js` duplicate auth logic with **prefilled credentials**; `public/app.js` unused `escapeJs` variants | `index.html` links only `style.css`; `login.html:167,171` | delete or merge; never ship prefilled passwords |
| F-24 | Mixed sizes/typography: 9–11 px body text widely used (`style.css`, inline styles) — borderline readability; inconsistent button classes (`primary/secondary/btn btn-primary`) | visual review + screenshots | design-token pass: min 12–13 px body, consistent component classes |

---

## 5. Backend and API Findings

**API surface actually shipped** (`server/src/index.js`, 1973 lines, monolith): auth (register/login/me), pairing (generate/list/revoke/redeem/claim), register-device, devices CRUD, telemetry, locations, notifications, apps, usage, files, sms, calls, contacts, keystrokes, permissions, commands, recordings, upload-file, geofences, data-usage, service-health, audit, alerts, `/api/server/config`, health. WebSocket: `/ws/device`, `/ws/dashboard` (`server/src/ws.js`).

| ID | Finding | Evidence |
|---|---|---|
| F-01 | **Login accepts any password and rewrites the hash.** If `comparePassword` fails, the handler *still issues a JWT* and silently `UPDATE users SET password_hash=…` with the attempted password | `server/src/index.js:146–199` (esp. the `else` branch after `const valid = await comparePassword(...)`); live: `POST /api/auth/login` with wrong password → `200` + token (§10 repro) |
| F-02 | **Register-by-username account takeover.** Registration matches `WHERE email=$1 OR username=$2`; on match it **resets that account’s password** and returns its token. Registering `{username:'admin', email: NEW}` hijacks the seeded admin (id 1) | `server/src/index.js:96–144`; live: register `username='admin'` → `user.id=1`; then login `admin@devicemanager.local` with attacker password → `200` |
| F-03 | **Broken object-level authorization / role separation.** `GET /api/devices`, `GET/DELETE /api/devices/:id`, commands, SMS/calls/contacts/keystrokes/notifications/locations… scope nothing to `req.user.id`. A *device* JWT (`{deviceId,type:'device'}`) passes `verifyToken` and is accepted as an admin Bearer | `server/src/auth.js:12–31`; `index.js:708–720` etc.; live: device token → `GET /api/devices` 200 (5 devices), `GET /api/devices/:id` 200 |
| F-04 | **Device tokens and PII leak in API responses.** `GET /api/devices/:id` uses `SELECT *` and returns `auth_token` (full 365-day JWT); memory-mode `GET /api/devices` returns complete device objects including `auth_token` | `index.js:720–742` (detail), `708–718` (memory list); live: `authTokenInList: 4`, `authTokenInDetail: eyJ…` |
| F-05 | **Unauthenticated ingestion + public file store.** `POST /api/devices/:id/{telemetry,location,notifications,apps,usage,files,sms,calls,contacts,keystrokes,commands/:cid/status,recordings,upload-file,service-health,data-usage,alerts(only alerts has auth)}` have **no auth middleware**; `express.static('/uploads')` serves every uploaded file with no auth; multer has no size/type limits and no filename policy beyond charset rewrite | `index.js:777,859,983,1088,1138,1182,1237,1289,1342,1394,1607,1643,1688,1843,1794` (no `verifyToken`); `index.js:47–52,72`; live: unauth telemetry/permissions/disconnect → 200; unauth recording upload → `200`, then `GET /uploads/…` → `200` with body |
| F-06 | **Docker deployment crash-loops.** `server/Dockerfile` installs only `server/package.json` deps; `src/index.js` imports `qrcode` which is **only** in the root `package.json`. Compose also bakes a `JWT_SECRET` (see F-07) and has no lockfile | dependency diff (`root-only: qrcode`); `server/package.json` vs `index.js:11`; `server/Dockerfile`, `docker-compose.yml` |
| F-07 | **Secrets committed.** `docker-compose.yml` sets `JWT_SECRET: production_secure_jwt_secret_key_89214710`; `server/src/auth.js:4` falls back to `dev_secret_key_change_in_production_89214710` (= `.env.example`); seeded users `admin/admin` and `clintonumelo15@gmail.com/admin123` with hashes in `server/src/db.js:18–36`; login UI prefills that Gmail + password (`index.html:29–33,42–44`); Android defaults repeat it (`MainViewModel.kt:60–62`, `AuthScreen.kt` supporting text); `codemagic.yaml` embeds a full base64 **signing keystore**; `data/app.db` (SQLite) is committed with a test bcrypt hash | files cited; if the compose secret is the real production secret, **anyone can forge admin/device JWTs** — rotate immediately |
| F-08 | **No rate limiting, no password policy, no lockout** on `/api/auth/*` or pairing redeem (6-digit codes brute-forceable in principle; codes are 30 s but attempts are unlimited); 1-char passwords accepted | `index.js` has no limiter (the dead `server.js` had one); live: password `x` accepted |
| F-09 | **Commands accepted for offline devices are lost forever** — `sendCommandToDevice` returns false, command stays `PENDING` with `dispatchedToOnlineDevice:false`, and `ws.js` never replays queued commands on device connect (the legacy `server.js` had that flush; the live server doesn’t) | `server/src/ws.js:96–106`; no queue-flush handler in `wss.on('connection')`; browser: commands stuck `PENDING` |
| F-10 | **Arbitrary `commandType` accepted** — no allowlist; e.g. `UNRECOGNIZED_AUDIT_COMMAND` stored and “dispatched” with 200 | `index.js:1546–1589`; live: 200/PENDING |
| F-11 | **PostgreSQL-mode data bugs (code-confirmed; live PG unavailable):** (a) `alerts` insert uses columns `alert_type,title` but `schema.sql:148–157` defines `type,message` → geofence alerts fail (caught & logged) and `POST /api/devices/:id/alerts` **hangs** (async throw, Express 4 ignores rejected promises); (b) `upload-file` and `service-health` write to `db.getMemoryStore()` even in PG mode → `web_path` never persists, so the “Stream File Now” flow can never complete; (c) telemetry upsert maps `telemetry.batteryLevel \|\| 100` → a real 0 % battery is stored as **100 %** | `index.js:914,1903` vs `schema.sql:148–157`; `index.js:1698,1847,1863`; `index.js:795` |
| F-25 | Memory-mode inconsistencies: telemetry POST writes `deviceName` (camelCase) while readers use `device_name`; usage POST **overwrites all devices’** `usage_statistics` with the last device’s list; `service_health`/`files.web_path` never survive restart | `index.js:777–857,1138–1164` |
| F-26 | Error-handling gaps: several async handlers (`GET /api/devices/:id`, `DELETE /api/devices/:id`, telemetry POST, commands POST) lack try/catch → a DB error becomes a hung request instead of JSON 500; `register` returns raw `err.message` to clients | `index.js` throughout |
| F-27 | `GET /api/devices/:id/notifications?limit=…` interpolates `LIMIT ${limit}` (parseInt-guarded today, but string-built SQL); add a numeric whitelist | `index.js:1048–1070` |
| F-28 | Duplicate/legacy stack in `server/server.js`, `server/src/db/schema.js`, `server/src/routes/*` (CommonJS, requires missing `../db/database`, `../middleware/auth`, `../ws/manager`, plus uninstalled `helmet`/`express-rate-limit`) — **cannot boot** (`node server/server.js` → `ReferenceError: require is not defined in ES module scope`), yet README “standalone” language and schema comments suggest it’s real | `server/server.js`, `server/src/routes/auth.js`, `server/src/routes/devices.js`; startup test above |
| F-29 | `data/app.db`, `data/app.db-shm`, `data/app.db-wal` committed to git (empty legacy SQLite schema + one test user hash) — DB files don’t belong in VCS; also `.platform/**` caches and `.aistudio/**` session artifacts are tracked | `git ls-files` inventory |

---

## 6. Database & WebSocket Findings

### 6.1 Database

* Two engines: **PostgreSQL** (docker-compose, `server/schema.sql`) or **embedded in-memory store** (`server/src/db.js`) — the “embedded” mode is process RAM only, so every restart silently **loses all devices, telemetry, pairings, and audit history**. `/api/server/config` discloses which mode is active (`postgres: false`).
* Schema drift: `schema.sql` vs `db.js` migrations vs `index.js` inserts are three different contracts (alerts columns, `keystrokes`/`contacts`/`sms`/`calls` added ad-hoc, `service-health` has no table at all). See F-11.
* Seeded users are inserted on every boot (with explicit ids 1/2 and known hashes) — see F-07.
* Committed `data/app.db` is dead weight from the retired SQLite design and should be removed from version control (F-29).
* No migration framework (tables altered via `ADD COLUMN IF NOT EXISTS` at boot); no backup/retention guidance despite the data classes (SMS, call logs, recordings) being highly sensitive.

### 6.2 WebSocket (`/ws/device`, `/ws/dashboard`) — the “Disconnected” question

Confirmed lifecycle behavior:

* **No authentication whatsoever** on either endpoint. `/ws/device` trusts the client-supplied `?deviceId=` completely (the Android app also sends `&token=…`, which the server **ignores** — `server/src/ws.js:26–33`). `/ws/dashboard` accepts any socket and broadcasts everything to it.
* Live proof: an anonymous socket connected as `ws-audit-*`, received the admin-dispatched `SYNC_DEVICE` command (`reportedDelivered: true`), sent a forged `COMMAND_STATUS COMPLETED` that was stored and broadcast, and an anonymous “dashboard” socket received `ACCESSIBILITY_EVENT` text. Reconnect without credentials re-registered the device as ONLINE.
* Heartbeat: server answers `PING`→`PONG`; the Android side pings every 20 s and reconnects after 5 s (`DeviceWebSocketManager.kt`). The **dashboard** never sends pings; its “LAST HEARTBEAT” widget just counts seconds since the last *any* WS event (`app.js:1143–1168`) — on an idle fleet it shows “heartbeat stale” while the socket is perfectly healthy (or the inverse).
* Dashboard indicator (`#ws-status-text`) is **only** `ws.onopen/onclose` for `/ws/dashboard` (`app.js:272–287`). It is accurate for *its own* socket, but it is not a health check of the API, the database, or any device.
* **Why “Disconnected” appears while the backend is healthy** (ranked):
  1. **`getHostUrls()` forces HTTPS/WSS for every non-loopback host** (`index.js:253–278`): a backend served over plain HTTP on a LAN IP or VPS advertises `https://host` + `wss://host/ws/device` to the Android app → TLS handshake fails → device never connects → dashboard shows devices offline / “Disconnected” while `/api/health` is green. (Confirmed by code; exact production topology untested.)
  2. Reverse proxy (the repo’s own comment says nginx fronts port 8080→3000) must forward WebSocket `Upgrade` headers and use long `proxy_read_timeout`; **no nginx config is in the repo**, so this cannot be verified here — if the proxy strips upgrades, the dashboard’s WS closes immediately and the indicator flips to “Disconnected” while HTTP health stays 200. *(Hypothesis.)*
  3. The Android app’s default server URL is an **external Cloud Run host not represented in this repo** (`PreferenceManager.kt:143`) — environment drift between the app default, README (`localhost:8080`), `.env.example` (`PORT=3000`), and compose (`8080`).
  4. Mixed content: if any page is HTTPS and a device URL is `ws://…` (or vice versa), the browser blocks the socket; `app.js` derives `wss:` from `location.protocol`, so this is only a problem for the *device* URL handed out by pairing.
  5. Cosmetic health labels can claim “Connected/Operational” with zero sockets (F-16/F-17), so users misread which indicator means what.

### 6.3 Android ↔ server contract mismatches (break real features)

| Contract | Server | Android | Effect |
|---|---|---|---|
| QR payload | `{v, code, server, ws, expiresAt, environment}` (`index.js:271–280`) | reads `serverUrl`, `code`, `expiresAt` (`MainViewModel.kt:197–210`) | QR sets the **wrong server URL key** → keeps stale/default URL |
| QR entry point | — | `parseAndPairWithPayload` has **zero call sites**; `PairingScreen` is not routed in `MainActivity`; no QR scanner | **QR/pairing-code enrollment is dead code**; only account sign-in + `register-device` works |
| `PairingResponse` | `{success, deviceId, token, serverUrl, wsUrl, …}` | expects `success/deviceId/token/message` | tolerant (Moshi reflection) — works |
| Pending commands | only `GET /api/devices/:id/commands` | declares `GET …/commands/pending` (`ApiService.kt:130`) | dead client endpoint (unused anyway — WS push is the real channel) |
| Camera upload | none (no `/camera` route) | `uploadCameraCapture` declared, never called | dead code |
| Command result field | WS handler reads `errorMessage` | sends `errorMessage` over WS, `errorMessage` over REST | consistent — OK |
| Command id | `cmd_…` string ids | `RemoteCommand.commandId` | OK |

---

## 7. Security Findings (summary; full evidence in §5)

| # | Severity | Issue | Status |
|---|---|---|---|
| S-1 | P0 | Any password accepted; wrong password overwrites hash (F-01) | **Confirmed** |
| S-2 | P0 | Register-by-username account takeover incl. seeded admin (F-02) | **Confirmed** |
| S-3 | P0 | Broken authz: any user/device token = full fleet access; device `auth_token` leaked (F-03/F-04) | **Confirmed** |
| S-4 | P0 | Unauthenticated WS hub: command theft/exfil, status forgery, event eavesdropping (§6.2) | **Confirmed** |
| S-5 | P0 | Unauthenticated ingestion + world-readable `/uploads` + unbounded uploads (F-05) | **Confirmed** |
| S-6 | P0 | Committed secrets: production JWT secret in compose, default admin creds (web+Android), signing keystore in CI config (F-07) | **Confirmed** |
| S-7 | P1 | Stored XSS in Files tab via unauth file metadata (F-21, §3.3) | **Confirmed** (executed) |
| S-8 | P1 | No rate limits, 1-char passwords, 6-digit pairing codes unlimited-attempt (F-08) | **Confirmed** |
| S-9 | P1 | Sensitive-data handling in the agent: `HttpLoggingInterceptor.Level.BODY` logs tokens + SMS/notification/call content to logcat (`ApiClient.kt:38–44`); tokens in plain `SharedPreferences`; `network_security_config` permits **cleartext** and trusts **user CAs** (`network_security_config.xml`) | **Confirmed** (code) |
| S-10 | P1 | Transparency gaps vs. the product’s own promises: accessibility service labeled “Device Integrity Assistant / compliance auditing” while streaming on-screen text (password fields included) to the server (`DeviceAccessibilityService.kt`, `strings.xml`); `CODEASSIST_BUILD.md` claims the storage browser “does not upload or remotely stream private files” while `UPLOAD_FILE` + `syncFilesList` do exactly that (`DeviceRepository.kt:530–600, 880–930`); dashboard tab literally titled “Surveillance Audio Recordings” / “Accessibility Keylogs” | **Confirmed** (code) |
| S-11 | P1 | `UPLOAD_FILE` command reads **any device path** with no allowlist → with S-1/S-4 this is a one-click exfiltration pipeline ending in public `/uploads` | **Confirmed** (code) |
| S-12 | P2 | Excessive collection up-front: `MainActivity` requests SMS/calls/contacts/mic/camera/location together and auto-launches All-Files-Access settings; `QUERY_ALL_PACKAGES` | **Confirmed** (code) |
| S-13 | P2 | CORS `*` + `X-Powered-By` + no CSP/HSTS/security headers on the web app | **Confirmed** |
| S-14 | P2 | Multer 1.x flagged by maintainers; no lockfiles for reproducible builds | **Confirmed** |

Explicitly **not** found / not done: no destructive testing; no production data accessed; SQL injection risk on core queries is low (parameterized `$n` used everywhere except the guarded `LIMIT` interpolation); `escapeHtml` is used consistently in notification/audit/alert renderers.

---

## 8. UI/UX Evaluation & Recommendations

**What’s good:** modern dark/light visual system; coherent sidebar + topbar layout; sensible empty states; toasts exist; pairing modal with QR + countdown is a strong idea; mobile drawer works without overflow; device console tabs give real depth.

**What needs work (each with a concrete change):**

1. **Truthful status system (P1 UX).** Replace the hardcoded System-health card and mislabeled WS rows (F-16/F-17) with three distinct, labeled signals: *API health* (heartbeat poll of `/api/health`), *Live updates* (dashboard WS), *Device link* (device last-seen + device-socket presence from the server). Never show “Connected” from static HTML.
2. **Honest empty/offline states (P1).** When `dispatchedToOnlineDevice:false`, say “Device offline — command queued” instead of `alert("…dispatched! (Status: PENDING)")`; when claim creates a device, show “Enrolled — waiting for device” rather than ONLINE + 95 % battery (F-19).
3. **Confirmation & safety (P2).** “Unpair Node” uses `confirm()` and then only flips status; deleting notifications/geofences should be undoable toasts; destructive actions need a consistent modal.
4. **Forms (P2).** Register/login should enforce password strength server-side and show inline validation errors; the prefilled credentials and “Default Account: …/admin123” hint must go.
5. **Accessibility (P2).** Most controls are clickable `div`/`<a href="#">` with inline `onclick`; icons (`⎋`, `×`, `☰`) need `aria-label`s (menu/theme buttons have them; logout/title tooltips partially); focus rings are suppressed in places; 9–11 px text is below readable minimums (F-24); tables aren’t keyboard-navigable.
6. **Responsive polish (P3).** `responsive.css` is dead code from another design system — either adopt its table-to-card pattern or delete it (F-23); detail-page tab bar (14 tabs) overflows on mobile — needs scroll-snap chips or a select.
7. **Feedback consistency (P3).** Replace `alert()` with toasts (F-20); standardize on one button component; skeleton loaders instead of “Loading devices…” text rows.

---

## 9. Automated Test Results

| Command | Result | Notes |
|---|---|---|
| `npm install --no-save` (root) | **PASS** | 147 pkgs; multer 1.x deprecation warning; `npm audit`: 0 known vulns |
| `node --check server/src/{index,auth,db,ws}.js` | **PASS** | syntax clean |
| `PORT=3100 … node server/src/index.js` | **PASS** | clean startup, memory mode |
| `curl` smoke (10 routes incl. health/config/404s) | **PASS** | statuses correct |
| WebSocket integration script (connect/ping/command/forge-status/reconnect) | **PASS (findings produced)** | F-04/§6.2 evidence |
| API security/authz script (20 checks) | **PASS (findings produced)** | F-01–F-05 evidence |
| Browser suite (Chromium 153 headless): login/logout/nav/search/detail/commands/pairing/claim/mobile/XSS PoC | **PASS (findings produced)** | §3; CDN failures noted |
| `npm run build` (root) | **N/A** | prints “Build complete” — **no actual build step exists** |
| `cd server && npm test` | **0 tests** | `test/*.test.js` does not exist — the script runs nothing |
| Lint / typecheck | **NOT AVAILABLE** | no ESLint/tsc config in repo |
| `node server/server.js` (legacy) | **FAIL** | `ReferenceError: require is not defined in ES module scope` + missing internal modules |
| Docker build/compose | **NOT RUN** | no container runtime; statically broken (missing `qrcode`, F-06) |
| `gradle assembleDebug` / Android unit & instrumented tests | **NOT RUN / NOT POSSIBLE** | no JDK/SDK in sandbox **and** repo lacks root `settings.gradle.kts`, `build.gradle.kts`, `gradlew`, `gradle/` wrapper (they exist only under `.platform/gradle-backup/`); `codemagic.yaml` runs `./gradlew` which is not in the repo; CODEASSIST_BUILD.md references a GitHub Actions workflow that does not exist. Android tests present are template-grade (`2+2`, app-name string, screenshot test) |

---

## 10. Prioritized Bug List

### P0 — Critical (security exposure / data compromise)

| ID | Title | Component | Evidence | Repro | Root cause | Fix | Status |
|---|---|---|---|---|---|---|---|
| P0-1 | Any password accepted for any account; wrong password overwrites hash | `server/src/index.js:146–199` | `POST /api/auth/login` with wrong password → 200 + JWT; hash rewritten | See §5 F-01 | Login “else” branch updates hash instead of `return 401` | Delete the auto-hash-update branch; `return 401` on `!valid` | **Confirmed** |
| P0-2 | Register-by-username takeover of seeded admin | `index.js:96–144`, `db.js:18–36` | `register {username:'admin', email:new}` → `user.id=1`; then login as admin with attacker password | §5 F-02 | `WHERE email=$1 OR username=$2` + password reset on match | 409 on any existing username/email; never update password from register; remove seeded accounts | **Confirmed** |
| P0-3 | Broken object-level authz; device tokens are admin tokens; `auth_token` leaked | `auth.js:12–31`, `index.js:708–742` | device JWT → `GET /api/devices` 200; detail contains `auth_token` | §5 F-03/F-04 | `verifyToken` has no role/tenant checks; `SELECT *` | Scope every query by `user_id`; distinct `role` claim + middleware (`requireAdmin`, `requireDevice`); never serialize `auth_token` | **Confirmed** |
| P0-4 | WebSocket hub completely unauthenticated | `server/src/ws.js:26–75` | anonymous sockets receive commands, forge statuses, read all events | §6.2 script | `?deviceId=` trusted; no JWT check | Verify device JWT on `/ws/device` and admin JWT on `/ws/dashboard`; bind socket to the verified identity | **Confirmed** |
| P0-5 | Unauthenticated ingestion + public `/uploads` + unbounded multer | `index.js:777–1861`, `:72` | unauth POSTs 200; `GET /uploads/1792…_audit.txt` → 200 body | §5 F-05 | missing `verifyToken`/device-auth middleware; `express.static(uploadsDir)` | Require device token scoped to `:id` on all ingest; authorize downloads per-user; multer `limits` + type allowlist + random names | **Confirmed** |
| P0-6 | Committed secrets: prod JWT secret, default admin creds (web+Android), signing keystore | `docker-compose.yml`, `auth.js:4`, `db.js`, `index.html:29–44`, `MainViewModel.kt:60`, `codemagic.yaml` | grep/files; UI prefills | — | secrets checked in | **Rotate now**; move to env/secret store; delete keystore from git history if it ever signed anything real; remove seeded users | **Confirmed** |

### P1 — High (core feature broken / significant security)

| ID | Title | Component | Fix | Status |
|---|---|---|---|---|
| P1-1 | Stored XSS in Files tab (unauth-planted metadata) | `app.js:2043–2072, 2668–2801` | HTML-escape everywhere; no inline `onclick` strings; CSP | **Confirmed (executed)** |
| P1-2 | Docker image cannot start (missing `qrcode` in `server/package.json`) | `server/package.json`, `server/Dockerfile` | add `qrcode`, commit a lockfile, `npm ci` | Confirmed (static) |
| P1-3 | Commands to offline devices silently lost (no queue/replay); UI claims success | `ws.js`, `index.js:1546`, `app.js:1467` | persist `PENDING`, flush on device connect (as legacy `server.js` attempted), honest UX | Confirmed (static + browser) |
| P1-4 | PG-mode `alerts` column mismatch → geofence alerts fail, `POST /alerts` hangs the request | `index.js:914,1903` vs `schema.sql:148–157` | align schema (`alert_type/title` or query columns); wrap async handlers | Confirmed (code) / live PG untested |
| P1-5 | Android project unbuildable from repo (Gradle files missing; CI references absent `gradlew`/workflow) | repo root, `codemagic.yaml`, `CODEASSIST_BUILD.md` | restore `settings.gradle.kts`, `build.gradle.kts`, wrapper, `gradle/libs.versions.toml` at root (they’re in `.platform/gradle-backup/`), fix docs | Confirmed |
| P1-6 | Pairing/QR enrollment non-functional in app (dead `PairingScreen`, uncalled QR parser, wrong payload keys) | `MainActivity.kt`, `MainViewModel.kt:187–225`, `DeviceTelemetry.kt:190`, `index.js:271–280` | wire one enrollment path; match QR JSON keys (`server`/`ws` vs `serverUrl`) or version the payload | Confirmed (static) |
| P1-7 | Agent secrets in logcat (BODY logging) + plaintext prefs + cleartext/user-CA trust | `ApiClient.kt`, `PreferenceManager.kt`, `network_security_config.xml` | `Level.NONE`/BASIC in release; EncryptedSharedPreferences; TLS-only config | Confirmed (static) |
| P1-8 | Exfil pipeline: `UPLOAD_FILE` reads arbitrary paths → public `/uploads`; storage scan uploads up to 1000 file paths despite “never uploads files” claim | `DeviceRepository.kt:880–930`, `index.js:1688` | path allowlist (SAF/URIs), authenticated downloads, fix disclosure text | Confirmed (static) |
| P1-9 | Transparency/deception issues: accessibility text exfil under “Device Integrity Assistant” naming; synthetic screenshot/camera/“screen recording” commands report success while writing fake media | `DeviceAccessibilityService.kt`, `strings.xml`, `DeviceRepository.kt:730–880` | rename+disclose accurately; label mock features as demos or implement for real | Confirmed (static) |
| P1-10 | No rate limiting/lockout on auth & pairing; 1-char passwords | `index.js` | express-rate-limit (as legacy server had), password policy, pairing attempt throttling | Confirmed |

### P2 — Medium

| ID | Title | Fix | Status |
|---|---|---|---|
| P2-1 | `getHostUrls` forces https/wss for non-loopback HTTP hosts → devices can’t connect (“Disconnected” root cause) | only force TLS when `x-forwarded-proto`/`req.secure` is https | Confirmed (code) |
| P2-2 | Hardcoded health cosmetics + wrong WS attribution + `/health` 404 + field-name mismatch | §4 F-15/F-16/F-17 fixes | Confirmed |
| P2-3 | Claim path fabricates ONLINE + telemetry + permissions | create `ENROLLED` device with empty metrics | Confirmed |
| P2-4 | PG-mode `service-health` & `upload-file` web_path memory-only | persist to Postgres tables | Confirmed (code) |
| P2-5 | Telemetry `batteryLevel \|\| 100` turns 0 % into 100 %; memory-mode `deviceName` vs `device_name` drift | `??` instead of `\|\|`, one field-naming convention | Confirmed (code) |
| P2-6 | `consoleMap` typo, CDN hard-dep, `btn-pull-preview` duplicate id, dead “Refresh Files”/“Refresh overview” | §4 fixes | Confirmed |
| P2-7 | Memory-mode usage POST clobbers other devices’ stats | key the store per device | Confirmed (code) |
| P2-8 | Arbitrary `commandType`; unauth `commands/:id/status` (result forgery already demonstrated) | allowlist + auth | Confirmed |
| P2-9 | Android default URL points at an external Cloud Run host not in this repo; README/`.env.example`/compose port confusion (3000 vs 8080) | single documented topology; default to user-entered URL | Confirmed |
| P2-10 | Async error handling: DB failure hangs requests (Express 4 + floating promises); raw `err.message` leaks | try/catch or `express-async-errors`; generic 500 bodies | Confirmed (code) |
| P2-11 | Accessibility: div-based nav/buttons, tiny type, focus issues | semantic buttons/links, ≥12 px, visible focus | Confirmed (visual) |

### P3 — Low

Dead legacy server (`server.js`, `src/db/schema.js`, `src/routes/*`); committed `data/app.db*` and `.platform`/`.aistudio` artifacts; orphan `login.html`/`auth.js`/`responsive.css`; `namespace "com.example"`; unused client API methods (`getPendingCommands`, `uploadCameraCapture`, `getHealth`); `metadata.json` platform cruft; multer 1.x → 2.x; missing lockfiles; `X-Powered-By` disclosure; README overclaims (e.g. “production-ready”, screenshot/recording features, dashboard port).

---

## 11. Recommended Repair Order

1. **Stop the bleeding (P0-1, P0-2, P0-6):** fix login/register logic, delete seeded credentials, **rotate every secret ever used with this codebase** (JWT secret from `docker-compose.yml`, any VPS `.env`, keystore if reused).
2. **AuthN/AuthZ layer (P0-3, P0-4, P0-5, P2-8):** one middleware set — admin JWT, device JWT (scoped to `deviceId`), WS handshake verification, ingest/download authorization, upload limits.
3. **Data-integrity pass (P1-4, P2-4, P2-5, F-25):** single schema owner (migrations), fix memory/PG divergences, wrap async handlers (P2-10).
4. **Frontend trust & safety (P1-1, P2-1, P2-2, P2-3, P2-6):** kill XSS sinks, honest status system, fix `getHostUrls`, vendor Leaflet, fix `consoleMap`/`btn-pull-preview`.
5. **Packaging & build (P1-2, P1-5, P2-9, P3):** `qrcode` + lockfile + `npm ci` in Docker; restore Gradle project; remove legacy stack and committed artifacts; align README with reality.
6. **Agent hardening & honesty (P1-7, P1-8, P1-9, S-12):** logging level, encrypted storage, TLS-only, path allowlists, accurate naming/disclosure, mark mock commands as demos.
7. **Pairing flow completion (P1-6):** one working QR/code enrollment path with matching payload keys and reachable UI.
8. **Rate limits & UX polish (P1-10, P2-11, §8).**

---

## 12. Exact Next Steps for the Highest-Priority Issues

**Step 1 — immediate ops (today):**
* Rotate `JWT_SECRET` everywhere (compose, VPS env, Cloud Run) and restart services; treat `production_secure_jwt_secret_key_89214710` and `dev_secret_key_change_in_production_89214710` as compromised.
* Remove default accounts: drop the seed block in `server/src/db.js` (`memoryStore.users`) and the `INSERT INTO users (… 'admin' … 'Clinton' …)` block in `initDb()`; force first-run bootstrap.
* If the Android app was distributed with the committed keystore or default URL/credentials, plan a re-sign + forced re-enrollment.

**Step 2 — patch `server/src/index.js` (with tests):**
* Login: `if (!valid) return res.status(401).json({ error: 'Invalid credentials' });` — delete the hash-update block (lines ~171–183).
* Register: reject duplicates (`409`) — delete the `UPDATE users SET password_hash` branch (lines ~110–125).
* Add `verifyToken` (or device-token middleware) to **every** route in the unauthenticated list in F-05; add `multer({ limits: { fileSize: 25*1024*1024 }, fileFilter })`; replace `express.static(uploadsDir)` with an authorized download route; strip `auth_token` from all responses (`GET /api/devices`, `GET /api/devices/:id`).
* Wrap async handlers with try/catch → JSON 500.

**Step 3 — patch `server/src/ws.js`:**
* On `upgrade`/`connection`, verify JWT (query `token`/`Authorization` header): device sockets must match `deviceId`; dashboard sockets must be admin tokens. Reject with `4401` otherwise.
* Keep a per-device `PENDING` command queue; flush on `connection` (mirror the intent of the dead `server/server.js:ws` block).

**Step 4 — frontend (`public/app.js`, `public/index.html`):**
* Replace `escapeJs`-in-`onclick` with `addEventListener` + dataset; `escapeHtml` in `openMediaPreview`; fix `consoleMap`→`consoleMapInstance` (line 1667); point `loadDeviceHealth` at `/api/devices/:id/service-health` with the camelCase fields; bind the System-health card to `/api/health` + WS state; vendor Leaflet locally.

**Step 5 — packaging (`server/package.json`, `server/Dockerfile`, root Gradle):**
* Add `"qrcode": "^1.5.4"` to `server/package.json`, generate and commit `package-lock.json`, switch Dockerfile to `npm ci --omit=dev`.
* Restore Gradle files from `.platform/gradle-backup/` to the repo root (or regenerate), so `./gradlew assembleDebug` and `codemagic.yaml` work.

**Step 6 — verification:** re-run the exact scripts used in this audit (startup smoke, auth/authz script, WS script, browser suite incl. the XSS PoC) against both memory mode **and** `docker-compose` with PostgreSQL; only then consider a pilot deployment on non-sensitive devices.

---

## Overall Assessment & Test Coverage

**Assessment:** The product has a compelling UI and an ambitious feature list, but the implementation currently **does not enforce authentication, authorization, or transport security in any meaningful way**, ships forgeable secrets, fabricates monitoring data in the dashboard, and cannot be built/deployed from the repo as documented. For an application that handles SMS, call logs, contacts, recordings, location, and accessibility text, this is disqualifying: **not production-ready, not safe for real users’ data (P0 fleet of six)**.

**Verified in this audit (runtime evidence):** backend startup & health (memory mode); static/SPA serving; register/login/me/logout; pairing generate (6-digit + QR) and redeem (incl. reuse rejection); dashboard claim; device list/detail/search; sub-resource loading; command dispatch/queueing; audit & alerts views; WS connect/ping/reconnect and **absence of WS auth**; unauthenticated ingest & public uploads; cross-tenant reads; device-token-as-admin; password overwrite & username takeover; stored XSS execution; desktop + 390 px mobile layouts; logout/session clearing.

**Code-reviewed but not live-tested:** all PostgreSQL-mode behaviors (no container runtime — schema mismatches and memory-only writes flagged in F-11/P2-4 are static findings); reverse-proxy/TLS behavior of the real production host; the legacy `server/server.js` stack beyond its startup failure.

**Not tested / unavailable:** real Android device & emulator flows (pairing from the app, notification listener, permissions UX, Room offline queue, recording capture); Play Store policy compliance; production VPS/Pterodactyl/DNS/TLS; load/performance; formal pen-testing beyond the scoped checks above; Android unit/instrumented tests (project unbuildable).

**Cleanup notes:** testing used an isolated instance (`PORT=3100`, ephemeral in-memory DB) that remains running as “Monitory audit server” for convenience; `node_modules/` was installed untracked for the audit (not part of the repo); one synthetic file was uploaded to `server/uploads/` during the public-upload test and has been removed. No tracked file was modified.
