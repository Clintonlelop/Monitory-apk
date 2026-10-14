# Implementation Plan - Android MDM & Glassmorphism Web Control Dashboard

This plan outlines the complete build for a modern, mobile-first Web Control Dashboard and an Android Client APK for personal educational device management and health monitoring.

---

## System Architecture Overview

```
 ┌─────────────────────────────────────────────────────────┐
 │               Android Client APK (MDM Agent)            │
 │  - Onboarding, Sign-Up (Username, Gmail, Password)     │
 │  - Runtime Permission Audit & Consent Screen            │
 │  - Persistent Foreground Service Notification           │
 │  - Location, SMS, Call Recording, Telemetry, Remote Cmd │
 └────────────────────────────┬────────────────────────────┘
                              │ HTTPS / WebSocket Sync
 ┌────────────────────────────▼────────────────────────────┐
 │                  Node.js Backend & Database             │
 │  - Express REST API & WebSocket Server                  │
 │  - User Auth (JWT), Device Management & Telemetry DB    │
 │  - Serves Single-Page Web Dashboard Assets              │
 └────────────────────────────┬────────────────────────────┘
                              │ Real-time Data & Remote Controls
 ┌────────────────────────────▼────────────────────────────┐
 │         Modern Glassmorphism Web Control Dashboard      │
 │  - Dark Navy/Slate layout, Glass backdrop blur & borders │
 │  - Dashboard, Devices, Security, Telemetry, Settings    │
 │  - Call Audio Streaming & Transcript/Translation View    │
 │  - Remote Screen Recording & Geofence Safe Zones         │
 └─────────────────────────────────────────────────────────┘
```

---

## Component Details

### 1. Android Client Application (`app/`)
- **Onboarding & Auth (`SetupActivity`)**:
  - Introduction screen presenting device management features.
  - Sign-Up screen for Username, Gmail address, and Password.
  - Sign-In screen with pre-set server URL toggle.
- **Permissions Audit (`PermissionsActivity`)**:
  - Interactive status badges and "Accept All Permissions" button.
  - Requests: Location (GPS/Network), SMS, Call Logs, Audio Recording (Microphone), Media Gallery, Contacts, Notifications, and Accessibility.
- **Foreground Service & Sync (`MainForegroundService`)**:
  - Displays persistent, non-dismissible status bar notification for full transparency.
  - Periodically uploads device telemetry, battery stats, network specs, call logs, and location coordinates to the server.
  - Receives and executes remote commands (Screenshot capture, short audio recording, screen recording start/stop).
- **Educational Disclaimer**: In-app card stating monitoring requires explicit user permission and ownership.

### 2. Node.js Express Backend & Web Server (`server/`)
- **Database Schema (`server/src/db/schema.js`)**:
  - `users`: Stores account credentials (Username, Email, Password Hash).
  - `devices`: Tracks registered devices, specs, online/offline status, SIM details.
  - `telemetry`, `locations`, `sms_logs`, `call_logs`, `call_recordings`, `geofences`, `screen_recordings`, `audit_logs`.
- **API Routes**:
  - `/api/auth/register`, `/api/auth/login`: Handles authentication.
  - `/api/devices`, `/api/telemetry`, `/api/locations`, `/api/commands`: Handles client data & remote control execution.
  - `/api/recordings`: Audio/video stream endpoints.
- **AI Audio Processing**: If Gemini API key is configured, provides transcription & translation for call recordings; falls back to local player with mock transcript when absent.

### 3. Glassmorphism Web Control Dashboard (`public/`)
- **Theme & UI Design**:
  - Deep Navy/Slate background (`slate-900/80`), backdrop blur (`backdrop-blur-md`), white outline accents (`border-white/10`).
  - Neon Cyan (`#06b6d4`) for online status, Emerald (`#10b981`) for secure status, Rose (`#f43f5e`) for alerts.
  - Mobile-first layout with top header profile and bottom navigation bar.
  - Prominent disclaimer banner: *"FOR EDUCATIONAL USE ONLY. MONITORING REQUIRES EXPLICIT USER CONSENT."*
- **Main Dashboard Views**:
  1. **Dashboard Tab**: Device Health circular progress metrics (Battery %, CPU Temp, RAM), Network Status card (Signal, WiFi, IP), Security Score Gauge (e.g., 95% Secure), Recent Security Alerts Feed.
  2. **Devices Tab**: Registered devices list with status indicator. Detail View showing Installed Apps, Storage Breakdown, and Leaflet GPS location map.
  3. **Security Tab**: Remote action toggle controls (Lock, Wipe, Reset Password, Start Screen Recording, Ambient Mic), Permission audit matrix, Geofence safe zone editor.
  4. **Logs & Media Tabs**: SMS/Call logs with audio player and transcript/translation panel, Screen recording video player list, Notification history, Clipboard records, Data Export (JSON/CSV).
  5. **Settings Tab**: API key setup, notification toggles, data retention policies.

---

## Verification & Execution Plan

1. **Build & Compile**:
   - Compile Android app with `compile_applet` to confirm zero build errors.
   - Run backend server and test REST API endpoints with `curl`.
2. **End-to-End Test Journey**:
   - Complete registration and login on Android app.
   - Verify permission prompts and foreground service status bar display.
   - Access Web Control Dashboard on server URL, log in with registered credentials, and verify live telemetry, device health metrics, call recording streaming, and remote command execution.
