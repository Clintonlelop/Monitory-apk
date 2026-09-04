# Android Device Management & Monitoring System

A complete, production-ready, fully transparent Android Device Management agent and full-stack administrative infrastructure built with modern Kotlin, Jetpack Compose, Node.js, WebSockets, PostgreSQL, and an interactive Web Admin Dashboard.

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
docker-compose up -d
```
The Web Dashboard is now available at `http://localhost:8080` (or your configured domain).

#### Option B: Standalone Node.js
Use environment variables from `.env.example` and run the backend directly:
```bash
cd server
npm install
npm start
```
Open `http://localhost:8080` in your browser.

In production, always disable default local credentials and create real accounts via `/api/auth/register`.

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
4. Set the **Server URL** to your deployed HTTPS API URL (for example `https://api.example.com`).
5. On the Web Dashboard, click **Pair New Device** to generate a 6-digit pairing code.
6. Enter the pairing code in the Android app and tap **Pair Device**.

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
- **Remote Command Center:** WebSocket-dispatched commands (`SYNC_DEVICE`, `REQUEST_LOCATION`, `REQUEST_APPS`, `REQUEST_USAGE`, `SEND_NOTIFICATION`, `START_RECORDING`, `STOP_RECORDING`) with real-time state transitions (`PENDING` ➔ `RUNNING` ➔ `COMPLETED` / `FAILED`).
- **Offline Resilience:** Room database local event queue for offline telemetry, location, and notifications with automatic synchronization when reconnected.
- **Audit System:** Immutable administrative audit logs capturing timestamps, user IDs, actions, IP addresses, and payload details.
