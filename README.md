# Android Device Management & Monitoring System

An Android Device Management agent and full-stack administrative infrastructure built with Kotlin, Jetpack Compose, Node.js, WebSockets, PostgreSQL (or an embedded development store), and an interactive Web Admin Dashboard. Review `AUDIT_REPORT.md` and the security notes below before deploying — this system handles highly sensitive data (SMS, call logs, recordings, location) and must only be used on devices you own or administer with informed consent.

---

## 🏛 System Architecture

```
┌────────────────────────────────────────────────────────┐
│               Android Target Device                    │
│  - DeviceManagementService (Foreground Service)        │
│  - NotificationMonitorService (Notification Listener)  │
│  - Jetpack Compose UI (Pairing, Telemetry, Privacy)    │
│  - Room Database (Local Offline Event Queue)           │
│  - LocationHelper (GPS / FusedLocationProvider)        │
└──────────────▲─────────────────────────┬───────────────┘
               │                         │
      WebSocket Real-Time        HTTPS REST API
      Bi-directional Commands     Telemetry & Uploads
               │                         │
┌──────────────┴─────────────────────────▼───────────────┐
│               Node.js Backend Server                   │
│  - Express REST API (Auth, Devices, Telemetry, Files)  │
│  - WebSocket Hub (/ws/device, /ws/dashboard)           │
│  - In-Memory & PostgreSQL Dual Storage Engine          │
│  - Audit Logging & Alert Rules Engine                  │
└──────────────▲─────────────────────────┬───────────────┘
               │                         │
      Live Telemetry & Sync      Command Dispatch
               │                         │
┌──────────────┴─────────────────────────▼───────────────┐
│              Web Admin Dashboard                       │
│  - Real-time Device Fleet Overview                     │
│  - Interactive GPS Map & Breadcrumb Trails (Leaflet)   │
│  - Live Notification Intercept Stream & Search         │
│  - Application Inventory & 24h Usage Statistics        │
│  - Remote Command Center with Status Monitor           │
│  - Diagnostic Audio Player & Security Audit Trail      │
└────────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start

### 1. Run the Backend & Dashboard

#### Option A: Docker Compose (PostgreSQL + Backend)
```bash
cp .env.example .env
# Generate a JWT secret and set it (plus POSTGRES_PASSWORD) in .env:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
docker-compose up -d
```
The Web Dashboard is available at `http://localhost:8080`.

#### Option B: Standalone Node.js (zero external dependencies)
The backend includes an embedded in-memory store for development (all data is
lost on restart — use PostgreSQL for anything real):
```bash
cd server
npm install
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))") npm start
```
Open `http://localhost:3000` in your browser (or set `PORT`).

#### First administrator (fresh install)
There are **no default accounts**. On a fresh instance, either:

1. Set `ADMIN_EMAIL` / `ADMIN_PASSWORD` (and optional `ADMIN_USERNAME`) in `.env`
   before boot, or
2. Call the one-time bootstrap endpoint while the users table is empty:
   ```bash
   curl -X POST http://localhost:3000/api/auth/bootstrap \
     -H 'Content-Type: application/json' \
     -d '{"username":"admin","email":"you@example.com","password":"a-strong-password"}'
   ```

The bootstrap endpoint disables itself as soon as one account exists. If you are
migrating a deployment that used the old `admin/admin` accounts: those accounts
still exist in your database — reset their passwords via SQL
(`UPDATE users SET password_hash = '<new bcrypt hash>' WHERE email = '...';`)
or create a new account and transfer device ownership (`UPDATE devices SET user_id = ...`).

#### Secret rotation (existing deployments)
Treat every previously committed secret as compromised and rotate it:
`JWT_SECRET` (from `docker-compose.yml` / old `.env`), the default account
passwords, and the Android debug keystore that was embedded in `codemagic.yaml`.
After changing `JWT_SECRET`, all issued tokens (user and device) become invalid
and devices must re-pair.

---

### 2. Build and Install the Android Agent

1. Open this repository in Android Studio or compile with Gradle:
   ```bash
   gradle assembleDebug
   ```
2. Install the generated APK onto your test device:
   ```bash
   adb install app/build/outputs/apk/debug/app-debug.apk
   ```
3. Open the **Device Manager** app on your phone.
4. Set the **Server URL**:
   - For Android Emulator: `http://10.0.2.2:8080`
   - For physical device on same Wi-Fi: `http://<your-computer-lan-ip>:8080`
5. On the Web Dashboard, click **Pair New Device** to generate a 6-digit pairing code.
6. Enter the pairing code in the Android app and tap **Pair Device**.

---

## 📱 Command Center & Remote Commands

