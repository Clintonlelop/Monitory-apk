# Monitory Command Contract

Single source of truth: [`server/src/commands.js`](../server/src/commands.js)
(registry + validation + lifecycle) and [`server/src/command-store.js`](../server/src/command-store.js)
(persistence + transition enforcement). The Android agent mirrors this contract
in `DeviceRepository.handleCommand` and reports through the same vocabulary.

## Wire format

```jsonc
{
  "commandId":   "cmd_1712345678901_a1b2c3",  // unique per command
  "deviceId":    "dev_...",                    // target device
  "commandType": "TAKE_SCREENSHOT",            // registry key (normalized)
  "parameters":  { "key": "string value" },    // STRING-valued map (validated)
  "status":      "QUEUED",                     // canonical lifecycle status
  "timestamp":   1712345678901,                // creation (epoch ms)
  "expiresAt":   1712388878901                 // delivery deadline (epoch ms)
}
```

- Every command has a unique `commandId`, a validated `parameters` map, the
  target device, the requesting user (persisted server-side), creation and
  expiry timestamps, and a truthful lifecycle `status`.
- `parameters` values are **strings** on the wire (numbers are coerced, e.g.
  `"10"`), so the Moshi model on Android stays simple and strict.
- Optional `idempotencyKey` (dispatch request) makes retries return the
  original command instead of creating a duplicate.

## Lifecycle

```
QUEUED ──▶ DELIVERED ──▶ RECEIVED ──▶ EXECUTING ──▶ COMPLETED
   │           │             │            │
   │           │             │            ├──▶ FAILED
   │           │             │            └──▶ REJECTED   (user declined consent)
   │           │             ├──▶ FAILED / REJECTED / CANCELLED
   │           └──▶ EXPIRED / CANCELLED / FAILED
   └──▶ EXPIRED / CANCELLED
```

| Status | Meaning |
|---|---|
| `QUEUED` | Persisted; the device is offline or delivery has not been attempted |
| `DELIVERED` | Written to the device socket (NOT proof of execution) |
| `RECEIVED` | The Android agent parsed and accepted the command |
| `EXECUTING` | The agent is working (capture commands stay here while awaiting user consent) |
| `COMPLETED` | The agent produced a validated execution result |
| `FAILED` | Execution error (structured `error_message`) |
| `REJECTED` | The device user declined a consent dialog (not a bug) |
| `EXPIRED` | Not delivered before `expiresAt` — never replayed |
| `CANCELLED` | Cancelled by the dashboard before execution started |

Ingress aliases (accepted, then normalized): `PENDING→QUEUED`,
`SENT→DELIVERED`, `RUNNING→EXECUTING`. A successful WebSocket send never
produces `COMPLETED`; only the device's validated result does.

- Terminal states (`COMPLETED/FAILED/REJECTED/EXPIRED/CANCELLED`) are
  immutable; duplicate reports of the *same* status are idempotent no-ops.
- Backward transitions (`COMPLETED → EXECUTING`, …) are rejected with `409`.
- Reconnect policy: `QUEUED` and never-acknowledged `DELIVERED` commands are
  redelivered (device-side `commandId` dedupe prevents double execution);
  `RECEIVED/EXECUTING` are never replayed; expired work is marked `EXPIRED`.

## Command registry