Every dashboard command runs end-to-end: the dashboard button maps to a
**canonical command type** validated by the server registry
(`server/src/commands.js`), queued with an expiry, delivered over the device
WebSocket, executed by the Android agent, and completed **only** when the agent
returns a validated result. The dashboard history shows the full lifecycle,
result or error text, and offers Cancel/Retry.

Capture commands use **visible user consent** on the device:

- 📸 **Capture Screen** (`TAKE_SCREENSHOT`) — one frame via Android
  MediaProjection after the user passes the system consent dialog.
- 📷 **Take Photo** (`TAKE_PHOTO`) — opens the system camera; the device user
  taps the shutter.
- 🎬 **Screen recording** (`START_RECORDING` / `STOP_RECORDING` /
  `RECORDING_STATUS`) — video-only (no microphone; Android blocks background
  mic access), visible notification while recording, auto-stop at 5 min or
  50 MB, finalized and uploaded before the dashboard shows anything.
- Declines are reported as `REJECTED`, unanswered requests time out as
  `FAILED`. Nothing is captured silently.

Media uploads land in private server storage and are served **only** to the
authenticated device owner (`GET /uploads/:filename` + ownership check).

Command reference and schema: [docs/COMMAND_CONTRACT.md](docs/COMMAND_CONTRACT.md).

### Staging test & deployment procedure

1. `cd server && npm test` — full regression suite (commands, lifecycle,
   media, auth, WS, ingestion).
2. Start an isolated stack with test secrets:
   ```bash
   cp .env.example .env            # set JWT_SECRET + POSTGRES_PASSWORD
   docker compose up --build       # PostgreSQL + backend on :3000
   ```
   or standalone: `cd server && JWT_SECRET=<test-secret> npm start`.
3. `POST /api/auth/bootstrap` to create the staging admin, pair a test device,
   and exercise the Command Center buttons; verify each status transition and
   the screenshot/recording consent flow on the device.
4. Build the Android APK from this branch
   (`./gradlew :app:assembleDebug`, JDK 17 + Android SDK 36) and install it on
   a physical device — screen capture cannot be exercised on an emulator
   reliably.
5. Deploy to production only after the staging checklist passes; rotate
   `JWT_SECRET` and re-pair devices per the secret-rotation section above.

---

## 🔒 Transparency & Permission Model

This system strictly adheres to Android's official security and privacy model:

1. **Persistent Notification:** A persistent foreground service notification titled *"Device Management Active"* remains visible in the system status bar at all times, with a single tap leading to the **DEVICE MANAGEMENT STATUS** screen.
2. **Dedicated Privacy Screen:** The Android app displays live transparency statuses:
   - Location: `ENABLED / DISABLED`
   - Notification Access: `ENABLED / DISABLED`
   - Files/Media: `ENABLED / DISABLED`
   - Camera: `ENABLED / DISABLED`
   - Microphone: `ENABLED / DISABLED`
   - Usage Access: `ENABLED / DISABLED`
   - Screen Sharing: `NOT ACTIVE / ACTIVE`
3. **One-Tap Revocation & Disconnect:** The device user can disconnect and revoke the pairing token at any time via the `[Disconnect Device]` button.
4. **No Stealth Mechanics:** No hidden icons, no root exploits, no persistent background services designed to bypass OS restrictions.

---

## 📋 Features Implemented

- **Pairing System:** Secure 6-digit pairing code generator with 10-minute expiry countdown and JWT device token generation.
- **Real-Time Telemetry:** Battery percentage & charging state, internal storage free/total, RAM memory free/total, network SSID, Android OS version, SDK version, uptime.
- **Live Location Tracking:** GPS & Network location queries using `FusedLocationProviderClient`, displayed with pinpoint accuracy circles and historical breadcrumbs on Leaflet.
- **Notification Capture:** `NotificationListenerService` capturing app name, title, text, category, and timestamp with full text search and deletion controls.
- **App Inventory & Usage:** Full inventory of installed system and third-party apps, plus 24-hour foreground usage stats via `UsageStatsManager`.
- **Remote Command Center:** WebSocket-dispatched commands with a canonical lifecycle (`QUEUED` ➔ `DELIVERED` ➔ `RECEIVED` ➔ `EXECUTING` ➔ `COMPLETED` / `FAILED` / `REJECTED` / `EXPIRED` / `CANCELLED`), offline queueing with delivery deadlines, idempotent replay, and structured results. See [docs/COMMAND_CONTRACT.md](docs/COMMAND_CONTRACT.md).
- **Offline Resilience:** Room database local event queue for offline telemetry, location, and notifications with automatic synchronization when reconnected.
- **Audit System:** Immutable administrative audit logs capturing timestamps, user IDs, actions, IP addresses, and payload details.