| Command | Parameters | Consent | Android implementation | Result |
|---|---|---|---|---|
| `REFRESH_TELEMETRY` | — | — | telemetry sync | text |
| `REFRESH_PERMISSIONS` | — | — | permissions sync | text |
| `REQUEST_LOCATION` | — | location | GPS fix + sync | text |
| `REQUEST_APPS` / `SYNC_APPLICATIONS` | — | — | app inventory sync | text |
| `REQUEST_USAGE` / `SYNC_USAGE` | — | usage access | usage sync | text |
| `SYNC_DEVICE` | — | — | telemetry + permissions | text |
| `SYNC_FILES` | — | storage | file list sync | text |
| `SYNC_NOTIFICATIONS` | — | notification listener | listener status | text |
| `SYNC_CONTACTS` | — | READ_CONTACTS | contacts sync | text |
| `SYNC_SMS` | — | READ_SMS | SMS sync | text |
| `SYNC_CALLS` | — | READ_CALL_LOG | call log sync | text |
| `SYNC_KEYSTROKES` | — | accessibility | accessibility text log sync | text |
| `SEND_NOTIFICATION` | `title?`, `message?` (≤120/500 chars) | notifications | shows notification | text |
| `RING_ALARM` | `durationSeconds?` 3–30 | — | alarm at full volume | text |
| `VIBRATE` | `durationMs?` 100–2000 | VIBRATE | vibration | text |
| `TAKE_SCREENSHOT` | — | **screen-capture** | MediaProjection 1-frame JPEG → `POST /screenshots` | media JSON |
| `TAKE_PHOTO` | — | **camera** | system camera app (user taps shutter) → `POST /screenshots` (kind=camera) | media JSON |
| `RECORD_AUDIO` | `durationSeconds?` 1–60 | mic | timed audio clip → `POST /recordings` | media JSON |
| `START_RECORDING` | — | **screen-capture** | MediaProjection + MediaRecorder session (video-only, ≤5 min/50 MB) | stays `EXECUTING` until finalized |
| `STOP_RECORDING` | — | — | finalize + upload video → `POST /videos` | media JSON |
| `RECORDING_STATUS` | — | — | session state | text JSON |
| `LOCK_DEVICE` | — | Device Admin | `DevicePolicyManager.lockNow()` | text |
| `WIPE_DEVICE` | `confirm="WIPE"` (**required**) | visible confirm | wipes agent data + unpairs (NOT a factory reset) | text |
| `LAUNCH_APP` | `packageName` (required) | — | launch intent | text |
| `UNINSTALL_APP` | `packageName` (required) | user confirms system dialog | uninstall dialog | text |
| `UPLOAD_FILE` | `path` under `/storage/emulated/0/…` | storage | upload file → `POST /upload-file` | text |

Unknown `commandType` → `400 Unknown commandType…` (never a silent success).
Unknown/invalid parameters → `400` before anything is queued.

## Media pipeline

- `POST /api/devices/:id/screenshots` (device token) — multipart `file`
  (JPEG/PNG/WebP, ≤12 MB) + `kind` (`screenshot`|`camera`), `width`, `height`.
- `POST /api/devices/:id/videos` (device token) — multipart `file`
  (video/mp4|webm|3gpp|quicktime|matroska, ≤50 MB) + `durationMs`.
- `POST /api/devices/:id/recordings` — audio clips (25 MB cap).
- Reads: `GET /api/devices/:id/screenshots`, `GET /api/devices/:id/videos`,
  `GET /api/devices/:id/recordings` (owner only).
- Download/streaming: `GET /uploads/:filename` requires a **user** token and
  device ownership (files, recordings and screenshots all resolve through the
  same authorized route). There are no public/unauthenticated media URLs.

## Status endpoints

- `POST /api/devices/:id/commands` (user, owner) — dispatch
  `{ commandType, parameters?, idempotencyKey?, ttlSeconds? (1–86400) }`
- `GET /api/devices/:id/commands` (user, owner) — history (lazy expiry applied)
- `POST /api/devices/:id/commands/:commandId/status` (device or owner) —
  lifecycle report with transition enforcement
- `POST /api/devices/:id/commands/:commandId/cancel` (user, owner) — cancel
  pre-execution commands (`QUEUED/DELIVERED/RECEIVED`); idempotent

## Android consent model

Commands that capture screen or camera start a **visible** flow: a persistent
notification opens `CaptureConsentActivity`, which explains the request; the
user must tap Allow **and** pass the Android system dialog (MediaProjection /
camera app). Declines are reported as `REJECTED`; unanswered requests time out
(2 min) as `FAILED`. Screen recordings keep a visible foreground notification
for their duration and are video-only (Android blocks background microphone
access; silent audio capture would be non-consensual anyway).
